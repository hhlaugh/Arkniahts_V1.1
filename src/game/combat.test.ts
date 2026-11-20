import { describe, expect, it } from 'vitest';
import { loadDemoData } from '../data/load-card-data';
import { createInitialGameState, mulligan, reduceGameAction, advancePhase } from './engine';
import {
  applyEffectDamage,
  applyStatusToInstance,
  expireStatusesAtTurnStart,
  resolveCombat,
} from './combat';
import { resolveDamagePipeline } from './combat-primitives';
import type { CardId, CardInstance, CardInstanceId, GameState, HpValue, LaneId, PlayerId, StatusKind } from './types';

const data = loadDemoData();
const testFixtures: any[] = [
  {
    card_id: 'OP-TEST-FLOAT',
    card_name_zh: '测试浮空单位',
    card_type: 'operator',
    rarity: 3,
    cost: 1,
    hp: 2,
    atk: 1,
    class: 'supporter',
    attack_type: 'ranged',
    deploy_rule: 'back_only',
    floating: true,
    taunt_scope: 'none',
    deck_copy_limit: 2,
    max_sp: 0,
    starting_sp: 0,
    sp_regen_per_turn: 0,
    sp_gain_on_attacked: 0,
    sp_gain_on_damaged: 0,
    sp_gain_on_kill: 0,
    redeploy_cd_base: 2,
    effect_trigger: 'none',
    effect_json: { trigger: 'none', actions: [] },
  },
  {
    card_id: 'TEST-TAC-FREEZE',
    card_name_zh: '冰霜发生器测试',
    card_type: 'tactic',
    rarity: 4,
    cost: 1,
    deck_copy_limit: 2,
    skill_effects: [
      {
        trigger: 'on_play',
        effects: [{ op: 'apply_status', target: 'selected_enemy_operator', status_id: 'freeze' }],
      },
    ],
    effect_trigger: 'on_play',
    effect_json: {
      trigger: 'on_play',
      actions: [{ type: 'apply_status', target: 'chosen_enemy_operator', status: 'freeze', duration_owner_turns: 1 }],
    },
  },
];

const cards = [...data.validCards, ...testFixtures];
const uniqueCards = (() => {
  const list: typeof cards = [];
  const seen = new Set<string>();
  for (const c of cards) {
    if (!seen.has(c.card_name_zh)) {
      seen.add(c.card_name_zh);
      list.push(c);
    }
  }
  return list;
})();
const id = (s: string) => s as CardId;

const CANONICAL_LANE: Record<string, LaneId> = {
  left: 'L1',
  center: 'L2',
  right: 'L3',
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
};

function emptyFight(): GameState {
  const deck = {
    deck_id: 'FIGHT',
    deck_name_zh: '测试',
    cards: [...uniqueCards.map((c) => ({ card_id: c.card_id, quantity: 1 })), { card_id: id('OP-GUA-001'), quantity: 1 }],
  };
  let state = createInitialGameState({
    decks: { player_a: deck, player_b: { ...deck, deck_id: 'FIGHT-B' } },
    cards,
    seed: 4,
  });
  const a = mulligan(state, 'player_a', []);
  if (!a.ok) throw new Error(a.reason);
  const b = mulligan(a.value, 'player_b', []);
  if (!b.ok) throw new Error(b.reason);
  state = b.value;
  return {
    ...state,
    phase: 'combat',
    active_player_id: 'player_a',
    players: {
      ...state.players,
      player_a: { ...state.players.player_a, turns_taken: 1, own_turn_index: 1 },
      player_b: { ...state.players.player_b, turns_taken: 1, own_turn_index: 1 },
    },
    card_instances: { ...state.card_instances },
  };
}

