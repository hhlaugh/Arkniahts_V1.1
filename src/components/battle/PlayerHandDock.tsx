import React from 'react';
import type { CardInstanceId, GameState, PlayerId } from '../../game/types';
import { CardView, cardDefinitionOf } from '../cards/CardView';
import { Button } from '../ui/Button';
import { ScenicBannerLayer } from '../ui/ScenicBackdrop';
import { BaseHpBar } from './BaseHpBar';
import type { HoveredCardPreview } from './CardPreviewPopover';
import titaniumHudSurface from '../../assets/images/titanium_hud_surface_1795070730280.jpg';

interface PlayerHandDockProps {
  readonly state: GameState;
  readonly bottomPlayer: PlayerId;
  readonly actor: PlayerId;
  readonly canAct: boolean;
  readonly isActionPhase: boolean;
  readonly hasPending: boolean;
  readonly isHotseat: boolean;
  readonly isMobile: boolean;
  readonly isLandscape?: boolean;
  readonly layoutMode?: 'bottom' | 'side-rail';
  readonly selection: CardInstanceId | null;
  readonly draggingCardId: CardInstanceId | null;
  readonly allyBaseDamageDelta?: number | null;
  readonly disableMotion?: boolean;
  readonly selectionPrompt?: React.ReactNode;
  readonly idlePrompt?: React.ReactNode;
  readonly onHandCardClick: (id: CardInstanceId) => void;
  readonly onLongPressCard: (id: CardInstanceId, rect?: DOMRect) => void;
  readonly onHoverCard: (preview: HoveredCardPreview | null) => void;
  readonly onDragStartCard: (id: CardInstanceId, e: React.DragEvent) => void;
  readonly onDragEndCard: () => void;
  readonly onTouchStartCardCandidate?: (
    id: CardInstanceId,
    e: React.PointerEvent<HTMLDivElement>,
    layoutMode: 'bottom' | 'side-rail',
  ) => void;
  readonly onEndActionPhase: () => void;
}

const CP_CAP_GAUGE = 10;
const BASE_HP_MAX = 20;

/**
 * 己方指挥面板与手牌托盘 (PlayerHandDock)
 * 自适应双布局模式：
 * - `bottom`（竖屏手机 / 平板 / 桌面默认）：底部横向托盘，显示基地 HP(20)、CP 与本回合上限
 * - `side-rail`（手机横屏 / 超矮视口）：右侧战术侧栏
 */
