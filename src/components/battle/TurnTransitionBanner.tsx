import React from 'react';
import type { PlayerId } from '../../game/types';
import type { TurnBannerCue } from './combatPresentation';

interface TurnTransitionBannerProps {
  readonly banner: TurnBannerCue;
  readonly bottomPlayer: PlayerId;
  readonly isHotseat?: boolean;
  readonly disableMotion?: boolean;
}

/**
 * 近未来极简工业风回合切换横幅：
 * - 外层仅负责横向居中定位，避免 CSS translate3d 动画覆写居中偏移
 * - 切角金属双层外壳 + 方向化滑入动效 + 机械扫描光带与底轨展开指示
 */
export function TurnTransitionBanner({
  banner,
  bottomPlayer,
  isHotseat = false,
  disableMotion = false,
}: TurnTransitionBannerProps) {
  const isAllyIncoming = isHotseat ? banner.actor === 'player_a' : banner.actor === bottomPlayer;
  const label = isHotseat
    ? banner.actor === 'player_a'
      ? '玩家 A 行动阶段'
      : '玩家 B 行动阶段'
    : banner.actor === bottomPlayer
      ? '我方行动阶段'
      : '敌方行动阶段';

  const shellAccentClass = isHotseat
    ? 'bg-[#e5a52b]/85'
    : isAllyIncoming
      ? 'bg-sky-400/80'
      : 'bg-rose-500/80';

  const railAccentClass = isHotseat
    ? 'bg-[#e5a52b]'
    : isAllyIncoming
      ? 'bg-sky-400'
      : 'bg-rose-400';

  const labelColorClass = isHotseat
    ? 'text-amber-100'
    : isAllyIncoming
      ? 'text-sky-100'
      : 'text-rose-100';

  const directionClass = disableMotion
    ? ''
    : isAllyIncoming
      ? 'anim-turn-banner anim-turn-banner-ally'
      : 'anim-turn-banner anim-turn-banner-enemy';

  return (
    <div
      data-testid="turn-transition-banner"
      data-incoming-side={isAllyIncoming ? 'ally' : 'enemy'}
      aria-live="polite"
      className="pointer-events-none absolute top-2.5 inset-x-0 z-40 flex justify-center px-3"
    >
      <div
        key={banner.id}
        className={`board-chamfer-sm p-[1px] shadow-[0_6px_18px_rgba(0,0,0,0.62)] ${shellAccentClass} ${directionClass}`}
      >
        <div className="board-chamfer-sm relative overflow-hidden bg-gradient-to-b from-[#171d26] via-[#0e1218] to-[#0a0d12] px-3.5 sm:px-5 py-1.5 sm:py-2 flex items-center gap-2.5 sm:gap-3">
          {/* 顶部 1px 金属倒角高光 */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 inset-x-0 h-[1px] bg-white/[0.12]"
          />

          {/* 水平扫掠光束 */}
          {!disableMotion && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/[0.14] to-transparent anim-turn-banner-sweep"
            />
          )}

          {/* 阵营识别色条 */}
          <span className={`relative z-10 w-1 h-4 shrink-0 ${railAccentClass}`} aria-hidden="true" />

          {/* 回合编号与行动归属 */}
          <div className="relative z-10 flex items-center gap-2 font-mono tabular-nums whitespace-nowrap">
            <span className="text-[11px] sm:text-xs font-black tracking-[0.14em] text-[#e5a52b]">
              {`T${String(banner.turnNumber).padStart(2, '0')}`}
            </span>
            <span className="h-3 w-px bg-slate-600/80" aria-hidden="true" />
            <span className={`text-xs sm:text-sm font-bold tracking-[0.08em] ${labelColorClass}`}>
              {label}
            </span>
          </div>

          {/* 底部展开基准轨道 */}
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute bottom-0 inset-x-3 h-[1.5px] ${railAccentClass} ${
              disableMotion ? 'opacity-80' : 'anim-turn-banner-rail'
            }`}
          />
        </div>
      </div>
    </div>
  );
}
