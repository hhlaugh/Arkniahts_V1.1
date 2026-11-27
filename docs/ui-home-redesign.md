# 舟塔自走牌 V1.1 — 首页视觉审计与重构方案 (`docs/ui-home-redesign.md`)

> **适用范围：** 仅针对首页 `StartView`（`src/views/StartView.tsx`）及其直接依赖的共享样式与文档；不修改 `BattleView`、规则引擎、AI、联机、抽卡概率、卡组业务或账户存档逻辑。  
> **设计方向：** Arknights / Rhodes Island Industrial Sci-Fi Tactical Command Terminal（罗德岛 PRTS 近未来军事工业风战术指挥中心）。

---

## 1. Phase 0 视觉审计结论

### 1.1 现有可复用组件
| 组件 / 模块 | 位置 | 现状与复用方式 |
|---|---|---|
| `Panel` | `src/components/ui/Panel.tsx` | 已内置深灰钛金属色调、`holo-panel` 投影、顶部基准线、四角微定位线标、拉丝合金底纹、切角 (`cornerCut`) 与可选扫描线/网格；可直接作为指挥中心主视觉与功能模块外壳。 |
| `Button` | `src/components/ui/Button.tsx` | 已内置 `.holo-btn` 微斜面质感、悬停扫光 (`::before`)、边角微刻度线与 `primary` / `outline` / `secondary` / `ghost` 变体；首页主 CTA 与系统栏操作继续复用。 |
| `Badge` | `src/components/ui/Badge.tsx` | 已支持 `unboxed` 文本分隔与无圆角工业标签；可用于规则按钮缺失时的版本提示降级。 |
| `OrundumIcon` | `src/components/ui/OrundumIcon.tsx` | 真实合成玉实物图标 (`./assets/arknights/items/orundum.png`)，支持 `xs`/`sm`/`md`/`lg` 四档尺寸与 `data-testid="orundum-icon"`。 |
| `ScenicBackdrop` & `ScenicBannerLayer` | `src/components/ui/ScenicBackdrop.tsx` | 方向性渐变遮罩 + 暗角遮罩层，已内置 `rhodes-bridge`、`rhodes-exterior`、`rhodes-command`、`lungmen-night`、`snowfield`、`terra-landscape` 场景配置；可直接复用保证 4.5:1 以上文本对比度。 |
| `RhodesWatermarkBackdrop` | `src/components/ui/RhodesWatermark.tsx` | 全屏罗德岛白盾斜向暗纹与双角主徽章水印；继续作为空间纵深衬底。 |
| `TacticalCornerBrackets` & `TacticalCornerSlashes` | `src/components/ui/TacticalCornerBrackets.tsx` | 新增纯 SVG 阶梯护框与斜杠刻度组件：采用 45° 切角双层导轨与工业斜杠标识，用于全息主窗及作战子模式边框边角。 |
| `tokens.ts` & `terminal.css` | `src/components/ui/tokens.ts`, `src/styles/terminal.css` | 已定义 PRTS 深灰黑/石墨灰/钛金属灰底色、战术黄 `#e5a52b`、友方蓝 `#38bdf8`、敌方红 `#fb7185`、切角 `CORNER_CUTS`；新增 `.prts-grad-frame` / `.prts-grad-divider` 亮→淡→亮对称渐变边框体系及 `prefers-reduced-motion` 降级规则。 |

### 1.2 现有可复用素材（兼容 GitHub Pages `./` 相对路径）
- **场景背景 (`./assets/arknights/backgrounds/`)**：
  - `bg_rhodes_bridge.png`（16:9 罗德岛舰桥走廊 — 全屏主背景首选）
  - `bg_rhodes_command.png`（16:9 罗德岛作战指挥中枢 — 单人战术演习子卡环境）
  - `bg_rhodes_exterior.png`（16:9 罗德岛本舰外部远景 — 作战中枢主视觉区）
  - `bg_lungmen_night.png`（16:9 龙门夜景 — 作战窗口内 P2P 联机子卡环境）
  - `bg_snowfield.png`（16:9 极地雪原 — 仅测试版本地热座子卡环境）
  - `bg_terra_landscape.png`（16:9 泰拉远景 — 干员图鉴模块）
- **自研静态视觉资产 (`src/assets/images/` via Vite static import)**：
  - `tactical_command_backdrop_1795044168530.jpg`（全息战术沙盘指挥室 — 辅助卡组构筑模块）
  - `headhunting_banner_art_1795044169776.jpg`（源石光束寻访通道 — 辅助干员寻访模块）
  - `titanium_hud_surface_1795070730280.jpg`（拉丝钛金属面板底纹，已集成于 `Panel`）
