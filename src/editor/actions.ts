/**
 * The four editor-protocol actions (`diagnostics.get`, `completion.get`, `quickfix.apply`,
 * `format`) over the same seam-first action runner the model tools use. Read-only actions are
 * reference-only; the two write actions apply server-verified edits through the official
 * `fs/write-intent` waterfall and the per-session sandbox policy — the same official permission
 * presets and approval choreography as `lsp_format`/`lsp_rename`, with the editor's escalation
 * pair (`sandbox_permissions` + `justification`) resolved through `approveEscalation`.
 *
 * Positions and ranges here are zero-based (LSP convention); the model tools keep one-based.
 * @module dsh-lsp-actions/editor/actions
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { approveEscalation, sandboxDenialMarker, escalationHintMarker, validateEscalationArgs } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { CallId } from '../call-id.ts'
import { applyEdits } from '../edits.ts'
import { readHostSource, canonicalizeWorkspace, workspaceRelativePath } from '../host.ts'
import type { HostSource, HostWorkspace } from '../host.ts'
import type { ActionRunner, RunnerRequest } from '../runner.ts'
import type { FormatSandboxController } from '../sandbox.ts'
import type { ResolvedConfig } from '../servers.ts'
import { linesChangedByEdits, mapWriteFailure } from '../tools.ts'
import type { LspTextEdit, LspPosition, LspRange } from '../vocabulary.ts'
import { LspActionError } from '../vocabulary.ts'
import type { LruDiagnosticsCache } from './cache.ts'
import type {
  EditorActionDescriptor,
  EditorActionResult,
  EditorCompletionParams,
  EditorDiagnosticsParams,
  EditorEvent,
  EditorFormatParams,
  EditorQuickfixParams,
} from './types.ts'

/** The editor-facing agent shape (structurally, so no agent-package dependency). */
export interface EditorAgent {
  readonly session: { readonly id: unknown }
}

/** The per-run context the service assembles: identity, cancellation, and the approval actor. */
export interface EditorRunContext {
  readonly requestId: string
  readonly signal: AbortSignal
  /** The live agent of the addressed session, when the session exists and has one. */
  readonly agent: EditorAgent | undefined
}

/** The dependencies one action call needs. */
export interface EditorActionDeps {
  readonly ctx: Context
  readonly runner: ActionRunner
  readonly sandbox: FormatSandboxController
  readonly config: ResolvedConfig
  readonly cache: LruDiagnosticsCache
  readonly onEvent: (event: EditorEvent) => void
}

/** The static v1 action catalog, in the order `lsp.actions.list` advertises it. */
export const EDITOR_ACTIONS: readonly EditorActionDescriptor[] = [
  {
    action: 'diagnostics.get',
    writes: false,
    description: 'Fetch compiler/analyzer diagnostics for one file from its language server (read-only).',
  },
  {
    action: 'completion.get',
    writes: false,
    description: 'Request completion suggestions at a zero-based cursor position (read-only).',
  },
  {
    action: 'quickfix.apply',
    writes: true,
    description: 'Select one server-verified code action (quickfix) and apply its edits through the official write policy.',
  },
  {
    action: 'format',
    writes: true,
    description: 'Format a file (or a zero-based selection) through its language server and apply the result.',
  },
]

/** Dispatch one action id to its handler. */
export function runEditorAction(
  deps: EditorActionDeps,
  action: string,
  params: Record<string, unknown> | undefined,
  run: EditorRunContext,
): Promise<EditorActionResult> {
  switch (action) {
    case 'diagnostics.get':
      return runDiagnosticsGet(deps, params as unknown as EditorDiagnosticsParams, run)
    case 'completion.get':
      return runCompletionGet(deps, params as unknown as EditorCompletionParams, run)
    case 'quickfix.apply':
      return runQuickfixApply(deps, params as unknown as EditorQuickfixParams, run)
    case 'format':
      return runFormat(deps, params as unknown as EditorFormatParams, run)
    default:
      throw new LspActionError(`unknown editor action "${action}" — call lsp.actions.list for the v1 catalog`, 'LSP_ACTION_UNKNOWN')
  }
}

/**
 * `diagnostics.get`: read-only diagnostics for one file, count-capped, cached (LRU, freshness-
 * stamped), and announced to every connected editor as a `diagnostics.updated` event.
 */
