import {
  compareBoardEntities,
  getInstancePositionKey,
  getSameAndAdjacentLaneIds,
  normalizeLaneId,
  resolveLaneProfile,
  sortedLanes,
} from './board';
import type {
  AttackProfile,
  CardDefinition,
  CardInstance,
  CardInstanceId,
  EntityKind,
  GameState,
  LaneId,
  PlayerId,
  RouteScope,
  TargetPriority,
} from './types';

export function hasStatus(instance: CardInstance | undefined, kind: string): boolean {
  if (!instance?.operator_combat) return false;
  const normalized = normalizeStatusKind(kind);
  return instance.operator_combat.statuses.some((s) => s.kind === normalized);
}

export function normalizeStatusKind(kind: string): CardInstance['operator_combat'] extends { statuses: readonly (infer S)[] }
  ? S extends { kind: infer K }
    ? K
    : string
  : string {
  switch (kind) {
    case 'suppression':
    case 'suppressed':
      return 'suppressed';
    case 'cold':
    case 'chilled':
      return 'chilled';
    case 'frozen':
    case 'freeze':
      return 'freeze';
    case 'stunned':
    case 'stun':
      return 'stun';
    case 'silenced':
    case 'silence':
      return 'silence';
    default:
      return kind as never;
  }
}

export function getEntityKind(state: GameState, instance: CardInstance): EntityKind {
  if (instance.entity_kind) return instance.entity_kind;
  const def = state.card_definitions[instance.card_id];
  if (def?.card_type === 'facility' || def?.support_subtype === 'facility') return 'facility';
  if (instance.summon_state) return 'summon';
  return 'operator';
}

export function isFacilityDisabled(state: GameState, instance: CardInstance): boolean {
  if (getEntityKind(state, instance) !== 'facility') return false;
  const until = instance.facility_state?.disabled_until_owner_turn;
  if (until === null || until === undefined) return false;
  const controllerTurn = state.players[instance.controller_id]?.own_turn_index ?? state.players[instance.controller_id]?.turns_taken ?? 0;
  return controllerTurn <= until;
}

export function isFrozen(instance: CardInstance): boolean {
  return hasStatus(instance, 'freeze');
}

export function isStunned(instance: CardInstance): boolean {
  return hasStatus(instance, 'stun');
}

export function isSilenced(instance: CardInstance): boolean {
  return hasStatus(instance, 'silence');
}

export function canTriggerOwnEffects(state: GameState, instance: CardInstance): boolean {
  if (instance.zone !== 'board') return false;
  const kind = getEntityKind(state, instance);
  if (kind === 'facility') {
    return !isFacilityDisabled(state, instance);
  }
  return !isFrozen(instance) && !isStunned(instance) && !isSilenced(instance);
}

export function isNativeFloating(state: GameState, instance: CardInstance): boolean {
  return state.card_definitions[instance.card_id]?.floating === true;
}

export function isGrounded(state: GameState, instance: CardInstance): boolean {
  if (hasStatus(instance, 'grounded')) return true;
  return !isNativeFloating(state, instance) || isFrozen(instance) || isStunned(instance);
}

/**
 * 判定单位是否具备拦截资格（阻止越位/阻挡敌方直接攻击己方基地）。
 * V1.1：
 * - 冻结：不拦截
 * - 眩晕 / 沉默 / 压制：保留拦截资格
 * - 设施：不具备固有拦截资格（但 FAC-02 明确其作为正常占格实体按位置参与普通攻击目标优先级）
 * - 伏击客（Ethan/Manticore）& 夜莺鸟笼：intercept_eligible=false，不拦截基地攻击
 */
export function isInterceptEligible(state: GameState, instance: CardInstance): boolean {
  if (instance.zone !== 'board' || !instance.operator_combat) return false;
  const kind = getEntityKind(state, instance);
  if (kind === 'facility') return false;
  if (isFrozen(instance)) return false;
  if (kind === 'summon') {
    if (instance.summon_state?.token_id === 'nightingale_birdcage') return false;
    return true;
  }
  const def = state.card_definitions[instance.card_id];
  if (def?.attack_profile?.intercept_eligible === false || def?.intercept_eligible === false) {
    return false;
  }
  return true;
}

