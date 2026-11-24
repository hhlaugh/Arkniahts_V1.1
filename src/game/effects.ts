import {
  areAdjacentLanes,
  compareBoardEntities,
  getSameAndAdjacentLaneIds,
  isValidCell,
  normalizeLaneId,
  resolveLaneProfile,
  sortedLanes,
} from './board';
import {
  addCombatLog,
  applyStatusToInstance,
  defOf,
  entityName,
  grantCpWithCap,
  grantShieldToEntity,
  healEntity,
  installEquipmentPackageOnEntity,
  playerLabel,
  removeEntityByDefeatOrDestroy,
  removeEquipmentPackageFromEntity,
  removeShieldFromEntity,
  removeStatusFromInstance,
  resolveDamagePipeline,
  updateInstance,
  updatePlayer,
} from './combat-primitives';
import {
  canTriggerOwnEffects,
  findEntityAtCell,
  getEntityKind,
  getEntityMaxHp,
  getEntityStats,
  getFirstEmptyCellInLane,
  hasStatus,
  isCellOccupied,
  isFacilityDisabled,
  selectHighestAttackEnemy,
} from './range';
import type {
  CardDefinition,
  CardId,
  CardInstance,
  CardInstanceId,
  EquipmentPackageState,
  ExpireAtNode,
  GameState,
  HpValue,
  LaneId,
  PlayerId,
  Position,
  SkillEffectBlock,
  SkillEffectOp,
  SummonRuntimeState,
  TemporaryAttackModifier,
} from './types';

export interface EffectExecutionContext {
  readonly sourceId?: CardInstanceId;
  readonly sourceName: string;
  readonly actorId: PlayerId;
  readonly sourceLane?: LaneId | null;
  readonly triggerName?: string;
  readonly selectedTargetId?: CardInstanceId;
  readonly secondaryTargetId?: CardInstanceId;
  readonly selectedLane?: LaneId;
  readonly selectedLanes?: readonly LaneId[];
  readonly selectedPosition?: Position;
  readonly selectedSlotIndex?: number;
  readonly primaryTargetId?: CardInstanceId;
  readonly primaryTargetLostHp?: boolean;
  readonly primaryTargetRow?: Position;
  readonly primaryTargetWasSuppressed?: boolean;
  readonly primaryAttackHit?: boolean;
  readonly damagedTargetIds?: readonly CardInstanceId[];
  readonly damageSourceId?: CardInstanceId;
  readonly killerId?: CardInstanceId;
  readonly currentAttackPowerDelta?: number;
  readonly focusFireBonus?: number;
  readonly healAmountModifier?: number;
  readonly snapshotTargets?: readonly CardInstanceId[];
  readonly lockedHighestAttackId?: CardInstanceId;
  readonly preventedLethal?: boolean;
  readonly defaultTargetToSelected?: boolean;
  readonly onImmediateAttack?: (
    state: GameState,
    unitId: CardInstanceId,
    focusFireBonus: number,
    consumeNormalAttack: boolean,
  ) => GameState;
  readonly onDrawCards?: (state: GameState, playerId: PlayerId, count: number) => GameState;
}

export interface EffectExecutionResult {
  readonly state: GameState;
  readonly context: EffectExecutionContext;
}

export function isOperatorDeployPositionAllowed(definition: CardDefinition, position: Position): boolean {
  if (definition.floating && position !== 'back') return false;
  const rule = definition.attack_profile?.deploy_rule ?? definition.deploy_rule ?? (definition.attack_type === 'melee' ? 'front_only' : 'back_only');
  if (rule === 'front_only') return position === 'front';
  if (rule === 'back_only') return position === 'back';
  return true;
}

export function isOperatorInstance(state: GameState, inst: CardInstance | undefined): boolean {
  return Boolean(inst && inst.zone === 'board' && getEntityKind(state, inst) === 'operator' && inst.operator_combat);
}

export function isUnitInstance(state: GameState, inst: CardInstance | undefined): boolean {
  if (!inst || inst.zone !== 'board' || !inst.operator_combat) return false;
  const kind = getEntityKind(state, inst);
  return kind === 'operator' || kind === 'summon';
}

export function isFacilityInstance(state: GameState, inst: CardInstance | undefined): boolean {
  return Boolean(inst && inst.zone === 'board' && getEntityKind(state, inst) === 'facility');
}

export function createSummonTokenInstance(
  state: GameState,
  controllerId: PlayerId,
  sourceId: CardInstanceId,
  lane: LaneId,
  position: Position,
  slotIndex: number,
  config: {
    readonly token_id: string;
    readonly atk?: number;
    readonly hp?: number;
    readonly attack_type?: 'melee' | 'ranged';
    readonly damage_type?: 'physical' | 'arts';
    readonly taunt_scope?: 'none' | 'same_lane' | 'all_lanes';
    readonly recallable_by_controller?: boolean;
    readonly on_turn_end?: string;
  },
): { readonly state: GameState; readonly tokenId: CardInstanceId } {
  const seq = state.next_entity_seq + 1;
  const tokenInstanceId = `summon:${controllerId}:${config.token_id}:${seq}` as CardInstanceId;
  const source = state.card_instances[sourceId];
  const summonState: SummonRuntimeState = {
    token_id: config.token_id,
    source_instance_id: sourceId,
    atk: config.atk ?? 0,
    max_hp: config.hp ?? 2,
    attack_type: config.attack_type ?? 'melee',
    damage_type: config.damage_type ?? 'physical',
    taunt_scope: config.taunt_scope ?? 'none',
    recallable_by_controller: config.recallable_by_controller ?? true,
    on_turn_end: config.on_turn_end,
  };
  const tokenInstance: CardInstance = {
    card_instance_id: tokenInstanceId,
    card_id: (source?.card_id ?? (`TOKEN:${config.token_id}` as CardId)) as CardId,
    owner_id: controllerId,
    controller_id: controllerId,
    entity_kind: 'summon',
    board_half: controllerId,
    lane: normalizeLaneId(state.board_profile, lane),
    position,
    slot_index: slotIndex,
    zone: 'board',
    operator_combat: {
      current_hp: summonState.max_hp as HpValue,
      current_atk_modifiers: [],
      current_sp: 0 as never,
      shield: 0,
      statuses: [],
      equipment_ids: [],
    },
    operator_lifecycle: {
      redeploy_cd_remaining: 0,
      redeploy_cd_applied_owner_turn_index: null,
      has_deployed_before: true,
      entered_battle_this_owner_turn: true,
      paid_deploy_cost: 0 as never,
      once_per_game_flags: {},
    },
    summon_state: summonState,
  };

  let next: GameState = {
    ...state,
    next_entity_seq: seq,
    card_instances: {
      ...state.card_instances,
      [tokenInstanceId]: tokenInstance,
    },
  };
  next = addCombatLog(next, {
    type: 'summon_created',
    source_instance_id: sourceId,
    target_instance_id: tokenInstanceId,
    source_player_id: controllerId,
    target_player_id: controllerId,
    source_name: source ? entityName(next, source) : undefined,
    target_name: entityName(next, tokenInstance),
    lane,
    position,
    slot_index: slotIndex,
    detail: `${playerLabel(controllerId)} 召唤了【${entityName(next, tokenInstance)}】于 [${lane}·${position === 'front' ? 'F' : 'R'}${slotIndex}]。`,
  });
  return { state: next, tokenId: tokenInstanceId };
}

/**
 * 触发实体被摧毁事件（如梅尔水獭/傀影虚影的亡语爆破）
 */
export function triggerEntityDestroyedEffects(state: GameState, destroyedEntity: CardInstance): GameState {
  if (!destroyedEntity.summon_state) return state;
  const sourceId = destroyedEntity.summon_state.source_instance_id;
  const source = state.card_instances[sourceId];
  const sourceDef = source ? defOf(state, source) : state.card_definitions[destroyedEntity.card_id];
  if (!sourceDef) return state;
  // 若来源仍在场且被眩晕/沉默/冻结，按自身技能检查；若来源已因撤离/击倒不在场，召唤物自身的亡语仍触发
  if (source && source.zone === 'board' && !canTriggerOwnEffects(state, source)) {
    return state;
  }

  const blocks = sourceDef.skill_effects ?? sourceDef.effect_json?.v1_1_blocks ?? [];
  const tokenId = destroyedEntity.summon_state.token_id;
  const onceKey = `entity_destroyed_${destroyedEntity.card_instance_id}`;
  if (source?.operator_lifecycle?.once_per_game_flags?.[onceKey]) {
    return state;
  }

  let next = state;
  if (source?.operator_lifecycle) {
    next = updateInstance(next, sourceId, (s) => ({
      ...s,
      operator_lifecycle: {
        ...s.operator_lifecycle!,
        once_per_game_flags: { ...s.operator_lifecycle!.once_per_game_flags, [onceKey]: true },
      },
    }));
  }

  for (const block of blocks) {
    if (block.trigger !== 'on_entity_destroyed') continue;
    const filterId = block.filter?.entity_id;
    if (filterId && filterId !== tokenId) continue;
    const res = executeEffectOps(next, block.effects, {
      sourceId: destroyedEntity.card_instance_id,
      sourceName: entityName(next, destroyedEntity),
      actorId: destroyedEntity.controller_id,
      sourceLane: destroyedEntity.lane,
      triggerName: 'on_entity_destroyed',
    });
    next = res.state;
  }
  return next;
}

