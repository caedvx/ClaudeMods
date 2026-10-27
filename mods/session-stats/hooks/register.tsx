import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Tokens, Window } from '../types'

const PANE = 'session-stats'
const ZERO: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const EDITORS = new Set(['Edit', 'Write', 'NotebookEdit'])

const tools = atom({ plugin: 'session-stats', key: 'tools' } as const, {})
const files = atom({ plugin: 'session-stats', key: 'files' } as const, [])
const tokens = atom({ plugin: 'session-stats', key: 'tokens' } as const, ZERO)
const costUsd = atom({ plugin: 'session-stats', key: 'costUsd' } as const, null)
const context = atom({ plugin: 'session-stats', key: 'context' } as const, null)
const window = atom({ plugin: 'session-stats', key: 'window' } as const, { tokens: null, base: null, lastTurnAt: null })
const handledRequest = atom({ plugin: 'session-stats', key: 'handledRequest' } as const, 0)
const alerted = atom({ plugin: 'session-stats', key: 'alerted' } as const, 'ok')
const RANK = { ok: 0, soon: 1, swap: 2 } as const

const CACHE_TTL = 60 * 60 * 1000
const HANDOFF_MODEL = 'haiku'
const TRANSCRIPT_CAP = 400_000

let poller: { cancel: () => void } | undefined
let ticks = 0
let busy = false

export type Advice = { level: 'ok' | 'soon' | 'swap'; reason: string; extra: number; cacheLeftMs: number | null }

export function advise(w: Window, percent: number | null, now: number): Advice {
  if (w.tokens === null || w.base === null) return { level: 'ok', reason: 'no context reading yet', extra: 0, cacheLeftMs: null }
  const extra = Math.max(0, w.tokens - w.base)
  const left = w.lastTurnAt === null ? null : Math.max(0, CACHE_TTL - (now - w.lastTurnAt))
  const cold = left === 0
  const pct = percent ?? 0

  if (pct >= 75) return { level: 'swap', reason: `context ${pct}% full; auto-compact soon costs a full pass over it`, extra, cacheLeftMs: left }
  if (cold && extra >= 30_000)
    return {
      level: 'swap',
      reason: `cache expired; next turn re-writes ${compact(w.tokens)} at write price, a new chat only ${compact(w.base)}`,
      extra,
      cacheLeftMs: left,
    }
  if (extra >= 150_000) return { level: 'swap', reason: `every turn re-reads ${compact(extra)} a fresh chat would not`, extra, cacheLeftMs: left }
  if (extra >= 80_000 || pct >= 50)
    return {
      level: 'soon',
      reason: `swap at the next task boundary${left ? `, before cache expires in ${Math.round(left / 60000)}m` : ''}`,
      extra,
      cacheLeftMs: left,
    }
  return { level: 'ok', reason: `${compact(extra)} over a fresh chat`, extra, cacheLeftMs: left }
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function claudeDir($: EngineInterface): string {
  return `${$.plugin.root}/../..`
}

function hasCaveman($: EngineInterface): Promise<boolean> {
  return $.fs.exists(`${claudeDir($)}/.caveman-active`).catch(() => false)
}

async function snapshot($: EngineInterface) {
  try {
    await writeSnapshot($)
  } catch {}
}

async function writeSnapshot($: EngineInterface) {
  const [id, cwd, at] = await Promise.all([$.session.id(), $.session.cwd(), $.clock.now()])
  const data = {
    sessionId: id,
    cwd,
    updatedAt: at,
    tools: await read($, tools),
    files: await read($, files),
    tokens: await read($, tokens),
    costUsd: await read($, costUsd),
    context: await read($, context),
    window: await read($, window),
    advice: advise(await read($, window), await read($, context), at),
  }
  await $.fs.write(`${claudeDir($)}/mod-stats/session-stats/${id}.json`, JSON.stringify(data))
  await alert($, data.advice)
}

async function alert($: EngineInterface, advice: Advice) {
  const last = await read($, alerted)
  if (RANK[advice.level] === RANK[last]) return
  await update($, alerted, () => advice.level)
  if (RANK[advice.level] < RANK[last]) return
  const head = advice.level === 'swap' ? 'Swap to a new chat now' : 'Swap to a new chat soon'
  $.ui.toast(`${head}: ${advice.reason}. Run /handoff.`, { timeoutMs: 15_000 })
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function brief(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'notebook_path', 'command', 'pattern', 'url', 'description', 'prompt', 'skill']) {
    if (typeof input[key] === 'string') return clip(String(input[key]).replace(/\s+/g, ' '), 200)
  }
  return ''
}

