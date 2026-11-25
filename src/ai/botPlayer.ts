import { normalizeLaneId } from '../game/board';
import { enumerateLegalActions } from '../game/legal-actions';
import { getEntityKind, getEntityStats, hasStatus } from '../game/range';
import type { CardDefinition, CardId, CardInstanceId, GameAction, GameState, LaneId, PlayerId } from '../game/types';

/**
 * 本地机器人（V1.1 自适应棋盘启发式评分）。
 *
 * 信息边界：
 * - 动作候选只来自 enumerateLegalActions；
 * - 适配任意 1–5 路、每排 0–3 格的 BoardProfile；
 * - 不读取对手手牌内容、牌库顺序或 random_state。
 */

const OTHER_PLAYER: Readonly<Record<PlayerId, PlayerId>> = { player_a: 'player_b', player_b: 'player_a' };

export type BotDifficulty = 'normal';

export interface BotWatchdogOptions {
  readonly maxScoredActions?: number;
  readonly maxDecisionsPerMatch?: number;
  readonly maxMsPerDecision?: number;
}

export interface BotOptions {
  readonly player: PlayerId;
  readonly difficulty?: BotDifficulty;
  readonly rng?: () => number;
  readonly log?: (message: string) => void;
  readonly watchdog?: BotWatchdogOptions;
}

export interface BotTelemetry {
  readonly decisions: number;
  readonly watchdogStops: number;
  readonly repetitionStops: number;
  readonly fallbacks: number;
}

const DEFAULT_WATCHDOG: Required<BotWatchdogOptions> = {
  maxScoredActions: 800,
  maxDecisionsPerMatch: 3000,
  maxMsPerDecision: 50,
};

interface ScoredAction {
  readonly action: GameAction;
  readonly score: number;
}

function boardEntities(state: GameState) {
  return Object.values(state.card_instances).filter((instance) => instance.zone === 'board' && instance.operator_combat);
}

function isDisabledControl(instance: ReturnType<typeof boardEntities>[number]): boolean {
  return hasStatus(instance, 'stun') || hasStatus(instance, 'freeze');
}

function definitionWorth(definition: CardDefinition): number {
  let worth = (definition.hp ?? 0) * 0.7 + (definition.atk ?? 0) * 1.25;
  if (definition.floating) worth += 0.8;
  if (definition.taunt_scope === 'all_lanes') worth += 1.2;
  else if (definition.taunt_scope === 'same_lane') worth += 0.9;
  if ((definition.skill_effects?.length ?? 0) > 0) worth += 0.6;
  return worth;
}

function laneThreat(state: GameState, defender: PlayerId, lane: LaneId): number {
  const attacker = OTHER_PLAYER[defender];
  const targetLane = normalizeLaneId(state.board_profile, lane);
  let threat = 0;
  for (const unit of boardEntities(state)) {
    if (unit.controller_id !== attacker || !unit.lane) continue;
    if (normalizeLaneId(state.board_profile, unit.lane) !== targetLane) continue;
    if (isDisabledControl(unit) || getEntityKind(state, unit) === 'facility') continue;
    threat = Math.max(threat, getEntityStats(state, unit).atk);
  }
  return threat;
}

