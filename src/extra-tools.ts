/**
 * The extended read-only LSP action tools: `lsp_code_action` (server-verified quickfixes, never
 * applied), `lsp_symbols` (workspace-wide or per-document symbol search), `lsp_signature`
 * (signature help at a cursor), and `lsp_inlay_hints` (server type/parameter hints). All four are
 * read-only: results are reference material, and applying anything is the model's own write/edit
 * decision. All declare `timeoutMs` for the official timeout policy and observe `exec.signal`.
 * @module dsh-lsp-actions/extra-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { OUTPUT_RANGE_SCHEMA, parseCursor, parseFilePath, parseOptionalRange, POSITION_SCHEMA, prepareRequest, requireWorkspace } from './tools.ts'
import type { ActionRunner } from './runner.ts'
import type { ResolvedConfig } from './servers.ts'
import {
  formatCodeActions,
  formatInlayHints,
  formatSignatures,
  formatSymbols,
  presentLspCodeActionCall,
  presentLspCodeActionResult,
  presentLspInlayHintsCall,
  presentLspInlayHintsResult,
  presentLspSignatureCall,
  presentLspSignatureResult,
  presentLspSymbolsCall,
  presentLspSymbolsResult,
  symbolKindLabel,
} from './render.ts'
import type { LspRange } from './vocabulary.ts'

/** The one-based range schema, shared by the range-accepting extended tools. */
const RANGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description: 'Optional selection as one-based UTF-16 line/character (cursor convention); omit for the whole file.',
  properties: {
    start: { type: 'object', additionalProperties: false, required: true, properties: { line: { type: 'integer', required: true }, character: { type: 'integer', required: true } } },
    end: { type: 'object', additionalProperties: false, required: true, properties: { line: { type: 'integer', required: true }, character: { type: 'integer', required: true } } },
  },
} as const

/**
 * Register the `lsp_code_action` tool: server-verified fixes for a range (or the first
 * diagnostic's range) as reference-only items — the tool never applies edits or runs commands.
 * @param ctx - the plugin context.
 * @param runner - the seam-first action runner.
 * @param config - the resolved plugin configuration.
 */
export function registerCodeActionTool(ctx: Context, runner: ActionRunner, config: ResolvedConfig): void {
  ctx.tools.register(defineTool({
    name: 'lsp_code_action',
    description:
      'Request server-verified code actions (quickfixes, refactorings) for a range — or for the first reported diagnostic when no range is given. Reference-only: edits and commands are reported, never applied — apply an action\'s edits yourself with write/edit.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'The source file, relative to the workspace or absolute.' },
      range: RANGE_SCHEMA,
      only: {
        type: 'array',
        description: 'Optional CodeActionKind filters, e.g. ["quickfix"], ["refactor"].',
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'codeActions' },
          file_path: { type: 'string', required: true },
          range: {
            type: 'object',
            additionalProperties: false,
            properties: {
              start: { ...POSITION_SCHEMA, required: true },
              end: { ...POSITION_SCHEMA, required: true },
            },
          },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                kind: { type: 'string' },
                isPreferred: { type: 'boolean' },
                edits: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      uri: { type: 'string', required: true },
                      edits: {
                        type: 'array',
                        required: true,
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            range: { ...OUTPUT_RANGE_SCHEMA, required: true },
                            newText: { type: 'string', required: true },
                          },
                        },
                      },
                    },
                  },
                },
                command: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    title: { type: 'string', required: true },
                    command: { type: 'string', required: true },
                    arguments: { type: 'array' },
                  },
                },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
          total: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatCodeActions(value.file_path, value.items, config.maxResultChars) }],
      presentationMeta: (_args, value) => ({
        items: value.items.map((item: { title: string; kind?: string; isPreferred?: boolean }) => ({
          title: item.title,
          ...item.kind === undefined ? {} : { kind: item.kind },
          ...item.isPreferred === undefined ? {} : { isPreferred: item.isPreferred },
        })),
      }),
    },
    timeoutMs: config.timeoutMs,
    async execute(args: { file_path: string; range?: { start: { line: number; character: number }; end: { line: number; character: number } }; only?: string[] }, exec) {
      const filePath = parseFilePath(args.file_path)
      const workspaceRoot = requireWorkspace(exec)
      const wireRange = parseOptionalRange(args.range)
      const request = await prepareRequest(ctx, config, filePath, workspaceRoot, exec)
      const result = await runner.codeActions({
        ...request,
        ...wireRange === undefined ? {} : { range: wireRange },
        ...args.only === undefined || args.only.length === 0 ? {} : { onlyKinds: args.only },
      }, exec.signal)
      const capped = result.items.slice(0, config.maxCodeActions)
      // Project the grouped edit record into the schema-friendly uri→edits list form.
      const items = capped.map(action => ({
        title: action.title,
        ...action.kind === undefined ? {} : { kind: action.kind },
        ...action.isPreferred === undefined ? {} : { isPreferred: action.isPreferred },
        edits: Object.entries(action.edits).map(([uri, edits]) => ({
          uri,
          edits: edits.map(edit => ({ range: edit.range, newText: edit.newText })),
        })),
        ...action.command === undefined ? {} : {
          command: {
            title: action.command.title,
            command: action.command.command,
            ...Array.isArray(action.command.arguments) ? { arguments: action.command.arguments } : {},
          },
        },
      }))
      return {
        kind: 'codeActions' as const,
        file_path: filePath,
        // Echo the caller's one-based range (the model-facing convention), not the wire range.
        ...args.range === undefined ? {} : { range: args.range },
        items,
        truncated: result.items.length > capped.length,
        total: result.items.length,
      }
    },
    presentCall: presentLspCodeActionCall,
    presentResult: presentLspCodeActionResult,
  }))
}