export interface ComputedEntityStats {
  readonly atk: number;
  readonly maxHp: number;
  readonly currentHp: number;
  readonly shield: number;
}

export function getContinuousTraitAtkBonus(state: GameState, instance: CardInstance): number {
  const def = state.card_definitions[instance.card_id];
  if (!def || !canTriggerOwnEffects(state, instance)) return 0;
  let bonus = 0;
  const blocks = def.skill_effects ?? def.effect_json?.v1_1_blocks ?? [];
  for (const block of blocks) {
    if (block.trigger !== 'continuous') continue;
    for (const op of block.effects) {
      if (op.op === 'conditional_attack_modifier' && op.condition === 'other_friendly_vanguard_count') {
        const amountPerUnit = Number(op.amount_per_unit ?? 1);
        const cap = Number(op.cap ?? 2);
        const otherVanguards = Object.values(state.card_instances).filter(
          (u) =>
            u.zone === 'board' &&
            u.controller_id === instance.controller_id &&
            u.card_instance_id !== instance.card_instance_id &&
            state.card_definitions[u.card_id]?.class === 'vanguard',
        ).length;
        bonus += Math.min(cap, otherVanguards * amountPerUnit);
      }
    }
  }
  return bonus;
}

export function getEntityMaxHp(state: GameState, instance: CardInstance): number {
  const def = state.card_definitions[instance.card_id];
  const baseHp = getEntityKind(state, instance) === 'facility'
    ? (def?.hp ?? 3)
    : getEntityKind(state, instance) === 'summon'
      ? (instance.summon_state?.max_hp ?? 2)
      : (def?.hp ?? 1);
  const combat = instance.operator_combat;
  let bonus = combat?.max_hp_bonus ?? 0;
  let minFloor = 1;
  if (combat?.equipped_package) {
    for (const mod of combat.equipped_package.modifiers) {
      if (mod.stat === 'max_hp') {
        bonus += mod.amount ?? 0;
        if (typeof mod.minimum === 'number') {
          minFloor = Math.max(minFloor, mod.minimum);
        }
      }
    }
  }
  return Math.max(minFloor, baseHp + bonus);
}

export function getEntityStats(state: GameState, instance: CardInstance): ComputedEntityStats {
  const combat = instance.operator_combat;
  const def = state.card_definitions[instance.card_id];
  const kind = getEntityKind(state, instance);
  if (kind === 'facility') {
    return {
      atk: 0,
      maxHp: getEntityMaxHp(state, instance),
      currentHp: combat?.current_hp ?? 0,
      shield: combat?.shield ?? 0,
    };
  }
  const baseAtk = kind === 'summon' ? (instance.summon_state?.atk ?? 0) : (def?.atk ?? 0);
  const modSum = (combat?.current_atk_modifiers ?? []).reduce((acc, v) => acc + v, 0);
  const permBonus = combat?.permanent_atk_bonus ?? 0;
  const equipBonus = (combat?.equipped_package?.modifiers ?? [])
    .filter((m) => m.stat === 'attack')
    .reduce((acc, m) => acc + (m.amount ?? 0), 0);
  const tempStatBonus = (combat?.temp_modifiers ?? [])
    .filter((m) => m.kind === 'stat' && m.stat === 'attack')
    .reduce((acc, m) => acc + (m.amount ?? 0), 0);
  const continuousBonus = getContinuousTraitAtkBonus(state, instance);

  return {
    atk: Math.max(0, baseAtk + modSum + permBonus + equipBonus + tempStatBonus + continuousBonus),
    maxHp: getEntityMaxHp(state, instance),
    currentHp: combat?.current_hp ?? 0,
    shield: combat?.shield ?? 0,
  };
}

export function canEntityPerformBasicAttack(state: GameState, instance: CardInstance): boolean {
  if (instance.zone !== 'board' || !instance.operator_combat) return false;
  const kind = getEntityKind(state, instance);
  if (kind === 'facility') return false;
  if (isFrozen(instance) || isStunned(instance)) return false;
  if (kind === 'summon') {
    const summonAtk = getEntityStats(state, instance).atk;
    if (summonAtk <= 0) return false;
    if (instance.operator_combat.consumed_normal_attack_this_turn) return false;
    if (instance.operator_lifecycle?.entered_battle_this_owner_turn && !instance.operator_combat.granted_immediate_attack_this_turn) {
      return false;
    }
    return true;
  }
  if (instance.operator_combat.consumed_normal_attack_this_turn) return false;
  if (instance.operator_lifecycle?.entered_battle_this_owner_turn && !instance.operator_combat.granted_immediate_attack_this_turn) {
    return false;
  }
  const profile = getEffectiveAttackProfile(state, instance);
  // 医疗干员在 combat_attack_step 执行治疗而非伤害攻击，仍属于普通行动队列
  return Boolean(profile);
}

