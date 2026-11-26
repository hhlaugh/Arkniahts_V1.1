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
import { applyStatusToInstance, grantShieldToEntity, healEntity, resolveDamagePipeline } from './combat-primitives';
import { executeEffectOps } from './effects';
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
        entity_kind: def.card_type === 'facility' || def.support_subtype === 'facility' ? 'facility' : 'operator',
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
          def.card_type === 'facility' || def.support_subtype === 'facility'
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
          def.card_type === 'facility' || def.support_subtype === 'facility'
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
  it('1. 数据层：108 张卡（72 干员 + 24 战术 + 6 设施 + 6 支援）+ 35 关键词（含突击，暂不做卡牌拓展）+ 无超 8 费卡 + 零校验错误', () => {
    expect(loaded.validCards).toHaveLength(108);
    expect(loaded.validCards.filter((c) => c.card_type === 'operator')).toHaveLength(72);
    expect(loaded.validCards.filter((c) => c.card_type === 'tactic')).toHaveLength(24);
    expect(loaded.validCards.filter((c) => c.card_type === 'facility')).toHaveLength(6);
    expect(loaded.validCards.filter((c) => c.card_type === 'support')).toHaveLength(6);
    expect(loaded.validCards.every((c) => c.cost <= 8)).toBe(true);
    expect(summarizeValidation(loaded.issues)).toEqual({ errors: 0, warnings: 0 });
    expect(keywordsJson).toHaveLength(35);
    expect(keywordsJson.some((k) => k.keyword_id === 'assault' && k.keyword_name_zh === '突击')).toBe(true);
    expect(loaded.validCards.every((c) => !(c.keyword_tokens ?? '').split(';').includes('突击'))).toBe(true);
  });

  it('2. 动态 BoardProfile：支持经典三路 21/32/21、单路与 5 路自定义，拒绝非法路线/格数', () => {
    expect(validateBoardProfile(CLASSIC_BOARD_PROFILE).valid).toBe(true);
    expect(CLASSIC_BOARD_PROFILE.lanes.map((l) => `${l.frontSlots}${l.rearSlots}`)).toEqual(['21', '32', '21']);
    expect(validateBoardProfile(CUSTOM_5_LANE_EXAMPLE).valid).toBe(true);
    expect(validateBoardProfile(createCustomBoardProfile([{ frontSlots: 2, rearSlots: 2 }])).valid).toBe(true);

    // 旧版 3×2 classic 配置不再合法
    expect(
      validateBoardProfile({
        profileId: 'legacy-3x2',
        mode: 'classic',
        laneCount: 3,
        lanes: [
          { laneId: 'L1', laneOrder: 0, frontSlots: 1, rearSlots: 1 },
          { laneId: 'L2', laneOrder: 1, frontSlots: 1, rearSlots: 1 },
          { laneId: 'L3', laneOrder: 2, frontSlots: 1, rearSlots: 1 },
        ],
      }).valid,
    ).toBe(false);

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

  it('3. 索敌优先级（嘲讽 > 标记 > 干员优先级 > 路/排/格序）与低索敌隐匿规则', () => {
    let s = startGame(11);
    const actor = s.active_player_id;
    const enemy: PlayerId = actor === 'player_a' ? 'player_b' : 'player_a';

    // 默认按前排先，且标记可绕过同优先级敌方
    let atkId: CardInstanceId;
    let f1: CardInstanceId;
    let f2: CardInstanceId;
    let tauntId: CardInstanceId;
    ({ state: s, id: atkId } = placeBoardUnit(s, actor, 'OP-SNI-002', 'L1', 'back', 1));
    ({ state: s, id: f1 } = placeBoardUnit(s, enemy, 'OP-VAN-001', 'L1', 'front', 1));
    ({ state: s, id: f2 } = placeBoardUnit(s, enemy, 'OP-SNI-001', 'L1', 'back', 1));
    // 将后排设为标记目标（无嘲讽时优先打标记）
    s = reduceGameAction(s, actor, { type: 'set_focus_target', target_instance_id: f2 }).value;
    expect(selectOrdinaryAttackTargets(s, s.card_instances[atkId]!).map((u) => u.card_instance_id)).toEqual([f2]);

    // 添加嘲讽单位 -> 嘲讽优先级高于标记
    ({ state: s, id: tauntId } = placeBoardUnit(s, enemy, 'OP-DEF-003', 'L1', 'front', 1, {
      statuses: [{ kind: 'taunt', remaining_owner_turns: 1, applied_on_owner_turn_index: 1, blocks_normal_withdrawal: false }],
    }));
    expect(selectOrdinaryAttackTargets(s, s.card_instances[atkId]!).map((u) => u.card_instance_id)).toEqual([tauntId]);

    // 多路 3 格下检验伊桑 / 狮蝎伏击客规则：不拦截但可被攻击，未标记下优先级等同基本分（仅伏击客时直击基地），标记可命中，且仅压制最高攻敌方单位
    const wide = createCustomBoardProfile([{ frontSlots: 3, rearSlots: 2 }]);
    let w = startGame(12, { boardProfile: wide });
    const wActor = w.active_player_id;
    const wEnemy: PlayerId = wActor === 'player_a' ? 'player_b' : 'player_a';
    let wAttacker: CardInstanceId;
    let ethanId: CardInstanceId;
    let otherFrontId: CardInstanceId;
    ({ state: w, id: wAttacker } = placeBoardUnit(w, wActor, 'OP-GUA-001', 'L1', 'front', 1));
    ({ state: w, id: ethanId } = placeBoardUnit(w, wEnemy, 'OP-SPE-004', 'L1', 'front', 1));
    expect(isInterceptEligible(w, w.card_instances[ethanId]!)).toBe(false);
    // 1) 仅有伏击客且未标记 -> 返回空目标并直接攻击敌方基地基本分
    expect(selectOrdinaryAttackTargets(w, w.card_instances[wAttacker]!)).toEqual([]);
    const baseBefore = w.players[wEnemy].base_points;
    const directBaseRes = resolveCombat({ ...w, phase: 'combat' });
    expect(directBaseRes.players[wEnemy].base_points).toBe(baseBefore - 2);
    expect(directBaseRes.card_instances[ethanId]?.operator_combat?.current_hp).toBe(3);

    // 2) 对伏击客下达标记指令 -> 可直接攻击伏击客
    const focusedEthan = reduceGameAction(w, wActor, { type: 'set_focus_target', target_instance_id: ethanId }).value;
    expect(selectOrdinaryAttackTargets(focusedEthan, focusedEthan.card_instances[wAttacker]!).map((u) => u.card_instance_id)).toEqual([ethanId]);

    // 3) 场上同时存在常规可拦截单位与伏击客且未标记 -> 优先打常规目标而非伏击客
    ({ state: w, id: otherFrontId } = placeBoardUnit(w, wEnemy, 'OP-VAN-001', 'L1', 'front', 2));
    expect(isInterceptEligible(w, w.card_instances[otherFrontId]!)).toBe(true);
    expect(selectOrdinaryAttackTargets(w, w.card_instances[wAttacker]!).map((u) => u.card_instance_id)).toEqual([otherFrontId]);

    // 4) 伊桑（OP-SPE-004）多目标攻击后仅压制实际受伤目标中攻击力最高的 1 名敌方单位
    let ethanTest = startGame(13, { boardProfile: wide });
    const eActor = ethanTest.active_player_id;
    const eEnemy: PlayerId = eActor === 'player_a' ? 'player_b' : 'player_a';
    let eLowAtk: CardInstanceId;
    let eHighAtk: CardInstanceId;
    ({ state: ethanTest } = placeBoardUnit(ethanTest, eActor, 'OP-SPE-004', 'L1', 'front', 1));
    ({ state: ethanTest, id: eLowAtk } = placeBoardUnit(ethanTest, eEnemy, 'OP-DEF-003', 'L1', 'front', 1, { current_hp: 6 as HpValue })); // atk 1
    ({ state: ethanTest, id: eHighAtk } = placeBoardUnit(ethanTest, eEnemy, 'OP-GUA-002', 'L1', 'front', 2, { current_hp: 5 as HpValue })); // atk 3
    const afterEthanCombat = resolveCombat({ ...ethanTest, phase: 'combat' });
    expect(afterEthanCombat.card_instances[eHighAtk]?.operator_combat?.statuses.some((st) => st.kind === 'suppressed')).toBe(true);
    expect(afterEthanCombat.card_instances[eLowAtk]?.operator_combat?.statuses.some((st) => st.kind === 'suppressed')).toBe(false);

    // 5) 狮蝎（OP-SPE-006）战斗开始时仅压制同路攻击力最高的 1 名敌方单位
    let manticoreTest = startGame(14, { boardProfile: wide });
    const mActor = manticoreTest.active_player_id;
    const mEnemy: PlayerId = mActor === 'player_a' ? 'player_b' : 'player_a';
    let mLowAtk: CardInstanceId;
    let mHighAtk: CardInstanceId;
    ({ state: manticoreTest } = placeBoardUnit(manticoreTest, mActor, 'OP-SPE-006', 'L1', 'front', 1));
    ({ state: manticoreTest, id: mLowAtk } = placeBoardUnit(manticoreTest, mEnemy, 'OP-VAN-001', 'L1', 'front', 1, { current_hp: 6 as HpValue })); // atk 2
    ({ state: manticoreTest, id: mHighAtk } = placeBoardUnit(manticoreTest, mEnemy, 'OP-GUA-005', 'L1', 'front', 2, { current_hp: 6 as HpValue })); // atk 3
    const afterManticoreCombat = resolveCombat({ ...manticoreTest, phase: 'combat' });
    expect(afterManticoreCombat.card_instances[mHighAtk]?.operator_combat?.statuses.some((st) => st.kind === 'suppressed')).toBe(true);
    expect(afterManticoreCombat.card_instances[mLowAtk]?.operator_combat?.statuses.some((st) => st.kind === 'suppressed')).toBe(false);
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

  it('6. 设施（可前/后排占格、不受治疗/增益/减益/位移影响、每回合自身扣 1 HP 至归零销毁）与装备规则', () => {
    let s = startGame(41);
    const actor = s.active_player_id;
    const enemy: PlayerId = actor === 'player_a' ? 'player_b' : 'player_a';
    s = setCp(s, actor, 10, 10);

    // 己方部署前线掩体（DEMO-SUP-V2-001）于后排 + 战术通讯终端（DEMO-SUP-V2-002）于前排
    let facId: CardInstanceId;
    let frontFacId: CardInstanceId;
    ({ state: s, id: facId } = giveHandCard(s, actor, 'DEMO-SUP-V2-001'));
    ({ state: s, id: frontFacId } = giveHandCard(s, actor, 'DEMO-SUP-V2-002'));
    s = reduceGameAction(s, actor, {
      type: 'play_card',
      card_instance_id: facId,
      target_lane: 'L1',
      target_position: 'back',
      target_slot_index: 1,
    }).value;
    s = reduceGameAction(s, actor, {
      type: 'play_card',
      card_instance_id: frontFacId,
      target_lane: 'L2',
      target_position: 'front',
      target_slot_index: 1,
    }).value;
    expect(s.card_instances[facId].zone).toBe('board');
    expect(s.card_instances[facId].position).toBe('back');
    expect(s.card_instances[facId].operator_combat?.current_hp).toBe(3);
    expect(s.card_instances[frontFacId].zone).toBe('board');
    expect(s.card_instances[frontFacId].position).toBe('front');

    // 设施免疫治疗、护盾、状态（掩护/压制/冻结/易伤）、属性增益及位移
    let damagedFac = resolveDamagePipeline(s, {
      targetId: facId,
      rawDamage: 1,
      damageType: 'physical',
      isBasicAttack: true,
    }).state;
    expect(damagedFac.card_instances[facId].operator_combat?.current_hp).toBe(2);

    const healed = healEntity(damagedFac, facId, 2);
    expect(healed.actualHeal).toBe(0);
    expect(healed.state.card_instances[facId].operator_combat?.current_hp).toBe(2);

    const shielded = grantShieldToEntity(healed.state, facId, 2);
    expect(shielded.card_instances[facId].operator_combat?.shield).toBe(0);

    let statusBlocked = applyStatusToInstance(shielded, facId, 'cover', 1);
    statusBlocked = applyStatusToInstance(statusBlocked, facId, 'suppressed', 1);
    statusBlocked = applyStatusToInstance(statusBlocked, facId, 'freeze', 1);
    statusBlocked = applyStatusToInstance(statusBlocked, facId, 'vulnerable', 1);
    expect(statusBlocked.card_instances[facId].operator_combat?.statuses).toEqual([]);

    const statBuffed = executeEffectOps(
      statusBlocked,
      [{ op: 'increase_attack_permanently', target: 'selected_friendly_unit', amount: 2 }],
      { sourceId: facId, sourceName: '测试', actorId: actor, selectedTargetId: facId },
    ).state;
    expect(statBuffed.card_instances[facId].operator_combat?.permanent_atk_bonus ?? 0).toBe(0);

    // 前排设施不可被 push_unit 位移至后排
    const pushRes = executeEffectOps(
      statBuffed,
      [{ op: 'push_unit', target: 'selected_enemy_operator' }],
      { sourceId: facId, sourceName: '推击测试', actorId: enemy, selectedTargetId: frontFacId },
    ).state;
    expect(pushRes.card_instances[frontFacId].position).toBe('front');

    // 敌方打出设施破坏（DEMO-TAC-V2-020）使 facId 失效
    let breakId: CardInstanceId;
    ({ state: s, id: breakId } = giveHandCard(s, enemy, 'DEMO-TAC-V2-020'));
    s = setCp({ ...s, active_player_id: enemy }, enemy, 5, 5);
    s = reduceGameAction(s, enemy, {
      type: 'play_card',
      card_instance_id: breakId,
      target_instance_id: facId,
    }).value;
    expect(s.card_instances[facId].facility_state?.disabled_until_owner_turn).not.toBeNull();

    // 回合开始：失效期间暂停触发效果，且每回合自身扣除 1 HP（3 -> 2 -> 1 -> 0 摧毁进弃牌堆）
    const turn1 = advancePhase({
      ...s,
      phase: 'turn_start',
      active_player_id: actor,
      turn_start_prepared: false,
    });
    if (!turn1.ok) throw new Error(turn1.reason);
    expect(turn1.value.pending_effect_choices).toHaveLength(0);
    expect(turn1.value.card_instances[facId].operator_combat?.current_hp).toBe(2);
    expect(turn1.value.card_instances[frontFacId].operator_combat?.current_hp).toBe(2);

    const turn2 = advancePhase({
      ...turn1.value,
      phase: 'turn_start',
      active_player_id: actor,
      turn_start_prepared: false,
    });
    if (!turn2.ok) throw new Error(turn2.reason);
    expect(turn2.value.card_instances[facId].operator_combat?.current_hp).toBe(1);

    const turn3 = advancePhase({
      ...turn2.value,
      phase: 'turn_start',
      active_player_id: actor,
      turn_start_prepared: false,
    });
    if (!turn3.ok) throw new Error(turn3.reason);
    expect(turn3.value.card_instances[facId].zone).toBe('discard');
    expect(turn3.value.combat_log.some((e) => e.target_instance_id === facId && e.cause === 'self_hp_loss')).toBe(true);
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

  it('10. 阿消/温蒂部署推击敌方前位且敌方后位有设施占用时，伤害与压制作用于被推敌方而非自身', () => {
    let s = startGame(901);
    const actor = s.active_player_id;
    const enemy: PlayerId = actor === 'player_a' ? 'player_b' : 'player_a';
    s = setCp(s, actor, 10, 10);

    let enemyFrontId: CardInstanceId;
    let enemyFacilityId: CardInstanceId;
    let shawHandId: CardInstanceId;
    // 敌方 L1 前排有芬（HP 4），L1 后排有设施（前线掩体）
    ({ state: s, id: enemyFrontId } = placeBoardUnit(s, enemy, 'OP-VAN-001', 'L1', 'front', 1, {
      current_hp: 4 as HpValue,
    }));
    ({ state: s, id: enemyFacilityId } = placeBoardUnit(s, enemy, 'DEMO-SUP-V2-001', 'L1', 'back', 1));
    ({ state: s, id: shawHandId } = giveHandCard(s, actor, 'OP-SPE-002'));

    const res = reduceGameAction(s, actor, {
      type: 'deploy_operator',
      card_instance_id: shawHandId,
      lane: 'L1',
      position: 'front',
      slot_index: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const after = res.value;
    const shaw = after.card_instances[shawHandId]!;
    const pushedEnemy = after.card_instances[enemyFrontId]!;
    const rearFacility = after.card_instances[enemyFacilityId]!;

    // 阿消自身满血且未被压制
    expect(shaw.zone).toBe('board');
    expect(shaw.operator_combat?.current_hp).toBe(2);
    expect(shaw.operator_combat?.statuses.some((st) => st.kind === 'suppressed')).toBe(false);

    // 敌方前排留守前排并受到 1 点伤害与压制；敌方后排设施完好
    expect(pushedEnemy.position).toBe('front');
    expect(pushedEnemy.operator_combat?.current_hp).toBe(3);
    expect(pushedEnemy.operator_combat?.statuses.some((st) => st.kind === 'suppressed')).toBe(true);
    expect(rearFacility.position).toBe('back');
    expect(rearFacility.operator_combat?.current_hp).toBe(3);

    // 同理验证温蒂（OP-SPE-009）在 L3 后排被设施占用时，2点伤害与压制作用于敌方而非自身
    let wendyState = startGame(902);
    const wActor = wendyState.active_player_id;
    const wEnemy: PlayerId = wActor === 'player_a' ? 'player_b' : 'player_a';
    wendyState = setCp(wendyState, wActor, 10, 10);
    let wEnemyFrontId: CardInstanceId;
    let wendyHandId: CardInstanceId;
    ({ state: wendyState, id: wEnemyFrontId } = placeBoardUnit(wendyState, wEnemy, 'OP-DEF-003', 'L3', 'front', 1, {
      current_hp: 5 as HpValue,
    }));
    ({ state: wendyState } = placeBoardUnit(wendyState, wEnemy, 'DEMO-SUP-V2-002', 'L3', 'back', 1));
    ({ state: wendyState, id: wendyHandId } = giveHandCard(wendyState, wActor, 'OP-SPE-009'));

    const wRes = reduceGameAction(wendyState, wActor, {
      type: 'deploy_operator',
      card_instance_id: wendyHandId,
      lane: 'L3',
      position: 'front',
      slot_index: 1,
    });
    expect(wRes.ok).toBe(true);
    if (!wRes.ok) return;
    const wAfter = wRes.value;
    expect(wAfter.card_instances[wendyHandId]?.operator_combat?.statuses.some((st) => st.kind === 'suppressed')).toBe(false);
    expect(wAfter.card_instances[wendyHandId]?.operator_combat?.current_hp).toBe(3);
    expect(wAfter.card_instances[wEnemyFrontId]?.operator_combat?.current_hp).toBe(3);
    expect(wAfter.card_instances[wEnemyFrontId]?.operator_combat?.statuses.some((st) => st.kind === 'suppressed')).toBe(true);
  });

  it('11. 艾雅法拉（OP-CAS-008）平衡调整：4 费 4/2，命中主目标后对每条相邻路线各1名敌人造成1点无视掩护的法术溅射伤害，空路直击不溅射', () => {
    const eyjaDef = cardsById.get('OP-CAS-008' as CardId)!;
    expect(eyjaDef.cost).toBe(4);
    expect(eyjaDef.hp).toBe(4);
    expect(eyjaDef.atk).toBe(2);

    // 场景 A：中路 L2 艾雅法拉攻击 L2 主目标，同时 L1 与 L3 各有敌方（且 L1 敌人携带【掩护】）
    let s = startGame(911);
    const actor = s.active_player_id;
    const enemy: PlayerId = actor === 'player_a' ? 'player_b' : 'player_a';

    let eyjaId: CardInstanceId;
    let l1EnemyId: CardInstanceId;
    let l1SecondEnemyId: CardInstanceId;
    let l2EnemyId: CardInstanceId;
    let l3EnemyId: CardInstanceId;

    ({ state: s, id: eyjaId } = placeBoardUnit(s, actor, 'OP-CAS-008', 'L2', 'back', 1));
    ({ state: s, id: l2EnemyId } = placeBoardUnit(s, enemy, 'OP-DEF-003', 'L2', 'front', 1, {
      current_hp: 5 as HpValue,
    }));
    ({ state: s, id: l1EnemyId } = placeBoardUnit(s, enemy, 'OP-VAN-001', 'L1', 'front', 1, {
      current_hp: 4 as HpValue,
    }));
    ({ state: s, id: l1SecondEnemyId } = placeBoardUnit(s, enemy, 'OP-VAN-002', 'L1', 'front', 2, {
      current_hp: 3 as HpValue,
    }));
    ({ state: s, id: l3EnemyId } = placeBoardUnit(s, enemy, 'OP-SNI-001', 'L3', 'back', 1, {
      current_hp: 2 as HpValue,
    }));

    // 给 L1 首目标挂上【掩护】，验证法术溅射无视且不消耗掩护
    s = applyStatusToInstance(s, l1EnemyId, 'cover', 1);

    const after = resolveCombat(s);
    // 主目标（L2）受到 2 点法伤（5 -> 3）
    expect(after.card_instances[l2EnemyId]?.operator_combat?.current_hp).toBe(3);
    // L1 首位敌人受到 1 点法术溅射（4 -> 3）且保留【掩护】
    expect(after.card_instances[l1EnemyId]?.operator_combat?.current_hp).toBe(3);
    expect(after.card_instances[l1EnemyId]?.operator_combat?.statuses.some((st) => st.kind === 'cover')).toBe(true);
    // L1 第二名敌人不受伤害（每条邻路仅 1 名）
    expect(after.card_instances[l1SecondEnemyId]?.operator_combat?.current_hp).toBe(3);
    // L3 敌人受到 1 点法术溅射（2 -> 1）
    expect(after.card_instances[l3EnemyId]?.operator_combat?.current_hp).toBe(1);
    // 艾雅法拉保持满血 4 点，没有额外的 combat_start AOE
    expect(after.card_instances[eyjaId]?.operator_combat?.current_hp).toBe(4);

    // 场景 B：艾雅法拉直击空路基地时不触发相邻路溅射
    let sDirect = startGame(912);
    const dActor = sDirect.active_player_id;
    const dEnemy: PlayerId = dActor === 'player_a' ? 'player_b' : 'player_a';
    let dL1EnemyId: CardInstanceId;

    ({ state: sDirect } = placeBoardUnit(sDirect, dActor, 'OP-CAS-008', 'L2', 'back', 1));
    ({ state: sDirect, id: dL1EnemyId } = placeBoardUnit(sDirect, dEnemy, 'OP-VAN-001', 'L1', 'front', 1, {
      current_hp: 4 as HpValue,
    }));

    const directAfter = resolveCombat(sDirect);
    expect(directAfter.players[dEnemy].base_points).toBe(18);
    expect(directAfter.card_instances[dL1EnemyId]?.operator_combat?.current_hp).toBe(4);
  });

  it('12. 后手首次部署干员获得【突击】：无视部署回合冷却立即攻击，先手方与后手后续部署不获得', () => {
    let s = startGame(921);
    const firstPlayer = s.first_player_id ?? s.active_player_id;
    const secondPlayer: PlayerId = firstPlayer === 'player_a' ? 'player_b' : 'player_a';
    expect(s.active_player_id).toBe(firstPlayer);

    // 先手方部署第一个干员（OP-VAN-001，ATK 1）：不获得【突击】，本回合无法攻击敌方基地
    s = setCp(s, firstPlayer, 10, 10);
    let p1Op1: CardInstanceId;
    ({ state: s, id: p1Op1 } = giveHandCard(s, firstPlayer, 'OP-VAN-001'));
    const p1DeployRes = reduceGameAction(s, firstPlayer, {
      type: 'deploy_operator',
      card_instance_id: p1Op1,
      lane: 'L1',
      position: 'front',
      slot_index: 1,
    });
    expect(p1DeployRes.ok).toBe(true);
    s = p1DeployRes.value;
    expect(s.card_instances[p1Op1]?.operator_combat?.statuses.some((st) => st.kind === 'assault')).toBe(false);
    expect(s.card_instances[p1Op1]?.operator_combat?.granted_immediate_attack_this_turn).not.toBe(true);

    // 结束先手行动阶段 -> 进入作战并推进结算，再推进到后手行动阶段
    const p2BaseBeforeP1End = s.players[secondPlayer].base_points;
    let endP1 = reduceGameAction(s, firstPlayer, { type: 'end_action_phase' });
    expect(endP1.ok).toBe(true);
    s = advancePhase(endP1.value).value;
    // 先手刚部署干员未攻击，后手基地血量未减少
    expect(s.players[secondPlayer].base_points).toBe(p2BaseBeforeP1End);
    while (s.active_player_id !== secondPlayer || s.phase !== 'action') {
      const adv = advancePhase(s);
      if (!adv.ok) throw new Error(adv.reason);
      s = adv.value;
    }

    // 后手方首次部署干员（OP-GUA-001，ATK 2）：获得【突击】，本回合立即攻击先手基地
    s = setCp(s, secondPlayer, 10, 10);
    let p2Op1: CardInstanceId;
    let p2Op2: CardInstanceId;
    ({ state: s, id: p2Op1 } = giveHandCard(s, secondPlayer, 'OP-GUA-001'));
    ({ state: s, id: p2Op2 } = giveHandCard(s, secondPlayer, 'OP-VAN-001'));

    const p2Deploy1 = reduceGameAction(s, secondPlayer, {
      type: 'deploy_operator',
      card_instance_id: p2Op1,
      lane: 'L2',
      position: 'front',
      slot_index: 1,
    });
    expect(p2Deploy1.ok).toBe(true);
    s = p2Deploy1.value;
    expect(s.players[secondPlayer].assault_bonus_used).toBe(true);
    expect(s.card_instances[p2Op1]?.operator_combat?.statuses.some((st) => st.kind === 'assault')).toBe(true);
    expect(s.card_instances[p2Op1]?.operator_combat?.granted_immediate_attack_this_turn).toBe(true);

    // 后手方同一回合部署第二名干员 -> 不再获得【突击】
    const p2Deploy2 = reduceGameAction(s, secondPlayer, {
      type: 'deploy_operator',
      card_instance_id: p2Op2,
      lane: 'L3',
      position: 'front',
      slot_index: 1,
    });
    expect(p2Deploy2.ok).toBe(true);
    s = p2Deploy2.value;
    expect(s.card_instances[p2Op2]?.operator_combat?.statuses.some((st) => st.kind === 'assault')).toBe(false);

    // 结束行动阶段并推进作战结算：第一名干员（L2，ATK 2）攻击先手基地，第二名干员（L3）仍在部署冷却中不攻击；战斗后清理临时突击状态
    const p1BaseBefore = s.players[firstPlayer].base_points;
    const endP2 = reduceGameAction(s, secondPlayer, { type: 'end_action_phase' });
    expect(endP2.ok).toBe(true);
    const afterCombatP2 = advancePhase(endP2.value);
    expect(afterCombatP2.ok).toBe(true);
    s = afterCombatP2.value;
    expect(s.players[firstPlayer].base_points).toBe(p1BaseBefore - 2);
    expect(s.card_instances[p2Op1]?.operator_combat?.statuses.some((st) => st.kind === 'assault')).toBe(false);
  });

  it('13. 近战单位处于后排时无法攻击敌方后排与基本分，仍可攻击射程内敌方前排；领主后排仍可正常打击后排与基地', () => {
    let s = startGame(931);
    const actor = s.active_player_id;
    const enemy: PlayerId = actor === 'player_a' ? 'player_b' : 'player_a';

    // 场景 A：近战干员 OP-GUA-001 位于 L1 后排，敌方 L1 仅后排有干员 + 全路空前排 -> 无法攻击敌方后排与基地
    let backMeleeId: CardInstanceId;
    let enemyBackId: CardInstanceId;
    ({ state: s, id: backMeleeId } = placeBoardUnit(s, actor, 'OP-GUA-001', 'L1', 'back', 1));
    ({ state: s, id: enemyBackId } = placeBoardUnit(s, enemy, 'OP-SNI-001', 'L1', 'back', 1, {
      current_hp: 4 as HpValue,
    }));

    expect(selectOrdinaryAttackTargets(s, s.card_instances[backMeleeId]!)).toEqual([]);
    const baseBefore = s.players[enemy].base_points;
    const afterEmptyFront = resolveCombat(s);
    expect(afterEmptyFront.card_instances[enemyBackId]?.operator_combat?.current_hp).toBe(4);
    expect(afterEmptyFront.players[enemy].base_points).toBe(baseBefore);

    // 场景 B：敌方 L1 前排有干员时，后排近战仍可正常攻击前排
    let enemyFrontId: CardInstanceId;
    ({ state: s, id: enemyFrontId } = placeBoardUnit(s, enemy, 'OP-VAN-001', 'L1', 'front', 1, {
      current_hp: 4 as HpValue,
    }));
    expect(selectOrdinaryAttackTargets(s, s.card_instances[backMeleeId]!).map((u) => u.card_instance_id)).toEqual([enemyFrontId]);
    const afterWithFront = resolveCombat(s);
    expect(afterWithFront.card_instances[enemyFrontId]?.operator_combat?.current_hp).toBe(2);
    expect(afterWithFront.card_instances[enemyBackId]?.operator_combat?.current_hp).toBe(4);

    // 场景 C：领主干员（OP-GUA-008 银灰，mode=ranged）位于后排且敌方同路仅后排有单位 -> 仍可正常打击敌方后排
    let lordState = startGame(932);
    const lActor = lordState.active_player_id;
    const lEnemy: PlayerId = lActor === 'player_a' ? 'player_b' : 'player_a';
    let lordId: CardInstanceId;
    let lEnemyBackId: CardInstanceId;
    ({ state: lordState, id: lordId } = placeBoardUnit(lordState, lActor, 'OP-GUA-008', 'L2', 'back', 1));
    ({ state: lordState, id: lEnemyBackId } = placeBoardUnit(lordState, lEnemy, 'OP-SNI-001', 'L2', 'back', 1, {
      current_hp: 5 as HpValue,
    }));
    expect(selectOrdinaryAttackTargets(lordState, lordState.card_instances[lordId]!).map((u) => u.card_instance_id)).toEqual([
      lEnemyBackId,
    ]);
  });
});

