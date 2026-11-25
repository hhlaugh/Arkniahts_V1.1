import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

export interface RulesSupplementModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

type RulesCategoryId =
  | 'all'
  | 'basics'
  | 'turn_flow'
  | 'board_targeting'
  | 'cards_facilities'
  | 'damage_keywords';

interface RulesCategoryTab {
  readonly id: RulesCategoryId;
  readonly label: string;
}

const RULES_CATEGORIES: readonly RulesCategoryTab[] = [
  { id: 'all', label: '全部规则' },
  { id: 'basics', label: '基础与构筑' },
  { id: 'turn_flow', label: '回合与费用' },
  { id: 'board_targeting', label: '棋盘与索敌' },
  { id: 'cards_facilities', label: '卡牌与设施' },
  { id: 'damage_keywords', label: '伤害与词条' },
];

const TURN_START_STEPS: readonly { readonly step: string; readonly title: string; readonly detail: string }[] = [
  { step: '01', title: '重置费用与状态标记', detail: 'CP 重置为本回合基础值；清除新入场限制并刷新每回合触发次数。' },
  { step: '02', title: '回合初抽牌', detail: '从牌库顶抽 1 张牌（满 10 张则溢入弃牌堆，空库触发递增疲劳伤害）。' },
  { step: '03', title: '补给先行结算', detail: '优先结算己方在场单位的【补给】回合初效果（先于维护执行）。' },
  { step: '04', title: '支付维护费用', detail: '按棋盘位置序支付【维护】CP；费用不足时单位视为被击倒并进弃牌堆（不退款）。' },
  { step: '05', title: '中毒与回合初到期', detail: '先按【中毒】层数造成无视【掩护】的伤害并清空到期层数，再清除到期状态。' },
  { step: '06', title: '其他回合初效果', detail: '结算前线掩体等其余回合开始触发效果或待玩家确认的抉择。' },
  { step: '07', title: '设施寿命自扣 1 HP', detail: '己方每座在场设施自身扣除 1 点 HP（归零摧毁进弃牌堆）。' },
];

const DAMAGE_PIPELINE_STEPS: readonly { readonly step: string; readonly title: string; readonly detail: string }[] = [
  { step: '1', title: '攻击力汇总', detail: '基础 ATK + 鼓舞永久成长 + 装备 + 临时增益 - 压制 / 寒冷惩罚（最低 0）。' },
  { step: '2', title: '【脆弱】增伤', detail: '仅限普通攻击：目标带有【脆弱】时本次伤害 +1，命中后立即消耗。' },
  { step: '3', title: '【掩护】减伤', detail: '仅非【法伤】、非【中毒】伤害生效：伤害 -1 并消耗掩护；【法伤】与【中毒】无视且不消耗掩护。' },
  { step: '4', title: '护盾优先吸收', detail: '由目标当前护盾先行抵消伤害，多余部分再进入生命扣减。' },
  { step: '5', title: '扣减生命与击倒', detail: '扣减当前 HP；归零先触发【不屈】免死检查（保留 1 HP），否则击倒并触发离场/击杀效果。' },
];

