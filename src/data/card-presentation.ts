import type { CardId } from '../game/types';

import summonMeeboImg from '../assets/images/summon_meebo_1795498706092.jpg';
import summonPhantomShadowImg from '../assets/images/summon_phantom_shadow_1795498707522.jpg';
import summonSilenceDroneImg from '../assets/images/summon_silence_drone_1795498705746.jpg';
import summonNightingaleCageImg from '../assets/images/summon_nightingale_cage_1795498708508.jpg';
import summonMagallanStrikeImg from '../assets/images/summon_magallan_strike_1795498709653.jpg';
import summonMagallanSupportImg from '../assets/images/summon_magallan_support_1795498709550.jpg';

import facFrontlineBunkerImg from '../assets/images/fac_frontline_bunker_1795498710383.jpg';
import facCommsTerminalImg from '../assets/images/fac_comms_terminal_1795498710207.jpg';
import facWatchtowerImg from '../assets/images/fac_watchtower_1795498710193.jpg';
import facFieldRepairImg from '../assets/images/fac_field_repair_1795498710504.jpg';
import facJammingTowerImg from '../assets/images/fac_jamming_tower_1795498826833.jpg';
import facLogisticsDeskImg from '../assets/images/fac_logistics_desk_1795498826386.jpg';

import eqCompositeArmorImg from '../assets/images/eq_composite_armor_1795498824997.jpg';
import eqSniperScopeImg from '../assets/images/eq_sniper_scope_1795498806740.jpg';
import eqOriginiumAmpImg from '../assets/images/eq_originium_amp_1795498713396.jpg';
import eqFirstAidImg from '../assets/images/eq_first_aid_1795498713709.jpg';
import eqAssaultModuleImg from '../assets/images/eq_assault_module_1795498714213.jpg';
import eqTacticalVisorImg from '../assets/images/eq_tactical_visor_1795498826605.jpg';

import tacRedeploySwapImg from '../assets/images/tac_redeploy_swap_1795498828021.jpg';
import tacAirdropDeployImg from '../assets/images/tac_airdrop_deploy_1795498716937.jpg';
import tacBattleRallyImg from '../assets/images/tac_battle_rally_1795498716710.jpg';
import tacPrecisionBlastImg from '../assets/images/tac_precision_blast_1795498717968.jpg';
import tacShrapnelSalvoImg from '../assets/images/tac_shrapnel_salvo_1795498718591.jpg';
import tacRearSnipeImg from '../assets/images/tac_rear_snipe_1795498826450.jpg';
import tacAntiSummonImg from '../assets/images/tac_anti_summon_1795498827538.jpg';
import tacMedkitHealImg from '../assets/images/tac_medkit_heal_1795498827640.jpg';
import tacEmergencyShieldImg from '../assets/images/tac_emergency_shield_1795498899798.jpg';
import tacBastionCoverImg from '../assets/images/tac_bastion_cover_1795498808105.jpg';
import tacSuppressionFireImg from '../assets/images/tac_suppression_fire_1795498901176.jpg';
import tacArmorPierceImg from '../assets/images/tac_armor_pierce_1795498899905.jpg';
import tacEmpSabotageImg from '../assets/images/tac_emp_sabotage_1795498901286.jpg';
import tacReconIntelImg from '../assets/images/tac_recon_intel_1795498901542.jpg';
import tacIntelFocusImg from '../assets/images/tac_intel_focus_1795498806933.jpg';
import tacPreemptiveStrikeImg from '../assets/images/tac_preemptive_strike_1795498901458.jpg';

/**
 * 卡牌表现层元数据模型 (Card Presentation Manifest)
 * 严格与游戏规则数据（CardDefinition）解耦：仅保存展示、立绘路径、头像路径、裁切位置与素材来源。
 */
export interface CardPresentation {
  readonly cardId: CardId;
  readonly operatorId: string;
  readonly codeNameZh: string;
  readonly codeNameEn: string;
  readonly profession: string;
  readonly rarity: number;
  readonly assets: {
    readonly portrait: string;
    readonly avatar: string;
    readonly alternatePortraits?: readonly string[];
  };
  readonly display: {
    readonly portraitFit: 'contain' | 'cover';
    readonly portraitPosition: string;
    readonly objectPosition?: string;
  };
  readonly source: {
    readonly name: string;
    readonly url?: string;
    readonly notes?: string;
  };
}

