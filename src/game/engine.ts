import {
  compareBoardEntities,
  formatCellLabel,
  formatLaneLabelZh,
  isValidCell,
  normalizeLaneId,
  resolveLaneProfile,
  validateBoardProfile,
} from './board';
import {
  addCombatLog,
  defOf,
  drawCards,
  entityName,
  evaluateWinner,
  grantCpWithCap,
  HAND_LIMIT,
  playerLabel,
  removeEntityByDefeatOrDestroy,
  updateInstance,
  updatePlayer,
  type DrawResult,
} from './combat-primitives';
import {
  executeImmediateAttackForUnit,
  expireStatusesAtTurnEnd,
  expireStatusesAtTurnStart,
  resolveCombat,
} from './combat';
import {
  executeEffectOps,
  isOperatorDeployPositionAllowed,
  triggerEntityDestroyedEffects,
  triggerUnitEventBlocks,
  validateTacticOrSupportPlay,
} from './effects';
import { normalizeSeed, seededRandomSource, shuffleDeck } from './random';
import type { RandomSource } from './random';
import {
  canTriggerOwnEffects,
  getEntityKind,
  getEntityStats,
  getFirstEmptyCellInLane,
  isCellOccupied,
  isFacilityDisabled,
} from './range';
import type {
  BasePoints,
  BoardProfile,
  CardDefinition,
  CardId,
  CardInstance,
  CardInstanceId,
  Cost,
  DeckDefinition,
  GameAction,
  GamePhase,
  GameState,
  HpValue,
  LaneId,
  OpenDecisionConfig,
  OperatorCombatState,
  OperatorLifecycleState,
  PaidDeployCost,
  PendingEffectChoice,
  PlayerId,
  Position,
  SpValue,
} from './types';
import { CLASSIC_BOARD_PROFILE } from './board';

export const OPENING_HAND_SIZE = 5;
export { HAND_LIMIT, drawCards, type DrawResult };
export const STARTING_BASE_POINTS = 20;
export const STARTING_COST = 0;
export const COST_PER_TURN = 3;
export const MAX_COST = 10;
export const MAX_ACTIVE_FACILITIES = 2;
export const MAX_EQUIPMENT_PER_OPERATOR = 1;
export const DEFAULT_CP_CURVE: readonly number[] = [3, 4, 5, 6, 7, 8];

export const DEFAULT_OPEN_DECISION_CONFIG: OpenDecisionConfig = {
  shieldCap: null,
  maxFocusChangesPerTurn: null,
  disabledFacilityContinuesCountdown: true,
  manualRecallCpCost: 0,
  aoeTargetLimit: null,
};

const PLAYER_IDS: readonly PlayerId[] = ['player_a', 'player_b'];

export type EngineResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly value: T; readonly reason: string };

export interface InitialGameOptions {
  readonly decks: Readonly<Record<PlayerId, DeckDefinition>>;
  readonly cards: readonly CardDefinition[];
  readonly seed: number;
  readonly randomSource?: RandomSource;
  readonly boardProfile?: BoardProfile;
  readonly cpCurve?: readonly number[];
  readonly openDecisionConfig?: Partial<OpenDecisionConfig>;
}

function makeInstanceId(playerId: PlayerId, deckId: string, cardId: CardId, copy: number): CardInstanceId {
  return `${playerId}:${deckId}:${cardId}:${copy}` as CardInstanceId;
}

function setPlayer(state: GameState, playerId: PlayerId, player: GameState['players'][PlayerId]): GameState {
  return { ...state, players: { ...state.players, [playerId]: player } };
}

function setInstances(state: GameState, updates: Readonly<Record<CardInstanceId, CardInstance>>): GameState {
  return { ...state, card_instances: { ...state.card_instances, ...updates } };
}

function makePlayer(playerId: PlayerId, deck: readonly CardInstanceId[]): GameState['players'][PlayerId] {
  return {
    player_id: playerId,
    base_points: STARTING_BASE_POINTS as BasePoints,
    cost: STARTING_COST as Cost,
    turn_cp_cap: 5,
    hand: [],
    deck,
    discard: [],
    facility_ids: [],
    fatigue_count: 0,
    turns_taken: 0,
    own_turn_index: 0,
    focus_target_id: null,
    focus_target_changes_this_turn: 0,
    next_deploy_discounts: [],
    facility_first_deploy_discount_used_turn: null,
    assault_bonus_used: false,
  };
}

function expandDeck(playerId: PlayerId, deck: DeckDefinition, cardsById: ReadonlyMap<CardId, CardDefinition>): CardInstance[] {
  const instances: CardInstance[] = [];
  const copiesByCard = new Map<CardId, number>();
  const copiesByName = new Map<string, number>();
  for (const entry of deck.cards) {
    if (!Number.isInteger(entry.quantity) || entry.quantity < 1) {
      throw new RangeError(`牌组 ${deck.deck_id} 中 ${entry.card_id} 的数量必须是正整数。`);
    }
    const definition = cardsById.get(entry.card_id);
    if (!definition) {
      throw new Error(`牌组 ${deck.deck_id} 引用了不存在的卡牌 ${entry.card_id}。`);
    }
    const sameNameTotal = (copiesByName.get(definition.card_name_zh) ?? 0) + entry.quantity;
    if (sameNameTotal > 2) {
      throw new Error(`牌组 ${deck.deck_id} 中同名卡「${definition.card_name_zh}」超过 2 张。`);
    }
    copiesByName.set(definition.card_name_zh, sameNameTotal);
    for (let copy = 0; copy < entry.quantity; copy += 1) {
      const serial = (copiesByCard.get(entry.card_id) ?? 0) + 1;
      copiesByCard.set(entry.card_id, serial);
      const cardInstanceId = makeInstanceId(playerId, deck.deck_id, entry.card_id, serial);
      instances.push({
        card_instance_id: cardInstanceId,
        card_id: entry.card_id,
        owner_id: playerId,
        controller_id: playerId,
        entity_kind: definition.card_type === 'facility' || definition.support_subtype === 'facility' ? 'facility' : 'operator',
        board_half: null,
        lane: null,
        position: null,
        slot_index: null,
        zone: 'deck',
      });
    }
  }
  if (instances.length < OPENING_HAND_SIZE) {
    throw new RangeError(`牌组 ${deck.deck_id} 至少需要 ${OPENING_HAND_SIZE} 张才能发起手牌。`);
  }
  return instances;
}

