import React from 'react';
import { getEffectiveAttackProfile, getEntityKind, getEntityStats, isFacilityDisabled } from '../../game/range';
import type { CardInstance, GameState } from '../../game/types';
import { STATUS_LABEL } from '../../client/gameData';
import { getCardPresentation } from '../../data/card-presentation';
import { useLongPress } from '../../hooks/useLongPress';
import type { FloatingPopupKind, UnitAnimationState } from './combatPresentation';
import { cardDefinitionOf } from '../cards/CardView';
import { OperatorPortrait } from '../cards/OperatorPortrait';
import { HealthBar } from '../ui/HealthBar';
import { RARITY_THEMES } from '../ui/tokens';
import titaniumHudSurface from '../../assets/images/titanium_hud_surface_1795070730280.jpg';

export type UnitHighlight = 'none' | 'target' | 'selected' | 'attack_target';

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
  readonly isDragLocked?: boolean;
  readonly animState?: UnitAnimationState;
  readonly tapCue?: UnitTapCue | null;
  readonly onClick?: () => void;
  readonly onDoubleTap?: () => void;
  readonly onLongPress?: () => void;
  readonly onHoverStart?: () => void;
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
};

const SUMMON_DISPLAY_NAMES: Readonly<Record<string, string>> = {
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
 * - 区分干员、场地设施（3HP · 剩余回合 · 瘫痪状态）、召唤物（可召回/嘲讽）及装备/集火角标
 */
export function UnitView({
  state,
  instance,
  highlight,
  compact = false,
  canActivateSkill = false,
  isFocusTarget = false,
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
    disabled: !onClick && !onDoubleTap && !onLongPress,
  });

  if (!definition || !combat) return null;

  const entityKind = getEntityKind(state, instance);
  const stats = getEntityStats(state, instance);
  const attackProfile = getEffectiveAttackProfile(state, instance);
  const facilityDisabled = entityKind === 'facility' && isFacilityDisabled(state, instance);
  const presentation = getCardPresentation(instance.card_id);
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
  const hasEquipped = Boolean(combat.equipped_package || combat.equipment_ids.length > 0);
  const hasStatuses = combat.statuses.length > 0 || hasEquipped;

  const motionOff = Boolean(animState?.disableMotion);
  const rarityDeployCls =
    !motionOff && rarity >= 6 ? ' anim-deploy-rarity-6' : !motionOff && rarity === 5 ? ' anim-deploy-rarity-5' : '';
  const tapShakeCls = !motionOff && tapCue ? ' anim-cell-hit-shake' : '';
  const showSkillFx = !motionOff && (Boolean(animState?.skillFlash) || tapCue?.kind === 'skill');
  const motionClass = motionOff
    ? ''
    : animState?.hit
      ? 'anim-hit-shake'
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
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onPointerDown={longPressHandlers.onPointerDown}
      onPointerMove={longPressHandlers.onPointerMove}
      onPointerUp={longPressHandlers.onPointerUp}
      onPointerCancel={longPressHandlers.onPointerCancel}
      onContextMenu={longPressHandlers.onContextMenu}
      onClick={(e) => {
        e.stopPropagation();
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
      className={`holo-frame touch-gesture-surface group relative rounded-sm bg-[#12161c] select-none transition-colors duration-150 cursor-pointer border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#e5a52b] ${
        isDragLocked
          ? 'border-cyan-300 ring-1 ring-cyan-300/85 scale-[1.02] z-30'
          : longPressHandlers.isHolding
            ? 'border-amber-400 ring-1 ring-amber-400/75 z-25'
            : isSelected
              ? 'border-[#e5a52b] ring-1 ring-[#e5a52b]/70 z-20'
              : isTarget
                ? 'border-cyan-400 ring-1 ring-cyan-400/75 z-20'
                : isAttackTarget
                  ? 'border-rose-500 ring-1 ring-rose-500/70 z-20'
                  : isFocusTarget
                    ? 'border-amber-400/90 ring-1 ring-amber-400/50 z-15'
                    : animState?.hit
                      ? 'border-rose-400 ring-1 ring-rose-400/80 z-20'
                      : showSkillFx
                        ? 'border-cyan-300 ring-1 ring-cyan-400/85 z-25'
                        : entityKind === 'facility'
                          ? 'border-amber-500/40 hover:border-amber-300/70 hover:bg-[#171c23]'
                          : entityKind === 'summon'
                            ? 'border-emerald-500/40 hover:border-emerald-300/70 hover:bg-[#171c23]'
                            : 'border-[#333e4c] hover:border-slate-400/75 hover:bg-[#171c23]'
      } ${motionClass} w-full ${compact ? 'h-[54px]' : 'h-[58px] sm:h-[70px] lg:h-[82px]'}`}
    >
      {/* 内部裁切内容容器 */}
      <div className={`relative flex flex-col justify-between w-full h-full ${compact ? 'p-0.5 pl-1.5' : 'p-1 sm:p-1.5 pl-1.5 sm:pl-2'} overflow-hidden`}>
        <img
          src={titaniumHudSurface}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover opacity-[0.15] pointer-events-none"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-slate-400/25 via-slate-300/30 to-transparent z-10"
        />
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-10"
          viewBox="0 0 120 80"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline
            points="108 1.2, 118.8 1.2, 118.8 12"
            fill="none"
            stroke={rarityTheme.color}
            strokeOpacity="0.82"
            strokeWidth="1.5"
          />
          <polyline
            points="1.2 68, 1.2 78.8, 12 78.8"
            fill="none"
            stroke={rarityTheme.color}
            strokeOpacity="0.68"
            strokeWidth="1.5"
          />
          <polyline
            points="4 4, 12 4"
            fill="none"
            stroke="rgba(148,163,184,0.45)"
            strokeWidth="1"
          />
        </svg>

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
        <div className="flex items-center justify-between gap-0.5 sm:gap-1 w-full overflow-hidden">
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1">
            <OperatorPortrait
              key={instance.card_id}
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
                  className="text-[8px] px-0.5 sm:px-1 bg-rose-950 text-rose-300 border border-rose-500/60 font-mono leading-tight"
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
          ) : (
            <span className="text-[8px] sm:text-[9px] font-mono text-slate-400 shrink-0 leading-none">
              <span className="hidden sm:inline">{attackModeFull}</span>
              <span className="sm:hidden">{attackModeShort}</span>
            </span>
          )}
        </div>

        {/* 中部：生命条与护盾 */}
        <div className={`w-full ${compact ? 'my-0' : 'my-0 sm:my-0.5'}`}>
          <HealthBar
            currentHp={combat.current_hp}
            maxHp={maxHp}
            shield={combat.shield}
            size="sm"
            compact={compact}
            showNumbers
            disableMotion={motionOff}
          />
        </div>

        {/* 底部：数值或设施生命周期条 */}
        {entityKind === 'facility' ? (
          <div className={`flex items-center justify-between ${compact ? 'text-[9px] px-1 py-[1px]' : 'text-[10px] sm:text-[11px] px-1 sm:px-1.5 py-[1px] sm:py-0.5'} font-mono tabular-nums bg-[#12161b] border border-[#2b353f] leading-none`}>
            <span className="text-amber-300 font-bold">
              {facilityDisabled ? '⏸ 暂停' : '⚙ 生效中'}
            </span>
            <span className="text-slate-300 font-bold">
              余 {instance.facility_state?.remaining_turns ?? 1} 回
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
              <span className="text-sky-400 font-bold flex items-center gap-0.5">
                <span className="text-[8px] sm:text-[9px]">⚡</span>
                <span>{combat.current_sp}/{definition.max_sp ?? 5}</span>
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

        {!isDragLocked && !isTarget && !isAttackTarget && isFocusTarget && (
          <div className="absolute top-0 right-0 px-1 py-0.2 bg-amber-400 text-slate-950 font-mono font-black text-[8px] pointer-events-none z-20">
            🎯 集火
          </div>
        )}

        {!isDragLocked && !isTarget && !isAttackTarget && !isFocusTarget && canActivateSkill && (
          <div
            data-skill-ready="true"
            className="absolute top-0 right-0 px-1 py-0.2 bg-amber-400/95 text-slate-950 font-mono font-black text-[8px] pointer-events-none shadow-xs"
          >
            ⚡ 就绪
          </div>
        )}
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
