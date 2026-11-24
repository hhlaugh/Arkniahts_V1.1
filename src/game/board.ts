import type { BoardPosition, BoardProfile, CardInstance, LaneId, LaneProfile, Position } from './types';

export const CLASSIC_BOARD_PROFILE: BoardProfile = {
  profileId: 'classic-21-32-21',
  mode: 'classic',
  laneCount: 3,
  lanes: [
    { laneId: 'L1', laneOrder: 0, frontSlots: 2, rearSlots: 1 },
    { laneId: 'L2', laneOrder: 1, frontSlots: 3, rearSlots: 2 },
    { laneId: 'L3', laneOrder: 2, frontSlots: 2, rearSlots: 1 },
  ],
};

export const CUSTOM_5_LANE_EXAMPLE: BoardProfile = {
  profileId: 'custom-5-example',
  mode: 'custom',
  laneCount: 5,
  lanes: [
    { laneId: 'L1', laneOrder: 0, frontSlots: 2, rearSlots: 1 },
    { laneId: 'L2', laneOrder: 1, frontSlots: 3, rearSlots: 2 },
    { laneId: 'L3', laneOrder: 2, frontSlots: 1, rearSlots: 3 },
    { laneId: 'L4', laneOrder: 3, frontSlots: 2, rearSlots: 2 },
    { laneId: 'L5', laneOrder: 4, frontSlots: 1, rearSlots: 1 },
  ],
};

export function createCustomBoardProfile(
  lanes: readonly { frontSlots: number; rearSlots: number; laneId?: string }[],
  profileId = `custom-${lanes.length}-lane`,
): BoardProfile {
  return {
    profileId,
    mode: 'custom',
    laneCount: lanes.length,
    lanes: lanes.map((lane, index) => ({
      laneId: lane.laneId ?? `L${index + 1}`,
      laneOrder: index,
      frontSlots: lane.frontSlots,
      rearSlots: lane.rearSlots,
    })),
  };
}

