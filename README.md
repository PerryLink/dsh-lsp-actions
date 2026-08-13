<div align="center">

# 🛰️ dsh-lsp-actions

**The LSP action surface for DeepSeek Harness — real language servers, real feedback.**

Diagnostics, formatting, and code completion for your agent's editor loop, powered by the same language servers your IDE uses.

[![Topic: dsh](https://img.shields.io/badge/Topic-dsh-4D6BFE?style=for-the-badge)](https://github.com/topics/dsh)
[![Topic: dsh-plugin](https://img.shields.io/badge/Topic-dsh--plugin-8257D0?style=for-the-badge)](https://github.com/topics/dsh-plugin)
[![License](https://img.shields.io/badge/License-Apache%202.0-D22128?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%5E22.19%20%7C%7C%20%3E%3D24-43853D?style=flat-square)](package.json)

[English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [हिन्दी](README.hi.md) · [Português](README.pt.md)

</div>

---

## What this plugin gives your agent

The official DeepSeek Harness `ctx.lsp` seam covers **navigation** (go-to-definition, references, implementation, hover). `dsh-lsp-actions` completes the **action surface** — the feedback loop an agent needs while it writes and fixes code:

| Tool | What it does | Writes? |
| --- | --- | --- |
| `lsp_diagnostics <file>` | Compiler/analyzer errors, warnings and hints with severity, range, message and source server | ❌ read-only |
| `lsp_format <file> [range?]` | Formats a file or selection through the language server and applies the result, returning the diff | ✅ via `fs/write-intent` + sandbox policy |
| `lsp_completion <file> <line> <character>` | Completion suggestions at a cursor position — **reference-only hints**, never executed | ❌ read-only |

> ✨ A real `typescript-language-server` run is part of the test suite: diagnostics, formatting, and completion are verified end-to-end against a live server, not just mocks.

## Quick start

```sh
dsh plugin --profile <name> add <path-or-tarball-of-dsh-lsp-actions>
```

Configure one entry per language server (the shape mirrors the official `lsp-stdio` config):

```yaml
# in your profile's cordis.patch.yml (or the bundle row)
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

With an **empty `servers` table and no `ctx.lsp` seam mounted, the plugin contributes nothing** — it never starts servers you did not configure.

## Why it is safe by construction

- **Formatting is a real mutation, treated like `write`/`edit`.** Every byte goes through the `fs/write-intent` waterfall (observation → guarded write → observation) and the per-call sandbox policy.
- **Read-only sessions fail loud, fast, and structured** — `LSP_ACTION_READ_ONLY` with the shared `[sandbox: …]` marker, raised *before* any server round-trip.
- **Escalation matches the official tools.** Under a confining filesystem, `lsp_format` advertises the same `sandbox_permissions` / `justification` one-shot retry as `write`/`edit`, resolved through `ctx.approval`.
- **Conflicts never clobber.** If the file changed on disk after it was read, the guarded write fails with `LSP_ACTION_CONFLICT` and the model is told to choose: re-read and re-run, or apply the diff manually.
- **Timeouts are the platform's.** Each tool declares `timeoutMs`; the official `dsh-tool-call-timeout-policy` enforces it, and every await honors `exec.signal`.
- **Nothing is cached.** Diagnostics/completion results live only in the session log; there is no cross-session persistence.
- **Bad servers fail loudly.** A missing executable fails at load; a server that dies at startup fails the call with `LSP_ACTION_SERVER_FAILED` plus its stderr tail.

## Architecture

Actions run **official-seam-first** and fall back to the plugin's own minimal stdio client:

```
lsp_diagnostics / lsp_format / lsp_completion
        │
        ▼
   ctx.lsp seam (extended: diagnostics / formatDocument / completion)
        │  absent · legacy · no provider for this file
        ▼
   built-in stdio client  ←  servers table (ctx.subprocess.spawn + JSON-RPC)
```

The seam extension is proposed upstream (`upstream/lsp-action-seam.patch`, PR description in `upstream/PR-description.md`). Once it lands, the plugin keeps working unchanged — the built-in client simply stops being used. Full research and design notes: [`docs/seam-extension-notes.md`](docs/seam-extension-notes.md).

## Configuration reference

```ts
interface Config {
  /** Named language servers; empty = the plugin activates no servers. */
  servers?: Record<string, LspServerEntry>
  maxDiagnostics?: number        // default 200
  maxCompletionItems?: number    // default 20
  maxResultChars?: number        // default 16000 (complete rendered result cap)
  maxDocumentBytes?: number      // default 4000000
  timeoutMs?: number             // default 60000 (enforced by the official timeout policy)
}

interface LspServerEntry {
  command: string                        // executable, resolved on PATH at load
  extensionToLanguage: Record<string, string>  // ".ts" → "typescript"
  fileGlobs?: string[]                   // optional; glob matches beat the extension map
  args?: string[]                        // no shell
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown                // static answer to workspace/configuration
  formattingOptions?: unknown            // e.g. { tabSize: 2, insertSpaces: true }
  maxMessageBytes?: number               // default 16000000
  maxStderrBytes?: number                // default 1000000
  killGraceMs?: number                   // default 2000
  shutdownTimeoutMs?: number             // default 5000
  diagnosticsSettleMs?: number           // default 2000 (push-only diagnostics window)
}
```

## Development

```sh
pnpm install
pnpm test          # 105 tests: unit + fixture-server integration + real tsls e2e
pnpm build         # emits lib/
```

## License

[Apache License 2.0](LICENSE)
