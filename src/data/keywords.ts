import keywordsJson from './keywords-v1.1.json';
import type { CardDefinition, CardInstance } from '../game/types';
import type { UiCardDefinition } from '../client/gameData';

export interface KeywordGlossaryEntry {
  readonly keyword: string;
  readonly category: string;
  readonly brief: string;
}

interface RawKeywordJsonEntry {
  readonly keyword_id: string;
  readonly keyword_name_zh: string;
  readonly category: string;
  readonly card_short_text: string;
  readonly detail_rules_text: string;
}

/**
 * 玩家侧词条简要说明映射表（统一对齐 V1.1 规则，精简无赘余）
 */
const CURATED_KEYWORD_BRIEFS: Readonly<Record<string, { readonly category: string; readonly brief: string }>> = {
  补给: { category: '资源', brief: '立即抽 1 张牌（【补给】N 抽 N 张），满手牌时溢入弃牌堆，空库时承受疲劳伤害。' },
  掩护: { category: '防护', brief: '抵挡下一次受到的非【法伤】、非【中毒】伤害 -1，最多持有 1 层，触发后移除。' },
  集火: { category: '增益', brief: '仅本次攻击攻击力 +1（【集火】N 则 +N），多个来源取最高值。' },
  守护: { category: '防护', brief: '为目标提供 1 点护盾（【守护】N 提供 N 点），护盾可叠加并优先于生命吸收伤害。' },
  压制: { category: '减益', brief: '使目标下一次普通攻击的攻击力 -1（最低为 0），该次攻击结算后移除。' },
  治疗: { category: '恢复', brief: '立即恢复目标 1 点生命（【治疗】N 恢复 N 点），不超过最大生命且不恢复护盾。' },
  鼓舞: { category: '成长', brief: '使目标攻击力永久 +1（【鼓舞】N 则 +N），持续至单位离场。' },
  法伤: { category: '攻击', brief: '普通攻击造成法术伤害，无视且不消耗目标【掩护】（仍受护盾吸收）。' },
  强攻: { category: '攻击', brief: '普通攻击可同时攻击同路最多 2 名合法敌方单位。' },
  领主: { category: '特性', brief: '前排或后排皆可部署，且在任意阵位均具备远程索敌能力。' },
  连击: { category: '攻击', brief: '一次普通攻击分为 N 段连续打击同一目标，每段伤害=max(1, 攻击力-1)。' },
  越位: { category: '索敌', brief: '普通攻击可越过同路前排，优先锁定敌方后排目标；无后排时打前排。' },
  溅射: { category: '攻击', brief: '命中主目标后，对指定副目标额外造成溅射伤害。' },
  连锁: { category: '攻击', brief: '命中主目标后，伤害可跳跃至相邻路线的指定敌方单位。' },
  贯穿: { category: '攻击', brief: '普通攻击同时命中同路所有合法敌方单位，按格位依次结算。' },
  脆弱: { category: '减益', brief: '使目标下一次受到的普通攻击伤害 +1，触发后移除（不叠加）。' },
  中毒: { category: '状态', brief: '可叠加层数；目标己方回合开始时每层造成 1 点无视【掩护】伤害并清空到期层数。' },
  眩晕: { category: '控制', brief: '跳过下一次普通攻击机会，期间禁用自身技能与主动撤离，保留原有拦截资格。' },
  沉默: { category: '控制', brief: '无法触发自身技能与被动效果，但仍可正常进行普通攻击与拦截。' },
  召唤: { category: '战术', brief: '在合法空格生成占据格位的召唤物；控制者可 0 CP 主动回收（视为摧毁）。' },
  回收: { category: '战术', brief: '主动移除己方召唤物以腾出格位，视作摧毁并触发离场效果（不退费）。' },
  牵引: { category: '位移', brief: '将敌方后排单位拉至同路前排；若前排已占则按规则交换位置。' },
  推击: { category: '位移', brief: '将敌方前排单位推向同路后排；若后排已占则结算碰撞伤害或【压制】。' },
  群疗: { category: '治疗', brief: '一次治疗行动可同时恢复范围内多名受伤友方单位的生命值。' },
  伏击: { category: '特性', brief: '不具备拦截资格但可被攻击；未被【标记】时被攻击优先级等同基本分，仅有伏击单位时敌方可直接攻击基本分。' },
  维护: { category: '限制', brief: '己方回合开始恢复 CP 并结算补给抽牌后支付指定费用，不足时视为被击倒并进入弃牌堆。' },
  快速再部署: { category: '特性', brief: '撤离或退场后的再部署冷却回合更短，可更快重新部署上场。' },
  不屈: { category: '保命', brief: '首次受到致命伤害时保留 1 点生命留在场上，不触发离场。' },
  反击: { category: '反应', brief: '受伤后对直接伤害来源单位造成指定的反击伤害。' },
  嘲讽: { category: '索敌', brief: '在攻击者合法射程内，敌方普通攻击将强制优先锁定该单位（冻结时失效）。' },
  禁疗: { category: '减益', brief: '无法成为友方治疗效果的目标（不限制自身技能写出的自回效果）。' },
  剧毒: { category: '特性', brief: '普通攻击造成目标实际生命损失后，额外施加 1 层【中毒】。' },
  寒冷: { category: '控制', brief: '目标下次普通攻击攻击力 -1；已处于【寒冷】时再次受寒则转为【冻结】。' },
  冻结: { category: '强控', brief: '冻结期间无法普攻、禁用技能与撤离，并失去拦截与嘲讽资格，仍可受伤害。' },
  护盾: { category: '防护', brief: '可叠加的临时耐久值，在【掩护】之后、生命值之前优先吸收伤害。' },
  减速: { category: '减益', brief: '使目标下一次普通攻击攻击力 -1，该次攻击结算后移除。' },
  落地: { category: '状态', brief: '令浮空单位可被近战普通攻击选中。' },
  浮空: { category: '特性', brief: '仅可部署于后排；未被【落地】、眩晕或冻结前免疫近战普通攻击。' },
  突击: { category: '特性', brief: '无视部署当回合的攻击冷却，部署当回合即可直接参与交锋。' },
};

