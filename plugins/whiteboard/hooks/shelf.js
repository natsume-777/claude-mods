// The boards as register.js finds them in $.store (pure: no $ here).
//
// register.js reads the store's keys and the values under the mod's own (`b:`, `bm:`, `attach:`,
// and any key of 0.10.0 still there); this turns them into the list the pane and list_boards show
// (the `boards` value of $.state: a row per board whose meta is sound) and the store's size.

import { BOARD_PREFIX, META_PREFIX, ATTACH_PREFIX, boardKey, boardOfMetaKey, summarizeBoard } from './boards.js'
import { OLD_PREFIXES } from './migrate.js'

// Every prefix of the mod's keys
const PREFIXES = [BOARD_PREFIX, META_PREFIX, ATTACH_PREFIX, ...OLD_PREFIXES]

/** The `boards` value when nothing is known yet. */
export const NO_BOARDS = { owner: '', rows: [], bytes: 0, sig: '' }

/** Whether two state values are the same (compared as JSON), so a write is made only when the value changed. */
export const isSame = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** The JSON length of a stored value (0 for none). */
export const sizeOf = (value) => (value === undefined ? 0 : JSON.stringify(value).length)

/** Whether a key is one of the mod's own. */
export const isMine = (key) => typeof key === 'string' && PREFIXES.some((p) => key.startsWith(p) && key.length > p.length)

/** Whether a key is a board's meta. */
export const isMetaKey = (key) => boardOfMetaKey(key) !== null

/**
 * A sign of the list from the store's `keys` and a Map of the metas' values (by key): it differs
 * when a board came, went, or was written, renamed or retitled, so the list is read again only then.
 */
export function listSigOf(keys, metas) {
  const parts = []
  for (const key of keys) {
    if (!isMetaKey(key)) continue
    const m = metas.get(key)
    parts.push([key, m?.updatedAt, m?.name, m?.count, m?.lastTitle, m?.old === true])
  }
  return JSON.stringify(parts)
}

/** Whether a key is read for the list: a board's record or its meta (the attachments are not). */
export const isListed = (key) => typeof key === 'string' && (key.startsWith(BOARD_PREFIX) || key.startsWith(META_PREFIX))

/**
 * Every board from the store's `keys` and a Map of their `values` (by key): { rows (boards.js
 * summarizeBoard, in the store's order), bytes: the JSON length of the mod's keys whose values were
 * read, sig: listSigOf of the same metas }.
 */
export function scanBoards(keys, values) {
  const rows = []
  let bytes = 0
  for (const key of keys) {
    if (!isMine(key)) continue
    bytes += sizeOf(values.get(key))
    const id = boardOfMetaKey(key)
    if (id === null) continue
    const row = summarizeBoard(id, values.get(boardKey(id)), values.get(key))
    if (row !== null) rows.push(row)
  }
  return { rows, bytes, sig: listSigOf(keys, values) }
}