function put(
  state: GameState,
  player: PlayerId,
  cardId: string,
  lane: 'left' | 'center' | 'right' | 'L1' | 'L2' | 'L3',
  position: 'front' | 'back',
  options: { hp?: number; sp?: number; shield?: number; statuses?: NonNullable<CardInstance['operator_combat']>['statuses'] } = {},
): [GameState, CardInstanceId] {
  const instance = Object.values(state.card_instances).find(
    (i) => i.owner_id === player && i.card_id === id(cardId) && (i.zone === 'deck' || i.zone === 'hand'),
  );
  if (!instance) throw new Error(`missing ${player}:${cardId}`);
  const definition = state.card_definitions[instance.card_id];
  const canonicalLane = CANONICAL_LANE[lane] ?? lane;
  const placed: CardInstance = {
    ...instance,
    zone: 'board',
    board_half: player,
    lane: canonicalLane,
    position,
    slot_index: 1,
    operator_combat: {
      current_hp: (options.hp ?? definition.hp ?? 1) as HpValue,
      current_atk_modifiers: [],
      current_sp: (options.sp ?? 0) as never,
      shield: options.shield ?? 0,
      statuses: options.statuses ? [...options.statuses] : [],
      equipment_ids: [],
    },
    operator_lifecycle: {
      redeploy_cd_remaining: 0,
      redeploy_cd_applied_owner_turn_index: null,
      has_deployed_before: true,
      entered_battle_this_owner_turn: false,
      paid_deploy_cost: 1 as never,
      once_per_game_flags: {},
    },
  };
  const playerState = state.players[player];
  return [
    {
      ...state,
      players: {
        ...state.players,
        [player]: {
          ...playerState,
          hand: playerState.hand.filter((x) => x !== instance.card_instance_id),
          deck: playerState.deck.filter((x) => x !== instance.card_instance_id),
        },
      },
      card_instances: { ...state.card_instances, [instance.card_instance_id]: placed },
    },
    instance.card_instance_id,
  ];
}

function handCard(state: GameState, player: PlayerId, cardId: string, cost = 10): [GameState, CardInstanceId] {
  const instance = Object.values(state.card_instances).find(
    (i) => i.owner_id === player && i.card_id === id(cardId) && (i.zone === 'deck' || i.zone === 'hand'),
  );
  if (!instance) throw new Error(`missing hand fixture ${cardId}`);
  const p = state.players[player];
  return [
    {
      ...state,
      players: {
        ...state.players,
        [player]: {
          ...p,
          cost: cost as never,
          deck: p.deck.filter((x) => x !== instance.card_instance_id),
          hand: [...p.hand.filter((x) => x !== instance.card_instance_id), instance.card_instance_id],
        },
      },
      card_instances: {
        ...state.card_instances,
        [instance.card_instance_id]: { ...instance, zone: 'hand' },
      },
    },
    instance.card_instance_id,
  ];
}

const status = (kind: StatusKind, turns = 1) =>
  [
    {
      kind,
      remaining_owner_turns: turns,
      applied_on_owner_turn_index: 0,
      expire_at_node: 'owner_turn_start' as const,
      blocks_normal_withdrawal: kind === 'stun' || kind === 'freeze',
    },
  ] as const;