export function normalizeRouteScope(raw: string | undefined): RouteScope {
  switch (raw) {
    case 'same_and_adjacent_lane':
    case 'same_and_adjacent_lanes':
    case 'same_and_directly_adjacent_lanes':
      return 'same_and_adjacent_lane';
    case 'all_lanes':
      return 'all_lanes';
    case 'explicit_lanes':
      return 'explicit_lanes';
    case 'explicit_cells':
      return 'explicit_cells';
    default:
      return 'same_lane';
  }
}

export function normalizeTargetPriority(raw: string | undefined): TargetPriority {
  switch (raw) {
    case 'back_first':
      return 'back_first';
    case 'lowest_hp':
    case 'lowest_current_hp':
      return 'lowest_hp';
    case 'lowest_hp_ratio':
      return 'lowest_hp_ratio';
    case 'highest_hp':
      return 'highest_hp';
    case 'shield_first':
      return 'shield_first';
    default:
      return 'front_first';
  }
}

export function getEffectiveAttackProfile(state: GameState, instance: CardInstance): AttackProfile | null {
  const kind = getEntityKind(state, instance);
  if (kind === 'facility') return null;
  if (kind === 'summon') {
    const s = instance.summon_state;
    if (!s) return null;
    let profile: AttackProfile = {
      mode: s.attack_type === 'ranged' ? 'ranged' : 'melee',
      damage_type: s.damage_type ?? 'physical',
      route_scope: 'same_lane',
      target_priority: 'front_first',
      pattern: 'single',
      target_limit: 1,
      deploy_rule: 'any_empty',
      intercept_eligible: isInterceptEligible(state, instance),
    };
    const equipScope = instance.operator_combat?.equipped_package?.modifiers.find((m) => m.stat === 'ordinary_attack_route_scope');
    if (equipScope?.value) {
      profile = { ...profile, route_scope: normalizeRouteScope(equipScope.value) };
    }
    return profile;
  }

  const def = state.card_definitions[instance.card_id];
  if (!def) return null;
  const baseProfile: AttackProfile = def.attack_profile ?? {
    mode: def.attack_mode ?? (def.class === 'medic' ? 'support' : def.attack_type ?? 'melee'),
    damage_type: def.damage_type ?? (def.class === 'medic' ? 'none' : def.class === 'caster' || def.class === 'supporter' ? 'arts' : 'physical'),
    route_scope: 'same_lane',
    target_priority: 'front_first',
    pattern: 'single',
    target_limit: 1,
    deploy_rule: def.deploy_rule ?? 'front_only',
    intercept_eligible: def.intercept_eligible ?? true,
  };

  let effective: AttackProfile = {
    ...baseProfile,
    route_scope: normalizeRouteScope(String(baseProfile.route_scope)),
    target_priority: normalizeTargetPriority(String(baseProfile.target_priority)),
  };

  const equipScope = instance.operator_combat?.equipped_package?.modifiers.find((m) => m.stat === 'ordinary_attack_route_scope');
  if (equipScope?.value) {
    effective = { ...effective, route_scope: normalizeRouteScope(equipScope.value) };
  }

  for (const mod of instance.operator_combat?.temp_modifiers ?? []) {
    if (mod.kind !== 'attack_profile') continue;
    effective = {
      ...effective,
      ...(mod.route_scope ? { route_scope: normalizeRouteScope(String(mod.route_scope)) } : {}),
      ...(mod.target_priority ? { target_priority: normalizeTargetPriority(String(mod.target_priority)) } : {}),
      ...(mod.pattern ? { pattern: mod.pattern } : {}),
      ...(mod.target_limit !== undefined ? { target_limit: mod.target_limit } : {}),
      ...(mod.secondary_damage !== undefined ? { secondary_damage: mod.secondary_damage } : {}),
      ...(mod.ignore_front_interception !== undefined ? { can_target_back: mod.ignore_front_interception } : {}),
    };
  }

  return effective;
}

