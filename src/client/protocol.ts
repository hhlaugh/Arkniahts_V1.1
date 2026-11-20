import type { BoardProfile, GameAction } from '../game/types';

/**
 * 联机通讯协议类型：访客提交 ActionRequest；房主权威校验并回执 ActionAck。
 */

export type OnlineRole = 'host' | 'guest';

export interface RoomStatePayload {
  readonly code: string;
  readonly started: boolean;
  readonly pausedForGuest: boolean;
  readonly boardProfile?: BoardProfile;
  readonly host: { readonly connected: boolean; readonly deckId: string | null; readonly ready: boolean };
  readonly guest: { readonly connected: boolean; readonly deckId: string | null; readonly ready: boolean } | null;
}

export interface ActionRequest {
  readonly requestId: string;
  readonly expectedStateVersion: number;
  readonly action: GameAction;
}

export interface ActionAck {
  readonly requestId: string;
  readonly ok: boolean;
  readonly reason?: string;
  readonly stateVersion: number;
}

const ACTION_TYPES: ReadonlySet<string> = new Set([
  'end_action_phase',
  'surrender',
  'play_card',
  'deploy_operator',
  'withdraw_operator',
  'recall_summon',
  'set_focus_target',
  'activate_skill',
  'resolve_pending_choice',
]);
const POSITIONS: ReadonlySet<string> = new Set(['front', 'back']);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveSlotIndex(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3);
}

/** ActionRequest 的轻量运行时 schema 校验：结构校验后仍由引擎 reduceGameAction 执行完整合法性判定。 */
export function isActionRequest(value: unknown): value is ActionRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Record<string, unknown>;
  if (!isNonEmptyString(request.requestId)) return false;
  if (!isNonNegativeInteger(request.expectedStateVersion)) return false;
  const action = request.action;
  if (typeof action !== 'object' || action === null) return false;
  const fields = action as Record<string, unknown>;
  if (typeof fields.type !== 'string' || !ACTION_TYPES.has(fields.type)) return false;
  const hasOptionalTarget = fields.target_instance_id === undefined || isNonEmptyString(fields.target_instance_id);
  const hasOptionalSecondary =
    fields.secondary_target_instance_id === undefined || isNonEmptyString(fields.secondary_target_instance_id);
  const hasOptionalLane = fields.target_lane === undefined || isNonEmptyString(fields.target_lane);
  const hasOptionalLanes =
    fields.target_lanes === undefined ||
    (Array.isArray(fields.target_lanes) && fields.target_lanes.every((l) => isNonEmptyString(l)));
  const hasOptionalPosition =
    fields.target_position === undefined || (typeof fields.target_position === 'string' && POSITIONS.has(fields.target_position));

  switch (fields.type) {
    case 'end_action_phase':
    case 'surrender':
      return true;
    case 'play_card':
      return (
        isNonEmptyString(fields.card_instance_id) &&
        hasOptionalTarget &&
        hasOptionalSecondary &&
        hasOptionalLane &&
        hasOptionalLanes &&
        hasOptionalPosition &&
        isPositiveSlotIndex(fields.target_slot_index)
      );
    case 'withdraw_operator':
    case 'recall_summon':
      return isNonEmptyString(fields.card_instance_id);
    case 'activate_skill':
      return isNonEmptyString(fields.card_instance_id) && hasOptionalTarget;
    case 'set_focus_target':
      return fields.target_instance_id === null || isNonEmptyString(fields.target_instance_id);
    case 'deploy_operator':
      return (
        isNonEmptyString(fields.card_instance_id) &&
        isNonEmptyString(fields.lane) &&
        typeof fields.position === 'string' &&
        POSITIONS.has(fields.position) &&
        isPositiveSlotIndex(fields.slot_index)
      );
    case 'resolve_pending_choice':
      return (
        isNonEmptyString(fields.source_instance_id) &&
        hasOptionalTarget &&
        (fields.choice_id === undefined || isNonEmptyString(fields.choice_id))
      );
    default:
      return false;
  }
}

export function isActionAck(value: unknown): value is ActionAck {
  if (typeof value !== 'object' || value === null) return false;
  const ack = value as Record<string, unknown>;
  if (!isNonEmptyString(ack.requestId)) return false;
  if (typeof ack.ok !== 'boolean') return false;
  if (ack.reason !== undefined && typeof ack.reason !== 'string') return false;
  return isNonNegativeInteger(ack.stateVersion);
}
