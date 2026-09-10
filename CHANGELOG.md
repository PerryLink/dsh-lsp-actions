# Changelog

All notable changes to dsh-lsp-actions are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Rename the four translated READMEs to `README-<lang>.md`. npm selects the package-page readme as the first markdown file matching its `{README,README.*}` glob (`@npmcli/package-json`, publish path), and that glob order puts `README.<lang>.md` ahead of `README.md` — so npm was serving the Simplified-Chinese file for this package too (measured on 15/15 sampled packages of the family). The new names sit outside the glob, so the English source is served again. No content changed apart from the language-switcher link each translation holds to its siblings, and the repo readme gate still passes. Takes effect with the next release; an already-published version cannot gain a corrected readme retroactively.

- The release workflow now creates the GitHub Release itself, with the body taken from this version's CHANGELOG section. Until now a `v*` tag published to npm and stopped there, so every Release page had to be created by hand afterwards.

## [0.5.0] - 2026-09-10


### Added

- Project-config routing (`servers.<id>.projectMarkers`, issue #4): the nearest ancestor directory — walking up to the workspace root — that holds a configured project config file now decides which server serves a file, so sibling projects sharing an extension can use different servers. `["deno.json", "deno.jsonc"]` on the Deno entry and `["package.json", "tsconfig.json"]` on the TypeScript entry serve `apps/deno-app/src/main.ts` and `apps/node-app/src/main.ts` from their own servers with no path rule, and adding, renaming, or moving a project needs no configuration change. Routing order is `fileGlobs` → nearest project marker (matched only against entries that map the file's extension) → `extensionToLanguage`; the walk never leaves the workspace root, a project config never applies to a sibling directory, and an entry that declares no marker (the default) behaves exactly as before.

### Docs

- Document project-marker routing and its precedence in the five-language READMEs, and record the new `projectMarkers` key in `cordis.patch.yml` and `docs/seam-extension-notes.md`.

## [0.4.8] - 2026-09-10

### Changed

- Pin the `@deepseek-ai/dsh-*` dev/test dependencies to the published `0.1.5-rc.1` line and record `0.1.5-rc.1` in `dshWorkshop.compatibility.dshVersions`; the monthly Compat workflow now runs against `0.1.5-rc.1`. The peer range `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0` is unchanged, so no supported host line is dropped.

### Docs

- Refresh the five-language README compatibility baseline to `dsh-v0.1.5-rc.1` (verified 2026-09-10).

## [0.4.7] - 2026-09-09

### Fixed

- Remove the `LspConnection.pid` accessor: dsh `0.1.5-alpha.1` deleted `SubprocessHandle.pid` (`a95f0b368f`, which also removed the byte-identical getter from the official `lsp-stdio` connection), and no code in this plugin ever read it; the connection still terminates through `terminate()` / `waitForExit()` and reports failures through the retained stderr tail. No behavior change.

### Changed

- Adapt to DeepSeek Harness `dsh-v0.1.5-alpha.1`: widen the `@deepseek-ai/dsh-*` peer ranges to `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0` (prerelease-tuple resolution makes the plain band reject `0.1.5-alpha.1`), pin the devDependencies to `0.1.5-alpha.1`, append the new version to `dshWorkshop.compatibility.dshVersions`, repoint the compat workflow (CLI/base/headless) and the editor backend example dependencies to `0.1.5-alpha.1`; no behavior change.

### Docs

- Refresh the five-language README compatibility rows to `dsh-v0.1.5-alpha.1` (verified 2026-09-09) and record the executed seam status check in `docs/seam-extension-notes.md` §6.

## [0.4.6] - 2026-09-07

### Docs

- Fix the DSH plugin badge URL: shields.io rejects the four-segment static badge form with "404 badge not found"; the label now uses the documented double-dash form (`dsh--plugin`), rendering identically; no behavior change.


## [0.4.5] - 2026-09-07

### Fixed

- Align the `@deepseek-ai/dsh-*` peer ranges to `>=0.1.2-rc.1 <0.2.0`: the older `>=0.1.0-rc.8 <0.2.0` band resolved to only the `0.1.0-rc.8` prerelease under registry-driven resolution and broke fresh tarball installs; no behavior change.

### Docs

- Refresh the five-language README support-version wording: the verified GitHub tag `dsh-v0.1.3-alpha.1` now leads the compatibility claim, while npm `0.1.2-rc.1` stays the published dependency-pin line (peers `>=0.1.2-rc.1 <0.2.0`); no behavior change.


## [0.4.4] - 2026-09-04

### Changed

- Align the devDependency pins to the published dsh `0.1.2-rc.1` line, repoint the compat workflow (CLI/base/headless) from the stale `0.1.2-alpha.3` pins to `0.1.2-rc.1`, sync the editor backend example dependencies, and refresh the five-language README compatibility rows; no behavior change.

## [0.4.3] - 2026-09-02

### Changed

- Align the devDependency pins to the published dsh 0.1.2-alpha.5 line and re-verify the adaptation claims; no behavior change.

## [0.4.2] - 2026-09-01

### Changed

- Upgrade the `@deepseek-ai/dsh-*` dev dependencies from `0.1.2-alpha.2` to `0.1.2-alpha.3` (peer ranges stay `>=0.1.0-rc.8 <0.2.0`), align the `@deepseek-ai/cordis` / `@deepseek-ai/schemastery` peer and dev carets to `^4.0.2` / `^3.18.2`, refresh `dshWorkshop.compatibility.dshVersions`, sync the editor backend example dependencies to `^0.1.2-alpha.3`, repoint the compat workflow to the alpha.3 CLI/base/headless, and rewrite the five-language README compatibility rows to the alpha.3 fact (the plugin writes no session events itself).

## 0.4.1 — 2026-08-30

### Fixed

- Stop importing the `CallId` runtime value from `@deepseek-ai/dsh-llm` (removed in DeepSeek Harness `0.1.2-alpha.1`; renamed `ToolCallId`): the editor escalation-approval context now builds its call id through a local identity helper typed from the `@deepseek-ai/dsh-tools` execution contract, so approvals no longer crash on hosts without the old export.

## 0.4.0 — 2026-08-26

### Added

- 常驻会话客户端（保 didOpen）+ runner 抽象为公开 provider 接口。

## 0.3.4 — 2026-08-23

### Changed

- **Schemastery compatibility floor.** The `@deepseek-ai/schemastery` peer and dev dependency
  floor is raised from `^3.0.0` to `^3.18.0`, matching the harness release line. No behavior
  changes.

## 0.3.3 — 2026-08-22

### Changed

- **rc.2 compatibility release.** All `@deepseek-ai/dsh-*` dev dependencies are pinned to
  `0.1.1-rc.2`, the harness peer-dependency ranges stay `>=0.1.0-rc.8 <0.2.0`,
  `dshWorkshop.compatibility.dshVersions` now declares `0.1.1-rc.2`, the CI compat pins and the
  VS Code backend example track the same release line, and the READMEs declare DeepSeek Harness
  `0.1.1-rc.2` compatibility. No behavior changes — the full suite (including the real
  typescript-language-server e2e) passes against the rc.2 runtime.

## 0.3.2 — 2026-08-21

### Changed

- **rc.8 compatibility release.** All `@deepseek-ai/dsh-*` dev dependencies are pinned to
  `0.1.0-rc.8` and the harness peer dependencies are widened to `>=0.1.0-rc.8 <0.2.0`; the VS Code
  backend example tracks the same release line, and the READMEs declare DeepSeek Harness
  `0.1.0-rc.8` compatibility. No behavior changes — the full suite (including the real
  typescript-language-server e2e) passes against the rc.8 runtime.

## 0.3.1 — 2026-08-19

### Fixed

- The editor service's request-id serial is now instance-owned instead of module-level, matching its documented per-instance semantics — a plugin reload no longer shares counter state across mounts.

## 0.3.0 — 2026-08-16

### Added

- **Editor action protocol v1 — the IDE integration backend.** With `editor.enabled: true` in a
  dedicated headless composition, the plugin serves `lsp.actions.list` / `lsp.actions.run` /
  `lsp.events` over newline-delimited JSON-RPC 2.0 (wire-framing-compatible with the official
  SDK/ACP transports), so any editor can consume the LSP capabilities directly — no agent round-trip.
  - Four v1 actions: `diagnostics.get` (read-only), `completion.get` (read-only, zero-based LSP
    positions), `quickfix.apply` (selects a server-verified code action by `title`/`index` and
    applies its edits), and `format` (whole-file or range).
  - `run` always answers one structured `{ requestId, action, status, result | error }` envelope;
    failures carry the stable `LSP_ACTION_*` codes, extended with `LSP_ACTION_UNKNOWN`,
    `LSP_ACTION_INVALID_ARGS`, `LSP_ACTION_APPROVAL_UNAVAILABLE`, and
    `LSP_PROTOCOL_VERSION_UNSUPPORTED`.
  - Streamed `lsp.event` notifications: `diagnostics.updated`, `action.status`, `file.changed`,
    `sessions.changed`; `lsp.events {subscribe}` controls the stream.
  - **Versioning & backward compatibility**: `lsp-actions/v1` is frozen; evolution is additive
    only; breaking changes ship under a new protocol version. Documented in the bilingual spec
    [`docs/editor-protocol.md`](docs/editor-protocol.md) / [`docs/editor-protocol.zh-CN.md`](docs/editor-protocol.zh-CN.md).
- **Official permission presets and approval for editor writes.** `quickfix.apply` and `format`
  resolve the addressed session's official sandbox policy (read-only sessions fail with
  `LSP_ACTION_READ_ONLY` before any server round-trip), write through the `fs/write-intent`
  waterfall with guarded writes, and resolve the `sandbox_permissions` + `justification` escalation
  pair through the official `approveEscalation` ask (fail-closed with
  `LSP_ACTION_APPROVAL_UNAVAILABLE` when no answerer can decide).
