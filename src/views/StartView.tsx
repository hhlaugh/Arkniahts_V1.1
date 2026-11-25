import React, { useRef, useState } from 'react';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { OrundumIcon } from '../components/ui/OrundumIcon';
import { RhodesWatermarkBackdrop } from '../components/ui/RhodesWatermark';
import { ScenicBackdrop, ScenicBannerLayer } from '../components/ui/ScenicBackdrop';
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
    <div className="relative min-h-screen w-full bg-[#12161b] text-[#e8e9e6] flex flex-col items-center justify-center p-4 sm:p-6 select-none overflow-hidden">
      {/* 官方罗德岛舰桥半淡出风景底图 + 纹章水印 */}
      <ScenicBackdrop
        scene="rhodes-bridge"
        fade="diagonal-tr"
        opacityClassName="opacity-[0.4]"
        tint="radial-gradient(circle at 78% 22%, rgba(56,189,248,0.14) 0%, transparent 58%)"
      />
      <RhodesWatermarkBackdrop />
      {/* Central Terminal Console Panel */}
      <Panel
        variant="dark"
        cornerCut="lg"
        scanlines
        grid
        className="relative z-10 w-full max-w-4xl border border-[#52606d] bg-[#161b21]/90 backdrop-blur-sm shadow-[0_24px_64px_rgba(0,0,0,0.8)] overflow-hidden"
      >
        {/* Top Operational Status Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3.5 bg-[#14171a]/92 border-b border-[#363f45]">
          <div className="flex items-center gap-3">
            <img
              src="./assets/arknights/logos/prts_badge.svg"
              alt="PRTS Logo"
              referrerPolicy="no-referrer"
              className="w-10 h-10 shrink-0 object-contain border border-[#4a555b] bg-black"
            />
            <div>
              <h1 className="text-base font-black tracking-widest text-slate-100 uppercase m-0 leading-tight">
                {activeIsTest ? 'PRTS · 战术演习测试终端' : 'PRTS · 罗德岛战术演习终端'}
              </h1>
              <span className="text-[10px] font-mono text-slate-400 tracking-wider">
                RHODES ISLAND TACTICAL EXERCISE TERMINAL
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] font-mono tabular-nums">
            <span className="text-slate-300">
              博士 <strong className="text-white">{activeName}</strong>
            </span>
            <span className="inline-flex items-center gap-1 text-amber-300 font-bold">
              <OrundumIcon size="sm" />
              <span>{collection.currency.originite}</span>
            </span>
            <span className="text-slate-400">
              收录 {ownedSpeciesCount}/{DEMO_CARDS.length}
            </span>
            {onOpenRules ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenRules}
                aria-label="打开游戏规则补充说明"
                className="text-[11px] font-mono px-2.5 py-1"
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
                onClick={onOpenSettings}
                aria-label="打开系统设置"
                className="text-[11px] font-mono px-2.5 py-1"
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
                className="text-[11px] font-mono px-2 py-1 text-slate-300 border border-[#3a4552] hover:border-rose-400 hover:text-rose-200"
              >
                退出登录
              </Button>
            )}
          </div>
        </div>

        {/* Hero Section */}
        <div className="relative px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-6 bg-[#131820] border-b border-[#313b46] overflow-hidden">
          <ScenicBannerLayer
            scene="rhodes-exterior"
            fade="right"
            opacityClassName="opacity-50"
            tint="radial-gradient(circle at 74% 46%, rgba(229,165,43,0.16) 0%, transparent 62%)"
          />
          <img
            src="./assets/arknights/logos/rhodes_island_dark.png"
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="pointer-events-none select-none relative md:absolute right-6 md:right-60 top-1/2 -translate-y-1/2 w-56 h-56 object-contain opacity-[0.18] hidden md:block z-0"
          />
          <div className="relative z-10 flex-1 space-y-2.5">
            <div className="inline-flex items-center gap-2 text-xs font-mono text-[#e5a52b] tracking-wider uppercase">
              <span className="w-2 h-2 bg-[#e5a52b]" />
              <span>RHODES ISLAND PRTS · TACTICAL EXERCISE TERMINAL</span>
              <span>·</span>
              <span>72 OPERATORS</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-wide m-0">
              舟塔自走牌
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-xl">
              {activeIsTest
                ? '测试终端权限已验证。当前开放全干员图鉴调阅、单人模拟演习、联机对抗及本地双人热座沙盘。'
                : '博士，欢迎接入罗德岛舰桥战术演习终端。PRTS 拟真沙盘已同步 72 位干员作战档案与三路防线攻防推演协议，请调遣干员、整备编队，在演习中锤炼临场指挥协同。'}
            </p>
          </div>

          {/* Quick Deck Builder & Archive Launcher */}
          <div className="relative z-10 w-full md:w-auto shrink-0 flex flex-col sm:flex-row md:flex-col gap-2 items-center">
            <Button
              variant="primary"
              size="lg"
              cornerCut
              onClick={onRecruitment}
              className="w-full md:w-60 font-bold tracking-wider"
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <OrundumIcon size="md" />
                <span>干员寻访 (Gacha)</span>
              </span>
            </Button>
            <Button
              variant="outline"
              size="md"
              cornerCut
              onClick={onDeckEditor}
              className="w-full md:w-60 font-bold tracking-wide"
            >
              🎴 卡组构筑器 (Deck Builder)
            </Button>
            {onLibrary && (
              <Button
                variant="secondary"
                size="md"
                cornerCut
                onClick={onLibrary}
                className="w-full md:w-60 font-medium"
              >
                📖 罗德岛干员图鉴 (Archive)
              </Button>
            )}
            <span className="text-[10px] text-slate-400 font-mono text-center">
              100 抽启动补给 · 编队整备 · PRTS 干员档案库
            </span>
          </div>
        </div>

        {/* Tactical Battle Modes Selection Grid */}
        <div className={`p-6 grid grid-cols-1 gap-4 ${showHotseatMode ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {/* Mode 1: VS Bot */}
          <div
            onClick={onVsBot}
            className="holo-frame group relative flex flex-col justify-between p-4 bg-[#12161b] hover:bg-[#171c23] border border-[#2c3540] hover:border-[#e5a52b]/80 transition-colors duration-150 cursor-pointer select-none overflow-hidden"
            style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)' }}
          >
            <ScenicBannerLayer
              scene="rhodes-command"
              fade="right"
              opacityClassName="opacity-22"
              tint="radial-gradient(circle at 80% 45%, rgba(229,165,43,0.09) 0%, transparent 62%)"
            />
            <div aria-hidden="true" className="pointer-events-none absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-[#e5a52b]/85 via-[#e5a52b]/25 to-transparent z-10" />
            <div className="relative z-10 space-y-1.5 mb-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-[#e5a52b] font-semibold tracking-wider">
                  <span className="w-1.5 h-1.5 bg-[#e5a52b]" />
                  演习项目 01
                </span>
                <span className="text-[9px] font-mono text-slate-400 bg-[#0d1116] border border-[#2a333d] px-1.5 py-0.2">PRTS SIM</span>
              </div>
              <h3 className="text-sm font-bold text-slate-100 group-hover:text-[#e5a52b] transition-colors m-0">
                单人战术演习（vs PRTS 模拟教官）
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                博士率领己方整备编队接入 PRTS 模拟对抗，教官系统将严格依循部署、阻挡与技能规则执行推演。
              </p>
            </div>
            <Button variant="primary" size="sm" cornerCut className="relative z-10 w-full font-mono text-[11px] tracking-[0.12em]">
              开始演习
            </Button>
          </div>

          {/* Mode 2: Hotseat (Test Version Only) */}
          {showHotseatMode && (
            <div
              onClick={onHotseat}
              className="holo-frame group relative flex flex-col justify-between p-4 bg-[#12161b] hover:bg-[#171c23] border border-[#2c3540] hover:border-sky-400/75 transition-colors duration-150 cursor-pointer select-none overflow-hidden"
              style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)' }}
            >
              <ScenicBannerLayer
                scene="snowfield"
                fade="right"
                opacityClassName="opacity-22"
                tint="radial-gradient(circle at 80% 45%, rgba(56,189,248,0.09) 0%, transparent 62%)"
              />
              <div aria-hidden="true" className="pointer-events-none absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-sky-400/80 via-sky-400/20 to-transparent z-10" />
              <div className="relative z-10 space-y-1.5 mb-4">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-sky-400 font-semibold tracking-wider">
                    <span className="w-1.5 h-1.5 bg-sky-400" />
                    TEST MODE
                  </span>
                  <span className="text-[9px] font-mono text-slate-400 bg-[#0d1116] border border-[#2a333d] px-1.5 py-0.2">LOCAL</span>
                </div>
                <h3 className="text-sm font-bold text-slate-100 group-hover:text-sky-300 transition-colors m-0">
                  本地热座（双人同屏）
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  测试版本专属：双人同屏轮流出牌与攻防推演，完整验证选牌、调度与三路对推。
                </p>
              </div>
              <Button variant="secondary" size="sm" cornerCut className="relative z-10 w-full font-mono text-[11px] tracking-[0.12em] hover:border-sky-400/75">
                同屏对战
              </Button>
            </div>
          )}

          {/* Mode 3: Online Room */}
          <div
            onClick={onOnline}
            className="holo-frame group relative flex flex-col justify-between p-4 bg-[#12161b] hover:bg-[#171c23] border border-[#2c3540] hover:border-rose-400/75 transition-colors duration-150 cursor-pointer select-none overflow-hidden"
            style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)' }}
          >
            <ScenicBannerLayer
              scene="lungmen-night"
              fade="right"
              opacityClassName="opacity-22"
              tint="radial-gradient(circle at 80% 45%, rgba(244,63,94,0.09) 0%, transparent 62%)"
            />
            <div aria-hidden="true" className="pointer-events-none absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-rose-400/80 via-rose-400/20 to-transparent z-10" />
            <div className="relative z-10 space-y-1.5 mb-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-rose-400 font-semibold tracking-wider">
                  <span className="w-1.5 h-1.5 bg-rose-400" />
                  {showHotseatMode ? '演习项目 03' : '演习项目 02'}
                </span>
                <span className="text-[9px] font-mono text-slate-400 bg-[#0d1116] border border-[#2a333d] px-1.5 py-0.2">P2P RTC</span>
              </div>
              <h3 className="text-sm font-bold text-slate-100 group-hover:text-rose-300 transition-colors m-0">
                博士联机演习（P2P 对抗）
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                与另一位博士建立点对点战术信标连线，生成演习房间码即可实时展开跨终端演习对抗。
              </p>
            </div>
            <Button variant="secondary" size="sm" cornerCut className="relative z-10 w-full font-mono text-[11px] tracking-[0.12em] hover:border-rose-400/75">
              进入联机大厅
            </Button>
          </div>
        </div>

        {/* Doctor Profiles & Save Backup (Test accounts hidden) */}
        <div className="px-6 py-4 bg-[#14171a] border-t border-[#2d353b] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-mono text-slate-400 tracking-wider">
              博士神经档案 · 演习藏品保存于本机终端（支持 JSON 备份搬运）
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}>
                导出存档
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
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
                  className={`px-2 py-1 text-[11px] font-mono border transition-colors flex items-center gap-1.5 ${
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
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newName}
              maxLength={24}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
              placeholder="新建博士代号（初始：3★×2 + 60000 合成玉 · 100 抽）"
              className="flex-1 min-w-[180px] sm:max-w-xs bg-[#1b2127] border border-[#3c4750] px-2.5 py-1 text-xs text-slate-200 font-mono focus:border-amber-400 focus:outline-none"
            />
            <Button variant="secondary" size="sm" onClick={handleCreate}>
              新建档案
            </Button>
            {notice && <span className="text-[10px] font-mono text-emerald-300">{notice}</span>}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#121518] border-t border-[#2d353b] flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-400">
          <span>PRTS 战术演习终端 · 支持多博士档案管理与 JSON 备份</span>
          <span>RHODES ISLAND TACTICAL EXERCISE TERMINAL</span>
        </div>
      </Panel>
    </div>
  );
}
