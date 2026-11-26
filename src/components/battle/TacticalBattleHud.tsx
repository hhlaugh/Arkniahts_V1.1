import React from 'react';
import type { GameState, PlayerId } from '../../game/types';
import { Button } from '../ui/Button';
import type { NetworkStatus } from '../../views/BattleView';
import type { PresentationBeat } from './combatPresentation';
import { DEFAULT_ANIMATION_SPEED_MODE, type AnimationSpeedMode } from './combatPresentation';
import { ScenicBannerLayer } from '../ui/ScenicBackdrop';
import { BaseHpBar } from './BaseHpBar';
import titaniumHudSurface from '../../assets/images/titanium_hud_surface_1795070730280.jpg';

interface TacticalBattleHudProps {
  readonly state: GameState;
  readonly actor: PlayerId;
  readonly bottomPlayer: PlayerId;
  readonly topPlayer: PlayerId;
  readonly hasPending: boolean;
  readonly isHotseat?: boolean;
  readonly networkStatus?: NetworkStatus | null;
  readonly seed?: number;
  readonly showLog: boolean;
  readonly onToggleLog: () => void;
  readonly showDetail: boolean;
  readonly onToggleDetail: () => void;
  readonly onSurrender?: () => void;
  readonly onExit?: () => void;
  readonly animSpeedMode?: AnimationSpeedMode;
  readonly onCycleAnimSpeed?: () => void;
  readonly activeAnimPhase?: PresentationBeat['phase'] | null;
  readonly enemyBaseDamageDelta?: number | null;
  readonly disableMotion?: boolean;
  readonly onOpenSettings?: () => void;
  readonly onOpenRules?: () => void;
  readonly missionSummary?: { readonly completed: number; readonly total: number };
  readonly showMissions?: boolean;
  readonly onToggleMissions?: () => void;
}

export type TurnPhaseStepKey = 'mulligan' | 'turn_start' | 'deploy' | 'combat' | 'pending' | 'turn_end' | 'finished';

export interface TurnPhaseDisplayInfo {
  readonly turnOwnerLabel: string;
  readonly phaseKey: TurnPhaseStepKey;
  readonly phaseLabel: string;
  readonly isAllyTurn: boolean;
}

export function getTurnPhaseDisplay({
  state,
  actor,
  bottomPlayer,
  hasPending,
  isHotseat = false,
  activeAnimPhase = null,
}: {
  readonly state: GameState;
  readonly actor: PlayerId;
  readonly bottomPlayer: PlayerId;
  readonly hasPending: boolean;
  readonly isHotseat?: boolean;
  readonly activeAnimPhase?: PresentationBeat['phase'] | null;
}): TurnPhaseDisplayInfo {
  const isAllyTurn = actor === bottomPlayer;

  const turnOwnerLabel =
    state.phase === 'finished'
      ? '对局结束'
      : isHotseat
        ? actor === 'player_a'
          ? '玩家 A 回合'
          : '玩家 B 回合'
        : isAllyTurn
          ? '你的回合'
          : '敌方回合';

  if (activeAnimPhase === 'strike' || activeAnimPhase === 'impact' || state.phase === 'combat') {
    return {
      turnOwnerLabel,
      phaseKey: 'combat',
      phaseLabel: '作战阶段',
      isAllyTurn,
    };
  }
  if (hasPending) {
    return {
      turnOwnerLabel,
      phaseKey: 'pending',
      phaseLabel: '待选支援',
      isAllyTurn,
    };
  }
  switch (state.phase) {
    case 'action':
      return { turnOwnerLabel, phaseKey: 'deploy', phaseLabel: '部署阶段', isAllyTurn };
    case 'turn_start':
      return { turnOwnerLabel, phaseKey: 'turn_start', phaseLabel: '准备阶段', isAllyTurn };
    case 'turn_end':
      return { turnOwnerLabel, phaseKey: 'turn_end', phaseLabel: '回合结算', isAllyTurn };
    case 'mulligan':
      return { turnOwnerLabel, phaseKey: 'mulligan', phaseLabel: '起手调度', isAllyTurn };
    case 'finished':
      return { turnOwnerLabel, phaseKey: 'finished', phaseLabel: '战局结束', isAllyTurn };
    default:
      return { turnOwnerLabel, phaseKey: 'turn_end', phaseLabel: '结算中', isAllyTurn };
  }
}