/** 72 位官方干员全量视觉表现配置登记表 */
const PRESENTATIONS: readonly CardPresentation[] = [
  // --- 先锋 (Vanguard) ---
  {
    cardId: 'OP-VAN-001' as CardId,
    operatorId: 'operator_fang',
    codeNameZh: '芬',
    codeNameEn: 'Fang',
    profession: 'vanguard',
    rarity: 3,
    assets: {
      portrait: '/assets/arknights/operators/fang/portrait.webp',
      avatar: '/assets/arknights/operators/fang/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '行动预备组A1队长' },
  },
  {
    cardId: 'OP-VAN-002' as CardId,
    operatorId: 'operator_plume',
    codeNameZh: '翎羽',
    codeNameEn: 'Plume',
    profession: 'vanguard',
    rarity: 3,
    assets: {
      portrait: '/assets/arknights/operators/plume/portrait.webp',
      avatar: '/assets/arknights/operators/plume/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '拉特兰铳骑士' },
  },
  {
    cardId: 'OP-VAN-003' as CardId,
    operatorId: 'operator_myrtle',
    codeNameZh: '桃金娘',
    codeNameEn: 'Myrtle',
    profession: 'vanguard',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/myrtle/portrait.webp',
      avatar: '/assets/arknights/operators/myrtle/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 25%' },
    source: { name: 'Arknights Official Assets', notes: '执旗手先锋' },
  },
  {
    cardId: 'OP-VAN-004' as CardId,
    operatorId: 'operator_courier',
    codeNameZh: '讯使',
    codeNameEn: 'Courier',
    profession: 'vanguard',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/courier/portrait.webp',
      avatar: '/assets/arknights/operators/courier/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '谢拉格邮差' },
  },
  {
    cardId: 'OP-VAN-005' as CardId,
    operatorId: 'operator_vigna',
    codeNameZh: '红豆',
    codeNameEn: 'Vigna',
    profession: 'vanguard',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/vigna/portrait.webp',
      avatar: '/assets/arknights/operators/vigna/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '冲锋手先锋' },
  },
  {
    cardId: 'OP-VAN-006' as CardId,
    operatorId: 'operator_texas',
    codeNameZh: '德克萨斯',
    codeNameEn: 'Texas',
    profession: 'vanguard',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/texas/portrait.webp',
      avatar: '/assets/arknights/operators/texas/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '企鹅物流干员' },
  },
  {
    cardId: 'OP-VAN-007' as CardId,
    operatorId: 'operator_elysium',
    codeNameZh: '极境',
    codeNameEn: 'Elysium',
    profession: 'vanguard',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/elysium/portrait.webp',
      avatar: '/assets/arknights/operators/elysium/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 18%' },
    source: { name: 'Arknights Official Assets', notes: '罗德岛信使' },
  },
  {
    cardId: 'OP-VAN-008' as CardId,
    operatorId: 'operator_siege',
    codeNameZh: '推进之王',
    codeNameEn: 'Siege',
    profession: 'vanguard',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/siege/portrait.webp',
      avatar: '/assets/arknights/operators/siege/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '格拉斯哥帮首领' },
  },
  {
    cardId: 'OP-VAN-009' as CardId,
    operatorId: 'operator_bagpipe',
    codeNameZh: '风笛',
    codeNameEn: 'Bagpipe',
    profession: 'vanguard',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/bagpipe/portrait.webp',
      avatar: '/assets/arknights/operators/bagpipe/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '维多利亚军人' },
  },

  // --- 近卫 (Guard) ---
  {
    cardId: 'OP-GUA-001' as CardId,
    operatorId: 'operator_melantha',
    codeNameZh: '玫兰莎',
    codeNameEn: 'Melantha',
    profession: 'guard',
    rarity: 3,
    assets: {
      portrait: '/assets/arknights/operators/melantha/portrait.webp',
      avatar: '/assets/arknights/operators/melantha/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '预备组A4组长' },
  },
  {
    cardId: 'OP-GUA-002' as CardId,
    operatorId: 'operator_midnight',
    codeNameZh: '月见夜',
    codeNameEn: 'Midnight',
    profession: 'guard',
    rarity: 3,
    assets: {
      portrait: '/assets/arknights/operators/midnight/portrait.webp',
      avatar: '/assets/arknights/operators/midnight/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 18%' },
    source: { name: 'Arknights Official Assets', notes: '领主近卫' },
  },
  {
    cardId: 'OP-GUA-003' as CardId,
    operatorId: 'operator_cutter',
    codeNameZh: '刻刀',
    codeNameEn: 'Cutter',
    profession: 'guard',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/cutter/portrait.webp',
      avatar: '/assets/arknights/operators/cutter/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '双剑剑豪' },
  },
  {
    cardId: 'OP-GUA-004' as CardId,
    operatorId: 'operator_utage',
    codeNameZh: '宴',
    codeNameEn: 'Utage',
    profession: 'guard',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/utage/portrait.webp',
      avatar: '/assets/arknights/operators/utage/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '武者近卫' },
  },
  {
    cardId: 'OP-GUA-005' as CardId,
    operatorId: 'operator_lappland',
    codeNameZh: '拉普兰德',
    codeNameEn: 'Lappland',
    profession: 'guard',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/lappland/portrait.webp',
      avatar: '/assets/arknights/operators/lappland/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '叙拉古干员' },
  },
  {
    cardId: 'OP-GUA-006' as CardId,
    operatorId: 'operator_specter',
    codeNameZh: '幽灵鲨',
    codeNameEn: 'Specter',
    profession: 'guard',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/specter/portrait.webp',
      avatar: '/assets/arknights/operators/specter/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 18%' },
    source: { name: 'Arknights Official Assets', notes: '深海猎人' },
  },
  {
    cardId: 'OP-GUA-007' as CardId,
    operatorId: 'operator_silverash',
    codeNameZh: '银灰',
    codeNameEn: 'SilverAsh',
    profession: 'guard',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/silverash/portrait.webp',
      avatar: '/assets/arknights/operators/silverash/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '谢拉格领主' },
  },
  {
    cardId: 'OP-GUA-008' as CardId,
    operatorId: 'operator_thorns',
    codeNameZh: '棘刺',
    codeNameEn: 'Thorns',
    profession: 'guard',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/thorns/portrait.webp',
      avatar: '/assets/arknights/operators/thorns/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '伊比利亚至高之术' },
  },
  {
    cardId: 'OP-GUA-009' as CardId,
    operatorId: 'operator_surtr',
    codeNameZh: '史尔特尔',
    codeNameEn: 'Surtr',
    profession: 'guard',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/surtr/portrait.webp',
      avatar: '/assets/arknights/operators/surtr/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '黄昏魔剑' },
  },

  // --- 重装 (Defender) ---
  {
    cardId: 'OP-DEF-001' as CardId,
    operatorId: 'operator_beagle',
    codeNameZh: '米格鲁',
    codeNameEn: 'Beagle',
    profession: 'defender',
    rarity: 3,
    assets: {
      portrait: '/assets/arknights/operators/beagle/portrait.webp',
      avatar: '/assets/arknights/operators/beagle/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '行动预备组A1' },
  },
  {
    cardId: 'OP-DEF-002' as CardId,
    operatorId: 'operator_spot',
    codeNameZh: '斑点',
    codeNameEn: 'Spot',
    profession: 'defender',
    rarity: 3,
    assets: {
      portrait: '/assets/arknights/operators/spot/portrait.webp',
      avatar: '/assets/arknights/operators/spot/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '庇护卫士' },
  },
  {
    cardId: 'OP-DEF-003' as CardId,
    operatorId: 'operator_cuora',
    codeNameZh: '蛇屠箱',
    codeNameEn: 'Cuora',
    profession: 'defender',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/cuora/portrait.webp',
      avatar: '/assets/arknights/operators/cuora/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '坚守铁卫' },
  },
  {
    cardId: 'OP-DEF-004' as CardId,
    operatorId: 'operator_gummy',
    codeNameZh: '古米',
    codeNameEn: 'Gummy',
    profession: 'defender',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/gummy/portrait.webp',
      avatar: '/assets/arknights/operators/gummy/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '乌萨斯学生自治团' },
  },
  {
    cardId: 'OP-DEF-005' as CardId,
    operatorId: 'operator_bubble',
    codeNameZh: '泡泡',
    codeNameEn: 'Bubble',
    profession: 'defender',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/bubble/portrait.webp',
      avatar: '/assets/arknights/operators/bubble/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '萨尔贡勇士' },
  },
  {
    cardId: 'OP-DEF-006' as CardId,
    operatorId: 'operator_liskarm',
    codeNameZh: '雷蛇',
    codeNameEn: 'Liskarm',
    profession: 'defender',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/liskarm/portrait.webp',
      avatar: '/assets/arknights/operators/liskarm/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 18%' },
    source: { name: 'Arknights Official Assets', notes: '黑钢国际' },
  },
  {
    cardId: 'OP-DEF-007' as CardId,
    operatorId: 'operator_nearl',
    codeNameZh: '临光',
    codeNameEn: 'Nearl',
    profession: 'defender',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/nearl/portrait.webp',
      avatar: '/assets/arknights/operators/nearl/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '耀骑士' },
  },
  {
    cardId: 'OP-DEF-008' as CardId,
    operatorId: 'operator_saria',
    codeNameZh: '塞雷娅',
    codeNameEn: 'Saria',
    profession: 'defender',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/saria/portrait.webp',
      avatar: '/assets/arknights/operators/saria/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '莱茵生命主任' },
  },
  {
    cardId: 'OP-DEF-009' as CardId,
    operatorId: 'operator_hoshiguma',
    codeNameZh: '星熊',
    codeNameEn: 'Hoshiguma',
    profession: 'defender',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/hoshiguma/portrait.webp',
      avatar: '/assets/arknights/operators/hoshiguma/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '龙门近卫局督察' },
  },

  // --- 狙击 (Sniper) ---
  {
    cardId: 'OP-SNI-001' as CardId,
    operatorId: 'operator_kroos',
    codeNameZh: '克洛丝',
    codeNameEn: 'Kroos',
    profession: 'sniper',
    rarity: 3,
    assets: {
      portrait: '/assets/arknights/operators/kroos/portrait.webp',
      avatar: '/assets/arknights/operators/kroos/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '行动预备组A1' },
  },
  {
    cardId: 'OP-SNI-002' as CardId,
    operatorId: 'operator_jessica',
    codeNameZh: '杰西卡',
    codeNameEn: 'Jessica',
    profession: 'sniper',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/jessica/portrait.webp',
      avatar: '/assets/arknights/operators/jessica/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '黑钢国际干员' },
  },
  {
    cardId: 'OP-SNI-003' as CardId,
    operatorId: 'operator_meteor',
    codeNameZh: '流星',
    codeNameEn: 'Meteor',
    profession: 'sniper',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/meteor/portrait.webp',
      avatar: '/assets/arknights/operators/meteor/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 18%' },
    source: { name: 'Arknights Official Assets', notes: '卡西米尔森林巡林者' },
  },
  {
    cardId: 'OP-SNI-004' as CardId,
    operatorId: 'operator_may',
    codeNameZh: '梅',
    codeNameEn: 'May',
    profession: 'sniper',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/may/portrait.webp',
      avatar: '/assets/arknights/operators/may/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '维多利亚皇家侦探' },
  },
  {
    cardId: 'OP-SNI-005' as CardId,
    operatorId: 'operator_platinum',
    codeNameZh: '白金',
    codeNameEn: 'Platinum',
    profession: 'sniper',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/platinum/portrait.webp',
      avatar: '/assets/arknights/operators/platinum/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '无胄盟刺客' },
  },
  {
    cardId: 'OP-SNI-006' as CardId,
    operatorId: 'operator_bluepoison',
    codeNameZh: '蓝毒',
    codeNameEn: 'Blue Poison',
    profession: 'sniper',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/bluepoison/portrait.webp',
      avatar: '/assets/arknights/operators/bluepoison/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 18%' },
    source: { name: 'Arknights Official Assets', notes: '毒理学干员' },
  },
  {
    cardId: 'OP-SNI-007' as CardId,
    operatorId: 'operator_firewatch',
    codeNameZh: '守林人',
    codeNameEn: 'Firewatch',
    profession: 'sniper',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/firewatch/portrait.webp',
      avatar: '/assets/arknights/operators/firewatch/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '远程战术狙击' },
  },
  {
    cardId: 'OP-SNI-008' as CardId,
    operatorId: 'operator_exusiai',
    codeNameZh: '能天使',
    codeNameEn: 'Exusiai',
    profession: 'sniper',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/exusiai/portrait.webp',
      avatar: '/assets/arknights/operators/exusiai/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '企鹅物流干员' },
  },
  {
    cardId: 'OP-SNI-009' as CardId,
    operatorId: 'operator_schwarz',
    codeNameZh: '黑',
    codeNameEn: 'Schwarz',
    profession: 'sniper',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/schwarz/portrait.webp',
      avatar: '/assets/arknights/operators/schwarz/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '汐斯塔保镖' },
  },

  // --- 术师 (Caster) ---
  {
    cardId: 'OP-CAS-001' as CardId,
    operatorId: 'operator_steward',
    codeNameZh: '史都华德',
    codeNameEn: 'Steward',
    profession: 'caster',
    rarity: 3,
    assets: {
      portrait: '/assets/arknights/operators/steward/portrait.webp',
      avatar: '/assets/arknights/operators/steward/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '行动预备组A4' },
  },
  {
    cardId: 'OP-CAS-002' as CardId,
    operatorId: 'operator_lava',
    codeNameZh: '炎熔',
    codeNameEn: 'Lava',
    profession: 'caster',
    rarity: 3,
    assets: {
      portrait: '/assets/arknights/operators/lava/portrait.webp',
      avatar: '/assets/arknights/operators/lava/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '扩散术师' },
  },
  {
    cardId: 'OP-CAS-003' as CardId,
    operatorId: 'operator_haze',
    codeNameZh: '夜烟',
    codeNameEn: 'Haze',
    profession: 'caster',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/haze/portrait.webp',
      avatar: '/assets/arknights/operators/haze/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '削弱法抗' },
  },
  {
    cardId: 'OP-CAS-004' as CardId,
    operatorId: 'operator_click',
    codeNameZh: '卡达',
    codeNameEn: 'Click',
    profession: 'caster',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/click/portrait.webp',
      avatar: '/assets/arknights/operators/click/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '驭械术师' },
  },
  {
    cardId: 'OP-CAS-005' as CardId,
    operatorId: 'operator_gitano',
    codeNameZh: '远山',
    codeNameEn: 'Gitano',
    profession: 'caster',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/gitano/portrait.webp',
      avatar: '/assets/arknights/operators/gitano/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '占卜扩散法' },
  },
  {
    cardId: 'OP-CAS-006' as CardId,
    operatorId: 'operator_amiya',
    codeNameZh: '阿米娅',
    codeNameEn: 'Amiya',
    profession: 'caster',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/amiya/portrait.webp',
      avatar: '/assets/arknights/operators/amiya/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '罗德岛公开领袖' },
  },
  {
    cardId: 'OP-CAS-007' as CardId,
    operatorId: 'operator_nightmare',
    codeNameZh: '夜魔',
    codeNameEn: 'Nightmare',
    profession: 'caster',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/nightmare/portrait.webp',
      avatar: '/assets/arknights/operators/nightmare/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 18%' },
    source: { name: 'Arknights Official Assets', notes: '双重人格法师' },
  },
  {
    cardId: 'OP-CAS-008' as CardId,
    operatorId: 'operator_eyjafjalla',
    codeNameZh: '艾雅法拉',
    codeNameEn: 'Eyjafjalla',
    profession: 'caster',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/eyjafjalla/portrait.webp',
      avatar: '/assets/arknights/operators/eyjafjalla/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '火山学者' },
  },
  {
    cardId: 'OP-CAS-009' as CardId,
    operatorId: 'operator_ifrit',
    codeNameZh: '伊芙利特',
    codeNameEn: 'Ifrit',
    profession: 'caster',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/ifrit/portrait.webp',
      avatar: '/assets/arknights/operators/ifrit/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '莱茵生命实验体' },
  },

  // --- 医疗 (Medic) ---
  {
    cardId: 'OP-MED-001' as CardId,
    operatorId: 'operator_ansel',
    codeNameZh: '安赛尔',
    codeNameEn: 'Ansel',
    profession: 'medic',
    rarity: 3,
    assets: {
      portrait: '/assets/arknights/operators/ansel/portrait.webp',
      avatar: '/assets/arknights/operators/ansel/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '行动预备组A4' },
  },
  {
    cardId: 'OP-MED-002' as CardId,
    operatorId: 'operator_hibiscus',
    codeNameZh: '芙蓉',
    codeNameEn: 'Hibiscus',
    profession: 'medic',
    rarity: 3,
    assets: {
      portrait: '/assets/arknights/operators/hibiscus/portrait.webp',
      avatar: '/assets/arknights/operators/hibiscus/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '行动预备组A1' },
  },
  {
    cardId: 'OP-MED-003' as CardId,
    operatorId: 'operator_perfumer',
    codeNameZh: '调香师',
    codeNameEn: 'Perfumer',
    profession: 'medic',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/perfumer/portrait.webp',
      avatar: '/assets/arknights/operators/perfumer/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '群愈医疗' },
  },
  {
    cardId: 'OP-MED-004' as CardId,
    operatorId: 'operator_gavial',
    codeNameZh: '嘉维尔',
    codeNameEn: 'Gavial',
    profession: 'medic',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/gavial/portrait.webp',
      avatar: '/assets/arknights/operators/gavial/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '阿卡胡拉医术' },
  },
  {
    cardId: 'OP-MED-005' as CardId,
    operatorId: 'operator_sussurro',
    codeNameZh: '苏苏洛',
    codeNameEn: 'Sussurro',
    profession: 'medic',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/sussurro/portrait.webp',
      avatar: '/assets/arknights/operators/sussurro/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '深度治疗' },
  },
  {
    cardId: 'OP-MED-006' as CardId,
    operatorId: 'operator_silence',
    codeNameZh: '赫默',
    codeNameEn: 'Silence',
    profession: 'medic',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/silence/portrait.webp',
      avatar: '/assets/arknights/operators/silence/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 18%' },
    source: { name: 'Arknights Official Assets', notes: '无人机医疗' },
  },
  {
    cardId: 'OP-MED-007' as CardId,
    operatorId: 'operator_warfarin',
    codeNameZh: '华法琳',
    codeNameEn: 'Warfarin',
    profession: 'medic',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/warfarin/portrait.webp',
      avatar: '/assets/arknights/operators/warfarin/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 18%' },
    source: { name: 'Arknights Official Assets', notes: '血液学医生' },
  },
  {
    cardId: 'OP-MED-008' as CardId,
    operatorId: 'operator_shining',
    codeNameZh: '闪灵',
    codeNameEn: 'Shining',
    profession: 'medic',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/shining/portrait.webp',
      avatar: '/assets/arknights/operators/shining/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '使徒干员' },
  },
  {
    cardId: 'OP-MED-009' as CardId,
    operatorId: 'operator_nightingale',
    codeNameZh: '夜莺',
    codeNameEn: 'Nightingale',
    profession: 'medic',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/nightingale/portrait.webp',
      avatar: '/assets/arknights/operators/nightingale/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '圣域法抗' },
  },

  // --- 辅助 (Supporter) ---
  {
    cardId: 'OP-SUP-001' as CardId,
    operatorId: 'operator_earthspirit_or_caper',
    codeNameZh: '梓兰',
    codeNameEn: 'Orchid',
    profession: 'supporter',
    rarity: 3,
    assets: {
      portrait: '/assets/arknights/operators/orchid/portrait.webp',
      avatar: '/assets/arknights/operators/orchid/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '行动预备组A4组长' },
  },
  {
    cardId: 'OP-SUP-002' as CardId,
    operatorId: 'operator_podenco',
    codeNameZh: '波登可',
    codeNameEn: 'Podenco',
    profession: 'supporter',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/podenco/portrait.webp',
      avatar: '/assets/arknights/operators/podenco/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '温室孢子控场' },
  },
  {
    cardId: 'OP-SUP-003' as CardId,
    operatorId: 'operator_earthspirit',
    codeNameZh: '地灵',
    codeNameEn: 'Earthspirit',
    profession: 'supporter',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/earthspirit/portrait.webp',
      avatar: '/assets/arknights/operators/earthspirit/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '地质学停顿' },
  },
  {
    cardId: 'OP-SUP-004' as CardId,
    operatorId: 'operator_istina',
    codeNameZh: '真理',
    codeNameEn: 'Istina',
    profession: 'supporter',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/istina/portrait.webp',
      avatar: '/assets/arknights/operators/istina/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 18%' },
    source: { name: 'Arknights Official Assets', notes: '乌萨斯学生自治团' },
  },
  {
    cardId: 'OP-SUP-005' as CardId,
    operatorId: 'operator_pramanix',
    codeNameZh: '初雪',
    codeNameEn: 'Pramanix',
    profession: 'supporter',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/pramanix/portrait.webp',
      avatar: '/assets/arknights/operators/pramanix/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 18%' },
    source: { name: 'Arknights Official Assets', notes: '谢拉格圣女' },
  },
  {
    cardId: 'OP-SUP-006' as CardId,
    operatorId: 'operator_mayer',
    codeNameZh: '梅尔',
    codeNameEn: 'Mayer',
    profession: 'supporter',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/mayer/portrait.webp',
      avatar: '/assets/arknights/operators/mayer/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 18%' },
    source: { name: 'Arknights Official Assets', notes: '机械水獭召唤' },
  },
  {
    cardId: 'OP-SUP-007' as CardId,
    operatorId: 'operator_angelina',
    codeNameZh: '安洁莉娜',
    codeNameEn: 'Angelina',
    profession: 'supporter',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/angelina/portrait.webp',
      avatar: '/assets/arknights/operators/angelina/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '反重力密使' },
  },
  {
    cardId: 'OP-SUP-008' as CardId,
    operatorId: 'operator_suzuran',
    codeNameZh: '铃兰',
    codeNameEn: 'Suzuran',
    profession: 'supporter',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/suzuran/portrait.webp',
      avatar: '/assets/arknights/operators/suzuran/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '光辉原石技艺' },
  },
  {
    cardId: 'OP-SUP-009' as CardId,
    operatorId: 'operator_magallan',
    codeNameZh: '麦哲伦',
    codeNameEn: 'Magallan',
    profession: 'supporter',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/magallan/portrait.webp',
      avatar: '/assets/arknights/operators/magallan/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '莱茵生命极地科考' },
  },

  // --- 特种 (Specialist) ---
  {
    cardId: 'OP-SPE-001' as CardId,
    operatorId: 'operator_rope',
    codeNameZh: '暗索',
    codeNameEn: 'Rope',
    profession: 'specialist',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/rope/portrait.webp',
      avatar: '/assets/arknights/operators/rope/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '钩爪特种' },
  },
  {
    cardId: 'OP-SPE-002' as CardId,
    operatorId: 'operator_shaw',
    codeNameZh: '阿消',
    codeNameEn: 'Shaw',
    profession: 'specialist',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/shaw/portrait.webp',
      avatar: '/assets/arknights/operators/shaw/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '推力特种' },
  },
  {
    cardId: 'OP-SPE-003' as CardId,
    operatorId: 'operator_gravel',
    codeNameZh: '砾',
    codeNameEn: 'Gravel',
    profession: 'specialist',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/gravel/portrait.webp',
      avatar: '/assets/arknights/operators/gravel/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '快速复活处决' },
  },
  {
    cardId: 'OP-SPE-004' as CardId,
    operatorId: 'operator_ethan',
    codeNameZh: '伊桑',
    codeNameEn: 'Ethan',
    profession: 'specialist',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/ethan/portrait.webp',
      avatar: '/assets/arknights/operators/ethan/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '潜行定身特种' },
  },
  {
    cardId: 'OP-SPE-005' as CardId,
    operatorId: 'operator_jaye',
    codeNameZh: '孑',
    codeNameEn: 'Jaye',
    profession: 'specialist',
    rarity: 4,
    assets: {
      portrait: '/assets/arknights/operators/jaye/portrait.webp',
      avatar: '/assets/arknights/operators/jaye/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 20%' },
    source: { name: 'Arknights Official Assets', notes: '龙门水产刀工' },
  },
  {
    cardId: 'OP-SPE-006' as CardId,
    operatorId: 'operator_manticore',
    codeNameZh: '狮蝎',
    codeNameEn: 'Manticore',
    profession: 'specialist',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/manticore/portrait.webp',
      avatar: '/assets/arknights/operators/manticore/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 18%' },
    source: { name: 'Arknights Official Assets', notes: '隐匿刺杀' },
  },
  {
    cardId: 'OP-SPE-007' as CardId,
    operatorId: 'operator_red',
    codeNameZh: '红',
    codeNameEn: 'Projekt Red',
    profession: 'specialist',
    rarity: 5,
    assets: {
      portrait: '/assets/arknights/operators/red/portrait.webp',
      avatar: '/assets/arknights/operators/red/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 18%' },
    source: { name: 'Arknights Official Assets', notes: '狼群刺杀与眩晕' },
  },
  {
    cardId: 'OP-SPE-008' as CardId,
    operatorId: 'operator_phantom',
    codeNameZh: '傀影',
    codeNameEn: 'Phantom',
    profession: 'specialist',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/phantom/portrait.webp',
      avatar: '/assets/arknights/operators/phantom/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '猩红剧团影子' },
  },
  {
    cardId: 'OP-SPE-009' as CardId,
    operatorId: 'operator_weedy',
    codeNameZh: '温蒂',
    codeNameEn: 'Weedy',
    profession: 'specialist',
    rarity: 6,
    assets: {
      portrait: '/assets/arknights/operators/weedy/portrait.webp',
      avatar: '/assets/arknights/operators/weedy/avatar.webp',
    },
    display: { portraitFit: 'cover', portraitPosition: 'center 15%' },
    source: { name: 'Arknights Official Assets', notes: '生化加农炮' },
  },
  // --- 战术卡 & 支援卡 (V1.1 36张) ---
  {
    cardId: 'DEMO-TAC-V2-001' as CardId,
    operatorId: 'demo_tac_v2_001',
    codeNameZh: '临机调度',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacRedeploySwapImg, avatar: tacRedeploySwapImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '临机调度' },
  },
  {
    cardId: 'DEMO-TAC-V2-002' as CardId,
    operatorId: 'demo_tac_v2_002',
    codeNameZh: '空降部署',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacAirdropDeployImg, avatar: tacAirdropDeployImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '空降部署' },
  },
  {
    cardId: 'DEMO-TAC-V2-003' as CardId,
    operatorId: 'demo_tac_v2_003',
    codeNameZh: '战线集结',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacBattleRallyImg, avatar: tacBattleRallyImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '战线集结' },
  },
  {
    cardId: 'DEMO-TAC-V2-004' as CardId,
    operatorId: 'demo_tac_v2_004',
    codeNameZh: '预备队换班',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacRedeploySwapImg, avatar: tacRedeploySwapImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '预备队换班' },
  },
  {
    cardId: 'DEMO-TAC-V2-005' as CardId,
    operatorId: 'demo_tac_v2_005',
    codeNameZh: '定点爆破',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacPrecisionBlastImg, avatar: tacPrecisionBlastImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '定点爆破' },
  },
  {
    cardId: 'DEMO-TAC-V2-006' as CardId,
    operatorId: 'demo_tac_v2_006',
    codeNameZh: '破片齐射',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacShrapnelSalvoImg, avatar: tacShrapnelSalvoImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '破片齐射' },
  },
  {
    cardId: 'DEMO-TAC-V2-007' as CardId,
    operatorId: 'demo_tac_v2_007',
    codeNameZh: '后排狙杀',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacRearSnipeImg, avatar: tacRearSnipeImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '后排狙杀' },
  },
  {
    cardId: 'DEMO-TAC-V2-008' as CardId,
    operatorId: 'demo_tac_v2_008',
    codeNameZh: '反召唤弹',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacAntiSummonImg, avatar: tacAntiSummonImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '反召唤弹' },
  },
  {
    cardId: 'DEMO-TAC-V2-009' as CardId,
    operatorId: 'demo_tac_v2_009',
    codeNameZh: '急救包',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacMedkitHealImg, avatar: tacMedkitHealImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '急救包' },
  },
  {
    cardId: 'DEMO-TAC-V2-010' as CardId,
    operatorId: 'demo_tac_v2_010',
    codeNameZh: '紧急护盾',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacEmergencyShieldImg, avatar: tacEmergencyShieldImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '紧急护盾' },
  },
  {
    cardId: 'DEMO-TAC-V2-011' as CardId,
    operatorId: 'demo_tac_v2_011',
    codeNameZh: '防线固守',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacBastionCoverImg, avatar: tacBastionCoverImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '防线固守' },
  },
  {
    cardId: 'DEMO-TAC-V2-012' as CardId,
    operatorId: 'demo_tac_v2_012',
    codeNameZh: '掩护撤退',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacBastionCoverImg, avatar: tacBastionCoverImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '掩护撤退' },
  },
  {
    cardId: 'DEMO-TAC-V2-013' as CardId,
    operatorId: 'demo_tac_v2_013',
    codeNameZh: '压制射击',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacSuppressionFireImg, avatar: tacSuppressionFireImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '压制射击' },
  },
  {
    cardId: 'DEMO-TAC-V2-014' as CardId,
    operatorId: 'demo_tac_v2_014',
    codeNameZh: '全线压制',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacSuppressionFireImg, avatar: tacSuppressionFireImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '全线压制' },
  },
  {
    cardId: 'DEMO-TAC-V2-015' as CardId,
    operatorId: 'demo_tac_v2_015',
    codeNameZh: '侧翼掩护',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacRedeploySwapImg, avatar: tacRedeploySwapImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '侧翼掩护' },
  },
  {
    cardId: 'DEMO-TAC-V2-016' as CardId,
    operatorId: 'demo_tac_v2_016',
    codeNameZh: '推进行动',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacBattleRallyImg, avatar: tacBattleRallyImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '推进行动' },
  },
  {
    cardId: 'DEMO-TAC-V2-017' as CardId,
    operatorId: 'demo_tac_v2_017',
    codeNameZh: '破甲弹',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacArmorPierceImg, avatar: tacArmorPierceImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '破甲弹' },
  },
  {
    cardId: 'DEMO-TAC-V2-018' as CardId,
    operatorId: 'demo_tac_v2_018',
    codeNameZh: '电磁干扰',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacEmpSabotageImg, avatar: tacEmpSabotageImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '电磁干扰' },
  },
  {
    cardId: 'DEMO-TAC-V2-019' as CardId,
    operatorId: 'demo_tac_v2_019',
    codeNameZh: '清障行动',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacArmorPierceImg, avatar: tacArmorPierceImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '清障行动' },
  },
  {
    cardId: 'DEMO-TAC-V2-020' as CardId,
    operatorId: 'demo_tac_v2_020',
    codeNameZh: '设施破坏',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacEmpSabotageImg, avatar: tacEmpSabotageImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '设施破坏' },
  },
  {
    cardId: 'DEMO-TAC-V2-021' as CardId,
    operatorId: 'demo_tac_v2_021',
    codeNameZh: '战术分析',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacReconIntelImg, avatar: tacReconIntelImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '战术分析' },
  },
  {
    cardId: 'DEMO-TAC-V2-022' as CardId,
    operatorId: 'demo_tac_v2_022',
    codeNameZh: '集火标记',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacIntelFocusImg, avatar: tacIntelFocusImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '集火标记' },
  },
  {
    cardId: 'DEMO-TAC-V2-023' as CardId,
    operatorId: 'demo_tac_v2_023',
    codeNameZh: '先发制人',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacPreemptiveStrikeImg, avatar: tacPreemptiveStrikeImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '先发制人' },
  },
  {
    cardId: 'DEMO-TAC-V2-024' as CardId,
    operatorId: 'demo_tac_v2_024',
    codeNameZh: '越线校准',
    codeNameEn: 'Tactic Order',
    profession: 'tactic',
    rarity: 3,
    assets: { portrait: tacRearSnipeImg, avatar: tacRearSnipeImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '越线校准' },
  },
  {
    cardId: 'DEMO-SUP-V2-001' as CardId,
    operatorId: 'demo_sup_v2_001',
    codeNameZh: '前线掩体',
    codeNameEn: 'Facility',
    profession: 'support',
    rarity: 2,
    assets: { portrait: facFrontlineBunkerImg, avatar: facFrontlineBunkerImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '前线掩体' },
  },
  {
    cardId: 'DEMO-SUP-V2-002' as CardId,
    operatorId: 'demo_sup_v2_002',
    codeNameZh: '战术通讯终端',
    codeNameEn: 'Facility',
    profession: 'support',
    rarity: 2,
    assets: { portrait: facCommsTerminalImg, avatar: facCommsTerminalImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '战术通讯终端' },
  },
  {
    cardId: 'DEMO-SUP-V2-003' as CardId,
    operatorId: 'demo_sup_v2_003',
    codeNameZh: '观察哨',
    codeNameEn: 'Facility',
    profession: 'support',
    rarity: 2,
    assets: { portrait: facWatchtowerImg, avatar: facWatchtowerImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '观察哨' },
  },
  {
    cardId: 'DEMO-SUP-V2-004' as CardId,
    operatorId: 'demo_sup_v2_004',
    codeNameZh: '战地维修站',
    codeNameEn: 'Facility',
    profession: 'support',
    rarity: 2,
    assets: { portrait: facFieldRepairImg, avatar: facFieldRepairImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '战地维修站' },
  },
  {
    cardId: 'DEMO-SUP-V2-005' as CardId,
    operatorId: 'demo_sup_v2_005',
    codeNameZh: '电子干扰塔',
    codeNameEn: 'Facility',
    profession: 'support',
    rarity: 2,
    assets: { portrait: facJammingTowerImg, avatar: facJammingTowerImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '电子干扰塔' },
  },
  {
    cardId: 'DEMO-SUP-V2-006' as CardId,
    operatorId: 'demo_sup_v2_006',
    codeNameZh: '后勤调度台',
    codeNameEn: 'Facility',
    profession: 'support',
    rarity: 2,
    assets: { portrait: facLogisticsDeskImg, avatar: facLogisticsDeskImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '后勤调度台' },
  },
  {
    cardId: 'DEMO-SUP-V2-007' as CardId,
    operatorId: 'demo_sup_v2_007',
    codeNameZh: '复合装甲',
    codeNameEn: 'Equipment',
    profession: 'support',
    rarity: 2,
    assets: { portrait: eqCompositeArmorImg, avatar: eqCompositeArmorImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '复合装甲' },
  },
  {
    cardId: 'DEMO-SUP-V2-008' as CardId,
    operatorId: 'demo_sup_v2_008',
    codeNameZh: '狙击瞄准镜',
    codeNameEn: 'Equipment',
    profession: 'support',
    rarity: 2,
    assets: { portrait: eqSniperScopeImg, avatar: eqSniperScopeImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '狙击瞄准镜' },
  },
  {
    cardId: 'DEMO-SUP-V2-009' as CardId,
    operatorId: 'demo_sup_v2_009',
    codeNameZh: '源石增幅模块',
    codeNameEn: 'Equipment',
    profession: 'support',
    rarity: 2,
    assets: { portrait: eqOriginiumAmpImg, avatar: eqOriginiumAmpImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '源石增幅模块' },
  },
  {
    cardId: 'DEMO-SUP-V2-010' as CardId,
    operatorId: 'demo_sup_v2_010',
    codeNameZh: '急救组件',
    codeNameEn: 'Equipment',
    profession: 'support',
    rarity: 2,
    assets: { portrait: eqFirstAidImg, avatar: eqFirstAidImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '急救组件' },
  },
  {
    cardId: 'DEMO-SUP-V2-011' as CardId,
    operatorId: 'demo_sup_v2_011',
    codeNameZh: '强袭组件',
    codeNameEn: 'Equipment',
    profession: 'support',
    rarity: 2,
    assets: { portrait: eqAssaultModuleImg, avatar: eqAssaultModuleImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '强袭组件' },
  },
  {
    cardId: 'DEMO-SUP-V2-012' as CardId,
    operatorId: 'demo_sup_v2_012',
    codeNameZh: '战术目镜',
    codeNameEn: 'Equipment',
    profession: 'support',
    rarity: 2,
    assets: { portrait: eqTacticalVisorImg, avatar: eqTacticalVisorImg },
    display: { portraitFit: 'cover', portraitPosition: 'center center' },
    source: { name: 'V1.1 Tactical & Support Kit', notes: '战术目镜' },
  },
];