export function createInitialGameState(options: InitialGameOptions): GameState {
  const { decks, cards } = options;
  const boardProfile = options.boardProfile ?? CLASSIC_BOARD_PROFILE;
  const boardValidation = validateBoardProfile(boardProfile);
  if (!boardValidation.valid) {
    throw new Error(`棋盘配置不合法：${boardValidation.errors.join(' ')}`);
  }

  const cpCurve = options.cpCurve && options.cpCurve.length > 0 ? [...options.cpCurve] : [...DEFAULT_CP_CURVE];
  const openDecisionConfig: OpenDecisionConfig = {
    ...DEFAULT_OPEN_DECISION_CONFIG,
    ...(options.openDecisionConfig ?? {}),
  };

  const randomSource = options.randomSource ?? seededRandomSource;
  const seed = normalizeSeed(options.seed);
  const cardsById = new Map<CardId, CardDefinition>();
  for (const card of cards) {
    if (cardsById.has(card.card_id)) throw new Error(`卡牌定义 ID 重复：${card.card_id}。`);
    cardsById.set(card.card_id, card);
  }

  const cardInstances: Record<CardInstanceId, CardInstance> = {};
  const playerDeckIds = {} as Record<PlayerId, CardInstanceId[]>;
  let randomState = seed;
  for (const playerId of PLAYER_IDS) {
    const expanded = expandDeck(playerId, decks[playerId], cardsById);
    for (const instance of expanded) cardInstances[instance.card_instance_id] = instance;
    const shuffled = shuffleDeck(expanded.map((instance) => instance.card_instance_id), randomState, randomSource);
    randomState = shuffled.randomState;
    playerDeckIds[playerId] = shuffled.deck;
  }

  let state: GameState = {
    rules_version: '1.1',
    board_profile: boardProfile,
    cp_curve: cpCurve,
    open_decision_config: openDecisionConfig,
    card_definitions: Object.fromEntries(cardsById) as Record<CardId, CardDefinition>,
    players: {
      player_a: makePlayer('player_a', playerDeckIds.player_a),
      player_b: makePlayer('player_b', playerDeckIds.player_b),
    },
    card_instances: cardInstances,
    mulligan_completed: { player_a: false, player_b: false },
    random_state: randomState,
    active_player_id: 'player_a',
    phase: 'mulligan',
    turn_number: 0,
    state_version: 0,
    status_sequence: 0,
    next_entity_seq: 0,
    winner: null,
    combat_log: [],
    pending_effect_choices: [],
    turn_start_prepared: false,
  };

  for (const playerId of PLAYER_IDS) state = drawCards(state, playerId, OPENING_HAND_SIZE).state;
  return state;
}

export function mulligan(
  state: GameState,
  playerId: PlayerId,
  selectedCardInstanceIds: readonly CardInstanceId[],
  randomSource: RandomSource = seededRandomSource,
): EngineResult<GameState> {
  const player = state.players[playerId];
  if (state.phase !== 'mulligan') return { ok: false, value: state, reason: '当前不在起手换牌阶段。' };
  if (!player) return { ok: false, value: state, reason: `找不到玩家 ${playerId}。` };
  if (state.mulligan_completed[playerId]) return { ok: false, value: state, reason: '该玩家已经完成起手换牌。' };
  if (selectedCardInstanceIds.length > OPENING_HAND_SIZE) return { ok: false, value: state, reason: `最多选择 ${OPENING_HAND_SIZE} 张起手牌。` };
  if (new Set(selectedCardInstanceIds).size !== selectedCardInstanceIds.length) return { ok: false, value: state, reason: '换牌选择中有重复卡实例。' };
  if (selectedCardInstanceIds.some((id) => !player.hand.includes(id))) return { ok: false, value: state, reason: '换牌只能选择自己的起手手牌。' };
  if (player.deck.length < selectedCardInstanceIds.length) return { ok: false, value: state, reason: '牌库剩余张数不足，无法等量补牌。' };

  const selected = new Set(selectedCardInstanceIds);
  const remainingHand = player.hand.filter((id) => !selected.has(id));
  const basePlayer = { ...player, hand: remainingHand };
  let nextState = setPlayer(state, playerId, basePlayer);
  const replacementDraw = drawCards(nextState, playerId, selectedCardInstanceIds.length);
  nextState = replacementDraw.state;
  const updatedPlayer = nextState.players[playerId];
  const shuffled = shuffleDeck([...updatedPlayer.deck, ...selectedCardInstanceIds], nextState.random_state, randomSource);
  const instanceUpdates: Record<CardInstanceId, CardInstance> = {};
  for (const id of selectedCardInstanceIds) {
    const instance = state.card_instances[id];
    if (instance) instanceUpdates[id] = { ...instance, zone: 'deck' };
  }
  nextState = setPlayer(nextState, playerId, { ...updatedPlayer, deck: shuffled.deck });
  nextState = setInstances(nextState, instanceUpdates);
  nextState = {
    ...nextState,
    random_state: shuffled.randomState,
    mulligan_completed: { ...nextState.mulligan_completed, [playerId]: true },
    state_version: nextState.state_version + 1,
  };

  if (PLAYER_IDS.every((id) => nextState.mulligan_completed[id])) {
    const firstPlayerRoll = randomSource(nextState.random_state);
    if (!Number.isFinite(firstPlayerRoll.value) || firstPlayerRoll.value < 0 || firstPlayerRoll.value >= 1 || !Number.isInteger(firstPlayerRoll.state)) {
      return { ok: false, value: state, reason: 'randomSource 返回了无效随机值。' };
    }
    const firstPlayer: PlayerId = firstPlayerRoll.value < 0.5 ? 'player_a' : 'player_b';
    nextState = {
      ...nextState,
      active_player_id: firstPlayer,
      first_player_id: firstPlayer,
      phase: 'turn_start',
      turn_number: 1,
      random_state: normalizeSeed(firstPlayerRoll.state),
    };
  }
  return { ok: true, value: nextState };
}

function findCardDefinition(state: GameState, cardId: CardId): CardDefinition | undefined {
  return state.card_definitions[cardId];
}

function initialOperatorCombat(definition: CardDefinition): OperatorCombatState {
  return {
    current_hp: (definition.hp ?? 1) as HpValue,
    current_atk_modifiers: [],
    permanent_atk_bonus: 0,
    current_sp: (definition.starting_sp ?? 0) as SpValue,
    shield: 0,
    statuses: [],
    equipment_ids: [],
    equipped_package: null,
    temp_modifiers: [],
    took_hp_damage_last_owner_turn: false,
    took_hp_damage_this_owner_turn: false,
    per_combat_trigger_counts: {},
    per_turn_trigger_counts: {},
    granted_immediate_attack_this_turn: false,
    consumed_normal_attack_this_turn: false,
  };
}

function hasCardInHand(state: GameState, playerId: PlayerId, cardInstanceId: CardInstanceId): boolean {
  const instance = state.card_instances[cardInstanceId];
  return Boolean(instance && instance.owner_id === playerId && instance.zone === 'hand' && state.players[playerId].hand.includes(cardInstanceId));
}

function hasActiveLogisticsStation(state: GameState, playerId: PlayerId): boolean {
  const player = state.players[playerId];
  if (!player) return false;
  if (player.facility_first_deploy_discount_used_turn === player.own_turn_index) return false;
  return player.facility_ids.some((fid) => {
    const fac = state.card_instances[fid];
    return (
      fac &&
      fac.zone === 'board' &&
      fac.card_id === ('DEMO-SUP-V2-006' as CardId) &&
      !isFacilityDisabled(state, fac)
    );
  });
}

function getEffectiveDeployCost(
  state: GameState,
  actorId: PlayerId,
  baseCost: number,
): { readonly finalCost: number; readonly logisticsUsed: boolean } {
  const player = state.players[actorId];
  let discount = 0;
  for (const d of player.next_deploy_discounts) {
    if (d.expires_player === actorId) discount += d.amount;
  }
  const logisticsUsed = hasActiveLogisticsStation(state, actorId);
  if (logisticsUsed) discount += 1;
  return {
    finalCost: Math.max(0, baseCost - discount),
    logisticsUsed,
  };
}