async function runDiagnosticsGet(deps: EditorActionDeps, params: EditorDiagnosticsParams, run: EditorRunContext): Promise<EditorActionResult> {
  const { filePath, workspaceRoot } = requireWorkspaceParams(params, 'diagnostics.get')
  const request = await prepareEditorRequest(deps, filePath, workspaceRoot, run.signal)
  const result = await deps.runner.diagnostics(request, run.signal)
  const capped = result.diagnostics.slice(0, deps.config.maxDiagnostics)
  const diagnostics = capped.map(projectDiagnostic)
  const source = request.source
  const snapshot = {
    filePath: source.target.displayPath,
    ...source.version === undefined ? {} : { version: String(source.version) },
    diagnostics,
    truncated: result.diagnostics.length > capped.length,
    total: result.diagnostics.length,
    updatedAt: Date.now(),
  }
  deps.cache.set(snapshot)
  const payload: EditorActionResult & { kind: 'diagnostics' } = {
    kind: 'diagnostics',
    filePath,
    diagnostics,
    truncated: snapshot.truncated,
    total: snapshot.total,
    ...params.includeSource === true ? { source: source.text } : {},
  }
  deps.onEvent({
    kind: 'diagnostics.updated',
    filePath,
    diagnostics,
    truncated: snapshot.truncated,
    total: snapshot.total,
    ...firstSource(diagnostics) === undefined ? {} : { source: firstSource(diagnostics) },
  })
  return payload
}

/**
 * `completion.get`: reference-only completion items at a zero-based cursor position. Nothing is
 * applied — the editor owns insertion.
 */
async function runCompletionGet(deps: EditorActionDeps, params: EditorCompletionParams, run: EditorRunContext): Promise<EditorActionResult> {
  const { filePath, workspaceRoot } = requireWorkspaceParams(params, 'completion.get')
  const position = parseEditorPosition(params.position, 'completion.get')
  const request = await prepareEditorRequest(deps, filePath, workspaceRoot, run.signal)
  const result = await deps.runner.completion({ ...request, position }, run.signal)
  const capped = result.items.slice(0, deps.config.maxCompletionItems)
  return {
    kind: 'completion',
    filePath,
    position,
    items: capped.map(projectCompletionItem),
    truncated: result.items.length > capped.length,
    total: result.items.length,
  }
}

/**
 * `quickfix.apply`: select one server-verified code action by exact `title` or zero-based `index`
 * (defaulting to the range of the first cached error diagnostic for the file) and apply its
 * grouped edits through the official write path. Command-only actions are never executed.
 */
async function runQuickfixApply(deps: EditorActionDeps, params: EditorQuickfixParams, run: EditorRunContext): Promise<EditorActionResult> {
  const { filePath, workspaceRoot } = requireWorkspaceParams(params, 'quickfix.apply')
  const policy = await resolveEditorPolicy(deps, 'lsp.actions quickfix.apply', params, run)
  const request = await prepareEditorRequest(deps, filePath, workspaceRoot, run.signal)
  const wireRange = params.range === undefined
    ? firstCachedErrorRange(deps.cache, request.source)
    : parseEditorRange(params.range, 'quickfix.apply')
  const result = await deps.runner.codeActions({
    ...request,
    ...wireRange === undefined ? {} : { range: wireRange },
    ...params.only === undefined || params.only.length === 0 ? {} : { onlyKinds: params.only },
  }, run.signal)
  const selected = selectCodeAction(result.items, params.title, params.index)
  if (selected === undefined) {
    const titles = result.items.map(item => `"${item.title}"`).join(', ')
    throw new LspActionError(
      `no code action matched (titles: ${titles === '' ? 'none' : titles}) — pass an exact title or a zero-based index`,
      'LSP_ACTION_UNKNOWN',
    )
  }
  if (Object.keys(selected.edits).length === 0) {
    throw new LspActionError(
      `the code action "${selected.title}" carries no edits (command-only actions are never executed)`,
      'LSP_ACTION_UNKNOWN',
    )
  }
  const applied = await applyEditorEdits(deps, request.workspace, selected.edits, policy, run.signal)
  if (applied.filesChanged === 0) {
    return { kind: 'unchanged', filePath }
  }
  return {
    kind: 'quickfixApplied',
    filePath,
    title: selected.title,
    filesChanged: applied.filesChanged,
    appliedEdits: applied.appliedEdits,
    diffs: applied.diffs,
  }
}

/**
 * `format`: whole-file or range formatting through the language server, applied through the
 * official write path exactly like the `lsp_format` tool. A read-only session fails loud before
 * any server round-trip; a stale file fails as a structured conflict.
 */