- **Bounded LRU diagnostics cache** (`editor.diagnosticsCacheMaxFiles`, default 64):
  freshness-stamped snapshots, least-recently-used eviction, invalidated by filesystem
  observations and by the plugin's own writes; never persisted across restarts. Cached
  first-error ranges power range-less `quickfix.apply` targeting.
- **Schema configuration** for the backend: `editor.enabled` (default `false` — only headless
  backends may claim stdio), `editor.requestTimeoutMs` (default 60000, enforced per run), and
  `editor.diagnosticsCacheMaxFiles`. Misconfiguration fails at load.
- **Reversible registration.** The transport, event listeners, and cache live entirely inside the
  plugin's effect scope; stopping or updating the plugin tears the whole surface down.
- **`examples/vscode/`**: a minimal UI-only VS Code extension (sidebar with DSH sessions +
  diagnostics list + one-click quickfix + open-at-range + format) plus the headless backend
  composition (`backend/cordis.yml` + `bin.mjs`). The extension implements zero LSP logic.
- **Tests**: bounded-LRU coverage, editor-protocol service semantics (permission gating, escalation
  fail-closed, timeouts, cache invalidation), and a full diagnostics → quickfix → format chain over
  real JSON-RPC frames against the fixture LSP server.

### Changed

- **Prompt hygiene commitment**: the plugin injects no persona or prompt prose (model-facing
  surface = the eight tool schemas); any future prompt segment must open with one short role
  sentence and stay brief, aligned with the official Minimal persona style.
