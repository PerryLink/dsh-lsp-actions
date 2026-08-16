/**
 * DSH LSP Actions — minimal VS Code extension over the dsh-lsp-actions editor
 * action protocol. The extension is UI-only: it connects to the backend over
 * ACP-style JSON-RPC, lists sessions, shows diagnostics, and forwards
 * quickfix/format intents. Every LSP capability — and every byte written —
 * belongs to the backend plugin.
 */

'use strict'

const vscode = require('vscode')
const path = require('node:path')
const { BackendClient } = require('./client')
const { DiagnosticTreeProvider, SessionTreeProvider } = require('./views')

/** @type {BackendClient | undefined} */
let client
let sessions = []
let workspaceRoot = ''
const output = vscode.window.createOutputChannel('DSH LSP Actions')
const sessionTree = new SessionTreeProvider()
const diagnosticTree = new DiagnosticTreeProvider()

/** One action-status line per run, on the output channel (never stdout of the backend). */
function logStatus(event) {
  const error = event.error ? ` — ${event.error.code}: ${event.error.message}` : ''
  output.appendLine(`[${event.action}] ${event.status}${error}`)
}

/** Route one `lsp.event` payload to the UI. */
function handleEvent(event) {
  switch (event.kind) {
    case 'diagnostics.updated':
      diagnosticTree.update(event.filePath, workspaceRoot, event.diagnostics)
      break
    case 'file.changed':
      output.appendLine(`[file.changed] ${event.filePath} (diagnostics cache invalidated)`)
      break
    case 'action.status':
      logStatus(event)
      break
    case 'sessions.changed':
      sessions = event.sessions
      sessionTree.setSessions(sessions)
      break
    default:
      break
  }
}

/** The backend launch spec from settings. */
function backendOptions() {
  const config = vscode.workspace.getConfiguration('dshLspActions.backend')
  return {
    node: config.get('node', 'node'),
    bin: config.get('bin', '') || path.join(__dirname, '..', '..', 'backend', 'bin.mjs'),
    config: config.get('config', '') || path.join(__dirname, '..', '..', 'backend', 'cordis.yml'),
  }
}

/** Resolve the first workspace folder as the backend workspace root. */
function resolveWorkspaceRoot() {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error('open a workspace folder first — the backend needs a workspace root')
  return folder.uri.fsPath
}

/** The filePath + workspaceRoot pair for the active editor. */
function activeFile() {
  const editor = vscode.window.activeTextEditor
  if (!editor) throw new Error('open a file in the editor first')
  const root = resolveWorkspaceRoot()
  const filePath = editor.document.uri.fsPath
  if (!filePath.startsWith(root)) throw new Error(`the active file must live under the workspace root (${root})`)
  return { filePath: path.relative(root, filePath), workspaceRoot: root }
}

async function connect() {
  if (client) {
    vscode.window.showInformationMessage('DSH: already connected')
    return
  }
  const options = backendOptions()
  output.appendLine(`[connect] ${options.node} ${options.bin} ${options.config}`)
  client = new BackendClient(options, (line) => { output.append(line) })
  client.onEvent(handleEvent)
  const list = await client.request('lsp.actions.list', {})
  output.appendLine(`[list] protocol=${list.protocol} actions=${list.actions.map(entry => entry.action).join(',')}`)
  sessions = list.sessions
  sessionTree.setSessions(sessions)
  client.notify('lsp.events', { subscribe: true })
  vscode.window.showInformationMessage(`DSH: connected (${list.protocol})`)
}

function disconnect() {
  client?.close()
  client = undefined
  sessions = []
  sessionTree.setSessions([])
  diagnosticTree.clear()
  output.appendLine('[disconnect]')
  vscode.window.showInformationMessage('DSH: disconnected')
}

async function run(action, params, title) {
  if (!client) {
    vscode.window.showWarningMessage('DSH: connect to the editor backend first')
    return undefined
  }
  const result = await client.request('lsp.actions.run', { action, params, requestId: `${action}:${Date.now()}` })
  if (result.status === 'failed') {
    vscode.window.showErrorMessage(`DSH ${title} failed: ${result.error.code} — ${result.error.message}`)
    return undefined
  }
  return result.result
}

async function refreshDiagnostics() {
  try {
    const { filePath, workspaceRoot: root } = activeFile()
    workspaceRoot = root
    const result = await run('diagnostics.get', { filePath, workspaceRoot: root }, 'diagnostics')
    if (result) diagnosticTree.update(filePath, root, result.diagnostics)
  } catch (error) {
    vscode.window.showErrorMessage(`DSH diagnostics: ${error.message}`)
  }
}

async function applyQuickfix(filePath, root, diagnostic) {
  try {
    const result = await run('quickfix.apply', {
      filePath,
      workspaceRoot: root,
      range: diagnostic.range,
      index: 0,
    }, 'quickfix')
    if (result && result.kind === 'quickfixApplied') {
      vscode.window.showInformationMessage(`DSH: applied "${result.title}" to ${result.filesChanged} file(s)`)
      void refreshDiagnostics()
    }
  } catch (error) {
    vscode.window.showErrorMessage(`DSH quickfix: ${error.message}`)
  }
}

async function openDiagnostic(filePath, root, range) {
  const uri = vscode.Uri.file(path.join(root, filePath))
  const document = await vscode.workspace.openTextDocument(uri)
  const editor = await vscode.window.showTextDocument(document, { preview: true })
  const start = new vscode.Position(range.start.line, range.start.character)
  const end = new vscode.Position(range.end.line, range.end.character)
  editor.selection = new vscode.Selection(start, end)
  editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter)
}

async function formatDocument() {
  try {
    const { filePath, workspaceRoot: root } = activeFile()
    workspaceRoot = root
    const result = await run('format', { filePath, workspaceRoot: root }, 'format')
    if (result && result.kind === 'formatted') {
      vscode.window.showInformationMessage(`DSH: formatted ${filePath} (${result.appliedEdits} edit(s))`)
    }
  } catch (error) {
    vscode.window.showErrorMessage(`DSH format: ${error.message}`)
  }
}

function activate(context) {
  vscode.window.registerTreeDataProvider('dshLspActions.sessions', sessionTree)
  vscode.window.registerTreeDataProvider('dshLspActions.diagnostics', diagnosticTree)
  context.subscriptions.push(
    vscode.commands.registerCommand('dshLspActions.connect', () => { void connect() }),
    vscode.commands.registerCommand('dshLspActions.disconnect', disconnect),
    vscode.commands.registerCommand('dshLspActions.refreshDiagnostics', () => { void refreshDiagnostics() }),
    vscode.commands.registerCommand('dshLspActions.applyQuickfix', (filePath, root, diagnostic) => { void applyQuickfix(filePath, root, diagnostic) }),
    vscode.commands.registerCommand('dshLspActions.openDiagnostic', (filePath, root, range) => { void openDiagnostic(filePath, root, range) }),
    vscode.commands.registerCommand('dshLspActions.formatDocument', () => { void formatDocument() }),
  )
}

function deactivate() {
  client?.close()
  client = undefined
}

module.exports = { activate, deactivate }
