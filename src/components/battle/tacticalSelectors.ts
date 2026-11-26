import {
  compareBoardEntities,
  normalizeLaneId,
  slotCountForRow,
  sortedLanes,
} from '../../game/board';
import { reduceGameAction } from '../../game/engine';
import { enumerateLegalActions, POSITIONS } from '../../game/legal-actions';
import {
  getEffectiveAttackProfile,
  getEligibleLanes,
  getEntityKind,
  getEntityMaxHp,
  hasStatus,
  hasTauntForAttacker,
  isFrozen,
  isGrounded,
  isNativeFloating,
  normalizeRouteScope,
  selectOrdinaryAttackTargets,
} from '../../game/range';
import type {
  CardDefinition,
  CardInstance,
  CardInstanceId,
  GameAction,
  GameState,
  LaneId,
  PendingEffectChoice,
  PlayerId,
  Position,
} from '../../game/types';

export interface AttackPreviewResult {
  readonly attackerId?: CardInstanceId;
  readonly lane: LaneId;
  readonly controllerId: PlayerId;
  readonly primaryTargetId: CardInstanceId | null;
  readonly targetIds: readonly CardInstanceId[];
  readonly legalTargetIds: readonly CardInstanceId[];
  readonly tauntBlocked: boolean;
  readonly attacksBase: boolean;
  readonly cannotAttackReason: string | null;
  readonly laneSlots: readonly { readonly half: PlayerId; readonly lane: LaneId; readonly position: Position }[];
}

export interface HealingRangePreview {
  readonly healerId?: CardInstanceId;
  readonly controllerId: PlayerId;
  readonly lane: LaneId | null;
  readonly routeScope: 'same_lane' | 'same_and_adjacent_lane' | 'all_lanes';
  readonly scopeLabel: string;
  readonly healableUnitIds: readonly CardInstanceId[];
  readonly woundedTargetIds: readonly CardInstanceId[];
  readonly priorityTargetIds: readonly CardInstanceId[];
  readonly rangeCells: readonly { readonly half: PlayerId; readonly lane: LaneId; readonly position: Position }[];
}

function willDeployGrantAssault(state: GameState, controllerId: PlayerId): boolean {
  const otherId: PlayerId = controllerId === 'player_a' ? 'player_b' : 'player_a';
  const player = state.players[controllerId];
  if (!player || player.assault_bonus_used) return false;
  return (
    (state.first_player_id !== undefined && state.first_player_id !== controllerId) ||
    (state.first_player_id === undefined &&
      state.players[otherId].turns_taken > 0 &&
      player.turns_taken <= state.players[otherPlayerFallback(otherId)].turns_taken)
  );
}

function otherPlayerFallback(id: PlayerId): PlayerId {
  return id;
}

/**
 * 与 V1.1 规则引擎 100% 对齐的攻击目标与航道预览选择器（只读，不产生副作用）。
 * 支持已部署实体或悬停待部署格子预演（含嘲讽、标记、近战后排限制、范围覆盖与合法目标预览）。
 */
