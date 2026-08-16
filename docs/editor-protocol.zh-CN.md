# 编辑器 Action 协议 v1

[English](editor-protocol.md) | 简体中文

**编辑器 action 协议**是 `dsh-lsp-actions` 面向编辑器的稳定接口：任何编辑器（先行 VS Code）通过**换行分帧的 JSON-RPC 2.0** 消费插件的 LSP 能力——无需驱动 agent，也无需自己实现 LSP。线上帧格式与官方 DeepSeek Harness SDK/ACP 传输完全一致（每行一个 JSON 对象）；区别仅在方法词汇。

| 方法 | 方向 | 用途 |
| --- | --- | --- |
| `lsp.actions.list` | 客户端 → 服务端 | 协议版本、动作目录、可寻址的 DSH 会话。 |
| `lsp.actions.run` | 客户端 → 服务端 | 执行一个动作（`diagnostics.get`、`quickfix.apply`、`format`、`completion.get`），返回结构化结果信封。 |
| `lsp.events` | 客户端 → 服务端（通知） | `{subscribe: true/false}` 开关事件流。 |
| `lsp.event` | 服务端 → 客户端（通知） | 流式事件：诊断更新、动作状态、文件变更、会话变更。 |

传输：每行一个 UTF-8 JSON 对象（以 `\n` 结尾）。请求携带 `id` + `method` + `params`；响应携带 `id` + `result`（或 `error`）；通知只携带 `method` + `params`。格式错误的行被忽略。未知方法应答 `-32601`；处理失败应答 `-32603`。

## 版本化与向后兼容承诺

- 协议带版本：`lsp.actions.list` 返回 `protocol: "lsp-actions/v1"` 与 `version: 1`。`lsp.actions.run` 可携带 `protocol`；服务端不支持时以 `LSP_PROTOCOL_VERSION_UNSUPPORTED` 的失败信封应答。
- **v1 已冻结。** v1 的所有字段名、动作 id、事件类型与错误码保持稳定。演进只做加法：
  - 新增动作、新字段、新事件类型无需升版本；
  - 既有字段语义不得原地变更；
  - 破坏性变更以新的 `protocol` 版本发布，服务端可同时服务多个版本。
- **客户端必须**忽略未知字段、未知事件类型与目录中未宣告的动作；按稳定错误 `code` 路由，绝不解析消息文本。

## `lsp.actions.list`

参数：`{}`。

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

`actions` 是闭合的 v1 目录。`sessions` 列出后端运行时的活跃 DSH 会话；`run` 可传 `sessionId` 把权限预设与审批绑定到该会话。

## `lsp.actions.run`

参数：

```ts
{
  action: string              // lsp.actions.list 中的动作 id
  params?: object             // 各动作参数（见下）
  sessionId?: string          // 将权限预设与审批绑定到该 DSH 会话
  requestId?: string          // 在结果与每个 action.status 事件中回显
  protocol?: string           // 可选；"lsp-actions/v1"
}
```

结果**始终**是同一信封——成功与失败均为结构化、可机器路由：

```json
{ "requestId": "q1", "action": "quickfix.apply", "status": "succeeded", "result": { … } }
{ "requestId": "q1", "action": "quickfix.apply", "status": "failed",
  "error": { "code": "LSP_ACTION_READ_ONLY", "message": "…" } }
```

线上位置与范围采用 **LSP 约定**：零基、半开区间、UTF-16。

### `diagnostics.get`（只读）

参数：`{ filePath, workspaceRoot, includeSource? }`。

结果：`{ kind: "diagnostics", filePath, diagnostics: [{ severity, range, message, source?, code? }], truncated, total, source? }`。快照存入后端有界的 LRU 诊断缓存（配置 `editor.diagnosticsCacheMaxFiles`），并以 `diagnostics.updated` 事件推送给所有订阅者。

### `completion.get`（只读）

参数：`{ filePath, workspaceRoot, position: { line, character } }`（零基光标）。

