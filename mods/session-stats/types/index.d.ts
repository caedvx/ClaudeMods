export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Window = { tokens: number | null; base: number | null; lastTurnAt: number | null }

declare module 'claude-code' {
  interface PluginState {
    'session-stats': {
      tools: Record<string, number>
      files: string[]
      tokens: Tokens
      costUsd: number | null
      context: number | null
      window: Window
      handledRequest: number
      alerted: 'ok' | 'soon' | 'swap'
      title: string
      activeAt: number
    }
  }
}
