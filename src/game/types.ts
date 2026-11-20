export type PlayerId = 'player_a' | 'player_b';
export type LaneId = string;
export type Position = 'front' | 'back';
export type GamePhase = 'mulligan' | 'turn_start' | 'action' | 'combat' | 'turn_end' | 'finished';

declare const identifierBrand: unique symbol;
export type CardId = string & { readonly [identifierBrand]: 'CardId' };
export type CardInstanceId = string & { readonly [identifierBrand]: 'CardInstanceId' };
export type Cost = number & { readonly [identifierBrand]: 'Cost' };
export type PaidDeployCost = number & { readonly [identifierBrand]: 'PaidDeployCost' };
export type SpValue = number & { readonly [identifierBrand]: 'SpValue' };
export type SpCost = number & { readonly [identifierBrand]: 'SpCost' };
export type BasePoints = number & { readonly [identifierBrand]: 'BasePoints' };
export type HpValue = number & { readonly [identifierBrand]: 'HpValue' };

export type CardType = 'operator' | 'tactic' | 'support';
export type AttackType = 'melee' | 'ranged';
export type AttackMode = 'melee' | 'ranged' | 'support';
export type DamageType = 'physical' | 'arts' | 'none';
export type OperatorClass = 'vanguard' | 'guard' | 'defender' | 'sniper' | 'caster' | 'medic' | 'supporter' | 'specialist';
export type DeployRule = 'front_only' | 'front_or_back' | 'back_only' | 'any_empty' | 'attach_friendly_unit';
export type EntityKind = 'operator' | 'facility' | 'summon';

export type BoardMode = 'classic' | 'custom';

export interface LaneProfile {
  readonly laneId: LaneId;
  readonly laneOrder: number;
  readonly frontSlots: number;
  readonly rearSlots: number;
}

export interface BoardProfile {
  readonly profileId: string;
  readonly mode: BoardMode;
  readonly laneCount: number;
  readonly lanes: readonly LaneProfile[];
}

export interface BoardPosition {
  readonly laneId: LaneId;
  readonly laneOrder: number;
  readonly row: Position;
  readonly rowOrder: 0 | 1;
  readonly slotIndex: number;
  readonly displayLabel: string;
  readonly internalKey: string;
}

export type StatusKind =
  | 'stun'
  | 'freeze'
  | 'grounded'
  | 'slow'
  | 'taunt'
  | 'silence'
  | 'suppressed'
  | 'chilled'
  | 'vulnerable'
  | 'cover'
  | 'poisoned';

export type ExpireAtNode =
  | 'owner_turn_start'
  | 'owner_next_turn_start'
  | 'owner_next_turn_end'
  | 'source_next_turn_start'
  | 'target_next_basic_attack'
  | 'combat_end'
  | 'until_removed';

export type EffectTrigger =
  | 'turn_start' | 'turn_end' | 'on_play' | 'on_deploy' | 'on_attacked' | 'on_damaged'
  | 'on_damage_survive' | 'on_lethal' | 'on_death' | 'on_ally_death' | 'on_kill'
  | 'on_heal' | 'on_leave_field' | 'combat_end' | 'combat_start' | 'combat_attack_step'
  | 'before_attack' | 'after_attack' | 'before_heal' | 'on_ally_damaged'
  | 'on_entity_destroyed' | 'on_friendly_operator_deploy'
  | 'active' | 'passive_free' | 'passive_sp' | 'reaction_sp' | 'none'
  | 'on_attack_declared' | 'on_attack_resolved' | 'continuous' | 'on_friendly_attack_declared';

export type EffectActionType =
  | 'gain_cost' | 'reduce_incoming_damage' | 'damage' | 'heal' | 'apply_status'
  | 'withdraw_operator' | 'attach_equipment' | 'choose_friendly_operator_gain_sp' | 'gain_shield'
  | 'reduce_damage' | 'buff_attack' | 'debuff_attack' | 'bonus_damage' | 'shield' | 'prevent_lethal'
  | 'summon' | 'if_else' | 'gain_sp'
  | string;

export interface EffectAction {
  readonly type: EffectActionType;
  readonly sp_cost?: SpCost;
  readonly [key: string]: unknown;
}

export interface EffectDefinition {
  readonly trigger: EffectTrigger;
  readonly actions: readonly EffectAction[];
  readonly v1_1_blocks?: readonly SkillEffectBlock[];
  readonly [key: string]: unknown;
}