function checkCondition(
  state: GameState,
  condition: string | undefined,
  ctx: EffectExecutionContext,
): boolean {
  if (!condition) return true;
  const source = ctx.sourceId ? state.card_instances[ctx.sourceId] : undefined;
  const sourceLane = ctx.sourceLane ?? source?.lane ?? null;
  const actorId = ctx.actorId;
  const primary = ctx.primaryTargetId ? state.card_instances[ctx.primaryTargetId] : undefined;
  const selected = ctx.selectedTargetId ? state.card_instances[ctx.selectedTargetId] : undefined;

  switch (condition) {
    case 'primary_target_lost_hp':
    case 'hp_was_lost':
      return Boolean(ctx.primaryTargetLostHp);
    case 'primary_attack_hit':
      return ctx.primaryAttackHit !== false;
    case 'primary_target_is_suppressed':
      return Boolean(ctx.primaryTargetWasSuppressed || (primary && hasStatus(primary, 'suppressed')));
    case 'primary_target_has_shield':
      return Boolean(primary?.operator_combat && primary.operator_combat.shield > 0);
    case 'primary_target_is_back_row':
    case 'current_target_row_is_rear':
      return (ctx.primaryTargetRow ?? primary?.position) === 'back';
    case 'primary_target_current_hp_gte_4':
      return (primary?.operator_combat?.current_hp ?? 0) >= 4;
    case 'primary_target_current_hp_below_max_hp': {
      if (!primary?.operator_combat) return false;
      return primary.operator_combat.current_hp < getEntityMaxHp(state, primary);
    }
    case 'self_hp_at_or_below_half': {
      if (!source?.operator_combat) return false;
      return source.operator_combat.current_hp * 2 <= getEntityMaxHp(state, source);
    }
    case 'self_took_no_hp_damage_during_previous_owner_turn':
      return Boolean(source?.operator_combat && !source.operator_combat.took_hp_damage_last_owner_turn);
    case 'self_has_shield':
      return Boolean(source?.operator_combat && source.operator_combat.shield > 0);
    case 'other_friendly_vanguard_same_lane_exists':
      return Object.values(state.card_instances).some(
        (u) =>
          u.zone === 'board' &&
          u.controller_id === actorId &&
          u.card_instance_id !== ctx.sourceId &&
          sourceLane !== null &&
          normalizeLaneId(state.board_profile, u.lane ?? '') === normalizeLaneId(state.board_profile, sourceLane) &&
          defOf(state, u)?.class === 'vanguard',
      );
    case 'enemy_back_exists':
      return Object.values(state.card_instances).some(
        (u) =>
          u.zone === 'board' &&
          u.controller_id !== actorId &&
          sourceLane !== null &&
          normalizeLaneId(state.board_profile, u.lane ?? '') === normalizeLaneId(state.board_profile, sourceLane) &&
          u.position === 'back',
      );
    case 'no_other_friendly_same_lane':
      return !Object.values(state.card_instances).some(
        (u) =>
          u.zone === 'board' &&
          u.controller_id === actorId &&
          u.card_instance_id !== ctx.sourceId &&
          sourceLane !== null &&
          normalizeLaneId(state.board_profile, u.lane ?? '') === normalizeLaneId(state.board_profile, sourceLane),
      );
    case 'self_first_basic_attack_this_combat':
      return Boolean(source?.operator_combat && !(source.operator_combat.per_combat_trigger_counts?.first_attack_used));
    case 'target_hp_at_most_half': {
      const target = selected ?? primary;
      if (!target?.operator_combat) return false;
      return target.operator_combat.current_hp * 2 <= getEntityMaxHp(state, target);
    }
    case 'controller_hand_count_below_4':
      return (state.players[actorId]?.hand.length ?? 0) < 4;
    case 'selected_enemy_operator_has_status_suppressed':
      return Boolean(selected && hasStatus(selected, 'suppressed'));
    case 'token_is_present': {
      const drone = Object.values(state.card_instances).find(
        (u) =>
          u.zone === 'board' &&
          u.summon_state?.source_instance_id === ctx.sourceId &&
          u.summon_state?.token_id === 'silence_med_drone',
      );
      if (!drone) return false;
      const sourceInst = ctx.sourceId ? state.card_instances[ctx.sourceId] : undefined;
      const usedCount = Number(sourceInst?.operator_combat?.per_combat_trigger_counts?.silence_drone_turns ?? 0);
      return usedCount < 2;
    }
    case 'host_lost_actual_hp_and_not_triggered_this_controller_turn': {
      if (!source?.operator_combat) return false;
      return Boolean(ctx.primaryTargetLostHp) && !source.operator_combat.equipped_package?.triggered_this_owner_turn;
    }
    default:
      return true;
  }
}

function checkAndMarkLimit(
  state: GameState,
  sourceId: CardInstanceId | undefined,
  op: SkillEffectOp,
  ctx: EffectExecutionContext,
): { readonly allowed: boolean; readonly state: GameState } {
  const limit = typeof op.limit === 'string' ? op.limit : undefined;
  if (!limit || !sourceId) return { allowed: true, state };
  const source = state.card_instances[sourceId];
  if (!source) return { allowed: true, state };
  const flagKey = `${ctx.triggerName ?? 'effect'}_${op.op}`;

  if (limit === 'once_per_game') {
    if (source.operator_lifecycle?.once_per_game_flags[flagKey]) return { allowed: false, state };
    return {
      allowed: true,
      state: updateInstance(state, sourceId, (s) => ({
        ...s,
        operator_lifecycle: {
          ...s.operator_lifecycle!,
          once_per_game_flags: { ...s.operator_lifecycle!.once_per_game_flags, [flagKey]: true },
        },
      })),
    };
  }

  if (limit === 'once_per_owner_turn') {
    const count = source.operator_combat?.per_turn_trigger_counts?.[flagKey] ?? 0;
    if (count >= 1) return { allowed: false, state };
    return {
      allowed: true,
      state: updateInstance(state, sourceId, (s) => ({
        ...s,
        operator_combat: {
          ...s.operator_combat!,
          per_turn_trigger_counts: { ...(s.operator_combat!.per_turn_trigger_counts ?? {}), [flagKey]: count + 1 },
        },
      })),
    };
  }

  if (limit === 'once_per_combat' || limit === '2_per_combat') {
    const cap = limit === '2_per_combat' ? 2 : 1;
    const count = source.operator_combat?.per_combat_trigger_counts?.[flagKey] ?? 0;
    if (count >= cap) return { allowed: false, state };
    return {
      allowed: true,
      state: updateInstance(state, sourceId, (s) => ({
        ...s,
        operator_combat: {
          ...s.operator_combat!,
          per_combat_trigger_counts: { ...(s.operator_combat!.per_combat_trigger_counts ?? {}), [flagKey]: count + 1 },
        },
      })),
    };
  }

  return { allowed: true, state };
}

