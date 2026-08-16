# dsh-lsp-actions VS Code 示例

一个最小 VS Code 扩展，通过 ACP 风格的 JSON-RPC 消费 [`dsh-lsp-actions`](../../) 的**编辑器 action 协议**（`lsp.actions.list` / `lsp.actions.run` / `lsp.events`）。扩展**只做 UI**：不实现任何 LSP 逻辑、不计算诊断、不编辑缓冲区——所有能力与每一次写入都由插件后端完成。

```
┌──────────────────┐  stdio JSON-RPC（换行分帧）          ┌───────────────────────────────┐
│  VS Code         │  lsp.actions.list / lsp.actions.run  │  编辑器后端（headless DSH）    │
│  扩展（纯 UI）   │ ────────────────────────────────────► │  dsh-lsp-actions              │
│  侧栏 + 命令     │  ◄──────────────────────────────────── │  (editor.enabled: true)       │
│                  │  lsp.event（诊断、动作状态…）         │  fs-local · subprocess-local   │
└──────────────────┘                                       │  LSP 服务器（tsls 等）         │
                                                           └───────────────────────────────┘
```

## 侧栏提供什么

- **DSH Sessions** —— 后端运行时内的会话（`run` 可绑定权限预设的 `sessionId`）。
- **LSP Diagnostics** —— 后端推送的逐文件诊断（`diagnostics.updated` 事件），可按需刷新。每条诊断：
  - 点击 → 在范围内打开文件（`openDiagnostic`，纯 VS Code UI）；
  - **Apply quickfix** 按钮 → 后端为该范围选择服务器首选 code action，并走官方写入策略应用（`quickfix.apply`）。扩展不碰缓冲区。
- **DSH: Format the active document** → 经后端执行 `format`（全文件、服务器验证过的编辑）。

## 安装与运行

### 1. 安装后端

```sh
cd examples/vscode/backend
npm install
# 确保 PATH 上有语言服务器，例如：
npm install -g typescript-language-server typescript
```

### 2. 启动扩展

```sh
cd examples/vscode/extension
code --new-window 你的/TypeScript/项目路径 .
```

- 在 VS Code 中：**Run and Debug → Run Extension**（`F5`），或先 `npx @vscode/vsce package` 再 **Extensions: Install from VSIX…**。
- 打开 **DSH LSP Actions** 活动栏容器（server-process 图标）。

### 3. 使用

1. 命令面板执行 **DSH: Connect to the editor backend** —— 启动 `node backend/bin.mjs backend/cordis.yml` 并读取 `lsp.actions.list`。
2. 打开一个带错误的 `.ts` 文件，点击 LSP Diagnostics 视图的 **↻ 刷新**按钮。
3. 展开诊断，点击 **Apply quickfix** —— 后端应用服务器修复并推送 `file.changed`；刷新后错误消失。
4. 执行 **DSH: Format the active document** —— 缩进由 `typescript-language-server` 经后端重写。

## 设置项

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| `dshLspActions.backend.node` | `node` | 启动后端的 Node 可执行文件。 |
| `dshLspActions.backend.bin` | （内置路径） | `backend/bin.mjs` 的绝对路径。 |
| `dshLspActions.backend.config` | （内置路径） | `backend/cordis.yml` 的绝对路径。 |

## 录制动图

主 README 中的演示动图按以下流程在干净 profile 上录制：

1. `examples/vscode/backend` 全新 `npm install`；新建一个 TypeScript 项目，放入一个坏文件（如未声明变量 + 四空格缩进）。
2. 连接 → 刷新诊断（错误出现）→ 应用 quickfix（修复生效）→ 格式化文档（缩进被重写）。
3. 用你顺手的动图工具（Linux `peek`、Windows ScreenToGif、macOS Kap）录制，命名为 `docs/editor-demo.gif`，主 README 引用它。

## 边界（请先阅读）

- **只做 UI。** 所有 LSP 请求、quickfix 选择、编辑计算与文件写入都发生在后端。扩展只发送 `lsp.actions.run` 并渲染结构化结果/事件。
- **官方写入策略。** `quickfix.apply` 与 `format` 走后端插件的 `fs/write-intent` 瀑布与会话的官方权限预设。本示例（未沙箱）组合中为直接写入；如需预设管控，组合 `@deepseek-ai/dsh-fs-sandbox` + `@deepseek-ai/dsh-sandbox-policy` + `@deepseek-ai/dsh-user-approval`（read-only 会话将以 `LSP_ACTION_READ_ONLY` 拒绝写操作，越级升级走官方审批）。
- **stdio 单一归属。** 后端 stdout 只承载协议帧——切勿给 `backend/cordis.yml` 添加 stdout 日志器。
- **协议稳定性。** 线上协议为 `lsp-actions/v1`（见 [`docs/editor-protocol.md`](../../docs/editor-protocol.md)）；客户端必须忽略未知字段与未知事件类型。
