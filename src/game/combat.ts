import { compareBoardEntities, formatCellLabel, formatLaneLabelZh, normalizeLaneId } from './board';
import {
  addCombatLog,
  applyStatusToInstance,
  defOf,
  entityName,
  gainSp as grantSp,
  healEntity,
  playerLabel,
  removeStatusFromInstance,
  resolveDamagePipeline,
  updateInstance,
  updatePlayer,
} from './combat-primitives';
import {
  executeEffectOps,
  triggerEntityDestroyedEffects,
  triggerOnKillEffects,
  triggerUnitEventBlocks,
} from './effects';
import {
  canEntityPerformBasicAttack,
  canTriggerOwnEffects,
  getEffectiveAttackProfile,
  getEligibleLanes,
  getEntityKind,
  getEntityMaxHp,
  getEntityStats,
  hasStatus,
  isFrozen,
  isStunned,
  selectOrdinaryAttackTargets,
} from './range';
import { drainTriggerQueue, MAX_TRIGGER_DEPTH } from './trigger-queue';
import type {
  BasePoints,
  CardId,
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  SpValue,
  StatusEffect,
} from './types';

export { addCombatLog, applyStatusToInstance, grantSp };

export function applyEffectDamage(
  state: GameState,
  sourceId: CardInstanceId,
  targetId: CardInstanceId,
  amount: number,
): GameState {
  const src = state.card_instances[sourceId];
  const res = resolveDamagePipeline(state, {
    sourceId,
    sourceControllerId: src?.controller_id,
    sourceName: src ? entityName(state, src) : '效果',
    targetId,
    rawDamage: amount,
    damageType: 'effect_damage',
    isBasicAttack: false,
    onEntityDestroyed: triggerEntityDestroyedEffects,
  });
  let next = res.state;
  if (res.defeated && src && src.zone === 'board') {
    next = triggerOnKillEffects(next, sourceId, targetId);
  }
  return next;
}

function getFocusFireBonusFromUnit(attacker: CardInstance): number {
  let maxBonus = 0;
  for (const mod of attacker.operator_combat?.temp_modifiers ?? []) {
    if (mod.kind === 'focus_fire' && typeof mod.amount === 'number') {
      maxBonus = Math.max(maxBonus, mod.amount);
    }
  }
  return maxBonus;
}

function consumeFirstAttackModifiers(state: GameState, attackerId: CardInstanceId): GameState {
  const unit = state.card_instances[attackerId];
  if (!unit?.operator_combat?.temp_modifiers?.length) return state;
  const remaining = unit.operator_combat.temp_modifiers.filter(
    (m) => m.expires !== 'first_basic_attack' && m.expires !== 'first_basic_attack_this_combat',
  );
  return updateInstance(state, attackerId, (u) => ({
    ...u,
    operator_combat: {
      ...u.operator_combat!,
      temp_modifiers: remaining,
    },
  }));
}

function consumePostAttackDebuffs(state: GameState, attackerId: CardInstanceId): GameState {
  let next = state;
  const attacker = next.card_instances[attackerId];
  if (!attacker) return next;
  if (hasStatus(attacker, 'suppressed')) {
    next = removeStatusFromInstance(next, attackerId, 'suppressed', 'consumed');
  }
  if (hasStatus(next.card_instances[attackerId], 'slow')) {
    next = removeStatusFromInstance(next, attackerId, 'slow', 'consumed');
  }
  return next;
}

function countAttackDebuffPenalty(attacker: CardInstance): number {
  let penalty = 0;
  if (hasStatus(attacker, 'suppressed')) penalty += 1;
  if (hasStatus(attacker, 'chilled')) penalty += 1;
  if (hasStatus(attacker, 'slow')) penalty += 1;
  return penalty;
}

