# Editor Action Protocol v1

English | [简体中文](editor-protocol.zh-CN.md)

The **editor action protocol** is the stable, editor-facing surface of `dsh-lsp-actions`: any editor (VS Code first) consumes the plugin's LSP capabilities over **newline-delimited JSON-RPC 2.0** without driving an agent and without implementing LSP itself. The wire framing is identical to the official DeepSeek Harness SDK/ACP transports (one JSON object per line); only the method vocabulary differs.

| Method | Direction | Purpose |
| --- | --- | --- |
| `lsp.actions.list` | client → server | The protocol version, the action catalog, and the addressable DSH sessions. |
| `lsp.actions.run` | client → server | Execute one action (`diagnostics.get`, `quickfix.apply`, `format`, `completion.get`) with a structured result envelope. |
| `lsp.events` | client → server (notification) | `{subscribe: true/false}` turns the event stream on/off. |
| `lsp.event` | server → client (notification) | Streaming events: diagnostics updates, action status, file changes, session changes. |

Transport: one UTF-8 JSON object per line (`\n`-terminated). Requests carry `id` + `method` + `params`; responses carry `id` + `result` (or `error`); notifications carry only `method` + `params`. Malformed lines are ignored. Unknown methods answer `-32601`; handler failures answer `-32603`.

## Versioning and the backward-compatibility promise

- The protocol is versioned: `lsp.actions.list` returns `protocol: "lsp-actions/v1"` and `version: 1`. `lsp.actions.run` may carry `protocol`; a server that does not support it answers a failed envelope with `LSP_PROTOCOL_VERSION_UNSUPPORTED`.
- **v1 is frozen.** Every v1 field name, action id, event kind, and error code stays stable. Evolution is additive only:
  - new actions, new fields, and new event kinds may be added without a version bump;
  - existing field semantics never change in place;
  - a breaking change is published under a new `protocol` version, and servers may serve several versions side by side.
- **Clients must** ignore unknown fields, unknown event kinds, and unknown actions advertised in `lsp.actions.list`; route on the stable error `code`, never on message text.

## `lsp.actions.list`

Params: `{}`.

```json
{
  "protocol": "lsp-actions/v1",
  "version": 1,
  "actions": [
    { "action": "diagnostics.get", "writes": false, "description": "…" },
    { "action": "completion.get", "writes": false, "description": "…" },
    { "action": "quickfix.apply", "writes": true,  "description": "…" },
    { "action": "format",         "writes": true,  "description": "…" }
  ],
  "sessions": [
    { "sessionId": "…", "cwd": "/path/to/workspace", "live": true }
  ]
}
```

`actions` is the closed v1 catalog. `sessions` lists the live DSH sessions of the backend runtime; a run may pass `sessionId` to bind its permission preset and approval to that session.

## `lsp.actions.run`

Params:

```ts
{
  action: string              // an id from lsp.actions.list
  params?: object             // per-action parameters (below)
  sessionId?: string          // bind permission preset + approval to this DSH session
  requestId?: string          // echoed on the result and every action.status event
  protocol?: string           // optional; "lsp-actions/v1"
}
```

The result is **always** the same envelope — success and failure are structured, machine-routable:

```json
{ "requestId": "q1", "action": "quickfix.apply", "status": "succeeded", "result": { … } }
{ "requestId": "q1", "action": "quickfix.apply", "status": "failed",
  "error": { "code": "LSP_ACTION_READ_ONLY", "message": "…" } }
```

Positions and ranges on this wire use the **LSP convention**: zero-based, half-open UTF-16.

### `diagnostics.get` (read-only)

Params: `{ filePath, workspaceRoot, includeSource? }`.

Result: `{ kind: "diagnostics", filePath, diagnostics: [{ severity, range, message, source?, code? }], truncated, total, source? }`. The snapshot is cached in the backend's bounded LRU diagnostics cache (config `editor.diagnosticsCacheMaxFiles`) and announced to every subscriber as a `diagnostics.updated` event.

### `completion.get` (read-only)

Params: `{ filePath, workspaceRoot, position: { line, character } }` (zero-based cursor).

Result: `{ kind: "completion", filePath, position, items: [{ label, kind?, detail?, insertText?, sortText?, textEdit? }], truncated, total }`. Reference-only: the editor owns insertion.

### `quickfix.apply` (writes)

Params: `{ filePath, workspaceRoot, range?, title?, index?, only?, sandbox_permissions?, justification? }`.

