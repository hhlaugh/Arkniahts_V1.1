import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ActionResult, LocalGameController, LocalGameSnapshot } from '../client/localGameController';
import { PLAYER_LABEL } from '../client/gameData';
import { cardDefinitionOf } from '../components/cards/CardView';
import { UnitView } from '../components/battle/UnitView';
import type { UnitHighlight } from '../components/battle/UnitView';
import { LogView } from '../components/battle/LogView';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { BottomSheet } from '../components/ui/BottomSheet';
import { Modal } from '../components/ui/Modal';
import type { ScenicSceneId } from '../components/ui/ScenicBackdrop';
import { TacticalBattleHud } from '../components/battle/TacticalBattleHud';
import { PlayerHandDock } from '../components/battle/PlayerHandDock';
import { TacticalDetailPanel } from '../components/battle/TacticalDetailPanel';
import { AttackPathOverlay, type Point2D } from '../components/battle/AttackPathOverlay';
import { CardPreviewPopover, type HoveredCardPreview } from '../components/battle/CardPreviewPopover';
import { TurnTransitionBanner } from '../components/battle/TurnTransitionBanner';
import { CardTouchDragOverlay } from '../components/battle/CardTouchDragOverlay';
import { TacticalBoardViewport } from '../components/battle/TacticalBoardViewport';
import battlefieldArenaSurface from '../assets/images/battlefield_arena_surface_1795044169209.jpg';
import deployPadAllyArt from '../assets/images/deploy_pad_ally_1795070691439.jpg';
import deployPadEnemyArt from '../assets/images/deploy_pad_enemy_1795070690125.jpg';
import {
  computeTouchAimPoint,
  detectTouchDragIntent,
  resolveTouchDropTarget,
  type TouchDragLayoutMode,
  type TouchDragSlotCandidate,
  type TouchDropResolution,
} from '../components/battle/touchDrag';
import {
  getInvalidCardReason,
  getInvalidDeployReason,
  getInvalidUnitActionReason,
  previewAttackTargets,
} from '../components/battle/tacticalSelectors';
import {
  makeSlotKey,
  type FloatingPopupKind,
  type SlotKey,
  type UnitAnimationState,
} from '../components/battle/combatPresentation';
import { enumerateLegalActions } from '../game/legal-actions';
import { useCombatAnimations } from '../hooks/useCombatAnimations';
import { triggerHaptic, type PointerPosition } from '../hooks/useLongPress';
import { useViewport } from '../hooks/useViewport';
import { useAppSettings } from '../data/app-settings';
import { playTacticalSfx } from '../audio/bgmPlayer';
import { playCombatSfx } from '../audio/combatSfx';
import {
  formatCellLabel,
  formatLaneLabelZh,
  getDisplaySlotLabel,
  normalizeLaneId,
  slotCountForRow,
  sortedLanes,
} from '../game/board';
import { getEntityKind } from '../game/range';
import type { CardInstance, CardInstanceId, GameAction, LaneId, PlayerId, Position } from '../game/types';

const SLOT_POPUP_STYLE: Record<FloatingPopupKind, string> = {
  damage: 'bg-[#0e1116]/95 text-rose-300 border-rose-500/85 border-l-2',
  shield: 'bg-[#0e1116]/95 text-sky-300 border-sky-400/85 border-l-2',
  heal: 'bg-[#0e1116]/95 text-emerald-300 border-emerald-400/85 border-l-2',
  sp: 'bg-[#0e1116]/95 text-cyan-300 border-cyan-400/85 border-l-2',
  skill: 'bg-[#0e1116]/95 text-amber-300 border-[#e5a52b] border-l-2',
  deploy: 'bg-[#0e1116]/92 text-amber-200 border-[#e5a52b]/80 border-l-2',
  status: 'bg-[#0e1116]/95 text-purple-300 border-purple-400/85 border-l-2',
};

const SUMMON_OPTION_LABELS: Readonly<Record<string, string>> = {
  magallan_strike_drone: '强击无人机 (3/2 远程)',
  magallan_support_drone: '支援无人机 (0/2 护盾支持)',
};

type DeployAction = Extract<GameAction, { type: 'deploy_operator' }>;
type PlayCardAction = Extract<GameAction, { type: 'play_card' }>;
type SkillAction = Extract<GameAction, { type: 'activate_skill' }>;
type WithdrawAction = Extract<GameAction, { type: 'withdraw_operator' }>;
type RecallSummonAction = Extract<GameAction, { type: 'recall_summon' }>;
type PendingResolveAction = Extract<GameAction, { type: 'resolve_pending_choice' }>;

interface SlotCoords {
  readonly half: PlayerId;
  readonly lane: LaneId;
  readonly position: Position;
  readonly slotIndex: number;
}

interface TouchDragState {
  readonly cardId: CardInstanceId;
  readonly pointerId: number;
  readonly pointer: PointerPosition;
  readonly aimPoint: PointerPosition;
  readonly resolution: TouchDropResolution;
  readonly statusText: string;
  readonly layoutMode: TouchDragLayoutMode;
}

export interface NetworkStatus {
  readonly isOnline: boolean;
  readonly roomCode?: string;
  readonly seat?: 'host' | 'guest';
  readonly opponentConnected: boolean;
  readonly pausedForGuest?: boolean;
  readonly onLeaveRoom?: () => void;
}

interface BattleViewProps {
  readonly snapshot: LocalGameSnapshot;
  readonly controller?: LocalGameController;
  readonly onDispatch?: (action: GameAction) => ActionResult | Promise<ActionResult>;
  /** 单人模式下由人类操作的玩家座位；null 表示本地热座（双方都是人）。 */
  readonly humanPlayer?: PlayerId | null;
  readonly networkStatus?: NetworkStatus | null;
  readonly onExit?: () => void;
  readonly onOpenSettings?: () => void;
}

