import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  createLongPressController,
  DOUBLE_TAP_WINDOW_MS,
  exceedsMoveThreshold,
  LONG_PRESS_DELAY_MS,
} from '../../hooks/useLongPress';
import {
  createHoverIntentController,
  HOVER_INTENT_DELAY_MS,
  isFineHoverPointerType,
  isRecentTouchActivity,
  markTouchPointerActivity,
} from '../../hooks/useHoverIntent';
import {
  clampPopoverPosition,
  computeHearthstonePreviewLayout,
  CardPreviewPopover,
} from './CardPreviewPopover';
import { PlayerHandDock } from './PlayerHandDock';
import { TacticalDetailPanel } from './TacticalDetailPanel';
import { TacticalBattleHud, getTurnPhaseDisplay } from './TacticalBattleHud';
import { KeywordGlossary } from '../cards/KeywordGlossary';
import { extractCardKeywords } from '../../data/keywords';
import {
  computeTouchAimPoint,
  detectTouchDragIntent,
  resolveTouchDropTarget,
  type TouchDragSlotCandidate,
} from './touchDrag';
import {
  findDirectPlayAction,
  getHealingRangeLabel,
  getInvalidCardReason,
  getInvalidDeployReason,
  getInvalidUnitActionReason,
  getPendingChoicePromptText,
  previewAttackTargets,
  previewHealingRange,
} from './tacticalSelectors';
import { UnitView } from './UnitView';
import { DynamicBattlefieldBackdrop } from './DynamicBattlefieldBackdrop';
import { DEMO_CARDS, PRESET_DECKS, type UiCardDefinition } from '../../client/gameData';
import { isOperatorDeployPositionAllowed } from '../../game/effects';
import { advancePhase, createInitialGameState, mulligan, reduceGameAction } from '../../game/engine';
import { enumerateLegalActions } from '../../game/legal-actions';
import type { CardId, CardInstanceId, Cost, GameState, HpValue, SpValue } from '../../game/types';

function createActionPhaseState(seed = 2026): GameState {
  let state = createInitialGameState({
    decks: { player_a: PRESET_DECKS[0], player_b: PRESET_DECKS[1] },
    cards: DEMO_CARDS,
    seed,
  });
  state = mulligan(state, 'player_a', []).value;
  state = mulligan(state, 'player_b', []).value;
  state = advancePhase(state).value;
  if (state.phase === 'turn_start') {
    state = advancePhase(state).value;
  }
  return state;
}

