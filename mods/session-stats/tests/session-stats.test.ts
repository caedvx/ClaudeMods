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
