<div align="center">

# 🛰️ dsh-lsp-actions

**DeepSeek Harness 的 LSP 动作面 —— 真实的语言服务器，真实的反馈。**

为你的 agent 编辑循环提供诊断、格式化、补全、快速修复、符号、签名提示与内联提示，驱动它们的正是你 IDE 所用的那些语言服务器。

[![Topic: dsh](https://img.shields.io/badge/Topic-dsh-4D6BFE?style=for-the-badge)](https://github.com/topics/dsh)
[![Topic: dsh-plugin](https://img.shields.io/badge/Topic-dsh--plugin-8257D0?style=for-the-badge)](https://github.com/topics/dsh-plugin)
[![CI](https://github.com/PerryLink/dsh-lsp-actions/actions/workflows/ci.yml/badge.svg)](https://github.com/PerryLink/dsh-lsp-actions/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-lsp-actions?style=flat-square)](https://www.npmjs.com/package/dsh-lsp-actions)
[![npm downloads](https://img.shields.io/npm/dw/dsh-lsp-actions?style=flat-square)](https://www.npmjs.com/package/dsh-lsp-actions)
[![License](https://img.shields.io/badge/License-Apache%202.0-D22128?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%5E22.19%20%7C%7C%20%3E%3D24-43853D?style=flat-square)](package.json)

[English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [हिन्दी](README.hi.md) · [Português](README.pt.md)

</div>

---

## 这个插件给 agent 带来什么

官方 DeepSeek Harness 的 `ctx.lsp` seam 只覆盖**导航**（跳转定义、引用、实现、悬停）。`dsh-lsp-actions` 补齐了**动作面** —— agent 写代码和修代码时需要的反馈闭环：

| 工具 | 做什么 | 写盘？ |
| --- | --- | --- |
| `lsp_diagnostics <file>` | 编译器/分析器的错误、警告与提示（含严重级、范围、消息与来源服务器） | ❌ 只读 |
| `lsp_format <file> [range?]` | 通过语言服务器格式化文件或选区并写入，返回 diff | ✅ 走 `fs/write-intent` + 沙箱策略 |
| `lsp_completion <file> <line> <character>` | 光标处的补全建议，含实际插入文本 | ❌ 只读 |
| `lsp_code_action <file> [range?] [only?]` | 服务器验证过的快速修复/重构（含其编辑） | ❌ 仅参考 |
| `lsp_symbols <query?> <file_path?>` | 按名字全局搜索符号，或列出单个文件的符号大纲 | ❌ 只读 |
| `lsp_signature <file> <line> <character>` | 调用点处的签名提示（参数与文档） | ❌ 只读 |
| `lsp_inlay_hints <file> [range?]` | 服务器的类型标注与参数名提示 | ❌ 只读 |
| `lsp_rename <file> <line> <character> <new_name>` | 服务器验证过的符号重命名，跨工作区应用并返回逐文件 diff | ✅ 走 `fs/write-intent` + 沙箱策略 |

> ✨ 测试套件包含一次真实的 `typescript-language-server` 运行：诊断、格式化、补全、符号搜索与重命名都是对着活服务器端到端验证的，而非只有 mock。套件自包含（tsls 是 devDependency），并在 CI 中以 Node 22/24 × Linux/Windows/macOS 矩阵运行。

## 快速开始

```sh
dsh plugin --profile <name> add dsh-lsp-actions
```

卸载：

```sh
dsh plugin --profile <name> remove dsh-lsp-actions
```

每个语言服务器配一条 entry（形态与官方 `lsp-stdio` 配置一致）：

```yaml
# 写在 profile 的 cordis.patch.yml（或 bundle 行）里
- insert:
    - id: lsp-actions
      name: dsh-lsp-actions
      inject: [tools, fs, subprocess]
      config:
        servers:
          ts:
            command: typescript-language-server
            args: [--stdio]
            extensionToLanguage:
              ".ts": typescript
            formattingOptions: { tabSize: 2, insertSpaces: true }
          py:
            command: pyright-langserver
            args: [--stdio]
            extensionToLanguage:
              ".py": python
        maxDiagnostics: 200
        maxCompletionItems: 20
        maxCodeActions: 50
        maxSymbols: 100
        maxSignatures: 10
        maxInlayHints: 200
        maxResultChars: 16000
        timeoutMs: 60000
```

八个工具**始终注册**。当 `servers` 表为空且没有挂载 `ctx.lsp` seam 时，调用会**响亮失败**（`LSP_ACTION_UNAVAILABLE`，错误信息指明该配置什么）—— 插件绝不会启动你没有配置的服务器。**在插件之后**挂载的 `ctx.lsp` seam 会在下一次调用时被识别（seam 探测按调用惰性解析，加载顺序无关）。

## 为什么按构造就安全

- **格式化与重命名是真实写入，按 `write`/`edit` 同等对待。** 每个字节都经过 `fs/write-intent` waterfall（观测 → 守卫写 → 观测）与每次调用的沙箱策略。`lsp_rename` 会在第一笔写入**之前**对每个待改文件做预检（工作区包含性、重叠检查、字节上限读取），坏服务器响应不可能留下写了一半的重命名。
- **其余一切按设计只读。** 代码动作、补全、符号、签名与提示都作为参考材料返回；应用它们由模型自行决定用 write/edit 完成。命令形态只报告、**绝不执行**。
- **只读会话响亮、快速、结构化地失败** —— 在任何服务器往返之前抛出带共享 `[sandbox: …]` 标记的 `LSP_ACTION_READ_ONLY`。
- **升级路径与官方工具一致。** 在受限文件系统下，`lsp_format` 与 `lsp_rename` 广告与 `write`/`edit` 相同的 `sandbox_permissions` / `justification` 一次性重试，经 `ctx.approval` 裁决。
- **冲突绝不覆盖。** 若文件在读后被改动，守卫写以 `LSP_ACTION_CONFLICT` 失败，并让模型二选一：重读后重跑，或手工应用 diff。
- **超时是平台职责。** 每个工具声明 `timeoutMs`，由官方 `dsh-tool-call-timeout-policy` 执行，所有 await 尊重 `exec.signal`。
- **不缓存任何东西。** 结果只存在于会话日志，无跨会话持久化。
- **坏服务器响亮失败。** 命令缺失在加载期即失败；启动即死的服务器以 `LSP_ACTION_SERVER_FAILED` + stderr 尾部失败（启动失败先自动换新进程重试一次）。

## 架构

动作**优先走官方 seam**，未命中则回落插件自带的最小 stdio 客户端：

```
lsp_diagnostics / lsp_format / lsp_completion / lsp_code_action /
lsp_symbols / lsp_signature / lsp_inlay_hints / lsp_rename
        │
        ▼
   ctx.lsp seam（扩展后：diagnostics / formatDocument / completion）
        │  缺席 · 旧版 · 该文件无 provider
        ▼
   内置 stdio 客户端  ←  servers 表（ctx.subprocess.spawn + JSON-RPC）
```

seam 扩展已向上游提案（`upstream/lsp-action-seam.patch`，PR 描述见 `upstream/PR-description.md`）。合入后插件无需改动即自动迁移 —— 内置客户端停止被使用即可。内置客户端会保留为 `servers` 表的独立兜底。完整调研与设计笔记：[`docs/seam-extension-notes.md`](docs/seam-extension-notes.md)、[`upstream/README.md`](upstream/README.md)。

## 配置参考

```ts
interface Config {
  /** 命名的语言服务器；为空 = 插件自带客户端不服务任何文件。 */
  servers?: Record<string, LspServerEntry>
  maxDiagnostics?: number        // 默认 200
  maxCompletionItems?: number    // 默认 20
  maxCodeActions?: number        // 默认 50
  maxSymbols?: number            // 默认 100
  maxSignatures?: number         // 默认 10
  maxInlayHints?: number         // 默认 200
  maxResultChars?: number        // 默认 16000（完整渲染结果上限）
  maxDocumentBytes?: number      // 默认 4000000
  timeoutMs?: number             // 默认 60000（由官方超时策略执行）
}

interface LspServerEntry {
  command: string                        // 可执行文件，加载期在 PATH 上解析
  extensionToLanguage: Record<string, string>  // ".ts" → "typescript"
  fileGlobs?: string[]                   // 可选；glob 命中优先于扩展名映射
  args?: string[]                        // 不经 shell
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown                // 对象形态按 section 应答 workspace/configuration
  formattingOptions?: unknown            // 例如 { tabSize: 2, insertSpaces: true }
  maxMessageBytes?: number               // 默认 16000000
  maxStderrBytes?: number                // 默认 1000000
  killGraceMs?: number                   // 默认 2000
  shutdownTimeoutMs?: number             // 默认 5000
  diagnosticsSettleMs?: number           // 默认 2000（仅推送诊断的收集窗口）
  diagnosticsDebounceMs?: number         // 默认 250（最后一批推送后的安静期）
  idleTimeoutMs?: number                 // 默认 0（0 = 服务器进程常驻）
}
```

### 错误码

每个失败都在错误结果上携带稳定 `code`；模型与调用方按 code 路由，绝不解析消息文本。

| Code | 含义 |
| --- | --- |
| `LSP_ACTION_UNAVAILABLE` | 没有服务器 entry、seam provider 也不处理该文件。 |
| `LSP_ACTION_UNSUPPORTED` | 服务器（或 seam provider）未广告该操作。 |
| `LSP_ACTION_SERVER_FAILED` | 服务器失败（附 stderr 尾部）；启动失败重试一次。 |
| `LSP_ACTION_MALFORMED_RESPONSE` | 服务器返回了结构非法的负载。 |
| `LSP_ACTION_CONFLICT` | 文件读后已变，或服务器返回的编辑重叠/越界/越出工作区。 |
| `LSP_ACTION_READ_ONLY` | 会话沙箱模式禁止格式化/重命名写入。 |
| `LSP_ACTION_WORKSPACE_REQUIRED` | 调用会话没有可扎根的 workspace cwd。 |
| `LSP_ACTION_NO_SYMBOL` | 服务器在光标位置找不到可重命名的符号。 |

### 宿主版本支持

插件把 DeepSeek Harness 各包声明为 **peerDependencies**（`@deepseek-ai/dsh-fs`、`dsh-llm`、`dsh-sandbox`、`dsh-subprocess`、`dsh-tools` ≥ `0.1.0-rc.6`），宿主与插件共享同一份副本。已在 `0.1.0-rc.6` 上实测，最后验证日期 2026-08-15。

### 已知限制

- **瞬态文档。** 每次动作都是打开文件 → 发一个请求 → 关闭文件（与官方 stdio host 一致）。依赖常驻打开文件的基于项目的服务器（tsls 在无打开文档时拒绝 `workspace/symbol`）可通过给 `lsp_symbols` 传 `file_path` 解决 —— 插件会在该请求期间保持路由文件打开。tsls 在该生命周期下对 `textDocument/signatureHelp` 返回 `null`；其他服务器（gopls、pyright、rust-analyzer）正常应答。
- **范围格式化要求服务器广告 range provider。** 只广告全文格式化的服务器对范围请求以 `LSP_ACTION_UNSUPPORTED` 失败。
- **重命名只应用文本编辑。** 服务器重命名结果中的资源操作（新建/删除/重命名文件）以 `LSP_ACTION_UNSUPPORTED` 拒绝；越出工作区的编辑在任何写入发生前以 `LSP_ACTION_CONFLICT` 失败。在 `utf-8`/`utf-32` 服务器上，跨文件重命名位置通过逐个读取被编辑文件来解码；被编辑文件不可读时以冲突失败，绝不错误解码位置。

## 开发

```sh
pnpm install
pnpm run lint        # oxlint 检查 src/ 与 tests/
pnpm test            # 240+ 测试：单元 + fixture 服务器集成 + 真实 tsls e2e
pnpm run test:coverage   # 门禁：行/语句/函数 ≥ 90%，分支 ≥ 85%
pnpm build           # 产出 lib/
```

### 发布

CI 在每次推送与 PR 上运行 lint/构建/测试矩阵 + 覆盖率门禁。推送 `v*` tag 会触发发布工作流：先验证全套测试再发布到 npm —— 需要在仓库里一次性配置 `NPM_TOKEN` Actions secret（发布权限的 npm access token）。版本号在打 tag 前于 `package.json` / `CHANGELOG.md` 中手动提升。

## 贡献者

感谢为本项目做出贡献的每一个人：

- [PerryLink](https://github.com/PerryLink) —— 插件本体：LSP 动作客户端与服务器生命周期、全部八个工具、测试、CI 与文档。

## PerryLink DSH 插件家族

本项目是 [PerryLink](https://github.com/PerryLink) 维护的 [15 个 DeepSeek Harness 插件](https://github.com/PerryLink)之一。如果你觉得这个插件有用，其余的很可能同样有用：

| 插件 | 一句话说明 |
|---|---|
| [dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel) | 只读 MCP 运行时面板：/mcp 命令 + 设置页，状态/工具/错误一览 |
| [dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck) | 工程纪律守门：需求审讯、测试证据门、对抗评审 |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | 持久化后台子代理：Web 侧边栏进度、随时留言与打断 |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | 基于语言服务器的诊断/格式化/补全/代码动作/重命名 |
| [dsh-output-styles](https://github.com/PerryLink/dsh-output-styles) | 对标 Claude Code outputStyles 的运行时风格切换 |
| [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind) | 对标 Claude Code /rewind：快照、会话 fork、一键回退 |
| [dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules) | Claude Code 风格声明式 allow/deny/ask 权限规则，带审计 |
| [dsh-auto-review](https://github.com/PerryLink/dsh-auto-review) | 审批链上的第二模型自动审查，默认 fail-closed |
| [dsh-memento](https://github.com/PerryLink/dsh-memento) | 带审批门的跨会话记忆：ctx.memory + SQLite + memory 工具 |
| [dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security) | 安全审计技能包：密钥扫描、依赖与供应链审查 |
| [dsh-session-pin](https://github.com/PerryLink/dsh-session-pin) | 在 Web 侧边栏置顶会话，持久排序 |
| [dsh-composer-history](https://github.com/PerryLink/dsh-composer-history) | Web 作曲器终端式输入历史：方向键、Ctrl+R 搜索 |
| [dsh-github](https://github.com/PerryLink/dsh-github) | DSH 的 GitHub PR/issue 集成，所有写操作经审批门 |
| [dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide) | 插件开发知识库，随 bundle 安装的按需 agent 技能 |
| [dsh-claude-move](https://github.com/PerryLink/dsh-claude-move) | 把 Claude Code 会话、记忆、技能和 CLAUDE.md 迁入 DSH |

## License

[Apache License 2.0](LICENSE)
