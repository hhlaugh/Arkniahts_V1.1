import { areAdjacentLanes, slotCountForRow, sortedLanes } from './board';
import { reduceGameAction } from './engine';
import { getEntityKind } from './range';
import type { CardId, GameAction, GameState, PlayerId, Position } from './types';

export const POSITIONS: readonly Position[] = ['front', 'back'];

function isLegal(state: GameState, actorId: PlayerId, action: GameAction): boolean {
  return reduceGameAction(state, actorId, action).ok;
}

/**
 * 引擎层的合法动作查询：全由 reduceGameAction 验证兜底，UI/AI 不得自行推导规则边界。
 * 支持任意 1–5 路、每排 0–3 格的自定义 BoardProfile。
 */
export function enumerateLegalActions(state: GameState, playerId: PlayerId): readonly GameAction[] {
  if (
    ((state.phase === 'turn_start' && state.turn_start_prepared) || state.phase === 'action') &&
    state.pending_effect_choices.length > 0
  ) {
    const candidates: GameAction[] = [];
    const choice = state.pending_effect_choices[0];
    if (choice.effect === 'choose_summon') {
      for (const opt of choice.options ?? ['magallan_strike_drone', 'magallan_support_drone']) {
        candidates.push({
          type: 'resolve_pending_choice',
          source_instance_id: choice.source_instance_id,
          choice_id: opt,
        });
      }
    } else if (choice.effect === 'choose_discard') {
      for (const cardId of state.players[playerId]?.hand ?? []) {
        candidates.push({
          type: 'resolve_pending_choice',
          source_instance_id: choice.source_instance_id,
          target_instance_id: cardId,
        });
      }
    } else {
      candidates.push({ type: 'resolve_pending_choice', source_instance_id: choice.source_instance_id });
      for (const unit of Object.values(state.card_instances)) {
        if (unit.zone !== 'board' || unit.controller_id !== playerId) continue;
        candidates.push({
          type: 'resolve_pending_choice',
          source_instance_id: choice.source_instance_id,
          target_instance_id: unit.card_instance_id,
        });
      }
    }
    return candidates.filter((action) => isLegal(state, playerId, action));
  }

  if (state.phase !== 'action') return [];

  const lanes = sortedLanes(state.board_profile);
  const candidates: GameAction[] = [{ type: 'end_action_phase' }];
  const boardEntities = Object.values(state.card_instances).filter((instance) => instance.zone === 'board');
  const ownEntities = boardEntities.filter((e) => e.controller_id === playerId);
  const enemyEntities = boardEntities.filter((e) => e.controller_id !== playerId);

  for (const id of state.players[playerId].hand) {
    const instance = state.card_instances[id];
    const definition = instance ? state.card_definitions[instance.card_id] : undefined;
    if (!definition) continue;

    if (definition.card_type === 'operator') {
      for (const lane of lanes) {
        for (const position of POSITIONS) {
          const slots = slotCountForRow(lane, position);
          for (let slot = 1; slot <= slots; slot += 1) {
            candidates.push({
              type: 'deploy_operator',
              card_instance_id: id,
              lane: lane.laneId,
              position,
              slot_index: slot,
            });
          }
        }
      }
      continue;
    }

    if (definition.card_type === 'facility' || (definition.card_type === 'support' && definition.support_subtype === 'facility')) {
      for (const lane of lanes) {
        for (const position of POSITIONS) {
          const slots = slotCountForRow(lane, position);
          for (let slot = 1; slot <= slots; slot += 1) {
            candidates.push({
              type: 'play_card',
              card_instance_id: id,
              target_lane: lane.laneId,
              target_position: position,
              target_slot_index: slot,
            });
          }
        }
      }
      continue;
    }

    if (definition.card_type === 'support') {
      for (const unit of ownEntities) {
        if (getEntityKind(state, unit) === 'facility') continue;
        candidates.push({
          type: 'play_card',
          card_instance_id: id,
          target_instance_id: unit.card_instance_id,
        });
      }
      continue;
    }

    // 战术卡细分候选生成
    const cardId = definition.card_id;
    if (cardId === ('DEMO-TAC-V2-001' as CardId)) {
      const ownOps = ownEntities.filter((u) => getEntityKind(state, u) === 'operator');
      for (let i = 0; i < ownOps.length; i += 1) {
        for (let j = i + 1; j < ownOps.length; j += 1) {
          candidates.push({
            type: 'play_card',
            card_instance_id: id,
            target_instance_id: ownOps[i].card_instance_id,
            secondary_target_instance_id: ownOps[j].card_instance_id,
          });
        }
      }
    } else if (cardId === ('DEMO-TAC-V2-003' as CardId) || cardId === ('DEMO-TAC-V2-011' as CardId)) {
      for (const lane of lanes) {
        candidates.push({
          type: 'play_card',
          card_instance_id: id,
          target_lane: lane.laneId,
        });
      }
    } else if (cardId === ('DEMO-TAC-V2-014' as CardId)) {
      if (lanes.length === 1) {
        candidates.push({
          type: 'play_card',
          card_instance_id: id,
          target_lanes: [lanes[0].laneId],
        });
      } else {
        for (let i = 0; i < lanes.length - 1; i += 1) {
          candidates.push({
            type: 'play_card',
            card_instance_id: id,
            target_lanes: [lanes[i].laneId, lanes[i + 1].laneId],
          });
        }
      }
    } else if (cardId === ('DEMO-TAC-V2-015' as CardId)) {
      for (const unit of ownEntities) {
        if (getEntityKind(state, unit) !== 'operator' || !unit.lane) continue;
        for (const lane of lanes) {
          if (areAdjacentLanes(state.board_profile, unit.lane, lane.laneId)) {
            candidates.push({
              type: 'play_card',
              card_instance_id: id,
              target_instance_id: unit.card_instance_id,
              target_lane: lane.laneId,
            });
          }
        }
      }
    } else if (cardId === ('DEMO-TAC-V2-016' as CardId)) {
      for (const unit of enemyEntities) {
        if (getEntityKind(state, unit) !== 'operator' || unit.position !== 'front' || !unit.lane) continue;
        for (const lane of lanes) {
          if (areAdjacentLanes(state.board_profile, unit.lane, lane.laneId)) {
            candidates.push({
              type: 'play_card',
              card_instance_id: id,
              target_instance_id: unit.card_instance_id,
              target_lane: lane.laneId,
            });
          }
        }
      }
    } else if (
      cardId === ('DEMO-TAC-V2-002' as CardId) ||
      cardId === ('DEMO-TAC-V2-006' as CardId) ||
      cardId === ('DEMO-TAC-V2-021' as CardId)
    ) {
      candidates.push({ type: 'play_card', card_instance_id: id });
    } else {
      for (const target of boardEntities) {
        candidates.push({
          type: 'play_card',
          card_instance_id: id,
          target_instance_id: target.card_instance_id,
        });
      }
    }
  }

  for (const unit of ownEntities) {
    const kind = getEntityKind(state, unit);
    if (kind === 'operator') {
      candidates.push({ type: 'withdraw_operator', card_instance_id: unit.card_instance_id });
    } else if (kind === 'summon') {
      candidates.push({ type: 'recall_summon', card_instance_id: unit.card_instance_id });
    }
  }

  const currentFocus = state.players[playerId]?.focus_target_id ?? null;
  for (const enemy of enemyEntities) {
    if (enemy.card_instance_id !== currentFocus) {
      candidates.push({ type: 'set_focus_target', target_instance_id: enemy.card_instance_id });
    }
  }
  if (currentFocus !== null) {
    candidates.push({ type: 'set_focus_target', target_instance_id: null });
  }

  return candidates.filter((action) => isLegal(state, playerId, action));
}
