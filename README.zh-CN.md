<div align="center">

# 🛰️ dsh-lsp-actions

**DeepSeek Harness 的 LSP 动作面 —— 真实的语言服务器，真实的反馈。**

为你的 agent 编辑循环提供诊断、格式化与代码补全，驱动它们的正是你 IDE 所用的那些语言服务器。

[![Topic: dsh](https://img.shields.io/badge/Topic-dsh-4D6BFE?style=for-the-badge)](https://github.com/topics/dsh)
[![Topic: dsh-plugin](https://img.shields.io/badge/Topic-dsh--plugin-8257D0?style=for-the-badge)](https://github.com/topics/dsh-plugin)
[![License](https://img.shields.io/badge/License-Apache%202.0-D22128?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%5E22.19%20%7C%7C%20%3E%3D24-43853D?style=flat-square)](package.json)

[English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [हिन्दी](README.hi.md) · [Português](README.pt.md)

</div>

---

## 这个插件给 agent 带来什么

官方 DeepSeek Harness 的 `ctx.lsp` seam 覆盖**导航**（转到定义、引用、实现、悬停）。`dsh-lsp-actions` 补齐**动作面**——agent 在编写与修复代码时需要的反馈闭环：

| 工具 | 做什么 | 会写入吗？ |
| --- | --- | --- |
| `lsp_diagnostics <file>` | 编译器/分析器的错误、警告与提示，含严重级、范围、消息与来源服务器 | ❌ 只读 |
| `lsp_format <file> [range?]` | 通过语言服务器格式化文件/选区并应用结果，返回 diff | ✅ 走 `fs/write-intent` + sandbox 策略 |
| `lsp_completion <file> <line> <character>` | 光标位置的补全建议——**仅供参考的提示**，绝不执行 | ❌ 只读 |

> ✨ 测试套件里包含一次真实的 `typescript-language-server` 运行：诊断、格式化与补全都是对着活服务器端到端验证的，不只是 mock。

## 快速开始

```sh
dsh plugin --profile <name> add <dsh-lsp-actions 的路径或 tarball>
```

每种语言服务器配一条（形态与官方 `lsp-stdio` 配置对齐）：

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
        maxResultChars: 16000
        timeoutMs: 60000
```

**`servers` 表为空且没有挂载 `ctx.lsp` seam 时，插件什么都不贡献**——它永远不会启动你没有配置的服务器。

## 为什么它在设计上就是安全的

- **格式化是真实的变更操作，与 `write`/`edit` 同等对待。** 每一个字节都经过 `fs/write-intent` waterfall（观测 → 带守卫写入 → 观测）与逐调用 sandbox 策略。
- **只读会话响亮、快速、结构化地失败**——`LSP_ACTION_READ_ONLY` + 共享的 `[sandbox: …]` 标记，在任何服务器往返**之前**抛出。
- **升级路径与官方工具一致。** 在约束型文件系统下，`lsp_format` 广告与 `write`/`edit` 相同的 `sandbox_permissions` / `justification` 一次性重试，经 `ctx.approval` 裁决。
- **冲突绝不覆盖数据。** 若文件在读后被改动，带守卫的写入以 `LSP_ACTION_CONFLICT` 失败，并提示模型**选择**：重读后重跑，或手工应用 diff。
- **超时属于平台。** 每个工具声明 `timeoutMs`，由官方 `dsh-tool-call-timeout-policy` 执行，所有等待都尊重 `exec.signal`。
- **零缓存。** 诊断/补全结果只存在于会话日志中，没有任何跨会话持久化。
- **坏服务器响亮失败。** 命令不存在在加载期失败；启动即挂的服务器让调用以 `LSP_ACTION_SERVER_FAILED` + stderr 尾部失败。

## 架构

动作**优先走官方 seam**，失败时回落到插件自带的最小 stdio 客户端：

```
lsp_diagnostics / lsp_format / lsp_completion
        │
        ▼
   ctx.lsp seam（扩展后：diagnostics / formatDocument / completion）
        │  未挂载 · 旧版 · 该文件无 provider
        ▼
   内置 stdio 客户端  ←  servers 表（ctx.subprocess.spawn + JSON-RPC）
```

seam 扩展已向上游提案（`upstream/lsp-action-seam.patch`，PR 描述见 `upstream/PR-description.md`）。合入后插件无需改动——内置客户端自然退役。完整调研与设计笔记：[`docs/seam-extension-notes.md`](docs/seam-extension-notes.md)。

## 配置参考

```ts
interface Config {
  /** 具名语言服务器；为空 = 插件不激活任何服务器。 */
  servers?: Record<string, LspServerEntry>
  maxDiagnostics?: number        // 默认 200
  maxCompletionItems?: number    // 默认 20
  maxResultChars?: number        // 默认 16000（完整渲染结果上限）
  maxDocumentBytes?: number      // 默认 4000000
  timeoutMs?: number             // 默认 60000（由官方超时策略执行）
}

interface LspServerEntry {
  command: string                        // 可执行文件，加载期在 PATH 上解析
  extensionToLanguage: Record<string, string>  // ".ts" → "typescript"
  fileGlobs?: string[]                   // 可选；glob 命中优先于扩展名映射
  args?: string[]                        // 无 shell
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown                // 对 workspace/configuration 的静态应答
  formattingOptions?: unknown            // 如 { tabSize: 2, insertSpaces: true }
  maxMessageBytes?: number               // 默认 16000000
  maxStderrBytes?: number                // 默认 1000000
  killGraceMs?: number                   // 默认 2000
  shutdownTimeoutMs?: number             // 默认 5000
  diagnosticsSettleMs?: number           // 默认 2000（仅推送式诊断的收集窗口）
}
```

## 开发

```sh
pnpm install
pnpm test          # 105 个测试：单元 + fixture 服务器集成 + 真实 tsls e2e
pnpm build         # 产出 lib/
```

## 许可证

[Apache License 2.0](LICENSE)
