import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  getAppSettings,
  resetAppSettings,
  updateAppSettings,
} from './app-settings';
import {
  getAuthSession,
  hasAccountPassword,
  isAuthenticated,
  listLoginableAccounts,
  loginAccount,
  loginAsGuest,
  logoutAccount,
  quickLoginAccount,
  registerAccount,
} from './auth-store';
import {
  DEFAULT_ACCOUNT_NAME,
  buildInitialCollection,
  buildTestCollection,
  importAccountsJson,
  isTestAccount,
} from './player-collection';
import {
  BGM_SCENE_TRACKS,
  computeEffectiveBgmVolume,
  computeEffectiveSfxVolume,
  getBgmSnapshot,
  setBgmScene,
} from '../audio/bgmPlayer';

describe('系统设置与音频配置存储', () => {
  beforeEach(() => {
    resetAppSettings();
  });

  it('默认音量、慢速动效与视觉特效默认值符合预期', () => {
    const s = getAppSettings();
    expect(s).toEqual(DEFAULT_APP_SETTINGS);
    expect(s.animSpeedMode).toBe('slow');
    expect(s.combatVfxEnabled).toBe(true);
    expect(s.scanlineFxEnabled).toBe(true);
    expect(s.muted).toBe(false);
  });

  it('音量夹逼 0~100 并正确计算 BGM/SFX 有效输出及静音抑制', () => {
    updateAppSettings({ masterVolume: 150, bgmVolume: -10, sfxVolume: 50 });
    expect(getAppSettings().masterVolume).toBe(100);
    expect(getAppSettings().bgmVolume).toBe(0);
    expect(getAppSettings().sfxVolume).toBe(50);
    expect(computeEffectiveBgmVolume()).toBe(0);
    expect(computeEffectiveSfxVolume()).toBeGreaterThan(0);

    updateAppSettings({ bgmVolume: 80, muted: true });
    expect(computeEffectiveBgmVolume()).toBe(0);
    expect(computeEffectiveSfxVolume()).toBe(0);

    updateAppSettings({ muted: false });
    expect(computeEffectiveBgmVolume()).toBeGreaterThan(0);
  });

  it('BGM 场景切换分别对应登录/主界面/战斗默认明日方舟曲目', () => {
    expect(BGM_SCENE_TRACKS.auth.src).toContain('m_sys_title.mp3');
    expect(BGM_SCENE_TRACKS.lobby.src).toContain('m_sys_void.mp3');
    expect(BGM_SCENE_TRACKS.battle.src).toContain('m_bat_normal02.mp3');

    setBgmScene('auth');
    expect(getBgmSnapshot().track.id).toBe('m_sys_title');

    setBgmScene('lobby');
    expect(getBgmSnapshot().track.id).toBe('m_sys_void');

    setBgmScene('battle');
    expect(getBgmSnapshot().track.id).toBe('m_bat_normal02');
  });
});

describe('刀客塔注册登录与会话存储', () => {
  beforeEach(() => {
    logoutAccount();
  });

  it('支持注册新账户并自动签发会话，拒绝重名、短密码与两次密码不一致', () => {
    expect(isAuthenticated()).toBe(false);

    const shortPw = registerAccount('博士Alpha', '123', '123');
    expect(shortPw.ok).toBe(false);

    const mismatch = registerAccount('博士Alpha', '1234', '5678');
    expect(mismatch.ok).toBe(false);

    const uniqueName = `博士-${Date.now().toString(36)}`;
    const ok = registerAccount(uniqueName, 'prts2026', 'prts2026');
    expect(ok.ok).toBe(true);
    expect(isAuthenticated()).toBe(true);
    expect(getAuthSession()?.username).toBe(uniqueName);
    expect(hasAccountPassword(uniqueName)).toBe(true);

    logoutAccount();
    expect(isAuthenticated()).toBe(false);

    const wrongPw = loginAccount(uniqueName, 'wrong-pass');
    expect(wrongPw.ok).toBe(false);

    const relogin = loginAccount(uniqueName, 'prts2026');
    expect(relogin.ok).toBe(true);
    expect(getAuthSession()?.username).toBe(uniqueName);
  });

  it('隐藏测试账户不出现在可登录列表中，禁用免密直连并强制校验密码进入测试版', () => {
    const visibleNames = listLoginableAccounts().map((a) => a.name);
    expect(visibleNames).not.toContain('hhlaugh-1');
    expect(visibleNames).not.toContain('hhlaugh-2');

    expect(hasAccountPassword('hhlaugh-1')).toBe(true);
    expect(hasAccountPassword('hhlaugh-2')).toBe(true);

    expect(quickLoginAccount('hhlaugh-1').ok).toBe(false);
    expect(quickLoginAccount('hhlaugh-2').ok).toBe(false);
    expect(isAuthenticated()).toBe(false);

    expect(loginAccount('hhlaugh-1', '').ok).toBe(false);
    expect(loginAccount('hhlaugh-1', 'wrong-pass').ok).toBe(false);

    const ok1 = loginAccount('hhlaugh-1', 'hhlaugh');
    expect(ok1.ok).toBe(true);
    expect(getAuthSession()?.username).toBe('hhlaugh-1');
    expect(isTestAccount('hhlaugh-1')).toBe(true);

    logoutAccount();
    const ok2 = loginAccount('hhlaugh-2', 'hhlaugh');
    expect(ok2.ok).toBe(true);
    expect(getAuthSession()?.username).toBe('hhlaugh-2');
    expect(isTestAccount('hhlaugh-2')).toBe(true);
  });

  it('游客登录进入正式版非测试账户且不暴露测试账号', () => {
    const guest = loginAsGuest();
    expect(guest.ok).toBe(true);
    expect(guest.username).toBeTruthy();
    expect(isTestAccount(guest.username)).toBe(false);
    expect(getAuthSession()?.username).toBe(guest.username);
  });

  it('旧版默认代号「指挥官」凭证登录无缝迁移至「刀客塔」', () => {
    const legacyV1 = {
      schemaVersion: 1,
      active: '指挥官',
      accounts: {
        '指挥官': { ...buildInitialCollection(), currency: { originite: 6000 } },
        'hhlaugh-1': buildTestCollection(),
        'hhlaugh-2': buildTestCollection(),
      },
    };
    const imported = importAccountsJson(JSON.stringify(legacyV1));
    expect(imported.ok).toBe(true);
    const res = loginAccount('指挥官', '');
    expect(res.ok).toBe(true);
    expect(getAuthSession()?.username).toBe(DEFAULT_ACCOUNT_NAME);
  });
});
