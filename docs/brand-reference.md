# TierFlow Desktop 品牌对齐

参考：2026-10-07 的 TierFlow 云端控制台 `https://tierflow.cn/usage`。

- 完整 Logo：`https://tierflow.cn/tsingshu_ai_logo.svg`，原文件保存至 `public/tsingshu_ai_logo.svg`，用于侧栏。
- TierSense 使用自己的官方标识 `https://tierflow.cn/tiersense-logo.svg`：原始字标用于订阅页，从同文件提取的原始图形用于路由示意与连接区；不以清枢智汇图标代替。
- 应用图标：从同一 SVG 的 `symbol` 图形组提取，保留原始几何路径、黑灰边框和橙色圆点；用于窗口、任务栏、Windows 可执行文件和 favicon。
- 主色 `#2760F5`；链接/引导蓝 `#2D5CFA`；浅蓝底 `#EDF2FF`。
- 控制台背景 `#F9FAFD`；导航选中底 `#E6E9EF`；边框 `#E7E9F0`。
- 主文字 `#0A0A0A`，次文字 `#666666`；蓝色胶囊按钮、圆角导航、白色卡片和淡蓝渐变。
- 字体沿用云端 `PingFang SC / Inter Variable / Inter`，补充 Windows 中文字体回退；Inter 拉丁字形本地打包，许可证见 `public/fonts/Inter-OFL.txt`。

`src/brand.css` 集中维护品牌样式，不影响网关、密钥存储或路由行为。`scripts/brand-icons.mjs` 生成 PNG/ICO，`scripts/brand-executable.cjs` 将图标写入 Windows 构建产物。无需在线加载品牌图片或字体。

## 0.2.2 模型渠道预设

地址于 2026-10-07 核对，适配本地网关的 OpenAI Chat Completions 协议。仅用于新增渠道的表单默认值，不改写已有配置；不同地域或套餐可能有独立地址。

| 渠道 | 默认 Base URL | 官方参考 |
| --- | --- | --- |
| TierFlow | `https://tierflow.cn/v1` | https://tierflow.cn （官网 SDK 示例以当前站点 origin + `/v1` 为基础地址） |
| DeepSeek | `https://api.deepseek.com` | https://api-docs.deepseek.com/guides/codex |
| 智谱 AI | `https://open.bigmodel.cn/api/paas/v4` | https://docs.bigmodel.cn/cn/best-practice/case/ai-search-engine |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | https://help.aliyun.com/en/model-studio/base-url |
| 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | https://api.volcengine.com/api-docs/view?action=GetAFPUsage&serviceCode=ark&version=2024-01-01 |
| Kimi | `https://api.moonshot.cn/v1` | https://platform.kimi.com/docs/get-api-key |
| MiniMax | `https://api.minimax.cn/v1` | https://platform.minimax.cn/docs/api-reference/text-openai-api |
| 腾讯混元 | `https://api.hunyuan.cloud.tencent.com/v1` | https://cloud.tencent.com/document/product/1729/116755 |
| 硅基流动 | `https://api.siliconflow.cn/v1` | https://docs.siliconflow.cn/docs/userguide/guides/function-calling |

渠道图标使用 [Lobe Icons](https://github.com/lobehub/lobe-icons) 的静态品牌 SVG，固定提交 `c385b2b8d1f9e19aa86e628d4e23c91ee1111a47`，来源目录 `packages/static-svg/icons`。文件保存在 `public/providers/`，保留原图形；百炼使用 Qwen 标识，方舟使用火山引擎标识，其他使用对应品牌标识。图标库 MIT 许可证随安装包保存在同目录 `lobe-icons-LICENSE.txt`。商标归各品牌所有，渠道预设不表示品牌合作或背书。

0.2.3 新增 TierFlow，并作为预设列表首项和新增渠道的默认选项。TierFlow 图标复用已对齐云端的 `public/icon.svg`，保存为 `public/providers/tierflow.svg`；该图标来自清枢智能的原始品牌资产，不属于 Lobe Icons。
