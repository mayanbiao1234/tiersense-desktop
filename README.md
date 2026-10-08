<p align="center"><img src="public/tiersense-logo.svg" alt="TierSense" width="240" /></p>

# TierFlow Desktop · 由 TierSense 驱动

**智能选模，搭配刚刚好**

在自己的电脑上管理多个模型平台的 API，由 TierSense 判断每一步任务的难度，自动选择合适的模型。继续使用你习惯的 AI 工具，只需填写本地服务地址、访问密钥和模型名称。

[下载 Windows 体验版](https://github.com/mayanbiao1234/tiersense-desktop/releases/tag/v0.4.10) · [三步上手](docs/getting-started.md) · [反馈问题](https://github.com/mayanbiao1234/tiersense-desktop/issues/new/choose) · [官网](https://tierflow.cn)

## 下载与安装

当前体验版：**0.4.10 · Windows x64**。

在 Release 的 **Assets** 中下载 `TierFlow-Setup-0.4.10.exe`，运行后按向导安装即可。支持选择安装位置、桌面和开始菜单快捷方式；无需 Node.js、Python、源码或固定盘符。

已有用户请先从右下角托盘菜单选择「退出 TierFlow」，再安装新版。点击窗口 × 只会收起到托盘，已启动的服务仍会运行。

这是未签名的体验版，Windows 可能提示无法验证发布者。请核对下载来源和 Release 附带的 SHA-256。当前 Release 仅分发 Windows 版本；macOS 代码与构建脚本保留在仓库中，尚未完成当前版本的实机验证、签名和公证。

## 三步开始

先准备：至少一个模型平台的访问密钥，以及用于难度判断的 TierSense 密钥（可在 [tierflow.cn](https://tierflow.cn) 获取）。

1. **连接服务**：选择模型渠道，填写密钥，获取并勾选模型；连接 TierSense。
2. **安排模型**：按综合难度设置档次，同一档内再安排不同模型擅长的任务。
3. **连接 AI 工具**：开启路由，将客户端显示的 **Base URL、API Key、Model** 填入工具的 OpenAI 兼容配置。

默认模型请求名称是 `tierflow-auto`。访问密钥请复制客户端生成的本地密钥，不要把示例字符串当作真实密钥。

## 它如何选择模型

```text
AI 工具发来一个步骤的请求
          ↓
TierSense 返回综合难度和五个维度评分
          ↓
先按综合难度确定档次
          ↓
在该档内按维度分工、规则优先级选择模型
          ↓
通过你配置的渠道调用模型，结果返回 AI 工具
```

例如，两款模型都放在旗舰档：编程难时优先选 GLM，规划难时优先选 Qwen。编程维度高但综合难度未达到旗舰档时，仍在综合难度对应的档次中选择。

## 主要功能

- **自己的渠道和模型池**：预置 TierFlow、DeepSeek、智谱、百炼、火山方舟、Kimi、MiniMax、混元、硅基流动，也支持自定义 OpenAI 兼容地址；自动获取模型列表，支持手动添加。
- **灵活分档与分工**：1–20 个档次、综合难度分界、同档模型顺序、五维条件和优先级；工具调用及图片能力按实际模型配置。
- **日常桌面工作台**：三步配置引导、渠道和模型搜索筛选、托盘启停、界面缩放、窗口位置记忆、未保存提醒。
- **调用与用量**：模型占比、Token、上游返回的缓存用量、按自填单价估算费用；未提供的数据不冒充零费用。
- **部分渠道余额查询**：DeepSeek、Kimi、硅基流动官方接口；其他渠道按支持情况展示。TierFlow 余额查询尚待接口接入。
- **故障处理**：对符合条件的上游错误尝试备用模型，暂时跳过明确不可用的模型或渠道，并给出处理提示。
- **推理历史兼容**：在后台尽可能恢复已捕获的推理字段，减少多轮工具调用时的兼容问题。详见 [Agent 接入说明](docs/agent-compatibility.md)。

## 使用边界与数据

本项目是个人本地 API 路由客户端，不负责 Agent 的工具执行、任务规划或上下文压缩。当前提供 OpenAI Chat Completions 接口；不提供 Responses 或 Anthropic 原生协议转换。

模型使用费用由各渠道结算，TierSense 使用规则以官网及密钥权益为准。客户端内账号登录、购买订阅和支付暂未接通；安装客户端不等于获得免费的模型额度或 TierSense 订阅。

访问密钥使用系统加密保存在本机。判断难度所需的任务消息发送给配置的 TierSense 服务；模型消息发送给选中的上游渠道。本地调用记录包含用量和路由信息，不记录提示词或回复。推理兼容默认仅保存在内存；可主动开启加密的重启恢复。完整说明见 [数据与隐私](docs/data-and-privacy.md)。

## 反馈体验

欢迎通过 [Issues](https://github.com/mayanbiao1234/tiersense-desktop/issues/new/choose) 提交问题或建议。请提供客户端版本、AI 工具名称、模型和渠道名称、复现步骤，以及脱敏后的错误信息。不要上传 API Key、配置文件或私密对话。

## 从源码运行

使用 Windows 和 Node.js 22.12+。项目采用 Electron、React、TypeScript 和 Vite。

```powershell
git clone https://github.com/mayanbiao1234/tiersense-desktop.git
cd tiersense-desktop
npm ci
npm run dev
```

```powershell
npm run check       # 类型检查、构建和测试
npm run installer   # 生成 Windows 安装包
```

安装包输出到 `release/<版本>/`。`npm run dev:web` 仅预览页面，不提供桌面 IPC 和本地网关能力。测试使用合成数据与本地模拟服务，不需要真实 API Key。

如需指定开发资料目录，可设置 `TIERFLOW_DATA_DIR` 为可写的绝对路径。`scripts/run.ps1` 是原开发环境将临时文件、缓存与资料放到 D 盘的便捷脚本；其他开发者可使用上面的 npm 命令。安装后的应用默认使用当前用户的数据目录，不依赖开发者路径。

品牌标识归各自权利人所有；随仓库分发的第三方图标和字体许可证保存在 `public/providers/` 与 `public/fonts/`。公开源码不变更第三方许可证或商标权利。
