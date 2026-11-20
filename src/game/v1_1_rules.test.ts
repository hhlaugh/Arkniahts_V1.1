import { describe, expect, it } from 'vitest';
import { BotPlayer, botMulliganChoice } from '../ai/botPlayer';
import { LocalGameController } from '../client/localGameController';
import { loadDemoData, summarizeValidation } from '../data/load-card-data';
import keywordsJson from '../data/keywords-v1.1.json';
import {
  CLASSIC_BOARD_PROFILE,
  CUSTOM_5_LANE_EXAMPLE,
  areAdjacentLanes,
  createCustomBoardProfile,
  getDisplaySlotLabel,
  validateBoardProfile,
} from './board';
import { resolveCombat } from './combat';
import { resolveDamagePipeline } from './combat-primitives';
import { advancePhase, createInitialGameState, mulligan, reduceGameAction } from './engine';
import { enumerateLegalActions } from './legal-actions';
import { isInterceptEligible, selectOrdinaryAttackTargets } from './range';
import type {
  CardId,
  CardInstance,
  CardInstanceId,
  Cost,
  DeckDefinition,
  GameState,
  HpValue,
  LaneId,
  PlayerId,
  Position,
} from './types';

const loaded = loadDemoData();
const cardsById = new Map(loaded.validCards.map((c) => [c.card_id, c]));

function makeDeckFromCardIds(deckId: string, cardIds: readonly string[]): DeckDefinition {
  const counts = new Map<string, number>();
  for (const cid of cardIds) counts.set(cid, (counts.get(cid) ?? 0) + 1);
  // Pad up to 20 cards with valid non-duplicate cards from card pool
  let idx = 0;
  while ([...counts.values()].reduce((a, b) => a + b, 0) < 20 && idx < loaded.validCards.length) {
    const candidate = loaded.validCards[idx]!;
    idx += 1;
    if ((counts.get(candidate.card_id) ?? 0) === 0) {
      counts.set(candidate.card_id, 1);
    }
  }
  return {
    deck_id: deckId,
    deck_name_zh: deckId,
    cards: [...counts.entries()].map(([card_id, quantity]) => ({ card_id: card_id as CardId, quantity })),
  };
}

function startGame(
  seed: number,
  options: {
    boardProfile?: typeof CLASSIC_BOARD_PROFILE;
    cardsA?: readonly string[];
    cardsB?: readonly string[];
  } = {},
): GameState {
  const deckA = options.cardsA ? makeDeckFromCardIds('V11-TEST-A', options.cardsA) : loaded.decks[0]!;
  const deckB = options.cardsB ? makeDeckFromCardIds('V11-TEST-B', options.cardsB) : loaded.decks[1]!;
  let state = createInitialGameState({
    decks: { player_a: deckA, player_b: deckB },
    cards: loaded.validCards,
    seed,
    boardProfile: options.boardProfile,
  });
  state = mulligan(state, 'player_a', []).value;
  state = mulligan(state, 'player_b', []).value;
  const started = advancePhase(state);
  if (!started.ok) throw new Error(started.reason);
  return started.value;
}

function giveHandCard(state: GameState, playerId: PlayerId, cardId: string): { state: GameState; id: CardInstanceId } {
  const found = Object.values(state.card_instances).find(
    (c) => c.owner_id === playerId && c.card_id === (cardId as CardId) && (c.zone === 'deck' || c.zone === 'hand'),
  );
  if (found) {
    const nextState: GameState = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...state.players[playerId],
          deck: state.players[playerId].deck.filter((x) => x !== found.card_instance_id),
          hand: [...state.players[playerId].hand.filter((x) => x !== found.card_instance_id), found.card_instance_id],
        },
      },
      card_instances: {
        ...state.card_instances,
        [found.card_instance_id]: { ...found, zone: 'hand' },
      },
    };
    return { state: nextState, id: found.card_instance_id };
  }
  const seq = state.next_entity_seq + 1;
  const id = `injected:${playerId}:${cardId}:${seq}` as CardInstanceId;
  const inst: CardInstance = {
    card_instance_id: id,
    card_id: cardId as CardId,
    zone: 'hand',
    owner_id: playerId,
    controller_id: playerId,
    board_half: null,
    lane: null,
    position: null,
    slot_index: null,
    operator_combat: undefined,
    operator_lifecycle: undefined,
    support_lifecycle: undefined,
  };
  return {
    state: {
      ...state,
      next_entity_seq: seq,
      players: {
        ...state.players,
        [playerId]: { ...state.players[playerId], hand: [...state.players[playerId].hand, id] },
      },
      card_instances: { ...state.card_instances, [id]: inst },
    },
    id,
  };
}