async function transcript($: EngineInterface): Promise<string> {
  const rows: string[] = []
  for (const m of await $.session.messages()) {
    if (m.role === 'user') {
      if (m.text.trim()) rows.push(`USER: ${clip(m.text, 4000)}`)
      continue
    }
    if (m.text.trim()) rows.push(`ASSISTANT: ${clip(m.text, 3000)}`)
    for (const u of m.toolUses) {
      rows.push(`  ${u.tool} ${brief(u.input)}${u.isError ? ` -> ERROR ${clip(u.text ?? '', 300)}` : ''}`)
    }
  }

  let total = rows.reduce((n, r) => n + r.length + 1, 0)
  if (total <= TRANSCRIPT_CAP) return rows.join('\n')
  const head = rows.filter(r => r.startsWith('USER:')).slice(0, 2)
  const tail: string[] = []
  total = head.reduce((n, r) => n + r.length + 1, 0)
  for (const row of [...rows].reverse()) {
    if (total + row.length >= TRANSCRIPT_CAP) break
    tail.unshift(row)
    total += row.length + 1
  }
  return [...head, '[… middle of transcript dropped …]', ...tail].join('\n')
}

const HANDOFF_SYSTEM =
  'You write handoff notes so a brand-new Claude Code session can continue the work with no other context. ' +
  'Dense and exact: keep file paths, commands, identifiers, versions, error strings, decisions and the user\'s stated preferences verbatim. ' +
  'Drop pleasantries and dead ends unless they warn against something. Terse fragments, no filler.'

const HANDOFF_ASK =
  'Write the handoff for the session above under these headings: Goal, Done, Current state, Decisions & constraints, Files, Next step, Open questions. ' +
  'At most 600 words. Output only the notes.'

async function buildHandoff($: EngineInterface): Promise<{ text: string; method: string }> {
  const [id, cwd] = await Promise.all([$.session.id(), $.session.cwd()])

  let notes: string | undefined
  let method = HANDOFF_MODEL
  const log = await transcript($)
  if (log.trim()) {
    const r = await $.model.complete({
      model: HANDOFF_MODEL,
      system: HANDOFF_SYSTEM,
      prompt: `<transcript>\n${log}\n</transcript>\n\n${HANDOFF_ASK}`,
      maxTokens: 2000,
      effort: 'low',
      timeoutMs: 120_000,
    })
    if (r.isAnswered) notes = r.text.trim()
  }
  if (!notes) {
    method = 'fork'
    const r = await $.model.fork({ prompt: `${HANDOFF_SYSTEM}\n\n${HANDOFF_ASK}` })
    if (!r.isAnswered) throw new Error(`handoff failed: ${r.reason}`)
    notes = r.text.trim()
  }

  const old = `~/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${id}.jsonl`
  const caveman = (await hasCaveman($)) ? 'Caveman ultra. ' : ''
  const text = [
    `<handoff from="${id}">`,
    `Continuing from a previous chat. ${caveman}Old transcript, grep only if notes miss something: ` + old,
    '',
    notes,
    '</handoff>',
  ].join('\n')
  return { text, method }
}

async function runHandoff($: EngineInterface): Promise<string | undefined> {
  if (busy) return undefined
  busy = true
  const id = await $.session.id()
  const out = `${claudeDir($)}/mod-stats/handoff/${id}.json`
  try {
    await $.fs.write(out, JSON.stringify({ status: 'working', at: await $.clock.now() }))
    const { text, method } = await buildHandoff($)
    await $.fs.write(out, JSON.stringify({ status: 'ready', at: await $.clock.now(), method, text }))
    return text
  } catch (err) {
    await $.fs.write(out, JSON.stringify({ status: 'error', at: await $.clock.now(), error: String(err) }))
    throw err
  } finally {
    busy = false
  }
}

async function poll($: EngineInterface) {
  try {
    if (++ticks % 30 === 0) await snapshot($)
    const path = `${claudeDir($)}/mod-stats/handoff/${await $.session.id()}.request`
    if (!(await $.fs.exists(path))) return
    const at = Number(await $.fs.read(path))
    if (!(at > (await read($, handledRequest)))) return
    await update($, handledRequest, () => at)
    await runHandoff($)
  } catch {}
}

