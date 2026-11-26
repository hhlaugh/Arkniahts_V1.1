import { describe, expect, it } from 'vitest';
import { loadDemoData } from '../data/load-card-data';
import { advancePhase, createInitialGameState, mulligan, reduceGameAction } from './engine';
import type { CardId, CardInstance, CardInstanceId, Cost, GameState, PlayerId, StatusKind } from './types';

const loaded = loadDemoData();
if (loaded.issues.length > 0) throw new Error(`Demo data has validation issues: ${JSON.stringify(loaded.issues)}`);
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
    deck_copy_limit: 2,
    redeploy_cd_base: 2,
    effect_trigger: 'none',
    effect_json: { trigger: 'none', actions: [] },
  },
  {
    card_id: 'OP-TEST-BACK',
    card_name_zh: '测试后排干员',
    card_type: 'operator',
    rarity: 3,
    cost: 1,
    hp: 2,
    atk: 1,
    class: 'sniper',
    attack_type: 'ranged',
    deploy_rule: 'back_only',
    floating: false,
    deck_copy_limit: 2,
    redeploy_cd_base: 1,
    effect_trigger: 'none',
    effect_json: { trigger: 'none', actions: [] },
  },
  {
    card_id: 'OP-TEST-DEF',
    card_name_zh: '测试防御干员',
    card_type: 'operator',
    rarity: 4,
    cost: 3,
    hp: 6,
    atk: 1,
    class: 'defender',
    attack_type: 'melee',
    deploy_rule: 'front_only',
    floating: false,
    taunt_scope: 'none',
    redeploy_cd_base: 1,
    deck_copy_limit: 2,
    effect_trigger: 'none',
    effect_json: { trigger: 'none', actions: [] },
  },
];

const cards = [...loaded.validCards, ...testFixtures];
const cardIds = Object.fromEntries(cards.map((card) => [card.card_id, card.card_id])) as Record<string, CardId>;
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
const repeatedCardIds = ['OP-VAN-001', 'DEMO-TAC-V2-004', 'DEMO-SUP-V2-001', 'DEMO-SUP-V2-007', 'DEMO-SUP-V2-008'];
const deckCards = [
  ...uniqueCards.map((card) => ({ card_id: card.card_id, quantity: 1 })),
  ...repeatedCardIds.map((id) => ({ card_id: cardIds[id], quantity: 1 })),
];

function freshActionState(seed = 101): GameState {
  const state = createInitialGameState({
    decks: {
      player_a: { deck_id: 'LIFECYCLE-A', deck_name_zh: 'A', cards: deckCards },
      player_b: { deck_id: 'LIFECYCLE-B', deck_name_zh: 'B', cards: deckCards },
    },
    cards,
    seed,
  });
  const firstMulligan = applyMulligan(state, 'player_a');
  const secondMulligan = applyMulligan(firstMulligan, 'player_b');
  const start = advancePhase(secondMulligan);
  if (!start.ok) throw new Error(start.reason);
  return start.value;
}