function deployOperator(
  state: GameState,
  actorId: PlayerId,
  cardInstanceId: CardInstanceId,
  lane: LaneId,
  position: Position,
  slotIndex = 1,
): EngineResult<GameState> {
  if (!hasCardInHand(state, actorId, cardInstanceId)) return { ok: false, value: state, reason: '只能部署自己手牌中的卡实例。' };
  const laneProfile = resolveLaneProfile(state.board_profile, lane);
  if (!laneProfile) return { ok: false, value: state, reason: '部署路线无效。' };
  if (!['front', 'back'].includes(position)) return { ok: false, value: state, reason: '部署位置无效。' };
  if (!isValidCell(state.board_profile, laneProfile.laneId, position, slotIndex)) {
    return { ok: false, value: state, reason: '目标棋盘格位不存在。' };
  }

  const instance = state.card_instances[cardInstanceId];
  const definition = findCardDefinition(state, instance.card_id);
  if (!definition || definition.card_type !== 'operator') return { ok: false, value: state, reason: '目标卡实例不是有效干员卡。' };
  const lifecycle = instance.operator_lifecycle;
  if (lifecycle && lifecycle.redeploy_cd_remaining > 0) {
    return { ok: false, value: state, reason: `再部署冷却尚未归零：${lifecycle.redeploy_cd_remaining}。` };
  }
  if (!isOperatorDeployPositionAllowed(definition, position)) return { ok: false, value: state, reason: '干员不能部署在所选位置。' };
  if (isCellOccupied(state, actorId, laneProfile.laneId, position, slotIndex)) {
    return { ok: false, value: state, reason: '所选部署位已被占用。' };
  }

  const player = state.players[actorId];
  const { finalCost, logisticsUsed } = getEffectiveDeployCost(state, actorId, definition.cost);
  if (player.cost < finalCost) return { ok: false, value: state, reason: '费用不足。' };

  const canonicalLane = laneProfile.laneId;
  const nextLifecycle: OperatorLifecycleState = {
    redeploy_cd_remaining: 0,
    redeploy_cd_applied_owner_turn_index: null,
    has_deployed_before: true,
    entered_battle_this_owner_turn: true,
    paid_deploy_cost: finalCost as unknown as PaidDeployCost,
    once_per_game_flags: lifecycle?.once_per_game_flags ?? {},
  };

  const otherId: PlayerId = actorId === 'player_a' ? 'player_b' : 'player_a';
  const isSecondPlayer =
    (state.first_player_id !== undefined && state.first_player_id !== actorId) ||
    (state.first_player_id === undefined &&
      state.players[otherId].turns_taken > 0 &&
      player.turns_taken <= state.players[otherId].turns_taken);
  const triggersAssault = Boolean(isSecondPlayer && !player.assault_bonus_used);

  const baseCombat = initialOperatorCombat(definition);
  const deployedCombat: OperatorCombatState = triggersAssault
    ? {
        ...baseCombat,
        granted_immediate_attack_this_turn: true,
        statuses: [
          ...baseCombat.statuses,
          {
            status_id: 'assault_first_deploy',
            kind: 'assault',
            remaining_owner_turns: 1,
            applied_on_owner_turn_index: player.turns_taken,
            expire_at_node: 'combat_end',
            blocks_normal_withdrawal: false,
          },
        ],
      }
    : baseCombat;

  const deployed: CardInstance = {
    ...instance,
    entity_kind: 'operator',
    zone: 'board',
    board_half: actorId,
    lane: canonicalLane,
    position,
    slot_index: slotIndex,
    operator_combat: deployedCombat,
    operator_lifecycle: nextLifecycle,
  };

  const nextPlayer = {
    ...player,
    hand: player.hand.filter((id) => id !== cardInstanceId),
    cost: (player.cost - finalCost) as Cost,
    next_deploy_discounts: player.next_deploy_discounts.filter((d) => d.expires_player !== actorId),
    facility_first_deploy_discount_used_turn: logisticsUsed ? player.own_turn_index : player.facility_first_deploy_discount_used_turn,
    assault_bonus_used: triggersAssault ? true : player.assault_bonus_used,
  };

  let nextState = setPlayer(state, actorId, nextPlayer);
  nextState = setInstances(nextState, { [cardInstanceId]: deployed });

  const cellDesc = formatCellLabel(nextState.board_profile, canonicalLane, position, slotIndex);
  nextState = addCombatLog(nextState, {
    type: 'unit_deployed',
    source_instance_id: cardInstanceId,
    source_player_id: actorId,
    source_name: definition.card_name_zh,
    lane: canonicalLane,
    position,
    slot_index: slotIndex,
    amount: finalCost,
    action_type: 'deploy',
    detail: `${playerLabel(actorId)} 部署了【${definition.card_name_zh}】于 [${cellDesc}]（消耗 ${finalCost} CP${finalCost < definition.cost ? `，原价 ${definition.cost}` : ''}）。`,
  });

  if (triggersAssault) {
    nextState = addCombatLog(nextState, {
      type: 'effect_triggered',
      source_instance_id: cardInstanceId,
      target_instance_id: cardInstanceId,
      source_player_id: actorId,
      target_player_id: actorId,
      source_name: definition.card_name_zh,
      target_name: definition.card_name_zh,
      action_type: 'assault',
      detail: `${playerLabel(actorId)} 后手首个干员【${definition.card_name_zh}】获得【突击】，本回合可直接参与交锋。`,
    });
  }

  if (logisticsUsed) {
    nextState = addCombatLog(nextState, {
      type: 'effect_triggered',
      source_player_id: actorId,
      source_name: '后勤调度台',
      action_type: 'deploy_discount',
      amount: 1,
      detail: `${playerLabel(actorId)}【后勤调度台】触发，本次部署费用 -1 CP。`,
    });
  }

  // V1.1 skill_effects on_deploy
  if (definition.skill_effects && definition.skill_effects.length > 0) {
    nextState = triggerUnitEventBlocks(nextState, cardInstanceId, 'on_deploy', {
      onDrawCards: (s, pid, count) => drawCards(s, pid, count).state,
    }).state;
  } else if (definition.effect_trigger === 'on_deploy' && definition.effect_json?.actions?.length) {
    // 兼容旧测试夹具中未填写 skill_effects 的干员
    for (const action of definition.effect_json.actions) {
      if (action.type === 'gain_cost' && action.target === 'owner' && typeof action.value === 'number') {
        nextState = grantCpWithCap(nextState, actorId, action.value, definition.card_name_zh, cardInstanceId);
      }
    }
  }

  // 触发其他在场实体的 on_friendly_operator_deploy（除后勤调度台已计入外）
  const friendlyListeners = Object.values(nextState.card_instances)
    .filter((u) => u.zone === 'board' && u.controller_id === actorId && u.card_instance_id !== cardInstanceId && canTriggerOwnEffects(nextState, u))
    .sort((a, b) => compareBoardEntities(nextState.board_profile, a, b));
  for (const listener of friendlyListeners) {
    if (listener.card_id === ('DEMO-SUP-V2-006' as CardId)) continue;
    nextState = triggerUnitEventBlocks(nextState, listener.card_instance_id, 'on_friendly_operator_deploy', {
      primaryTargetId: cardInstanceId,
    }).state;
  }

  nextState = evaluateWinner(nextState);
  return {
    ok: true,
    value: { ...nextState, state_version: nextState.state_version + 1 },
  };
}

