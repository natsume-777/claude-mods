// The values token-ledger keeps in $.state for the session. Small summaries that outlive the
// session (handoff records, observed context sizes) go to $.store instead.

/** The five token kinds of one request, the cache writes split by their assumed lifetime. */
export type TokenLedgerTokens = {
  input: number
  cache_read: number
  cache_write_5m: number
  cache_write_1h: number
  output: number
}

/**
 * One model request: `id` is `turnId:index` (live) or the response's message id (read back
 * from a subagent's transcript), `ts` epoch ms, `thread` 'main' or the subagent's agentId.
 */
export type TokenLedgerRequest = {
  id: string
  ts: number
  model: string
  tools: string[]
  tok: TokenLedgerTokens
  thread: string
}

/** What is known of a subagent, by its agentId. */
export type TokenLedgerThread = {
  agentType?: string
  description?: string
  /** True once its requests were replaced by the ones its transcript records. */
  isBackfilled?: boolean
}

/** The pane's views. */
export type TokenLedgerView = 'overview' | 'threads' | 'kinds' | 'costly' | 'gaps' | 'tools' | 'handoff'

/** A handoff this session drafted: 'drafted' once the prompt box holds it, 'done' once a new session reported in. */
export type TokenLedgerHandoff = {
  id: string
  status: 'drafted' | 'done'
  createdAt: number
  file: string
  ctxAtHandoff: number | null
  predictedCtx: number
  /** The new session's context on its first requests, as it stored them. */
  observed: number[]
}

/** The handoff this session was started from: its first requests' context goes back to the store. */
export type TokenLedgerIncoming = {
  id: string
  fromSession: string | null
  ctxAtHandoff: number | null
  predictedCtx: number | null
  observed: number[]
}

declare module 'claude-code' {
  interface PluginState {
    'token-ledger': {
      /** Every request seen since `startedAt`, oldest first, capped. Unset before the first. */
      requests: TokenLedgerRequest[]
      /** Subagents by agentId. */
      threads: Record<string, TokenLedgerThread>
      /** When counting started (the first load in this session), epoch ms. */
      startedAt: number
      /** Unset means 'overview'. */
      view: TokenLedgerView
      /** The row whose details are open, by view; '' or unset means none. */
      open: StateFamily<string>
      /** Unset or null: no handoff drafted here. */
      handoff: TokenLedgerHandoff | null
      /** Unset or null: this session was not started from a handoff. */
      incoming: TokenLedgerIncoming | null
    }
  }
}
