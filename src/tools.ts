/**
 * The three model-facing LSP action tools: `lsp_diagnostics` (read-only), `lsp_format` (writes
 * through fs write-intent and sandbox policy), and `lsp_completion` (reference-only hints). All
 * three declare `timeoutMs` for the official timeout policy to enforce and observe `exec.signal`
 * throughout; results are capped and never cached.
 * @module dsh-lsp-actions/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { escalationHintMarker, sandboxDenialMarker } from '@deepseek-ai/dsh-sandbox'
import { applyEdits } from './edits.ts'
import { canonicalizeWorkspace, readHostSource } from './host.ts'
import type { ActionRunner, RunnerRequest } from './runner.ts'
import { FormatSandboxController } from './sandbox.ts'
import type { ResolvedConfig } from './servers.ts'
import { sessionCwd } from './session-cwd.ts'
import {
  formatAppliedEdits,
  formatCompletionList,
  formatDiagnostics,
  presentLspCompletionCall,
  presentLspCompletionResult,
  presentLspDiagnosticsCall,
  presentLspDiagnosticsResult,
  presentLspFormatCall,
  presentLspFormatResult,
} from './render.ts'
import type { LspPosition, LspRange } from './vocabulary.ts'
import { LspActionError } from './vocabulary.ts'

/** The shared position schema, reused inside ranges and output projections. */
const POSITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    line: { type: 'integer', required: true },
    character: { type: 'integer', required: true },
  },
} as const

/** The shared output-side range schema. */
const OUTPUT_RANGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    start: { ...POSITION_SCHEMA, required: true },
    end: { ...POSITION_SCHEMA, required: true },
  },
} as const

/** The schema-typed raw argument shape of `lsp_format` (escalation fields included under a confining fs). */
export interface FormatToolArgs {
  file_path: string
  range?: { start: { line: number; character: number }; end: { line: number; character: number } }
  sandbox_permissions?: string
  justification?: string
}

/**
 * Register the `lsp_diagnostics` tool: read-only diagnostics for one file, count-capped in the
 * canonical value and character-capped in the rendered text.
 * @param ctx - the plugin context.
 * @param runner - the seam-first action runner.
 * @param config - the resolved plugin configuration.
 */
export function registerDiagnosticsTool(ctx: Context, runner: ActionRunner, config: ResolvedConfig): void {
  ctx.tools.register(defineTool({
    name: 'lsp_diagnostics',
    description:
      'Request compiler/analyzer diagnostics (errors, warnings, hints) for a file from its language server. Returns severity, zero-based range, message, and source per diagnostic, capped at maxDiagnostics. Read-only.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'The source file to diagnose, relative to the workspace or absolute.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'diagnostics' },
          file_path: { type: 'string', required: true },
          diagnostics: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                severity: { type: 'integer', required: true },
                range: OUTPUT_RANGE_SCHEMA,
                message: { type: 'string', required: true },
                source: { type: 'string' },
                code: { oneOf: [{ type: 'string' }, { type: 'number' }] },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
          total: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatDiagnostics(value.file_path, value.diagnostics, config.maxResultChars) }],
      presentationMeta: (_args, value) => ({
        diagnostics: value.diagnostics.map((diagnostic: { severity: number; range: { start: LspPosition }; message: string; source?: string; code?: string | number }) => ({
          line: diagnostic.range.start.line + 1,
          severity: diagnostic.severity,
          message: diagnostic.message,
          ...diagnostic.source === undefined ? {} : { source: diagnostic.source },
          ...diagnostic.code === undefined ? {} : { code: diagnostic.code },
        })),
      }),
    },
    timeoutMs: config.timeoutMs,
    async execute(args, exec) {
      const filePath = parseFilePath(args.file_path)
      const workspaceRoot = requireWorkspace(exec)
      const request = await prepareRequest(ctx, config, filePath, workspaceRoot, exec)
      const result = await runner.diagnostics(request, exec.signal)
      const capped = result.diagnostics.slice(0, config.maxDiagnostics)
      return {
        kind: 'diagnostics' as const,
        file_path: filePath,
        diagnostics: capped.map(projectDiagnostic),
        truncated: result.diagnostics.length > capped.length,
        total: result.diagnostics.length,
      }
    },
    presentCall: presentLspDiagnosticsCall,
    presentResult: presentLspDiagnosticsResult,
  }))
}

/**
 * Register the `lsp_format` tool: formatting through a language server, applied through the
 * filesystem write-intent waterfall and the per-call sandbox policy. Read-only sandbox modes fail
 * loud before any server round-trip; a stale on-disk file fails as a structured conflict.
 * @param ctx - the plugin context.
 * @param runner - the seam-first action runner.
 * @param sandbox - the shared escalation controller.
 * @param config - the resolved plugin configuration.
 */