function withdrawNormally(state: GameState, actorId: PlayerId, targetId: CardInstanceId): EngineResult<GameState> {
  const instance = state.card_instances[targetId];
  if (!instance || instance.zone !== 'board') return { ok: false, value: state, reason: '撤离目标不在战场上。' };
  const definition = findCardDefinition(state, instance.card_id);
  if (!definition || getEntityKind(state, instance) !== 'operator' || !instance.operator_lifecycle || !instance.operator_combat) {
    return { ok: false, value: state, reason: '撤离目标不是有效的在场干员。' };
  }
  if (instance.controller_id !== actorId) return { ok: false, value: state, reason: '只能撤离当前由自己控制的干员。' };
  if (instance.board_half !== instance.controller_id) return { ok: false, value: state, reason: '普通撤离要求干员位于控制者自己的半区。' };
  if (instance.operator_combat.statuses.some((status) => status.blocks_normal_withdrawal)) {
    return { ok: false, value: state, reason: '该干员当前受到禁止普通撤离的控制状态。' };
  }

  // 关联召唤物一并按摧毁处理（cause = 'source_retreat'）
  let nextState = state;
  const linkedSummons = Object.values(nextState.card_instances).filter(
    (u) => u.zone === 'board' && u.summon_state?.source_instance_id === targetId,
  );
  for (const summon of linkedSummons) {
    nextState = removeEntityByDefeatOrDestroy(nextState, summon.card_instance_id, {
      cause: 'source_retreat',
      isEnemyKill: false,
      triggerOnEntityDestroyed: triggerEntityDestroyedEffects,
    });
  }

  const latestTarget = nextState.card_instances[targetId];
  const baseCd = Math.max(1, definition.redeploy_cd_base ?? 1);
  const nextLifecycle: OperatorLifecycleState = {
    ...(latestTarget.operator_lifecycle!),
    redeploy_cd_remaining: baseCd,
    redeploy_cd_applied_owner_turn_index: nextState.players[actorId].turns_taken,
    paid_deploy_cost: null,
  };

  const posDesc = formatCellLabel(nextState.board_profile, latestTarget.lane, latestTarget.position, latestTarget.slot_index);

  // V1.1: 普通撤离取消 CP 退款（refund = 0）；清理附着装备包，干员回手牌并启动再部署冷却
  const returned: CardInstance = {
    ...latestTarget,
    zone: 'hand',
    board_half: null,
    lane: null,
    position: null,
    slot_index: null,
    operator_combat: initialOperatorCombat(definition),
    operator_lifecycle: nextLifecycle,
  };

  nextState = updateInstance(nextState, targetId, () => returned);
  nextState = updatePlayer(nextState, latestTarget.owner_id, (p) => ({
    ...p,
    hand: p.hand.includes(targetId) ? p.hand : [...p.hand, targetId],
    focus_target_id: p.focus_target_id === targetId ? null : p.focus_target_id,
  }));
  const otherId: PlayerId = latestTarget.owner_id === 'player_a' ? 'player_b' : 'player_a';
  if (nextState.players[otherId].focus_target_id === targetId) {
    nextState = updatePlayer(nextState, otherId, (p) => ({ ...p, focus_target_id: null }));
  }

  nextState = addCombatLog(nextState, {
    type: 'unit_withdrawn',
    source_instance_id: targetId,
    source_player_id: actorId,
    source_name: definition.card_name_zh,
    lane: latestTarget.lane ?? undefined,
    position: latestTarget.position ?? undefined,
    slot_index: latestTarget.slot_index ?? undefined,
    amount: 0,
    action_type: 'withdraw',
    detail: `${playerLabel(actorId)}【${definition.card_name_zh}】从 [${posDesc}] 主动撤离返回手牌（无CP退款，再部署冷却 ${baseCd} 回合）。`,
  });

  return { ok: true, value: { ...nextState, state_version: nextState.state_version + 1 } };
}

function recallSummon(state: GameState, actorId: PlayerId, targetId: CardInstanceId): EngineResult<GameState> {
  const summon = state.card_instances[targetId];
  if (!summon || summon.zone !== 'board' || getEntityKind(state, summon) !== 'summon') {
    return { ok: false, value: state, reason: '回收目标不是在场召唤物。' };
  }
  if (summon.controller_id !== actorId) {
    return { ok: false, value: state, reason: '只能主动回收自己控制的召唤物。' };
  }
  if (summon.summon_state?.recallable_by_controller === false) {
    return { ok: false, value: state, reason: '该召唤物不可主动回收。' };
  }
  const recallCost = Math.max(0, state.open_decision_config.manualRecallCpCost ?? 0);
  const player = state.players[actorId];
  if (player.cost < recallCost) {
    return { ok: false, value: state, reason: `回收需要 ${recallCost} CP，当前费用不足。` };
  }

  let next = state;
  if (recallCost > 0) {
    next = updatePlayer(next, actorId, (p) => ({ ...p, cost: (p.cost - recallCost) as Cost }));
  }
  next = removeEntityByDefeatOrDestroy(next, targetId, {
    cause: 'manual_recall',
    isEnemyKill: false,
    triggerOnEntityDestroyed: triggerEntityDestroyedEffects,
  });
  next = evaluateWinner(next);
  return { ok: true, value: { ...next, state_version: next.state_version + 1 } };
}

function setFocusTarget(
  state: GameState,
  actorId: PlayerId,
  targetId: CardInstanceId | null,
): EngineResult<GameState> {
  const player = state.players[actorId];
  const maxChanges = state.open_decision_config.maxFocusChangesPerTurn;
  if (typeof maxChanges === 'number' && player.focus_target_changes_this_turn >= maxChanges) {
    return { ok: false, value: state, reason: `每回合最多更改 ${maxChanges} 次标记目标。` };
  }
  if (targetId !== null) {
    const target = state.card_instances[targetId];
    if (!target || target.zone !== 'board' || target.controller_id === actorId || !target.operator_combat) {
      return { ok: false, value: state, reason: '标记目标必须是一名在场的敌方实体（干员、召唤物或设施）。' };
    }
  }

  let next = updatePlayer(state, actorId, (p) => ({
    ...p,
    focus_target_id: targetId,
    focus_target_changes_this_turn: p.focus_target_changes_this_turn + 1,
  }));
  const targetInst = targetId ? next.card_instances[targetId] : undefined;
  next = addCombatLog(next, {
    type: 'focus_target_set',
    source_player_id: actorId,
    target_instance_id: targetId ?? undefined,
    target_name: targetInst ? entityName(next, targetInst) : undefined,
    detail: targetInst
      ? `${playerLabel(actorId)} 标记【${entityName(next, targetInst)}】为本回合优先攻击目标。`
      : `${playerLabel(actorId)} 取消了本回合标记目标。`,
  });
  return { ok: true, value: { ...next, state_version: next.state_version + 1 } };
}

