export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-pace': { limits: Limit[]; now: number; readAt: number }
  }
}
