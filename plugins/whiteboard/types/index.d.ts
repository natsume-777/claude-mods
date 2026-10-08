// The values whiteboard keeps in $.state for the session. The cards are also kept in $.store,
// keyed by the session id, so they outlive the app.

/** One card on the board: `id` names it for Claude, `body` is Markdown, `updatedAt` epoch ms. */
export type WhiteboardCard = {
  id: string
  title: string
  body: string
  updatedAt: number
  /** True for a card fixed to the top of the pane; absent otherwise. */
  pinned?: true
}

/** Another session's board as the list of the other sessions' boards shows it. */
export type WhiteboardOtherBoard = {
  /** The session's id (the store keys are `board:<sid>` and `meta:<sid>`). */
  sid: string
  /** Its first 8 plain characters: the buttons' keys (`import-<sid8>`, `drop-<sid8>`) and the archive file's name. */
  sid8: string
  /** Epoch ms the board was last written (the meta's, else the newest card's); null when neither is known. */
  updatedAt: number | null
  /** The last folder of the session's working directory; 不明 when the board has no meta. */
  cwdName: string
  /** The cards the board holds. */
  count: number
  /** The first three titles, cut to 60 characters. */
  titles: string[]
}

declare module 'claude-code' {
  interface PluginState {
    whiteboard: {
      /** The cards in the order they were added. Unset until they are loaded from the store. */
      cards: WhiteboardCard[]
      /** The other sessions' boards in the store: the newest few, how many more there are, the JSON size of all the other keys, and the line about the last action (or ''). Never stored. */
      others: { boards: WhiteboardOtherBoard[]; more: number; bytes: number; notice: string }
    }
  }
}