function resolveTargets(state: GameState, targetSpec: unknown, ctx: EffectExecutionContext): readonly CardInstance[] {
  const actorId = ctx.actorId;
  const source = ctx.sourceId ? state.card_instances[ctx.sourceId] : undefined;
  const sourceLane = ctx.sourceLane ?? source?.lane ?? null;
  const canonicalSourceLane = sourceLane ? normalizeLaneId(state.board_profile, sourceLane) : null;
  const selectedLane = ctx.selectedLane ? normalizeLaneId(state.board_profile, ctx.selectedLane) : null;

  const allBoard = Object.values(state.card_instances)
    .filter((u) => u.zone === 'board' && u.operator_combat)
    .sort((a, b) => compareBoardEntities(state.board_profile, a, b));

  const sameLane = (u: CardInstance, lane = canonicalSourceLane) =>
    lane !== null && u.lane !== null && normalizeLaneId(state.board_profile, u.lane) === lane;

  const sortWoundedLowestRatio = (list: readonly CardInstance[]) =>
    [...list]
      .filter((u) => (u.operator_combat?.current_hp ?? 0) < getEntityMaxHp(state, u))
      .sort((a, b) => {
        const ra = (a.operator_combat?.current_hp ?? 0) / Math.max(1, getEntityMaxHp(state, a));
        const rb = (b.operator_combat?.current_hp ?? 0) / Math.max(1, getEntityMaxHp(state, b));
        if (Math.abs(ra - rb) > 1e-6) return ra - rb;
        return compareBoardEntities(state.board_profile, a, b);
      });

  if (targetSpec === undefined || targetSpec === null || targetSpec === '') {
    if (ctx.defaultTargetToSelected) {
      const s = ctx.selectedTargetId ? state.card_instances[ctx.selectedTargetId] : undefined;
      return s && s.zone === 'board' ? [s] : [];
    }
    return source && source.zone === 'board' ? [source] : [];
  }

  switch (String(targetSpec)) {
    case 'self':
    case 'host':
      return source && source.zone === 'board' ? [source] : [];
    case 'primary_target':
    case 'damaged_primary_target': {
      const p = ctx.primaryTargetId ? state.card_instances[ctx.primaryTargetId] : undefined;
      return p && p.zone === 'board' ? [p] : [];
    }
    case 'damage_source': {
      const ds = ctx.damageSourceId ? state.card_instances[ctx.damageSourceId] : undefined;
      return ds && ds.zone === 'board' && ds.controller_id !== actorId ? [ds] : [];
    }
    case 'all_enemy_operators':
      return allBoard.filter((u) => u.controller_id !== actorId && isOperatorInstance(state, u));
    case 'selected_friendly_operator':
    case 'selected_friendly_unit':
    case 'selected_friendly_ranged_operator':
    case 'selected_enemy_operator':
    case 'selected_enemy_rear_operator_any_lane':
    case 'selected_enemy_summon':
    case 'selected_enemy_front_operator':
    case 'selected_enemy_facility':
    case 'same_selected_operator': {
      const s = ctx.selectedTargetId ? state.card_instances[ctx.selectedTargetId] : undefined;
      return s && s.zone === 'board' ? [s] : [];
    }
    case 'locked_highest_attack_target_if_survives': {
      const locked = ctx.lockedHighestAttackId ? state.card_instances[ctx.lockedHighestAttackId] : undefined;
      return locked && locked.zone === 'board' ? [locked] : [];
    }
    case 'each_damaged_target':
      return (ctx.damagedTargetIds ?? [])
        .map((id) => state.card_instances[id])
        .filter((u): u is CardInstance => Boolean(u && u.zone === 'board'));
    case 'enemy_front_same_lane': {
      const front = allBoard.filter(
        (u) => u.controller_id !== actorId && isUnitInstance(state, u) && sameLane(u) && u.position === 'front',
      );
      return front.length > 0 ? [front[0]] : [];
    }
    case 'enemy_back_same_lane': {
      const back = allBoard.filter(
        (u) => u.controller_id !== actorId && isUnitInstance(state, u) && sameLane(u) && u.position === 'back',
      );
      return back.length > 0 ? [back[0]] : [];
    }
    case 'one_enemy_same_lane': {
      const enemies = allBoard.filter((u) => u.controller_id !== actorId && sameLane(u));
      return enemies.length > 0 ? [enemies[0]] : [];
    }
    case 'all_enemies_same_lane':
      return allBoard.filter((u) => u.controller_id !== actorId && sameLane(u));
    case 'all_enemies_same_and_adjacent_lane': {
      if (!canonicalSourceLane) return [];
      const lanes = new Set(getSameAndAdjacentLaneIds(state.board_profile, canonicalSourceLane));
      return allBoard.filter(
        (u) => u.controller_id !== actorId && u.lane !== null && lanes.has(normalizeLaneId(state.board_profile, u.lane)),
      );
    }
    case 'highest_hp_enemy_same_lane': {
      const enemies = allBoard.filter((u) => u.controller_id !== actorId && sameLane(u));
      if (enemies.length === 0) return [];
      const sorted = [...enemies].sort(
        (a, b) => (b.operator_combat?.current_hp ?? 0) - (a.operator_combat?.current_hp ?? 0) || compareBoardEntities(state.board_profile, a, b),
      );
      return [sorted[0]];
    }
    case 'enemy_operator_highest_attack_global': {
      const top = selectHighestAttackEnemy(state, actorId);
      return top ? [top] : [];
    }
    case 'another_enemy_same_lane': {
      const others = allBoard.filter(
        (u) => u.controller_id !== actorId && sameLane(u) && u.card_instance_id !== ctx.primaryTargetId,
      );
      return others.length > 0 ? [others[0]] : [];
    }
    case 'one_enemy_adjacent_lane': {
      if (!canonicalSourceLane) return [];
      const adj = allBoard.filter(
        (u) =>
          u.controller_id !== actorId &&
          u.lane !== null &&
          areAdjacentLanes(state.board_profile, canonicalSourceLane, u.lane),
      );
      return adj.length > 0 ? [adj[0]] : [];
    }
    case 'all_friendly_vanguards':
      return allBoard.filter((u) => u.controller_id === actorId && defOf(state, u)?.class === 'vanguard');
    case 'all_friendly_units_in_selected_lane':
      return allBoard.filter((u) => u.controller_id === actorId && isUnitInstance(state, u) && sameLane(u, selectedLane));
    case 'enemy_operators_in_selected_two_directly_adjacent_lanes': {
      const lanes = new Set((ctx.selectedLanes ?? (selectedLane ? [selectedLane] : [])).map((l) => normalizeLaneId(state.board_profile, l)));
      return allBoard.filter(
        (u) =>
          u.controller_id !== actorId &&
          isOperatorInstance(state, u) &&
          u.lane !== null &&
          lanes.has(normalizeLaneId(state.board_profile, u.lane)),
      );
    }
    case 'enemy_units_in_lowest_laneId_containing_enemy_unit': {
      for (const lane of sortedLanes(state.board_profile)) {
        const units = allBoard.filter(
          (u) => u.controller_id !== actorId && sameLane(u, lane.laneId),
        );
        if (units.length > 0) return units;
      }
      return [];
    }
    case 'other_ally_same_lane': {
      const allies = allBoard.filter(
        (u) => u.controller_id === actorId && isUnitInstance(state, u) && sameLane(u) && u.card_instance_id !== ctx.sourceId,
      );
      return allies.length > 0 ? [allies[0]] : [];
    }
    case 'damaged_ally_same_lane': {
      const dmgTarget = ctx.primaryTargetId ? state.card_instances[ctx.primaryTargetId] : undefined;
      if (dmgTarget && dmgTarget.zone === 'board' && dmgTarget.controller_id === actorId && sameLane(dmgTarget)) {
        return [dmgTarget];
      }
      return [];
    }
    case 'lowest_hp_ratio_wounded_ally_same_lane':
    case 'wounded_ally_same_lane': {
      const candidates = allBoard.filter(
        (u) =>
          u.controller_id === actorId &&
          isUnitInstance(state, u) &&
          sameLane(u) &&
          !defOf(state, u)?.native_traits?.some((t) => t.effect?.op === 'exclude_from_friendly_heal_targets'),
      );
      const wounded = sortWoundedLowestRatio(candidates);
      return wounded.length > 0 ? [wounded[0]] : [];
    }
    case 'lowest_hp_ratio_ally_same_lane': {
      const candidates = allBoard.filter((u) => u.controller_id === actorId && isUnitInstance(state, u) && sameLane(u));
      const sorted = [...candidates].sort((a, b) => {
        const ra = (a.operator_combat?.current_hp ?? 0) / Math.max(1, getEntityMaxHp(state, a));
        const rb = (b.operator_combat?.current_hp ?? 0) / Math.max(1, getEntityMaxHp(state, b));
        if (Math.abs(ra - rb) > 1e-6) return ra - rb;
        return compareBoardEntities(state.board_profile, a, b);
      });
      return sorted.length > 0 ? [sorted[0]] : [];
    }
    case 'lowest_hp_ratio_wounded_ally_same_or_adjacent': {
      if (!canonicalSourceLane) return [];
      const lanes = new Set(getSameAndAdjacentLaneIds(state.board_profile, canonicalSourceLane));
      const candidates = allBoard.filter(
        (u) =>
          u.controller_id === actorId &&
          isUnitInstance(state, u) &&
          u.lane !== null &&
          lanes.has(normalizeLaneId(state.board_profile, u.lane)) &&
          !defOf(state, u)?.native_traits?.some((t) => t.effect?.op === 'exclude_from_friendly_heal_targets'),
      );
      const wounded = sortWoundedLowestRatio(candidates);
      return wounded.length > 0 ? [wounded[0]] : [];
    }
    case 'all_wounded_allies': {
      const candidates = allBoard.filter(
        (u) =>
          u.controller_id === actorId &&
          isUnitInstance(state, u) &&
          !defOf(state, u)?.native_traits?.some((t) => t.effect?.op === 'exclude_from_friendly_heal_targets'),
      );
      return sortWoundedLowestRatio(candidates);
    }
    case 'friendly_damaged_unit_lowest_current_hp': {
      const wounded = allBoard
        .filter(
          (u) =>
            u.controller_id === actorId &&
            isUnitInstance(state, u) &&
            (u.operator_combat?.current_hp ?? 0) < getEntityMaxHp(state, u) &&
            !defOf(state, u)?.native_traits?.some((t) => t.effect?.op === 'exclude_from_friendly_heal_targets'),
        )
        .sort((a, b) => (a.operator_combat?.current_hp ?? 0) - (b.operator_combat?.current_hp ?? 0) || compareBoardEntities(state.board_profile, a, b));
      return wounded.length > 0 ? [wounded[0]] : [];
    }
    case 'killer_same_lane': {
      const killer = ctx.killerId ? state.card_instances[ctx.killerId] : undefined;
      if (killer && killer.zone === 'board' && killer.controller_id === actorId && sameLane(killer)) {
        return [killer];
      }
      return [];
    }
    case 'choose_one_friendly_front_row_unit_any_lane': {
      if (ctx.selectedTargetId && state.card_instances[ctx.selectedTargetId]) {
        return [state.card_instances[ctx.selectedTargetId]];
      }
      const fronts = allBoard.filter((u) => u.controller_id === actorId && isUnitInstance(state, u) && u.position === 'front');
      return fronts.length > 0 ? [fronts[0]] : [];
    }
    default: {
      if (!targetSpec && ctx.defaultTargetToSelected && ctx.selectedTargetId) {
        const s = state.card_instances[ctx.selectedTargetId];
        return s && s.zone === 'board' ? [s] : [];
      }
      return [];
    }
  }
}

