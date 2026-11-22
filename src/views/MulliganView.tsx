import React, { useState } from 'react';
import type { ActionResult } from '../client/localGameController';
import { PLAYER_LABEL } from '../client/gameData';
import { CardView, cardDefinitionOf } from '../components/cards/CardView';
import { CardFrame } from '../components/cards/CardFrame';
import { KeywordGlossary } from '../components/cards/KeywordGlossary';
import { CardPreviewPopover, type HoveredCardPreview } from '../components/battle/CardPreviewPopover';
import type { CardInstanceId, GameState, PlayerId } from '../game/types';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { BottomSheet } from '../components/ui/BottomSheet';
import { ScenicBackdrop, ScenicBannerLayer } from '../components/ui/ScenicBackdrop';
import { useIsMobile } from '../hooks/useViewport';
import { playTacticalSfx } from '../audio/bgmPlayer';
import { playCombatSfx } from '../audio/combatSfx';

interface MulliganViewProps {
  readonly state: GameState;
  readonly playerId: PlayerId;
  readonly deckName: string;
  readonly waitingForOpponent?: boolean;
  readonly onConfirm: (selected: readonly CardInstanceId[]) => ActionResult | Promise<ActionResult>;
  readonly onLeave?: () => void;
  readonly leaveLabel?: string;
}