const KEYWORD_GLOSSARY_ENTRIES: readonly { readonly name: string; readonly kind: string; readonly effect: string }[] = [
  { name: '法伤', kind: '攻击 · 无视掩护', effect: '普通攻击造成法术伤害，无视且不消耗目标【掩护】（仍受护盾正常吸收）。' },
  { name: '伏击', kind: '特性 · 不拦截', effect: '不具备普通攻击拦截资格但可被攻击；未被【集火】时被攻击优先级等同基地基本分。' },
  { name: '嘲讽', kind: '索敌 · P1 强制', effect: '在攻击者合法射程内强制优先吸引敌方普通攻击（冻结期间失效）。' },
  { name: '集火', kind: '增益 · 攻击强化', effect: '本次普通攻击攻击力 +1（【集火】N 则 +N），多个来源取最高值。' },
  { name: '压制', kind: '减益 · 单次降攻', effect: '使目标下一次普通攻击攻击力 -1（最低 0），该次攻击结算后移除。' },
  { name: '脆弱', kind: '减益 · 易伤', effect: '使目标下一次受到的普通攻击伤害 +1，触发后消耗（不叠加）。' },
  { name: '掩护', kind: '防护 · 物伤减免', effect: '下一次受到的非【法伤】、非【中毒】伤害 -1 并消耗（至多持有 1 层）。' },
  { name: '守护 / 护盾', kind: '防护 · 可叠加', effect: '【守护】为目标提供护盾；护盾可叠加，在【掩护】之后、生命之前吸收伤害。' },
  { name: '眩晕', kind: '控制 · 保留阻挡', effect: '跳过下一次普通攻击并消耗，期间禁用自身技能与主动撤离，令浮空落地，保留拦截。' },
  { name: '冻结', kind: '强控 · 失去阻挡', effect: '无法普攻、禁用技能与撤离、令浮空落地，并失去拦截与嘲讽资格，持续至己方回合开始。' },
  { name: '寒冷', kind: '控制 · 叠寒转冻', effect: '目标下次普通攻击攻击力 -1；已处于【寒冷】时再次受寒则移除寒冷并转为【冻结】。' },
  { name: '沉默', kind: '控制 · 禁用技能', effect: '禁用自身技能与被动效果，保留正常普通攻击与拦截资格，持续至目标下回合结束。' },
  { name: '中毒 / 剧毒', kind: '状态 · 无视掩护', effect: '【中毒】按层在己方回合开始造成无视【掩护】伤害并清层；【剧毒】普攻造成实际生命损失后施加 1 层中毒。' },
  { name: '不屈', kind: '保命 · 免死留场', effect: '首次受到致命伤害时保留 1 点 HP 留在场上，不触发离场（关联召唤物保留）。' },
  { name: '禁疗', kind: '限制 · 拒收友疗', effect: '无法成为友方治疗效果的目标；不限制自身技能描述写出的自回效果。' },
  { name: '治疗 / 群疗', kind: '恢复 · 即时回血', effect: '立即恢复目标生命值（不超过最大生命，不恢复护盾）；【群疗】可同时治疗多名友军。' },
  { name: '补给 / 维护', kind: '资源 · CP 机制', effect: '【补给】立即获得 CP（受上限约束）；【维护】在回合开始补给后支付指定 CP，不足则被击倒进弃牌堆。' },
  { name: '鼓舞 / 反击', kind: '成长 / 反应', effect: '【鼓舞】永久提升攻击力至离场；【反击】受到直接伤害后对伤害来源造成指定伤害。' },
  { name: '召唤 / 回收', kind: '战术 · 占格单位', effect: '在空格生成占位召唤物；控制者可 0 CP 主动【回收】（视作摧毁，不退费）。' },
  { name: '推击 / 牵引', kind: '位移 · 阵位调整', effect: '同路前/后排强制位移；若目标位置已占则依卡牌结算碰撞伤害、压制或交换位置（设施免疫位移）。' },
  { name: '领主 / 越位 / 快速再部署', kind: '部署与索敌特性', effect: '【领主】前后排皆可部署且远程索敌；【越位】优先打后排；【快速再部署】再部署冷却更短。' },
  { name: '强攻 / 连击 / 贯穿 / 溅射 / 连锁', kind: '攻击模式', effect: '【强攻】打同路最多 2 名；【连击】分段打击同一目标；【贯穿】打整路；【溅射】波及同路副目标；【连锁】跳邻路敌人。' },
];

