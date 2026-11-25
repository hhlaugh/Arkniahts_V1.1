import { useEffect, useMemo, useRef, useState } from 'react';
import type { CombatLogEvent, GameState, PlayerId } from '../../game/types';
import { formatCellLabel } from '../../game/board';
import { CARD_BY_ID } from '../../client/gameData';

interface LogViewProps {
  readonly history: readonly CombatLogEvent[];
  readonly state?: GameState;
  readonly viewerPlayer?: PlayerId | null;
}

type FilterCategory = 'all' | 'player_a' | 'player_b' | 'ally' | 'enemy' | 'combat' | 'skills' | 'moves';

const MAX_RENDERED_EVENTS = 300;

const KNOWN_CARD_NAMES = new Set<string>(
  Array.from(CARD_BY_ID.values()).map((card) => card.card_name_zh),
);

const STATUS_NAMES = new Set<string>([
  '眩晕',
  '冻结',
  '落地',
  '减速',
  '压制',
  '寒冷',
  '脆弱',
  '掩护',
  '中毒',
  '沉默',
  '嘲讽',
  '集火',
  '不屈',
  '隐匿',
  '浮空',
  '连击',
  '免疫',
  '剧毒',
]);

const SKILL_KEYWORDS = [
  '受击减伤反应',
  '战场急救',
  '防御整备',
  '狙击支援',
  '自然震慑',
  '战术控场',
  '战术调度',
  '主动技能',
  '击杀回复',
];

const PLAYER_VIEW_DROPPED_TYPES = new Set<string>([
  'attack_declared',
  'target_selected',
  'sp_gained',
  'sp_spent',
  'status_expired',
  'status_removed',
  'trigger_limit',
  'shield_absorbed',
]);

function extractCellToken(event: CombatLogEvent, state?: GameState): string | null {
  if (event.lane && event.position && event.slot_index && state?.board_profile) {
    return `[${formatCellLabel(state.board_profile, event.lane, event.position, event.slot_index)}]`;
  }
  const match = event.detail.match(/\[[^\]]+·[^\]]+\]/);
  return match ? match[0] : null;
}