export type RouteScope = 'same_lane' | 'same_and_adjacent_lane' | 'all_lanes' | 'explicit_lanes' | 'explicit_cells';
export type TargetPriority = 'front_first' | 'back_first' | 'lowest_hp' | 'lowest_hp_ratio' | 'highest_hp' | 'shield_first';
export type AttackPattern = 'single' | 'multi_hit' | 'multi_target' | 'line' | 'splash' | 'chain' | 'heal_single' | 'heal_multi';

export interface AttackProfile {
  readonly mode: AttackMode;
  readonly damage_type: DamageType;
  readonly route_scope: RouteScope | string;
  readonly target_priority: TargetPriority | string;
  readonly pattern: AttackPattern | string;
  readonly target_limit: number | 'all';
  readonly deploy_rule: DeployRule | string;
  readonly intercept_eligible: boolean;
  readonly can_target_back?: boolean;
  readonly hit_count?: number;
  readonly hit_damage?: number | string;
  readonly damage_per_hit?: number | string;
  readonly splash_damage?: number;
  readonly secondary_damage?: number;
  readonly jump_count?: number;
  readonly jump_damage?: number;
  readonly heal_amount?: number | string;
}

export interface SkillEffectOp {
  readonly op: string;
  readonly [key: string]: unknown;
}

export interface SkillEffectBlock {
  readonly trigger: string;
  readonly effects: readonly SkillEffectOp[];
  readonly subphase?: string;
  readonly filter?: Readonly<Record<string, unknown>>;
}

export interface NativeTrait {
  readonly trait_id: string;
  readonly trigger?: string;
  readonly effect?: SkillEffectOp;
}

export interface CardDefinition {
  readonly card_id: CardId;
  readonly card_name_zh: string;
  readonly card_type: CardType;
  readonly support_subtype?: 'facility' | 'equipment' | '';
  readonly rarity: number;
  readonly cost: Cost;
  readonly v3_3_original_cost_cp?: number;
  readonly hp?: HpValue;
  readonly atk?: number;
  readonly class?: OperatorClass;
  readonly operator_subclass_zh?: string;
  readonly attack_type?: AttackType;
  readonly attack_mode?: AttackMode;
  readonly damage_type?: DamageType;
  readonly deploy_rule?: DeployRule;
  readonly floating?: boolean;
  readonly intercept_eligible?: boolean;
  readonly occupies_cell?: boolean;
  readonly taunt_scope?: 'none' | 'same_lane' | 'all_lanes';
  readonly max_sp?: number;
  readonly starting_sp?: number;
  readonly sp_regen_per_turn?: number;
  readonly sp_gain_on_attacked?: number;
  readonly sp_gain_on_damaged?: number;
  readonly sp_gain_on_kill?: number;
  readonly active_skill_sp_cost?: SpCost | null;
  readonly normal_withdrawal_refund_ratio?: number;
  readonly redeploy_cd_base?: number;
  readonly facility_duration?: number;
  readonly attack_profile?: AttackProfile | null;
  readonly trigger_events?: readonly string[];
  readonly skill_effects?: readonly SkillEffectBlock[];
  readonly native_traits?: readonly NativeTrait[];
  readonly ability_name_zh?: string;
  readonly trigger_phrase_zh?: string;
  readonly keyword_tokens?: string;
  readonly counterplay_or_limit?: string;
  readonly effect_trigger: EffectTrigger;
  readonly effect_json: EffectDefinition;
}

export interface StatusEffect {
  readonly status_id?: string;
  readonly kind: StatusKind;
  readonly remaining_owner_turns: number;
  readonly applied_on_owner_turn_index: number;
  readonly expire_at_node?: ExpireAtNode;
  readonly stacks?: number;
  readonly bonus_damage?: number;
  readonly status_priority?: number;
  readonly applied_sequence?: number;
  readonly source_instance_id?: CardInstanceId;
  readonly blocks_normal_withdrawal: boolean;
}

export interface EquipmentPackageModifier {
  readonly stat: 'max_hp' | 'attack' | 'ordinary_attack_route_scope';
  readonly amount?: number;
  readonly minimum?: number;
  readonly value?: string;
  readonly replace?: boolean;
  readonly ordinary_attack_only?: boolean;
}

export interface EquipmentPackageTrigger {
  readonly trigger: string;
  readonly condition?: string;
  readonly effects: readonly SkillEffectOp[];
  readonly reset?: string;
}

export interface EquipmentPackageState {
  readonly card_id: CardId;
  readonly card_name_zh: string;
  readonly effect_id: string;
  readonly modifiers: readonly EquipmentPackageModifier[];
  readonly triggers: readonly EquipmentPackageTrigger[];
  readonly triggered_this_owner_turn?: boolean;
}

