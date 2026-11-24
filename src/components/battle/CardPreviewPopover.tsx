import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GameState, CardInstanceId } from '../../game/types';
import { formatCellLabel } from '../../game/board';
import { getEffectiveAttackProfile, getEntityKind, getEntityStats, isFacilityDisabled } from '../../game/range';
import { CLASS_COLOR, CLASS_LABEL, STATUS_LABEL } from '../../client/gameData';
import { cardDefinitionOf, effectSummary } from '../cards/CardView';
import { getCardPresentation, getSummonPresentation } from '../../data/card-presentation';
import { extractCardKeywords } from '../../data/keywords';
import { OperatorPortrait } from '../cards/OperatorPortrait';
import { RARITY_THEMES } from '../ui/tokens';
import tacticalCardBackplate from '../../assets/images/tactical_card_backplate_1795070703422.jpg';

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
  /** 'hover' = 桌面悬停浮层 (pointer-events-none); 'pinned' = 移动端长按钉住浮层 (轻点空白关闭) */
  readonly mode?: 'hover' | 'pinned';
}

interface CardPreviewPopoverProps {
  readonly state: GameState;
  readonly hovered: HoveredCardPreview | null;
  readonly invalidReason?: string | null;
  readonly onDismiss?: () => void;
}

const DESKTOP_CARD_WIDTH = 248;
const DESKTOP_KEYWORD_WIDTH = 198;
const DESKTOP_GAP = 8;
const MOBILE_GAP = 6;
const DEFAULT_ESTIMATED_HEIGHT = 344;
const EDGE_PADDING = 10;
const SAFE_VIEWPORT_EDGE = 12;

export interface HearthstonePreviewLayout {
  readonly left: number;
  readonly top: number;
  readonly cardWidth: number;
  readonly keywordWidth: number;
  readonly gap: number;
  readonly totalWidth: number;
  readonly keywordSide: 'right' | 'left';
}

export function computeHearthstonePreviewLayout({
  anchorRect,
  viewportWidth,
  viewportHeight,
  estimatedHeight = DEFAULT_ESTIMATED_HEIGHT,
  hasKeywords = false,
}: {
  readonly anchorRect: HoveredCardPreview['rect'];
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly estimatedHeight?: number;
  readonly hasKeywords?: boolean;
}): HearthstonePreviewLayout {
  const isCompact = viewportWidth < 640;
  const edgePad = isCompact ? EDGE_PADDING : SAFE_VIEWPORT_EDGE;
  const gap = hasKeywords ? (isCompact ? MOBILE_GAP : DESKTOP_GAP) : 0;

  const cardWidth = isCompact
    ? hasKeywords
      ? Math.min(204, Math.max(176, Math.floor((viewportWidth - edgePad * 2 - gap) * 0.56)))
      : Math.min(244, Math.max(196, viewportWidth - edgePad * 2))
    : DESKTOP_CARD_WIDTH;

  const keywordWidth = hasKeywords
    ? isCompact
      ? Math.min(168, Math.max(132, viewportWidth - edgePad * 2 - cardWidth - gap))
      : DESKTOP_KEYWORD_WIDTH
    : 0;

  const totalWidth = cardWidth + gap + keywordWidth;
  const anchorCenterX = anchorRect.left + anchorRect.width / 2;
  const anchorCenterY = anchorRect.top + anchorRect.height / 2;
  const maxCompositeLeft = Math.max(edgePad, viewportWidth - totalWidth - edgePad);
  const maxTop = Math.max(edgePad, viewportHeight - estimatedHeight - edgePad);

  let keywordSide: 'right' | 'left' = 'right';
  if (hasKeywords) {
    const idealCardLeft = Math.min(
      Math.max(edgePad, anchorCenterX - cardWidth / 2),
      Math.max(edgePad, viewportWidth - cardWidth - edgePad),
    );
    const fitsRight = idealCardLeft + cardWidth + gap + keywordWidth <= viewportWidth - edgePad;
    const fitsLeft = idealCardLeft - gap - keywordWidth >= edgePad;
    if (fitsRight) {
      keywordSide = 'right';
    } else if (fitsLeft) {
      keywordSide = 'left';
    } else {
      keywordSide = anchorCenterX <= viewportWidth / 2 ? 'right' : 'left';
    }
  }

  let left: number;
  let top: number;

  // 1. 优先放在锚点上方（手牌区 / 下半区单位）
  const aboveTop = anchorRect.top - estimatedHeight - 10;
  if (aboveTop >= edgePad) {
    const rawCardLeft = anchorCenterX - cardWidth / 2;
    const rawCompositeLeft = keywordSide === 'right' ? rawCardLeft : rawCardLeft - gap - keywordWidth;
    left = Math.min(Math.max(edgePad, rawCompositeLeft), maxCompositeLeft);
    top = Math.round(aboveTop);
  } else {
    // 2. 上方空间不足时，优先放在锚点下方（敌方前/后排单位）
    const belowTop = anchorRect.bottom + 10;
    if (belowTop + estimatedHeight <= viewportHeight - edgePad) {
      const rawCardLeft = anchorCenterX - cardWidth / 2;
      const rawCompositeLeft = keywordSide === 'right' ? rawCardLeft : rawCardLeft - gap - keywordWidth;
      left = Math.min(Math.max(edgePad, rawCompositeLeft), maxCompositeLeft);
      top = Math.round(belowTop);
    } else {
      // 3. 上下空间都受限时（如棋盘中段或矮横屏），优先贴目标右侧/左侧放置避免遮挡棋格
      const rightCandidate = anchorRect.right + 12;
      const leftCandidate = anchorRect.left - totalWidth - 12;
      if (rightCandidate + totalWidth <= viewportWidth - edgePad) {
        left = rightCandidate;
        keywordSide = 'right';
      } else if (leftCandidate >= edgePad) {
        left = leftCandidate;
        keywordSide = 'left';
      } else {
        const rawCompositeLeft = anchorCenterX - totalWidth / 2;
        left = Math.min(Math.max(edgePad, rawCompositeLeft), maxCompositeLeft);
      }
      const idealTop = anchorCenterY - estimatedHeight / 2;
      top = Math.min(Math.max(edgePad, idealTop), maxTop);
    }
  }

  return {
    left: Math.round(left),
    top: Math.round(top),
    cardWidth,
    keywordWidth,
    gap,
    totalWidth,
    keywordSide,
  };
}

