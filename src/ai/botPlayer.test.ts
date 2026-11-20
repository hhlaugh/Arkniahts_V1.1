import { describe, expect, it } from 'vitest';
import { loadDemoData } from '../data/load-card-data';
import { advancePhase, createInitialGameState, mulligan, reduceGameAction } from '../game/engine';
import { BotPlayer, botMulliganChoice, stateHashForRepetition } from './botPlayer';
import type { CardId, CardInstanceId, Cost, GameState, HpValue, LaneId, PaidDeployCost, PlayerId, Position, SpValue } from '../game/types';

const loaded = loadDemoData();
if (loaded.issues.length > 0) throw new Error(`Demo 数据无效：${JSON.stringify(loaded.issues)}`);
const [deckA, deckB] = loaded.decks;
if (!deckA || !deckB) throw new Error('必须加载两套 Demo 牌组。');

const PLAYERS: readonly PlayerId[] = ['player_a', 'player_b'];

function reachActionPhaseAs(seed: number, actor: PlayerId): GameState {
  let state = createInitialGameState({ decks: { player_a: deckA, player_b: deckB }, cards: loaded.validCards, seed });
  for (const playerId of PLAYERS) {
    const result = mulligan(state, playerId, []);
    if (!result.ok) throw new Error(result.reason);
    state = result.value;
  }
  const advanced = advancePhase(state);
  if (!advanced.ok) throw new Error(advanced.reason);
  return { ...advanced.value, active_player_id: actor };
}

function findDeckInstance(state: GameState, owner: PlayerId, cardId: string): CardInstanceId {
  const instance = Object.values(state.card_instances).find(
    (candidate) => candidate.owner_id === owner && (candidate.zone === 'deck' || candidate.zone === 'hand') && candidate.card_id === cardId,
  );
  if (!instance) throw new Error(`测试前置失败：${owner} 的牌库/手牌里没有 ${cardId}。`);
  return instance.card_instance_id;
}

function withPlayerCost(state: GameState, playerId: PlayerId, cost: number): GameState {
  const player = state.players[playerId];
  return { ...state, players: { ...state.players, [playerId]: { ...player, cost: cost as Cost } } };
}

function withHand(state: GameState, playerId: PlayerId, hand: readonly CardInstanceId[]): GameState {
  const player = state.players[playerId];
  const updates: Record<CardInstanceId, GameState['card_instances'][CardInstanceId]> = {};
  for (const id of hand) {
    const instance = state.card_instances[id];
    if (instance && instance.zone !== 'hand') updates[id] = { ...instance, zone: 'hand' };
  }
  return {
    ...state,
    players: { ...state.players, [playerId]: { ...player, hand: [...hand] } },
    card_instances: { ...state.card_instances, ...updates },
  };
}

function placeUnit(
  state: GameState,
  instanceId: CardInstanceId,
  options: { lane: LaneId; position: Position; hp?: number; sp?: number },
): GameState {
  const instance = state.card_instances[instanceId];
  if (!instance) throw new Error('测试前置失败：实例不存在。');
  const definition = state.card_definitions[instance.card_id];
  const owner = instance.owner_id;
  const player = state.players[owner];
  return {
    ...state,
    players: { ...state.players, [owner]: { ...player, deck: player.deck.filter((id) => id !== instanceId), hand: player.hand.filter((id) => id !== instanceId) } },
    card_instances: {
      ...state.card_instances,
      [instanceId]: {
        ...instance,
        zone: 'board',
        board_half: owner,
        lane: options.lane,
        position: options.position,
        operator_combat: {
          current_hp: (options.hp ?? definition.hp ?? 1) as HpValue,
          current_atk_modifiers: [],
          current_sp: (options.sp ?? definition.starting_sp ?? 0) as SpValue,
          shield: 0,
          statuses: [],
          equipment_ids: [],
        },
        operator_lifecycle: {
          redeploy_cd_remaining: 0,
          redeploy_cd_applied_owner_turn_index: null,
          has_deployed_before: true,
          entered_battle_this_owner_turn: false,
          paid_deploy_cost: definition.cost as unknown as PaidDeployCost,
          once_per_game_flags: {},
        },
      },
    },
  };
}