export function previewAttackTargets(
  state: GameState,
  source:
    | { readonly kind: 'unit'; readonly instance: CardInstance }
    | {
        readonly kind: 'draft';
        readonly cardInstanceId: CardInstanceId;
        readonly controllerId: PlayerId;
        readonly lane: LaneId;
        readonly position: Position;
        readonly slotIndex?: number;
      },
): AttackPreviewResult | null {
  const controllerId = source.kind === 'unit' ? source.instance.controller_id : source.controllerId;
  const rawLane = source.kind === 'unit' ? source.instance.lane : source.lane;
  if (!rawLane) return null;
  const lane = normalizeLaneId(state.board_profile, rawLane);

  const instance =
    source.kind === 'unit' ? source.instance : state.card_instances[source.cardInstanceId];
  if (!instance) return null;

  const def = state.card_definitions[instance.card_id];
  const entityKind = getEntityKind(state, instance);
  if (entityKind === 'facility') return null;

  const previewInstance: CardInstance =
    source.kind === 'draft'
      ? {
          ...instance,
          zone: 'board',
          board_half: controllerId,
          lane,
          position: source.position,
          slot_index: source.slotIndex ?? 1,
          controller_id: controllerId,
          operator_combat: instance.operator_combat ?? {
            current_hp: (def?.hp ?? 1) as CardInstance['operator_combat'] extends { current_hp: infer H } ? H : never,
            current_atk_modifiers: [],
            current_sp: (def?.starting_sp ?? 0) as CardInstance['operator_combat'] extends { current_sp: infer S } ? S : never,
            shield: 0,
            statuses: [],
            equipment_ids: [],
          },
        }
      : instance;

  const profile = getEffectiveAttackProfile(state, previewInstance);
  if (!profile) return null;

  const isBackRowMelee = profile.mode === 'melee' && previewInstance.position === 'back';
  const enemyHalf: PlayerId = controllerId === 'player_a' ? 'player_b' : 'player_a';
  const eligibleLanes = getEligibleLanes(state, lane, profile.route_scope);
  const laneSlots = eligibleLanes.flatMap((l) =>
    isBackRowMelee
      ? [{ half: enemyHalf, lane: l, position: 'front' as const }]
      : [
          { half: enemyHalf, lane: l, position: 'front' as const },
          { half: enemyHalf, lane: l, position: 'back' as const },
        ],
  );

  let cannotAttackReason: string | null = null;
  if (source.kind === 'unit') {
    if (hasStatus(instance, 'freeze')) {
      cannotAttackReason = '当前处于冻结状态，本回合跳过攻击';
    } else if (hasStatus(instance, 'stun')) {
      cannotAttackReason = '当前处于眩晕状态，本回合跳过攻击';
    } else if (profile.mode === 'support') {
      cannotAttackReason = '医疗干员在战斗阶段优先执行友方治疗';
    } else if (
      instance.operator_lifecycle?.entered_battle_this_owner_turn &&
      !instance.operator_combat?.granted_immediate_attack_this_turn &&
      !hasStatus(instance, 'assault')
    ) {
      cannotAttackReason = '本回合刚部署，将在下次行动后参与交锋';
    }
  } else {
    const draftGrantsAssault = willDeployGrantAssault(state, controllerId);
    cannotAttackReason =
      profile.mode === 'support'
        ? draftGrantsAssault
          ? '【突击】后手首部署：本回合作战阶段即可治疗友方'
          : '医疗干员部署后于我方战斗阶段治疗友方'
        : draftGrantsAssault
          ? '【突击】后手首部署：无视部署冷却，本回合即可进攻'
          : '部署当回合不会立刻攻击，下回合按此路径索敌';
  }

  if (profile.mode === 'support') {
    return {
      attackerId: source.kind === 'unit' ? source.instance.card_instance_id : undefined,
      lane,
      controllerId,
      primaryTargetId: null,
      targetIds: [],
      legalTargetIds: [],
      tauntBlocked: false,
      attacksBase: false,
      cannotAttackReason,
      laneSlots: [],
    };
  }

  const eligibleLaneSet = new Set(eligibleLanes);
  const legalEnemies = Object.values(state.card_instances)
    .filter((i) => {
      if (i.zone !== 'board' || i.controller_id === controllerId || !i.lane || !i.operator_combat) {
        return false;
      }
      if (isBackRowMelee && i.position === 'back') return false;
      const inScope = eligibleLaneSet.has(normalizeLaneId(state.board_profile, i.lane));
      const tauntScope = i.summon_state?.taunt_scope ?? state.card_definitions[i.card_id]?.taunt_scope ?? 'none';
      const hasGlobalTaunt = tauntScope === 'all_lanes' && !isFrozen(i);
      if (!inScope && !hasGlobalTaunt) return false;
      return !isNativeFloating(state, i) || isGrounded(state, i) || profile.mode === 'ranged';
    })
    .sort((a, b) => compareBoardEntities(state.board_profile, a, b));

  const targets = selectOrdinaryAttackTargets(state, previewInstance);
  const primary = targets[0] ?? null;
  const tauntBlocked = Boolean(primary && hasTauntForAttacker(state, previewInstance, primary));
  const attacksBase = targets.length === 0 && !isBackRowMelee;

  if (isBackRowMelee && targets.length === 0 && !cannotAttackReason) {
    cannotAttackReason = '近战处于后排，无法攻击敌方后排与基地';
  }

  return {
    attackerId: source.kind === 'unit' ? source.instance.card_instance_id : undefined,
    lane,
    controllerId,
    primaryTargetId: primary?.card_instance_id ?? null,
    targetIds: targets.map((t) => t.card_instance_id),
    legalTargetIds: legalEnemies.map((t) => t.card_instance_id),
    tauntBlocked,
    attacksBase,
    cannotAttackReason,
    laneSlots,
  };
}