/** 重复状态检测哈希：只含公开与己方信息。 */
export function stateHashForRepetition(state: GameState, player: PlayerId): string {
  const parts: string[] = [`t${state.turn_number}`, `a${state.active_player_id}`, `b${state.board_profile.profileId}`];
  for (const playerId of ['player_a', 'player_b'] as const) {
    const p = state.players[playerId];
    parts.push(`${playerId}|bp${p.base_points}|c${p.cost}|cap${p.turn_cp_cap}|f${p.fatigue_count}|fc${p.focus_target_id ?? ''}|fac[${p.facility_ids.join(',')}]`);
  }
  parts.push(`hand[${state.players[player].hand.join(',')}]`);
  parts.push(`oppHandN${state.players[OTHER_PLAYER[player]].hand.length}`);
  const units = boardEntities(state)
    .map((unit) =>
      `${unit.card_instance_id}@${unit.board_half}:${unit.lane}:${unit.position}:${unit.slot_index ?? 1}`
      + `|hp${unit.operator_combat?.current_hp}|atk${getEntityStats(state, unit).atk}|sh${unit.operator_combat?.shield}`
      + `|eq${unit.operator_combat?.equipped_package?.card_id ?? ''}`
      + `|st[${unit.operator_combat?.statuses.map((status) => `${status.kind}:${status.remaining_owner_turns}:${status.stacks ?? 1}`).join(',')}]`,
    )
    .sort();
  parts.push(`units[${units.join(';')}]`);
  parts.push(`pend[${state.pending_effect_choices.map((choice) => `${choice.source_instance_id}:${choice.effect}:${choice.amount}`).join(',')}]`);
  return parts.join('#');
}

function describeAction(action: GameAction): string {
  switch (action.type) {
    case 'deploy_operator':
      return `deploy ${action.card_instance_id} → ${action.lane}/${action.position}#${action.slot_index ?? 1}`;
    case 'play_card':
      return `play ${action.card_instance_id}${action.target_instance_id ? ` → ${action.target_instance_id}` : action.target_lane ? ` → ${action.target_lane}` : ''}`;
    case 'withdraw_operator':
      return `withdraw ${action.card_instance_id}`;
    case 'recall_summon':
      return `recall ${action.card_instance_id}`;
    case 'set_focus_target':
      return `focus ${action.target_instance_id ?? 'clear'}`;
    case 'activate_skill':
      return `skill ${action.card_instance_id}${action.target_instance_id ? ` → ${action.target_instance_id}` : ''}`;
    case 'resolve_pending_choice':
      return `resolve ${action.source_instance_id}${action.choice_id ? `:${action.choice_id}` : ''}${action.target_instance_id ? ` → ${action.target_instance_id}` : ''}`;
    case 'end_action_phase':
      return 'end action phase';
    case 'surrender':
      return 'surrender';
  }
}

export class BotPlayer {
  readonly player: PlayerId;
  readonly difficulty: BotDifficulty;

  private readonly rng: () => number;
  private readonly log?: (message: string) => void;
  private readonly watchdog: Required<BotWatchdogOptions>;
  private readonly memory = new Map<string, number>();
  private readonly memoryOrder: string[] = [];
  private readonly telemetryInternal = { decisions: 0, watchdogStops: 0, repetitionStops: 0, fallbacks: 0 };

  constructor(options: BotOptions) {
    this.player = options.player;
    this.difficulty = options.difficulty ?? 'normal';
    this.rng = options.rng ?? Math.random;
    this.log = options.log;
    this.watchdog = { ...DEFAULT_WATCHDOG, ...options.watchdog };
  }

  getTelemetry(): BotTelemetry {
    return { ...this.telemetryInternal };
  }

  noteFallback(reason: string): void {
    this.telemetryInternal.fallbacks += 1;
    this.log?.(`[bot:${this.player}] 回退动作（${reason}）。`);
  }

