import React from 'react';

export type TacticalTone = 'cyan' | 'amber' | 'rose' | 'slate';
export type TacticalBracketSize = 'sm' | 'md' | 'lg';

interface TacticalCornerBracketsProps {
  readonly tone?: TacticalTone;
  readonly size?: TacticalBracketSize;
  readonly className?: string;
}

const TONE_STROKES: Record<TacticalTone, { readonly primary: string; readonly secondary: string }> = {
  cyan: {
    primary: 'rgba(103, 232, 249, 0.88)',
    secondary: 'rgba(56, 189, 248, 0.48)',
  },
  amber: {
    primary: 'rgba(251, 191, 36, 0.9)',
    secondary: 'rgba(229, 165, 43, 0.5)',
  },
  rose: {
    primary: 'rgba(251, 113, 133, 0.86)',
    secondary: 'rgba(244, 63, 94, 0.46)',
  },
  slate: {
    primary: 'rgba(203, 213, 225, 0.72)',
    secondary: 'rgba(148, 163, 184, 0.36)',
  },
};

const SIZE_DIMENSIONS: Record<TacticalBracketSize, string> = {
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-11 h-11',
};

/**
 * 精密工业终端边角护框 SVG 组件：
 * 采用阶梯线宽外轨、45° 切角双层导轨与微刻度缺口，
 * 复刻高精度 HUD 边角线框语言并支持四种终端语义色。
 */
export function TacticalCornerBrackets({
  tone = 'cyan',
  size = 'md',
  className = '',
}: TacticalCornerBracketsProps) {
  const { primary, secondary } = TONE_STROKES[tone];
  const dim = SIZE_DIMENSIONS[size];

  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 z-30 ${className}`}>
      {/* Top-Left */}
      <svg viewBox="0 0 48 48" fill="none" className={`absolute top-0 left-0 ${dim}`}>
        <path
          d="M 1.5 38 L 1.5 16 L 4 13.5 L 4 9 L 9 4 L 13.5 4 L 16 1.5 L 42 1.5"
          stroke={primary}
          strokeWidth="2.1"
          strokeLinecap="square"
        />
        <path
          d="M 6.5 28 L 6.5 13 L 13 6.5 L 30 6.5"
          stroke={secondary}
          strokeWidth="1.15"
          strokeLinecap="square"
        />
        <path d="M 1.5 44 L 1.5 40 M 44 1.5 L 47 1.5" stroke={secondary} strokeWidth="1" />
      </svg>

      {/* Top-Right */}
      <svg viewBox="0 0 48 48" fill="none" className={`absolute top-0 right-0 ${dim} scale-x-[-1]`}>
        <path
          d="M 1.5 38 L 1.5 16 L 4 13.5 L 4 9 L 9 4 L 13.5 4 L 16 1.5 L 42 1.5"
          stroke={primary}
          strokeWidth="2.1"
          strokeLinecap="square"
        />
        <path
          d="M 6.5 28 L 6.5 13 L 13 6.5 L 30 6.5"
          stroke={secondary}
          strokeWidth="1.15"
          strokeLinecap="square"
        />
        <path d="M 1.5 44 L 1.5 40 M 44 1.5 L 47 1.5" stroke={secondary} strokeWidth="1" />
      </svg>

      {/* Bottom-Left */}
      <svg viewBox="0 0 48 48" fill="none" className={`absolute bottom-0 left-0 ${dim} scale-y-[-1]`}>
        <path
          d="M 1.5 38 L 1.5 16 L 4 13.5 L 4 9 L 9 4 L 13.5 4 L 16 1.5 L 42 1.5"
          stroke={primary}
          strokeWidth="2.1"
          strokeLinecap="square"
        />
        <path
          d="M 6.5 28 L 6.5 13 L 13 6.5 L 30 6.5"
          stroke={secondary}
          strokeWidth="1.15"
          strokeLinecap="square"
        />
        <path d="M 1.5 44 L 1.5 40 M 44 1.5 L 47 1.5" stroke={secondary} strokeWidth="1" />
      </svg>

      {/* Bottom-Right */}
      <svg viewBox="0 0 48 48" fill="none" className={`absolute bottom-0 right-0 ${dim} scale-[-1]`}>
        <path
          d="M 1.5 38 L 1.5 16 L 4 13.5 L 4 9 L 9 4 L 13.5 4 L 16 1.5 L 42 1.5"
          stroke={primary}
          strokeWidth="2.1"
          strokeLinecap="square"
        />
        <path
          d="M 6.5 28 L 6.5 13 L 13 6.5 L 30 6.5"
          stroke={secondary}
          strokeWidth="1.15"
          strokeLinecap="square"
        />
        <path d="M 1.5 44 L 1.5 40 M 44 1.5 L 47 1.5" stroke={secondary} strokeWidth="1" />
      </svg>
    </div>
  );
}

interface TacticalCornerSlashesProps {
  readonly tone?: TacticalTone;
  readonly className?: string;
}

const SLASH_FILL: Record<TacticalTone, string> = {
  cyan: '#38bdf8',
  amber: '#e5a52b',
  rose: '#fb7185',
  slate: '#94a3b8',
};

/**
 * 模块左上角倾斜斜杠刻度装饰条（呼应战术作战模式卡片的工业边界识别）。
 */
export function TacticalCornerSlashes({ tone = 'amber', className = '' }: TacticalCornerSlashesProps) {
  const fill = SLASH_FILL[tone];
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 8"
      fill="none"
      className={`pointer-events-none w-11 h-2 ${className}`}
    >
      <polygon points="0,8 5,0 9,0 4,8" fill={fill} fillOpacity="0.9" />
      <polygon points="11,8 16,0 20,0 15,8" fill={fill} fillOpacity="0.72" />
      <polygon points="22,8 27,0 31,0 26,8" fill={fill} fillOpacity="0.52" />
      <polygon points="33,8 38,0 42,0 37,8" fill={fill} fillOpacity="0.32" />
    </svg>
  );
}