function runLegacyOnAttackedReaction(
  state: GameState,
  targetId: CardInstanceId,
  attackerId: CardInstanceId,
  initialDamage: number,
): { readonly state: GameState; readonly damage: number } {
  let next = state;
  let currentDamage = initialDamage;
  const entries = [{ payload: { source: targetId, attackerId }, depth: 0 }];
  const queueResult = drainTriggerQueue(
    entries,
    (task) => {
      const target = next.card_instances[task.source];
      if (!target?.operator_combat || target.zone !== 'board' || !canTriggerOwnEffects(next, target)) return [];
      const targetDef = defOf(next, target);
      const action = targetDef?.effect_json?.actions?.find(
        (x) => x.type === 'reduce_incoming_damage' && typeof x.sp_cost === 'number',
      );
      if (!targetDef || !action || target.operator_combat.current_sp < (action.sp_cost as number)) return [];
      const cost = action.sp_cost as number;
      next = updateInstance(next, target.card_instance_id, (i) => ({
        ...i,
        operator_combat: { ...i.operator_combat!, current_sp: (i.operator_combat!.current_sp - cost) as SpValue },
      }));
      next = addCombatLog(next, {
        type: 'sp_spent',
        source_instance_id: target.card_instance_id,
        target_instance_id: target.card_instance_id,
        source_player_id: target.controller_id,
        target_player_id: target.controller_id,
        source_name: targetDef.card_name_zh,
        amount: cost,
        detail: `${playerLabel(target.controller_id)}【${targetDef.card_name_zh}】支付 ${cost} SP 反应技能费用。`,
      });
      const reactionValue = typeof action.value === 'number' ? action.value : 0;
      next = addCombatLog(next, {
        type: 'reaction_triggered',
        source_instance_id: target.card_instance_id,
        target_instance_id: task.attackerId,
        source_player_id: target.controller_id,
        source_name: targetDef.card_name_zh,
        skill_name: '受击减伤反应',
        amount: reactionValue,
        action_type: 'reaction',
        detail: `${playerLabel(target.controller_id)}【${targetDef.card_name_zh}】触发技能【受击减伤反应】，减免 ${reactionValue} 点受击伤害！`,
      });
      currentDamage = Math.max(0, currentDamage - reactionValue);
      return [];
    },
    (task) => {
      const d = defOf(next, next.card_instances[task.source]);
      return Number(d?.effect_json?.skill_priority ?? d?.effect_json?.actions?.[0]?.skill_priority ?? 0);
    },
    (task) => task.source,
  );
  if (queueResult.exceededDepthLimit) {
    next = addCombatLog(next, {
      type: 'trigger_limit',
      detail: `触发队列达到安全阀 ${MAX_TRIGGER_DEPTH}，余下效果停止。`,
    });
  }
  return { state: next, damage: currentDamage };
}

function triggerOnDamagedHooks(
  state: GameState,
  victimId: CardInstanceId,
  attackerId: CardInstanceId,
  hpDamage: number,
  shieldAbsorbed: number,
  suppressTargetRetaliation: boolean,
): GameState {
  let next = state;
  const victim = next.card_instances[victimId];
  if (!victim || victim.zone !== 'board') return next;
  const didTakeHit = hpDamage > 0 || shieldAbsorbed > 0;
  if (!didTakeHit) return next;

  if (!suppressTargetRetaliation && canTriggerOwnEffects(next, victim)) {
    const res = triggerUnitEventBlocks(next, victimId, 'on_damaged', {
      damageSourceId: attackerId,
      primaryTargetLostHp: hpDamage > 0,
    });
    next = res.state;
  }

  // 同路友方古米（OP-DEF-004）等 on_ally_damaged 钩子
  if (hpDamage > 0 && victim.lane) {
    const canonicalLane = normalizeLaneId(next.board_profile, victim.lane);
    const sameLaneAllies = Object.values(next.card_instances)
      .filter(
        (u) =>
          u.zone === 'board' &&
          u.controller_id === victim.controller_id &&
          u.card_instance_id !== victimId &&
          u.lane !== null &&
          normalizeLaneId(next.board_profile, u.lane) === canonicalLane &&
          canTriggerOwnEffects(next, u),
      )
      .sort((a, b) => compareBoardEntities(next.board_profile, a, b));

    for (const ally of sameLaneAllies) {
      const allyDef = defOf(next, ally);
      if (!allyDef?.skill_effects?.some((b) => b.trigger === 'on_ally_damaged')) continue;
      next = triggerUnitEventBlocks(next, ally.card_instance_id, 'on_ally_damaged', {
        primaryTargetId: victimId,
        primaryTargetLostHp: true,
      }).state;
    }
  }
  return next;
}

