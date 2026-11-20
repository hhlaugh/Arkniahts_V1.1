import { CLASSIC_BOARD_PROFILE } from '../game/board';
import { getEntityKind, getEntityStats, isFacilityDisabled } from '../game/range';
import type {
  BasePoints,
  BoardProfile,
  CardDefinition,
  CardId,
  CardInstance,
  CardInstanceId,
  CombatLogEvent,
  Cost,
  DeployDiscount,
  EntityKind,
  EquipmentPackageState,
  FacilityRuntimeState,
  GamePhase,
  GameState,
  HpValue,
  LaneId,
  OpenDecisionConfig,
  PaidDeployCost,
  PendingEffectChoice,
  PlayerId,
  PlayerState,
  Position,
  SpValue,
  StatusEffect,
  StatusKind,
  SummonRuntimeState,
  TemporaryAttackModifier,
} from '../game/types';

export interface PlayerViewStatus {
  readonly kind: StatusKind;
  readonly remainingOwnerTurns: number;
  readonly stacks?: number;
}

export interface PlayerViewUnit {
  readonly cardInstanceId: CardInstanceId;
  readonly ownerId: PlayerId;
  readonly controllerId: PlayerId;
  readonly entityKind: EntityKind;
  readonly boardHalf: PlayerId;
  readonly lane: LaneId;
  readonly position: Position;
  readonly slotIndex: number;
  readonly cardId: CardId;
  readonly hp: number;
  readonly maxHp: number;
  readonly atk: number;
  readonly baseAtk: number;
  readonly atkModifiers: readonly number[];
  readonly permanentAtkBonus: number;
  readonly sp: number;
  readonly maxSp: number;
  readonly shield: number;
  readonly statuses: readonly PlayerViewStatus[];
  readonly equipmentIds: readonly CardInstanceId[];
  readonly equippedPackage?: EquipmentPackageState | null;
  readonly facilityState?: FacilityRuntimeState;
  readonly summonState?: SummonRuntimeState;
  readonly tempModifiers?: readonly TemporaryAttackModifier[];
  readonly isFacilityDisabled?: boolean;
}

export interface PlayerViewFacility {
  readonly instanceId: CardInstanceId;
  readonly cardId: CardId;
  readonly turnStartTriggers: number;
  readonly remainingTurns?: number;
  readonly disabled?: boolean;
}

export interface PlayerViewSide {
  readonly playerId: PlayerId;
  readonly basePoints: number;
  readonly cost: number;
  readonly turnCpCap: number;
  readonly ownTurnIndex: number;
  readonly handCount?: number;
  readonly deckCount: number;
  readonly discardCount: number;
  readonly fatigueCount: number;
  readonly focusTargetId: CardInstanceId | null;
  readonly focusTargetChangesThisTurn: number;
  readonly nextDeployDiscounts: readonly DeployDiscount[];
  readonly facilities: readonly PlayerViewFacility[];
}

export interface PlayerViewHandCard {
  readonly instanceId: CardInstanceId;
  readonly cardId: CardId;
}

export interface PlayerViewPendingChoice {
  readonly sourceInstanceId: CardInstanceId;
  readonly effect: PendingEffectChoice['effect'];
  readonly amount: number;
  readonly options?: readonly string[];
}

export interface PlayerView {
  readonly rulesVersion: '1.1';
  readonly boardProfile: BoardProfile;
  readonly cpCurve: readonly number[];
  readonly openDecisionConfig: OpenDecisionConfig;
  readonly stateVersion: number;
  readonly phase: GamePhase;
  readonly turnNumber: number;
  readonly activePlayerId: PlayerId;
  readonly winner: PlayerId | 'draw' | null;
  readonly viewerId: PlayerId;
  readonly mulliganCompleted: Readonly<Record<PlayerId, boolean>>;
  readonly players: Readonly<Record<PlayerId, PlayerViewSide>>;
  readonly hand: readonly PlayerViewHandCard[];
  readonly ownDeck: readonly CardInstanceId[];
  readonly ownDiscard: readonly CardInstanceId[];
  readonly units: readonly PlayerViewUnit[];
  readonly combatLog: readonly CombatLogEvent[];
  readonly pendingEffectChoices: readonly PlayerViewPendingChoice[];
  readonly cardDefinitions: Readonly<Record<CardId, CardDefinition>>;
}

export interface PlayerViewOptions {
  readonly logHistory?: readonly CombatLogEvent[];
}

