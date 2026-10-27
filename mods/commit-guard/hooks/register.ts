import type { Register } from 'claude-code'

const TARGET = /\bgit\b[^\n]*\bcommit\b|\bgh\s+pr\s+(create|edit)\b/
const AI = /claude|anthropic/i

const TRAILER_LINE = /^[ \t]*co-authored-by:[^\n]*$\n?/gim
const GENERATED_LINE = /^[^\n]*generated with[^\n]*claude[^\n]*$\n?/gim
const TRAILER_FLAG = /\s--trailer[ =](["'])co-authored-by:[^"'\n]*\1/gi

export function scrub(command: string): string {
  if (!TARGET.test(command)) return command

  return command
    .replace(TRAILER_LINE, line => (AI.test(line) ? '' : line))
    .replace(GENERATED_LINE, '')
    .replace(TRAILER_FLAG, flag => (AI.test(flag) ? '' : flag))
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const command = scrub(e.command)
    if (command === e.command) return next(e)

    $.ui.toast('commit-guard: stripped AI attribution')

    return next({ ...e, command })
  }).catch(($, e, next) =>
    next.called || !TARGET.test(e.command)
      ? next(e)
      : { deny: 'commit-guard failed; commit not run.' },
  )
}
