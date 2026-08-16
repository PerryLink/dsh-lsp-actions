/**
 * The sidebar tree providers: a DSH session list and a diagnostics list with
 * quickfix actions. Both are pure presentation of backend state — the
 * extension never computes diagnostics or applies edits itself.
 */

'use strict'

const vscode = require('vscode')

const SEVERITY_ICON = new Map([
  [1, 'error'],
  [2, 'warning'],
  [3, 'info'],
  [4, 'hint'],
])

/** The "DSH Sessions" view: sessionId + cwd + live marker. */
class SessionTreeProvider {
  constructor() {
    this.sessions = []
    this._onDidChange = new vscode.EventEmitter()
    this.onDidChangeTreeData = this._onDidChange.event
  }

  setSessions(sessions) {
    this.sessions = sessions
    this._onDidChange.fire()
  }

  getTreeItem(element) {
    return element
  }

  getChildren() {
    if (this.sessions.length === 0) {
      return [new vscode.TreeItem('No sessions in the backend runtime (connect first)', vscode.TreeItemCollapsibleState.None)]
    }
    return this.sessions.map((session) => {
      const item = new vscode.TreeItem(`${session.sessionId}${session.live ? ' ●' : ''}`, vscode.TreeItemCollapsibleState.None)
      item.description = session.cwd || '(no cwd)'
      item.tooltip = session.live ? 'Live agent in this session' : 'No live agent'
      item.iconPath = new vscode.ThemeIcon(session.live ? 'pulse' : 'circle-outline')
      return item
    })
  }
}

/** One file grouping in the diagnostics view. */
class FileItem extends vscode.TreeItem {
  constructor(filePath, workspaceRoot, count) {
    super(filePath, vscode.TreeItemCollapsibleState.Expanded)
    this.description = `${count} diagnostic${count === 1 ? '' : 's'}`
    this.iconPath = vscode.ThemeIcon.File
    this.payload = { kind: 'file', filePath, workspaceRoot }
  }
}

/** One diagnostic row; clicking it opens the file at the range. */
class DiagnosticItem extends vscode.TreeItem {
  constructor(diagnostic, filePath, workspaceRoot) {
    const where = `${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`
    super(diagnostic.message, vscode.TreeItemCollapsibleState.Collapsed)
    this.description = `${where} — ${diagnostic.source || 'LSP'}`
    this.iconPath = new vscode.ThemeIcon(SEVERITY_ICON.get(diagnostic.severity) || 'info')
    this.command = {
      command: 'dshLspActions.openDiagnostic',
      title: 'Open file',
      arguments: [filePath, workspaceRoot, diagnostic.range],
    }
    this.payload = { kind: 'diagnostic', filePath, workspaceRoot, diagnostic }
  }
}

/** The "LSP Diagnostics" view. */
class DiagnosticTreeProvider {
  constructor() {
    this.files = new Map()
    this._onDidChange = new vscode.EventEmitter()
    this.onDidChangeTreeData = this._onDidChange.event
  }

  /** Replace the diagnostics of one file (usually from a `diagnostics.updated` event). */
  update(filePath, workspaceRoot, diagnostics) {
    this.files.set(`${workspaceRoot}::${filePath}`, { filePath, workspaceRoot, diagnostics })
    this._onDidChange.fire()
  }

  clear() {
    this.files.clear()
    this._onDidChange.fire()
  }

  getTreeItem(element) {
    return element
  }

  getChildren(element) {
    if (element === undefined) {
      const rows = []
      for (const { filePath, workspaceRoot, diagnostics } of this.files.values()) {
        rows.push(new FileItem(filePath, workspaceRoot, diagnostics.length))
      }
      if (rows.length === 0) {
        return [new vscode.TreeItem('No diagnostics yet — open a file and press the ↻ refresh button', vscode.TreeItemCollapsibleState.None)]
      }
      return rows
    }
    if (element.payload.kind === 'file') {
      const entry = this.files.get(`${element.payload.workspaceRoot}::${element.payload.filePath}`)
      return (entry?.diagnostics || []).map(diagnostic => new DiagnosticItem(diagnostic, entry.filePath, entry.workspaceRoot))
    }
    // One-click quickfix: the backend selects the server's preferred action for this
    // diagnostic's range. Applying is the BACKEND's write (official write policy);
    // this extension never edits the buffer.
    const apply = new vscode.TreeItem('Apply quickfix', vscode.TreeItemCollapsibleState.None)
    apply.iconPath = new vscode.ThemeIcon('lightbulb-autofix')
    apply.command = {
      command: 'dshLspActions.applyQuickfix',
      title: 'Apply quickfix',
      arguments: [element.payload.filePath, element.payload.workspaceRoot, element.payload.diagnostic],
    }
    return [apply]
  }
}

module.exports = { SessionTreeProvider, DiagnosticTreeProvider }