- **品牌标识与道具 (`./assets/arknights/`)**：
  - `logos/prts_badge.svg`、`logos/prts_diamond.png`、`logos/rhodes_island_dark.png`、`logos/rhodes_island_light.png`
  - `items/orundum.png`

### 1.3 原有首页布局与视觉问题
1. **居中孤岛式小面板浪费大屏空间**：原 `StartView` 在 `1440×900` / `1920×1080` 视口下仅渲染一个居中的 `max-w-4xl` 弹窗式卡片，四周大面积留白，缺少 PRTS 战术指挥中心的空间纵深感。
2. **作战入口分散与边界平淡**：早期将「人机作战」与「好友联机」拆散在不同区域且边框为单色等亮细线，缺乏作战总控窗口的整合感与机械护框质感。
3. **入口层级趋同**：次级模块与主作战入口尺寸、背景透明度与视觉权重接近，缺少战术优先级划分。
4. **顶部状态栏与底部结构耦合**：顶部操作栏、Hero、入口区与存档区全部挤在同一个边框盒子内，层级扁平。

### 1.4 拟修改文件清单
- `docs/ui-home-redesign.md`（首页视觉审计与重构方案说明）
- `src/components/ui/TacticalCornerBrackets.tsx`（新建精密工业阶梯 SVG 边角护框与斜杠刻度装饰组件）
- `src/styles/terminal.css`（新增 `.prts-grad-frame` / `.prts-grad-divider` 亮→淡→亮渐变边框、克制入场/呼吸光动效及 `prefers-reduced-motion` 兼容规则）
- `src/views/StartView.tsx`（重构为双栏全息作战总控窗口 + 下层整备/档案终端，人机与联机统一归入右侧作战模式栈并联动左侧简报）
- `src/views/app-regression.test.tsx`（补充统一作战窗口标识与结构断言，保持原有回归保护）

### 1.5 功能保护与风险点
- **测试版本隔离风险**：仅当 `activeIsTest === true`（`isTestVersion` 或 `hhlaugh-1` / `hhlaugh-2`）时显示本地热座，且界面中绝不泄露 `hhlaugh-1` / `hhlaugh-2` 账号名或隐藏测试开关。
- **既有回归测试契约**：`app-regression.test.tsx` 与 `components.test.tsx` 对标题、说明文本、素材路径、`holo-panel`/`holo-btn`/`holo-frame`、`📖 规则说明`、`60000 合成玉`、禁用词（`招募`、`PROTOCOL`、`animate-pulse`、`玩家 A/B`）存在明确断言，改造须 100% 遵守。
- **GitHub Pages 路径风险**：`vite.config.ts` 使用 `base: './'` 并复制 `assets/arknights` 与 `src/assets`，所有资源须沿用 `./assets/...` 或 ES 模块静态 `import`，禁止硬编码 `/assets/...` 根路径。

---

## 2. 目标空间架构（首页布局方案）

```text
+---------------------------------------------------------------------------------------+
| [PRTS Logo + 终端标题 + v1.1]             [博士档案 · 合成玉 · 收录]  [规则 | 设置 | 登出] |  <- 顶部战术系统栏
+---------------------------------------------------------------------------------------+
| +- 亮→淡→亮全息作战主窗 + 阶梯 SVG 护角 -----------------------------------------------+ |
| | OPERATIONS · 作战中枢                       | COMBAT MODES · 作战模式               | |
| | 舟塔自走牌 · 主视觉展示 + 4 项战备条形参数  |  [//// 演习项目 01] 单人战术演习(高亮) | |
| | -- 亮→淡→亮水平分割线 --                    |  [//// LINK-01]    博士联机演习(P2P)  | |
| | BRIEFING · 模式简报 (随悬停/聚焦实时切换)   |  [//// TEST-01]    本地热座(仅测试版) | |
| +---------------------------------------------+---------------------------------------+ |
+---------------------------------------------------------------------------------------+
|  [MOD-02 卡组构筑器] [MOD-03 干员寻访] [MOD-04 图鉴] |  [ARCHIVE-IO 博士神经档案与备份坞] |  <- 下层战备与档案区
+---------------------------------------------------------------------------------------+
|  PRTS 战术演习终端 v1.1 · 支持多博士档案管理与 JSON 备份    RHODES ISLAND EXERCISE ...  |  <- 底部信息栏
+---------------------------------------------------------------------------------------+
```

- **Desktop (`1440×900` / `1920×1080`)**：`max-w-[1440px]` 全幅战术网格布局，核心双栏全息作战主窗将「作战中枢展示 + 动态模式简报」与「人机 / P2P 联机 /（测试热座）作战模式栈」整合于同一亮→淡→亮护框窗口内，首屏完整呈现。
- **Tablet (`768×1024`) & Mobile (`390×844`)**：自适应退化为单列/双列紧凑堆叠，确保无水平溢出、触摸目标清晰、背景对比度稳定。