export function validateBoardProfile(profile: unknown): { readonly valid: boolean; readonly errors: readonly string[] } {
  const errors: string[] = [];
  if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) {
    return { valid: false, errors: ['BoardProfile 必须是对象。'] };
  }
  const p = profile as Record<string, unknown>;
  if (typeof p.profileId !== 'string' || p.profileId.trim() === '') {
    errors.push('profileId 不能为空。');
  }
  if (p.mode !== 'classic' && p.mode !== 'custom') {
    errors.push('mode 必须是 classic 或 custom。');
  }
  if (typeof p.laneCount !== 'number' || !Number.isInteger(p.laneCount) || p.laneCount < 1 || p.laneCount > 5) {
    errors.push('laneCount 必须是 1 到 5 的整数。');
  }
  if (!Array.isArray(p.lanes) || p.lanes.length < 1 || p.lanes.length > 5) {
    errors.push('lanes 数组长度必须在 1 到 5 之间。');
    return { valid: false, errors };
  }
  if (typeof p.laneCount === 'number' && p.lanes.length !== p.laneCount) {
    errors.push(`lanes.length (${p.lanes.length}) 必须等于 laneCount (${p.laneCount})。`);
  }
  if (p.mode === 'classic' && p.laneCount !== 3) {
    errors.push('经典模式必须固定为 3 条路线。');
  }

  const seenLaneIds = new Set<string>();
  const seenOrders = new Set<number>();
  let totalDeployableSlots = 0;

  for (const rawLane of p.lanes) {
    if (typeof rawLane !== 'object' || rawLane === null) {
      errors.push('lane 条目必须是对象。');
      continue;
    }
    const lane = rawLane as Record<string, unknown>;
    if (typeof lane.laneId !== 'string' || lane.laneId.trim() === '') {
      errors.push('laneId 不能为空。');
    } else if (seenLaneIds.has(lane.laneId)) {
      errors.push(`重复的 laneId: ${lane.laneId}`);
    } else {
      seenLaneIds.add(lane.laneId);
    }

    if (typeof lane.laneOrder !== 'number' || !Number.isInteger(lane.laneOrder) || lane.laneOrder < 0 || lane.laneOrder > 4) {
      errors.push(`laneOrder 无效: ${String(lane.laneOrder)}`);
    } else if (seenOrders.has(lane.laneOrder)) {
      errors.push(`重复的 laneOrder: ${lane.laneOrder}`);
    } else {
      seenOrders.add(lane.laneOrder);
    }

    if (typeof lane.frontSlots !== 'number' || !Number.isInteger(lane.frontSlots) || lane.frontSlots < 0 || lane.frontSlots > 3) {
      errors.push(`frontSlots 必须在 0 到 3 之间: ${String(lane.frontSlots)}`);
    } else {
      totalDeployableSlots += lane.frontSlots;
    }

    if (typeof lane.rearSlots !== 'number' || !Number.isInteger(lane.rearSlots) || lane.rearSlots < 0 || lane.rearSlots > 3) {
      errors.push(`rearSlots 必须在 0 到 3 之间: ${String(lane.rearSlots)}`);
    } else {
      totalDeployableSlots += lane.rearSlots;
    }
  }

  if (p.mode === 'classic') {
    const expectedClassicShape: readonly { readonly frontSlots: number; readonly rearSlots: number }[] = [
      { frontSlots: 2, rearSlots: 1 },
      { frontSlots: 3, rearSlots: 2 },
      { frontSlots: 2, rearSlots: 1 },
    ];
    const sortedClassic = [...p.lanes]
      .filter((l): l is Record<string, unknown> => typeof l === 'object' && l !== null)
      .sort((a, b) => Number(a.laneOrder) - Number(b.laneOrder));
    const matchesClassicShape =
      sortedClassic.length === 3 &&
      expectedClassicShape.every(
        (exp, idx) =>
          sortedClassic[idx]?.laneOrder === idx &&
          sortedClassic[idx]?.frontSlots === exp.frontSlots &&
          sortedClassic[idx]?.rearSlots === exp.rearSlots,
      );
    if (!matchesClassicShape) {
      errors.push('经典模式必须为三路 21 / 32 / 21 布局（L1: 前2后1, L2: 前3后2, L3: 前2后1）。');
    }
  }

  if (totalDeployableSlots <= 0) {
    errors.push('棋盘至少需要 1 个可部署格子。');
  }

  return { valid: errors.length === 0, errors };
}

const LEGACY_LANE_ALIASES: Readonly<Record<string, number>> = {
  left: 0,
  center: 1,
  right: 2,
};

/**
 * 将规范 laneId 或经典 3 路别名 ('left'|'center'|'right') 解析到当前 BoardProfile 的真实 LaneProfile。
 */
export function resolveLaneProfile(board: BoardProfile, laneId: LaneId): LaneProfile | undefined {
  const direct = board.lanes.find((l) => l.laneId === laneId);
  if (direct) return direct;
  if (board.laneCount === 3 && laneId in LEGACY_LANE_ALIASES) {
    const order = LEGACY_LANE_ALIASES[laneId];
    return sortedLanes(board).find((l) => l.laneOrder === order);
  }
  return undefined;
}

export function normalizeLaneId(board: BoardProfile, laneId: LaneId): LaneId {
  return resolveLaneProfile(board, laneId)?.laneId ?? laneId;
}

export function sortedLanes(board: BoardProfile): readonly LaneProfile[] {
  return [...board.lanes].sort((a, b) => a.laneOrder - b.laneOrder);
}

export function slotCountForRow(lane: LaneProfile, row: Position): number {
  return row === 'front' ? lane.frontSlots : lane.rearSlots;
}

export function isValidCell(board: BoardProfile, laneId: LaneId, row: Position, slotIndex: number): boolean {
  const lane = resolveLaneProfile(board, laneId);
  if (!lane) return false;
  if (!Number.isInteger(slotIndex) || slotIndex < 1) return false;
  return slotIndex <= slotCountForRow(lane, row);
}

export function getDisplaySlotLabel(row: Position, slotIndex: number): string {
  return `${row === 'front' ? 'F' : 'R'}${slotIndex}`;
}