function resolveSupportHealingStep(state: GameState, healerId: CardInstanceId): GameState {
  const healer = state.card_instances[healerId];
  if (!healer?.operator_combat || healer.zone !== 'board' || !healer.lane) return state;
  const def = defOf(state, healer);
  const profile = getEffectiveAttackProfile(state, healer);
  if (!def || !profile || profile.mode !== 'support') return state;

  let next = state;
  const hasExplicitStep = (def.skill_effects ?? []).some((b) => b.trigger === 'combat_attack_step');
  if (hasExplicitStep) {
    return triggerUnitEventBlocks(next, healerId, 'combat_attack_step').state;
  }

  const eligibleLanes = new Set(getEligibleLanes(next, healer.lane, profile.route_scope));
  const candidates = Object.values(next.card_instances)
    .filter((u) => {
      if (u.zone !== 'board' || u.controller_id !== healer.controller_id || !u.operator_combat) return false;
      if (getEntityKind(next, u) === 'facility') return false;
      if (!u.lane || !eligibleLanes.has(normalizeLaneId(next.board_profile, u.lane))) return false;
      if (defOf(next, u)?.native_traits?.some((t) => t.effect?.op === 'exclude_from_friendly_heal_targets')) return false;
      return u.operator_combat.current_hp < getEntityMaxHp(next, u);
    })
    .sort((a, b) => {
      const ra = a.operator_combat!.current_hp / Math.max(1, getEntityMaxHp(next, a));
      const rb = b.operator_combat!.current_hp / Math.max(1, getEntityMaxHp(next, b));
      if (Math.abs(ra - rb) > 1e-6) return ra - rb;
      return compareBoardEntities(next.board_profile, a, b);
    });

  if (candidates.length === 0) return next;

  const limit =
    profile.pattern === 'heal_multi'
      ? (profile.target_limit === 'all' ? candidates.length : Math.max(1, Number(profile.target_limit ?? 2)))
      : 1;
  const baseHeal =
    typeof profile.heal_amount === 'number'
      ? profile.heal_amount
      : getEntityStats(next, healer).atk;

  for (const target of candidates.slice(0, limit)) {
    let healAmount = baseHeal;
    const latestHealer = next.card_instances[healerId];
    if (latestHealer && canTriggerOwnEffects(next, latestHealer)) {
      const bhRes = triggerUnitEventBlocks(next, healerId, 'before_heal', { healAmountModifier: 0 });
      next = bhRes.state;
      healAmount += bhRes.context.healAmountModifier ?? 0;
    }
    next = healEntity(next, target.card_instance_id, healAmount, {
      sourceId: healerId,
      sourceName: entityName(next, healer),
    }).state;
  }

  return next;
}