function playFacilityCard(
  state: GameState,
  actorId: PlayerId,
  cardInstanceId: CardInstanceId,
  definition: CardDefinition,
  action: Extract<GameAction, { type: 'play_card' }>,
): EngineResult<GameState> {
  const player = state.players[actorId];
  if (player.facility_ids.length >= MAX_ACTIVE_FACILITIES) {
    return { ok: false, value: state, reason: `每方最多同时在场 ${MAX_ACTIVE_FACILITIES} 个设施。` };
  }
  if (player.cost < definition.cost) {
    return { ok: false, value: state, reason: '费用不足。' };
  }

  let laneId = action.target_lane ? normalizeLaneId(state.board_profile, action.target_lane) : null;
  let pos: Position | null = action.target_position ?? null;
  let slotIdx: number | null = action.target_slot_index ?? null;

  if (!laneId || !pos || !slotIdx) {
    return { ok: false, value: state, reason: '部署设施必须指定合法的己方空位格子（路线、前后排与格位序号）。' };
  }
  if (!isValidCell(state.board_profile, laneId, pos, slotIdx)) {
    return { ok: false, value: state, reason: '设施目标棋盘格位不存在。' };
  }
  if (isCellOccupied(state, actorId, laneId, pos, slotIdx)) {
    return { ok: false, value: state, reason: '所选棋盘格位已被占用，不能部署设施。' };
  }

  const instance = state.card_instances[cardInstanceId];
  const facilityHp = (definition.hp ?? 3) as HpValue;

  const placedFacility: CardInstance = {
    ...instance,
    entity_kind: 'facility',
    zone: 'board',
    board_half: actorId,
    lane: laneId,
    position: pos,
    slot_index: slotIdx,
    operator_combat: {
      current_hp: facilityHp,
      current_atk_modifiers: [],
      current_sp: 0 as SpValue,
      shield: 0,
      statuses: [],
      equipment_ids: [],
    },
    support_lifecycle: { turn_start_triggers: 0 },
    facility_state: {
      remaining_turns: facilityHp,
      disabled_until_owner_turn: null,
      pause_effects_when_disabled: true,
      continue_countdown_when_disabled: state.open_decision_config.disabledFacilityContinuesCountdown,
    },
  };

  let next = updatePlayer(state, actorId, (p) => ({
    ...p,
    cost: (p.cost - definition.cost) as Cost,
    hand: p.hand.filter((id) => id !== cardInstanceId),
    facility_ids: [...p.facility_ids, cardInstanceId],
  }));
  next = setInstances(next, { [cardInstanceId]: placedFacility });
  next = addCombatLog(next, {
    type: 'facility_deployed',
    source_instance_id: cardInstanceId,
    source_player_id: actorId,
    source_name: definition.card_name_zh,
    lane: laneId,
    position: pos,
    slot_index: slotIdx,
    amount: definition.cost,
    detail: `${playerLabel(actorId)} 部署了设施【${definition.card_name_zh}】于 [${formatCellLabel(next.board_profile, laneId, pos, slotIdx)}]（${facilityHp} HP，每回合自身扣除 1 HP）。`,
  });

  if (definition.skill_effects?.some((b) => b.trigger === 'on_deploy')) {
    next = triggerUnitEventBlocks(next, cardInstanceId, 'on_deploy').state;
  }

  return { ok: true, value: { ...next, state_version: next.state_version + 1 } };
}

function playCard(
  state: GameState,
  actorId: PlayerId,
  action: Extract<GameAction, { type: 'play_card' }>,
): EngineResult<GameState> {
  const { card_instance_id: cardInstanceId } = action;
  if (!hasCardInHand(state, actorId, cardInstanceId)) {
    return { ok: false, value: state, reason: '只能使用自己手牌中的卡实例。' };
  }
  const instance = state.card_instances[cardInstanceId];
  const definition = findCardDefinition(state, instance.card_id);
  if (!definition) return { ok: false, value: state, reason: '找不到卡牌定义。' };
  if (definition.card_type === 'operator') {
    return { ok: false, value: state, reason: '干员卡请使用部署动作。' };
  }

  if (definition.card_type === 'facility' || (definition.card_type === 'support' && definition.support_subtype === 'facility')) {
    return playFacilityCard(state, actorId, cardInstanceId, definition, action);
  }

  const player = state.players[actorId];
  if (player.cost < definition.cost) {
    return { ok: false, value: state, reason: '费用不足。' };
  }

  // Spec §7.1: 打出前严格校验目标和选择条件，不合法时保留手牌、不扣CP
  const validation = validateTacticOrSupportPlay(state, actorId, definition, {
    targetId: action.target_instance_id,
    secondaryTargetId: action.secondary_target_instance_id,
    targetLane: action.target_lane,
    targetLanes: action.target_lanes,
  });
  if (!validation.ok) {
    return { ok: false, value: state, reason: validation.reason ?? '目标或选择条件不合法。' };
  }

  // 支付费用并将一次性卡牌（战术卡 / 装备卡）移出棋盘外进入弃牌堆
  let next = updatePlayer(state, actorId, (p) => ({
    ...p,
    cost: (p.cost - definition.cost) as Cost,
    hand: p.hand.filter((id) => id !== cardInstanceId),
    discard: [...p.discard, cardInstanceId],
  }));
  next = updateInstance(next, cardInstanceId, (i) => ({
    ...i,
    zone: 'discard',
    board_half: null,
    lane: null,
    position: null,
    slot_index: null,
  }));

  next = addCombatLog(next, {
    type: 'effect_triggered',
    source_instance_id: cardInstanceId,
    target_instance_id: action.target_instance_id,
    source_player_id: actorId,
    source_name: definition.card_name_zh,
    action_type: definition.card_type === 'support' ? 'play_equipment' : 'play_tactic',
    amount: definition.cost,
    detail: `${playerLabel(actorId)} 使用了${definition.card_type === 'support' ? '支援卡' : '战术卡'}【${definition.card_name_zh}】（消耗 ${definition.cost} CP）。`,
  });

  const blocks = definition.skill_effects ?? definition.effect_json?.v1_1_blocks ?? [];
  const onPlayBlocks = blocks.filter((b) => b.trigger === 'on_play');
  for (const block of onPlayBlocks) {
    const res = executeEffectOps(next, block.effects, {
      sourceId: cardInstanceId,
      sourceName: definition.card_name_zh,
      actorId,
      triggerName: 'on_play',
      selectedTargetId: action.target_instance_id,
      secondaryTargetId: action.secondary_target_instance_id,
      selectedLane: action.target_lane,
      selectedLanes: action.target_lanes,
      selectedPosition: action.target_position,
      selectedSlotIndex: action.target_slot_index,
      onImmediateAttack: (s, uid, focusBonus, consume) =>
        executeImmediateAttackForUnit(s, uid, focusBonus, consume, { noRetaliationIfDefeated: true }),
      onDrawCards: (s, pid, count) => drawCards(s, pid, count).state,
    });
    next = res.state;
  }

  next = evaluateWinner(next);
  return { ok: true, value: { ...next, state_version: next.state_version + 1 } };
}

function finishActionPhase(state: GameState): GameState {
  const playerId = state.active_player_id;
  const turnIndex = state.players[playerId].turns_taken;
  const updates: Record<CardInstanceId, CardInstance> = {};
  for (const [instanceId, instance] of Object.entries(state.card_instances) as [CardInstanceId, CardInstance][]) {
    const lifecycle = instance.operator_lifecycle;
    if (instance.controller_id !== playerId || !lifecycle || lifecycle.redeploy_cd_remaining <= 0) continue;
    if (lifecycle.redeploy_cd_applied_owner_turn_index === null || turnIndex <= lifecycle.redeploy_cd_applied_owner_turn_index) continue;
    updates[instanceId] = {
      ...instance,
      operator_lifecycle: { ...lifecycle, redeploy_cd_remaining: lifecycle.redeploy_cd_remaining - 1 },
    };
  }
  return {
    ...state,
    phase: 'combat',
    card_instances: { ...state.card_instances, ...updates },
    state_version: state.state_version + 1,
  };
}

