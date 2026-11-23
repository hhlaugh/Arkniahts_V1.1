import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GameState, CardInstanceId } from '../../game/types';
import { getEntityKind, getEntityStats, isFacilityDisabled } from '../../game/range';
import { STATUS_LABEL } from '../../client/gameData';
import { cardDefinitionOf } from '../cards/CardView';
import { getCardPresentation } from '../../data/card-presentation';
import { CardFrame } from '../cards/CardFrame';
import { KeywordGlossary } from '../cards/KeywordGlossary';

export interface HoveredCardPreview {
  readonly instanceId: CardInstanceId;
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly width: number;
    readonly height: number;
  };
}

interface CardPreviewPopoverProps {
  readonly state: GameState;
  readonly hovered: HoveredCardPreview | null;
  readonly invalidReason?: string | null;
}

const POPOVER_WIDTH = 264;
const POPOVER_ESTIMATED_HEIGHT = 430;
const EDGE_PADDING = 12;

export function clampPopoverPosition(
  anchorRect: HoveredCardPreview['rect'],
  viewportWidth: number,
  viewportHeight: number,
  estimatedHeight: number = POPOVER_ESTIMATED_HEIGHT,
): { readonly left: number; readonly top: number } {
  const maxLeft = Math.max(EDGE_PADDING, viewportWidth - POPOVER_WIDTH - EDGE_PADDING);
  const maxTop = Math.max(EDGE_PADDING, viewportHeight - estimatedHeight - EDGE_PADDING);

  // 1. 优先尝试放在悬停目标上方（手牌、下半区单位）
  const aboveTop = anchorRect.top - estimatedHeight - 10;
  if (aboveTop >= EDGE_PADDING) {
    const centerX = anchorRect.left + anchorRect.width / 2;
    const left = Math.min(Math.max(EDGE_PADDING, centerX - POPOVER_WIDTH / 2), maxLeft);
    return { left: Math.round(left), top: Math.round(aboveTop) };
  }

  // 2. 若上方空间不足（敌方后排/上区单位），优先翻至目标下方，避免遮挡目标本身
  const belowTop = anchorRect.bottom + 10;
  if (belowTop + estimatedHeight <= viewportHeight - EDGE_PADDING) {
    const centerX = anchorRect.left + anchorRect.width / 2;
    const left = Math.min(Math.max(EDGE_PADDING, centerX - POPOVER_WIDTH / 2), maxLeft);
    return { left: Math.round(left), top: Math.round(belowTop) };
  }

  // 3. 若上下空间均受限（中区在场单位），优先放置于目标右侧或左侧，不遮挡格子
  const rightCandidate = anchorRect.right + 12;
  const leftCandidate = anchorRect.left - POPOVER_WIDTH - 12;
  let left: number;
  if (rightCandidate + POPOVER_WIDTH <= viewportWidth - EDGE_PADDING) {
    left = rightCandidate;
  } else if (leftCandidate >= EDGE_PADDING) {
    left = leftCandidate;
  } else {
    const centerX = anchorRect.left + anchorRect.width / 2;
    left = Math.min(Math.max(EDGE_PADDING, centerX - POPOVER_WIDTH / 2), maxLeft);
  }

  const idealTop = anchorRect.top + anchorRect.height / 2 - estimatedHeight / 2;
  const top = Math.min(Math.max(EDGE_PADDING, idealTop), maxTop);

  return { left: Math.round(left), top: Math.round(top) };
}

/**
 * 桌面端卡牌/在场单位悬停浮层预览：
 * - 仅在鼠标悬停停留达到阈值后触发，不与移动端长按冲突
 * - 实时测量浮层实际高度后再做边缘钳位，保证高星多词条卡牌也绝不裁切或遮挡手牌
 */
