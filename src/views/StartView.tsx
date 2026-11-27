import React, { useRef, useState } from 'react';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { OrundumIcon } from '../components/ui/OrundumIcon';
import { RhodesWatermarkBackdrop } from '../components/ui/RhodesWatermark';
import { ScenicBackdrop, ScenicBannerLayer } from '../components/ui/ScenicBackdrop';
import { TacticalCornerBrackets, TacticalCornerSlashes } from '../components/ui/TacticalCornerBrackets';
import { CORNER_CUTS } from '../components/ui/tokens';
import tacticalCommandBackdrop from '../assets/images/tactical_command_backdrop_1795044168530.jpg';
import headhuntingBannerArt from '../assets/images/headhunting_banner_art_1795044169776.jpg';
import {
  createAccount,
  exportAccountsJson,
  getActiveAccountName,
  getActiveCollection,
  importAccountsJson,
  isTestAccount,
  isTestAccountName,
  listAccounts,
  setActiveAccount,
} from '../data/player-collection';
import type { AccountSummary } from '../data/player-collection';
import { DEMO_CARDS } from '../client/gameData';

interface StartViewProps {
  readonly isTestVersion?: boolean;
  readonly onHotseat?: () => void;
  readonly onVsBot: () => void;
  readonly onOnline: () => void;
  readonly onDeckEditor: () => void;
  readonly onLibrary?: () => void;
  readonly onRecruitment: () => void;
  readonly onOpenSettings?: () => void;
  readonly onOpenRules?: () => void;
  readonly onLogout?: () => void;
}

type CombatBriefingId = 'bot' | 'online' | 'hotseat';

interface CombatBriefingMeta {
  readonly code: string;
  readonly title: string;
  readonly summary: string;
  readonly details: string;
}

const COMBAT_BRIEFINGS: Record<CombatBriefingId, CombatBriefingMeta> = {
  bot: {
    code: 'PRTS-SIM 01',
    title: '单人战术演习（vs PRTS 模拟教官）',
    summary: '标准三路攻防推演 · 部署冷却与【突击】机制生效',
    details:
      '博士率领 20 张整备编制接入 PRTS 模拟对抗；教官系统依循部署费用、前后排站位射程、阻挡拦截与主动技能规则执行推演。',
  },
  online: {
    code: 'LINK-01 · P2P WEBRTC',
    title: '博士联机演习（P2P 对抗）',
    summary: '免服务器点对点实时对战 · 房间信标码直连',
    details:
      '创建或输入好友房间信标码建立 WebRTC 加密直连，双方各自使用己方编队完成起手调度并展开同步三路对决。',
  },
  hotseat: {
    code: 'TEST-01 · LOCAL',
    title: '本地热座（双人同屏）',
    summary: '测试版本专属 · 双人同屏交替推演沙盘',
    details:
      '测试终端授权开放：双人于同一屏幕轮流完成调度、部署与技能结算，用于快速验证卡组配合与三路对战规则。',
  },
};

