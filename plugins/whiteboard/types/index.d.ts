// The values whiteboard keeps in $.state for the session. The cards are also kept in $.store,
// keyed by the session id, so they outlive the app.

/**
 * One card on the board: `id` names it for Claude, `body` is Markdown, `updatedAt` epoch ms. The
 * store's copy of a card may also carry `prev` (its previous version, for undo_card); the state's never does.
 */
export type WhiteboardCard = {
  id: string
  title: string
  body: string
  updatedAt: number
  /** Epoch ms a hand-over copied the card in (the stale mark counts from the later of this and `updatedAt`); absent otherwise. */
  arrivedAt?: number
  /** True for a card fixed to the top of the pane; absent otherwise. */
  pinned?: true
  /** The card's style: one of the colour names the tools list (see hooks/style.js); absent for none. */
  style?: 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray' | (string & {})
  /** The board's revision of the card's last change (list_cards' `since`); absent for 0, a card written before revisions existed. */
  rev?: number
}

/** A card changed since the person's latest prompt: new to the board, or changed (the lines added and removed since before the turn's first write to it). */
export type WhiteboardRecentMark = { kind: 'new' } | { kind: 'changed'; added: number; removed: number }

/** Another session's board as the pane's list of boards to take over shows it. */
export type WhiteboardOtherBoard = {
  /** The session's id (the store keys are `board:<sid>`, `meta:<sid>` and, once taken over, `seal:<sid>`). */
  sid: string
  /** Its first 8 plain characters: the buttons' keys (`peek-<sid8>`, `take-<sid8>`). */
  sid8: string
  /** Epoch ms the board was last written (the meta's, else the newest card's); null when neither is known. */
  updatedAt: number | null
  /** The last folder of the session root; 不明 when the board has no meta. */
  cwdName: string
  /** The hash of the session root's full path the meta keeps (16 hex digits; the path itself is not kept); null when it has none. */
  rootHash: string | null
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
    /** The card limit the plan was made with (the setting `maxCards`). */
    limit?: number
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
      /** The other sessions' boards in the store: the boards to take over (the first few, in order), how many more there are, the JSON size of all the other keys, and the line about the last action (or ''). Never stored. */
      others: { boards: WhiteboardOtherBoard[]; more: number; bytes: number; notice: string }
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
      /**
       * The pane's own state: the board opened in the list (a short id, '' for none), whether the list is shown over cards, the confirmation step,
       * and the person's fold choices on long cards for the session `owner` (by card id: opened or not, and the card's `rev` when chosen; null
       * until the first), the search field's text for the session `owner` (as typed; null when empty), and the count of the
       * field's clears (its key; a new key draws it anew, empty). Never stored.
       */
      view: {
        pick: string
        shown: boolean
        confirm: WhiteboardConfirm | null
        folds?: { owner: string; cards: Record<string, { open: boolean; rev: number }> } | null
        filter?: { owner: string; text: string } | null
        searchGen?: number
        /** The cards' order for the session `owner`: the latest write first; null for the order they were added. */
        order?: { owner: string; by: 'updated' } | null
      }
      /** The person's turns: one more on each of their prompts, for the session `owner`. Unset until the first prompt. Never stored. */
      turn: { owner: string; n: number }
      /** The cards the tools changed in the turn `turn` of the session `owner`, by id: new to the board, or changed with the lines added and removed. Shown only while `turn` is the current one. Never stored. */
      recent: { owner: string; turn: number; cards: Record<string, WhiteboardRecentMark> }
    }
  }
}
