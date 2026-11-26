import { formatCellLabel } from './board';
import {
  getEntityKind,
  getEntityMaxHp,
  getEntityStats,
  hasStatus,
  isNativeFloating,
  normalizeStatusKind,
} from './range';
import type {
  BasePoints,
  CardDefinition,
  CardInstance,
  CardInstanceId,
  CombatLogEvent,
  Cost,
  EquipmentPackageState,
  ExpireAtNode,
  GameState,
  HpValue,
  PlayerId,
  SpValue,
  StatusEffect,
  StatusKind,
} from './types';

export const HAND_LIMIT = 10;

export interface DrawResult {
  readonly state: GameState;
  readonly drawn: readonly CardInstanceId[];
  readonly discardedAtHandLimit: readonly CardInstanceId[];
  readonly fatigueDamage: number;
}

export function evaluateWinner(state: GameState): GameState {
  const aLost = state.players.player_a.base_points <= 0;
  const bLost = state.players.player_b.base_points <= 0;
  if (!aLost && !bLost) return state;
  const winner: GameState['winner'] = aLost && bLost ? 'draw' : aLost ? 'player_b' : 'player_a';
  return { ...state, phase: 'finished', winner, state_version: state.state_version + 1 };
}

export function drawCards(state: GameState, playerId: PlayerId, count: number): DrawResult {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('抽牌数量必须是非负整数。');
  const initialPlayer = state.players[playerId];
  if (!initialPlayer) throw new Error(`找不到玩家 ${playerId}。`);
  let player = initialPlayer;
  let nextState = state;
  const drawn: CardInstanceId[] = [];
  const discardedAtHandLimit: CardInstanceId[] = [];
  let fatigueDamage = 0;
  const instanceUpdates: Record<CardInstanceId, CardInstance> = {};

  for (let drawIndex = 0; drawIndex < count; drawIndex += 1) {
    if (player.deck.length === 0) {
      const nextFatigue = player.fatigue_count + 1;
      fatigueDamage += nextFatigue;
      player = {
        ...player,
        base_points: (player.base_points - nextFatigue) as BasePoints,
        fatigue_count: nextFatigue,
      };
      continue;
    }

    const [cardInstanceId, ...remainingDeck] = player.deck;
    if (player.hand.length >= HAND_LIMIT) {
      player = { ...player, deck: remainingDeck, discard: [...player.discard, cardInstanceId] };
      discardedAtHandLimit.push(cardInstanceId);
      const instance = state.card_instances[cardInstanceId];
      if (instance) instanceUpdates[cardInstanceId] = { ...instance, zone: 'discard' };
    } else {
      player = { ...player, deck: remainingDeck, hand: [...player.hand, cardInstanceId] };
      drawn.push(cardInstanceId);
      const instance = state.card_instances[cardInstanceId];
      if (instance) instanceUpdates[cardInstanceId] = { ...instance, zone: 'hand' };
    }
  }

  nextState = updatePlayer(nextState, playerId, () => player);
  if (Object.keys(instanceUpdates).length > 0) {
    nextState = {
      ...nextState,
      card_instances: { ...nextState.card_instances, ...instanceUpdates },
    };
  }
  nextState = evaluateWinner(nextState);
  return { state: nextState, drawn, discardedAtHandLimit, fatigueDamage };
}

export function addCombatLog(state: GameState, event: Omit<CombatLogEvent, 'sequence'>): GameState {
  return {
    ...state,
    combat_log: [...state.combat_log, { ...event, sequence: state.combat_log.length }],
  };
}

export function defOf(state: GameState, instance: CardInstance | undefined): CardDefinition | undefined {
  return instance ? state.card_definitions[instance.card_id] : undefined;
}

export function updateInstance(
  state: GameState,
  id: CardInstanceId,
  update: (i: CardInstance) => CardInstance,
): GameState {
  const inst = state.card_instances[id];
  if (!inst) return state;
  return {
    ...state,
    card_instances: {
      ...state.card_instances,
      [id]: update(inst),
    },
  };
}

export function updatePlayer(
  state: GameState,
  playerId: PlayerId,
  update: (p: GameState['players'][PlayerId]) => GameState['players'][PlayerId],
): GameState {
  const player = state.players[playerId];
  if (!player) return state;
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: update(player),
    },
  };
}