interface AllyHealSpec {
  readonly routeScope: 'same_lane' | 'same_and_adjacent_lane' | 'all_lanes';
  readonly targetLimit: number | 'all';
  readonly priority: 'lowest_hp_ratio' | 'lowest_current_hp';
  readonly scopeLabel: string;
}

function getAllyHealSpecForDefinition(def: CardDefinition): AllyHealSpec | null {
  if (def.attack_profile?.mode === 'support') {
    const scope = normalizeRouteScope(String(def.attack_profile.route_scope));
    const normalizedScope: AllyHealSpec['routeScope'] =
      scope === 'all_lanes' || scope === 'same_and_adjacent_lane' ? scope : 'same_lane';
    const limit: number | 'all' =
      def.attack_profile.pattern === 'heal_multi'
        ? def.attack_profile.target_limit === 'all'
          ? 'all'
          : Math.max(1, Number(def.attack_profile.target_limit ?? 2))
        : 1;
    const hasAllWoundedTurnEnd = (def.skill_effects ?? []).some((b) =>
      b.effects.some((e) => e.op === 'heal' && e.target === 'all_wounded_allies'),
    );
    const scopeText =
      normalizedScope === 'all_lanes'
        ? '全路友方单位'
        : normalizedScope === 'same_and_adjacent_lane'
          ? '同路及邻路友方单位'
          : '同路友方单位';
    const countText = limit === 'all' ? '全员' : limit > 1 ? `至多 ${limit} 名` : '生命比例最低 1 名';
    const extraText = hasAllWoundedTurnEnd ? '；回合末全路群疗' : '';
    return {
      routeScope: normalizedScope,
      targetLimit: limit,
      priority: 'lowest_hp_ratio',
      scopeLabel: `${scopeText}（${countText}${extraText} · 含召唤物，不含设施与【禁疗】）`,
    };
  }

  for (const block of def.skill_effects ?? def.effect_json?.v1_1_blocks ?? []) {
    for (const op of block.effects) {
      if (op.op !== 'heal' && op.op !== 'heal_and_shield') continue;
      const target = String(op.target ?? '');
      if (target === 'self' || target === 'host') continue;
      if (target === 'selected_friendly_unit') {
        return {
          routeScope: 'all_lanes',
          targetLimit: 1,
          priority: 'lowest_hp_ratio',
          scopeLabel: '全场任意可治疗友方单位（不含设施与【禁疗】）',
        };
      }
      if (target === 'all_wounded_allies') {
        return {
          routeScope: 'all_lanes',
          targetLimit: 'all',
          priority: 'lowest_hp_ratio',
          scopeLabel: '全路所有受伤友方单位（不含设施与【禁疗】）',
        };
      }
      if (target === 'friendly_damaged_unit_lowest_current_hp') {
        return {
          routeScope: 'all_lanes',
          targetLimit: 1,
          priority: 'lowest_current_hp',
          scopeLabel: '全路当前生命最低 1 名受伤友方单位（不含设施与【禁疗】）',
        };
      }
      if (target === 'lowest_hp_ratio_wounded_ally_same_or_adjacent') {
        return {
          routeScope: 'same_and_adjacent_lane',
          targetLimit: 1,
          priority: 'lowest_hp_ratio',
          scopeLabel: '同路及邻路生命比例最低 1 名受伤友方单位（不含设施与【禁疗】）',
        };
      }
      if (
        target === 'lowest_hp_ratio_wounded_ally_same_lane' ||
        target === 'wounded_ally_same_lane' ||
        target === 'damaged_ally_same_lane'
      ) {
        return {
          routeScope: 'same_lane',
          targetLimit: 1,
          priority: 'lowest_hp_ratio',
          scopeLabel: '同路受伤友方单位（不含设施与【禁疗】）',
        };
      }
    }
  }

  return null;
}