describe('Phase 5: 桌面与移动端交互体验测试', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('长按控制器: 静止长按达到 450ms 触发详情回调，松手不会误触发部署/点击', () => {
    const onLongPress = vi.fn();
    const onTap = vi.fn();
    const ctrl = createLongPressController({ onLongPress, onTap });

    ctrl.start({ x: 100, y: 500 });
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS - 50);
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(ctrl.wasLongPressTriggered()).toBe(true);

    ctrl.end();
    const tapped = ctrl.consumeClick();
    expect(tapped).toBe(false);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('长按控制器: 手牌横向滑动超过 10px 时立即取消长按计时器，绝不误弹详情', () => {
    const onLongPress = vi.fn();
    const onTap = vi.fn();
    const ctrl = createLongPressController({ onLongPress, onTap });

    expect(exceedsMoveThreshold({ x: 100, y: 500 }, { x: 106, y: 504 })).toBe(false);
    expect(exceedsMoveThreshold({ x: 100, y: 500 }, { x: 115, y: 500 })).toBe(true);

    ctrl.start({ x: 100, y: 500 });
    vi.advanceTimersByTime(150);
    ctrl.move({ x: 118, y: 502 });
    vi.advanceTimersByTime(500);

    expect(onLongPress).not.toHaveBeenCalled();
    ctrl.end();
    expect(ctrl.consumeClick()).toBe(false);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('长按控制器: 短促点击在阈值内正常触发单击选中', () => {
    const onLongPress = vi.fn();
    const onTap = vi.fn();
    const ctrl = createLongPressController({ onLongPress, onTap });

    ctrl.start({ x: 100, y: 500 });
    vi.advanceTimersByTime(120);
    ctrl.end();
    expect(ctrl.consumeClick()).toBe(true);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('悬停浮层坐标钳位: 左右边缘与底部手牌触发时严禁超出视口裁切', () => {
    const leftEdgePos = clampPopoverPosition(
      { left: 4, top: 620, right: 120, bottom: 770, width: 116, height: 150 },
      1280,
      800,
    );
    expect(leftEdgePos.left).toBeGreaterThanOrEqual(12);
    expect(leftEdgePos.top).toBeGreaterThanOrEqual(12);

    const rightEdgePos = clampPopoverPosition(
      { left: 1200, top: 620, right: 1316, bottom: 770, width: 116, height: 150 },
      1280,
      800,
    );
    expect(rightEdgePos.left + 236).toBeLessThanOrEqual(1280 - 12);
  });

  it('引擎驱动错误原因: 部署半区/前后排规则/费用不足/已占格均直接返回引擎真实 reason', () => {
    const baseState = createActionPhaseState(2026);
    const actor = baseState.active_player_id;
    const enemy = actor === 'player_a' ? 'player_b' : 'player_a';

    // 找一张当前玩家手牌里的干员，调整双方状态进行确定性校验
    const handOpId = baseState.players[actor].hand.find(
      (id) => baseState.card_definitions[baseState.card_instances[id].card_id]?.card_type === 'operator',
    )!;
    const handOpDef = baseState.card_definitions[baseState.card_instances[handOpId].card_id];

    // 1. 敌方半区部署 -> 返回半区错误
    expect(getInvalidDeployReason(baseState, actor, handOpId, enemy, 'center', 'front')).toBe(
      '只能部署在己方半区阵位。',
    );

    // 2. 强制令费用为 0 测试手牌和格子不可部署时的真实原因
    const zeroCostState: GameState = {
      ...baseState,
      players: {
        ...baseState.players,
        [actor]: { ...baseState.players[actor], cost: 0 as Cost },
      },
    };
    const validPos =
      handOpDef.deploy_rule === 'back_only' || (handOpDef.deploy_rule === undefined && handOpDef.attack_type === 'ranged') || handOpDef.floating
        ? 'back'
        : 'front';
    const invalidPos = validPos === 'front' ? 'back' : 'front';

    if (handOpDef.deploy_rule !== 'front_or_back') {
      expect(getInvalidDeployReason(zeroCostState, actor, handOpId, actor, 'center', invalidPos)).toBe(
        '干员不能部署在所选位置。',
      );
    }
    if (handOpDef.cost > 0) {
      expect(getInvalidDeployReason(zeroCostState, actor, handOpId, actor, 'center', validPos)).toBe('费用不足。');
      expect(getInvalidCardReason(zeroCostState, actor, handOpId)).toBe('费用不足。');
    }

    // 3. 给足够费用部署成功后再点同一格子 -> 返回已占用
    const richState: GameState = {
      ...baseState,
      players: {
        ...baseState.players,
        [actor]: { ...baseState.players[actor], cost: 10 as Cost },
      },
    };
    const res = reduceGameAction(richState, actor, {
      type: 'deploy_operator',
      card_instance_id: handOpId,
      lane: 'left',
      position: validPos,
    });
    expect(res.ok).toBe(true);
    const anotherOpId = Object.values(res.value.card_instances).find((inst) => {
      if (inst.card_instance_id === handOpId || inst.owner_id !== actor) return false;
      const def = res.value.card_definitions[inst.card_id];
      return def?.card_type === 'operator' && isOperatorDeployPositionAllowed(def, validPos);
    })?.card_instance_id;
    if (anotherOpId) {
      const checkState: GameState = res.value.players[actor].hand.includes(anotherOpId)
        ? res.value
        : {
            ...res.value,
            players: {
              ...res.value.players,
              [actor]: {
                ...res.value.players[actor],
                hand: [...res.value.players[actor].hand, anotherOpId],
                deck: res.value.players[actor].deck.filter((id) => id !== anotherOpId),
              },
            },
            card_instances: {
              ...res.value.card_instances,
              [anotherOpId]: { ...res.value.card_instances[anotherOpId], zone: 'hand' },
            },
          };
      expect(getInvalidDeployReason(checkState, actor, anotherOpId, actor, 'left', validPos)).toBe(
        '所选部署位已被占用。',
      );
    }

    // 4. 在场单位主动技能不可用时直接返回引擎原因
    const skillErr = getInvalidUnitActionReason(res.value, actor, handOpId, 'activate_skill');
    expect(typeof skillErr).toBe('string');
  });

  it('攻击范围与索敌预演: 与 combat.ts 一致（直击基地、同路前锋优先、跨路嘲讽拦截）', () => {
    const state = createActionPhaseState(42);
    const actor = state.active_player_id;
    const enemy = actor === 'player_a' ? 'player_b' : 'player_a';

    const meleeId = 'unit-melee' as CardInstanceId;
    const enemyFrontId = 'unit-enemy-front' as CardInstanceId;
    const enemyBackId = 'unit-enemy-back' as CardInstanceId;
    const tauntId = 'unit-taunt' as CardInstanceId;

    const meleeDefId = 'OP-GUA-001' as CardId;
    const enemyDefId = 'OP-SNI-001' as CardId;
    const tauntDefId = 'OP-DEF-003' as CardId; // 查找是否带 all_lanes 嘲讽，若无则显式挂载测试定义
    const tauntDef = {
      ...DEMO_CARDS.find((c) => c.card_id === meleeDefId)!,
      card_id: tauntDefId,
      card_name_zh: '测试重装',
      taunt_scope: 'all_lanes' as const,
    };

    const customDefs = {
      ...state.card_definitions,
      [tauntDefId]: tauntDef,
    };

    const emptyLaneState: GameState = {
      ...state,
      card_definitions: customDefs,
      card_instances: {
        ...state.card_instances,
        [meleeId]: {
          card_instance_id: meleeId,
          card_id: meleeDefId,
          owner_id: actor,
          controller_id: actor,
          board_half: actor,
          lane: 'center',
          position: 'front',
          zone: 'board',
          operator_combat: {
            current_hp: 10 as never,
            current_atk_modifiers: [],
            current_sp: 0 as never,
            shield: 0,
            statuses: [],
            equipment_ids: [],
          },
          operator_lifecycle: {
            redeploy_cd_remaining: 0,
            redeploy_cd_applied_owner_turn_index: null,
            has_deployed_before: true,
            entered_battle_this_owner_turn: false,
            paid_deploy_cost: 3 as never,
            once_per_game_flags: {},
          },
        },
      },
    };

    // 1. 敌方中路无人 -> 直击基地
    const previewEmpty = previewAttackTargets(emptyLaneState, {
      kind: 'unit',
      instance: emptyLaneState.card_instances[meleeId],
    });
    expect(previewEmpty?.attacksBase).toBe(true);
    expect(previewEmpty?.primaryTargetId).toBeNull();

    // 2. 敌方中路前排与后排均有人 -> 优先锁定前排
    const duelState: GameState = {
      ...emptyLaneState,
      card_instances: {
        ...emptyLaneState.card_instances,
        [enemyFrontId]: {
          ...emptyLaneState.card_instances[meleeId],
          card_instance_id: enemyFrontId,
          card_id: meleeDefId,
          owner_id: enemy,
          controller_id: enemy,
          board_half: enemy,
          lane: 'center',
          position: 'front',
        },
        [enemyBackId]: {
          ...emptyLaneState.card_instances[meleeId],
          card_instance_id: enemyBackId,
          card_id: enemyDefId,
          owner_id: enemy,
          controller_id: enemy,
          board_half: enemy,
          lane: 'center',
          position: 'back',
        },
      },
    };
    const previewFront = previewAttackTargets(duelState, {
      kind: 'unit',
      instance: duelState.card_instances[meleeId],
    });
    expect(previewFront?.attacksBase).toBe(false);
    expect(previewFront?.primaryTargetId).toBe(enemyFrontId);

    // 3. 敌方左路有全路嘲讽单位 -> 强制拦截中路攻击
    const tauntState: GameState = {
      ...duelState,
      card_instances: {
        ...duelState.card_instances,
        [tauntId]: {
          ...emptyLaneState.card_instances[meleeId],
          card_instance_id: tauntId,
          card_id: tauntDefId,
          owner_id: enemy,
          controller_id: enemy,
          board_half: enemy,
          lane: 'left',
          position: 'front',
        },
      },
    };
    const previewTaunt = previewAttackTargets(tauntState, {
      kind: 'unit',
      instance: tauntState.card_instances[meleeId],
    });
    expect(previewTaunt?.tauntBlocked).toBe(true);
    expect(previewTaunt?.primaryTargetId).toBe(tauntId);
    expect(previewTaunt?.legalTargetIds).toEqual(expect.arrayContaining([enemyFrontId, enemyBackId, tauntId]));

    // 4. 后排近战预览：不将敌方后排纳入合法目标，且 attacksBase 为 false 并返回提示原因
    const backMeleeState: GameState = {
      ...duelState,
      card_instances: {
        ...duelState.card_instances,
        [meleeId]: {
          ...duelState.card_instances[meleeId],
          position: 'back',
        },
      },
    };
    const previewBackWithFront = previewAttackTargets(backMeleeState, {
      kind: 'unit',
      instance: backMeleeState.card_instances[meleeId],
    });
    expect(previewBackWithFront?.legalTargetIds).toEqual([enemyFrontId]);
    expect(previewBackWithFront?.primaryTargetId).toBe(enemyFrontId);

    const backMeleeOnlyEnemyBack: GameState = {
      ...backMeleeState,
      card_instances: Object.fromEntries(
        Object.entries(backMeleeState.card_instances).filter(([id]) => id !== enemyFrontId),
      ),
    };
    const previewBackNoFront = previewAttackTargets(backMeleeOnlyEnemyBack, {
      kind: 'unit',
      instance: backMeleeOnlyEnemyBack.card_instances[meleeId],
    });
    expect(previewBackNoFront?.attacksBase).toBe(false);
    expect(previewBackNoFront?.legalTargetIds).toEqual([]);
    expect(previewBackNoFront?.cannotAttackReason).toContain('近战处于后排');
  });

  it('治疗范围预览: 医疗干员高亮同路/邻路可治疗友军并排除设施与禁疗干员', () => {
    const state = createActionPhaseState(105);
    const actor = state.active_player_id;

    const medicId = 'unit-medic' as CardInstanceId;
    const woundedId = 'unit-wounded' as CardInstanceId;
    const adjAllyId = 'unit-adj-ally' as CardInstanceId;
    const hellagurId = 'unit-hellagur' as CardInstanceId; // OP-GUA-004 宴/赫拉格类禁疗占位校验
    const facilityId = 'unit-facility' as CardInstanceId;

    const medicDef = DEMO_CARDS.find((c) => c.card_id === ('OP-MED-003' as CardId))!; // 调香师 same_and_adjacent_lane
    const allyDef = DEMO_CARDS.find((c) => c.card_id === ('OP-VAN-001' as CardId))!;
    const banHealDef = DEMO_CARDS.find((c) => c.card_id === ('OP-GUA-004' as CardId))!;
    const facilityDef = DEMO_CARDS.find((c) => c.card_id === ('DEMO-SUP-V2-001' as CardId))!;

    expect(getHealingRangeLabel(medicDef)).toContain('同路及邻路');

    const healState: GameState = {
      ...state,
      card_definitions: {
        ...state.card_definitions,
        [medicDef.card_id]: medicDef,
        [allyDef.card_id]: allyDef,
        [banHealDef.card_id]: banHealDef,
        [facilityDef.card_id]: facilityDef,
      },
      card_instances: {
        ...state.card_instances,
        [medicId]: {
          card_instance_id: medicId,
          card_id: medicDef.card_id,
          owner_id: actor,
          controller_id: actor,
          board_half: actor,
          lane: 'L1',
          position: 'back',
          zone: 'board',
          operator_combat: {
            current_hp: (medicDef.hp ?? 3) as HpValue,
            current_atk_modifiers: [],
            current_sp: 0 as SpValue,
            shield: 0,
            statuses: [],
            equipment_ids: [],
          },
        },
        [woundedId]: {
          card_instance_id: woundedId,
          card_id: allyDef.card_id,
          owner_id: actor,
          controller_id: actor,
          board_half: actor,
          lane: 'L1',
          position: 'front',
          zone: 'board',
          operator_combat: {
            current_hp: 1 as HpValue,
            current_atk_modifiers: [],
            current_sp: 0 as SpValue,
            shield: 0,
            statuses: [],
            equipment_ids: [],
          },
        },
        [adjAllyId]: {
          card_instance_id: adjAllyId,
          card_id: allyDef.card_id,
          owner_id: actor,
          controller_id: actor,
          board_half: actor,
          lane: 'L2',
          position: 'front',
          zone: 'board',
          operator_combat: {
            current_hp: (allyDef.hp ?? 3) as HpValue,
            current_atk_modifiers: [],
            current_sp: 0 as SpValue,
            shield: 0,
            statuses: [],
            equipment_ids: [],
          },
        },
        [hellagurId]: {
          card_instance_id: hellagurId,
          card_id: banHealDef.card_id,
          owner_id: actor,
          controller_id: actor,
          board_half: actor,
          lane: 'L2',
          position: 'front',
          slot_index: 2,
          zone: 'board',
          operator_combat: {
            current_hp: 1 as HpValue,
            current_atk_modifiers: [],
            current_sp: 0 as SpValue,
            shield: 0,
            statuses: [],
            equipment_ids: [],
          },
        },
        [facilityId]: {
          card_instance_id: facilityId,
          card_id: facilityDef.card_id,
          owner_id: actor,
          controller_id: actor,
          board_half: actor,
          lane: 'L2',
          position: 'back',
          zone: 'board',
          entity_kind: 'facility',
          operator_combat: {
            current_hp: 2 as HpValue,
            current_atk_modifiers: [],
            current_sp: 0 as SpValue,
            shield: 0,
            statuses: [],
            equipment_ids: [],
          },
        },
      },
    };

    const preview = previewHealingRange(healState, {
      kind: 'unit',
      instance: healState.card_instances[medicId],
    });
    expect(preview).not.toBeNull();
    expect(preview?.rangeCells.some((c) => c.lane === 'L1' && c.position === 'front')).toBe(true);
    expect(preview?.rangeCells.some((c) => c.lane === 'L2' && c.position === 'back')).toBe(true);
    expect(preview?.rangeCells.some((c) => c.lane === 'L3')).toBe(false);
    expect(preview?.healableUnitIds).toContain(woundedId);
    expect(preview?.healableUnitIds).toContain(adjAllyId);
    expect(preview?.healableUnitIds).not.toContain(hellagurId);
    expect(preview?.healableUnitIds).not.toContain(facilityId);
    expect(preview?.woundedTargetIds).toEqual([woundedId]);
    expect(preview?.priorityTargetIds).toEqual([woundedId]);
  });

  it('UnitView: 不同高亮状态 (attack_target vs target vs selected) 渲染可区分视觉指示', () => {
    const state = createActionPhaseState(99);
    const unitId = 'test-unit' as CardInstanceId;
    const def = DEMO_CARDS.find((c) => c.card_type === 'operator')!;
    const unitState: GameState = {
      ...state,
      card_instances: {
        ...state.card_instances,
        [unitId]: {
          card_instance_id: unitId,
          card_id: def.card_id,
          owner_id: 'player_b',
          controller_id: 'player_b',
          board_half: 'player_b',
          lane: 'center',
          position: 'front',
          zone: 'board',
          operator_combat: {
            current_hp: (def.hp ?? 10) as never,
            current_atk_modifiers: [],
            current_sp: 0 as never,
            shield: 0,
            statuses: [],
            equipment_ids: [],
          },
        },
      },
    };

    const htmlAttackTarget = renderToString(
      <UnitView state={unitState} instance={unitState.card_instances[unitId]} highlight="attack_target" />,
    );
    expect(htmlAttackTarget).toContain('data-highlight="attack_target"');
    expect(htmlAttackTarget).toContain('⚔ 锁定');

    const htmlSkillTarget = renderToString(
      <UnitView state={unitState} instance={unitState.card_instances[unitId]} highlight="target" />,
    );
    expect(htmlSkillTarget).toContain('data-highlight="target"');
    expect(htmlSkillTarget).toContain('◎ 目标');

    const htmlSkillReady = renderToString(
      <UnitView
        state={unitState}
        instance={unitState.card_instances[unitId]}
        highlight="none"
        canActivateSkill
      />,
    );
    expect(htmlSkillReady).toContain('data-skill-ready="true"');
    expect(htmlSkillReady).toContain('⚡ 就绪');

    const htmlDragLocked = renderToString(
      <UnitView
        state={unitState}
        instance={unitState.card_instances[unitId]}
        highlight="target"
        isDragLocked
      />,
    );
    expect(htmlDragLocked).toContain('✓ 释放锁定');

    const htmlTapHitShake = renderToString(
      <UnitView
        state={unitState}
        instance={unitState.card_instances[unitId]}
        highlight="selected"
        tapCue={{ kind: 'tap', seq: 1 }}
      />,
    );
    expect(htmlTapHitShake).toContain('data-tap-cue="tap"');
    expect(htmlTapHitShake).toContain('anim-cell-hit-shake');

    const htmlTapSkillFx = renderToString(
      <UnitView
        state={unitState}
        instance={unitState.card_instances[unitId]}
        highlight="none"
        tapCue={{ kind: 'skill', seq: 2 }}
      />,
    );
    expect(htmlTapSkillFx).toContain('data-tap-cue="skill"');
    expect(htmlTapSkillFx).toContain('anim-skill-burst');
    expect(htmlTapSkillFx).toContain('anim-skill-sweep');

    const htmlInRange = renderToString(
      <UnitView state={unitState} instance={unitState.card_instances[unitId]} highlight="in_range" />,
    );
    expect(htmlInRange).toContain('data-highlight="in_range"');
    expect(htmlInRange).toContain('◎ 射程内');

    const htmlHealTarget = renderToString(
      <UnitView
        state={unitState}
        instance={unitState.card_instances[unitId]}
        highlight="heal_target"
        isPriorityHealTarget
      />,
    );
    expect(htmlHealTarget).toContain('data-highlight="heal_target"');
    expect(htmlHealTarget).toContain('+ 优先治疗');

    const htmlHealRange = renderToString(
      <UnitView state={unitState} instance={unitState.card_instances[unitId]} highlight="heal_range" />,
    );
    expect(htmlHealRange).toContain('data-highlight="heal_range"');
    expect(htmlHealRange).toContain('+ 治疗范围');

    const htmlMarkedWithAssault = renderToString(
      <UnitView
        state={unitState}
        instance={{
          ...unitState.card_instances[unitId],
          operator_combat: {
            ...unitState.card_instances[unitId].operator_combat!,
            statuses: [
              {
                kind: 'assault',
                remaining_owner_turns: 1,
                applied_on_owner_turn_index: 1,
                blocks_normal_withdrawal: false,
                expire_at_node: 'combat_end',
              },
            ],
          },
        }}
        highlight="none"
        isFocusTarget
      />,
    );
    expect(htmlMarkedWithAssault).toContain('🎯 标记');
    expect(htmlMarkedWithAssault).not.toContain('🎯 集火');
    expect(htmlMarkedWithAssault).toContain('突击');

    const enemyPlayer = unitState.active_player_id === 'player_a' ? 'player_b' : 'player_a';
    const enemyUnitState: GameState = {
      ...unitState,
      card_instances: {
        ...unitState.card_instances,
        [unitId]: {
          ...unitState.card_instances[unitId],
          owner_id: enemyPlayer,
          controller_id: enemyPlayer,
          board_half: enemyPlayer,
        },
      },
    };
    const detailHtml = renderToString(
      <TacticalDetailPanel
        state={enemyUnitState}
        selection={unitId}
        onDeselect={() => {}}
        canAct
        isActionPhase
        hasPending={false}
        legalActions={enumerateLegalActions(enemyUnitState, enemyUnitState.active_player_id)}
        onDispatch={() => {}}
      />,
    ).replace(/<!-- -->/g, '');
    expect(detailHtml).toContain('🎯 标记为本回合优先目标');
    expect(detailHtml).not.toContain('集火为本回合优先目标');
  });

  it('双击手势识别: 300ms 内连续轻点触发双击快速技能，超过阈值则按普通单击处理', () => {
    let clock = 1000;
    const onLongPress = vi.fn();
    const onTap = vi.fn();
    const onDoubleTap = vi.fn();
    const ctrl = createLongPressController({
      onLongPress,
      onTap,
      onDoubleTap,
      now: () => clock,
    });

    // 第一次点击
    ctrl.start({ x: 180, y: 320 });
    ctrl.end();
    expect(ctrl.consumeClick()).toBe(true);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onDoubleTap).not.toHaveBeenCalled();

    // 220ms 后第二次点击 -> 识别为双击
    clock += 220;
    ctrl.start({ x: 182, y: 321 });
    ctrl.end();
    expect(ctrl.consumeClick()).toBe(true);
    expect(onDoubleTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledTimes(1);

    // 超过 DOUBLE_TAP_WINDOW_MS 再次点击 -> 重新作为普通单击
    clock += DOUBLE_TAP_WINDOW_MS + 60;
    ctrl.start({ x: 180, y: 320 });
    ctrl.end();
    expect(ctrl.consumeClick()).toBe(true);
    expect(onTap).toHaveBeenCalledTimes(2);
    expect(onDoubleTap).toHaveBeenCalledTimes(1);
  });

  it('移动端拖牌意图识别: 竖屏上拉拖牌 vs 横向滑手牌，横屏侧栏左拉拖牌 vs 纵向滚动', () => {
    // 竖屏 bottom 模式
    expect(
      detectTouchDragIntent({
        start: { x: 200, y: 700 },
        current: { x: 204, y: 694 },
        layoutMode: 'bottom',
      }),
    ).toBe('pending');
    expect(
      detectTouchDragIntent({
        start: { x: 200, y: 700 },
        current: { x: 202, y: 675 },
        layoutMode: 'bottom',
      }),
    ).toBe('drag');
    expect(
      detectTouchDragIntent({
        start: { x: 200, y: 700 },
        current: { x: 240, y: 696 },
        layoutMode: 'bottom',
      }),
    ).toBe('scroll');

    // 横屏 side-rail 模式
    expect(
      detectTouchDragIntent({
        start: { x: 740, y: 260 },
        current: { x: 710, y: 256 },
        layoutMode: 'side-rail',
      }),
    ).toBe('drag');
    expect(
      detectTouchDragIntent({
        start: { x: 740, y: 260 },
        current: { x: 742, y: 295 },
        layoutMode: 'side-rail',
      }),
    ).toBe('scroll');
  });

  it('触控准星偏移与格位磁吸解析: 精准命中、24px 边缘磁吸、非法格位提示与棋盘直接释放', () => {
    const aim = computeTouchAimPoint({ x: 160, y: 400 }, 390, 844);
    expect(aim.x).toBe(160);
    expect(aim.y).toBe(372); // 默认上移 28px 防止手指遮挡

    const slots: TouchDragSlotCandidate[] = [
      {
        key: 'player_a:L1:front:1',
        half: 'player_a',
        lane: 'L1',
        position: 'front',
        slotIndex: 1,
        rect: { left: 20, top: 300, right: 120, bottom: 360 },
        isValidDeploy: true,
        isValidUnitTarget: false,
      },
      {
        key: 'player_a:L2:front:1',
        half: 'player_a',
        lane: 'L2',
        position: 'front',
        slotIndex: 1,
        rect: { left: 140, top: 300, right: 240, bottom: 360 },
        isValidDeploy: false,
        isValidUnitTarget: false,
      },
    ];
    const boardRect = { left: 10, top: 140, right: 380, bottom: 480 };

    // 1. 直接命中有效格
    const directRes = resolveTouchDropTarget({
      aimPoint: { x: 70, y: 330 },
      slots,
      boardRect,
      canDirectPlay: false,
    });
    expect(directRes.kind).toBe('slot');
    if (directRes.kind === 'slot') {
      expect(directRes.snapped).toBe(false);
      expect(directRes.slot.key).toBe('player_a:L1:front:1');
    }

    // 2. 位于有效格边缘外 16px（<= 24px）自动磁吸至格中心
    const snappedRes = resolveTouchDropTarget({
      aimPoint: { x: 70, y: 376 },
      slots,
      boardRect,
      canDirectPlay: false,
    });
    expect(snappedRes.kind).toBe('slot');
    if (snappedRes.kind === 'slot') {
      expect(snappedRes.snapped).toBe(true);
      expect(snappedRes.aimCenter).toEqual({ x: 70, y: 330 });
    }

    // 3. 落在不可部署格位内
    const invalidRes = resolveTouchDropTarget({
      aimPoint: { x: 190, y: 330 },
      slots,
      boardRect,
      canDirectPlay: false,
    });
    expect(invalidRes.kind).toBe('invalid_slot');

    // 4. 非指向型战术卡拖入棋盘空白区 -> direct_play
    const directPlayRes = resolveTouchDropTarget({
      aimPoint: { x: 300, y: 200 },
      slots,
      boardRect,
      canDirectPlay: true,
    });
    expect(directPlayRes.kind).toBe('direct_play');

    // 5. 拖回手牌托盘区 -> 安全取消
    const cancelRes = resolveTouchDropTarget({
      aimPoint: { x: 190, y: 720 },
      slots,
      boardRect,
      canDirectPlay: true,
    });
    expect(cancelRes.kind).toBe('cancel');
  });

  it('DynamicBattlefieldBackdrop: 启用与关闭动效时均安全渲染 Arknights 主题底图、漂移聚光灯遮罩、天气烟雾遮罩与多样化粒子层', () => {
    const activeHtml = renderToString(
      <DynamicBattlefieldBackdrop backdropUrl="/mock-arena.jpg" disableMotion={false} />,
    );
    expect(activeHtml).toContain('data-testid="battlefield-backdrop"');
    expect(activeHtml).toContain('data-motion-disabled="false"');
    expect(activeHtml).toContain('data-particle-kinds="snowflake,debris,ember,light_mote"');
    expect(activeHtml).toContain('data-testid="battlefield-spotlight-mask"');
    expect(activeHtml).toContain('data-testid="battlefield-spotlight-secondary"');
    expect(activeHtml).toContain('data-testid="battlefield-weather-haze"');
    expect(activeHtml).toContain('data-testid="battlefield-weather-shimmer"');
    expect(activeHtml).toContain('radial-gradient(');
    expect(activeHtml).toContain('anim-spotlight-drift');
    expect(activeHtml).toContain('anim-spotlight-secondary');
    expect(activeHtml).toContain('anim-weather-haze');
    expect(activeHtml).toContain('anim-weather-shimmer');
    expect(activeHtml).toContain('data-testid="battlefield-ambient-canvas"');
    expect(activeHtml).toContain('anim-arena-drift');
    expect(activeHtml).toContain('anim-emblem-drift');
    expect(activeHtml).toContain('rhodes_island_dark.png');

    const staticHtml = renderToString(
      <DynamicBattlefieldBackdrop backdropUrl="/mock-arena.jpg" disableMotion />,
    );
    expect(staticHtml).toContain('data-motion-disabled="true"');
    expect(staticHtml).toContain('data-testid="battlefield-spotlight-mask"');
    expect(staticHtml).toContain('data-testid="battlefield-weather-haze"');
    expect(staticHtml).toContain('data-testid="battlefield-ambient-canvas"');
    expect(staticHtml).not.toContain('anim-spotlight-drift');
    expect(staticHtml).not.toContain('anim-spotlight-secondary');
    expect(staticHtml).not.toContain('anim-weather-haze');
    expect(staticHtml).not.toContain('anim-weather-shimmer');
    expect(staticHtml).not.toContain('anim-arena-drift');
    expect(staticHtml).not.toContain('anim-emblem-drift');
    expect(staticHtml).toContain('prts-grid');
  });

  it('卡牌详情与词条简要说明: 支持桌面悬停与移动端详情面板渲染详情卡面、在场状态及词条解析', () => {
    const state = createActionPhaseState(101);
    const unitId = 'inspect-unit' as CardInstanceId;
    const silverAsh = DEMO_CARDS.find((c) => c.card_name_zh === '银灰') ?? DEMO_CARDS.find((c) => c.card_type === 'operator')!;
    const unitState: GameState = {
      ...state,
      card_instances: {
        ...state.card_instances,
        [unitId]: {
          card_instance_id: unitId,
          card_id: silverAsh.card_id,
          owner_id: 'player_a',
          controller_id: 'player_a',
          board_half: 'player_a',
          lane: 'center',
          position: 'front',
          zone: 'board',
          operator_combat: {
            current_hp: Math.max(1, (silverAsh.hp ?? 6) - 1) as never,
            current_atk_modifiers: [],
            current_sp: 2 as never,
            shield: 1,
            statuses: [
              {
                status_id: 'st-1',
                kind: 'poison',
                stacks: 2,
                remaining_owner_turns: 2,
                applied_sequence: 1,
              },
            ],
            equipment_ids: [],
          },
        },
      },
    };

    const unitInstance = unitState.card_instances[unitId];
    const keywords = extractCardKeywords(silverAsh, unitInstance);
    expect(keywords.some((k) => k.keyword === '护盾')).toBe(true);
    expect(keywords.some((k) => k.keyword === '中毒')).toBe(true);

    // 1. KeywordGlossary 独立渲染
    const glossaryHtml = renderToString(
      <KeywordGlossary definition={silverAsh} instance={unitInstance} />,
    );
    expect(glossaryHtml).toContain('data-testid="keyword-glossary"');
    expect(glossaryHtml).toContain('词条简要说明');
    expect(glossaryHtml).toContain('【护盾】');
    expect(glossaryHtml).toContain('【中毒】');

    // 2. 炉石风格悬停浮层：放大主卡面承载完整有效信息 + 侧边独立词条小框
    const silverAshUi = silverAsh as UiCardDefinition;
    const popoverHtml = renderToString(
      <CardPreviewPopover
        state={unitState}
        hovered={{
          instanceId: unitId,
          rect: { left: 480, top: 40, right: 610, bottom: 120, width: 130, height: 80 },
        }}
      />,
    ).replace(/<!-- -->/g, '');
    expect(popoverHtml).toContain('data-testid="card-preview-popover"');
    expect(popoverHtml).toContain('data-testid="magnified-card-preview"');
    expect(popoverHtml).toContain('data-testid="card-cost-badge"');
    expect(popoverHtml).toContain('data-testid="card-rules-box"');
    expect(popoverHtml).toContain('data-testid="card-atk-badge"');
    expect(popoverHtml).toContain('data-testid="card-hp-badge"');
    expect(popoverHtml).toContain('data-testid="keyword-side-callouts"');
    expect(popoverHtml).toContain('data-testid="keyword-callout-box"');
    expect(popoverHtml).toContain(silverAsh.card_name_zh);
    expect(popoverHtml).toContain('(+1盾)');
    expect(popoverHtml).toContain('词条简要说明');
    expect(popoverHtml).toContain('护盾');
    expect(popoverHtml).toContain('中毒');
    // 不展示已移除的 SP 与主动技能，且效果描述只出现一次（炉石布局：描述框 -> 左下攻击 -> 右下生命）
    expect(popoverHtml).not.toContain('SP');
    expect(popoverHtml).not.toContain('主动技');
    if (silverAshUi.rules_text_zh) {
      expect(popoverHtml.split(silverAshUi.rules_text_zh).length - 1).toBe(1);
    }
    const rulesIdx = popoverHtml.indexOf('data-testid="card-rules-box"');
    const atkIdx = popoverHtml.indexOf('data-testid="card-atk-badge"');
    const hpIdx = popoverHtml.indexOf('data-testid="card-hp-badge"');
    expect(rulesIdx).toBeGreaterThan(-1);
    expect(atkIdx).toBeGreaterThan(rulesIdx);
    expect(hpIdx).toBeGreaterThan(atkIdx);

    // 2b. 移动端长按钉住预览模式（pinned）：渲染轻量遮罩与关闭提示，而不呼出整页 BottomSheet
    const pinnedHtml = renderToString(
      <CardPreviewPopover
        state={unitState}
        hovered={{
          instanceId: unitId,
          rect: { left: 140, top: 520, right: 250, bottom: 630, width: 110, height: 110 },
          mode: 'pinned',
        }}
      />,
    );
    expect(pinnedHtml).toContain('data-testid="card-preview-backdrop"');
    expect(pinnedHtml).toContain('data-preview-mode="pinned"');
    expect(pinnedHtml).toContain('轻点任意处关闭预览');

    // 2c. 炉石侧边词条列位置计算：桌面右侧有空位放右侧，靠右边缘自动翻到左侧，360px 窄屏仍严格贴边并排不裁切
    const desktopLeftSideFlip = computeHearthstonePreviewLayout({
      anchorRect: { left: 1120, top: 560, right: 1236, bottom: 710, width: 116, height: 150 },
      viewportWidth: 1280,
      viewportHeight: 800,
      hasKeywords: true,
    });
    expect(desktopLeftSideFlip.keywordSide).toBe('left');
    expect(desktopLeftSideFlip.left + desktopLeftSideFlip.totalWidth).toBeLessThanOrEqual(1280 - 12);

    const mobileCompactLayout = computeHearthstonePreviewLayout({
      anchorRect: { left: 20, top: 520, right: 102, bottom: 628, width: 82, height: 108 },
      viewportWidth: 360,
      viewportHeight: 740,
      hasKeywords: true,
    });
    expect(mobileCompactLayout.left).toBeGreaterThanOrEqual(10);
    expect(mobileCompactLayout.left + mobileCompactLayout.totalWidth).toBeLessThanOrEqual(360 - 10);

    // 3. 顶部敌方单位悬停时自动翻转至目标下方，不遮挡目标格子
    const flippedPos = clampPopoverPosition(
      { left: 500, top: 38, right: 630, bottom: 118, width: 130, height: 80 },
      1280,
      800,
    );
    expect(flippedPos.top).toBeGreaterThanOrEqual(118 + 10);

    // 4. 侧栏战术详情面板：含详情卡面 + 词条简要说明，且不重复显示主动技能/SP
    const detailHtml = renderToString(
      <TacticalDetailPanel
        state={unitState}
        selection={unitId}
        onDeselect={() => {}}
        canAct
        isActionPhase
        hasPending={false}
        legalActions={[]}
        onDispatch={() => {}}
      />,
    );
    expect(detailHtml).toContain(silverAsh.card_name_zh);
    expect(detailHtml).toContain('词条简要说明');
    expect(detailHtml).toContain('【中毒】');
    expect(detailHtml).not.toContain('主动技能');
    expect(detailHtml).not.toContain('SP');
    if (silverAshUi.rules_text_zh) {
      expect(detailHtml.split(silverAshUi.rules_text_zh).length - 1).toBe(1);
    }

    // 5. UnitView 具备尖锐硬朗切角金属壳结构，且不显示无效的 SP 计数
    const unitHtml = renderToString(
      <UnitView state={unitState} instance={unitInstance} highlight="none" />,
    );
    expect(unitHtml).toContain('board-unit-shell');
    expect(unitHtml).toContain('board-unit');
    expect(unitHtml).not.toContain('pr-11');
    expect(unitHtml).not.toContain('0/0');

    // 6. UnitView 有角标时自动预留右上角空距，避免与状态或 attackMode 重叠
    const skillReadyHtml = renderToString(
      <UnitView state={unitState} instance={unitInstance} highlight="none" canActivateSkill />,
    );
    expect(skillReadyHtml).toContain('pr-11');
    expect(skillReadyHtml).toContain('⚡ 就绪');
  });

  it('桌面悬停意图与触控隔离: 鼠标须稳定悬停达到阈值才显示，移出/点击立即取消且触控指针绝不触发悬停', () => {
    const onShow = vi.fn();
    const onHide = vi.fn();
    const ctrl = createHoverIntentController({ onShow, onHide });

    // 快速扫过不足 380ms 移出 -> 不展示详情
    ctrl.enter();
    vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS - 100);
    expect(onShow).not.toHaveBeenCalled();
    ctrl.leave();
    vi.advanceTimersByTime(300);
    expect(onShow).not.toHaveBeenCalled();
    expect(onHide).not.toHaveBeenCalled();

    // 稳定悬停达到 380ms -> 展示详情；点击/移出立即隐藏
    ctrl.enter();
    vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS);
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(ctrl.isShown()).toBe(true);
    ctrl.cancel();
    expect(ctrl.isShown()).toBe(false);
    expect(onHide).toHaveBeenCalledTimes(1);

    // 指针类型与近期触控防穿透校验
    expect(isFineHoverPointerType('mouse')).toBe(true);
    expect(isFineHoverPointerType('pen')).toBe(true);
    expect(isFineHoverPointerType('touch')).toBe(false);

    const t0 = 1_700_000_000_000;
    markTouchPointerActivity(t0);
    expect(isRecentTouchActivity(t0 + 200)).toBe(true);
    expect(isRecentTouchActivity(t0 + 1200)).toBe(false);
  });

  it('布局与手牌托盘体验: 固定占位提示栏、下次部署减费中文文案及移动端 embedded 详情面板', () => {
    const baseState = createActionPhaseState(314);
    const actor = baseState.active_player_id;
    const discountedState: GameState = {
      ...baseState,
      players: {
        ...baseState.players,
        [actor]: {
          ...baseState.players[actor],
          next_deploy_discounts: [{ source_instance_id: 'disc-1' as CardInstanceId, amount: 1 }],
        },
      },
    };

    const dockHtml = renderToString(
      <PlayerHandDock
        state={discountedState}
        bottomPlayer={actor}
        actor={actor}
        canAct
        isActionPhase
        hasPending={false}
        isHotseat={false}
        isMobile={false}
        layoutMode="bottom"
        selection={null}
        draggingCardId={null}
        onHandCardClick={() => {}}
        onLongPressCard={() => {}}
        onHoverCard={() => {}}
        onDragStartCard={() => {}}
        onDragEndCard={() => {}}
        onEndActionPhase={() => {}}
      />,
    );
    expect(dockHtml).toContain('min-h-[34px]');
    expect(dockHtml).toContain('first:ml-auto last:mr-auto');
    expect(dockHtml).toContain('下次部署 -1 CP');
    expect(dockHtml).not.toContain('下 deploy');

    const firstHandId = discountedState.players[actor].hand[0];
    const embeddedDetailHtml = renderToString(
      <TacticalDetailPanel
        state={discountedState}
        selection={firstHandId}
        embedded
        onDeselect={() => {}}
        canAct
        isActionPhase
        hasPending={false}
        legalActions={[]}
        onDispatch={() => {}}
      />,
    );
    expect(embeddedDetailHtml).toContain('取消选中');
    expect(embeddedDetailHtml).not.toContain('战术参数与指令');
  });

  it('固定顶栏回合与阶段指示 + 手牌悬停完整属性展示: 明确展示「你的回合」「部署阶段」「作战阶段」与完整面板数值', () => {
    const baseState = createActionPhaseState(512);
    const actor = baseState.active_player_id;
    const opponent = actor === 'player_a' ? 'player_b' : 'player_a';

    expect(
      getTurnPhaseDisplay({
        state: baseState,
        actor,
        bottomPlayer: actor,
        hasPending: false,
        isHotseat: false,
      }),
    ).toMatchObject({
      turnOwnerLabel: '你的回合',
      phaseKey: 'deploy',
      phaseLabel: '部署阶段',
    });

    expect(
      getTurnPhaseDisplay({
        state: baseState,
        actor: opponent,
        bottomPlayer: actor,
        hasPending: false,
        isHotseat: false,
      }),
    ).toMatchObject({
      turnOwnerLabel: '敌方回合',
      phaseKey: 'deploy',
      phaseLabel: '部署阶段',
    });

    expect(
      getTurnPhaseDisplay({
        state: baseState,
        actor,
        bottomPlayer: actor,
        hasPending: false,
        activeAnimPhase: 'strike',
      }),
    ).toMatchObject({
      turnOwnerLabel: '你的回合',
      phaseKey: 'combat',
      phaseLabel: '作战阶段',
    });

    const hudDeployHtml = renderToString(
      <TacticalBattleHud
        state={baseState}
        actor={actor}
        bottomPlayer={actor}
        topPlayer={opponent}
        hasPending={false}
        isHotseat={false}
        showLog={false}
        onToggleLog={() => {}}
        showDetail={false}
        onToggleDetail={() => {}}
      />,
    );
    expect(hudDeployHtml).toContain('data-testid="battle-turn-phase-header"');
    expect(hudDeployHtml).toContain('data-testid="hud-turn-owner-badge"');
    expect(hudDeployHtml).toContain('data-testid="hud-phase-badge"');
    expect(hudDeployHtml).toContain('你的回合');
    expect(hudDeployHtml).toContain('部署阶段');

    const hudCombatHtml = renderToString(
      <TacticalBattleHud
        state={baseState}
        actor={actor}
        bottomPlayer={actor}
        topPlayer={opponent}
        hasPending={false}
        isHotseat={false}
        activeAnimPhase="strike"
        showLog={false}
        onToggleLog={() => {}}
        showDetail={false}
        onToggleDetail={() => {}}
      />,
    );
    expect(hudCombatHtml).toContain('作战阶段');

    // 手牌悬停抬升反馈与完整属性（物理/法术、部署位置、再部署 CD、ATK/HP、技能描述）
    const dockHtml = renderToString(
      <PlayerHandDock
        state={baseState}
        bottomPlayer={actor}
        actor={actor}
        canAct={false}
        isActionPhase
        hasPending={false}
        isHotseat={false}
        isMobile={false}
        layoutMode="bottom"
        selection={null}
        draggingCardId={null}
        onHandCardClick={() => {}}
        onLongPressCard={() => {}}
        onHoverCard={() => {}}
        onDragStartCard={() => {}}
        onDragEndCard={() => {}}
        onEndActionPhase={() => {}}
      />,
    );
    expect(dockHtml).toContain('hover:-translate-y-1');

    const handOpId = baseState.players[actor].hand.find(
      (id) => baseState.card_definitions[baseState.card_instances[id].card_id]?.card_type === 'operator',
    )!;
    const handOpDef = baseState.card_definitions[baseState.card_instances[handOpId].card_id] as UiCardDefinition;
    const handPopoverHtml = renderToString(
      <CardPreviewPopover
        state={baseState}
        hovered={{
          instanceId: handOpId,
          rect: { left: 200, top: 620, right: 316, bottom: 774, width: 116, height: 154 },
        }}
      />,
    ).replace(/<!-- -->/g, '');
    expect(handPopoverHtml).toContain(handOpDef.card_name_zh);
    expect(handPopoverHtml).toContain('data-testid="card-atk-badge"');
    expect(handPopoverHtml).toContain('data-testid="card-hp-badge"');
    expect(handPopoverHtml).toContain(`>${handOpDef.atk ?? 0}<`);
    expect(handPopoverHtml).toContain(`>${handOpDef.hp ?? 0}<`);
    if (handOpDef.rules_text_zh) {
      expect(handPopoverHtml).toContain(handOpDef.rules_text_zh);
    }
    if (typeof handOpDef.redeploy_cd_base === 'number' && handOpDef.redeploy_cd_base > 0) {
      expect(handPopoverHtml).toContain(`再部署${handOpDef.redeploy_cd_base}回`);
    }
  });

  it('无目标手牌双击直发 + 战术分析抽一弃一明确提示与手牌高亮 + 推进行动敌方半区跨路目标', () => {
    const baseState = createActionPhaseState(909);
    const actor = baseState.active_player_id;
    const enemy = actor === 'player_a' ? 'player_b' : 'player_a';

    // 1. 构造手牌包含「战术分析」(DEMO-TAC-V2-021)、「紧急治疗」(需指定目标) 与 1 名干员
    const tacDef = DEMO_CARDS.find((c) => c.card_id === ('DEMO-TAC-V2-021' as CardId))!;
    const tacInstId = 'tac-analysis-1' as CardInstanceId;
    const extraOpId =
      baseState.players[actor].hand.find(
        (id) => baseState.card_definitions[baseState.card_instances[id]!.card_id]?.card_type === 'operator',
      ) ?? baseState.players[actor].hand[0]!;
    const stagedState: GameState = {
      ...baseState,
      card_definitions: { ...baseState.card_definitions, [tacDef.card_id]: tacDef },
      card_instances: {
        ...baseState.card_instances,
        [tacInstId]: {
          card_instance_id: tacInstId,
          card_id: tacDef.card_id,
          owner_id: actor,
          controller_id: actor,
          zone: 'hand',
          board_half: null,
          lane: null,
          position: null,
          slot_index: null,
        },
      },
      players: {
        ...baseState.players,
        [actor]: {
          ...baseState.players[actor],
          cost: 5 as Cost,
          hand: [tacInstId, extraOpId],
        },
      },
    };

    const legal = enumerateLegalActions(stagedState, actor);
    const directTac = findDirectPlayAction(legal, tacInstId);
    expect(directTac).toEqual({ type: 'play_card', card_instance_id: tacInstId });
    // 需要指定目标的干员/卡牌不应误触发双击直发
    expect(findDirectPlayAction(legal, extraOpId)).toBeUndefined();

    // 2. 打出「战术分析」后产生 choose_discard 待决选择，PlayerHandDock 必须显式提示且手牌保持可点击高亮
    const afterPlay = reduceGameAction(stagedState, actor, directTac!);
    expect(afterPlay.ok).toBe(true);
    const pendingState = afterPlay.value;
    expect(pendingState.pending_effect_choices[0]?.effect).toBe('choose_discard');

    const promptText = getPendingChoicePromptText(pendingState, pendingState.pending_effect_choices[0]);
    expect(promptText).toContain('战术分析');
    expect(promptText).toContain('弃置');

    const pendingLegal = enumerateLegalActions(pendingState, actor);
    const discardCandidates = new Set(
      pendingLegal
        .filter((a): a is Extract<typeof a, { type: 'resolve_pending_choice' }> => a.type === 'resolve_pending_choice')
        .map((a) => a.target_instance_id)
        .filter((id): id is CardInstanceId => id !== undefined),
    );
    expect(discardCandidates.size).toBe(pendingState.players[actor].hand.length);

    for (const layoutMode of ['bottom', 'side-rail'] as const) {
      const dockHtml = renderToString(
        <PlayerHandDock
          state={pendingState}
          bottomPlayer={actor}
          actor={actor}
          canAct
          isActionPhase
          hasPending
          pendingChoice={pendingState.pending_effect_choices[0]}
          pendingPromptText={promptText}
          discardCandidateIds={discardCandidates}
          isHotseat={false}
          isMobile={false}
          layoutMode={layoutMode}
          selection={null}
          draggingCardId={null}
          onHandCardClick={() => {}}
          onLongPressCard={() => {}}
          onHoverCard={() => {}}
          onDragStartCard={() => {}}
          onDragEndCard={() => {}}
          onEndActionPhase={() => {}}
        />,
      ).replace(/<!-- -->/g, '');
      expect(dockHtml).toContain('data-testid="hand-dock-pending-prompt"');
      expect(dockHtml).toContain(promptText);
      expect(dockHtml).toContain('data-discard-candidate="true"');
      expect(dockHtml).toContain('点击弃置');
      expect(dockHtml).toContain('data-interactive="true"');
    }

    // 3. 推进行动 (DEMO-TAC-V2-016): 目标在敌方前排时必须能选到敌方相邻路线
    const pushDef = DEMO_CARDS.find((c) => c.card_id === ('DEMO-TAC-V2-016' as CardId))!;
    const pushId = 'tac-push-1' as CardInstanceId;
    const enemyOpInst = Object.values(stagedState.card_instances).find(
      (i) => i.owner_id === enemy && stagedState.card_definitions[i.card_id]?.card_type === 'operator',
    )!;
    const pushState: GameState = {
      ...stagedState,
      card_definitions: { ...stagedState.card_definitions, [pushDef.card_id]: pushDef },
      card_instances: {
        ...stagedState.card_instances,
        [pushId]: {
          card_instance_id: pushId,
          card_id: pushDef.card_id,
          owner_id: actor,
          controller_id: actor,
          zone: 'hand',
          board_half: null,
          lane: null,
          position: null,
          slot_index: null,
        },
        [enemyOpInst.card_instance_id]: {
          ...enemyOpInst,
          zone: 'board',
          board_half: enemy,
          lane: 'L1',
          position: 'front',
          slot_index: 1,
          operator_combat: {
            current_hp: 4 as HpValue,
            current_atk_modifiers: [],
            current_sp: 0 as SpValue,
            shield: 0,
            statuses: [],
            equipment_ids: [],
          },
        },
      },
      players: {
        ...stagedState.players,
        [actor]: { ...stagedState.players[actor], cost: 5 as Cost, hand: [pushId] },
      },
    };
    const pushLegal = enumerateLegalActions(pushState, actor);
    expect(
      pushLegal.some(
        (a) =>
          a.type === 'play_card' &&
          a.card_instance_id === pushId &&
          a.target_instance_id === enemyOpInst.card_instance_id &&
          a.target_lane === 'L2',
      ),
    ).toBe(true);
  });
});