export function entityName(state: GameState, instance: CardInstance | undefined): string {
  if (!instance) return '未知实体';
  if (instance.summon_state) {
    switch (instance.summon_state.token_id) {
      case 'meebo':
        return '机械水獭';
      case 'phantom_shadow':
        return '傀影虚影';
      case 'nightingale_birdcage':
        return '夜莺鸟笼';
      case 'silence_med_drone':
        return '医疗无人机';
      case 'magallan_strike_drone':
        return '打击无人机';
      case 'magallan_support_drone':
        return '支援无人机';
      default:
        return instance.summon_state.token_id;
    }
  }
  return defOf(state, instance)?.card_name_zh ?? instance.card_id;
}

export function playerLabel(playerId: PlayerId | undefined): string {
  return playerId === 'player_a' ? '玩家 A' : playerId === 'player_b' ? '玩家 B' : '';
}

export function getTurnCpCap(state: GameState, playerId: PlayerId): number {
  const player = state.players[playerId];
  if (!player) return 10;
  return Math.max(0, Math.min(10, player.turn_cp_cap || 10));
}

export function grantCpWithCap(
  state: GameState,
  playerId: PlayerId,
  amount: number,
  sourceName: string,
  sourceId?: CardInstanceId,
): GameState {
  if (amount <= 0) return state;
  const player = state.players[playerId];
  if (!player) return state;
  const cap = getTurnCpCap(state, playerId);
  const after = Math.min(cap, player.cost + amount);
  const gained = Math.max(0, after - player.cost);
  let next = updatePlayer(state, playerId, (p) => ({ ...p, cost: after as Cost }));
  next = addCombatLog(next, {
    type: 'cp_updated',
    source_instance_id: sourceId,
    source_player_id: playerId,
    target_player_id: playerId,
    source_name: sourceName,
    amount: gained,
    action_type: 'cp_recovery',
    detail: `${playerLabel(playerId)}【${sourceName}】恢复费用（当前回合上限 ${cap} CP），实际获得 ${gained} CP（${player.cost} → ${after}）。`,
  });
  return next;
}

export function gainSp(
  state: GameState,
  id: CardInstanceId,
  amount: number,
  reason: string,
  shouldLog = true,
): GameState {
  const i = state.card_instances[id];
  if (!i?.operator_combat || hasStatus(i, 'freeze') || amount <= 0) return state;
  const d = defOf(state, i);
  const before = i.operator_combat.current_sp;
  const after = Math.min(d?.max_sp ?? 5, before + amount);
  const gained = after - before;
  if (!gained) return state;
  const next = updateInstance(state, id, (x) => ({
    ...x,
    operator_combat: { ...x.operator_combat!, current_sp: after as SpValue },
  }));
  if (!shouldLog || reason.includes('自然回复')) return next;
  return addCombatLog(next, {
    type: 'sp_gained',
    source_instance_id: id,
    target_instance_id: id,
    source_player_id: i.controller_id,
    target_player_id: i.controller_id,
    source_name: entityName(next, i),
    target_name: entityName(next, i),
    amount: gained,
    detail: `${reason}：${playerLabel(i.controller_id)}【${entityName(next, i)}】获得 ${gained} SP。`,
  });
}

export function grantShieldToEntity(
  state: GameState,
  targetId: CardInstanceId,
  amount: number,
  sourceName?: string,
  sourceId?: CardInstanceId,
): GameState {
  const target = state.card_instances[targetId];
  if (!target?.operator_combat || target.zone !== 'board' || amount <= 0) return state;
  if (getEntityKind(state, target) === 'facility') return state;
  const shieldCap = state.open_decision_config?.shieldCap;
  const before = target.operator_combat.shield;
  const rawAfter = before + amount;
  const after = typeof shieldCap === 'number' ? Math.min(shieldCap, rawAfter) : rawAfter;
  const gained = Math.max(0, after - before);
  let next = updateInstance(state, targetId, (i) => ({
    ...i,
    operator_combat: { ...i.operator_combat!, shield: after },
  }));
  if (sourceName) {
    next = addCombatLog(next, {
      type: 'effect_triggered',
      source_instance_id: sourceId,
      target_instance_id: targetId,
      source_player_id: sourceId ? next.card_instances[sourceId]?.controller_id : target.controller_id,
      target_player_id: target.controller_id,
      source_name: sourceName,
      target_name: entityName(next, target),
      amount: gained,
      action_type: 'shield',
      detail: `${playerLabel(target.controller_id)}【${entityName(next, target)}】获得 ${gained} 点护盾（来自 ${sourceName}）。`,
    });
  }
  return next;
}

