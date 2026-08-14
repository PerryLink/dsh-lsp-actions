/**
 * A minimal LSP fixture server over stdio JSON-RPC: deterministic diagnostics (pull or push),
 * completion items, and space→tab formatting edits, with flags for failure and hang behavior so
 * client tests exercise real process, framing, and teardown paths.
 *
 * Usage: node lsp-fixture-server.mjs [--push-diag] [--multi-push] [--hang] [--malformed-format]
 *   [--fail-start] [--no-completion] [--sync-none] [--ask-config] [--utf8]
 *   [--fail-first-time <marker>] [--count-spawns <marker>]
 */

import process from 'node:process'
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'

const args = new Set(process.argv.slice(2))
const pushDiag = args.has('--push-diag') || args.has('--multi-push')
const multiPush = args.has('--multi-push')
const hang = args.has('--hang')
const malformedFormat = args.has('--malformed-format')
const noCompletion = args.has('--no-completion')
const syncNone = args.has('--sync-none')
const askConfig = args.has('--ask-config')
const utf8 = args.has('--utf8')
const rejectFormat = args.has('--reject-format')
const serverRequests = args.has('--server-requests')

const flagValue = (flag) => {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : null
}

if (args.has('--fail-start')) {
  process.stderr.write('fixture: refusing to start\n')
  process.exit(2)
}

// The first spawn of a --fail-first-time run exits before the handshake completes; the marker
// makes the second spawn (the client's retry) proceed.
const failFirstTime = flagValue('--fail-first-time')
if (failFirstTime !== null && !existsSync(failFirstTime)) {
  writeFileSync(failFirstTime, 'spawned\n')
  process.stderr.write('fixture: failing first spawn\n')
  process.exit(2)
}

const countSpawns = flagValue('--count-spawns')
if (countSpawns !== null) appendFileSync(countSpawns, 'spawn\n')

const opened = new Map()
let configRequestId = 0
let configAnswers = []
let pendingDiagnosticId = null

function fixtureDiagnostics() {
  if (utf8) {
    // utf-8 character offsets on line 1 of a '😀xx' document (4 bytes emoji + 2 bytes): decoded to
    // utf-16 this is characters 2..4.
    return [{
      severity: 1,
      range: { start: { line: 1, character: 4 }, end: { line: 1, character: 6 } },
      message: 'utf8 diag',
      source: 'fixture',
    }]
  }
  const base = [
    { severity: 1, range: { start: { line: 1, character: 1 }, end: { line: 1, character: 3 } }, message: 'fixture error', source: 'fixture', code: 42 },
    { severity: 2, range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } }, message: 'fixture warning', source: 'fixture', code: 'w1' },
    { severity: 3, range: { start: { line: 3, character: 0 }, end: { line: 3, character: 0 } }, message: 'fixture info' },
  ]
  if (!askConfig) return base
  return base.map((diagnostic, index) => ({
    ...diagnostic,
    message: `${diagnostic.message} [config:${JSON.stringify(configAnswers[index])}]`,
  }))
}

function fixtureCompletion() {
  return {
    isIncomplete: false,
    items: [
      { label: 'alpha', kind: 1, detail: 'fixture alpha' },
      { label: 'beta', kind: 2, insertText: 'beta' },
    ],
  }
}

/** Replace four-space indentation with a tab, one edit per changed line. */
function fixtureFormatting() {
  if (malformedFormat) return [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }]
  const text = opened.values().next().value ?? ''
  const edits = []
  for (const [index, line] of text.split('\n').entries()) {
    const match = /^( {4})+/.exec(line)
    if (match !== null) {
      edits.push({
        range: { start: { line: index, character: 0 }, end: { line: index, character: match[0].length } },
        newText: '\t'.repeat(match[0].length / 4),
      })
    }
  }
  return edits
}

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  process.stdout.write(`Content-Length: ${body.byteLength}\r\n\r\n`)
  process.stdout.write(body)
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function respondError(id, message) {
  send({ jsonrpc: '2.0', id, error: { code: -32601, message } })
}