- README (EN/zh-CN) now documents the IDE-backend architecture (editor protocol × official ACP
  server × Python SDK), the versioning promise, the VS Code example, and the extended error-code
  table; es/hi/pt READMEs point at the canonical protocol docs.

## 0.2.0 — 2026-08-15

### Added

- **`lsp_rename` tool**: a server-verified symbol rename (`textDocument/prepareRename` +
  `textDocument/rename`) applied workspace-wide through the filesystem write-intent waterfall and
  the per-call sandbox policy, exactly like `lsp_format`. Edits are pre-flighted before the first
  write (workspace containment, overlap check, byte-capped read), no-op files are dropped, and the
  result renders per-file diff cards. Cross-document positions from `utf-8`/`utf-32` servers are
  decoded per document by reading each edited file; unreadable targets fail as a structured
  conflict instead of mis-decoding positions. File resource operations in a rename answer are
  refused as unsupported. New `LSP_ACTION_NO_SYMBOL` error code for a bare cursor.
- **Four new read-only tools**: `lsp_code_action` (server-verified quickfixes, reported never
  applied), `lsp_symbols` (workspace-wide name search and per-file symbol outline),
  `lsp_signature` (signature help at a cursor), and `lsp_inlay_hints` (type/parameter hints).
- **Operation-specific seam extras**: the seam query forwards `query` (workspace symbol search),
  `onlyKinds` (code-action filters), and `newName` (rename), so a future seam vintage can serve
  the extended operations directly.
