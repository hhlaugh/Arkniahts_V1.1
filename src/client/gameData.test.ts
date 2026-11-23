import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_CARDS,
  PRESET_DECKS,
  getAllAvailableDecks,
  getCustomDecks,
  saveCustomDeck,
  validateDeck,
} from './gameData';
import { getActiveCollection } from '../data/player-collection';
import type { CardId, DeckDefinition } from '../game/types';

function mockLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  vi.stubGlobal('localStorage', storage);
  return storage;
}

describe('demoData custom deck sanitization and validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('strips removed legacy DEMO-* cards from custom decks and excludes incomplete decks from battle selection', () => {
    const eighteenValidCards = DEMO_CARDS.slice(0, 9).map((c) => ({ card_id: c.card_id, quantity: 2 }));
    const legacyMixedDeck: DeckDefinition = {
      deck_id: 'CUSTOM-MWABWAWC',
      deck_name_zh: '历史混合卡组',
      cards: [
        ...eighteenValidCards,
        { card_id: 'DEMO-TAC-003' as CardId, quantity: 2 },
      ],
    };
    const legacyOnlyDemoDeck: DeckDefinition = {
      deck_id: 'CUSTOM-ONLY-DEMO',
      deck_name_zh: '纯测试卡组',
      cards: [{ card_id: 'DEMO-TAC-003' as CardId, quantity: 2 }],
    };

    const storage = mockLocalStorage({
      mrfz_custom_decks: JSON.stringify([legacyMixedDeck, legacyOnlyDemoDeck]),
    });

    const loadedCustom = getCustomDecks();
    // 纯测试卡组被丢弃；混合卡组保留剩余 18 张合法干员并清除 DEMO-TAC-003
    expect(loadedCustom).toHaveLength(1);
    expect(loadedCustom[0]!.deck_id).toBe('CUSTOM-MWABWAWC');
    expect(loadedCustom[0]!.cards.some((c) => c.card_id === ('DEMO-TAC-003' as CardId))).toBe(false);
    expect(validateDeck(loadedCustom[0]!, DEMO_CARDS).totalCards).toBe(18);
    expect(validateDeck(loadedCustom[0]!, DEMO_CARDS).valid).toBe(false);

    // 清理后的数据已迁入账户存档（arknight_accounts_v1）；旧 localStorage 键被移除
    const persisted = getActiveCollection().customDecks;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.cards.every((c) => c.card_id !== ('DEMO-TAC-003' as CardId))).toBe(true);
    expect(storage.getItem('mrfz_custom_decks')).toBeNull();

    // 未满 20 张的自定义卡组不会出现在对战可选列表 getAllAvailableDecks 中
    const battleDecks = getAllAvailableDecks();
    expect(battleDecks.some((d) => d.deck_id === 'CUSTOM-MWABWAWC')).toBe(false);
    expect(battleDecks.length).toBe(PRESET_DECKS.length);
  });

  it('includes valid 20-card custom decks in getAllAvailableDecks and preserves them when cloning presets', () => {
    mockLocalStorage();
    const initialOwned = { ...getActiveCollection().owned };

    // 20张全干员自定义卡组（非13/5/1/1）在全局规则下依然合法
    const pureOperatorDeck: DeckDefinition = {
      deck_id: 'CUSTOM-VALID-20',
      deck_name_zh: '全干员自定义卡组',
      cards: DEMO_CARDS.filter((c) => c.card_type === 'operator')
        .slice(0, 10)
        .map((c) => ({ card_id: c.card_id, quantity: 2 })),
    };
    expect(validateDeck(pureOperatorDeck, DEMO_CARDS).valid).toBe(true);

    saveCustomDeck(pureOperatorDeck);

    // 复制官方预设作为新自定义卡组保存，不应覆盖已有自定义卡组，也不应改动玩家收藏持有量
    const clonedPreset: DeckDefinition = {
      deck_id: 'CUSTOM-CLONE-PRESET-01',
      deck_name_zh: `${PRESET_DECKS[0]!.deck_name_zh} (副本)`,
      cards: PRESET_DECKS[0]!.cards.map((c) => ({ ...c })),
    };
    saveCustomDeck(clonedPreset);

    const saved = getCustomDecks();
    expect(saved.some((d) => d.deck_id === 'CUSTOM-VALID-20')).toBe(true);
    expect(saved.some((d) => d.deck_id === 'CUSTOM-CLONE-PRESET-01')).toBe(true);
    expect(getActiveCollection().owned).toEqual(initialOwned);

    const battleDecks = getAllAvailableDecks('free');
    expect(battleDecks.some((d) => d.deck_id === 'CUSTOM-VALID-20')).toBe(true);
    expect(battleDecks.some((d) => d.deck_id === 'CUSTOM-CLONE-PRESET-01')).toBe(true);
    expect(battleDecks.length).toBe(PRESET_DECKS.length + 2);
  });

  it('does not treat official preset template cards as owned cards in collection mode', () => {
    mockLocalStorage();
    const collectionDecks = getAllAvailableDecks('collection');
    // 新账号仅持有 3★ 干员，未持有官方预设中的 4★/5★/6★/战术/支援卡
    for (const preset of PRESET_DECKS) {
      expect(collectionDecks.some((d) => d.deck_id === preset.deck_id)).toBe(false);
    }
    expect(collectionDecks.some((d) => d.deck_id === 'DECK-STARTER-A')).toBe(true);
  });
});
