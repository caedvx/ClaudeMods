import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit } from '../types'

const PANE = 'usage-pace'
const HOUR = 3_600_000
const WINDOWS: Record<string, { label: string; ms: number }> = {
  five_hour: { label: '5h', ms: 5 * HOUR },
  seven_day: { label: '7d', ms: 7 * 24 * HOUR },
}
const WARN_POINTS = 10

const limits = atom({ plugin: 'usage-pace', key: 'limits' } as const, [])
const now = atom({ plugin: 'usage-pace', key: 'now' } as const, 0)
const readAt = atom({ plugin: 'usage-pace', key: 'readAt' } as const, 0)

export type Pace = {
  label: string
  used: number
  elapsed: number | null
  ahead: number | null
  resetsIn: number | null
}

export function pace(limit: Limit, at: number): Pace {
  const window = WINDOWS[limit.kind]
  const label = window?.label ?? limit.kind
  const resetsAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
  if (!window || Number.isNaN(resetsAt)) {
    return { label, used: limit.percentUsed, elapsed: null, ahead: null, resetsIn: null }
  }

  const left = Math.max(0, resetsAt - at)
  const elapsed = Math.round(Math.min(100, Math.max(0, (1 - left / window.ms) * 100)))

  return {
    label,
    used: limit.percentUsed,
    elapsed,
    ahead: Math.round(limit.percentUsed - elapsed),
    resetsIn: left,
  }
}

export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, '0')}`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

export function statusLine(paces: Pace[]): string | undefined {
  if (paces.length === 0) return undefined

  return paces
    .map(p => {
      if (p.elapsed === null) return `${p.label} ${p.used}%`
      const mark = p.ahead !== null && p.ahead > 0 ? ` (+${p.ahead})` : ''
      return `${p.label} ${p.used}% used vs ${p.elapsed}% time${mark}`
    })
    .join(' · ')
}

const warned = new Set<string>()

async function refresh($: EngineInterface, next?: Limit[], fromApi = false) {
  const at = await $.clock.now()
  const current = next ?? (await read($, limits))
  if (next) await update($, limits, () => next)
  if (fromApi) await update($, readAt, () => at)
  await update($, now, () => at)

  const paces = current.map(l => pace(l, at))
  $.ui.status(statusLine(paces))

  try {
    const id = await $.session.id()
    await $.fs.write(`${$.plugin.root}/../../mod-stats/usage-pace/${id}.json`, JSON.stringify({ sessionId: id, updatedAt: at, readAt: await read($, readAt), paces }))
  } catch {}

  for (const [i, p] of paces.entries()) {
    const key = `${current[i]?.kind}@${current[i]?.resetsAt}`
    if (p.ahead !== null && p.ahead >= WARN_POINTS && !warned.has(key)) {
      warned.add(key)
      $.ui.toast(`${p.label} usage ${p.ahead} points ahead of pace (${p.used}% used, ${p.elapsed}% of window gone)`)
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-pace',
      description: 'Compare rate-limit usage with time elapsed until each reset',
    })

    const { rateLimits } = await $.session.usage()
    await refresh($, rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })))
    $.clock.every(60_000, () => void refresh($))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await refresh($, e.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })), true)
    }

    return next(e)
  })

  on('command.run', { command: 'usage-pace' }, async $ => {
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Usage pace' })
    if (isPlaced) return { text: 'Usage pace pane opened.' }

    const at = await $.clock.now()
    const paces = (await read($, limits)).map(l => pace(l, at))

    return { text: statusLine(paces) ?? 'No rate-limit reading yet (subscription only, after the first response).' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const at = await read($, now)
    const paces = (await read($, limits)).map(l => pace(l, at))
    const width = Math.max(10, Math.min(40, (e.props.bodyColumns ?? 40) - 14))

    const bar = (pct: number) => {
      const filled = Math.round((Math.min(100, pct) / 100) * width)
      return '█'.repeat(filled) + '░'.repeat(width - filled)
    }

    if (paces.length === 0) {
      return <Text dimColor>No rate-limit reading yet.</Text>
    }

    return (
      <Box flexDirection="column">
        {paces.map(p => (
          <Box flexDirection="column">
            <Text bold>
              {p.label}
              {p.resetsIn !== null && <Text dimColor>  resets in {duration(p.resetsIn)}</Text>}
            </Text>
            <Text>
              usage {bar(p.used)} {p.used}%
            </Text>
            {p.elapsed !== null && (
              <Text dimColor>
                time  {bar(p.elapsed)} {p.elapsed}%
              </Text>
            )}
            {p.ahead !== null && (
              <Text color={p.ahead > 0 ? 'red' : 'green'}>
                {p.ahead > 0 ? `${p.ahead} points ahead of pace` : `${-p.ahead} points under pace`}
              </Text>
            )}
            <Text> </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
