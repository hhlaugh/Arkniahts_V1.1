import React, { useRef, useState } from 'react';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { OrundumIcon } from '../components/ui/OrundumIcon';
import { RhodesWatermarkBackdrop } from '../components/ui/RhodesWatermark';
import { ScenicBackdrop, ScenicBannerLayer } from '../components/ui/ScenicBackdrop';
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
  const [newName, setNewName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeIsTest = isTestVersion ?? (isTestAccountName(activeName) || isTestAccount(activeName));
  const showHotseatMode = activeIsTest && Boolean(onHotseat);
  const visibleAccounts = accounts.filter((account) => !account.isTest && !isTestAccountName(account.name));
  const ownedSpeciesCount = DEMO_CARDS.filter((c) => (collection.owned[c.card_id] ?? 0) > 0).length;
  const customDeckCount = collection.customDecks.length;

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
    <div className="relative min-h-screen w-full bg-[#111519] text-[#e8e9e6] flex flex-col justify-between select-none overflow-x-hidden">
      {/* 全屏舰桥空间底图 + 罗德岛纹章水印 + 层次暗角光影 */}
      <ScenicBackdrop
        scene="rhodes-bridge"
        fixed
        fade="diagonal-tr"
        opacityClassName="opacity-[0.46]"
        baseColor="#101418"
        tint="radial-gradient(circle at 76% 24%, rgba(56,189,248,0.13) 0%, rgba(229,165,43,0.06) 46%, transparent 74%)"
      />
      <RhodesWatermarkBackdrop />
      <div
        aria-hidden="true"
        className="prts-ambient-glow pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 68% 48% at 62% 28%, rgba(229,165,43,0.06) 0%, rgba(56,189,248,0.04) 45%, transparent 78%)',
        }}
      />
      <div
        aria-hidden="true"
        className="prts-grid pointer-events-none fixed inset-0 opacity-[0.04] z-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.16) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.16) 1px, transparent 1px)
          `,
          backgroundSize: '36px 36px',
        }}
      />

      {/* 顶部系统指令栏 */}
      <header className="relative z-20 w-full border-b border-[#343f4a] bg-[#12171d]/90 backdrop-blur-md">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-[#e5a52b]/75 via-[#e5a52b]/20 to-transparent"
        />
        <div className="w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          {/* 左侧：PRTS Logo 与终端识别号 */}
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="relative w-11 h-11 shrink-0 border border-[#4a555b] bg-[#0a0d11] p-1 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
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
              <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 tracking-[0.12em] truncate">
                <span>RHODES ISLAND TACTICAL EXERCISE TERMINAL</span>
                <span aria-hidden="true" className="hidden sm:inline text-slate-600">·</span>
                <span className="hidden sm:inline text-slate-400">
                  {activeIsTest ? 'TEST SANDBOX' : 'COMMAND LINK'}
                </span>
              </div>
            </div>
          </div>

          {/* 右侧：博士档案真实数据与系统快捷入口 */}
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
      </header>

      {/* 主指挥中心工作区 */}
      <main className="relative z-10 flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6 flex flex-col justify-center gap-5">
        {/* 主视觉区域：进入作战 / 战术演习中枢 */}
        <Panel
          variant="dark"
          cornerCut="lg"
          scanlines
          grid
          className="prts-panel-enter border border-[#4b5866] bg-[#141920]/90 shadow-[0_22px_56px_rgba(0,0,0,0.72)]"
        >
          <div className="relative grid grid-cols-1 lg:grid-cols-12 items-stretch overflow-hidden">
            {/* 主视觉背景图：罗德岛舰体外部晨景 + 层次对比遮罩 */}
            <ScenicBannerLayer
              scene="rhodes-exterior"
              fade="right"
              opacityClassName="opacity-55"
              tint="radial-gradient(circle at 72% 42%, rgba(229,165,43,0.16) 0%, rgba(56,189,248,0.08) 45%, transparent 72%)"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0"
              style={{
                background:
                  'linear-gradient(96deg, rgba(13,17,22,0.95) 0%, rgba(15,20,26,0.84) 48%, rgba(16,21,28,0.48) 100%)',
              }}
            />
            <img
              src="./assets/arknights/logos/rhodes_island_dark.png"
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="pointer-events-none select-none hidden md:block absolute left-[42%] top-1/2 -translate-y-1/2 w-64 h-64 object-contain opacity-[0.12] z-0"
            />

            {/* 左侧主作战引导区 */}
            <div className="relative z-10 lg:col-span-7 p-6 sm:p-8 lg:p-10 flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-mono tracking-[0.14em] text-[#e5a52b]">
                  <span className="prts-status-breath inline-block w-2 h-2 bg-[#e5a52b]" aria-hidden="true" />
                  <span>01 · RHODES ISLAND TACTICAL COMMAND</span>
                  <span aria-hidden="true" className="text-slate-500">·</span>
                  <span className="text-slate-300 tabular-nums">72 OPERATORS</span>
                </div>

                <div className="space-y-2">
                  <h2 className="text-3xl sm:text-5xl font-black tracking-[0.06em] text-white m-0 leading-[1.12] [text-wrap:balance]">
                    舟塔自走牌
                  </h2>
                  <p className="text-xs sm:text-sm font-mono tracking-[0.08em] text-sky-300/90 m-0">
                    三路防线攻防推演 · 罗德岛战术指挥终端
                  </p>
                </div>

                <p className="text-xs sm:text-sm text-slate-200/90 leading-relaxed max-w-xl m-0">
                  {activeIsTest
                    ? '测试终端权限已验证。当前开放全干员图鉴调阅、单人模拟演习、联机对抗及本地双人热座沙盘。'
                    : '博士，欢迎接入罗德岛舰桥战术演习终端。PRTS 拟真沙盘已同步 72 位干员作战档案与三路防线攻防推演协议。'}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-4 pt-1">
                <Button
                  variant="primary"
                  size="lg"
                  cornerCut
                  onClick={onVsBot}
                  className="w-full sm:w-auto min-h-[48px] px-7 text-sm sm:text-base font-black tracking-[0.12em] whitespace-nowrap shadow-[0_10px_28px_rgba(229,165,43,0.25)]"
                >
                  开始演习 · 进入作战
                </Button>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono text-slate-300 tabular-nums">
                  <span>PRTS-SIM 01</span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span>20 张编制出击</span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span>三路前/后排交锋</span>
                </div>
              </div>
            </div>

            {/* 右侧作战室战术简报卡（直达单人战术演习） */}
            <div className="relative z-10 lg:col-span-5 p-5 sm:p-7 lg:p-8 flex items-stretch border-t lg:border-t-0 lg:border-l border-[#2f3a46]/80 bg-[#0e1318]/45">
              <button
                type="button"
                onClick={onVsBot}
                className="holo-frame prts-module-tile group relative w-full text-left flex flex-col justify-between p-5 bg-[#12171e]/92 hover:bg-[#161d26] border border-[#3a4654] hover:border-[#e5a52b]/85 cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5a52b]"
                style={{ clipPath: CORNER_CUTS.md }}
              >
                <ScenicBannerLayer
                  scene="rhodes-command"
                  fade="right"
                  opacityClassName="opacity-40 group-hover:opacity-55 transition-opacity"
                  tint="radial-gradient(circle at 78% 40%, rgba(229,165,43,0.16) 0%, transparent 66%)"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-[#e5a52b] via-[#e5a52b]/40 to-transparent z-10"
                />

                <div className="relative z-10 space-y-3">
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                    <span className="inline-flex items-center gap-1.5 text-[#e5a52b] font-semibold tracking-wider">
                      <span className="w-1.5 h-1.5 bg-[#e5a52b]" aria-hidden="true" />
                      演习项目 01 · PRTS SIM
                    </span>
                    <span className="text-slate-300 tabular-nums">单人标准演习</span>
                  </div>

                  <div>
                    <h3 className="text-base sm:text-lg font-black text-white group-hover:text-[#e5a52b] transition-colors m-0 leading-snug">
                      单人战术演习（vs PRTS 模拟教官）
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed mt-1.5 mb-0">
                      博士率领己方整备编队接入 PRTS 模拟对抗，教官系统依循部署、阻挡与站位规则执行推演。
                    </p>
                  </div>
                </div>

                <div className="relative z-10 mt-5 pt-3.5 border-t border-[#2d3742] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 text-[11px] font-mono text-slate-300 tabular-nums">
                    <span>自建 {customDeckCount} 套</span>
                    <span aria-hidden="true" className="text-slate-600">/</span>
                    <span>全池 {DEMO_CARDS.length} 卡</span>
                  </div>
                  <span className="holo-btn holo-btn-outline px-3 py-1.5 text-[11px] font-mono font-bold tracking-wider whitespace-nowrap">
                    启动演习 →
                  </span>
                </div>
              </button>
            </div>
          </div>
        </Panel>

        {/* 次级功能模块区（按重要性区分视觉权重） */}
        <section aria-label="罗德岛整备与干员系统" className="prts-panel-enter prts-enter-delay-1 grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* 模块 A：卡组构筑器（高权重核心整备区） */}
          <button
            type="button"
            onClick={onDeckEditor}
            className="holo-frame prts-module-tile group relative md:col-span-5 min-h-[152px] text-left flex flex-col justify-between p-5 bg-[#151b22] hover:bg-[#19212a] border border-[#34414e] hover:border-sky-400/80 cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            style={{ clipPath: CORNER_CUTS.md }}
          >
            <img
              src={tacticalCommandBackdrop}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="pointer-events-none select-none absolute inset-0 w-full h-full object-cover opacity-[0.26] group-hover:opacity-[0.36] transition-opacity"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(100deg, rgba(16,21,27,0.96) 0%, rgba(18,24,31,0.84) 55%, rgba(16,21,27,0.68) 100%)',
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-sky-400/85 via-sky-400/25 to-transparent z-10"
            />

            <div className="relative z-10 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-sky-300 font-semibold tracking-wider">MOD-02 · DECK BUILDER</span>
                <span className="text-slate-300 tabular-nums">自建编制 {customDeckCount} 套</span>
              </div>
              <h3 className="text-base sm:text-lg font-extrabold text-white group-hover:text-sky-300 transition-colors m-0">
                卡组构筑器
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed m-0 max-w-md">
                整备 20 张出击编队，校验费用曲线、过牌与前后排职业协同。
              </p>
            </div>

            <div className="relative z-10 mt-4 flex items-center justify-between text-[11px] font-mono">
              <span className="text-slate-400">收录 / 自由双模式构筑</span>
              <span className="text-sky-300 font-bold tracking-wider group-hover:translate-x-0.5 transition-transform">
                进入整备 →
              </span>
            </div>
          </button>

          {/* 模块 B：干员寻访 */}
          <button
            type="button"
            onClick={onRecruitment}
            className={`holo-frame prts-module-tile group relative ${onLibrary ? 'md:col-span-4' : 'md:col-span-7'} min-h-[152px] text-left flex flex-col justify-between p-5 bg-[#151b22] hover:bg-[#1b2026] border border-[#3a424b] hover:border-[#e5a52b]/85 cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5a52b]`}
            style={{ clipPath: CORNER_CUTS.md }}
          >
            <img
              src={headhuntingBannerArt}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="pointer-events-none select-none absolute inset-0 w-full h-full object-cover opacity-[0.28] group-hover:opacity-[0.4] transition-opacity"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(100deg, rgba(16,19,24,0.95) 0%, rgba(19,23,28,0.8) 54%, rgba(16,19,24,0.62) 100%)',
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-[#e5a52b]/90 via-[#e5a52b]/25 to-transparent z-10"
            />

            <div className="relative z-10 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-[#e5a52b] font-semibold tracking-wider">MOD-03 · HEADHUNTING</span>
                <span className="inline-flex items-center gap-1 text-amber-300 font-bold tabular-nums">
                  <OrundumIcon size="xs" />
                  <span>{collection.currency.originite}</span>
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-extrabold text-white group-hover:text-[#e5a52b] transition-colors m-0">
                干员寻访
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed m-0">
                消耗合成玉执行单抽或十连寻访，扩充高星级干员作战名录。
              </p>
            </div>

            <div className="relative z-10 mt-4 flex items-center justify-between text-[11px] font-mono">
              <span className="text-slate-400">6★ 递增保底补给通道</span>
              <span className="text-[#e5a52b] font-bold tracking-wider group-hover:translate-x-0.5 transition-transform">
                前往寻访 →
              </span>
            </div>
          </button>

          {/* 模块 C：罗德岛干员图鉴 */}
          {onLibrary && (
            <button
              type="button"
              onClick={onLibrary}
              className="holo-frame prts-module-tile group relative md:col-span-3 min-h-[152px] text-left flex flex-col justify-between p-5 bg-[#151b22] hover:bg-[#1a222b] border border-[#34404c] hover:border-slate-300/75 cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              style={{ clipPath: CORNER_CUTS.md }}
            >
              <ScenicBannerLayer
                scene="terra-landscape"
                fade="right"
                opacityClassName="opacity-28 group-hover:opacity-40 transition-opacity"
                tint="radial-gradient(circle at 80% 35%, rgba(148,163,184,0.12) 0%, transparent 64%)"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-slate-300/70 via-slate-400/20 to-transparent z-10"
              />

              <div className="relative z-10 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-slate-300 font-semibold tracking-wider">MOD-04 · ARCHIVE</span>
                  <span className="text-slate-300 tabular-nums">{ownedSpeciesCount}/{DEMO_CARDS.length}</span>
                </div>
                <h3 className="text-base sm:text-lg font-extrabold text-white group-hover:text-slate-100 transition-colors m-0">
                  罗德岛干员图鉴
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed m-0">
                  查阅全部 {DEMO_CARDS.length} 张作战卡档案、主动技能与词条图鉴。
                </p>
              </div>

              <div className="relative z-10 mt-4 flex items-center justify-between text-[11px] font-mono">
                <span className="text-slate-400">全卡池只读检索</span>
                <span className="text-slate-200 font-bold tracking-wider group-hover:translate-x-0.5 transition-transform">
                  调阅档案 →
                </span>
              </div>
            </button>
          )}
        </section>

        {/* 对战扩展入口 + 博士神经档案控制台 */}
        <section aria-label="联机对抗与博士档案管理" className="prts-panel-enter prts-enter-delay-2 grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* P2P 好友联机 */}
          <button
            type="button"
            onClick={onOnline}
            className={`holo-frame prts-module-tile group relative ${showHotseatMode ? 'lg:col-span-3' : 'lg:col-span-5'} min-h-[136px] text-left flex flex-col justify-between p-4 sm:p-5 bg-[#13171d] hover:bg-[#191e26] border border-[#2f3945] hover:border-rose-400/80 cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400`}
            style={{ clipPath: CORNER_CUTS.md }}
          >
            <ScenicBannerLayer
              scene="lungmen-night"
              fade="right"
              opacityClassName="opacity-28 group-hover:opacity-40 transition-opacity"
              tint="radial-gradient(circle at 80% 45%, rgba(244,63,94,0.12) 0%, transparent 64%)"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-rose-400/85 via-rose-400/20 to-transparent z-10"
            />
            <div className="relative z-10 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-rose-300 font-semibold tracking-wider">
                  LINK-01 · P2P WEBRTC
                </span>
                <span className="text-slate-400">
                  {showHotseatMode ? '演习项目 03' : '演习项目 02'}
                </span>
              </div>
              <h3 className="text-sm sm:text-base font-bold text-slate-100 group-hover:text-rose-200 transition-colors m-0">
                博士联机演习（P2P 对抗）
              </h3>
              <p className="text-xs text-slate-300/90 leading-relaxed m-0">
                建立点对点战术信标连线，生成演习房间码即可实时跨终端对抗。
              </p>
            </div>
            <div className="relative z-10 mt-3 flex items-center justify-between text-[11px] font-mono">
              <span className="text-slate-400">免服直连对抗</span>
              <span className="holo-btn holo-btn-secondary px-2.5 py-1 text-[11px] group-hover:border-rose-400/75 whitespace-nowrap">
                进入联机大厅
              </span>
            </div>
          </button>

          {/* 本地热座（仅当前测试逻辑允许时显示） */}
          {showHotseatMode && (
            <button
              type="button"
              onClick={onHotseat}
              className="holo-frame prts-module-tile group relative lg:col-span-3 min-h-[136px] text-left flex flex-col justify-between p-4 sm:p-5 bg-[#13171d] hover:bg-[#182029] border border-[#2f3945] hover:border-sky-400/80 cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              style={{ clipPath: CORNER_CUTS.md }}
            >
              <ScenicBannerLayer
                scene="snowfield"
                fade="right"
                opacityClassName="opacity-28 group-hover:opacity-40 transition-opacity"
                tint="radial-gradient(circle at 80% 45%, rgba(56,189,248,0.12) 0%, transparent 64%)"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-sky-400/85 via-sky-400/20 to-transparent z-10"
              />
              <div className="relative z-10 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-sky-300 font-semibold tracking-wider">TEST-01 · LOCAL</span>
                  <span className="text-slate-400">沙盘测试</span>
                </div>
                <h3 className="text-sm sm:text-base font-bold text-slate-100 group-hover:text-sky-200 transition-colors m-0">
                  本地热座（双人同屏）
                </h3>
                <p className="text-xs text-slate-300/90 leading-relaxed m-0">
                  测试版本专属：双人同屏轮流出牌与三路攻防推演沙盘。
                </p>
              </div>
              <div className="relative z-10 mt-3 flex items-center justify-between text-[11px] font-mono">
                <span className="text-slate-400">同屏交替操作</span>
                <span className="holo-btn holo-btn-secondary px-2.5 py-1 text-[11px] group-hover:border-sky-400/75 whitespace-nowrap">
                  同屏对战
                </span>
              </div>
            </button>
          )}

          {/* 博士神经档案与存档备份控制台 */}
          <Panel
            variant="dark"
            cornerCut="md"
            className={`${showHotseatMode ? 'lg:col-span-6' : 'lg:col-span-7'} border border-[#343f4a] bg-[#13181e]/92`}
          >
            <div className="p-4 sm:p-5 h-full flex flex-col justify-between gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <span className="block text-[11px] font-mono text-[#e5a52b] tracking-wider">
                    ARCHIVE-IO · DOCTOR PROFILE
                  </span>
                  <span className="block text-xs text-slate-300">
                    博士神经档案 · 演习藏品保存于本机终端（支持 JSON 备份搬运）
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={handleExport} className="min-h-[34px] whitespace-nowrap">
                    导出存档
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[34px] whitespace-nowrap"
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
                      className={`px-2.5 py-1.5 min-h-[32px] text-[11px] font-mono tabular-nums border transition-colors flex items-center gap-1.5 cursor-pointer ${
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

              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#27303a]">
                <input
                  type="text"
                  value={newName}
                  maxLength={24}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                  }}
                  placeholder="新建博士代号（初始：3★×2 + 60000 合成玉 · 100 抽）"
                  className="flex-1 min-w-[200px] bg-[#1a2027] border border-[#3c4750] px-3 py-1.5 min-h-[36px] text-xs text-slate-100 font-mono placeholder:text-slate-400 focus:border-[#e5a52b] focus:outline-none"
                />
                <Button variant="secondary" size="sm" cornerCut onClick={handleCreate} className="min-h-[36px] whitespace-nowrap">
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

      {/* 底部终端版本与基础说明栏 */}
      <footer className="relative z-20 w-full border-t border-[#2c3640] bg-[#101419]/92">
        <div className="w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
          <span>PRTS 战术演习终端 v1.1 · 支持多博士档案管理与 JSON 备份</span>
          <span>RHODES ISLAND TACTICAL EXERCISE TERMINAL</span>
        </div>
      </footer>
    </div>
  );
}