export function removeShieldFromEntity(state: GameState, targetId: CardInstanceId, amount: number | 'all'): GameState {
  const target = state.card_instances[targetId];
  if (!target?.operator_combat || target.zone !== 'board') return state;
  const current = target.operator_combat.shield;
  if (current <= 0) return state;
  const removed = amount === 'all' ? current : Math.min(current, Math.max(0, amount));
  let next = updateInstance(state, targetId, (i) => ({
    ...i,
    operator_combat: { ...i.operator_combat!, shield: Math.max(0, current - removed) },
  }));
  next = addCombatLog(next, {
    type: 'effect_triggered',
    target_instance_id: targetId,
    target_player_id: target.controller_id,
    target_name: entityName(next, target),
    amount: removed,
    action_type: 'shield_break',
    detail: `${playerLabel(target.controller_id)}【${entityName(next, target)}】失去了 ${removed} 点护盾。`,
  });
  return next;
}

export function healEntity(
  state: GameState,
  targetId: CardInstanceId,
  amount: number,
  options: {
    readonly sourceId?: CardInstanceId;
    readonly sourceName?: string;
    readonly isFriendlyHealEffect?: boolean;
    readonly allowSelfHealOverride?: boolean;
  } = {},
): { readonly state: GameState; readonly actualHeal: number } {
  const target = state.card_instances[targetId];
  if (!target?.operator_combat || target.zone !== 'board' || amount <= 0) {
    return { state, actualHeal: 0 };
  }
  const targetDef = defOf(state, target);
  // 禁疗检查（例如 宴 OP-GUA-004 固有特性 exclude_from_friendly_heal_targets，仅限自身恢复不受限）
  const hasCannotBeHealedTrait = targetDef?.native_traits?.some(
    (t) => t.effect?.op === 'exclude_from_friendly_heal_targets',
  );
  if (hasCannotBeHealedTrait && !options.allowSelfHealOverride && options.sourceId !== targetId) {
    return { state, actualHeal: 0 };
  }
  // 设施不受治疗影响
  if (getEntityKind(state, target) === 'facility') {
    return { state, actualHeal: 0 };
  }

  const maxHp = getEntityMaxHp(state, target);
  const currentHp = target.operator_combat.current_hp;
  const actualHeal = Math.max(0, Math.min(amount, maxHp - currentHp));
  if (actualHeal <= 0) {
    return { state, actualHeal: 0 };
  }

  let next = updateInstance(state, targetId, (i) => ({
    ...i,
    operator_combat: {
      ...i.operator_combat!,
      current_hp: (i.operator_combat!.current_hp + actualHeal) as HpValue,
    },
  }));
  const srcInst = options.sourceId ? next.card_instances[options.sourceId] : undefined;
  next = addCombatLog(next, {
    type: 'healed',
    source_instance_id: options.sourceId,
    target_instance_id: targetId,
    source_player_id: srcInst?.controller_id,
    target_player_id: target.controller_id,
    source_name: options.sourceName ?? (srcInst ? entityName(next, srcInst) : undefined),
    target_name: entityName(next, target),
    amount: actualHeal,
    action_type: 'heal',
    detail: `${options.sourceName ? `【${options.sourceName}】` : ''}为 ${playerLabel(target.controller_id)}【${entityName(next, target)}】恢复 ${actualHeal} 点 HP（${currentHp} → ${currentHp + actualHeal}）。`,
  });
  return { state: next, actualHeal };
}