const STATUS_TO_KEYWORD: Readonly<Record<string, string>> = {
  suppressed: '压制',
  suppression: '压制',
  stun: '眩晕',
  silence: '沉默',
  poison: '中毒',
  poisoned: '中毒',
  cold: '寒冷',
  chilled: '寒冷',
  freeze: '冻结',
  vulnerable: '脆弱',
  cover: '掩护',
  taunt: '嘲讽',
  slow: '减速',
  grounded: '落地',
  assault: '突击',
};

const RAW_KEYWORD_MAP: ReadonlyMap<string, RawKeywordJsonEntry> = new Map(
  (keywordsJson as readonly RawKeywordJsonEntry[]).map((entry) => [entry.keyword_name_zh, entry]),
);

function lookupKeywordEntry(name: string): KeywordGlossaryEntry | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const curated = CURATED_KEYWORD_BRIEFS[trimmed];
  if (curated) {
    return {
      keyword: trimmed,
      category: curated.category,
      brief: curated.brief,
    };
  }

  const raw = RAW_KEYWORD_MAP.get(trimmed);
  if (raw) {
    const cleanText = raw.detail_rules_text.split('。')[0]?.trim() || raw.card_short_text;
    return {
      keyword: raw.keyword_name_zh,
      category: raw.category,
      brief: cleanText.endsWith('。') ? cleanText : `${cleanText}。`,
    };
  }

  return null;
}

/**
 * 提取卡牌定义与在场单位实例涉及的全部关键词，返回去重后的简要词条说明列表。
 */
export function extractCardKeywords(
  definition?: CardDefinition | UiCardDefinition | null,
  instance?: CardInstance | null,
): readonly KeywordGlossaryEntry[] {
  if (!definition) return [];

  const uiDef = definition as UiCardDefinition;
  const seen = new Set<string>();
  const results: KeywordGlossaryEntry[] = [];

  const pushKeyword = (token: string) => {
    const normalized = token.trim();
    if (!normalized || seen.has(normalized)) return;
    const entry = lookupKeywordEntry(normalized);
    if (!entry) return;
    seen.add(normalized);
    results.push(entry);
  };

  // 1. 优先采集当前在场单位身上的活跃状态与固有特性
  if (instance?.operator_combat) {
    if (instance.operator_combat.shield > 0) {
      pushKeyword('护盾');
    }
    for (const status of instance.operator_combat.statuses) {
      const mapped = STATUS_TO_KEYWORD[status.kind];
      if (mapped) pushKeyword(mapped);
    }
  }

  // 2. 卡牌数据中声明的 keyword_tokens
  if (definition.keyword_tokens) {
    for (const token of definition.keyword_tokens.split(/[;；、,，]/)) {
      pushKeyword(token);
    }
  }

  // 3. 规则文案与主动技能文案中出现的【词条】标记
  const textPool = [uiDef.rules_text_zh ?? '', uiDef.active_skill_text_zh ?? ''];
  for (const text of textPool) {
    const matches = text.matchAll(/【([^】]+)】/g);
    for (const m of matches) {
      if (m[1]) pushKeyword(m[1]);
    }
  }

  // 4. 引擎规则字段衍生词条（嘲讽 / 法伤 / 伏击 / 快速再部署 / 浮空）
  if (definition.taunt_scope && definition.taunt_scope !== 'none') {
    pushKeyword('嘲讽');
  }
  if (definition.attack_profile?.damage_type === 'arts' || definition.damage_type === 'arts') {
    pushKeyword('法伤');
  }
  if (definition.intercept_eligible === false && definition.card_type === 'operator') {
    pushKeyword('伏击');
  }
  if (definition.floating) {
    pushKeyword('浮空');
  }
  if (definition.operator_subclass_zh === '领主') {
    pushKeyword('领主');
  }
  if (definition.operator_subclass_zh === '强攻手') {
    pushKeyword('强攻');
  }
  if (definition.operator_subclass_zh === '处决者') {
    pushKeyword('快速再部署');
  }
  if (definition.skill_effects?.some((block) => block.effects.some((eff) => eff.op === 'pay_upkeep'))) {
    pushKeyword('维护');
  }

  return results;
}
