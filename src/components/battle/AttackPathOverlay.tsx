import React from 'react';
import type { LaneId, PlayerId, Position } from '../../game/types';
import type { LaneStrikeCue } from './combatPresentation';

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

interface AttackPathOverlayProps {
  readonly strikes: readonly LaneStrikeCue[];
  readonly bottomPlayer: PlayerId;
  readonly topPlayer: PlayerId;
  readonly laneIds?: readonly LaneId[];
  readonly slotCenters?: Readonly<Record<string, Point2D>>;
  readonly boardSize?: { readonly width: number; readonly height: number };
  readonly cssAnimScale: number;
  readonly disableMotion: boolean;
}

const LEGACY_LANE_INDEX: Readonly<Record<string, number>> = {
  left: 0,
  center: 1,
  right: 2,
};

function computeLaneXRatio(lane: LaneId, laneIds?: readonly LaneId[]): number {
  if (laneIds && laneIds.length > 0) {
    const idx = laneIds.indexOf(lane);
    if (idx >= 0) {
      return (idx + 0.5) / laneIds.length;
    }
  }
  if (lane in LEGACY_LANE_INDEX) {
    return (LEGACY_LANE_INDEX[lane] + 0.5) / 3;
  }
  const match = /^L(\d+)$/.exec(lane);
  if (match) {
    const count = Math.max(laneIds?.length ?? 3, Number(match[1]));
    return (Number(match[1]) - 0.5) / count;
  }
  return 0.5;
}

function parseSlotKey(slotKey: string): { half: PlayerId; lane: LaneId; position: Position; slotIndex: number } | null {
  const parts = slotKey.split(':');
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [half, lane, position, rawSlot] = parts;
  if (
    (half === 'player_a' || half === 'player_b') &&
    lane.length > 0 &&
    (position === 'front' || position === 'back')
  ) {
    const slotIndex = rawSlot ? Math.max(1, Number.parseInt(rawSlot, 10) || 1) : 1;
    return { half, lane, position, slotIndex };
  }
  return null;
}

function fallbackPointForSlot(
  slotKey: string,
  bottomPlayer: PlayerId,
  topPlayer: PlayerId,
  width: number,
  height: number,
  laneIds?: readonly LaneId[],
): Point2D | null {
  const parsed = parseSlotKey(slotKey);
  if (!parsed) return null;
  const x = computeLaneXRatio(parsed.lane, laneIds) * width;
  let yRatio = 0.5;
  if (parsed.half === topPlayer) {
    yRatio = parsed.position === 'back' ? 0.21 : 0.40;
  } else if (parsed.half === bottomPlayer) {
    yRatio = parsed.position === 'front' ? 0.60 : 0.79;
  }
  return { x, y: yRatio * height };
}

function fallbackBasePoint(
  targetHalf: PlayerId,
  lane: LaneId,
  bottomPlayer: PlayerId,
  width: number,
  height: number,
  laneIds?: readonly LaneId[],
): Point2D {
  const x = computeLaneXRatio(lane, laneIds) * width;
  const y = (targetHalf === bottomPlayer ? 0.96 : 0.04) * height;
  return { x, y };
}

function buildStrikePathD(start: Point2D, end: Point2D, attackType: 'melee' | 'ranged', direction: 'up' | 'down'): string {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (attackType === 'ranged' || Math.abs(dx) > 12) {
    // 远程或跨路攻击采用带横向弧度的战术抛物线，避开中线遮挡，清晰展示起点与落点
    const curveOffset = Math.abs(dx) > 12 ? 0 : direction === 'up' ? 34 : -34;
    const cx = (start.x + end.x) / 2 + curveOffset;
    const cy = (start.y + end.y) / 2;
    return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  }
  // 近战直线突刺路径，略微偏移避免完全压在文字中心
  const offset = direction === 'up' ? -2 : 2;
  return `M ${(start.x + offset).toFixed(1)} ${start.y.toFixed(1)} L ${(end.x + offset).toFixed(1)} ${(end.y + dy * 0.01).toFixed(1)}`;
}

/**
 * 全棋盘战术攻击路径矢量覆盖层 (AttackPathOverlay)
 * 在攻击节拍内直接连接攻击方格位与目标格位（或基地边界），提供清晰的视觉轨迹与锁定准星。
 */