function resolveSingleAttackerTurn(
  state: GameState,
  attackerId: CardInstanceId,
  options: {
    readonly isImmediateAttack?: boolean;
    readonly immediateFocusFireBonus?: number;
    readonly consumeNormalAttack?: boolean;
    readonly noRetaliationIfDefeated?: boolean;
  } = {},
): GameState {
  let next = state;
  const attacker = next.card_instances[attackerId];
  if (!attacker?.operator_combat || attacker.zone !== 'board') return next;

  // 若眩晕且未被冻结：跳过这次普通攻击机会并消耗眩晕
  if (isStunned(attacker) && !isFrozen(attacker)) {
    next = removeStatusFromInstance(next, attackerId, 'stun', 'consumed');
    next = addCombatLog(next, {
      type: 'effect_triggered',
      source_instance_id: attackerId,
      source_player_id: attacker.controller_id,
      source_name: entityName(next, attacker),
      action_type: 'stun_skip',
      detail: `${playerLabel(attacker.controller_id)}【${entityName(next, attacker)}】处于【眩晕】，跳过本次普通攻击并解除眩晕。`,
    });
    return next;
  }

  if (!options.isImmediateAttack) {
    if (!canEntityPerformBasicAttack(next, attacker)) return next;
  } else {
    if (getEntityKind(next, attacker) === 'facility' || isFrozen(attacker) || isStunned(attacker)) return next;
    if (attacker.operator_combat.consumed_normal_attack_this_turn) return next;
    if (getEntityKind(next, attacker) === 'summon' && getEntityStats(next, attacker).atk <= 0) return next;
  }

  if (options.isImmediateAttack && options.consumeNormalAttack !== false) {
    next = updateInstance(next, attackerId, (i) => ({
      ...i,
      operator_combat: {
        ...i.operator_combat!,
        consumed_normal_attack_this_turn: true,
        granted_immediate_attack_this_turn: true,
      },
    }));
  }

  const freshAttacker = next.card_instances[attackerId];
  const profile = getEffectiveAttackProfile(next, freshAttacker);
  if (!profile || !freshAttacker.lane) return next;

  // 医疗干员执行治疗步骤
  if (profile.mode === 'support') {
    return resolveSupportHealingStep(next, attackerId);
  }

  const targets = selectOrdinaryAttackTargets(next, freshAttacker);
  const attackerDef = defOf(next, freshAttacker);
  const attackerName = entityName(next, freshAttacker);
  const laneLabel = formatLaneLabelZh(next.board_profile, freshAttacker.lane);
  const posLabel = formatCellLabel(next.board_profile, freshAttacker.lane, freshAttacker.position, freshAttacker.slot_index);

  const stats = getEntityStats(next, freshAttacker);
  const debuffPenalty = countAttackDebuffPenalty(freshAttacker);
  const focusFireBonus = Math.max(getFocusFireBonusFromUnit(freshAttacker), options.immediateFocusFireBonus ?? 0);

  // 无敌方阻挡目标 -> 直击基地
  if (targets.length === 0) {
    const baseAttackDamage = Math.max(0, stats.atk - debuffPenalty + focusFireBonus);
    next = consumePostAttackDebuffs(next, attackerId);
    next = consumeFirstAttackModifiers(next, attackerId);
    next = addCombatLog(next, {
      type: 'attack_declared',
      source_instance_id: attackerId,
      source_player_id: freshAttacker.controller_id,
      source_name: attackerName,
      lane: freshAttacker.lane,
      position: freshAttacker.position ?? undefined,
      slot_index: freshAttacker.slot_index ?? undefined,
      amount: baseAttackDamage,
      action_type: 'attack',
      detail: `${playerLabel(freshAttacker.controller_id)}【${attackerName}】(${posLabel}) 发起普通攻击（攻击力 ${baseAttackDamage}）。`,
    });

    const defender: PlayerId = freshAttacker.controller_id === 'player_a' ? 'player_b' : 'player_a';
    next = updatePlayer(next, defender, (p) => ({
      ...p,
      base_points: (p.base_points - baseAttackDamage) as BasePoints,
    }));
    next = addCombatLog(next, {
      type: 'base_damaged',
      source_instance_id: attackerId,
      player_id: defender,
      source_player_id: freshAttacker.controller_id,
      target_player_id: defender,
      source_name: attackerName,
      lane: freshAttacker.lane,
      position: freshAttacker.position ?? undefined,
      amount: baseAttackDamage,
      action_type: 'attack',
      detail: `${playerLabel(freshAttacker.controller_id)}【${attackerName}】[${laneLabel}] 直击 ${playerLabel(defender)} 基地，造成 ${baseAttackDamage} 点伤害！`,
    });
    next = updateInstance(next, attackerId, (u) => ({
      ...u,
      operator_combat: {
        ...u.operator_combat!,
        per_combat_trigger_counts: { ...(u.operator_combat!.per_combat_trigger_counts ?? {}), first_attack_used: 1 },
      },
    }));
    return next;
  }

  const primaryTarget = targets[0];
  let preAttackDelta = 0;

  // before_attack 钩子（玫兰莎、流星、白金、黑、阿米娅、狙击瞄准镜、源石增幅模块等）
  if (canTriggerOwnEffects(next, freshAttacker)) {
    const beforeRes = triggerUnitEventBlocks(next, attackerId, 'before_attack', {
      primaryTargetId: primaryTarget.card_instance_id,
      primaryTargetRow: primaryTarget.position ?? undefined,
      primaryTargetWasSuppressed: hasStatus(primaryTarget, 'suppressed'),
      currentAttackPowerDelta: 0,
      focusFireBonus: 0,
    });
    next = beforeRes.state;
    preAttackDelta += beforeRes.context.currentAttackPowerDelta ?? 0;
    const beforeFocus = beforeRes.context.focusFireBonus ?? 0;
    if (beforeFocus > 0) {
      // 源石增幅模块的 +1 focus_fire
      preAttackDelta += Math.max(0, Math.max(focusFireBonus, beforeFocus) - focusFireBonus);
    }

    // OP-CAS-007 夜魔：当主目标已处于压制时获得 +1 临时伤害加成
    if (attackerDef?.card_id === ('OP-CAS-007' as CardId) && hasStatus(primaryTarget, 'suppressed')) {
      preAttackDelta += 1;
    }
  }

  const firstHitRawAtk = Math.max(0, stats.atk - debuffPenalty + preAttackDelta + focusFireBonus);
  const nonFocusRawAtk = Math.max(0, stats.atk - debuffPenalty + preAttackDelta);
  const damageType = profile.damage_type === 'arts' ? 'arts' : 'physical';

  next = addCombatLog(next, {
    type: 'attack_declared',
    source_instance_id: attackerId,
    target_instance_id: primaryTarget.card_instance_id,
    source_player_id: freshAttacker.controller_id,
    target_player_id: primaryTarget.controller_id,
    source_name: attackerName,
    target_name: entityName(next, primaryTarget),
    lane: freshAttacker.lane,
    position: freshAttacker.position ?? undefined,
    amount: firstHitRawAtk,
    action_type: 'attack',
    detail: `${playerLabel(freshAttacker.controller_id)}【${attackerName}】(${posLabel}) 攻击 ${playerLabel(primaryTarget.controller_id)}【${entityName(next, primaryTarget)}】（预期伤害 ${firstHitRawAtk}）。`,
  });

  let primaryLostHp = false;
  let primaryAttackHit = false;
  const damagedTargetIds: CardInstanceId[] = [];
  const primaryWasSuppressed = hasStatus(primaryTarget, 'suppressed');

  const resolveHitOnTarget = (targetSnapshot: CardInstance, rawHitDamage: number): { readonly stopped: boolean } => {
    const liveTarget = next.card_instances[targetSnapshot.card_instance_id];
    if (!liveTarget || liveTarget.zone !== 'board' || !liveTarget.operator_combat) {
      return { stopped: true };
    }
    const legacyReaction = runLegacyOnAttackedReaction(next, liveTarget.card_instance_id, attackerId, rawHitDamage);
    next = legacyReaction.state;
    const afterReactionTarget = next.card_instances[liveTarget.card_instance_id];
    if (!afterReactionTarget || afterReactionTarget.zone !== 'board') {
      return { stopped: true };
    }

    const dmgRes = resolveDamagePipeline(next, {
      sourceId: attackerId,
      sourceControllerId: freshAttacker.controller_id,
      sourceName: attackerName,
      targetId: liveTarget.card_instance_id,
      rawDamage: legacyReaction.damage,
      damageType,
      isBasicAttack: true,
      onPreventLethal: (s, tgt) => {
        if (!canTriggerOwnEffects(s, tgt)) return { state: s, prevented: false };
        const lethalRes = triggerUnitEventBlocks(s, tgt.card_instance_id, 'on_lethal', {
          damageSourceId: attackerId,
        });
        return { state: lethalRes.state, prevented: Boolean(lethalRes.context.preventedLethal) };
      },
      onEntityDestroyed: triggerEntityDestroyedEffects,
    });
    next = dmgRes.state;

    if (liveTarget.card_instance_id === primaryTarget.card_instance_id) {
      primaryAttackHit = true;
      if (dmgRes.hpDamage > 0) primaryLostHp = true;
    }
    if (dmgRes.hpDamage > 0 || dmgRes.shieldAbsorbed > 0) {
      if (!damagedTargetIds.includes(liveTarget.card_instance_id)) {
        damagedTargetIds.push(liveTarget.card_instance_id);
      }
      const suppressRetaliation = Boolean(options.noRetaliationIfDefeated && dmgRes.defeated);
      next = triggerOnDamagedHooks(
        next,
        liveTarget.card_instance_id,
        attackerId,
        dmgRes.hpDamage,
        dmgRes.shieldAbsorbed,
        suppressRetaliation,
      );
    }
    if (dmgRes.defeated) {
      next = triggerOnKillEffects(next, attackerId, liveTarget.card_instance_id);
    }

    return { stopped: dmgRes.defeated };
  };

  if (profile.pattern === 'multi_hit') {
    const hitCount = Math.max(2, Number(profile.hit_count ?? 2));
    const baseHit = Math.max(1, stats.atk - debuffPenalty + preAttackDelta - 1);
    for (let hitIdx = 0; hitIdx < hitCount; hitIdx += 1) {
      const hitDamage = hitIdx === 0 ? Math.max(1, baseHit + focusFireBonus) : baseHit;
      const hitRes = resolveHitOnTarget(primaryTarget, hitDamage);
      if (hitRes.stopped) break;
    }
  } else if (profile.pattern === 'multi_target' || profile.pattern === 'line') {
    for (let idx = 0; idx < targets.length; idx += 1) {
      const tgt = targets[idx];
      let hitDamage: number;
      if (idx === 0) {
        hitDamage = firstHitRawAtk;
      } else if (typeof profile.secondary_damage === 'number') {
        hitDamage = Math.max(0, profile.secondary_damage);
      } else {
        hitDamage = nonFocusRawAtk;
      }
      resolveHitOnTarget(tgt, hitDamage);
    }
  } else {
    resolveHitOnTarget(primaryTarget, firstHitRawAtk);
  }

  // 清除消耗性的压制、减速以及“首击”集火加成
  next = consumePostAttackDebuffs(next, attackerId);
  next = consumeFirstAttackModifiers(next, attackerId);

  // after_attack / on_attack_resolved 钩子（无论后续自身是否仍在场/未沉默未冻结）
  const latestAttacker = next.card_instances[attackerId];
  if (latestAttacker && latestAttacker.zone === 'board' && canTriggerOwnEffects(next, latestAttacker)) {
    const postCtx = {
      primaryTargetId: primaryTarget.card_instance_id,
      primaryTargetLostHp: primaryLostHp,
      primaryTargetRow: primaryTarget.position ?? undefined,
      primaryTargetWasSuppressed: primaryWasSuppressed,
      primaryAttackHit,
      damagedTargetIds,
    };
    next = triggerUnitEventBlocks(next, attackerId, 'after_attack', postCtx).state;
    next = triggerUnitEventBlocks(next, attackerId, 'on_attack_resolved', postCtx).state;
  }

  if (next.card_instances[attackerId]?.operator_combat) {
    next = updateInstance(next, attackerId, (u) => ({
      ...u,
      operator_combat: {
        ...u.operator_combat!,
        per_combat_trigger_counts: {
          ...(u.operator_combat!.per_combat_trigger_counts ?? {}),
          first_attack_used: 1,
        },
      },
    }));
  }

  return next;
}

