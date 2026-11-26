import {
  normalizeLaneId,
  slotCountForRow,
  sortedLanes,
} from '../../game/board';
import { reduceGameAction } from '../../game/engine';
import { enumerateLegalActions, POSITIONS } from '../../game/legal-actions';
import {
  getEffectiveAttackProfile,
  getEligibleLanes,
  getEntityKind,
  hasStatus,
  hasTauntForAttacker,
  selectOrdinaryAttackTargets,
} from '../../game/range';
import type {
  CardInstance,
  CardInstanceId,
  GameAction,
  GameState,
  LaneId,
  PendingEffectChoice,
  PlayerId,
  Position,
} from '../../game/types';

export interface AttackPreviewResult {
  readonly attackerId?: CardInstanceId;
  readonly lane: LaneId;
  readonly controllerId: PlayerId;
  readonly primaryTargetId: CardInstanceId | null;
  readonly targetIds: readonly CardInstanceId[];
  readonly tauntBlocked: boolean;
  readonly attacksBase: boolean;
  readonly cannotAttackReason: string | null;
  readonly laneSlots: readonly { readonly half: PlayerId; readonly lane: LaneId; readonly position: Position }[];
}

/**
 * 与 V1.1 规则引擎 100% 对齐的攻击目标与航道预览选择器（只读，不产生副作用）。
 * 支持已部署实体或悬停待部署格子预演（含嘲讽、集火、范围覆盖与多目标/贯穿预览）。
 */
export function previewAttackTargets(
  state: GameState,
  source:
    | { readonly kind: 'unit'; readonly instance: CardInstance }
    | {
        readonly kind: 'draft';
        readonly cardInstanceId: CardInstanceId;
        readonly controllerId: PlayerId;
        readonly lane: LaneId;
        readonly position: Position;
        readonly slotIndex?: number;
      },
): AttackPreviewResult | null {
  const controllerId = source.kind === 'unit' ? source.instance.controller_id : source.controllerId;
  const rawLane = source.kind === 'unit' ? source.instance.lane : source.lane;
  if (!rawLane) return null;
  const lane = normalizeLaneId(state.board_profile, rawLane);

  const instance =
    source.kind === 'unit' ? source.instance : state.card_instances[source.cardInstanceId];
  if (!instance) return null;

  const def = state.card_definitions[instance.card_id];
  const entityKind = getEntityKind(state, instance);
  if (entityKind === 'facility') return null;

  const previewInstance: CardInstance =
    source.kind === 'draft'
      ? {
          ...instance,
          zone: 'board',
          board_half: controllerId,
          lane,
          position: source.position,
          slot_index: source.slotIndex ?? 1,
          controller_id: controllerId,
          operator_combat: instance.operator_combat ?? {
            current_hp: (def?.hp ?? 1) as CardInstance['operator_combat'] extends { current_hp: infer H } ? H : never,
            current_atk_modifiers: [],
            current_sp: (def?.starting_sp ?? 0) as CardInstance['operator_combat'] extends { current_sp: infer S } ? S : never,
            shield: 0,
            statuses: [],
            equipment_ids: [],
          },
        }
      : instance;

  const profile = getEffectiveAttackProfile(state, previewInstance);
  if (!profile) return null;

  const enemyHalf: PlayerId = controllerId === 'player_a' ? 'player_b' : 'player_a';
  const eligibleLanes = getEligibleLanes(state, lane, profile.route_scope);
  const laneSlots = eligibleLanes.flatMap((l) => [
    { half: enemyHalf, lane: l, position: 'front' as const },
    { half: enemyHalf, lane: l, position: 'back' as const },
  ]);

  let cannotAttackReason: string | null = null;
  if (source.kind === 'unit') {
    if (hasStatus(instance, 'freeze')) {
      cannotAttackReason = '当前处于冻结状态，本回合跳过攻击';
    } else if (hasStatus(instance, 'stun')) {
      cannotAttackReason = '当前处于眩晕状态，本回合跳过攻击';
    } else if (profile.mode === 'support') {
      cannotAttackReason = '医疗干员在战斗阶段优先执行友方治疗';
    } else if (instance.operator_lifecycle?.entered_battle_this_owner_turn && !instance.operator_combat?.granted_immediate_attack_this_turn) {
      cannotAttackReason = '本回合刚部署，将在下次行动后参与交锋';
    }
  } else {
    cannotAttackReason =
      profile.mode === 'support'
        ? '医疗干员部署后于我方战斗阶段治疗友方'
        : '部署当回合不会立刻攻击，下回合按此路径索敌';
  }

  if (profile.mode === 'support') {
    return {
      attackerId: source.kind === 'unit' ? source.instance.card_instance_id : undefined,
      lane,
      controllerId,
      primaryTargetId: null,
      targetIds: [],
      tauntBlocked: false,
      attacksBase: false,
      cannotAttackReason,
      laneSlots: [],
    };
  }

  const targets = selectOrdinaryAttackTargets(state, previewInstance);
  const primary = targets[0] ?? null;
  const tauntBlocked = Boolean(primary && hasTauntForAttacker(state, previewInstance, primary));

  return {
    attackerId: source.kind === 'unit' ? source.instance.card_instance_id : undefined,
    lane,
    controllerId,
    primaryTargetId: primary?.card_instance_id ?? null,
    targetIds: targets.map((t) => t.card_instance_id),
    tauntBlocked,
    attacksBase: targets.length === 0,
    cannotAttackReason,
    laneSlots,
  };
}

