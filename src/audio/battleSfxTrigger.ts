import { playCombatAudioCues, playCombatSfx, type CombatAudioCue, type CombatSfxKind } from './combatSfx';
import type { CombatLogEvent, GameAction, GameState, PlayerId } from '../game/types';

export type BattleSfxCategory = 'deploy' | 'attack' | 'damage' | 'skill';

export interface ResolvedBattleSfxCue {
  readonly category: BattleSfxCategory;
  readonly kind: CombatSfxKind;
  readonly delayMs?: number;
}

/**
 * 玩家操作触发的即时音效映射：
 * - 部署干员 / 部署设施 → 'deploy' / 'deploy_elite'
 * - 主动技能 / 战术支持卡 → 'skill'
 */
export function resolveActionSfx(
  action: GameAction,
  state: GameState,
): { readonly category: BattleSfxCategory; readonly kind: CombatSfxKind } | null {
  if (action.type === 'deploy_operator') {
    const inst = state.card_instances[action.card_instance_id];
    const rarity = inst ? (state.card_definitions[inst.card_id]?.rarity ?? 3) : 3;
    return {
      category: 'deploy',
      kind: rarity >= 5 ? 'deploy_elite' : 'deploy',
    };
  }
  if (action.type === 'play_card') {
    const inst = state.card_instances[action.card_instance_id];
    const def = inst ? state.card_definitions[inst.card_id] : undefined;
    const isFacility =
      def?.card_type === 'facility' ||
      (def?.card_type === 'support' && def?.support_subtype === 'facility');
    if (isFacility) {
      return { category: 'deploy', kind: 'deploy' };
    }
    return { category: 'skill', kind: 'skill' };
  }
  if (action.type === 'activate_skill') {
    return { category: 'skill', kind: 'skill' };
  }
  return null;
}

/**
 * 根据战斗引擎日志事件解析‘部署’、‘普通攻击’、‘受到伤害’、‘释放技能’四类核心音效。
 */
export function resolveCombatEventSfx(
  event: CombatLogEvent,
  state: GameState,
  bottomPlayer: PlayerId,
): ResolvedBattleSfxCue | null {
  if (
    event.type === 'unit_deployed' ||
    event.type === 'facility_deployed' ||
    event.type === 'summon_created'
  ) {
    const inst = event.source_instance_id ? state.card_instances[event.source_instance_id] : undefined;
    const rarity = inst ? (state.card_definitions[inst.card_id]?.rarity ?? 3) : 3;
    return {
      category: 'deploy',
      kind: rarity >= 5 ? 'deploy_elite' : 'deploy',
    };
  }

  if (event.type === 'attack_declared') {
    const inst = event.source_instance_id ? state.card_instances[event.source_instance_id] : undefined;
    const def = inst ? state.card_definitions[inst.card_id] : undefined;
    const isRanged = inst?.summon_state?.attack_type === 'ranged' || def?.attack_type === 'ranged';
    return {
      category: 'attack',
      kind: isRanged ? 'strike_ranged' : 'strike_melee',
    };
  }

  if (event.type === 'base_damaged' && (event.amount ?? 0) > 0) {
    return {
      category: 'damage',
      kind: 'base_hit',
    };
  }

  if (event.type === 'damage_resolved' && (event.amount ?? 0) > 0) {
    const targetInst = event.target_instance_id ? state.card_instances[event.target_instance_id] : undefined;
    const targetOwner = event.target_player_id ?? targetInst?.owner_id;
    return {
      category: 'damage',
      kind: targetOwner === bottomPlayer ? 'damage_taken' : 'hit',
    };
  }

  if (
    event.type === 'skill_activated' ||
    event.type === 'reaction_triggered' ||
    event.type === 'effect_triggered'
  ) {
    return {
      category: 'skill',
      kind: 'skill',
    };
  }

  return null;
}

/**
 * 触发单次玩家交互动作的即时战斗音效。
 */
export function triggerBattleActionSfx(action: GameAction, state: GameState): BattleSfxCategory | null {
  const resolved = resolveActionSfx(action, state);
  if (!resolved) return null;
  playCombatSfx(resolved.kind);
  return resolved.category;
}

/**
 * 批量触发战斗日志事件对应的音效回馈（按类别去重并错峰编排时间轴，避免音频叠音刺耳）。
 */
export function triggerBattleEventsSfx(
  events: readonly CombatLogEvent[],
  state: GameState,
  bottomPlayer: PlayerId,
  options?: { readonly skipCategories?: ReadonlySet<BattleSfxCategory> },
): readonly ResolvedBattleSfxCue[] {
  const resolvedList: ResolvedBattleSfxCue[] = [];
  const seenKinds = new Set<CombatSfxKind>();

  for (const event of events) {
    const cue = resolveCombatEventSfx(event, state, bottomPlayer);
    if (!cue) continue;
    if (options?.skipCategories?.has(cue.category)) continue;
    if (seenKinds.has(cue.kind)) continue;
    seenKinds.add(cue.kind);
    resolvedList.push({
      ...cue,
      delayMs: resolvedList.length * 55,
    });
    if (resolvedList.length >= 6) break;
  }

  if (resolvedList.length > 0) {
    const audioCues: CombatAudioCue[] = resolvedList.map((item) => ({
      kind: item.kind,
      ...(item.delayMs ? { delayMs: item.delayMs } : {}),
    }));
    playCombatAudioCues(audioCues);
  }

  return resolvedList;
}
