// The values whiteboard keeps in $.state for the session. The cards are also kept in $.store,
// keyed by the session id, so they outlive the app; the subagents are not.

/** One card on the board: `id` names it for Claude, `body` is Markdown, `updatedAt` epoch ms. */
export type WhiteboardCard = {
  id: string
  title: string
  body: string
  updatedAt: number
}

/** One subagent in the pane's 並行処理 section. The text is shown as it came. */
export type WhiteboardAgent = {
  /** The agent's id, `$.agent.list()`'s and the classic events' `agent_id`. */
  id: string
  /** The agent type (`Explore`, `general-purpose`, ...); '' when none was told. */
  type: string
  /** The Agent call's own description; '' when `$.agent.list()` did not give it. */
  description: string
  status: 'running' | 'done'
  /** Epoch ms of the start (of the stop, when a start was missed). */
  startedAt: number
  /** Epoch ms of the stop; only when `status` is `done`. */
  endedAt?: number
  /** The first line of its last message, cut short; only when done and it said something. */
  summary?: string
}

declare module 'claude-code' {
  interface PluginState {
    whiteboard: {
      /** The cards in the order they were added. Unset until they are loaded from the store. */
      cards: WhiteboardCard[]
      /** The running subagents and the last few finished ones, in the order they started. Never stored. */
      agents: WhiteboardAgent[]
    }
  }
}