export function toBoardPosition(
  board: BoardProfile,
  laneId: LaneId,
  row: Position,
  slotIndex = 1,
): BoardPosition | null {
  const lane = resolveLaneProfile(board, laneId);
  if (!lane) return null;
  if (!isValidCell(board, lane.laneId, row, slotIndex)) return null;
  const rowOrder: 0 | 1 = row === 'front' ? 0 : 1;
  return {
    laneId: lane.laneId,
    laneOrder: lane.laneOrder,
    row,
    rowOrder,
    slotIndex,
    displayLabel: getDisplaySlotLabel(row, slotIndex),
    internalKey: `${lane.laneId}:${row}:${slotIndex}`,
  };
}

export function listAllBoardPositions(board: BoardProfile): readonly BoardPosition[] {
  const out: BoardPosition[] = [];
  for (const lane of sortedLanes(board)) {
    for (const row of ['front', 'back'] as const) {
      const count = slotCountForRow(lane, row);
      for (let slotIndex = 1; slotIndex <= count; slotIndex += 1) {
        const pos = toBoardPosition(board, lane.laneId, row, slotIndex);
        if (pos) out.push(pos);
      }
    }
  }
  return out;
}

export function areAdjacentLanes(board: BoardProfile, laneA: LaneId, laneB: LaneId): boolean {
  const a = resolveLaneProfile(board, laneA);
  const b = resolveLaneProfile(board, laneB);
  if (!a || !b) return false;
  return Math.abs(a.laneOrder - b.laneOrder) === 1;
}

export function getSameAndAdjacentLaneIds(board: BoardProfile, laneId: LaneId): readonly LaneId[] {
  const origin = resolveLaneProfile(board, laneId);
  if (!origin) return [];
  return sortedLanes(board)
    .filter((l) => Math.abs(l.laneOrder - origin.laneOrder) <= 1)
    .map((l) => l.laneId);
}

export function getAdjacentLaneIds(board: BoardProfile, laneId: LaneId): readonly LaneId[] {
  const origin = resolveLaneProfile(board, laneId);
  if (!origin) return [];
  return sortedLanes(board)
    .filter((l) => Math.abs(l.laneOrder - origin.laneOrder) === 1)
    .map((l) => l.laneId);
}

export function getInstancePositionKey(board: BoardProfile, instance: CardInstance): {
  readonly laneOrder: number;
  readonly rowOrder: 0 | 1;
  readonly slotIndex: number;
  readonly entityId: string;
} {
  const lane = instance.lane ? resolveLaneProfile(board, instance.lane) : undefined;
  const laneOrder = lane ? lane.laneOrder : 999;
  const rowOrder: 0 | 1 = instance.position === 'front' ? 0 : 1;
  const slotIndex = instance.slot_index ?? 1;
  return {
    laneOrder,
    rowOrder,
    slotIndex,
    entityId: instance.card_instance_id,
  };
}

/**
 * 内部稳定位置比较器：(laneOrder, rowOrder front-before-rear, slotIndex, entityId)
 */
export function compareBoardEntities(board: BoardProfile, a: CardInstance, b: CardInstance): number {
  const ka = getInstancePositionKey(board, a);
  const kb = getInstancePositionKey(board, b);
  return (
    ka.laneOrder - kb.laneOrder ||
    ka.rowOrder - kb.rowOrder ||
    ka.slotIndex - kb.slotIndex ||
    ka.entityId.localeCompare(kb.entityId)
  );
}

export function formatLaneLabelZh(board: BoardProfile, laneId: LaneId | null): string {
  if (!laneId) return '';
  const lane = resolveLaneProfile(board, laneId);
  if (!lane) return String(laneId);
  if (board.mode === 'classic' && board.laneCount === 3) {
    return lane.laneOrder === 0 ? '左路 L1' : lane.laneOrder === 1 ? '中路 L2' : '右路 L3';
  }
  return `路线 ${lane.laneId}`;
}

export function formatCellLabel(board: BoardProfile, laneId: LaneId | null, row: Position | null, slotIndex: number | null): string {
  if (!laneId || !row) return '';
  const lane = resolveLaneProfile(board, laneId);
  const label = getDisplaySlotLabel(row, slotIndex ?? 1);
  return `${lane?.laneId ?? laneId}·${label}`;
}