async function runFormat(deps: EditorActionDeps, params: EditorFormatParams, run: EditorRunContext): Promise<EditorActionResult> {
  const { filePath, workspaceRoot } = requireWorkspaceParams(params, 'format')
  const policy = await resolveEditorPolicy(deps, 'lsp.actions format', params, run)
  const request = await prepareEditorRequest(deps, filePath, workspaceRoot, run.signal)
  if (request.source.version !== undefined) {
    deps.ctx.emit('fs/observed', request.source.target, { kind: 'present', version: request.source.version }, undefined)
  }
  const range = params.range === undefined ? undefined : parseEditorRange(params.range, 'format')
  const result = await deps.runner.formatDocument({ ...request, range }, run.signal)
  if (result.edits.length === 0) {
    return { kind: 'unchanged', filePath }
  }
  const newText = applyEdits(request.source.text, result.edits)
  const intent = await deps.ctx.waterfall('fs/write-intent', request.source.target, undefined, () => undefined)
  let outcome
  try {
    outcome = await deps.ctx.fs.writeText(request.source.target, newText, intent, run.signal, policy)
  } catch (error) {
    throw mapWriteFailure(deps.sandbox.mapError(error, policy), 'lsp.actions format')
  }
  deps.ctx.emit('fs/observed', request.source.target, { kind: 'present', version: outcome.version }, undefined)
  deps.cache.delete(request.source.target.displayPath)
  deps.onEvent({ kind: 'file.changed', filePath })
  return {
    kind: 'formatted',
    filePath,
    appliedEdits: result.edits.length,
    linesChanged: linesChangedByEdits(result.edits),
    before: outcome.before ?? request.source.text,
    after: outcome.after,
  }
}

/** The validated workspace pair every action needs: the editor always names the workspace root. */
function requireWorkspaceParams(params: { filePath?: unknown; workspaceRoot?: unknown } | undefined, action: string): { filePath: string; workspaceRoot: string } {
  if (typeof params?.filePath !== 'string' || params.filePath.trim() === '') {
    throw new LspActionError(`${action} requires a non-empty string filePath`, 'LSP_ACTION_INVALID_ARGS')
  }
  if (typeof params.workspaceRoot !== 'string' || params.workspaceRoot.trim() === '') {
    throw new LspActionError(`${action} requires a non-empty string workspaceRoot`, 'LSP_ACTION_INVALID_ARGS')
  }
  return { filePath: params.filePath, workspaceRoot: params.workspaceRoot }
}

/** Canonicalize the workspace and read the byte-bounded source, like the model tools prepare. */
async function prepareEditorRequest(
  deps: EditorActionDeps,
  filePath: string,
  workspaceRoot: string,
  signal: AbortSignal,
): Promise<RunnerRequest & { source: NonNullable<RunnerRequest['source']>; workspace: HostWorkspace }> {
  const workspace = await canonicalizeWorkspace(deps.ctx.fs, workspaceRoot, signal)
  const source = await readHostSource(deps.ctx.fs, filePath, workspace, deps.config.maxDocumentBytes, signal)
  return { filePath, workspaceRoot, source, workspace }
}

/** Validate one zero-based cursor position (LSP convention). */
function parseEditorPosition(position: unknown, action: string): LspPosition {
  if (position === null || typeof position !== 'object') {
    throw new LspActionError(`${action} requires a position { line, character } (zero-based)`, 'LSP_ACTION_INVALID_ARGS')
  }
  const { line, character } = position as { line?: unknown; character?: unknown }
  if (!Number.isInteger(line) || (line as number) < 0 || !Number.isInteger(character) || (character as number) < 0) {
    throw new LspActionError(`${action} position must be zero-based non-negative integers`, 'LSP_ACTION_INVALID_ARGS')
  }
  return { line: line as number, character: character as number }
}

/** Validate one zero-based half-open range (LSP convention). */
function parseEditorRange(range: unknown, action: string): LspRange {
  if (range === null || typeof range !== 'object') {
    throw new LspActionError(`${action} requires a range { start, end } (zero-based)`, 'LSP_ACTION_INVALID_ARGS')
  }
  const { start, end } = range as { start?: unknown; end?: unknown }
  const parsedStart = parseEditorPosition(start, action)
  const parsedEnd = parseEditorPosition(end, action)
  if (parsedEnd.line < parsedStart.line || (parsedEnd.line === parsedStart.line && parsedEnd.character < parsedStart.character)) {
    throw new LspActionError(`${action} range end must not precede range start`, 'LSP_ACTION_INVALID_ARGS')
  }
  return { start: parsedStart, end: parsedEnd }
}