describe('BotPlayer (normal difficulty)', () => {
  it('deploys only on engine-legal slots with melee staying in front rows', () => {
    let state = withPlayerCost(reachActionPhaseAs(101, 'player_a'), 'player_a', 10);
    const fen = findDeckInstance(state, 'player_a', 'OP-VAN-001');
    state = withHand(state, 'player_a', [fen]);
    const bot = new BotPlayer({ player: 'player_a', rng: () => 0.5 });
    const action = bot.decide(state);
    expect(action.type).toBe('deploy_operator');
    expect(reduceGameAction(state, 'player_a', action).ok).toBe(true);
    if (action.type === 'deploy_operator') expect(action.position).toBe('front');
  });

  it('prefers empty lanes over a lane it already occupies', () => {
    let state = withPlayerCost(reachActionPhaseAs(202, 'player_a'), 'player_a', 10);
    const fen = findDeckInstance(state, 'player_a', 'OP-VAN-001');
    state = placeUnit(state, fen, { lane: 'left', position: 'front' });
    const sniper = findDeckInstance(state, 'player_a', 'OP-SNI-001');
    state = withHand(state, 'player_a', [sniper]);
    const bot = new BotPlayer({ player: 'player_a', rng: () => 0.5 });
    const action = bot.decide(state);
    expect(action.type).toBe('deploy_operator');
    if (action.type === 'deploy_operator') expect(action.lane).not.toBe('L1');
  });

  it('withdraws a dying unit but ends the phase when the unit is healthy', () => {
    let state = reachActionPhaseAs(303, 'player_a');
    const fen = findDeckInstance(state, 'player_a', 'OP-VAN-001');
    state = placeUnit(state, fen, { lane: 'L1', position: 'front', hp: 1 });
    const enemyCaster = findDeckInstance(state, 'player_b', 'OP-CAS-006');
    state = placeUnit(state, enemyCaster, { lane: 'L1', position: 'front' });
    state = {
      ...withHand(state, 'player_a', []),
      players: {
        ...state.players,
        player_a: { ...state.players.player_a, hand: [], focus_target_id: enemyCaster },
      },
    };
    const bot = new BotPlayer({ player: 'player_a', rng: () => 0.5 });
    const dying = bot.decide(state);
    expect(dying.type).toBe('withdraw_operator');
    expect(reduceGameAction(state, 'player_a', dying).ok).toBe(true);

    let healthyState = placeUnit(reachActionPhaseAs(303, 'player_a'), fen, { lane: 'L1', position: 'front', hp: 3 });
    const healthyEnemy = findDeckInstance(healthyState, 'player_b', 'OP-DEF-003');
    healthyState = placeUnit(healthyState, healthyEnemy, { lane: 'L1', position: 'front' });
    healthyState = {
      ...withHand(healthyState, 'player_a', []),
      players: {
        ...healthyState.players,
        player_a: { ...healthyState.players.player_a, hand: [], focus_target_id: healthyEnemy },
      },
    };
    const healthy = bot.decide(healthyState);
    expect(healthy.type).toBe('end_action_phase');
  });

  it('plays a targeted damage tactic at a killable enemy operator', () => {
    let state = withPlayerCost(reachActionPhaseAs(404, 'player_a'), 'player_a', 5);
    const tacticId = 'test-tac-demolition' as CardInstanceId;
    const demolitionDef = loaded.validCards.find((card) => card.card_id === ('DEMO-TAC-V2-005' as CardId));
    if (!demolitionDef) throw new Error('测试前置失败：找不到 DEMO-TAC-V2-005。');
    state = {
      ...state,
      card_instances: {
        ...state.card_instances,
        [tacticId]: {
          card_instance_id: tacticId,
          card_id: demolitionDef.card_id,
          zone: 'hand',
          owner_id: 'player_a',
          controller_id: 'player_a',
          operator_combat: null,
          operator_lifecycle: null,
          support_lifecycle: null,
        },
      },
    };
    const enemyDefender = findDeckInstance(state, 'player_b', 'OP-DEF-003');
    state = placeUnit(state, enemyDefender, { lane: 'L1', position: 'front', hp: 3 });
    state = {
      ...withHand(state, 'player_a', [tacticId]),
      players: {
        ...state.players,
        player_a: { ...state.players.player_a, hand: [tacticId], focus_target_id: enemyDefender },
      },
    };
    const bot = new BotPlayer({ player: 'player_a', rng: () => 0.5 });
    const action = bot.decide(state);
    expect(action.type).toBe('play_card');
    expect(reduceGameAction(state, 'player_a', action).ok).toBe(true);
    if (action.type === 'play_card') {
      expect(action.card_instance_id).toBe(tacticId);
      expect(action.target_instance_id).toBe(enemyDefender);
    }
  });

  it('detects repeated states and restricts itself to advancing actions', () => {
    let state = reachActionPhaseAs(303, 'player_a');
    const fen = findDeckInstance(state, 'player_a', 'OP-VAN-001');
    state = placeUnit(state, fen, { lane: 'L1', position: 'front', hp: 1 });
    const enemyCaster = findDeckInstance(state, 'player_b', 'OP-CAS-006');
    state = placeUnit(state, enemyCaster, { lane: 'L1', position: 'front' });
    state = {
      ...withHand(state, 'player_a', []),
      players: {
        ...state.players,
        player_a: { ...state.players.player_a, hand: [], focus_target_id: enemyCaster },
      },
    };
    const bot = new BotPlayer({ player: 'player_a', rng: () => 0.5 });
    expect(bot.decide(state).type).toBe('withdraw_operator');
    expect(bot.decide(state).type).toBe('withdraw_operator');
    const third = bot.decide(state);
    expect(third.type).toBe('end_action_phase');
    expect(bot.getTelemetry().repetitionStops).toBe(1);
  });

  it('watchdog caps decisions per match as an AI-internal safety valve', () => {
    const state = withPlayerCost(reachActionPhaseAs(505, 'player_a'), 'player_a', 10);
    const bot = new BotPlayer({ player: 'player_a', rng: () => 0.5, watchdog: { maxDecisionsPerMatch: 2 } });
    bot.decide(state);
    bot.decide(state);
    const third = bot.decide(state);
    expect(third.type).toBe('end_action_phase');
    const telemetry = bot.getTelemetry();
    expect(telemetry.watchdogStops).toBe(1);
    expect(telemetry.fallbacks).toBe(1);
  });

  it('builds a repetition hash that hides opponent hand contents', () => {
    const state = reachActionPhaseAs(606, 'player_a');
    const hash = stateHashForRepetition(state, 'player_a');
    expect(hash).not.toContain(state.players.player_b.hand.join(','));
    const withDifferentOpponentHand = {
      ...state,
      players: { ...state.players, player_b: { ...state.players.player_b, hand: [...state.players.player_b.hand].reverse() } },
    };
    expect(stateHashForRepetition(withDifferentOpponentHand, 'player_a')).toBe(hash);
  });

  it('mulligan choice only swaps expensive non-operator cards from its own hand', () => {
    const state = reachActionPhaseAs(707, 'player_a');
    const swaps = botMulliganChoice(state, 'player_a');
    const hand = new Set(state.players.player_a.hand);
    for (const id of swaps) {
      expect(hand.has(id)).toBe(true);
      const definition = state.card_definitions[state.card_instances[id].card_id];
      expect(definition.card_type).not.toBe('operator');
      expect(definition.cost).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('BotPlayer integration through the controller path', () => {
  it('first decision always resolves pending facility choices when present', () => {
    let state = reachActionPhaseAs(808, 'player_a');
    const friendlyOp = findDeckInstance(state, 'player_a', 'OP-VAN-001');
    state = placeUnit(state, friendlyOp, { lane: 'center', position: 'front' });
    const facility = 'test-inst-pylon' as CardInstanceId;
    state = withHand(state, 'player_a', []);
    state = {
      ...state,
      card_definitions: {
        ...state.card_definitions,
        ['TEST-SUP-PYLON' as CardId]: {
          card_id: 'TEST-SUP-PYLON' as CardId,
          card_name_zh: '技力中继桩测试',
          card_type: 'support',
          support_subtype: 'facility',
          rarity: 4,
          cost: 1,
          deck_copy_limit: 2,
          effect_trigger: 'turn_start',
          effect_json: {
            trigger: 'turn_start',
            actions: [{ type: 'choose_friendly_operator_gain_sp', target: 'friendly_operator', value: 1 }],
          },
        } as never,
      },
      players: { ...state.players, player_a: { ...state.players.player_a, facility_ids: [facility] } },
      card_instances: {
        ...state.card_instances,
        [facility]: {
          card_instance_id: facility,
          card_id: 'TEST-SUP-PYLON' as CardId,
          zone: 'board',
          board_half: 'player_a',
          lane: 'L1',
          position: 'back',
          slot_index: 1,
          owner_id: 'player_a',
          controller_id: 'player_a',
          operator_combat: null,
          operator_lifecycle: null,
          support_lifecycle: { turn_start_triggers: 0 },
        },
      },
      phase: 'turn_start',
      turn_start_prepared: true,
      pending_effect_choices: [{ source_instance_id: facility, effect: 'gain_sp', amount: 1 }],
    };
    const bot = new BotPlayer({ player: 'player_a', rng: () => 0.5 });
    const action = bot.decide(state);
    expect(action.type).toBe('resolve_pending_choice');
    expect(reduceGameAction(state, 'player_a', action).ok).toBe(true);
  });
});