export function getHealingRangeLabel(def: CardDefinition | undefined | null): string | null {
  if (!def) return null;
  return getAllyHealSpecForDefinition(def)?.scopeLabel ?? null;
}

/**
 * 计算友方治疗可作用范围、可治疗单位与优先治疗目标（只读预览，与引擎治疗校验一致）。
 */
export function previewHealingRange(
  state: GameState,
  source:
    | { readonly kind: 'unit'; readonly instance: CardInstance }
    | {
        readonly kind: 'draft';
        readonly cardInstanceId: CardInstanceId;
        readonly controllerId: PlayerId;
        readonly lane: LaneId;
        readonly position: Position;
        readonly slotIndex?: number;
      }
    | {
        readonly kind: 'card';
        readonly cardInstanceId: CardInstanceId;
        readonly controllerId: PlayerId;
      },
): HealingRangePreview | null {
  const controllerId = source.kind === 'unit' ? source.instance.controller_id : source.controllerId;
  const instance =
    source.kind === 'unit' ? source.instance : state.card_instances[source.cardInstanceId];
  if (!instance) return null;

  const def = state.card_definitions[instance.card_id];
  if (!def) return null;

  let spec: AllyHealSpec | null = null;
  if (instance.summon_state?.token_id === 'magallan_support_drone') {
    spec = {
      routeScope: 'same_lane',
      targetLimit: 1,
      priority: 'lowest_hp_ratio',
      scopeLabel: '同路受伤友方单位（回合末恢复 1 HP，不含设施与【禁疗】）',
    };
  } else {
    spec = getAllyHealSpecForDefinition(def);
  }
  if (!spec) return null;

  const rawLane = source.kind === 'unit' ? source.instance.lane : source.kind === 'draft' ? source.lane : null;
  if (source.kind === 'card' && spec.routeScope !== 'all_lanes') {
    return null;
  }
  const lane = rawLane ? normalizeLaneId(state.board_profile, rawLane) : null;
  if (spec.routeScope !== 'all_lanes' && !lane) return null;

  const eligibleLanes =
    spec.routeScope === 'all_lanes' || !lane
      ? sortedLanes(state.board_profile).map((l) => l.laneId)
      : getEligibleLanes(state, lane, spec.routeScope);
  const eligibleLaneSet = new Set(eligibleLanes);

  const rangeCells = eligibleLanes.flatMap((l) => [
    { half: controllerId, lane: l, position: 'front' as const },
    { half: controllerId, lane: l, position: 'back' as const },
  ]);

  const healableUnits = Object.values(state.card_instances)
    .filter((u) => {
      if (u.zone !== 'board' || u.controller_id !== controllerId || !u.operator_combat || !u.lane) return false;
      if (getEntityKind(state, u) === 'facility') return false;
      if (!eligibleLaneSet.has(normalizeLaneId(state.board_profile, u.lane))) return false;
      const uDef = state.card_definitions[u.card_id];
      if (uDef?.native_traits?.some((t) => t.effect?.op === 'exclude_from_friendly_heal_targets')) return false;
      return true;
    })
    .sort((a, b) => compareBoardEntities(state.board_profile, a, b));

  const woundedUnits = [...healableUnits]
    .filter((u) => (u.operator_combat?.current_hp ?? 0) < getEntityMaxHp(state, u))
    .sort((a, b) => {
      if (spec.priority === 'lowest_current_hp') {
        const diff = (a.operator_combat?.current_hp ?? 0) - (b.operator_combat?.current_hp ?? 0);
        if (diff !== 0) return diff;
      } else {
        const ra = (a.operator_combat?.current_hp ?? 0) / Math.max(1, getEntityMaxHp(state, a));
        const rb = (b.operator_combat?.current_hp ?? 0) / Math.max(1, getEntityMaxHp(state, b));
        if (Math.abs(ra - rb) > 1e-6) return ra - rb;
      }
      return compareBoardEntities(state.board_profile, a, b);
    });

  const priorityTargets =
    spec.targetLimit === 'all'
      ? woundedUnits
      : woundedUnits.slice(0, Math.max(1, spec.targetLimit));

  return {
    healerId: source.kind === 'unit' ? source.instance.card_instance_id : undefined,
    controllerId,
    lane,
    routeScope: spec.routeScope,
    scopeLabel: spec.scopeLabel,
    healableUnitIds: healableUnits.map((u) => u.card_instance_id),
    woundedTargetIds: woundedUnits.map((u) => u.card_instance_id),
    priorityTargetIds: priorityTargets.map((u) => u.card_instance_id),
    rangeCells,
  };
}