function applyMulligan(state: GameState, playerId: PlayerId): GameState {
  const result = mulligan(state, playerId, []);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function giveCard(state: GameState, playerId: PlayerId, cardId: CardId): { state: GameState; cardInstanceId: CardInstanceId } {
  const candidates = Object.values(state.card_instances).filter(
    (candidate) => candidate.owner_id === playerId && candidate.card_id === cardId && (candidate.zone === 'deck' || candidate.zone === 'hand'),
  );
  candidates.sort((left, right) => Number(left.zone !== 'deck') - Number(right.zone !== 'deck'));
  const instance = candidates[0];
  if (!instance) throw new Error(`Missing ${cardId} for ${playerId}`);
  const player = state.players[playerId];
  const without = (ids: readonly CardInstanceId[]) => ids.filter((id) => id !== instance.card_instance_id);
  const nextPlayer = {
    ...player,
    hand: [...without(player.hand), instance.card_instance_id],
    deck: without(player.deck),
    discard: without(player.discard),
    facility_ids: without(player.facility_ids),
  };
  return {
    state: {
      ...state,
      players: { ...state.players, [playerId]: nextPlayer },
      card_instances: { ...state.card_instances, [instance.card_instance_id]: { ...instance, zone: 'hand' } },
    },
    cardInstanceId: instance.card_instance_id,
  };
}

function injectHandCopy(state: GameState, playerId: PlayerId, sourceId: CardInstanceId): { state: GameState; cardInstanceId: CardInstanceId } {
  const source = state.card_instances[sourceId];
  const id = `fixture-copy:${playerId}:${sourceId}` as CardInstanceId;
  const copy: CardInstance = { ...source, card_instance_id: id, owner_id: playerId, controller_id: playerId, zone: 'hand' };
  return {
    state: {
      ...state,
      players: { ...state.players, [playerId]: { ...state.players[playerId], hand: [...state.players[playerId].hand, id] } },
      card_instances: { ...state.card_instances, [id]: copy },
    },
    cardInstanceId: id,
  };
}

function setCost(state: GameState, playerId: PlayerId, cost: number): GameState {
  return { ...state, players: { ...state.players, [playerId]: { ...state.players[playerId], cost: cost as Cost } } };
}

function editInstance(state: GameState, id: CardInstanceId, update: (instance: CardInstance) => CardInstance): GameState {
  return { ...state, card_instances: { ...state.card_instances, [id]: update(state.card_instances[id]) } };
}

function dispatch(state: GameState, playerId: PlayerId, action: Parameters<typeof reduceGameAction>[2]): GameState {
  const result = reduceGameAction(state, playerId, action);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function deploy(
  state: GameState,
  playerId: PlayerId,
  cardInstanceId: CardInstanceId,
  lane: 'L1' | 'L2' | 'L3' | 'left' | 'center' | 'right' = 'L1',
  position: 'front' | 'back' = 'front',
): GameState {
  return dispatch(state, playerId, { type: 'deploy_operator', card_instance_id: cardInstanceId, lane, position, slot_index: 1 });
}

function status(kind: StatusKind) {
  return {
    kind,
    remaining_owner_turns: 1,
    applied_on_owner_turn_index: 1,
    expire_at_node: 'owner_turn_start' as const,
    blocks_normal_withdrawal: kind === 'stun' || kind === 'freeze',
  } as const;
}

describe('deployment validation and atomicity', () => {
  it('enforces melee/ranged deployment rules and floating back-row restriction', () => {
    const state = freshActionState();
    const actor = state.active_player_id;
    const melee = giveCard(state, actor, cardIds['OP-VAN-001']);
    const illegalMelee = reduceGameAction(melee.state, actor, {
      type: 'deploy_operator',
      card_instance_id: melee.cardInstanceId,
      lane: 'L1',
      position: 'back',
      slot_index: 1,
    });
    expect(illegalMelee).toMatchObject({ ok: false, value: melee.state });

    const ranged = giveCard(state, actor, cardIds['OP-TEST-BACK']);
    expect(
      dispatch(ranged.state, actor, {
        type: 'deploy_operator',
        card_instance_id: ranged.cardInstanceId,
        lane: 'L2',
        position: 'back',
        slot_index: 1,
      }).card_instances[ranged.cardInstanceId].zone,
    ).toBe('board');
    const illegalRangedFront = reduceGameAction(ranged.state, actor, {
      type: 'deploy_operator',
      card_instance_id: ranged.cardInstanceId,
      lane: 'L2',
      position: 'front',
      slot_index: 1,
    });
    expect(illegalRangedFront).toMatchObject({ ok: false, value: ranged.state });

    const floating = giveCard(state, actor, cardIds['OP-TEST-FLOAT']);
    const illegalFloating = reduceGameAction(floating.state, actor, {
      type: 'deploy_operator',
      card_instance_id: floating.cardInstanceId,
      lane: 'L3',
      position: 'front',
      slot_index: 1,
    });
    expect(illegalFloating).toMatchObject({ ok: false, value: floating.state });
    expect(deploy(floating.state, actor, floating.cardInstanceId, 'L3', 'back').card_instances[floating.cardInstanceId].position).toBe('back');
  });

  it('rejects insufficient cost and occupied slots without partial payment or hand movement', () => {
    const state = freshActionState();
    const actor = state.active_player_id;
    const one = giveCard(state, actor, cardIds['OP-VAN-001']);
    const lowCost = setCost(one.state, actor, 0);
    const noFunds = reduceGameAction(lowCost, actor, {
      type: 'deploy_operator',
      card_instance_id: one.cardInstanceId,
      lane: 'L1',
      position: 'front',
      slot_index: 1,
    });
    expect(noFunds).toMatchObject({ ok: false, value: lowCost });
    expect(noFunds.value.players[actor].cost).toBe(0);
    expect(noFunds.value.players[actor].hand).toContain(one.cardInstanceId);

    const second = giveCard(one.state, actor, cardIds['OP-GUA-001']);
    const board = deploy(second.state, actor, one.cardInstanceId);
    const occupied = reduceGameAction(board, actor, {
      type: 'deploy_operator',
      card_instance_id: second.cardInstanceId,
      lane: 'L1',
      position: 'front',
      slot_index: 1,
    });
    expect(occupied).toMatchObject({ ok: false, value: board });
    expect(occupied.value.players[actor].hand).toContain(second.cardInstanceId);
  });

  it('allows separate same-name instances in separate slots and fires on_deploy supply (draw 1 card) for each instance', () => {
    const state = freshActionState();
    const actor = state.active_player_id;
    const first = giveCard(state, actor, cardIds['OP-VAN-001']);
    const second = giveCard(first.state, actor, cardIds['OP-VAN-001']);
    const withFunds = setCost(second.state, actor, 5);
    const handBefore = withFunds.players[actor].hand.length;
    const deckBefore = withFunds.players[actor].deck.length;
    // OP-VAN-001 cost 1, on_deploy grant_supply draws 1 card
    const deployed = deploy(withFunds, actor, first.cardInstanceId, 'L1', 'front');
    expect(deployed.players[actor].cost).toBe(4);
    expect(deployed.players[actor].hand.length).toBe(handBefore); // -1 played + 1 drawn
    expect(deployed.players[actor].deck.length).toBe(deckBefore - 1);

    const deployedAgain = deploy(deployed, actor, second.cardInstanceId, 'L3', 'front');
    const firstState = deployedAgain.card_instances[first.cardInstanceId].operator_lifecycle;
    const secondState = deployedAgain.card_instances[second.cardInstanceId].operator_lifecycle;
    expect(firstState?.has_deployed_before).toBe(true);
    expect(firstState?.paid_deploy_cost).toBe(1);
    expect(secondState?.has_deployed_before).toBe(true);
    expect(secondState?.paid_deploy_cost).toBe(1);
    expect(deployedAgain.players[actor].cost).toBe(3);
    expect(deployedAgain.players[actor].hand.length).toBe(handBefore); // -1 played + 1 drawn
    expect(deployedAgain.players[actor].deck.length).toBe(deckBefore - 2);
  });

  it('triggers turn_start supply draw for OP-VAN-003 and OP-VAN-007', () => {
    const state = freshActionState();
    const actor = state.active_player_id;
    const myrtle = giveCard(state, actor, cardIds['OP-VAN-003']);
    const withFunds = setCost(myrtle.state, actor, 10);
    const deployed = deploy(withFunds, actor, myrtle.cardInstanceId, 'L1', 'front');
    const handBeforeTurnStart = deployed.players[actor].hand.length;
    const deckBeforeTurnStart = deployed.players[actor].deck.length;

    const nextTurnStart = advancePhase({
      ...deployed,
      phase: 'turn_start',
      active_player_id: actor,
      turn_start_prepared: false,
    });
    if (!nextTurnStart.ok) throw new Error(nextTurnStart.reason);
    // +1 normal turn_start draw + 1 OP-VAN-003 supply draw = +2 cards
    expect(nextTurnStart.value.players[actor].hand.length).toBe(handBeforeTurnStart + 2);
    expect(nextTurnStart.value.players[actor].deck.length).toBe(deckBeforeTurnStart - 2);
    expect(nextTurnStart.value.combat_log.some((e) => e.action_type === 'supply' && e.source_name === '桃金娘')).toBe(true);
  });

  it('triggers on_kill supply draw for OP-VAN-002 when defeating an enemy operator', () => {
    let state = freshActionState();
    const actor = state.active_player_id;
    const enemy: PlayerId = actor === 'player_a' ? 'player_b' : 'player_a';
    const plume = giveCard(state, actor, cardIds['OP-VAN-002']);
    const enemyUnit = giveCard(plume.state, enemy, cardIds['OP-VAN-001']);
    state = setCost(enemyUnit.state, actor, 10);
    state = setCost(state, enemy, 10);
    state = deploy(state, actor, plume.cardInstanceId, 'L1', 'front');
    state = deploy(state, enemy, enemyUnit.cardInstanceId, 'L1', 'front');
    state = dispatch(state, actor, { type: 'end_action_phase' });

    const handBefore = state.players[actor].hand.length;
    const deckBefore = state.players[actor].deck.length;
    const postCombat = advancePhase(state); // combat -> turn_end
    if (!postCombat.ok) throw new Error(postCombat.reason);
    expect(postCombat.value.card_instances[enemyUnit.cardInstanceId].zone).toBe('discard');
    expect(postCombat.value.players[actor].hand.length).toBe(handBefore + 1);
    expect(postCombat.value.players[actor].deck.length).toBe(deckBefore - 1);
    expect(postCombat.value.combat_log.some((e) => e.action_type === 'supply' && e.source_name === '翎羽')).toBe(true);
  });
});

describe('V1.1 normal withdrawal and tactical return-to-hand', () => {
  it.each([
    ['stun', 'status'],
    ['freeze', 'status'],
    ['slow', 'none'],
    ['grounded', 'none'],
    ['taunt', 'none'],
  ] as const)('normal withdrawal status rule for %s', (kind, expected) => {
    const state = freshActionState();
    const actor = state.active_player_id;
    const operator = giveCard(state, actor, cardIds['OP-TEST-DEF']);
    const deployed = deploy(setCost(operator.state, actor, 10), actor, operator.cardInstanceId);
    const controlled = editInstance(deployed, operator.cardInstanceId, (instance) => ({
      ...instance,
      operator_combat: { ...instance.operator_combat!, statuses: [status(kind)] },
    }));
    const result = reduceGameAction(controlled, actor, { type: 'withdraw_operator', card_instance_id: operator.cardInstanceId });
    if (expected === 'status') {
      expect(result).toMatchObject({ ok: false, value: controlled });
      expect(result.value.players[actor].cost).toBe(7);
    } else {
      expect(result.ok).toBe(true);
    }
  });

  it('normal withdrawal requires control and own half, refunds 0 CP in V1.1, resets combat, and starts redeploy CD', () => {
    const state = freshActionState();
    const actor = state.active_player_id;
    const operator = giveCard(state, actor, cardIds['OP-TEST-DEF']);
    const deployed = deploy(setCost(operator.state, actor, 10), actor, operator.cardInstanceId);
    const dirty = editInstance(deployed, operator.cardInstanceId, (instance) => ({
      ...instance,
      operator_combat: {
        ...instance.operator_combat!,
        current_hp: 1 as never,
        current_atk_modifiers: [2],
        current_sp: 3 as never,
        shield: 4,
        statuses: [status('slow')],
      },
    }));
    const enemyHalf = editInstance(dirty, operator.cardInstanceId, (instance) => ({
      ...instance,
      board_half: actor === 'player_a' ? 'player_b' : 'player_a',
    }));
    expect(reduceGameAction(enemyHalf, actor, { type: 'withdraw_operator', card_instance_id: operator.cardInstanceId })).toMatchObject({
      ok: false,
      value: enemyHalf,
    });
    const wrongController = editInstance(dirty, operator.cardInstanceId, (instance) => ({
      ...instance,
      controller_id: actor === 'player_a' ? 'player_b' : 'player_a',
    }));
    expect(reduceGameAction(wrongController, actor, { type: 'withdraw_operator', card_instance_id: operator.cardInstanceId })).toMatchObject({
      ok: false,
      value: wrongController,
    });

    const valid = setCost(dirty, actor, 0);
    const withdrawn = dispatch(valid, actor, { type: 'withdraw_operator', card_instance_id: operator.cardInstanceId });
    const instance = withdrawn.card_instances[operator.cardInstanceId];
    const definition = withdrawn.card_definitions[instance.card_id];
    // V1.1 常规撤离退还 0 CP
    expect(withdrawn.players[actor].cost).toBe(0);
    expect(withdrawn.players[actor].hand).toContain(operator.cardInstanceId);
    expect(instance.zone).toBe('hand');
    expect(instance.operator_combat?.current_hp).toBe(definition.hp);
    expect(instance.operator_combat?.current_atk_modifiers).toEqual([]);
    expect(instance.operator_combat?.shield).toBe(0);
    expect(instance.operator_combat?.statuses).toEqual([]);
    expect(instance.operator_lifecycle).toMatchObject({
      has_deployed_before: true,
      entered_battle_this_owner_turn: true,
      paid_deploy_cost: null,
      redeploy_cd_remaining: 1,
    });
    expect(instance.operator_lifecycle?.redeploy_cd_applied_owner_turn_index).toBe(withdrawn.players[actor].own_turn_index);
  });

  it('DEMO-TAC-V2-004 returns friendly operator to hand with no CP refund, grants -1 next deploy discount, and sets cooldown', () => {
    const state = freshActionState();
    const actor = state.active_player_id;
    const operator = giveCard(state, actor, cardIds['OP-SNI-001']);
    const tactic = giveCard(operator.state, actor, cardIds['DEMO-TAC-V2-004']);
    const deployed = deploy(setCost(tactic.state, actor, 10), actor, operator.cardInstanceId, 'L1', 'back');
    const withCost = setCost(deployed, actor, 5);
    const result = dispatch(withCost, actor, {
      type: 'play_card',
      card_instance_id: tactic.cardInstanceId,
      target_instance_id: operator.cardInstanceId,
    });
    const unit = result.card_instances[operator.cardInstanceId];
    expect(result.players[actor].cost).toBe(3); // 5 - 2 (tactic cost) = 3, 0 refund
    expect(result.players[actor].hand).toContain(operator.cardInstanceId);
    expect(result.players[actor].discard).toContain(tactic.cardInstanceId);
    expect(result.players[actor].next_deploy_discounts.reduce((s, d) => s + d.amount, 0)).toBe(1);
    expect(unit.zone).toBe('hand');
    expect(unit.operator_lifecycle?.redeploy_cd_remaining).toBe(1);

    // Rejects enemy-controlled targets atomically
    const op2 = giveCard(result, actor, cardIds['OP-GUA-001']);
    const tactic2 = giveCard(op2.state, actor, cardIds['DEMO-TAC-V2-004']);
    const deployed2 = deploy(setCost(tactic2.state, actor, 10), actor, op2.cardInstanceId, 'L2', 'front');
    const enemyControlled = editInstance(deployed2, op2.cardInstanceId, (instance) => ({
      ...instance,
      controller_id: actor === 'player_a' ? 'player_b' : 'player_a',
    }));
    const rejected = reduceGameAction(enemyControlled, actor, {
      type: 'play_card',
      card_instance_id: tactic2.cardInstanceId,
      target_instance_id: op2.cardInstanceId,
    });
    expect(rejected).toMatchObject({ ok: false, value: enemyControlled });
  });
});

describe('V1.1 facilities, equipment override/clamp and redeploy cooldown', () => {
  it('occupies a board cell for facilities on front or back row, enforces 2-facility limit, disables via DEMO-TAC-V2-020, and loses 1 HP per turn until destroyed', () => {
    const state = freshActionState();
    const actor = state.active_player_id;
    const f1 = giveCard(state, actor, cardIds['DEMO-SUP-V2-001']);
    const f2 = giveCard(f1.state, actor, cardIds['DEMO-SUP-V2-001']);
    const f3 = injectHandCopy(f2.state, actor, f2.cardInstanceId);
    const enough = setCost(f3.state, actor, 10);

    const afterF1 = dispatch(enough, actor, {
      type: 'play_card',
      card_instance_id: f1.cardInstanceId,
      target_lane: 'L1',
      target_position: 'back',
      target_slot_index: 1,
    });
    expect(afterF1.card_instances[f1.cardInstanceId].zone).toBe('board');
    expect(afterF1.card_instances[f1.cardInstanceId].operator_combat?.current_hp).toBe(3);

    // Cannot deploy another card onto the occupied facility cell
    const op = giveCard(afterF1, actor, cardIds['OP-TEST-BACK']);
    const blockedDeploy = reduceGameAction(op.state, actor, {
      type: 'deploy_operator',
      card_instance_id: op.cardInstanceId,
      lane: 'L1',
      position: 'back',
      slot_index: 1,
    });
    expect(blockedDeploy).toMatchObject({ ok: false });

    // Deploy second facility onto front row
    const afterF2 = dispatch(op.state, actor, {
      type: 'play_card',
      card_instance_id: f2.cardInstanceId,
      target_lane: 'L2',
      target_position: 'front',
      target_slot_index: 1,
    });
    expect(afterF2.card_instances[f2.cardInstanceId].position).toBe('front');
    expect(afterF2.players[actor].facility_ids).toHaveLength(2);

    const overLimit = reduceGameAction(afterF2, actor, {
      type: 'play_card',
      card_instance_id: f3.cardInstanceId,
      target_lane: 'L3',
      target_position: 'back',
      target_slot_index: 1,
    });
    expect(overLimit).toMatchObject({ ok: false, value: afterF2 });

    // Three owner turn starts deduct 1 HP each turn (3 -> 2 -> 1 -> 0 destroyed)
    let cur = afterF2;
    for (const expectedHp of [2, 1]) {
      const step = advancePhase({
        ...cur,
        phase: 'turn_start',
        active_player_id: actor,
        turn_start_prepared: false,
      });
      if (!step.ok) throw new Error(step.reason);
      cur = step.value;
      expect(cur.card_instances[f1.cardInstanceId].operator_combat?.current_hp).toBe(expectedHp);
      expect(cur.card_instances[f2.cardInstanceId].operator_combat?.current_hp).toBe(expectedHp);
    }
    const finalStep = advancePhase({
      ...cur,
      phase: 'turn_start',
      active_player_id: actor,
      turn_start_prepared: false,
    });
    if (!finalStep.ok) throw new Error(finalStep.reason);
    expect(finalStep.value.card_instances[f1.cardInstanceId].zone).toBe('discard');
    expect(finalStep.value.card_instances[f2.cardInstanceId].zone).toBe('discard');
    expect(finalStep.value.players[actor].facility_ids).toHaveLength(0);
  });

  it('installs equipment package (card moves to discard), enforces 1-slot override with HP clamping, and clears on withdraw', () => {
    const state = freshActionState();
    const actor = state.active_player_id;
    const operator = giveCard(state, actor, cardIds['OP-SNI-001']); // max HP = 3
    const eqArmor = giveCard(operator.state, actor, cardIds['DEMO-SUP-V2-007']); // +1 max_hp, +3 shield
    const eqScope = giveCard(eqArmor.state, actor, cardIds['DEMO-SUP-V2-008']); // override (no max_hp bonus)
    const deployed = deploy(setCost(eqScope.state, actor, 10), actor, operator.cardInstanceId, 'L1', 'back');

    const armored = dispatch(deployed, actor, {
      type: 'play_card',
      card_instance_id: eqArmor.cardInstanceId,
      target_instance_id: operator.cardInstanceId,
    });
    // Equipment card goes to discard immediately; host receives equipped_package
    expect(armored.players[actor].discard).toContain(eqArmor.cardInstanceId);
    expect(armored.card_instances[eqArmor.cardInstanceId].zone).toBe('discard');
    expect(armored.card_instances[operator.cardInstanceId].operator_combat?.shield).toBe(3);
    expect(armored.card_instances[operator.cardInstanceId].operator_combat?.equipped_package?.card_id).toBe('DEMO-SUP-V2-007');

    // Raise current_hp to 4 (the temporary buffed max_hp), then override with non-HP equipment -> clamps down to 3
    const boostedHp = editInstance(armored, operator.cardInstanceId, (inst) => ({
      ...inst,
      operator_combat: { ...inst.operator_combat!, current_hp: 4 as never },
    }));
    const scoped = dispatch(boostedHp, actor, {
      type: 'play_card',
      card_instance_id: eqScope.cardInstanceId,
      target_instance_id: operator.cardInstanceId,
    });
    expect(scoped.card_instances[operator.cardInstanceId].operator_combat?.equipped_package?.card_id).toBe('DEMO-SUP-V2-008');
    expect(scoped.card_instances[operator.cardInstanceId].operator_combat?.current_hp).toBe(3);

    // Withdrawal clears installed package and shield
    const withdrawn = dispatch(scoped, actor, { type: 'withdraw_operator', card_instance_id: operator.cardInstanceId });
    expect(withdrawn.card_instances[operator.cardInstanceId].operator_combat?.equipped_package).toBeNull();
    expect(withdrawn.card_instances[operator.cardInstanceId].operator_combat?.shield).toBe(0);
  });

  it('does not decrement CD at the withdrawal turn end; skips the next own action phase then permits redeploy', () => {
    let state = freshActionState();
    const actor = state.active_player_id;
    const operator = giveCard(state, actor, cardIds['OP-VAN-001']);
    state = deploy(setCost(operator.state, actor, 10), actor, operator.cardInstanceId);
    state = dispatch(state, actor, { type: 'withdraw_operator', card_instance_id: operator.cardInstanceId });
    expect(state.card_instances[operator.cardInstanceId].operator_lifecycle?.redeploy_cd_remaining).toBe(1);
    state = dispatch(state, actor, { type: 'end_action_phase' });
    expect(state.card_instances[operator.cardInstanceId].operator_lifecycle?.redeploy_cd_remaining).toBe(1);
    let phase = advancePhase(state); // combat → turn_end
    if (!phase.ok) throw new Error(phase.reason);
    phase = advancePhase(phase.value); // opponent turn_start
    if (!phase.ok) throw new Error(phase.reason);
    phase = advancePhase(phase.value); // opponent action
    if (!phase.ok) throw new Error(phase.reason);
    state = dispatch(phase.value, phase.value.active_player_id, { type: 'end_action_phase' });
    phase = advancePhase(state); // combat → turn_end
    if (!phase.ok) throw new Error(phase.reason);
    phase = advancePhase(phase.value); // owner's turn_start
    if (!phase.ok) throw new Error(phase.reason);
    phase = advancePhase(phase.value); // owner's action
    if (!phase.ok) throw new Error(phase.reason);
    const cannotYet = reduceGameAction(phase.value, actor, {
      type: 'deploy_operator',
      card_instance_id: operator.cardInstanceId,
      lane: 'L3',
      position: 'front',
      slot_index: 1,
    });
    expect(cannotYet).toMatchObject({ ok: false, value: phase.value });
    state = dispatch(phase.value, actor, { type: 'end_action_phase' });
    expect(state.card_instances[operator.cardInstanceId].operator_lifecycle?.redeploy_cd_remaining).toBe(0);
    let otherTurn = advancePhase(state);
    if (!otherTurn.ok) throw new Error(otherTurn.reason);
    otherTurn = advancePhase(otherTurn.value);
    if (!otherTurn.ok) throw new Error(otherTurn.reason);
    otherTurn = advancePhase(otherTurn.value);
    if (!otherTurn.ok) throw new Error(otherTurn.reason);
    state = dispatch(otherTurn.value, otherTurn.value.active_player_id, { type: 'end_action_phase' });
    phase = advancePhase(state);
    if (!phase.ok) throw new Error(phase.reason);
    phase = advancePhase(phase.value);
    if (!phase.ok) throw new Error(phase.reason);
    phase = advancePhase(phase.value);
    if (!phase.ok) throw new Error(phase.reason);
    const redeployed = reduceGameAction(phase.value, actor, {
      type: 'deploy_operator',
      card_instance_id: operator.cardInstanceId,
      lane: 'L3',
      position: 'front',
      slot_index: 1,
    });
    expect(redeployed.ok).toBe(true);
  });
});