export function applyStatusToInstance(
  state: GameState,
  targetId: CardInstanceId,
  rawKind: string,
  duration = 1,
  options: {
    readonly sourceInstanceId?: CardInstanceId;
    readonly expireAtNode?: ExpireAtNode;
    readonly stacks?: number;
    readonly bonusDamage?: number;
  } = {},
): GameState {
  const target = state.card_instances[targetId];
  if (!target?.operator_combat || target.zone !== 'board') return state;
  const kind = normalizeStatusKind(rawKind) as StatusKind;
  if (getEntityKind(state, target) === 'facility') {
    // 设施不受任何增益与减益状态影响
    return state;
  }
  if (kind === 'grounded' && !isNativeFloating(state, target)) return state;
  if (duration < 1 && kind !== 'cover' && kind !== 'vulnerable' && kind !== 'suppressed') return state;

  const current = target.operator_combat.statuses;
  const targetTurn = state.players[target.owner_id]?.turns_taken ?? 0;
  const seq = state.status_sequence + 1;
  let next: GameState = { ...state, status_sequence: seq };

  // 寒冷 -> 再次受寒冷转冻结，移除寒冷
  if (kind === 'chilled' && current.some((s) => s.kind === 'chilled')) {
    const filtered = current.filter((s) => s.kind !== 'chilled');
    const freezeStatus: StatusEffect = {
      status_id: `freeze_${seq}`,
      kind: 'freeze',
      remaining_owner_turns: 1,
      applied_on_owner_turn_index: targetTurn,
      expire_at_node: 'owner_turn_start',
      status_priority: 90,
      applied_sequence: seq,
      source_instance_id: options.sourceInstanceId,
      blocks_normal_withdrawal: true,
    };
    next = updateInstance(next, targetId, (i) => ({
      ...i,
      operator_combat: { ...i.operator_combat!, statuses: [...filtered, freezeStatus] },
    }));
    return addCombatLog(next, {
      type: 'status_applied',
      source_instance_id: options.sourceInstanceId,
      target_instance_id: targetId,
      target_player_id: target.controller_id,
      target_name: entityName(next, target),
      detail: `${playerLabel(target.controller_id)}【${entityName(next, target)}】再次受到寒冷，转化为【冻结】！`,
    });
  }

  // 中毒可叠加层数
  if (kind === 'poisoned') {
    const addStacks = Math.max(1, options.stacks ?? 1);
    const existing = current.find((s) => s.kind === 'poisoned');
    const updated: StatusEffect = existing
      ? {
          ...existing,
          stacks: (existing.stacks ?? 1) + addStacks,
          applied_on_owner_turn_index: targetTurn,
          remaining_owner_turns: 1,
          expire_at_node: 'owner_turn_start',
        }
      : {
          status_id: `poisoned_${seq}`,
          kind: 'poisoned',
          stacks: addStacks,
          remaining_owner_turns: 1,
          applied_on_owner_turn_index: targetTurn,
          expire_at_node: 'owner_turn_start',
          status_priority: 50,
          applied_sequence: seq,
          source_instance_id: options.sourceInstanceId,
          blocks_normal_withdrawal: false,
        };
    const nextStatuses = [...current.filter((s) => s.kind !== 'poisoned'), updated];
    next = updateInstance(next, targetId, (i) => ({
      ...i,
      operator_combat: { ...i.operator_combat!, statuses: nextStatuses },
    }));
    return addCombatLog(next, {
      type: 'status_applied',
      source_instance_id: options.sourceInstanceId,
      target_instance_id: targetId,
      target_player_id: target.controller_id,
      target_name: entityName(next, target),
      amount: addStacks,
      detail: `${playerLabel(target.controller_id)}【${entityName(next, target)}】获得 ${addStacks} 层【中毒】（共 ${updated.stacks} 层）。`,
    });
  }

  // 默认到期节点映射（V1.1 §5.1–5.3）
  const defaultExpire: ExpireAtNode =
    options.expireAtNode ??
    (kind === 'cover' || kind === 'vulnerable'
      ? 'until_removed'
      : kind === 'suppressed'
        ? 'target_next_basic_attack'
        : 'owner_turn_start');

  // V1.1 STATUS-02/STATUS-05: 控制状态相互独立、并存，不再互相覆盖
  const existing = current.find((s) => s.kind === kind);
  const incoming: StatusEffect = {
    status_id: `${kind}_${seq}`,
    kind,
    remaining_owner_turns: Math.max(1, duration),
    applied_on_owner_turn_index: targetTurn,
    expire_at_node: defaultExpire,
    bonus_damage: options.bonusDamage ?? (kind === 'vulnerable' ? 1 : undefined),
    status_priority: kind === 'freeze' ? 90 : kind === 'stun' ? 80 : 40,
    applied_sequence: seq,
    source_instance_id: options.sourceInstanceId,
    blocks_normal_withdrawal: kind === 'stun' || kind === 'freeze',
  };

  let nextStatuses: StatusEffect[];
  if (existing) {
    // 同类状态不叠加；保留较长持续时间
    const kept =
      existing.remaining_owner_turns > incoming.remaining_owner_turns ? existing : incoming;
    nextStatuses = [...current.filter((s) => s.kind !== kind), kept];
  } else {
    nextStatuses = [...current, incoming];
  }

  next = updateInstance(next, targetId, (i) => ({
    ...i,
    operator_combat: { ...i.operator_combat!, statuses: nextStatuses },
  }));

  const statusZhMap: Readonly<Record<string, string>> = {
    stun: '眩晕',
    freeze: '冻结',
    grounded: '落地',
    slow: '减速',
    taunt: '嘲讽',
    silence: '沉默',
    suppressed: '压制',
    chilled: '寒冷',
    vulnerable: '脆弱',
    cover: '掩护',
    poisoned: '中毒',
  };
  return addCombatLog(next, {
    type: 'status_applied',
    source_instance_id: options.sourceInstanceId,
    target_instance_id: targetId,
    target_player_id: target.controller_id,
    target_name: entityName(next, target),
    detail: `${playerLabel(target.controller_id)}【${entityName(next, target)}】获得了【${statusZhMap[kind] ?? kind}】状态。`,
  });
}

