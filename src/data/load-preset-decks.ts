import officialPresetJson from './official-preset-decks.json';
import type { CardDefinition, CardId, DeckDefinition } from '../game/types';
import type { ValidationIssue } from './load-card-data';

export interface OfficialPresetComposition {
  readonly operators: number;
  readonly tactics: number;
  readonly facilities: number;
  readonly equipment: number;
  readonly totalCopies: number;
}

export interface OfficialPresetDeckMetadata {
  readonly deckId: string;
  readonly name: string;
  readonly archetype: string;
  readonly difficulty: string;
  readonly recommendedMode: string;
  readonly description: string;
  readonly strengths: string;
  readonly weaknesses: string;
  readonly gamePlan: string;
  readonly composition: OfficialPresetComposition;
  readonly duplicates: readonly { readonly cardId: string; readonly name: string; readonly count: number }[];
}

export interface DeckCostProfile {
  readonly totalCopies: number;
  readonly totalCostSum: number;
  readonly averageCost: number;
  readonly byCost: Readonly<Record<number, number>>;
  readonly typeCounts: {
    readonly operator: number;
    readonly tactic: number;
    readonly facility: number;
    readonly equipment: number;
  };
}

export interface OfficialPresetLoadResult {
  readonly decks: readonly DeckDefinition[];
  readonly metadataById: ReadonlyMap<string, OfficialPresetDeckMetadata>;
  readonly issues: readonly ValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 统一由主卡池（card-pool.json / CardDefinition.cost）实时计算卡组费用分布与类型统计，
 * 避免在预设层建立第二套独立费用数据源。
 */
export function computeDeckCostProfile(
  deck: DeckDefinition,
  cardById: ReadonlyMap<CardId, CardDefinition>,
): DeckCostProfile {
  const byCost: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const typeCounts = { operator: 0, tactic: 0, facility: 0, equipment: 0 };
  let totalCopies = 0;
  let totalCostSum = 0;

  for (const entry of deck.cards) {
    const def = cardById.get(entry.card_id);
    if (!def) continue;
    const qty = entry.quantity;
    totalCopies += qty;
    totalCostSum += def.cost * qty;
    const bucket = Math.min(6, Math.max(1, def.cost));
    byCost[bucket] = (byCost[bucket] ?? 0) + qty;
    if (def.card_type === 'operator') {
      typeCounts.operator += qty;
    } else if (def.card_type === 'tactic') {
      typeCounts.tactic += qty;
    } else if (def.card_type === 'facility' || def.support_subtype === 'facility') {
      typeCounts.facility += qty;
    } else {
      typeCounts.equipment += qty;
    }
  }

  return {
    totalCopies,
    totalCostSum,
    averageCost: totalCopies > 0 ? Number((totalCostSum / totalCopies).toFixed(2)) : 0,
    byCost,
    typeCounts,
  };
}

/**
 * 解析并校验《Arknight V1.1 官方预设卡组（20张）》JSON 数据包。
 * - 强校验：cardId 必须存在于主卡池；每套展开恰好 20 张；单卡与同名上限均为 2；costCP 与主卡池一致。
 * - 预设类别配比（13干员/5战术/1设施/1支援）仅作预设元数据核对与展示，不作为全局构筑限制。
 */
export function loadOfficialPresetDecks(
  cardPool: readonly CardDefinition[],
  rawJson: unknown = officialPresetJson,
): OfficialPresetLoadResult {
  const issues: ValidationIssue[] = [];
  const decks: DeckDefinition[] = [];
  const metadataById = new Map<string, OfficialPresetDeckMetadata>();
  const cardById = new Map<string, CardDefinition>(cardPool.map((card) => [card.card_id, card]));

  if (!isRecord(rawJson) || !Array.isArray(rawJson.decks)) {
    issues.push({
      severity: 'error',
      code: 'INVALID_PRESET_JSON',
      message: '官方预设卡组 JSON 缺少 decks 数组。',
    });
    return { decks, metadataById, issues };
  }

  const seenDeckIds = new Set<string>();

  for (const rawDeck of rawJson.decks) {
    if (!isRecord(rawDeck) || typeof rawDeck.deckId !== 'string' || typeof rawDeck.name !== 'string') {
      issues.push({
        severity: 'error',
        code: 'INVALID_PRESET_DECK',
        message: '预设卡组条目缺少 deckId 或 name。',
      });
      continue;
    }

    const deckId = rawDeck.deckId;
    if (seenDeckIds.has(deckId)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_PRESET_DECK_ID',
        message: `预设卡组存在重复 deckId：${deckId}。`,
        recordId: deckId,
      });
    }
    seenDeckIds.add(deckId);

    if (!Array.isArray(rawDeck.cards)) {
      issues.push({
        severity: 'error',
        code: 'INVALID_PRESET_CARDS',
        message: `预设卡组 ${deckId} 缺少 cards 数组。`,
        recordId: deckId,
      });
      continue;
    }

    const mappedCards: { card_id: CardId; quantity: number }[] = [];
    const seenCardIds = new Set<string>();
    const nameCounts = new Map<string, number>();
    let totalCopies = 0;