export function executeImmediateAttackForUnit(
  state: GameState,
  unitId: CardInstanceId,
  focusFireBonus = 0,
  consumeNormalAttack = true,
  options: { readonly noRetaliationIfDefeated?: boolean } = {},
): GameState {
  return resolveSingleAttackerTurn(state, unitId, {
    isImmediateAttack: true,
    immediateFocusFireBonus: focusFireBonus,
    consumeNormalAttack,
    noRetaliationIfDefeated: options.noRetaliationIfDefeated,
  });
}

export function resolveCombat(state: GameState): GameState {
  const actor = state.active_player_id;
  let next: GameState = { ...state, combat_log: [] };

  // 0. 清空上一场战斗残留的 per_combat_trigger_counts
  const clearedCounts: Record<CardInstanceId, CardInstance> = { ...next.card_instances };
  for (const [id, inst] of Object.entries(clearedCounts) as [CardInstanceId, CardInstance][]) {
    if (inst.operator_combat?.per_combat_trigger_counts) {
      clearedCounts[id] = {
        ...inst,
        operator_combat: { ...inst.operator_combat, per_combat_trigger_counts: {} },
      };
    }
  }
  next = { ...next, card_instances: clearedCounts };

  // 1. 战斗开始节点（主动玩家的干员、非失效设施按稳定位置顺序结算 combat_start）
  const combatStartSources = Object.values(next.card_instances)
    .filter((i) => i.zone === 'board' && i.controller_id === actor)
    .sort((a, b) => compareBoardEntities(next.board_profile, a, b));

  for (const src of combatStartSources) {
    if (!next.card_instances[src.card_instance_id] || next.card_instances[src.card_instance_id].zone !== 'board') continue;
    next = triggerUnitEventBlocks(next, src.card_instance_id, 'combat_start').state;
  }

  // 2. 建立普通攻击队列快照（OQ-10：开战时按复合位置键排序快照；队列建立后位移不重排，新召唤/新部署不自动入队）
  const attackQueue = Object.values(next.card_instances)
    .filter((i) => i.zone === 'board' && i.controller_id === actor && i.operator_combat && getEntityKind(next, i) !== 'facility')
    .sort((a, b) => compareBoardEntities(next.board_profile, a, b))
    .map((i) => i.card_instance_id);

  for (const attackerId of attackQueue) {
    next = resolveSingleAttackerTurn(next, attackerId);
    if (next.players.player_a.base_points <= 0 || next.players.player_b.base_points <= 0) break;
  }

  // 3. 战斗结束节点（斑点、史尔特尔、战地维修站等）
  const combatEndSources = Object.values(next.card_instances)
    .filter((i) => i.zone === 'board' && i.controller_id === actor)
    .sort((a, b) => compareBoardEntities(next.board_profile, a, b));

  for (const src of combatEndSources) {
    if (!next.card_instances[src.card_instance_id] || next.card_instances[src.card_instance_id].zone !== 'board') continue;
    next = triggerUnitEventBlocks(next, src.card_instance_id, 'combat_end').state;
  }

  // 4. 清除 combat_end 到期的临时修正（如真银斩、风笛 combat_end 残留等）
  for (const inst of Object.values(next.card_instances)) {
    if (!inst.operator_combat?.temp_modifiers?.length) continue;
    const filtered = inst.operator_combat.temp_modifiers.filter(
      (m) => m.expires !== 'combat_end' && m.expires !== 'first_basic_attack_this_combat',
    );
    if (filtered.length !== inst.operator_combat.temp_modifiers.length) {
      next = updateInstance(next, inst.card_instance_id, (u) => ({
        ...u,
        operator_combat: { ...u.operator_combat!, temp_modifiers: filtered },
      }));
    }
  }

  const aLost = next.players.player_a.base_points <= 0;
  const bLost = next.players.player_b.base_points <= 0;
  const winner: GameState['winner'] = !aLost && !bLost ? null : aLost && bLost ? 'draw' : aLost ? 'player_b' : 'player_a';
  return {
    ...next,
    phase: winner ? 'finished' : 'turn_end',
    winner,
    state_version: next.state_version + 1,
  };
}