- `title` (exact match) wins over `index` (zero-based, default `0`). Without `range`, the action targets the first cached **error** diagnostic of the file, when the cache holds a snapshot of the same source version.
- The backend runs `textDocument/codeAction` through the same seam-first runner the model tools use, selects the action, and applies its edits through the official write path (`fs/write-intent` + the session's official permission preset). Command-only actions are never executed. All targets are pre-flighted before the first write; out-of-workspace edits fail as `LSP_ACTION_CONFLICT`.

Result: `{ kind: "quickfixApplied", filePath, title, filesChanged, appliedEdits, diffs: [{ filePath, before, after }] }` or `{ kind: "unchanged", filePath }`.

### `format` (writes)

Params: `{ filePath, workspaceRoot, range?, sandbox_permissions?, justification? }` (`range` zero-based; omit for the whole file).

Result: `{ kind: "formatted", filePath, appliedEdits, linesChanged, before, after }` or `{ kind: "unchanged", filePath }`.

## `lsp.events`

Client notification `{ "method": "lsp.events", "params": { "subscribe": true|false } }`. While subscribed, the server pushes `lsp.event` notifications:

| Kind | Payload | Meaning |
| --- | --- | --- |
| `diagnostics.updated` | `{ filePath, diagnostics, truncated, total, source? }` | A fresh `diagnostics.get` snapshot (also emitted on demand, not only on subscription). |
| `action.status` | `{ requestId, action, status: started\|succeeded\|failed, error? }` | One event per run lifecycle transition. |
| `file.changed` | `{ filePath }` | A write action edited the file (or the filesystem observed a new version); cached diagnostics for it are invalidated. |
| `sessions.changed` | `{ sessions }` | The live-session snapshot changed. |

## Error codes

Every failed envelope carries a stable `code`. Route on it, never on message text.

| Code | Meaning |
| --- | --- |
| `LSP_ACTION_UNAVAILABLE` | No server entry and no seam provider handles the file; also the run-timeout failure. |
| `LSP_ACTION_UNSUPPORTED` | The server does not advertise the operation. |
| `LSP_ACTION_SERVER_FAILED` | The server failed (stderr tail in the message); startup failures retry once. |
| `LSP_ACTION_MALFORMED_RESPONSE` | The server sent a structurally invalid payload. |
| `LSP_ACTION_CONFLICT` | The file changed since it was read, or edits overlap / leave the workspace. |
| `LSP_ACTION_READ_ONLY` | The session's official permission preset is `read-only`; refused before any server round-trip. |
| `LSP_ACTION_WORKSPACE_REQUIRED` | The request carries no usable workspace root. |
| `LSP_ACTION_UNKNOWN` | Unknown action id, or no code action matched `title`/`index`. |
| `LSP_ACTION_INVALID_ARGS` | Malformed action parameters. |
| `LSP_ACTION_APPROVAL_UNAVAILABLE` | The official approval path could not grant a wider sandbox mode (no approval service, no live agent, no open turn, rejection, cancellation). |
| `LSP_PROTOCOL_VERSION_UNSUPPORTED` | The `protocol` a run declared is not served by this server. |

## Permission presets and approval (write actions)

Write actions (`quickfix.apply`, `format`) never bypass the official permission machinery:

1. **Permission preset gate.** The backend resolves the addressed session's official sandbox policy (`ctx.sandboxPolicy`). A `read-only` session refuses the write with `LSP_ACTION_READ_ONLY` before any server round-trip; `workspace-write` confines every edit to the session workspace (the official filesystem fence enforces it); `danger-full-access` passes through.
2. **Official write path.** Applied edits go through the `fs/write-intent` waterfall and guarded writes, exactly like the `lsp_format` tool — a file that changed on disk fails as `LSP_ACTION_CONFLICT`, never a silent clobber.
3. **Approval (`ask`).** The editor may carry the official escalation pair `sandbox_permissions` + `justification`; it is resolved through `approveEscalation` → `ctx.approval.request`, i.e. the same choreography as `write`/`edit` escalation. Because the official audit pair requires an open agent turn, escalation asks bind to the addressed session's live agent: with a live agent in an open turn, the composed answerers decide (Web UI dialog, CLI, or an ACP client's `session/request_permission`); without one, the run fails closed with `LSP_ACTION_APPROVAL_UNAVAILABLE`.

## How this composes with the official ACP server and the Python SDK

```
                        ┌─────────────────────────────────────────────┐
                        │  one DSH runtime (headless backend)          │
  VS Code extension ────┤  editor action protocol  (this plugin)       │
  (UI only)             │  dsh-lsp-actions, editor.enabled: true       │
                        ├─────────────────────────────────────────────┤
  official ACP clients ─┤  @deepseek-ai/dsh-acp  (agent chat sessions) │
  (separate spawn)      │  session/new · session/prompt · permissions  │
                        ├─────────────────────────────────────────────┤
  Python SDK ───────────┤  @deepseek-ai/dsh-sdk-jsonrpc-server         │
  (separate spawn)      │  session/prompt · session.event notifications│
                        └─────────────────────────────────────────────┘
```

- **Official ACP server** ([`@deepseek-ai/dsh-acp`](../../../packages/acp/acp/README.md) in the harness repo) is the *agent-conversation* transport: `session/new`, `session/prompt`, `session/cancel`, `session/request_permission`. Editors that want to chat with DSH agents use it — and the agents those ACP sessions run can call the plugin's `lsp_*` model tools. The editor action protocol is the *direct-capability* transport: no model round-trip, structured results. Each transport owns one stdio connection, so a runtime serves one owner per process; the same profile/persistence root can back both processes.
- **Approval interop.** When an editor write action escalates inside an ACP-owned session's open turn, the official approval ask flows to the ACP client as `session/request_permission` — the ACP client (or a policy) answers it, and the editor observes the outcome via `action.status`.
- **Python SDK** (`pip install deepseek-harness-sdk`) drives the same runtime over the official SDK wire (`session/prompt` + notifications). SDK users do not need the editor protocol: their sessions' agents call the `lsp_*` tools. Because this protocol uses the same newline-delimited JSON-RPC framing, an SDK-grade client can speak it unchanged — call `lsp.actions.list`, `lsp.actions.run`, and read `lsp.event` notifications with the same transport code.

## Engineering guarantees

- **Reversible registration.** The transport, event listeners, and cache all live in the plugin's effect scope; stopping or updating the plugin tears all of them down.
- **Bounded diagnostics cache.** A Map-backed LRU capped by `editor.diagnosticsCacheMaxFiles` (default 64), freshness-stamped and invalidated by filesystem observations and by the plugin's own writes.
- **Schema configuration.** `editor.enabled` (default `false` — only headless backends may claim stdio), `editor.requestTimeoutMs` (default 60000, enforced per run), `editor.diagnosticsCacheMaxFiles` (default 64). Misconfiguration fails at load.