  decide(state: GameState): GameAction {
    this.telemetryInternal.decisions += 1;
    if (this.telemetryInternal.decisions > this.watchdog.maxDecisionsPerMatch) {
      this.telemetryInternal.watchdogStops += 1;
      this.log?.(`[bot:${this.player}] watchdog：本局决策次数超过 ${this.watchdog.maxDecisionsPerMatch}，强制保守动作。`);
      return this.safeFallback(state, 'max-decisions');
    }
    const legal = enumerateLegalActions(state, this.player);
    if (legal.length === 0) throw new Error(`[bot:${this.player}] 决策点没有任何合法动作。`);
    const hash = stateHashForRepetition(state, this.player);
    const seenCount = this.memory.get(hash) ?? 0;
    let candidates = legal;
    let mode = 'normal';
    if (seenCount >= 2) {
      const advancing = legal.filter(
        (action) =>
          action.type === 'deploy_operator' ||
          action.type === 'play_card' ||
          action.type === 'resolve_pending_choice' ||
          action.type === 'end_action_phase',
      );
      if (advancing.length > 0) {
        candidates = advancing;
        mode = 'repetition-guard';
        this.telemetryInternal.repetitionStops += 1;
        this.log?.(`[bot:${this.player}] 重复状态检测：限制为推进型动作。`);
      }
    }
    const scored = this.scoreAll(state, candidates, Date.now() + this.watchdog.maxMsPerDecision);
    scored.sort((a, b) => b.score - a.score);
    this.recordHash(hash);
    const best = scored[0];
    if (!best) {
      return this.safeFallback(state, 'empty-scored');
    }
    this.log?.(`[bot:${this.player}] turn${state.turn_number} ${mode} → ${describeAction(best.action)} score=${best.score.toFixed(2)} considered=${scored.length}`);
    return best.action;
  }

  private recordHash(hash: string): void {
    this.memory.set(hash, (this.memory.get(hash) ?? 0) + 1);
    this.memoryOrder.push(hash);
    while (this.memoryOrder.length > 32) {
      const oldest = this.memoryOrder.shift() as string;
      const count = (this.memory.get(oldest) ?? 1) - 1;
      if (count <= 0) this.memory.delete(oldest);
      else this.memory.set(oldest, count);
    }
  }

  private safeFallback(state: GameState, reason: string): GameAction {
    this.telemetryInternal.fallbacks += 1;
    const legal = enumerateLegalActions(state, this.player);
    const end = legal.find((action) => action.type === 'end_action_phase');
    if (end) return end;
    const skip = legal.find((action) => action.type === 'resolve_pending_choice');
    if (skip) return skip;
    const first = legal[0];
    this.log?.(`[bot:${this.player}] watchdog(${reason})：使用兜底动作 ${describeAction(first)}。`);
    return first;
  }

  private scoreAll(state: GameState, candidates: readonly GameAction[], deadline: number): ScoredAction[] {
    const out: ScoredAction[] = [];
    let scored = 0;
    for (const action of candidates) {
      if (scored >= this.watchdog.maxScoredActions || (scored > 0 && scored % 64 === 0 && Date.now() > deadline)) {
        this.telemetryInternal.watchdogStops += 1;
        this.log?.(`[bot:${this.player}] watchdog：单次决策预算用尽（已评分 ${scored} 个动作）。`);
        break;
      }
      out.push({ action, score: this.scoreAction(state, action) + this.rng() * 0.05 });
      scored += 1;
    }
    return out;
  }

  private scoreAction(state: GameState, action: GameAction): number {
    switch (action.type) {
      case 'end_action_phase':
        return 0;
      case 'surrender':
        return -9999;
      case 'resolve_pending_choice':
        return this.scorePendingChoice(state, action);
      case 'deploy_operator':
        return this.scoreDeploy(state, action);
      case 'play_card':
        return this.scorePlayCard(state, action);
      case 'withdraw_operator':
        return this.scoreNormalWithdrawal(state, action);
      case 'recall_summon':
        return this.scoreRecallSummon(state, action);
      case 'set_focus_target':
        return this.scoreFocusTarget(state, action);
      default:
        return -1;
    }
  }

