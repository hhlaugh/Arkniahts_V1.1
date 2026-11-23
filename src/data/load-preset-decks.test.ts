import { describe, expect, it } from 'vitest';
import officialPresetJson from './official-preset-decks.json';
import { loadDemoData } from './load-card-data';
import { computeDeckCostProfile, loadOfficialPresetDecks } from './load-preset-decks';
import type { CardDefinition, CardId } from '../game/types';

describe('loadOfficialPresetDecks', () => {
  const { validCards } = loadDemoData();
  const cardById = new Map<CardId, CardDefinition>(validCards.map((c) => [c.card_id, c]));

  it('loads all 8 official 20-card preset decks with zero validation issues', () => {
    const result = loadOfficialPresetDecks(validCards);
    expect(result.issues).toEqual([]);
    expect(result.decks).toHaveLength(8);
    expect(result.decks.map((d) => d.deck_id)).toEqual([
      'PRESET-01',
      'PRESET-02',
      'PRESET-03',
      'PRESET-04',
      'PRESET-05',
      'PRESET-06',
      'PRESET-07',
      'PRESET-08',
    ]);
  });

  it('verifies every official preset deck has 20 copies, <=2 per cardId/name, valid IDs, matching costCP, and 13/5/1/1 composition', () => {
    const result = loadOfficialPresetDecks(validCards);

    for (const deck of result.decks) {
      const total = deck.cards.reduce((sum, item) => sum + item.quantity, 0);
      expect(total).toBe(20);

      const nameCounts = new Map<string, number>();
      for (const entry of deck.cards) {
        const def = cardById.get(entry.card_id);
        expect(def).toBeDefined();
        expect(entry.quantity).toBeGreaterThanOrEqual(1);
        expect(entry.quantity).toBeLessThanOrEqual(2);
        const nextNameCount = (nameCounts.get(def!.card_name_zh) ?? 0) + entry.quantity;
        nameCounts.set(def!.card_name_zh, nextNameCount);
        expect(nextNameCount).toBeLessThanOrEqual(2);
      }

      const meta = result.metadataById.get(deck.deck_id);
      expect(meta).toBeDefined();
      expect(meta!.archetype.length).toBeGreaterThan(0);
      expect(meta!.difficulty.length).toBeGreaterThan(0);
      expect(meta!.strengths.length).toBeGreaterThan(0);
      expect(meta!.weaknesses.length).toBeGreaterThan(0);
      expect(meta!.gamePlan.length).toBeGreaterThan(0);
      expect(meta!.composition).toEqual({
        operators: 13,
        tactics: 5,
        facilities: 1,
        equipment: 1,
        totalCopies: 20,
      });

      // 实时费用曲线必须严格与主卡池 cost 一致
      const profile = computeDeckCostProfile(deck, cardById);
      expect(profile.totalCopies).toBe(20);
      expect(profile.typeCounts).toEqual({
        operator: 13,
        tactic: 5,
        facility: 1,
        equipment: 1,
      });
      const expectedCostSum = deck.cards.reduce((sum, item) => sum + (cardById.get(item.card_id)?.cost ?? 0) * item.quantity, 0);
      expect(profile.totalCostSum).toBe(expectedCostSum);
    }
  });

  it('matches official-preset-decks.json costCP and name fields identically against card-pool.json', () => {
    for (const rawDeck of officialPresetJson.decks) {
      let costSumFromJson = 0;
      for (const rawCard of rawDeck.cards) {
        const def = cardById.get(rawCard.cardId as CardId);
        expect(def).toBeDefined();
        expect(rawCard.costCP).toBe(def!.cost);
        expect(rawCard.name).toBe(def!.card_name_zh);
        costSumFromJson += rawCard.costCP * rawCard.count;
      }
      expect(costSumFromJson).toBe(rawDeck.costSummary.totalCardCostSum);
    }
  });

  it('rejects cost mismatches, unknown cardIds, wrong deck sizes, and copy limit violations', () => {
    const baseDeck = structuredClone(officialPresetJson.decks[0]!);
    baseDeck.cards[0]!.costCP = 99;
    baseDeck.cards[1]!.count = 3;
    baseDeck.cards.push({
      cardId: 'NON-EXISTENT-CARD',
      name: '不存在',
      count: 1,
      cardType: 'operator',
      supportSubtype: '',
      costCP: 1,
      operatorClass: 'van',
      subclass: '尖兵',
      synergyTags: '',
      abilityText: 'test',
    });

    const badResult = loadOfficialPresetDecks(validCards, { decks: [baseDeck] });
    const codes = badResult.issues.map((i) => i.code);
    expect(codes).toContain('PRESET_COST_MISMATCH');
    expect(codes).toContain('COPY_LIMIT_EXCEEDED');
    expect(codes).toContain('UNKNOWN_PRESET_CARD');
    expect(codes).toContain('INVALID_DECK_SIZE');
  });
});