export function clampPopoverPosition(
  anchorRect: HoveredCardPreview['rect'],
  viewportWidth: number,
  viewportHeight: number,
  estimatedHeight: number = DEFAULT_ESTIMATED_HEIGHT,
): { readonly left: number; readonly top: number } {
  const layout = computeHearthstonePreviewLayout({
    anchorRect,
    viewportWidth,
    viewportHeight,
    estimatedHeight,
    hasKeywords: false,
  });
  return { left: layout.left, top: layout.top };
}

/**
 * 炉石传说风格战中卡牌预览浮层：
 * - 主卡面采用经典炉石分布：左上费用水晶、上方立绘+居中名称条、中下部单份效果描述框、左下攻击力 / 右下生命值角标
 * - 当前 V1.1 规则无主动技能与 SP，卡面不再重复渲染规则文本或展示 SP / 主动技能
 * - 卡牌侧边单独排列紧凑词条解释小框，自动根据屏幕剩余空间置于左或右侧
 */
export function CardPreviewPopover({ state, hovered, invalidReason, onDismiss }: CardPreviewPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(DEFAULT_ESTIMATED_HEIGHT);
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

  const isPinned = hovered.mode === 'pinned';
  const isBoardUnit = instance.zone === 'board';
  const entityKind = isBoardUnit ? getEntityKind(state, instance) : null;
  const basePresentation = getCardPresentation(instance.card_id);
  const presentation =
    entityKind === 'summon'
      ? getSummonPresentation(instance.summon_state?.token_id, basePresentation)
      : basePresentation;
  const rarity = presentation.rarity;
  const rarityTheme = RARITY_THEMES[rarity as keyof typeof RARITY_THEMES] ?? RARITY_THEMES[3];
  const supportSubtype =
    definition.card_type === 'support' ? (definition.support_subtype || '') : '';
  const isFacilityDef = supportSubtype === 'facility';
  const isEquipmentDef = supportSubtype === 'equipment';
  const classColor = isFacilityDef
    ? '#f59e0b'
    : isEquipmentDef
      ? '#06b6d4'
      : CLASS_COLOR[presentation.profession] ?? '#94a3b8';
  const classLabelZh = isFacilityDef
    ? '🏗️ 支援 · 设施'
    : isEquipmentDef
      ? '🔧 支援 · 装备'
      : CLASS_LABEL[presentation.profession] ?? presentation.profession;

  const entityStats = isBoardUnit ? getEntityStats(state, instance) : null;
  const attackProfile = isBoardUnit ? getEffectiveAttackProfile(state, instance) : null;
  const facilityDisabled = entityKind === 'facility' && isFacilityDisabled(state, instance);

  const keywords = extractCardKeywords(definition, instance);
  const maxKeywords = viewport.width < 640 ? 4 : 6;
  const visibleKeywords = keywords.slice(0, maxKeywords);
  const hiddenKeywordCount = Math.max(0, keywords.length - visibleKeywords.length);

  const layout = computeHearthstonePreviewLayout({
    anchorRect: hovered.rect,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    estimatedHeight: measuredHeight,
    hasKeywords: visibleKeywords.length > 0,
  });

  const isOperator = definition.card_type === 'operator';
  const isSummon = entityKind === 'summon';
  const hasCombatStats = isOperator || isSummon;
  const redeployCd = instance.operator_lifecycle?.redeploy_cd_remaining ?? 0;

  // V1.1 卡牌仅保留单份效果描述（不重复渲染 active_skill_text_zh）
  const rulesText = definition.rules_text_zh || effectSummary(definition);
  const liveCombat = isBoardUnit ? instance.operator_combat : undefined;
  const baseAtk = definition.atk ?? 0;
  const effectiveAtk = entityStats?.atk ?? baseAtk;
  const baseHp = definition.hp ?? 0;
  const effectiveHp = isBoardUnit && liveCombat ? liveCombat.current_hp : baseHp;
  const maxHp = entityStats?.maxHp ?? baseHp;
  const shield = isBoardUnit && liveCombat ? liveCombat.shield : 0;

  const atkDeltaColor =
    isBoardUnit && entityStats
      ? effectiveAtk > baseAtk
        ? 'text-emerald-300'
        : effectiveAtk < baseAtk
          ? 'text-amber-300'
          : 'text-rose-200'
      : 'text-rose-200';

  const hpDeltaColor =
    isBoardUnit && liveCombat && liveCombat.current_hp < maxHp ? 'text-amber-300' : 'text-emerald-200';

  const attackModeLabel =
    attackProfile?.mode === 'ranged'
      ? '远程'
      : attackProfile?.mode === 'support'
        ? '医疗'
        : definition.attack_type === 'ranged'
          ? '远程'
          : '近战';
  const deployRuleLabel =
    definition.deploy_rule === 'front_only'
      ? '仅前排'
      : definition.deploy_rule === 'back_only'
        ? '仅后排'
        : '全阵位';
  const cellLabel =
    isBoardUnit && instance.lane && instance.position
      ? formatCellLabel(state.board_profile, instance.lane, instance.position, instance.slot_index)
      : null;

  const damageTypeLabel =
    isOperator && attackProfile?.mode !== 'support' && definition.class !== 'medic'
      ? definition.damage_type === 'arts'
        ? '法术'
        : '物理'
      : null;
  const redeployBaseLabel =
    isOperator && typeof definition.redeploy_cd_base === 'number' && definition.redeploy_cd_base > 0
      ? `再部署${definition.redeploy_cd_base}回`
      : null;
  const operatorMetaParts = [
    attackModeLabel,
    damageTypeLabel,
    deployRuleLabel,
    definition.floating ? '浮空' : null,
    redeployBaseLabel,
  ].filter(Boolean);

  const cardTypeLabel =
    entityKind === 'facility' || isFacilityDef
      ? '场地设施 · 占格部署'
      : isSummon
        ? '召唤单位'
        : definition.card_type === 'tactic'
          ? '战术指令 · 一次性'
          : isEquipmentDef
            ? '干员装备 · 附着强化'
            : operatorMetaParts.join(' · ');

  const centerSubLabel =
    isSummon
      ? instance.summon_state?.taunt_scope !== 'none'
        ? '嘲讽召唤'
        : '召唤物'
      : definition.operator_subclass_zh
        ? `${classLabelZh} · ${definition.operator_subclass_zh}`
        : classLabelZh;

  const previewContent = (
    <div
      ref={popoverRef}
      role={isPinned ? 'dialog' : 'tooltip'}
      aria-modal={isPinned ? 'false' : undefined}
      data-testid="card-preview-popover"
      data-preview-mode={isPinned ? 'pinned' : 'hover'}
      data-keyword-side={layout.keywordSide}
      aria-label={`${definition.card_name_zh} 卡牌详情预览`}
      className={`fixed z-50 max-h-[calc(100dvh-20px)] ${
        isPinned ? 'pointer-events-auto overflow-y-auto overscroll-contain' : 'pointer-events-none'
      } animate-fade-in`}
      style={{
        left: `${layout.left}px`,
        top: `${layout.top}px`,
        width: `${layout.totalWidth}px`,
      }}
      onPointerDown={(e) => {
        if (!isPinned) return;
        e.stopPropagation();
        onDismiss?.();
      }}
    >
      <div
        className={`flex items-start ${layout.keywordSide === 'left' ? 'flex-row-reverse' : 'flex-row'}`}
        style={{ gap: `${layout.gap}px` }}
      >
        {/* 主卡面：炉石传说布局（左上费用 / 上方立绘+居中名称条 / 中下效果框 / 左下攻击 + 右下血量） */}
        <div className="flex flex-col shrink-0" style={{ width: `${layout.cardWidth}px` }}>
          <article
            data-testid="magnified-card-preview"
            className="board-chamfer-sm relative overflow-hidden bg-[#0e131b] border shadow-[0_14px_34px_rgba(0,0,0,0.82)] flex flex-col"
            style={{
              width: `${layout.cardWidth}px`,
              borderColor: `${rarityTheme.color}99`,
            }}
          >
            {/* 钛金碳纤维机械背板与稀有度顶光 */}
            <img
              src={tacticalCardBackplate}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="pointer-events-none select-none absolute inset-0 w-full h-full object-cover opacity-[0.26]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: `radial-gradient(circle at 86% 6%, ${rarityTheme.color}30 0%, transparent 56%)`,
              }}
            />

            {/* 顶部区域：立绘视窗 + 左上角悬浮 CP 费用晶体 + 右上角职业星级 + 下沿居中名牌横幅 */}
            <div
              className={`relative z-10 ${
                viewport.height < 520 ? 'h-[92px]' : 'h-[124px] sm:h-[150px]'
              } w-full overflow-hidden border-b border-[#2c3849]`}
            >
              <OperatorPortrait
                cardId={instance.card_id}
                presentation={presentation}
                variant="portrait"
                className="w-full h-full"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(8,12,18,0.58) 0%, transparent 32%, rgba(9,13,19,0.72) 70%, rgba(10,14,20,0.98) 100%)',
                }}
              />

              {/* 左上角：CP 费用徽章 + 再部署冷却 */}
              <div className="absolute top-2 left-2 flex items-center gap-1.5">
                <div
                  data-testid="card-cost-badge"
                  className={`flex items-baseline gap-0.5 px-2 py-0.5 font-mono font-black shadow-lg ${
                    invalidReason && !isBoardUnit
                      ? 'bg-slate-900 text-rose-300 border border-rose-500/75'
                      : 'bg-[#e5a52b] text-slate-950'
                  }`}
                  style={{ clipPath: 'polygon(12% 0, 100% 0, 88% 100%, 0 100%)' }}
                >
                  <span className="text-[9px] font-sans">CP</span>
                  <span className="text-sm sm:text-base leading-none tabular-nums">{definition.cost}</span>
                </div>
                {redeployCd > 0 && (
                  <span className="px-1.5 py-0.5 bg-amber-950/90 border border-amber-500/70 text-[9px] font-mono font-bold text-amber-300 leading-none">
                    冷却 {redeployCd}
                  </span>
                )}
              </div>

              {/* 右上角：职业 / 支援子类与稀有度星级 */}
              <div className="absolute top-2 right-2 flex flex-col items-end gap-0.5">
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 border-r-2 leading-none ${
                    isFacilityDef
                      ? 'bg-amber-950/92 text-amber-200 border border-amber-500/65'
                      : isEquipmentDef
                        ? 'bg-cyan-950/92 text-cyan-200 border border-cyan-500/65'
                        : 'bg-[#0a0e14]/90 text-slate-100'
                  }`}
                  style={{ borderRightColor: classColor }}
                >
                  {classLabelZh}
                </span>
                <span
                  className="text-[9px] font-mono font-bold px-1 bg-[#0a0e14]/80 leading-tight tracking-tight"
                  style={{ color: rarityTheme.color }}
                >
                  {'★'.repeat(rarity)}
                </span>
              </div>

              {/* 立绘下沿：炉石式居中卡名横幅 */}
              <div className="absolute inset-x-2 bottom-1.5 px-2.5 py-1 bg-[#0d121a]/92 border border-[#3a485a] text-center shadow-md">
                <div className="flex items-baseline justify-center gap-1.5">
                  <h4 className="m-0 text-sm sm:text-[15px] font-black text-white tracking-wide truncate">
                    {isSummon ? presentation.codeNameZh : definition.card_name_zh}
                  </h4>
                  <span className="text-[9px] font-mono text-slate-400 uppercase truncate max-w-[42%]">
                    {presentation.codeNameEn}
                  </span>
                </div>
                <div className="flex items-center justify-center flex-wrap gap-x-1.5 text-[9px] sm:text-[10px] font-mono text-slate-300 leading-tight mt-0.5">
                  <span>{cardTypeLabel}</span>
                  {cellLabel && (
                    <>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="text-amber-300 font-bold">{cellLabel}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 中下部：单份效果描述框（与在场附加状态/装备） */}
            <div className="relative z-10 px-2.5 pt-2 pb-1.5">
              <div
                data-testid="card-rules-box"
                className="bg-[#121822]/95 border border-[#2a3647] px-2.5 sm:px-3 py-2 space-y-1.5 text-[10px] sm:text-[11px] leading-relaxed min-h-[58px] flex flex-col justify-center"
              >
                {rulesText && (
                  <p className="m-0 text-slate-100 text-center">{rulesText}</p>
                )}

                {liveCombat?.equipped_package && (
                  <div className="pt-1 border-t border-[#222c3a] text-[10px] font-mono text-emerald-300 text-center">
                    🔧 已装备：{liveCombat.equipped_package.card_name_zh}
                  </div>
                )}

                {liveCombat && liveCombat.statuses.length > 0 && (
                  <div className="pt-1 border-t border-[#222c3a] text-[10px] font-mono text-rose-200 flex flex-wrap justify-center gap-x-2 gap-y-0.5">
                    {liveCombat.statuses.map((s, idx) => (
                      <span key={`${s.kind}-${s.status_id ?? s.applied_sequence ?? idx}`}>
                        {STATUS_LABEL[s.kind] ?? s.kind} {s.remaining_owner_turns}回
                      </span>
                    ))}
                  </div>
                )}

                {invalidReason && (
                  <div className="pt-1 border-t border-rose-500/35 text-[10px] font-bold text-rose-300 text-center">
                    ⚠️ {invalidReason}
                  </div>
                )}
              </div>
            </div>

            {/* 底部角标栏：炉石经典 左下攻击力 / 中间分支标识 / 右下生命值（无 SP） */}
            <div className="relative z-10 px-2 pb-2 pt-0.5 flex items-end justify-between gap-1.5 font-mono tabular-nums">
              {hasCombatStats ? (
                <>
                  {/* 左下角：攻击力徽章 */}
                  <div
                    data-testid="card-atk-badge"
                    className="flex items-baseline gap-1 px-2.5 py-1 bg-[#1e1217] border border-rose-500/75 shadow-md shrink-0"
                    style={{ clipPath: 'polygon(0 0, 86% 0, 100% 28%, 100% 100%, 14% 100%, 0 72%)' }}
                  >
                    <span className="text-[9px] font-bold text-rose-300/85">ATK</span>
                    <span className={`text-sm sm:text-base font-black leading-none ${atkDeltaColor}`}>
                      {effectiveAtk}
                    </span>
                  </div>

                  {/* 中间：干员分支 / 职业标识 */}
                  <span className="text-[9px] text-slate-400 tracking-wide truncate pb-1 text-center min-w-0">
                    {centerSubLabel}
                  </span>

                  {/* 右下角：生命值徽章（含护盾） */}
                  <div
                    data-testid="card-hp-badge"
                    className="flex items-baseline gap-1 px-2.5 py-1 bg-[#0e1f19] border border-emerald-500/75 shadow-md shrink-0"
                    style={{ clipPath: 'polygon(14% 0, 100% 0, 100% 72%, 86% 100%, 0 100%, 0 28%)' }}
                  >
                    <span className="text-[9px] font-bold text-emerald-300/85">HP</span>
                    <span className={`text-sm sm:text-base font-black leading-none ${hpDeltaColor}`}>
                      {effectiveHp}
                    </span>
                    {isBoardUnit && effectiveHp < maxHp && (
                      <span className="text-[9px] text-slate-400 leading-none">/{maxHp}</span>
                    )}
                    {shield > 0 && (
                      <span className="text-[9px] font-bold text-sky-300 leading-none">
                        (+{shield}盾)
                      </span>
                    )}
                  </div>
                </>
              ) : entityKind === 'facility' && liveCombat && entityStats ? (
                <>
                  <span className="text-[10px] font-bold text-amber-300 pb-0.5 pl-0.5">
                    {facilityDisabled ? '⏸ 已瘫痪' : '⚙ 生效中'} · 余{instance.facility_state?.remaining_turns ?? 1}回
                  </span>
                  <div
                    data-testid="card-hp-badge"
                    className="flex items-baseline gap-1 px-2.5 py-1 bg-[#0e1f19] border border-emerald-500/75 shadow-md shrink-0"
                    style={{ clipPath: 'polygon(14% 0, 100% 0, 100% 72%, 86% 100%, 0 100%, 0 28%)' }}
                  >
                    <span className="text-[9px] font-bold text-emerald-300/85">HP</span>
                    <span className={`text-sm font-black leading-none ${hpDeltaColor}`}>
                      {effectiveHp}
                    </span>
                    <span className="text-[9px] text-slate-400 leading-none">/{entityStats.maxHp}</span>
                  </div>
                </>
              ) : isFacilityDef ? (
                <>
                  <span className="text-[10px] font-bold text-amber-200 bg-amber-950/80 border border-amber-500/55 px-1.5 py-0.5">
                    🏗️ 占格部署 · 持续{definition.facility_duration ?? 3}回合
                  </span>
                  <div
                    data-testid="card-hp-badge"
                    className="flex items-baseline gap-1 px-2.5 py-1 bg-[#0e1f19] border border-emerald-500/75 shadow-md shrink-0"
                    style={{ clipPath: 'polygon(14% 0, 100% 0, 100% 72%, 86% 100%, 0 100%, 0 28%)' }}
                  >
                    <span className="text-[9px] font-bold text-emerald-300/85">HP</span>
                    <span className="text-sm font-black leading-none text-emerald-200">{definition.hp ?? 3}</span>
                  </div>
                </>
              ) : isEquipmentDef ? (
                <div className="w-full flex items-center justify-between px-1.5 py-1 bg-cyan-950/70 border border-cyan-500/50 text-[10px] font-bold text-cyan-200">
                  <span>🔧 附着友方单位（限装 1 件）</span>
                  <span className="text-amber-300">{definition.cost} CP</span>
                </div>
              ) : (
                <div className="w-full flex items-center justify-between px-1 py-0.5 text-[10px] font-bold text-slate-300 border-t border-[#222c3a]">
                  <span>{cardTypeLabel}</span>
                  <span className="text-amber-300">{definition.cost} CP</span>
                </div>
              )}
            </div>
          </article>

          {isPinned && (
            <div className="mt-1 px-2.5 py-1 bg-[#080c12]/92 border border-[#2c3849] text-center text-[9px] font-mono text-slate-300 shadow-md">
              轻点任意处关闭预览
            </div>
          )}
        </div>

        {/* 卡牌侧边独立词条解释小框列（仿炉石传说侧边词条气泡） */}
        {visibleKeywords.length > 0 && (
          <aside
            data-testid="keyword-side-callouts"
            aria-label="词条简要说明"
            className="flex flex-col gap-1.5 shrink-0"
            style={{ width: `${layout.keywordWidth}px` }}
          >
            {visibleKeywords.map((entry) => (
              <div
                key={entry.keyword}
                data-testid="keyword-callout-box"
                className="board-chamfer-sm bg-[#0d1219]/96 border border-[#3a485a] shadow-[0_8px_20px_rgba(0,0,0,0.72)] px-2.5 py-1.5"
              >
                <div className="flex items-baseline justify-between gap-1.5 mb-0.5">
                  <span className="text-[11px] sm:text-xs font-bold text-[#e5a52b] leading-tight">
                    {entry.keyword}
                  </span>
                  <span className="text-[9px] font-mono text-slate-400 shrink-0 leading-none">
                    {entry.category}
                  </span>
                </div>
                <p className="m-0 text-[10px] sm:text-[11px] text-slate-200 leading-snug">
                  {entry.brief}
                </p>
              </div>
            ))}
            {hiddenKeywordCount > 0 && (
              <div className="board-chamfer-sm bg-[#0d1219]/92 border border-[#2b3646] px-2 py-1 text-[9px] font-mono text-slate-400">
                另有 {hiddenKeywordCount} 条相关词条
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );

  if (isPinned) {
    return (
      <div
        data-testid="card-preview-backdrop"
        className="fixed inset-0 z-50 bg-black/35 animate-fade-in"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDismiss?.();
        }}
      >
        {previewContent}
      </div>
    );
  }

  return previewContent;
}