- **Structured JSON-RPC errors**: `LspRpcError` carries the server's wire error code, so advisory
  round-trips (prepareRename) can distinguish error responses from transport failures.
- **Position encoding negotiation** for `utf-8` and `utf-32` servers: request positions are
  encoded and server results are decoded through a per-document codec, so non-utf-16 servers no
  longer fail the handshake.
- **`workspace/symbol` with an open routing file**: when `lsp_symbols` receives `file_path` with a
  query, the file stays transiently open for the request, so project-based servers (tsls) that
  refuse document-free symbol search work.
- **One fresh-spawn retry** when a server dies during its handshake, matching the official stdio
  host's single bad-transport retry; mid-action failures never retry.
- **Idle server eviction** (`idleTimeoutMs` per server entry, default 0 = keep alive).
- **Push-diagnostic debounce** (`diagnosticsDebounceMs` per server entry, default 250 ms): the
  latest pushed batch wins inside the settle window instead of the first.
- **Per-section `workspace/configuration` answers**: a plain-object `configuration` answers each
  requested section, falling back to the whole value.
- **CI** (GitHub Actions: Node 22/24 × ubuntu/windows/macos lint+build+test matrix with a separate
  coverage-gate job) and **coverage gates** (lines/statements/functions ≥ 90%, branches ≥ 85%),
  plus a tag-triggered **publish workflow** for npm releases.
- **Real-server e2e for rename and workspace symbols** through typescript-language-server (the
  suite is self-contained via the `typescript-language-server` devDependency).

### Changed

- **The action surface is eight tools**: the write-path safety contract (`write-intent`, sandbox
  policy, conflict handling) now covers `lsp_rename` alongside `lsp_format`; the shared sandbox
  escalation schema names the action (`formatting` / `rename`) in its advertised descriptions.
- **Tools are always registered.** With an empty `servers` table and no `ctx.lsp` seam, calls fail
  loudly with `LSP_ACTION_UNAVAILABLE` instead of the plugin contributing nothing.
- **Seam detection is lazy per call**: a `ctx.lsp` seam mounted after this plugin (or re-added
  mid-session) is served without a reload.
- **Completion results now render the insertion text** (`textEdit.newText` / `insertText`) on an
  indented arrow line, because the model only sees rendered content.
- **Glob routes prefer the file's own extension mapping** for the language id, falling back to the
  entry's first mapping only when the extension is not mapped.
- **Diagnostics, format, and inlay results carry columns** (and the format summary names the line
  span), improving UI precision and model readback.
- **The harness packages are peer dependencies** (`>=0.1.0-rc.6`), so a host harness shares one
  copy and cross-version `instanceof` mismatches cannot silently break error mapping.

### Fixed

- **Server re-spelled file URIs no longer corrupt rename targets.** Servers re-spell the root URI
  sent at initialize (lowercase drive letter and percent-encoded colon on Windows), and the
  workspace-relative mapping sliced the raw URI at the raw root's length — mis-cutting every such
  URI into a garbage path. Containment is now judged on decoded, case-insensitive forms while the
  relative path is sliced from the decoded URI.
- Diagnostics on servers whose `textDocumentSync` excludes transient open now fail with
  `LSP_ACTION_UNSUPPORTED` (previously unchecked for diagnostics).
- A caller abort racing a seam failure now surfaces the signal's reason instead of the seam's
  unrelated error.
- The e2e suite no longer depends on a sibling harness checkout's node_modules.

## 0.1.0 — 2026-08-14

- Initial release: `lsp_diagnostics`, `lsp_format`, and `lsp_completion` tools over the extended
  `ctx.lsp` seam proposal and the built-in stdio client.