export function MulliganView({
  state,
  playerId,
  deckName,
  waitingForOpponent = false,
  onConfirm,
  onLeave,
  leaveLabel = '离开对局',
}: MulliganViewProps) {
  const [selected, setSelected] = useState<ReadonlySet<CardInstanceId>>(new Set());
  const [hoveredCard, setHoveredCard] = useState<HoveredCardPreview | null>(null);
  const [inspectId, setInspectId] = useState<CardInstanceId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isMobile = useIsMobile();
  const hand = state.players[playerId].hand;

  const toggle = (id: CardInstanceId) => {
    if (submitting) return;
    playCombatSfx('select');
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < hand.length) next.add(id);
      return next;
    });
  };

  const confirm = async () => {
    setSubmitting(true);
    try {
      const swapCount = selected.size;
      const result = await onConfirm([...selected]);
      if (!result.ok) {
        playTacticalSfx('alert');
        setSubmitting(false);
        setError(result.reason ?? '换牌失败');
      } else {
        playCombatSfx(swapCount > 0 ? 'draw' : 'select');
        if (swapCount === 0) {
          playTacticalSfx('confirm');
        }
      }
    } catch (err) {
      playTacticalSfx('alert');
      setSubmitting(false);
      setError(err instanceof Error ? err.message : '换牌异常');
    }
  };

  if (waitingForOpponent || (submitting && !error)) {
    return (
      <div className="relative min-h-screen w-full bg-[#12161b] text-[#e8e9e6] flex flex-col items-center justify-center p-4 select-none overflow-hidden">
        <ScenicBackdrop
          scene="snowfield"
          fade="top"
          opacityClassName="opacity-[0.38]"
          tint="radial-gradient(circle at 60% 18%, rgba(125,211,252,0.14) 0%, transparent 56%)"
        />
        <Panel variant="raised" cornerCut="lg" scanlines className="relative z-10 max-w-md p-6 text-center space-y-3 border-[#52606d] bg-[#161b22]/92">
          <div className="w-12 h-12 mx-auto rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
          <h2 className="text-base font-bold text-white uppercase tracking-wider">
            起手调度已锁定 · {PLAYER_LABEL[playerId]}
          </h2>
          <p className="text-xs text-slate-400 font-mono">
            编制：{deckName} · 正在等待对手完成调度同步…
          </p>
          {onLeave && (
            <div className="pt-2">
              <Button variant="ghost" size="sm" onClick={onLeave}>
                {leaveLabel}
              </Button>
            </div>
          )}
        </Panel>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] w-full bg-[#12161b] text-[#e8e9e6] flex flex-col items-center justify-center p-2.5 sm:p-6 select-none overflow-y-auto">
      <ScenicBackdrop
        scene="snowfield"
        fixed
        fade="top"
        opacityClassName="opacity-[0.38]"
        tint="radial-gradient(circle at 60% 18%, rgba(125,211,252,0.14) 0%, transparent 56%)"
      />
      <Panel
        variant="raised"
        cornerCut="lg"
        scanlines
        className="relative z-10 w-full max-w-5xl border border-[#52606d] bg-[#161b22]/92 backdrop-blur-sm shadow-[0_24px_64px_rgba(0,0,0,0.8)] flex flex-col my-auto overflow-hidden"
      >
        {/* Terminal Header */}
        <div className="relative flex flex-wrap items-center justify-between gap-2 px-3 sm:px-5 py-2.5 sm:py-3.5 bg-[#14171a] border-b border-[#363f45] overflow-hidden">
          <ScenicBannerLayer
            scene="snowfield"
            fade="right"
            opacityClassName="opacity-42"
            tint="radial-gradient(circle at 80% 45%, rgba(125,211,252,0.14) 0%, transparent 58%)"
          />
          <div className="relative z-10 flex items-center gap-2.5 sm:gap-3">
            <span className="w-1.5 sm:w-2 h-5 bg-[#e5a52b]" />
            <div>
              <h2 className="text-sm sm:text-base font-black tracking-widest text-slate-100 uppercase m-0 leading-tight">
                战术调度阶段 · 起手换牌
              </h2>
              <span className="text-[10px] font-mono text-slate-400 tracking-wider">
                {PLAYER_LABEL[playerId]} · 当前编制: {deckName}
              </span>
            </div>
          </div>
          <span className="relative z-10 text-[11px] sm:text-xs font-mono text-amber-300 bg-amber-950/60 px-2 sm:px-2.5 py-0.5 sm:py-1 border border-amber-500/40">
            已选择换出: {selected.size} / {hand.length} 张
          </span>
        </div>

        {/* Instructions banner */}
        <div className="px-3 sm:px-5 py-2 bg-[#1a2026] border-b border-[#2e3740] text-[11px] sm:text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2">
          <span>
            点击勾选想要换掉的卡牌（可全不选）。{isMobile ? '长按卡牌可查看详情与词条说明。' : '悬停卡牌可预览详情与词条说明。'}
          </span>
          <span className="text-slate-400 text-[10px] font-mono hidden sm:inline">STEP: 01_DEPLOY_PREP</span>
        </div>

        {/* Hand Cards Selection Grid */}
        <div className="p-3 sm:p-6 bg-gradient-to-b from-[#1b2025] to-[#14181c] flex items-center justify-center">
          <div className="flex flex-wrap gap-2.5 sm:gap-4 justify-center items-center max-w-4xl">
            {hand.map((id) => (
              <CardView
                key={id}
                state={state}
                instanceId={id}
                selectable
                checked={selected.has(id)}
                interactive
                onClick={() => toggle(id)}
                onLongPress={() => {
                  setHoveredCard(null);
                  setInspectId(id);
                }}
                onHoverStart={(rect) => {
                  if (!isMobile) {
                    setHoveredCard({ instanceId: id, rect });
                  }
                }}
                onHoverEnd={() => {
                  setHoveredCard((prev) => (prev?.instanceId === id ? null : prev));
                }}
              />
            ))}
          </div>
        </div>

        {/* Error Toast */}
        {error && (
          <div className="mx-3 sm:mx-6 mb-3 p-2.5 bg-rose-950/80 border border-rose-500 text-rose-300 text-xs text-center">
            {error}
          </div>
        )}

        {/* Bottom Actions */}
        <div className="px-3 sm:px-5 py-2.5 sm:py-3.5 bg-[#121518] border-t border-[#313b43] flex flex-wrap items-center justify-between gap-2.5">
          <div className="text-[11px] text-slate-400 font-mono">
            {selected.size === 0 ? '保持当前起手手牌不作替换' : `替换选中的 ${selected.size} 张卡牌`}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            {onLeave && (
              <Button variant="ghost" size="md" onClick={onLeave}>
                ✕ {leaveLabel}
              </Button>
            )}
            <Button
              variant="primary"
              size="lg"
              cornerCut
              onClick={confirm}
              loading={submitting}
              className="font-bold px-5 sm:px-8 shadow-lg"
            >
              确认调度（换 {selected.size} 张） ▶
            </Button>
          </div>
        </div>
      </Panel>

      {!isMobile && (
        <CardPreviewPopover state={state} hovered={hoveredCard} />
      )}

      {isMobile && (() => {
        const inspectInst = inspectId ? state.card_instances[inspectId] : undefined;
        const inspectDef = inspectId ? cardDefinitionOf(state, inspectId) : undefined;
        return (
          <BottomSheet
            isOpen={Boolean(inspectInst && inspectDef)}
            onClose={() => setInspectId(null)}
            title={inspectDef?.card_name_zh ?? '卡牌详情'}
            codeName={inspectInst?.card_id}
            maxHeight="max-h-[86dvh]"
          >
            {inspectInst && inspectDef && (
              <div className="p-4 space-y-3 text-xs">
                <div className="flex justify-center">
                  <CardFrame
                    cardId={inspectInst.card_id}
                    definition={inspectDef}
                    variant="preview"
                    interactive={false}
                    className="w-[186px] min-h-[240px] shadow-md"
                  />
                </div>
                {(inspectDef.rules_text_zh || inspectDef.active_skill_text_zh) && (
                  <div className="bg-[#12161d] p-2.5 border border-[#263140] space-y-1.5">
                    {inspectDef.rules_text_zh && (
                      <p className="text-slate-200 leading-relaxed m-0">{inspectDef.rules_text_zh}</p>
                    )}
                    {inspectDef.active_skill_text_zh && (
                      <p className="text-sky-300 leading-relaxed m-0">
                        ⚡ 主动 ({inspectDef.active_skill_sp_cost ?? 0} SP): {inspectDef.active_skill_text_zh}
                      </p>
                    )}
                  </div>
                )}
                <KeywordGlossary definition={inspectDef} instance={inspectInst} />
              </div>
            )}
          </BottomSheet>
        );
      })()}
    </div>
  );
}
