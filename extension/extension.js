const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { localUsage } = require('./usage')

const ROOT = path.join(os.homedir(), '.claude', 'mod-stats')
const STATS = path.join(ROOT, 'session-stats')
const PACE = path.join(ROOT, 'usage-pace')
const HANDOFF = path.join(ROOT, 'handoff')
const HANDOFF_TIMEOUT = 3 * 60 * 1000
const STALE = 7 * 24 * 3600 * 1000

function readAll(dir) {
  let names = []
  try {
    names = fs.readdirSync(dir).filter(n => n.endsWith('.json'))
  } catch {
    return []
  }
  const out = []
  for (const n of names) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
      if (Date.now() - data.updatedAt < STALE) out.push(data)
    } catch {}
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

function inWorkspace(cwd) {
  const folders = vscode.workspace.workspaceFolders ?? []
  return folders.some(f => cwd === f.uri.fsPath || cwd.startsWith(f.uri.fsPath + path.sep))
}

function snapshot() {
  const stats = readAll(STATS)
  const session = stats.find(s => s.cwd && inWorkspace(s.cwd)) ?? stats[0] ?? null
  const paces = readAll(PACE)
  const pace = paces.find(p => p.paces.length > 0) ?? paces[0] ?? null
  return { session, pace, local: localUsage(), handoff: pending ? 'working' : null, now: Date.now() }
}

let pending = null
let state = null

const RANK = { ok: 0, soon: 1, swap: 2 }
const FRESH = 60 * 60 * 1000

function alertSwap(s, provider) {
  if (!s?.advice || !state || Date.now() - s.updatedAt > FRESH) return
  const key = `alerted:${s.sessionId}`
  const level = s.advice.level
  const last = state.get(key, 'ok')
  if (RANK[level] === RANK[last]) return
  state.update(key, level)
  if (RANK[level] < RANK[last]) return

  const show = level === 'swap' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage
  const head = level === 'swap' ? 'Swap to a new chat now' : 'Swap to a new chat soon'
  const cut = s.advice.extra >= 1000 ? ` This chat re-reads ${Math.round(s.advice.extra / 1000)}k tokens per turn a fresh one would not.` : ''
  show(`${head}: ${s.advice.reason}.${cut}`, 'Hand off to new chat', 'Not now').then(pick => {
    if (pick === 'Hand off to new chat') requestHandoff(s.sessionId, provider)
  })
}

function requestHandoff(sessionId, provider) {
  if (!sessionId || pending) return
  const at = Date.now()
  pending = { sessionId, at }
  fs.writeFileSync(path.join(HANDOFF, `${sessionId}.request`), String(at))
  setTimeout(() => {
    if (pending?.at !== at) return
    pending = null
    vscode.window.showWarningMessage('Handoff timed out. Is that Claude session still open? Run /handoff in it instead.')
    provider.push()
  }, HANDOFF_TIMEOUT)
  provider.push()
}

async function checkHandoff(provider) {
  if (!pending) return
  let data
  try {
    data = JSON.parse(fs.readFileSync(path.join(HANDOFF, `${pending.sessionId}.json`), 'utf8'))
  } catch {
    return
  }
  if (data.at < pending.at || data.status === 'working') return
  pending = null
  provider.push()
  if (data.status === 'error') {
    vscode.window.showErrorMessage(`Handoff failed: ${data.error}`)
    return
  }
  await vscode.env.clipboard.writeText(data.text)
  await vscode.commands.executeCommand('claude-vscode.editor.open', undefined, data.text)
  vscode.window.showInformationMessage(`Handoff ready (${data.method}), also on clipboard. Send it in the new chat.`)
}

class Provider {
  resolveWebviewView(view) {
    this.view = view
    const nonce = crypto.randomBytes(16).toString('hex')
    view.webview.options = { enableScripts: true }
    view.webview.html = html(nonce, view.webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, 'media', 'view.js'))))
    view.webview.onDidReceiveMessage(m => {
      if (m === 'ready') this.push()
      else if (m?.type === 'handoff') requestHandoff(m.sessionId, this)
    })
    view.onDidChangeVisibility(() => view.visible && this.push())
  }

  push() {
    const data = snapshot()
    alertSwap(data.session, this)
    if (this.view?.visible) this.view.webview.postMessage(data)
  }
}

function html(nonce, script) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 4px 8px 12px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--vscode-descriptionForeground); margin: 14px 0 6px; font-weight: 600; }
  .row { display: flex; justify-content: space-between; gap: 8px; line-height: 1.6; }
  .row span:last-child { font-variant-numeric: tabular-nums; }
  .dim { color: var(--vscode-descriptionForeground); }
  .bar { height: 6px; background: var(--vscode-editorWidget-border, #8884); border-radius: 3px; overflow: hidden; margin: 2px 0 4px; }
  .bar > div { height: 100%; background: var(--vscode-progressBar-background); }
  .bar.time > div { background: var(--vscode-descriptionForeground); opacity: .6; }
  .ahead { color: var(--vscode-errorForeground); }
  .under { color: var(--vscode-testing-iconPassed, var(--vscode-charts-green)); }
  .window { margin-bottom: 10px; }
  .swap { border-left: 3px solid var(--vscode-descriptionForeground); padding: 4px 8px; margin: 4px 0 8px; }
  .swap.soon { border-color: var(--vscode-editorWarning-foreground); }
  .swap.now { border-color: var(--vscode-errorForeground); }
  button { margin-top: 6px; width: 100%; padding: 4px; border: none; border-radius: 2px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font-family: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: .6; cursor: default; }
  .file { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
</style>
</head>
<body><div id="root" class="dim">Waiting for mod data…</div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
}

function activate(context) {
  fs.mkdirSync(STATS, { recursive: true })
  fs.mkdirSync(PACE, { recursive: true })
  fs.mkdirSync(HANDOFF, { recursive: true })

  state = context.globalState
  const provider = new Provider()
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('claudeStats.panel', provider))

  let debounce
  const schedule = () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => provider.push(), 150)
  }
  for (const dir of [STATS, PACE]) {
    const watcher = fs.watch(dir, schedule)
    context.subscriptions.push({ dispose: () => watcher.close() })
  }
  const handoffWatcher = fs.watch(HANDOFF, () => void checkHandoff(provider))
  context.subscriptions.push({ dispose: () => handoffWatcher.close() })
  const timer = setInterval(() => provider.push(), 15000)
  context.subscriptions.push({ dispose: () => clearInterval(timer) })
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(schedule))
}

module.exports = { activate, deactivate() {} }