/** 卡牌表现映射索引 Map */
export const CARD_PRESENTATION_MAP: ReadonlyMap<CardId, CardPresentation> = new Map(
  PRESENTATIONS.map((p) => [p.cardId, p]),
);

/**
 * 获取指定卡牌的视觉表现配置。
 * 若尚未登记（如动态创建的卡），安全生成结构化 fallback，保证永远不返回 undefined。
 */
/**
 * 解析素材 URL：manifest 内路径以 '/' 开头（面向部署根书写）。
 * GitHub Pages 等子路径部署（如 /Arknight/）下必须拼接 Vite BASE_URL（base: './'），
 * 否则浏览器会把 '/assets/...' 解析到域名根导致 404（本地根路径部署不受影响）。
 */
export function resolveAssetUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  const base = import.meta.env.BASE_URL ?? '/';
  return base === '/' ? path : `${base}${path.slice(1)}`;
}

export function getCardPresentation(cardId: CardId): CardPresentation {
  const found = CARD_PRESENTATION_MAP.get(cardId);
  if (found) return found;

  const fallbackId = String(cardId).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return {
    cardId,
    operatorId: `auto_${fallbackId}`,
    codeNameZh: String(cardId),
    codeNameEn: String(cardId),
    profession: String(cardId).includes('TAC') ? 'tactic' : String(cardId).includes('SUP') ? 'support' : 'operator',
    rarity: 3,
    assets: {
      portrait: `/assets/arknights/fallback/${fallbackId}.webp`,
      avatar: `/assets/arknights/fallback/${fallbackId}_icon.webp`,
    },
    display: {
      portraitFit: 'cover',
      portraitPosition: 'center center',
    },
    source: {
      name: 'Auto Generated Presentation Fallback',
      notes: '动态安全降级兜底',
    },
  };
}

