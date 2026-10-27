import { expect, mock, test } from 'claude-code/testing'

import { duration, pace, statusLine } from '../hooks/register'

const NOW = Date.parse('2026-10-25T12:00:00Z')

test('five-hour window 2h in, 60% used is 20 points ahead', () => {
  const p = pace({ kind: 'five_hour', percentUsed: 60, resetsAt: '2026-10-25T15:00:00Z' }, NOW)
  expect(p.elapsed).toBe(40)
  expect(p.ahead).toBe(20)
  expect(p.resetsIn).toBe(3 * 3_600_000)
})

test('seven-day window halfway, 30% used is under pace', () => {
  const p = pace({ kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-29T00:00:00Z' }, NOW)
  expect(p.elapsed).toBe(50)
  expect(p.ahead).toBe(-20)
})

test('unknown window shows usage only', () => {
  const p = pace({ kind: 'spend_limit', percentUsed: 12 }, NOW)
  expect(p.elapsed).toBe(null)
  expect(statusLine([p])).toBe('spend_limit 12%')
})

test('status line marks windows ahead of pace', () => {
  const line = statusLine([
    pace({ kind: 'five_hour', percentUsed: 60, resetsAt: '2026-10-25T15:00:00Z' }, NOW),
    pace({ kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-29T00:00:00Z' }, NOW),
  ])
  expect(line).toBe('5h 60% used vs 40% time (+20) · 7d 30% used vs 50% time')
})

test('durations', () => {
  expect(duration(45 * 60_000)).toBe('45m')
  expect(duration(3 * 3_600_000 + 5 * 60_000)).toBe('3h05')
  expect(duration(50 * 3_600_000)).toBe('2d2h')
})

test('status line tracks the window as time passes', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test' } }))
  on('command.register', () => ({ value: { command: 'usage-pace' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.status', (_$, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: new Date(NOW + 4 * 3_600_000).toISOString() }],
    },
  }))

  await $.session.start({ cwd: '/', surface: null, isInteractive: true })
  expect(statuses.at(-1)).toBe('5h 10% used vs 20% time')

  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 45, resetsAt: new Date(NOW + 4 * 3_600_000).toISOString() }],
    changed: ['rateLimits'],
  })
  expect(statuses.at(-1)).toBe('5h 45% used vs 20% time (+25)')
  expect(toasts).toHaveLength(1)

  await clock.advance(60 * 60_000)
  expect(statuses.at(-1)).toBe('5h 45% used vs 40% time (+5)')
  expect(toasts).toHaveLength(1)
})