    for (const rawEntry of rawDeck.cards) {
      if (!isRecord(rawEntry) || typeof rawEntry.cardId !== 'string' || typeof rawEntry.count !== 'number') {
        issues.push({
          severity: 'error',
          code: 'INVALID_PRESET_CARD_ENTRY',
          message: `预设卡组 ${deckId} 包含无效卡牌条目。`,
          recordId: deckId,
        });
        continue;
      }

      const cardId = rawEntry.cardId;
      const count = rawEntry.count;
      const def = cardById.get(cardId);
      if (!def) {
        issues.push({
          severity: 'error',
          code: 'UNKNOWN_PRESET_CARD',
          message: `预设卡组 ${deckId} 引用了主卡池不存在的卡牌 ${cardId}。`,
          recordId: deckId,
        });
        continue;
      }

      if (seenCardIds.has(cardId)) {
        issues.push({
          severity: 'error',
          code: 'DUPLICATE_PRESET_CARD_ROW',
          message: `预设卡组 ${deckId} 中卡牌 ${cardId} 重复出现多条记录。`,
          recordId: deckId,
        });
      }
      seenCardIds.add(cardId);

      if (!Number.isInteger(count) || count < 1 || count > 2) {
        issues.push({
          severity: 'error',
          code: 'COPY_LIMIT_EXCEEDED',
          message: `预设卡组 ${deckId} 中 ${cardId} 数量为 ${count}，必须为 1~2。`,
          recordId: deckId,
        });
      }

      if (typeof rawEntry.costCP === 'number' && rawEntry.costCP !== def.cost) {
        issues.push({
          severity: 'error',
          code: 'PRESET_COST_MISMATCH',
          message: `预设卡组 ${deckId} 中 ${cardId} (${def.card_name_zh}) 费用 ${rawEntry.costCP} 与主卡池 ${def.cost} 不一致。`,
          recordId: deckId,
        });
      }

      if (typeof rawEntry.name === 'string' && rawEntry.name !== def.card_name_zh) {
        issues.push({
          severity: 'error',
          code: 'PRESET_NAME_MISMATCH',
          message: `预设卡组 ${deckId} 中 ${cardId} 名称 ${rawEntry.name} 与主卡池 ${def.card_name_zh} 不一致。`,
          recordId: deckId,
        });
      }

      const nextNameCount = (nameCounts.get(def.card_name_zh) ?? 0) + count;
      nameCounts.set(def.card_name_zh, nextNameCount);
      if (nextNameCount > 2) {
        issues.push({
          severity: 'error',
          code: 'COPY_LIMIT_EXCEEDED',
          message: `预设卡组 ${deckId} 中同名卡「${def.card_name_zh}」超过 2 张上限。`,
          recordId: deckId,
        });
      }

      totalCopies += count;
      mappedCards.push({ card_id: cardId as CardId, quantity: count });
    }

    if (totalCopies !== 20 || rawDeck.deckSize !== 20) {
      issues.push({
        severity: 'error',
        code: 'INVALID_DECK_SIZE',
        message: `预设卡组 ${deckId} 展开共 ${totalCopies} 张（声明 ${String(rawDeck.deckSize)}），必须恰好 20 张。`,
        recordId: deckId,
      });
    }

    const deck: DeckDefinition = {
      deck_id: deckId,
      deck_name_zh: rawDeck.name,
      cards: mappedCards,
    };

    const rawComp = isRecord(rawDeck.composition) ? rawDeck.composition : {};
    const composition: OfficialPresetComposition = {
      operators: typeof rawComp.operators === 'number' ? rawComp.operators : 0,
      tactics: typeof rawComp.tactics === 'number' ? rawComp.tactics : 0,
      facilities: typeof rawComp.facilities === 'number' ? rawComp.facilities : 0,
      equipment: typeof rawComp.equipment === 'number' ? rawComp.equipment : 0,
      totalCopies: typeof rawComp.totalCopies === 'number' ? rawComp.totalCopies : totalCopies,
    };

    const computed = computeDeckCostProfile(deck, new Map(cardPool.map((c) => [c.card_id, c])));
    if (
      computed.typeCounts.operator !== composition.operators ||
      computed.typeCounts.tactic !== composition.tactics ||
      computed.typeCounts.facility !== composition.facilities ||
      computed.typeCounts.equipment !== composition.equipment
    ) {
      issues.push({
        severity: 'warning',
        code: 'PRESET_COMPOSITION_DRIFT',
        message: `预设卡组 ${deckId} 的展示类别计数与实际卡池类型计数存在差异。`,
        recordId: deckId,
      });
    }

    const duplicates = Array.isArray(rawDeck.duplicates)
      ? rawDeck.duplicates
          .filter(isRecord)
          .map((d) => ({
            cardId: String(d.cardId ?? ''),
            name: String(d.name ?? ''),
            count: Number(d.count ?? 2),
          }))
      : [];

    decks.push(deck);
    metadataById.set(deckId, {
      deckId,
      name: rawDeck.name,
      archetype: typeof rawDeck.archetype === 'string' ? rawDeck.archetype : '',
      difficulty: typeof rawDeck.difficulty === 'string' ? rawDeck.difficulty : '标准',
      recommendedMode: typeof rawDeck.recommendedMode === 'string' ? rawDeck.recommendedMode : '经典3路',
      description: typeof rawDeck.description === 'string' ? rawDeck.description : '',
      strengths: typeof rawDeck.strengths === 'string' ? rawDeck.strengths : '',
      weaknesses: typeof rawDeck.weaknesses === 'string' ? rawDeck.weaknesses : '',
      gamePlan: typeof rawDeck.gamePlan === 'string' ? rawDeck.gamePlan : '',
      composition,
      duplicates,
    });
  }

  return { decks, metadataById, issues };
}
