import { expect, test } from 'claude-code/testing'

import { advise } from '../hooks/register'

const W = { tokens: 30_000, base: 25_000, lastTurnAt: 0 }
const MIN = 60_000

test('advice stays quiet for a small chat', async () => {
  expect(advise(W, 10, MIN).level).toBe('ok')
})

test('advice says soon once the chat outgrows a fresh one', async () => {
  const a = advise({ ...W, tokens: 120_000 }, 30, 10 * MIN)
  expect(a.level).toBe('soon')
  expect(a.reason).toMatch(/50m/)
})

test('advice says swap when the cache expired on a big chat', async () => {
  expect(advise({ ...W, tokens: 70_000 }, 20, 61 * MIN).level).toBe('swap')
})

test('advice says swap near auto-compact', async () => {
  expect(advise(W, 80, MIN).level).toBe('swap')
})

test('a handoff prompt switches caveman to ultra', async ($, on) => {
  const writes: [string, string][] = []
  on('fs.exists', () => ({ value: true }))
  on('fs.write', (_, e) => {
    writes.push([e.path, e.text])
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)

  await $.prompt.submit({ text: '<handoff from="abc">\nnotes\n</handoff>' } as never)
  expect(writes.some(([path, text]) => path.endsWith('/.caveman-active') && text === 'ultra')).toBe(true)
})

test('a handoff prompt leaves caveman alone when it is not installed', async ($, on) => {
  const writes: [string, string][] = []
  on('fs.exists', () => ({ value: false }))
  on('fs.write', (_, e) => {
    writes.push([e.path, e.text])
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)

  await $.prompt.submit({ text: '<handoff from="abc">\nnotes\n</handoff>' } as never)
  expect(writes.some(([path]) => path.endsWith('/.caveman-active'))).toBe(false)
})

test('/handoff asks haiku and wraps the notes', async ($, on) => {
  const writes: [string, string][] = []
  on('fs.write', (_, e) => {
    writes.push([e.path, e.text])
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: '/home/x/proj' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'build the thing', toolUses: [] }] }))
  on('model.complete', (_, e) => {
    expect(e.model).toBe('haiku')
    expect(e.prompt).toMatch(/build the thing/)
    return { value: { isAnswered: true, text: 'Goal: thing', usage: {} } } as never
  })
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('clock.now', () => ({ value: 1 }))
  on('fs.exists', () => ({ value: true }))

  const { text } = await $.command.run({ command: 'handoff', args: '' } as never)
  expect(text).toMatch(/<handoff from="abc">/)
  expect(text).toMatch(/Caveman ultra/)
  expect(text).toMatch(/-home-x-proj\/abc\.jsonl/)
  expect(writes.some(([path, t]) => path.endsWith('/handoff/abc.json') && t.includes('"ready"'))).toBe(true)
})

test('a toast fires once when advice rises to swap', async ($, on) => {
  const toasts: string[] = []
  on('fs.write', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: '/p' }))
  on('clock.now', () => ({ value: 1 }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))

  const measure = (tokens: number, percent: number) =>
    $.session.measure({ context: { tokens, percent, window: 200_000 }, rateLimits: [], changed: ['context'] } as never)
  await measure(20_000, 10)
  await measure(30_000, 15)
  expect(toasts).toHaveLength(0)
  await measure(180_000, 90)
  await measure(185_000, 92)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/now/)
})