/**
 * Register the `lsp_symbols` tool: workspace-wide symbol search by name (`query`) or a per-file
 * symbol outline (`file_path` without `query`). At least one of the two must be supplied.
 * @param ctx - the plugin context.
 * @param runner - the seam-first action runner.
 * @param config - the resolved plugin configuration.
 */
export function registerSymbolsTool(ctx: Context, runner: ActionRunner, config: ResolvedConfig): void {
  ctx.tools.register(defineTool({
    name: 'lsp_symbols',
    description:
      'Search symbols: with query, a workspace-wide name search through the language server; with file_path but no query, the symbol outline of one file. Read-only.',
    parameters: {
      query: { type: 'string', description: 'The symbol name to search across the workspace (substring match).' },
      file_path: { type: 'string', description: 'Restrict the search to one file\'s symbols when query is omitted; with query, the file only routes the server selection.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'symbols' },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                kind: { type: 'integer', required: true },
                location: {
                  type: 'object',
                  additionalProperties: false,
                  required: true,
                  properties: {
                    uri: { type: 'string', required: true },
                    range: { ...OUTPUT_RANGE_SCHEMA, required: true },
                  },
                },
                containerName: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
          total: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatSymbols(value.items, config.maxResultChars) }],
      presentationMeta: (_args, value) => ({
        items: value.items.map((item: { name: string; kind: number; location: { uri: string; range: { start: { line: number; character: number } } } }) => ({
          name: item.name,
          kind: item.kind,
          location: {
            uri: item.location.uri,
            line: item.location.range.start.line + 1,
            character: item.location.range.start.character + 1,
          },
        })),
      }),
    },
    timeoutMs: config.timeoutMs,
    async execute(args: { query?: string; file_path?: string }, exec) {
      if ((args.query ?? '').trim() === '' && (args.file_path ?? '').trim() === '') {
        throw new Error('lsp_symbols requires a non-empty query or file_path')
      }
      const workspaceRoot = requireWorkspace(exec)
      const project = <T,>(result: { items: readonly T[] }): { items: T[]; truncated: boolean; total: number } => {
        const capped = result.items.slice(0, config.maxSymbols)
        return { items: [...capped], truncated: result.items.length > capped.length, total: result.items.length }
      }
      if (args.query !== undefined && args.query.trim() !== '') {
        // Workspace-wide search. The optional file_path routes the server selection and, when
        // given, is kept transiently open so project-based servers (tsls) can serve the search.
        const query = args.query.trim()
        if (args.file_path !== undefined && args.file_path.trim() !== '') {
          const filePath = parseFilePath(args.file_path)
          const request = await prepareRequest(ctx, config, filePath, workspaceRoot, exec)
          const result = await runner.workspaceSymbols({ ...request, query }, exec.signal)
          return { kind: 'symbols' as const, ...project(result) }
        }
        const result = await runner.workspaceSymbols({ filePath: '', workspaceRoot, query }, exec.signal)
        return { kind: 'symbols' as const, ...project(result) }
      }
      const filePath = parseFilePath(args.file_path as string)
      const request = await prepareRequest(ctx, config, filePath, workspaceRoot, exec)
      const result = await runner.documentSymbols(request, exec.signal)
      return { kind: 'symbols' as const, ...project(result) }
    },
    presentCall: presentLspSymbolsCall,
    presentResult: presentLspSymbolsResult,
  }))
}

/**
 * Register the `lsp_signature` tool: signature help at a cursor position.
 * @param ctx - the plugin context.
 * @param runner - the seam-first action runner.
 * @param config - the resolved plugin configuration.
 */