export function StartView({
  isTestVersion,
  onHotseat,
  onVsBot,
  onOnline,
  onDeckEditor,
  onLibrary,
  onRecruitment,
  onOpenSettings,
  onOpenRules,
  onLogout,
}: StartViewProps) {
  const [accounts, setAccounts] = useState<AccountSummary[]>(() => listAccounts());
  const [activeName, setActiveNameState] = useState(() => getActiveAccountName());
  const [collection, setCollection] = useState(() => getActiveCollection());
  const [activeBriefing, setActiveBriefing] = useState<CombatBriefingId>('bot');
  const [newName, setNewName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeIsTest = isTestVersion ?? (isTestAccountName(activeName) || isTestAccount(activeName));
  const showHotseatMode = activeIsTest && Boolean(onHotseat);
  const visibleAccounts = accounts.filter((account) => !account.isTest && !isTestAccountName(account.name));
  const ownedSpeciesCount = DEMO_CARDS.filter((c) => (collection.owned[c.card_id] ?? 0) > 0).length;
  const customDeckCount = collection.customDecks.length;
  const collectionSteps = Math.max(1, Math.min(8, Math.round((ownedSpeciesCount / DEMO_CARDS.length) * 8)));
  const briefing = COMBAT_BRIEFINGS[activeBriefing === 'hotseat' && !showHotseatMode ? 'bot' : activeBriefing];

  const refreshAccounts = () => {
    setAccounts(listAccounts());
    setActiveNameState(getActiveAccountName());
    setCollection(getActiveCollection());
  };

  const handleSwitch = (name: string) => {
    setActiveAccount(name);
    setNotice(`已切换至博士档案「${name}」`);
    refreshAccounts();
  };

  const handleCreate = () => {
    const result = createAccount(newName);
    if (!result.ok) {
      setNotice(result.error ?? '创建失败');
      return;
    }
    setNotice(`博士档案「${newName.trim()}」已建档并激活（初始：3★×2 + 60000 合成玉 · 100 抽）`);
    setNewName('');
    refreshAccounts();
  };

  const handleExport = () => {
    try {
      const blob = new Blob([exportAccountsJson()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'arknight_accounts_backup.json';
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice('存档已导出（全部账户，可放 OneDrive 跨设备搬运）');
    } catch {
      setNotice('导出失败：浏览器拒绝了下载。');
    }
  };

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = importAccountsJson(String(reader.result));
      setNotice(result.ok ? `存档已导入（${result.accountCount} 个账户）` : result.error ?? '导入失败');
      refreshAccounts();
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  return (
    <div className="relative min-h-screen w-full bg-[#0e1318] text-[#e8e9e6] flex flex-col justify-between select-none overflow-x-hidden">
      {/* 全屏舰桥空间底图 + 罗德岛纹章水印 + 层次暗角光影 */}
      <ScenicBackdrop
        scene="rhodes-bridge"
        fixed
        fade="diagonal-tr"
        opacityClassName="opacity-[0.46]"
        baseColor="#0d1217"
        tint="radial-gradient(circle at 74% 26%, rgba(56,189,248,0.14) 0%, rgba(229,165,43,0.06) 46%, transparent 74%)"
      />
      <RhodesWatermarkBackdrop />
      <div
        aria-hidden="true"
        className="prts-ambient-glow pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 68% 48% at 58% 28%, rgba(56,189,248,0.07) 0%, rgba(229,165,43,0.05) 45%, transparent 78%)',
        }}
      />
      <div
        aria-hidden="true"
        className="prts-grid pointer-events-none fixed inset-0 opacity-[0.04] z-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(148,163,184,0.18) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(148,163,184,0.18) 1px, transparent 1px)
          `,
          backgroundSize: '32px 32px',
        }}
      />

      {/* 顶部战术终端系统栏 */}
      <header className="relative z-20 w-full bg-[#0f151c]/90 backdrop-blur-md">
        <div className="w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
          {/* 左侧：PRTS Logo 与系统标识 */}
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="relative w-10 h-10 shrink-0 border border-sky-400/45 bg-[#090d12] p-1 flex items-center justify-center shadow-[0_0_16px_rgba(56,189,248,0.12)]"
              style={{ clipPath: CORNER_CUTS.sm }}
            >
              <img
                src="./assets/arknights/logos/prts_badge.svg"
                alt="PRTS Logo"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
              />
              <span
                aria-hidden="true"
                className="prts-status-breath absolute top-1 right-1 w-1.5 h-1.5 bg-[#e5a52b]"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-sm sm:text-base font-black tracking-[0.14em] text-slate-100 m-0 leading-tight whitespace-nowrap">
                  {activeIsTest ? 'PRTS · 战术演习测试终端' : 'PRTS · 罗德岛战术演习终端'}
                </h1>
                <span className="text-[11px] font-mono text-[#e5a52b] tabular-nums whitespace-nowrap">
                  v1.1
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] sm:text-[11px] font-mono text-slate-400 tracking-[0.12em] truncate">
                <span>RHODES ISLAND TACTICAL EXERCISE TERMINAL</span>
                <span aria-hidden="true" className="hidden sm:inline text-slate-600">·</span>
                <span className="hidden sm:inline text-sky-300/80">
                  {activeIsTest ? 'TEST SANDBOX' : 'COMMAND LINK'}
                </span>
              </div>
            </div>
          </div>

          {/* 右侧：真实档案数据与规则/设置/登出入口 */}
          <div className="flex flex-wrap items-center justify-between lg:justify-end gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono tabular-nums text-slate-300">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="text-slate-400">博士</span>
                <strong className="text-white font-bold">{activeName}</strong>
              </span>
              <span aria-hidden="true" className="text-slate-600">|</span>
              <span className="inline-flex items-center gap-1.5 text-amber-300 font-bold whitespace-nowrap">
                <OrundumIcon size="sm" />
                <span>{collection.currency.originite}</span>
              </span>
              <span aria-hidden="true" className="text-slate-600">|</span>
              <span className="text-slate-300 whitespace-nowrap">
                收录 <strong className="text-sky-300 font-semibold">{ownedSpeciesCount}</strong>/{DEMO_CARDS.length}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onOpenRules ? (
                <Button
                  variant="outline"
                  size="sm"
                  cornerCut
                  onClick={onOpenRules}
                  aria-label="打开游戏规则补充说明"
                  className="min-h-[36px] sm:min-h-[32px] text-[11px] font-mono px-3 whitespace-nowrap shrink-0"
                >
                  📖 规则说明
                </Button>
              ) : (
                <Badge variant="rarity" value={6}>v1.1 规则</Badge>
              )}
              {onOpenSettings && (
                <Button
                  variant="secondary"
                  size="sm"
                  cornerCut
                  onClick={onOpenSettings}
                  aria-label="打开系统设置"
                  className="min-h-[36px] sm:min-h-[32px] text-[11px] font-mono px-3 whitespace-nowrap shrink-0"
                >
                  ⚙ 设置
                </Button>
              )}
              {onLogout && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onLogout}
                  aria-label="退出登录"
                  className="min-h-[36px] sm:min-h-[32px] text-[11px] font-mono px-2.5 text-slate-300 border border-[#3a4552] hover:border-rose-400 hover:text-rose-200 whitespace-nowrap shrink-0"
                >
                  退出登录
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className="prts-grad-divider w-full" aria-hidden="true" />
      </header>

      {/* 主指挥中心工作区 */}
      <main className="relative z-10 flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-5 flex flex-col justify-center gap-4">
        {/* 核心全息作战窗口：左（视觉主景 + 实时作战简报） / 右（人机 + 联机 [+ 热座] 统一作战模式栈） */}
        <section
          aria-label="罗德岛战术作战中枢"
          className="holo-panel prts-panel-enter prts-grad-frame prts-grad-cyan relative bg-[#0c131a]/88 backdrop-blur-md overflow-hidden"
        >
          <TacticalCornerBrackets tone="cyan" size="lg" />
          <div
            aria-hidden="true"
            className="prts-scanlines pointer-events-none absolute inset-0 opacity-[0.06] z-0"
            style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.12) 2px, rgba(255,255,255,0.12) 4px)',
            }}
          />

          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 items-stretch">
            {/* 左侧主景展示 + 模式简报（对应参考图的 WEAPON + DESCRIPTION 纵列结构） */}
            <div className="lg:col-span-7 flex flex-col justify-between">
              {/* 左上：作战终端主视觉区 */}
              <div className="relative flex-1 p-5 sm:p-7 flex flex-col justify-between gap-5 overflow-hidden min-h-[250px] sm:min-h-[280px]">
                <ScenicBannerLayer
                  scene="rhodes-exterior"
                  fade="right"
                  opacityClassName="opacity-55"
                  tint="radial-gradient(circle at 72% 42%, rgba(56,189,248,0.18) 0%, rgba(229,165,43,0.08) 46%, transparent 72%)"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-0"
                  style={{
                    background:
                      'linear-gradient(96deg, rgba(10,16,23,0.94) 0%, rgba(12,19,27,0.8) 52%, rgba(12,19,27,0.45) 100%)',
                  }}
                />
                <img
                  src="./assets/arknights/logos/rhodes_island_dark.png"
                  alt=""
                  aria-hidden="true"
                  referrerPolicy="no-referrer"
                  className="pointer-events-none select-none hidden sm:block absolute right-8 top-1/2 -translate-y-1/2 w-52 h-52 object-contain opacity-[0.15] z-0"
                />

                {/* 顶部子区标题行 */}
                <div className="relative z-10 space-y-3">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-sky-400/20">
                    <div className="flex items-center gap-2 text-[11px] font-mono tracking-[0.16em] text-sky-300">
                      <span className="prts-status-breath inline-block w-1.5 h-1.5 bg-[#e5a52b]" aria-hidden="true" />
                      <span>OPERATIONS · 作战中枢</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-300 tabular-nums">72 OPERATORS</span>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <h2 className="text-3xl sm:text-5xl font-black tracking-[0.06em] text-white m-0 leading-[1.1] [text-wrap:balance]">
                      舟塔自走牌
                    </h2>
                    <p className="text-xs sm:text-sm font-mono tracking-[0.08em] text-sky-300/95 m-0">
                      RHODES ISLAND PRTS · 三路战术攻防推演终端
                    </p>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-200/90 leading-relaxed max-w-xl m-0">
                    {activeIsTest
                      ? '测试终端权限已验证。当前开放全干员图鉴调阅、单人模拟演习、联机对抗及本地双人热座沙盘。'
                      : '博士，欢迎接入罗德岛舰桥战术演习终端。PRTS 拟真沙盘已同步 72 位干员作战档案与三路防线攻防推演协议。'}
                  </p>
                </div>

                {/* 左上底部 4 格真实战备指标卡（呼应参考图底部 4 项条形参数区） */}
                <div className="relative z-10 grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">
                  <div className="prts-grad-frame prts-grad-slate bg-[#0b1117]/88 px-3 py-2">
                    <div className="text-[10px] font-mono text-slate-400">干员收录</div>
                    <div className="text-sm font-mono font-bold text-sky-300 tabular-nums mt-0.5">
                      {ownedSpeciesCount}/{DEMO_CARDS.length}
                    </div>
                    <div className="mt-1.5 flex items-center gap-0.5" aria-hidden="true">
                      {Array.from({ length: 8 }).map((_, idx) => (
                        <span
                          key={idx}
                          className={`h-1 flex-1 ${idx < collectionSteps ? 'bg-sky-400' : 'bg-slate-700/70'}`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="prts-grad-frame prts-grad-slate bg-[#0b1117]/88 px-3 py-2">
                    <div className="text-[10px] font-mono text-slate-400">合成玉储备</div>
                    <div className="mt-0.5 flex items-center gap-1 text-sm font-mono font-bold text-amber-300 tabular-nums">
                      <OrundumIcon size="xs" />
                      <span>{collection.currency.originite}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-0.5" aria-hidden="true">
                      {Array.from({ length: 8 }).map((_, idx) => (
                        <span
                          key={idx}
                          className={`h-1 flex-1 ${idx < (collection.currency.originite >= 600 ? 6 : 2) ? 'bg-[#e5a52b]' : 'bg-slate-700/70'}`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="prts-grad-frame prts-grad-slate bg-[#0b1117]/88 px-3 py-2">
                    <div className="text-[10px] font-mono text-slate-400">自建编制</div>
                    <div className="text-sm font-mono font-bold text-slate-100 tabular-nums mt-0.5">
                      {customDeckCount} 套
                    </div>
                    <div className="mt-1.5 flex items-center gap-0.5" aria-hidden="true">
                      {Array.from({ length: 8 }).map((_, idx) => (
                        <span
                          key={idx}
                          className={`h-1 flex-1 ${idx < Math.min(8, Math.max(1, customDeckCount)) ? 'bg-emerald-400' : 'bg-slate-700/70'}`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="prts-grad-frame prts-grad-slate bg-[#0b1117]/88 px-3 py-2">
                    <div className="text-[10px] font-mono text-slate-400">出击规格</div>
                    <div className="text-sm font-mono font-bold text-slate-100 tabular-nums mt-0.5">
                      20 张 / 三路
                    </div>
                    <div className="mt-1.5 flex items-center gap-0.5" aria-hidden="true">
                      {Array.from({ length: 8 }).map((_, idx) => (
                        <span key={idx} className="h-1 flex-1 bg-sky-300/80" />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* 亮 → 淡 → 亮 水平分割线 */}
              <div className="prts-grad-divider mx-4 sm:mx-6" aria-hidden="true" />

              {/* 左下：当前选定/悬停作战模式说明（对应参考图 DESCRIPTION 区） */}
              <div className="p-5 sm:px-7 sm:py-5 bg-[#090f15]/78 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-sky-400/15">
                  <span className="text-[11px] font-mono tracking-[0.16em] text-sky-300">
                    BRIEFING · 模式简报
                  </span>
                  <span className="text-[11px] font-mono text-[#e5a52b] tabular-nums">
                    {briefing.code}
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm sm:text-base font-bold text-white m-0">
                    {briefing.title}
                  </h3>
                  <span className="text-[11px] font-mono text-slate-400">
                    {briefing.summary}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed m-0">
                  {briefing.details}
                </p>
              </div>
            </div>

            {/* 右侧：作战模式子项目栈（单人战术演习 + 博士联机演习 + [本地热座]，对应参考图 CHALLENGES 栏） */}
            <div className="lg:col-span-5 flex flex-col border-t lg:border-t-0 lg:border-l border-sky-400/20 bg-[#0a1017]/78 p-4 sm:p-6 gap-3.5">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-sky-400/20">
                <span className="text-[11px] font-mono tracking-[0.16em] text-sky-300">
                  COMBAT MODES · 作战模式
                </span>
                <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                  {showHotseatMode ? '3 项可用协议' : '2 项可用协议'}
                </span>
              </div>

              <div className="flex-1 flex flex-col justify-center gap-3.5">
                {/* 作战子项目 01：单人战术演习（默认重点推荐高亮） */}
                <div
                  onMouseEnter={() => setActiveBriefing('bot')}
                  onFocus={() => setActiveBriefing('bot')}
                  onClick={onVsBot}
                  className="holo-frame prts-module-tile prts-grad-frame prts-grad-amber prts-grad-interactive group relative p-4 sm:p-5 bg-gradient-to-br from-[#231b0e]/92 via-[#15181d]/92 to-[#0e1319]/95 cursor-pointer overflow-hidden"
                  style={{ clipPath: CORNER_CUTS.md }}
                >
                  <TacticalCornerBrackets tone="amber" size="sm" />
                  <ScenicBannerLayer
                    scene="rhodes-command"
                    fade="right"
                    opacityClassName="opacity-34 group-hover:opacity-48 transition-opacity"
                    tint="radial-gradient(circle at 78% 45%, rgba(229,165,43,0.18) 0%, transparent 66%)"
                  />

                  <div className="relative z-10 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <TacticalCornerSlashes tone="amber" />
                      <span className="text-[10px] font-mono font-semibold text-[#e5a52b] tracking-wider">
                        演习项目 01 · PRTS SIM
                      </span>
                    </div>

                    <div className="space-y-1">
                      <h3 className="text-sm sm:text-base font-black text-white group-hover:text-[#fcd34d] transition-colors m-0">
                        单人战术演习（vs PRTS 模拟教官）
                      </h3>
                      <p className="text-xs text-slate-300 leading-relaxed m-0">
                        博士率领己方整备编队接入 PRTS 模拟对抗，教官严格依循部署、阻挡与站位规则推演。
                      </p>
                    </div>

                    <div className="pt-1 flex items-center justify-between gap-3">
                      <span className="text-[11px] font-mono text-amber-200/85">主推模式 · 即时开战</span>
                      <Button
                        variant="primary"
                        size="md"
                        cornerCut
                        onClick={(e) => {
                          e.stopPropagation();
                          onVsBot();
                        }}
                        className="min-h-[40px] px-5 font-black tracking-[0.1em] whitespace-nowrap"
                      >
                        开始演习 · 进入作战
                      </Button>
                    </div>
                  </div>
                </div>

                {/* 作战子项目 02：博士联机演习（P2P 对抗） */}
                <div
                  onMouseEnter={() => setActiveBriefing('online')}
                  onFocus={() => setActiveBriefing('online')}
                  onClick={onOnline}
                  className="holo-frame prts-module-tile prts-grad-frame prts-grad-rose prts-grad-interactive group relative p-4 sm:p-5 bg-gradient-to-br from-[#1b1218]/90 via-[#13171e]/92 to-[#0d1218]/95 cursor-pointer overflow-hidden"
                  style={{ clipPath: CORNER_CUTS.md }}
                >
                  <TacticalCornerBrackets tone="rose" size="sm" />
                  <ScenicBannerLayer
                    scene="lungmen-night"
                    fade="right"
                    opacityClassName="opacity-30 group-hover:opacity-44 transition-opacity"
                    tint="radial-gradient(circle at 78% 45%, rgba(244,63,94,0.16) 0%, transparent 66%)"
                  />

                  <div className="relative z-10 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <TacticalCornerSlashes tone="rose" />
                      <span className="text-[10px] font-mono font-semibold text-rose-300 tracking-wider">
                        LINK-01 · P2P WEBRTC · {showHotseatMode ? '演习项目 03' : '演习项目 02'}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <h3 className="text-sm sm:text-base font-black text-slate-100 group-hover:text-rose-200 transition-colors m-0">
                        博士联机演习（P2P 对抗）
                      </h3>
                      <p className="text-xs text-slate-300 leading-relaxed m-0">
                        与另一位博士建立点对点战术信标连线，生成演习房间码即可实时展开跨终端对抗。
                      </p>
                    </div>

                    <div className="pt-1 flex items-center justify-between gap-3">
                      <span className="text-[11px] font-mono text-rose-200/80">免服直连 · 房间码匹配</span>
                      <Button
                        variant="outline"
                        size="md"
                        cornerCut
                        onClick={(e) => {
                          e.stopPropagation();
                          onOnline();
                        }}
                        className="min-h-[40px] px-4 border-rose-400/60 text-rose-200 hover:bg-rose-500/15 hover:border-rose-300 whitespace-nowrap"
                      >
                        进入联机大厅
                      </Button>
                    </div>
                  </div>
                </div>

                {/* 作战子项目 03：本地热座（仅测试版本逻辑允许时显示） */}
                {showHotseatMode && (
                  <div
                    onMouseEnter={() => setActiveBriefing('hotseat')}
                    onFocus={() => setActiveBriefing('hotseat')}
                    onClick={onHotseat}
                    className="holo-frame prts-module-tile prts-grad-frame prts-grad-cyan prts-grad-interactive group relative p-4 bg-gradient-to-br from-[#0e1b24]/90 via-[#121820]/92 to-[#0d1218]/95 cursor-pointer overflow-hidden"
                    style={{ clipPath: CORNER_CUTS.md }}
                  >
                    <TacticalCornerBrackets tone="cyan" size="sm" />
                    <ScenicBannerLayer
                      scene="snowfield"
                      fade="right"
                      opacityClassName="opacity-28 group-hover:opacity-42 transition-opacity"
                      tint="radial-gradient(circle at 78% 45%, rgba(56,189,248,0.16) 0%, transparent 66%)"
                    />

                    <div className="relative z-10 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <TacticalCornerSlashes tone="cyan" />
                        <span className="text-[10px] font-mono font-semibold text-sky-300 tracking-wider">
                          TEST-01 · LOCAL
                        </span>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                        <div className="space-y-0.5">
                          <h3 className="text-sm font-bold text-slate-100 group-hover:text-sky-200 transition-colors m-0">
                            本地热座（双人同屏）
                          </h3>
                          <p className="text-[11px] text-slate-300 leading-snug m-0">
                            测试版本专属：双人同屏交替推演沙盘。
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          cornerCut
                          onClick={(e) => {
                            e.stopPropagation();
                            onHotseat?.();
                          }}
                          className="min-h-[36px] px-4 border-sky-400/50 hover:border-sky-300 whitespace-nowrap shrink-0"
                        >
                          同屏对战
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 下层战备区：左侧三大整备模块（卡组构筑 / 干员寻访 / 干员图鉴） + 右侧博士档案备份坞 */}
        <section
          aria-label="战备整备模块与博士档案管理"
          className="prts-panel-enter prts-enter-delay-1 grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch"
        >
          {/* 整备模块区 */}
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-12 gap-3.5">
            {/* 卡组构筑器 */}
            <button
              type="button"
              onClick={onDeckEditor}
              className="holo-frame prts-module-tile prts-grad-frame prts-grad-cyan prts-grad-interactive group relative sm:col-span-5 min-h-[138px] text-left flex flex-col justify-between p-4 bg-[#111820]/92 hover:bg-[#151e28] cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              style={{ clipPath: CORNER_CUTS.md }}
            >
              <TacticalCornerBrackets tone="cyan" size="sm" />
              <img
                src={tacticalCommandBackdrop}
                alt=""
                aria-hidden="true"
                referrerPolicy="no-referrer"
                className="pointer-events-none select-none absolute inset-0 w-full h-full object-cover opacity-[0.26] group-hover:opacity-[0.38] transition-opacity"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(100deg, rgba(13,18,24,0.95) 0%, rgba(16,22,30,0.8) 58%, rgba(13,18,24,0.62) 100%)',
                }}
              />
              <div className="relative z-10 space-y-1">
                <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                  <span className="text-sky-300 font-semibold tracking-wider">MOD-02 · DECK BUILDER</span>
                  <span className="text-slate-300 tabular-nums">{customDeckCount} 套自建</span>
                </div>
                <h3 className="text-base font-extrabold text-white group-hover:text-sky-300 transition-colors m-0">
                  卡组构筑器
                </h3>
                <p className="text-xs text-slate-300 leading-snug m-0">
                  整备 20 张编队，校验费用曲线与职业协同。
                </p>
              </div>
              <div className="relative z-10 mt-3 flex items-center justify-between text-[11px] font-mono">
                <span className="text-slate-400">收录 / 自由双模式</span>
                <span className="text-sky-300 font-bold tracking-wider group-hover:translate-x-0.5 transition-transform">
                  进入整备 →
                </span>
              </div>
            </button>

            {/* 干员寻访 */}
            <button
              type="button"
              onClick={onRecruitment}
              className={`holo-frame prts-module-tile prts-grad-frame prts-grad-amber prts-grad-interactive group relative ${onLibrary ? 'sm:col-span-4' : 'sm:col-span-7'} min-h-[138px] text-left flex flex-col justify-between p-4 bg-[#12171e]/92 hover:bg-[#191f27] cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5a52b]`}
              style={{ clipPath: CORNER_CUTS.md }}
            >
              <TacticalCornerBrackets tone="amber" size="sm" />
              <img
                src={headhuntingBannerArt}
                alt=""
                aria-hidden="true"
                referrerPolicy="no-referrer"
                className="pointer-events-none select-none absolute inset-0 w-full h-full object-cover opacity-[0.28] group-hover:opacity-[0.42] transition-opacity"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(100deg, rgba(14,17,22,0.95) 0%, rgba(18,22,28,0.78) 58%, rgba(14,17,22,0.58) 100%)',
                }}
              />
              <div className="relative z-10 space-y-1">
                <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                  <span className="text-[#e5a52b] font-semibold tracking-wider">MOD-03 · HEADHUNTING</span>
                  <span className="inline-flex items-center gap-1 text-amber-300 font-bold tabular-nums">
                    <OrundumIcon size="xs" />
                    <span>{collection.currency.originite}</span>
                  </span>
                </div>
                <h3 className="text-base font-extrabold text-white group-hover:text-[#e5a52b] transition-colors m-0">
                  干员寻访
                </h3>
                <p className="text-xs text-slate-300 leading-snug m-0">
                  消耗合成玉执行单抽或十连寻访。
                </p>
              </div>
              <div className="relative z-10 mt-3 flex items-center justify-between text-[11px] font-mono">
                <span className="text-slate-400">6★ 递增保底</span>
                <span className="text-[#e5a52b] font-bold tracking-wider group-hover:translate-x-0.5 transition-transform">
                  前往寻访 →
                </span>
              </div>
            </button>

            {/* 罗德岛干员图鉴 */}
            {onLibrary && (
              <button
                type="button"
                onClick={onLibrary}
                className="holo-frame prts-module-tile prts-grad-frame prts-grad-slate prts-grad-interactive group relative sm:col-span-3 min-h-[138px] text-left flex flex-col justify-between p-4 bg-[#11171e]/92 hover:bg-[#17202a] cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                style={{ clipPath: CORNER_CUTS.md }}
              >
                <TacticalCornerBrackets tone="slate" size="sm" />
                <ScenicBannerLayer
                  scene="terra-landscape"
                  fade="right"
                  opacityClassName="opacity-28 group-hover:opacity-42 transition-opacity"
                  tint="radial-gradient(circle at 80% 35%, rgba(148,163,184,0.12) 0%, transparent 64%)"
                />
                <div className="relative z-10 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                    <span className="text-slate-300 font-semibold tracking-wider">MOD-04 · ARCHIVE</span>
                    <span className="text-slate-300 tabular-nums">{ownedSpeciesCount}/{DEMO_CARDS.length}</span>
                  </div>
                  <h3 className="text-base font-extrabold text-white group-hover:text-slate-100 transition-colors m-0">
                    罗德岛干员图鉴
                  </h3>
                  <p className="text-xs text-slate-300 leading-snug m-0">
                    检索全池干员技能与词条。
                  </p>
                </div>
                <div className="relative z-10 mt-3 flex items-center justify-between text-[11px] font-mono">
                  <span className="text-slate-400">全卡池只读</span>
                  <span className="text-slate-200 font-bold tracking-wider group-hover:translate-x-0.5 transition-transform">
                    查阅 →
                  </span>
                </div>
              </button>
            )}
          </div>

          {/* 博士神经档案与存档备份控制台 */}
          <Panel
            variant="dark"
            cornerCut="md"
            className="lg:col-span-5 prts-grad-frame prts-grad-slate bg-[#10161d]/92"
          >
            <TacticalCornerBrackets tone="slate" size="sm" />
            <div className="p-4 h-full flex flex-col justify-between gap-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <span className="block text-[10px] font-mono text-[#e5a52b] tracking-wider">
                    ARCHIVE-IO · DOCTOR PROFILE
                  </span>
                  <span className="block text-xs text-slate-300">
                    博士神经档案 · 演习藏品保存于本机终端（支持 JSON 备份搬运）
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={handleExport} className="min-h-[32px] whitespace-nowrap">
                    导出存档
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[32px] whitespace-nowrap"
                  >
                    导入存档
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleImportFile}
                  />
                </div>
              </div>

              {!activeIsTest && visibleAccounts.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {visibleAccounts.map((account) => (
                    <button
                      key={account.name}
                      type="button"
                      onClick={() => handleSwitch(account.name)}
                      className={`px-2 py-1 min-h-[30px] text-[11px] font-mono tabular-nums border transition-colors flex items-center gap-1.5 cursor-pointer ${
                        account.name === activeName
                          ? 'bg-[#29323d] border-[#e5a52b] text-white ring-1 ring-[#e5a52b]/40'
                          : 'bg-[#181d22] border-[#313b43] text-slate-300 hover:border-[#4b5a66]'
                      }`}
                    >
                      <span>{account.name}</span>
                      <span className="inline-flex items-center gap-1 text-amber-300">
                        <OrundumIcon size="xs" />
                        <span>{account.originite}</span>
                      </span>
                      {account.name === activeName && <span className="text-[#e5a52b]">✓</span>}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-[#27303a]">
                <input
                  type="text"
                  value={newName}
                  maxLength={24}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                  }}
                  placeholder="新建博士代号（初始：3★×2 + 60000 合成玉 · 100 抽）"
                  className="flex-1 min-w-[180px] bg-[#1a2027] border border-[#3c4750] px-2.5 py-1.5 min-h-[34px] text-xs text-slate-100 font-mono placeholder:text-slate-400 focus:border-[#e5a52b] focus:outline-none"
                />
                <Button variant="secondary" size="sm" cornerCut onClick={handleCreate} className="min-h-[34px] whitespace-nowrap">
                  新建档案
                </Button>
                {notice && (
                  <span className="w-full text-[11px] font-mono text-emerald-300 leading-snug">
                    {notice}
                  </span>
                )}
              </div>
            </div>
          </Panel>
        </section>
      </main>

      {/* 底部版本与终端标识栏 */}
      <footer className="relative z-20 w-full bg-[#0d1217]/92">
        <div className="prts-grad-divider w-full" aria-hidden="true" />
        <div className="w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
          <span>PRTS 战术演习终端 v1.1 · 支持多博士档案管理与 JSON 备份</span>
          <span>RHODES ISLAND TACTICAL EXERCISE TERMINAL</span>
        </div>
      </footer>
    </div>
  );
}