function finishPreparedTurnStart(state: GameState): GameState {
  const checked = evaluateWinner(state);
  return {
    ...checked,
    phase: checked.winner ? 'finished' : 'action',
    turn_start_prepared: false,
    state_version: checked.state_version + 1,
  };
}

function resolveTurnStart(state: GameState): GameState {
  const playerId = state.active_player_id;
  const player = state.players[playerId];
  const nextOwnTurnIndex = (player.own_turn_index ?? player.turns_taken) + 1;
  const nextTurnsTaken = player.turns_taken + 1;
  const curveIndex = Math.min(state.cp_curve.length - 1, Math.max(0, nextOwnTurnIndex - 1));
  const baseCp = state.cp_curve[curveIndex] ?? 8;
  const turnCpCap = Math.min(MAX_COST, baseCp + 2);

  // 1. 重置当前 CP 至该回合基础 CP、重置本回合一次性标记
  const otherPlayerId: PlayerId = playerId === 'player_a' ? 'player_b' : 'player_a';
  let next = state;
  if (!next.first_player_id && next.players[otherPlayerId].turns_taken === 0) {
    next = { ...next, first_player_id: playerId };
  }
  next = updatePlayer(next, playerId, (p) => ({
    ...p,
    cost: baseCp as Cost,
    turn_cp_cap: turnCpCap,
    turns_taken: nextTurnsTaken,
    own_turn_index: nextOwnTurnIndex,
    focus_target_changes_this_turn: 0,
    facility_first_deploy_discount_used_turn: null,
  }));

  for (const [id, inst] of Object.entries(next.card_instances) as [CardInstanceId, CardInstance][]) {
    if (inst.controller_id !== playerId) continue;
    const nextLife = inst.operator_lifecycle?.entered_battle_this_owner_turn
      ? { ...inst.operator_lifecycle, entered_battle_this_owner_turn: false }
      : inst.operator_lifecycle;
    const combat = inst.operator_combat;
    const nextCombat = combat
      ? {
          ...combat,
          per_turn_trigger_counts: {},
          granted_immediate_attack_this_turn: false,
          consumed_normal_attack_this_turn: false,
          took_hp_damage_last_owner_turn: Boolean(combat.took_hp_damage_this_owner_turn),
          took_hp_damage_this_owner_turn: false,
          equipped_package: combat.equipped_package
            ? { ...combat.equipped_package, triggered_this_owner_turn: false }
            : null,
        }
      : undefined;
    if (nextLife !== inst.operator_lifecycle || nextCombat !== combat) {
      next = updateInstance(next, id, (u) => ({
        ...u,
        operator_lifecycle: nextLife,
        operator_combat: nextCombat,
      }));
    }
  }

  next = addCombatLog(next, {
    type: 'cp_updated',
    source_player_id: playerId,
    target_player_id: playerId,
    amount: baseCp,
    action_type: 'turn_start_reset',
    detail: `${playerLabel(playerId)} 第 ${nextOwnTurnIndex} 个己方回合开始，CP 重置为 ${baseCp}（当回合获取上限 ${turnCpCap} CP）。`,
  });

  next = { ...next, phase: 'turn_start', turn_start_prepared: true, state_version: next.state_version + 1 };

  // 2. 回合开始抽 1 张牌
  next = drawCards(next, playerId, 1).state;
  if (next.winner) {
    return { ...next, phase: 'finished', turn_start_prepared: false };
  }
  next = { ...next, phase: 'turn_start', turn_start_prepared: true };

  // 3. 回合开始补给效果（先于维护执行）
  const boardSources = Object.values(next.card_instances)
    .filter((u) => u.zone === 'board' && u.controller_id === playerId)
    .sort((a, b) => compareBoardEntities(next.board_profile, a, b));

  for (const unit of boardSources) {
    const live = next.card_instances[unit.card_instance_id];
    if (!live || live.zone !== 'board' || !canTriggerOwnEffects(next, live)) continue;
    const def = defOf(next, live);
    if (!def?.skill_effects) continue;
    for (const block of def.skill_effects) {
      if (block.trigger !== 'turn_start') continue;
      const supplyOps = block.effects.filter((e) => e.op === 'grant_supply');
      if (supplyOps.length > 0) {
        next = executeEffectOps(next, supplyOps, {
          sourceId: live.card_instance_id,
          sourceName: entityName(next, live),
          actorId: playerId,
          sourceLane: live.lane,
          triggerName: 'turn_start',
          onDrawCards: (s, pid, count) => drawCards(s, pid, count).state,
        }).state;
        if (next.winner) {
          return { ...next, phase: 'finished', turn_start_prepared: false };
        }
      }
    }
  }

  // 4. 维护支付节点（在补给之后按稳定棋盘顺序支付）
  for (const unit of boardSources) {
    const live = next.card_instances[unit.card_instance_id];
    if (!live || live.zone !== 'board' || !canTriggerOwnEffects(next, live)) continue;
    const def = defOf(next, live);
    if (!def?.skill_effects) continue;
    for (const block of def.skill_effects) {
      if (block.trigger !== 'turn_start') continue;
      const upkeepOps = block.effects.filter((e) => e.op === 'pay_upkeep');
      if (upkeepOps.length > 0) {
        next = executeEffectOps(next, upkeepOps, {
          sourceId: live.card_instance_id,
          sourceName: entityName(next, live),
          actorId: playerId,
          sourceLane: live.lane,
          triggerName: 'turn_start',
        }).state;
      }
    }
  }

  // 5. 状态回合开始节点（中毒伤害先结算 -> 状态到期清理）
  next = expireStatusesAtTurnStart(next, playerId);

  // 6. 其他干员/设施 turn_start 触发（跳过已执行过的 grant_supply 与 pay_upkeep）
  const pending: PendingEffectChoice[] = [];
  const activeEntitiesAfterUpkeep = Object.values(next.card_instances)
    .filter((u) => u.zone === 'board' && u.controller_id === playerId)
    .sort((a, b) => compareBoardEntities(next.board_profile, a, b));

  for (const unit of activeEntitiesAfterUpkeep) {
    const live = next.card_instances[unit.card_instance_id];
    if (!live || live.zone !== 'board' || !canTriggerOwnEffects(next, live)) continue;
    const def = defOf(next, live);
    if (!def?.skill_effects) continue;

    for (const block of def.skill_effects) {
      if (block.trigger !== 'turn_start') continue;
      const remainingOps = block.effects.filter((e) => e.op !== 'grant_supply' && e.op !== 'pay_upkeep');
      if (remainingOps.length === 0) continue;

      // DEMO-SUP-V2-001 前线掩体：若有前排友军则提示玩家选择一名获得 1 护盾
      if (def.card_id === ('DEMO-SUP-V2-001' as CardId)) {
        const hasFront = Object.values(next.card_instances).some(
          (u) => u.zone === 'board' && u.controller_id === playerId && getEntityKind(next, u) !== 'facility' && u.position === 'front',
        );
        if (hasFront) {
          pending.push({
            source_instance_id: live.card_instance_id,
            effect: 'grant_front_shield',
            amount: 1,
          });
        }
        continue;
      }

      next = executeEffectOps(next, remainingOps, {
        sourceId: live.card_instance_id,
        sourceName: entityName(next, live),
        actorId: playerId,
        sourceLane: live.lane,
        triggerName: 'turn_start',
        onDrawCards: (s, pid, count) => drawCards(s, pid, count).state,
      }).state;
    }
  }

  // 7. 设施寿命自我损耗节点（触发完 turn_start 效果后，每回合扣除自身 1 点 HP；HP 归零时摧毁进弃牌堆）
  for (const facId of [...next.players[playerId].facility_ids]) {
    const fac = next.card_instances[facId];
    if (!fac || fac.zone !== 'board' || !fac.operator_combat || !fac.facility_state) continue;
    const disabled = isFacilityDisabled(next, fac);
    if (disabled && !next.open_decision_config.disabledFacilityContinuesCountdown) continue;
    const nextHp = Math.max(0, fac.operator_combat.current_hp - 1);
    next = updateInstance(next, facId, (f) => ({
      ...f,
      operator_combat: {
        ...f.operator_combat!,
        current_hp: nextHp as HpValue,
        took_hp_damage_this_owner_turn: true,
      },
      facility_state: {
        ...f.facility_state!,
        remaining_turns: nextHp,
      },
    }));
    next = addCombatLog(next, {
      type: 'damage_resolved',
      source_instance_id: facId,
      target_instance_id: facId,
      source_player_id: playerId,
      target_player_id: playerId,
      source_name: entityName(next, fac),
      target_name: entityName(next, fac),
      amount: 1,
      action_type: 'facility_self_hp_loss',
      detail: `${playerLabel(playerId)} 的设施【${entityName(next, fac)}】回合维护扣除自身 1 点 HP（剩余 ${nextHp} HP）。`,
    });
    if (nextHp <= 0) {
      next = removeEntityByDefeatOrDestroy(next, facId, {
        cause: 'self_hp_loss',
        isEnemyKill: false,
        triggerOnEntityDestroyed: triggerEntityDestroyedEffects,
      });
    }
  }

  next = { ...next, pending_effect_choices: [...next.pending_effect_choices, ...pending] };
  return next.pending_effect_choices.length > 0 ? next : finishPreparedTurnStart(next);
}

