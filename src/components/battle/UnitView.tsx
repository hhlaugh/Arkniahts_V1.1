import React from 'react';
import { getEffectiveAttackProfile, getEntityKind, getEntityStats, isFacilityDisabled } from '../../game/range';
import type { CardInstance, GameState } from '../../game/types';
import { STATUS_LABEL } from '../../client/gameData';
import { getCardPresentation, getSummonPresentation } from '../../data/card-presentation';
import { useLongPress } from '../../hooks/useLongPress';
import { HOVER_INTENT_DELAY_MS, useHoverIntent } from '../../hooks/useHoverIntent';
import type { FloatingPopupKind, UnitAnimationState } from './combatPresentation';
import { cardDefinitionOf } from '../cards/CardView';
import { OperatorPortrait } from '../cards/OperatorPortrait';
import { HealthBar } from '../ui/HealthBar';
import { RARITY_THEMES } from '../ui/tokens';

export type UnitHighlight =
  | 'none'
  | 'target'
  | 'selected'
  | 'attack_target'
  | 'in_range'
  | 'heal_target'
  | 'heal_range';

export interface UnitTapCue {
  readonly kind: 'tap' | 'skill' | 'deploy';
  readonly seq: number;
}

interface UnitViewProps {
  readonly state: GameState;
  readonly instance: CardInstance;
  readonly highlight: UnitHighlight;
  readonly compact?: boolean;
  readonly canActivateSkill?: boolean;
  readonly isFocusTarget?: boolean;
  readonly isPriorityHealTarget?: boolean;
  readonly isDragLocked?: boolean;
  readonly animState?: UnitAnimationState;
  readonly tapCue?: UnitTapCue | null;
  readonly onClick?: () => void;
  readonly onDoubleTap?: () => void;
  readonly onLongPress?: (rect?: DOMRect) => void;
  readonly onHoverStart?: (rect: DOMRect) => void;
  readonly onHoverEnd?: () => void;
}

const POPUP_COLORS: Record<FloatingPopupKind, string> = {
  damage: 'bg-[#0e1116]/95 text-rose-300 border-rose-500/85 border-l-2',
  shield: 'bg-[#0e1116]/95 text-sky-300 border-sky-400/85 border-l-2',
  heal: 'bg-[#0e1116]/95 text-emerald-300 border-emerald-400/85 border-l-2',
  sp: 'bg-[#0e1116]/95 text-cyan-300 border-cyan-400/85 border-l-2',
  skill: 'bg-[#0e1116]/95 text-amber-300 border-[#e5a52b] border-l-2',
  deploy: 'bg-[#0e1116]/92 text-amber-200 border-[#e5a52b]/80 border-l-2',
  status: 'bg-[#0e1116]/95 text-purple-300 border-purple-400/85 border-l-2',
  facility_decay: 'bg-[#1a130b]/95 text-amber-200 border-amber-400/90',
};

const SUMMON_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  meebo: '机械水獭·咪波',
  mayer_meebo: '机械水獭·咪波',
  phantom_shadow: '虚影',
  silence_med_drone: '医疗无人机',
  nightingale_birdcage: '圣域鸟笼',
  magallan_strike_drone: '强击无人机',
  magallan_support_drone: '支援无人机',
};

/**
 * 战场棋盘实体组件 (BoardUnit: 干员 / 场地设施 / 召唤物)
 * - 使用 V1.1 `getEntityStats` / `getEntityKind` / `getEffectiveAttackProfile` 权威计算攻击、生命与状态
 * - 区分干员、场地设施（3HP · 剩余回合 · 瘫痪状态）、召唤物（可召回/嘲讽）及装备/标记角标
 */