export function registerSignatureTool(ctx: Context, runner: ActionRunner, config: ResolvedConfig): void {
  ctx.tools.register(defineTool({
    name: 'lsp_signature',
    description:
      'Request signature help (parameter list and documentation) at a one-based UTF-16 cursor position from the file\'s language server. Read-only.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'The source file, relative to the workspace or absolute.' },
      line: { type: 'integer', required: true, description: 'One-based line of the cursor (inside the call).' },
      character: { type: 'integer', required: true, description: 'One-based UTF-16 column of the cursor.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'signatures' },
          file_path: { type: 'string', required: true },
          signatures: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                label: { type: 'string', required: true },
                documentation: { type: 'string' },
                parameters: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      label: { type: 'string', required: true },
                      documentation: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          activeSignature: { type: 'integer' },
          activeParameter: { type: 'integer' },
        },
      },
      render: (args, value) => [{ type: 'text', text: formatSignatures(value.file_path, value.signatures, value.activeSignature, value.activeParameter, config.maxResultChars) }],
      presentationMeta: (_args, value) => ({
        signatures: value.signatures.map((signature: { label: string; documentation?: string }) => ({
          label: signature.label,
          ...signature.documentation === undefined ? {} : { documentation: signature.documentation },
        })),
      }),
    },
    timeoutMs: config.timeoutMs,
    async execute(args: { file_path: string; line: number; character: number }, exec) {
      const filePath = parseFilePath(args.file_path)
      const position = parseCursor(args.line, args.character)
      const workspaceRoot = requireWorkspace(exec)
      const request = await prepareRequest(ctx, config, filePath, workspaceRoot, exec)
      const result = await runner.signatureHelp({ ...request, position }, exec.signal)
      const signatures = result.signatures.slice(0, config.maxSignatures).map((signature) => ({
        label: signature.label,
        ...signature.documentation === undefined ? {} : { documentation: signature.documentation },
        ...signature.parameters === undefined ? {} : {
          parameters: signature.parameters.map(parameter => ({
            label: parameter.label,
            ...parameter.documentation === undefined ? {} : { documentation: parameter.documentation },
          })),
        },
      }))
      return {
        kind: 'signatures' as const,
        file_path: filePath,
        signatures,
        ...result.activeSignature === undefined ? {} : { activeSignature: result.activeSignature },
        ...result.activeParameter === undefined ? {} : { activeParameter: result.activeParameter },
      }
    },
    presentCall: presentLspSignatureCall,
    presentResult: presentLspSignatureResult,
  }))
}

/**
 * Register the `lsp_inlay_hints` tool: server type/parameter inlay hints for a file or range.
 * @param ctx - the plugin context.
 * @param runner - the seam-first action runner.
 * @param config - the resolved plugin configuration.
 */
export function registerInlayHintsTool(ctx: Context, runner: ActionRunner, config: ResolvedConfig): void {
  ctx.tools.register(defineTool({
    name: 'lsp_inlay_hints',
    description:
      'Request inlay hints (type annotations, parameter names) for a file or a one-based selection from its language server. Read-only.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'The source file, relative to the workspace or absolute.' },
      range: RANGE_SCHEMA,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'inlayHints' },
          file_path: { type: 'string', required: true },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                position: { ...POSITION_SCHEMA, required: true },
                label: { type: 'string', required: true },
                kind: { type: 'integer' },
                paddingLeft: { type: 'boolean' },
                paddingRight: { type: 'boolean' },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
          total: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatInlayHints(value.file_path, value.items, config.maxResultChars) }],
      presentationMeta: (_args, value) => ({
        items: value.items.map((item: { position: { line: number; character: number }; label: string }) => ({
          line: item.position.line + 1,
          character: item.position.character + 1,
          label: item.label,
        })),
      }),
    },
    timeoutMs: config.timeoutMs,
    async execute(args: { file_path: string; range?: { start: { line: number; character: number }; end: { line: number; character: number } } }, exec) {
      const filePath = parseFilePath(args.file_path)
      const workspaceRoot = requireWorkspace(exec)
      const range: LspRange | undefined = parseOptionalRange(args.range)
      const request = await prepareRequest(ctx, config, filePath, workspaceRoot, exec)
      const result = await runner.inlayHints({ ...request, ...range === undefined ? {} : { range } }, exec.signal)
      const capped = result.items.slice(0, config.maxInlayHints)
      return {
        kind: 'inlayHints' as const,
        file_path: filePath,
        items: capped,
        truncated: result.items.length > capped.length,
        total: result.items.length,
      }
    },
    presentCall: presentLspInlayHintsCall,
    presentResult: presentLspInlayHintsResult,
  }))
}

/** The human-readable label for a numeric symbol kind, re-exported for tests. */
export { symbolKindLabel }