  private scoreDeploy(state: GameState, action: Extract<GameAction, { type: 'deploy_operator' }>): number {
    const instance = state.card_instances[action.card_instance_id];
    const definition = instance ? state.card_definitions[instance.card_id] : undefined;
    if (!definition) return -1;
    const own = state.players[this.player];
    const enemy = state.players[OTHER_PLAYER[this.player]];
    const lane = normalizeLaneId(state.board_profile, action.lane);
    let score = definitionWorth(definition) - definition.cost * 0.65;

    const allBoard = boardEntities(state);
    const ownUnits = allBoard.filter((u) => u.controller_id === this.player);
    const enemyUnits = allBoard.filter((u) => u.controller_id !== this.player && !isDisabledControl(u));
    const ownInLane = ownUnits.filter((u) => u.lane && normalizeLaneId(state.board_profile, u.lane) === lane).length;
    const enemyInLane = enemyUnits.filter((u) => u.lane && normalizeLaneId(state.board_profile, u.lane) === lane).length;

    if (ownInLane === 0) score += 1.2;
    if (enemyInLane > 0 && ownInLane === 0) score += 1.1;
    if (enemyInLane === 0) score += 1.0;
    if (enemy.base_points <= 8 && enemyInLane === 0) score += 0.9;
    if (own.base_points <= 8 && enemyInLane > 0) score += 0.9;
    if (definition.attack_type === 'ranged' && action.position === 'back') score += 0.35;
    if (definition.attack_type === 'melee' && action.position === 'front') score += 0.35;

    // 回合末 CP 会清零，因此只要部署明显正收益即优先花光可用 CP
    score += Math.min(2.0, definition.cost * 0.25);

    for (const block of definition.skill_effects ?? []) {
      if (block.trigger === 'on_deploy') {
        for (const op of block.effects) {
          if (op.op === 'grant_supply') score += Number(op.amount ?? 1) * 0.5;
          if (op.op === 'grant_shield') score += Number(op.amount ?? 1) * 0.3;
          if (op.op === 'deal_damage' && enemyInLane > 0) score += 0.8;
        }
      }
    }
    return score;
  }