/**
 * 直接向引擎 reduceGameAction 查询在目标格子部署手牌（干员或场地设施）失败的权威原因。
 */
export function getInvalidDeployReason(
  state: GameState,
  actorId: PlayerId,
  cardInstanceId: CardInstanceId,
  half: PlayerId,
  lane: LaneId,
  position: Position,
  slotIndex = 1,
): string | null {
  if (half !== actorId) {
    return '只能部署在己方半区阵位。';
  }
  const inst = state.card_instances[cardInstanceId];
  const def = inst ? state.card_definitions[inst.card_id] : undefined;
  if (def?.card_type === 'facility' || (def?.card_type === 'support' && def.support_subtype === 'facility')) {
    const result = reduceGameAction(state, actorId, {
      type: 'play_card',
      card_instance_id: cardInstanceId,
      target_lane: lane,
      target_position: position,
      target_slot_index: slotIndex,
    });
    return result.ok ? null : result.reason;
  }
  const result = reduceGameAction(state, actorId, {
    type: 'deploy_operator',
    card_instance_id: cardInstanceId,
    lane,
    position,
    slot_index: slotIndex,
  });
  return result.ok ? null : result.reason;
}

/**
 * 直接向引擎 reduceGameAction / enumerateLegalActions 查询手牌当前不可打出的真实原因。
 */
export function getInvalidCardReason(
  state: GameState,
  actorId: PlayerId,
  cardInstanceId: CardInstanceId,
): string | null {
  const instance = state.card_instances[cardInstanceId];
  if (!instance) return '找不到卡牌实例。';
  const definition = state.card_definitions[instance.card_id];
  if (!definition) return '找不到卡牌定义。';

  const legal = enumerateLegalActions(state, actorId);
  if (
    legal.some(
      (action) =>
        (action.type === 'deploy_operator' || action.type === 'play_card') &&
        action.card_instance_id === cardInstanceId,
    )
  ) {
    return null;
  }

  if (definition.card_type === 'operator') {
    const preferredPositions: readonly Position[] =
      definition.deploy_rule === 'back_only' || (definition.deploy_rule === undefined && definition.attack_type === 'ranged') || definition.floating
        ? ['back', 'front']
        : ['front', 'back'];

    let firstReason: string | null = null;
    for (const position of preferredPositions) {
      for (const lane of sortedLanes(state.board_profile)) {
        const count = slotCountForRow(lane, position);
        for (let slot = 1; slot <= count; slot += 1) {
          const res = reduceGameAction(state, actorId, {
            type: 'deploy_operator',
            card_instance_id: cardInstanceId,
            lane: lane.laneId,
            position,
            slot_index: slot,
          });
          if (!res.ok) {
            if (!firstReason) firstReason = res.reason;
            if (res.reason !== '所选部署位已被占用。' && res.reason !== '干员不能部署在所选位置。') {
              return res.reason;
            }
          }
        }
      }
    }
    return firstReason ?? '当前无法部署该干员。';
  }

  if (definition.card_type === 'facility' || (definition.card_type === 'support' && definition.support_subtype === 'facility')) {
    let firstReason: string | null = null;
    for (const position of POSITIONS) {
      for (const lane of sortedLanes(state.board_profile)) {
        const count = slotCountForRow(lane, position);
        for (let slot = 1; slot <= count; slot += 1) {
          const res = reduceGameAction(state, actorId, {
            type: 'play_card',
            card_instance_id: cardInstanceId,
            target_lane: lane.laneId,
            target_position: position,
            target_slot_index: slot,
          });
          if (!res.ok) {
            if (!firstReason) firstReason = res.reason;
            if (!res.reason.includes('已被占用')) return res.reason;
          }
        }
      }
    }
    return firstReason ?? '当前棋盘没有空余格位可部署设施。';
  }

  const directPlay = reduceGameAction(state, actorId, {
    type: 'play_card',
    card_instance_id: cardInstanceId,
  });
  if (!directPlay.ok) {
    if (
      directPlay.reason.includes('必须指定') ||
      directPlay.reason.includes('白名单效果并指定目标') ||
      directPlay.reason.includes('需要选择')
    ) {
      return '场上当前没有符合条件的作用目标或路线。';
    }
    return directPlay.reason;
  }
  return null;
}