function placeBoardUnit(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  lane: LaneId,
  position: Position,
  slotIndex = 1,
  overrides: Partial<NonNullable<CardInstance['operator_combat']>> = {},
): { state: GameState; id: CardInstanceId } {
  const { state: s1, id } = giveHandCard(state, playerId, cardId);
  const def = cardsById.get(cardId as CardId)!;
  const next: GameState = {
    ...s1,
    players: {
      ...s1.players,
      [playerId]: { ...s1.players[playerId], hand: s1.players[playerId].hand.filter((x) => x !== id) },
    },
    card_instances: {
      ...s1.card_instances,
      [id]: {
        ...s1.card_instances[id],
        zone: 'board',
        board_half: playerId,
        lane,
        position,
        slot_index: slotIndex,
        entity_kind: def.support_subtype === 'facility' ? 'facility' : 'operator',
        operator_combat: {
          current_hp: ((overrides.current_hp ?? def.hp ?? 3) as HpValue),
          current_atk_modifiers: overrides.current_atk_modifiers ?? [],
          current_sp: 0 as never,
          shield: overrides.shield ?? 0,
          statuses: overrides.statuses ?? [],
          equipment_ids: [],
          equipped_package: overrides.equipped_package ?? null,
        },
        operator_lifecycle:
          def.support_subtype === 'facility'
            ? undefined
            : {
                redeploy_cd_remaining: 0,
                redeploy_cd_applied_owner_turn_index: null,
                has_deployed_before: true,
                entered_battle_this_owner_turn: false,
                paid_deploy_cost: def.cost as never,
                once_per_game_flags: {},
              },
        facility_state:
          def.support_subtype === 'facility'
            ? {
                remaining_turns: def.facility_duration ?? 3,
                disabled_until_owner_turn: null,
                pause_effects_when_disabled: true,
                continue_countdown_when_disabled: true,
              }
            : undefined,
      },
    },
  };
  return { state: next, id };
}

function setCp(state: GameState, playerId: PlayerId, cp: number, cap = 10): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...state.players[playerId], cost: cp as Cost, turn_cp_cap: cap },
    },
  };
}