const SPEED_LABEL: Record<AnimationSpeedMode, { short: string; title: string }> = {
  slow: { short: '0.5x', title: '战斗动效：慢速（初始 0.5x · 点击切换为 1x 标准）' },
  normal: { short: '1x', title: '战斗动效：标准速度（点击切换为 2x 加速）' },
  fast: { short: '2x', title: '战斗动效：2x 加速（点击切换为关闭动效）' },
  off: { short: '关', title: '战斗动效：已关闭（点击恢复 0.5x 初始速度）' },
};

const FLOW_STEPS: readonly { readonly key: 'turn_start' | 'deploy' | 'combat'; readonly label: string }[] = [
  { key: 'turn_start', label: '准备' },
  { key: 'deploy', label: '部署' },
  { key: 'combat', label: '作战' },
];

/**
 * 顶部战局与敌方阵地 HUD (TacticalBattleHud)
 * 采用响应式 CSS Grid 三分区布局：
 * - 桌面端：`grid-cols-[1fr_auto_1fr]` 让敌方基地状态精确居中对齐上方棋盘，左右分列回合/阶段信息与系统控制
 * - 移动端：`grid-cols-[1fr_auto]` 首行紧凑展示回合/阶段与系统控制，次行全宽展示敌方基地 HP/DP/手牌余量，绝不挤出或遮挡战场
 */