export function getEligibleLanes(state: GameState, originLane: LaneId | null, routeScope: RouteScope | string): readonly LaneId[] {
  if (!originLane) return [];
  const board = state.board_profile;
  const scope = normalizeRouteScope(String(routeScope));
  if (scope === 'all_lanes') {
    return sortedLanes(board).map((l) => l.laneId);
  }
  if (scope === 'same_and_adjacent_lane') {
    return getSameAndAdjacentLaneIds(board, originLane);
  }
  const canonical = normalizeLaneId(board, originLane);
  return resolveLaneProfile(board, canonical) ? [canonical] : [];
}

export function hasTauntForAttacker(state: GameState, attacker: CardInstance, candidate: CardInstance): boolean {
  if (candidate.zone !== 'board' || isFrozen(candidate)) return false;
  const scope = candidate.summon_state?.taunt_scope ?? state.card_definitions[candidate.card_id]?.taunt_scope ?? 'none';
  if (scope === 'all_lanes') return true;
  if (scope === 'same_lane' || hasStatus(candidate, 'taunt')) {
    return candidate.lane !== null && attacker.lane !== null &&
      normalizeLaneId(state.board_profile, candidate.lane) === normalizeLaneId(state.board_profile, attacker.lane);
  }
  return false;
}

function compareByTargetPriority(
  state: GameState,
  attacker: CardInstance,
  priority: TargetPriority,
  a: CardInstance,
  b: CardInstance,
): number {
  const statsA = getEntityStats(state, a);
  const statsB = getEntityStats(state, b);
  const ratioA = statsA.maxHp > 0 ? statsA.currentHp / statsA.maxHp : 1;
  const ratioB = statsB.maxHp > 0 ? statsB.currentHp / statsB.maxHp : 1;

  switch (priority) {
    case 'back_first': {
      const ra = a.position === 'back' ? 0 : 1;
      const rb = b.position === 'back' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      break;
    }
    case 'lowest_hp': {
      if (statsA.currentHp !== statsB.currentHp) return statsA.currentHp - statsB.currentHp;
      break;
    }
    case 'lowest_hp_ratio': {
      if (Math.abs(ratioA - ratioB) > 1e-6) return ratioA - ratioB;
      break;
    }
    case 'highest_hp': {
      if (statsA.currentHp !== statsB.currentHp) return statsB.currentHp - statsA.currentHp;
      break;
    }
    case 'shield_first': {
      const sa = statsA.shield > 0 ? 0 : 1;
      const sb = statsB.shield > 0 ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (statsA.shield !== statsB.shield) return statsB.shield - statsA.shield;
      break;
    }
    case 'front_first':
    default: {
      // 同排按位置排序；设施与干员均按 (laneOrder, rowOrder, slotIndex) 参与，不再排斥设施
      const ra = a.position === 'front' ? 0 : 1;
      const rb = b.position === 'front' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      break;
    }
  }

  // 若是同一攻击者主路优先于相邻路线（当启用跨路瞄准器等时，优先本路同优先级还是全局位置序？Spec §3.2: 按 (laneOrder, rowOrder, slotIndex) 升序）
  void attacker;
  return compareBoardEntities(state.board_profile, a, b);
}

export function getBoardEntitiesForPlayer(state: GameState, controllerId: PlayerId): readonly CardInstance[] {
  return Object.values(state.card_instances)
    .filter((i) => i.zone === 'board' && i.controller_id === controllerId)
    .sort((a, b) => compareBoardEntities(state.board_profile, a, b));
}

export function canEntityBlockBaseAttack(state: GameState, instance: CardInstance): boolean {
  if (instance.zone !== 'board' || !instance.operator_combat) return false;
  const kind = getEntityKind(state, instance);
  // FAC-02 & §7.3: 设施位于格位上，处于目标优先位置时成为攻击目标（包括阻止空路直击）；
  // 冻结单位、伏击客(伊桑/狮蝎)、夜莺鸟笼不拦截基地攻击
  if (kind === 'facility') return true;
  return isInterceptEligible(state, instance);
}

