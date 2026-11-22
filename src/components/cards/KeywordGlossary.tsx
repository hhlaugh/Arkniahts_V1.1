import React from 'react';
import type { CardDefinition, CardInstance } from '../../game/types';
import type { UiCardDefinition } from '../../client/gameData';
import { extractCardKeywords } from '../../data/keywords';

interface KeywordGlossaryProps {
  readonly definition?: CardDefinition | UiCardDefinition | null;
  readonly instance?: CardInstance | null;
  readonly compact?: boolean;
  readonly maxItems?: number;
  readonly className?: string;
}

/**
 * 卡牌词条简要说明列表：
 * - 自动提取卡牌 keyword_tokens、规则内【词条】及在场单位当前状态
 * - 以近未来极简工业风的左对齐索引清单呈现，无多余圆角气泡装饰
 */
export function KeywordGlossary({
  definition,
  instance,
  compact = false,
  maxItems,
  className = '',
}: KeywordGlossaryProps) {
  const allEntries = extractCardKeywords(definition, instance);
  if (allEntries.length === 0) return null;

  const visibleEntries = maxItems && maxItems > 0 ? allEntries.slice(0, maxItems) : allEntries;
  const hiddenCount = Math.max(0, allEntries.length - visibleEntries.length);

  return (
    <div
      data-testid="keyword-glossary"
      className={`bg-[#0b0f14] border border-[#252f3d] ${compact ? 'p-1.5 space-y-1' : 'p-2.5 space-y-1.5'} ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#1d2530] pb-1">
        <span className="text-[10px] font-mono font-bold text-[#e5a52b] uppercase tracking-wider">
          词条简要说明
        </span>
        <span className="text-[9px] font-mono text-slate-500 tabular-nums">
          {allEntries.length} 项
        </span>
      </div>

      <ul className={`m-0 p-0 list-none ${compact ? 'space-y-1' : 'space-y-1.5'}`}>
        {visibleEntries.map((entry) => (
          <li
            key={entry.keyword}
            className="flex items-start gap-1.5 border-l-2 border-[#e5a52b]/65 pl-1.5 leading-snug"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={`${compact ? 'text-[10px]' : 'text-[11px]'} font-bold text-slate-100`}>
                  {`【${entry.keyword}】`}
                </span>
                <span className="text-[9px] font-mono text-slate-500">
                  {entry.category}
                </span>
              </div>
              <p className={`m-0 text-slate-300 ${compact ? 'text-[10px] leading-tight' : 'text-[11px] leading-relaxed'}`}>
                {entry.brief}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {hiddenCount > 0 && (
        <div className="text-[9px] font-mono text-slate-500 pt-0.5">
          另有 {hiddenCount} 条词条（点击或长按查看完整档案）
        </div>
      )}
    </div>
  );
}
