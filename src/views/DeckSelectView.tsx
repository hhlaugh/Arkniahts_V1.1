import React, { useEffect, useMemo, useState } from 'react';
import {
  CARD_BY_ID,
  DEMO_CARDS,
  PRESET_DECKS,
  getAllAvailableDecks,
  getCustomDecks,
  getPresetDeckMetadata,
  PLAYER_LABEL,
  validateDeck,
} from '../client/gameData';
import { getActiveAccountName, getDeckMode, setDeckMode } from '../data/player-collection';
import type { DeckMode } from '../data/player-collection';
import type { LocalGameSetup } from '../client/localGameController';
import {
  CLASSIC_BOARD_PROFILE,
  CUSTOM_5_LANE_EXAMPLE,
  createCustomBoardProfile,
  validateBoardProfile,
} from '../game/board';
import type { BoardProfile, DeckDefinition, PlayerId } from '../game/types';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { PresetDeckSummary } from '../components/deck/PresetDeckSummary';
import { ScenicBackdrop, ScenicBannerLayer } from '../components/ui/ScenicBackdrop';

const BOARD_PRESETS: readonly { readonly id: string; readonly label: string; readonly profile: BoardProfile }[] = [
  { id: 'classic-3x2', label: '经典 3×2 (F1/R1)', profile: CLASSIC_BOARD_PROFILE },
  {
    id: 'custom-1-lane',
    label: '单路狭道 1×2',
    profile: createCustomBoardProfile([{ frontSlots: 1, rearSlots: 1 }], 'custom-1-lane'),
  },
  {
    id: 'custom-4-lane',
    label: '4路双前锋 (F2/R1)',
    profile: createCustomBoardProfile(
      [
        { frontSlots: 2, rearSlots: 1 },
        { frontSlots: 2, rearSlots: 1 },
        { frontSlots: 2, rearSlots: 1 },
        { frontSlots: 2, rearSlots: 1 },
      ],
      'custom-4-lane',
    ),
  },
  { id: 'custom-5-example', label: '5路非对称 (示例)', profile: CUSTOM_5_LANE_EXAMPLE },
];

interface DeckSelectViewProps {
  readonly mode: 'hotseat' | 'vs-bot';
  readonly onStart: (setup: LocalGameSetup) => void;
  readonly onCancel: () => void;
  readonly onOpenDeckEditor?: () => void;
  readonly initialDeckMode?: DeckMode;
  readonly initialBoardProfile?: BoardProfile;
}

function deckComposition(deck: DeckDefinition): string {
  return deck.cards
    .map((entry) => `${CARD_BY_ID.get(entry.card_id)?.card_name_zh ?? entry.card_id}×${entry.quantity}`)
    .join('、');
}