export function removeStatusFromInstance(
  state: GameState,
  targetId: CardInstanceId,
  rawKind: string,
  reason: 'dispelled' | 'consumed' | 'expired' = 'dispelled',
): GameState {
  const target = state.card_instances[targetId];
  if (!target?.operator_combat) return state;
  const kind = normalizeStatusKind(rawKind) as StatusKind;
  if (!target.operator_combat.statuses.some((s) => s.kind === kind)) return state;
  const nextStatuses = target.operator_combat.statuses.filter((s) => s.kind !== kind);
  let next = updateInstance(state, targetId, (i) => ({
    ...i,
    operator_combat: { ...i.operator_combat!, statuses: nextStatuses },
  }));
  next = addCombatLog(next, {
    type: reason === 'expired' ? 'status_expired' : 'status_removed',
    target_instance_id: targetId,
    target_player_id: target.controller_id,
    target_name: entityName(next, target),
    cause: reason,
    detail: `${playerLabel(target.controller_id)}【${entityName(next, target)}】的 ${kind} 状态${reason === 'expired' ? '到期' : reason === 'consumed' ? '消耗' : '被移除'}。`,
  });
  return next;
}

export function removeEquipmentPackageFromEntity(state: GameState, targetId: CardInstanceId): GameState {
  const target = state.card_instances[targetId];
  if (!target?.operator_combat || !target.operator_combat.equipped_package) return state;
  const pkgName = target.operator_combat.equipped_package.card_name_zh;
  let next = updateInstance(state, targetId, (i) => ({
    ...i,
    operator_combat: {
      ...i.operator_combat!,
      equipped_package: null,
    },
  }));
  const updated = next.card_instances[targetId];
  const newMaxHp = getEntityMaxHp(next, updated);
  if ((updated.operator_combat?.current_hp ?? 0) > newMaxHp) {
    next = updateInstance(next, targetId, (i) => ({
      ...i,
      operator_combat: {
        ...i.operator_combat!,
        current_hp: newMaxHp as HpValue,
      },
    }));
  }
  return addCombatLog(next, {
    type: 'effect_triggered',
    target_instance_id: targetId,
    target_player_id: target.controller_id,
    target_name: entityName(next, target),
    action_type: 'remove_equipment',
    detail: `${playerLabel(target.controller_id)}【${entityName(next, target)}】失去了装备效果【${pkgName}】。`,
  });
}

export function installEquipmentPackageOnEntity(
  state: GameState,
  targetId: CardInstanceId,
  pkg: EquipmentPackageState,
): GameState {
  const target = state.card_instances[targetId];
  if (!target?.operator_combat || target.zone !== 'board') return state;
  if (getEntityKind(state, target) === 'facility') return state;
  // 先移除旧装备效果包（不回滚已结算护盾等即时结果），再安装新包并钳制当前 HP 到新上限
  let next = updateInstance(state, targetId, (i) => ({
    ...i,
    operator_combat: {
      ...i.operator_combat!,
      equipped_package: pkg,
    },
  }));
  const updated = next.card_instances[targetId];
  const newMaxHp = getEntityMaxHp(next, updated);
  if ((updated.operator_combat?.current_hp ?? 0) > newMaxHp) {
    next = updateInstance(next, targetId, (i) => ({
      ...i,
      operator_combat: {
        ...i.operator_combat!,
        current_hp: newMaxHp as HpValue,
      },
    }));
  }
  return addCombatLog(next, {
    type: 'equipment_installed',
    target_instance_id: targetId,
    target_player_id: target.controller_id,
    target_name: entityName(next, target),
    skill_name: pkg.card_name_zh,
    detail: `${playerLabel(target.controller_id)}【${entityName(next, target)}】安装了装备效果【${pkg.card_name_zh}】。`,
  });
}

export interface DestroyEntityOptions {
  readonly killerId?: CardInstanceId;
  readonly killerControllerId?: PlayerId;
  readonly cause: string;
  readonly isEnemyKill?: boolean;
  readonly triggerOnEntityDestroyed?: (state: GameState, entity: CardInstance) => GameState;
}

