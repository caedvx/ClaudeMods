import { expect, test } from 'claude-code/testing'

test('counts tool calls and edited files', async ($, on) => {
  on('tool.call', () => ({ result: {} as never }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test' } }))
  await $.tool.call({ tool: 'Read', file_path: '/a/b.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/a/b.ts', old_string: 'x', new_string: 'y' })
  await $.tool.call({ tool: 'Edit', file_path: '/a/b.ts', old_string: 'y', new_string: 'z' })

  const { text } = await $.command.run({ command: 'session-stats', args: '' } as never)
  expect(text).toMatch(/^3 tool calls, 1 files edited/)
})

test('snapshot names the chat and when the user last typed in it', async ($, on) => {
  const writes: [string, string][] = []
  let now = 1000
  on('fs.write', (_, e) => (writes.push([e.path, e.text]), { value: undefined }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: '/a' }))
  on('clock.now', () => ({ value: now }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('tool.call', () => ({ result: {} as never }))

  await $.prompt.submit({ text: '<ide_opened_file>x.md</ide_opened_file>fix the   chat handoff\nplease' } as never)
  now = 5000
  await $.prompt.submit({ text: 'second thing' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/a' })

  const snap = JSON.parse(writes.filter(([p]) => p.endsWith('/session-stats/abc.json')).at(-1)![1])
  expect(snap.title).toBe('fix the chat handoff please')
  expect(snap.activeAt).toBe(5000)
})
