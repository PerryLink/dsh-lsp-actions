# Changelog

All notable changes to dsh-lsp-actions are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- **Four new read-only tools**: `lsp_code_action` (server-verified quickfixes, reported never
  applied), `lsp_symbols` (workspace-wide name search and per-file symbol outline),
  `lsp_signature` (signature help at a cursor), and `lsp_inlay_hints` (type/parameter hints).
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
- **CI** (GitHub Actions: Node 22/24 × ubuntu/windows/macos, lint + build + tests + coverage) and
  **coverage gates** (lines/statements/functions ≥ 90%, branches ≥ 85%).
- **Real-server e2e for workspace symbols** through typescript-language-server (the suite is now
  self-contained via the `typescript-language-server` devDependency).

### Changed

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

- Diagnostics on servers whose `textDocumentSync` excludes transient open now fail with
  `LSP_ACTION_UNSUPPORTED` (previously unchecked for diagnostics).
- A caller abort racing a seam failure now surfaces the signal's reason instead of the seam's
  unrelated error.
- The e2e suite no longer depends on a sibling harness checkout's node_modules.

## 0.1.0 — 2026-08-14

- Initial release: `lsp_diagnostics`, `lsp_format`, and `lsp_completion` tools over the extended
  `ctx.lsp` seam proposal and the built-in stdio client.