describe('V1.1 规范全量验收测试', () => {
  it('1. 数据层：108 张卡（72 干员 + 24 战术 + 12 支援）+ 38 关键词 + 无超 8 费卡 + 零校验错误', () => {
    expect(loaded.validCards).toHaveLength(108);
    expect(loaded.validCards.filter((c) => c.card_type === 'operator')).toHaveLength(72);
    expect(loaded.validCards.filter((c) => c.card_type === 'tactic')).toHaveLength(24);
    expect(loaded.validCards.filter((c) => c.card_type === 'support')).toHaveLength(12);
    expect(loaded.validCards.every((c) => c.cost <= 8)).toBe(true);
    expect(summarizeValidation(loaded.issues)).toEqual({ errors: 0, warnings: 0 });
    expect(keywordsJson).toHaveLength(38);
  });

  it('2. 动态 BoardProfile：支持经典 3×2、单路与 5 路自定义，拒绝非法路线/格数', () => {
    expect(validateBoardProfile(CLASSIC_BOARD_PROFILE).valid).toBe(true);
    expect(validateBoardProfile(CUSTOM_5_LANE_EXAMPLE).valid).toBe(true);
    expect(validateBoardProfile(createCustomBoardProfile([{ frontSlots: 2, rearSlots: 2 }])).valid).toBe(true);

    expect(validateBoardProfile(createCustomBoardProfile([])).valid).toBe(false);
    expect(
      validateBoardProfile(
        createCustomBoardProfile(
          Array.from({ length: 6 }, () => ({ frontSlots: 1, rearSlots: 1 })),
        ),
      ).valid,
    ).toBe(false);
    expect(validateBoardProfile(createCustomBoardProfile([{ frontSlots: 0, rearSlots: 0 }])).valid).toBe(false);
    expect(validateBoardProfile(createCustomBoardProfile([{ frontSlots: 4, rearSlots: 1 }])).valid).toBe(false);

    expect(getDisplaySlotLabel('front', 2)).toBe('F2');
    expect(getDisplaySlotLabel('back', 3)).toBe('R3');
    expect(areAdjacentLanes(CUSTOM_5_LANE_EXAMPLE, 'L2', 'L3')).toBe(true);
    expect(areAdjacentLanes(CUSTOM_5_LANE_EXAMPLE, 'L1', 'L3')).toBe(false);
  });

  it('3. 索敌优先级（嘲讽 > 集火 > 干员优先级 > 路/排/格序）与低索敌隐匿规则', () => {
    let s = startGame(11);
    const actor = s.active_player_id;
    const enemy: PlayerId = actor === 'player_a' ? 'player_b' : 'player_a';

    // 默认按前排先，且集火可绕过同优先级敌方
    let atkId: CardInstanceId;
    let f1: CardInstanceId;
    let f2: CardInstanceId;
    let tauntId: CardInstanceId;
    ({ state: s, id: atkId } = placeBoardUnit(s, actor, 'OP-SNI-002', 'L1', 'back', 1));
    ({ state: s, id: f1 } = placeBoardUnit(s, enemy, 'OP-VAN-001', 'L1', 'front', 1));
    ({ state: s, id: f2 } = placeBoardUnit(s, enemy, 'OP-SNI-001', 'L1', 'back', 1));
    // 将后排设为集火目标（无嘲讽时优先打集火）
    s = reduceGameAction(s, actor, { type: 'set_focus_target', target_instance_id: f2 }).value;
    expect(selectOrdinaryAttackTargets(s, s.card_instances[atkId]!).map((u) => u.card_instance_id)).toEqual([f2]);

    // 添加嘲讽单位 -> 嘲讽优先级高于集火
    ({ state: s, id: tauntId } = placeBoardUnit(s, enemy, 'OP-DEF-003', 'L1', 'front', 1, {
      statuses: [{ kind: 'taunt', remaining_owner_turns: 1, applied_on_owner_turn_index: 1, blocks_normal_withdrawal: false }],
    }));
    expect(selectOrdinaryAttackTargets(s, s.card_instances[atkId]!).map((u) => u.card_instance_id)).toEqual([tauntId]);

    // 多路 3 格下检验同位置伊桑 / 狮蝎低索敌（先打正常目标而非隐匿单位）
    const wide = createCustomBoardProfile([{ frontSlots: 3, rearSlots: 2 }]);
    let w = startGame(12, { boardProfile: wide });
    const wActor = w.active_player_id;
    const wEnemy: PlayerId = wActor === 'player_a' ? 'player_b' : 'player_a';
    let wAttacker: CardInstanceId;
    let ethanId: CardInstanceId;
    let otherFrontId: CardInstanceId;
    ({ state: w, id: wAttacker } = placeBoardUnit(w, wActor, 'OP-GUA-001', 'L1', 'front', 1));
    ({ state: w, id: ethanId } = placeBoardUnit(w, wEnemy, 'OP-SPE-004', 'L1', 'front', 1));
    ({ state: w, id: otherFrontId } = placeBoardUnit(w, wEnemy, 'OP-VAN-001', 'L1', 'front', 2));
    expect(isInterceptEligible(w, w.card_instances[ethanId]!)).toBe(false);
    expect(isInterceptEligible(w, w.card_instances[otherFrontId]!)).toBe(true);
    // 槽位 1 是伊桑（隐匿不拦截），槽位 2 是芬 -> 选中芬
    expect(selectOrdinaryAttackTargets(w, w.card_instances[wAttacker]!).map((u) => u.card_instance_id)).toEqual([otherFrontId]);
  });

  it('4. 统一伤害顺序（易伤 -> 掩护减半 -> 护盾 -> 生命）与幽灵鲨不死、连击/群攻/直线/溅射/连锁', () => {
    let s = startGame(21);
    const actor = s.active_player_id;
    const enemy: PlayerId = actor === 'player_a' ? 'player_b' : 'player_a';

    // 幽灵鲨（OP-GUA-006）：首次致命伤害保留 1 HP 并永久 +2 ATK（鼓舞 2）
    let specterId: CardInstanceId;
    let heavyAttackerId: CardInstanceId;
    ({ state: s, id: heavyAttackerId } = placeBoardUnit(s, actor, 'OP-GUA-001', 'L1', 'front', 1, { current_atk_modifiers: [3] })); // 2+3=5 ATK
    ({ state: s, id: specterId } = placeBoardUnit(s, enemy, 'OP-GUA-006', 'L1', 'front', 1, { current_hp: 2 as HpValue }));
    // 统一伤害顺序验证（脆弱 +1 -> 掩护 -1 -> 护盾吸收 -> HP 扣减）
    const pipeRes = resolveDamagePipeline(s, {
      targetId: specterId,
      rawDamage: 2,
      damageType: 'physical',
      isBasicAttack: true,
    });
    expect(pipeRes.hpDamage).toBe(2);
    expect(pipeRes.defeated).toBe(true);

    // 幽灵鲨（OP-GUA-006）：战斗中首次致命伤害保留 1 HP 并永久 +2 ATK（鼓舞 2）
    const specterAfter = resolveCombat({ ...s, phase: 'combat' });
    expect(specterAfter.card_instances[specterId].zone).toBe('board');
    expect(specterAfter.card_instances[specterId].operator_combat?.current_hp).toBe(1);
    expect(specterAfter.card_instances[specterId].operator_combat?.permanent_atk_bonus).toBe(2);
    void heavyAttackerId;

    // 伊芙利特（OP-CAS-009）直线攻击穿透同路敌方前后排
    let ifritState = startGame(22);
    const ifritActor = ifritState.active_player_id;
    const ifritEnemy: PlayerId = ifritActor === 'player_a' ? 'player_b' : 'player_a';
    let eFront: CardInstanceId;
    let eBack: CardInstanceId;
    ({ state: ifritState } = placeBoardUnit(ifritState, ifritActor, 'OP-CAS-009', 'L2', 'back', 1));
    ({ state: ifritState, id: eFront } = placeBoardUnit(ifritState, ifritEnemy, 'OP-DEF-003', 'L2', 'front', 1, { current_hp: 5 as HpValue }));
    ({ state: ifritState, id: eBack } = placeBoardUnit(ifritState, ifritEnemy, 'OP-SNI-001', 'L2', 'back', 1, { current_hp: 3 as HpValue }));
    const postLine = resolveCombat({ ...ifritState, phase: 'combat' });
    expect(postLine.card_instances[eFront].operator_combat?.current_hp).toBe(4);
    expect(postLine.card_instances[eBack].operator_combat?.current_hp).toBe(2);

    // 炎熔（OP-CAS-002）主目标受 2 伤，相邻格受 1 溅射伤
    const wide = createCustomBoardProfile([{ frontSlots: 2, rearSlots: 1 }]);
    let lavaState = startGame(23, { boardProfile: wide });
    const lActor = lavaState.active_player_id;
    const lEnemy: PlayerId = lActor === 'player_a' ? 'player_b' : 'player_a';
    let slot1: CardInstanceId;
    let slot2: CardInstanceId;
    ({ state: lavaState } = placeBoardUnit(lavaState, lActor, 'OP-CAS-002', 'L1', 'back', 1));
    ({ state: lavaState, id: slot1 } = placeBoardUnit(lavaState, lEnemy, 'OP-DEF-003', 'L1', 'front', 1, { current_hp: 6 as HpValue }));
    ({ state: lavaState, id: slot2 } = placeBoardUnit(lavaState, lEnemy, 'OP-VAN-001', 'L1', 'front', 2, { current_hp: 2 as HpValue }));
    const postSplash = resolveCombat({ ...lavaState, phase: 'combat' });
    expect(postSplash.card_instances[slot1].operator_combat?.current_hp).toBe(4);
    expect(postSplash.card_instances[slot2].operator_combat?.current_hp).toBe(1);

    // 先发制人（DEMO-TAC-V2-023）：击败目标时无反击，消耗本次普攻
    let preState = startGame(24);
    const pActor = preState.active_player_id;
    const pEnemy: PlayerId = pActor === 'player_a' ? 'player_b' : 'player_a';
    preState = setCp(preState, pActor, 8, 10);
    let attackerId: CardInstanceId;
    let defenderId: CardInstanceId;
    let tacId: CardInstanceId;
    ({ state: preState, id: attackerId } = placeBoardUnit(preState, pActor, 'OP-GUA-002', 'L1', 'front', 1)); // 月见夜 atk 3
    ({ state: preState, id: defenderId } = placeBoardUnit(preState, pEnemy, 'OP-VAN-001', 'L1', 'front', 1, { current_hp: 2 as HpValue }));
    ({ state: preState, id: tacId } = giveHandCard(preState, pActor, 'DEMO-TAC-V2-023'));
    const preRes = reduceGameAction(preState, pActor, {
      type: 'play_card',
      card_instance_id: tacId,
      target_instance_id: attackerId,
    });
    expect(preRes.ok).toBe(true);
    if (preRes.ok) {
      expect(preRes.value.card_instances[defenderId].zone).toBe('discard');
      expect(preRes.value.card_instances[attackerId].operator_combat?.current_hp).toBe(2); // 未被反击
      expect(preRes.value.card_instances[attackerId].operator_combat?.consumed_normal_attack_this_turn).toBe(true);
    }
  });

  it('5. CP 曲线（3..8）、turn_cp_cap = min(10, base+2)、叠减费、孑维护费未付退场', () => {
    let s = startGame(31);
    const actor = s.active_player_id;
    expect(s.players[actor].cost).toBe(3);
    expect(s.players[actor].turn_cp_cap).toBe(5);

    // 空降部署（DEMO-TAC-V2-002，cost 1 -> 下次部署 -2 CP）+ 2 CP 干员减 2 费变成 0 CP 部署
    s = setCp(s, actor, 5, 5);
    let tac1: CardInstanceId;
    let guardId: CardInstanceId;
    ({ state: s, id: tac1 } = giveHandCard(s, actor, 'DEMO-TAC-V2-002'));
    ({ state: s, id: guardId } = giveHandCard(s, actor, 'OP-GUA-001')); // cost 2
    s = reduceGameAction(s, actor, { type: 'play_card', card_instance_id: tac1 }).value;
    expect(s.players[actor].next_deploy_discounts.reduce((sum, d) => sum + d.amount, 0)).toBe(2);
    // 2 CP 干员减 2 费变成 0 CP 部署
    s = reduceGameAction(s, actor, {
      type: 'deploy_operator',
      card_instance_id: guardId,
      lane: 'L1',
      position: 'front',
      slot_index: 1,
    }).value;
    expect(s.players[actor].cost).toBe(4); // 5 - 1(战术) - 0(干员) = 4

    // 孑（OP-SPE-005）在场、回合开始若 CP 无法支付 1 费维护 -> 自动退场进入弃牌堆
    let jayeState = startGame(32);
    const jActor = jayeState.active_player_id;
    let jayeId: CardInstanceId;
    ({ state: jayeState, id: jayeId } = placeBoardUnit(jayeState, jActor, 'OP-SPE-005', 'L1', 'front', 1));
    // 调整 cp_curve 使下回合基础 CP = 0
    const zeroCurveState: GameState = {
      ...jayeState,
      cp_curve: [0],
      phase: 'turn_start',
      active_player_id: jActor,
      turn_start_prepared: false,
    };
    const upkeepTurn = advancePhase(zeroCurveState);
    if (!upkeepTurn.ok) throw new Error(upkeepTurn.reason);
    expect(upkeepTurn.value.card_instances[jayeId].zone).toBe('discard');
    expect(upkeepTurn.value.combat_log.some((e) => e.cause === 'upkeep_unpaid')).toBe(true);
  });

  it('6. 设施（3 HP 占格、失效暂停效果但继续计时、3 回合到期销毁）与装备（单槽覆盖、向下钳位 HP）', () => {
    let s = startGame(41);
    const actor = s.active_player_id;
    const enemy: PlayerId = actor === 'player_a' ? 'player_b' : 'player_a';
    s = setCp(s, actor, 10, 10);

    // 己方部署前线掩体（DEMO-SUP-V2-001）
    let facId: CardInstanceId;
    ({ state: s, id: facId } = giveHandCard(s, actor, 'DEMO-SUP-V2-001'));
    s = reduceGameAction(s, actor, {
      type: 'play_card',
      card_instance_id: facId,
      target_lane: 'L1',
      target_position: 'back',
      target_slot_index: 1,
    }).value;
    expect(s.card_instances[facId].zone).toBe('board');
    expect(s.card_instances[facId].operator_combat?.current_hp).toBe(3);

    // 敌方打出设施破坏（DEMO-TAC-V2-020）使之失效
    let breakId: CardInstanceId;
    ({ state: s, id: breakId } = giveHandCard(s, enemy, 'DEMO-TAC-V2-020'));
    s = setCp({ ...s, active_player_id: enemy }, enemy, 5, 5);
    s = reduceGameAction(s, enemy, {
      type: 'play_card',
      card_instance_id: breakId,
      target_instance_id: facId,
    }).value;
    expect(s.card_instances[facId].facility_state?.disabled_until_owner_turn).not.toBeNull();

    // 轮到原控制者回合开始：失效期间暂停触发效果，不产生 pending_effect_choices，且 remaining_turns 仍倒计时 3 -> 2
    const nextStart = advancePhase({
      ...s,
      phase: 'turn_start',
      active_player_id: actor,
      turn_start_prepared: false,
    });
    if (!nextStart.ok) throw new Error(nextStart.reason);
    expect(nextStart.value.pending_effect_choices).toHaveLength(0);
    expect(nextStart.value.card_instances[facId].facility_state?.remaining_turns).toBe(2);
  });

  it('7. 召唤物：米波/幻影/医疗无人机（2回合销毁）/麦哲伦（选机台）/手动召回与本体离场清除', () => {
    // 麦哲伦（OP-SUP-009）：部署触发 choose_and_summon 弹窗选择
    let s = startGame(51);
    const actor = s.active_player_id;
    s = setCp(s, actor, 10, 10);
    let magId: CardInstanceId;
    ({ state: s, id: magId } = giveHandCard(s, actor, 'OP-SUP-009'));
    s = reduceGameAction(s, actor, {
      type: 'deploy_operator',
      card_instance_id: magId,
      lane: 'L1',
      position: 'back',
      slot_index: 1,
    }).value;
    expect(s.pending_effect_choices).toHaveLength(1);
    const droneChosen = reduceGameAction(s, actor, {
      type: 'resolve_pending_choice',
      source_instance_id: s.pending_effect_choices[0]!.source_instance_id,
      choice_id: 'strike_drone',
    });
    expect(droneChosen.ok).toBe(true);
    if (!droneChosen.ok) return;
    const drone = Object.values(droneChosen.value.card_instances).find(
      (i) => i.zone === 'board' && i.summon_state?.source_instance_id === magId,
    );
    expect(drone?.summon_state?.token_id).toBe('magallan_strike_drone');

    // 手动召回召唤物可腾出格子
    const recalled = reduceGameAction(droneChosen.value, actor, {
      type: 'recall_summon',
      card_instance_id: drone!.card_instance_id,
    });
    expect(recalled.ok).toBe(true);
    if (!recalled.ok) return;
    expect(recalled.value.card_instances[drone!.card_instance_id]?.zone).toBe('discard');
    expect(recalled.value.card_instances[drone!.card_instance_id]?.lane).toBeNull();

    // 本体退场时自动清理其关联召唤物（傀影 OP-SPE-008 + 幻影分身）
    let phState = startGame(52);
    const phActor = phState.active_player_id;
    phState = setCp(phState, phActor, 10, 10);
    let phantomId: CardInstanceId;
    ({ state: phState, id: phantomId } = giveHandCard(phState, phActor, 'OP-SPE-008'));
    phState = reduceGameAction(phState, phActor, {
      type: 'deploy_operator',
      card_instance_id: phantomId,
      lane: 'L2',
      position: 'front',
      slot_index: 1,
    }).value;
    const shadow = Object.values(phState.card_instances).find(
      (i) => i.zone === 'board' && i.summon_state?.source_instance_id === phantomId,
    );
    expect(shadow).toBeDefined();
    phState = reduceGameAction(phState, phActor, {
      type: 'withdraw_operator',
      card_instance_id: phantomId,
    }).value;
    expect(phState.card_instances[shadow!.card_instance_id]?.zone).toBe('discard');
    expect(phState.card_instances[shadow!.card_instance_id]?.lane).toBeNull();
  });

  it('8. 经典 3 路、自定义单路与 5 路棋盘 AI 完整对局回归与 PlayerView 脱敏校验', { timeout: 60_000 }, () => {
    const singleLane = createCustomBoardProfile([{ frontSlots: 2, rearSlots: 2 }], 'single-lane-2x2');
    for (const [label, profile, seed] of [
      ['classic', CLASSIC_BOARD_PROFILE, 1001],
      ['single', singleLane, 1002],
      ['custom-5', CUSTOM_5_LANE_EXAMPLE, 1003],
    ] as const) {
      const controller = LocalGameController.create({
        decks: { player_a: loaded.decks[0]!, player_b: loaded.decks[1]! },
        cards: loaded.validCards,
        seed,
        boardProfile: profile,
      });
      const state0 = controller.getSnapshot().state;
      controller.submitMulligan('player_a', botMulliganChoice(state0, 'player_a'));
      controller.submitMulligan('player_b', botMulliganChoice(state0, 'player_b'));

      // PlayerView 投影校验：含动态棋盘配置与脱敏隔离
      const viewA = controller.toPlayerView('player_a');
      expect(viewA.rulesVersion).toBe('1.1');
      expect(viewA.boardProfile.profileId).toBe(profile.profileId);
      expect(viewA.boardProfile.laneCount).toBe(profile.laneCount);
      expect(viewA.players.player_b).not.toHaveProperty('hand');

      const bots = {
        player_a: new BotPlayer({ player: 'player_a', rng: () => 0.5 }),
        player_b: new BotPlayer({ player: 'player_b', rng: () => 0.5 }),
      };

      let steps = 0;
      while (controller.getSnapshot().state.phase !== 'finished' && steps < 4000) {
        const cur = controller.getSnapshot().state;
        const actor = cur.active_player_id;
        const action = bots[actor].decide(cur);
        const res = controller.dispatch(actor, action);
        if (!res.ok) {
          const legal = enumerateLegalActions(cur, actor);
          expect(legal.length).toBeGreaterThan(0);
          expect(controller.dispatch(actor, legal[0]!).ok).toBe(true);
        }
        steps += 1;
      }

      const finalState = controller.getSnapshot().state;
      expect(finalState.phase, `board=${label}`).toBe('finished');
      expect(finalState.winner, `board=${label}`).not.toBeNull();
    }
  });
});
