import { describe, expect, it } from 'vitest';
import { loadDemoData, summarizeValidation } from './load-card-data';

describe('loadDemoData', () => {
  it('loads all source cards and eight complete official preset decks without changing source records', () => {
    const result = loadDemoData();
    expect(result.cards).toHaveLength(108);
    expect(result.decks).toHaveLength(8);
    expect(result.decks.map((deck) => deck.cards.reduce((sum, item) => sum + item.quantity, 0))).toEqual([
      20, 20, 20, 20, 20, 20, 20, 20,
    ]);
    expect(result.issues.some((item) => item.code === 'UNKNOWN_EFFECT_ACTION' || item.code === 'UNKNOWN_EFFECT_TRIGGER')).toBe(false);
  });

  it('accepts corrected fields and keeps rapid withdrawal exemptions explicit', () => {
    const sampleRapid = {
      card_id: 'TEST-TAC-RAPID',
      card_name_zh: '快速撤离测试',
      card_type: 'tactic',
      rarity: 4,
      cost: 1,
      effect_trigger: 'on_play',
      effect_json: {
        trigger: 'on_play',
        actions: [
          {
            type: 'withdraw_operator',
            ignore_control_restriction: true,
            ignore_half_restriction: true,
            withdrawal_refund_policy: 'full_paid_cost',
          },
        ],
      },
    };
    const result = loadDemoData([sampleRapid], '');
    expect(result.issues).toEqual([]);
    expect(result.validCards).toHaveLength(1);
    const rapid = result.validCards[0];
    expect(rapid?.effect_json.actions[0]).toMatchObject({
      ignore_control_restriction: true,
      ignore_half_restriction: true,
      withdrawal_refund_policy: 'full_paid_cost',
    });
  });

  it('validates data whitelist values and deck references, size, and copy limits', () => {
    const badCards = [
      { card_id: 'BAD', card_name_zh: '坏卡', card_type: 'operator', rarity: 1, cost: 0,
        effect_trigger: 'execute_js', effect_json: { trigger: 'execute_js', actions: [{ type: 'run_code' }] } },
    ];
    const badCsv = [
      'deck_id,deck_name_zh,card_id,card_name_zh,quantity,total_deck_size,notes',
      'BAD-DECK,坏牌组,NO-SUCH-CARD,不存在,3,20,test',
    ].join('\n');
    const result = loadDemoData(badCards, badCsv);
    const codes = result.issues.map((item) => item.code);
    expect(codes).toContain('UNKNOWN_EFFECT_TRIGGER');
    expect(codes).toContain('UNKNOWN_EFFECT_ACTION');
    expect(codes).toContain('UNKNOWN_DECK_CARD');
    expect(codes).toContain('COPY_LIMIT_EXCEEDED');
    expect(codes).toContain('INVALID_DECK_SIZE');
  });

  it('rejects duplicate card IDs and confirms rapid withdrawal keeps both v0.7 exemptions explicit', () => {
    const duplicate = [...loadDemoData().cards];
    const firstCardId = (duplicate[0] as { card_id: string }).card_id;
    duplicate.push(duplicate[0]);
    const result = loadDemoData(duplicate);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_CARD_ID', recordId: firstCardId }));

    const sampleRapid = {
      card_id: 'TEST-TAC-RAPID',
      card_name_zh: '快速撤离测试',
      card_type: 'tactic',
      rarity: 4,
      cost: 1,
      effect_trigger: 'on_play',
      effect_json: {
        trigger: 'on_play',
        actions: [
          {
            type: 'withdraw_operator',
            ignore_control_restriction: true,
            ignore_half_restriction: true,
            withdrawal_refund_policy: 'full_paid_cost',
          },
        ],
      },
    };
    const rapidResult = loadDemoData([sampleRapid], '');
    const rapid = rapidResult.cards[0] as { effect_json: { actions: Array<Record<string, unknown>> } };
    expect(rapid.effect_json.actions[0]).toMatchObject({ ignore_control_restriction: true, ignore_half_restriction: true });
    expect(rapidResult.issues).not.toContainEqual(expect.objectContaining({ code: 'REFUND_POLICY_FIELD_MISMATCH', recordId: 'TEST-TAC-RAPID' }));
  });

  it('reports a clean card pool after aligning fields with the v0.7 data contract', () => {
    const result = loadDemoData();
    expect(summarizeValidation(result.issues)).toEqual({ errors: 0, warnings: 0 });
  });

  it('unifies keyword_tokens with 【词条】 in rules_text_zh across all 108 cards', async () => {
    const { extractCardKeywords } = await import('./keywords');
    const cards = loadDemoData().cards as Array<{
      card_id: string;
      card_name_zh: string;
      card_type: string;
      rules_text_zh?: string;
      keyword_tokens?: string;
      damage_type?: string;
      intercept_eligible?: boolean;
      floating?: boolean;
      taunt_scope?: string;
    }>;

    for (const card of cards) {
      const rules = card.rules_text_zh ?? '';
      const tokens = (card.keyword_tokens ?? '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);

      for (const token of tokens) {
        expect(rules, `${card.card_id} ${card.card_name_zh} 缺少【${token}】`).toContain(`【${token}】`);
      }

      if (card.card_type === 'operator') {
        if (card.damage_type === 'arts') {
          expect(rules, `${card.card_id} ${card.card_name_zh} 缺少【法伤】`).toContain('【法伤】');
        }
        if (card.intercept_eligible === false) {
          expect(rules, `${card.card_id} ${card.card_name_zh} 缺少【伏击】`).toContain('【伏击】');
        }
        if (card.floating === true) {
          expect(rules, `${card.card_id} ${card.card_name_zh} 缺少【浮空】`).toContain('【浮空】');
        }
        if (card.taunt_scope && card.taunt_scope !== 'none') {
          expect(rules, `${card.card_id} ${card.card_name_zh} 缺少【嘲讽】`).toContain('【嘲讽】');
        }
      }
    }

    const meyer = loadDemoData().validCards.find((c) => c.card_id === 'OP-SUP-006')!;
    const meyerKeywords = extractCardKeywords(meyer).map((k) => k.keyword);
    expect(meyerKeywords).toContain('法伤');
    expect(meyerKeywords).toContain('召唤');

    const manticore = loadDemoData().validCards.find((c) => c.card_id === 'OP-SPE-006')!;
    const manticoreKeywords = extractCardKeywords(manticore).map((k) => k.keyword);
    expect(manticoreKeywords).toContain('伏击');
    expect(manticoreKeywords).toContain('压制');
  });
});