  private scorePlayCard(state: GameState, action: Extract<GameAction, { type: 'play_card' }>): number {
    const instance = state.card_instances[action.card_instance_id];
    const definition = instance ? state.card_definitions[instance.card_id] : undefined;
    if (!definition) return -1;
    if (definition.card_type === 'support' || definition.card_type === 'facility') {
      return this.scoreSupport(state, action, definition);
    }

    const target = action.target_instance_id ? state.card_instances[action.target_instance_id] : undefined;
    const targetDef = target ? state.card_definitions[target.card_id] : undefined;
    const cardId = definition.card_id;

    // 针对 24 张 V1.1 战术卡的清晰启发式评分
    switch (cardId) {
      case 'DEMO-TAC-V2-005' as CardId: // 定点爆破 (3 CP, 4伤)
      case 'DEMO-TAC-V2-007' as CardId: // 后排狙杀 (3 CP, 3伤+压制)
      case 'DEMO-TAC-V2-008' as CardId: // 反召唤弹 (2 CP, 3伤)
      case 'DEMO-TAC-V2-017' as CardId: // 破甲弹 (3 CP, 破掩护护盾+2伤)
      case 'DEMO-TAC-V2-018' as CardId: // 电磁干扰 (3 CP, 1或3伤)
      case 'DEMO-TAC-V2-016' as CardId: // 推进行动 (3 CP, 移位+1伤+压制)
      {
        if (!target?.operator_combat || !targetDef) return -1;
        const stats = getEntityStats(state, target);
        const totalHp = stats.currentHp + stats.shield;
        const estDmg = cardId === ('DEMO-TAC-V2-005' as CardId) ? 4 : cardId === ('DEMO-TAC-V2-007' as CardId) ? 3 : cardId === ('DEMO-TAC-V2-017' as CardId) ? 2 : 1.5;
        let score = Math.min(estDmg, totalHp) * 0.75 + stats.atk * 0.15 - definition.cost * 0.55;
        if (estDmg >= totalHp) score += definitionWorth(targetDef) * 0.6;
        return score;
      }
      case 'DEMO-TAC-V2-006' as CardId: { // 破片齐射 (4 CP)
        const enemies = boardEntities(state).filter((u) => u.controller_id !== this.player && getEntityKind(state, u) === 'operator');
        return enemies.length * 0.9 - definition.cost * 0.55;
      }
      case 'DEMO-TAC-V2-014' as CardId: { // 全线压制 (4 CP)
        const lanesSet = new Set((action.target_lanes ?? []).map((l) => normalizeLaneId(state.board_profile, l)));
        const count = boardEntities(state).filter(
          (u) => u.controller_id !== this.player && u.lane && lanesSet.has(normalizeLaneId(state.board_profile, u.lane)),
        ).length;
        return count * 0.7 - definition.cost * 0.55;
      }
      case 'DEMO-TAC-V2-003' as CardId: // 战线集结
      case 'DEMO-TAC-V2-011' as CardId: { // 防线固守
        if (!action.target_lane) return -1;
        const tLane = normalizeLaneId(state.board_profile, action.target_lane);
        const ownCount = boardEntities(state).filter(
          (u) => u.controller_id === this.player && getEntityKind(state, u) !== 'facility' && u.lane && normalizeLaneId(state.board_profile, u.lane) === tLane,
        ).length;
        return ownCount * 1.15 - definition.cost * 0.55;
      }
      case 'DEMO-TAC-V2-009' as CardId: { // 急救包 (2 CP, 治疗2)
        if (!target?.operator_combat) return -1;
        const missing = Math.max(0, getEntityStats(state, target).maxHp - target.operator_combat.current_hp);
        return Math.min(2, missing) * 0.85 - definition.cost * 0.55;
      }
      case 'DEMO-TAC-V2-010' as CardId: { // 紧急护盾 (2 CP, 护盾2)
        if (!target?.operator_combat) return -1;
        return 1.3 + (target.position === 'front' ? 0.4 : 0) - definition.cost * 0.55;
      }
      case 'DEMO-TAC-V2-013' as CardId: // 压制射击
      case 'DEMO-TAC-V2-019' as CardId: // 清障行动
      case 'DEMO-TAC-V2-020' as CardId: // 设施破坏
        return target ? 1.4 - definition.cost * 0.55 : -1;
      case 'DEMO-TAC-V2-002' as CardId: // 空降部署 (1 CP, 下次部署 -2)
        return state.players[this.player].hand.length >= 2 ? 1.5 : -0.5;
      case 'DEMO-TAC-V2-021' as CardId: // 战术分析
        return 0.9;
      case 'DEMO-TAC-V2-022' as CardId: // 集火标记
      case 'DEMO-TAC-V2-023' as CardId: // 先发制人
      case 'DEMO-TAC-V2-024' as CardId: // 越线校准
        return target ? 1.6 - definition.cost * 0.5 : -1;
      case 'DEMO-TAC-V2-004' as CardId: { // 预备队换班 (退回满血/重部署减费)
        if (!target?.operator_combat || !target.lane) return -1;
        const dying = laneThreat(state, this.player, target.lane) >= target.operator_combat.current_hp + target.operator_combat.shield;
        return dying ? 1.8 : -1.0;
      }
      default:
        return 0.4 - definition.cost * 0.4;
    }
  }

  private scoreSupport(state: GameState, action: Extract<GameAction, { type: 'play_card' }>, definition: CardDefinition): number {
    if (definition.card_type === 'facility' || definition.support_subtype === 'facility') {
      // 后排格位优先放置设施，避免占用前排阻挡格位
      const rowBonus = action.target_position === 'back' ? 0.8 : -0.4;
      return 1.8 + rowBonus - definition.cost * 0.55;
    }
    if (definition.card_type === 'support') {
      const target = action.target_instance_id ? state.card_instances[action.target_instance_id] : undefined;
      if (!target?.operator_combat) return -1;
      // 尽量不浪费已经装有同档装备的单位，优先前排或高攻输出位
      const hasEquipPenalty = target.operator_combat.equipped_package ? -1.4 : 0.4;
      const frontBonus = target.position === 'front' ? 0.35 : 0.15;
      return 1.2 + hasEquipPenalty + frontBonus - definition.cost * 0.55;
    }
    return -1;
  }

