<div align="center">

# 🛰️ dsh-lsp-actions

**The LSP action surface for DeepSeek Harness — real language servers, real feedback.**

Diagnostics, formatting, code completion, quickfixes, symbols, signature help, inlay hints, and workspace-wide rename for your agent's editor loop, powered by the same language servers your IDE uses.

[![Topic: dsh](https://img.shields.io/badge/Topic-dsh-4D6BFE?style=for-the-badge)](https://github.com/topics/dsh)
[![Topic: dsh-plugin](https://img.shields.io/badge/Topic-dsh--plugin-8257D0?style=for-the-badge)](https://github.com/topics/dsh-plugin)
[![CI](https://github.com/PerryLink/dsh-lsp-actions/actions/workflows/ci.yml/badge.svg)](https://github.com/PerryLink/dsh-lsp-actions/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dw/dsh-lsp-actions?style=flat-square)](https://www.npmjs.com/package/dsh-lsp-actions)
[![npm](https://img.shields.io/npm/v/dsh-lsp-actions?style=flat-square)](https://www.npmjs.com/package/dsh-lsp-actions)
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
| `lsp_completion <file> <line> <character>` | Completion suggestions at a cursor position, including the actual insertion text | ❌ read-only |
| `lsp_code_action <file> [range?] [only?]` | Server-verified quickfixes/refactorings (with their edits) for a range or the first diagnostic | ❌ reference-only |
| `lsp_symbols <query?> <file_path?>` | Workspace-wide symbol search by name, or one file's symbol outline | ❌ read-only |
| `lsp_signature <file> <line> <character>` | Signature help (parameters and documentation) inside a call | ❌ read-only |
| `lsp_inlay_hints <file> [range?]` | Type annotations and parameter-name hints from the server | ❌ read-only |
| `lsp_rename <file> <line> <character> <new_name>` | Server-verified symbol rename, applied workspace-wide with per-file diffs | ✅ via `fs/write-intent` + sandbox policy |

> ✨ A real `typescript-language-server` run is part of the test suite: diagnostics, formatting, completion, symbol search, and rename are verified end-to-end against a live server, not just mocks. The suite is self-contained (tsls is a devDependency) and runs in CI on Node 22/24 across Linux, Windows, and macOS.

## Quick start

```sh
dsh plugin --profile <name> add dsh-lsp-actions
```

Remove it with:

```sh
dsh plugin --profile <name> remove dsh-lsp-actions
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
        maxCodeActions: 50
        maxSymbols: 100
        maxSignatures: 10
        maxInlayHints: 200
        maxResultChars: 16000
        timeoutMs: 60000
```

The eight tools are always registered. With an **empty `servers` table and no `ctx.lsp` seam mounted, calls fail loudly** with `LSP_ACTION_UNAVAILABLE` telling the user what to configure — the plugin never starts servers you did not configure. A `ctx.lsp` seam mounted **after** this plugin is picked up on the next call (seam detection is per-call, so load order does not matter).

## Why it is safe by construction

- **Formatting and rename are real mutations, treated like `write`/`edit`.** Every byte goes through the `fs/write-intent` waterfall (observation → guarded write → observation) and the per-call sandbox policy. `lsp_rename` pre-flights every edited file (workspace containment, overlap check, byte-capped read) *before* the first write, so a bad server response cannot leave a half-applied rename.
- **Everything else is read-only by design.** Code actions, completions, symbols, signatures, and hints are reported as reference material; applying them is the model's own write/edit decision. Command forms are reported and **never executed**.
- **Read-only sessions fail loud, fast, and structured** — `LSP_ACTION_READ_ONLY` with the shared `[sandbox: …]` marker, raised *before* any server round-trip.
- **Escalation matches the official tools.** Under a confining filesystem, `lsp_format` and `lsp_rename` advertise the same `sandbox_permissions` / `justification` one-shot retry as `write`/`edit`, resolved through `ctx.approval`.
- **Conflicts never clobber.** If the file changed on disk after it was read, the guarded write fails with `LSP_ACTION_CONFLICT` and the model is told to choose: re-read and re-run, or apply the diff manually.
- **Timeouts are the platform's.** Each tool declares `timeoutMs`; the official `dsh-tool-call-timeout-policy` enforces it, and every await honors `exec.signal`.
- **Nothing is cached.** Results live only in the session log; there is no cross-session persistence.
- **Bad servers fail loudly.** A missing executable fails at load; a server that dies at startup fails the call with `LSP_ACTION_SERVER_FAILED` plus its stderr tail (after one fresh-spawn retry).

## Architecture

Actions run **official-seam-first** and fall back to the plugin's own minimal stdio client:

```
lsp_diagnostics / lsp_format / lsp_completion / lsp_code_action /
lsp_symbols / lsp_signature / lsp_inlay_hints / lsp_rename
        │
        ▼
   ctx.lsp seam (extended: diagnostics / formatDocument / completion)
        │  absent · legacy · no provider for this file
        ▼
   built-in stdio client  ←  servers table (ctx.subprocess.spawn + JSON-RPC)
```

The seam extension is proposed upstream (`upstream/lsp-action-seam.patch`, PR description in `upstream/PR-description.md`). Once it lands, the plugin keeps working unchanged — the built-in client simply stops being used. The built-in client stays as the standalone fallback for the `servers` table. Full research and design notes: [`docs/seam-extension-notes.md`](docs/seam-extension-notes.md).

## Configuration reference

```ts
interface Config {
  /** Named language servers; empty = the plugin's own client serves nothing. */
  servers?: Record<string, LspServerEntry>
  maxDiagnostics?: number        // default 200
  maxCompletionItems?: number    // default 20
  maxCodeActions?: number        // default 50
  maxSymbols?: number            // default 100
  maxSignatures?: number         // default 10
  maxInlayHints?: number         // default 200
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
  configuration?: unknown                // object form answers workspace/configuration per section
  formattingOptions?: unknown            // e.g. { tabSize: 2, insertSpaces: true }
  maxMessageBytes?: number               // default 16000000
  maxStderrBytes?: number                // default 1000000
  killGraceMs?: number                   // default 2000
  shutdownTimeoutMs?: number             // default 5000
  diagnosticsSettleMs?: number           // default 2000 (push-only diagnostics window)
  diagnosticsDebounceMs?: number         // default 250 (quiet period after the last pushed batch)
  idleTimeoutMs?: number                 // default 0 (0 = keep the server process alive)
}
```

### Error codes

Every failure carries a stable `code` on the error result; models and callers route on the code, never on message text.

| Code | Meaning |
| --- | --- |
| `LSP_ACTION_UNAVAILABLE` | No server entry and no seam provider handles this file. |
| `LSP_ACTION_UNSUPPORTED` | The server (or seam provider) does not advertise the operation. |
| `LSP_ACTION_SERVER_FAILED` | The server failed (with its stderr tail); startup failures retry once. |
| `LSP_ACTION_MALFORMED_RESPONSE` | The server sent a structurally invalid payload. |
| `LSP_ACTION_CONFLICT` | The file changed since it was read, or the server's edits overlap / go out of bounds / leave the workspace. |
| `LSP_ACTION_READ_ONLY` | The session's sandbox mode forbids the formatting/rename write. |
| `LSP_ACTION_WORKSPACE_REQUIRED` | The calling session has no workspace cwd to root the server in. |
| `LSP_ACTION_NO_SYMBOL` | The server found no renameable symbol at the cursor position. |

### Host version support

The plugin declares its DeepSeek Harness packages as **peer dependencies** (`@deepseek-ai/dsh-fs`, `dsh-llm`, `dsh-sandbox`, `dsh-subprocess`, `dsh-tools` ≥ `0.1.0-rc.6`), so one copy serves both the host and the plugin. Tested against `0.1.0-rc.6`; last verified 2026-08-15.

### Known limitations

- **Transient documents.** Every action opens the file, runs one request, and closes it again (matching the official stdio host). Project-based servers that require a resident open file for document-free requests (tsls refuses `workspace/symbol` without one) are served by passing `file_path` to `lsp_symbols`, which keeps the routing file open for that request. tsls also answers `textDocument/signatureHelp` with `null` under this lifecycle; other servers (gopls, pyright, rust-analyzer) serve it normally.
- **Range formatting requires the server's range provider.** Servers that only advertise whole-document formatting fail range requests with `LSP_ACTION_UNSUPPORTED`.
- **Rename applies text edits only.** Resource operations (create/delete/rename files) in a server's rename answer are refused with `LSP_ACTION_UNSUPPORTED`, and edits outside the workspace fail as `LSP_ACTION_CONFLICT` before anything is written. On `utf-8`/`utf-32` servers, cross-file rename positions are decoded by reading each edited file; an unreadable edited file fails the call as a conflict instead of mis-decoding positions.

## Development

```sh
pnpm install
pnpm run lint        # oxlint over src/ and tests/
pnpm test            # 240+ tests: unit + fixture-server integration + real tsls e2e
pnpm run test:coverage   # gates: lines/statements/functions ≥ 90%, branches ≥ 85%
pnpm build           # emits lib/
```

### Releasing

CI runs the lint/build/test matrix plus the coverage gate on every push and pull request. Pushing a `v*` tag triggers the publish workflow, which verifies the suite and publishes the package to npm — it needs an `NPM_TOKEN` Actions secret (a publish-scoped npm access token) set once on the repository. The version is bumped manually in `package.json`/`CHANGELOG.md` before tagging.

## Contributors

Thanks to everyone who has contributed to this project:

- [PerryLink](https://github.com/PerryLink) — the plugin itself: the LSP action client and server lifecycle, all eight tools, tests, CI, and documentation.

## License

[Apache License 2.0](LICENSE)
