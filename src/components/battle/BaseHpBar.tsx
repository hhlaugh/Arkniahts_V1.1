import React from 'react';

interface BaseHpBarProps {
  readonly currentHp: number;
  readonly maxHp?: number;
  readonly side: 'ally' | 'enemy';
  readonly isHit?: boolean;
  readonly compact?: boolean;
  readonly label?: string;
  readonly className?: string;
}

/**
 * 双方基地基本分分段式血条 (BaseHpBar)
 * - 己方统一蓝色（sky/cyan），敌方统一红色（rose）
 * - 内置 4 段刻度线（每 5 点一格），受击闪光与低血量（<= 6）警报描边
 * - 在移动端与桌面端始终可见，不使用 hidden 隐藏
 */
export function BaseHpBar({
  currentHp,
  maxHp = 20,
  side,
  isHit = false,
  compact = false,
  label,
  className = '',
}: BaseHpBarProps) {
  const safeMax = Math.max(1, maxHp);
  const clamped = Math.max(0, Math.min(safeMax, currentHp));
  const pct = (clamped / safeMax) * 100;
  const isCritical = clamped > 0 && clamped <= 6;

  const isAlly = side === 'ally';
  const defaultLabel = isAlly ? '己方基地生命值' : '敌方基地生命值';

  const trackCls = isHit
    ? 'border-amber-400 bg-[#1a130b] shadow-[0_0_8px_rgba(251,191,36,0.45)]'
    : isCritical
      ? isAlly
        ? 'border-amber-400/80 bg-[#0b1320] shadow-[0_0_8px_rgba(245,158,11,0.35)]'
        : 'border-rose-400 bg-[#1c0c12] shadow-[0_0_8px_rgba(244,63,94,0.4)]'
      : isAlly
        ? 'border-sky-800/85 bg-[#08111c]'
        : 'border-rose-900/85 bg-[#180a10]';

  const fillCls = isHit
    ? 'bg-gradient-to-r from-amber-500 to-amber-300'
    : isAlly
      ? isCritical
        ? 'bg-gradient-to-r from-sky-500 via-sky-400 to-amber-300'
        : 'bg-gradient-to-r from-sky-600 via-sky-400 to-cyan-300 shadow-[0_0_8px_rgba(56,189,248,0.4)]'
      : 'bg-gradient-to-r from-rose-700 via-rose-500 to-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.4)]';

  const heightCls = compact ? 'h-2' : 'h-2.5 sm:h-3';

  return (
    <div
      role="progressbar"
      aria-label={label ?? defaultLabel}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      data-testid={isAlly ? 'base-hp-bar-ally' : 'base-hp-bar-enemy'}
      data-side={side}
      className={`relative overflow-hidden border p-[1px] transition-colors duration-200 ${heightCls} ${trackCls} ${className}`}
      style={{ clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)' }}
    >
      {/* 内部填充条 */}
      <div
        className={`relative h-full transition-[width] duration-300 ease-out ${fillCls}`}
        style={{ width: `${pct}%` }}
      >
        {/* 血条前沿高光切边 */}
        {clamped > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-0 top-0 bottom-0 w-[2px] bg-white/80"
          />
        )}
      </div>

      {/* 4 等分刻度线（每 5 点 HP 一段） */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 grid grid-cols-4"
      >
        <span className="border-r border-[#080b10]/70" />
        <span className="border-r border-[#080b10]/70" />
        <span className="border-r border-[#080b10]/70" />
        <span />
      </div>
    </div>
  );
}
