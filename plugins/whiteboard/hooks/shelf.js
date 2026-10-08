// The other sessions' boards as register.js finds them in $.store (pure: no $ here).
//
// register.js reads the store's keys and the values under the `board:` and `meta:` ones; this
// turns them into what the pane holds (the `others` value of $.state: the boards a new session
// may take over, and the clean-up list), and words what the pane says after an action.

import { sessionOfKey, summarizeBoard, candidatesOf, cleanupOf, metaKey, BOARD_PREFIX } from './boards.js'

/** The `others` value when nothing is known yet. */
export const NO_OTHERS = { boards: [], more: 0, cleanup: [], bytes: 0, notice: '' }

/** What the pane says when the board it was drawn from is not there any more. */
export const GONE = 'このボードは、もうありません（消されたか、片付けられました）'
/** What the pane says when a button's board is not in the list the state holds (the list is old). */
export const OLD_LIST = 'この一覧は古くなっています。もう一度開き直してください'
/** What the pane says when the board was taken over by another session in the meantime. */
export const ALREADY = (sealed) => `このボードは、すでに別のセッション（${sealed.toCwdName} · ID ${sealed.toSid8}）に引き継がれています`

/** Whether two state values are the same (compared as JSON), so a write is made only when the value changed. */
export const isSame = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const sizeOf = (value) => (value === undefined ? 0 : JSON.stringify(value).length)

/** Whether a key is one of the mod's own (a board or a meta). */
export const isMine = (key) => typeof key === 'string' && (key.startsWith(BOARD_PREFIX) || key.startsWith('meta:'))

/**
 * Every other session's board from the store's `keys` and a Map of their `values` (by key):
 * { entries: the summaries, bytes: the JSON length of all the other sessions' board and meta keys }.
 * The session `me` is left out; a meta whose board is gone still counts for its size.
 */
export function scanEntries(me, keys, values) {
  const entries = []
  const seen = new Set()
  let bytes = 0
  for (const key of keys) {
    const sid = sessionOfKey(key)
    if (sid === null || sid === me) continue
    seen.add(sid)
    bytes += sizeOf(values.get(key)) + sizeOf(values.get(metaKey(sid)))
    entries.push(summarizeBoard(sid, values.get(key), values.get(metaKey(sid))))
  }
  for (const key of keys) {
    if (typeof key === 'string' && key.startsWith('meta:') && key.slice(5) !== me && !seen.has(key.slice(5))) bytes += sizeOf(values.get(key))
  }
  return { entries, bytes }
}

/**
 * The `others` value for a scan: the boards that may be taken over (the first few, how many more
 * there are), the clean-up list (only with `admin`), the size, and the line about the last action.
 * `handover` false leaves the boards out.
 */
export function othersOf(scanned, { me, cwdName, notice = '', handover = true, admin = false } = {}) {
  const { boards, more } = handover ? candidatesOf(scanned.entries, { me, cwdName }) : { boards: [], more: 0 }
  return { boards, more, cleanup: admin ? cleanupOf(scanned.entries, { me }) : [], bytes: scanned.bytes, notice }
}

/** The line after [消す]. */
export const droppedText = (row, shown) => `消しました: ${row.cwdName}（${row.count} 枚）` + (shown !== '' ? `。${shown} に書き出しました` : '')

/** The line after [消す] when the file could not be written and so nothing was deleted. */
export const keptText = (shown, error) => `書き出せなかったので、消していません（${shown}）: ${error}`
