import type { CombatLogEvent, GameState, PlayerId } from '../../game/types';

export type BattleMissionKind =
  | 'deploy_operators'
  | 'deal_damage'
  | 'base_damage'
  | 'defeat_enemies'
  | 'activate_skills'
  | 'use_tactics_or_facilities';

export interface BattleMissionItem {
  readonly id: string;
  readonly kind: BattleMissionKind;
  readonly title: string;
  readonly description: string;
  readonly current: number;
  readonly target: number;
  readonly completed: boolean;
  readonly rewardOriginite: number;
}

export interface BattleMissionReport {
  readonly matchKey: string;
  readonly missions: readonly BattleMissionItem[];
  readonly completedCount: number;
  readonly totalCount: number;
  readonly totalEarnedOriginite: number;
}

function hashSeed(input: string | number): number {
  const str = String(input);
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function resolveMatchSeed(state: GameState, seed?: number): number {
  if (typeof seed === 'number' && Number.isFinite(seed) && seed !== 0) {
    return Math.abs(Math.trunc(seed));
  }
  const deckFingerprint = Object.values(state.card_instances)
    .sort((a, b) => a.card_instance_id.localeCompare(b.card_instance_id))
    .slice(0, 12)
    .map((inst) => inst.card_id)
    .join(',');
  return hashSeed(`${state.board_profile.profileId}:${deckFingerprint}`);
}

interface MissionTemplate {
  readonly kind: BattleMissionKind;
  readonly title: string;
  readonly targets: readonly number[];
  readonly rewardPerStep: number;
  readonly formatDesc: (target: number) => string;
}

const DEPLOY_TEMPLATE: MissionTemplate = {
  kind: 'deploy_operators',
  title: '先锋进场整备',
  targets: [3, 4, 5],
  rewardPerStep: 100,
  formatDesc: (target) => `本局累计部署至少 ${target} 名干员`,
};

const DAMAGE_TEMPLATE: MissionTemplate = {
  kind: 'deal_damage',
  title: '战术火力压制',
  targets: [8, 10, 12],
  rewardPerStep: 40,
  formatDesc: (target) => `本局对敌方累计造成至少 ${target} 点伤害`,
};

const SECONDARY_TEMPLATES: readonly MissionTemplate[] = [
  {
    kind: 'defeat_enemies',
    title: '防线清剿行动',
    targets: [2, 3],
    rewardPerStep: 200,
    formatDesc: (target) => `击倒至少 ${target} 名敌方在场单位`,
  },
  {
    kind: 'base_damage',
    title: '核心突防直击',
    targets: [4, 6],
    rewardPerStep: 100,
    formatDesc: (target) => `对敌方基地造成至少 ${target} 点直接伤害`,
  },
  {
    kind: 'activate_skills',
    title: '干员技能协同',
    targets: [1, 2],
    rewardPerStep: 250,
    formatDesc: (target) => `在实战中主动发动至少 ${target} 次干员技能`,
  },
  {
    kind: 'use_tactics_or_facilities',
    title: '战术设施调配',
    targets: [2, 3],
    rewardPerStep: 150,
    formatDesc: (target) => `使用至少 ${target} 张战术、设施或支援卡牌`,
  },
];

function computeMetricsForPlayer(
  state: GameState,
  logHistory: readonly CombatLogEvent[],
  playerId: PlayerId,
): Record<BattleMissionKind, number> {
  const counts: Record<BattleMissionKind, number> = {
    deploy_operators: 0,
    deal_damage: 0,
    base_damage: 0,
    defeat_enemies: 0,
    activate_skills: 0,
    use_tactics_or_facilities: 0,
  };

  for (const event of logHistory) {
    const srcPlayer =
      event.source_player_id ??
      (event.source_instance_id ? state.card_instances[event.source_instance_id]?.owner_id : undefined) ??
      (event.type !== 'base_damaged' ? event.player_id : undefined);
    const tgtPlayer =
      event.target_player_id ??
      (event.target_instance_id ? state.card_instances[event.target_instance_id]?.owner_id : undefined) ??
      (event.type === 'base_damaged' ? event.player_id : undefined);

    if (event.type === 'unit_deployed' && srcPlayer === playerId) {
      counts.deploy_operators += 1;
    } else if (event.type === 'damage_resolved' && srcPlayer === playerId && typeof event.amount === 'number') {
      counts.deal_damage += Math.max(0, event.amount);
    } else if (event.type === 'base_damaged' && srcPlayer === playerId && typeof event.amount === 'number') {
      const dmg = Math.max(0, event.amount);
      counts.deal_damage += dmg;
      counts.base_damage += dmg;
    } else if (event.type === 'unit_defeated') {
      const killer =
        srcPlayer ??
        (tgtPlayer === 'player_a' ? 'player_b' : tgtPlayer === 'player_b' ? 'player_a' : undefined);
      if (killer === playerId) {
        counts.defeat_enemies += 1;
      }
    } else if (event.type === 'skill_activated' && srcPlayer === playerId) {
      counts.activate_skills += 1;
    } else if (event.type === 'facility_deployed' && srcPlayer === playerId) {
      counts.use_tactics_or_facilities += 1;
    } else if (event.type === 'effect_triggered' && srcPlayer === playerId && event.source_instance_id) {
      const inst = state.card_instances[event.source_instance_id];
      const cardType = inst ? state.card_definitions[inst.card_id]?.card_type : undefined;
      if (cardType === 'tactic' || cardType === 'support' || cardType === 'facility') {
        counts.use_tactics_or_facilities += 1;
      }
    }
  }

  return counts;
}

/**
 * 基于单局对局种子与实时日志生成并评估 3 项动态演习任务。
 */
export function evaluateBattleMissions(params: {
  readonly state: GameState;
  readonly logHistory: readonly CombatLogEvent[];
  readonly playerId: PlayerId;
  readonly seed?: number;
}): BattleMissionReport {
  const { state, logHistory, playerId, seed } = params;
  const matchSeed = resolveMatchSeed(state, seed);
  const metrics = computeMetricsForPlayer(state, logHistory, playerId);

  const deployTarget = DEPLOY_TEMPLATE.targets[matchSeed % DEPLOY_TEMPLATE.targets.length]!;
  const damageTarget = DAMAGE_TEMPLATE.targets[(matchSeed >>> 3) % DAMAGE_TEMPLATE.targets.length]!;
  const secondaryTemplate = SECONDARY_TEMPLATES[(matchSeed >>> 6) % SECONDARY_TEMPLATES.length]!;
  const secondaryTarget = secondaryTemplate.targets[(matchSeed >>> 9) % secondaryTemplate.targets.length]!;

  const specs: readonly { readonly template: MissionTemplate; readonly target: number; readonly reward: number }[] = [
    { template: DEPLOY_TEMPLATE, target: deployTarget, reward: deployTarget * DEPLOY_TEMPLATE.rewardPerStep },
    { template: DAMAGE_TEMPLATE, target: damageTarget, reward: damageTarget * DAMAGE_TEMPLATE.rewardPerStep },
    { template: secondaryTemplate, target: secondaryTarget, reward: Math.max(300, secondaryTarget * secondaryTemplate.rewardPerStep) },
  ];

  const missions: BattleMissionItem[] = specs.map((spec, idx) => {
    const current = metrics[spec.template.kind];
    const completed = current >= spec.target;
    return {
      id: `mission-${matchSeed}-${idx}`,
      kind: spec.template.kind,
      title: spec.template.title,
      description: spec.template.formatDesc(spec.target),
      current,
      target: spec.target,
      completed,
      rewardOriginite: spec.reward,
    };
  });

  const completedCount = missions.filter((m) => m.completed).length;
  const totalEarnedOriginite = missions.reduce(
    (sum, item) => sum + (item.completed ? item.rewardOriginite : 0),
    0,
  );

  return {
    matchKey: `match-${matchSeed}-${playerId}`,
    missions,
    completedCount,
    totalCount: missions.length,
    totalEarnedOriginite,
  };
}