export function TacticalBattleHud({
  state,
  actor,
  bottomPlayer,
  topPlayer,
  hasPending,
  isHotseat = false,
  networkStatus,
  seed,
  showLog,
  onToggleLog,
  showDetail,
  onToggleDetail,
  onSurrender,
  onExit,
  animSpeedMode = DEFAULT_ANIMATION_SPEED_MODE,
  onCycleAnimSpeed,
  activeAnimPhase = null,
  enemyBaseDamageDelta = null,
  disableMotion = false,
  onOpenSettings,
  onOpenRules,
  missionSummary,
  showMissions = false,
  onToggleMissions,
}: TacticalBattleHudProps) {
  const playerEnemy = state.players[topPlayer];
  const isAllyTurn = actor === bottomPlayer;
  const isEnemyTurn = actor === topPlayer;

  const turnPhaseInfo = getTurnPhaseDisplay({
    state,
    actor,
    bottomPlayer,
    hasPending,
    isHotseat,
    activeAnimPhase,
  });

  const hudShiftCls = disableMotion
    ? ''
    : isEnemyTurn
      ? 'anim-hud-turn-shift anim-hud-turn-shift-enemy'
      : 'anim-hud-turn-shift anim-hud-turn-shift-ally';

  const ownerBadgeCls =
    state.phase === 'finished'
      ? 'bg-slate-800/90 text-slate-200 border-slate-500/70'
      : isHotseat
        ? 'bg-emerald-500/18 text-emerald-200 border-emerald-400/65'
        : isAllyTurn
          ? 'bg-sky-500/18 text-sky-200 border-sky-400/70'
          : 'bg-rose-500/18 text-rose-200 border-rose-500/65';

  const ownerDotCls =
    state.phase === 'finished'
      ? 'bg-slate-400'
      : isHotseat
        ? 'bg-emerald-400'
        : isAllyTurn
          ? 'bg-sky-400'
          : 'bg-rose-400';

  const phaseBadgeCls =
    turnPhaseInfo.phaseKey === 'combat'
      ? 'bg-rose-950/90 text-rose-200 border-rose-500/70'
      : turnPhaseInfo.phaseKey === 'pending'
        ? 'bg-cyan-950/90 text-cyan-200 border-cyan-400/70'
        : turnPhaseInfo.phaseKey === 'deploy'
          ? 'bg-amber-500/18 text-amber-200 border-amber-400/70'
          : 'bg-slate-800/90 text-slate-200 border-slate-600/80';

  const enemyHit = enemyBaseDamageDelta !== null && enemyBaseDamageDelta > 0;
  const enemyMaxBaseHp = 20;
  const enemyCpCap = playerEnemy.turn_cp_cap || 3;

  return (
    <header className="relative overflow-hidden grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-1.5 sm:gap-x-2 gap-y-1 px-1.5 sm:px-3.5 py-1 sm:py-1.5 bg-[#0d1016] border-b border-[#232d3d] text-[#e8e9e6] shadow-md z-30 shrink-0 select-none">
      <ScenicBannerLayer
        scene={networkStatus?.isOnline ? 'lungmen-night' : 'rhodes-bridge'}
        fade="right"
        opacityClassName="opacity-28"
      />
      <img
        src={titaniumHudSurface}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        className="pointer-events-none select-none absolute inset-0 w-full h-full object-cover opacity-[0.22]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 inset-x-0 h-[1.5px] bg-gradient-to-r from-cyan-400/20 via-cyan-300/65 to-amber-400/50 z-20"
      />
      {/* 1. 左区：PRTS 官方菱形徽记 + 固定回合归属与阶段指示器 */}
      <div
        data-testid="battle-turn-phase-header"
        aria-label={`第 ${state.turn_number} 回合 · ${turnPhaseInfo.turnOwnerLabel} · ${turnPhaseInfo.phaseLabel}`}
        className="relative z-10 flex items-center gap-1 sm:gap-1.5 min-w-0 justify-self-start"
      >
        <img
          src="./assets/arknights/logos/prts_diamond.png"
          alt="PRTS"
          referrerPolicy="no-referrer"
          className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 object-contain opacity-90"
        />
        <div className="flex items-center gap-1 font-mono tabular-nums shrink-0">
          <span className="w-1 h-3.5 sm:h-4 bg-[#e5a52b]" />
          <span className="font-black text-xs sm:text-sm tracking-wider sm:tracking-widest text-white">
            T{String(state.turn_number).padStart(2, '0')}
          </span>
        </div>

        <div className="shrink-0 overflow-hidden">
          <div
            key={`${actor}-${turnPhaseInfo.phaseKey}-${hasPending}`}
            className={`flex items-center gap-1 ${hudShiftCls}`}
          >
            <span
              data-testid="hud-turn-owner-badge"
              className={`board-chamfer-sm px-1.5 sm:px-2 py-0.5 border font-bold text-[10px] sm:text-xs tracking-wider inline-flex items-center gap-1 whitespace-nowrap ${ownerBadgeCls}`}
            >
              <span className={`w-1 h-2.5 shrink-0 ${ownerDotCls}`} aria-hidden="true" />
              <span>{turnPhaseInfo.turnOwnerLabel}</span>
            </span>

            <span
              data-testid="hud-phase-badge"
              className={`board-chamfer-sm px-1.5 sm:px-2 py-0.5 border font-bold text-[10px] sm:text-xs tracking-wider whitespace-nowrap ${phaseBadgeCls}`}
            >
              {turnPhaseInfo.phaseLabel}
            </span>
          </div>
        </div>

        {/* 桌面宽屏紧凑阶段流程条（准备 › 部署 › 作战） */}
        <div
          aria-hidden="true"
          className="hidden xl:inline-flex items-center gap-1 ml-1 px-2 py-0.5 bg-[#121722]/90 border border-[#253145] text-[10px] font-mono shrink-0"
        >
          {FLOW_STEPS.map((step, idx) => {
            const isStepActive = turnPhaseInfo.phaseKey === step.key;
            return (
              <React.Fragment key={step.key}>
                {idx > 0 && <span className="text-slate-600">›</span>}
                <span
                  className={
                    isStepActive
                      ? step.key === 'combat'
                        ? 'text-rose-300 font-black'
                        : 'text-amber-300 font-black'
                      : 'text-slate-500'
                  }
                >
                  {step.label}
                </span>
              </React.Fragment>
            );
          })}
        </div>

        {networkStatus?.isOnline ? (
          <div className="hidden lg:flex items-center gap-1.5 text-[11px] font-mono text-slate-400 whitespace-nowrap">
            <span className={`w-2 h-2 rounded-full ${networkStatus.opponentConnected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span>房号 {networkStatus.roomCode}</span>
          </div>
        ) : (
          seed !== undefined && (
            <span className="text-[10px] font-mono text-slate-500 hidden 2xl:inline tabular-nums whitespace-nowrap">
              SEED:{seed}
            </span>
          )
        )}
      </div>

      {/* 2. 中区（窄竖屏占第二行全宽，横屏及平板桌面居正中）：敌方基地状态面板 */}
      <div
        data-testid="enemy-hud-panel"
        className={`holo-frame relative z-10 col-span-2 sm:col-span-1 order-3 sm:order-2 justify-self-stretch sm:justify-self-center flex items-center justify-between sm:justify-center gap-1.5 sm:gap-3 px-2 sm:px-3 py-0.5 sm:py-1 bg-gradient-to-r from-[#1a1015] via-[#211319] to-[#1a1015] border transition-all duration-200 ${
          enemyHit
            ? `border-amber-400 ring-2 ring-amber-400/70 ${disableMotion ? '' : 'anim-base-hit'}`
            : isEnemyTurn
              ? 'border-rose-500 ring-1 ring-rose-500/45 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
              : 'border-rose-800/75'
        }`}
        style={{ clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)' }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 inset-x-0 h-[1.5px] bg-gradient-to-r from-rose-400/20 via-rose-300/75 to-amber-400/55"
        />
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="px-1.5 py-0.2 bg-rose-600 text-white font-black text-[10px] sm:text-xs tracking-wider shrink-0 uppercase whitespace-nowrap">
            {isHotseat ? (
              <>
                <span className="hidden md:inline">{topPlayer === 'player_a' ? '玩家 A (等待中)' : '玩家 B (等待中)'}</span>
                <span className="md:hidden">{topPlayer === 'player_a' ? '玩家 A' : '玩家 B'}</span>
              </>
            ) : (
              <>
                <span className="hidden md:inline">敌方基地</span>
                <span className="md:hidden">敌方</span>
              </>
            )}
          </span>

          {/* 敌方基地生命值 + 紧凑进度条 */}
          <div className="relative flex items-center gap-1.5 font-mono tabular-nums">
            <div className="flex items-baseline gap-0.5 sm:gap-1">
              <span className="text-[10px] text-rose-400 font-bold">HP</span>
              <strong className={`text-sm sm:text-lg lg:text-xl font-black leading-none ${enemyHit ? 'text-amber-300' : 'text-rose-400'}`}>
                {playerEnemy.base_points}
              </strong>
              <span className="text-[10px] text-slate-500">/{enemyMaxBaseHp}</span>
            </div>
            <BaseHpBar
              currentHp={playerEnemy.base_points}
              maxHp={enemyMaxBaseHp}
              side="enemy"
              isHit={enemyHit}
              label="敌方基本分"
              className="w-20 sm:w-28 lg:w-36 shrink-0"
            />
            {enemyHit && !disableMotion && (
              <span
                aria-hidden="true"
                className="absolute -bottom-4 right-0 px-1 py-0.2 bg-amber-950/95 border border-amber-400 text-amber-200 font-mono font-black text-[10px] pointer-events-none z-50 anim-float-number"
              >
                -{enemyBaseDamageDelta}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5 font-mono tabular-nums">
          <span className="h-3 w-px bg-rose-900/60 hidden sm:inline-block" aria-hidden="true" />
          {/* 敌方可用 CP 与本回合上限 */}
          <div className="flex items-baseline gap-0.5 sm:gap-1 text-xs sm:text-sm" title="敌方当前 CP / 本回合上限">
            <span className="text-[10px] text-rose-300/80 font-bold">CP</span>
            <strong className="font-black text-rose-300 leading-none">{playerEnemy.cost}</strong>
            <span className="text-[10px] text-rose-500/70">/{enemyCpCap}</span>
          </div>

          <span className="h-3 w-px bg-rose-900/60" aria-hidden="true" />

          {/* 敌方手牌与牌库余量 */}
          <div className="flex items-center gap-1 sm:gap-2 text-[10px] sm:text-[11px] text-slate-400 whitespace-nowrap">
            <span>
              <span className="hidden md:inline">手牌 </span>
              <span className="md:hidden">手</span>
              <strong className="text-slate-200">{playerEnemy.hand.length}</strong>
            </span>
            <span>·</span>
            <span>
              <span className="hidden md:inline">牌库 </span>
              <span className="md:hidden">库</span>
              <strong className="text-slate-200">{playerEnemy.deck.length}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* 3. 右区：倍速、日志、档案与投降/退出操作（支持窄屏自适应换行与紧凑触控尺寸） */}
      <div className="relative z-10 order-2 sm:order-3 justify-self-end flex flex-wrap items-center justify-end gap-0.5 sm:gap-1 min-w-0">
        {onCycleAnimSpeed && (
          <Button
            variant={animSpeedMode === 'off' ? 'ghost' : 'secondary'}
            size="sm"
            onClick={onCycleAnimSpeed}
            title={SPEED_LABEL[animSpeedMode].title}
            aria-label={`切换战斗动效速度，当前：${SPEED_LABEL[animSpeedMode].short}`}
            className={`text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 min-h-[30px] sm:min-h-[28px] shrink-0 font-mono whitespace-nowrap ${
              animSpeedMode === 'off' ? 'text-slate-400 border border-slate-700' : 'text-amber-300'
            }`}
          >
            ⚡<span className="ml-0.5">{SPEED_LABEL[animSpeedMode].short}</span>
          </Button>
        )}

        <Button
          variant={showLog ? 'secondary' : 'ghost'}
          size="sm"
          onClick={onToggleLog}
          title={showLog ? '关闭战斗日志' : '打开战斗日志'}
          aria-label={showLog ? '关闭战斗日志' : '打开战斗日志'}
          className="text-[11px] sm:text-xs px-1.5 sm:px-2 py-0.5 min-h-[30px] min-w-[30px] sm:min-h-[28px] shrink-0 whitespace-nowrap"
        >
          📜<span className="hidden lg:inline ml-1">日志</span>
        </Button>

        <Button
          variant={showDetail ? 'secondary' : 'ghost'}
          size="sm"
          onClick={onToggleDetail}
          title={showDetail ? '关闭干员档案' : '查看干员档案'}
          aria-label={showDetail ? '关闭干员档案' : '查看干员档案'}
          className="text-[11px] sm:text-xs px-1.5 sm:px-2 py-0.5 min-h-[30px] min-w-[30px] sm:min-h-[28px] shrink-0 whitespace-nowrap"
        >
          🔍<span className="hidden lg:inline ml-1">档案</span>
        </Button>

        {onToggleMissions && (
          <Button
            variant={showMissions ? 'secondary' : 'ghost'}
            size="sm"
            onClick={onToggleMissions}
            title={showMissions ? '收起演习任务面板' : '查看本局动态演习任务与奖励进度'}
            aria-label="查看动态演习任务"
            className="text-[11px] sm:text-xs px-1.5 sm:px-2 py-0.5 min-h-[30px] min-w-[30px] sm:min-h-[28px] shrink-0 whitespace-nowrap font-mono tabular-nums"
          >
            🎯
            <span className="hidden lg:inline ml-1">
              {missionSummary ? `任务 ${missionSummary.completed}/${missionSummary.total}` : '任务'}
            </span>
          </Button>
        )}

        {onOpenRules && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenRules}
            title="查看游戏规则补充说明（含突击部署、站位射程与词条图鉴）"
            aria-label="规则说明"
            className="text-[11px] sm:text-xs px-1.5 sm:px-2 py-0.5 min-h-[30px] min-w-[30px] sm:min-h-[28px] shrink-0 whitespace-nowrap text-slate-200 hover:text-amber-300"
          >
            📖<span className="hidden xl:inline ml-1">规则</span>
          </Button>
        )}

        {onOpenSettings && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            title="打开系统设置（音量、特效、动效倍速）"
            aria-label="系统设置"
            className="text-[11px] sm:text-xs px-1.5 sm:px-2 py-0.5 min-h-[30px] min-w-[30px] sm:min-h-[28px] shrink-0 whitespace-nowrap text-slate-200 hover:text-amber-300"
          >
            ⚙<span className="hidden xl:inline ml-1">设置</span>
          </Button>
        )}

        {(onSurrender || onExit) && (
          <>
            <span className="hidden md:inline-block h-4 w-px bg-[#2b3746] mx-0.5" aria-hidden="true" />
            {onSurrender && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSurrender}
                title="宣告撤退（投降并直接进入胜负结算）"
                aria-label="投降"
                className="inline-flex text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 min-h-[30px] min-w-[30px] sm:min-h-[28px] shrink-0 text-amber-200 bg-amber-950/45 border border-amber-500/50 hover:bg-amber-900/60 hover:border-amber-400 whitespace-nowrap"
              >
                🏳<span className="hidden md:inline ml-1">投降</span>
              </Button>
            )}
            {onExit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onExit}
                title="退出当前对局并返回主菜单"
                aria-label="退出对局"
                className="inline-flex text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 min-h-[30px] min-w-[30px] sm:min-h-[28px] shrink-0 text-rose-200 bg-rose-950/45 border border-rose-500/50 hover:bg-rose-900/60 hover:border-rose-400 whitespace-nowrap"
              >
                ✕<span className="hidden md:inline ml-1">退出</span>
              </Button>
            )}
          </>
        )}
      </div>
    </header>
  );
}
