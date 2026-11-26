import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { Button, Panel, Badge, HealthBar, ResourceIndicator, TERMINAL_COLORS, RARITY_THEMES } from './index';
import { CardFrame } from '../cards/CardFrame';
import type { CardId, Cost, HpValue } from '../../game/types';

describe('Phase 1: Design Tokens 与基础 UI 终端组件', () => {
  it('Design Tokens: 集中管理终端色系与稀有度色值', () => {
    expect(TERMINAL_COLORS.bgBase).toBe('#171a1d');
    expect(TERMINAL_COLORS.accent).toBe('#e5a52b');
    expect(RARITY_THEMES[6].color).toBe('#f97316');
    expect(RARITY_THEMES[3].color).toBe('#94a3b8');
  });

  it('Badge: 正确渲染稀有度与职业徽章', () => {
    const htmlRarity = renderToString(<Badge variant="rarity" value={6} />);
    expect(htmlRarity).toContain('★★★★★★');

    const htmlClass = renderToString(<Badge variant="class" value="vanguard" />);
    expect(htmlClass).toContain('先锋');
  });

  it('HealthBar: 正确计算生命百分比与护盾显示', () => {
    const html = renderToString(<HealthBar currentHp={15} maxHp={30} shield={5} />).replace(/<!-- -->/g, '');
    expect(html).toContain('15');
    expect(html).toContain('30');
    expect(html).toContain('+5');
  });

  it('ResourceIndicator: 正确渲染 DP 与 SP 数值', () => {
    const htmlDp = renderToString(<ResourceIndicator type="dp" current={8} max={10} />);
    expect(htmlDp).toContain('DP');
    expect(htmlDp).toContain('8');
    expect(htmlDp).toContain('10');

    const htmlSp = renderToString(<ResourceIndicator type="sp" current={4} max={5} />);
    expect(htmlSp).toContain('SP');
    expect(htmlSp).toContain('4');
  });

  it('Button: 正确应用变体与禁用状态属性', () => {
    const html = renderToString(
      <Button variant="primary" disabled>
        确认行动
      </Button>,
    );
    expect(html).toContain('disabled');
    expect(html).toContain('确认行动');
  });

  it('Panel: 正确渲染战术标题与代号', () => {
    const html = renderToString(
      <Panel title="作战参数" codeName="SYS.GRID">
        <div>参数内容</div>
      </Panel>,
    );
    expect(html).toContain('作战参数');
    expect(html).toContain('SYS.GRID');
    expect(html).toContain('参数内容');
  });

  it('CardFrame: 正确渲染卡牌立绘、名称、费用与 SVG 几何框架', () => {
    const html = renderToString(
      <CardFrame
        cardId={'OP-VAN-001' as CardId}
        definition={{
          card_id: 'OP-VAN-001' as CardId,
          card_name_zh: '芬',
          card_type: 'operator',
          cost: 2 as Cost,
          rarity: 3,
          atk: 3,
          hp: 12 as HpValue,
          effect_trigger: 'none',
          effect_json: { trigger: 'none', actions: [] },
        }}
        variant="deck"
      />,
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('芬');
    expect(html).toContain('2'); // Cost
    expect(html).toContain('ATK 3');
    expect(html).toContain('<svg');
  });
});

describe('Phase 4: 卡牌视觉系统、只读图鉴与卡组编辑深化', () => {
  it('CardFrame: 通过 data-rarity 与 data-state 区分 3★/6★ 稀有度及不可出牌状态', async () => {
    const lowRarityHtml = renderToString(
      <CardFrame
        cardId={'OP-VAN-001' as CardId}
        definition={{
          card_id: 'OP-VAN-001' as CardId,
          card_name_zh: '芬',
          card_type: 'operator',
          cost: 2 as Cost,
          rarity: 3,
          atk: 3,
          hp: 12 as HpValue,
          effect_trigger: 'none',
          effect_json: { trigger: 'none', actions: [] },
        }}
        variant="hand"
        unplayable
      />,
    ).replace(/<!-- -->/g, '');
    expect(lowRarityHtml).toContain('data-rarity="3"');
    expect(lowRarityHtml).toContain('data-state="unplayable"');
    expect(lowRarityHtml).toContain('费用不足');
    expect(lowRarityHtml).not.toContain('card-frames');

    const highRarityHtml = renderToString(
      <CardFrame
        cardId={'OP-GUA-008' as CardId}
        definition={{
          card_id: 'OP-GUA-008' as CardId,
          card_name_zh: '银灰',
          card_type: 'operator',
          cost: 6 as Cost,
          rarity: 6,
          atk: 6,
          hp: 16 as HpValue,
          effect_trigger: 'none',
          effect_json: { trigger: 'none', actions: [] },
        }}
        variant="preview"
        selected
      />,
    ).replace(/<!-- -->/g, '');
    expect(highRarityHtml).toContain('data-rarity="6"');
    expect(highRarityHtml).toContain('data-state="selected"');
    expect(highRarityHtml).toContain('★★★★★★');
  });

  it('CardLibraryView: 全量只读展示 108 张官方卡牌且无伪库存锁', async () => {
    const { CardLibraryView } = await import('../../views/CardLibraryView');
    const html = renderToString(<CardLibraryView onBack={() => {}} />).replace(/<!-- -->/g, '');
    expect(html).toContain('罗德岛战术卡牌图鉴');
    expect(html).toContain('108');
    expect(html).not.toContain('未拥有');
    expect(html).not.toContain('招募获得');
  });

  it('DeckEditorView: 正确渲染高级搜索、费用曲线、职业分布与 20 张卡组校验（自由构筑）', async () => {
    const { DeckEditorView } = await import('../../views/DeckEditorView');
    const { setDeckMode } = await import('../../data/player-collection');
    // 默认构筑模式已改为收录模式（GACHA_PLAN_v0.3）；官方预设合法性在自由构筑下验证。
    setDeckMode('free');
    const html = renderToString(<DeckEditorView onBack={() => {}} />).replace(/<!-- -->/g, '');
    expect(html).toContain('平均费用');
    expect(html).toContain('费用分布');
    expect(html).toContain('20/20');
    expect(html).toContain('卡组合法');
    expect(html).toContain('自由构筑');
  });

  it('DeckEditorView: 收录模式下未持有干员拒收并显示持有徽标', async () => {
    const { DeckEditorView } = await import('../../views/DeckEditorView');
    const { setDeckMode } = await import('../../data/player-collection');
    setDeckMode('collection');
    const html = renderToString(<DeckEditorView onBack={() => {}} />).replace(/<!-- -->/g, '');
    expect(html).toContain('收录模式');
    // 默认载入的官方预设含未持有干员（新账户仅 3★×2），收录模式校验拒收
    expect(html).toContain('未持有「红豆」，收录模式下无法使用');
    // 已持有的 3★ 干员显示持有徽标
    expect(html).toContain('持有×2');
  });

  it('CardFrame & DeckEditorView: 卡组目录支持不点开详情直接减少携带数量(-)', async () => {
    const htmlWithRemove = renderToString(
      <CardFrame
        cardId={'OP-VAN-001' as CardId}
        definition={{
          card_id: 'OP-VAN-001' as CardId,
          card_name_zh: '芬',
          card_type: 'operator',
          cost: 2 as Cost,
          rarity: 3,
          atk: 3,
          hp: 12 as HpValue,
          effect_trigger: 'none',
          effect_json: { trigger: 'none', actions: [] },
        }}
        variant="deck"
        inDeckCount={1}
        maxInDeckCount={2}
        onActionClick={() => {}}
        onRemoveClick={() => {}}
      />,
    ).replace(/<!-- -->/g, '');
    expect(htmlWithRemove).toContain('aria-label="减少一张 芬"');
    expect(htmlWithRemove).toContain('1/2');

    const htmlZeroCount = renderToString(
      <CardFrame
        cardId={'OP-VAN-001' as CardId}
        definition={{
          card_id: 'OP-VAN-001' as CardId,
          card_name_zh: '芬',
          card_type: 'operator',
          cost: 2 as Cost,
          rarity: 3,
          atk: 3,
          hp: 12 as HpValue,
          effect_trigger: 'none',
          effect_json: { trigger: 'none', actions: [] },
        }}
        variant="deck"
        inDeckCount={0}
        maxInDeckCount={2}
        onActionClick={() => {}}
        onRemoveClick={() => {}}
      />,
    ).replace(/<!-- -->/g, '');
    expect(htmlZeroCount).not.toContain('aria-label="减少一张 芬"');

    const { DeckEditorView } = await import('../../views/DeckEditorView');
    const { setDeckMode } = await import('../../data/player-collection');
    setDeckMode('free');
    const editorHtml = renderToString(<DeckEditorView onBack={() => {}} />).replace(/<!-- -->/g, '');
    // 目录内已编入卡组的卡牌直接渲染 "-" 减量按钮，同时提供设施/支援独立筛选芯片
    expect(editorHtml).toContain('title="从卡组移出一张"');
    expect(editorHtml).toContain('>设施</button>');
    expect(editorHtml).toContain('>支援</button>');
  });

  it('卡牌类别区分: 设施(占格·HP) 与 支援(附着·限装1件) 在 CardFrame 与预览浮层中显著区分', async () => {
    const { DEMO_CARDS, PRESET_DECKS } = await import('../../client/gameData');
    const { createInitialGameState } = await import('../../game/engine');
    const { CardPreviewPopover } = await import('../battle/CardPreviewPopover');

    const facilityDef = DEMO_CARDS.find((c) => c.card_type === 'facility')!;
    const equipmentDef = DEMO_CARDS.find((c) => c.card_type === 'support')!;

    const facilityHtml = renderToString(
      <CardFrame cardId={facilityDef.card_id} definition={facilityDef} variant="deck" />,
    ).replace(/<!-- -->/g, '');
    expect(facilityHtml).toContain('data-support-subtype="facility"');
    expect(facilityHtml).toContain('🏗️ 设施');
    expect(facilityHtml).toContain('占格设施');
    expect(facilityHtml).toContain(`HP ${facilityDef.hp ?? 3}`);

    const equipmentHtml = renderToString(
      <CardFrame cardId={equipmentDef.card_id} definition={equipmentDef} variant="deck" />,
    ).replace(/<!-- -->/g, '');
    expect(equipmentHtml).toContain('data-support-subtype="equipment"');
    expect(equipmentHtml).toContain('🔧 支援');
    expect(equipmentHtml).toContain('支援装备·附着');
    expect(equipmentHtml).toContain('限装1件');

    const state = createInitialGameState({
      decks: { player_a: PRESET_DECKS[0], player_b: PRESET_DECKS[1] },
      cards: DEMO_CARDS,
      seed: 123,
    });
    const instA = Object.values(state.card_instances)[0];
    const previewState = {
      ...state,
      card_definitions: {
        ...state.card_definitions,
        [facilityDef.card_id]: facilityDef,
        [equipmentDef.card_id]: equipmentDef,
      },
      card_instances: {
        ...state.card_instances,
        'fac-inst': { ...instA, card_instance_id: 'fac-inst' as never, card_id: facilityDef.card_id },
        'eqp-inst': { ...instA, card_instance_id: 'eqp-inst' as never, card_id: equipmentDef.card_id },
      },
    };

    const facilityPopover = renderToString(
      <CardPreviewPopover
        state={previewState}
        hovered={{ instanceId: 'fac-inst' as never, rect: { left: 100, top: 200, right: 180, bottom: 300, width: 80, height: 100 } }}
      />,
    ).replace(/<!-- -->/g, '');
    expect(facilityPopover).toContain('🏗️ 设施');
    expect(facilityPopover).toContain('场地设施 · 占格部署');

    const equipmentPopover = renderToString(
      <CardPreviewPopover
        state={previewState}
        hovered={{ instanceId: 'eqp-inst' as never, rect: { left: 100, top: 200, right: 180, bottom: 300, width: 80, height: 100 } }}
      />,
    ).replace(/<!-- -->/g, '');
    expect(equipmentPopover).toContain('🔧 支援');
    expect(equipmentPopover).toContain('支援装备 · 附着强化');
  });

  it('RulesSupplementModal: 统一展示五大规则章节、设施/支援分离及词条图鉴（伏击与法伤并列呈现）', async () => {
    const { RulesSupplementModal } = await import('./RulesSupplementModal');
    const { StartView } = await import('../../views/StartView');

    const rulesHtml = renderToString(
      <RulesSupplementModal isOpen onClose={() => {}} />,
    ).replace(/<!-- -->/g, '');
    expect(rulesHtml).toContain('游戏规则补充说明');
    expect(rulesHtml).toContain('全部规则');
    expect(rulesHtml).toContain('回合与费用');
    expect(rulesHtml).toContain('01. 胜负判定、构筑规范与抽牌机制');
    expect(rulesHtml).toContain('02. 费用（CP）曲线与完整回合流程');
    expect(rulesHtml).toContain('03. 三路棋盘结构、站位规则与索敌顺位');
    expect(rulesHtml).toContain('04. 卡牌四大类别、主动撤离与位移交互');
    expect(rulesHtml).toContain('05. 统一伤害管线与词条图鉴');
    expect(rulesHtml).toContain('干员 · 战术 · 设施 · 支援');
    expect(rulesHtml).toContain('基础 CP：3 → 4 → 5 → 6 → 7 → 8');
    expect(rulesHtml).toContain('主动撤离不退还 CP（退款 0）');
    expect(rulesHtml).toContain('设施（6 张）· 独立卡牌类别与寿命限制');
    expect(rulesHtml).toContain('【法伤】');
    expect(rulesHtml).toContain('【伏击】');
    expect(rulesHtml).toContain('【突击】');
    expect(rulesHtml).toContain('标记指令');
    expect(rulesHtml).toContain('近战单位若被推击至后排，无法攻击敌方后排单位与敌方基本分');
    expect(rulesHtml).not.toContain('法术攻击');
    expect(rulesHtml).not.toContain('伏击客机制');
    expect(rulesHtml).not.toContain('集火指令');
    expect(rulesHtml).not.toContain('data-testid="ambusher-priority-popover"');

    const startHtml = renderToString(
      <StartView
        onHotseat={() => {}}
        onVsBot={() => {}}
        onOnline={() => {}}
        onDeckEditor={() => {}}
        onRecruitment={() => {}}
        onOpenRules={() => {}}
      />,
    ).replace(/<!-- -->/g, '');
    expect(startHtml).toContain('打开游戏规则补充说明');
    expect(startHtml).toContain('📖 规则说明');
  });
});