  private scoreNormalWithdrawal(state: GameState, action: Extract<GameAction, { type: 'withdraw_operator' }>): number {
    const target = state.card_instances[action.card_instance_id];
    if (!target?.operator_combat || !target.lane || target.controller_id !== this.player) return -1;
    const targetDefinition = state.card_definitions[target.card_id];
    const dying = laneThreat(state, this.player, target.lane) >= target.operator_combat.current_hp + target.operator_combat.shield;
    if (!dying) return -2.0; // V1.1 无退款，只在可保存高价值干员免阵亡时撤离
    return definitionWorth(targetDefinition) * 0.45 + 0.1;
  }

  private scoreRecallSummon(state: GameState, action: Extract<GameAction, { type: 'recall_summon' }>): number {
    const summon = state.card_instances[action.card_instance_id];
    if (!summon?.summon_state || !summon.lane) return -2;
    // 只有像水獭/虚影这类带亡语爆破的召唤物，且对面有敌人或即将占用紧急格子时才回收
    const hasDeathrattle = summon.summon_state.token_id === 'meebo' || summon.summon_state.token_id === 'phantom_shadow';
    if (!hasDeathrattle) return -2.5;
    const canonicalLane = normalizeLaneId(state.board_profile, summon.lane);
    const enemyInLane = boardEntities(state).filter(
      (u) => u.controller_id !== this.player && u.lane && normalizeLaneId(state.board_profile, u.lane) === canonicalLane,
    ).length;
    return enemyInLane >= 2 ? 0.8 : -1.5;
  }

  private scoreFocusTarget(state: GameState, action: Extract<GameAction, { type: 'set_focus_target' }>): number {
    if (!action.target_instance_id) return -0.8;
    if (state.players[this.player].focus_target_id) return -0.9; // 若本回合已设置过则不反复切换
    const target = state.card_instances[action.target_instance_id];
    if (!target?.operator_combat) return -1;
    const stats = getEntityStats(state, target);
    const lowHp = stats.currentHp <= 2 ? 0.9 : 0;
    return 0.6 + stats.atk * 0.25 + lowHp;
  }

  private scorePendingChoice(state: GameState, action: Extract<GameAction, { type: 'resolve_pending_choice' }>): number {
    const pending = state.pending_effect_choices[0];
    if (!pending) return 0.1;
    if (pending.effect === 'choose_summon') {
      return action.choice_id === 'magallan_strike_drone' ? 2.5 : 2.0;
    }
    if (pending.effect === 'choose_discard') {
      const card = action.target_instance_id ? state.card_instances[action.target_instance_id] : undefined;
      const def = card ? state.card_definitions[card.card_id] : undefined;
      // 弃掉最高费暂时打不出的卡或多余的低价值卡
      return def ? (def.cost >= 5 ? 2.0 : 1.0 - def.cost * 0.1) : 0.5;
    }
    if (!action.target_instance_id) return 0.2;
    const target = state.card_instances[action.target_instance_id];
    if (!target?.operator_combat) return -1;
    return 1.8 + (target.position === 'front' ? 0.4 : 0) + (target.operator_combat.current_hp <= 2 ? 0.3 : 0);
  }
}

/** 起手换牌策略：换掉大于本回合自然费用的高费非干员卡。 */
export function botMulliganChoice(state: GameState, player: PlayerId): readonly CardInstanceId[] {
  const swaps: CardInstanceId[] = [];
  for (const id of state.players[player].hand) {
    const instance = state.card_instances[id];
    const definition = instance ? state.card_definitions[instance.card_id] : undefined;
    if (!definition) continue;
    if (definition.card_type !== 'operator' && definition.cost >= 4) swaps.push(id);
    else if (definition.cost >= 5) swaps.push(id);
  }
  return swaps;
}
