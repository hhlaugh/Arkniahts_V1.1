import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { LocalGameController } from '../../client/localGameController';
import { DEMO_CARDS, PRESET_DECKS } from '../../client/gameData';
import { advancePhase, reduceGameAction } from '../../game/engine';
import type { CardInstanceId, CombatLogEvent, GameState, HpValue, PlayerId, SpValue } from '../../game/types';
import {
  buildPresentationBeats,
  captureBoardPositions,
  collectImmediateCombatAudioCues,
  DEFAULT_ANIMATION_SPEED_MODE,
  getBeatDurationMs,
  getCssAnimationScale,
  makeSlotKey,
} from './combatPresentation';
import { playCombatAudioCues, playCombatSfx } from '../../audio/combatSfx';
import {
  resolveActionSfx,
  resolveCombatEventSfx,
  triggerBattleEventsSfx,
} from '../../audio/battleSfxTrigger';
import { evaluateBattleMissions } from './battleMissions';
import { TacticalBattleHud } from './TacticalBattleHud';
import { TurnTransitionBanner } from './TurnTransitionBanner';
import { PlayerHandDock } from './PlayerHandDock';
import { AttackPathOverlay } from './AttackPathOverlay';
import { UnitView } from './UnitView';
import { HealthBar } from '../ui/HealthBar';

function createStartedController(seed = 777): LocalGameController {
  const ctrl = LocalGameController.create({
    decks: { player_a: PRESET_DECKS[0]!, player_b: PRESET_DECKS[3] ?? PRESET_DECKS[0]! },
    cards: DEMO_CARDS,
    seed,
  });
  ctrl.submitMulligan('player_a', []);
  ctrl.submitMulligan('player_b', []);
  return ctrl;
}