/**
 * 查询在场单位主动技能、撤离或召回不可执行时的权威引擎原因。
 */
export function getInvalidUnitActionReason(
  state: GameState,
  actorId: PlayerId,
  cardInstanceId: CardInstanceId,
  actionType: 'activate_skill' | 'withdraw_operator' | 'recall_summon',
): string | null {
  if (actionType === 'withdraw_operator') {
    const res = reduceGameAction(state, actorId, {
      type: 'withdraw_operator',
      card_instance_id: cardInstanceId,
    });
    return res.ok ? null : res.reason;
  }
  if (actionType === 'recall_summon') {
    const res = reduceGameAction(state, actorId, {
      type: 'recall_summon',
      card_instance_id: cardInstanceId,
    });
    return res.ok ? null : res.reason;
  }

  const res = reduceGameAction(state, actorId, {
    type: 'activate_skill',
    card_instance_id: cardInstanceId,
  });
  return res.ok ? null : res.reason;
}

/**
 * 查找无需指定目标、路线或阵位的手牌直发动作（如「战术分析」「空降部署」「紧急后勤」）。
 */
export function findDirectPlayAction(
  legalActions: readonly GameAction[],
  cardInstanceId: CardInstanceId,
): Extract<GameAction, { type: 'play_card' }> | undefined {
  return legalActions.find(
    (a): a is Extract<GameAction, { type: 'play_card' }> =>
      a.type === 'play_card' &&
      a.card_instance_id === cardInstanceId &&
      a.target_instance_id === undefined &&
      a.target_lane === undefined &&
      (!a.target_lanes || a.target_lanes.length === 0) &&
      a.target_position === undefined,
  );
}

/**
 * 生成待决效应选择的明确中文操作提示（覆盖弃牌、召唤抉择、前排护盾/掩护及充能等所有待决类型）。
 */
export function getPendingChoicePromptText(
  state: GameState,
  choice: PendingEffectChoice | null | undefined,
): string {
  if (!choice) return '';
  const sourceInst = state.card_instances[choice.source_instance_id];
  const sourceName = sourceInst
    ? state.card_definitions[sourceInst.card_id]?.card_name_zh ?? '战术效果'
    : '战术效果';

  switch (choice.effect) {
    case 'choose_discard':
      return `【${sourceName}】待决弃牌：请点击下方青色高亮手牌，选择 ${choice.amount} 张弃置`;
    case 'choose_summon':
      return `【${sourceName}】待决抉择：请在上方提示栏选择要部署的无人机型号`;
    case 'grant_front_shield':
      return `【${sourceName}】回合支援：请点击棋盘青色高亮前排友方干员获得 +${choice.amount} 护盾`;
    case 'grant_front_cover':
      return `【${sourceName}】回合支援：请点击棋盘青色高亮前排友方干员获得 掩护`;
    case 'gain_sp':
      return `【${sourceName}】回合支援：请点击棋盘青色高亮友方干员充能 +${choice.amount} SP`;
    default:
      return `【${sourceName}】请先完成当前待决战术选择`;
  }
}