function handle(id, method, params) {
  switch (method) {
    case 'initialize': {
      respond(id, {
        capabilities: {
          positionEncoding: utf8 ? 'utf-8' : 'utf-16',
          textDocumentSync: syncNone ? 0 : { openClose: true, change: 2 },
          ...noCompletion ? {} : { completionProvider: {} },
          documentFormattingProvider: true,
          documentRangeFormattingProvider: true,
          codeActionProvider: true,
          workspaceSymbolProvider: true,
          documentSymbolProvider: true,
          signatureHelpProvider: { triggerCharacters: ['('] },
          inlayHintProvider: true,
          ...pushDiag ? {} : { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } },
        },
      })
      return
    }
    case 'initialized':
      // Ask once at initialization, before any action runs, so later diagnostics can embed the
      // recorded answers without racing the client's response.
      if (askConfig) {
        configRequestId += 1
        send({
          jsonrpc: '2.0',
          id: configRequestId,
          method: 'workspace/configuration',
          params: { items: [{ section: 'typescript' }, { section: 'python' }, { section: 'unmapped' }] },
        })
      }
      if (serverRequests) {
        // Exercise the client's server→client request paths: a noop lifecycle request and a
        // refused workspace/applyEdit.
        send({ jsonrpc: '2.0', id: 9001, method: 'client/registerCapability', params: { registrations: [] } })
        send({ jsonrpc: '2.0', id: 9002, method: 'workspace/applyEdit', params: { edit: {} } })
        send({ jsonrpc: '2.0', id: 9003, method: 'window/workDoneProgress/create', params: { token: 't' } })
      }
      return
    case 'textDocument/didOpen': {
      opened.set(params.textDocument.uri, params.textDocument.text)
      if (pushDiag) {
        if (multiPush) {
          // A partial batch first, then a complete one shortly after: the client must return the
          // latest batch (debounced), not the first.
          send({
            jsonrpc: '2.0',
            method: 'textDocument/publishDiagnostics',
            params: { uri: params.textDocument.uri, diagnostics: [fixtureDiagnostics()[0]] },
          })
          setTimeout(() => {
            send({
              jsonrpc: '2.0',
              method: 'textDocument/publishDiagnostics',
              params: { uri: params.textDocument.uri, diagnostics: fixtureDiagnostics() },
            })
          }, 60)
        } else {
          send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: params.textDocument.uri, diagnostics: fixtureDiagnostics() } })
        }
      }
      return
    }
    case 'textDocument/didClose':
      opened.delete(params.textDocument.uri)
      return
    case 'textDocument/diagnostic':
      if (askConfig && configAnswers.length === 0) {
        // Defer until the client's workspace/configuration answers arrive, so the embedded
        // messages reflect them deterministically.
        pendingDiagnosticId = id
        return
      }
      respond(id, { kind: 'full', items: fixtureDiagnostics() })
      return
    case 'textDocument/completion':
      if (hang) return
      if (utf8) {
        // Echo the request position back inside a textEdit range: the client must decode the
        // server-side (utf-8) position to the original utf-16 cursor.
        respond(id, {
          isIncomplete: false,
          items: [{ label: 'echo', textEdit: { range: { start: params.position, end: params.position }, newText: 'Y' } }],
        })
        return
      }
      respond(id, fixtureCompletion())
      return
    case 'textDocument/formatting':
    case 'textDocument/rangeFormatting':
      if (hang) return
      if (rejectFormat) {
        respondError(id, 'formatting refused by the fixture')
        return
      }
      respond(id, fixtureFormatting())
      return
    case 'textDocument/codeAction':
      respond(id, [
        {
          title: 'Fix fixture error',
          kind: 'quickfix',
          isPreferred: true,
          edit: {
            changes: {
              [params.textDocument.uri]: [
                { range: { start: { line: 1, character: 1 }, end: { line: 1, character: 3 } }, newText: 'fixed' },
              ],
            },
          },
        },
        {
          title: 'Run a fixture command',
          command: { title: 'run', command: 'fixture.run', arguments: [1] },
        },
        {
          title: 'Run a bare fixture command',
          command: { title: 'bare', command: 'fixture.bare' },
        },
      ])
      return
    case 'workspace/symbol':
      respond(id, [
        { name: 'fixtureSymbol', kind: 12, location: { uri: 'file:///ws/a.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } } }, containerName: 'mod' },
      ])
      return
    case 'textDocument/documentSymbol':
      respond(id, [
        {
          name: 'fixtureDocumentSymbol',
          kind: 12,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
          selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
          children: [
            { name: 'child', kind: 6, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, selectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } },
          ],
        },
      ])
      return
    case 'textDocument/signatureHelp':
      respond(id, {
        signatures: [
          {
            label: 'fixture(a: number)',
            parameters: [{ label: 'a: number' }],
            documentation: { kind: 'markdown', value: 'fixture docs' },
          },
        ],
        activeSignature: 0,
        activeParameter: 0,
      })
      return
    case 'textDocument/inlayHint':
      respond(id, [
        { position: { line: 1, character: 0 }, label: [{ value: ': ' }, { value: 'number' }], kind: 1, paddingLeft: true },
      ])
      return
    case 'shutdown':
      respond(id, null)
      return
    case 'exit':
      process.exit(0)
      return
    case '$/cancelRequest':
      return
    default:
      if (typeof id === 'number') respondError(id, `unsupported method: ${method}`)
  }
}

let buffer = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const header = buffer.subarray(0, headerEnd).toString('ascii')
    const match = /^Content-Length: (\d+)\s*$/m.exec(header)
    if (match === null) return
    const length = Number(match[1])
    const start = headerEnd + 4
    if (buffer.length < start + length) return
    const body = buffer.subarray(start, start + length).toString('utf8')
    buffer = buffer.subarray(start + length)
    const message = JSON.parse(body)
    const id = message.id
    const method = message.method
    if (typeof method === 'string' && typeof id !== 'number') {
      handle(undefined, method, message.params)
    } else if (typeof method === 'string' && typeof id === 'number') {
      handle(id, method, message.params)
    } else if (typeof method !== 'string' && typeof id === 'number' && id === configRequestId) {
      // The client's answer to this server's workspace/configuration request.
      configAnswers = message.result
      if (pendingDiagnosticId !== null) {
        respond(pendingDiagnosticId, { kind: 'full', items: fixtureDiagnostics() })
        pendingDiagnosticId = null
      }
    }
  }
})
