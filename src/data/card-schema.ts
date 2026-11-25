import type { EffectActionType, EffectTrigger, StatusKind } from '../game/types';

export const CARD_TYPES = ['operator', 'tactic', 'support', 'facility'] as const;
export const LANES = ['L1', 'L2', 'L3'] as const;
export const LEGACY_LANES = ['left', 'center', 'right'] as const;
export const POSITIONS = ['front', 'back'] as const;
export const GAME_PHASES = ['mulligan', 'turn_start', 'action', 'combat', 'turn_end', 'finished'] as const;

export const MAX_CARD_COST_CP = 8;

export const EFFECT_TRIGGERS: readonly EffectTrigger[] = [
  'turn_start', 'turn_end', 'on_play', 'on_deploy', 'on_attacked', 'on_damaged',
  'on_damage_survive', 'on_lethal', 'on_death', 'on_ally_death', 'on_kill', 'on_heal',
  'on_leave_field', 'combat_end', 'combat_start', 'combat_attack_step',
  'before_attack', 'after_attack', 'before_heal', 'on_ally_damaged',
  'on_entity_destroyed', 'on_friendly_operator_deploy',
  'active', 'passive_free', 'passive_sp', 'reaction_sp', 'none',
  'on_attack_declared', 'on_attack_resolved', 'continuous', 'on_friendly_attack_declared',
];

export const EFFECT_ACTION_TYPES: readonly EffectActionType[] = [
  'gain_cost', 'reduce_incoming_damage', 'damage', 'heal', 'apply_status',
  'withdraw_operator', 'attach_equipment', 'choose_friendly_operator_gain_sp', 'gain_shield',
  'reduce_damage', 'buff_attack', 'debuff_attack', 'bonus_damage', 'shield', 'prevent_lethal',
  'summon', 'if_else', 'gain_sp',
];

export const SKILL_EFFECT_OPS = [
  'apply_attack_profile_modifier',
  'apply_cold_or_freeze',
  'apply_stat_modifier',
  'apply_status',
  'choose_and_summon',
  'choose_discard',
  'conditional_attack_modifier',
  'deal_damage',
  'deal_damage_and_status',
  'deal_damage_and_suppression',
  'deal_damage_to_all',
  'deal_damage_to_snapshot',
  'defeat_unit',
  'disable_facility',
  'draw_cards',
  'exclude_from_friendly_heal_targets',
  'for_each',
  'grant_cover',
  'grant_deploy_cost_discount',
  'grant_first_attack_modifier',
  'grant_immediate_attack',
  'grant_next_deploy_discount',
  'grant_shield',
  'grant_supply',
  'heal',
  'heal_and_shield',
  'if_else',
  'if_then',
  'increase_attack_permanently',
  'install_equipment_effect',
  'lose_hp',
  'modify_current_attack_damage',
  'modify_current_attack_power',
  'modify_heal_amount',
  'move_or_swap_unit',
  'move_unit',
  'pay_upkeep',
  'prevent_lethal',
  'push_unit',
  'remove_equipment_effect',
  'remove_first_available',
  'remove_shield',
  'remove_status',
  'return_to_hand',
  'set_attack_profile_modifier',
  'snapshot_targets',
  'summon_unit',
] as const;

export const STATUS_KINDS: readonly StatusKind[] = [
  'stun',
  'freeze',
  'grounded',
  'slow',
  'taunt',
  'silence',
  'suppressed',
  'chilled',
  'vulnerable',
  'cover',
  'poisoned',
] as const;

/** JSON Schema subset for the V1.1 data contract; cross-record invariants are runtime-validated below. */
export const cardPoolJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'array',
  items: {
    type: 'object',
    required: ['card_id', 'card_name_zh', 'card_type', 'rarity', 'cost', 'effect_trigger', 'effect_json'],
    properties: {
      card_id: { type: 'string', minLength: 1 },
      card_name_zh: { type: 'string', minLength: 1 },
      card_type: { enum: CARD_TYPES },
      support_subtype: { enum: ['', 'facility', 'equipment'] },
      rarity: { type: 'integer', minimum: 1, maximum: 6 },
      cost: { type: 'integer', minimum: 0, maximum: MAX_CARD_COST_CP },
      floating: { type: 'boolean' },
      occupies_cell: { type: 'boolean' },
      intercept_eligible: { type: 'boolean' },
      active_skill_sp_cost: { type: ['integer', 'null'], minimum: 0 },
      effect_trigger: { enum: EFFECT_TRIGGERS },
      effect_json: {
        type: 'object',
        properties: {
          trigger: { enum: EFFECT_TRIGGERS },
          actions: {
            type: 'array',
            items: { type: 'object', required: ['type'], properties: { type: { enum: EFFECT_ACTION_TYPES } } },
          },
        },
      },
    },
  },
} as const;
