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

/** Another session's board as the pane's list of boards to take over shows it. */
export type WhiteboardOtherBoard = {
  /** The session's id (the store keys are `board:<sid>`, `meta:<sid>` and, once taken over, `seal:<sid>`). */
  sid: string
  /** Its first 8 plain characters: the buttons' keys (`peek-<sid8>`, `take-<sid8>`) and the archive file's name. */
  sid8: string
  /** Epoch ms the board was last written (the meta's, else the newest card's); null when neither is known. */
  updatedAt: number | null
  /** The last folder of the session's working directory; 不明 when the board has no meta. */
  cwdName: string
  /** The cards the board holds. */
  count: number
  /** The first three titles in the pane's order, cut to 60 characters. */
  titles: string[]
  /** Up to 20 titles in the pane's order, for the opened row. */
  allTitles: { title: string; pinned: boolean }[]
  /** How many of the cards are pinned. */
  pinnedCount: number
  /** The first request the person made in that session (60 characters at most); null for a board saved before it was kept. */
  firstPrompt: string | null
  /** The session's title, when the app handed it over; null otherwise. */
  title: string | null
  /** The seal (the `seal:<sid>` value; a 0.9.0 board has it in its meta). Set on a sealed board; such a board is never in the list of boards to take over. */
  handedOver: { to: string; toSid8: string; toCwdName: string; at: number } | null
}

/** A board of the clean-up list (switched off in this version). */
export type WhiteboardCleanupRow = {
  sid: string
  sid8: string
  updatedAt: number | null
  cwdName: string
  count: number
  /** True for a board that was taken over (sealed). */
  sealed: boolean
}

/** Where this session's cards came from, as the meta keeps it. */
export type WhiteboardHandedFrom = {
  sid: string
  sid8: string
  cwdName: string
  updatedAt: number | null
  count: number | null
  /** Epoch ms of the hand-over. */
  at: number
}

/** The confirmation step before a hand-over whose outcome is not plain. */
export type WhiteboardConfirm = {
  /** The board it is about. */
  sid8: string
  /** The cards of both boards when the plan was made; a different one means the plan is old. */
  sig: string
  plan: {
    added: { id: string; title: string; pinned: boolean }[]
    duplicates: { id: string; title: string; pinned: boolean }[]
    overflow: { id: string; title: string; pinned: boolean }[]
  }
  /** True when the plan was made again because the boards had changed. */
  recounted: boolean
}

declare module 'claude-code' {
  interface PluginState {
    whiteboard: {
      /** The cards in the order they were added. Unset until they are loaded from the store. */
      cards: WhiteboardCard[]
      /** The session id the `cards` belong to. The drawings take `cards` only when it is this session's (the process goes on under another id after /clear). */
      owner: string
      /** The other sessions' boards in the store: the boards to take over (the first few, in order), how many more there are, the clean-up list (empty unless it is switched on), the JSON size of all the other keys, and the line about the last action (or ''). Never stored. */
      others: { boards: WhiteboardOtherBoard[]; more: number; cleanup: WhiteboardCleanupRow[]; bytes: number; notice: string }
      /**
       * `sealed`: set when another session took this board over (read-only here).
       * `from`: where this session's cards came from. `last`: the line about the last hand-over
       * or unsealing, until the pane is opened again. Never stored (the meta keeps the first two).
       */
      handover: {
        sealed: { to: string; toSid8: string; toCwdName: string; at: number } | null
        from: WhiteboardHandedFrom | null
        last: { text: string } | null
      }
      /** The pane's own state: the board opened in the list (a short id, '' for none), whether the list is shown over cards, the confirmation step. Never stored. */
      view: { pick: string; shown: boolean; confirm: WhiteboardConfirm | null }
    }
  }
}