/**
 * 统一离场 / 击倒 / 摧毁处理：
 * - 干员：进入拥有者弃牌堆（维护失败与敌方击杀不返手不退费）
 * - 设施：从 controller.facility_ids 与格位移除，设施卡进入拥有者弃牌堆
 * - 召唤物：先锁定并触发 on_entity_destroyed 效果（如梅尔水獭/傀影影子），再清除状态与装备并移除
 * - 关联召唤物：当召唤来源离开战场时，关联召唤物按摧毁处理（cause = 'source_retreat'）
 */
export function removeEntityByDefeatOrDestroy(
  state: GameState,
  entityId: CardInstanceId,
  options: DestroyEntityOptions,
): GameState {
  const entity = state.card_instances[entityId];
  if (!entity || entity.zone !== 'board') return state;
  const kind = getEntityKind(state, entity);
  const name = entityName(state, entity);
  const killer = options.killerId ? state.card_instances[options.killerId] : undefined;
  const killerName = killer ? entityName(state, killer) : undefined;
  const posDesc = formatCellLabel(state.board_profile, entity.lane, entity.position, entity.slot_index);

  let next = state;

  // 若实体在离场前有 on_entity_destroyed 需要结算，先锁定当前位置执行（spec §8）
  if (kind === 'summon' && options.triggerOnEntityDestroyed) {
    next = options.triggerOnEntityDestroyed(next, next.card_instances[entityId]);
  }

  const latest = next.card_instances[entityId];
  if (!latest || latest.zone !== 'board') return next;

  const owner = next.players[latest.owner_id];
  const controller = next.players[latest.controller_id];
  const equipment = latest.operator_combat?.equipment_ids ?? [];

  if (kind === 'facility') {
    next = updatePlayer(next, latest.controller_id, (p) => ({
      ...p,
      facility_ids: p.facility_ids.filter((fid) => fid !== entityId),
    }));
    next = updatePlayer(next, latest.owner_id, (p) => ({
      ...p,
      discard: [...p.discard, entityId],
    }));
    next = updateInstance(next, entityId, (i) => ({
      ...i,
      zone: 'discard',
      board_half: null,
      lane: null,
      position: null,
      slot_index: null,
      operator_combat: undefined,
      facility_state: undefined,
    }));
    next = addCombatLog(next, {
      type: 'entity_destroyed',
      source_instance_id: options.killerId,
      target_instance_id: entityId,
      source_player_id: options.killerControllerId ?? killer?.controller_id,
      target_player_id: latest.controller_id,
      source_name: killerName,
      target_name: name,
      cause: options.cause,
      detail: `${playerLabel(latest.controller_id)} 的设施【${name}】(${posDesc}) 被摧毁并进入弃牌堆（原因：${options.cause}）。`,
    });
    return next;
  }

  if (kind === 'summon') {
    next = updateInstance(next, entityId, (i) => ({
      ...i,
      zone: 'discard',
      board_half: null,
      lane: null,
      position: null,
      slot_index: null,
      operator_combat: undefined,
    }));
    next = addCombatLog(next, {
      type: options.cause === 'manual_recall' ? 'summon_recalled' : 'entity_destroyed',
      source_instance_id: options.killerId,
      target_instance_id: entityId,
      source_player_id: options.killerControllerId ?? killer?.controller_id,
      target_player_id: latest.controller_id,
      source_name: killerName,
      target_name: name,
      cause: options.cause,
      detail:
        options.cause === 'manual_recall'
          ? `${playerLabel(latest.controller_id)} 主动回收召唤物【${name}】(${posDesc})，视作摧毁移除。`
          : `${playerLabel(latest.controller_id)} 的召唤物【${name}】(${posDesc}) 被摧毁移除（原因：${options.cause}）。`,
    });
    return next;
  }

  // 干员离场进入弃牌堆
  const nextOwnerDiscard = [...owner.discard, entityId, ...equipment];
  next = updatePlayer(next, latest.owner_id, (p) => ({
    ...p,
    discard: nextOwnerDiscard,
    focus_target_id: p.focus_target_id === entityId ? null : p.focus_target_id,
  }));
  // 清除对方集火该目标
  const otherId: PlayerId = latest.owner_id === 'player_a' ? 'player_b' : 'player_a';
  if (next.players[otherId].focus_target_id === entityId) {
    next = updatePlayer(next, otherId, (p) => ({ ...p, focus_target_id: null }));
  }

  const updates: Record<CardInstanceId, CardInstance> = {
    [entityId]: {
      ...latest,
      zone: 'discard',
      board_half: null,
      lane: null,
      position: null,
      slot_index: null,
      operator_combat: undefined,
    },
  };
  for (const eqId of equipment) {
    const eq = next.card_instances[eqId];
    if (eq) {
      updates[eqId] = { ...eq, zone: 'discard', board_half: null, lane: null, position: null, slot_index: null };
    }
  }
  next = { ...next, card_instances: { ...next.card_instances, ...updates } };

  const detail =
    options.cause === 'upkeep_unpaid'
      ? `${playerLabel(latest.owner_id)}【${name}】因无法支付维护费用而被击倒并进入弃牌堆（不回手、不退款、不计敌方击杀）。`
      : killerName
        ? `${playerLabel(killer?.controller_id)}【${killerName}】击倒了 ${playerLabel(latest.owner_id)}【${name}】！`
        : `${playerLabel(latest.owner_id)}【${name}】被击倒并进入弃牌堆。`;

  next = addCombatLog(next, {
    type: 'unit_defeated',
    source_instance_id: options.killerId,
    target_instance_id: entityId,
    source_player_id: options.killerControllerId ?? killer?.controller_id,
    target_player_id: latest.owner_id,
    source_name: killerName,
    target_name: name,
    cause: options.cause,
    action_type: 'kill',
    detail,
  });

  // 关联召唤物一并摧毁（cause = 'source_retreat' / 'source_defeated'）
  const linkedSummons = Object.values(next.card_instances).filter(
    (u) => u.zone === 'board' && u.summon_state?.source_instance_id === entityId,
  );
  for (const summon of linkedSummons) {
    next = removeEntityByDefeatOrDestroy(next, summon.card_instance_id, {
      cause: 'source_retreat',
      isEnemyKill: false,
      triggerOnEntityDestroyed: options.triggerOnEntityDestroyed,
    });
  }

  void controller;
  return next;
}