export interface FacilityRuntimeState {
  readonly remaining_turns: number;
  readonly disabled_until_owner_turn?: number | null;
  readonly pause_effects_when_disabled: boolean;
  readonly continue_countdown_when_disabled: boolean;
}

export interface SummonRuntimeState {
  readonly token_id: string;
  readonly source_instance_id: CardInstanceId;
  readonly atk: number;
  readonly max_hp: number;
  readonly attack_type: AttackType;
  readonly damage_type: DamageType;
  readonly taunt_scope: 'none' | 'same_lane' | 'all_lanes';
  readonly recallable_by_controller: boolean;
  readonly on_turn_end?: string;
}

export interface TemporaryAttackModifier {
  readonly kind: 'stat' | 'focus_fire' | 'attack_profile';
  readonly stat?: 'attack';
  readonly amount?: number;
  readonly modifier_id?: string;
  readonly route_scope?: RouteScope | string;
  readonly target_priority?: TargetPriority | string;
  readonly ignore_front_interception?: boolean;
  readonly pattern?: string;
  readonly target_limit?: number | 'all';
  readonly secondary_damage?: number;
  readonly expires: 'turn_end' | 'combat_end' | 'first_basic_attack' | 'first_basic_attack_this_combat';
  readonly owner_id: PlayerId;
}

export interface OperatorCombatState {
  current_hp: HpValue;
  max_hp_bonus?: number;
  current_atk_modifiers: readonly number[];
  permanent_atk_bonus?: number;
  current_sp: SpValue;
  shield: number;
  statuses: readonly StatusEffect[];
  equipment_ids: readonly CardInstanceId[];
  equipped_package?: EquipmentPackageState | null;
  temp_modifiers?: readonly TemporaryAttackModifier[];
  took_hp_damage_last_owner_turn?: boolean;
  took_hp_damage_this_owner_turn?: boolean;
  per_combat_trigger_counts?: Readonly<Record<string, number>>;
  per_turn_trigger_counts?: Readonly<Record<string, number>>;
  granted_immediate_attack_this_turn?: boolean;
  consumed_normal_attack_this_turn?: boolean;
}

export interface OperatorLifecycleState {
  redeploy_cd_remaining: number;
  redeploy_cd_applied_owner_turn_index: number | null;
  has_deployed_before: boolean;
  entered_battle_this_owner_turn: boolean;
  /** Rules file name: current_deployment_paid_cost. This is a paid cost snapshot, not printed cost. */
  paid_deploy_cost: PaidDeployCost | null;
  once_per_game_flags: Readonly<Record<string, boolean>>;
}

export interface SupportLifecycleState {
  readonly turn_start_triggers: number;
}

export interface CardInstance {
  readonly card_instance_id: CardInstanceId;
  readonly card_id: CardId;
  readonly owner_id: PlayerId;
  controller_id: PlayerId;
  readonly entity_kind?: EntityKind;
  board_half: PlayerId | null;
  lane: LaneId | null;
  position: Position | null;
  slot_index: number | null;
  zone: 'deck' | 'hand' | 'board' | 'discard' | 'support';
  operator_combat?: OperatorCombatState;
  operator_lifecycle?: OperatorLifecycleState;
  support_lifecycle?: SupportLifecycleState;
  facility_state?: FacilityRuntimeState;
  summon_state?: SummonRuntimeState;
}

export interface OperatorState {
  readonly instance: CardInstance;
  readonly combat: OperatorCombatState;
  readonly lifecycle: OperatorLifecycleState;
}

export interface DeployDiscount {
  readonly amount: number;
  readonly expires_player: PlayerId;
  readonly source: string;
}

export interface PlayerState {
  readonly player_id: PlayerId;
  base_points: BasePoints;
  cost: Cost;
  readonly turn_cp_cap: number;
  readonly hand: readonly CardInstanceId[];
  readonly deck: readonly CardInstanceId[];
  readonly discard: readonly CardInstanceId[];
  readonly facility_ids: readonly CardInstanceId[];
  fatigue_count: number;
  turns_taken: number;
  own_turn_index: number;
  focus_target_id: CardInstanceId | null;
  focus_target_changes_this_turn: number;
  next_deploy_discounts: readonly DeployDiscount[];
  facility_first_deploy_discount_used_turn: number | null;
}

