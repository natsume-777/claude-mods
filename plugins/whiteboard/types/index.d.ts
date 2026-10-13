// The values whiteboard keeps in $.state for the session. The boards are kept in $.store under
// their own ids (`b:<id>`, `bm:<id>`), and which one a session is attached to under `attach:<sessionId>`,
// so they outlive the app and the session.

/**
 * One card on the board: `id` names it for Claude, `body` is Markdown, `updatedAt` epoch ms. The
 * store's copy of a card may also carry `prev` (its previous version, for undo_card); the state's never does.
 */
export type WhiteboardCard = {
  id: string
  title: string
  body: string
  updatedAt: number
  /** Epoch ms a hand-over of 0.10.0 copied the card in (the stale mark counts from the later of this and `updatedAt`); absent otherwise. */
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

/** One board as the pane's list shows it (hooks/boards.js summarizeBoard). The id is never shown. */
export type WhiteboardBoardRow = {
  /** The board's id: the store keys are `b:<id>` (the cards) and `bm:<id>` (this row's meta); the buttons' keys (`attach-<id>`, `peek-<id>`). */
  id: string
  /** The board's name: Claude gives it, the person may change it. */
  name: string
  /** Epoch ms the board was last written (or made). */
  updatedAt: number
  /** Epoch ms the board was made (or moved from 0.10.0). */
  createdAt: number
  /** The last folder of the session root it was made under; 不明 when not known. */
  cwdName: string
  /** The hash of that root's full path (16 hex digits; the path itself is not kept); null when not known. */
  rootHash: string | null
  /** The cards the board holds. */
  count: number
  /** Every card's title in the pane's order (the pinned first), cut to 60 characters, with its checklist's progress ('' for none). */
  titles: { title: string; pinned: boolean; progress: string }[]
  /** The title (or 「the first request」) of the session that wrote the board last; null when not known. */
  lastTitle: string | null
  /** True for a board moved from a read-only (taken over) board of 0.10.0. */
  old: boolean
}

declare module 'claude-code' {
  interface PluginState {
    whiteboard: {
      /** The cards in the order they were added. Unset until they are loaded from the store. */
      cards: WhiteboardCard[]
      /** The session id the `cards` belong to. The drawings take `cards` only when it is this session's (the process goes on under another id after /clear). */
      owner: string
      /** The board the session `owner` is attached to (`board` its id, null for none; `name` its name, '' for none; `stamp` its meta's time of the last write as last read, 0 for none, so a read at a turn's boundary tells whether another session wrote it). The store keeps the attachment as `attach:<sessionId>`. */
      attached: { owner: string; board: string | null; name: string; stamp: number }
      /** Every board in the store (the list the pane shows), the JSON size of the mod's keys, and a sign of the boards' metas as read (the list is read again when it differs). Never stored. */
      boards: { owner: string; rows: WhiteboardBoardRow[]; bytes: number; sig: string }
      /** The session root as the session `owner` first saw it: its last folder and the hash of its full path (null when empty). Kept for the session's life, so a moved working folder does not move the boards to another project. Never stored. */
      root: { owner: string; name: string; hash: string | null }
      /** What the session `owner` is about: the title the app gives it, and the person's first request (60 characters at most); null when not known. The board's meta keeps it as `lastTitle`. Never stored. */
      about: { owner: string; title: string | null; firstPrompt: string | null }
      /**
       * The pane's own state: the board opened in the list (an id, '' for none), whether the list of the other boards is shown below the cards,
       * which folded groups of the list are shown, whether the board's name is being edited (and the editor's key, moved on at each opening),
       * the person's fold choices on long cards for the session `owner` (by card id: opened or not, and the card's `rev` when chosen; null
       * until the first), the search field's text for the session `owner` (as typed; null when empty), and the count of the
       * field's clears (its key; a new key draws it anew, empty). Never stored.
       */
      view: {
        pick: string
        shown: boolean
        groups?: { others: boolean; old: boolean }
        rename?: boolean
        renameGen?: number
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