export function PlayerHandDock({
  state,
  bottomPlayer,
  actor,
  canAct,
  isActionPhase,
  hasPending,
  isHotseat,
  isMobile,
  layoutMode = 'bottom',
  selection,
  draggingCardId,
  allyBaseDamageDelta = null,
  disableMotion = false,
  selectionPrompt,
  idlePrompt,
  onHandCardClick,
  onLongPressCard,
  onHoverCard,
  onDragStartCard,
  onDragEndCard,
  onTouchStartCardCandidate,
  onEndActionPhase,
}: PlayerHandDockProps) {
  const playerAlly = state.players[bottomPlayer];
  const isAllyTurn = actor === bottomPlayer;
  const canEndTurn = canAct && isActionPhase && !hasPending && isAllyTurn;
  const allyHit = allyBaseDamageDelta !== null && allyBaseDamageDelta > 0;
  const turnCpCap = playerAlly.turn_cp_cap || 3;
  const litPips = Math.min(CP_CAP_GAUGE, Math.max(0, playerAlly.cost));
  const canInteractHand = isActionPhase && !hasPending && isAllyTurn && canAct;
  const handTrayRef = React.useRef<HTMLDivElement>(null);

  const handleTrayWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = handTrayRef.current;
    if (!el || el.scrollWidth <= el.clientWidth + 2) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
      onHoverCard(null);
    }
  };

  if (layoutMode === 'side-rail') {
    return (
      <section
        data-testid="player-hand-dock"
        onClick={(e) => e.stopPropagation()}
        className="relative overflow-hidden w-[228px] sm:w-[254px] h-full min-h-0 bg-[#0e131b] border-l border-[#263244] shrink-0 flex flex-col z-20 shadow-[-8px_0_24px_rgba(0,0,0,0.45)]"
      >
        <ScenicBannerLayer scene="rhodes-command" fade="right" opacityClassName="opacity-24" />
        <img
          src={titaniumHudSurface}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          className="pointer-events-none select-none absolute inset-0 w-full h-full object-cover opacity-[0.2]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 bottom-0 w-[1.5px] bg-gradient-to-b from-cyan-300/75 via-sky-400/45 to-amber-400/55 z-20"
        />
        {/* 侧栏顶部：我方 HP + DP + 结束行动 */}
        <div
          className={`relative z-10 p-2 bg-[#111824]/92 border-b space-y-1.5 shrink-0 transition-colors ${
            allyHit
              ? `border-rose-400 bg-rose-950/30 ${disableMotion ? '' : 'anim-base-hit'}`
              : isAllyTurn
                ? 'border-sky-500/45'
                : 'border-[#212b3a]'
          }`}
        >
          <div className="flex items-center justify-between gap-1.5">
            <div className="relative flex items-center gap-1.5 font-mono tabular-nums">
              <span className="px-1 py-0.2 bg-sky-500 text-slate-950 font-black text-[10px] tracking-wider uppercase shrink-0">
                {isHotseat ? (bottomPlayer === 'player_a' ? 'A方' : 'B方') : '我方'}
              </span>
              <span className="text-[10px] text-sky-400 font-bold">HP</span>
              <strong className={`text-sm font-black leading-none ${allyHit ? 'text-rose-300' : 'text-sky-300'}`}>
                {playerAlly.base_points}
              </strong>
              <span className="text-[9px] text-slate-500">/{BASE_HP_MAX}</span>
              {allyHit && !disableMotion && (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-4 left-2 px-1 py-0.2 bg-rose-950/95 border border-rose-400 text-rose-200 font-mono font-black text-[10px] pointer-events-none z-50 anim-float-number"
                >
                  -{allyBaseDamageDelta}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 text-[10px] font-mono tabular-nums text-slate-400">
              <span>
                手<strong className="text-slate-100">{playerAlly.hand.length}</strong>
              </span>
              <span>·</span>
              <span>
                库<strong className="text-slate-100">{playerAlly.deck.length}</strong>
              </span>
            </div>
          </div>

          <BaseHpBar
            currentHp={playerAlly.base_points}
            maxHp={BASE_HP_MAX}
            side="ally"
            isHit={allyHit}
            compact
            label="己方基本分"
            className="w-full"
          />

          <div
            className="flex items-center justify-between gap-2 font-mono tabular-nums"
            aria-label={`当前可用费用 ${playerAlly.cost} / ${turnCpCap} CP（回合结束清零）`}
            title={`当前可用 ${playerAlly.cost} CP，本回合上限 ${turnCpCap} CP，回合结束清零`}
          >
            <div className="flex items-baseline gap-0.5">
              <span className="text-[10px] text-amber-400 font-bold">CP</span>
              <strong className="text-sm font-black text-amber-300 leading-none">{playerAlly.cost}</strong>
              <span className="text-[9px] text-amber-500/75">/{turnCpCap}</span>
            </div>
            <div className="flex items-center gap-[2px] flex-1 justify-end" aria-hidden="true">
              {Array.from({ length: CP_CAP_GAUGE }, (_, idx) => {
                const active = idx < litPips;
                const withinCap = idx < turnCpCap;
                return (
                  <span
                    key={idx}
                    className={`w-1.5 h-2.5 transition-colors ${
                      active
                        ? 'bg-[#e5a52b] shadow-[0_0_4px_rgba(229,165,43,0.45)]'
                        : withinCap
                          ? 'bg-[#1f2836] border border-[#3a4a63]'
                          : 'bg-[#131820] border border-[#222b3a] opacity-40'
                    }`}
                  />
                );
              })}
            </div>
          </div>

          <Button
            variant={canEndTurn ? 'primary' : 'ghost'}
            size="sm"
            cornerCut
            disabled={!canEndTurn}
            onClick={onEndActionPhase}
            className={`w-full text-xs min-h-[34px] font-bold whitespace-nowrap transition-all ${
              canEndTurn
                ? 'ring-1 ring-amber-400/50 shadow-[0_0_12px_rgba(229,165,43,0.35)]'
                : 'opacity-45 border border-slate-700/70'
            }`}
          >
            结束行动 ▶
          </Button>
        </div>

        {/* 选中提示条 */}
        {selectionPrompt && (
          <div className="relative z-10 px-2 py-1.5 bg-[#16202e]/95 border-b border-[#29384d] flex flex-col gap-1 text-[11px] text-amber-300 shrink-0">
            {selectionPrompt}
          </div>
        )}

        {/* 手牌双列纵向滚动网格 */}
        <div
          className={`relative z-10 flex-1 min-h-0 p-1.5 ${
            draggingCardId ? 'overflow-hidden touch-none' : 'overflow-y-auto overscroll-contain'
          }`}
        >
          {playerAlly.hand.length === 0 ? (
            <div className="w-full text-center py-6 text-xs text-slate-500 font-mono">
              （暂无手牌）
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 content-start">
              {playerAlly.hand.map((id) => {
                const def = cardDefinitionOf(state, id);
                const canDragCard =
                  !isMobile &&
                  canInteractHand &&
                  (def?.card_type === 'operator' || def?.card_type === 'facility' || (def?.card_type === 'support' && def?.support_subtype === 'facility'));
                return (
                  <CardView
                    key={id}
                    state={state}
                    instanceId={id}
                    variant="compact"
                    selected={selection === id}
                    interactive={canInteractHand}
                    draggable={canDragCard}
                    touchActionMode="pan-y"
                    isTouchDragging={draggingCardId === id}
                    onClick={() => onHandCardClick(id)}
                    onLongPress={(rect) => {
                      onHoverCard(null);
                      onLongPressCard(id, rect);
                    }}
                    onHoverStart={(rect) => {
                      if (!draggingCardId) {
                        onHoverCard({ instanceId: id, rect });
                      }
                    }}
                    onHoverEnd={() => onHoverCard(null)}
                    onDragStart={(e) => onDragStartCard(id, e)}
                    onDragEnd={onDragEndCard}
                    onTouchPointerDown={(e) => {
                      if (canInteractHand) {
                        onTouchStartCardCandidate?.(id, e, 'side-rail');
                      }
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      data-testid="player-hand-dock"
      onClick={(e) => e.stopPropagation()}
      className="relative overflow-hidden bg-[#0e131b] border-t border-[#263244] shrink-0 flex flex-col pb-safe z-20 shadow-[0_-8px_24px_rgba(0,0,0,0.45)]"
    >
      <ScenicBannerLayer scene="rhodes-command" fade="right" opacityClassName="opacity-24" />
      <img
        src={titaniumHudSurface}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        className="pointer-events-none select-none absolute inset-0 w-full h-full object-cover opacity-[0.2]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 inset-x-0 h-[1.5px] bg-gradient-to-r from-cyan-400/20 via-cyan-300/70 to-amber-400/50 z-20"
      />
      {/* 0. 固定高度的整合式战术引导/选中指令条（彻底杜绝悬停或选中时棋盘上下跳动） */}
      <div className="relative z-10 min-h-[34px] px-2 sm:px-3.5 py-1 bg-[#131b27]/95 border-b border-[#253245] flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2 text-xs">
        {selectionPrompt ?? (
          <div className="flex items-center justify-between gap-2 w-full text-[11px] text-slate-400 min-w-0">
            <span className="truncate">
              {idlePrompt ??
                (canInteractHand
                  ? isMobile
                    ? '轻点选牌 / 上拉拖牌部署；长按任意卡牌或单位查看详情与词条。'
                    : '单击或拖放手牌部署；鼠标悬停卡牌或单位片刻预览详情与词条。'
                  : hasPending
                    ? '请先完成上方待决战术选择。'
                    : '等待对手行动中…')}
            </span>
          </div>
        )}
      </div>

      {/* 1. 己方指挥核心条：自适应单行紧凑分区（360px 窄屏绝不挤压换行） */}
      <div
        className={`relative z-10 flex items-center justify-between gap-1.5 sm:gap-2.5 px-2 sm:px-4 py-1 sm:py-1.5 bg-[#111824]/92 border-b transition-colors ${
          allyHit
            ? `border-rose-400 bg-rose-950/30 ${disableMotion ? '' : 'anim-base-hit'}`
            : isAllyTurn
              ? 'border-sky-500/45'
              : 'border-[#212b3a]'
        }`}
      >
        {/* 左侧：我方基地 HP 区块 + DP 10格能量条 */}
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          {/* 阵营与基地 HP */}
          <div className="relative flex items-center gap-1 sm:gap-2 shrink-0">
            <span className="px-1 sm:px-1.5 py-0.5 bg-sky-500 text-slate-950 font-black text-[10px] sm:text-xs tracking-wider uppercase shrink-0 whitespace-nowrap">
              {isHotseat ? (
                <>
                  <span className="hidden sm:inline">
                    {bottomPlayer === 'player_a' ? '玩家 A (行动方)' : '玩家 B (行动方)'}
                  </span>
                  <span className="sm:hidden">{bottomPlayer === 'player_a' ? 'A方' : 'B方'}</span>
                </>
              ) : (
                <>
                  <span className="hidden sm:inline">我方基地</span>
                  <span className="sm:hidden">我方</span>
                </>
              )}
            </span>

            <div className="relative flex items-center gap-1 sm:gap-1.5 font-mono tabular-nums">
              <div className="flex items-baseline gap-0.5 sm:gap-1">
                <span className="text-[9px] sm:text-[10px] text-sky-400 font-bold">HP</span>
                <strong
                  className={`text-sm sm:text-2xl font-black leading-none ${
                    allyHit ? 'text-rose-300' : 'text-sky-300'
                  }`}
                >
                  {playerAlly.base_points}
                </strong>
                <span className="text-[9px] sm:text-[10px] text-slate-500">/{BASE_HP_MAX}</span>
              </div>
              <BaseHpBar
                currentHp={playerAlly.base_points}
                maxHp={BASE_HP_MAX}
                side="ally"
                isHit={allyHit}
                label="己方基本分"
                className="w-16 sm:w-28 md:w-36 shrink-0"
              />
              {allyHit && !disableMotion && (
                <span
                  aria-hidden="true"
                  className="absolute -top-4 left-2 px-1 py-0.2 bg-rose-950/95 border border-rose-400 text-rose-200 font-mono font-black text-[10px] pointer-events-none z-50 anim-float-number"
                >
                  -{allyBaseDamageDelta}
                </span>
              )}
            </div>
          </div>

          <span className="h-3.5 sm:h-4 w-px bg-[#293548] shrink-0" aria-hidden="true" />

          {/* 战术费用 CP 与本回合上限 */}
          <div
            className="flex items-center gap-1 sm:gap-2 font-mono tabular-nums shrink-0"
            aria-label={`当前可用费用 ${playerAlly.cost} / ${turnCpCap} CP（回合结束清零）`}
            title={`当前可用 ${playerAlly.cost} CP，本回合上限 ${turnCpCap} CP，回合结束清零`}
          >
            <div className="flex items-baseline gap-0.5 sm:gap-1">
              <span className="text-[9px] sm:text-[10px] text-amber-400 font-bold">CP</span>
              <strong className="text-sm sm:text-lg font-black text-amber-300 leading-none">
                {playerAlly.cost}
              </strong>
              <span className="text-[9px] sm:text-[10px] text-amber-500/75">/{turnCpCap}</span>
            </div>

            <div className="flex items-center gap-[1.5px] sm:gap-0.5" aria-hidden="true">
              {Array.from({ length: CP_CAP_GAUGE }, (_, idx) => {
                const active = idx < litPips;
                const withinCap = idx < turnCpCap;
                return (
                  <span
                    key={idx}
                    className={`w-[3px] sm:w-1.5 md:w-2 h-2.5 sm:h-3 transition-colors ${
                      active
                        ? 'bg-[#e5a52b] shadow-[0_0_4px_rgba(229,165,43,0.45)]'
                        : withinCap
                          ? 'bg-[#1f2836] border border-[#3a4a63]'
                          : 'bg-[#131820] border border-[#222b3a] opacity-40'
                    }`}
                  />
                );
              })}
            </div>
            {playerAlly.next_deploy_discounts.length > 0 && (
              <span className="hidden sm:inline text-[10px] px-1.5 py-0.2 bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 whitespace-nowrap">
                {`下次部署 -${playerAlly.next_deploy_discounts.reduce((s, d) => s + d.amount, 0)} CP`}
              </span>
            )}
          </div>
        </div>

        {/* 右侧：手牌/牌库计数 + 唯一主操作按钮「结束行动」 */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <div className="flex items-center gap-1 sm:gap-2 text-[10px] sm:text-[11px] font-mono tabular-nums text-slate-400 whitespace-nowrap">
            <span>
              <span className="hidden sm:inline">手牌 </span>
              <span className="sm:hidden">手</span>
              <strong className="text-slate-100">{playerAlly.hand.length}</strong>
            </span>
            <span>·</span>
            <span>
              <span className="hidden sm:inline">牌库 </span>
              <span className="sm:hidden">库</span>
              <strong className="text-slate-100">{playerAlly.deck.length}</strong>
            </span>
          </div>

          <Button
            variant={canEndTurn ? 'primary' : 'ghost'}
            size="sm"
            cornerCut
            disabled={!canEndTurn}
            onClick={onEndActionPhase}
            className={`text-[11px] sm:text-xs px-2 sm:px-4 min-h-[32px] sm:min-h-[38px] font-bold whitespace-nowrap transition-all shrink-0 ${
              canEndTurn
                ? 'ring-1 ring-amber-400/50 shadow-[0_0_12px_rgba(229,165,43,0.35)]'
                : 'opacity-45 border border-slate-700/70'
            }`}
          >
            结束行动 ▶
          </Button>
        </div>
      </div>

      {/* 2. 手牌横向滚动托盘（居中自适应 + 滚轮横向滚动 + 触控防裁切） */}
      <div
        ref={handTrayRef}
        onWheel={handleTrayWheel}
        onScroll={() => onHoverCard(null)}
        className={`relative z-10 flex items-center gap-1.5 sm:gap-2.5 pt-2.5 sm:pt-3 pb-1.5 sm:pb-2 px-2.5 sm:px-4 snap-x min-h-[124px] sm:min-h-[158px] lg:min-h-[172px] ${
          draggingCardId ? 'overflow-hidden touch-none' : 'overflow-x-auto overscroll-x-contain'
        }`}
      >
        {playerAlly.hand.length === 0 ? (
          <div className="w-full text-center py-6 text-xs text-slate-500 font-mono">
            （暂无手牌）
          </div>
        ) : (
          playerAlly.hand.map((id) => {
            const def = cardDefinitionOf(state, id);
            const canDragCard =
              !isMobile &&
              canInteractHand &&
              (def?.card_type === 'operator' || def?.card_type === 'facility' || (def?.card_type === 'support' && def?.support_subtype === 'facility'));
            return (
              <div key={id} className="snap-start shrink-0 first:ml-auto last:mr-auto">
                <CardView
                  state={state}
                  instanceId={id}
                  selected={selection === id}
                  interactive={canInteractHand}
                  draggable={canDragCard}
                  touchActionMode="pan-x"
                  isTouchDragging={draggingCardId === id}
                  onClick={() => onHandCardClick(id)}
                  onLongPress={(rect) => {
                    onHoverCard(null);
                    onLongPressCard(id, rect);
                  }}
                  onHoverStart={(rect) => {
                    if (!draggingCardId) {
                      onHoverCard({ instanceId: id, rect });
                    }
                  }}
                  onHoverEnd={() => {
                    onHoverCard(null);
                  }}
                  onDragStart={(e) => onDragStartCard(id, e)}
                  onDragEnd={onDragEndCard}
                  onTouchPointerDown={(e) => {
                    if (canInteractHand) {
                      onTouchStartCardCandidate?.(id, e, 'bottom');
                    }
                  }}
                />
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
