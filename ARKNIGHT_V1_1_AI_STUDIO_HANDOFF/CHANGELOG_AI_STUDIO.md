# AI Studio交接包修改说明

本包由原 V1.1 代码代理交接包转换而来。

## 修改内容
- 将执行入口和README改为Google AI Studio Build模式工作流。
- 新增逐阶段提示词，避免单轮要求代理一次性重写整个项目。
- 明确先导入现有GitHub项目，再审计真实架构；不从空白项目重建。
- 明确保持现有Web技术栈，不迁移到Android、Kotlin、Unity或其他框架。
- 增加GitHub分支/同步保护、AI Studio Code视图/预览复核步骤。
- 明确Google AI Studio只是开发环境，不因此为游戏添加不必要的Gemini API调用。
- 将规则文档中面向Codex的称谓改成通用开发代理/AI Studio开发代理。

## 未修改内容
- V1.1游戏规则、未决事项和数值建议。
- 108张卡牌数据、费用、关键词、BoardProfile schema与示例。
- 原始V3.3参考数据与费用验证统计。

本包仍是实施交接稿，不代表游戏代码已经按V1.1完成。