/**
 * Resolve the per-run sandbox policy through the official per-session resolver, mirroring
 * `FormatSandboxController.resolvePolicy` for the editor execution shape: the standing preset
 * (permission preset gate — a read-only session refuses writes before any server round-trip), and
 * the official one-shot escalation ask through `approveEscalation` when the editor carries the
 * `sandbox_permissions` + `justification` pair. Every escalation-approval failure (no approval
 * service, no live agent, no open turn, rejection, cancellation) surfaces as the stable
 * `LSP_ACTION_APPROVAL_UNAVAILABLE` code with the official text — fail closed, never widened.
 */
async function resolveEditorPolicy(
  deps: EditorActionDeps,
  toolName: string,
  args: { sandbox_permissions?: string; justification?: string },
  run: EditorRunContext,
): Promise<SandboxExecutionPolicy | undefined> {
  validateEscalationArgs(args.sandbox_permissions, args.justification)
  const policyService = deps.ctx.get('sandboxPolicy') as SandboxPolicyService | undefined
  // The runtime object is the addressed session's real session; the structural editor agent type
  // just avoids an agent-package dependency here.
  const request = (run.agent === undefined ? {} : { session: run.agent.session }) as Parameters<SandboxPolicyService['resolve']>[0]
  const standingPolicy = policyService?.resolve(request)
  if (standingPolicy !== undefined && standingPolicy.mode === 'read-only') {
    throw new LspActionError(
      `${sandboxDenialMarker(standingPolicy.mode)}\n${escalationHintMarker('operation')}`,
      'LSP_ACTION_READ_ONLY',
    )
  }
  if (args.sandbox_permissions === undefined || args.justification === undefined) {
    return standingPolicy
  }
  if (deps.sandbox.escalationModes.length === 0) {
    throw new LspActionError('sandbox_permissions is not available in this composition (no sandboxing filesystem to escalate)', 'LSP_ACTION_APPROVAL_UNAVAILABLE')
  }
  const policy = standingPolicy as SandboxExecutionPolicy
  try {
    const approvedMode = await approveEscalation(
      { requestedMode: args.sandbox_permissions, justification: args.justification, effectiveMode: policy.mode, subject: 'operation' },
      {
        approver: deps.ctx.get('approval') as Parameters<typeof approveEscalation>[1]['approver'],
        agent: run.agent,
        callId: CallId(`lsp-editor:${run.requestId}`),
        toolName,
        signal: run.signal,
      },
    )
    return { ...policy, mode: approvedMode }
  } catch (error) {
    throw new LspActionError(
      `the official approval path did not grant the wider sandbox mode: ${messageOf(error)}`,
      'LSP_ACTION_APPROVAL_UNAVAILABLE',
      { cause: error },
    )
  }
}

/**
 * Apply one grouped edit record (document URI → text edits) through the official write path,
 * pre-flighting every target before the first write — the same fail-before-any-byte contract as
 * `lsp_rename`. No-op files are dropped; out-of-workspace targets fail as conflicts.
 */
