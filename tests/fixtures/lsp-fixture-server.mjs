/**
 * A minimal LSP fixture server over stdio JSON-RPC: deterministic diagnostics (pull or push),
 * completion items, and space→tab formatting edits, with flags for failure and hang behavior so
 * client tests exercise real process, framing, and teardown paths.
 *
 * Usage: node lsp-fixture-server.mjs [--push-diag] [--hang] [--malformed-format] [--fail-start]
 */

import process from 'node:process'

const args = new Set(process.argv.slice(2))
const pushDiag = args.has('--push-diag')
const hang = args.has('--hang')
const malformedFormat = args.has('--malformed-format')
const noCompletion = args.has('--no-completion')

if (args.has('--fail-start')) {
  process.stderr.write('fixture: refusing to start\n')
  process.exit(2)
}

const opened = new Map()

function fixtureDiagnostics() {
  return [
    { severity: 1, range: { start: { line: 1, character: 1 }, end: { line: 1, character: 3 } }, message: 'fixture error', source: 'fixture', code: 42 },
    { severity: 2, range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } }, message: 'fixture warning', source: 'fixture', code: 'w1' },
    { severity: 3, range: { start: { line: 3, character: 0 }, end: { line: 3, character: 0 } }, message: 'fixture info' },
  ]
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
          positionEncoding: 'utf-16',
          textDocumentSync: { openClose: true, change: 2 },
          ...noCompletion ? {} : { completionProvider: {} },
          documentFormattingProvider: true,
          documentRangeFormattingProvider: true,
          ...pushDiag ? {} : { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } },
        },
      })
      return
    }
    case 'initialized':
      return
    case 'textDocument/didOpen': {
      opened.set(params.textDocument.uri, params.textDocument.text)
      if (pushDiag) {
        send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: params.textDocument.uri, diagnostics: fixtureDiagnostics() } })
      }
      return
    }
    case 'textDocument/didClose':
      opened.delete(params.textDocument.uri)
      return
    case 'textDocument/diagnostic':
      respond(id, { kind: 'full', items: fixtureDiagnostics() })
      return
    case 'textDocument/completion':
      if (hang) return
      respond(id, fixtureCompletion())
      return
    case 'textDocument/formatting':
    case 'textDocument/rangeFormatting':
      if (hang) return
      respond(id, fixtureFormatting())
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
    }
  }
})