/**
 * 解析普通攻击主目标（以及多目标/贯穿等目标列表）。
 * 严格遵循 V1.1 优先级：
 * 1. 合法范围内的嘲讽目标
 * 2. 合法范围内的玩家本回合集火目标指令
 * 3. 干员自身索敌规则（front_first / back_first / lowest_hp / lowest_hp_ratio / highest_hp / shield_first）
 * 4. 最终并列按 (laneOrder, rowOrder, slotIndex, entityId) 升序
 */
export function selectOrdinaryAttackTargets(state: GameState, attacker: CardInstance): readonly CardInstance[] {
  const profile = getEffectiveAttackProfile(state, attacker);
  if (!profile || profile.mode === 'support' || !attacker.lane) return [];

  const eligibleLanes = new Set(getEligibleLanes(state, attacker.lane, profile.route_scope));
  const enemyEntities = Object.values(state.card_instances).filter((i) => {
    if (i.zone !== 'board' || i.controller_id === attacker.controller_id || !i.lane || !i.operator_combat) {
      return false;
    }
    const inScope = eligibleLanes.has(normalizeLaneId(state.board_profile, i.lane));
    const tauntScope = i.summon_state?.taunt_scope ?? state.card_definitions[i.card_id]?.taunt_scope ?? 'none';
    const hasGlobalTaunt = tauntScope === 'all_lanes' && !isFrozen(i);
    if (!inScope && !hasGlobalTaunt) return false;
    return !isNativeFloating(state, i) || isGrounded(state, i) || profile.mode === 'ranged';
  });

  if (enemyEntities.length === 0) return [];

  const focusId = state.players[attacker.controller_id]?.focus_target_id ?? null;
  const focusedInScope = focusId ? enemyEntities.some((e) => e.card_instance_id === focusId) : false;

  // 若攻击范围内完全没有任何能拦截基地/承担前排阻挡的实体（如场上仅有孤立的被冻结单位、或仅有孤立的伊桑/狮蝎/鸟笼，不含设施），
  // 且我方未对其中单位下达集火指令 -> 不拦截基地攻击（返回空数组使主攻击直击基地）
  const hasAnyBaseBlocker = enemyEntities.some((e) => canEntityBlockBaseAttack(state, e));
  if (!hasAnyBaseBlocker && !focusedInScope) {
    return [];
  }

  const priority = normalizeTargetPriority(String(profile.target_priority));
  // 嘲讽（含鸟笼）、设施（FAC-02）与多目标/贯穿始终参与候选；
  // 伏击客（伊桑/狮蝎）不拦截但可被集火或多目标攻击命中；非集火指令下，被攻击优先级等同基地（低于一切可拦截/占位阻挡目标）
  const selectableEntities = enemyEntities.filter((e) => {
    const kind = getEntityKind(state, e);
    if (kind === 'facility') return true;
    if (hasTauntForAttacker(state, attacker, e)) return true;
    if (focusId && e.card_instance_id === focusId) return true;
    if (profile.pattern === 'multi_target' || profile.pattern === 'line') return true;
    return isInterceptEligible(state, e);
  });

  const pool = selectableEntities.length > 0 ? selectableEntities : enemyEntities;

  const sortedPool = [...pool].sort((a, b) => {
    const aTaunt = hasTauntForAttacker(state, attacker, a) ? 0 : 1;
    const bTaunt = hasTauntForAttacker(state, attacker, b) ? 0 : 1;
    if (aTaunt !== bTaunt) return aTaunt - bTaunt;

    const aFocus = focusId && a.card_instance_id === focusId ? 0 : 1;
    const bFocus = focusId && b.card_instance_id === focusId ? 0 : 1;
    if (aFocus !== bFocus) return aFocus - bFocus;

    // 非集火状态下，具有拦截资格/占格阻挡的实体（含设施）始终优先于不拦截的伏击客/冻结单位
    const aBlocks = canEntityBlockBaseAttack(state, a) ? 0 : 1;
    const bBlocks = canEntityBlockBaseAttack(state, b) ? 0 : 1;
    if (aBlocks !== bBlocks) return aBlocks - bBlocks;

    return compareByTargetPriority(state, attacker, priority, a, b);
  });

  if (profile.pattern === 'line') {
    // 贯穿：按棋盘位置顺序攻击同路合法目标
    return [...pool].sort((a, b) => compareBoardEntities(state.board_profile, a, b));
  }

  if (profile.pattern === 'multi_target') {
    const rawLimit = profile.target_limit === 'all' ? pool.length : Number(profile.target_limit ?? 2);
    const globalCap = state.open_decision_config?.aoeTargetLimit;
    const limit = typeof globalCap === 'number' ? Math.min(rawLimit, globalCap) : rawLimit;
    return sortedPool.slice(0, Math.max(1, limit));
  }

  return sortedPool.length > 0 ? [sortedPool[0]] : [];
}