async function applyEditorEdits(
  deps: EditorActionDeps,
  workspace: HostWorkspace,
  edits: Readonly<Record<string, readonly LspTextEdit[]>>,
  policy: SandboxExecutionPolicy | undefined,
  signal: AbortSignal,
): Promise<{ filesChanged: number; appliedEdits: number; diffs: Array<{ filePath: string; before: string; after: string }> }> {
  const planned: Array<{ filePath: string; target: HostSource['target']; before: string; after: string; edits: number }> = []
  for (const [uri, fileEdits] of Object.entries(edits)) {
    const relative = workspaceRelativePath(workspace, uri)
    if (relative === undefined) {
      throw new LspActionError(
        `the language server's edits touch a file outside the workspace (${uri}); refusing to apply them`,
        'LSP_ACTION_CONFLICT',
      )
    }
    const source = await readHostSource(deps.ctx.fs, relative, workspace, deps.config.maxDocumentBytes, signal)
    if (source.version !== undefined) {
      deps.ctx.emit('fs/observed', source.target, { kind: 'present', version: source.version }, undefined)
    }
    const after = applyEdits(source.text, fileEdits)
    if (after !== source.text) {
      planned.push({ filePath: relative, target: source.target, before: source.text, after, edits: fileEdits.length })
    }
  }
  let appliedEdits = 0
  let written = 0
  const diffs: Array<{ filePath: string; before: string; after: string }> = []
  for (const file of planned) {
    const intent = await deps.ctx.waterfall('fs/write-intent', file.target, undefined, () => undefined)
    try {
      const outcome = await deps.ctx.fs.writeText(file.target, file.after, intent, signal, policy)
      deps.ctx.emit('fs/observed', file.target, { kind: 'present', version: outcome.version }, undefined)
      deps.cache.delete(file.target.displayPath)
      deps.onEvent({ kind: 'file.changed', filePath: file.filePath })
      appliedEdits += file.edits
      written += 1
      diffs.push({ filePath: file.filePath, before: outcome.before ?? file.before, after: outcome.after })
    } catch (error) {
      const mapped = mapWriteFailure(deps.sandbox.mapError(error, policy), 'lsp.actions quickfix.apply')
      if (mapped instanceof LspActionError && mapped.code === 'LSP_ACTION_CONFLICT' && written > 0) {
        throw new LspActionError(
          `${mapped.message} (${written} of ${planned.length} file${planned.length === 1 ? '' : 's'} were already updated)`,
          'LSP_ACTION_CONFLICT',
          { cause: error },
        )
      }
      throw mapped
    }
  }
  return { filesChanged: written, appliedEdits, diffs }
}

/** Select the code action the editor asked for: exact title wins, then zero-based index. */
function selectCodeAction(
  items: readonly { title: string; edits: Readonly<Record<string, readonly LspTextEdit[]>> }[],
  title: string | undefined,
  index: number | undefined,
): { title: string; edits: Readonly<Record<string, readonly LspTextEdit[]>> } | undefined {
  if (title !== undefined && title.trim() !== '') {
    return items.find(item => item.title === title)
  }
  const position = index === undefined ? 0 : index
  if (!Number.isInteger(position) || position < 0) return undefined
  return items[position]
}

/**
 * The range of the first error-severity cached diagnostic for the source, when the cache holds a
 * snapshot of the exact same source version — otherwise undefined (the server's own
 * first-diagnostic behavior applies). Prevents quickfixes from landing on a moved line.
 */
function firstCachedErrorRange(
  cache: LruDiagnosticsCache,
  source: HostSource,
): LspRange | undefined {
  const snapshot = cache.get(source.target.displayPath)
  if (snapshot === undefined) return undefined
  if (source.version !== undefined && snapshot.version !== undefined && snapshot.version !== String(source.version)) return undefined
  return snapshot.diagnostics.find(diagnostic => diagnostic.severity === 1)?.range
}

/** Project one normalized diagnostic into the editor wire shape (plain JSON values only). */
function projectDiagnostic(diagnostic: {
  severity: number
  range: LspRange
  message: string
  source?: string
  code?: string | number
}): { severity: number; range: LspRange; message: string; source?: string; code?: string | number } {
  return {
    severity: diagnostic.severity,
    range: diagnostic.range,
    message: diagnostic.message,
    ...diagnostic.source === undefined ? {} : { source: diagnostic.source },
    ...diagnostic.code === undefined ? {} : { code: diagnostic.code },
  }
}

/** Project one normalized completion item into the editor wire shape. */
function projectCompletionItem(item: {
  label: string
  kind?: number
  detail?: string
  insertText?: string
  sortText?: string
  textEdit?: { range: LspRange; newText: string }
}): {
  label: string
  kind?: number
  detail?: string
  insertText?: string
  sortText?: string
  textEdit?: { range: LspRange; newText: string }
} {
  return {
    label: item.label,
    ...item.kind === undefined ? {} : { kind: item.kind },
    ...item.detail === undefined ? {} : { detail: item.detail },
    ...item.insertText === undefined ? {} : { insertText: item.insertText },
    ...item.sortText === undefined ? {} : { sortText: item.sortText },
    ...item.textEdit === undefined ? {} : {
      textEdit: {
        range: { start: item.textEdit.range.start, end: item.textEdit.range.end },
        newText: item.textEdit.newText,
      },
    },
  }
}

/** The first named diagnostic source, for the `diagnostics.updated` event's source field. */
function firstSource(diagnostics: readonly { source?: string }[]): string | undefined {
  return diagnostics.find(diagnostic => diagnostic.source !== undefined)?.source
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
