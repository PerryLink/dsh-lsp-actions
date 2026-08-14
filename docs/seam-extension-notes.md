# LSP 动作面 seam 扩展调研笔记

状态：2026-08-14。本文档是交付物第 1 条：结论分叉的调研记录与决策依据。

## 1. 现状盘点（调研结论）

### 官方 seam 词汇（`packages/lsp/`）

- `@deepseek-ai/dsh-lsp`（Service Definition）在单一 `ctx.lsp` 服务上只暴露 **4 个导航操作**：`goToDefinition` / `findReferences` / `goToImplementation` / `hover`。`LspOperation` 是**闭合联合**，文档明言"新增一项查询会通过编译强制要求同步修改 seam、提供方和工具"；`LspQueryResult` 是闭合可辨识联合（`locations` / `hover`），消费方 `switch` 穷尽。
- 请求 `LspQueryRequest` 的四个字段全部必填：`operation` / `filePath` / `position` / `workspaceRoot`；位置与范围是**从零开始的 UTF-16** 坐标，模型面向的工具做从 1 开始的光标换算。
- `@deepseek-ai/dsh-lsp-stdio`（Provider）是通用 stdio 语言服务器宿主：每服务器一个隔离 provider、按工作区惰性单飞、瞬态 `didOpen`→请求→`didClose` 生命周期、坏 transport 换进程重试一次、进程树级 teardown。它是本插件自带 client 的直接范本。
- `@deepseek-ai/dsh-tool-lsp`（Consumer）是 `lsp` 工具：schema、位置归一化、结果上限（`maxLocations`/`maxResultChars`）、`timeoutMs` 交给官方 `dsh-tool-call-timeout-policy` 执行。
- seam 无协议类型、进程或文档控制、无 JSON-RPC 逃生口；错误按稳定码（`LSP_*`）路由。

### 门禁理解（实现前已跑）

- `pnpm run verify-cordis-api`（= `scripts/gen-cordis-api.ts --check`）在干净树上通过（EXIT=0）。它校验的是生成式 Cordis 核心 API 文档；**seam 词汇改动真正牵动的门禁是 `gen-cordis-catalog`（docs/subsystems/lsp.* 的 cordis-surface 区）与 `verify-type-equiv`（文档 `type-equiv` 块必须与 `types.ts` 逐字节一致）**，还有 `verify-export-jsdoc`（新导出需 JSDoc）。上游补丁按此方向实现并逐项跑绿。
- 工具契约（`docs/cookbook/adding-a-tool.zh.md`）：`execute` 返回 `output.schema` 声明的规范 JSON；尊重 `exec.signal`；`timeoutMs` 由 `dsh-tool-call-timeout-policy` 通过替换 `exec.signal` 执行，插件不得自实现超时；UI 卡片 presenter 是 `args`（+ result）的纯函数；diff 卡片走 `presentationMeta` 持久化投影，保证回放可重现。

### 冲突排查（GitHub）

- GitHub topic `dsh-plugin`（约 550 仓）+ topic `lsp` 检索：**无任何 DSH 插件实现 LSP 动作面**；"diagnostics" 命中的全是健康检查类插件；OpenCode bridge 只桥接 skills/config，不包装 OpenCode 的 LSP。
- `deepseek-ai/deepseek-harness` 的 issue/PR 检索（lsp/diagnostics/formatting/completion/formatDocument/publishDiagnostics）：**0 条**，无人提过 seam 扩展提案。
- 结论：`lsp_diagnostics` / `lsp_format` / `lsp_completion` 三个工具名在 DSH 生态内无冲突，是生态首例。

## 2. 结论分叉

**路径一（推荐，已执行）**：向 `ctx.lsp` seam 词汇提上游 PR——新增 `diagnostics` / `formatDocument` / `completion` 操作、对应 provider 契约与位置归一化；本插件作为官方 seam 的消费方实现三个工具与结果卡片。补丁文件在本仓库 `upstream/lsp-action-seam.patch`（PR 描述见 `upstream/PR-description.md`）。

**路径二（兜底，已实现为插件的内置 client）**：PR 合入周期不可控，插件自带最小 LSP 客户端（`src/client.ts` 等：`ctx.subprocess.spawn` + stdio JSON-RPC，可执行路径走 Config `servers` 表，不硬编码），实现同样的三个工具。README 明确"待 seam 扩展 PR 合入后迁移到 ctx.lsp"。

**提案提交流程（2026-08-14 实测）**：上游仓库关闭了 issues（`has_issues=false`），GitHub 因此**禁用 PR 功能**（pulls 端点整体 404）。提案已改道提交到官方 **GitHub Discussions #781**（Ideas 分类）：https://github.com/deepseek-ai/deepseek-harness/discussions/781 —— 文中附了 fork 分支（`PerryLink/deepseek-harness:agent/lsp-action-seam`，提交 7f10651，门禁全绿）、补丁文件与本插件的链接；上游开启 PR 后可直接把该分支开成 PR。

**混合架构（本插件实际形态）**：每次动作调用 **seam 优先、自带 client 兜底**（`src/runner.ts`）：

