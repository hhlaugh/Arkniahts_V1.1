import React from 'react';
import { formatCellLabel, formatLaneLabelZh } from '../../game/board';
import { getEffectiveAttackProfile, getEntityKind, getEntityStats, isFacilityDisabled } from '../../game/range';
import type {
  CardInstance,
  CardInstanceId,
  GameAction,
  GameState,
} from '../../game/types';
import { cardDefinitionOf } from '../cards/CardView';
import { getCardPresentation, getSummonPresentation } from '../../data/card-presentation';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ScenicBannerLayer } from '../ui/ScenicBackdrop';
import { CardFrame } from '../cards/CardFrame';
import { HealthBar } from '../ui/HealthBar';
import { ResourceIndicator } from '../ui/ResourceIndicator';
import { STATUS_LABEL, PLAYER_LABEL } from '../../client/gameData';
import { getInvalidCardReason, getInvalidUnitActionReason } from './tacticalSelectors';
import { KeywordGlossary } from '../cards/KeywordGlossary';

interface TacticalDetailPanelProps {
  readonly state: GameState;
  readonly selection: CardInstanceId | null;
  readonly onDeselect: () => void;
  readonly canAct: boolean;
  readonly isActionPhase: boolean;
  readonly hasPending: boolean;
  readonly legalActions: readonly GameAction[];
  readonly onDispatch: (action: GameAction) => void;
  readonly embedded?: boolean;
  readonly className?: string;
}

type SkillAction = Extract<GameAction, { type: 'activate_skill' }>;
type PlayCardAction = Extract<GameAction, { type: 'play_card' }>;
type WithdrawAction = Extract<GameAction, { type: 'withdraw_operator' }>;
type RecallAction = Extract<GameAction, { type: 'recall_summon' }>;