export function executeEffectOps(
  initialState: GameState,
  ops: readonly SkillEffectOp[],
  initialCtx: EffectExecutionContext,
): EffectExecutionResult {
  let state = initialState;
  let ctx = initialCtx;

  for (const op of ops) {
    if (op.condition && !checkCondition(state, String(op.condition), ctx)) {
      continue;
    }
    if (op.limit) {
      const limitCheck = checkAndMarkLimit(state, ctx.sourceId, op, ctx);
      state = limitCheck.state;
      if (!limitCheck.allowed) continue;
    }

    switch (op.op) {
      case 'exclude_from_friendly_heal_targets':
      case 'continuous':
        break;

      case 'if_then': {
        const cond = typeof op.condition === 'string' ? checkCondition(state, op.condition, ctx) : true;
        if (cond && op.then) {
          const nested = Array.isArray(op.then) ? (op.then as SkillEffectOp[]) : [op.then as SkillEffectOp];
          const res = executeEffectOps(state, nested, ctx);
          state = res.state;
          ctx = res.context;
        }
        break;
      }

      case 'if_else': {
        const cond = typeof op.condition === 'string' ? checkCondition(state, op.condition, ctx) : false;
        const branch = cond ? op.then : op.else;
        if (branch) {
          const nested = Array.isArray(branch) ? (branch as SkillEffectOp[]) : [branch as SkillEffectOp];
          const res = executeEffectOps(state, nested, ctx);
          state = res.state;
          ctx = res.context;
        }
        break;
      }

      case 'for_each': {
        const rawTargets = resolveTargets(state, op.target, ctx);
        const cap = state.open_decision_config?.aoeTargetLimit;
        const targets = typeof cap === 'number' ? rawTargets.slice(0, cap) : rawTargets;
        const nestedOps = Array.isArray(op.effects) ? (op.effects as SkillEffectOp[]) : [];
        for (const t of targets) {
          const res = executeEffectOps(state, nestedOps, {
            ...ctx,
            selectedTargetId: t.card_instance_id,
            defaultTargetToSelected: true,
          });
          state = res.state;
          ctx = res.context;
        }
        break;
      }

      case 'grant_supply': {
        const amount = Number(op.amount ?? 1);
        state = grantCpWithCap(state, ctx.actorId, amount, ctx.sourceName, ctx.sourceId);
        break;
      }

      case 'grant_shield': {
        const amount = Number(op.amount ?? 1);
        const targets = resolveTargets(state, op.target ?? (ctx.defaultTargetToSelected ? undefined : 'self'), ctx);
        for (const t of targets) {
          state = grantShieldToEntity(state, t.card_instance_id, amount, ctx.sourceName, ctx.sourceId);
        }
        break;
      }

      case 'grant_cover': {
        const targets = resolveTargets(state, op.target ?? (ctx.defaultTargetToSelected ? undefined : 'self'), ctx);
        for (const t of targets) {
          state = applyStatusToInstance(state, t.card_instance_id, 'cover', 1, {
            sourceInstanceId: ctx.sourceId,
            expireAtNode: 'until_removed',
          });
        }
        break;
      }

      case 'heal': {
        const targets = resolveTargets(state, op.target ?? 'self', ctx);
        for (const t of targets) {
          let amount =
            op.amount === 'self_atk'
              ? getEntityStats(state, state.card_instances[ctx.sourceId!]!).atk
              : Number(op.amount ?? 1);
          if (typeof op.bonus_amount === 'number' && checkCondition(state, typeof op.condition === 'string' ? op.condition : 'target_hp_at_most_half', { ...ctx, selectedTargetId: t.card_instance_id })) {
            amount += op.bonus_amount;
          }
          // 治疗前钩子 (例如苏苏洛 OP-MED-005 首次治疗 +2)
          if (ctx.sourceId) {
            const healer = state.card_instances[ctx.sourceId];
            const hDef = healer ? defOf(state, healer) : undefined;
            if (healer && canTriggerOwnEffects(state, healer) && hDef) {
              const beforeHealBlocks = (hDef.skill_effects ?? []).filter((b) => b.trigger === 'before_heal');
              for (const b of beforeHealBlocks) {
                const bhRes = executeEffectOps(state, b.effects, { ...ctx, healAmountModifier: 0 });
                state = bhRes.state;
                amount += bhRes.context.healAmountModifier ?? 0;
              }
            }
          }
          const res = healEntity(state, t.card_instance_id, amount, {
            sourceId: ctx.sourceId,
            sourceName: ctx.sourceName,
            allowSelfHealOverride: op.target === 'self' || op.target === 'host',
          });
          state = res.state;
        }
        break;
      }

      case 'heal_and_shield': {
        const targets = resolveTargets(state, op.target, ctx);
        const healAmt = Number(op.heal_amount ?? 1);
        const shieldAmt = Number(op.shield_amount ?? 1);
        for (const t of targets) {
          state = healEntity(state, t.card_instance_id, healAmt, {
            sourceId: ctx.sourceId,
            sourceName: ctx.sourceName,
          }).state;
          state = grantShieldToEntity(state, t.card_instance_id, shieldAmt, ctx.sourceName, ctx.sourceId);
        }
        break;
      }

      case 'modify_heal_amount': {
        ctx = {
          ...ctx,
          healAmountModifier: (ctx.healAmountModifier ?? 0) + Number(op.amount ?? 0),
        };
        break;
      }

      case 'apply_status': {
        const statusKind = String(op.status_id ?? op.status ?? 'suppressed');
        const targets = resolveTargets(state, op.target ?? (ctx.defaultTargetToSelected ? undefined : 'primary_target'), ctx);
        const rawDur = String(op.duration ?? '');
        const expireAtNode: ExpireAtNode | undefined =
          rawDur === 'until_end_of_next_owner_turn'
            ? 'owner_next_turn_end'
            : rawDur === 'next_owner_combat'
              ? 'owner_turn_start'
              : undefined;
        for (const t of targets) {
          state = applyStatusToInstance(state, t.card_instance_id, statusKind, 1, {
            sourceInstanceId: ctx.sourceId,
            expireAtNode,
            stacks: typeof op.stacks === 'number' ? op.stacks : undefined,
            bonusDamage: typeof op.bonus_damage === 'number' ? op.bonus_damage : undefined,
          });
        }
        break;
      }

      case 'apply_cold_or_freeze': {
        const targets = resolveTargets(state, op.target ?? 'primary_target', ctx);
        for (const t of targets) {
          state = applyStatusToInstance(state, t.card_instance_id, 'chilled', 1, {
            sourceInstanceId: ctx.sourceId,
          });
        }
        break;
      }

      case 'remove_status': {
        const statusKind = String(op.status_id ?? op.status ?? 'cover');
        const targets = resolveTargets(state, op.target, ctx);
        for (const t of targets) {
          state = removeStatusFromInstance(state, t.card_instance_id, statusKind, 'dispelled');
        }
        break;
      }

      case 'remove_shield': {
        const targets = resolveTargets(state, op.target, ctx);
        const amt = op.amount === 'all' ? 'all' : Number(op.amount ?? 1);
        for (const t of targets) {
          state = removeShieldFromEntity(state, t.card_instance_id, amt);
        }
        break;
      }

      case 'remove_equipment_effect': {
        const targets = resolveTargets(state, op.target, ctx);
        for (const t of targets) {
          state = removeEquipmentPackageFromEntity(state, t.card_instance_id);
        }
        break;
      }

      case 'remove_first_available': {
        const targets = resolveTargets(state, op.target, ctx);
        const priority = Array.isArray(op.priority) ? (op.priority as SkillEffectOp[]) : [];
        for (const t of targets) {
          for (const step of priority) {
            if (step.op === 'remove_status') {
              const sk = String(step.status_id ?? step.status ?? 'cover');
              if (hasStatus(t, sk)) {
                state = removeStatusFromInstance(state, t.card_instance_id, sk, 'dispelled');
                break;
              }
            } else if (step.op === 'remove_shield') {
              if ((t.operator_combat?.shield ?? 0) > 0) {
                const amt = step.amount === 'all' ? 'all' : Number(step.amount ?? 1);
                state = removeShieldFromEntity(state, t.card_instance_id, amt);
                break;
              }
            } else if (step.op === 'remove_equipment_effect') {
              if (t.operator_combat?.equipped_package) {
                state = removeEquipmentPackageFromEntity(state, t.card_instance_id);
                break;
              }
            }
          }
        }
        break;
      }

      case 'deal_damage':
      case 'deal_damage_to_all':
      case 'deal_damage_and_status':
      case 'deal_damage_and_suppression': {
        const targets = resolveTargets(state, op.target ?? (ctx.defaultTargetToSelected ? undefined : 'primary_target'), ctx);
        const amount = Number(op.amount ?? op.damage ?? 1);
        const dmgType =
          op.damage_type === 'arts'
            ? 'arts'
            : op.damage_type === 'facility_effect_damage'
              ? 'facility_effect_damage'
              : 'effect_damage';
        for (const t of targets) {
          const res = resolveDamagePipeline(state, {
            sourceId: ctx.sourceId,
            sourceControllerId: ctx.actorId,
            sourceName: ctx.sourceName,
            targetId: t.card_instance_id,
            rawDamage: amount,
            damageType: dmgType,
            isBasicAttack: false,
            onEntityDestroyed: triggerEntityDestroyedEffects,
          });
          state = res.state;
          if (res.survived) {
            if (op.op === 'deal_damage_and_suppression') {
              state = applyStatusToInstance(state, t.card_instance_id, 'suppressed', 1, {
                sourceInstanceId: ctx.sourceId,
              });
            } else if (op.op === 'deal_damage_and_status' && (op.status || op.status_id)) {
              state = applyStatusToInstance(state, t.card_instance_id, String(op.status_id ?? op.status), 1, {
                sourceInstanceId: ctx.sourceId,
              });
            } else if (op.then_if_survives && typeof op.then_if_survives === 'object') {
              const subRes = executeEffectOps(state, [op.then_if_survives as SkillEffectOp], {
                ...ctx,
                selectedTargetId: t.card_instance_id,
                defaultTargetToSelected: true,
              });
              state = subRes.state;
            }
          } else if (res.defeated && ctx.sourceId) {
            state = triggerOnKillEffects(state, ctx.sourceId, t.card_instance_id);
          }
        }
        break;
      }

      case 'snapshot_targets': {
        const targets = resolveTargets(state, op.target, ctx);
        const cap = state.open_decision_config?.aoeTargetLimit;
        const limited = typeof cap === 'number' ? targets.slice(0, cap) : targets;
        let lockedHighestAttackId: CardInstanceId | undefined;
        if (op.also_lock_target === 'enemy_operator_highest_attack_before_damage') {
          lockedHighestAttackId = selectHighestAttackEnemy(state, ctx.actorId)?.card_instance_id;
        }
        ctx = {
          ...ctx,
          snapshotTargets: limited.map((t) => t.card_instance_id),
          lockedHighestAttackId,
        };
        break;
      }

      case 'deal_damage_to_snapshot': {
        const amount = Number(op.amount ?? 1);
        const targets = ctx.snapshotTargets ?? [];
        for (const tid of targets) {
          const inst = state.card_instances[tid];
          if (!inst || inst.zone !== 'board') continue;
          const res = resolveDamagePipeline(state, {
            sourceId: ctx.sourceId,
            sourceControllerId: ctx.actorId,
            sourceName: ctx.sourceName,
            targetId: tid,
            rawDamage: amount,
            damageType: op.damage_type === 'arts' ? 'arts' : 'effect_damage',
            isBasicAttack: false,
            onEntityDestroyed: triggerEntityDestroyedEffects,
          });
          state = res.state;
        }
        break;
      }

      case 'lose_hp': {
        const targets = resolveTargets(state, op.target ?? 'self', ctx);
        const amount = Number(op.amount ?? 1);
        for (const t of targets) {
          if (!t.operator_combat) continue;
          const nextHp = Math.max(0, t.operator_combat.current_hp - amount);
          state = updateInstance(state, t.card_instance_id, (i) => ({
            ...i,
            operator_combat: {
              ...i.operator_combat!,
              current_hp: nextHp as HpValue,
              took_hp_damage_this_owner_turn: true,
            },
          }));
          state = addCombatLog(state, {
            type: 'damage_resolved',
            source_instance_id: ctx.sourceId,
            target_instance_id: t.card_instance_id,
            source_player_id: t.controller_id,
            target_player_id: t.controller_id,
            source_name: ctx.sourceName,
            target_name: entityName(state, t),
            amount,
            action_type: 'self_lose_hp',
            detail: `${playerLabel(t.controller_id)}【${entityName(state, t)}】自身失去 ${amount} 点 HP。`,
          });
          if (nextHp <= 0) {
            state = removeEntityByDefeatOrDestroy(state, t.card_instance_id, {
              cause: 'self_hp_loss',
              isEnemyKill: false,
              triggerOnEntityDestroyed: triggerEntityDestroyedEffects,
            });
          }
        }
        break;
      }

      case 'increase_attack_permanently': {
        const targets = resolveTargets(state, op.target ?? 'self', ctx);
        const amount = Number(op.amount ?? 1);
        const maxTotal = typeof op.max_total === 'number' ? op.max_total : Number.POSITIVE_INFINITY;
        for (const t of targets) {
          if (!t.operator_combat) continue;
          const currentPerm = t.operator_combat.permanent_atk_bonus ?? 0;
          const actual = Math.min(amount, Math.max(0, maxTotal - currentPerm));
          if (actual <= 0) continue;
          state = updateInstance(state, t.card_instance_id, (i) => ({
            ...i,
            operator_combat: {
              ...i.operator_combat!,
              permanent_atk_bonus: currentPerm + actual,
            },
          }));
          state = addCombatLog(state, {
            type: 'effect_triggered',
            source_instance_id: ctx.sourceId,
            target_instance_id: t.card_instance_id,
            source_player_id: ctx.actorId,
            target_player_id: t.controller_id,
            source_name: ctx.sourceName,
            target_name: entityName(state, t),
            amount: actual,
            action_type: 'inspire',
            detail: `【${ctx.sourceName}】鼓舞 ${playerLabel(t.controller_id)}【${entityName(state, t)}】，攻击力永久 +${actual}！`,
          });
        }
        break;
      }

      case 'apply_stat_modifier': {
        const targets = resolveTargets(state, op.target, ctx);
        const amount = Number(op.amount ?? 1);
        const mod: TemporaryAttackModifier = {
          kind: 'stat',
          stat: 'attack',
          amount,
          expires: 'turn_end',
          owner_id: ctx.actorId,
        };
        for (const t of targets) {
          if (!t.operator_combat) continue;
          state = updateInstance(state, t.card_instance_id, (i) => ({
            ...i,
            operator_combat: {
              ...i.operator_combat!,
              temp_modifiers: [...(i.operator_combat!.temp_modifiers ?? []), mod],
            },
          }));
        }
        break;
      }

      case 'modify_current_attack_damage':
      case 'modify_current_attack_power': {
        const amount = Number(op.amount ?? 0);
        if (op.source_modifier === 'focus_fire') {
          ctx = {
            ...ctx,
            focusFireBonus: Math.max(ctx.focusFireBonus ?? 0, amount),
          };
        } else {
          ctx = {
            ...ctx,
            currentAttackPowerDelta: (ctx.currentAttackPowerDelta ?? 0) + amount,
          };
        }
        break;
      }

      case 'grant_first_attack_modifier': {
        const targets = resolveTargets(state, op.target, ctx);
        const amount = Number(op.amount ?? 1);
        const expires: TemporaryAttackModifier['expires'] =
          op.limit === 'first_basic_attack_this_combat' ? 'first_basic_attack_this_combat' : 'first_basic_attack';
        const mod: TemporaryAttackModifier = {
          kind: 'focus_fire',
          amount,
          expires,
          owner_id: ctx.actorId,
        };
        for (const t of targets) {
          if (!t.operator_combat) continue;
          state = updateInstance(state, t.card_instance_id, (i) => ({
            ...i,
            operator_combat: {
              ...i.operator_combat!,
              temp_modifiers: [...(i.operator_combat!.temp_modifiers ?? []), mod],
            },
          }));
        }
        break;
      }

      case 'set_attack_profile_modifier':
      case 'apply_attack_profile_modifier': {
        const targets = resolveTargets(state, op.target, ctx);
        const mod: TemporaryAttackModifier = {
          kind: 'attack_profile',
          modifier_id: typeof op.modifier_id === 'string' ? op.modifier_id : undefined,
          route_scope: typeof op.route_scope === 'string' ? op.route_scope : undefined,
          target_priority: typeof op.target_priority === 'string' ? op.target_priority : undefined,
          ignore_front_interception: typeof op.ignore_front_interception === 'boolean' ? op.ignore_front_interception : undefined,
          pattern: typeof op.pattern === 'string' ? op.pattern : undefined,
          target_limit: (op.target_limit === 'all' || typeof op.target_limit === 'number') ? op.target_limit : undefined,
          secondary_damage: typeof op.secondary_damage === 'number' ? op.secondary_damage : undefined,
          expires: op.duration === 'this_combat' ? 'combat_end' : 'turn_end',
          owner_id: ctx.actorId,
        };
        for (const t of targets) {
          if (!t.operator_combat) continue;
          state = updateInstance(state, t.card_instance_id, (i) => ({
            ...i,
            operator_combat: {
              ...i.operator_combat!,
              temp_modifiers: [...(i.operator_combat!.temp_modifiers ?? []), mod],
            },
          }));
        }
        break;
      }

      case 'grant_next_deploy_discount': {
        const amount = Number(op.amount ?? 1);
        state = updatePlayer(state, ctx.actorId, (p) => ({
          ...p,
          next_deploy_discounts: [
            ...p.next_deploy_discounts,
            { amount, expires_player: ctx.actorId, source: ctx.sourceName },
          ],
        }));
        break;
      }

      case 'return_to_hand': {
        const targets = resolveTargets(state, op.target, ctx);
        for (const t of targets) {
          const tDef = defOf(state, t);
          if (!tDef || getEntityKind(state, t) !== 'operator') continue;
          const cd = Math.max(1, tDef.redeploy_cd_base ?? 1);
          const ownerId = t.owner_id;
          // 清除关联召唤物
          const linkedSummons = Object.values(state.card_instances).filter(
            (u) => u.zone === 'board' && u.summon_state?.source_instance_id === t.card_instance_id,
          );
          for (const sum of linkedSummons) {
            state = removeEntityByDefeatOrDestroy(state, sum.card_instance_id, {
              cause: 'source_retreat',
              isEnemyKill: false,
              triggerOnEntityDestroyed: triggerEntityDestroyedEffects,
            });
          }
          state = updateInstance(state, t.card_instance_id, (i) => ({
            ...i,
            zone: 'hand',
            board_half: null,
            lane: null,
            position: null,
            slot_index: null,
            operator_combat: {
              current_hp: tDef.hp as HpValue,
              current_atk_modifiers: [],
              current_sp: (tDef.starting_sp ?? 0) as never,
              shield: 0,
              statuses: [],
              equipment_ids: [],
              equipped_package: null,
            },
            operator_lifecycle: {
              ...(i.operator_lifecycle!),
              redeploy_cd_remaining: cd,
              redeploy_cd_applied_owner_turn_index: state.players[ownerId].own_turn_index,
              paid_deploy_cost: null,
            },
          }));
          state = updatePlayer(state, ownerId, (p) => ({
            ...p,
            hand: [...p.hand, t.card_instance_id],
          }));
          if (typeof op.grant_next_redeploy_discount === 'number' && op.grant_next_redeploy_discount > 0) {
            state = updatePlayer(state, ctx.actorId, (p) => ({
              ...p,
              next_deploy_discounts: [
                ...p.next_deploy_discounts,
                { amount: Number(op.grant_next_redeploy_discount), expires_player: ctx.actorId, source: ctx.sourceName },
              ],
            }));
          }
          state = addCombatLog(state, {
            type: 'unit_withdrawn',
            source_instance_id: t.card_instance_id,
            source_player_id: ctx.actorId,
            source_name: tDef.card_name_zh,
            amount: 0,
            action_type: 'tactic_return',
            detail: `${playerLabel(ctx.actorId)} 通过【${ctx.sourceName}】将【${tDef.card_name_zh}】撤回手牌（冷却 ${cd} 回合，下一次部署 -${Number(op.grant_next_redeploy_discount ?? 0)} CP）。`,
          });
        }
        break;
      }

      case 'move_or_swap_unit': {
        if (op.operation === 'swap_positions' && ctx.selectedTargetId && ctx.secondaryTargetId) {
          const a = state.card_instances[ctx.selectedTargetId];
          const b = state.card_instances[ctx.secondaryTargetId];
          if (a && b && a.zone === 'board' && b.zone === 'board') {
            const aLane = a.lane;
            const aPos = a.position;
            const aSlot = a.slot_index;
            state = updateInstance(state, a.card_instance_id, (i) => ({
              ...i,
              lane: b.lane,
              position: b.position,
              slot_index: b.slot_index,
            }));
            state = updateInstance(state, b.card_instance_id, (i) => ({
              ...i,
              lane: aLane,
              position: aPos,
              slot_index: aSlot,
            }));
            state = addCombatLog(state, {
              type: 'unit_moved',
              source_instance_id: a.card_instance_id,
              target_instance_id: b.card_instance_id,
              source_player_id: ctx.actorId,
              source_name: entityName(state, a),
              target_name: entityName(state, b),
              detail: `${playerLabel(ctx.actorId)} 使用【${ctx.sourceName}】交换了【${entityName(state, a)}】与【${entityName(state, b)}】的位置。`,
            });
          }
        } else {
          // 暗索：牵引同路敌方后位 -> 同路敌方前位；若前位被占则交换
          const targets = resolveTargets(state, op.target, ctx);
          for (const enemyBack of targets) {
            if (!enemyBack.lane) continue;
            const enemyController = enemyBack.controller_id;
            const lane = resolveLaneProfile(state.board_profile, enemyBack.lane);
            if (!lane || lane.frontSlots <= 0) continue;
            const desiredSlot = Math.min(enemyBack.slot_index ?? 1, lane.frontSlots);
            const occupant = findEntityAtCell(state, enemyController, lane.laneId, 'front', desiredSlot);
            if (!occupant) {
              state = updateInstance(state, enemyBack.card_instance_id, (i) => ({
                ...i,
                position: 'front',
                slot_index: desiredSlot,
              }));
            } else if (op.if_occupied === 'swap') {
              const oldSlot = enemyBack.slot_index ?? 1;
              state = updateInstance(state, enemyBack.card_instance_id, (i) => ({
                ...i,
                position: 'front',
                slot_index: desiredSlot,
              }));
              state = updateInstance(state, occupant.card_instance_id, (i) => ({
                ...i,
                position: 'back',
                slot_index: oldSlot,
              }));
            }
            state = addCombatLog(state, {
              type: 'unit_moved',
              source_instance_id: ctx.sourceId,
              target_instance_id: enemyBack.card_instance_id,
              source_player_id: ctx.actorId,
              target_player_id: enemyController,
              source_name: ctx.sourceName,
              target_name: entityName(state, enemyBack),
              detail: `【${ctx.sourceName}】将 ${playerLabel(enemyController)}【${entityName(state, enemyBack)}】牵引至前排！`,
            });
          }
        }
        break;
      }

      case 'push_unit': {
        const targets = resolveTargets(state, op.target, ctx);
        for (const frontEnemy of targets) {
          if (!frontEnemy.lane) continue;
          const enemyController = frontEnemy.controller_id;
          const lane = resolveLaneProfile(state.board_profile, frontEnemy.lane);
          if (!lane || lane.rearSlots <= 0) {
            if (op.if_occupied && typeof op.if_occupied === 'object') {
              const res = executeEffectOps(state, [op.if_occupied as SkillEffectOp], {
                ...ctx,
                selectedTargetId: frontEnemy.card_instance_id,
                primaryTargetId: frontEnemy.card_instance_id,
                defaultTargetToSelected: true,
              });
              state = res.state;
            }
            continue;
          }
          const desiredSlot = Math.min(frontEnemy.slot_index ?? 1, lane.rearSlots);
          const occupied = isCellOccupied(state, enemyController, lane.laneId, 'back', desiredSlot);
          if (!occupied) {
            state = updateInstance(state, frontEnemy.card_instance_id, (i) => ({
              ...i,
              position: 'back',
              slot_index: desiredSlot,
            }));
            state = addCombatLog(state, {
              type: 'unit_moved',
              source_instance_id: ctx.sourceId,
              target_instance_id: frontEnemy.card_instance_id,
              source_player_id: ctx.actorId,
              target_player_id: enemyController,
              source_name: ctx.sourceName,
              target_name: entityName(state, frontEnemy),
              detail: `【${ctx.sourceName}】将 ${playerLabel(enemyController)}【${entityName(state, frontEnemy)}】推击至后排！`,
            });
          } else if (op.if_occupied && typeof op.if_occupied === 'object') {
            const subOp = op.if_occupied as SkillEffectOp;
            const res = executeEffectOps(state, [subOp], {
              ...ctx,
              selectedTargetId: frontEnemy.card_instance_id,
              primaryTargetId: frontEnemy.card_instance_id,
              defaultTargetToSelected: true,
            });
            state = res.state;
          }
        }
        break;
      }

      case 'move_unit': {
        const targets = resolveTargets(state, op.target, ctx);
        for (const unit of targets) {
          if (!unit.lane || !unit.position) continue;
          const unitDef = defOf(state, unit);
          if (op.destination === 'any_other_empty_cell_same_lane') {
            const lane = resolveLaneProfile(state.board_profile, unit.lane);
            if (!lane) continue;
            let destPos: Position | null = ctx.selectedPosition ?? null;
            let destSlot: number | null = ctx.selectedSlotIndex ?? null;

            const isLegalDest = (pos: Position, slot: number) =>
              !(pos === unit.position && slot === (unit.slot_index ?? 1)) &&
              isValidCell(state.board_profile, lane.laneId, pos, slot) &&
              (!unitDef || isOperatorDeployPositionAllowed(unitDef, pos)) &&
              !isCellOccupied(state, unit.controller_id, lane.laneId, pos, slot, unit.card_instance_id);

            if (!destPos || !destSlot || !isLegalDest(destPos, destSlot)) {
              destPos = null;
              destSlot = null;
              for (const pos of ['back', 'front'] as const) {
                const count = pos === 'front' ? lane.frontSlots : lane.rearSlots;
                for (let s = 1; s <= count; s += 1) {
                  if (isLegalDest(pos, s)) {
                    destPos = pos;
                    destSlot = s;
                    break;
                  }
                }
                if (destPos) break;
              }
            }
            if (destPos && destSlot) {
              state = updateInstance(state, unit.card_instance_id, (i) => ({
                ...i,
                position: destPos,
                slot_index: destSlot,
              }));
              state = addCombatLog(state, {
                type: 'unit_moved',
                target_instance_id: unit.card_instance_id,
                target_player_id: unit.controller_id,
                target_name: entityName(state, unit),
                lane: lane.laneId,
                position: destPos,
                slot_index: destSlot,
                detail: `${playerLabel(unit.controller_id)}【${entityName(state, unit)}】移动至 [${lane.laneId}·${destPos === 'front' ? 'F' : 'R'}${destSlot}]。`,
              });
            }
          } else if (op.destination === 'same_row_same_position_in_directly_adjacent_lane_empty_cell') {
            const destLane = ctx.selectedLane ? resolveLaneProfile(state.board_profile, ctx.selectedLane) : undefined;
            const slot = unit.slot_index ?? 1;
            const candidateLanes = destLane && areAdjacentLanes(state.board_profile, unit.lane, destLane.laneId)
              ? [destLane]
              : sortedLanes(state.board_profile).filter((l) => areAdjacentLanes(state.board_profile, unit.lane!, l.laneId));
            const chosenLane = candidateLanes.find(
              (l) =>
                isValidCell(state.board_profile, l.laneId, unit.position!, slot) &&
                !isCellOccupied(state, unit.controller_id, l.laneId, unit.position!, slot),
            );
            if (chosenLane) {
              state = updateInstance(state, unit.card_instance_id, (i) => ({
                ...i,
                lane: chosenLane.laneId,
              }));
              state = addCombatLog(state, {
                type: 'unit_moved',
                target_instance_id: unit.card_instance_id,
                target_player_id: unit.controller_id,
                target_name: entityName(state, unit),
                lane: chosenLane.laneId,
                position: unit.position,
                slot_index: slot,
                detail: `${playerLabel(unit.controller_id)}【${entityName(state, unit)}】跨路移动至 [${chosenLane.laneId}·${unit.position === 'front' ? 'F' : 'R'}${slot}]。`,
              });
            }
          }
        }
        break;
      }

      case 'disable_facility': {
        const targets = resolveTargets(state, op.target, ctx);
        for (const fac of targets) {
          if (!isFacilityInstance(state, fac)) continue;
          const facController = fac.controller_id;
          const facCtrlTurn = state.players[facController].own_turn_index;
          const untilTurn = facCtrlTurn + 1;
          state = updateInstance(state, fac.card_instance_id, (i) => ({
            ...i,
            facility_state: {
              ...(i.facility_state ?? {
                remaining_turns: 3,
                pause_effects_when_disabled: true,
                continue_countdown_when_disabled: state.open_decision_config.disabledFacilityContinuesCountdown,
              }),
              disabled_until_owner_turn: untilTurn,
            },
          }));
          state = addCombatLog(state, {
            type: 'facility_disabled',
            source_instance_id: ctx.sourceId,
            target_instance_id: fac.card_instance_id,
            source_player_id: ctx.actorId,
            target_player_id: facController,
            source_name: ctx.sourceName,
            target_name: entityName(state, fac),
            detail: `${playerLabel(ctx.actorId)} 使用【${ctx.sourceName}】使敌方设施【${entityName(state, fac)}】失效（暂停全部效果至控制者下回合结束）。`,
          });
        }
        break;
      }

      case 'install_equipment_effect': {
        const targets = resolveTargets(state, op.target, ctx);
        const rawPkg = op.package as {
          effect_id?: string;
          on_install?: SkillEffectOp[];
          modifiers?: EquipmentPackageState['modifiers'];
          triggers?: EquipmentPackageState['triggers'];
        } | undefined;
        if (!rawPkg) break;
        const sourceCard = ctx.sourceId ? state.card_instances[ctx.sourceId] : undefined;
        const sourceDef = sourceCard ? defOf(state, sourceCard) : undefined;
        const pkg: EquipmentPackageState = {
          card_id: sourceDef?.card_id ?? (ctx.sourceId as unknown as CardId),
          card_name_zh: ctx.sourceName,
          effect_id: rawPkg.effect_id ?? 'equipment',
          modifiers: rawPkg.modifiers ?? [],
          triggers: rawPkg.triggers ?? [],
          triggered_this_owner_turn: false,
        };
        for (const t of targets) {
          state = installEquipmentPackageOnEntity(state, t.card_instance_id, pkg);
          if (Array.isArray(rawPkg.on_install) && rawPkg.on_install.length > 0) {
            const onInstallRes = executeEffectOps(state, rawPkg.on_install, {
              ...ctx,
              sourceId: t.card_instance_id,
              actorId: t.controller_id,
            });
            state = onInstallRes.state;
          }
        }
        break;
      }

      case 'draw_cards': {
        const count = Number(op.count ?? 1);
        if (ctx.onDrawCards) {
          state = ctx.onDrawCards(state, ctx.actorId, count);
        }
        break;
      }

      case 'choose_discard': {
        const player = state.players[ctx.actorId];
        if (player && player.hand.length > 0 && ctx.sourceId) {
          state = {
            ...state,
            pending_effect_choices: [
              ...state.pending_effect_choices,
              {
                source_instance_id: ctx.sourceId,
                effect: 'choose_discard',
                amount: Number(op.count ?? 1),
              },
            ],
          };
        }
        break;
      }

      case 'summon_unit': {
        if (!ctx.sourceId || !ctx.sourceLane) break;
        const preferred = op.token_id === 'nightingale_birdcage' ? 'front' : undefined;
        const emptyCell = getFirstEmptyCellInLane(state, ctx.actorId, ctx.sourceLane, preferred);
        if (!emptyCell) break;
        const created = createSummonTokenInstance(state, ctx.actorId, ctx.sourceId, emptyCell.lane, emptyCell.position, emptyCell.slot_index, {
          token_id: String(op.token_id),
          atk: typeof op.atk === 'number' ? op.atk : 0,
          hp: typeof op.hp === 'number' ? op.hp : 2,
          taunt_scope: (op.taunt_scope as 'none' | 'same_lane' | 'all_lanes') ?? 'none',
          recallable_by_controller: op.recallable_by_controller !== false,
        });
        state = created.state;
        break;
      }

      case 'choose_and_summon': {
        if (!ctx.sourceId || !ctx.sourceLane) break;
        const emptyCell = getFirstEmptyCellInLane(state, ctx.actorId, ctx.sourceLane);
        if (!emptyCell) break;
        const choices = Array.isArray(op.choices) ? (op.choices as Array<{ token_id: string }>) : [];
        if (choices.length > 0) {
          state = {
            ...state,
            pending_effect_choices: [
              ...state.pending_effect_choices,
              {
                source_instance_id: ctx.sourceId,
                effect: 'choose_summon',
                amount: 1,
                options: choices.map((c) => c.token_id),
              },
            ],
          };
        }
        break;
      }

      case 'grant_immediate_attack': {
        const targets = resolveTargets(state, op.target, ctx);
        const focusBonus = Number(op.amount ?? 0);
        const consumeNormal = op.consume_normal_attack_this_turn !== false;
        for (const t of targets) {
          if (ctx.onImmediateAttack) {
            state = ctx.onImmediateAttack(state, t.card_instance_id, focusBonus, consumeNormal);
          }
        }
        break;
      }

      case 'prevent_lethal': {
        const targets = resolveTargets(state, op.target ?? 'self', ctx);
        const keepHp = Math.max(1, Number(op.amount ?? 1));
        for (const t of targets) {
          if (!t.operator_combat) continue;
          state = updateInstance(state, t.card_instance_id, (i) => ({
            ...i,
            operator_combat: {
              ...i.operator_combat!,
              current_hp: keepHp as HpValue,
            },
          }));
          ctx = { ...ctx, preventedLethal: true };
          state = addCombatLog(state, {
            type: 'effect_triggered',
            source_instance_id: t.card_instance_id,
            source_player_id: t.controller_id,
            source_name: entityName(state, t),
            action_type: 'prevent_lethal',
            amount: keepHp,
            detail: `${playerLabel(t.controller_id)}【${entityName(state, t)}】触发【不屈】，保留 ${keepHp} 点 HP 免于阵亡！`,
          });
        }
        break;
      }

      case 'pay_upkeep': {
        // 维护费用在 engine 的 turn_start 专属节点统一处理，这里兜底处理直接调用
        const amount = Number(op.amount ?? 1);
        const source = ctx.sourceId ? state.card_instances[ctx.sourceId] : undefined;
        if (!source || source.zone !== 'board') break;
        const player = state.players[ctx.actorId];
        if (player.cost >= amount) {
          state = updatePlayer(state, ctx.actorId, (p) => ({
            ...p,
            cost: (p.cost - amount) as never,
          }));
          state = addCombatLog(state, {
            type: 'cp_updated',
            source_instance_id: source.card_instance_id,
            source_player_id: ctx.actorId,
            source_name: entityName(state, source),
            amount: -amount,
            action_type: 'upkeep',
            detail: `${playerLabel(ctx.actorId)}【${entityName(state, source)}】支付 ${amount} CP 维护费用（剩余 ${player.cost - amount} CP）。`,
          });
        } else {
          state = removeEntityByDefeatOrDestroy(state, source.card_instance_id, {
            cause: 'upkeep_unpaid',
            isEnemyKill: false,
            triggerOnEntityDestroyed: triggerEntityDestroyedEffects,
          });
        }
        break;
      }

      case 'defeat_unit': {
        const targets = resolveTargets(state, op.target ?? 'self', ctx);
        for (const t of targets) {
          state = removeEntityByDefeatOrDestroy(state, t.card_instance_id, {
            cause: typeof op.cause === 'string' ? op.cause : 'effect_defeat',
            isEnemyKill: false,
            triggerOnEntityDestroyed: triggerEntityDestroyedEffects,
          });
        }
        break;
      }

      default:
        break;
    }
  }

  return { state, context: ctx };
}

