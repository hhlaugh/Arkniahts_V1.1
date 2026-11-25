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
  readonly onClose?: () => void;
  readonly onExitMatch?: () => void;
}

/**
 * 罗德岛演习动态任务面板 (MissionPanel)
 * - 展示本局动态生成的 3 项演习任务及实时/终局完成进度
 * - 对局结束时汇总已完成任务并展示额外发放的合成玉奖励
 */
export function MissionPanel({
  report,
  isMatchFinished,
  variant = 'overlay',
  claimedAmount = null,
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
          const pct = Math.max(0, Math.min(100, Math.round((mission.current / Math.max(1, mission.target)) * 100)));
          return (
            <div
              key={mission.id}
              data-testid={`mission-item-${mission.kind}`}
              className={`p-3 border transition-colors ${
                mission.completed
                  ? 'bg-[#101c1a]/90 border-emerald-500/55'
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
                        mission.completed
                          ? 'text-emerald-300'
                          : isMatchFinished
                            ? 'text-slate-400'
                            : 'text-sky-300'
                      }`}
                    >
                      {mission.completed ? '已完成' : isMatchFinished ? '未达成' : '进行中'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 m-0">{mission.description}</p>
                </div>

                <div className="flex items-center gap-2 font-mono text-xs tabular-nums shrink-0">
                  <span className={mission.completed ? 'text-emerald-300 font-bold' : 'text-slate-200'}>
                    {Math.min(mission.current, mission.target)}/{mission.target}
                  </span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="inline-flex items-center gap-1 text-amber-300 font-bold">
                    <OrundumIcon size="xs" />
                    <span>+{mission.rewardOriginite}</span>
                  </span>
                </div>
              </div>

              <div
                role="progressbar"
                aria-label={mission.title}
                aria-valuemin={0}
                aria-valuemax={mission.target}
                aria-valuenow={Math.min(mission.current, mission.target)}
                className="mt-2 h-1.5 w-full bg-[#0a0e14] border border-[#222d3b] overflow-hidden"
              >
                <div
                  className={`h-full transition-[width] duration-300 ${
                    mission.completed
                      ? 'bg-gradient-to-r from-emerald-500 to-teal-300'
                      : 'bg-gradient-to-r from-sky-600 to-cyan-400'
                  }`}
                  style={{ width: `${pct}%` }}
                />
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
