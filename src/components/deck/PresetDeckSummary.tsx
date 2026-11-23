import React from 'react';
import { CARD_BY_ID, getPresetDeckMetadata } from '../../client/gameData';
import { computeDeckCostProfile, type OfficialPresetDeckMetadata } from '../../data/load-preset-decks';
import type { DeckDefinition } from '../../game/types';

interface PresetDeckSummaryProps {
  readonly deck: DeckDefinition;
  readonly expanded?: boolean;
  readonly compact?: boolean;
}

export function PresetDeckCostCurve({
  byCost,
  averageCost,
}: {
  readonly byCost: Readonly<Record<number, number>>;
  readonly averageCost: number;
}) {
  const buckets = [1, 2, 3, 4, 5, 6];
  const maxVal = Math.max(1, ...buckets.map((cost) => byCost[cost] ?? 0));

  return (
    <div className="space-y-1" data-testid="preset-cost-curve">
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
        <span>费用曲线 (CP)</span>
        <span className="text-amber-300 font-bold tabular-nums">均费 {averageCost.toFixed(2)} CP</span>
      </div>
      <div className="grid grid-cols-6 gap-1 items-end bg-[#0d1117] border border-[#252e3a] px-1.5 pt-2 pb-1">
        {buckets.map((cost) => {
          const count = byCost[cost] ?? 0;
          const heightPct = count > 0 ? Math.max(20, Math.round((count / maxVal) * 100)) : 8;
          return (
            <div key={cost} className="flex flex-col items-center gap-0.5">
              <span className={`text-[9px] font-mono tabular-nums leading-none ${count > 0 ? 'text-slate-200 font-bold' : 'text-slate-600'}`}>
                {count}
              </span>
              <div className="w-full h-5 flex items-end justify-center bg-[#141a22]">
                <div
                  className={`w-full transition-all ${count > 0 ? 'bg-[#e5a52b]' : 'bg-slate-800/70'}`}
                  style={{ height: `${heightPct}%` }}
                />
              </div>
              <span className="text-[9px] font-mono text-slate-400 leading-none">{cost === 6 ? '6+' : `${cost}费`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 展示官方预设卡组的玩法定位、难度、卡组数量、费用曲线，以及展开后的优势、弱点和简短打法。
 */
export function PresetDeckSummary({ deck, expanded = false, compact = false }: PresetDeckSummaryProps) {
  const meta: OfficialPresetDeckMetadata | undefined = getPresetDeckMetadata(deck.deck_id);
  const profile = computeDeckCostProfile(deck, CARD_BY_ID);

  return (
    <div className="space-y-1.5 text-[11px]" data-testid={`preset-summary-${deck.deck_id}`}>
      {/* 核心定位、难度与卡组数量/构成 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-mono">
        {meta?.archetype && (
          <span className="text-sky-300 font-bold">{meta.archetype}</span>
        )}
        {meta?.difficulty && (
          <span
            className={`px-1.5 py-0.2 border leading-tight font-bold ${
              meta.difficulty === '入门'
                ? 'bg-emerald-950/75 border-emerald-500/50 text-emerald-300'
                : 'bg-amber-950/75 border-amber-500/50 text-amber-300'
            }`}
          >
            难度：{meta.difficulty}
          </span>
        )}
        <span className="text-slate-300 tabular-nums">
          {profile.totalCopies}张（{profile.typeCounts.operator}干员·{profile.typeCounts.tactic}战术·{profile.typeCounts.facility}设施·{profile.typeCounts.equipment}装备）
        </span>
      </div>

      {/* 简介 */}
      {meta?.description && !compact && (
        <p className="m-0 text-[11px] text-slate-300 leading-relaxed">
          {meta.description}
        </p>
      )}

      {/* 费用曲线 */}
      <PresetDeckCostCurve byCost={profile.byCost} averageCost={profile.averageCost} />

      {/* 优势 / 弱点 / 简短打法 */}
      {expanded && meta && (
        <div className="p-2 bg-[#0e1319] border border-[#293442] space-y-1 text-[11px] leading-relaxed">
          <div>
            <span className="text-emerald-300 font-bold">优势：</span>
            <span className="text-slate-200">{meta.strengths}</span>
          </div>
          <div>
            <span className="text-rose-300 font-bold">弱点：</span>
            <span className="text-slate-200">{meta.weaknesses}</span>
          </div>
          <div>
            <span className="text-amber-300 font-bold">打法：</span>
            <span className="text-slate-200">{meta.gamePlan}</span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 pt-0.5 border-t border-[#1e2733]">
            平衡环境：{meta.recommendedMode}
          </div>
        </div>
      )}
    </div>
  );
}