export function DeckSelectView({
  mode,
  onStart,
  onCancel,
  onOpenDeckEditor,
  initialDeckMode,
  initialBoardProfile = CLASSIC_BOARD_PROFILE,
}: DeckSelectViewProps) {
  const [accountName] = useState(() => getActiveAccountName());
  const [deckMode, setDeckModeState] = useState<DeckMode>(() => initialDeckMode ?? getDeckMode());
  const availableDecks = useMemo(() => getAllAvailableDecks(deckMode), [deckMode]);
  const incompleteCustomDecks = useMemo(
    () => getCustomDecks().filter((deck) => !validateDeck(deck, DEMO_CARDS).valid),
    [],
  );

  // 切换构筑模式后，已选卡组可能不再可用（收录模式下被过滤），回退到首个可用卡组。
  useEffect(() => {
    setDeckIds((prev) => {
      const validA = availableDecks.some((deck) => deck.deck_id === prev.player_a);
      const validB = availableDecks.some((deck) => deck.deck_id === prev.player_b);
      return {
        player_a: validA ? prev.player_a : availableDecks[0]?.deck_id ?? '',
        player_b: validB ? prev.player_b : availableDecks[1]?.deck_id ?? availableDecks[0]?.deck_id ?? '',
      };
    });
  }, [availableDecks]);

  const [deckIds, setDeckIds] = useState<Record<PlayerId, string>>({
    player_a: availableDecks[0]?.deck_id ?? '',
    player_b: availableDecks[1]?.deck_id ?? availableDecks[0]?.deck_id ?? '',
  });
  const [seedText, setSeedText] = useState('');
  const [boardProfile, setBoardProfile] = useState<BoardProfile>(initialBoardProfile);
  const [showCustomBoard, setShowCustomBoard] = useState(false);
  const [expandedPresetKeys, setExpandedPresetKeys] = useState<Record<string, boolean>>({});
  const [showPresetGuideModal, setShowPresetGuideModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toggleExpanded = (key: string) => {
    setExpandedPresetKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const boardValidation = useMemo(() => validateBoardProfile(boardProfile), [boardProfile]);

  const setCustomLaneCount = (count: number) => {
    const clamped = Math.max(1, Math.min(5, count));
    const lanes = Array.from({ length: clamped }, (_, i) => {
      const existing = boardProfile.lanes[i];
      return {
        frontSlots: existing ? existing.frontSlots : 1,
        rearSlots: existing ? existing.rearSlots : 1,
      };
    });
    setBoardProfile(createCustomBoardProfile(lanes, `custom-${clamped}-lane`));
  };

  const updateCustomLaneSlot = (index: number, field: 'frontSlots' | 'rearSlots', value: number) => {
    const clamped = Math.max(0, Math.min(3, value));
    const lanes = boardProfile.lanes.map((lane, i) =>
      i === index
        ? { frontSlots: field === 'frontSlots' ? clamped : lane.frontSlots, rearSlots: field === 'rearSlots' ? clamped : lane.rearSlots }
        : { frontSlots: lane.frontSlots, rearSlots: lane.rearSlots },
    );
    setBoardProfile(createCustomBoardProfile(lanes, `custom-${lanes.length}-lane`));
  };

  const start = () => {
    const deckA = availableDecks.find((deck) => deck.deck_id === deckIds.player_a);
    const deckB = availableDecks.find((deck) => deck.deck_id === deckIds.player_b);
    if (!deckA || !deckB) {
      setErrorMessage('请为双方选择有效卡组。');
      return;
    }
    const checkA = validateDeck(deckA, DEMO_CARDS);
    if (!checkA.valid) {
      setErrorMessage(`玩家 A 卡组「${deckA.deck_name_zh}」无效：${checkA.errors[0] ?? '请检查构筑'}`);
      return;
    }
    const checkB = validateDeck(deckB, DEMO_CARDS);
    if (!checkB.valid) {
      setErrorMessage(`玩家 B 卡组「${deckB.deck_name_zh}」无效：${checkB.errors[0] ?? '请检查构筑'}`);
      return;
    }
    if (!boardValidation.valid) {
      setErrorMessage(`棋盘地形配置无效：${boardValidation.errors[0] ?? '至少需要 1 个可部署格'}`);
      return;
    }
    setErrorMessage(null);
    const parsed = Number.parseInt(seedText, 10);
    const seed = Number.isFinite(parsed) ? parsed : Math.floor(Math.random() * 2 ** 31);
    onStart({ decks: { player_a: deckA, player_b: deckB }, cards: DEMO_CARDS, seed, boardProfile });
  };

  const renderColumn = (playerId: PlayerId) => {
    const isPlayerA = playerId === 'player_a';
    const columnScene = isPlayerA ? 'rhodes-exterior' : mode === 'vs-bot' ? 'rhodes-command' : 'snowfield';
    return (
      <Panel
        variant="default"
        title={`${PLAYER_LABEL[playerId]} 作战编制`}
        codeName={isPlayerA ? 'OPERATOR.ALPHA' : 'OPERATOR.BETA'}
        headerScene={columnScene}
        className="flex-1 flex flex-col min-w-0"
      >
        <div className="relative overflow-hidden">
          <ScenicBannerLayer scene={columnScene} fade="right" opacityClassName="opacity-18" />
          <div className="relative z-10 p-3 space-y-2 max-h-[55vh] overflow-y-auto">
            {availableDecks.map((deck) => {
              const isSelected = deckIds[playerId] === deck.deck_id;
              const isCustom = deck.deck_id.startsWith('CUSTOM-');
              const meta = getPresetDeckMetadata(deck.deck_id);
              const expandKey = `${playerId}:${deck.deck_id}`;
              const isExpanded = Boolean(expandedPresetKeys[expandKey]) || (isSelected && Boolean(meta));
              return (
                <div
                  key={deck.deck_id}
                  onClick={() => setDeckIds((prev) => ({ ...prev, [playerId]: deck.deck_id }))}
                  className={`p-3 border transition-all cursor-pointer select-none space-y-2 ${
                    isSelected
                      ? 'bg-[#29323d]/95 border-[#e5a52b] ring-1 ring-[#e5a52b]/40 shadow-md'
                      : 'bg-[#181d22]/90 border-[#313b43] hover:border-[#4b5a66] hover:bg-[#1d232a]/95'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-xs text-white truncate">{deck.deck_name_zh}</span>
                      <Badge variant={isCustom ? 'rarity' : 'neutral'} value={isCustom ? 5 : undefined}>
                        {isCustom ? '自定义' : meta ? '官方预设' : '新手预设'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {meta && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpanded(expandKey);
                          }}
                          className="px-1.5 py-0.5 text-[10px] font-mono bg-[#11161d] border border-[#3a4756] text-slate-300 hover:text-amber-300 cursor-pointer"
                        >
                          {isExpanded ? '收起详情' : '打法详情'}
                        </button>
                      )}
                      {isSelected && (
                        <span className="text-[10px] font-mono text-[#e5a52b] font-bold">
                          ✓ 已选择
                        </span>
                      )}
                    </div>
                  </div>
                  {meta ? (
                    <PresetDeckSummary deck={deck} expanded={isExpanded} />
                  ) : (
                    <div className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                      {deckComposition(deck)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Panel>
    );
  };

  return (
    <div className="relative min-h-screen w-full bg-[#12161b] text-[#e8e9e6] flex flex-col items-center justify-center p-4 sm:p-6 select-none overflow-hidden">
      <ScenicBackdrop
        scene="rhodes-command"
        fade="diagonal-tr"
        opacityClassName="opacity-[0.42]"
        tint="radial-gradient(circle at 72% 24%, rgba(56,189,248,0.14) 0%, transparent 58%)"
      />
      <Panel
        variant="raised"
        cornerCut="lg"
        scanlines
        className="relative z-10 w-full max-w-5xl border border-[#52606d] bg-[#161b22]/92 backdrop-blur-sm shadow-[0_24px_64px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden"
      >
        {/* Terminal Header */}
        <div className="relative flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3.5 bg-[#14171a] border-b border-[#363f45] overflow-hidden">
          <ScenicBannerLayer
            scene="rhodes-bridge"
            fade="right"
            opacityClassName="opacity-38"
            tint="radial-gradient(circle at 78% 50%, rgba(229,165,43,0.14) 0%, transparent 58%)"
          />
          <div className="relative z-10 flex items-center gap-3">
            <span className="w-2 h-5 bg-[#e5a52b]" />
            <div>
              <h2 className="text-base font-black tracking-widest text-slate-100 uppercase m-0 leading-tight">
                作战出击配置 · 编制选择
              </h2>
              <span className="text-[10px] font-mono text-slate-400 tracking-wider">
                账户 {accountName} · {mode === 'vs-bot' ? '单人人机推演模式' : '本地热座双人推演模式'} · {deckMode === 'collection' ? '收录模式（仅已持有干员）' : '自由构筑（全量干员）'}
              </span>
            </div>
          </div>
          {onOpenDeckEditor && (
            <div className="relative z-10 flex items-center gap-2">
              <div className="flex items-center gap-1 bg-[#161b21] border border-[#3b485e] p-0.5">
                {(['collection', 'free'] as DeckMode[]).map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => {
                      setDeckMode(candidate);
                      setDeckModeState(candidate);
                    }}
                    className={`px-2 py-1 text-[10px] font-mono font-bold transition-colors ${
                      deckMode === candidate ? 'bg-[#e5a52b] text-black' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {candidate === 'collection' ? '收录模式' : '自由构筑'}
                  </button>
                ))}
              </div>
              <Button variant="outline" size="sm" cornerCut onClick={onOpenDeckEditor}>
                🎴 打开卡组构筑器
              </Button>
            </div>
          )}
        </div>

        {/* Incomplete Custom Deck, Collection Mode & Error Notice */}
        {(incompleteCustomDecks.length > 0 || errorMessage || deckMode === 'collection') && (
          <div className="px-5 pt-3 space-y-2 bg-[#1b2025]">
            {errorMessage && (
              <div className="px-3 py-2 bg-rose-950/70 border border-rose-500/60 text-rose-200 text-xs flex items-center justify-between">
                <span>⚠️ {errorMessage}</span>
                <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-white ml-2">✕</button>
              </div>
            )}
            {deckMode === 'collection' && (
              <div className="px-3 py-2 bg-sky-950/50 border border-sky-500/40 text-sky-200 text-xs flex flex-wrap items-center justify-between gap-2">
                <span>
                  ℹ️ 收录模式：仅显示由已持有干员组成的卡组（含低星 starter 预设）；未持有的官方预设已隐藏。切换到自由构筑可使用全部 8 套官方预设。
                </span>
                <Button variant="outline" size="sm" onClick={() => setShowPresetGuideModal(true)} className="text-[11px] px-2 py-0.5">
                  📖 预览 8 套官方预设
                </Button>
              </div>
            )}
            {incompleteCustomDecks.length > 0 && (
              <div className="px-3 py-2 bg-amber-950/50 border border-amber-500/40 text-amber-200 text-xs flex flex-wrap items-center justify-between gap-2">
                <span>
                  ℹ️ 有 {incompleteCustomDecks.length} 套自定义卡组当前未满 20 张（已自动清理移除旧测试卡牌），请在卡组构筑器中补全后再用于出击。
                </span>
                {onOpenDeckEditor && (
                  <Button variant="outline" size="sm" onClick={onOpenDeckEditor} className="text-[11px] px-2 py-0.5">
                    前往补全
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Dual Deck Selection Columns */}
        <div className="p-3 sm:p-5 flex flex-col md:flex-row gap-3 sm:gap-4 bg-gradient-to-b from-[#1b2025] to-[#14181c]">
          {renderColumn('player_a')}
          {renderColumn('player_b')}
        </div>

        {/* V1.1 Board Profile Selector & Customizer */}
        <div className="px-3 sm:px-5 py-2.5 bg-[#151a20] border-t border-[#2b343e] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-mono text-slate-400 mr-1">地形预设:</span>
              {BOARD_PRESETS.map((preset) => {
                const active = !showCustomBoard && boardProfile.profileId === preset.profile.profileId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setShowCustomBoard(false);
                      setBoardProfile(preset.profile);
                    }}
                    className={`px-2 py-1 text-[10px] font-mono border cursor-pointer transition ${
                      active
                        ? 'bg-[#e5a52b]/20 text-[#e5a52b] border-[#e5a52b] font-bold'
                        : 'bg-[#101419] text-slate-300 border-[#2f3943] hover:border-slate-500'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setShowCustomBoard((prev) => !prev);
                  if (boardProfile.mode === 'classic') {
                    setCustomLaneCount(boardProfile.laneCount);
                  }
                }}
                className={`px-2 py-1 text-[10px] font-mono border cursor-pointer transition ${
                  showCustomBoard
                    ? 'bg-sky-500/20 text-sky-300 border-sky-400 font-bold'
                    : 'bg-[#101419] text-slate-300 border-[#2f3943] hover:border-slate-500'
                }`}
              >
                ⚙ 自定义 1~5 路
              </button>
            </div>
            <span className="text-[10px] font-mono text-slate-400">
              当前: <strong className="text-slate-200">{boardProfile.laneCount} 路</strong> ({boardProfile.lanes.map((l) => `${l.laneId}:F${l.frontSlots}/R${l.rearSlots}`).join(' · ')})
            </span>
          </div>

          {boardProfile.mode !== 'classic' && (
            <div className="px-2.5 py-1.5 bg-amber-950/55 border border-amber-500/45 text-[11px] text-amber-200">
              ⚠️ 自定义模式尚未单独平衡：1~5 路沿用固定卡牌效果，不会按棋盘尺寸自动增强卡牌；官方预设首选平衡环境为经典 3 路。
            </div>
          )}

          {showCustomBoard && (
            <div className="p-2.5 bg-[#0f1318] border border-[#2a3440] space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                <span className="text-slate-400">路线数:</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCustomLaneCount(n)}
                    className={`px-2 py-0.5 border cursor-pointer ${
                      boardProfile.laneCount === n
                        ? 'bg-sky-500/25 border-sky-400 text-sky-200 font-bold'
                        : 'bg-[#161c24] border-[#2e3844] text-slate-400 hover:text-white'
                    }`}
                  >
                    {n} 路
                  </button>
                ))}
                {!boardValidation.valid && (
                  <span className="text-rose-300 ml-2">⚠ {boardValidation.errors[0]}</span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {boardProfile.lanes.map((lane, idx) => (
                  <div key={lane.laneId} className="p-1.5 bg-[#151b22] border border-[#28323e] space-y-1 text-[10px] font-mono">
                    <div className="font-bold text-amber-300">{lane.laneId}</div>
                    <label className="flex items-center justify-between text-slate-300">
                      <span>前排 F</span>
                      <select
                        value={lane.frontSlots}
                        onChange={(e) => updateCustomLaneSlot(idx, 'frontSlots', Number(e.target.value))}
                        className="bg-[#0d1116] border border-[#323d4a] px-1 py-0.5 text-white"
                      >
                        {[0, 1, 2, 3].map((v) => (
                          <option key={v} value={v}>{v}格</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center justify-between text-slate-300">
                      <span>后排 R</span>
                      <select
                        value={lane.rearSlots}
                        onChange={(e) => updateCustomLaneSlot(idx, 'rearSlots', Number(e.target.value))}
                        className="bg-[#0d1116] border border-[#323d4a] px-1 py-0.5 text-white"
                      >
                        {[0, 1, 2, 3].map((v) => (
                          <option key={v} value={v}>{v}格</option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Controls & Seed Input */}
        <div className="px-3 sm:px-5 py-3 bg-[#121518] border-t border-[#313b43] flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-mono">随机种子:</span>
            <input
              type="number"
              value={seedText}
              placeholder="留空 = 随机真随机数"
              onChange={(e) => setSeedText(e.target.value)}
              className="bg-[#1b2127] border border-[#3c4750] px-2.5 py-1 text-xs text-amber-300 font-mono focus:border-amber-400 focus:outline-none w-44"
            />
          </div>

          <div className="flex items-center gap-2.5">
            <Button variant="ghost" size="md" onClick={onCancel}>
              ◀ 返回主菜单
            </Button>
            <Button variant="primary" size="md" cornerCut onClick={start} className="font-bold px-6">
              确认出击 ▶
            </Button>
          </div>
        </div>
      </Panel>

      {/* 官方 8 套预设卡组只读预览弹窗（收录模式下不污染收藏与可用列表） */}
      <Modal
        isOpen={showPresetGuideModal}
        onClose={() => setShowPresetGuideModal(false)}
        title="V1.1 官方预设卡组一览（20 张）"
        codeName="PRESET.CATALOG"
        size="lg"
        footer={
          <Button variant="secondary" size="sm" onClick={() => setShowPresetGuideModal(false)}>
            关闭预览
          </Button>
        }
      >
        <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
          <div className="px-3 py-2 bg-sky-950/40 border border-sky-500/35 text-xs text-sky-200">
            官方预设仅供参考与自由构筑体验，不会改变你的实际干员收藏数量。
          </div>
          {PRESET_DECKS.map((preset) => (
            <div key={preset.deck_id} className="p-3 bg-[#12171e] border border-[#2b3645] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm text-white">{preset.deck_name_zh}</span>
                <span className="text-[10px] font-mono text-slate-400">{preset.deck_id}</span>
              </div>
              <PresetDeckSummary deck={preset} expanded />
              <div className="text-[10px] text-slate-400 leading-relaxed pt-1 border-t border-[#222c38]">
                牌表：{deckComposition(preset)}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