export function triggerOnKillEffects(
  state: GameState,
  killerId: CardInstanceId,
  killedId: CardInstanceId,
): GameState {
  const killer = state.card_instances[killerId];
  const killed = state.card_instances[killedId];
  if (!killer || killer.zone !== 'board' || !canTriggerOwnEffects(state, killer)) {
    return state;
  }
  const killerDef = defOf(state, killer);
  let next = state;

  // 1. 击杀者自身的 on_kill 效果（如 翎羽 击杀回费 / 红豆 鼓舞 / 孑 治疗）
  if (killerDef) {
    const blocks = killerDef.skill_effects ?? killerDef.effect_json?.v1_1_blocks ?? [];
    for (const block of blocks) {
      if (block.trigger !== 'on_kill') continue;
      const res = executeEffectOps(next, block.effects, {
        sourceId: killerId,
        sourceName: entityName(next, killer),
        actorId: killer.controller_id,
        sourceLane: killer.lane,
        triggerName: 'on_kill',
        primaryTargetId: killedId,
        killerId,
      });
      next = res.state;
    }
  }

  // 2. 同路友方华法琳 (OP-MED-007) 等友军击杀监听
  const sameLaneAllies = Object.values(next.card_instances).filter(
    (u) =>
      u.zone === 'board' &&
      u.controller_id === killer.controller_id &&
      u.card_instance_id !== killerId &&
      u.lane !== null &&
      killer.lane !== null &&
      normalizeLaneId(next.board_profile, u.lane) === normalizeLaneId(next.board_profile, killer.lane) &&
      canTriggerOwnEffects(next, u),
  );
  for (const ally of sameLaneAllies) {
    const aDef = defOf(next, ally);
    if (!aDef) continue;
    const blocks = aDef.skill_effects ?? [];
    for (const block of blocks) {
      if (block.trigger !== 'on_kill') continue;
      // 华法琳给同路击杀者加攻击力
      if (aDef.card_id === ('OP-MED-007' as CardId)) {
        const res = executeEffectOps(next, block.effects, {
          sourceId: ally.card_instance_id,
          sourceName: entityName(next, ally),
          actorId: ally.controller_id,
          sourceLane: ally.lane,
          triggerName: 'on_kill',
          killerId,
          primaryTargetId: killedId,
        });
        next = res.state;
      }
    }
  }

  void killed;
  return next;
}