describe('automatic combat target selection and settlement', () => {
  it('runs only active player attacks in lane/front-back order and retargets after each death', () => {
    let s = emptyFight();
    let aFront: CardInstanceId;
    let aBack: CardInstanceId;
    let bFront: CardInstanceId;
    let bBack: CardInstanceId;
    [s, aFront] = put(s, 'player_a', 'OP-GUA-001', 'L1', 'front');
    [s, aBack] = put(s, 'player_a', 'OP-GUA-001', 'L1', 'back');
    [s, bFront] = put(s, 'player_b', 'OP-GUA-001', 'L1', 'front', { hp: 2 });
    [s, bBack] = put(s, 'player_b', 'OP-GUA-001', 'L1', 'back', { hp: 3 });
    s = resolveCombat(s);
    const attacks = s.combat_log.filter((e) => e.type === 'attack_declared');
    expect(attacks.map((e) => e.source_instance_id)).toEqual([aFront, aBack]);
    expect(attacks.map((e) => e.target_instance_id)).toEqual([bFront, bBack]);
    expect(s.players.player_b.discard).toContain(bFront);
    expect(s.card_instances[bBack].operator_combat?.current_hp).toBe(1);
  });

  it('attacks base if only a stunned defender is present; stunned units are not interceptors', () => {
    let s = emptyFight();
    let attacker: CardInstanceId;
    [s, attacker] = put(s, 'player_a', 'OP-GUA-001', 'L2', 'front');
    [s] = put(s, 'player_b', 'OP-DEF-005', 'L2', 'front', { statuses: status('stun') });
    s = resolveCombat(s);
    expect(s.players.player_b.base_points).toBe(18); // OP-GUA-001 ATK = 2
    expect(
      s.combat_log.some((e) => e.type === 'attack_declared' && e.target_instance_id && e.target_instance_id !== attacker),
    ).toBe(false);
  });

  it('uses taunt, then valid ground front/back, and ranged floating priority', () => {
    let s = emptyFight();
    let taunt: CardInstanceId;
    [s] = put(s, 'player_a', 'OP-SNI-001', 'L1', 'front');
    [s] = put(s, 'player_b', 'OP-GUA-001', 'L1', 'front');
    [s, taunt] = put(s, 'player_b', 'OP-DEF-005', 'L1', 'back', { statuses: status('taunt') });
    s = resolveCombat(s);
    expect(s.combat_log.find((e) => e.type === 'attack_declared')?.target_instance_id).toBe(taunt);

    s = emptyFight();
    [s] = put(s, 'player_a', 'OP-SNI-001', 'L1', 'front');
    const float = put(s, 'player_b', 'OP-TEST-FLOAT', 'L1', 'back');
    s = float[0];
    s = resolveCombat(s);
    expect(s.combat_log.find((e) => e.type === 'attack_declared')?.target_instance_id).toBe(float[1]);

    s = emptyFight();
    [s] = put(s, 'player_a', 'OP-SNI-001', 'L2', 'front');
    const groundFront = put(s, 'player_b', 'OP-GUA-001', 'L2', 'front');
    s = groundFront[0];
    [s] = put(s, 'player_b', 'OP-GUA-001', 'L2', 'back');
    s = resolveCombat(s);
    expect(s.combat_log.find((e) => e.type === 'attack_declared')?.target_instance_id).toBe(groundFront[1]);

    s = emptyFight();
    [s] = put(s, 'player_a', 'OP-GUA-001', 'L1', 'front');
    const allLaneTaunt = put(s, 'player_b', 'OP-DEF-005', 'L3', 'front');
    s = allLaneTaunt[0];
    s = {
      ...s,
      card_definitions: {
        ...s.card_definitions,
        [id('OP-DEF-005')]: { ...s.card_definitions[id('OP-DEF-005')], taunt_scope: 'all_lanes' },
      },
    };
    s = resolveCombat(s);
    expect(s.combat_log.find((e) => e.type === 'attack_declared')?.target_instance_id).toBe(allLaneTaunt[1]);
  });

  it('allows melee to attack grounded floating units but not native floating units', () => {
    let s = emptyFight();
    [s] = put(s, 'player_a', 'OP-GUA-001', 'L3', 'front');
    const [placed, target] = put(s, 'player_b', 'OP-TEST-FLOAT', 'L3', 'back', { statuses: status('grounded', 2) });
    s = resolveCombat(placed);
    expect(s.combat_log.find((e) => e.type === 'attack_declared')?.target_instance_id).toBe(target);

    s = emptyFight();
    [s] = put(s, 'player_a', 'OP-GUA-001', 'L3', 'front');
    [s] = put(s, 'player_b', 'OP-TEST-FLOAT', 'L3', 'back');
    s = resolveCombat(s);
    expect(s.combat_log.some((e) => e.type === 'attack_declared' && e.target_instance_id)).toBe(false);
    expect(s.players.player_b.base_points).toBe(18);
  });

  it('applies slow to the next attack only and freeze disables taunt targeting', () => {
    let s = emptyFight();
    [s] = put(s, 'player_a', 'OP-GUA-001', 'L1', 'front', { statuses: status('slow') });
    s = resolveCombat(s);
    expect(s.players.player_b.base_points).toBe(19); // ATK 2 - 1 (slow) = 1
    expect(Object.values(s.card_instances).find((i) => i.owner_id === 'player_a' && i.zone === 'board')?.operator_combat?.statuses).toEqual([]);

    s = emptyFight();
    [s] = put(s, 'player_a', 'OP-SNI-001', 'L2', 'front');
    [s] = put(s, 'player_b', 'OP-DEF-005', 'L2', 'front', { statuses: status('freeze') });
    s = resolveCombat(s);
    // OP-SNI-001 (克洛丝) attacks with 2 hits of 1 damage -> 20 - 2 = 18
    expect(s.players.player_b.base_points).toBe(18);
    expect(s.combat_log.some((e) => e.type === 'attack_declared' && e.target_instance_id)).toBe(false);
  });

  it('absorbs shield before HP and ends immediately when base reaches zero', () => {
    let s = emptyFight();
    [s] = put(s, 'player_a', 'OP-GUA-001', 'L1', 'front');
    const target = put(s, 'player_b', 'OP-GUA-001', 'L1', 'front', { hp: 1, shield: 1 });
    s = resolveCombat(target[0]);
    expect(s.combat_log.some((e) => e.type === 'shield_absorbed' && e.amount === 1)).toBe(true);
    expect(s.players.player_b.discard).toContain(target[1]);

    s = emptyFight();
    s = { ...s, players: { ...s.players, player_b: { ...s.players.player_b, base_points: 2 as never } } };
    [s] = put(s, 'player_a', 'OP-GUA-001', 'L1', 'front');
    [s] = put(s, 'player_a', 'OP-SNI-001', 'L2', 'front');
    s = resolveCombat(s);
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe('player_a');
    expect(s.combat_log.filter((e) => e.type === 'attack_declared')).toHaveLength(1);
  });
});

