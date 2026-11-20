# Arknight V1.1 Google AI Studio开发交接包

本包用于在 **Google AI Studio Build（Web app）** 中，对现有 `hhlaugh/Arknight` 项目实施V1.1棋盘、规则引擎、经济系统和108张卡牌适配。

**这不是从零生成新游戏的提示词包。** 必须导入现有仓库，先审计实际代码，再按阶段修改。

## 推荐使用流程

### 1. 先准备安全的开发副本

- 建议先在GitHub创建独立的V1.1开发分支或仓库副本，不要直接在默认分支上试验。
- 确认当前仓库已有代码、分支和未提交修改已备份。
- 如果仓库为私有仓库，确认Google AI Studio导入GitHub时使用的账号有访问权限。

### 2. 在Google AI Studio导入现有项目

1. 打开 <https://aistudio.google.com/>，进入 **Build**。
2. 选择构建 **Web app**，不要选择Android app。
3. 在提示输入框旁打开 **Add files（+）**，选择 **Import from GitHub**，导入开发副本 `hhlaugh/Arknight`。
4. 确认右侧预览和 **Code** 视图显示的是现有项目文件，而不是新建的空白模板。
5. 将本交接包的文件加入项目上下文。推荐将整个解压目录放入仓库的 `docs/v1.1-handoff/`；也可以使用AI Studio的Add files添加本包中的Markdown、CSV和JSON文件。如果ZIP无法直接读取，请先在本地解压，不要要求代理猜测压缩包内部内容。

官方操作说明：<https://ai.google.dev/gemini-api/docs/aistudio-build-mode>

### 3. 先审计，后改代码

- 打开 `AI_STUDIO_EXECUTION_PROMPT.md`，将全文发送给AI Studio Build代理。
- 首轮只允许执行架构审计，不允许直接大规模修改代码。
- 检查审计报告中的真实文件路径、架构差异和测试计划。
- 审计通过后，按 `AI_STUDIO_PHASE_PROMPTS.md` 从阶段1到阶段7逐步执行。
- 每个阶段完成后使用文末的“通用复核提示”，检查实际代码差异、预览和测试，再进入下一阶段。

### 4. 检查和同步

- 在AI Studio的Code视图检查修改文件，在预览中检查界面和棋盘行为。
- 尽可能运行项目既有的typecheck、lint、build和自动化测试；不能运行的测试必须标记为“未运行”。
- 在Google AI Studio Settings → GitHub中管理仓库连接和双向同步。只在用户检查后同步到开发分支；不要未经确认合并到默认分支。
- 可从Code视图下载ZIP，留存阶段备份。不要在测试通过前部署到Cloud Run。

## 本包文件权威顺序

- `spec/V1_1_IMPLEMENTATION_SPEC.md`：V1.1统一规则基线；3→8 CP逐玩家回合成长并在回合结束清零。
- `data/ARKNIGHT_V1_1_CARD_POOL_108_MASTER.csv`：60列主数据，含V1.1费用和审计元数据。
- `data/ARKNIGHT_V1_1_CARD_POOL_108_ENGINE_50COL.csv`：原V3.3的50列兼容表，`command_cost_cp`已更新为V1.1建议费用。
- `data/KEYWORD_DICTIONARY_V1_1.csv`：关键词语义。
- `data/RULE_DECISIONS_V1_1.csv`：已确认项、建议项和待核验项。
- `data/V1_1_COST_CHANGELOG.csv`：相对V3.3的费用变化。
- `spec/OPEN_DECISIONS_DO_NOT_GUESS.md`：未决事项，不得擅自定案。
- `spec/BOARD_PROFILE_SCHEMA.json` / `spec/BOARD_PROFILE_EXAMPLES.json`：棋盘配置数据结构。
- `AI_STUDIO_PHASE_PROMPTS.md`：逐阶段执行提示词。
- `reference/`：原V3.3数据和旧版本文档，只作差异核验。

如不同文件出现冲突，先报告冲突，不得静默选择一种解释。

## V1.1重要变更摘要

- 经典棋盘：3路线，每路前排1格、后排1格。
- 自定义棋盘：1–5路线，每路前/后排分别最多3格。
- 每路独立显示F1–F3/R1–R3；内部使用路线、前后排、排内格位排序，不向玩家显示全局1–30编号。
- 只有直接相邻路线才相邻；默认禁止跨路移动，除非效果明确授权。
- 普通攻击索敌：嘲讽 > 玩家集火目标指令 > 单位自身索敌；均不扩大合法范围。
- 伤害管线：攻击力/持续修正 > 当前攻击【集火】 > 【脆弱】等受伤修正 > 掩护 > 护盾 > HP。
- CP：每名玩家自己的回合基础CP为3、4、5、6、7、8，之后保持8；回合开始重置、结束清零；当回合CP上限=min(10,基础CP+2)。
- 维护失败：视为击倒，进入弃牌堆，不回手、不退款、不进入再部署冷却。
- 普通主动撤离保留，但不退款。
- 设施统一3 HP，占格，按位置参与普通攻击目标优先级。
- 战术卡使用后弃牌、不占格；装备卡使用后弃牌、不占格，装备效果包采用目标单位单槽覆盖解释。
- 召唤物占格、按普通单位待遇参与合法效果；允许主动回收，回收视为摧毁，不回手、不退款、不计敌方击杀回费。
- 当前108张卡费用：1CP×5、2CP×29、3CP×48、4CP×22、5CP×3、6CP×1；没有超过8 CP的卡。

## 数据验证摘要

- 总卡数108，`card_id`唯一。
- 类别：72干员、24战术、6设施、6装备。
- 建议费用范围1–6 CP，单卡设计硬上限8 CP。
- `attack_profile_json`：72个非空且可解析；战术/支援为空符合字段用途。
- `trigger_events_json`、`skill_effects_json`、`native_traits_json`：108行均可解析。
- 6张设施HP均为3；设施占格；6张装备不占格。
- JSON可解析不代表每个操作符都已在现有引擎实现，必须逐项映射与运行时测试。

## 重要限制

费用曲线尚未通过机器人胜率验证。冻结细节、护盾上限、集火指令的设置时点、设施失效期间持续时间等边界规则仍待核验，见 `spec/OPEN_DECISIONS_DO_NOT_GUESS.md`。本包是规则/数据/实施规格交接，不代表程序已经实现，也不代表测试已通过。

**不要仅因为开发环境是Google AI Studio就新增Gemini API调用。** 本游戏规则引擎和机器人对局应保持确定性；只有用户明确要求AI功能且完成成本/密钥设计时，才新增模型调用。
