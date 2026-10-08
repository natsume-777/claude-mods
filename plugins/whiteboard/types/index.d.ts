// The value whiteboard keeps in $.state for the session. The same cards are kept in $.store,
// keyed by the session id, so they outlive the app.

/** One card on the board: `id` names it for Claude, `body` is Markdown, `updatedAt` epoch ms. */
export type WhiteboardCard = {
  id: string
  title: string
  body: string
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    whiteboard: {
      /** The cards in the order they were added. Unset until they are loaded from the store. */
      cards: WhiteboardCard[]
    }
  }
}