/**
 * 保留旧接口名称兼容旧测试夹具；V1.1 中 SP 自然回复已停用（全部以 CP/JSON 触发代替）。
 */
export function naturalSpAtTurnStart(state: GameState, playerId: PlayerId): GameState {
  void playerId;
  return state;
}

/**
 * 回合开始时状态结算节点（V1.1 §5.2）：
 * 1. 先结算中毒伤害（层数 = 伤害），再清层；
 * 2. 清除 owner_turn_start / owner_next_turn_start 到期的状态（如冻结、寒冷等）。
 */
export function expireStatusesAtTurnStart(state: GameState, playerId: PlayerId): GameState {
  let next = state;
  const targetUnits = Object.values(next.card_instances)
    .filter((i) => i.zone === 'board' && i.controller_id === playerId && i.operator_combat)
    .sort((a, b) => compareBoardEntities(next.board_profile, a, b));

  // Step 1: 毒伤先结算
  for (const unit of targetUnits) {
    const live = next.card_instances[unit.card_instance_id];
    const poison = live?.operator_combat?.statuses.find((s) => s.kind === 'poisoned');
    if (!poison) continue;
    const dmg = Math.max(1, poison.stacks ?? 1);
    const dmgRes = resolveDamagePipeline(next, {
      sourceId: poison.source_instance_id,
      sourceControllerId: poison.source_instance_id ? next.card_instances[poison.source_instance_id]?.controller_id : undefined,
      sourceName: '中毒',
      targetId: live.card_instance_id,
      rawDamage: dmg,
      damageType: 'poison',
      isBasicAttack: false,
      ignoreCover: true,
      onEntityDestroyed: triggerEntityDestroyedEffects,
    });
    next = dmgRes.state;
  }

  // Step 2: 清除在该回合开始节点到期的状态
  const ownerTurn = next.players[playerId].turns_taken;
  for (const unit of Object.values(next.card_instances)) {
    if (unit.zone !== 'board' || !unit.operator_combat) continue;
    if (unit.owner_id !== playerId && unit.controller_id !== playerId) continue;

    const remainingStatuses: StatusEffect[] = [];
    for (const status of unit.operator_combat.statuses) {
      const expireNode = status.expire_at_node ?? 'owner_turn_start';
      if (status.kind === 'poisoned' && unit.controller_id === playerId) {
        next = addCombatLog(next, {
          type: 'status_expired',
          target_instance_id: unit.card_instance_id,
          target_player_id: unit.controller_id,
          target_name: entityName(next, unit),
          detail: `${playerLabel(unit.controller_id)}【${entityName(next, unit)}】的中毒层数在回合开始伤害结算后清除。`,
        });
        continue;
      }
      if (expireNode !== 'owner_turn_start' && expireNode !== 'owner_next_turn_start') {
        remainingStatuses.push(status);
        continue;
      }
      if (unit.owner_id === playerId && status.applied_on_owner_turn_index >= ownerTurn) {
        remainingStatuses.push(status);
        continue;
      }
      const nextRemaining = status.remaining_owner_turns - 1;
      if (nextRemaining <= 0) {
        next = addCombatLog(next, {
          type: 'status_expired',
          target_instance_id: unit.card_instance_id,
          target_player_id: unit.controller_id,
          target_name: entityName(next, unit),
          detail: `${playerLabel(unit.controller_id)}【${entityName(next, unit)}】的 ${status.kind} 状态到期。`,
        });
      } else {
        remainingStatuses.push({ ...status, remaining_owner_turns: nextRemaining });
      }
    }

    if (remainingStatuses.length !== unit.operator_combat.statuses.length ||
        remainingStatuses.some((s, idx) => s !== unit.operator_combat!.statuses[idx])) {
      next = updateInstance(next, unit.card_instance_id, (u) => ({
        ...u,
        operator_combat: { ...u.operator_combat!, statuses: remainingStatuses },
      }));
    }
  }

  return next;
}