export function registerFormatTool(
  ctx: Context,
  runner: ActionRunner,
  sandbox: FormatSandboxController,
  config: ResolvedConfig,
): void {
  ctx.tools.register(defineTool({
    name: 'lsp_format',
    description:
      'Format a file (or a one-based UTF-16 selection within it) through its language server and write the result, returning the applied diff. Writes go through the filesystem write-intent policy; a file that changed on disk since it was read fails the call as a conflict.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'The source file to format, relative to the workspace or absolute.' },
      range: {
        type: 'object',
        additionalProperties: false,
        description: 'Optional selection to format as one-based UTF-16 line/character (cursor convention); omit for the whole file.',
        properties: {
          start: { type: 'object', additionalProperties: false, required: true, properties: { line: { type: 'integer', required: true }, character: { type: 'integer', required: true } } },
          end: { type: 'object', additionalProperties: false, required: true, properties: { line: { type: 'integer', required: true }, character: { type: 'integer', required: true } } },
        },
      },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'formatted' },
              file_path: { type: 'string', required: true },
              appliedEdits: { type: 'integer', required: true },
              before: { type: 'string', required: true },
              after: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'unchanged' },
              file_path: { type: 'string', required: true },
            },
          },
        ],
      },
      render: (_args, value) => {
        switch (value.kind) {
          case 'formatted':
            return [{ type: 'text', text: formatAppliedEdits(value.file_path, value.appliedEdits) }]
          case 'unchanged':
            return [{ type: 'text', text: `Formatted ${value.file_path}: the server returned no changes.` }]
        }
      },
      presentationMeta: (args, value) => value.kind === 'formatted'
        ? { diffs: [{ path: args.file_path, oldText: value.before, newText: value.after }] }
        : { diffs: [] },
    },
    timeoutMs: config.timeoutMs,
    async execute(args: FormatToolArgs, exec) {
      const filePath = parseFilePath(args.file_path)
      const workspaceRoot = requireWorkspace(exec)
      // Resolve the per-call sandbox policy (approved mode > session override > backend default)
      // BEFORE anything executes, so a read-only session never pays for a server round-trip.
      const sandboxPolicy = await sandbox.resolvePolicy('lsp_format', args, exec)
      if (sandboxPolicy !== undefined && sandboxPolicy.mode === 'read-only') {
        throw new LspActionError(
          `${sandboxDenialMarker(sandboxPolicy.mode)}\n${escalationHintMarker('operation')}`,
          'LSP_ACTION_READ_ONLY',
        )
      }
      const request = await prepareRequest(ctx, config, filePath, workspaceRoot, exec)
      // Record the present observation so the write-intent policy can guard against staleness.
      if (request.source.version !== undefined) {
        ctx.emit('fs/observed', request.source.target, { kind: 'present', version: request.source.version }, exec)
      }
      const range = parseOptionalRange(args.range)
      const result = await runner.formatDocument({ ...request, range }, exec.signal)
      if (result.edits.length === 0) {
        return { kind: 'unchanged' as const, file_path: filePath }
      }
      const newText = applyEdits(request.source.text, result.edits)
      const intent = await ctx.waterfall('fs/write-intent', request.source.target, exec, () => undefined)
      let outcome
      try {
        outcome = await ctx.fs.writeText(request.source.target, newText, intent, exec.signal, sandboxPolicy)
      } catch (error) {
        throw mapFormatWriteFailure(sandbox.mapError(error, sandboxPolicy))
      }
      ctx.emit('fs/observed', request.source.target, { kind: 'present', version: outcome.version }, exec)
      return {
        kind: 'formatted' as const,
        file_path: filePath,
        appliedEdits: result.edits.length,
        before: outcome.before ?? request.source.text,
        after: outcome.after,
      }
    },
    presentCall: presentLspFormatCall,
    presentResult: presentLspFormatResult,
  }))
}

/**
 * Register the `lsp_completion` tool: reference-only completion hints at a cursor position. The
 * description and the rendered header both state that nothing is executed — applying a suggestion
 * is the model's own write/edit decision.
 * @param ctx - the plugin context.
 * @param runner - the seam-first action runner.
 * @param config - the resolved plugin configuration.
 */
export function registerCompletionTool(ctx: Context, runner: ActionRunner, config: ResolvedConfig): void {
  ctx.tools.register(defineTool({
    name: 'lsp_completion',
    description:
      'Request code-completion suggestions at a one-based UTF-16 cursor position from the file\'s language server. Reference-only hints: nothing is executed or written — apply a suggestion yourself with write/edit.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'The source file to complete in, relative to the workspace or absolute.' },
      line: { type: 'integer', required: true, description: 'One-based line of the cursor.' },
      character: { type: 'integer', required: true, description: 'One-based UTF-16 column of the cursor.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'completion' },
          file_path: { type: 'string', required: true },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                label: { type: 'string', required: true },
                kind: { type: 'integer' },
                detail: { type: 'string' },
                insertText: { type: 'string' },
                sortText: { type: 'string' },
                textEdit: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    range: OUTPUT_RANGE_SCHEMA,
                    newText: { type: 'string', required: true },
                  },
                },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
          total: { type: 'integer', required: true },
        },
      },
      render: (args, value) => [{ type: 'text', text: formatCompletionList(value.file_path, args.line, args.character, value.items, config.maxResultChars) }],
      presentationMeta: (_args, value) => ({
        items: value.items.map((item: { label: string; detail?: string }) => ({
          label: item.label,
          ...item.detail === undefined ? {} : { detail: item.detail },
        })),
      }),
    },
    timeoutMs: config.timeoutMs,
    async execute(args, exec) {
      const filePath = parseFilePath(args.file_path)
      const position = parseCursor(args.line, args.character)
      const workspaceRoot = requireWorkspace(exec)
      const request = await prepareRequest(ctx, config, filePath, workspaceRoot, exec)
      const result = await runner.completion({ ...request, position }, exec.signal)
      const capped = result.items.slice(0, config.maxCompletionItems)
      return {
        kind: 'completion' as const,
        file_path: filePath,
        items: capped.map(projectCompletionItem),
        truncated: result.items.length > capped.length,
        total: result.items.length,
      }
    },
    presentCall: presentLspCompletionCall,
    presentResult: presentLspCompletionResult,
  }))
}