export function RulesSupplementModal({ isOpen, onClose }: RulesSupplementModalProps) {
  const [activeCategory, setActiveCategory] = useState<RulesCategoryId>('all');

  useEffect(() => {
    if (!isOpen) {
      setActiveCategory('all');
    }
  }, [isOpen]);

  const showSection = (category: Exclude<RulesCategoryId, 'all'>) =>
    activeCategory === 'all' || activeCategory === category;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="游戏规则补充说明"
      codeName="完整规则与机制手册"
      headerScene="rhodes-command"
      size="xl"
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-mono text-slate-400">
            涵盖胜负构筑、CP 曲线与回合序、三路索敌、卡牌四大类别与设施、统一伤害管线及全词条
          </span>
          <Button variant="primary" size="sm" cornerCut onClick={onClose}>
            我已知晓
          </Button>
        </div>
      }
    >
      <div className="relative space-y-4 text-xs">
        {/* 分类筛选控制条 */}
        <nav
          aria-label="规则章节筛选"
          className="flex flex-wrap items-center gap-1.5 p-1.5 bg-[#12171e] border border-[#2a3442]"
        >
          {RULES_CATEGORIES.map((cat) => {
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                aria-pressed={active}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3 py-1.5 text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                  active
                    ? 'bg-[#e5a52b] text-[#11151b] border-[#f2c464]'
                    : 'bg-[#171d26] text-slate-300 border-[#283240] hover:text-white hover:border-slate-500'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </nav>

        {/* 01. 核心胜负、构筑与起手规则 */}
        {showSection('basics') && (
          <section className="border border-[#2d3744] bg-[#151a21] p-3.5 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2 border-b border-[#252e3a]">
              <h4 className="font-bold text-slate-100 tracking-wide m-0">
                01. 胜负判定、构筑规范与抽牌机制
              </h4>
              <span className="text-[11px] font-mono text-amber-300 tabular-nums">
                基地 20 HP · 卡组 20 张 · 同名限 2 · 手牌上限 10
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[11px] text-slate-300 leading-relaxed">
              <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1">
                <div className="font-bold text-slate-100">胜负判定与自动技能</div>
                <p className="m-0">
                  双方基地初始拥有 <strong className="text-amber-300 tabular-nums">20 点</strong> 基本分；任一方降为{' '}
                  <span className="font-mono tabular-nums text-slate-100">0</span> 或以下即告负（同时归零则平局）。干员能力均在部署、攻击或特定节点自动结算，不设主动 SP 技能按钮。
                </p>
              </div>
              <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1">
                <div className="font-bold text-slate-100">构筑与起手换牌</div>
                <p className="m-0">
                  标准卡组固定 <strong className="text-slate-100 tabular-nums">20 张</strong>，同名卡至多携带{' '}
                  <strong className="text-slate-100 tabular-nums">2 张</strong>。开局各抽{' '}
                  <strong className="text-slate-100 tabular-nums">5 张</strong>起手牌，可选择{' '}
                  <span className="font-mono tabular-nums text-slate-100">0–5</span> 张洗回并等量重抽，随后随机决定先后手。
                </p>
              </div>
              <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1 md:col-span-2">
                <div className="font-bold text-slate-100">手牌上限与空库疲劳惩罚</div>
                <p className="m-0">
                  手牌上限为 <strong className="text-slate-100 tabular-nums">10 张</strong>，满手牌时继续抽牌将直接送入弃牌堆。牌库耗尽后每次强制抽牌改为承受递增<strong className="text-rose-300">疲劳伤害</strong>（第 1 次扣基地 1 点、第 2 次扣 2 点，依此类推）。
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 02. 费用（CP）曲线与完整回合流程 */}
        {showSection('turn_flow') && (
          <section className="border border-[#2d3744] bg-[#151a21] p-3.5 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2 border-b border-[#252e3a]">
              <h4 className="font-bold text-slate-100 tracking-wide m-0">
                02. 费用（CP）曲线与完整回合流程
              </h4>
              <span className="text-[11px] font-mono text-sky-300 tabular-nums">
                基础 CP：3 → 4 → 5 → 6 → 7 → 8 · 上限 min(10, 基础+2)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-300">
              <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1">
                <div className="font-bold text-amber-300">费用成长与硬上限</div>
                <p className="m-0">
                  己方第 1–6 回合基础 CP 依次为 <span className="font-mono tabular-nums text-slate-100">3 / 4 / 5 / 6 / 7 / 8</span>（第 6 回合起稳定为 8）。当回合通过【补给】最多可将 CP 充能至{' '}
                  <span className="font-mono tabular-nums text-slate-100">min(10, 基础 + 2)</span>。
                </p>
              </div>
              <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1">
                <div className="font-bold text-amber-300">回合末余费清零</div>
                <p className="m-0">
                  回合结束时所有未使用的剩余 CP 以及当回合未消耗的一次性部署减费标记均会清零，不会保留到下个己方回合。
                </p>
              </div>
              <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1">
                <div className="font-bold text-sky-300">四大阶段顺序</div>
                <p className="m-0">
                  每个回合严格按 <strong className="text-slate-100">回合开始 → 行动阶段 → 作战阶段 → 回合结束</strong> 推进，随后切换行动方。
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-slate-200">回合开始（Turn Start）7 步精确结算序</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
                {TURN_START_STEPS.map((item) => (
                  <div key={item.step} className="bg-[#11151b] border border-[#252e3a] p-2 space-y-0.5">
                    <div className="font-mono text-[10px] font-bold text-sky-300 tabular-nums">
                      {item.step}. {item.title}
                    </div>
                    <p className="m-0 text-[10px] text-slate-300 leading-snug">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] text-slate-300">
              <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1">
                <div className="font-bold text-slate-100">行动阶段（Action）</div>
                <p className="m-0">
                  可按任意顺序部署干员、使用战术卡、部署设施、附着支援装备、主动撤离干员、0 CP 回收召唤物或设定【集火】目标。退出行动阶段时，手牌冷却 <span className="font-mono tabular-nums">-1</span>。
                </p>
              </div>
              <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1">
                <div className="font-bold text-slate-100">作战阶段（Combat）</div>
                <p className="m-0">
                  先结算战斗开始效果，再按 <span className="font-mono">(L1→L3, 前→后, 格位)</span> 依次普攻或治疗。<strong className="text-amber-300">当回合刚部署单位与设施不参与常规普攻</strong>；最后结算战斗结束效果。
                </p>
              </div>
              <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1">
                <div className="font-bold text-slate-100">回合结束（Turn End）</div>
                <p className="m-0">
                  结算回合结束触发器，清除到期的【沉默】与回合末临时攻击修正，清空剩余 CP 并切换行动方。
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 03. 三路棋盘结构、站位规则与 P1–P4 索敌顺位 */}
        {showSection('board_targeting') && (
          <section className="border border-[#2d3744] bg-[#151a21] p-3.5 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2 border-b border-[#252e3a]">
              <h4 className="font-bold text-slate-100 tracking-wide m-0">
                03. 三路棋盘结构、站位规则与索敌顺位
              </h4>
              <span className="text-[11px] font-mono text-sky-300 tabular-nums">
                L1(2/1) · L2(3/2) · L3(2/1) · 支持 1–5 路自定义
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[11px] text-slate-300 leading-relaxed">
              <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1">
                <div className="font-bold text-slate-100">标准三路与部署站位限制</div>
                <p className="m-0">
                  标准棋盘按 <strong className="text-sky-300 tabular-nums">21 / 32 / 21</strong> 布局划分：左路（2 前排 / 1 后排）、中路（3 前排 / 2 后排）、右路（2 前排 / 1 后排）。近战仅限前排，远程与医疗仅限后排，【领主】与部分特殊干员可前/后排部署。
                </p>
              </div>
              <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1">
                <div className="font-bold text-slate-100">普通攻击范围与 P1–P4 索敌顺位</div>
                <p className="m-0">
                  普攻默认作用于同路敌方，遵循 <strong className="text-slate-100">P1【嘲讽】 › P2【集火】指令 › P3 常规干员 / 召唤物 / 占格设施 › P4 基地基本分</strong>（不具备拦截资格的【伏击】与【冻结】单位在未被集火时与基本分同级，仅有此类单位时敌方可直击基本分）。
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 04. 卡牌四大类别、主动撤离与场地设施 */}
        {showSection('cards_facilities') && (
          <div className="space-y-4">
            <section className="border border-[#2d3744] bg-[#151a21] p-3.5 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2 border-b border-[#252e3a]">
                <h4 className="font-bold text-slate-100 tracking-wide m-0">
                  04. 卡牌四大类别、主动撤离与位移交互
                </h4>
                <span className="text-[11px] font-mono text-emerald-300 tabular-nums">
                  干员 · 战术 · 设施 · 支援
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px] text-slate-300 leading-relaxed">
                <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1">
                  <div className="font-bold text-slate-100">干员（72 张）与主动撤离</div>
                  <p className="m-0">
                    新部署干员当回合不参与常规普攻（可立即结算部署效果）。仅己方半区且未受【眩晕/冻结】控制的干员可主动撤离回手牌，进入对应回合数的<strong className="text-slate-100">再部署冷却</strong>，身上支援装备进弃牌堆且关联召唤物一并摧毁。<strong className="text-amber-300">主动撤离不退还 CP（退款 0）</strong>。
                  </p>
                </div>
                <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1">
                  <div className="font-bold text-slate-100">战术（24 张）与位移规则</div>
                  <p className="m-0">
                    战术卡打出前校验合法目标，结算即时效果后进入弃牌堆。【推击】将前排移至同路后排，【牵引】将后排拉至同路前排；目标排满时按卡牌说明结算碰撞伤害、压制或位置交换。
                  </p>
                </div>
                <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1">
                  <div className="font-bold text-cyan-300">支援（6 张）· 干员装备</div>
                  <p className="m-0">
                    独立作为「支援」类别卡牌，使用时附着于一名己方单位（干员或召唤物，不可装给设施），每名单位至多携带 <strong className="text-slate-100 tabular-nums">1 件</strong>（装新顶旧），卡牌本体随即进入弃牌堆。
                  </p>
                </div>
                <div className="bg-[#11151b] border border-[#252e3a] p-2.5 space-y-1">
                  <div className="font-bold text-slate-100">召唤物与主动回收</div>
                  <p className="m-0">
                    召唤物占据空格并参与正常索敌（嘲讽召唤物优先承伤）。控制者可在行动阶段以{' '}
                    <strong className="text-slate-100 tabular-nums">0 CP</strong> 主动【回收】（视作摧毁，触发离场效果）；召唤来源离场时关联召唤物同步摧毁。
                  </p>
                </div>
              </div>
            </section>

            {/* 设施独立分类与寿命规则 */}
            <section className="border border-[#2d3744] bg-[#151a21] p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#252e3a]">
                <h4 className="font-bold text-amber-300 tracking-wide m-0">
                  设施（6 张）· 独立卡牌类别与寿命限制
                </h4>
                <span className="text-[10px] font-mono text-amber-300 tabular-nums">
                  同场限 2 座 · 初始 3 HP · 每回合 -1 HP
                </span>
              </div>

              <ul className="m-0 pl-4 space-y-1.5 text-[11px] text-slate-300">
                <li>
                  <strong className="text-slate-100">独立类别与部署：</strong>
                  设施与支援为两个独立卡牌种类；每方场上至多同时存在 <strong className="text-amber-300 tabular-nums">2 座</strong>设施，可部署在我方任意<strong className="text-amber-300">前排或后排</strong>空位，占据 1 个格位（P3 占格承伤但不主动攻击）。
                </li>
                <li>
                  <strong className="text-slate-100">免疫机制：</strong>
                  设施不受任何治疗、护盾、支援装备、攻防增益或减益状态影响，也免疫【推击】/【牵引】位移。敌方「设施破坏」可使其效果暂时失效，但不会暂停寿命扣血。
                </li>
                <li>
                  <strong className="text-amber-300">寿命损耗（每回合自扣 1 HP）：</strong>
                  每逢己方回合开始时，在场设施自动扣除自身 <strong className="text-amber-200">1 点 HP</strong>（战场显示「寿命 -1 HP」提示）；敌方攻击也可提前摧毁设施，HP 归零立即离场进弃牌堆。
                </li>
              </ul>
            </section>
          </div>
        )}

        {/* 05. 统一伤害管线与全词条图鉴 */}
        {showSection('damage_keywords') && (
          <section className="border border-[#2d3744] bg-[#151a21] p-3.5 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2 border-b border-[#252e3a]">
              <h4 className="font-bold text-slate-100 tracking-wide m-0">
                05. 统一伤害管线与词条图鉴
              </h4>
              <span className="text-[11px] font-mono text-rose-300 tabular-nums">
                脆弱(+1) → 掩护(-1，法伤/毒无视) → 护盾 → HP → 不屈
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-slate-200">统一伤害结算管线</div>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-1.5">
                {DAMAGE_PIPELINE_STEPS.map((item) => (
                  <div key={item.step} className="bg-[#11151b] border border-[#252e3a] p-2 space-y-0.5">
                    <div className="font-mono text-[10px] font-bold text-rose-300 tabular-nums">
                      STEP {item.step} · {item.title}
                    </div>
                    <p className="m-0 text-[10px] text-slate-300 leading-snug">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-slate-200">全机制词条速查</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {KEYWORD_GLOSSARY_ENTRIES.map((entry) => (
                  <div key={entry.name} className="bg-[#11151b] border border-[#252e3a] p-2 space-y-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-bold text-amber-300">【{entry.name}】</span>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0">{entry.kind}</span>
                    </div>
                    <p className="m-0 text-[10px] text-slate-300 leading-snug">{entry.effect}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
