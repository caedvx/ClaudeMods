const vscode = acquireVsCodeApi()
const root = document.getElementById('root')

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function compact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}

function money(n) {
  return '$' + (n >= 100 ? n.toFixed(0) : n.toFixed(2))
}

function duration(ms) {
  const m = Math.round(ms / 60000)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h' + String(m % 60).padStart(2, '0')
  return Math.floor(h / 24) + 'd' + (h % 24) + 'h'
}

function ago(ms) {
  if (ms < 60000) return 'just now'
  return duration(ms) + ' ago'
}

const row = (a, b, cls = '') => `<div class="row ${cls}"><span>${a}</span><span>${b}</span></div>`
const bar = (pct, cls = '') => `<div class="bar ${cls}"><div style="width:${Math.min(100, Math.max(0, pct))}%"></div></div>`

function usage(pace, now) {
  if (!pace || pace.paces.length === 0) return '<h2>Usage pace</h2><div class="dim">No rate-limit reading yet.</div>'
  const age = now - pace.updatedAt
  return (
    '<h2>Usage pace</h2>' +
    pace.paces
      .map(p => {
        const left = p.resetsIn === null ? null : Math.max(0, p.resetsIn - age)
        let out = `<div class="window">${row(`<b>${esc(p.label)}</b>`, left === null ? '' : `<span class="dim">resets in ${duration(left)}</span>`)}`
        out += row('used', p.used + '%') + bar(p.used)
        if (p.elapsed !== null) out += row('<span class="dim">time</span>', `<span class="dim">${p.elapsed}%</span>`) + bar(p.elapsed, 'time')
        if (p.ahead !== null)
          out += p.ahead > 0 ? `<div class="ahead">${p.ahead} points ahead of pace</div>` : `<div class="under">${-p.ahead} points under pace</div>`
        return out + '</div>'
      })
      .join('')
  )
}

function local(l) {
  if (!l) return ''
  let out = `<h2>All sessions · local</h2><div class="dim">${l.active} active in last 10m</div>`
  for (const w of l.windows) {
    const total = w.input + w.output + w.cacheRead + w.cacheWrite
    const usd = w.unpriced > 0 ? `${money(w.usd)}+` : money(w.usd)
    out += `<div class="window">${row(`<b>${w.label}</b>`, `<b>${usd}</b>`)}`
    out += row('<span class="dim">tokens</span>', `<span class="dim">${compact(total)}</span>`)
    out += row('<span class="dim">out · cache read</span>', `<span class="dim">${compact(w.output)} · ${compact(w.cacheRead)}</span>`)
    out += row('<span class="dim">requests · sessions</span>', `<span class="dim">${w.requests} · ${w.sessions}</span>`)
    out += '</div>'
  }
  if (l.models.length > 0) {
    out += '<div class="dim">7d by model</div>'
    out += l.models.slice(0, 5).map(([name, m]) => row(esc(name.replace(/^claude-/, '')), `${money(m.usd)} · ${compact(m.tokens)}`)).join('')
    out += '<div class="dim" style="margin-top:6px">API list prices; subscription usage is not billed this way.</div>'
  }
  return out
}

function swap(s, handoff, now) {
  const a = s.advice
  if (!a) return ''
  const age = now - s.updatedAt
  const left = a.cacheLeftMs === null ? null : Math.max(0, a.cacheLeftMs - age)
  const cls = a.level === 'swap' ? 'now' : a.level
  const label = a.level === 'swap' ? 'Swap now' : a.level === 'soon' ? 'Swap soon' : 'Keep going'
  let out = `<h2>New chat?</h2><div class="swap ${cls}"><b>${label}</b><div class="dim">${esc(a.reason)}</div>`
  out += row('<span class="dim">re-read per turn vs fresh</span>', `<span class="dim">${compact(a.extra)}</span>`)
  if (left !== null) out += row('<span class="dim">prompt cache</span>', `<span class="dim">${left === 0 ? 'expired' : duration(left) + ' left'}</span>`)
  out += `<button id="handoff" data-session="${esc(s.sessionId)}"${handoff ? ' disabled' : ''}>${handoff ? 'Writing handoff…' : 'Hand off to new chat'}</button>`
  return out + '</div>'
}

function session(s) {
  if (!s) return '<h2>Session</h2><div class="dim">No session data yet.</div>'
  const t = s.tokens
  const ranked = Object.entries(s.tools).sort((a, b) => b[1] - a[1])
  const total = ranked.reduce((sum, [, n]) => sum + n, 0)
  let out = '<h2>Tokens</h2>'
  out += row('in', compact(t.input))
  out += row('cache read', compact(t.cacheRead))
  out += row('cache write', compact(t.cacheWrite))
  out += row('out', compact(t.output))
  out += row('context', s.context === null ? '–' : s.context + '%', 'dim')
  out += row('cost', s.costUsd === null ? '–' : '$' + s.costUsd.toFixed(2), 'dim')
  out += `<h2>Tool calls (${total})</h2>`
  out += ranked.length === 0 ? '<div class="dim">none yet</div>' : ranked.slice(0, 10).map(([name, n]) => row(esc(name), n)).join('')
  out += `<h2>Files edited (${s.files.length})</h2>`
  out +=
    s.files.length === 0
      ? '<div class="dim">none yet</div>'
      : s.files
          .slice(-15)
          .reverse()
          .map(f => `<div class="file dim" title="${esc(f)}">&lrm;${esc(f.split('/').slice(-3).join('/'))}</div>`)
          .join('')
  return out
}

function picker(s, sessions, now) {
  if (!s) return ''
  if (sessions.length < 2) return `<div class="dim chat" title="${esc(s.sessionId)}">${esc(s.title || s.sessionId.slice(0, 8))}</div>`
  const opts = sessions
    .map(c => {
      const when = c.activeAt ? ago(now - c.activeAt) : 'no prompt yet'
      return `<option value="${esc(c.sessionId)}"${c.sessionId === s.sessionId ? ' selected' : ''}>${esc(c.title)} · ${when}</option>`
    })
    .join('')
  return `<select id="chat" title="Which chat this panel and its handoff follow">${opts}</select>`
}

window.addEventListener('message', ({ data }) => {
  const { session: s, sessions = [], pace, local: l, handoff, now } = data
  if (document.activeElement?.id === 'chat') return
  const head = s ? `<div class="dim">${esc(s.cwd.split('/').pop())} · ${ago(now - s.updatedAt)}</div>` : ''
  root.className = ''
  root.innerHTML = picker(s, sessions, now) + (s ? swap(s, handoff, now) : '') + usage(pace, now) + local(l) + '<h2>This chat</h2>' + head + session(s)
})

root.addEventListener('change', e => {
  if (e.target.id !== 'chat') return
  e.target.blur()
  vscode.postMessage({ type: 'pick', sessionId: e.target.value })
})

root.addEventListener('click', e => {
  const b = e.target.closest('#handoff')
  if (b && !b.disabled) vscode.postMessage({ type: 'handoff', sessionId: b.dataset.session })
})

vscode.postMessage('ready')