/**
 * 回合结束时状态与临时修正清理节点：
 * - 清除 owner_next_turn_end 到期的状态（如拉普兰德沉默到目标下回合结束）；
 * - 清除属于本回合控制者的 turn_end / first_basic_attack 临时修正。
 */
export function expireStatusesAtTurnEnd(state: GameState, playerId: PlayerId): GameState {
  let next = state;
  const ownerTurn = next.players[playerId].turns_taken;

  for (const unit of Object.values(next.card_instances)) {
    if (unit.zone !== 'board' || !unit.operator_combat) continue;

    // 1. owner_next_turn_end 到期的状态（如沉默）
    if (unit.owner_id === playerId || unit.controller_id === playerId) {
      const kept: StatusEffect[] = [];
      for (const status of unit.operator_combat.statuses) {
        if (status.expire_at_node === 'owner_next_turn_end' && status.applied_on_owner_turn_index < ownerTurn) {
          next = addCombatLog(next, {
            type: 'status_expired',
            target_instance_id: unit.card_instance_id,
            target_player_id: unit.controller_id,
            target_name: entityName(next, unit),
            detail: `${playerLabel(unit.controller_id)}【${entityName(next, unit)}】的 ${status.kind} 状态到期。`,
          });
          continue;
        }
        kept.push(status);
      }
      if (kept.length !== unit.operator_combat.statuses.length) {
        next = updateInstance(next, unit.card_instance_id, (u) => ({
          ...u,
          operator_combat: { ...u.operator_combat!, statuses: kept },
        }));
      }
    }

    // 2. 清除回合末临时强化
    const liveUnit = next.card_instances[unit.card_instance_id];
    if (liveUnit?.operator_combat?.temp_modifiers?.length) {
      const remainingMods = liveUnit.operator_combat.temp_modifiers.filter(
        (m) => !(m.owner_id === playerId && (m.expires === 'turn_end' || m.expires === 'first_basic_attack')),
      );
      if (remainingMods.length !== liveUnit.operator_combat.temp_modifiers.length) {
        next = updateInstance(next, unit.card_instance_id, (u) => ({
          ...u,
          operator_combat: { ...u.operator_combat!, temp_modifiers: remainingMods },
        }));
      }
    }
  }

  return next;
}

export function expireOwnerTurnStatuses(state: GameState, playerId: PlayerId): GameState {
  return expireStatusesAtTurnEnd(state, playerId);
}