1. `ctx.lsp` 已挂载 → 尝试 seam.query；成功即返回。
2. 失败分类（按错误 `code`，不用 instanceof 跨副本判断）：
   - `LSP_UNAVAILABLE`（该扩展名无 provider 路由）/ **无 code 的普通错误**（旧 seam 的 provider 对未知操作 assertNever）→ 旧 seam 或无路由 → 落到自带 client。
   - `LSP_UNSUPPORTED_OPERATION`（新 seam、provider 存在但服务器无该能力）→ **响亮失败**，不悄悄起第二台服务器（两处都配了服务器是配置错误）。
   - 其他带 code 的 LSP 错误 → 原样上抛。
3. seam 未挂载 → 直接自带 client；`servers` 表按 fileGlob → 扩展名映射路由。

## 3. 上游 PR 提案要点（`upstream/lsp-action-seam.patch`）

- `LspOperation` 闭合联合 + 3：`diagnostics` / `formatDocument` / `completion`。
- 请求改为闭合联合（不同操作 arity 不同，无法再"全字段必填"）：位置型（导航+completion 带 `position`）、`diagnostics`（无位置）、`formatDocument`（可选 `range`）。
- 结果联合 + 3 分支：`diagnostics`（带 `resolvedWorkspaceUri`）、`edits`（格式化返回 TextEdit[]，**seam/provider 永不落盘**——应用由消费方走 fs write-intent）、`completion`。
- provider 侧：`requestMethod`/`supportsOperation` 请求感知（range → `textDocument/rangeFormatting`）；诊断双路径——服务器有 `diagnosticProvider` 走 pull `textDocument/diagnostic`，否则 didOpen 后收 `publishDiagnostics` 推送并受 `diagnosticsSettleMs` 限时；`LspConnection` 增加通知观察钩子。
- 范围：不动 `tool-lsp` 的 4 操作与输出 schema（动作工具在插件里），只补 `assertNever` 不可达分支；双语文档（lsp.zh.md/lsp.md + type-equiv 逐字节同步 + gen-cordis-catalog 重生成）；Agent Note + 测试 + keyless snapshot 判定（无仓库内模型可见行为变化，故不新增 snapshot，判定写进 Agent Note）。

## 4. 本插件的硬性契约落实情况

| 契约 | 落实位置 |
| --- | --- |
| 三工具尊重 `exec.signal` 与工具超时 | 每个 `defineTool` 声明 `timeoutMs`（Config 默认 60000），官方 timeout-policy 替换信号；全链路（读文件、握手、请求、取消竞速）走 `abortable` + `$/cancelRequest` + `killGraceMs` 终止实例 |
| `lsp_format` 写入过 fs 意图事件与权限检查 | 读后 `fs/observed`（present+version）→ `fs/write-intent` waterfall 取意图 → `ctx.fs.writeText(..., intent, signal, sandboxPolicy)` → 写后 `fs/observed` |
| read-only sandbox 拒绝写入（fail loud 结构化） | 见下 §4.1 |
| 诊断/补全不落持久层、不跨会话缓存 | 工具结果只进会话日志（模型历史本身）；无任何磁盘/内存缓存；不提供 cache 开关（更严格地满足"除非 Config 显式开启"） |
| `servers` 配置形态与官方对齐 | `command`/`args`/`env`/`extensionToLanguage`/`initializationOptions`/`configuration`/字节上限/计时器字段与 `lsp-stdio` 同名同默认；另加 `fileGlobs`（glob 优先于扩展名）与 `formattingOptions`/`diagnosticsSettleMs`；`maxDocumentBytes` 因读取发生在上具层而提升为插件级 Config（文档已注明偏差） |

### 4.1 权限矩阵（`lsp_format`）

- 裸 fs（无 sandboxMode）→ 无 policy，走无条件写（与官方 `write` 工具语义一致）。
- 约束型 fs 后端 + 会话 `read-only` → **在任何服务器往返之前**抛 `LspActionError('LSP_ACTION_READ_ONLY')`，文本为共享的 `[sandbox: file access denied under read-only mode]` + 同轮升级提示。
- 升级：`sandbox_permissions`/`justification` 参数对（仅约束后端下广告），经 `@deepseek-ai/dsh-sandbox` 的 `approveEscalation` 严格放宽（read-only → workspace-write → danger-full-access），与 `dsh-tool-fs` 的 write/edit 完全同源。
- 写时拒绝（FS_SANDBOX_DENIED）→ 映射为共享 `[sandbox: …]` 标记（保留结构化 code）。
- 格式冲突：重叠 edits 或越界 edits → `LSP_ACTION_CONFLICT`；磁盘内容在读后被改（`replaceIfVersion` → `FS_STALE_VERSION` / `FS_NOT_OBSERVED`）→ `LSP_ACTION_CONFLICT`，错误文本提示模型**选择**：重读后重跑，或用 edit/write 手工应用 diff。

## 5. 已知取舍

- seam 路径下工具也先读一遍源文件（为了 format 的 diff 基线与观测），seam provider 内部会再读一份；代价是双读，换来单一基线与统一 prepare 路径，PR 合入后可优化。
- 坏 server 启动：命令在 **load 期**经 `subprocess.resolveExecutable` 解析（与 lsp-stdio 对齐，坏命令 fail loud at load）；运行期握手/进程失败 → `LSP_ACTION_SERVER_FAILED` + stderr tail，且不重试（调用失败即 isError，模型重跑会因死实例被逐出而重新拉起）。
- 诊断卡片的"严重级颜色"是中性的卡片词汇没有的字段；卡片只带 `[Error]` 等标签文本与行号，颜色映射是 UI 桥接层的能力（README 已注明）。
