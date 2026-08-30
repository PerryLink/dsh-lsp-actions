<div align="center">

# 🛰️ dsh-lsp-actions
- **1024 商店渠道**：先 `npm i -g dsh1024`，再 `dsh1024 plugin --profile web add dsh-lsp-actions`（计入 [deepseek1024.com](https://deepseek1024.com) 安装排行）。

**DeepSeek Harness 的 LSP 动作面 —— 真实的语言服务器、真实的反馈，以及面向编辑器的 IDE 集成后端。**

*为你的 agent 编辑循环提供诊断、格式化、补全、代码动作、符号、签名提示、内联提示与重命名 —— 外加稳定的编辑器 action 协议（`lsp.actions.*`），让任何编辑器都能直接消费这些能力。*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-lsp-actions/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-lsp-actions/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-lsp-actions?label=version)](https://github.com/PerryLink/dsh-lsp-actions/releases)
[![npm version](https://img.shields.io/npm/v/dsh-lsp-actions)](https://www.npmjs.com/package/dsh-lsp-actions)
[![npm downloads](https://img.shields.io/npm/dm/dsh-lsp-actions)](https://www.npmjs.com/package/dsh-lsp-actions)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.1-rc.2`（对 `>=0.1.0-rc.8 <0.2.0` 声明兼容） |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Platforms | 全部（纯 host；子进程 + 文件系统，无网络） |
| Model | 任意（工具与模型无关；插件从不调用模型） |

## What you get

`dsh-lsp-actions` 以单个 host 行挂载（`id: lsp-actions`、`name: dsh-lsp-actions`、`inject: [tools, fs, subprocess]`）。官方 DeepSeek Harness 的 `ctx.lsp` seam 覆盖**导航**（跳转定义、引用、实现、悬停）；本插件补齐了**动作面** —— agent 写代码和修代码时需要的反馈闭环：

1. **八个 `lsp_*` 工具** —— 诊断、格式化、补全、代码动作、符号、签名提示、内联提示与重命名，全部由你 IDE 所用的那些语言服务器提供。
2. **编辑器 action 协议 v1** —— 稳定的 JSON-RPC 面（`lsp.actions.list` / `lsp.actions.run` / `lsp.events`），让任何编辑器（先行 VS Code）直接消费这些能力。
3. **真实服务器验证** —— 测试套件包含一次真实的 `typescript-language-server` 运行（自包含，CI 在 Node 22/24 × Linux/Windows/macOS 上运行），而非只有 mock。

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add "github:PerryLink/dsh-lsp-actions#main"

# or from npm (published releases)
dsh plugin --profile web add dsh-lsp-actions

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A3 'id: lsp-actions'
```

## Install & uninstall

- **git channel**（最新 `main`）：`dsh plugin --profile web add "github:PerryLink/dsh-lsp-actions#main"` —— `prepare` 脚本负责构建（`tsc --noEmitOnError`）。
- **npm channel**（发布版本）：`dsh plugin --profile web add dsh-lsp-actions`。
- **tarball channel**：在本仓库执行 `pnpm pack`，然后 `dsh plugin --profile web add ./dsh-lsp-actions-<version>.tgz`。
- **uninstall**：`dsh plugin --profile web remove dsh-lsp-actions`（或从 profile patch 中移除该行）。

## Configuration

所有可调项都是 Schemastery `Config` 字段（可从 cordis.yml 修改）。以 id 为目标的覆盖会替换整行 —— 你需要重述每一个键。`cordis.patch.yml` 对每个键都有内联说明。

| Key | Default | Meaning |
|---|---|---|
| `servers` | `{}` | 命名的语言服务器；空表不激活任何服务器 |
| `editor.enabled` | `false` | 通过 JSON-RPC stdio 提供编辑器 action 协议（仅限 headless 后端） |
| `editor.requestTimeoutMs` | `60000` | 编辑器协议每次运行的超时预算（毫秒） |
| `editor.diagnosticsCacheMaxFiles` | `64` | 有界 LRU 诊断缓存大小（按文件数） |
| `maxDiagnostics` | `200` | 每次结果的诊断上限 |
| `maxCompletionItems` | `20` | 每次结果的补全项上限 |
| `maxCodeActions` | `50` | 每次结果的代码动作上限 |
| `maxSymbols` | `100` | 符号结果上限 |
| `maxSignatures` | `10` | 签名提示上限 |
| `maxInlayHints` | `200` | 内联提示上限 |
| `maxResultChars` | `16000` | 渲染结果上限（字符数） |
| `maxDocumentBytes` | `4000000` | 文档读取上限（字节数） |
| `timeoutMs` | `60000` | 每次调用的超时，由官方 timeout 策略执行 |

每个 `servers` 条目都是一个 `LspServerEntry`：`command`（可执行文件，加载期在 PATH 上解析）与 `extensionToLanguage`（`".ts"` → `typescript`）为必填；可选的 `fileGlobs`、`args`、`env`、`initializationOptions`、`configuration`、`formattingOptions`、`maxMessageBytes`、`maxStderrBytes`、`killGraceMs`、`shutdownTimeoutMs`、`diagnosticsSettleMs`、`diagnosticsDebounceMs` 与 `idleTimeoutMs`（`0` = 保持服务器进程存活）用于调校内置 stdio 客户端。

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `lsp_diagnostics` | tool | `<file>` —— 编译器/分析器的错误、警告与提示，含严重级、范围、消息与来源服务器（只读） |
| `lsp_format` | tool | `<file> [range?]` —— 通过语言服务器格式化文件/选区并应用，返回 diff（经 `fs/write-intent` 写盘） |
| `lsp_completion` | tool | `<file> <line> <character>` —— 光标处的补全建议，含插入文本（只读） |
| `lsp_code_action` | tool | `<file> [range?] [only?]` —— 服务器验证过的快速修复/重构（含其编辑），作用于某范围或首个诊断（仅参考） |
| `lsp_symbols` | tool | `<query?> <file_path?>` —— 按名字全局搜索符号，或列出单个文件的大纲（只读） |
| `lsp_signature` | tool | `<file> <line> <character>` —— 调用点处的签名提示（参数与文档）（只读） |
| `lsp_inlay_hints` | tool | `<file> [range?]` —— 服务器给出的类型标注与参数名提示（只读） |
| `lsp_rename` | tool | `<file> <line> <character> <new_name>` —— 服务器验证过的重命名，跨工作区应用并返回逐文件 diff（经 `fs/write-intent` 写盘） |
| `lsp.actions.*` | protocol | 编辑器 action 协议 v1：经 JSON-RPC 的 `lsp.actions.list` / `lsp.actions.run` / `lsp.events` |
| `examples/vscode/` | extension | 纯 UI 的 VS Code 扩展，及其所连接的 headless 后端组合 |

## Editor action protocol v1

在专用 headless 组合中设置 `editor.enabled: true` 后，`dsh-lsp-actions` 通过换行分帧的 JSON-RPC 2.0（与官方 SDK/ACP 传输同一线格式）提供稳定的编辑器协议：

| Method | What it does |
|---|---|
| `lsp.actions.list` | 返回 `lsp-actions/v1` 协议版本、动作目录（`diagnostics.get`、`completion.get`、`quickfix.apply`、`format`，逐个标注 `writes`）与可寻址的 DSH 会话 |
| `lsp.actions.run` | 执行一个动作，返回结构化 `{ requestId, action, status, result \| error }` 信封；错误携带稳定的 `LSP_ACTION_*` 码 |
| `lsp.events` | 订阅流式 `lsp.event` 通知：`diagnostics.updated`、`action.status`、`file.changed`、`sessions.changed` |

所有写动作（`quickfix.apply`、`format`）都走**官方权限预设与审批**：`read-only` 会话在任何服务器往返前以 `LSP_ACTION_READ_ONLY` 拒绝；编辑走 `fs/write-intent` waterfall；`sandbox_permissions` + `justification` 升级对经官方 `approveEscalation` 询问（无应答方时 fail-closed）。完整线上规范（双语）：[`docs/editor-protocol.md`](docs/editor-protocol.md) · [`docs/editor-protocol.zh-CN.md`](docs/editor-protocol.zh-CN.md)。

**版本化与向后兼容承诺**

- 协议带版本 —— `lsp.actions.list` 返回 `protocol: "lsp-actions/v1"`、`version: 1`。**v1 已冻结：**字段名、动作 id、事件类型与错误码永久稳定。
- 演进**只做加法**：新动作、新字段、新事件类型无需升版本；既有语义绝不原地变更；破坏性变更以新的 `protocol` 版本发布，服务端可并行服务多版本。
- 客户端必须忽略未知字段、未知事件类型与未知动作，并按稳定的错误 `code` 路由，绝不解析消息文本。

**错误码**

每个失败都携带稳定 `code`；模型与调用方按 code 路由，绝不解析消息文本。

| Code | Meaning |
|---|---|
| `LSP_ACTION_UNAVAILABLE` | 没有服务器 entry、seam provider 也不处理该文件 |
| `LSP_ACTION_UNSUPPORTED` | 服务器（或 seam provider）未广告该操作 |
| `LSP_ACTION_SERVER_FAILED` | 服务器失败（附 stderr 尾部）；启动失败重试一次 |
| `LSP_ACTION_MALFORMED_RESPONSE` | 服务器返回了结构非法的负载 |
| `LSP_ACTION_CONFLICT` | 文件读后已变，或编辑重叠 / 越界 / 越出工作区 |
| `LSP_ACTION_READ_ONLY` | 会话沙箱模式禁止格式化/重命名写入 |
| `LSP_ACTION_WORKSPACE_REQUIRED` | 调用会话没有可扎根的 workspace cwd |
| `LSP_ACTION_NO_SYMBOL` | 服务器在光标位置找不到可重命名的符号 |
| `LSP_ACTION_UNKNOWN` | 编辑器协议：未知动作 id，或没有 code action 匹配 `title`/`index` |
| `LSP_ACTION_INVALID_ARGS` | 编辑器协议：动作参数不合法 |
| `LSP_ACTION_APPROVAL_UNAVAILABLE` | 编辑器协议：审批路径未能授予更宽沙箱模式（fail-closed） |
| `LSP_PROTOCOL_VERSION_UNSUPPORTED` | 编辑器协议：所声明的协议版本不被支持 |

## VS Code extension

[`examples/vscode/`](examples/vscode/) 附带**纯 UI** 扩展（侧栏：DSH 会话、诊断列表、quickfix 一键应用、点击定位、格式化）及其经 ACP 风格 JSON-RPC 连接的 headless 后端组合（`backend/cordis.yml`）。扩展不实现任何 LSP 逻辑——所有能力与每一笔写入都属于插件。安装步骤、设置项与动图录制脚本见 [`examples/vscode/README.md`](examples/vscode/README.md)。

![编辑器演示](docs/editor-demo.gif)

## Permissions & data

- **权限**：格式化与重命名走官方权限预设与审批 —— `fs/write-intent` waterfall 与 `sandbox_permissions` / `justification` 升级对，经 `ctx.approval` 裁决。插件在其 workshop manifest 中声明 `fs:read`、`fs:write`、`subprocess:spawn` 与 `network:none`。
- **数据**：不向磁盘写入任何东西；工具结果只存在于会话日志（无跨会话持久化）。编辑器协议只保留一个有界的内存 LRU 诊断缓存，带新鲜度戳，绝不跨重启持久化。
- **无网络**：插件不发起任何网络请求；它通过本地子进程 stdio 与语言服务器通信。

## Security boundaries

- **默认只读。** 八个工具中有六个仅作参考；只有 `lsp_format` 与 `lsp_rename` 会变更，且按真实的 `write`/`edit` 变更对待。
- **走官方 seam，而非另起炉灶。** 每个字节都经过 `fs/write-intent` waterfall（观测 → 守卫写 → 观测）与每次调用的沙箱策略；升级路径与官方 `write`/`edit` 工具一致。
- **响亮、快速、结构化地失败。** `servers` 为空且无 `ctx.lsp` seam → `LSP_ACTION_UNAVAILABLE`；只读会话在任何服务器往返前 → `LSP_ACTION_READ_ONLY`；命令形态只报告、绝不执行。
- **冲突绝不覆盖。** 文件读后已变则以 `LSP_ACTION_CONFLICT` 失败；`lsp_rename` 在第一笔写入前预检每个待改文件。
- **有界工作。** 结果上限、字节上限与平台的 timeout 策略约束每一次调用；诊断缓存是有界 LRU。
- **模型路径不缓存任何东西。** 工具结果只存在于会话日志；诊断缓存绝不跨重启持久化。
- **坏服务器响亮失败。** 命令缺失在加载期即失败；启动即死的服务器以 `LSP_ACTION_SERVER_FAILED` + stderr 尾部失败（启动失败先自动换新进程重试一次）。
- **提示词卫生。** 本插件不向会话系统提示词注入任何 persona 或提示词段落——面向模型的接口只有八个工具 Schema。

## Architecture

动作**优先走官方 seam**，未命中则回落插件自带的最小 stdio 客户端：

```text
lsp_diagnostics / lsp_format / lsp_completion / lsp_code_action /
lsp_symbols / lsp_signature / lsp_inlay_hints / lsp_rename
        │
        ▼
   ctx.lsp seam（扩展后：diagnostics / formatDocument / completion）
        │  缺席 · 旧版 · 该文件无 provider
        ▼
   内置 stdio 客户端  ←  servers 表（ctx.subprocess.spawn + JSON-RPC）
```

seam 扩展已向上游提案（`upstream/lsp-action-seam.patch`，PR 描述见 `upstream/PR-description.md`）。合入后插件无需改动即自动迁移——内置客户端停止被使用即可。内置客户端会保留为 `servers` 表的独立兜底。**编辑器协议**复用同一 runner、同一写入路径与同一权限机制。完整调研与设计笔记：[`docs/seam-extension-notes.md`](docs/seam-extension-notes.md)。

## Known limitations

- **瞬态文档。** 每次动作都是打开文件 → 发一个请求 → 关闭文件（与官方 stdio host 一致）。依赖常驻打开文件的基于项目的服务器（tsls 在无打开文档时拒绝 `workspace/symbol`）可通过给 `lsp_symbols` 传 `file_path` 解决。tsls 在该生命周期下对 `textDocument/signatureHelp` 返回 `null`；其他服务器（gopls、pyright、rust-analyzer）正常应答。
- **范围格式化要求服务器的 range provider。** 只广告全文格式化的服务器对范围请求以 `LSP_ACTION_UNSUPPORTED` 失败。
- **重命名只应用文本编辑。** 服务器重命名结果中的资源操作（新建/删除/重命名文件）以 `LSP_ACTION_UNSUPPORTED` 拒绝；越出工作区的编辑在任何写入发生前以 `LSP_ACTION_CONFLICT` 失败。

## Development

```sh
pnpm install            # node ^22.19 || >=24
pnpm run lint           # oxlint over src/ and tests/
pnpm test               # vitest: unit + fixture-server integration + editor-protocol e2e + real tsls e2e
pnpm run test:coverage  # coverage gate
pnpm build              # tsc --noEmitOnError → lib/
pnpm run prepare        # tsc --noEmitOnError (runs on install)
pnpm run prepublishOnly # tsc --noEmitOnError (runs before publish)
```

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `lsp`, `language-server`, `diagnostics`, `formatting`, `completion`, `code-action`, `symbols`, `signature-help`, `inlay-hints`, `rename`, `refactor`, `ide`, `editor`, `vscode`, `acp`, `json-rpc`

## Contributors

- [@PerryLink](https://github.com/PerryLink) —— 创建者与维护者：LSP 动作客户端与服务器生命周期、全部八个工具、编辑器 action 协议、测试、CI，以及五语种文档。

## PerryLink DSH Plugin Family

这是 [PerryLink](https://github.com/PerryLink) 维护的 [33 个 DeepSeek Harness 插件](https://github.com/PerryLink) 之一。如果它能帮到你，其他的也会：

| Plugin | One-liner |
|---|---|
| **[dsh-dsh-auto-review](https://github.com/PerryLink/dsh-dsh-auto-review)** | 审批链上的第二模型自动审查，默认失败关闭 | |
| **[dsh-dsh-background-agents](https://github.com/PerryLink/dsh-dsh-background-agents)** | 带 Web UI 侧栏、消息与中断的持久后台子代理 | |
| **[dsh-dsh-budget](https://github.com/PerryLink/dsh-dsh-budget)** | DeepSeek Harness 的成本治理：预算、碳排与延迟一屏呈现。 | |
| **[dsh-dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-dsh-checkpoint-rewind)** | Claude Code /rewind 等价：快照、会话 fork、一次性恢复 | |
| **[dsh-dsh-claude-move](https://github.com/PerryLink/dsh-dsh-claude-move)** | 把 Claude Code 会话、记忆、技能与 CLAUDE.md 迁入 DSH | |
| **[dsh-dsh-click](https://github.com/PerryLink/dsh-dsh-click)** | 跨平台原生桌面控制（DeepSeek Harness），Windows 优先。 | |
| **[dsh-dsh-composer-history](https://github.com/PerryLink/dsh-dsh-composer-history)** | Web 输入框的终端式历史：方向键、Ctrl+R 搜索 | |
| **[dsh-dsh-data-quality](https://github.com/PerryLink/dsh-dsh-data-quality)** | 数据集质量检查与引文核查（本插件可选消费的数字核查桥） | |
| **[dsh-dsh-defend](https://github.com/PerryLink/dsh-dsh-defend)** | DeepSeek Harness 的提示注入、越狱与密钥泄露防护。 | |
| **[dsh-dsh-doublecheck](https://github.com/PerryLink/dsh-dsh-doublecheck)** | 工程纪律守卫：需求质询、测试门禁、对手评审 | |
| **[dsh-dsh-draw](https://github.com/PerryLink/dsh-dsh-draw)** | DeepSeek Harness 的统一静态图像生成路由。 | |
| **[dsh-dsh-fast](https://github.com/PerryLink/dsh-dsh-fast)** | DeepSeek Harness 只读性能诊断。 | |
| **[dsh-dsh-fund-research](https://github.com/PerryLink/dsh-dsh-fund-research)** | 面向中国公募基金的确定性研究报告 | |
| **[dsh-dsh-github](https://github.com/PerryLink/dsh-dsh-github)** | 面向 DSH 的 GitHub PR/issues 集成，每次写入经审批门控 | |
| **[dsh-dsh-industry-research](https://github.com/PerryLink/dsh-dsh-industry-research)** | 行业研究编排，经本插件的 `ctx.researchReport.assemble` 封存交付物 | |
| **[dsh-dsh-library](https://github.com/PerryLink/dsh-dsh-library)** | DeepSeek Harness 的本地文档知识库。 | |
| **[dsh-dsh-local-ai](https://github.com/PerryLink/dsh-dsh-local-ai)** | DeepSeek Harness 的本地模型（Ollama）接入。 | |
| **[dsh-dsh-mask](https://github.com/PerryLink/dsh-dsh-mask)** | PII 脱敏中间件：模型边界匿名化、展示层还原 | |
| **[dsh-dsh-mcp-panel](https://github.com/PerryLink/dsh-dsh-mcp-panel)** | 只读 MCP 运行时面板：/mcp 命令 + 带状态、工具与错误的 Settings 标签页 | |
| **[dsh-dsh-memento](https://github.com/PerryLink/dsh-dsh-memento)** | 审批门控的跨会话记忆：ctx.memory 接缝 + SQLite + 记忆工具 | |
| **[dsh-dsh-observe](https://github.com/PerryLink/dsh-dsh-observe)** | DeepSeek Harness 的 OpenTelemetry 与 Langfuse 可观测导出器。 | |
| **[dsh-dsh-output-styles](https://github.com/PerryLink/dsh-dsh-output-styles)** | Claude Code outputStyles 等价的运行时风格切换 | |
| **[dsh-dsh-permission-rules](https://github.com/PerryLink/dsh-dsh-permission-rules)** | Claude Code 风格声明式 allow/deny/ask 权限规则，带审计 | |
| **[dsh-dsh-plugin-guide](https://github.com/PerryLink/dsh-dsh-plugin-guide)** | 作为按需代理技能的插件开发知识库 | |
| **[dsh-dsh-research-report](https://github.com/PerryLink/dsh-dsh-research-report)** | 可验证研究报告引擎：内容寻址证据账本与封存版本 | |
| **[dsh-dsh-score](https://github.com/PerryLink/dsh-dsh-score)** | DeepSeek Harness 插件的多维质量评分。 | |
| **[dsh-dsh-session-pin](https://github.com/PerryLink/dsh-dsh-session-pin)** | 在 Web 侧栏置顶会话，带持久排序 | |
| **[dsh-dsh-session-sync](https://github.com/PerryLink/dsh-dsh-session-sync)** | DeepSeek Harness 的跨设备会话同步——会话存储的专用 git 镜像。 | |
| **[dsh-dsh-skill-pack-security](https://github.com/PerryLink/dsh-dsh-skill-pack-security)** | 安全审计技能包：密钥扫描、依赖与供应链审查 | |
| **[dsh-dsh-talk](https://github.com/PerryLink/dsh-dsh-talk)** | DeepSeek Harness 的语音优先会话闭环：对它说，听它答。 | |
| **[dsh-dsh-test-drive](https://github.com/PerryLink/dsh-dsh-test-drive)** | DeepSeek Harness 插件的隔离试装冒烟。 | |
| **[dsh-dsh-translate](https://github.com/PerryLink/dsh-dsh-translate)** | DeepSeek Harness 的厂商参数翻译与确定性 JSON 修复。 | |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-lsp-actions contributors