export interface DamagePipelineOptions {
  readonly sourceId?: CardInstanceId;
  readonly sourceControllerId?: PlayerId;
  readonly sourceName?: string;
  readonly targetId: CardInstanceId;
  readonly rawDamage: number;
  readonly damageType: 'physical' | 'arts' | 'effect_damage' | 'facility_effect_damage' | 'poison';
  readonly isBasicAttack: boolean;
  readonly ignoreCover?: boolean;
  readonly ignoreShield?: boolean;
  readonly onPreventLethal?: (state: GameState, target: CardInstance) => { readonly state: GameState; readonly prevented: boolean };
  readonly onEntityDestroyed?: (state: GameState, entity: CardInstance) => GameState;
}

export interface DamagePipelineResult {
  readonly state: GameState;
  readonly hpDamage: number;
  readonly shieldAbsorbed: number;
  readonly defeated: boolean;
  readonly survived: boolean;
}

/**
 * V1.1 统一伤害管线：
 * 1. 读取基础与临时修正（已在调用前汇总于 rawDamage）
 * 2. 若为普通攻击，结算【脆弱】（+1 伤害后消耗）
 * 3. 若非【法术攻击】且非毒伤且未忽略掩护，结算【掩护】（-1 伤害后消耗）
 * 4. 护盾吸收
 * 5. 扣减 HP
 * 6. 致命检查与不屈（on_lethal）
 * 7. 击倒/摧毁结算
 */