/** The shared preparation every tool runs: workspace + contained, byte-capped source read. */
async function prepareRequest(
  ctx: Context,
  config: ResolvedConfig,
  filePath: string,
  workspaceRoot: string,
  exec: ToolExecution,
): Promise<RunnerRequest> {
  const workspace = await canonicalizeWorkspace(ctx.fs, workspaceRoot, exec.signal)
  const source = await readHostSource(ctx.fs, filePath, workspace, config.maxDocumentBytes, exec.signal)
  return { filePath, workspaceRoot, source }
}

/** Validate a non-blank file path. */
function parseFilePath(filePath: string): string {
  if (filePath.trim().length === 0) throw new Error('file_path must be a non-empty string')
  return filePath
}

/** Validate one-based cursor coordinates and convert them to the zero-based wire position. */
function parseCursor(line: number, character: number): LspPosition {
  if (!Number.isInteger(line) || line < 1) throw new Error('line must be a positive integer (one-based)')
  if (!Number.isInteger(character) || character < 1) throw new Error('character must be a positive integer (one-based)')
  return { line: line - 1, character: character - 1 }
}

/** Validate an optional one-based range and convert it to the zero-based wire range. */
function parseOptionalRange(range: FormatToolArgs['range']): LspRange | undefined {
  if (range === undefined) return undefined
  const start = parseCursor(range.start.line, range.start.character)
  const end = parseCursor(range.end.line, range.end.character)
  if (end.line < start.line || (end.line === start.line && end.character < start.character)) {
    throw new Error('range end must not precede range start')
  }
  return { start, end }
}

/** The session workspace root, or a structured failure — a server needs a real workspace. */
function requireWorkspace(exec: ToolExecution): string {
  const workspaceRoot = sessionCwd(exec)
  if (workspaceRoot === undefined) {
    throw new LspActionError('this LSP action tool requires a session workspace cwd', 'LSP_ACTION_WORKSPACE_REQUIRED')
  }
  return workspaceRoot
}

/** Project one normalized diagnostic into the canonical output shape (plain JSON values only). */
function projectDiagnostic(diagnostic: {
  severity: number
  range: LspRange
  message: string
  source?: string
  code?: string | number
}): {
  severity: number
  range: { start: LspPosition; end: LspPosition }
  message: string
  source?: string
  code?: string | number
} {
  return {
    severity: diagnostic.severity,
    range: {
      start: { line: diagnostic.range.start.line, character: diagnostic.range.start.character },
      end: { line: diagnostic.range.end.line, character: diagnostic.range.end.character },
    },
    message: diagnostic.message,
    ...diagnostic.source === undefined ? {} : { source: diagnostic.source },
    ...diagnostic.code === undefined ? {} : { code: diagnostic.code },
  }
}

/** Project one normalized completion item into the canonical output shape. */
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
  textEdit?: { range: { start: LspPosition; end: LspPosition }; newText: string }
} {
  return {
    label: item.label,
    ...item.kind === undefined ? {} : { kind: item.kind },
    ...item.detail === undefined ? {} : { detail: item.detail },
    ...item.insertText === undefined ? {} : { insertText: item.insertText },
    ...item.sortText === undefined ? {} : { sortText: item.sortText },
    ...item.textEdit === undefined ? {} : {
      textEdit: {
        range: {
          start: { line: item.textEdit.range.start.line, character: item.textEdit.range.start.character },
          end: { line: item.textEdit.range.end.line, character: item.textEdit.range.end.character },
        },
        newText: item.textEdit.newText,
      },
    },
  }
}

/**
 * Map a formatting write failure for the model: sandbox denials become the shared `[sandbox: …]`
 * marker (via the controller), while stale/not-observed failures become the structured conflict
 * that asks the model to choose between re-running and applying the diff manually.
 * @param error - the already sandbox-mapped error.
 * @returns the error to throw.
 */
function mapFormatWriteFailure(error: unknown): unknown {
  if (error instanceof FsError && (error.code === 'FS_STALE_VERSION' || error.code === 'FS_NOT_OBSERVED')) {
    return new LspActionError(
      'the file changed on disk after it was read, and the write policy refused to overwrite it — re-read the file, then either re-run lsp_format or apply the diff manually with edit/write',
      'LSP_ACTION_CONFLICT',
      { cause: error },
    )
  }
  return error
}
