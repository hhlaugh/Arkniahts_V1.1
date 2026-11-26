import React from 'react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { OrundumIcon } from '../ui/OrundumIcon';
import type { BattleMissionReport } from './battleMissions';

interface MissionPanelProps {
  readonly report: BattleMissionReport;
  readonly isMatchFinished: boolean;
  readonly variant?: 'overlay' | 'embedded';
  readonly claimedAmount?: number | null;
  readonly disableMotion?: boolean;
  readonly onClose?: () => void;
  readonly onExitMatch?: () => void;
}

/**
 * 罗德岛演习动态任务面板 (MissionPanel)
 * - 展示本局动态生成的 3 项演习任务及实时/终局进度条（50% 与 100% 达成触发高亮脉冲）
 * - 对局结束时汇总已完成任务并展示额外发放的合成玉奖励
 */
export function MissionPanel({
  report,
  isMatchFinished,
  variant = 'overlay',
  claimedAmount = null,
  disableMotion = false,
  onClose,
  onExitMatch,
}: MissionPanelProps) {
  const displayBonus = claimedAmount !== null ? claimedAmount : report.totalEarnedOriginite;

  const content = (
    <div className="space-y-3" data-testid="mission-panel">
      {/* 汇总摘要头 */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#263140] text-xs font-mono">
        <div className="flex items-center gap-2 text-slate-300 tabular-nums">
          <span className="font-bold text-white">
            {isMatchFinished ? '本局演习任务结算' : '本局动态演习任务'}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            完成 {report.completedCount}/{report.totalCount}
          </span>
        </div>

        <div className="inline-flex items-center gap-1.5 text-amber-300 font-bold tabular-nums">
          <OrundumIcon size="sm" />
          <span>
            {isMatchFinished
              ? report.totalEarnedOriginite > 0
                ? `额外奖励 +${displayBonus} 合成玉`
                : '本次未达成额外任务'
              : `最高可得 +${report.missions.reduce((s, m) => s + m.rewardOriginite, 0)} 合成玉`}
          </span>
        </div>
      </div>

      {/* 动态任务列表 */}
      <div className="space-y-2.5">
        {report.missions.map((mission) => {
          const safeTarget = Math.max(1, mission.target);
          const clampedCurrent = Math.min(mission.current, mission.target);
          const pct = Math.max(0, Math.min(100, Math.round((mission.current / safeTarget) * 100)));
          const milestone: 'complete' | 'half' | 'normal' =
            pct >= 100 || mission.completed ? 'complete' : pct >= 50 ? 'half' : 'normal';
          const barPulseClass = disableMotion
            ? ''
            : milestone === 'complete'
              ? 'anim-progress-complete'
              : milestone === 'half'
                ? 'anim-progress-half'
                : '';

          return (
            <div
              key={mission.id}
              data-testid={`mission-item-${mission.kind}`}
              data-progress-milestone={milestone}
              className={`p-3 border transition-colors ${
                milestone === 'complete'
                  ? 'bg-[#101c1a]/90 border-emerald-400/65'
                  : milestone === 'half'
                    ? 'bg-[#101924]/90 border-cyan-400/50'
                    : 'bg-[#10151c]/90 border-[#283342]'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
                    <span>{mission.title}</span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span
                      className={`text-[11px] font-mono ${
                        milestone === 'complete'
                          ? 'text-emerald-300'
                          : isMatchFinished
                            ? 'text-slate-400'
                            : milestone === 'half'
                              ? 'text-cyan-300'
                              : 'text-sky-300'
                      }`}
                    >
                      {milestone === 'complete'
                        ? '已完成'
                        : isMatchFinished
                          ? '未达成'
                          : milestone === 'half'
                            ? '突破 50%'
                            : '进行中'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 m-0">{mission.description}</p>
                </div>

                <div className="flex items-center gap-2 font-mono text-xs tabular-nums shrink-0">
                  <span className={milestone === 'complete' ? 'text-emerald-300 font-bold' : 'text-slate-200'}>
                    {clampedCurrent}/{mission.target}
                  </span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="inline-flex items-center gap-1 text-amber-300 font-bold">
                    <OrundumIcon size="xs" />
                    <span>+{mission.rewardOriginite}</span>
                  </span>
                </div>
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <div
                  role="progressbar"
                  aria-label={mission.title}
                  aria-valuemin={0}
                  aria-valuemax={mission.target}
                  aria-valuenow={clampedCurrent}
                  aria-valuetext={`${pct}%`}
                  data-testid={`mission-progress-${mission.kind}`}
                  data-progress-milestone={milestone}
                  data-mission-pct={pct}
                  className={`relative h-2.5 flex-1 bg-[#0a0e14] border overflow-hidden ${
                    milestone === 'complete'
                      ? 'border-emerald-400/70'
                      : milestone === 'half'
                        ? 'border-cyan-400/60'
                        : 'border-[#222d3b]'
                  }`}
                >
                  {/* 50% 里程碑刻度线 */}
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute left-1/2 top-0 bottom-0 w-px z-20 ${
                      milestone !== 'normal' ? 'bg-cyan-200/75' : 'bg-slate-600/70'
                    }`}
                  />
                  <div
                    className={`relative z-10 h-full transition-[width] duration-300 ${barPulseClass} ${
                      milestone === 'complete'
                        ? 'bg-gradient-to-r from-emerald-500 via-teal-300 to-amber-300'
                        : milestone === 'half'
                          ? 'bg-gradient-to-r from-sky-500 via-cyan-300 to-sky-200'
                          : 'bg-gradient-to-r from-sky-700 to-sky-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  >
                    {!disableMotion && milestone === 'complete' && (
                      <div
                        aria-hidden="true"
                        className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/65 to-transparent pointer-events-none anim-progress-shimmer"
                      />
                    )}
                  </div>
                </div>

                <span
                  data-testid={`mission-pct-${mission.kind}`}
                  className={`text-[11px] font-mono font-bold tabular-nums w-10 text-right shrink-0 ${
                    milestone === 'complete'
                      ? 'text-emerald-300'
                      : milestone === 'half'
                        ? 'text-cyan-300'
                        : 'text-slate-400'
                  }`}
                >
                  {pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {variant === 'overlay' && (
        <div className="pt-2 flex flex-wrap items-center justify-end gap-2 border-t border-[#263140]">
          {onClose && (
            <Button variant="secondary" size="sm" onClick={onClose}>
              {isMatchFinished ? '继续查看棋盘' : '收起任务面板'}
            </Button>
          )}
          {isMatchFinished && onExitMatch && (
            <Button variant="primary" size="sm" cornerCut onClick={onExitMatch}>
              结束并离开演习
            </Button>
          )}
        </div>
      )}
    </div>
  );

  if (variant === 'embedded') {
    return (
      <div className="p-4 bg-[#10151c] border border-[#2a3646]">
        {content}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <Panel
          variant="dark"
          cornerCut="lg"
          scanlines
          title={isMatchFinished ? 'PRTS 演习任务结算' : 'PRTS 动态演习任务'}
          codeName="PRTS.MISSION"
          headerScene="rhodes-command"
          actions={
            onClose && (
              <Button variant="ghost" size="sm" onClick={onClose} aria-label="关闭任务面板">
                ✕
              </Button>
            )
          }
          className="border-[#52606d] shadow-[0_24px_64px_rgba(0,0,0,0.88)]"
        >
          <div className="p-4 sm:p-5">{content}</div>
        </Panel>
      </div>
    </div>
  );
}