export function BattleView({ snapshot, controller, onDispatch, humanPlayer = null, networkStatus = null, onExit, onOpenSettings }: BattleViewProps) {
  const state = snapshot.state;
  const actor = state.active_player_id;
  const canAct = !humanPlayer || actor === humanPlayer;
  const isActionPhase = state.phase === 'action';
  const hasPending =
    ((state.phase === 'turn_start' && state.turn_start_prepared) || state.phase === 'action') &&
    state.pending_effect_choices.length > 0;
  const activePendingChoice = hasPending ? state.pending_effect_choices[0] ?? null : null;

  const { width, height, isMobile, isPhone, isLandscape, isShortViewport, isCompactLandscape } = useViewport();
  const useCompactBoard = isCompactLandscape || (isPhone && isShortViewport) || isShortViewport;
  const useSideRail = isCompactLandscape;

  // 视角决定：单人/联机模式下 humanPlayer 固定为下方玩家；本地热座模式下，当前行动方 actor 置于下方
  const isHotseat = humanPlayer === null;
  const bottomPlayer: PlayerId = humanPlayer ?? actor;
  const topPlayer: PlayerId = bottomPlayer === 'player_a' ? 'player_b' : 'player_a';
  const boardScenicScene: ScenicSceneId = networkStatus?.isOnline
    ? 'lungmen-night'
    : isHotseat
      ? 'snowfield'
      : 'rhodes-exterior';

  const [selection, setSelection] = useState<CardInstanceId | null>(null);
  const [pendingPlayDraft, setPendingPlayDraft] = useState<{
    readonly cardId: CardInstanceId;
    readonly firstTargetId: CardInstanceId;
  } | null>(null);
  const [hoveredCard, setHoveredCard] = useState<HoveredCardPreview | null>(null);
  const [pinnedPreview, setPinnedPreview] = useState<HoveredCardPreview | null>(null);
  const [hoveredUnitId, setHoveredUnitId] = useState<CardInstanceId | null>(null);
  const [hoveredSlot, setHoveredSlot] = useState<SlotCoords | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<CardInstanceId | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<SlotCoords | null>(null);
  const [touchDragState, setTouchDragState] = useState<TouchDragState | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<'surrender' | 'exit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const touchCandidateRef = useRef<{
    cardId: CardInstanceId;
    pointerId: number;
    start: PointerPosition;
    layoutMode: TouchDragLayoutMode;
    active: boolean;
  } | null>(null);
  const touchCleanupRef = useRef<(() => void) | null>(null);
  const justFinishedTouchDragAtRef = useRef(0);
  const lastSnappedSlotKeyRef = useRef<SlotKey | null>(null);

  const effectiveOnExit = onExit ?? networkStatus?.onLeaveRoom ?? null;
  const surrenderActor: PlayerId = humanPlayer ?? actor;
  const canSurrender = Boolean((controller || onDispatch) && state.phase !== 'finished' && state.phase !== 'mulligan');
  const appSettings = useAppSettings();

  const combatAnim = useCombatAnimations({
    state,
    logHistory: snapshot.logHistory,
    bottomPlayer,
  });
  const activeBeat = combatAnim.activeBeat;
  // 演出进行期间使用 activeBeat.visualState 展示血量/护盾/退场，保证“先轨迹攻击、后扣血结算”
  const displayState = activeBeat?.visualState ?? state;

  const boardGridRef = useRef<HTMLDivElement>(null);
  const slotElRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [boardScale, setBoardScale] = useState(1);
  const boardScaleRef = useRef(1);
  boardScaleRef.current = boardScale;

  const [slotTapCue, setSlotTapCue] = useState<{
    readonly slotKey: SlotKey;
    readonly kind: 'tap' | 'skill' | 'deploy';
    readonly seq: number;
  } | null>(null);
  const tapCueSeqRef = useRef(0);
  const tapCueTimerRef = useRef<number | null>(null);

  const triggerSlotCue = (slotKey: SlotKey, kind: 'tap' | 'skill' | 'deploy') => {
    tapCueSeqRef.current += 1;
    const seq = tapCueSeqRef.current;
    setSlotTapCue({ slotKey, kind, seq });
    if (tapCueTimerRef.current !== null) {
      window.clearTimeout(tapCueTimerRef.current);
    }
    tapCueTimerRef.current = window.setTimeout(() => {
      setSlotTapCue((prev) => (prev && prev.seq === seq ? null : prev));
    }, 460);
  };

  const [boardGeometry, setBoardGeometry] = useState<{
    boardSize: { width: number; height: number };
    slotCenters: Record<string, Point2D>;
  }>({
    boardSize: { width: 0, height: 0 },
    slotCenters: {},
  });

  useLayoutEffect(() => {
    const measure = () => {
      const gridEl = boardGridRef.current;
      if (!gridEl) return;
      const gridRect = gridEl.getBoundingClientRect();
      if (gridRect.width <= 0 || gridRect.height <= 0) return;

      const scale = Math.max(0.1, boardScaleRef.current);
      const centers: Record<string, Point2D> = {};
      for (const [key, el] of Object.entries(slotElRefs.current)) {
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) continue;
        centers[key] = {
          x: (rect.left - gridRect.left + rect.width / 2) / scale,
          y: (rect.top - gridRect.top + rect.height / 2) / scale,
        };
      }
      setBoardGeometry({
        boardSize: { width: gridRect.width / scale, height: gridRect.height / scale },
        slotCenters: centers,
      });
    };

    measure();
    window.addEventListener('resize', measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && boardGridRef.current) {
      observer = new ResizeObserver(measure);
      observer.observe(boardGridRef.current);
    }
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [activeBeat?.id, boardScale, showLog, showDetail, isMobile, isLandscape, isCompactLandscape, width, height]);

  const cancelPendingTouchCandidate = () => {
    touchCleanupRef.current?.();
    touchCleanupRef.current = null;
    touchCandidateRef.current = null;
    lastSnappedSlotKeyRef.current = null;
    setTouchDragState(null);
  };

  useEffect(() => {
    cancelPendingTouchCandidate();
    setSelection(null);
    setPendingPlayDraft(null);
    setHoveredCard(null);
    setPinnedPreview(null);
    setHoveredUnitId(null);
    setHoveredSlot(null);
    setDraggingCardId(null);
    setDragOverSlot(null);
  }, [actor]);

  useEffect(() => {
    if (!isMobile) {
      setShowLog(true);
      setShowDetail(true);
      setHoveredCard(null);
      setPinnedPreview(null);
    } else {
      setShowLog(false);
      setShowDetail(false);
      setHoveredCard(null);
      setPinnedPreview(null);
      setHoveredUnitId(null);
      setHoveredSlot(null);
      setDraggingCardId(null);
      cancelPendingTouchCandidate();
    }
  }, [isMobile]);

  useEffect(() => {
    return () => {
      touchCleanupRef.current?.();
      touchCleanupRef.current = null;
      if (tapCueTimerRef.current !== null) {
        window.clearTimeout(tapCueTimerRef.current);
        tapCueTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(timer);
  }, [error]);

  // Esc 键盘取消与清理非模态浮层
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setHoveredCard(null);
      setDraggingCardId(null);
      setDragOverSlot(null);
      setHoveredSlot(null);
      setHoveredUnitId(null);
      if (pinnedPreview) {
        setPinnedPreview(null);
        return;
      }
      if (isMobile && showLog) {
        setShowLog(false);
        return;
      }
      setSelection(null);
      setPendingPlayDraft(null);
      setError(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, pinnedPreview, showLog]);

  const legal = useMemo(() => enumerateLegalActions(state, actor), [state, actor]);
  const boardLanes = useMemo(() => sortedLanes(displayState.board_profile), [displayState.board_profile]);
  const isWideBoard = useMemo(
    () => boardLanes.length >= 4 || boardLanes.some((l) => l.frontSlots >= 3 || l.rearSlots >= 3),
    [boardLanes],
  );

  const activeHandCardId = draggingCardId ?? (selection && state.card_instances[selection]?.zone === 'hand' ? selection : null);
  const activeHandDef = activeHandCardId ? cardDefinitionOf(state, activeHandCardId) : undefined;
  const activeHandIsOperator = activeHandDef?.card_type === 'operator';
  const activeHandIsFacility = activeHandDef?.card_type === 'support' && activeHandDef.support_subtype === 'facility';

  const selectedDeployActions = useMemo(
    () =>
      activeHandCardId
        ? legal.filter((action): action is DeployAction => action.type === 'deploy_operator' && action.card_instance_id === activeHandCardId)
        : [],
    [legal, activeHandCardId],
  );
  const selectedPlayActions = useMemo(
    () => (activeHandCardId ? legal.filter((action): action is PlayCardAction => action.type === 'play_card' && action.card_instance_id === activeHandCardId) : []),
    [legal, activeHandCardId],
  );
  const selectedFacilityActions = useMemo(
    () => selectedPlayActions.filter((action) => action.target_position !== undefined),
    [selectedPlayActions],
  );
  const isTwoUnitSwapPlay = useMemo(
    () => selectedPlayActions.some((action) => action.secondary_target_instance_id !== undefined),
    [selectedPlayActions],
  );
  const isUnitAndLaneMovePlay = useMemo(
    () =>
      selectedPlayActions.some(
        (action) => action.target_instance_id !== undefined && action.target_lane !== undefined && action.target_position === undefined,
      ),
    [selectedPlayActions],
  );
  const playTargets = useMemo(() => {
    if (pendingPlayDraft && pendingPlayDraft.cardId === selection) {
      if (isTwoUnitSwapPlay) {
        return new Set(
          selectedPlayActions
            .filter((action) => action.target_instance_id === pendingPlayDraft.firstTargetId && action.secondary_target_instance_id)
            .map((action) => action.secondary_target_instance_id!),
        );
      }
      return new Set<CardInstanceId>();
    }
    return new Set(
      selectedPlayActions
        .map((action) => action.target_instance_id)
        .filter((id): id is CardInstanceId => id !== undefined),
    );
  }, [isTwoUnitSwapPlay, pendingPlayDraft, selectedPlayActions, selection]);

  const laneOnlyPlayActions = useMemo(
    () =>
      selectedPlayActions.filter(
        (action) =>
          action.target_instance_id === undefined &&
          action.target_position === undefined &&
          (action.target_lane !== undefined || (action.target_lanes && action.target_lanes.length > 0)),
      ),
    [selectedPlayActions],
  );

  const selectedUnitActions = useMemo(() => {
    if (!selection) {
      return {
        canWithdraw: false,
        canRecallSummon: false,
        canSkillDirect: false,
        skillTargets: new Set<CardInstanceId>(),
        skillCost: null as number | null,
        focusTargetAction: null as Extract<GameAction, { type: 'set_focus_target' }> | null,
        clearFocusAction: null as Extract<GameAction, { type: 'set_focus_target' }> | null,
      };
    }
    const canWithdraw = legal.some((action) => action.type === 'withdraw_operator' && action.card_instance_id === selection);
    const canRecallSummon = legal.some((action) => action.type === 'recall_summon' && action.card_instance_id === selection);
    const skills = legal.filter((action): action is SkillAction => action.type === 'activate_skill' && action.card_instance_id === selection);
    const focusTargetAction =
      legal.find(
        (action): action is Extract<GameAction, { type: 'set_focus_target' }> =>
          action.type === 'set_focus_target' && action.target_instance_id === selection,
      ) ?? null;
    const clearFocusAction =
      state.players[actor]?.focus_target_id === selection
        ? legal.find(
            (action): action is Extract<GameAction, { type: 'set_focus_target' }> =>
              action.type === 'set_focus_target' && action.target_instance_id === null,
          ) ?? null
        : null;
    const instance = state.card_instances[selection];
    const definition = instance ? state.card_definitions[instance.card_id] : undefined;
    return {
      canWithdraw,
      canRecallSummon,
      canSkillDirect: skills.some((action) => action.target_instance_id === undefined),
      skillTargets: new Set(skills.map((action) => action.target_instance_id).filter((id): id is CardInstanceId => id !== undefined)),
      skillCost: definition?.active_skill_sp_cost ?? null,
      focusTargetAction,
      clearFocusAction,
    };
  }, [actor, legal, selection, state]);

  const pendingResolves = useMemo(
    () => (hasPending ? legal.filter((action): action is PendingResolveAction => action.type === 'resolve_pending_choice') : []),
    [legal, hasPending],
  );
  const pendingTargets = useMemo(
    () => new Set(pendingResolves.map((action) => action.target_instance_id).filter((id): id is CardInstanceId => id !== undefined)),
    [pendingResolves],
  );
  const canSkipPending = pendingResolves.some(
    (action) => action.target_instance_id === undefined && action.choice_id === undefined,
  );

  const boardMap = useMemo(() => {
    const map = new Map<string, CardInstance>();
    for (const instance of Object.values(displayState.card_instances)) {
      if (instance.zone === 'board' && instance.board_half && instance.lane && instance.position) {
        const lane = normalizeLaneId(displayState.board_profile, instance.lane);
        const slotIdx = instance.slot_index ?? 1;
        map.set(makeSlotKey(instance.board_half, lane, instance.position, slotIdx), instance);
      }
    }
    return map;
  }, [displayState.board_profile, displayState.card_instances]);

  // 攻击范围与目标锁定预览
  const attackPreview = useMemo(() => {
    const targetSlot = dragOverSlot ?? hoveredSlot;
    if (
      activeHandCardId &&
      activeHandIsOperator &&
      targetSlot &&
      targetSlot.half === actor &&
      selectedDeployActions.some(
        (a) => a.lane === targetSlot.lane && a.position === targetSlot.position && (a.slot_index ?? 1) === targetSlot.slotIndex,
      )
    ) {
      return previewAttackTargets(state, {
        kind: 'draft',
        cardInstanceId: activeHandCardId,
        controllerId: actor,
        lane: targetSlot.lane,
        position: targetSlot.position,
        slotIndex: targetSlot.slotIndex,
      });
    }

    const focusUnitId = hoveredUnitId ?? (selection && state.card_instances[selection]?.zone === 'board' ? selection : null);
    if (focusUnitId) {
      const unit = state.card_instances[focusUnitId];
      if (unit && unit.zone === 'board') {
        return previewAttackTargets(state, { kind: 'unit', instance: unit });
      }
    }

    return null;
  }, [activeHandCardId, activeHandIsOperator, actor, dragOverSlot, hoveredSlot, hoveredUnitId, selectedDeployActions, selection, state]);

  const dispatch = async (action: GameAction, actorOverride: PlayerId = actor) => {
    if (combatAnim.isPlaying) {
      combatAnim.skipAll();
    }
    try {
      const result = onDispatch ? await onDispatch(action) : controller?.dispatch(actorOverride, action);
      if (result && !result.ok) {
        playTacticalSfx('alert');
        setError(result.reason ?? '操作不合法');
      } else {
        if (action.type === 'end_action_phase') {
          playTacticalSfx('confirm');
        }
        setSelection(null);
        setPendingPlayDraft(null);
        setHoveredCard(null);
        setPinnedPreview(null);
        setHoveredSlot(null);
        setDragOverSlot(null);
        setDraggingCardId(null);
      }
    } catch (err) {
      playTacticalSfx('alert');
      setError(err instanceof Error ? err.message : '执行操作异常');
    }
  };

  const openPinnedPreview = (instanceId: CardInstanceId, rect?: DOMRect) => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : width;
    const vh = typeof window !== 'undefined' ? window.innerHeight : height;
    const anchorRect = rect
      ? {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        }
      : {
          left: Math.round(vw / 2 - 48),
          top: Math.round(vh * 0.56),
          right: Math.round(vw / 2 + 48),
          bottom: Math.round(vh * 0.56 + 110),
          width: 96,
          height: 110,
        };
    setHoveredCard(null);
    setPinnedPreview({ instanceId, rect: anchorRect, mode: 'pinned' });
  };

  const clearNonModalSelection = () => {
    if (Date.now() - justFinishedTouchDragAtRef.current < 160) return;
    setSelection(null);
    setPendingPlayDraft(null);
    setHoveredCard(null);
    setPinnedPreview(null);
    setHoveredSlot(null);
    setHoveredUnitId(null);
  };

  const onSlotClick = (half: PlayerId, lane: LaneId, position: Position, slotIndex: number) => {
    if (Date.now() - justFinishedTouchDragAtRef.current < 160) return;
    const slotKey = makeSlotKey(half, lane, position, slotIndex);
    if (!canAct) {
      triggerSlotCue(slotKey, 'tap');
      if (selection) {
        playTacticalSfx('alert');
        setError('当前不是你的行动回合。');
      }
      return;
    }
    if (hasPending) {
      triggerSlotCue(slotKey, 'tap');
      playTacticalSfx('alert');
      setError(
        activePendingChoice?.effect === 'choose_discard'
          ? '请先从手牌中选择要弃置的卡牌。'
          : activePendingChoice?.effect === 'choose_summon'
            ? '请先选择要生成的无人机型号。'
            : '请先完成当前待决支援目标选择。',
      );
      return;
    }
    if (!isActionPhase) {
      triggerSlotCue(slotKey, 'tap');
      if (selection) {
        playTacticalSfx('alert');
        setError('只有行动阶段可以执行部署操作。');
      }
      return;
    }

    if (pendingPlayDraft && selection === pendingPlayDraft.cardId && isUnitAndLaneMovePlay && half === actor) {
      const moveAction = selectedPlayActions.find(
        (candidate) => candidate.target_instance_id === pendingPlayDraft.firstTargetId && candidate.target_lane === lane,
      );
      if (moveAction) {
        triggerSlotCue(slotKey, 'skill');
        triggerHaptic(12);
        dispatch(moveAction);
        return;
      }
    }

    const deployAction = selectedDeployActions.find(
      (candidate) => candidate.lane === lane && candidate.position === position && (candidate.slot_index ?? 1) === slotIndex,
    );
    if (deployAction) {
      triggerSlotCue(slotKey, 'deploy');
      triggerHaptic(10);
      dispatch(deployAction);
      return;
    }

    const facilityAction =
      half === actor
        ? selectedFacilityActions.find(
            (candidate) =>
              candidate.target_lane === lane &&
              candidate.target_position === position &&
              (candidate.target_slot_index ?? 1) === slotIndex,
          )
        : undefined;
    if (facilityAction) {
      triggerSlotCue(slotKey, 'deploy');
      triggerHaptic(10);
      dispatch(facilityAction);
      return;
    }

    triggerSlotCue(slotKey, 'tap');
    if (selection) {
      const selectedInst = state.card_instances[selection];
      const selectedDef = cardDefinitionOf(state, selection);
      if (selectedInst?.zone === 'hand' && selectedDef) {
        if (selectedDef.card_type === 'operator' || (selectedDef.card_type === 'support' && selectedDef.support_subtype === 'facility')) {
          const reason = getInvalidDeployReason(state, actor, selection, half, lane, position, slotIndex);
          if (reason) {
            playTacticalSfx('alert');
            setError(reason);
          }
        } else {
          playTacticalSfx('alert');
          setError('战术或装备卡请点击高亮作用单位，或使用下方指令按钮。');
        }
      }
    }
  };

  const onUnitClick = (instance: CardInstance) => {
    const unitSlotKey =
      instance.board_half && instance.lane && instance.position
        ? makeSlotKey(
            instance.board_half,
            normalizeLaneId(state.board_profile, instance.lane),
            instance.position,
            instance.slot_index ?? 1,
          )
        : null;

    if (!canAct) {
      if (unitSlotKey) triggerSlotCue(unitSlotKey, 'tap');
      playCombatSfx('select');
      setSelection(instance.card_instance_id);
      return;
    }
    const targetId = instance.card_instance_id;

    if (hasPending) {
      if (activePendingChoice?.effect === 'choose_discard') {
        if (unitSlotKey) triggerSlotCue(unitSlotKey, 'tap');
        playTacticalSfx('alert');
        setError('请点击手牌区选择要弃置的卡牌。');
        return;
      }
      if (activePendingChoice?.effect === 'choose_summon') {
        if (unitSlotKey) triggerSlotCue(unitSlotKey, 'tap');
        playTacticalSfx('alert');
        setError('请在顶部提示栏点击选择要生成的无人机型号。');
        return;
      }
      const pendingAction = pendingResolves.find((candidate) => candidate.target_instance_id === targetId);
      if (pendingAction) {
        if (unitSlotKey) triggerSlotCue(unitSlotKey, 'skill');
        dispatch(pendingAction);
      } else {
        if (unitSlotKey) triggerSlotCue(unitSlotKey, 'tap');
        playTacticalSfx('alert');
        setError('当前只能选择青色高亮的符合条件友方目标。');
      }
      return;
    }

    if (selection && pendingPlayDraft && pendingPlayDraft.cardId === selection) {
      if (isTwoUnitSwapPlay && playTargets.has(targetId)) {
        const swapAction = selectedPlayActions.find(
          (candidate) =>
            candidate.target_instance_id === pendingPlayDraft.firstTargetId &&
            candidate.secondary_target_instance_id === targetId,
        );
        if (swapAction) {
          if (unitSlotKey) triggerSlotCue(unitSlotKey, 'skill');
          triggerHaptic(12);
          dispatch(swapAction);
          return;
        }
      }
      if (isUnitAndLaneMovePlay && instance.board_half === actor && instance.lane) {
        const targetLane = normalizeLaneId(state.board_profile, instance.lane);
        const moveAction = selectedPlayActions.find(
          (candidate) =>
            candidate.target_instance_id === pendingPlayDraft.firstTargetId &&
            candidate.target_lane === targetLane,
        );
        if (moveAction) {
          if (unitSlotKey) triggerSlotCue(unitSlotKey, 'skill');
          triggerHaptic(12);
          dispatch(moveAction);
          return;
        }
      }
    }

    if (selection && playTargets.has(targetId)) {
      if (isTwoUnitSwapPlay || isUnitAndLaneMovePlay) {
        if (unitSlotKey) triggerSlotCue(unitSlotKey, 'tap');
        playCombatSfx('select');
        setPendingPlayDraft({ cardId: selection, firstTargetId: targetId });
        return;
      }
      const action = selectedPlayActions.find((candidate) => candidate.target_instance_id === targetId);
      if (action) {
        if (unitSlotKey) triggerSlotCue(unitSlotKey, 'skill');
        triggerHaptic(12);
        dispatch(action);
        return;
      }
    }

    if (selection && selectedUnitActions.skillTargets.has(targetId)) {
      const action = legal.find(
        (candidate): candidate is SkillAction =>
          candidate.type === 'activate_skill' && candidate.card_instance_id === selection && candidate.target_instance_id === targetId,
      );
      if (action) {
        if (unitSlotKey) triggerSlotCue(unitSlotKey, 'skill');
        triggerHaptic(14);
        dispatch(action);
        return;
      }
    }

    if (unitSlotKey) triggerSlotCue(unitSlotKey, 'tap');
    triggerHaptic(6);
    setPendingPlayDraft(null);
    if (selection === targetId) {
      playTacticalSfx('click');
      setSelection(null);
      if (isMobile) setShowDetail(false);
    } else {
      playCombatSfx('select');
      setSelection(targetId);
    }
  };

  const onHandCardClick = (id: CardInstanceId) => {
    setHoveredCard(null);
    if (!canAct) {
      playTacticalSfx('alert');
      setError('当前不是你的行动回合。');
      return;
    }
    if (hasPending) {
      if (activePendingChoice?.effect === 'choose_discard') {
        const discardAction = pendingResolves.find((candidate) => candidate.target_instance_id === id);
        if (discardAction) {
          triggerHaptic(10);
          dispatch(discardAction);
          return;
        }
        playTacticalSfx('alert');
        setError('请选择手牌中的有效卡牌弃置。');
        return;
      }
      playTacticalSfx('alert');
      setError('请先完成当前的支援选择。');
      return;
    }
    if (!isActionPhase) {
      playTacticalSfx('alert');
      setError('当前不在行动阶段，无法使用手牌。');
      return;
    }

    setPendingPlayDraft(null);
    if (selection === id) {
      playTacticalSfx('click');
      setSelection(null);
      if (isMobile) setShowDetail(false);
      return;
    }

    setSelection(id);
    const reason = getInvalidCardReason(state, actor, id);
    if (reason) {
      playTacticalSfx('alert');
      setError(reason);
    } else {
      playCombatSfx('select');
    }
  };

  const handleQuickSkillClick = () => {
    if (!selection) return;
    const selectedInst = state.card_instances[selection];
    const selectedSlotKey =
      selectedInst?.board_half && selectedInst.lane && selectedInst.position
        ? makeSlotKey(
            selectedInst.board_half,
            normalizeLaneId(state.board_profile, selectedInst.lane),
            selectedInst.position,
            selectedInst.slot_index ?? 1,
          )
        : null;
    if (selectedUnitActions.canSkillDirect) {
      const action = legal.find(
        (a): a is SkillAction => a.type === 'activate_skill' && a.card_instance_id === selection && a.target_instance_id === undefined,
      );
      if (action) {
        if (selectedSlotKey) triggerSlotCue(selectedSlotKey, 'skill');
        triggerHaptic(14);
        dispatch(action);
        return;
      }
    }
    if (selectedUnitActions.skillTargets.size > 0) {
      if (selectedSlotKey) triggerSlotCue(selectedSlotKey, 'tap');
      playTacticalSfx('alert');
      setError('请直接点击棋盘上青色脉冲高亮的目标单位发动技能。');
      return;
    }
    if (selectedSlotKey) triggerSlotCue(selectedSlotKey, 'tap');
    const reason = getInvalidUnitActionReason(state, actor, selection, 'activate_skill');
    playTacticalSfx('alert');
    setError(reason ?? '当前无法发动主动技能。');
  };

  const handleQuickWithdrawClick = () => {
    if (!selection) return;
    const action = legal.find(
      (a): a is WithdrawAction => a.type === 'withdraw_operator' && a.card_instance_id === selection,
    );
    if (action) {
      dispatch(action);
      return;
    }
    const reason = getInvalidUnitActionReason(state, actor, selection, 'withdraw_operator');
    playTacticalSfx('alert');
    setError(reason ?? '当前无法撤离该干员。');
  };

  const handleQuickRecallClick = () => {
    if (!selection) return;
    const action = legal.find(
      (a): a is RecallSummonAction => a.type === 'recall_summon' && a.card_instance_id === selection,
    );
    if (action) {
      dispatch(action);
      return;
    }
    const reason = getInvalidUnitActionReason(state, actor, selection, 'recall_summon');
    playTacticalSfx('alert');
    setError(reason ?? '当前无法召回该召唤物。');
  };

  const handleUnitDoubleTap = (instance: CardInstance) => {
    const unitId = instance.card_instance_id;
    const unitSlotKey =
      instance.board_half && instance.lane && instance.position
        ? makeSlotKey(
            instance.board_half,
            normalizeLaneId(state.board_profile, instance.lane),
            instance.position,
            instance.slot_index ?? 1,
          )
        : null;
    // 若刚才已有其它选中项且该单位属于可选目标，单击已触发目标作用，不重复触发技能
    if (
      selection &&
      selection !== unitId &&
      (pendingTargets.has(unitId) || playTargets.has(unitId) || selectedUnitActions.skillTargets.has(unitId))
    ) {
      return;
    }

    if (!canAct || hasPending || !isActionPhase || instance.controller_id !== actor) {
      if (unitSlotKey) triggerSlotCue(unitSlotKey, 'tap');
      setSelection(unitId);
      openPinnedPreview(unitId);
      playCombatSfx('select');
      triggerHaptic(10);
      return;
    }

    const directSkill = legal.find(
      (a): a is SkillAction =>
        a.type === 'activate_skill' && a.card_instance_id === unitId && a.target_instance_id === undefined,
    );
    if (directSkill) {
      if (unitSlotKey) triggerSlotCue(unitSlotKey, 'skill');
      triggerHaptic(14);
      void dispatch(directSkill);
      return;
    }

    const targetedSkills = legal.filter(
      (a): a is SkillAction =>
        a.type === 'activate_skill' && a.card_instance_id === unitId && a.target_instance_id !== undefined,
    );
    if (targetedSkills.length > 0) {
      if (unitSlotKey) triggerSlotCue(unitSlotKey, 'tap');
      setSelection(unitId);
      playCombatSfx('select');
      triggerHaptic(10);
      return;
    }

    if (unitSlotKey) triggerSlotCue(unitSlotKey, 'tap');
    setSelection(unitId);
    const reason = getInvalidUnitActionReason(state, actor, unitId, 'activate_skill');
    playTacticalSfx('alert');
    triggerHaptic(8);
    setError(reason ?? '当前无法发动主动技能。');
  };

  const evaluateTouchDragRef = useRef<
    (cardId: CardInstanceId, pointer: PointerPosition) => {
      aimPoint: PointerPosition;
      resolution: TouchDropResolution;
      statusText: string;
    }
  >(() => ({
    aimPoint: { x: 0, y: 0 },
    resolution: { kind: 'cancel', aimCenter: { x: 0, y: 0 } },
    statusText: '',
  }));

  evaluateTouchDragRef.current = (cardId, pointer) => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : width;
    const vh = typeof window !== 'undefined' ? window.innerHeight : height;
    const aimPoint = computeTouchAimPoint(pointer, vw, vh);
    const cardDef = cardDefinitionOf(state, cardId);
    const isFacilityCard = cardDef?.card_type === 'support' && cardDef.support_subtype === 'facility';

    const deployActionsForCard =
      canAct && isActionPhase && !hasPending
        ? legal.filter((a): a is DeployAction => a.type === 'deploy_operator' && a.card_instance_id === cardId)
        : [];
    const playActionsForCard =
      canAct && isActionPhase && !hasPending
        ? legal.filter((a): a is PlayCardAction => a.type === 'play_card' && a.card_instance_id === cardId)
        : [];
    const playTargetIds = new Set(
      playActionsForCard.map((a) => a.target_instance_id).filter((id): id is CardInstanceId => id !== undefined),
    );
    const canDirectPlay = playActionsForCard.some(
      (a) =>
        a.target_instance_id === undefined &&
        a.target_lane === undefined &&
        (!a.target_lanes || a.target_lanes.length === 0) &&
        a.target_position === undefined,
    );

    const slots: TouchDragSlotCandidate[] = [];
    for (const half of [topPlayer, bottomPlayer] as const) {
      for (const laneProfile of sortedLanes(state.board_profile)) {
        const lane = laneProfile.laneId;
        for (const position of ['front', 'back'] as const) {
          const count = slotCountForRow(laneProfile, position);
          for (let slotIndex = 1; slotIndex <= count; slotIndex += 1) {
            const slotKey = makeSlotKey(half, lane, position, slotIndex);
            const el = slotElRefs.current[slotKey];
            if (!el) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            const unit = boardMap.get(slotKey);
            const isValidDeploy =
              half === actor &&
              !unit &&
              (deployActionsForCard.some((a) => a.lane === lane && a.position === position && (a.slot_index ?? 1) === slotIndex) ||
                playActionsForCard.some(
                  (a) => a.target_lane === lane && a.target_position === position && (a.target_slot_index ?? 1) === slotIndex,
                ));
            const isValidUnitTarget = Boolean(unit && playTargetIds.has(unit.card_instance_id));
            slots.push({
              key: slotKey,
              half,
              lane,
              position,
              slotIndex,
              rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
              isValidDeploy,
              unitId: unit?.card_instance_id,
              isValidUnitTarget,
            });
          }
        }
      }
    }

    const boardElRect = boardGridRef.current?.getBoundingClientRect();
    const boardRect = boardElRect
      ? {
          left: boardElRect.left,
          top: boardElRect.top,
          right: boardElRect.right,
          bottom: boardElRect.bottom,
        }
      : null;

    const resolution = resolveTouchDropTarget({
      aimPoint,
      slots,
      boardRect,
      canDirectPlay,
    });

    let statusText = '松手返回手牌区（取消操作）';
    if (resolution.kind === 'slot') {
      if (resolution.slot.isValidDeploy) {
        const cellLabel = formatCellLabel(
          state.board_profile,
          resolution.slot.lane,
          resolution.slot.position,
          resolution.slot.slotIndex ?? 1,
        );
        statusText = `松手部署${isFacilityCard ? '设施' : ''} · ${cellLabel} (-${cardDef?.cost ?? 0} CP)`;
      } else {
        const targetDef = resolution.slot.unitId ? cardDefinitionOf(state, resolution.slot.unitId) : undefined;
        statusText = `松手施放 · 目标【${targetDef?.card_name_zh ?? '单位'}】`;
      }
    } else if (resolution.kind === 'direct_play') {
      statusText = `松手直接施放 · ${cardDef?.card_name_zh ?? '战术指令'} (-${cardDef?.cost ?? 0} CP)`;
    } else if (resolution.kind === 'invalid_slot') {
      if (cardDef?.card_type === 'operator' || isFacilityCard) {
        statusText =
          getInvalidDeployReason(
            state,
            actor,
            cardId,
            resolution.slot.half,
            resolution.slot.lane,
            resolution.slot.position,
            resolution.slot.slotIndex ?? 1,
          ) ?? '所选格位不可部署';
      } else {
        statusText = getInvalidCardReason(state, actor, cardId) ?? '该目标无法使用此卡牌';
      }
    }

    return { aimPoint, resolution, statusText };
  };

  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const legalRef = useRef(legal);
  legalRef.current = legal;

  const handleTouchStartCardCandidate = (
    cardId: CardInstanceId,
    e: React.PointerEvent<HTMLDivElement>,
    layoutMode: TouchDragLayoutMode,
  ) => {
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    if (!canAct || !isActionPhase || hasPending) return;

    cancelPendingTouchCandidate();
    const pointerId = e.pointerId;
    const start: PointerPosition = { x: e.clientX, y: e.clientY };
    touchCandidateRef.current = { cardId, pointerId, start, layoutMode, active: false };

    const cleanup = () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerCancel);
      touchCleanupRef.current = null;
      touchCandidateRef.current = null;
      lastSnappedSlotKeyRef.current = null;
    };

    const syncDragFrame = (pointer: PointerPosition) => {
      const candidate = touchCandidateRef.current;
      if (!candidate) return;
      const evaluated = evaluateTouchDragRef.current(candidate.cardId, pointer);
      setTouchDragState({
        cardId: candidate.cardId,
        pointerId: candidate.pointerId,
        pointer,
        aimPoint: evaluated.aimPoint,
        resolution: evaluated.resolution,
        statusText: evaluated.statusText,
        layoutMode: candidate.layoutMode,
      });

      if (evaluated.resolution.kind === 'slot' || evaluated.resolution.kind === 'invalid_slot') {
        const s = evaluated.resolution.slot;
        setDragOverSlot({ half: s.half, lane: s.lane, position: s.position, slotIndex: s.slotIndex ?? 1 });
        const nextSnapKey = evaluated.resolution.kind === 'slot' ? s.key : null;
        if (nextSnapKey && nextSnapKey !== lastSnappedSlotKeyRef.current) {
          triggerHaptic(6);
        }
        lastSnappedSlotKeyRef.current = nextSnapKey;
      } else {
        setDragOverSlot(null);
        lastSnappedSlotKeyRef.current = null;
      }
    };

    const onWindowPointerMove = (moveEv: PointerEvent) => {
      const candidate = touchCandidateRef.current;
      if (!candidate || moveEv.pointerId !== candidate.pointerId) return;
      const current: PointerPosition = { x: moveEv.clientX, y: moveEv.clientY };

      if (!candidate.active) {
        const intent = detectTouchDragIntent({
          start: candidate.start,
          current,
          layoutMode: candidate.layoutMode,
        });
        if (intent === 'pending') return;
        if (intent === 'scroll') {
          cleanup();
          return;
        }
        candidate.active = true;
        setHoveredCard(null);
        setDraggingCardId(candidate.cardId);
        setSelection(candidate.cardId);
        setPendingPlayDraft(null);
        playCombatSfx('select');
        triggerHaptic(8);
      }

      if (moveEv.cancelable) {
        moveEv.preventDefault();
      }
      syncDragFrame(current);
    };

    const finishDrag = (endEv: PointerEvent, cancelled: boolean) => {
      const candidate = touchCandidateRef.current;
      if (!candidate || endEv.pointerId !== candidate.pointerId) return;
      const wasActive = candidate.active;
      const draggedCardId = candidate.cardId;
      cleanup();

      if (!wasActive) return;

      justFinishedTouchDragAtRef.current = Date.now();
      setDraggingCardId(null);
      setDragOverSlot(null);
      setTouchDragState(null);

      if (cancelled) {
        playTacticalSfx('click');
        return;
      }

      const dropPointer: PointerPosition = { x: endEv.clientX, y: endEv.clientY };
      const evaluated = evaluateTouchDragRef.current(draggedCardId, dropPointer);
      const currentLegal = legalRef.current;

      if (evaluated.resolution.kind === 'slot') {
        const slot = evaluated.resolution.slot;
        const targetSlotIdx = slot.slotIndex ?? 1;
        if (slot.isValidDeploy) {
          const deployAction = currentLegal.find(
            (a): a is DeployAction =>
              a.type === 'deploy_operator' &&
              a.card_instance_id === draggedCardId &&
              a.lane === slot.lane &&
              a.position === slot.position &&
              (a.slot_index ?? 1) === targetSlotIdx,
          );
          if (deployAction) {
            triggerHaptic(14);
            void dispatchRef.current(deployAction);
            return;
          }
          const facilityAction = currentLegal.find(
            (a): a is PlayCardAction =>
              a.type === 'play_card' &&
              a.card_instance_id === draggedCardId &&
              a.target_lane === slot.lane &&
              a.target_position === slot.position &&
              (a.target_slot_index ?? 1) === targetSlotIdx,
          );
          if (facilityAction) {
            triggerHaptic(14);
            void dispatchRef.current(facilityAction);
            return;
          }
        } else if (slot.isValidUnitTarget && slot.unitId) {
          const matchingPlays = currentLegal.filter(
            (a): a is PlayCardAction =>
              a.type === 'play_card' &&
              a.card_instance_id === draggedCardId &&
              a.target_instance_id === slot.unitId,
          );
          const needsSecondStep = matchingPlays.some(
            (a) => a.secondary_target_instance_id !== undefined || (a.target_lane !== undefined && a.target_position === undefined),
          );
          if (needsSecondStep) {
            setSelection(draggedCardId);
            setPendingPlayDraft({ cardId: draggedCardId, firstTargetId: slot.unitId });
            playCombatSfx('select');
            triggerHaptic(10);
            return;
          }
          const action = matchingPlays[0];
          if (action) {
            triggerHaptic(14);
            void dispatchRef.current(action);
            return;
          }
        }
      } else if (evaluated.resolution.kind === 'direct_play') {
        const action = currentLegal.find(
          (a): a is PlayCardAction =>
            a.type === 'play_card' &&
            a.card_instance_id === draggedCardId &&
            a.target_instance_id === undefined &&
            a.target_lane === undefined &&
            (!a.target_lanes || a.target_lanes.length === 0) &&
            a.target_position === undefined,
        );
        if (action) {
          triggerHaptic(14);
          void dispatchRef.current(action);
          return;
        }
      } else if (evaluated.resolution.kind === 'invalid_slot') {
        playTacticalSfx('alert');
        triggerHaptic(10);
        setError(evaluated.statusText);
        return;
      }

      playTacticalSfx('click');
    };

    const onWindowPointerUp = (upEv: PointerEvent) => finishDrag(upEv, false);
    const onWindowPointerCancel = (cancelEv: PointerEvent) => finishDrag(cancelEv, true);

    touchCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onWindowPointerMove, { passive: false });
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerCancel);
  };

  const selectedInstance = selection ? state.card_instances[selection] : undefined;
  const selectedDefinition = selection ? cardDefinitionOf(state, selection) : undefined;
  const activePreview = pinnedPreview ?? hoveredCard;
  const activePreviewInvalidReason = useMemo(() => {
    if (!activePreview || !isActionPhase || hasPending || !canAct || bottomPlayer !== actor) return null;
    const previewInst = state.card_instances[activePreview.instanceId];
    if (!previewInst || previewInst.zone !== 'hand') return null;
    return getInvalidCardReason(state, actor, activePreview.instanceId);
  }, [activePreview, actor, bottomPlayer, canAct, hasPending, isActionPhase, state]);

  const attackPreviewTargetName = attackPreview?.primaryTargetId
    ? cardDefinitionOf(state, attackPreview.primaryTargetId)?.card_name_zh ?? attackPreview.primaryTargetId
    : null;

  const renderSlot = (half: PlayerId, lane: LaneId, position: Position, slotIndex: number, rowSlotCount: number) => {
    const slotKey = makeSlotKey(half, lane, position, slotIndex);
    const key = slotKey;
    const instance = boardMap.get(key);
    const isDeployTarget =
      half === actor &&
      isActionPhase &&
      canAct &&
      !hasPending &&
      (selectedDeployActions.some(
        (action) => action.lane === lane && action.position === position && (action.slot_index ?? 1) === slotIndex,
      ) ||
        selectedFacilityActions.some(
          (action) =>
            action.target_lane === lane &&
            action.target_position === position &&
            (action.target_slot_index ?? 1) === slotIndex,
        ));
    const isEnemy = half === topPlayer;
    const localTag = rowSlotCount > 1 ? getDisplaySlotLabel(position, slotIndex) : '';
    const basePosName = isEnemy ? (position === 'front' ? '敌前锋' : '敌后排') : position === 'front' ? '我前锋' : '我后卫';
    const posName = localTag ? `${basePosName} ${localTag}` : basePosName;
    const laneLabel = formatLaneLabelZh(displayState.board_profile, lane);

    const isSlotHovered =
      (hoveredSlot?.half === half &&
        hoveredSlot.lane === lane &&
        hoveredSlot.position === position &&
        hoveredSlot.slotIndex === slotIndex) ||
      (dragOverSlot?.half === half &&
        dragOverSlot.lane === lane &&
        dragOverSlot.position === position &&
        dragOverSlot.slotIndex === slotIndex);

    const isAttackLaneCell = Boolean(
      attackPreview?.laneSlots.some(
        (slot) => slot.half === half && slot.lane === lane && slot.position === position,
      ),
    );

    const slotPopups = activeBeat?.floatingPopups.filter((p) => p.slotKey === slotKey) ?? [];
    const slotGhost = activeBeat?.ghostCues.find((g) => g.slotKey === slotKey);
    const isDeployedSlot = Boolean(activeBeat?.deployedSlots.includes(slotKey));

    if (!instance) {
      const slotInvalidReason =
        isSlotHovered &&
        !isDeployTarget &&
        activeHandCardId &&
        (activeHandIsOperator || activeHandIsFacility) &&
        isActionPhase &&
        canAct &&
        !hasPending
          ? getInvalidDeployReason(state, actor, activeHandCardId, half, lane, position, slotIndex)
          : null;

      const isTouchLockedSlot = Boolean(
        touchDragState &&
          touchDragState.resolution.kind === 'slot' &&
          touchDragState.resolution.slot.key === slotKey &&
          touchDragState.resolution.slot.isValidDeploy,
      );

      const isSlotTapped = !combatAnim.effectiveDisabled && slotTapCue?.slotKey === slotKey;

      return (
        <div
          key={key}
          ref={(el) => {
            slotElRefs.current[slotKey] = el;
          }}
          role="button"
          tabIndex={isDeployTarget ? 0 : -1}
          aria-label={`${laneLabel}${posName}${isDeployTarget ? ' 可部署' : ''}`}
          data-tap-cue={isSlotTapped ? slotTapCue.kind : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onSlotClick(half, lane, position, slotIndex);
          }}
          onKeyDown={(e) => {
            if (!isDeployTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onSlotClick(half, lane, position, slotIndex);
            }
          }}
          onMouseEnter={() => {
            if (!isMobile) setHoveredSlot({ half, lane, position, slotIndex });
          }}
          onMouseLeave={() => {
            setHoveredSlot((prev) =>
              prev && prev.half === half && prev.lane === lane && prev.position === position && prev.slotIndex === slotIndex
                ? null
                : prev,
            );
          }}
          onDragOver={(e) => {
            if (!draggingCardId || !isActionPhase || !canAct || hasPending) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = isDeployTarget ? 'move' : 'none';
            setDragOverSlot({ half, lane, position, slotIndex });
          }}
          onDragLeave={() => {
            setDragOverSlot((prev) =>
              prev && prev.half === half && prev.lane === lane && prev.position === position && prev.slotIndex === slotIndex
                ? null
                : prev,
            );
          }}
          onDrop={(e) => {
            if (!draggingCardId) return;
            e.preventDefault();
            e.stopPropagation();
            const cardId = draggingCardId;
            setDragOverSlot(null);
            setDraggingCardId(null);
            if (!isActionPhase || !canAct || hasPending) return;
            const deployAction = legal.find(
              (a): a is DeployAction =>
                a.type === 'deploy_operator' &&
                a.card_instance_id === cardId &&
                a.lane === lane &&
                a.position === position &&
                (a.slot_index ?? 1) === slotIndex,
            );
            if (deployAction) {
              dispatch(deployAction);
              return;
            }
            const facilityAction =
              half === actor
                ? legal.find(
                    (a): a is PlayCardAction =>
                      a.type === 'play_card' &&
                      a.card_instance_id === cardId &&
                      a.target_lane === lane &&
                      a.target_position === position &&
                      (a.target_slot_index ?? 1) === slotIndex,
                  )
                : undefined;
            if (facilityAction) {
              dispatch(facilityAction);
              return;
            }
            const reason = getInvalidDeployReason(state, actor, cardId, half, lane, position, slotIndex);
            if (reason) {
              playTacticalSfx('alert');
              setError(reason);
            }
          }}
          className={`group relative min-w-0 select-none focus-visible:outline-none ${
            useCompactBoard ? 'h-[54px]' : 'h-[58px] sm:h-[70px] lg:h-[82px]'
          } ${isSlotTapped ? 'anim-cell-hit-shake' : ''} ${
            isDeployTarget
              ? isTouchLockedSlot
                ? 'cursor-pointer z-20'
                : 'cursor-pointer'
              : slotInvalidReason
                ? 'cursor-not-allowed'
                : ''
          }`}
        >
          <div
            className={`board-slot-shell w-full h-full transition-colors duration-150 ${
              isDeployTarget
                ? isTouchLockedSlot
                  ? 'bg-[#f5b436]'
                  : isSlotHovered
                    ? 'bg-[#e5a52b]'
                    : 'bg-[#e5a52b]/85'
                : slotInvalidReason
                  ? 'bg-rose-500/75'
                  : isAttackLaneCell
                    ? 'bg-rose-500/70'
                    : isEnemy
                      ? 'bg-[#353d4a] group-hover:bg-rose-400/70'
                      : 'bg-[#334052] group-hover:bg-sky-400/75'
            }`}
          >
            <div className="board-slot relative overflow-hidden flex items-center justify-center w-full h-full">
              {/* 极简工业部署平台微弱蚀刻底纹 */}
              <img
                src={isEnemy ? deployPadEnemyArt : deployPadAllyArt}
                alt=""
                aria-hidden="true"
                referrerPolicy="no-referrer"
                data-testid={`deploy-pad-${isEnemy ? 'enemy' : 'ally'}`}
                className={`pointer-events-none select-none absolute inset-0 w-full h-full object-cover grayscale contrast-125 transition-opacity duration-150 ${
                  isDeployTarget
                    ? 'opacity-[0.16]'
                    : isAttackLaneCell
                      ? 'opacity-[0.12]'
                      : 'opacity-[0.06] group-hover:opacity-[0.12]'
                }`}
              />
              {/* 极简硬朗侧边索引线 */}
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute left-0 top-1 bottom-1 w-[2px] ${
                  isDeployTarget
                    ? 'bg-[#e5a52b]'
                    : slotInvalidReason
                      ? 'bg-rose-500/70'
                      : isAttackLaneCell
                        ? 'bg-rose-400/75'
                        : isEnemy
                          ? 'bg-rose-400/45'
                          : 'bg-sky-400/45'
                }`}
              />
              {isSlotTapped && (
                <div
                  key={`slot-tap-${slotTapCue.seq}`}
                  aria-hidden="true"
                  className="absolute inset-0 border border-[#e5a52b]/80 bg-[#e5a52b]/12 pointer-events-none z-25 anim-slot-flash"
                />
              )}
              <div className="relative z-10 flex flex-col items-center justify-center w-full px-1">
              {isDeployTarget ? (
                <div className="flex flex-col items-center gap-0.5 text-[#e5a52b] font-bold text-[10px] sm:text-xs tracking-wider text-center px-1">
                  <span className="truncate max-w-full">
                    {isTouchLockedSlot
                      ? '✓ 释放部署'
                      : isSlotHovered && activeHandDef
                        ? `✓ 部署 ${activeHandDef.card_name_zh}`
                        : '+ 部署'}
                  </span>
                  <span className="text-[8px] sm:text-[10px] font-mono">
                    {(isTouchLockedSlot || isSlotHovered) && activeHandDef
                      ? `-${activeHandDef.cost} CP · ${posName}`
                      : posName}
                  </span>
                </div>
              ) : slotInvalidReason ? (
                <div className="flex flex-col items-center gap-0.5 text-rose-300 font-bold text-[10px] text-center px-1">
                  <span>✕ 不可部署</span>
                  <span className="text-[9px] font-normal text-rose-200/90 line-clamp-1">{slotInvalidReason}</span>
                </div>
              ) : isAttackLaneCell ? (
                <div className="flex flex-col items-center gap-0.5 text-rose-300/90 font-mono text-[9px] sm:text-[10px]">
                  <span>⚔ 攻击航道</span>
                  <span className="text-[8px] text-rose-400/80">{posName}</span>
                </div>
              ) : (
                <span className={`text-[9px] sm:text-[10px] font-mono tracking-[0.14em] ${isEnemy ? 'text-rose-200/60' : 'text-sky-200/60'}`}>
                  {posName}
                </span>
              )}
              </div>

              {/* Phase 6: 阵亡 / 撤离残影徽标（零阻挡指针事件） */}
              {!combatAnim.effectiveDisabled && slotGhost && (
                <div
                  aria-hidden="true"
                  className={`absolute inset-1 flex items-center justify-center border pointer-events-none z-30 anim-ghost-fade ${
                    slotGhost.kind === 'defeat'
                      ? 'bg-rose-950/85 border-rose-500/80 text-rose-200'
                      : 'bg-emerald-950/85 border-emerald-500/80 text-emerald-200'
                  }`}
                >
                  <span className="font-mono font-bold text-[10px] px-1 truncate">
                    {slotGhost.kind === 'defeat' ? `💀 ${slotGhost.name} 退场` : `🏃 ${slotGhost.name} 撤离`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {!combatAnim.effectiveDisabled && slotPopups.length > 0 && (
            <div
              aria-hidden="true"
              className="absolute inset-x-0 -top-1 flex flex-col items-center gap-0.5 pointer-events-none z-40"
            >
              {slotPopups.slice(0, 2).map((popup) => (
                <span
                  key={popup.id}
                  className={`px-1.5 py-0.2 border font-mono font-black text-[11px] leading-tight whitespace-nowrap anim-float-number ${SLOT_POPUP_STYLE[popup.kind]}`}
                >
                  {popup.label}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }

    let highlight: UnitHighlight = 'none';
    if (
      pendingTargets.has(instance.card_instance_id) ||
      playTargets.has(instance.card_instance_id) ||
      selectedUnitActions.skillTargets.has(instance.card_instance_id)
    ) {
      highlight = 'target';
    } else if (
      selection === instance.card_instance_id ||
      pendingPlayDraft?.firstTargetId === instance.card_instance_id
    ) {
      highlight = 'selected';
    } else if (
      attackPreview?.primaryTargetId === instance.card_instance_id ||
      attackPreview?.targetIds.includes(instance.card_instance_id)
    ) {
      highlight = 'attack_target';
    }

    const unitAnimState: UnitAnimationState = {
      deployed: Boolean(activeBeat?.deployedUnits[instance.card_instance_id] || isDeployedSlot),
      hit: Boolean(activeBeat?.hitUnits[instance.card_instance_id]),
      attackDirection: activeBeat?.attackingUnits[instance.card_instance_id] ?? null,
      skillFlash: Boolean(activeBeat?.skillUnits[instance.card_instance_id]),
      floatingPopups: slotPopups,
      disableMotion: combatAnim.effectiveDisabled,
    };

    const canActivateUnitSkill =
      instance.controller_id === actor &&
      isActionPhase &&
      canAct &&
      !hasPending &&
      legal.some(
        (a) => a.type === 'activate_skill' && a.card_instance_id === instance.card_instance_id,
      );
    const isUnitDragLocked = Boolean(
      touchDragState &&
        touchDragState.resolution.kind === 'slot' &&
        touchDragState.resolution.slot.key === slotKey &&
        touchDragState.resolution.slot.isValidUnitTarget,
    );

    const unitTapCue =
      !combatAnim.effectiveDisabled && slotTapCue?.slotKey === slotKey
        ? { kind: slotTapCue.kind, seq: slotTapCue.seq }
        : null;
    const isSkillWaveActive =
      !combatAnim.effectiveDisabled &&
      (Boolean(activeBeat?.skillUnits[instance.card_instance_id]) || unitTapCue?.kind === 'skill');

    return (
      <div
        key={instance.card_instance_id}
        ref={(el) => {
          slotElRefs.current[slotKey] = el;
        }}
        className="relative min-w-0"
      >
        <UnitView
          state={displayState}
          instance={instance}
          highlight={highlight}
          compact={useCompactBoard}
          canActivateSkill={canActivateUnitSkill}
          isFocusTarget={displayState.players[actor]?.focus_target_id === instance.card_instance_id}
          isDragLocked={isUnitDragLocked}
          animState={unitAnimState}
          tapCue={unitTapCue}
          onClick={() => onUnitClick(instance)}
          onDoubleTap={() => handleUnitDoubleTap(instance)}
          onLongPress={(rect) => {
            cancelPendingTouchCandidate();
            openPinnedPreview(instance.card_instance_id, rect);
          }}
          onHoverStart={(rect) => {
            if (!draggingCardId && !touchDragState) {
              setHoveredUnitId(instance.card_instance_id);
              setHoveredCard({ instanceId: instance.card_instance_id, rect });
            }
          }}
          onHoverEnd={() => {
            setHoveredUnitId((prev) => (prev === instance.card_instance_id ? null : prev));
            setHoveredCard((prev) => (prev?.instanceId === instance.card_instance_id ? null : prev));
          }}
        />
        {!combatAnim.effectiveDisabled && isDeployedSlot && (
          <div
            aria-hidden="true"
            className="absolute inset-0 border border-[#e5a52b] pointer-events-none z-30 anim-slot-flash"
          />
        )}
        {isSkillWaveActive && (
          <div
            key={`wave-${unitTapCue?.seq ?? activeBeat?.id ?? 'skill'}`}
            aria-hidden="true"
            className="absolute -inset-[2px] border border-cyan-300/85 pointer-events-none z-30 anim-skill-wave"
          />
        )}
      </div>
    );
  };

  const canQuickActOnSelectedUnit = Boolean(
    selectedInstance?.zone === 'board' &&
      selectedInstance.controller_id === actor &&
      isActionPhase &&
      canAct &&
      !hasPending,
  );
  const selectedEntityKind = selectedInstance ? getEntityKind(state, selectedInstance) : null;
  const directPlayAction =
    selectedInstance?.zone === 'hand' && canAct && isActionPhase && !hasPending
      ? selectedPlayActions.find(
          (a) =>
            a.target_instance_id === undefined &&
            a.target_lane === undefined &&
            (!a.target_lanes || a.target_lanes.length === 0) &&
            a.target_position === undefined,
        )
      : undefined;

  const moveDraftLaneActions =
    pendingPlayDraft && selection === pendingPlayDraft.cardId && isUnitAndLaneMovePlay
      ? selectedPlayActions.filter((a) => a.target_instance_id === pendingPlayDraft.firstTargetId && a.target_lane !== undefined)
      : [];

  const selectionPromptContent =
    selectedInstance || attackPreview ? (
      <>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="w-1.5 h-3.5 bg-[#e5a52b] shrink-0" />
          {selectedInstance ? (
            <span className="truncate text-[11px] sm:text-xs">
              <strong>{selectedDefinition?.card_name_zh}</strong>
              {selectedInstance.zone === 'hand' ? (
                selectedDeployActions.length > 0 || selectedFacilityActions.length > 0 ? (
                  <span className="text-slate-200">
                    {' '}· {isMobile ? (useSideRail ? '左拖或点黄格部署' : '上拖或点黄格部署') : '点黄格部署'}
                    {activeHandIsFacility ? '设施' : ''}（{selectedDefinition?.cost ?? 0} CP）
                  </span>
                ) : selectedPlayActions.length > 0 ? (
                  <span className="text-cyan-300">
                    {pendingPlayDraft && isTwoUnitSwapPlay
                      ? ' · 请点击第二名友方干员完成位置交换'
                      : pendingPlayDraft && isUnitAndLaneMovePlay
                        ? ' · 请选择目标相邻路线完成移位'
                        : isTwoUnitSwapPlay
                          ? ' · 点击首位友方干员（两步换位）'
                          : isUnitAndLaneMovePlay
                            ? ' · 点击要移动的友方干员'
                            : laneOnlyPlayActions.length > 0
                              ? ' · 请选择目标路线生效'
                              : directPlayAction
                                ? isMobile
                                  ? ' · 拖入棋盘或点下方直接使用'
                                  : ' · 可直接使用此卡牌'
                                : isMobile
                                  ? ' · 拖向目标或点击青色高亮单位发动'
                                  : ' · 点击青色高亮目标发动'}
                  </span>
                ) : (
                  <span className="text-rose-300">
                    {' '}· {getInvalidCardReason(state, actor, selectedInstance.card_instance_id) ?? '当前无法使用'}
                  </span>
                )
              ) : attackPreview ? (
                <span className="text-slate-200">
                  {' '}· ⚔ 预计攻击：
                  {attackPreviewTargetName ? (
                    <strong className="text-rose-300">
                      {attackPreview.tauntBlocked ? `【${attackPreviewTargetName}】(嘲讽)` : `【${attackPreviewTargetName}】`}
                    </strong>
                  ) : (
                    <strong className="text-rose-300">对方基地</strong>
                  )}
                  {attackPreview.cannotAttackReason && (
                    <span className="text-slate-400 ml-1.5">({attackPreview.cannotAttackReason})</span>
                  )}
                  {canQuickActOnSelectedUnit && selectedUnitActions.canSkillDirect && (
                    <span className="text-amber-300 ml-1.5">· ⚡双击可发动技能</span>
                  )}
                  {canQuickActOnSelectedUnit && selectedUnitActions.skillTargets.size > 0 && (
                    <span className="text-cyan-300 ml-1.5">· ⚡点青格目标发动技能</span>
                  )}
                </span>
              ) : (
                <span className="text-slate-300">
                  {' '}·{' '}
                  {selectedEntityKind === 'facility'
                    ? isMobile
                      ? '场地设施（长按看详情）'
                      : '场地设施（悬停或右侧查看档案）'
                    : isMobile
                      ? '战场单位（长按看详情）'
                      : '战场单位（悬停或右侧查看档案）'}
                </span>
              )}
            </span>
          ) : (
            attackPreview && (
              <span className="truncate text-[11px] sm:text-xs text-slate-200">
                ⚔ 索敌预演：
                {attackPreviewTargetName ? (
                  <strong className="text-rose-300">
                    {attackPreview.tauntBlocked ? `【${attackPreviewTargetName}】(嘲讽拦截)` : `【${attackPreviewTargetName}】`}
                  </strong>
                ) : (
                  <strong className="text-rose-300">对方基地</strong>
                )}
                {attackPreview.cannotAttackReason && (
                  <span className="text-slate-400 ml-1.5">· {attackPreview.cannotAttackReason}</span>
                )}
              </span>
            )
          )}
        </div>

        {selectedInstance && (
          <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
            {moveDraftLaneActions.map((moveAct) => (
              <Button
                key={`move-${moveAct.target_lane}`}
                variant="primary"
                size="sm"
                onClick={() => dispatch(moveAct)}
                className="px-2 py-0.5 text-[10px] min-h-[28px] sm:min-h-[26px] font-bold"
              >
                → 移至{formatLaneLabelZh(state.board_profile, moveAct.target_lane ?? null)}
              </Button>
            ))}
            {laneOnlyPlayActions.map((laneAct, idx) => {
              const label = laneAct.target_lanes
                ? laneAct.target_lanes.map((l) => formatLaneLabelZh(state.board_profile, l)).join('+')
                : formatLaneLabelZh(state.board_profile, laneAct.target_lane ?? null);
              return (
                <Button
                  key={`lane-${idx}-${label}`}
                  variant="primary"
                  size="sm"
                  onClick={() => dispatch(laneAct)}
                  className="px-2 py-0.5 text-[10px] min-h-[28px] sm:min-h-[26px] font-bold"
                >
                  ⚡ {label}
                </Button>
              );
            })}
            {directPlayAction && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => dispatch(directPlayAction)}
                className="px-2.5 py-0.5 text-[10px] min-h-[28px] sm:min-h-[26px] font-bold"
              >
                ⚡ 直接使用
              </Button>
            )}
            {selectedUnitActions.focusTargetAction && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => dispatch(selectedUnitActions.focusTargetAction!)}
                className="px-2 py-0.5 text-[10px] min-h-[28px] sm:min-h-[26px] font-bold"
              >
                🎯 集火锁定
              </Button>
            )}
            {selectedUnitActions.clearFocusAction && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => dispatch(selectedUnitActions.clearFocusAction!)}
                className="px-2 py-0.5 text-[10px] min-h-[28px] sm:min-h-[26px]"
              >
                取消集火
              </Button>
            )}
            {canQuickActOnSelectedUnit && selectedDefinition?.effect_trigger === 'active' && selectedEntityKind === 'operator' && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleQuickSkillClick}
                className="px-2.5 py-0.5 text-[10px] min-h-[28px] sm:min-h-[26px]"
              >
                ⚡ 技能
              </Button>
            )}
            {canQuickActOnSelectedUnit && selectedUnitActions.canWithdraw && (
              <Button
                variant="danger"
                size="sm"
                onClick={handleQuickWithdrawClick}
                className="px-2.5 py-0.5 text-[10px] min-h-[28px] sm:min-h-[26px]"
              >
                ↩ 撤离(0CP)
              </Button>
            )}
            {canQuickActOnSelectedUnit && selectedUnitActions.canRecallSummon && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleQuickRecallClick}
                className="px-2.5 py-0.5 text-[10px] min-h-[28px] sm:min-h-[26px]"
              >
                ↩ 召回
              </Button>
            )}
            {isMobile && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openPinnedPreview(selectedInstance.card_instance_id)}
                className="px-2.5 py-0.5 text-[10px] min-h-[28px] sm:min-h-[26px]"
              >
                🔍 卡牌详情
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                playTacticalSfx('click');
                setPendingPlayDraft(null);
                setSelection(null);
              }}
              className="text-slate-400 hover:text-white px-2 py-0.5 text-[10px] min-h-[28px] sm:min-h-[26px]"
            >
              ✕ 取消
            </Button>
          </div>
        )}
      </>
    ) : null;

  return (
    <div
      className="grid grid-rows-[auto_auto_minmax(0,1fr)] h-[100dvh] w-full bg-[#0d1016] text-[#e8e9e6] font-sans overflow-hidden select-none"
      style={{ '--combat-anim-scale': String(combatAnim.cssAnimScale) } as React.CSSProperties}
    >
      {/* 1. 顶部敌方阵地与战局控制 HUD */}
      <TacticalBattleHud
        state={displayState}
        actor={actor}
        bottomPlayer={bottomPlayer}
        topPlayer={topPlayer}
        hasPending={hasPending}
        isHotseat={isHotseat}
        networkStatus={networkStatus}
        seed={controller?.getSetup().seed}
        showLog={showLog}
        onToggleLog={() => setShowLog((prev) => !prev)}
        showDetail={isMobile ? Boolean(pinnedPreview) : showDetail}
        onToggleDetail={() => {
          if (!isMobile) {
            setShowDetail((prev) => !prev);
            return;
          }
          if (pinnedPreview) {
            setPinnedPreview(null);
          } else if (selection) {
            openPinnedPreview(selection);
          } else {
            setError('长按任意手牌或单位即可放大查看卡牌与词条');
          }
        }}
        onSurrender={canSurrender ? () => setConfirmDialog('surrender') : undefined}
        onExit={effectiveOnExit ? () => setConfirmDialog('exit') : undefined}
        animSpeedMode={combatAnim.speedMode}
        onCycleAnimSpeed={combatAnim.cycleSpeedMode}
        activeAnimPhase={activeBeat?.phase ?? null}
        enemyBaseDamageDelta={activeBeat?.baseDamage.enemy ?? null}
        disableMotion={combatAnim.effectiveDisabled}
        onOpenSettings={onOpenSettings}
      />

      {/* 2. 系统提示与待决响应横幅区（无提示时自动折叠为 0px） */}
      <div className="shrink-0">

        {networkStatus?.pausedForGuest && (
          <div className="px-4 py-1.5 bg-amber-950/90 border-b border-amber-500/60 text-amber-300 text-xs flex items-center justify-center gap-2">
            <span>⏸️ 访客网络已断开，对局已自动暂停，等待重连（宽限期 120 秒）…</span>
          </div>
        )}

        {hasPending && activePendingChoice && (
          <div className="px-3 sm:px-4 py-1.5 bg-[#1a2332] border-b border-[#3b4c66] flex flex-wrap items-center justify-between gap-2 text-xs text-slate-200">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-cyan-400" />
              <span className="text-[11px] sm:text-xs">
                {activePendingChoice.effect === 'choose_summon'
                  ? '待决抉择：请选择麦哲伦召唤的无人机型号'
                  : activePendingChoice.effect === 'choose_discard'
                    ? `待决抉择：请从下方手牌点击选择要弃置的卡牌（需弃 ${activePendingChoice.amount} 张）`
                    : activePendingChoice.effect === 'grant_front_shield'
                      ? `回合支援：点击青色高亮前排友方干员获得 +${activePendingChoice.amount} 护盾`
                      : activePendingChoice.effect === 'grant_front_cover'
                        ? '回合支援：点击青色高亮前排友方干员获得 掩护'
                        : `回合支援：点击青色高亮友方干员充能 +${activePendingChoice.amount} SP`}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {activePendingChoice.effect === 'choose_summon' &&
                canAct &&
                pendingResolves
                  .filter((act) => act.choice_id)
                  .map((act) => (
                    <Button
                      key={act.choice_id}
                      variant="primary"
                      size="sm"
                      onClick={() => dispatch(act)}
                      className="text-[11px] px-2.5 py-0.5 font-bold"
                    >
                      {SUMMON_OPTION_LABELS[act.choice_id!] ?? act.choice_id}
                    </Button>
                  ))}
              {canSkipPending && canAct && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    dispatch({
                      type: 'resolve_pending_choice',
                      source_instance_id: activePendingChoice.source_instance_id,
                    })
                  }
                  className="text-[11px] px-2 py-0.5"
                >
                  跳过选择
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 3. 核心三栏桌面工作区 / 移动端自适应战场 */}
      <div className="flex min-h-0 overflow-hidden relative">
        {!isMobile && showLog && (
          <aside className="w-68 xl:w-76 border-r border-[#242e3d] bg-[#121620] flex flex-col shrink-0 overflow-hidden shadow-lg z-20">
            <Panel
              variant="default"
              title={`战斗日志 (${snapshot.logHistory.length})`}
              codeName="SYS.LOG"
              headerScene="rhodes-command"
              actions={
                <Button variant="ghost" size="sm" onClick={() => setShowLog(false)} className="px-1.5 py-0 text-[10px]">
                  ◀ 收起
                </Button>
              }
              className="flex-1 border-0 flex flex-col overflow-hidden"
            >
              <div className="flex-1 overflow-y-auto p-2">
                <LogView history={snapshot.logHistory} state={snapshot.state} />
              </div>
            </Panel>
          </aside>
        )}

        {/* 中栏：自适应战场主舞台 + 手牌指挥托盘（手机横屏自动切换为左右分栏，竖屏与桌面上下布局） */}
        <main
          className={`relative flex-1 min-w-0 min-h-0 grid ${
            useSideRail ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-rows-[minmax(0,1fr)_auto]'
          } bg-[#0a0d12] overflow-hidden`}
          onClick={clearNonModalSelection}
        >
          {/* 中央三路交锋推演棋盘（含非阻塞回合横幅与跳过演出按钮） */}
          <div className="relative min-w-0 min-h-0 flex flex-col overflow-hidden">
            {!combatAnim.effectiveDisabled && activeBeat?.turnBanner && (
              <TurnTransitionBanner
                banner={activeBeat.turnBanner}
                bottomPlayer={bottomPlayer}
                isHotseat={isHotseat}
                disableMotion={combatAnim.effectiveDisabled}
              />
            )}

            {combatAnim.isPlaying && combatAnim.remainingQueueCount > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  combatAnim.skipAll();
                }}
                className="absolute top-2 right-2 sm:right-3 z-40 px-2 sm:px-2.5 py-1 bg-[#12171e]/95 hover:bg-[#1a212b] border border-[#e5a52b]/65 text-[#e5a52b] font-mono font-semibold text-[10px] sm:text-[11px] cursor-pointer transition-colors"
                title="立即跳过余下战斗演出"
              >
                ⏭ 跳过演出 ({combatAnim.remainingQueueCount})
              </button>
            )}

            <TacticalBoardViewport
              isMobile={isMobile}
              wideBoard={isWideBoard}
              disableGestures={Boolean(touchDragState || draggingCardId)}
              disableMotion={combatAnim.effectiveDisabled}
              arenaBackdropUrl={battlefieldArenaSurface}
              scenicScene={boardScenicScene}
              onScaleChange={setBoardScale}
              onBackgroundClick={clearNonModalSelection}
            >
              <div
                ref={boardGridRef}
                className={`relative w-full transition-colors duration-150 ${
                  touchDragState?.resolution.kind === 'direct_play'
                    ? 'ring-1 ring-cyan-400/80 bg-cyan-950/15'
                    : ''
                }`}
              >
                {touchDragState?.resolution.kind === 'direct_play' && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-40 px-3 py-1 bg-[#0e1218]/95 border border-cyan-400 text-cyan-200 font-mono font-bold text-[11px] whitespace-nowrap"
                  >
                    ⚡ 松手直接释放战术指令
                  </div>
                )}
                <div
                  className="grid gap-2 sm:gap-3.5 lg:gap-5 w-full"
                  style={{ gridTemplateColumns: `repeat(${boardLanes.length}, minmax(0, 1fr))` }}
                >
                  {boardLanes.map((laneProfile) => {
                    const lane = laneProfile.laneId;
                    const isDirectBaseLane = Boolean(attackPreview?.attacksBase && attackPreview.lane === lane);
                    const laneStrike = activeBeat?.laneStrikes.find((s) => s.lane === lane || s.targetLane === lane);
                    const laneDisplayName = formatLaneLabelZh(displayState.board_profile, lane);
                    return (
                      <div
                        key={lane}
                        className={`holo-frame board-lane-shell transition-colors duration-150 ${
                          laneStrike
                            ? laneStrike.toBase
                              ? 'bg-rose-400/95'
                              : laneStrike.kind === 'skill'
                                ? 'bg-cyan-400/95'
                                : 'bg-[#e5a52b]/95'
                            : 'bg-[#334050]'
                        }`}
                      >
                        <div className="board-lane board-lane-grid relative flex flex-col w-full h-full overflow-hidden">
                        {/* 航道标头 */}
                        <div className="relative z-10 px-2 sm:px-2.5 py-1 bg-[#141a22]/94 border-b border-[#283240] flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-100 tracking-wider text-[10px] sm:text-xs truncate">{laneDisplayName}</span>
                          {isDirectBaseLane ? (
                            <span className="text-[8px] sm:text-[9px] font-mono font-bold text-rose-300 tracking-wider whitespace-nowrap">
                              ⚔ 直击
                            </span>
                          ) : (
                            <span className="text-[8px] sm:text-[10px] font-mono text-slate-500 uppercase tracking-wider shrink-0">
                              F{laneProfile.frontSlots}/R{laneProfile.rearSlots}
                            </span>
                          )}
                        </div>

                        {/* 敌方战区 (上方后排 + 前排)：融入网格负空间的极简排布 */}
                        <div className={`relative z-10 p-1.5 sm:p-2.5 space-y-1 sm:space-y-1.5 ${actor === topPlayer ? 'bg-rose-500/[0.03]' : ''}`}>
                          <div className={`${useCompactBoard ? 'hidden' : 'hidden sm:flex'} items-center justify-between px-0.5 pb-0.5 text-[9px] font-mono tracking-wider text-rose-300/65`}>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-1 h-2 bg-rose-400/70" />
                              <span>{isHotseat ? (topPlayer === 'player_a' ? '玩家 A 防线' : '玩家 B 防线') : '敌方战区'}</span>
                            </span>
                            <span className="text-[8px] text-slate-500">
                              {laneProfile.rearSlots > 0 && laneProfile.frontSlots > 0
                                ? '后排 / 前锋'
                                : laneProfile.frontSlots > 0
                                  ? '仅前锋'
                                  : '仅后排'}
                            </span>
                          </div>
                          {laneProfile.rearSlots > 0 && (
                            <div
                              className="grid gap-1 sm:gap-1.5"
                              style={{ gridTemplateColumns: `repeat(${laneProfile.rearSlots}, minmax(0, 1fr))` }}
                            >
                              {Array.from({ length: laneProfile.rearSlots }, (_, idx) =>
                                renderSlot(topPlayer, lane, 'back', idx + 1, laneProfile.rearSlots),
                              )}
                            </div>
                          )}
                          {laneProfile.rearSlots > 0 && laneProfile.frontSlots > 0 && (
                            <div aria-hidden="true" className="h-[1px] mx-1 bg-rose-500/15" />
                          )}
                          {laneProfile.frontSlots > 0 && (
                            <div
                              className="grid gap-1 sm:gap-1.5"
                              style={{ gridTemplateColumns: `repeat(${laneProfile.frontSlots}, minmax(0, 1fr))` }}
                            >
                              {Array.from({ length: laneProfile.frontSlots }, (_, idx) =>
                                renderSlot(topPlayer, lane, 'front', idx + 1, laneProfile.frontSlots),
                              )}
                            </div>
                          )}
                        </div>

                        {/* 极简工业交锋基准线 */}
                        <div className="relative z-10 py-1 sm:py-1.5 px-2 sm:px-3 bg-[#0a0d12]/70 border-y border-[#232c37] flex items-center justify-center gap-2 select-none">
                          <div className="flex-1 h-[1px] bg-[#293340]" />
                          <span className="text-[8px] sm:text-[9px] font-mono font-bold text-[#e5a52b]/90 tracking-[0.18em] flex items-center gap-1 whitespace-nowrap">
                            <span>⚔</span>
                            <span>{isDirectBaseLane ? '直击基地' : '交锋线'}</span>
                          </span>
                          <div className="flex-1 h-[1px] bg-[#293340]" />
                        </div>

                        {/* 己方战区 (下方前排 + 后排) */}
                        <div className={`relative z-10 p-1.5 sm:p-2.5 space-y-1 sm:space-y-1.5 ${actor === bottomPlayer ? 'bg-sky-400/[0.03]' : ''}`}>
                          {laneProfile.frontSlots > 0 && (
                            <div
                              className="grid gap-1 sm:gap-1.5"
                              style={{ gridTemplateColumns: `repeat(${laneProfile.frontSlots}, minmax(0, 1fr))` }}
                            >
                              {Array.from({ length: laneProfile.frontSlots }, (_, idx) =>
                                renderSlot(bottomPlayer, lane, 'front', idx + 1, laneProfile.frontSlots),
                              )}
                            </div>
                          )}
                          {laneProfile.frontSlots > 0 && laneProfile.rearSlots > 0 && (
                            <div aria-hidden="true" className="h-[1px] mx-1 bg-sky-400/15" />
                          )}
                          {laneProfile.rearSlots > 0 && (
                            <div
                              className="grid gap-1 sm:gap-1.5"
                              style={{ gridTemplateColumns: `repeat(${laneProfile.rearSlots}, minmax(0, 1fr))` }}
                            >
                              {Array.from({ length: laneProfile.rearSlots }, (_, idx) =>
                                renderSlot(bottomPlayer, lane, 'back', idx + 1, laneProfile.rearSlots),
                              )}
                            </div>
                          )}
                          <div className={`${useCompactBoard ? 'hidden' : 'hidden sm:flex'} items-center justify-between px-0.5 pt-0.5 text-[9px] font-mono tracking-wider text-sky-300/65`}>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-1 h-2 bg-sky-400/70" />
                              <span>{isHotseat ? (bottomPlayer === 'player_a' ? '玩家 A 防线' : '玩家 B 防线') : '我方防线'}</span>
                            </span>
                            <span className="text-[8px] text-slate-500">
                              {laneProfile.frontSlots > 0 && laneProfile.rearSlots > 0
                                ? '前锋 / 后卫'
                                : laneProfile.frontSlots > 0
                                  ? '仅前锋'
                                  : '仅后卫'}
                            </span>
                          </div>
                        </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 全棋盘矢量攻击轨迹与锁定准星覆盖层 */}
                <AttackPathOverlay
                  strikes={activeBeat?.laneStrikes ?? []}
                  bottomPlayer={bottomPlayer}
                  topPlayer={topPlayer}
                  laneIds={boardLanes.map((l) => l.laneId)}
                  slotCenters={boardGeometry.slotCenters}
                  boardSize={boardGeometry.boardSize}
                  cssAnimScale={combatAnim.cssAnimScale}
                  disableMotion={combatAnim.effectiveDisabled || !appSettings.combatVfxEnabled}
                />
              </div>
            </TacticalBoardViewport>
          </div>

          {/* 底部 / 横屏右侧统一己方指挥面板与手牌托盘 */}
          <PlayerHandDock
            state={displayState}
            bottomPlayer={bottomPlayer}
            actor={actor}
            canAct={canAct}
            isActionPhase={isActionPhase}
            hasPending={hasPending}
            isHotseat={isHotseat}
            isMobile={isMobile}
            isLandscape={isLandscape}
            layoutMode={useSideRail ? 'side-rail' : 'bottom'}
            selection={selection}
            draggingCardId={draggingCardId}
            allyBaseDamageDelta={activeBeat?.baseDamage.ally ?? null}
            disableMotion={combatAnim.effectiveDisabled}
            selectionPrompt={selectionPromptContent}
            onHandCardClick={onHandCardClick}
            onLongPressCard={(id, rect) => {
              cancelPendingTouchCandidate();
              openPinnedPreview(id, rect);
            }}
            onHoverCard={(preview) => {
              if (preview) {
                setHoveredCard(preview);
              } else {
                setHoveredCard(null);
              }
            }}
            onDragStartCard={(id, e) => {
              playCombatSfx('select');
              setHoveredCard(null);
              setDraggingCardId(id);
              setSelection(id);
              e.dataTransfer.setData('text/plain', id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEndCard={() => {
              setDraggingCardId(null);
              setDragOverSlot(null);
            }}
            onTouchStartCardCandidate={handleTouchStartCardCandidate}
            onEndActionPhase={() => dispatch({ type: 'end_action_phase' })}
          />
        </main>

        {!isMobile && showDetail && (
          <aside className="w-72 xl:w-80 border-l border-[#242e3d] bg-[#121620] flex flex-col shrink-0 overflow-hidden shadow-lg z-20">
            <TacticalDetailPanel
              state={state}
              selection={selection}
              onDeselect={() => setSelection(null)}
              canAct={canAct}
              isActionPhase={isActionPhase}
              hasPending={hasPending}
              legalActions={legal}
              onDispatch={dispatch}
              className="flex-1"
            />
          </aside>
        )}
      </div>

      {/* 炉石风格放大卡牌 + 侧边词条小框预览 (支持桌面悬停与移动端长按浮层，不另开整页抽屉) */}
      {!draggingCardId && !touchDragState && (
        <CardPreviewPopover
          state={displayState}
          hovered={activePreview}
          invalidReason={activePreviewInvalidReason}
          onDismiss={() => setPinnedPreview(null)}
        />
      )}

      {/* 5. 移动端独立底部抽屉：战斗日志 */}
      {isMobile && (
        <BottomSheet
          isOpen={showLog}
          onClose={() => setShowLog(false)}
          title={`战斗日志 (${snapshot.logHistory.length})`}
          codeName="SYS.LOG"
          maxHeight={isLandscape ? 'max-h-[92dvh]' : 'max-h-[85dvh]'}
        >
          <LogView history={snapshot.logHistory} state={snapshot.state} />
        </BottomSheet>
      )}

      {/* 7. 投降二次确认弹窗 */}
      <Modal
        isOpen={confirmDialog === 'surrender'}
        onClose={() => setConfirmDialog(null)}
        title="确认投降"
        codeName="SYS.SURRENDER"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDialog(null)}>
              继续作战
            </Button>
            <Button
              variant="danger"
              size="sm"
              cornerCut
              onClick={() => {
                setConfirmDialog(null);
                void dispatch({ type: 'surrender' }, surrenderActor);
              }}
            >
              确认投降
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-xs text-slate-200 leading-relaxed">
          <p className="m-0">
            {isHotseat
              ? `当前行动方【${PLAYER_LABEL[surrenderActor]}】将宣告撤退，直接判定对方获胜并进入战后结算页面。`
              : '宣告撤退将直接判定我方战败，并立即进入作战结算报告。'}
          </p>
          <p className="m-0 text-slate-400">该操作不可撤销，请确认是否立即结束推演。</p>
        </div>
      </Modal>

      {/* 9. 退出对局二次确认弹窗 */}
      <Modal
        isOpen={confirmDialog === 'exit'}
        onClose={() => setConfirmDialog(null)}
        title="确认退出对局"
        codeName="SYS.EXIT"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDialog(null)}>
              继续作战
            </Button>
            <Button
              variant="danger"
              size="sm"
              cornerCut
              onClick={() => {
                setConfirmDialog(null);
                effectiveOnExit?.();
              }}
            >
              确认退出
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-xs text-slate-200 leading-relaxed">
          <p className="m-0">
            退出将立即中止当前对局并返回主菜单，不会保留当前战局进度或发放战后奖励。
          </p>
          {canSurrender && (
            <p className="m-0 text-slate-400">如需认输并查看战报结算，请使用「投降」功能。</p>
          )}
        </div>
      </Modal>

      {/* 10. 浮动错误提示（移动端置于顶部 HUD 下方，避免遮挡底部手牌与行动按钮） */}
      {error && (
        <div
          role="alert"
          className="fixed top-[calc(3.5rem+env(safe-area-inset-top,0px))] sm:top-auto sm:bottom-6 left-1/2 -translate-x-1/2 z-50 px-3 sm:px-4 py-2 bg-rose-950/95 border border-rose-500 text-rose-100 text-xs shadow-2xl animate-fade-in flex items-center gap-2 max-w-[92vw]"
        >
          <span>⚠️ {error}</span>
          <button type="button" onClick={() => setError(null)} className="ml-2 text-rose-300 hover:text-white shrink-0">
            ✕
          </button>
        </div>
      )}
      {/* 11. 移动端触控拖拽悬浮预览、瞄准虚线与磁吸准星 */}
      {touchDragState && cardDefinitionOf(state, touchDragState.cardId) && (
        <CardTouchDragOverlay
          definition={cardDefinitionOf(state, touchDragState.cardId)!}
          pointer={touchDragState.pointer}
          aimPoint={touchDragState.aimPoint}
          resolution={touchDragState.resolution}
          statusText={touchDragState.statusText}
          viewportWidth={typeof window !== 'undefined' ? window.innerWidth : width}
          viewportHeight={typeof window !== 'undefined' ? window.innerHeight : height}
        />
      )}
    </div>
  );
}