function resolvePendingChoice(
  state: GameState,
  actorId: PlayerId,
  action: Extract<GameAction, { type: 'resolve_pending_choice' }>,
): EngineResult<GameState> {
  const { source_instance_id: sourceId, target_instance_id: targetId, choice_id: choiceId } = action;
  const pending = state.pending_effect_choices.find((c) => c.source_instance_id === sourceId);
  const source = state.card_instances[sourceId];
  if (!pending || !source || source.controller_id !== actorId) {
    return { ok: false, value: state, reason: '找不到该玩家待处理的选择项目。' };
  }

  let next = state;

  if (pending.effect === 'grant_front_shield' || pending.effect === 'grant_front_cover') {
    const frontUnits = Object.values(state.card_instances).filter(
      (u) => u.zone === 'board' && u.controller_id === actorId && getEntityKind(state, u) !== 'facility' && u.position === 'front',
    );
    if (!targetId) {
      if (frontUnits.length > 0) {
        return { ok: false, value: state, reason: '己方场上存在前排单位，必须指定目标。' };
      }
    } else {
      const target = state.card_instances[targetId];
      if (!target || target.zone !== 'board' || target.controller_id !== actorId || getEntityKind(state, target) === 'facility' || target.position !== 'front') {
        return { ok: false, value: state, reason: '必须选择自己控制的前排在场单位。' };
      }
      next = executeEffectOps(
        next,
        pending.effect === 'grant_front_shield'
          ? [{ op: 'grant_shield', target: 'selected_friendly_unit', amount: pending.amount }]
          : [{ op: 'grant_cover', target: 'selected_friendly_unit', amount: pending.amount }],
        {
          sourceId,
          sourceName: entityName(next, source),
          actorId,
          selectedTargetId: targetId,
        },
      ).state;
    }
  } else if (pending.effect === 'choose_summon') {
    const options = pending.options ?? ['magallan_strike_drone', 'magallan_support_drone'];
    const chosenToken = choiceId && options.includes(choiceId) ? choiceId : options[0];
    if (!source.lane) {
      return { ok: false, value: state, reason: '召唤来源未在棋盘路线上。' };
    }
    const emptyCell = getFirstEmptyCellInLane(next, actorId, source.lane);
    if (emptyCell) {
      next = executeEffectOps(
        next,
        [
          chosenToken === 'magallan_strike_drone'
            ? { op: 'summon_unit', token_id: 'magallan_strike_drone', atk: 2, hp: 2, recallable_by_controller: true }
            : { op: 'summon_unit', token_id: 'magallan_support_drone', atk: 1, hp: 2, recallable_by_controller: true, on_turn_end: 'heal_same_lane_ally_1' },
        ],
        {
          sourceId,
          sourceName: entityName(next, source),
          actorId,
          sourceLane: source.lane,
        },
      ).state;
    }
  } else if (pending.effect === 'choose_discard') {
    const player = next.players[actorId];
    if (player.hand.length > 0) {
      const discardId = targetId && player.hand.includes(targetId) ? targetId : null;
      if (!discardId) {
        return { ok: false, value: state, reason: '必须从手牌中选择一张卡牌弃置。' };
      }
      const discardedDef = defOf(next, next.card_instances[discardId]);
      next = updatePlayer(next, actorId, (p) => ({
        ...p,
        hand: p.hand.filter((id) => id !== discardId),
        discard: [...p.discard, discardId],
      }));
      next = updateInstance(next, discardId, (c) => ({ ...c, zone: 'discard' }));
      next = addCombatLog(next, {
        type: 'effect_triggered',
        source_instance_id: sourceId,
        target_instance_id: discardId,
        source_player_id: actorId,
        source_name: entityName(next, source),
        target_name: discardedDef?.card_name_zh,
        detail: `${playerLabel(actorId)}【${entityName(next, source)}】弃置了手牌【${discardedDef?.card_name_zh ?? discardId}】。`,
      });
    }
  }

  next = {
    ...next,
    pending_effect_choices: next.pending_effect_choices.filter((c) => c !== pending),
    state_version: next.state_version + 1,
  };
  if (next.phase === 'turn_start' && next.turn_start_prepared && next.pending_effect_choices.length === 0) {
    next = finishPreparedTurnStart(next);
  }
  return { ok: true, value: next };
}

