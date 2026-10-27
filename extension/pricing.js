// $/MTok from platform.claude.com/docs/en/about-claude/pricing, fetched 2026-10-26.
// [input, 5m cache write, 1h cache write, cache read, output]
const RATES = [
  ['claude-fable-5-1', [10, 12.5, 20, 0.25, 50]],
  ['claude-mythos-5-1', [10, 12.5, 20, 0.25, 50]],
  ['claude-fable-5', [10, 12.5, 20, 1, 50]],
  ['claude-mythos-5', [10, 12.5, 20, 1, 50]],
  ['claude-opus-5-5', [4, 5, 8, 0.2, 20]],
  ['claude-opus-5', [5, 6.25, 10, 0.5, 25]],
  ['claude-opus-4-8', [5, 6.25, 10, 0.5, 25]],
  ['claude-opus-4-7', [5, 6.25, 10, 0.5, 25]],
  ['claude-opus-4-6', [5, 6.25, 10, 0.5, 25]],
  ['claude-opus-4-5', [5, 6.25, 10, 0.5, 25]],
  ['claude-opus-4-1', [15, 18.75, 30, 1.5, 75]],
  ['claude-opus-4', [15, 18.75, 30, 1.5, 75]],
  ['claude-sonnet-5-5', [2, 2.5, 4, 0.1, 10]],
  ['claude-sonnet-5', [2, 2.5, 4, 0.2, 10]],
  ['claude-sonnet-4-6', [3, 3.75, 6, 0.3, 15]],
  ['claude-sonnet-4-5', [3, 3.75, 6, 0.3, 15]],
  ['claude-sonnet-4', [3, 3.75, 6, 0.3, 15]],
  ['claude-haiku-5-5', [0.1, 0.125, 0.2, 0.01, 0.5]],
  ['claude-haiku-4-5', [1, 1.25, 2, 0.1, 5]],
  ['claude-3-5-haiku', [0.8, 1, 1.6, 0.08, 4]],
]
const HAIKU_55_LONG = [0.5, 0.625, 1, 0.05, 2.5]
const FAST = 2
const US_ONLY = 1.1

function rates(model) {
  const id = model.replace(/^(us\.|eu\.|global\.)?anthropic\./, '').replace(/\[.*\]$/, '')
  for (const [prefix, r] of RATES) {
    if (id === prefix || id.startsWith(prefix + '-') || id.startsWith(prefix + '@')) return r
  }
  return null
}

function cost(model, u) {
  let r = rates(model)
  if (!r) return null
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const write5m = (u.cache_creation_input_tokens ?? 0) - write1h
  const read = u.cache_read_input_tokens ?? 0
  const input = u.input_tokens ?? 0
  if (r === rates('claude-haiku-5-5') && input + write5m + write1h + read > 100000) r = HAIKU_55_LONG

  let usd = (input * r[0] + write5m * r[1] + write1h * r[2] + read * r[3] + (u.output_tokens ?? 0) * r[4]) / 1e6
  if (u.speed === 'fast') usd *= FAST
  if (u.inference_geo === 'us') usd *= US_ONLY
  return usd
}

module.exports = { cost }
