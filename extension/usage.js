const fs = require('fs')
const os = require('os')
const path = require('path')
const { cost } = require('./pricing')

const PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const WEEK = 7 * 24 * 3600 * 1000

const offsets = new Map()
const messages = new Map()

function walk(dir, out) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

function ingest(line) {
  if (!line.includes('"usage"')) return
  let d
  try {
    d = JSON.parse(line)
  } catch {
    return
  }
  const m = d.message
  const u = m?.usage
  if (!u || !d.timestamp || m.model === '<synthetic>') return
  const t = Date.parse(d.timestamp)
  if (Date.now() - t > WEEK) return
  messages.set(`${m.id}:${d.requestId}`, {
    t,
    session: d.sessionId,
    model: m.model,
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    usd: cost(m.model, u),
  })
}

function scan() {
  const cutoff = Date.now() - WEEK
  for (const file of walk(PROJECTS, [])) {
    let stat
    try {
      stat = fs.statSync(file)
    } catch {
      continue
    }
    if (stat.mtimeMs < cutoff) continue
    let from = offsets.get(file) ?? 0
    if (stat.size < from) from = 0
    if (stat.size === from) continue

    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(stat.size - from)
      fs.readSync(fd, buf, 0, buf.length, from)
      const end = buf.lastIndexOf(0x0a)
      if (end < 0) continue
      for (const line of buf.subarray(0, end).toString('utf8').split('\n')) ingest(line)
      offsets.set(file, from + end + 1)
    } finally {
      fs.closeSync(fd)
    }
  }
  for (const [k, v] of messages) if (v.t < cutoff) messages.delete(k)
}

function totals(since) {
  const sum = { usd: 0, unpriced: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, sessions: new Set() }
  for (const m of messages.values()) {
    if (m.t < since) continue
    sum.input += m.input
    sum.output += m.output
    sum.cacheRead += m.cacheRead
    sum.cacheWrite += m.cacheWrite
    sum.requests++
    if (m.usd === null) sum.unpriced++
    else sum.usd += m.usd
    sum.sessions.add(m.session)
  }
  return { ...sum, sessions: sum.sessions.size }
}

function localUsage() {
  scan()
  const now = Date.now()
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)

  const models = {}
  for (const m of messages.values()) {
    const row = (models[m.model] ??= { tokens: 0, usd: 0 })
    row.tokens += m.input + m.output + m.cacheRead + m.cacheWrite
    row.usd += m.usd ?? 0
  }

  return {
    windows: [
      { label: '5h', ...totals(now - 5 * 3600 * 1000) },
      { label: 'today', ...totals(midnight.getTime()) },
      { label: '7d', ...totals(now - WEEK) },
    ],
    active: totals(now - 10 * 60 * 1000).sessions,
    models: Object.entries(models).sort((a, b) => b[1].usd - a[1].usd || b[1].tokens - a[1].tokens),
  }
}

module.exports = { localUsage }