结果：`{ kind: "completion", filePath, position, items: [{ label, kind?, detail?, insertText?, sortText?, textEdit? }], truncated, total }`。仅供参考：插入由编辑器自己完成。

### `quickfix.apply`（写）

参数：`{ filePath, workspaceRoot, range?, title?, index?, only?, sandbox_permissions?, justification? }`。

- `title`（精确匹配）优先于 `index`（零基，默认 `0`）。未给 `range` 时，若缓存中持有同源文件版本快照，则以该文件第一条**错误**诊断的范围为目标。
- 后端通过模型工具同款 seam-first runner 执行 `textDocument/codeAction`，选中动作后经官方写入路径（`fs/write-intent` + 会话官方权限预设）应用其编辑。仅命令型动作永不执行。所有目标在首个字节写入前完成预检；越出工作区的编辑以 `LSP_ACTION_CONFLICT` 失败。

结果：`{ kind: "quickfixApplied", filePath, title, filesChanged, appliedEdits, diffs: [{ filePath, before, after }] }` 或 `{ kind: "unchanged", filePath }`。

### `format`（写）

参数：`{ filePath, workspaceRoot, range?, sandbox_permissions?, justification? }`（`range` 零基；省略即全文件）。

结果：`{ kind: "formatted", filePath, appliedEdits, linesChanged, before, after }` 或 `{ kind: "unchanged", filePath }`。

## `lsp.events`

客户端通知 `{ "method": "lsp.events", "params": { "subscribe": true|false } }`。订阅期间，服务端推送 `lsp.event` 通知：

| 类型 | 载荷 | 含义 |
| --- | --- | --- |
| `diagnostics.updated` | `{ filePath, diagnostics, truncated, total, source? }` | 一次新的 `diagnostics.get` 快照（按需产生，非仅订阅时）。 |
| `action.status` | `{ requestId, action, status: started\|succeeded\|failed, error? }` | 每次运行的生命周期转换。 |
| `file.changed` | `{ filePath }` | 写动作编辑了文件（或文件系统观察到新版本）；该文件的缓存诊断已失效。 |
| `sessions.changed` | `{ sessions }` | 活跃会话快照变化。 |

## 错误码

每个失败信封携带稳定 `code`。请按 code 路由，切勿解析消息文本。

| 码 | 含义 |
| --- | --- |
| `LSP_ACTION_UNAVAILABLE` | 无服务器条目且无 seam 提供方处理该文件；也用于运行超时。 |
| `LSP_ACTION_UNSUPPORTED` | 服务器未宣告该操作。 |
| `LSP_ACTION_SERVER_FAILED` | 服务器失败（消息带 stderr 尾部）；启动失败重试一次。 |
| `LSP_ACTION_MALFORMED_RESPONSE` | 服务器返回结构非法的载荷。 |
| `LSP_ACTION_CONFLICT` | 文件在读取后变更，或编辑重叠/越出工作区。 |
| `LSP_ACTION_READ_ONLY` | 会话官方权限预设为 `read-only`；在任何服务器往返前拒绝。 |
| `LSP_ACTION_WORKSPACE_REQUIRED` | 请求没有可用的工作区根。 |
| `LSP_ACTION_UNKNOWN` | 未知动作 id，或没有 code action 匹配 `title`/`index`。 |
| `LSP_ACTION_INVALID_ARGS` | 动作参数不合法。 |
| `LSP_ACTION_APPROVAL_UNAVAILABLE` | 官方审批路径未能授予更宽沙箱模式（无审批服务、无活跃 agent、无开放 turn、被拒或取消）。 |
| `LSP_PROTOCOL_VERSION_UNSUPPORTED` | 该运行所声明的 `protocol` 不被本服务端支持。 |

## 权限预设与审批（写动作）

写动作（`quickfix.apply`、`format`）绝不绕过官方权限机制：