interface SummonVisualConfig {
  readonly tokenId: string;
  readonly codeNameZh: string;
  readonly codeNameEn: string;
  readonly profession: string;
  readonly image: string;
}

const SUMMON_VISUAL_MAP: Readonly<Record<string, SummonVisualConfig>> = {
  meebo: {
    tokenId: 'meebo',
    codeNameZh: '机械水獭·咪波',
    codeNameEn: 'Meebo',
    profession: 'specialist',
    image: summonMeeboImg,
  },
  mayer_meebo: {
    tokenId: 'mayer_meebo',
    codeNameZh: '机械水獭·咪波',
    codeNameEn: 'Meebo',
    profession: 'specialist',
    image: summonMeeboImg,
  },
  phantom_shadow: {
    tokenId: 'phantom_shadow',
    codeNameZh: '虚影',
    codeNameEn: 'Phantom Shadow',
    profession: 'specialist',
    image: summonPhantomShadowImg,
  },
  silence_med_drone: {
    tokenId: 'silence_med_drone',
    codeNameZh: '医疗无人机',
    codeNameEn: 'Medical Drone',
    profession: 'medic',
    image: summonSilenceDroneImg,
  },
  nightingale_birdcage: {
    tokenId: 'nightingale_birdcage',
    codeNameZh: '圣域鸟笼',
    codeNameEn: 'Sanctuary Birdcage',
    profession: 'medic',
    image: summonNightingaleCageImg,
  },
  magallan_strike_drone: {
    tokenId: 'magallan_strike_drone',
    codeNameZh: '强击无人机',
    codeNameEn: 'Armed Drone',
    profession: 'supporter',
    image: summonMagallanStrikeImg,
  },
  magallan_support_drone: {
    tokenId: 'magallan_support_drone',
    codeNameZh: '支援无人机',
    codeNameEn: 'Support Drone',
    profession: 'supporter',
    image: summonMagallanSupportImg,
  },
};

export function getSummonPresentation(
  tokenId: string | undefined | null,
  fallback: CardPresentation,
): CardPresentation {
  if (!tokenId) return fallback;
  const spec = SUMMON_VISUAL_MAP[tokenId];
  if (!spec) return fallback;
  return {
    ...fallback,
    operatorId: `summon_${spec.tokenId}`,
    codeNameZh: spec.codeNameZh,
    codeNameEn: spec.codeNameEn,
    profession: spec.profession,
    assets: {
      portrait: spec.image,
      avatar: spec.image,
    },
    display: {
      portraitFit: 'cover',
      portraitPosition: 'center center',
    },
    source: {
      name: 'Rhodes Island Tactical Summon Visuals',
      notes: spec.codeNameZh,
    },
  };
}