export function triggerUnitEventBlocks(
  state: GameState,
  unitId: CardInstanceId,
  triggerName: string,
  extraCtx: Partial<EffectExecutionContext> = {},
): EffectExecutionResult {
  const unit = state.card_instances[unitId];
  if (!unit || unit.zone !== 'board') return { state, context: { sourceId: unitId, sourceName: '', actorId: 'player_a' } };
  if (!canTriggerOwnEffects(state, unit)) {
    return {
      state,
      context: {
        sourceId: unitId,
        sourceName: entityName(state, unit),
        actorId: unit.controller_id,
        ...extraCtx,
      },
    };
  }
  const def = defOf(state, unit);
  let next = state;
  let ctx: EffectExecutionContext = {
    sourceId: unitId,
    sourceName: entityName(state, unit),
    actorId: unit.controller_id,
    sourceLane: unit.lane,
    triggerName,
    ...extraCtx,
  };

  if (def) {
    const blocks: readonly SkillEffectBlock[] = def.skill_effects ?? def.effect_json?.v1_1_blocks ?? [];
    for (const block of blocks) {
      if (block.trigger !== triggerName) continue;
      const res = executeEffectOps(next, block.effects, ctx);
      next = res.state;
      ctx = res.context;
    }
    for (const trait of def.native_traits ?? []) {
      if (trait.trigger === triggerName && trait.effect) {
        const res = executeEffectOps(next, [trait.effect], ctx);
        next = res.state;
        ctx = res.context;
      }
    }
  }

  // 检查装备效果包触发器 (V1.1 6件装备中的触发型装备：狙击瞄准镜 / 源石增幅模块 / 急救组件)
  const latestUnit = next.card_instances[unitId];
  const pkg = latestUnit?.operator_combat?.equipped_package;
  if (pkg && !isFacilityDisabled(next, latestUnit)) {
    for (const tr of pkg.triggers) {
      if (tr.trigger !== triggerName) continue;
      if (tr.condition && !checkCondition(next, tr.condition, ctx)) continue;
      const res = executeEffectOps(next, tr.effects, {
        ...ctx,
        sourceName: pkg.card_name_zh,
      });
      next = res.state;
      ctx = res.context;
      if (tr.reset === 'controller_turn_start') {
        next = updateInstance(next, unitId, (u) => ({
          ...u,
          operator_combat: {
            ...u.operator_combat!,
            equipped_package: u.operator_combat?.equipped_package
              ? { ...u.operator_combat.equipped_package, triggered_this_owner_turn: true }
              : null,
          },
        }));
      }
    }
  }

  return { state: next, context: ctx };
}

