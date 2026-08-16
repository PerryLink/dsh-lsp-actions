# dsh-lsp-actions VS Code example

A minimal VS Code extension that consumes the [`dsh-lsp-actions`](../../) **editor action protocol** (`lsp.actions.list` / `lsp.actions.run` / `lsp.events`) over ACP-style JSON-RPC. The extension is **UI-only**: it never implements LSP logic, never computes diagnostics, and never edits buffers — every capability and every byte written belongs to the plugin backend.

```
┌──────────────────┐  stdio JSON-RPC (newline-delimited)   ┌───────────────────────────────┐
│  VS Code         │  lsp.actions.list / lsp.actions.run   │  editor backend (headless DSH)│
│  extension (UI)  │ ────────────────────────────────────► │  dsh-lsp-actions              │
│  sidebar + cmds  │  ◄──────────────────────────────────── │  (editor.enabled: true)       │
│                  │  lsp.event (diagnostics, status, …)   │  fs-local · subprocess-local   │
└──────────────────┘                                       │  LSP servers (tsls, …)        │
                                                           └───────────────────────────────┘
```

## What the sidebar shows

- **DSH Sessions** — the sessions living in the backend runtime (the `sessionId` a run can bind its permission preset to).
- **LSP Diagnostics** — per-file diagnostics pushed by the backend (`diagnostics.updated` events) and refreshed on demand. Each diagnostic row:
  - click → opens the file at the range (`openDiagnostic`, pure VS Code UI);
  - **Apply quickfix** button → the backend selects the server's preferred code action for that range and applies it through the official write policy (`quickfix.apply`). The extension never touches the buffer.
- **DSH: Format the active document** → `format` through the backend (whole file, server-verified edits).

## Install & run

### 1. Install the backend

```sh
cd examples/vscode/backend
npm install
# make sure a language server is on PATH, e.g.:
npm install -g typescript-language-server typescript
```

### 2. Launch the extension

```sh
cd examples/vscode/extension
code --new-window path/to/your/typescript/project .
```

- In VS Code: **Run and Debug → Run Extension** (`F5`), or `Extensions: Install from VSIX…` after `npx @vscode/vsce package`.
- Open the **DSH LSP Actions** activity-bar container (server-process icon).

### 3. Use it

1. **DSH: Connect to the editor backend** (command palette) — spawns `node backend/bin.mjs backend/cordis.yml` and reads `lsp.actions.list`.
2. Open a `.ts` file with an error, then press the **↻ refresh** button in the LSP Diagnostics view.
3. Expand the diagnostic and click **Apply quickfix** — the backend applies the server's fix and pushes `file.changed`; refresh shows the error gone.
4. Run **DSH: Format the active document** — indentation is rewritten by `typescript-language-server` through the backend.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `dshLspActions.backend.node` | `node` | Node executable for the backend. |
| `dshLspActions.backend.bin` | (bundled path) | Absolute path to `backend/bin.mjs`. |
| `dshLspActions.backend.config` | (bundled path) | Absolute path to `backend/cordis.yml`. |

## Recording the demo gif

The README ships a demo gif recorded with this flow on a clean profile:

1. `examples/vscode/backend` freshly `npm install`ed; a new TypeScript project with one bad file (e.g. an undeclared variable and four-space indentation).
2. Connect → refresh diagnostics (errors appear) → apply quickfix (fix applied) → format document (indentation rewritten).
3. Record with your favorite gif tool (e.g. `peek` on Linux, ScreenToGif on Windows, Kap on macOS) and place it as `docs/editor-demo.gif`; the main README references it.

## Boundaries (read this)

- **UI only.** All LSP requests, quickfix selection, edit computation, and file writes happen in the backend. The extension sends `lsp.actions.run` and renders the structured results/events.
- **Official write policy.** `quickfix.apply` and `format` ride the backend plugin's `fs/write-intent` waterfall and the session's official permission preset. In this unsandboxed example composition they write directly; compose `@deepseek-ai/dsh-fs-sandbox` + `@deepseek-ai/dsh-sandbox-policy` + `@deepseek-ai/dsh-user-approval` to enforce presets (read-only sessions then refuse writes with `LSP_ACTION_READ_ONLY`, and escalations ask through the official approval path).
- **One stdio owner.** The backend's stdout carries only protocol frames — never add a stdout logger to `backend/cordis.yml`.
- **Protocol stability.** The wire is `lsp-actions/v1` (see [`docs/editor-protocol.md`](../../docs/editor-protocol.md)); clients must ignore unknown fields and event kinds.