export function resolveDamagePipeline(state: GameState, opts: DamagePipelineOptions): DamagePipelineResult {
  const target = state.card_instances[opts.targetId];
  if (!target?.operator_combat || target.zone !== 'board') {
    return { state, hpDamage: 0, shieldAbsorbed: 0, defeated: false, survived: false };
  }

  let next = state;
  let dmg = Math.max(0, Math.floor(opts.rawDamage));

  // Step 3: 脆弱（仅影响攻击伤害，不影响单独的技能/设施固定伤害）
  if (opts.isBasicAttack && hasStatus(target, 'vulnerable')) {
    const vuln = target.operator_combat.statuses.find((s) => s.kind === 'vulnerable');
    dmg += vuln?.bonus_damage ?? 1;
    next = removeStatusFromInstance(next, opts.targetId, 'vulnerable', 'consumed');
  }

  // Step 4: 掩护（法术攻击与中毒无视掩护且不消耗掩护）
  const latestAfterVuln = next.card_instances[opts.targetId];
  const isArts = opts.damageType === 'arts';
  if (
    !opts.ignoreCover &&
    !isArts &&
    opts.damageType !== 'poison' &&
    latestAfterVuln &&
    hasStatus(latestAfterVuln, 'cover')
  ) {
    dmg = Math.max(0, dmg - 1);
    next = removeStatusFromInstance(next, opts.targetId, 'cover', 'consumed');
  }

  // Step 5: 护盾吸收
  const latestTarget = next.card_instances[opts.targetId];
  const combat = latestTarget?.operator_combat;
  if (!latestTarget || !combat) {
    return { state: next, hpDamage: 0, shieldAbsorbed: 0, defeated: false, survived: false };
  }

  const shieldAbsorbed = opts.ignoreShield ? 0 : Math.min(combat.shield, dmg);
  const afterShield = Math.max(0, dmg - shieldAbsorbed);
  const hpDamage = Math.min(combat.current_hp, afterShield);
  const nextHp = Math.max(0, combat.current_hp - hpDamage);

  next = updateInstance(next, opts.targetId, (i) => ({
    ...i,
    operator_combat: {
      ...i.operator_combat!,
      shield: i.operator_combat!.shield - shieldAbsorbed,
      current_hp: nextHp as HpValue,
      took_hp_damage_this_owner_turn: i.operator_combat!.took_hp_damage_this_owner_turn || hpDamage > 0,
    },
  }));

  const src = opts.sourceId ? next.card_instances[opts.sourceId] : undefined;
  const srcName = opts.sourceName ?? (src ? entityName(next, src) : '效果');
  const tgtName = entityName(next, latestTarget);

  if (shieldAbsorbed > 0) {
    next = addCombatLog(next, {
      type: 'shield_absorbed',
      source_instance_id: opts.sourceId,
      target_instance_id: opts.targetId,
      source_player_id: opts.sourceControllerId ?? src?.controller_id,
      target_player_id: latestTarget.controller_id,
      source_name: srcName,
      target_name: tgtName,
      amount: shieldAbsorbed,
      detail: `${playerLabel(latestTarget.controller_id)}【${tgtName}】的护盾吸收了 ${shieldAbsorbed} 点伤害。`,
    });
  }

  next = addCombatLog(next, {
    type: 'damage_resolved',
    source_instance_id: opts.sourceId,
    target_instance_id: opts.targetId,
    source_player_id: opts.sourceControllerId ?? src?.controller_id,
    target_player_id: latestTarget.controller_id,
    source_name: srcName,
    target_name: tgtName,
    amount: hpDamage,
    absorbed: shieldAbsorbed,
    action_type: opts.isBasicAttack ? 'attack' : 'skill_damage',
    detail: `${srcName} 对 ${playerLabel(latestTarget.controller_id)}【${tgtName}】造成 ${hpDamage} 点 HP 伤害${shieldAbsorbed > 0 ? `（护盾吸收 ${shieldAbsorbed}）` : ''}。`,
  });

  // 致命检查与不屈（on_lethal）
  if (nextHp <= 0 && opts.onPreventLethal) {
    const lethalRes = opts.onPreventLethal(next, next.card_instances[opts.targetId]);
    next = lethalRes.state;
    if (lethalRes.prevented) {
      return {
        state: next,
        hpDamage,
        shieldAbsorbed,
        defeated: false,
        survived: true,
      };
    }
  }

  const finalHp = next.card_instances[opts.targetId]?.operator_combat?.current_hp ?? 0;
  if (finalHp <= 0) {
    const isEnemyKill =
      Boolean(opts.sourceId && src && src.controller_id !== latestTarget.controller_id && getEntityKind(next, latestTarget) === 'operator');
    next = removeEntityByDefeatOrDestroy(next, opts.targetId, {
      killerId: opts.sourceId,
      killerControllerId: opts.sourceControllerId ?? src?.controller_id,
      cause: opts.damageType === 'poison' ? 'poison' : 'damage',
      isEnemyKill,
      triggerOnEntityDestroyed: opts.onEntityDestroyed,
    });
    return {
      state: next,
      hpDamage,
      shieldAbsorbed,
      defeated: true,
      survived: false,
    };
  }

  // 兼容旧 SP 受击回复字段（V1.1 中已不再靠受击/攻击攒 SP，保留以兼容旧测试夹具）
  const tgtDef = defOf(next, latestTarget);
  if (hpDamage > 0 && (tgtDef?.sp_gain_on_damaged ?? 0) > 0 && !hasStatus(next.card_instances[opts.targetId], 'freeze')) {
    next = gainSp(next, opts.targetId, tgtDef?.sp_gain_on_damaged ?? 0, '受到伤害');
  }

  return {
    state: next,
    hpDamage,
    shieldAbsorbed,
    defeated: false,
    survived: true,
  };
}