export function AttackPathOverlay({
  strikes,
  bottomPlayer,
  topPlayer,
  laneIds,
  slotCenters,
  boardSize,
  cssAnimScale,
  disableMotion,
}: AttackPathOverlayProps) {
  if (disableMotion || strikes.length === 0) return null;

  const width = boardSize && boardSize.width > 0 ? boardSize.width : 900;
  const height = boardSize && boardSize.height > 0 ? boardSize.height : 420;
  const travelSeconds = Math.max(0.24, 0.44 * (cssAnimScale > 0 ? cssAnimScale : 1));

  return (
    <svg
      data-testid="attack-path-overlay"
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 w-full h-full z-30 overflow-visible"
    >
      <defs>
        <marker id="atk-arrow-ally" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
          <path d="M 0 1.2 L 9.5 5 L 0 8.8 L 2.6 5 Z" fill="#e5a52b" />
        </marker>
        <marker id="atk-arrow-enemy" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
          <path d="M 0 1.2 L 9.5 5 L 0 8.8 L 2.6 5 Z" fill="#fb7185" />
        </marker>
        <marker id="atk-arrow-skill" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
          <path d="M 0 1.2 L 9.5 5 L 0 8.8 L 2.6 5 Z" fill="#22d3ee" />
        </marker>
      </defs>

      {strikes.map((strike) => {
        const start =
          slotCenters?.[strike.attackerSlotKey] ??
          fallbackPointForSlot(strike.attackerSlotKey, bottomPlayer, topPlayer, width, height, laneIds);
        if (!start) return null;

        let end: Point2D | null = null;
        if (strike.targetSlotKey) {
          end =
            slotCenters?.[strike.targetSlotKey] ??
            fallbackPointForSlot(strike.targetSlotKey, bottomPlayer, topPlayer, width, height, laneIds);
        } else if (strike.toBase) {
          const targetHalf = strike.targetHalf ?? (strike.direction === 'up' ? topPlayer : bottomPlayer);
          const targetLane = strike.targetLane ?? strike.lane;
          const baseLaneFrontKey = `${targetHalf}:${targetLane}:front:1`;
          const frontCenter = slotCenters?.[baseLaneFrontKey] ?? slotCenters?.[`${targetHalf}:${targetLane}:back:1`];
          if (frontCenter) {
            end = {
              x: frontCenter.x,
              y: strike.direction === 'up' ? Math.max(10, frontCenter.y - 96) : Math.min(height - 10, frontCenter.y + 96),
            };
          } else {
            end = fallbackBasePoint(targetHalf, targetLane, bottomPlayer, width, height, laneIds);
          }
        }

        if (!end) return null;

        const isSkill = strike.kind === 'skill';
        const isAlly = strike.direction === 'up';
        const primaryColor = isSkill ? '#22d3ee' : isAlly ? '#38bdf8' : '#fb7185';
        const accentColor = isSkill ? '#a5f3fc' : isAlly ? '#e5a52b' : '#fb7185';
        const markerUrl = isSkill
          ? 'url(#atk-arrow-skill)'
          : isAlly
            ? 'url(#atk-arrow-ally)'
            : 'url(#atk-arrow-enemy)';

        const pathD = buildStrikePathD(start, end, strike.attackType, strike.direction);
        const isStrikePhase = strike.phase === 'strike';
        const rSize = strike.toBase ? 13 : 11;

        return (
          <g key={`${strike.id}-${strike.phase}`}>
            {/* 攻击起点精密菱形基准锚点 */}
            <polygon
              points={`${start.x},${start.y - 7} ${start.x + 7},${start.y} ${start.x},${start.y + 7} ${start.x - 7},${start.y}`}
              fill="none"
              stroke={primaryColor}
              strokeWidth={isStrikePhase ? 1.5 : 1}
              strokeOpacity={isStrikePhase ? 0.88 : 0.35}
            />
            <rect
              x={start.x - 2}
              y={start.y - 2}
              width={4}
              height={4}
              fill={accentColor}
              fillOpacity={isStrikePhase ? 0.95 : 0.45}
            />

            {/* 外层低不透明度轨道辅线 */}
            <path
              d={pathD}
              fill="none"
              stroke={primaryColor}
              strokeWidth={isStrikePhase ? 3.5 : 2}
              strokeOpacity={isStrikePhase ? 0.16 : 0.08}
              strokeLinecap="butt"
            />

            {/* 精密矢量弹道主线 */}
            <path
              d={pathD}
              fill="none"
              stroke={accentColor}
              strokeWidth={isStrikePhase ? 1.8 : 1.2}
              strokeOpacity={isStrikePhase ? 0.94 : 0.42}
              strokeLinecap="butt"
              markerEnd={markerUrl}
              className={isStrikePhase ? 'anim-path-draw' : undefined}
            />

            {/* 打击阶段：遥测虚线流与矢量梭形弹头 */}
            {isStrikePhase && (
              <>
                <path
                  d={pathD}
                  fill="none"
                  stroke="#f8fafc"
                  strokeWidth={1.1}
                  strokeOpacity={0.78}
                  className="anim-path-flow"
                />
                <g>
                  <polygon
                    points={strike.attackType === 'ranged' ? '-7,-2.4 7.5,0 -7,2.4 -3.5,0' : '-5.5,-2.2 6,0 -5.5,2.2 -2.5,0'}
                    fill={accentColor}
                    stroke="#f8fafc"
                    strokeWidth={0.9}
                  />
                  <animateMotion dur={`${travelSeconds.toFixed(2)}s`} rotate="auto" repeatCount="1" fill="freeze" path={pathD} />
                </g>
              </>
            )}

            {/* 目标点直角方括锁定准星 / 几何菱形冲击框 */}
            {isStrikePhase ? (
              <g className="anim-reticle-lock">
                <polygon
                  points={`${end.x},${end.y - (rSize - 2)} ${end.x + (rSize - 2)},${end.y} ${end.x},${end.y + (rSize - 2)} ${end.x - (rSize - 2)},${end.y}`}
                  fill={primaryColor}
                  fillOpacity={0.1}
                  stroke={primaryColor}
                  strokeWidth={1.1}
                  strokeOpacity={0.7}
                />
                {/* 四角 L 型测绘准星括号 */}
                <path
                  d={`M ${end.x - rSize} ${end.y - 5} L ${end.x - rSize} ${end.y - rSize} L ${end.x - 5} ${end.y - rSize}`}
                  fill="none"
                  stroke={accentColor}
                  strokeWidth={1.6}
                />
                <path
                  d={`M ${end.x + 5} ${end.y - rSize} L ${end.x + rSize} ${end.y - rSize} L ${end.x + rSize} ${end.y - 5}`}
                  fill="none"
                  stroke={accentColor}
                  strokeWidth={1.6}
                />
                <path
                  d={`M ${end.x - rSize} ${end.y + 5} L ${end.x - rSize} ${end.y + rSize} L ${end.x - 5} ${end.y + rSize}`}
                  fill="none"
                  stroke={accentColor}
                  strokeWidth={1.6}
                />
                <path
                  d={`M ${end.x + 5} ${end.y + rSize} L ${end.x + rSize} ${end.y + rSize} L ${end.x + rSize} ${end.y + 5}`}
                  fill="none"
                  stroke={accentColor}
                  strokeWidth={1.6}
                />
                <line x1={end.x - (rSize + 5)} y1={end.y} x2={end.x - (rSize - 3)} y2={end.y} stroke={accentColor} strokeWidth={1.2} />
                <line x1={end.x + (rSize - 3)} y1={end.y} x2={end.x + (rSize + 5)} y2={end.y} stroke={accentColor} strokeWidth={1.2} />
                <line x1={end.x} y1={end.y - (rSize + 5)} x2={end.x} y2={end.y - (rSize - 3)} stroke={accentColor} strokeWidth={1.2} />
                <line x1={end.x} y1={end.y + (rSize - 3)} x2={end.x} y2={end.y + (rSize + 5)} stroke={accentColor} strokeWidth={1.2} />
              </g>
            ) : (
              <g className="anim-impact-burst">
                <polygon
                  points={`${end.x},${end.y - 16} ${end.x + 16},${end.y} ${end.x},${end.y + 16} ${end.x - 16},${end.y}`}
                  fill={accentColor}
                  fillOpacity={0.14}
                  stroke={accentColor}
                  strokeWidth={1.8}
                />
                <rect
                  x={end.x - 8}
                  y={end.y - 8}
                  width={16}
                  height={16}
                  fill="none"
                  stroke="#f8fafc"
                  strokeOpacity={0.65}
                  strokeWidth={1}
                />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