describe('Phase 6: 战斗轻量动画与视觉反馈测试', () => {
  it('部署演出适配: 从真实引擎 unit_deployed 日志生成落位脉冲与跳字，且绝不修改 GameState', () => {
    const ctrl = createStartedController(1001);
    const prevSnapshot = ctrl.getSnapshot();
    const prevState = prevSnapshot.state;
    const prevPositions = captureBoardPositions(prevState);
    const actor = prevState.active_player_id;

    // 找一张当前费用够用的近战干员部署
    const opId = prevState.players[actor].hand.find((id) => {
      const def = prevState.card_definitions[prevState.card_instances[id].card_id];
      return def?.card_type === 'operator' && def.cost <= prevState.players[actor].cost;
    });
    expect(opId).toBeDefined();

    const opDef = prevState.card_definitions[prevState.card_instances[opId!].card_id]!;
    const pos = opDef.attack_type === 'melee' && !opDef.floating ? 'front' : 'back';
    const res = ctrl.dispatch(actor, {
      type: 'deploy_operator',
      card_instance_id: opId!,
      lane: 'center',
      position: pos,
    });
    expect(res.ok).toBe(true);

    const nextSnapshot = ctrl.getSnapshot();
    const newEvents = nextSnapshot.logHistory.slice(prevSnapshot.logHistory.length);
    const frozenNextCopy = structuredClone(nextSnapshot.state);

    const beats = buildPresentationBeats({
      prevState,
      nextState: nextSnapshot.state,
      newEvents,
      prevPositions,
      bottomPlayer: actor,
      speedMode: 'normal',
    });

    expect(beats.length).toBeGreaterThanOrEqual(1);
    const deployBeat = beats[0]!;
    const expectedSlot = makeSlotKey(actor, 'center', pos);
    expect(deployBeat.deployedSlots).toContain(expectedSlot);
    expect(deployBeat.deployedUnits[opId!]).toBe(true);
    expect(deployBeat.floatingPopups.some((p) => p.slotKey === expectedSlot && p.kind === 'deploy')).toBe(true);
    const expectedDeployCue = (opDef.rarity ?? 3) >= 5 ? 'deploy_elite' : 'deploy';
    expect(deployBeat.audioCues?.some((c) => c.kind === expectedDeployCue)).toBe(true);
    // 零规则耦合校验：适配器未改动 state 一分一毫
    expect(nextSnapshot.state).toEqual(frozenNextCopy);
  });

  it('真实交锋流水线: 正确识别近战/远程攻击、护盾吸收、伤害跳字、阵亡原位退场残影、直击基地与回合切换', () => {
    const ctrl = createStartedController(2026);
    const s0 = ctrl.getSnapshot().state;
    const actor = s0.active_player_id;
    const enemy: PlayerId = actor === 'player_a' ? 'player_b' : 'player_a';

    // 构造一个已部署的友方远程单位(左路)与敌方残血前锋(左路)，以及一个友方近战单位(右路空路直击基地)
    const allyRanged = Object.values(s0.card_instances).find((i) => {
      const def = s0.card_definitions[i.card_id];
      return (
        i.owner_id === actor &&
        def?.card_type === 'operator' &&
        def?.attack_type === 'ranged' &&
        def?.class !== 'medic' &&
        def?.attack_profile?.mode !== 'support'
      );
    })!;
    const allyMelee = Object.values(s0.card_instances).find(
      (i) => i.owner_id === actor && s0.card_definitions[i.card_id]?.attack_type === 'melee',
    )!;
    const enemyTarget = Object.values(s0.card_instances).find(
      (i) => i.owner_id === enemy && s0.card_definitions[i.card_id]?.card_type === 'operator',
    )!;

    const stagedState: GameState = {
      ...s0,
      card_instances: {
        ...s0.card_instances,
        [allyRanged.card_instance_id]: {
          ...allyRanged,
          zone: 'board',
          board_half: actor,
          lane: 'L1',
          position: 'back',
          slot_index: 1,
          operator_combat: {
            current_hp: 5 as HpValue,
            current_atk_modifiers: [3],
            current_sp: 0 as SpValue,
            shield: 0,
            statuses: [],
            equipment_ids: [],
          },
          operator_lifecycle: { entered_battle_this_owner_turn: false },
        },
        [allyMelee.card_instance_id]: {
          ...allyMelee,
          zone: 'board',
          board_half: actor,
          lane: 'L3',
          position: 'front',
          slot_index: 1,
          operator_combat: {
            current_hp: 6 as HpValue,
            current_atk_modifiers: [],
            current_sp: 0 as SpValue,
            shield: 0,
            statuses: [],
            equipment_ids: [],
          },
          operator_lifecycle: { entered_battle_this_owner_turn: false },
        },
        [enemyTarget.card_instance_id]: {
          ...enemyTarget,
          zone: 'board',
          board_half: enemy,
          lane: 'L1',
          position: 'front',
          slot_index: 1,
          operator_combat: {
            current_hp: 2 as HpValue,
            current_atk_modifiers: [],
            current_sp: 0 as SpValue,
            shield: 1,
            statuses: [],
            equipment_ids: [],
          },
          operator_lifecycle: { entered_battle_this_owner_turn: false },
        },
      },
    };

    const prevPositions = captureBoardPositions(stagedState);
    const res = reduceGameAction(stagedState, actor, { type: 'end_action_phase' });
    expect(res.ok).toBe(true);

    // 与 LocalGameController 一致：推进 combat -> turn_end -> turn_start -> action 并收集增量战报
    let nextState = res.value;
    const combatEvents: CombatLogEvent[] = [];
    for (let guard = 0; guard < 5 && nextState.phase !== 'action' && nextState.phase !== 'finished'; guard += 1) {
      const prevPhase = nextState.phase;
      const prevLen = nextState.combat_log.length;
      const stepped = advancePhase(nextState);
      expect(stepped.ok).toBe(true);
      nextState = stepped.value;
      if (prevPhase === 'combat' && nextState.phase !== 'combat') {
        combatEvents.push(...nextState.combat_log);
      } else if (nextState.combat_log.length >= prevLen) {
        combatEvents.push(...nextState.combat_log.slice(prevLen));
      } else {
        combatEvents.push(...nextState.combat_log);
      }
    }

    // 敌方单位已阵亡进入弃牌堆，lane/position 已被清空
    expect(nextState.card_instances[enemyTarget.card_instance_id].zone).toBe('discard');
    expect(nextState.card_instances[enemyTarget.card_instance_id].lane).toBeNull();

    const beats = buildPresentationBeats({
      prevState: stagedState,
      nextState,
      newEvents: combatEvents,
      prevPositions,
      bottomPlayer: actor,
      speedMode: 'normal',
    });

    // 第一段：左路远程攻击拆分为 Strike（攻击轨迹先行、目标保持受击前 HP）-> Impact（伤害扣血与原格位阵亡退场）
    const leftStrikeBeat = beats.find(
      (b) => b.phase === 'strike' && b.laneStrikes.some((s) => s.lane === 'L1' || s.lane === 'left'),
    );
    expect(leftStrikeBeat).toBeDefined();
    expect(leftStrikeBeat!.laneStrikes[0]!.attackType).toBe('ranged');
    expect(leftStrikeBeat!.laneStrikes[0]!.direction).toBe('up');
    expect(leftStrikeBeat!.laneStrikes[0]!.targetSlotKey).toBe(makeSlotKey(enemy, 'L1', 'front'));
    expect(leftStrikeBeat!.attackingUnits[allyRanged.card_instance_id]).toBe('up');
    expect(leftStrikeBeat!.audioCues?.some((c) => c.kind === 'strike_ranged')).toBe(true);
    // 关键校验：Strike 阶段绝不提前显示被攻击后的生命值或退场状态
    expect(leftStrikeBeat!.visualState?.card_instances[enemyTarget.card_instance_id]?.zone).toBe('board');
    expect(leftStrikeBeat!.visualState?.card_instances[enemyTarget.card_instance_id]?.operator_combat?.current_hp).toBe(2);
    expect(leftStrikeBeat!.visualState?.card_instances[enemyTarget.card_instance_id]?.operator_combat?.shield).toBe(1);

    const leftImpactBeat = beats.find(
      (b) => b.phase === 'impact' && b.laneStrikes.some((s) => s.lane === 'L1' || s.lane === 'left'),
    );
    expect(leftImpactBeat).toBeDefined();
    expect(leftImpactBeat!.hitUnits[enemyTarget.card_instance_id]).toBe(true);
    expect(leftImpactBeat!.floatingPopups.some((p) => p.kind === 'shield' && p.label === '🛡 -1')).toBe(true);
    expect(leftImpactBeat!.floatingPopups.some((p) => p.kind === 'damage' && p.label.startsWith('-'))).toBe(true);
    expect(leftImpactBeat!.audioCues?.some((c) => c.kind === 'shield')).toBe(true);
    expect(leftImpactBeat!.audioCues?.some((c) => c.kind === 'hit' && (c.delayMs ?? 0) > 0)).toBe(true);
    expect(leftImpactBeat!.audioCues?.some((c) => c.kind === 'defeat' && (c.delayMs ?? 0) >= 75)).toBe(true);
    expect(
      leftImpactBeat!.ghostCues.some(
        (g) => g.kind === 'defeat' && g.slotKey === makeSlotKey(enemy, 'L1', 'front'),
      ),
    ).toBe(true);
    expect(leftImpactBeat!.visualState?.card_instances[enemyTarget.card_instance_id]?.zone).toBe('discard');

    // 第二段：右路近战攻击空路直击基地（Strike 阶段保持基地受击前血量，Impact 阶段才扣除基地 HP）
    const rightStrikeBeat = beats.find(
      (b) => b.phase === 'strike' && b.laneStrikes.some((s) => s.lane === 'L3' || s.lane === 'right'),
    );
    expect(rightStrikeBeat).toBeDefined();
    expect(rightStrikeBeat!.laneStrikes[0]!.attackType).toBe('melee');
    expect(rightStrikeBeat!.laneStrikes[0]!.toBase).toBe(true);
    expect(rightStrikeBeat!.audioCues?.some((c) => c.kind === 'strike_melee')).toBe(true);
    expect(rightStrikeBeat!.visualState?.players[enemy].base_points).toBe(stagedState.players[enemy].base_points);

    const rightImpactBeat = beats.find(
      (b) => b.phase === 'impact' && b.laneStrikes.some((s) => s.lane === 'L3' || s.lane === 'right'),
    );
    expect(rightImpactBeat).toBeDefined();
    expect(rightImpactBeat!.baseDamage.enemy).toBeGreaterThan(0);
    expect(rightImpactBeat!.audioCues?.some((c) => c.kind === 'base_hit')).toBe(true);
    expect(rightImpactBeat!.visualState!.players[enemy].base_points).toBeLessThan(stagedState.players[enemy].base_points);

    // 最后一段：回合切换横幅 + 抽卡音效
    const turnBeat = beats.find((b) => Boolean(b.turnBanner));
    expect(turnBeat).toBeDefined();
    expect(turnBeat!.turnBanner!.actor).toBe(enemy);
    expect(turnBeat!.audioCues?.some((c) => c.kind === 'turn_enemy')).toBe(true);
    expect(turnBeat!.audioCues?.some((c) => c.kind === 'draw')).toBe(true);

    // 动画关闭时即时音频队列与 SSR 安全调用验证
    const immediateCues = collectImmediateCombatAudioCues({
      prevState: stagedState,
      nextState,
      newEvents: combatEvents,
      bottomPlayer: actor,
    });
    expect(immediateCues.some((c) => c.kind === 'shield')).toBe(true);
    expect(immediateCues.some((c) => c.kind === 'hit')).toBe(true);
    expect(immediateCues.some((c) => c.kind === 'draw')).toBe(true);
    expect(() => playCombatSfx('skill')).not.toThrow();
    expect(() => playCombatAudioCues(immediateCues)).not.toThrow();
  });

  it('撤离与倍速/关闭控制: withdraw 生成撤离残影；fast 时长减半；off 返回空队列', () => {
    const ctrl = createStartedController(3030);
    const prevSnapshot = ctrl.getSnapshot();
    const prevState = prevSnapshot.state;
    const actor = prevState.active_player_id;

    // 构造一个已过部署回合的场上单位进行撤离
    const unitId = prevState.players[actor].hand.find(
      (id) => prevState.card_definitions[prevState.card_instances[id].card_id]?.card_type === 'operator',
    )!;
    const unitInst = prevState.card_instances[unitId];
    const staged: GameState = {
      ...prevState,
      card_instances: {
        ...prevState.card_instances,
        [unitId]: {
          ...unitInst,
          zone: 'board',
          board_half: actor,
          lane: 'center',
          position: 'front',
          operator_combat: {
            current_hp: 4 as HpValue,
            current_atk_modifiers: [],
            current_sp: 0 as SpValue,
            shield: 0,
            statuses: [],
            equipment_ids: [],
          },
          operator_lifecycle: { entered_battle_this_owner_turn: false },
        },
      },
    };
    const prevPositions = captureBoardPositions(staged);

    const events: CombatLogEvent[] = [
      {
        sequence: 1,
        type: 'unit_withdrawn',
        source_instance_id: unitId,
        source_player_id: actor,
        source_name: staged.card_definitions[unitInst.card_id]!.card_name_zh,
        lane: 'center',
        position: 'front',
        detail: '主动撤离战场',
      },
    ];

    const slowBeats = buildPresentationBeats({
      prevState: staged,
      nextState: prevState,
      newEvents: events,
      prevPositions,
      bottomPlayer: actor,
      speedMode: 'slow',
    });
    expect(DEFAULT_ANIMATION_SPEED_MODE).toBe('slow');
    expect(getBeatDurationMs(440, 'slow')).toBe(880);
    expect(getCssAnimationScale('slow')).toBe(2);
    expect(slowBeats[0]!.durationMs).toBe(880);

    const fastBeats = buildPresentationBeats({
      prevState: staged,
      nextState: prevState,
      newEvents: events,
      prevPositions,
      bottomPlayer: actor,
      speedMode: 'fast',
    });
    expect(fastBeats).toHaveLength(1);
    expect(fastBeats[0]!.ghostCues[0]!.kind).toBe('withdraw');
    expect(fastBeats[0]!.audioCues?.some((c) => c.kind === 'withdraw')).toBe(true);
    expect(fastBeats[0]!.durationMs).toBe(getBeatDurationMs(440, 'fast'));

    const offBeats = buildPresentationBeats({
      prevState: staged,
      nextState: prevState,
      newEvents: events,
      prevPositions,
      bottomPlayer: actor,
      speedMode: 'off',
    });
    expect(offBeats).toHaveLength(0);

    // 主动技能事件应附加 skill 音效节拍
    const skillBeats = buildPresentationBeats({
      prevState: staged,
      nextState: staged,
      newEvents: [
        {
          sequence: 2,
          type: 'skill_activated',
          source_instance_id: unitId,
          source_player_id: actor,
          skill_name: '战术指令',
          detail: '发动技能',
        },
      ],
      prevPositions,
      bottomPlayer: actor,
      speedMode: 'normal',
    });
    expect(skillBeats.some((b) => b.audioCues?.some((c) => c.kind === 'skill'))).toBe(true);
  });

  it('组件视觉渲染: UnitView/HealthBar/TacticalBattleHud 正确渲染浮动伤害、基地受击标徽、倍速按钮及禁用动效', () => {
    const ctrl = createStartedController(4040);
    const state = ctrl.getSnapshot().state;
    const actor = state.active_player_id;
    const enemy: PlayerId = actor === 'player_a' ? 'player_b' : 'player_a';

    const unitId = state.players[actor].hand.find(
      (id) => state.card_definitions[state.card_instances[id].card_id]?.card_type === 'operator',
    )!;
    const unitInst = {
      ...state.card_instances[unitId],
      zone: 'board' as const,
      board_half: actor,
      lane: 'left' as const,
      position: 'front' as const,
      operator_combat: {
        current_hp: 3 as HpValue,
        current_atk_modifiers: [],
        current_sp: 2 as SpValue,
        shield: 1,
        statuses: [],
        equipment_ids: [],
      },
    };

    const unitHtml = renderToString(
      <UnitView
        state={{ ...state, card_instances: { ...state.card_instances, [unitId]: unitInst } }}
        instance={unitInst}
        highlight="none"
        animState={{
          hit: true,
          floatingPopups: [
            {
              id: 'p1',
              kind: 'damage',
              label: '-4',
              slotKey: makeSlotKey(actor, 'left', 'front'),
              unitId: unitId as CardInstanceId,
            },
          ],
          disableMotion: false,
        }}
      />,
    );
    expect(unitHtml).toContain('anim-hit-shake');
    expect(unitHtml).toContain('-4');
    expect(unitHtml).toContain('anim-float-number');

    const unitDisabledHtml = renderToString(
      <UnitView
        state={{ ...state, card_instances: { ...state.card_instances, [unitId]: unitInst } }}
        instance={unitInst}
        highlight="none"
        animState={{
          hit: true,
          floatingPopups: [
            {
              id: 'p1',
              kind: 'damage',
              label: '-4',
              slotKey: makeSlotKey(actor, 'left', 'front'),
              unitId: unitId as CardInstanceId,
            },
          ],
          disableMotion: true,
        }}
      />,
    );
    expect(unitDisabledHtml).not.toContain('anim-hit-shake');
    expect(unitDisabledHtml).not.toContain('anim-float-number');

    const hbHtml = renderToString(<HealthBar currentHp={3} maxHp={10} shield={2} />);
    expect(hbHtml).toContain('tabular-nums');

    const hudHtml = renderToString(
      <TacticalBattleHud
        state={state}
        actor={actor}
        bottomPlayer={actor}
        topPlayer={enemy}
        hasPending={false}
        showLog
        onToggleLog={() => {}}
        showDetail
        onToggleDetail={() => {}}
        animSpeedMode="fast"
        onCycleAnimSpeed={() => {}}
        enemyBaseDamageDelta={2}
      />,
    );
    expect(hudHtml).toContain('2x');
    expect(hudHtml).toContain('-2');
    expect(hudHtml).toContain('data-testid="scenic-banner-layer"');
    expect(hudHtml).toContain('bg_rhodes_bridge.png');

    const dockHtml = renderToString(
      <PlayerHandDock
        state={state}
        bottomPlayer={actor}
        actor={actor}
        canAct
        isActionPhase
        hasPending={false}
        isHotseat={false}
        isMobile={false}
        selection={null}
        draggingCardId={null}
        allyBaseDamageDelta={3}
        onHandCardClick={() => {}}
        onLongPressCard={() => {}}
        onHoverCard={() => {}}
        onDragStartCard={() => {}}
        onDragEndCard={() => {}}
        onEndActionPhase={() => {}}
      />,
    );
    expect(dockHtml).toContain('-3');
    expect(dockHtml).toContain('结束行动');
    expect(dockHtml).toContain(`/${state.players[actor].turn_cp_cap}`);
    expect(dockHtml).toContain('data-testid="scenic-banner-layer"');
    expect(dockHtml).toContain('bg_rhodes_command.png');

    const defaultHudHtml = renderToString(
      <TacticalBattleHud
        state={state}
        actor={actor}
        bottomPlayer={actor}
        topPlayer={enemy}
        hasPending={false}
        showLog
        onToggleLog={() => {}}
        showDetail
        onToggleDetail={() => {}}
        onCycleAnimSpeed={() => {}}
      />,
    );
    expect(defaultHudHtml).toContain('0.5x');

    const overlayHtml = renderToString(
      <AttackPathOverlay
        strikes={[
          {
            id: 's1',
            lane: 'left',
            attackType: 'ranged',
            direction: 'up',
            attackerSlotKey: makeSlotKey(actor, 'left', 'back'),
            targetSlotKey: makeSlotKey(enemy, 'left', 'front'),
            targetHalf: enemy,
            targetLane: 'left',
            toBase: false,
            kind: 'attack',
            phase: 'strike',
          },
        ]}
        bottomPlayer={actor}
        topPlayer={enemy}
        cssAnimScale={2}
        disableMotion={false}
      />,
    );
    expect(overlayHtml).toContain('data-testid="attack-path-overlay"');
    expect(overlayHtml).toContain('anim-path-draw');
    expect(overlayHtml).toContain('anim-reticle-lock');
    expect(overlayHtml).toContain('animateMotion');

    // TurnTransitionBanner: 工业切角外壳 + 敌我方向滑入动画 + 禁用动效降级
    const allyBannerHtml = renderToString(
      <TurnTransitionBanner
        banner={{ id: 'turn-2-a', actor, turnNumber: 2 }}
        bottomPlayer={actor}
      />,
    );
    expect(allyBannerHtml).toContain('data-testid="turn-transition-banner"');
    expect(allyBannerHtml).toContain('data-incoming-side="ally"');
    expect(allyBannerHtml).toContain('anim-turn-banner-ally');
    expect(allyBannerHtml).toContain('anim-turn-banner-sweep');
    expect(allyBannerHtml).toContain('anim-turn-banner-rail');
    expect(allyBannerHtml).toContain('board-chamfer-sm');
    expect(allyBannerHtml).toContain('T02');
    expect(allyBannerHtml).toContain('我方行动阶段');

    const enemyBannerHtml = renderToString(
      <TurnTransitionBanner
        banner={{ id: 'turn-3-b', actor: enemy, turnNumber: 3 }}
        bottomPlayer={actor}
      />,
    );
    expect(enemyBannerHtml).toContain('data-incoming-side="enemy"');
    expect(enemyBannerHtml).toContain('anim-turn-banner-enemy');
    expect(enemyBannerHtml).toContain('T03');
    expect(enemyBannerHtml).toContain('敌方行动阶段');

    const staticBannerHtml = renderToString(
      <TurnTransitionBanner
        banner={{ id: 'turn-4-a', actor, turnNumber: 4 }}
        bottomPlayer={actor}
        disableMotion
      />,
    );
    expect(staticBannerHtml).not.toContain('anim-turn-banner');
    expect(staticBannerHtml).not.toContain('anim-turn-banner-sweep');

    // TacticalBattleHud 回合徽章亦带平滑滑入切换类
    expect(hudHtml).toContain('anim-hud-turn-shift');
  });

  it('设施每回合寿命扣除: buildPresentationBeats 生成 facility_decay 专属节拍，UnitView 渲染扣除动效与末回合寿命提醒', () => {
    const ctrl = createStartedController(6060);
    const baseState = ctrl.getSnapshot().state;
    const actor = baseState.active_player_id;

    const facHandId = Object.keys(baseState.card_instances).find((id) => {
      const inst = baseState.card_instances[id as CardInstanceId];
      const def = baseState.card_definitions[inst.card_id];
      return def?.card_type === 'facility' || (def?.card_type === 'support' && def.support_subtype === 'facility');
    }) as CardInstanceId | undefined;
    expect(facHandId).toBeDefined();

    const facPrevInst = {
      ...baseState.card_instances[facHandId!],
      controller_id: actor,
      zone: 'board' as const,
      board_half: actor,
      lane: 'center' as const,
      position: 'back' as const,
      slot_index: 1,
      operator_combat: {
        current_hp: 3 as HpValue,
        current_atk_modifiers: [],
        current_sp: 0 as SpValue,
        shield: 0,
        statuses: [],
        equipment_ids: [],
      },
    };
    const facAfterDecayInst = {
      ...facPrevInst,
      operator_combat: {
        ...facPrevInst.operator_combat,
        current_hp: 2 as HpValue,
      },
    };
    const prevWithFac = {
      ...baseState,
      card_instances: { ...baseState.card_instances, [facHandId!]: facPrevInst },
    };
    const nextWithFac = {
      ...baseState,
      state_version: baseState.state_version + 1,
      card_instances: { ...baseState.card_instances, [facHandId!]: facAfterDecayInst },
    };

    const decayBeats = buildPresentationBeats({
      prevState: prevWithFac,
      nextState: nextWithFac,
      newEvents: [
        {
          sequence: 99,
          type: 'damage_resolved',
          action_type: 'facility_self_hp_loss',
          source_instance_id: facHandId!,
          target_instance_id: facHandId!,
          source_player_id: actor,
          target_player_id: actor,
          amount: 1,
          absorbed: 0,
          detail: '场地设施回合开始自损 1 点 HP（剩余 2/3）',
        },
      ],
      prevPositions: captureBoardPositions(prevWithFac),
      bottomPlayer: actor,
      speedMode: 'normal',
    });

    expect(decayBeats).toHaveLength(1);
    expect(decayBeats[0]!.facilityDecayUnits[facHandId!]).toBe(true);
    expect(decayBeats[0]!.hitUnits[facHandId!]).toBeUndefined();
    expect(decayBeats[0]!.floatingPopups[0]?.kind).toBe('facility_decay');
    expect(decayBeats[0]!.floatingPopups[0]?.label).toContain('寿命 -1 HP');

    const decayUnitHtml = renderToString(
      <UnitView
        state={nextWithFac}
        instance={facAfterDecayInst}
        highlight="none"
        animState={{
          facilityDecay: true,
          floatingPopups: decayBeats[0]!.floatingPopups,
          disableMotion: false,
        }}
      />,
    ).replace(/<!-- -->/g, '');
    expect(decayUnitHtml).toContain('data-facility-decay="true"');
    expect(decayUnitHtml).toContain('anim-facility-decay');
    expect(decayUnitHtml).toContain('data-testid="facility-decay-fx"');
    expect(decayUnitHtml).toContain('data-testid="facility-hp-cut-fx"');
    expect(decayUnitHtml).toContain('anim-facility-hp-cut');
    expect(decayUnitHtml).toContain('anim-facility-pip-shatter');
    expect(decayUnitHtml).toContain('data-testid="facility-lifetime-bar"');
    expect(decayUnitHtml).toContain('HP削减 -1');
    expect(decayUnitHtml).toContain('寿命 2/3');
    expect(decayUnitHtml).toContain('⏳ 寿命 -1 HP');

    // 回合结束时模拟设施自动扣除 1 HP 的 CSS 视觉反馈
    const enemy: PlayerId = actor === 'player_a' ? 'player_b' : 'player_a';
    const turnEndNextState: GameState = {
      ...prevWithFac,
      active_player_id: enemy,
      turn_number: prevWithFac.turn_number + 1,
      state_version: prevWithFac.state_version + 1,
    };
    const turnEndBeats = buildPresentationBeats({
      prevState: prevWithFac,
      nextState: turnEndNextState,
      newEvents: [],
      prevPositions: captureBoardPositions(prevWithFac),
      bottomPlayer: actor,
      speedMode: 'normal',
    });
    const turnEndSimBeat = turnEndBeats.find((b) => b.phase === 'turn');
    expect(turnEndSimBeat).toBeDefined();
    expect(turnEndSimBeat!.facilityTurnEndSimUnits[facHandId!]).toBe(true);
    expect(turnEndSimBeat!.floatingPopups.some((p) => p.label.includes('-1 HP'))).toBe(true);

    const turnEndSimHtml = renderToString(
      <UnitView
        state={turnEndNextState}
        instance={facPrevInst}
        highlight="none"
        animState={{
          facilityTurnEndSim: true,
          floatingPopups: turnEndSimBeat!.floatingPopups,
          disableMotion: false,
        }}
      />,
    ).replace(/<!-- -->/g, '');
    expect(turnEndSimHtml).toContain('data-facility-hp-sim="true"');
    expect(turnEndSimHtml).toContain('data-testid="facility-hp-cut-fx"');
    expect(turnEndSimHtml).toContain('anim-facility-hp-sim');
    expect(turnEndSimHtml).toContain('⏳ 回合末 -1 HP');

    // 1 HP 末回合寿命预警
    const facCriticalInst = {
      ...facPrevInst,
      operator_combat: {
        ...facPrevInst.operator_combat,
        current_hp: 1 as HpValue,
      },
    };
    const criticalHtml = renderToString(
      <UnitView
        state={{
          ...nextWithFac,
          card_instances: { ...baseState.card_instances, [facHandId!]: facCriticalInst },
        }}
        instance={facCriticalInst}
        highlight="none"
      />,
    ).replace(/<!-- -->/g, '');
    expect(criticalHtml).toContain('data-facility-critical="true"');
    expect(criticalHtml).toContain('⚠ 末回合');
    expect(criticalHtml).toContain('下回销毁');
    expect(criticalHtml).toContain('anim-facility-critical');
    expect(criticalHtml).toContain('anim-facility-pip-drain');

    // 关闭动效时应移除动画类但保留寿命刻度条
    const staticCriticalHtml = renderToString(
      <UnitView
        state={{
          ...nextWithFac,
          card_instances: { ...baseState.card_instances, [facHandId!]: facCriticalInst },
        }}
        instance={facCriticalInst}
        highlight="none"
        animState={{ facilityDecay: true, facilityTurnEndSim: true, disableMotion: true }}
      />,
    ).replace(/<!-- -->/g, '');
    expect(staticCriticalHtml).not.toContain('anim-facility-decay');
    expect(staticCriticalHtml).not.toContain('anim-facility-hp-cut');
    expect(staticCriticalHtml).not.toContain('anim-facility-hp-sim');
    expect(staticCriticalHtml).not.toContain('anim-facility-critical');
    expect(staticCriticalHtml).toContain('⚠ 末回合');
  });

  it('音效触发器（battleSfxTrigger）：准确区分部署、普通攻击、受到伤害（敌/我）与释放技能音效', () => {
    const ctrl = createStartedController(20261125);
    const state = ctrl.getSnapshot().state;
    const actor = state.active_player_id;
    const enemy: PlayerId = actor === 'player_a' ? 'player_b' : 'player_a';

    const opHandId = state.players[actor].hand.find((id) => {
      const def = state.card_definitions[state.card_instances[id].card_id];
      return def?.card_type === 'operator';
    })!;
    const deployCue = resolveActionSfx(
      { type: 'deploy_operator', card_instance_id: opHandId, lane: 'L1', position: 'front' },
      state,
    );
    expect(deployCue?.category).toBe('deploy');
    expect(['deploy', 'deploy_elite']).toContain(deployCue?.kind);

    const skillUnitId = Object.values(state.card_instances).find(
      (inst) => inst.owner_id === actor,
    )!.card_instance_id;
    expect(
      resolveActionSfx({ type: 'activate_skill', card_instance_id: skillUnitId }, state),
    ).toEqual({ category: 'skill', kind: 'skill' });

    const rangedInst = Object.values(state.card_instances).find(
      (i) => state.card_definitions[i.card_id]?.attack_type === 'ranged',
    )!;
    const allyUnit = Object.values(state.card_instances).find((i) => i.owner_id === actor)!;
    const enemyUnit = Object.values(state.card_instances).find((i) => i.owner_id === enemy)!;

    expect(
      resolveCombatEventSfx(
        {
          sequence: 1,
          type: 'attack_declared',
          source_instance_id: rangedInst.card_instance_id,
          detail: '远程普攻',
        },
        state,
        actor,
      ),
    ).toEqual({ category: 'attack', kind: 'strike_ranged' });

    // 己方受到伤害 -> damage_taken；敌方受到伤害 -> hit
    expect(
      resolveCombatEventSfx(
        {
          sequence: 2,
          type: 'damage_resolved',
          target_instance_id: allyUnit.card_instance_id,
          target_player_id: actor,
          amount: 3,
          detail: '己方受伤',
        },
        state,
        actor,
      ),
    ).toEqual({ category: 'damage', kind: 'damage_taken' });

    expect(
      resolveCombatEventSfx(
        {
          sequence: 3,
          type: 'damage_resolved',
          target_instance_id: enemyUnit.card_instance_id,
          target_player_id: enemy,
          amount: 3,
          detail: '敌方受伤',
        },
        state,
        actor,
      ),
    ).toEqual({ category: 'damage', kind: 'hit' });

    expect(
      resolveCombatEventSfx(
        {
          sequence: 4,
          type: 'skill_activated',
          source_instance_id: allyUnit.card_instance_id,
          detail: '释放技能',
        },
        state,
        actor,
      ),
    ).toEqual({ category: 'skill', kind: 'skill' });

    // SSR/Node 环境无 WebAudio 时安全执行并返回错峰队列
    const cues = triggerBattleEventsSfx(
      [
        { sequence: 10, type: 'unit_deployed', source_instance_id: opHandId, detail: '部署' },
        { sequence: 11, type: 'attack_declared', source_instance_id: rangedInst.card_instance_id, detail: '普攻' },
        { sequence: 12, type: 'damage_resolved', target_instance_id: allyUnit.card_instance_id, target_player_id: actor, amount: 2, detail: '受伤' },
        { sequence: 13, type: 'skill_activated', source_instance_id: allyUnit.card_instance_id, detail: '技能' },
      ],
      state,
      actor,
    );
    expect(cues.map((c) => c.category)).toEqual(['deploy', 'attack', 'damage', 'skill']);
    expect(() => playCombatSfx('damage_taken')).not.toThrow();
  });

  it('动态演习任务（evaluateBattleMissions）：实时统计部署、伤害与次级任务并计算额外合成玉奖励', () => {
    const ctrl = createStartedController(424242);
    const state = ctrl.getSnapshot().state;
    const logs: CombatLogEvent[] = [
      { sequence: 1, type: 'unit_deployed', source_player_id: 'player_a', detail: '部署1' },
      { sequence: 2, type: 'unit_deployed', source_player_id: 'player_a', detail: '部署2' },
      { sequence: 3, type: 'unit_deployed', source_player_id: 'player_a', detail: '部署3' },
      { sequence: 4, type: 'unit_deployed', source_player_id: 'player_a', detail: '部署4' },
      { sequence: 5, type: 'unit_deployed', source_player_id: 'player_a', detail: '部署5' },
      { sequence: 6, type: 'damage_resolved', source_player_id: 'player_a', target_player_id: 'player_b', amount: 12, detail: '伤害12' },
      { sequence: 7, type: 'base_damaged', source_player_id: 'player_a', target_player_id: 'player_b', amount: 6, detail: '基地6' },
      { sequence: 8, type: 'unit_defeated', source_player_id: 'player_a', target_player_id: 'player_b', detail: '击倒1' },
      { sequence: 9, type: 'unit_defeated', source_player_id: 'player_a', target_player_id: 'player_b', detail: '击倒2' },
      { sequence: 10, type: 'unit_defeated', source_player_id: 'player_a', target_player_id: 'player_b', detail: '击倒3' },
      { sequence: 11, type: 'skill_activated', source_player_id: 'player_a', detail: '技能1' },
      { sequence: 12, type: 'skill_activated', source_player_id: 'player_a', detail: '技能2' },
    ];
    const report = evaluateBattleMissions({
      state,
      logHistory: logs,
      playerId: 'player_a',
      seed: 424242,
    });
    expect(report.totalCount).toBe(3);
    expect(report.missions[0]!.kind).toBe('deploy_operators');
    expect(report.missions[0]!.completed).toBe(true);
    expect(report.missions[1]!.kind).toBe('deal_damage');
    expect(report.missions[1]!.completed).toBe(true);
    expect(report.completedCount).toBeGreaterThanOrEqual(2);
    expect(report.totalEarnedOriginite).toBeGreaterThan(0);
  });
});