export function toPlayerView(state: GameState, viewerId: PlayerId, options: PlayerViewOptions = {}): PlayerView {
  const viewer = state.players[viewerId];
  if (!viewer) throw new Error(`toPlayerView：未知 viewer ${viewerId}。`);
  const players = {} as Record<PlayerId, PlayerViewSide>;
  for (const playerId of ['player_a', 'player_b'] as const) {
    const player = state.players[playerId];
    players[playerId] = {
      playerId,
      basePoints: player.base_points,
      cost: player.cost,
      turnCpCap: player.turn_cp_cap,
      ownTurnIndex: player.own_turn_index,
      handCount: player.hand.length,
      deckCount: player.deck.length,
      discardCount: player.discard.length,
      fatigueCount: player.fatigue_count,
      focusTargetId: player.focus_target_id,
      focusTargetChangesThisTurn: player.focus_target_changes_this_turn,
      nextDeployDiscounts: [...player.next_deploy_discounts],
      facilities: player.facility_ids.map((facilityId) => {
        const instance = state.card_instances[facilityId];
        return {
          instanceId: facilityId,
          cardId: instance?.card_id ?? ('' as CardId),
          turnStartTriggers: instance?.support_lifecycle?.turn_start_triggers ?? 0,
          remainingTurns: instance?.facility_state?.remaining_turns,
          disabled: instance ? isFacilityDisabled(state, instance) : false,
        };
      }),
    };
  }

  const units = Object.values(state.card_instances)
    .filter((instance) => instance.zone === 'board' && instance.operator_combat && instance.board_half && instance.lane && instance.position)
    .map((instance) => {
      const combat = instance.operator_combat!;
      const definition = state.card_definitions[instance.card_id];
      const entityKind = getEntityKind(state, instance);
      const stats = getEntityStats(state, instance);
      return {
        cardInstanceId: instance.card_instance_id,
        ownerId: instance.owner_id,
        controllerId: instance.controller_id,
        entityKind,
        boardHalf: instance.board_half as PlayerId,
        lane: instance.lane as LaneId,
        position: instance.position as Position,
        slotIndex: instance.slot_index ?? 1,
        cardId: instance.card_id,
        hp: combat.current_hp,
        maxHp: stats.maxHp,
        atk: stats.atk,
        baseAtk: entityKind === 'summon' ? (instance.summon_state?.atk ?? 0) : (definition?.atk ?? 0),
        atkModifiers: [...combat.current_atk_modifiers],
        permanentAtkBonus: combat.permanent_atk_bonus ?? 0,
        sp: combat.current_sp,
        maxSp: definition?.max_sp ?? 5,
        shield: combat.shield,
        statuses: combat.statuses.map((status) => ({
          kind: status.kind,
          remainingOwnerTurns: status.remaining_owner_turns,
          stacks: status.stacks,
        })),
        equipmentIds: [...combat.equipment_ids],
        equippedPackage: combat.equipped_package ?? null,
        facilityState: instance.facility_state,
        summonState: instance.summon_state,
        tempModifiers: combat.temp_modifiers ? [...combat.temp_modifiers] : undefined,
        isFacilityDisabled: entityKind === 'facility' ? isFacilityDisabled(state, instance) : false,
      } satisfies PlayerViewUnit;
    });

  const isActing = state.active_player_id === viewerId;
  return {
    rulesVersion: state.rules_version,
    boardProfile: state.board_profile,
    cpCurve: [...state.cp_curve],
    openDecisionConfig: { ...state.open_decision_config },
    stateVersion: state.state_version,
    phase: state.phase,
    turnNumber: state.turn_number,
    activePlayerId: state.active_player_id,
    winner: state.winner,
    viewerId,
    mulliganCompleted: { ...state.mulligan_completed },
    players,
    hand: viewer.hand.map((id) => ({ instanceId: id, cardId: state.card_instances[id]?.card_id ?? ('' as CardId) })),
    ownDeck: [...viewer.deck],
    ownDiscard: [...viewer.discard],
    units,
    combatLog: [...(options.logHistory ?? state.combat_log)],
    pendingEffectChoices: isActing
      ? state.pending_effect_choices.map((choice) => ({
          sourceInstanceId: choice.source_instance_id,
          effect: choice.effect,
          amount: choice.amount,
          options: choice.options ? [...choice.options] : undefined,
        }))
      : [],
    cardDefinitions: { ...state.card_definitions },
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPlayerViewSide(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const side = value as Record<string, unknown>;
  return (
    isNonEmptyString(side.playerId) &&
    isNonNegativeInteger(side.basePoints) &&
    isNonNegativeInteger(side.cost) &&
    (side.handCount === undefined || isNonNegativeInteger(side.handCount)) &&
    isNonNegativeInteger(side.deckCount) &&
    isNonNegativeInteger(side.discardCount) &&
    isNonNegativeInteger(side.fatigueCount) &&
    Array.isArray(side.facilities)
  );
}

export function isPlayerView(value: unknown): value is PlayerView {
  if (typeof value !== 'object' || value === null) return false;
  const view = value as Record<string, unknown>;
  if (!isNonEmptyString(view.viewerId) || !isNonEmptyString(view.activePlayerId)) return false;
  if (!isNonEmptyString(view.rulesVersion) || typeof view.phase !== 'string') return false;
  if (!isNonNegativeInteger(view.stateVersion) || !isNonNegativeInteger(view.turnNumber)) return false;
  if (!Array.isArray(view.hand) || !Array.isArray(view.units) || !Array.isArray(view.combatLog) || !Array.isArray(view.pendingEffectChoices)) return false;
  if (typeof view.players !== 'object' || view.players === null) return false;
  const players = view.players as Record<string, unknown>;
  if (!isPlayerViewSide(players.player_a) || !isPlayerViewSide(players.player_b)) return false;
  if (typeof view.cardDefinitions !== 'object' || view.cardDefinitions === null) return false;
  return view.winner === null || isNonEmptyString(view.winner);
}

export function clientStateFromPlayerView(view: PlayerView): GameState {
  const card_instances: Record<string, CardInstance> = {};

  for (const unit of view.units) {
    card_instances[unit.cardInstanceId] = {
      card_instance_id: unit.cardInstanceId,
      card_id: unit.cardId,
      owner_id: unit.ownerId,
      controller_id: unit.controllerId,
      entity_kind: unit.entityKind,
      zone: 'board',
      board_half: unit.boardHalf,
      lane: unit.lane,
      position: unit.position,
      slot_index: unit.slotIndex,
      operator_lifecycle: {
        redeploy_cd_remaining: 0,
        redeploy_cd_applied_owner_turn_index: null,
        has_deployed_before: true,
        entered_battle_this_owner_turn: false,
        paid_deploy_cost: 0 as PaidDeployCost,
        once_per_game_flags: {},
      },
      operator_combat: {
        current_hp: unit.hp as HpValue,
        current_atk_modifiers: [...unit.atkModifiers],
        permanent_atk_bonus: unit.permanentAtkBonus,
        current_sp: unit.sp as SpValue,
        shield: unit.shield,
        statuses: unit.statuses.map((status): StatusEffect => ({
          kind: status.kind,
          remaining_owner_turns: status.remainingOwnerTurns,
          applied_on_owner_turn_index: 0,
          stacks: status.stacks,
          blocks_normal_withdrawal: status.kind === 'freeze' || status.kind === 'stun',
        })),
        equipment_ids: [...unit.equipmentIds],
        equipped_package: unit.equippedPackage ?? null,
        temp_modifiers: unit.tempModifiers ? [...unit.tempModifiers] : undefined,
      },
      facility_state: unit.facilityState,
      summon_state: unit.summonState,
    };
  }

  for (const handCard of view.hand) {
    card_instances[handCard.instanceId] = {
      card_instance_id: handCard.instanceId,
      card_id: handCard.cardId,
      owner_id: view.viewerId,
      controller_id: view.viewerId,
      board_half: null,
      lane: null,
      position: null,
      slot_index: null,
      zone: 'hand',
      operator_lifecycle: {
        redeploy_cd_remaining: 0,
        redeploy_cd_applied_owner_turn_index: null,
        has_deployed_before: false,
        entered_battle_this_owner_turn: false,
        paid_deploy_cost: 0 as PaidDeployCost,
        once_per_game_flags: {},
      },
    };
  }

  const buildPlayer = (playerId: PlayerId): PlayerState => {
    const side = view.players[playerId];
    const isViewer = view.viewerId === playerId;
    return {
      player_id: playerId,
      base_points: side.basePoints as BasePoints,
      cost: side.cost as Cost,
      turn_cp_cap: side.turnCpCap,
      own_turn_index: side.ownTurnIndex,
      hand: isViewer ? view.hand.map((card) => card.instanceId) : [],
      deck: isViewer ? view.ownDeck : Array.from({ length: side.deckCount }, (_, index) => `__hidden_deck_${playerId}_${index}` as CardInstanceId),
      discard: isViewer ? view.ownDiscard : Array.from({ length: side.discardCount }, (_, index) => `__hidden_discard_${playerId}_${index}` as CardInstanceId),
      fatigue_count: side.fatigueCount,
      turns_taken: side.ownTurnIndex,
      focus_target_id: side.focusTargetId,
      focus_target_changes_this_turn: side.focusTargetChangesThisTurn,
      next_deploy_discounts: [...side.nextDeployDiscounts],
      facility_first_deploy_discount_used_turn: null,
      facility_ids: side.facilities.map((facility) => facility.instanceId),
    };
  };

  return {
    rules_version: view.rulesVersion,
    board_profile: view.boardProfile ?? CLASSIC_BOARD_PROFILE,
    cp_curve: view.cpCurve ?? [3, 4, 5, 6, 7, 8],
    open_decision_config: view.openDecisionConfig ?? {
      shieldCap: null,
      maxFocusChangesPerTurn: null,
      disabledFacilityContinuesCountdown: true,
      manualRecallCpCost: 0,
      aoeTargetLimit: null,
    },
    state_version: view.stateVersion,
    turn_number: view.turnNumber,
    phase: view.phase,
    active_player_id: view.activePlayerId,
    turn_start_prepared: view.phase === 'turn_start',
    random_state: 0,
    status_sequence: 0,
    next_entity_seq: 0,
    players: {
      player_a: buildPlayer('player_a'),
      player_b: buildPlayer('player_b'),
    },
    card_instances,
    card_definitions: { ...view.cardDefinitions },
    mulligan_completed: { ...view.mulliganCompleted },
    combat_log: [...view.combatLog],
    pending_effect_choices: view.pendingEffectChoices.map((choice) => ({
      source_instance_id: choice.sourceInstanceId,
      effect: choice.effect,
      amount: choice.amount,
      options: choice.options ? [...choice.options] : undefined,
    })),
    winner: view.winner,
  };
}