export function TacticalDetailPanel({
  state,
  selection,
  onDeselect,
  canAct,
  isActionPhase,
  hasPending,
  legalActions,
  onDispatch,
  embedded = false,
  className = '',
}: TacticalDetailPanelProps) {
  const selectedInstance: CardInstance | undefined = selection ? state.card_instances[selection] : undefined;
  const selectedDefinition = selection ? cardDefinitionOf(state, selection) : undefined;

  const actor = state.active_player_id;
  const isOwnUnit = selectedInstance?.controller_id === actor;
  const isBoardUnit = selectedInstance?.zone === 'board';
  const isHandCard = selectedInstance?.zone === 'hand';
  const entityKind = selectedInstance ? getEntityKind(state, selectedInstance) : 'operator';
  const basePresentation = selectedInstance ? getCardPresentation(selectedInstance.card_id) : undefined;
  const selectedPresentation =
    selectedInstance && basePresentation && entityKind === 'summon'
      ? getSummonPresentation(selectedInstance.summon_state?.token_id, basePresentation)
      : basePresentation;
  const entityStats = selectedInstance ? getEntityStats(state, selectedInstance) : null;
  const effectiveProfile = selectedInstance ? getEffectiveAttackProfile(state, selectedInstance) : null;
  const facilityDisabled = selectedInstance ? isFacilityDisabled(state, selectedInstance) : false;

  const canWithdraw =
    isBoardUnit &&
    entityKind === 'operator' &&
    legalActions.some(
      (action): action is WithdrawAction => action.type === 'withdraw_operator' && action.card_instance_id === selection,
    );

  const recallAction =
    isBoardUnit && entityKind === 'summon'
      ? legalActions.find((action): action is RecallAction => action.type === 'recall_summon' && action.card_instance_id === selection)
      : undefined;

  const isFocused = Boolean(isBoardUnit && !isOwnUnit && state.players[actor]?.focus_target_id === selection);
  const canSetFocus =
    isBoardUnit &&
    !isOwnUnit &&
    canAct &&
    isActionPhase &&
    !hasPending &&
    legalActions.some((a) => a.type === 'set_focus_target' && a.target_instance_id === selection);
  const canClearFocus =
    isFocused &&
    canAct &&
    isActionPhase &&
    !hasPending &&
    legalActions.some((a) => a.type === 'set_focus_target' && a.target_instance_id === null);

  const skillActions = isBoardUnit
    ? legalActions.filter(
        (action): action is SkillAction => action.type === 'activate_skill' && action.card_instance_id === selection,
      )
    : [];
  const canSkillDirect = skillActions.some((action) => action.target_instance_id === undefined);
  const hasSkillTargets = skillActions.some((action) => action.target_instance_id !== undefined);

  const playCardActions = isHandCard
    ? legalActions.filter(
        (action): action is PlayCardAction => action.type === 'play_card' && action.card_instance_id === selection,
      )
    : [];
  const directPlayAction = playCardActions.find(
    (action) =>
      action.target_instance_id === undefined &&
      action.target_lane === undefined &&
      action.target_lanes === undefined &&
      action.target_position === undefined,
  );
  const hasUnitTargets = playCardActions.some((action) => action.target_instance_id !== undefined);
  const hasCellTargets = playCardActions.some((action) => action.target_position !== undefined);
  const laneOnlyActions = playCardActions.filter(
    (action) => action.target_lane !== undefined && action.target_position === undefined && action.target_instance_id === undefined,
  );
  const lanePairActions = playCardActions.filter((action) => Array.isArray(action.target_lanes) && action.target_lanes.length > 0);

  const canDeploy =
    isHandCard &&
    legalActions.some(
      (action) => action.type === 'deploy_operator' && action.card_instance_id === selection,
    );

  const handInvalidReason =
    isHandCard && selection && selectedInstance.owner_id === actor && isActionPhase && !hasPending && canAct
      ? getInvalidCardReason(state, actor, selection)
      : null;

  const withdrawInvalidReason =
    isBoardUnit && entityKind === 'operator' && isOwnUnit && selection && isActionPhase && !hasPending && canAct && !canWithdraw
      ? getInvalidUnitActionReason(state, actor, selection, 'withdraw_operator')
      : null;

  const skillInvalidReason =
    isBoardUnit &&
    isOwnUnit &&
    selection &&
    selectedDefinition?.effect_trigger === 'active' &&
    isActionPhase &&
    !hasPending &&
    canAct &&
    !canSkillDirect &&
    !hasSkillTargets
      ? getInvalidUnitActionReason(state, actor, selection, 'activate_skill')
      : null;

  const bodyContent =
    selectedInstance && selectedDefinition && selectedPresentation ? (
      <div className="flex flex-col h-full overflow-hidden">
        {!embedded && (
          <div className="relative flex items-center justify-between px-3.5 py-2 bg-[#13171e] border-b border-[#283240] shrink-0 overflow-hidden">
            <ScenicBannerLayer scene="rhodes-command" fade="right" opacityClassName="opacity-28" />
            <div className="relative z-10 flex items-center gap-1.5 min-w-0">
              <Badge variant={isBoardUnit ? 'status' : 'cost'} value={isBoardUnit ? (entityKind === 'facility' ? '设施' : entityKind === 'summon' ? '召唤物' : '在场单位') : `${selectedDefinition.cost} CP`}>
                {isBoardUnit ? (entityKind === 'facility' ? '设施' : entityKind === 'summon' ? '召唤' : '在场') : '手牌'}
              </Badge>
              <span className="text-xs font-bold text-white truncate max-w-[140px]">
                {entityKind === 'summon' ? selectedPresentation.codeNameZh : selectedDefinition.card_name_zh}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={onDeselect} className="relative z-10 text-slate-400 hover:text-white px-2 py-0.5 text-xs">
              ✕ 取消
            </Button>
          </div>
        )}

        {embedded && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#11161e] border-b border-[#263140] shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <Badge variant={isBoardUnit ? 'status' : 'cost'} value={isBoardUnit ? (entityKind === 'facility' ? '设施' : entityKind === 'summon' ? '召唤物' : '在场单位') : `${selectedDefinition.cost} CP`}>
                {isBoardUnit ? (entityKind === 'facility' ? '设施' : entityKind === 'summon' ? '召唤' : '在场') : '手牌'}
              </Badge>
              <span className="text-xs font-bold text-white truncate">
                {entityKind === 'summon' ? selectedPresentation.codeNameZh : selectedDefinition.card_name_zh}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={onDeselect} className="text-slate-400 hover:text-white px-2 py-0.5 text-xs">
              取消选中
            </Button>
          </div>
        )}

        <div className="p-2.5 sm:p-3.5 flex-1 overflow-y-auto space-y-2.5 sm:space-y-3.5 text-xs">
            <div className="flex justify-center">
              <CardFrame
                cardId={selectedInstance.card_id}
                definition={selectedDefinition}
                presentation={selectedPresentation}
                variant="preview"
                interactive={false}
                redeployCd={selectedInstance.operator_lifecycle?.redeploy_cd_remaining ?? 0}
                className="w-[172px] min-h-[222px] sm:w-[214px] sm:min-h-[268px] shadow-md"
              />
            </div>

            {selectedDefinition.card_type === 'operator' && (
              <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] font-mono text-slate-300">
                <span>
                  {effectiveProfile?.mode === 'ranged'
                    ? '远程输出'
                    : effectiveProfile?.mode === 'support'
                      ? '医疗支援'
                      : '近战输出'}
                </span>
                <span className="text-slate-600">·</span>
                <span>
                  {selectedDefinition.deploy_rule === 'front_only'
                    ? '仅部署前排'
                    : selectedDefinition.deploy_rule === 'back_only'
                      ? '仅部署后排'
                      : '前后排皆可'}
                </span>
                {isBoardUnit && selectedInstance.lane && selectedInstance.position && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="text-amber-300">
                      {formatCellLabel(state.board_profile, selectedInstance.lane, selectedInstance.position, selectedInstance.slot_index)}
                    </span>
                  </>
                )}
              </div>
            )}

            {isBoardUnit && selectedInstance.operator_combat && entityStats && (
              <div className="bg-[#0f131a] p-3 border border-[#2b3644] space-y-2">
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                  实时作战参数 (LIVE STATUS)
                </span>

                <HealthBar
                  currentHp={selectedInstance.operator_combat.current_hp}
                  maxHp={entityStats.maxHp}
                  shield={selectedInstance.operator_combat.shield}
                  size="md"
                  showNumbers
                />

                {entityKind === 'facility' ? (
                  <div className="space-y-1 pt-1 text-[11px] font-mono">
                    <div className="flex items-center justify-between text-amber-300">
                      <span>状态：{facilityDisabled ? '⏸ 已瘫痪（效果暂停）' : '⚙ 正常运行中'}</span>
                      <span>每回合自身 -1 HP</span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      特性：不受治疗/增益/减益 · 不可移动或被位移
                    </div>
                  </div>
                ) : (
                  <div className="pt-1">
                    <ResourceIndicator type="atk" current={entityStats.atk} size="sm" />
                  </div>
                )}

                {selectedInstance.operator_combat.equipped_package && (
                  <div className="px-2 py-1.5 bg-emerald-950/50 border border-emerald-500/40 text-emerald-200 text-[11px] flex items-center justify-between">
                    <span>🔧 已安装装备</span>
                    <strong>{selectedInstance.operator_combat.equipped_package.card_name_zh}</strong>
                  </div>
                )}

                {selectedInstance.operator_combat.statuses.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1 border-t border-[#232c38]">
                    {selectedInstance.operator_combat.statuses.map((s) => (
                      <Badge key={`${s.kind}-${s.status_id ?? s.applied_sequence ?? ''}`} variant="status" className="bg-rose-950/80 text-rose-300 border-rose-600">
                        {STATUS_LABEL[s.kind] ?? s.kind} ({s.remaining_owner_turns}回合)
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <KeywordGlossary definition={selectedDefinition} instance={selectedInstance} />
            </div>

            <div className="pt-2 border-t border-[#283442] space-y-2">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                指令下发 (TACTICAL COMMANDS)
              </span>

              {isHandCard && selectedDefinition.card_type === 'operator' && (
                <div
                  className={`p-2.5 border text-[11px] leading-relaxed ${
                    canDeploy
                      ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                      : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                  }`}
                >
                  {canDeploy ? (
                    <span>💡 点击或拖放至棋盘<strong>高亮阵位</strong>以部署该干员（基础费用 {selectedDefinition.cost} CP）。</span>
                  ) : (
                    <span>⚠️ {handInvalidReason ?? '当前回合不可部署此干员。'}</span>
                  )}
                </div>
              )}

              {isHandCard && selectedDefinition.card_type !== 'operator' && playCardActions.length === 0 && handInvalidReason && (
                <div className="p-2.5 bg-rose-950/40 border border-rose-500/40 text-rose-200 text-[11px] leading-relaxed">
                  ⚠️ {handInvalidReason}
                </div>
              )}

              {isHandCard && directPlayAction && canAct && isActionPhase && !hasPending && (
                <Button
                  variant="primary"
                  size="md"
                  cornerCut
                  onClick={() => onDispatch(directPlayAction)}
                  className="w-full font-bold shadow-md"
                >
                  ⚡ 直接使用此战术卡 (-{selectedDefinition.cost} CP)
                </Button>
              )}

              {isHandCard && canAct && isActionPhase && !hasPending && laneOnlyActions.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[11px] text-cyan-300 block">🎯 选择作用路线：</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {laneOnlyActions.map((act) => (
                      <Button
                        key={act.target_lane}
                        variant="secondary"
                        size="sm"
                        onClick={() => onDispatch(act)}
                        className="text-[11px]"
                      >
                        {formatLaneLabelZh(state.board_profile, act.target_lane ?? null)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {isHandCard && canAct && isActionPhase && !hasPending && lanePairActions.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[11px] text-cyan-300 block">🎯 选择相邻路线组：</span>
                  <div className="space-y-1">
                    {lanePairActions.map((act, idx) => (
                      <Button
                        key={`${idx}-${act.target_lanes?.join('-')}`}
                        variant="secondary"
                        size="sm"
                        onClick={() => onDispatch(act)}
                        className="w-full text-[11px]"
                      >
                        {(act.target_lanes ?? []).map((l) => formatLaneLabelZh(state.board_profile, l)).join(' + ')}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {isHandCard && hasCellTargets && (
                <div className="text-[11px] text-amber-300 bg-amber-950/40 p-2 border border-amber-500/30">
                  🏗️ 请在棋盘上点击黄色脉冲空位部署此场地设施。
                </div>
              )}

              {isHandCard && hasUnitTargets && (
                <div className="text-[11px] text-amber-300 bg-amber-950/40 p-2 border border-amber-500/30">
                  🎯 请在棋盘上点击青色脉冲高亮单位以发动（若需两步，请按顶部提示依次选择）。
                </div>
              )}

              {isBoardUnit && !isOwnUnit && canAct && isActionPhase && !hasPending && (
                <div className="space-y-1.5">
                  {canSetFocus && (
                    <Button
                      variant="primary"
                      size="sm"
                      cornerCut
                      onClick={() => onDispatch({ type: 'set_focus_target', target_instance_id: selection! })}
                      className="w-full font-bold"
                    >
                      🎯 设为本回合集火目标
                    </Button>
                  )}
                  {canClearFocus && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onDispatch({ type: 'set_focus_target', target_instance_id: null })}
                      className="w-full"
                    >
                      取消集火锁定
                    </Button>
                  )}
                </div>
              )}

              {isBoardUnit && isOwnUnit && canAct && isActionPhase && !hasPending && (
                <div className="space-y-1.5">

                  {entityKind === 'operator' && (
                    <>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={!canWithdraw}
                        onClick={() => {
                          const action = legalActions.find(
                            (a): a is WithdrawAction => a.type === 'withdraw_operator' && a.card_instance_id === selection,
                          );
                          if (action) onDispatch(action);
                        }}
                        className="w-full mt-2"
                      >
                        普通撤离（0 费返还，进入再部署冷却）
                      </Button>
                      {withdrawInvalidReason && (
                        <span className="text-[10px] text-rose-300 block text-center">
                          无法撤离：{withdrawInvalidReason}
                        </span>
                      )}
                    </>
                  )}

                  {entityKind === 'summon' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!recallAction}
                      onClick={() => recallAction && onDispatch(recallAction)}
                      className="w-full mt-2"
                    >
                      ↩ 召回召唤物（腾出格位）
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex flex-col items-center justify-center p-6 h-full text-center space-y-4 overflow-hidden">
          <ScenicBannerLayer scene="rhodes-command" fade="diagonal-tr" opacityClassName="opacity-22" />
          <div className="relative z-10 w-16 h-16 rounded-full border border-slate-700/60 bg-[#12161c] flex items-center justify-center text-slate-500 text-2xl shadow-inner">
            🔍
          </div>
          <div className="relative z-10 space-y-1">
            <h3 className="font-bold text-sm text-slate-200 uppercase tracking-wider m-0">
              战术监视器在线
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed max-w-[220px]">
              点击棋盘上的任意干员、设施、召唤物或己方手牌，查看完整数值、装备状态与可下发指令。
            </p>
          </div>

          <div className="relative z-10 w-full bg-[#10141a]/90 p-3 border border-[#263140] text-left space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between text-slate-400">
              <span>当前阶段:</span>
              <span className="text-[#e5a52b] font-bold">
                {state.phase === 'action' ? `行动阶段 (${PLAYER_LABEL[actor]})` : state.phase}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>推演回合:</span>
              <span className="text-white font-bold">第 {state.turn_number} 回合</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>战区规模:</span>
              <span className="text-cyan-300 font-bold">
                {state.board_profile.laneCount} 路 · {state.board_profile.mode === 'classic' ? '经典三路 (21/32/21)' : '自定义'}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>在场实体:</span>
              <span className="text-emerald-400 font-bold">
                {Object.values(state.card_instances).filter((i) => i.zone === 'board').length} 个
              </span>
            </div>
          </div>
        </div>
      );

  if (embedded) {
    return (
      <div className={`flex flex-col bg-[#161a22] overflow-hidden ${className}`}>
        {bodyContent}
      </div>
    );
  }

  return (
    <Panel
      variant="raised"
      title="战术参数与指令"
      codeName={selectedInstance ? selectedInstance.card_instance_id : 'IDLE'}
      headerScene="rhodes-bridge"
      scanlines
      grid
      className={`flex flex-col h-full bg-[#161a22] border-[#2f3b4a] shadow-xl overflow-hidden ${className}`}
    >
      {bodyContent}
    </Panel>
  );
}