export function selectHighestAttackEnemy(state: GameState, controllerId: PlayerId): CardInstance | undefined {
  const enemies = Object.values(state.card_instances).filter(
    (i) => i.zone === 'board' && i.controller_id !== controllerId && getEntityKind(state, i) === 'operator' && i.operator_combat,
  );
  if (enemies.length === 0) return undefined;
  return [...enemies].sort((a, b) => {
    const atkDiff = getEntityStats(state, b).atk - getEntityStats(state, a).atk;
    if (atkDiff !== 0) return atkDiff;
    return compareBoardEntities(state.board_profile, a, b);
  })[0];
}

export function getFirstEmptyCellInLane(
  state: GameState,
  playerId: PlayerId,
  laneId: LaneId,
  preferredRow?: 'front' | 'back',
  excludeInstanceId?: CardInstanceId,
): { readonly lane: LaneId; readonly position: 'front' | 'back'; readonly slot_index: number } | null {
  const lane = resolveLaneProfile(state.board_profile, laneId);
  if (!lane) return null;
  const rows: readonly ('front' | 'back')[] = preferredRow === 'back' ? ['back', 'front'] : ['front', 'back'];
  for (const row of rows) {
    const count = row === 'front' ? lane.frontSlots : lane.rearSlots;
    for (let slot = 1; slot <= count; slot += 1) {
      const occupied = Object.values(state.card_instances).some(
        (u) =>
          u.zone === 'board' &&
          u.card_instance_id !== excludeInstanceId &&
          u.controller_id === playerId &&
          u.board_half === playerId &&
          u.lane === lane.laneId &&
          u.position === row &&
          (u.slot_index ?? 1) === slot,
      );
      if (!occupied) {
        return { lane: lane.laneId, position: row, slot_index: slot };
      }
    }
  }
  return null;
}

export function isCellOccupied(
  state: GameState,
  playerId: PlayerId,
  laneId: LaneId,
  position: 'front' | 'back',
  slotIndex = 1,
  excludeInstanceId?: CardInstanceId,
): boolean {
  const canonicalLane = normalizeLaneId(state.board_profile, laneId);
  return Object.values(state.card_instances).some(
    (instance) =>
      instance.zone === 'board' &&
      instance.card_instance_id !== excludeInstanceId &&
      instance.controller_id === playerId &&
      instance.board_half === playerId &&
      normalizeLaneId(state.board_profile, instance.lane ?? '') === canonicalLane &&
      instance.position === position &&
      (instance.slot_index ?? 1) === slotIndex,
  );
}

export function findEntityAtCell(
  state: GameState,
  playerId: PlayerId,
  laneId: LaneId,
  position: 'front' | 'back',
  slotIndex = 1,
): CardInstance | undefined {
  const canonicalLane = normalizeLaneId(state.board_profile, laneId);
  return Object.values(state.card_instances).find(
    (instance) =>
      instance.zone === 'board' &&
      instance.controller_id === playerId &&
      instance.board_half === playerId &&
      normalizeLaneId(state.board_profile, instance.lane ?? '') === canonicalLane &&
      instance.position === position &&
      (instance.slot_index ?? 1) === slotIndex,
  );
}

export function getInstancePosDesc(state: GameState, instance: CardInstance | undefined): string {
  if (!instance?.lane || !instance.position) return '';
  const k = getInstancePositionKey(state.board_profile, instance);
  return `${k.laneOrder >= 0 ? normalizeLaneId(state.board_profile, instance.lane) : instance.lane}·${instance.position === 'front' ? 'F' : 'R'}${instance.slot_index ?? 1}`;
}