export type GameAction =
  | { readonly type: 'end_action_phase' }
  | { readonly type: 'surrender' }
  | {
      readonly type: 'play_card';
      readonly card_instance_id: CardInstanceId;
      readonly target_instance_id?: CardInstanceId;
      readonly secondary_target_instance_id?: CardInstanceId;
      readonly target_lane?: LaneId;
      readonly target_lanes?: readonly LaneId[];
      readonly target_position?: Position;
      readonly target_slot_index?: number;
    }
  | {
      readonly type: 'deploy_operator';
      readonly card_instance_id: CardInstanceId;
      readonly lane: LaneId;
      readonly position: Position;
      readonly slot_index?: number;
    }
  | { readonly type: 'withdraw_operator'; readonly card_instance_id: CardInstanceId }
  | { readonly type: 'recall_summon'; readonly card_instance_id: CardInstanceId }
  | { readonly type: 'set_focus_target'; readonly target_instance_id: CardInstanceId | null }
  | { readonly type: 'activate_skill'; readonly card_instance_id: CardInstanceId; readonly target_instance_id?: CardInstanceId }
  | {
      readonly type: 'resolve_pending_choice';
      readonly source_instance_id: CardInstanceId;
      readonly target_instance_id?: CardInstanceId;
      readonly choice_id?: string;
    };

export interface PendingEffectChoice {
  readonly source_instance_id: CardInstanceId;
  readonly effect: 'gain_sp' | 'choose_summon' | 'choose_discard' | 'grant_front_cover' | 'grant_front_shield';
  readonly amount: number;
  readonly options?: readonly string[];
}

export interface OpenDecisionConfig {
  /** OQ-02: Shield cap. null means uncapped (no hardcoded 10 cap). */
  readonly shieldCap: number | null;
  /** OQ-03: Max focus target changes per action phase (null = unlimited). */
  readonly maxFocusChangesPerTurn: number | null;
  /** OQ-04: Whether disabled facilities continue countdown. */
  readonly disabledFacilityContinuesCountdown: boolean;
  /** OQ-06: CP cost to manually recall own summon (default 0). */
  readonly manualRecallCpCost: number;
  /** OQ-09: Optional AOE target limit override (null = no artificial cap). */
  readonly aoeTargetLimit: number | null;
}

export interface GameState {
  readonly rules_version: '1.1';
  readonly board_profile: BoardProfile;
  readonly cp_curve: readonly number[];
  readonly open_decision_config: OpenDecisionConfig;
  readonly card_definitions: Readonly<Record<CardId, CardDefinition>>;
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly card_instances: Readonly<Record<CardInstanceId, CardInstance>>;
  readonly mulligan_completed: Readonly<Record<PlayerId, boolean>>;
  random_state: number;
  active_player_id: PlayerId;
  phase: GamePhase;
  turn_number: number;
  state_version: number;
  status_sequence: number;
  next_entity_seq: number;
  winner: PlayerId | 'draw' | null;
  readonly combat_log: readonly CombatLogEvent[];
  readonly pending_effect_choices: readonly PendingEffectChoice[];
  readonly turn_start_prepared: boolean;
}

export type CombatLogEventType =
  | 'attack_declared' | 'target_selected' | 'reaction_triggered' | 'sp_spent'
  | 'damage_resolved' | 'shield_absorbed' | 'base_damaged' | 'unit_defeated'
  | 'entity_destroyed' | 'sp_gained' | 'status_expired' | 'status_removed' | 'healed' | 'trigger_limit'
  | 'skill_activated' | 'effect_triggered' | 'unit_deployed' | 'unit_withdrawn' | 'status_applied'
  | 'unit_moved' | 'equipment_installed' | 'facility_deployed' | 'facility_disabled'
  | 'summon_created' | 'summon_recalled' | 'focus_target_set' | 'cp_updated';

export interface CombatLogEvent {
  readonly sequence: number;
  readonly type: CombatLogEventType;
  readonly source_instance_id?: CardInstanceId;
  readonly target_instance_id?: CardInstanceId;
  readonly player_id?: PlayerId;
  readonly source_player_id?: PlayerId;
  readonly target_player_id?: PlayerId;
  readonly source_name?: string;
  readonly target_name?: string;
  readonly skill_name?: string;
  readonly action_type?: string;
  readonly cause?: string;
  readonly lane?: LaneId;
  readonly position?: Position;
  readonly slot_index?: number;
  readonly amount?: number;
  readonly absorbed?: number;
  readonly detail: string;
}

export interface DeckDefinition {
  readonly deck_id: string;
  readonly deck_name_zh: string;
  readonly cards: readonly { readonly card_id: CardId; readonly quantity: number }[];
}