1. **权限预设门禁。** 后端解析所寻址会话的官方沙箱策略（`ctx.sandboxPolicy`）。`read-only` 会话在任何服务器往返前以 `LSP_ACTION_READ_ONLY` 拒绝写操作；`workspace-write` 把每次编辑限制在会话工作区内（由官方文件系统栅栏执行）；`danger-full-access` 放行。
2. **官方写入路径。** 应用的编辑走 `fs/write-intent` 瀑布与受守卫写入，与 `lsp_format` 工具完全一致——磁盘上文件已变化时以 `LSP_ACTION_CONFLICT` 失败，绝不静默覆盖。
3. **审批（`ask`）。** 编辑器可携带官方升级对 `sandbox_permissions` + `justification`；经 `approveEscalation` → `ctx.approval.request` 解析，即与 `write`/`edit` 升级相同的编排。因官方审计对要求开放 agent turn，升级请求绑定所寻址会话的活跃 agent：有活跃 agent 且处于开放 turn 时，由已组合的应答方决定（Web UI 对话框、CLI，或 ACP 客户端的 `session/request_permission`）；否则以 `LSP_ACTION_APPROVAL_UNAVAILABLE` 失败关闭。

## 与官方 ACP server、Python SDK 的配合

```
                        ┌─────────────────────────────────────────────┐
                        │  一个 DSH 运行时（headless 后端）            │
  VS Code 扩展 ─────────┤  编辑器 action 协议（本插件）               │
  （纯 UI）             │  dsh-lsp-actions, editor.enabled: true       │
                        ├─────────────────────────────────────────────┤
  官方 ACP 客户端 ──────┤  @deepseek-ai/dsh-acp（agent 对话会话）      │
  （独立进程）          │  session/new · session/prompt · permissions  │
                        ├─────────────────────────────────────────────┤
  Python SDK ───────────┤  @deepseek-ai/dsh-sdk-jsonrpc-server         │
  （独立进程）          │  session/prompt · session.event 通知         │
                        └─────────────────────────────────────────────┘
```

- **官方 ACP server**（harness 仓库中的 [`@deepseek-ai/dsh-acp`](../../../packages/acp/acp/README.md)）是 *agent 对话*传输：`session/new`、`session/prompt`、`session/cancel`、`session/request_permission`。想与 DSH agent 聊天的编辑器使用它——这些 ACP 会话中的 agent 可以调用本插件的 `lsp_*` 模型工具。编辑器 action 协议是*直接能力*传输：无模型往返、结构化结果。每个传输独占一条 stdio 连接，因此每个进程只服务一个归属方；同一 profile/持久化根可支撑多个进程。
- **审批互操作。** 当编辑器写动作在 ACP 拥有的会话的开放 turn 内升级时，官方审批请求以 `session/request_permission` 流向 ACP 客户端——由 ACP 客户端（或策略）作答，编辑器通过 `action.status` 观察结果。
- **Python SDK**（`pip install deepseek-harness-sdk`）经官方 SDK 线（`session/prompt` + 通知）驱动同一运行时。SDK 用户无需编辑器协议：其会话 agent 直接调用 `lsp_*` 工具。由于本协议使用相同的换行分帧 JSON-RPC，SDK 级客户端可用同一套传输代码直接调用 `lsp.actions.list`、`lsp.actions.run` 并读取 `lsp.event` 通知。

## 工程保证

- **可逆注册。** 传输、事件监听与缓存全部处于插件 effect 作用域内；停止或更新插件即全部拆除。
- **有界诊断缓存。** Map 实现 LRU，上限 `editor.diagnosticsCacheMaxFiles`（默认 64），带新鲜度戳，并随文件系统观察与本插件自身写入而失效。
- **Schema 配置。** `editor.enabled`（默认 `false`——只有 headless 后端才可占用 stdio）、`editor.requestTimeoutMs`（默认 60000，逐次运行强制）、`editor.diagnosticsCacheMaxFiles`（默认 64）。配置错误在加载时即失败。