function editedPath(e: { tool: string } & Record<string, unknown>): string | undefined {
  if (!EDITORS.has(String(e.tool))) return undefined
  const path = e.file_path ?? e.notebook_path
  return typeof path === 'string' ? path : undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-stats',
      description: 'Show tool calls, files edited and tokens for this session',
    })

    await $.command.register({
      name: 'handoff',
      description: 'Write handoff notes for a new chat and copy them',
    })

    poller?.cancel()
    poller = $.clock.every(2000, () => void poll($))

    await snapshot($)
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async $ => {
    const text = await runHandoff($)
    if (text === undefined) return { text: 'Handoff already running.' }
    const { isCopied } = await $.ui.copy({ text })
    return { text: `${isCopied ? 'Copied to clipboard. ' : ''}Paste into a new chat:\n\n${text}` }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || !e.text.includes('<handoff from="')) return next(e)
    if (!(await hasCaveman($))) return next(e)
    const ultra = () => $.fs.write(`${claudeDir($)}/.caveman-active`, 'ultra').catch(() => {})
    await ultra()
    const sent = await next(e)
    await ultra()
    return sent
  })

  on('command.run', { command: 'session-stats' }, async $ => {
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Session stats' })
    if (isPlaced) return { text: 'Session stats pane opened.' }

    const t = await read($, tokens)
    const counts = await read($, tools)
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    const edited = await read($, files)

    return {
      text: `${total} tool calls, ${edited.length} files edited, ${compact(t.input + t.cacheRead + t.cacheWrite)} in / ${compact(t.output)} out tokens`,
    }
  })

  on('tool.call', async ($, e, next) => {
    await update($, tools, all => ({ ...all, [e.tool]: (all[e.tool] ?? 0) + 1 }))
    const ran = await next(e)

    const path = editedPath(e as { tool: string } & Record<string, unknown>)
    if (path !== undefined && ran.deny === undefined && ran.isError !== true) {
      await update($, files, list => (list.includes(path) ? list : [...list, path]))
    }

    await snapshot($)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, window, w => ({ ...w, lastTurnAt: now }))
    }
    const u = e.usage
    if (u) {
      await update($, tokens, t => ({
        input: t.input + u.input_tokens,
        output: t.output + u.output_tokens,
        cacheRead: t.cacheRead + u.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
      }))
    }

    await snapshot($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.cost) await update($, costUsd, () => e.cost?.usd ?? null)
    if (e.context.percent !== undefined) await update($, context, () => e.context.percent ?? null)
    const fill = e.context.tokens
    if (fill !== undefined && fill > 0) {
      await update($, window, w => ({ ...w, tokens: fill, base: w.base === null ? fill : Math.min(w.base, fill) }))
    }

    await snapshot($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const counts = await read($, tools)
    const edited = await read($, files)
    const t = await read($, tokens)
    const usd = await read($, costUsd)
    const ctx = await read($, context)
    const advice = advise(await read($, window), ctx, await $.clock.now())

    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1])
    const total = ranked.reduce((sum, [, n]) => sum + n, 0)
    const room = Math.max(3, (e.viewport?.rows ?? 24) - 14)

    return (
      <Box flexDirection="column">
        <Text bold>Tokens</Text>
        <Text>  in {compact(t.input)}  cache read {compact(t.cacheRead)}  cache write {compact(t.cacheWrite)}</Text>
        <Text>  out {compact(t.output)}</Text>
        <Text dimColor>
          {'  '}context {ctx === null ? '–' : `${ctx}%`}  cost {usd === null ? '–' : `$${usd.toFixed(2)}`}
        </Text>
        <Text color={advice.level === 'swap' ? 'red' : advice.level === 'soon' ? 'yellow' : undefined}>
          {'  '}swap: {advice.level === 'ok' ? 'not yet' : advice.level === 'soon' ? 'soon' : 'now'} · {advice.reason}
        </Text>
        <Text> </Text>
        <Text bold>Tool calls ({total})</Text>
        {ranked.length === 0 && <Text dimColor>  none yet</Text>}
        {ranked.slice(0, 8).map(([name, n]) => (
          <Text>  {String(n).padStart(4)}  {name}</Text>
        ))}
        <Text> </Text>
        <Text bold>Files edited ({edited.length})</Text>
        {edited.length === 0 && <Text dimColor>  none yet</Text>}
        {edited.slice(-room).map(path => (
          <Text dimColor>  {path.split('/').slice(-2).join('/')}</Text>
        ))}
      </Box>
    )
  })
}
