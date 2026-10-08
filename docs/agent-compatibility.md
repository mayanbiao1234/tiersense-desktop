# Agent 接入与推理历史兼容（0.4.7）

支持范围为本机 OpenAI Chat Completions：WorkBuddy、OpenClaw、OpenCode。各软件的入口说明和可复制配置在客户端「连接 AI 工具 → 按软件查看连接步骤」，首次设置第三步也有同一入口。配置片段应合并至既有配置，不覆盖其他渠道或工具设置。

## 共同设置

- Base URL：以客户端显示的实际端口为准，默认 `http://127.0.0.1:18420/v1`。
- API Key：客户端生成的本地密钥，不是 TierSense 或上游渠道密钥。
- Model：`tierflow-auto`；在客户端模型池里填写厂商实际 API 模型 ID。WorkBuddy 中的显示名称和 `custom-local:...` 标识不作为厂商模型 ID。
- 所有工具都需要每次发送完整 Chat 消息历史。工具定义、选择参数、并行工具调用、上游 usage 及原始 SSE 字节继续透传。
- 只提供 Chat Completions，未新增 Responses、Anthropic Messages 或服务端历史 ID 接口；没有修改 Agent 的工具执行、权限或上下文压缩策略。

## 软件配置要点

| 软件 | 接入方式 | 推理历史 |
| --- | --- | --- |
| WorkBuddy | 设置 → 模型 → 自定义；默认关闭“自定义协议”，填 Base URL；开启时须填完整 `/v1/chat/completions` 地址 | 新版网关对缺失/空的字段尝试恢复；不修改 WorkBuddy 安装文件或用户配置 |
| OpenClaw | `models.providers.tiersense`，`api: "openai-completions"`，选择 `tiersense/tierflow-auto` | 在自定义模型 `compat` 中启用 `requiresReasoningContentOnAssistantMessages`；更新不能识别该字段的旧版软件 |
| OpenCode V1 | `provider` / `npm: "@ai-sdk/openai-compatible"` / `options.baseURL` | 模型中设置 `reasoning: true`、`interleaved: { field: "reasoning_content" }` |
| OpenCode V2 | `providers` / `package: "@opencode/ai/providers/openai-compatible"` / `settings.baseURL` | 使用相同的推理字段声明；请按安装版本选择配置模板 |

配置模板的 32K 上下文、4K 输出仅是示例限制，不是对模型能力的认证。应不超过候选池最小上限。图片输入按实际模型池能力配置，模板仅声明文本。上游未返回 usage 时不编造 Token、缓存或费用。

## DeepSeek 修复机制

当前官方文档要求：思考模式下只要请求携带 `tools`，后续请求要回传历史 assistant 的 `reasoning_content`，包括未实际触发工具的轮次。不携带 tools 时，官方说明历史推理会被忽略。用户反馈的模型名称为 DeepSeek v4.1 Flash；网关按所配置的实际 ID 转发，不硬编码或猜测该模型名。

0.4.6 只按目标模型和完整消息匹配缓存，无法覆盖步骤级跨模型接力。根据 WorkBuddy 5.5.6 的实际错误记录，失败前存在 Qwen → DeepSeek → Qwen → DeepSeek 切换；WorkBuddy 还会把一条回复拆成文字消息和多个 assistant/tool 对，并在部分内部历史中使用 `reasoning` 别名。0.4.7 在后台补偿这些差异，常规接入仍然只需地址、密钥和模型名称：

1. 普通完整响应或完整 SSE 的推理原文保留在内存，按完整可见历史的哈希查找。流式先收到 `[DONE]` 就可用于立即到来的后续请求。
2. 缺失、null 或空字符串可补回；已有非空内容不覆盖。识别 `reasoning` 字符串别名并原样回填 `reasoning_content`。指纹忽略已知客户端元数据，统一纯文本块、空内容、工具索引和参数字符串外空白的等价表示；不改写内容、工具参数或执行顺序。
3. 同一本地模型池共享对话缓存，切换模型或已有渠道时可回传上一模型真正生成的推理。渠道集合、地址、上游密钥、本地密钥或请求 user 变化时隔离。
4. 对拆分工具回复，组合首个用户消息的哈希、完整工具 ID/名称/参数指纹进行查找；多个工具必须属于同一条已捕获回复。仅在相邻文字内容也与该回复匹配时补回其推理。不同对话、改写工具或歧义不猜测，重复工具身份的歧义在淘汰时也保留。普通文字回复仍按完整历史匹配。
5. 仅使用完成的 stop/tool_calls/function_call 响应的原文；中断、错误、长度截断等不能作为完整推理回传。原始 JSON/SSE 仍转发，不拼造推理或关闭思考模式。
6. 0.4.8 起内存最多 1,024 条、32 MiB、24 小时，单次捕获有 1 MiB 上限；工具索引随条目一同淘汰，不截短推理。默认不落盘，停止服务和退出清空；可在设置中主动开启“重启后继续已有对话”，将必要推理与哈希指纹写入本机系统加密文件。关闭该选项会删除文件、保留本次运行的内存；清空兼容缓存或轮换本地密钥会清除内存和文件。过期记录不可恢复，应用关闭期间无法定时删除，下次启动清理。
7. 上游返回明确的 reasoning_content 缺失 400 时，给出 `reasoning_history_missing` 与简短提示；不自动重试 400，不将可能包含私密信息的上游错误原文交给 UI。

**边界：** 已通过当前网关捕获的其他模型推理能够恢复；升级前已丢失的原文、未开启重启恢复时退出后丢失的字段，以及无法匹配的压缩/改写历史，仍无法凭空补全。升级后可在 WorkBuddy 新建对话验证，已有三项接入参数不变。缓存补偿不能替代 Agent 持久保存推理历史。

## 验证口径

本地严格模拟 Qwen → Qwen → DeepSeek → Qwen → Qwen → DeepSeek 的实际切换顺序，包括普通文字、拆分并行工具回复、推理别名、JSON/SSE 和下一轮用户问题；另覆盖缓存隔离、歧义、过期、容量限制、失败流和错误脱敏。

另通过 Qwen 渠道和 DeepSeek 官方渠道发送独立的短测试任务，确认 Qwen 工具回复经 WorkBuddy 式拆分和字段丢弃后，可切换到 `deepseek-flash` 并继续下一轮，保持思考模式。测试只使用合成内容，TierSense 评分用本机固定结果以确保路由顺序。这不是三款 Agent 所有版本的完整实机验收，仍需按实际 AI 工具版本和工作流验证。

## 官方参考（2026-10-08 核对）

- [DeepSeek 思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)
- [WorkBuddy 模型配置](https://www.codebuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)
- [OpenClaw 自定义渠道与能力声明](https://github.com/openclaw/openclaw/blob/main/docs/gateway/config-tools/custom-providers.md)
- [OpenCode V1 自定义提供商](https://opencode.ai/docs/providers/#custom-provider)
- [OpenCode 配置 Schema](https://opencode.ai/config.json)
- [OpenCode V2 提供商](https://opencode.ai/v2/docs/providers/)