function resolveTurnEndPhase(state: GameState): GameState {
  const actor = state.active_player_id;
  let next = state;

  // 1. 回合结束触发器（调香师、赫默医疗无人机、麦哲伦支援无人机）
  const boardSources = Object.values(next.card_instances)
    .filter((u) => u.zone === 'board' && u.controller_id === actor)
    .sort((a, b) => compareBoardEntities(next.board_profile, a, b));

  for (const unit of boardSources) {
    const live = next.card_instances[unit.card_instance_id];
    if (!live || live.zone !== 'board' || !canTriggerOwnEffects(next, live)) continue;

    // 麦哲伦支援无人机自身的回合末治疗同路受伤友军
    if (live.summon_state?.token_id === 'magallan_support_drone') {
      next = executeEffectOps(
        next,
        [{ op: 'heal', target: 'lowest_hp_ratio_wounded_ally_same_lane', amount: 1 }],
        {
          sourceId: live.card_instance_id,
          sourceName: entityName(next, live),
          actorId: actor,
          sourceLane: live.lane,
          triggerName: 'turn_end',
        },
      ).state;
      continue;
    }

    const def = defOf(next, live);
    if (!def?.skill_effects?.some((b) => b.trigger === 'turn_end')) continue;

    // 赫默无人机仅持续 2 个己方回合结束
    if (def.card_id === ('OP-MED-006' as CardId)) {
      const beforeCount = Number(live.operator_combat?.per_combat_trigger_counts?.silence_drone_turns ?? 0);
      next = triggerUnitEventBlocks(next, live.card_instance_id, 'turn_end').state;
      const drone = Object.values(next.card_instances).find(
        (d) => d.zone === 'board' && d.summon_state?.source_instance_id === live.card_instance_id && d.summon_state?.token_id === 'silence_med_drone',
      );
      if (drone) {
        const afterCount = beforeCount + 1;
        if (next.card_instances[live.card_instance_id]?.operator_combat) {
          next = updateInstance(next, live.card_instance_id, (s) => ({
            ...s,
            operator_combat: {
              ...s.operator_combat!,
              per_combat_trigger_counts: {
                ...(s.operator_combat!.per_combat_trigger_counts ?? {}),
                silence_drone_turns: afterCount,
              },
            },
          }));
        }
        if (afterCount >= 2) {
          next = removeEntityByDefeatOrDestroy(next, drone.card_instance_id, {
            cause: 'duration_expired',
            isEnemyKill: false,
            triggerOnEntityDestroyed: triggerEntityDestroyedEffects,
          });
        }
      }
      continue;
    }

    next = triggerUnitEventBlocks(next, live.card_instance_id, 'turn_end').state;
  }

  // 2. 清理到期的回合结束状态与临时修正（含沉默等）
  next = expireStatusesAtTurnEnd(next, actor);

  // 3. 清除设施到期的“失效”标记（disabled_until_owner_turn <= active player's own_turn_index）
  const activeOwnTurn = next.players[actor].own_turn_index;
  for (const facId of next.players[actor].facility_ids) {
    const fac = next.card_instances[facId];
    const until = fac?.facility_state?.disabled_until_owner_turn;
    if (fac?.facility_state && typeof until === 'number' && until <= activeOwnTurn) {
      next = updateInstance(next, facId, (f) => ({
        ...f,
        facility_state: { ...f.facility_state!, disabled_until_owner_turn: null },
      }));
    }
  }

  // 4. V1.1 CP 规则：自己回合结束时，剩余 CP 全部清零，清空未使用的一次性部署折扣
  const beforeCp = next.players[actor].cost;
  next = updatePlayer(next, actor, (p) => ({
    ...p,
    cost: 0 as Cost,
    next_deploy_discounts: [],
  }));
  if (beforeCp > 0) {
    next = addCombatLog(next, {
      type: 'cp_updated',
      source_player_id: actor,
      amount: -beforeCp,
      action_type: 'turn_end_clear',
      detail: `${playerLabel(actor)} 回合结束，未使用 CP（${beforeCp}）已清零。`,
    });
  }

  const nextPlayer: PlayerId = actor === 'player_a' ? 'player_b' : 'player_a';
  return {
    ...next,
    active_player_id: nextPlayer,
    phase: 'turn_start',
    turn_number: next.turn_number + 1,
    state_version: next.state_version + 1,
  };
}

export function advancePhase(state: GameState): EngineResult<GameState> {
  if (state.phase === 'finished') return { ok: false, value: state, reason: '对局已经结束。' };
  if (state.phase === 'mulligan') return { ok: false, value: state, reason: '双方完成起手换牌后才能开始回合。' };
  let nextState: GameState;
  switch (state.phase) {
    case 'turn_start':
      if (state.turn_start_prepared) {
        if (state.pending_effect_choices.length > 0) return { ok: false, value: state, reason: '必须先完成回合开始的支援效果选择。' };
        nextState = finishPreparedTurnStart(state);
      } else {
        nextState = resolveTurnStart(state);
      }
      break;
    case 'action':
      nextState = finishActionPhase(state);
      break;
    case 'combat':
      nextState = resolveCombat(state);
      break;
    case 'turn_end':
      nextState = resolveTurnEndPhase(state);
      break;
    default:
      return { ok: false, value: state, reason: `不支持从阶段 ${state.phase as GamePhase} 前进。` };
  }
  return { ok: true, value: nextState };
}

function surrenderMatch(state: GameState, actorId: PlayerId): EngineResult<GameState> {
  if (!state.players[actorId]) {
    return { ok: false, value: state, reason: `找不到玩家 ${actorId}。` };
  }
  if (state.phase === 'finished') {
    return { ok: false, value: state, reason: '对局已经结束。' };
  }
  if (state.phase === 'mulligan') {
    return { ok: false, value: state, reason: '起手换牌阶段尚未正式交锋，请直接离开对局。' };
  }
  const winner: PlayerId = actorId === 'player_a' ? 'player_b' : 'player_a';
  const logged = addCombatLog(state, {
    type: 'effect_triggered',
    source_player_id: actorId,
    target_player_id: winner,
    action_type: 'surrender',
    detail: `${playerLabel(actorId)} 主动宣告撤退（投降），由 ${playerLabel(winner)} 获胜。`,
  });
  return {
    ok: true,
    value: {
      ...logged,
      phase: 'finished',
      winner,
      pending_effect_choices: [],
      turn_start_prepared: false,
      state_version: state.state_version + 1,
    },
  };
}

export function reduceGameAction(state: GameState, actorId: PlayerId, action: GameAction): EngineResult<GameState> {
  if (action.type === 'surrender') {
    return surrenderMatch(state, actorId);
  }
  if (state.phase === 'turn_start' && state.turn_start_prepared) {
    if (actorId !== state.active_player_id) return { ok: false, value: state, reason: '只有当前回合玩家可以处理回合开始选择。' };
    if (action.type !== 'resolve_pending_choice') return { ok: false, value: state, reason: '必须先完成回合开始的支援效果选择。' };
    return resolvePendingChoice(state, actorId, action);
  }
  if (state.phase !== 'action') return { ok: false, value: state, reason: '只有行动阶段可以提交玩家动作。' };
  if (actorId !== state.active_player_id) return { ok: false, value: state, reason: '当前不是该玩家的行动回合。' };

  if (state.pending_effect_choices.length > 0 && action.type !== 'resolve_pending_choice') {
    return { ok: false, value: state, reason: '必须先完成当前效果的选择步骤。' };
  }

  switch (action.type) {
    case 'end_action_phase':
      return { ok: true, value: finishActionPhase(state) };
    case 'deploy_operator':
      return deployOperator(state, actorId, action.card_instance_id, action.lane, action.position, action.slot_index ?? 1);
    case 'withdraw_operator':
      return withdrawNormally(state, actorId, action.card_instance_id);
    case 'recall_summon':
      return recallSummon(state, actorId, action.card_instance_id);
    case 'set_focus_target':
      return setFocusTarget(state, actorId, action.target_instance_id);
    case 'play_card':
      return playCard(state, actorId, action);
    case 'resolve_pending_choice':
      return resolvePendingChoice(state, actorId, action);
    case 'activate_skill':
      return { ok: false, value: state, reason: 'V1.1 规则下干员已统一为全自动/JSON 触发器，不再使用主动 SP 技能按钮。' };
    default:
      return { ok: false, value: state, reason: '未知动作类型。' };
  }
}

export { getEntityStats, formatLaneLabelZh, formatCellLabel };