describe('V1.1 combat primitives, statuses and control boundaries', () => {
  it('applies vulnerable (+1 damage) and cover (halves physical/arts before shield) but skips cover for poison/true damage', () => {
    let s = emptyFight();
    let src: CardInstanceId;
    let vulnTarget: CardInstanceId;
    let coverTarget: CardInstanceId;
    [s, src] = put(s, 'player_a', 'OP-GUA-001', 'L1', 'front');
    [s, vulnTarget] = put(s, 'player_b', 'OP-DEF-005', 'L1', 'front', { hp: 6, statuses: status('vulnerable') });
    [s, coverTarget] = put(s, 'player_b', 'OP-DEF-003', 'L2', 'front', { hp: 6, statuses: status('cover') });

    const r1 = resolveDamagePipeline(s, {
      sourceId: src,
      sourceControllerId: 'player_a',
      sourceName: '测试',
      targetId: vulnTarget,
      rawDamage: 2,
      damageType: 'physical',
      isBasicAttack: false,
    });
    expect(r1.hpLost).toBe(3);

    const r2 = resolveDamagePipeline(r1.state, {
      sourceId: src,
      sourceControllerId: 'player_a',
      sourceName: '测试',
      targetId: coverTarget,
      rawDamage: 3,
      damageType: 'physical',
      isBasicAttack: false,
    });
    expect(r2.hpLost).toBe(1); // floor(3/2) = 1

    const rPoison = resolveDamagePipeline(r2.state, {
      sourceId: src,
      sourceControllerId: 'player_a',
      sourceName: '毒',
      targetId: coverTarget,
      rawDamage: 3,
      damageType: 'poison',
      isBasicAttack: false,
    });
    expect(rPoison.hpLost).toBe(3);
  });

  it('upgrades stacked chilled into freeze (1 turn) and ticks poisoned at owner turn start bypassing shield', () => {
    let s = emptyFight();
    let target: CardInstanceId;
    [s, target] = put(s, 'player_b', 'OP-DEF-005', 'L1', 'front', { hp: 6, shield: 5 });

    s = applyStatusToInstance(s, target, { kind: 'chilled', remainingTurns: 1, expireAtNode: 'owner_turn_start' });
    expect(s.card_instances[target].operator_combat?.statuses.map((x) => x.kind)).toContain('chilled');

    s = applyStatusToInstance(s, target, { kind: 'chilled', remainingTurns: 1, expireAtNode: 'owner_turn_start' });
    const afterFreeze = s.card_instances[target].operator_combat?.statuses.map((x) => x.kind) ?? [];
    expect(afterFreeze).toContain('freeze');
    expect(afterFreeze).not.toContain('chilled');

    s = applyStatusToInstance(s, target, { kind: 'poisoned', remainingTurns: 1, stacks: 2 });
    s = { ...s, phase: 'turn_start', active_player_id: 'player_b', turn_start_prepared: false };
    const next = advancePhase(s);
    if (!next.ok) throw new Error(next.reason);
    // Poison deals 2 HP damage bypassing shield (6 -> 4) and shield stays 5
    expect(next.value.card_instances[target].operator_combat?.current_hp).toBe(4);
    expect(next.value.card_instances[target].operator_combat?.shield).toBe(5);
  });

  it('expires grounded after two target owner turns at turn start, independently of control', () => {
    let s = emptyFight();
    let target: CardInstanceId;
    [s, target] = put(s, 'player_b', 'OP-TEST-FLOAT', 'L3', 'back', {
      statuses: [...status('grounded', 2), ...status('freeze', 1)] as never,
    });
    s = { ...s, card_instances: { ...s.card_instances, [target]: { ...s.card_instances[target], controller_id: 'player_a' } } };
    s = { ...s, players: { ...s.players, player_b: { ...s.players.player_b, turns_taken: 1, own_turn_index: 1 } } };
    s = expireStatusesAtTurnStart(s, 'player_b');
    expect(s.card_instances[target].operator_combat?.statuses.map((x) => [x.kind, x.remaining_owner_turns])).toEqual([
      ['grounded', 1],
    ]);
  });

  it('plays V1.1 suppressed/freeze tactics through validated actions and rejects removed active_skill action', () => {
    let s = emptyFight();
    s = { ...s, phase: 'action' };
    let target: CardInstanceId;
    [s, target] = put(s, 'player_b', 'OP-DEF-005', 'L2', 'front');

    let suppressCard: CardInstanceId;
    [s, suppressCard] = handCard(s, 'player_a', 'DEMO-TAC-V2-013');
    const suppressed = reduceGameAction(s, 'player_a', {
      type: 'play_card',
      card_instance_id: suppressCard,
      target_instance_id: target,
    });
    expect(suppressed.ok).toBe(true);
    if (!suppressed.ok) return;
    expect(suppressed.value.card_instances[target].operator_combat?.statuses.some((x) => x.kind === 'suppressed')).toBe(true);

    let freezeCard: CardInstanceId;
    [s, freezeCard] = handCard(suppressed.value, 'player_a', 'TEST-TAC-FREEZE');
    const frozen = reduceGameAction(s, 'player_a', {
      type: 'play_card',
      card_instance_id: freezeCard,
      target_instance_id: target,
    });
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    expect(frozen.value.card_instances[target].operator_combat?.statuses.some((x) => x.kind === 'freeze')).toBe(true);

    // V1.1 移除了主动技能指令
    let attacker: CardInstanceId;
    [s, attacker] = put(frozen.value, 'player_a', 'OP-GUA-001', 'L1', 'front');
    const rejectedSkill = reduceGameAction(s, 'player_a', {
      type: 'activate_skill',
      card_instance_id: attacker,
      target_instance_id: target,
    });
    expect(rejectedSkill.ok).toBe(false);
    expect(rejectedSkill.value).toBe(s);

    // 验证 applyEffectDamage 走统一伤害通道
    const handAny = Object.values(s.card_instances).find((i) => i.owner_id === 'player_a' && i.zone === 'hand')!.card_instance_id;
    const damaged = applyEffectDamage(s, handAny, target, 2);
    expect(damaged.card_instances[target].operator_combat?.current_hp).toBe(4);
  });
});
