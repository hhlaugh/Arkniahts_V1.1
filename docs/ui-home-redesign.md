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
| `tokens.ts` & `terminal.css` | `src/components/ui/tokens.ts`, `src/styles/terminal.css` | 已定义完整的 PRTS 深灰黑/石墨灰/钛金属灰底色、战术黄 `#e5a52b`、友方蓝 `#38bdf8`、敌方红 `#fb7185`、切角 `CORNER_CUTS` 与 `prefers-reduced-motion` 降级规则。 |

### 1.2 现有可复用素材（兼容 GitHub Pages `./` 相对路径）
- **场景背景 (`./assets/arknights/backgrounds/`)**：
  - `bg_rhodes_bridge.png`（16:9 罗德岛舰桥走廊 — 全屏主背景首选）
  - `bg_rhodes_command.png`（16:9 罗德岛作战指挥中枢 — 主视觉战术演习区环境）
  - `bg_rhodes_exterior.png`（16:9 罗德岛本舰外部远景 — 舰桥战略视野辅助层）
  - `bg_lungmen_night.png`（16:9 龙门夜景 — P2P 联机信标入口）
  - `bg_snowfield.png`（16:9 极地雪原 — 仅测试版本地热座入口）
- **自研静态视觉资产 (`src/assets/images/` via Vite static import)**：
  - `tactical_command_backdrop_1795044168530.jpg`（全息战术沙盘指挥室 — 辅助卡组构筑模块）
  - `headhunting_banner_art_1795044169776.jpg`（源石光束寻访通道 — 辅助干员寻访模块）
  - `titanium_hud_surface_1795070730280.jpg`（拉丝钛金属面板底纹，已集成于 `Panel`）
- **品牌标识与道具 (`./assets/arknights/`)**：
  - `logos/prts_badge.svg`、`logos/prts_diamond.png`、`logos/rhodes_island_dark.png`、`logos/rhodes_island_light.png`
  - `items/orundum.png`

### 1.3 原有首页布局与视觉问题
1. **居中孤岛式小面板浪费大屏空间**：原 `StartView` 在 `1440×900` / `1920×1080` 视口下仅渲染一个居中的 `max-w-4xl` 弹窗式卡片，四周大面积留白，缺少 PRTS 战术指挥中心的空间纵深感。
2. **主次动作倒置**：原 Hero 区域右侧放置了「干员寻访 / 卡组构筑 / 干员图鉴」三颗按钮，而核心入口「进入作战 / 单人战术演习」被压缩在下方平铺的 2~3 张等权重小卡片中，视觉焦点不明确。
3. **入口层级趋同**：单人演习、P2P 联机、热座卡片尺寸、背景透明度与按钮风格几乎完全一致，缺乏战术优先级划分。
4. **顶部状态栏与底部结构耦合**：顶部操作栏、Hero、入口区与存档区全部挤在同一个边框盒子内，层级扁平；部分嵌套 `<div onClick>` 内包裹 `<Button>`，键盘焦点与可访问性不够理想。

### 1.4 拟修改文件清单
- `docs/ui-home-redesign.md`（新建视觉审计与设计说明）
- `src/styles/terminal.css`（补充轻量、克制的指挥终端首页入场/环境光微动效与 `prefers-reduced-motion` 兼容规则，不新建冲突色板）
- `src/views/StartView.tsx`（全面重构为全屏多层级 PRTS 战术指挥中心，保留 100% 现有 Props、账户逻辑与功能入口）
- `src/views/app-regression.test.tsx`（如需适配，仅补充首页结构/可访问性断言，不削弱原有回归保护）

### 1.5 功能保护与风险点
- **测试版本隔离风险**：仅当 `activeIsTest === true`（`isTestVersion` 或 `hhlaugh-1` / `hhlaugh-2`）时显示本地热座，且界面中绝不泄露 `hhlaugh-1` / `hhlaugh-2` 账号名或隐藏测试开关。
- **既有回归测试契约**：`app-regression.test.tsx` 与 `components.test.tsx` 对标题、说明文本、素材路径、`holo-panel`/`holo-btn`/`holo-frame`、`📖 规则说明`、`60000 合成玉`、禁用词（`招募`、`PROTOCOL`、`animate-pulse`、`玩家 A/B`）存在明确断言，改造须 100% 遵守。
- **GitHub Pages 路径风险**：`vite.config.ts` 使用 `base: './'` 并复制 `assets/arknights` 与 `src/assets`，所有资源须沿用 `./assets/...` 或 ES 模块静态 `import`，禁止硬编码 `/assets/...` 根路径。

---

## 2. 目标空间架构（首页布局方案）

```text
+-----------------------------------------------------------------------------------+
| [PRTS Logo + 终端标题 + v1.1]         [博士档案 · 合成玉 · 收录]  [规则 | 设置 | 登出] |  <- 顶部战术系统栏
+-----------------------------------------------------------------------------------+
|  PRTS-CMD · 01 · RHODES ISLAND TACTICAL COMMAND        +-----------------------+  |
|  舟塔自走牌                                            | [bg_rhodes_command]   |  |
|  主标题 + 战术简报                                      | 演习状态与编队参数    |  |  <- 主视觉区域（全宽重心）
|  [ 开始演习 · 单人战术对抗 (Primary CTA) ]             | (真实编制/收录/玉数据)|  |
+--------------------------------------------------------+-----------------------+  |
|  [MOD-02 卡组构筑器]          [MOD-03 干员寻访]          [MOD-04 罗德岛干员图鉴]  |  <- 次级整备模块（差异化权重）
+-----------------------------------------------------------------------------------+
|  [LINK-01 P2P 好友联机] (+ [TEST-01 本地热座]) |  [博士神经档案 · 切换/新建/JSON备份] |  <- 联机入口 + 档案坞
+-----------------------------------------------------------------------------------+
|  PRTS 战术演习终端 · 72 位干员完整收录体系              RHODES ISLAND TERMINAL       |  <- 底部信息栏
+-----------------------------------------------------------------------------------+
```

- **Desktop (`1440×900` / `1920×1080`)**：`max-w-[1440px]` 全幅战术网格布局，首屏即可完整呈现指挥中心空间感与全部一级/二级入口。
- **Tablet (`768×1024`) & Mobile (`390×844`)**：自适应退化为单列/双列紧凑堆叠，确保无水平溢出、触摸目标 `>= 44px`、背景对比度稳定。