function stripFactionText(raw: string): string {
  return raw
    .replace(/(?:玩家 A|玩家 B|player_a|player_b)\s*的\s*/g, '')
    .replace(/玩家 A|玩家 B|player_a|player_b/g, '')
    .replace(/敌方设施(?=【)/g, '设施')
    .replace(/^\s+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function LogView({ history, state, viewerPlayer = null }: LogViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [filter, setFilter] = useState<FilterCategory>('all');
  const [autoScroll, setAutoScroll] = useState(true);

  const isPlayerView = viewerPlayer !== null;
  const allySide: PlayerId | null = viewerPlayer;
  const enemySide: PlayerId | null =
    viewerPlayer === 'player_a' ? 'player_b' : viewerPlayer === 'player_b' ? 'player_a' : null;

  const instanceMap = useMemo(() => {
    const map = new Map<string, { owner: PlayerId; name: string }>();
    if (state?.card_instances) {
      for (const [id, inst] of Object.entries(state.card_instances)) {
        const def = state.card_definitions?.[inst.card_id] ?? CARD_BY_ID.get(inst.card_id);
        const name = def?.card_name_zh ?? inst.card_id;
        map.set(id, { owner: inst.owner_id, name });
      }
    }
    return map;
  }, [state]);

  const getEventSides = (event: CombatLogEvent): { primarySide: PlayerId | null; targetSide: PlayerId | null } => {
    let primarySide: PlayerId | null = event.source_player_id ?? null;
    let targetSide: PlayerId | null = event.target_player_id ?? null;

    if (!primarySide && event.source_instance_id) {
      const info = instanceMap.get(event.source_instance_id);
      if (info) primarySide = info.owner;
    }
    if (!targetSide && event.target_instance_id) {
      const info = instanceMap.get(event.target_instance_id);
      if (info) targetSide = info.owner;
    }
    if (event.player_id) {
      if (!primarySide) primarySide = event.player_id;
      else if (!targetSide && event.player_id !== primarySide) targetSide = event.player_id;
    }

    if (!primarySide) {
      if (event.detail.includes('玩家 A') || event.detail.includes('player_a')) primarySide = 'player_a';
      else if (event.detail.includes('玩家 B') || event.detail.includes('player_b')) primarySide = 'player_b';
    }
    if (!targetSide) {
      if (
        primarySide === 'player_a' &&
        (event.detail.includes('对 玩家 B') ||
          event.detail.includes('攻击 玩家 B') ||
          event.detail.includes('击杀了 玩家 B') ||
          event.detail.includes('直击 玩家 B') ||
          event.detail.includes('目标为 玩家 B'))
      ) {
        targetSide = 'player_b';
      } else if (
        primarySide === 'player_b' &&
        (event.detail.includes('对 玩家 A') ||
          event.detail.includes('攻击 玩家 A') ||
          event.detail.includes('击杀了 玩家 A') ||
          event.detail.includes('直击 玩家 A') ||
          event.detail.includes('目标为 玩家 A'))
      ) {
        targetSide = 'player_a';
      }
    }

    return { primarySide, targetSide };
  };

  const sanitizedHistory = useMemo(() => {
    return history.filter((event) => {
      if (isPlayerView) {
        if (PLAYER_VIEW_DROPPED_TYPES.has(event.type)) {
          return false;
        }
        if (
          event.type === 'cp_updated' &&
          (event.action_type === 'turn_start_reset' || event.action_type === 'turn_end_clear')
        ) {
          return false;
        }
        return true;
      }
      // 热座测试模式保持原有过滤行为
      if (
        event.type === 'sp_gained' &&
        (event.detail.includes('自然回复') ||
          event.detail.includes('回合开始固定') ||
          event.detail.includes('回合固定') ||
          event.detail.includes('回合开始自然回复'))
      ) {
        return false;
      }
      return true;
    });
  }, [history, isPlayerView]);

  const filteredEvents = useMemo(() => {
    return sanitizedHistory.filter((event) => {
      const { primarySide, targetSide } = getEventSides(event);

      if (filter === 'ally' && allySide) {
        return primarySide === allySide || targetSide === allySide;
      }
      if (filter === 'enemy' && enemySide) {
        return primarySide === enemySide || targetSide === enemySide;
      }
      if (filter === 'player_a') {
        return (
          primarySide === 'player_a' ||
          targetSide === 'player_a' ||
          event.detail.includes('玩家 A') ||
          event.detail.includes('player_a')
        );
      }
      if (filter === 'player_b') {
        return (
          primarySide === 'player_b' ||
          targetSide === 'player_b' ||
          event.detail.includes('玩家 B') ||
          event.detail.includes('player_b')
        );
      }
      if (filter === 'combat') {
        return (
          isPlayerView
            ? ['damage_resolved', 'base_damaged', 'unit_defeated', 'entity_destroyed']
            : [
                'attack_declared',
                'target_selected',
                'damage_resolved',
                'base_damaged',
                'shield_absorbed',
                'unit_defeated',
                'entity_destroyed',
              ]
        ).includes(event.type);
      }
      if (filter === 'skills') {
        return [
          'skill_activated',
          'reaction_triggered',
          'effect_triggered',
          'healed',
          'status_applied',
          'status_expired',
          'status_removed',
          'sp_spent',
          'sp_gained',
          'equipment_installed',
          'facility_disabled',
          'focus_target_set',
          'cp_updated',
        ].includes(event.type);
      }
      if (filter === 'moves') {
        return [
          'unit_deployed',
          'unit_withdrawn',
          'unit_moved',
          'facility_deployed',
          'summon_created',
          'summon_recalled',
        ].includes(event.type);
      }
      return true;
    });
  }, [sanitizedHistory, filter, instanceMap, allySide, enemySide, isPlayerView]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredEvents.length, autoScroll]);

  const visibleEvents =
    filteredEvents.length > MAX_RENDERED_EVENTS
      ? filteredEvents.slice(filteredEvents.length - MAX_RENDERED_EVENTS)
      : filteredEvents;

  const entityChipClass = (side: PlayerId | null): string => {
    if (!side) {
      return 'bg-slate-800 text-slate-200 border border-slate-600';
    }
    const isBlue = isPlayerView ? side === allySide : side === 'player_a';
    return isBlue
      ? 'bg-sky-950/80 text-sky-200 border border-sky-400/50 shadow-sm'
      : 'bg-rose-950/80 text-rose-200 border border-rose-400/50 shadow-sm';
  };

  const baseLabelClass = (side: PlayerId | null): string => {
    if (!side) return 'text-amber-300 font-bold';
    const isBlue = isPlayerView ? side === allySide : side === 'player_a';
    return isBlue
      ? 'font-bold px-1 py-0.5 rounded-[2px] bg-sky-950/75 text-sky-300 border border-sky-400/45 mx-0.5'
      : 'font-bold px-1 py-0.5 rounded-[2px] bg-rose-950/75 text-rose-300 border border-rose-400/45 mx-0.5';
  };

  const renderEntityChip = (name: string, side: PlayerId | null, key?: string | number) => (
    <span key={key} className={`font-bold px-1.5 py-0.5 rounded-[2px] text-[11px] mx-0.5 ${entityChipClass(side)}`}>
      【{name}】
    </span>
  );

  const renderCellBadge = (cell: string, key?: string | number) => (
    <span
      key={key}
      className="font-mono text-[10px] font-medium px-1 py-0.5 rounded-[2px] bg-[#1c2230] text-amber-200/90 border border-slate-600/40 mx-0.5"
    >
      {cell}
    </span>
  );

  const getEventBadge = (event: CombatLogEvent) => {
    switch (event.type) {
      case 'damage_resolved':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-rose-950/70 text-rose-300 border border-rose-600/40 shrink-0">
            {event.action_type === 'attack' ? '⚔️ 攻击' : '💥 伤害'}
          </span>
        );
      case 'unit_defeated':
      case 'entity_destroyed':
        return (
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-[2px] bg-red-950/90 text-red-200 border border-red-500/60 shadow-sm shrink-0">
            💀 击毁
          </span>
        );
      case 'base_damaged':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-red-950/80 text-amber-300 border border-amber-600/50 shrink-0">
            🏰 基地
          </span>
        );
      case 'skill_activated':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-cyan-950/70 text-cyan-300 border border-cyan-500/40 shrink-0">
            ⚡ 技能
          </span>
        );
      case 'reaction_triggered':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-purple-950/70 text-purple-300 border border-purple-500/40 shrink-0">
            🛡️ 反应
          </span>
        );
      case 'effect_triggered':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-amber-950/60 text-amber-300 border border-amber-500/40 shrink-0">
            ✨ 效果
          </span>
        );
      case 'unit_withdrawn':
      case 'summon_recalled':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 shrink-0">
            🏃 撤离/召回
          </span>
        );
      case 'unit_deployed':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-blue-950/70 text-blue-300 border border-blue-500/40 shrink-0">
            📍 部署
          </span>
        );
      case 'facility_deployed':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-amber-950/70 text-amber-300 border border-amber-500/40 shrink-0">
            🏗️ 设施
          </span>
        );
      case 'facility_disabled':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-slate-900 text-rose-300 border border-rose-500/40 shrink-0">
            ⏸ 瘫痪
          </span>
        );
      case 'summon_created':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 shrink-0">
            🐾 召唤
          </span>
        );
      case 'equipment_installed':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-teal-950/70 text-teal-300 border border-teal-500/40 shrink-0">
            🔧 装备
          </span>
        );
      case 'unit_moved':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-indigo-950/70 text-indigo-300 border border-indigo-500/40 shrink-0">
            ⇄ 位移
          </span>
        );
      case 'focus_target_set':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-amber-950/70 text-amber-300 border border-amber-500/40 shrink-0">
            🎯 集火
          </span>
        );
      case 'cp_updated':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-cyan-950/70 text-cyan-300 border border-cyan-500/40 shrink-0">
            ⚡ CP
          </span>
        );
      case 'healed':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 shrink-0">
            💚 治疗
          </span>
        );
      case 'shield_absorbed':
        return (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] bg-amber-950/60 text-amber-300 border border-amber-500/40 shrink-0">
            🛡️ 护盾
          </span>
        );
      case 'attack_declared':
        return (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-[2px] bg-slate-800/80 text-slate-300 border border-slate-600/40 shrink-0">
            ⚔️ 攻击
          </span>
        );
      case 'target_selected':
        return (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-[2px] bg-slate-800/80 text-slate-400 border border-slate-700/40 shrink-0">
            🎯 锁定
          </span>
        );
      default:
        return (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-[2px] bg-slate-800/80 text-slate-400 border border-slate-700/40 shrink-0">
            战报
          </span>
        );
    }
  };

  // 玩家视角精简战报格式化（仅用蓝/红代表敌我，不输出文字阵营标签）
  const renderPlayerPerspectiveDetail = (event: CombatLogEvent) => {
    const { primarySide, targetSide } = getEventSides(event);
    const cell = extractCellToken(event, state);

    if ((event.type === 'unit_deployed' || event.type === 'facility_deployed') && event.source_name) {
      const costText = event.amount !== undefined ? `（消耗 ${event.amount} CP）` : '';
      return (
        <span className="log-text leading-relaxed">
          {renderEntityChip(event.source_name, primarySide)}
          <span>{event.type === 'facility_deployed' ? '部署于' : '部署于'}</span>
          {cell ? renderCellBadge(cell) : null}
          {costText && <span className="text-slate-400">{costText}</span>}
        </span>
      );
    }

    if (event.type === 'summon_created') {
      const summonMatch = event.detail.match(/召唤了【([^】]+)】/);
      const summonName = event.target_name ?? summonMatch?.[1] ?? event.source_name;
      if (summonName) {
        return (
          <span className="log-text leading-relaxed">
            <span>召唤</span>
            {renderEntityChip(summonName, targetSide ?? primarySide)}
            {cell ? (
              <>
                <span>于</span>
                {renderCellBadge(cell)}
              </>
            ) : null}
          </span>
        );
      }
    }

    if (event.type === 'damage_resolved' && event.amount !== undefined) {
      const srcName = event.source_name ?? '效果';
      const tgtName = event.target_name;
      const absorbed = event.absorbed ?? 0;

      if (event.action_type === 'facility_self_hp_loss') {
        const remainMatch = event.detail.match(/剩余\s*(\d+)\s*HP/);
        return (
          <span className="log-text leading-relaxed">
            {renderEntityChip(tgtName ?? srcName, targetSide ?? primarySide)}
            <span>回合损耗</span>
            <span className="font-bold text-amber-300 bg-amber-950/50 px-1.5 py-0.5 rounded-[2px] border border-amber-500/40 mx-0.5">
              {event.amount} 点 HP
            </span>
            {remainMatch && <span className="text-slate-400">（剩余 {remainMatch[1]} HP）</span>}
          </span>
        );
      }

      if (event.action_type === 'self_lose_hp' && tgtName) {
        return (
          <span className="log-text leading-relaxed">
            {renderEntityChip(tgtName, targetSide ?? primarySide)}
            <span>自损</span>
            <span className="font-bold text-rose-400 bg-rose-950/50 px-1.5 py-0.5 rounded-[2px] border border-rose-500/40 mx-0.5">
              💥 {event.amount} 点 HP
            </span>
          </span>
        );
      }

      if (tgtName) {
        const verb = event.action_type === 'attack' ? '攻击' : '命中';
        return (
          <span className="log-text leading-relaxed">
            {event.source_instance_id || KNOWN_CARD_NAMES.has(srcName) ? (
              renderEntityChip(srcName, primarySide)
            ) : (
              <span className="font-bold text-amber-300 mx-0.5">✨ {srcName}</span>
            )}
            <span>{verb}</span>
            {renderEntityChip(tgtName, targetSide ?? primarySide)}
            <span>造成</span>
            <span className="font-bold text-rose-400 bg-rose-950/50 px-1.5 py-0.5 rounded-[2px] border border-rose-500/40 mx-0.5">
              💥 {event.amount} 点伤害
            </span>
            {absorbed > 0 && (
              <span className="font-bold text-amber-300 bg-amber-950/50 px-1.5 py-0.5 rounded-[2px] border border-amber-500/30 mx-0.5">
                🛡️ 护盾吸收 {absorbed}
              </span>
            )}
          </span>
        );
      }
    }

    if (event.type === 'base_damaged' && event.amount !== undefined) {
      const baseSide = targetSide ?? event.player_id ?? null;
      if (event.source_name) {
        return (
          <span className="log-text leading-relaxed">
            {renderEntityChip(event.source_name, primarySide)}
            <span>攻击</span>
            <span className={baseLabelClass(baseSide)}>基地</span>
            <span>造成</span>
            <span className="font-bold text-rose-400 bg-rose-950/50 px-1.5 py-0.5 rounded-[2px] border border-rose-500/40 mx-0.5">
              💥 {event.amount} 点伤害
            </span>
          </span>
        );
      }
    }

    if (event.type === 'unit_defeated' && event.source_name && event.target_name && primarySide !== targetSide) {
      return (
        <span className="log-text leading-relaxed">
          {renderEntityChip(event.source_name, primarySide)}
          <span className="font-black px-1.5 py-0.5 rounded-[2px] text-[11px] bg-red-950 text-red-300 border border-red-500/70 mx-1">
            💀 击倒
          </span>
          {renderEntityChip(event.target_name, targetSide)}
        </span>
      );
    }

    if (event.type === 'effect_triggered' && event.action_type === 'surrender') {
      const isBlue = primarySide === allySide;
      return (
        <span className="log-text leading-relaxed">
          <span className={isBlue ? 'text-sky-300 font-bold' : 'text-rose-300 font-bold'}>
            宣告撤退（投降），战斗结束
          </span>
        </span>
      );
    }

    // 通用清理：移除所有"玩家 A/B"文字，使用颜色直接标识敌我
    const cleaned = stripFactionText(event.detail);
    const regex =
      /(\[[^\]]+·[^\]]+\]|【[^】]+】|基地|击倒了|击杀了|造成 \d+ 点(?: HP| 法术| 物理| 中毒| 技能| 反击| 真实)?(?:技能)?伤害|造成 \d+ 点(?:基地|基本分|疲劳)+伤害|护盾吸收了 \d+ 点伤害|（护盾吸收 \d+）|（护盾吸收 \d+ 点）|主动撤离战场|撤回手牌|召回召唤物|获得 \d+ 点(?:部署费用|CP)|获得 \d+ 点护盾|恢复 \d+ 点 HP|治疗 [^ ]+ \d+ 点 HP|减免 \d+ 点受击伤害|阵亡并进入弃牌堆|被击倒并进入弃牌堆|被摧毁并进入弃牌堆|被摧毁移除|眩晕|冻结|落地|减速|压制|寒冷|脆弱|掩护|中毒|沉默|嘲讽|集火|不屈)/g;

    const parts: string[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(cleaned)) !== null) {
      if (match.index > lastIdx) parts.push(cleaned.substring(lastIdx, match.index));
      parts.push(match[0]);
      lastIdx = regex.lastIndex;
    }
    if (lastIdx < cleaned.length) parts.push(cleaned.substring(lastIdx));

    let seenEntityCount = 0;
    return (
      <span className="log-text leading-relaxed">
        {parts.map((token, i) => {
          if (!token) return null;

          if (token === '基地') {
            const baseSide = targetSide ?? event.player_id ?? primarySide;
            return (
              <span key={i} className={baseLabelClass(baseSide)}>
                基地
              </span>
            );
          }

          if (token.startsWith('[') && token.endsWith(']') && token.includes('·')) {
            return renderCellBadge(token, i);
          }

          if (token.startsWith('【') && token.endsWith('】')) {
            const inner = token.slice(1, -1);

            if (STATUS_NAMES.has(inner)) {
              return (
                <span
                  key={i}
                  className="font-bold text-amber-200 bg-amber-900/60 px-1.5 py-0.5 rounded-[2px] text-[11px] border border-amber-500/40 mx-0.5"
                >
                  {inner}
                </span>
              );
            }

            const isSkillOrPassive =
              SKILL_KEYWORDS.includes(inner) ||
              inner.includes('技能') ||
              inner.includes('反应') ||
              inner.includes('特性');

            if (isSkillOrPassive) {
              return (
                <span
                  key={i}
                  className="font-bold px-1.5 py-0.5 rounded-[2px] text-[11px] bg-amber-950/50 text-amber-300 border border-amber-500/40 mx-0.5"
                >
                  ⚡【{inner}】
                </span>
              );
            }

            // 推断实体所属阵营
            let opSide: PlayerId | null = null;
            if (event.source_name && inner === event.source_name && seenEntityCount === 0 && primarySide) {
              opSide = primarySide;
            } else if (event.target_name && inner === event.target_name && targetSide) {
              opSide = targetSide;
            } else if (seenEntityCount === 0 && primarySide) {
              opSide = primarySide;
            } else if (seenEntityCount > 0 && targetSide) {
              opSide = targetSide;
            } else {
              for (const info of instanceMap.values()) {
                if (info.name === inner) {
                  opSide = info.owner;
                  break;
                }
              }
            }
            seenEntityCount += 1;

            if (!opSide && !KNOWN_CARD_NAMES.has(inner)) {
              return (
                <span
                  key={i}
                  className="font-bold px-1.5 py-0.5 rounded-[2px] text-[11px] bg-amber-950/50 text-amber-300 border border-amber-500/40 mx-0.5"
                >
                  ⚡【{inner}】
                </span>
              );
            }

            return renderEntityChip(inner, opSide ?? primarySide, i);
          }

          if (token === '击杀了' || token === '击倒了') {
            return (
              <span
                key={i}
                className="font-black px-1.5 py-0.5 rounded-[2px] text-[11px] bg-red-950 text-red-300 border border-red-500/80 shadow-md mx-1"
              >
                💀 {token}
              </span>
            );
          }

          if (token.includes('伤害')) {
            return (
              <span
                key={i}
                className="font-bold text-rose-400 bg-rose-950/50 px-1.5 py-0.5 rounded-[2px] border border-rose-500/40 mx-0.5"
              >
                💥 {token}
              </span>
            );
          }

          if (token.includes('护盾')) {
            return (
              <span
                key={i}
                className="font-bold text-amber-300 bg-amber-950/50 px-1.5 py-0.5 rounded-[2px] border border-amber-500/30 mx-0.5"
              >
                🛡️ {token}
              </span>
            );
          }

          if (token.includes('治疗') || token.includes('恢复')) {
            return (
              <span
                key={i}
                className="font-bold text-emerald-300 bg-emerald-950/50 px-1.5 py-0.5 rounded-[2px] border border-emerald-500/40 mx-0.5"
              >
                💚 {token}
              </span>
            );
          }

          if (token === '主动撤离战场' || token === '撤回手牌' || token === '召回召唤物') {
            return (
              <span
                key={i}
                className="font-bold text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded-[2px] border border-emerald-500/40 mx-0.5"
              >
                🏃 {token}
              </span>
            );
          }

          if (STATUS_NAMES.has(token)) {
            return (
              <span
                key={i}
                className="font-bold text-amber-200 bg-amber-900/60 px-1.5 py-0.5 rounded-[2px] text-[11px] border border-amber-500/40 mx-0.5"
              >
                {token}
              </span>
            );
          }

          if (token.includes('阵亡') || token.includes('被击倒') || token.includes('被摧毁')) {
            return (
              <span key={i} className="font-bold text-rose-400 bg-rose-950/60 px-1 py-0.5 rounded-[2px] mx-0.5">
                💀 {token}
              </span>
            );
          }

          if (token.includes('CP') || token.includes('部署费用')) {
            return (
              <span
                key={i}
                className="font-bold text-cyan-300 bg-cyan-950/50 px-1.5 py-0.5 rounded-[2px] border border-cyan-500/30 mx-0.5"
              >
                ⚡ {token}
              </span>
            );
          }

          return <span key={i}>{token}</span>;
        })}
      </span>
    );
  };

  // 热座测试模式保留原有渲染方式
  const renderHotseatDetail = (event: CombatLogEvent) => {
    const detail = event.detail.replace(/player_a/g, '玩家 A').replace(/player_b/g, '玩家 B');

    const regex =
      /(玩家 A|玩家 B|\[[^\]]+·[^\]]+\]|【[^】]+】|击杀了|造成 \d+ 点(?: HP| 法术| 物理| 中毒| 技能| 反击| 真实)?(?:技能)?伤害|造成 \d+ 点基地(?:与)?(?:基本分)?伤害|造成 \d+ 点基本分伤害|护盾吸收了 \d+ 点伤害|（护盾吸收 \d+ 点）|主动撤离战场|普通撤离|召回召唤物|部署了|直击 玩家 [AB] 基地|攻击 玩家 [AB] 基地|阵亡并进入弃牌堆|阵亡退场|摧毁并移出|获得 \d+ 点(?:部署费用|CP)|获得 \d+ SP|消耗 \d+ SP|治疗 [^ ]+ \d+ 点 HP|为【[^】]+】治疗 \d+ 点 HP|减免 \d+ 点受击伤害|眩晕|冻结|落地|减速|压制|寒冷|脆弱|掩护|中毒|沉默|嘲讽|集火)/g;

    const parts: string[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(detail)) !== null) {
      if (match.index > lastIdx) {
        parts.push(detail.substring(lastIdx, match.index));
      }
      parts.push(match[0]);
      lastIdx = regex.lastIndex;
    }
    if (lastIdx < detail.length) {
      parts.push(detail.substring(lastIdx));
    }

    let lastFactionContext: PlayerId | null = event.source_player_id ?? null;

    return (
      <span className="log-text leading-relaxed">
        {parts.map((token, i) => {
          if (!token) return null;

          if (token === '玩家 A') {
            lastFactionContext = 'player_a';
            return (
              <span
                key={i}
                className="font-bold px-1.5 py-0.5 rounded text-[11px] bg-sky-950/90 text-sky-300 border border-sky-500/50 mx-0.5 shadow-sm inline-flex items-center gap-0.5"
              >
                🔵 玩家 A
              </span>
            );
          }

          if (token === '玩家 B') {
            lastFactionContext = 'player_b';
            return (
              <span
                key={i}
                className="font-bold px-1.5 py-0.5 rounded text-[11px] bg-rose-950/90 text-rose-300 border border-rose-500/50 mx-0.5 shadow-sm inline-flex items-center gap-0.5"
              >
                🔴 玩家 B
              </span>
            );
          }

          if (token.startsWith('[') && token.endsWith(']') && token.includes('·')) {
            return renderCellBadge(token, i);
          }

          if (token.startsWith('【') && token.endsWith('】')) {
            const inner = token.slice(1, -1);
            const isSkillOrPassive =
              SKILL_KEYWORDS.includes(inner) ||
              inner.includes('技能') ||
              inner.includes('反应') ||
              inner.includes('特性');

            if (isSkillOrPassive) {
              return (
                <span
                  key={i}
                  className="font-bold px-1.5 py-0.5 rounded text-[11px] bg-amber-950/50 text-amber-300 border border-amber-500/40 mx-0.5"
                >
                  ⚡【{inner}】
                </span>
              );
            }

            let opSide: PlayerId | null = null;
            for (const info of instanceMap.values()) {
              if (info.name === inner) {
                opSide = info.owner;
                break;
              }
            }
            if (!opSide) {
              opSide = lastFactionContext;
            }

            return (
              <span
                key={i}
                className={`font-bold px-1.5 py-0.5 rounded text-[11px] mx-0.5 transition ${entityChipClass(opSide)}`}
              >
                【{inner}】
              </span>
            );
          }

          if (token === '击杀了') {
            return (
              <span
                key={i}
                className="font-black px-1.5 py-0.5 rounded text-[11px] bg-red-950 text-red-300 border border-red-500/80 shadow-md mx-1"
              >
                💀 击杀了
              </span>
            );
          }

          if (token.includes('点') && (token.includes('伤害') || token.includes('基本分伤害'))) {
            return (
              <span
                key={i}
                className="font-bold text-rose-400 bg-rose-950/50 px-1.5 py-0.5 rounded border border-rose-500/40 mx-0.5"
              >
                💥 {token}
              </span>
            );
          }

          if (token === '主动撤离战场') {
            return (
              <span
                key={i}
                className="font-bold text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/40 mx-0.5"
              >
                🏃 主动撤离战场
              </span>
            );
          }

          if (token === '部署了') {
            return (
              <span
                key={i}
                className="font-bold text-blue-300 bg-blue-950/60 px-1.5 py-0.5 rounded border border-blue-500/40 mx-0.5"
              >
                📍 部署了
              </span>
            );
          }

          if (token.includes('护盾吸收')) {
            return (
              <span
                key={i}
                className="font-bold text-amber-300 bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-500/30 mx-0.5"
              >
                🛡️ {token}
              </span>
            );
          }

          if (token.includes('治疗')) {
            return (
              <span
                key={i}
                className="font-bold text-emerald-300 bg-emerald-950/50 px-1.5 py-0.5 rounded border border-emerald-500/40 mx-0.5"
              >
                💚 {token}
              </span>
            );
          }

          if (STATUS_NAMES.has(token)) {
            const icon =
              token === '冻结' || token === '寒冷'
                ? '❄️'
                : token === '眩晕'
                  ? '💫'
                  : token === '落地'
                    ? '⚓'
                    : token === '掩护' || token === '嘲讽'
                      ? '🛡️'
                      : token === '集火'
                        ? '🎯'
                        : token === '脆弱'
                          ? '💔'
                          : token === '中毒'
                            ? '☠️'
                            : '⏳';
            return (
              <span
                key={i}
                className="font-bold text-amber-200 bg-amber-900/60 px-1.5 py-0.5 rounded text-[11px] border border-amber-500/40 mx-0.5"
              >
                {icon} {token}
              </span>
            );
          }

          if (token.includes('阵亡并进入弃牌堆') || token.includes('阵亡退场')) {
            return (
              <span key={i} className="font-bold text-rose-400 line-through bg-rose-950/60 px-1 py-0.5 rounded mx-0.5">
                💀 {token}
              </span>
            );
          }

          if (token.includes('点部署费用') || token.includes('SP')) {
            return (
              <span
                key={i}
                className="font-bold text-cyan-300 bg-cyan-950/50 px-1.5 py-0.5 rounded border border-cyan-500/30 mx-0.5"
              >
                ⚡ {token}
              </span>
            );
          }

          return <span key={i}>{token}</span>;
        })}
      </span>
    );
  };

  return (
    <div className="log-container flex flex-col h-full bg-[#11151e] rounded-[3px] border border-[#232b3b] overflow-hidden text-xs shadow-inner">
      {/* Log Header with Filter Tabs & Auto-Scroll Toggle */}
      <div className="flex items-center justify-between p-1.5 bg-[#171c27] border-b border-[#232b3b] gap-1 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto text-[11px]">
          <button
            className={`px-2 py-0.5 rounded-[2px] font-medium cursor-pointer transition ${
              filter === 'all' ? 'bg-[#29354a] text-white font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
            onClick={() => setFilter('all')}
          >
            全部 ({sanitizedHistory.length})
          </button>

          {isPlayerView ? (
            <>
              <button
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] font-bold cursor-pointer transition border ${
                  filter === 'ally'
                    ? 'bg-sky-950 text-sky-300 border-sky-500'
                    : 'text-sky-400/85 border-transparent hover:bg-sky-950/40'
                }`}
                onClick={() => setFilter('ally')}
              >
                <span className="w-1.5 h-1.5 bg-sky-400 shrink-0" aria-hidden="true" />
                己方
              </button>
              <button
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] font-bold cursor-pointer transition border ${
                  filter === 'enemy'
                    ? 'bg-rose-950 text-rose-300 border-rose-500'
                    : 'text-rose-400/85 border-transparent hover:bg-rose-950/40'
                }`}
                onClick={() => setFilter('enemy')}
              >
                <span className="w-1.5 h-1.5 bg-rose-400 shrink-0" aria-hidden="true" />
                敌方
              </button>
              <button
                className={`px-1.5 py-0.5 rounded-[2px] cursor-pointer transition ${
                  filter === 'combat'
                    ? 'bg-amber-950/70 text-amber-300 font-bold border border-amber-600/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setFilter('combat')}
              >
                ⚔️ 攻击结算
              </button>
              <button
                className={`px-1.5 py-0.5 rounded-[2px] cursor-pointer transition ${
                  filter === 'skills'
                    ? 'bg-cyan-950/70 text-cyan-300 font-bold border border-cyan-600/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setFilter('skills')}
              >
                ✨ 效果/支援
              </button>
              <button
                className={`px-1.5 py-0.5 rounded-[2px] cursor-pointer transition ${
                  filter === 'moves'
                    ? 'bg-emerald-950/70 text-emerald-300 font-bold border border-emerald-600/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setFilter('moves')}
              >
                📍 部署/调度
              </button>
            </>
          ) : (
            <>
              <button
                className={`px-1.5 py-0.5 rounded font-bold cursor-pointer transition border ${
                  filter === 'player_a'
                    ? 'bg-sky-950 text-sky-300 border-sky-500'
                    : 'text-sky-400/80 border-transparent hover:bg-sky-950/40'
                }`}
                onClick={() => setFilter('player_a')}
              >
                🔵 玩家 A
              </button>
              <button
                className={`px-1.5 py-0.5 rounded font-bold cursor-pointer transition border ${
                  filter === 'player_b'
                    ? 'bg-rose-950 text-rose-300 border-rose-500'
                    : 'text-rose-400/80 border-transparent hover:bg-rose-950/40'
                }`}
                onClick={() => setFilter('player_b')}
              >
                🔴 玩家 B
              </button>
              <button
                className={`px-1.5 py-0.5 rounded cursor-pointer transition ${
                  filter === 'combat'
                    ? 'bg-amber-950/70 text-amber-300 font-bold border border-amber-600/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setFilter('combat')}
              >
                ⚔️ 战斗
              </button>
              <button
                className={`px-1.5 py-0.5 rounded cursor-pointer transition ${
                  filter === 'skills'
                    ? 'bg-cyan-950/70 text-cyan-300 font-bold border border-cyan-600/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setFilter('skills')}
              >
                ⚡ 技能
              </button>
              <button
                className={`px-1.5 py-0.5 rounded cursor-pointer transition ${
                  filter === 'moves'
                    ? 'bg-emerald-950/70 text-emerald-300 font-bold border border-emerald-600/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setFilter('moves')}
              >
                🏃 调度/撤离
              </button>
            </>
          )}
        </div>

        <button
          className={`text-[10px] px-1.5 py-0.5 rounded-[2px] cursor-pointer transition shrink-0 ${
            autoScroll
              ? 'text-cyan-400 bg-cyan-950/60 border border-cyan-500/40'
              : 'text-slate-500 hover:text-slate-300'
          }`}
          onClick={() => setAutoScroll((v) => !v)}
          title="点击切换自动滚动到底部"
        >
          {autoScroll ? '⬇ 自动滚动' : '⏸ 暂停滚动'}
        </button>
      </div>

      {/* Log Events List */}
      <div
        className="log-view flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 select-text"
        ref={containerRef}
        style={{ maxHeight: '68vh' }}
      >
        {filteredEvents.length > MAX_RENDERED_EVENTS && (
          <div className="log-omitted text-slate-500 text-[10px] text-center py-1">
            （仅显示最近 {MAX_RENDERED_EVENTS} 条记录，共 {filteredEvents.length} 条）
          </div>
        )}

        {visibleEvents.map((event) => {
          const { primarySide, targetSide } = getEventSides(event);
          const isBluePrimary = isPlayerView ? primarySide === allySide : primarySide === 'player_a';
          const isRedPrimary = isPlayerView ? primarySide === enemySide : primarySide === 'player_b';

          const rowTone =
            event.type === 'unit_defeated'
              ? 'bg-red-950/30 border-red-700/50 shadow-sm'
              : event.type === 'damage_resolved'
                ? isBluePrimary
                  ? 'bg-sky-950/20 border-sky-800/45'
                  : isRedPrimary
                    ? 'bg-rose-950/20 border-rose-800/45'
                    : 'bg-rose-950/20 border-rose-900/40'
                : event.type === 'skill_activated' || event.type === 'reaction_triggered'
                  ? 'bg-purple-950/20 border-purple-900/40'
                  : event.type === 'unit_withdrawn'
                    ? 'bg-emerald-950/20 border-emerald-900/40'
                    : isBluePrimary
                      ? 'bg-sky-950/15 border-sky-900/35'
                      : isRedPrimary
                        ? 'bg-rose-950/15 border-rose-900/35'
                        : 'bg-[#151924] border-[#222b3b]';

          const playerViewBorderAccent = isPlayerView
            ? isBluePrimary
              ? 'border-l-2 border-l-sky-400'
              : isRedPrimary
                ? 'border-l-2 border-l-rose-400'
                : 'border-l-2 border-l-slate-600'
            : '';

          return (
            <div
              key={event.sequence}
              className={`log-line flex items-start gap-1.5 p-1.5 rounded-[2px] transition text-[11px] leading-relaxed border ${rowTone} ${playerViewBorderAccent}`}
            >
              {/* Sequence badge */}
              <span className="font-mono text-[9px] text-slate-500 w-5 shrink-0 pt-0.5 tabular-nums">
                #{event.sequence + 1}
              </span>

              {/* Event Type Badge */}
              {getEventBadge(event)}

              {/* 热座测试模式保留 A方/B方 徽标；玩家视角仅用颜色表示敌我，不输出文字阵营声明 */}
              {!isPlayerView && primarySide ? (
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                    primarySide === 'player_a'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/50'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/50'
                  }`}
                >
                  {primarySide === 'player_a' ? 'A方' : 'B方'}
                  {targetSide && targetSide !== primarySide
                    ? ` ➔ ${targetSide === 'player_a' ? 'A方' : 'B方'}`
                    : ''}
                </span>
              ) : null}

              {/* Detail message */}
              <div className="flex-1 break-words">
                {isPlayerView ? renderPlayerPerspectiveDetail(event) : renderHotseatDetail(event)}
              </div>
            </div>
          );
        })}

        {filteredEvents.length === 0 && (
          <div className="log-empty text-slate-500 text-center py-8 text-xs">
            {sanitizedHistory.length === 0 ? '暂无战斗日志，等待回合战斗结算。' : '当前筛选分类下无日志记录。'}
          </div>
        )}
      </div>
    </div>
  );
}
