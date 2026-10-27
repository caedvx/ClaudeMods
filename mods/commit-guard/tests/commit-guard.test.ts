import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const HEREDOC = `git commit -m "$(cat <<'EOF'
fix: thing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"`

const PR = `gh pr create --title t --body "$(cat <<'EOF'
Body text

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"`

async function run($: Engine, on: On, command: string) {
  let seen = ''
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    seen = e.command
    return { deny: 'captured' }
  })
  await $.tool.call({ tool: 'Bash', command })
  return seen
}

test('strips Claude co-author trailer from a heredoc commit', async ($, on) => {
  const seen = await run($, on, HEREDOC)
  expect(seen).not.toContain('Co-Authored-By')
  expect(seen).toContain('fix: thing')
})

test('strips Generated with line from gh pr create', async ($, on) => {
  const seen = await run($, on, PR)
  expect(seen).not.toContain('Generated with')
  expect(seen).toContain('Body text')
})

test('strips --trailer flag naming Claude', async ($, on) => {
  const seen = await run($, on, `git commit -m "x" --trailer "Co-authored-by: Claude <noreply@anthropic.com>"`)
  expect(seen).toBe('git commit -m "x"')
})

test('keeps human co-authors', async ($, on) => {
  const cmd = `git commit -m "x\n\nCo-Authored-By: Alex <alex@example.com>"`
  expect(await run($, on, cmd)).toBe(cmd)
})

test('leaves non-commit commands alone', async ($, on) => {
  const cmd = `echo "Co-Authored-By: Claude"`
  expect(await run($, on, cmd)).toBe(cmd)
})