/**
 * 直接向引擎 reduceGameAction 查询在目标格子部署手牌（干员或场地设施）失败的权威原因。
 */
export function getInvalidDeployReason(
  state: GameState,
  actorId: PlayerId,
  cardInstanceId: CardInstanceId,
  half: PlayerId,
  lane: LaneId,
  position: Position,
  slotIndex = 1,
): string | null {
  if (half !== actorId) {
    return '只能部署在己方半区阵位。';
  }
  const inst = state.card_instances[cardInstanceId];
  const def = inst ? state.card_definitions[inst.card_id] : undefined;
  if (def?.card_type === 'facility' || (def?.card_type === 'support' && def.support_subtype === 'facility')) {
    const result = reduceGameAction(state, actorId, {
      type: 'play_card',
      card_instance_id: cardInstanceId,
      target_lane: lane,
      target_position: position,
      target_slot_index: slotIndex,
    });
    return result.ok ? null : result.reason;
  }
  const result = reduceGameAction(state, actorId, {
    type: 'deploy_operator',
    card_instance_id: cardInstanceId,
    lane,
    position,
    slot_index: slotIndex,
  });
  return result.ok ? null : result.reason;
}

/**
 * 直接向引擎 reduceGameAction / enumerateLegalActions 查询手牌当前不可打出的真实原因。
 */
export function getInvalidCardReason(
  state: GameState,
  actorId: PlayerId,
  cardInstanceId: CardInstanceId,
): string | null {
  const instance = state.card_instances[cardInstanceId];
  if (!instance) return '找不到卡牌实例。';
  const definition = state.card_definitions[instance.card_id];
  if (!definition) return '找不到卡牌定义。';

  const legal = enumerateLegalActions(state, actorId);
  if (
    legal.some(
      (action) =>
        (action.type === 'deploy_operator' || action.type === 'play_card') &&
        action.card_instance_id === cardInstanceId,
    )
  ) {
    return null;
  }

  if (definition.card_type === 'operator') {
    const preferredPositions: readonly Position[] =
      definition.deploy_rule === 'back_only' || (definition.deploy_rule === undefined && definition.attack_type === 'ranged') || definition.floating
        ? ['back', 'front']
        : ['front', 'back'];

    let firstReason: string | null = null;
    for (const position of preferredPositions) {
      for (const lane of sortedLanes(state.board_profile)) {
        const count = slotCountForRow(lane, position);
        for (let slot = 1; slot <= count; slot += 1) {
          const res = reduceGameAction(state, actorId, {
            type: 'deploy_operator',
            card_instance_id: cardInstanceId,
            lane: lane.laneId,
            position,
            slot_index: slot,
          });
          if (!res.ok) {
            if (!firstReason) firstReason = res.reason;
            if (res.reason !== '所选部署位已被占用。' && res.reason !== '干员不能部署在所选位置。') {
              return res.reason;
            }
          }
        }
      }
    }
    return firstReason ?? '当前无法部署该干员。';
  }

  if (definition.card_type === 'facility' || (definition.card_type === 'support' && definition.support_subtype === 'facility')) {
    let firstReason: string | null = null;
    for (const position of POSITIONS) {
      for (const lane of sortedLanes(state.board_profile)) {
        const count = slotCountForRow(lane, position);
        for (let slot = 1; slot <= count; slot += 1) {
          const res = reduceGameAction(state, actorId, {
            type: 'play_card',
            card_instance_id: cardInstanceId,
            target_lane: lane.laneId,
            target_position: position,
            target_slot_index: slot,
          });
          if (!res.ok) {
            if (!firstReason) firstReason = res.reason;
            if (!res.reason.includes('已被占用')) return res.reason;
          }
        }
      }
    }
    return firstReason ?? '当前棋盘没有空余格位可部署设施。';
  }

  const directPlay = reduceGameAction(state, actorId, {
    type: 'play_card',
    card_instance_id: cardInstanceId,
  });
  if (!directPlay.ok) {
    if (
      directPlay.reason.includes('必须指定') ||
      directPlay.reason.includes('白名单效果并指定目标') ||
      directPlay.reason.includes('需要选择')
    ) {
      return '场上当前没有符合条件的作用目标或路线。';
    }
    return directPlay.reason;
  }
  return null;
}

