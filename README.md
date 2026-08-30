<div align="center">

# 🛰️ dsh-lsp-actions
- **1024 store channel**: `npm i -g dsh1024` once, then `dsh1024 plugin --profile web add dsh-lsp-actions` (counts toward the [deepseek1024.com](https://deepseek1024.com) install ranking).
[![Gitee](https://img.shields.io/badge/Gitee-mirror-c71d23?logo=gitee)](https://gitee.com/perrylink/dsh-lsp-actions)

**The LSP action surface for DeepSeek Harness — real language servers, real feedback, and the IDE integration backend for editors.**

*Diagnostics, formatting, completion, code actions, symbols, signature help, inlay hints, and rename for your agent's editor loop — plus the stable editor action protocol (`lsp.actions.*`) that lets any editor consume them directly.*

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
| Harness | DeepSeek Harness `0.1.1-rc.2` (compat declared for `>=0.1.0-rc.8 <0.2.0`) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Platforms | All (pure host; subprocess + filesystem, no network) |
| Model | Any (tools are model-agnostic; the plugin never calls a model) |

## What you get

`dsh-lsp-actions` mounts as a single host row (`id: lsp-actions`, `name: dsh-lsp-actions`, `inject: [tools, fs, subprocess]`). The official DeepSeek Harness `ctx.lsp` seam covers **navigation** (go-to-definition, references, implementation, hover); this plugin completes the **action surface** — the feedback loop an agent needs while it writes and fixes code:

1. **Eight `lsp_*` tools** — diagnostics, formatting, completion, code actions, symbols, signature help, inlay hints, and rename, all served by the same language servers your IDE uses.
2. **Editor action protocol v1** — a stable JSON-RPC surface (`lsp.actions.list` / `lsp.actions.run` / `lsp.events`) that lets any editor (VS Code first) consume those capabilities directly.
3. **Real-server verification** — a real `typescript-language-server` run is part of the test suite (self-contained, CI on Node 22/24 across Linux, Windows, and macOS), not just mocks.

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

- **git channel** (latest `main`): `dsh plugin --profile web add "github:PerryLink/dsh-lsp-actions#main"` — the `prepare` script builds (`tsc --noEmitOnError`).
- **npm channel** (published releases): `dsh plugin --profile web add dsh-lsp-actions`.
- **tarball channel**: `pnpm pack` in this repo, then `dsh plugin --profile web add ./dsh-lsp-actions-<version>.tgz`.
- **uninstall**: `dsh plugin --profile web remove dsh-lsp-actions` (or remove the row from the profile patch).

## Configuration

All tunables are Schemastery `Config` fields (changeable from cordis.yml). An id-targeted override replaces the whole row — restate every key you need. `cordis.patch.yml` documents each key inline.

| Key | Default | Meaning |
|---|---|---|
| `servers` | `{}` | Named language servers; an empty table activates no servers |
| `editor.enabled` | `false` | Serve the editor action protocol over JSON-RPC stdio (headless backend only) |
| `editor.requestTimeoutMs` | `60000` | Per-run timeout budget (ms) for the editor protocol |
| `editor.diagnosticsCacheMaxFiles` | `64` | Bounded LRU diagnostics-cache size (files) |
| `maxDiagnostics` | `200` | Diagnostics cap per result |
| `maxCompletionItems` | `20` | Completion-items cap per result |
| `maxCodeActions` | `50` | Code-actions cap per result |
| `maxSymbols` | `100` | Symbol-results cap |
| `maxSignatures` | `10` | Signature-help cap |
| `maxInlayHints` | `200` | Inlay-hints cap |
| `maxResultChars` | `16000` | Rendered-result cap (chars) |
| `maxDocumentBytes` | `4000000` | Document-read cap (bytes) |
| `timeoutMs` | `60000` | Per-call timeout, enforced by the official timeout policy |

Each `servers` entry is an `LspServerEntry`: `command` (executable resolved on PATH at load) and `extensionToLanguage` (`".ts"` → `typescript`) are required; optional `fileGlobs`, `args`, `env`, `initializationOptions`, `configuration`, `formattingOptions`, `maxMessageBytes`, `maxStderrBytes`, `killGraceMs`, `shutdownTimeoutMs`, `diagnosticsSettleMs`, `diagnosticsDebounceMs`, and `idleTimeoutMs` (`0` = keep the server process alive) tune the built-in stdio client.

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `lsp_diagnostics` | tool | `<file>` — compiler/analyzer errors, warnings, and hints with severity, range, message, and source server (read-only) |
| `lsp_format` | tool | `<file> [range?]` — formats a file/selection through the language server and applies it, returning the diff (writes via `fs/write-intent`) |
| `lsp_completion` | tool | `<file> <line> <character>` — completion suggestions at a cursor position, including the insertion text (read-only) |
| `lsp_code_action` | tool | `<file> [range?] [only?]` — server-verified quickfixes/refactorings with their edits, for a range or the first diagnostic (reference-only) |
| `lsp_symbols` | tool | `<query?> <file_path?>` — workspace-wide symbol search by name, or one file's outline (read-only) |
| `lsp_signature` | tool | `<file> <line> <character>` — signature help (parameters and documentation) inside a call (read-only) |
| `lsp_inlay_hints` | tool | `<file> [range?]` — type annotations and parameter-name hints from the server (read-only) |
| `lsp_rename` | tool | `<file> <line> <character> <new_name>` — server-verified rename, applied workspace-wide with per-file diffs (writes via `fs/write-intent`) |
| `lsp.actions.*` | protocol | Editor action protocol v1: `lsp.actions.list` / `lsp.actions.run` / `lsp.events` over JSON-RPC |
| `examples/vscode/` | extension | UI-only VS Code extension plus the headless backend composition it connects to |

## Editor action protocol v1

When `editor.enabled: true` is set in a dedicated headless composition, `dsh-lsp-actions` serves a stable editor protocol over newline-delimited JSON-RPC 2.0 (the same wire framing as the official SDK/ACP transports):

| Method | What it does |
|---|---|
| `lsp.actions.list` | Returns the `lsp-actions/v1` protocol version, the action catalog (`diagnostics.get`, `completion.get`, `quickfix.apply`, `format` — each flagged `writes`), and the addressable DSH sessions |
| `lsp.actions.run` | Executes one action with a structured `{ requestId, action, status, result \| error }` envelope; errors carry the stable `LSP_ACTION_*` codes |
| `lsp.events` | Subscribes to the streamed `lsp.event` notifications: `diagnostics.updated`, `action.status`, `file.changed`, `sessions.changed` |

All write actions (`quickfix.apply`, `format`) go through the **official permission presets and approval**: a `read-only` session is refused with `LSP_ACTION_READ_ONLY` before any server round-trip, edits ride the `fs/write-intent` waterfall, and the `sandbox_permissions` + `justification` escalation pair resolves through the official `approveEscalation` ask (fail-closed when no answerer can decide). Full wire spec, bilingual: [`docs/editor-protocol.md`](docs/editor-protocol.md) · [`docs/editor-protocol.zh-CN.md`](docs/editor-protocol.zh-CN.md).

**Versioning and the backward-compatibility promise**

- The protocol is versioned — `lsp.actions.list` returns `protocol: "lsp-actions/v1"`, `version: 1`. **v1 is frozen:** field names, action ids, event kinds, and error codes stay stable forever.
- Evolution is **additive only**: new actions, fields, and event kinds arrive without a version bump; existing semantics never change in place; a breaking change ships under a new `protocol` version, which servers may serve side by side.
- Clients must ignore unknown fields, unknown event kinds, and unknown actions, and route on the stable error `code`, never on message text.

**Error codes**

Every failure carries a stable `code`; models and callers route on the code, never on message text.

| Code | Meaning |
|---|---|
| `LSP_ACTION_UNAVAILABLE` | No server entry and no seam provider handles this file |
| `LSP_ACTION_UNSUPPORTED` | The server (or seam provider) does not advertise the operation |
| `LSP_ACTION_SERVER_FAILED` | The server failed (with its stderr tail); startup failures retry once |
| `LSP_ACTION_MALFORMED_RESPONSE` | The server sent a structurally invalid payload |
| `LSP_ACTION_CONFLICT` | The file changed since it was read, or the edits overlap / go out of bounds / leave the workspace |
| `LSP_ACTION_READ_ONLY` | The session's sandbox mode forbids the formatting/rename write |
| `LSP_ACTION_WORKSPACE_REQUIRED` | The calling session has no workspace cwd to root the server in |
| `LSP_ACTION_NO_SYMBOL` | The server found no renameable symbol at the cursor position |
| `LSP_ACTION_UNKNOWN` | Editor protocol: unknown action id, or no code action matched `title`/`index` |
| `LSP_ACTION_INVALID_ARGS` | Editor protocol: malformed action parameters |
| `LSP_ACTION_APPROVAL_UNAVAILABLE` | Editor protocol: the approval path could not grant a wider sandbox mode (fail-closed) |
| `LSP_PROTOCOL_VERSION_UNSUPPORTED` | Editor protocol: the declared protocol version is not supported |

## VS Code extension

[`examples/vscode/`](examples/vscode/) ships a **UI-only** extension (sidebar with the DSH sessions, the diagnostics list, one-click quickfix apply, open-at-range, and format) plus the headless backend composition (`backend/cordis.yml`) it connects to over ACP-style JSON-RPC. The extension implements zero LSP logic — every capability and every byte written belongs to the plugin. Install steps, settings, and the demo-gif recording script are in [`examples/vscode/README.md`](examples/vscode/README.md).

![Editor demo](docs/editor-demo.gif)

## Permissions & data

- **Permissions**: formatting and rename ride the official permission presets and approval — the `fs/write-intent` waterfall and the `sandbox_permissions` / `justification` escalation pair resolved through `ctx.approval`. The plugin declares `fs:read`, `fs:write`, `subprocess:spawn`, and `network:none` in its workshop manifest.
- **Data**: nothing is stored on disk; tool results live only in the session log (no cross-session persistence). The editor protocol keeps one bounded in-memory LRU diagnostics cache, freshness-stamped and never persisted across restarts.
- **No network**: the plugin makes no network requests; it talks to language servers over local subprocess stdio.

## Security boundaries

- **Read-only by default.** Six of the eight tools are reference-only; only `lsp_format` and `lsp_rename` mutate, and they do so as real `write`/`edit` mutations.
- **Official seams, not re-implemented.** Every byte goes through the `fs/write-intent` waterfall (observation → guarded write → observation) and the per-call sandbox policy; escalation matches the official `write`/`edit` tools.
- **Fail loud, fast, structured.** Empty `servers` + no `ctx.lsp` seam → `LSP_ACTION_UNAVAILABLE`; read-only sessions → `LSP_ACTION_READ_ONLY` before any server round-trip; command forms are reported and never executed.
- **Conflicts never clobber.** A file changed on disk after it was read fails with `LSP_ACTION_CONFLICT`; `lsp_rename` pre-flights every edited file before the first write.
- **Bounded work.** Result caps, byte caps, and the platform's timeout policy bound every call; the diagnostics cache is a bounded LRU.
- **Nothing cached on the model path.** Tool results live only in the session log; the diagnostics cache never persists across restarts.
- **Bad servers fail loudly.** A missing executable fails at load; a server that dies at startup fails the call with `LSP_ACTION_SERVER_FAILED` plus its stderr tail (after one fresh-spawn retry).
- **Prompt hygiene.** The plugin injects no persona or prompt prose into the session system prompt — its model-facing surface is the eight tool schemas.

## Architecture

Actions run **official-seam-first** and fall back to the plugin's own minimal stdio client:

```text
lsp_diagnostics / lsp_format / lsp_completion / lsp_code_action /
lsp_symbols / lsp_signature / lsp_inlay_hints / lsp_rename
        │
        ▼
   ctx.lsp seam (extended: diagnostics / formatDocument / completion)
        │  absent · legacy · no provider for this file
        ▼
   built-in stdio client  ←  servers table (ctx.subprocess.spawn + JSON-RPC)
```

The seam extension is proposed upstream (`upstream/lsp-action-seam.patch`, PR description in `upstream/PR-description.md`). Once it lands, the plugin keeps working unchanged — the built-in client simply stops being used. The built-in client stays as the standalone fallback for the `servers` table. The **editor protocol** rides the same runner, the same write path, and the same permission machinery. Full research and design notes: [`docs/seam-extension-notes.md`](docs/seam-extension-notes.md).

The action backend is behind a public provider interface — `ActionRunner` (exported from the package) — implemented by the bundled runner and open to third-party providers: the eight tools consume only that interface, never a concrete client.

## Known limitations

- **Resident documents.** Each document opens once and stays open for the server instance's lifetime — a later request with changed source sends one full-document `didChange`, and the process shutdown closes every document — so project-based servers like tsls serve `textDocument/signatureHelp` and document-free `workspace/symbol` instead of answering `null` on a freshly-closed document. The resident set is bounded by the workspace and cleared with the instance (idle eviction or plugin disposal).
- **Range formatting requires the server's range provider.** Servers that only advertise whole-document formatting fail range requests with `LSP_ACTION_UNSUPPORTED`.
- **Rename applies text edits only.** Resource operations (create/delete/rename files) in a server's rename answer are refused with `LSP_ACTION_UNSUPPORTED`, and edits outside the workspace fail as `LSP_ACTION_CONFLICT` before anything is written.

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

- [@PerryLink](https://github.com/PerryLink) — creator and maintainer: the LSP action client and server lifecycle, all eight tools, the editor action protocol, tests, CI, and the five-language docs.

## PerryLink DSH Plugin Family

This project is one of the [33 DeepSeek Harness plugins](https://github.com/PerryLink) maintained by [PerryLink](https://github.com/PerryLink). If this one helps you, the others likely will too:

| Plugin | One-liner |
|---|---|
| **[dsh-dsh-auto-review](https://github.com/PerryLink/dsh-dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default | |
| **[dsh-dsh-background-agents](https://github.com/PerryLink/dsh-dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | |
| **[dsh-dsh-budget](https://github.com/PerryLink/dsh-dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | |
| **[dsh-dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore | |
| **[dsh-dsh-claude-move](https://github.com/PerryLink/dsh-dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | |
| **[dsh-dsh-click](https://github.com/PerryLink/dsh-dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. | |
| **[dsh-dsh-composer-history](https://github.com/PerryLink/dsh-dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search | |
| **[dsh-dsh-data-quality](https://github.com/PerryLink/dsh-dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) | |
| **[dsh-dsh-defend](https://github.com/PerryLink/dsh-dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | |
| **[dsh-dsh-doublecheck](https://github.com/PerryLink/dsh-dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review | |
| **[dsh-dsh-draw](https://github.com/PerryLink/dsh-dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | |
| **[dsh-dsh-fast](https://github.com/PerryLink/dsh-dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. | |
| **[dsh-dsh-fund-research](https://github.com/PerryLink/dsh-dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds | |
| **[dsh-dsh-github](https://github.com/PerryLink/dsh-dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval | |
| **[dsh-dsh-industry-research](https://github.com/PerryLink/dsh-dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` | |
| **[dsh-dsh-library](https://github.com/PerryLink/dsh-dsh-library)** | Local document knowledge base for DeepSeek Harness. | |
| **[dsh-dsh-local-ai](https://github.com/PerryLink/dsh-dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. | |
| **[dsh-dsh-mask](https://github.com/PerryLink/dsh-dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer | |
| **[dsh-dsh-mcp-panel](https://github.com/PerryLink/dsh-dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors | |
| **[dsh-dsh-memento](https://github.com/PerryLink/dsh-dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool | |
| **[dsh-dsh-observe](https://github.com/PerryLink/dsh-dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. | |
| **[dsh-dsh-output-styles](https://github.com/PerryLink/dsh-dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching | |
| **[dsh-dsh-permission-rules](https://github.com/PerryLink/dsh-dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit | |
| **[dsh-dsh-plugin-guide](https://github.com/PerryLink/dsh-dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill | |
| **[dsh-dsh-research-report](https://github.com/PerryLink/dsh-dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions | |
| **[dsh-dsh-score](https://github.com/PerryLink/dsh-dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. | |
| **[dsh-dsh-session-pin](https://github.com/PerryLink/dsh-dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | |
| **[dsh-dsh-session-sync](https://github.com/PerryLink/dsh-dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. | |
| **[dsh-dsh-skill-pack-security](https://github.com/PerryLink/dsh-dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review | |
| **[dsh-dsh-talk](https://github.com/PerryLink/dsh-dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. | |
| **[dsh-dsh-test-drive](https://github.com/PerryLink/dsh-dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. | |
| **[dsh-dsh-translate](https://github.com/PerryLink/dsh-dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. | |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-lsp-actions contributors