export function UnitView({
  state,
  instance,
  highlight,
  compact = false,
  canActivateSkill = false,
  isFocusTarget = false,
  isPriorityHealTarget = false,
  isDragLocked = false,
  animState,
  tapCue = null,
  onClick,
  onDoubleTap,
  onLongPress,
  onHoverStart,
  onHoverEnd,
}: UnitViewProps) {
  const definition = cardDefinitionOf(state, instance.card_instance_id);
  const combat = instance.operator_combat;
  const longPressHandlers = useLongPress({
    onLongPress,
    onClick,
    onDoubleTap,
    longPressTrigger: 'touch',
    disabled: !onClick && !onDoubleTap && !onLongPress,
  });
  const hoverHandlers = useHoverIntent({
    delayMs: HOVER_INTENT_DELAY_MS,
    disabled: !onHoverStart,
    onHoverShow: onHoverStart,
    onHoverHide: onHoverEnd,
  });

  if (!definition || !combat) return null;

  const entityKind = getEntityKind(state, instance);
  const stats = getEntityStats(state, instance);
  const attackProfile = getEffectiveAttackProfile(state, instance);
  const facilityDisabled = entityKind === 'facility' && isFacilityDisabled(state, instance);
  const basePresentation = getCardPresentation(instance.card_id);
  const presentation =
    entityKind === 'summon'
      ? getSummonPresentation(instance.summon_state?.token_id, basePresentation)
      : basePresentation;
  const rarity = presentation.rarity;
  const rarityTheme = RARITY_THEMES[rarity as keyof typeof RARITY_THEMES] ?? RARITY_THEMES[3];

  const displayName =
    entityKind === 'summon' && instance.summon_state?.token_id
      ? SUMMON_DISPLAY_NAMES[instance.summon_state.token_id] ?? `${definition.card_name_zh}·召唤`
      : definition.card_name_zh;

  const atk = stats.atk;
  const maxHp = stats.maxHp;
  const isSelected = highlight === 'selected';
  const isTarget = highlight === 'target';
  const isAttackTarget = highlight === 'attack_target';
  const isInRange = highlight === 'in_range';
  const isHealTarget = highlight === 'heal_target';
  const isHealRange = highlight === 'heal_range';
  const hasEquipped = Boolean(combat.equipped_package || combat.equipment_ids.length > 0);
  const hasStatuses = combat.statuses.length > 0 || hasEquipped;
  const hasCornerBadge =
    isDragLocked ||
    isTarget ||
    isAttackTarget ||
    isInRange ||
    isHealTarget ||
    isHealRange ||
    isFocusTarget ||
    canActivateSkill;

  const motionOff = Boolean(animState?.disableMotion);
  const isFacilityDecay = Boolean(animState?.facilityDecay);
  const isFacilityTurnEndSim = Boolean(animState?.facilityTurnEndSim) && entityKind === 'facility' && !facilityDisabled;
  const isFacilityHpReductionActive = isFacilityDecay || isFacilityTurnEndSim;
  const isFacilityCritical = entityKind === 'facility' && combat.current_hp === 1;
  const rarityDeployCls =
    !motionOff && rarity >= 6 ? ' anim-deploy-rarity-6' : !motionOff && rarity === 5 ? ' anim-deploy-rarity-5' : '';
  const tapShakeCls = !motionOff && tapCue ? ' anim-cell-hit-shake' : '';
  const showSkillFx = !motionOff && (Boolean(animState?.skillFlash) || tapCue?.kind === 'skill');
  const motionClass = motionOff
    ? ''
    : animState?.hit
      ? 'anim-hit-shake'
      : isFacilityHpReductionActive
        ? 'anim-facility-decay'
        : animState?.attackDirection === 'up'
          ? 'anim-melee-lunge-up anim-attack-glow'
          : animState?.attackDirection === 'down'
            ? 'anim-melee-lunge-down anim-attack-glow'
            : animState?.deployed
              ? `anim-deploy-land${rarityDeployCls}`
              : tapShakeCls.trim();

  const floatingPopups = animState?.floatingPopups ?? [];

  const attackModeShort =
    entityKind === 'facility'
      ? '设施'
      : attackProfile?.mode === 'ranged'
        ? '远'
        : attackProfile?.mode === 'support'
          ? '疗'
          : '近';
  const attackModeFull =
    entityKind === 'facility'
      ? '场地设施'
      : attackProfile?.mode === 'ranged'
        ? '远程'
        : attackProfile?.mode === 'support'
          ? '医疗'
          : '近战';

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={`${displayName}，生命 ${combat.current_hp}/${maxHp}${entityKind !== 'facility' ? `，攻击 ${atk}` : ''}`}
      data-rarity={String(rarity)}
      data-entity-kind={entityKind}
      data-highlight={highlight}
      data-tap-cue={tapCue?.kind}
      data-facility-decay={isFacilityDecay ? 'true' : undefined}
      data-facility-hp-sim={isFacilityTurnEndSim ? 'true' : undefined}
      data-facility-critical={isFacilityCritical ? 'true' : undefined}
      onPointerEnter={hoverHandlers.onPointerEnter}
      onPointerLeave={hoverHandlers.onPointerLeave}
      onPointerDown={(e) => {
        hoverHandlers.onPointerDown(e);
        longPressHandlers.onPointerDown(e);
      }}
      onPointerMove={longPressHandlers.onPointerMove}
      onPointerUp={longPressHandlers.onPointerUp}
      onPointerCancel={longPressHandlers.onPointerCancel}
      onContextMenu={longPressHandlers.onContextMenu}
      onClick={(e) => {
        e.stopPropagation();
        hoverHandlers.cancelHover();
        longPressHandlers.onClick(e);
      }}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }
      }}
      className={`touch-gesture-surface group relative select-none cursor-pointer focus-visible:outline-none ${
        isDragLocked
          ? 'scale-[1.02] z-30'
          : isSelected || isTarget || isAttackTarget || isInRange || isHealTarget || animState?.hit || isFacilityHpReductionActive
            ? 'z-20'
            : showSkillFx || longPressHandlers.isHolding || isHealRange
              ? 'z-25'
              : isFocusTarget
                ? 'z-15'
                : ''
      } ${motionClass} w-full ${compact ? 'h-[54px]' : 'h-[58px] sm:h-[70px] lg:h-[82px]'}`}
    >
      {/* 硬朗尖锐外切角金属边框壳 */}
      <div
        className={`holo-frame board-unit-shell w-full h-full transition-colors duration-150 ${
          isDragLocked
            ? 'bg-cyan-300'
            : longPressHandlers.isHolding
              ? 'bg-amber-400'
              : isSelected
                ? 'bg-[#e5a52b]'
                : isTarget
                  ? 'bg-cyan-400'
                  : isAttackTarget
                    ? 'bg-rose-500'
                    : isInRange
                      ? 'bg-rose-400/70'
                      : isHealTarget
                        ? 'bg-emerald-400'
                        : isHealRange
                          ? 'bg-emerald-500/60'
                          : isFocusTarget
                            ? 'bg-amber-400/90'
                            : animState?.hit
                              ? 'bg-rose-400'
                              : isFacilityHpReductionActive
                                ? 'bg-amber-400'
                                : isFacilityCritical
                                  ? 'bg-rose-500/85'
                                  : showSkillFx
                                    ? 'bg-cyan-300'
                                    : canActivateSkill
                                      ? 'bg-amber-400/70 group-hover:bg-amber-300'
                                      : entityKind === 'facility'
                                        ? 'bg-amber-500/55 group-hover:bg-amber-300/85'
                                        : entityKind === 'summon'
                                          ? 'bg-emerald-500/55 group-hover:bg-emerald-300/85'
                                          : 'bg-[#384556] group-hover:bg-[#7b8da6]'
        }`}
      >
      {/* 内部裁切内容容器 */}
      <div className={`board-unit relative flex flex-col justify-between w-full h-full ${compact ? 'p-0.5 pl-1.5' : 'p-1 sm:p-1.5 pl-1.5 sm:pl-2'} overflow-hidden`}>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 inset-x-0 h-[1px] bg-white/[0.08] z-10"
        />

        {longPressHandlers.isHolding && (
          <div
            aria-hidden="true"
            className="absolute top-0 left-0 right-0 h-[2px] bg-[#e5a52b] z-30 pointer-events-none anim-hold-charge"
          />
        )}
        <div
          className="absolute left-0 top-0 bottom-0 w-[2px] pointer-events-none"
          style={{
            background:
              entityKind === 'facility'
                ? '#f59e0b'
                : entityKind === 'summon'
                  ? '#34d399'
                  : rarityTheme.color,
          }}
        />

        {!motionOff && animState?.hit && (
          <div className="absolute inset-0 pointer-events-none z-20 anim-hit-flash border border-rose-300/80 bg-gradient-to-b from-rose-300/28 via-rose-500/18 to-transparent" />
        )}

        {!motionOff && isFacilityHpReductionActive && (
          <>
            <div
              data-testid="facility-decay-fx"
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none z-25 border border-amber-400/90 bg-gradient-to-b from-amber-400/22 via-rose-500/12 to-transparent anim-facility-decay-ring"
            />
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-1/2 pointer-events-none z-25 bg-gradient-to-b from-amber-300/35 via-rose-400/15 to-transparent anim-facility-decay-sweep"
            />
            <span
              data-testid="facility-hp-cut-badge"
              aria-hidden="true"
              className="absolute top-0.5 right-1 px-1 py-0.2 bg-[#1a120a]/95 border border-amber-400/85 text-amber-200 font-mono font-black text-[8px] pointer-events-none z-30"
            >
              {isFacilityDecay ? '⏳ -1 HP' : '⏳ 回合末 -1 HP'}
            </span>
          </>
        )}

        {!motionOff && isFacilityCritical && !isFacilityHpReductionActive && (
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none z-15 border border-rose-400/70 anim-facility-critical"
          />
        )}

        {!motionOff && tapCue && tapCue.kind === 'tap' && (
          <div
            key={`tap-pulse-${tapCue.seq}`}
            aria-hidden="true"
            className="absolute inset-0 border border-[#e5a52b]/75 bg-[#e5a52b]/10 pointer-events-none z-20 anim-slot-flash"
          />
        )}

        {showSkillFx && (
          <>
            <div
              key={`skill-burst-${tapCue?.seq ?? 'anim'}`}
              aria-hidden="true"
              className="absolute inset-0 border border-cyan-300/90 bg-gradient-to-b from-cyan-400/18 via-transparent to-cyan-500/10 pointer-events-none z-20 anim-skill-burst"
            />
            <div
              key={`skill-sweep-${tapCue?.seq ?? 'anim'}`}
              aria-hidden="true"
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-cyan-200/35 to-transparent pointer-events-none z-20 anim-skill-sweep"
            />
          </>
        )}

        {/* 顶部：头像、名称与状态标 */}
        <div className={`flex items-center justify-between gap-0.5 sm:gap-1 w-full overflow-hidden ${hasCornerBadge ? 'pr-11 sm:pr-12' : ''}`}>
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1">
            <OperatorPortrait
              key={instance.summon_state?.token_id ?? instance.card_id}
              cardId={instance.card_id}
              presentation={presentation}
              variant="avatar"
              className={`${compact ? 'w-4 h-4' : 'w-4 h-4 sm:w-5.5 sm:h-5.5'} shrink-0 rounded-xs border border-slate-700/80 shadow-xs`}
            />
            <div className="flex items-center gap-0.5 sm:gap-1 min-w-0 flex-1">
              <span className={`font-bold ${compact ? 'text-[10px]' : 'text-[11px] sm:text-xs'} text-white truncate leading-tight`}>
                {displayName}
              </span>
              {entityKind === 'summon' && (
                <span className="text-[8px] px-0.5 bg-emerald-950/90 text-emerald-300 border border-emerald-500/40 shrink-0 leading-none py-0.2">
                  召
                </span>
              )}
              {entityKind === 'facility' && (
                <span className="text-[8px] px-0.5 bg-amber-950/90 text-amber-300 border border-amber-500/40 shrink-0 leading-none py-0.2">
                  {facilityDisabled ? '瘫痪' : '设施'}
                </span>
              )}
            </div>
          </div>

          {hasStatuses ? (
            <div className="flex items-center gap-0.5 shrink-0">
              {combat.statuses.slice(0, 1).map((status) => (
                <span
                  key={status.kind}
                  title={`${STATUS_LABEL[status.kind] ?? status.kind}${status.remaining_owner_turns > 0 ? ` (${status.remaining_owner_turns}回合)` : ''}`}
                  className={`text-[8px] px-0.5 sm:px-1 border font-mono leading-tight ${
                    status.kind === 'assault'
                      ? 'bg-amber-950 text-amber-200 border-amber-400/75'
                      : 'bg-rose-950 text-rose-300 border-rose-500/60'
                  }`}
                >
                  {STATUS_LABEL[status.kind] ?? status.kind}
                </span>
              ))}
              {combat.statuses.length > 1 && (
                <span className="text-[8px] px-0.5 bg-slate-800 text-slate-300 border border-slate-600 font-mono leading-tight">
                  +{combat.statuses.length - 1}
                </span>
              )}
              {hasEquipped && (
                <span
                  title={combat.equipped_package ? `已安装：${combat.equipped_package.card_name_zh}` : '已安装装备'}
                  className="text-[8px] px-0.5 sm:px-1 bg-emerald-950 text-emerald-300 border border-emerald-500/60 font-mono leading-tight"
                >
                  装
                </span>
              )}
            </div>
          ) : !hasCornerBadge ? (
            <span className="text-[8px] sm:text-[9px] font-mono text-slate-400 shrink-0 leading-none">
              <span className="hidden sm:inline">{attackModeFull}</span>
              <span className="sm:hidden">{attackModeShort}</span>
            </span>
          ) : null}
        </div>

        {/* 中部：生命条、护盾与技力充能进度条 */}
        <div className={`w-full ${compact ? 'my-0' : 'my-0 sm:my-0.5'} space-y-[2px]`}>
          <HealthBar
            currentHp={combat.current_hp}
            maxHp={maxHp}
            shield={combat.shield}
            size="sm"
            compact={compact}
            showNumbers
            disableMotion={motionOff}
            hpCutPreview={
              !motionOff && entityKind === 'facility' && isFacilityHpReductionActive
                ? {
                    mode: isFacilityDecay ? 'decay' : 'turn_end_sim',
                    currentHp: combat.current_hp,
                    maxHp,
                  }
                : undefined
            }
          />
          {entityKind !== 'facility' && typeof definition.active_skill_sp_cost === 'number' && definition.active_skill_sp_cost > 0 && (() => {
            const spCost = definition.active_skill_sp_cost;
            const currentSp = Math.max(0, combat.current_sp);
            const spPct = Math.min(100, Math.max(0, Math.round((currentSp / spCost) * 100)));
            const spMilestone: 'complete' | 'half' | 'charging' =
              spPct >= 100 ? 'complete' : spPct >= 50 ? 'half' : 'charging';
            const spPulseCls = motionOff
              ? ''
              : spMilestone === 'complete'
                ? 'anim-unit-bar-complete'
                : spMilestone === 'half'
                  ? 'anim-unit-bar-half'
                  : '';
            return (
              <div className="flex items-center gap-1 leading-none">
                <div
                  role="progressbar"
                  aria-label="技力充能进度"
                  aria-valuemin={0}
                  aria-valuemax={spCost}
                  aria-valuenow={Math.min(currentSp, spCost)}
                  aria-valuetext={`${spPct}%`}
                  data-testid="unit-sp-bar"
                  data-sp-milestone={spMilestone}
                  className="relative flex-1 h-[3px] bg-slate-900 border border-slate-700/75 overflow-hidden"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1/2 top-0 bottom-0 w-[1px] bg-white/25 z-20"
                  />
                  <div
                    className={`relative z-10 h-full ${spPulseCls} ${
                      motionOff ? '' : 'transition-[width] duration-300 ease-out'
                    } ${
                      spMilestone === 'complete'
                        ? 'bg-gradient-to-r from-amber-400 to-yellow-200'
                        : spMilestone === 'half'
                          ? 'bg-gradient-to-r from-sky-500 to-cyan-300'
                          : 'bg-sky-700'
                    }`}
                    style={{ width: `${spPct}%` }}
                  />
                </div>
                <span
                  className={`font-mono tabular-nums text-[8px] font-bold leading-none shrink-0 ${
                    spMilestone === 'complete'
                      ? 'text-amber-300'
                      : spMilestone === 'half'
                        ? 'text-cyan-300'
                        : 'text-slate-400'
                  }`}
                >
                  ⚡{Math.min(currentSp, spCost)}/{spCost}
                </span>
              </div>
            );
          })()}
        </div>

        {/* 底部：数值或设施生命周期条 */}
        {entityKind === 'facility' ? (
          <div
            data-testid="facility-lifetime-bar"
            title={`场地设施寿命 ${combat.current_hp}/${maxHp}（每回合扣除 1 HP，归零摧毁）`}
            className={`flex items-center justify-between gap-1 ${compact ? 'text-[9px] px-1 py-[1px]' : 'text-[10px] sm:text-[11px] px-1 sm:px-1.5 py-[1px] sm:py-0.5'} font-mono tabular-nums border leading-none ${
              isFacilityCritical
                ? 'bg-rose-950/85 border-rose-500/75 text-rose-200'
                : isFacilityHpReductionActive
                  ? 'bg-amber-950/85 border-amber-400/80 text-amber-200'
                  : 'bg-[#12161b] border-[#2b353f] text-amber-300'
            }`}
          >
            <div className="flex items-center gap-1 min-w-0">
              <span className="flex items-center gap-0.5 shrink-0" aria-hidden="true">
                {Array.from({ length: Math.max(1, maxHp) }).map((_, idx) => {
                  const filled = idx < combat.current_hp;
                  const isNextCutPip = !facilityDisabled && filled && idx === combat.current_hp - 1;
                  const isDecayedPip = isFacilityDecay && idx === combat.current_hp;
                  const pipAnimCls = motionOff
                    ? ''
                    : isDecayedPip || (isFacilityTurnEndSim && isNextCutPip)
                      ? 'anim-facility-pip-shatter'
                      : isNextCutPip
                        ? 'anim-facility-pip-drain'
                        : '';
                  return (
                    <span
                      key={idx}
                      data-facility-pip={isNextCutPip ? 'next-cut' : isDecayedPip ? 'shattered' : filled ? 'filled' : 'empty'}
                      className={`inline-block w-1.5 h-2 ${pipAnimCls} ${
                        isDecayedPip
                          ? 'bg-rose-400/80'
                          : filled
                            ? isFacilityCritical || (isFacilityTurnEndSim && isNextCutPip)
                              ? 'bg-rose-400'
                              : isNextCutPip
                                ? 'bg-amber-300'
                                : 'bg-amber-400'
                            : 'bg-slate-700/85'
                      }`}
                    />
                  );
                })}
              </span>
              <span className={`font-bold truncate ${isFacilityCritical ? 'text-rose-200' : 'text-amber-300'}`}>
                {isFacilityCritical
                  ? '⚠ 末回合'
                  : facilityDisabled
                    ? '⏸ 暂停'
                    : `寿命 ${combat.current_hp}/${maxHp}`}
              </span>
            </div>
            <span className={`font-bold shrink-0 ${isFacilityHpReductionActive ? 'text-amber-200' : isFacilityCritical ? 'text-rose-300' : 'text-slate-300'}`}>
              {isFacilityHpReductionActive ? 'HP削减 -1' : isFacilityCritical ? '下回销毁' : '每回-1'}
            </span>
          </div>
        ) : (
          <div className={`flex items-center justify-between ${compact ? 'text-[9px] px-1 py-[1px]' : 'text-[10px] sm:text-[11px] px-1 sm:px-1.5 py-[1px] sm:py-0.5'} font-mono tabular-nums bg-[#12161b] border border-[#2b353f] leading-none`}>
            <span className="text-rose-400 font-bold flex items-center gap-0.5">
              <span className="text-[8px] sm:text-[9px]">⚔</span>
              <span>{atk}</span>
            </span>
            {entityKind === 'summon' ? (
              <span className="text-emerald-300 font-bold text-[9px] truncate">
                {instance.summon_state?.taunt_scope !== 'none' ? '🛡 嘲讽' : '可召回'}
              </span>
            ) : combat.equipped_package ? (
              <span className="text-emerald-300 font-bold text-[9px] truncate max-w-[68%]">
                🔧 {combat.equipped_package.card_name_zh}
              </span>
            ) : (
              <span className="text-slate-300 font-bold text-[9px] leading-none">
                <span className="hidden sm:inline">{attackModeFull}</span>
                <span className="sm:hidden">{attackModeShort}</span>
              </span>
            )}
          </div>
        )}

        {/* 角标指示器 */}
        {isDragLocked && (
          <div className="absolute top-0 right-0 px-1 py-0.2 bg-cyan-400 text-slate-950 font-mono font-black text-[8px] pointer-events-none z-25">
            ✓ 释放锁定
          </div>
        )}

        {!isDragLocked && isTarget && (
          <div className="absolute top-0 right-0 px-1 py-0.2 bg-cyan-500 text-slate-950 font-mono font-black text-[8px] pointer-events-none">
            ◎ 目标
          </div>
        )}

        {!isDragLocked && isAttackTarget && !isTarget && (
          <div className="absolute top-0 right-0 px-1 py-0.2 bg-rose-600 text-white font-mono font-black text-[8px] pointer-events-none">
            ⚔ 锁定
          </div>
        )}

        {!isDragLocked && isInRange && !isTarget && !isAttackTarget && (
          <div className="absolute top-0 right-0 px-1 py-0.2 bg-rose-950/95 border-l border-b border-rose-400/75 text-rose-200 font-mono font-black text-[8px] pointer-events-none">
            ◎ 射程内
          </div>
        )}

        {!isDragLocked && isHealTarget && !isTarget && !isAttackTarget && !isInRange && (
          <div className="absolute top-0 right-0 px-1 py-0.2 bg-emerald-500 text-slate-950 font-mono font-black text-[8px] pointer-events-none">
            {isPriorityHealTarget ? '+ 优先治疗' : '+ 可治疗'}
          </div>
        )}

        {!isDragLocked && isHealRange && !isHealTarget && !isTarget && !isAttackTarget && !isInRange && (
          <div className="absolute top-0 right-0 px-1 py-0.2 bg-emerald-950/95 border-l border-b border-emerald-400/70 text-emerald-200 font-mono font-black text-[8px] pointer-events-none">
            + 治疗范围
          </div>
        )}

        {!isDragLocked && !isTarget && !isAttackTarget && !isInRange && !isHealTarget && !isHealRange && isFocusTarget && (
          <div className="absolute top-0 right-0 px-1 py-0.2 bg-amber-400 text-slate-950 font-mono font-black text-[8px] pointer-events-none z-20">
            🎯 标记
          </div>
        )}

        {!isDragLocked && !isTarget && !isAttackTarget && !isInRange && !isHealTarget && !isHealRange && !isFocusTarget && canActivateSkill && (
          <div
            data-skill-ready="true"
            className="absolute top-0 right-0 px-1 py-0.2 bg-amber-400/95 text-slate-950 font-mono font-black text-[8px] pointer-events-none shadow-xs"
          >
            ⚡ 就绪
          </div>
        )}
      </div>
      </div>

      {/* 浮动战斗反馈跳字 */}
      {!motionOff && floatingPopups.length > 0 && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 -top-1 flex flex-col items-center gap-0.5 pointer-events-none z-40"
        >
          {floatingPopups.slice(0, 3).map((popup, idx) => {
            const numeric = Number.parseFloat(popup.label.replace(/[^\d.-]/g, ''));
            const magnitude = Number.isFinite(numeric) ? Math.abs(numeric) : 0;
            const sizeCls =
              magnitude >= 3
                ? 'text-[14px] px-2 py-0.5'
                : magnitude >= 2
                  ? 'text-[12px] px-1.5 py-0.2'
                  : 'text-[11px] px-1.5 py-0.2';
            return (
            <span
              key={popup.id}
              style={{ marginTop: `${idx * -2}px` }}
              className={`px-1.5 py-0.2 border font-mono font-bold tracking-tight leading-tight whitespace-nowrap anim-float-number ${sizeCls} ${POPUP_COLORS[popup.kind]}`}
            >
              {popup.label}
            </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