/**
 * 战术卡与装备卡出牌前置合法性检查（Spec §7.1：先验证目标/选择条件是否合法；不合法时不能打出、不支付CP）
 */
export function validateTacticOrSupportPlay(
  state: GameState,
  actorId: PlayerId,
  cardDef: CardDefinition,
  opts: {
    readonly targetId?: CardInstanceId;
    readonly secondaryTargetId?: CardInstanceId;
    readonly targetLane?: LaneId;
    readonly targetLanes?: readonly LaneId[];
  },
): { readonly ok: boolean; readonly reason?: string } {
  const target = opts.targetId ? state.card_instances[opts.targetId] : undefined;
  const secondary = opts.secondaryTargetId ? state.card_instances[opts.secondaryTargetId] : undefined;

  if (cardDef.card_type === 'support' && cardDef.support_subtype === 'equipment') {
    if (!target || !isUnitInstance(state, target) || target.controller_id !== actorId) {
      return { ok: false, reason: '装备必须指定一名自己控制的在场单位（干员或召唤物，设施不可装备）。' };
    }
    return { ok: true };
  }

  if (cardDef.card_type !== 'tactic') {
    return { ok: true };
  }

  switch (cardDef.card_id) {
    case 'DEMO-TAC-V2-001': {
      // 临机调度：交换两名友方干员的位置（可跨路；不可将只限前排的干员换到后排）
      if (!target || !secondary || target.card_instance_id === secondary.card_instance_id) {
        return { ok: false, reason: '临机调度必须指定两名不同的己方在场干员。' };
      }
      if (!isOperatorInstance(state, target) || !isOperatorInstance(state, secondary)) {
        return { ok: false, reason: '临机调度只能以在场干员为目标。' };
      }
      if (target.controller_id !== actorId || secondary.controller_id !== actorId) {
        return { ok: false, reason: '临机调度只能交换己方控制的干员。' };
      }
      const defA = defOf(state, target)!;
      const defB = defOf(state, secondary)!;
      if (!target.position || !secondary.position) return { ok: false, reason: '目标缺少位置信息。' };
      if (!isOperatorDeployPositionAllowed(defA, secondary.position) || !isOperatorDeployPositionAllowed(defB, target.position)) {
        return { ok: false, reason: '交换后存在不满足部署排位规则的干员（如近战干员不能位于后排）。' };
      }
      return { ok: true };
    }
    case 'DEMO-TAC-V2-003':
    case 'DEMO-TAC-V2-011': {
      if (!opts.targetLane || !resolveLaneProfile(state.board_profile, opts.targetLane)) {
        return { ok: false, reason: '必须选择有效的棋盘路线。' };
      }
      return { ok: true };
    }
    case 'DEMO-TAC-V2-004':
    case 'DEMO-TAC-V2-012':
    case 'DEMO-TAC-V2-022':
    case 'DEMO-TAC-V2-023': {
      if (!target || !isOperatorInstance(state, target) || target.controller_id !== actorId) {
        return { ok: false, reason: '该战术必须指定一名己方在场干员。' };
      }
      if (cardDef.card_id === 'DEMO-TAC-V2-023' && (hasStatus(target, 'freeze') || hasStatus(target, 'stun'))) {
        return { ok: false, reason: '处于冻结或眩晕中的干员不能执行先发制人。' };
      }
      if (cardDef.card_id === 'DEMO-TAC-V2-023' && target.operator_combat?.consumed_normal_attack_this_turn) {
        return { ok: false, reason: '该干员本回合普通攻击机会已被消耗。' };
      }
      return { ok: true };
    }
    case 'DEMO-TAC-V2-005':
    case 'DEMO-TAC-V2-013':
    case 'DEMO-TAC-V2-017':
    case 'DEMO-TAC-V2-018':
    case 'DEMO-TAC-V2-019': {
      if (!target || !isOperatorInstance(state, target) || target.controller_id === actorId) {
        return { ok: false, reason: '该战术必须指定一名敌方在场干员。' };
      }
      return { ok: true };
    }
    case 'DEMO-TAC-V2-007': {
      if (!target || !isOperatorInstance(state, target) || target.controller_id === actorId || target.position !== 'back') {
        return { ok: false, reason: '后排狙杀必须指定一名敌方后排干员。' };
      }
      return { ok: true };
    }
    case 'DEMO-TAC-V2-008': {
      if (!target || target.zone !== 'board' || getEntityKind(state, target) !== 'summon' || target.controller_id === actorId) {
        return { ok: false, reason: '反召唤弹必须指定一名敌方在场召唤物。' };
      }
      return { ok: true };
    }
    case 'DEMO-TAC-V2-009': {
      if (!target || !isUnitInstance(state, target) || target.controller_id !== actorId) {
        return { ok: false, reason: '急救包必须指定一名己方在场单位。' };
      }
      return { ok: true };
    }
    case 'DEMO-TAC-V2-010': {
      if (!target || !isUnitInstance(state, target) || target.controller_id !== actorId) {
        return { ok: false, reason: '紧急护盾必须指定一名己方在场单位。' };
      }
      return { ok: true };
    }
    case 'DEMO-TAC-V2-014': {
      const lanes = opts.targetLanes ?? (opts.targetLane ? [opts.targetLane] : []);
      if (state.board_profile.laneCount === 1) {
        if (lanes.length !== 1 || !resolveLaneProfile(state.board_profile, lanes[0])) {
          return { ok: false, reason: '单路棋盘下请选择有效路线。' };
        }
        return { ok: true };
      }
      if (lanes.length !== 2 || !areAdjacentLanes(state.board_profile, lanes[0], lanes[1])) {
        return { ok: false, reason: '全线压制必须选择两条直接相邻的路线。' };
      }
      return { ok: true };
    }
    case 'DEMO-TAC-V2-015': {
      if (!target || !isOperatorInstance(state, target) || target.controller_id !== actorId || !target.lane || !target.position) {
        return { ok: false, reason: '侧翼掩护必须指定一名己方在场干员。' };
      }
      const slot = target.slot_index ?? 1;
      const destLane = opts.targetLane ? resolveLaneProfile(state.board_profile, opts.targetLane) : undefined;
      const adjLanes = destLane && areAdjacentLanes(state.board_profile, target.lane, destLane.laneId)
        ? [destLane]
        : sortedLanes(state.board_profile).filter((l) => areAdjacentLanes(state.board_profile, target.lane!, l.laneId));
      const hasLegalDest = adjLanes.some(
        (l) => isValidCell(state.board_profile, l.laneId, target.position!, slot) && !isCellOccupied(state, actorId, l.laneId, target.position!, slot),
      );
      if (!hasLegalDest) {
        return { ok: false, reason: '相邻路线对应位置没有合法空位，无法执行侧翼掩护。' };
      }
      return { ok: true };
    }
    case 'DEMO-TAC-V2-016': {
      if (!target || !isOperatorInstance(state, target) || target.controller_id === actorId || target.position !== 'front' || !target.lane) {
        return { ok: false, reason: '推进行动必须指定一名敌方前位干员。' };
      }
      const slot = target.slot_index ?? 1;
      const destLane = opts.targetLane ? resolveLaneProfile(state.board_profile, opts.targetLane) : undefined;
      const adjLanes = destLane && areAdjacentLanes(state.board_profile, target.lane, destLane.laneId)
        ? [destLane]
        : sortedLanes(state.board_profile).filter((l) => areAdjacentLanes(state.board_profile, target.lane!, l.laneId));
      const hasLegalDest = adjLanes.some(
        (l) => isValidCell(state.board_profile, l.laneId, 'front', slot) && !isCellOccupied(state, target.controller_id, l.laneId, 'front', slot),
      );
      if (!hasLegalDest) {
        return { ok: false, reason: '目标敌方前位干员在相邻路线同位置没有合法空位。' };
      }
      return { ok: true };
    }
    case 'DEMO-TAC-V2-020': {
      if (!target || !isFacilityInstance(state, target) || target.controller_id === actorId) {
        return { ok: false, reason: '设施破坏必须指定一名敌方在场设施。' };
      }
      return { ok: true };
    }
    case 'DEMO-TAC-V2-024': {
      if (!target || !isOperatorInstance(state, target) || target.controller_id !== actorId || defOf(state, target)?.attack_type !== 'ranged') {
        return { ok: false, reason: '越线校准必须指定一名己方远程在场干员。' };
      }
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}