/**
 * 查询在场单位主动技能、撤离或召回不可执行时的权威引擎原因。
 */
export function getInvalidUnitActionReason(
  state: GameState,
  actorId: PlayerId,
  cardInstanceId: CardInstanceId,
  actionType: 'activate_skill' | 'withdraw_operator' | 'recall_summon',
): string | null {
  if (actionType === 'withdraw_operator') {
    const res = reduceGameAction(state, actorId, {
      type: 'withdraw_operator',
      card_instance_id: cardInstanceId,
    });
    return res.ok ? null : res.reason;
  }
  if (actionType === 'recall_summon') {
    const res = reduceGameAction(state, actorId, {
      type: 'recall_summon',
      card_instance_id: cardInstanceId,
    });
    return res.ok ? null : res.reason;
  }

  const res = reduceGameAction(state, actorId, {
    type: 'activate_skill',
    card_instance_id: cardInstanceId,
  });
  return res.ok ? null : res.reason;
}

/**
 * 查找无需指定目标、路线或阵位的手牌直发动作（如「战术分析」「空降部署」「紧急后勤」）。
 */
export function findDirectPlayAction(
  legalActions: readonly GameAction[],
  cardInstanceId: CardInstanceId,
): Extract<GameAction, { type: 'play_card' }> | undefined {
  return legalActions.find(
    (a): a is Extract<GameAction, { type: 'play_card' }> =>
      a.type === 'play_card' &&
      a.card_instance_id === cardInstanceId &&
      a.target_instance_id === undefined &&
      a.target_lane === undefined &&
      (!a.target_lanes || a.target_lanes.length === 0) &&
      a.target_position === undefined,
  );
}

/**
 * 生成待决效应选择的明确中文操作提示（覆盖弃牌、召唤抉择、前排护盾/掩护及充能等所有待决类型）。
 */
export function getPendingChoicePromptText(
  state: GameState,
  choice: PendingEffectChoice | null | undefined,
): string {
  if (!choice) return '';
  const sourceInst = state.card_instances[choice.source_instance_id];
  const sourceName = sourceInst
    ? state.card_definitions[sourceInst.card_id]?.card_name_zh ?? '战术效果'
    : '战术效果';

  switch (choice.effect) {
    case 'choose_discard':
      return `【${sourceName}】待决弃牌：请点击下方青色高亮手牌，选择 ${choice.amount} 张弃置`;
    case 'choose_summon':
      return `【${sourceName}】待决抉择：请在上方提示栏选择要部署的无人机型号`;
    case 'grant_front_shield':
      return `【${sourceName}】回合支援：请点击棋盘青色高亮前排友方干员获得 +${choice.amount} 护盾`;
    case 'grant_front_cover':
      return `【${sourceName}】回合支援：请点击棋盘青色高亮前排友方干员获得 掩护`;
    case 'gain_sp':
      return `【${sourceName}】回合支援：请点击棋盘青色高亮友方干员充能 +${choice.amount} SP`;
    default:
      return `【${sourceName}】请先完成当前待决战术选择`;
  }
}