export function CardPreviewPopover({ state, hovered, invalidReason }: CardPreviewPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(POPOVER_ESTIMATED_HEIGHT);
  const [viewport, setViewport] = useState<{ width: number; height: number }>(() => {
    if (typeof window === 'undefined') return { width: 1280, height: 800 };
    return { width: window.innerWidth, height: window.innerHeight };
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    if (!hovered || !popoverRef.current) return;
    const h = popoverRef.current.offsetHeight;
    if (h > 0) {
      setMeasuredHeight((prev) => (Math.abs(prev - h) > 2 ? h : prev));
    }
  }, [hovered, invalidReason, viewport.width, viewport.height]);

  if (!hovered) return null;

  const instance = state.card_instances[hovered.instanceId];
  const definition = cardDefinitionOf(state, hovered.instanceId);
  if (!instance || !definition) return null;

  const presentation = getCardPresentation(instance.card_id);
  const isBoardUnit = instance.zone === 'board';
  const entityKind = isBoardUnit ? getEntityKind(state, instance) : null;
  const entityStats = isBoardUnit ? getEntityStats(state, instance) : null;
  const facilityDisabled = entityKind === 'facility' && isFacilityDisabled(state, instance);

  const pos = clampPopoverPosition(hovered.rect, viewport.width, viewport.height, measuredHeight);

  return (
    <div
      ref={popoverRef}
      role="tooltip"
      data-testid="card-preview-popover"
      aria-label={`${definition.card_name_zh} 卡牌详情预览`}
      className="fixed z-40 pointer-events-none animate-fade-in"
      style={{ left: `${pos.left}px`, top: `${pos.top}px`, width: `${POPOVER_WIDTH}px` }}
    >
      <div className="board-chamfer-sm bg-[#0f131a]/97 border border-[#3a4656] shadow-[0_6px_18px_rgba(0,0,0,0.68)] p-2 flex flex-col gap-1.5">
        <div className="flex justify-center">
          <CardFrame
            cardId={instance.card_id}
            definition={definition}
            presentation={presentation}
            variant="preview"
            interactive={false}
            redeployCd={instance.operator_lifecycle?.redeploy_cd_remaining ?? 0}
            className="w-full max-w-[238px] min-h-[240px]"
          />
        </div>

        {/* 在场单位实时作战状态 */}
        {isBoardUnit && instance.operator_combat && entityStats && (
          <div className="px-2 py-1.5 bg-[#0a0d12] border border-[#283342] font-mono text-[10px] space-y-1">
            <div className="flex items-center justify-between text-slate-300 tabular-nums">
              <span className="text-emerald-300 font-bold">
                HP {instance.operator_combat.current_hp}/{entityStats.maxHp}
                {instance.operator_combat.shield > 0 ? ` (+${instance.operator_combat.shield}盾)` : ''}
              </span>
              {entityKind === 'facility' ? (
                <span className="text-amber-300 font-bold">
                  {facilityDisabled ? '⏸ 瘫痪' : '⚙ 生效'} · 余{instance.facility_state?.remaining_turns ?? 1}回
                </span>
              ) : (
                <span className="text-slate-200 font-bold">
                  <span className="text-rose-300">ATK {entityStats.atk}</span>
                  <span className="text-slate-600 mx-1">·</span>
                  <span className="text-sky-300">
                    SP {instance.operator_combat.current_sp}/{definition.max_sp ?? 5}
                  </span>
                </span>
              )}
            </div>
            {instance.operator_combat.statuses.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {instance.operator_combat.statuses.map((s) => (
                  <span
                    key={`${s.kind}-${s.status_id ?? s.applied_sequence ?? ''}`}
                    className="px-1 py-0.2 bg-rose-950/80 border border-rose-500/50 text-rose-200 text-[9px]"
                  >
                    {STATUS_LABEL[s.kind] ?? s.kind} ({s.remaining_owner_turns}回)
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {(definition.rules_text_zh || definition.active_skill_text_zh) && (
          <div className="px-2 py-1.5 bg-[#0b0f15] border border-[#25303e] text-[10px] text-slate-200 space-y-1 leading-snug">
            {definition.rules_text_zh && <p className="m-0">{definition.rules_text_zh}</p>}
            {definition.active_skill_text_zh && (
              <p className="m-0 text-sky-300">
                ⚡ 主动 ({definition.active_skill_sp_cost ?? 0} SP): {definition.active_skill_text_zh}
              </p>
            )}
          </div>
        )}

        {/* 词条简要说明 */}
        <KeywordGlossary
          definition={definition}
          instance={instance}
          compact
          maxItems={4}
        />

        {invalidReason ? (
          <div className="px-2 py-1 bg-rose-950/90 border border-rose-500/60 text-rose-200 text-[10px] font-bold">
            ⚠️ {invalidReason}
          </div>
        ) : (
          <div className="flex items-center justify-between px-1 text-[9px] font-mono text-slate-400">
            <span>{isBoardUnit ? '单击选中单位' : '单击选中卡牌'}</span>
            <span>
              {isBoardUnit
                ? '双击可快速发动主动技'
                : definition.card_type === 'operator'
                  ? '拖放或点高亮格部署'
                  : '单击后选目标'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
