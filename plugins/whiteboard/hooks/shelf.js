// The other sessions' boards as register.js finds them in $.store (pure: no $ here).
//
// register.js reads the store's keys and the values under the mod's own (`board:`, `meta:`, `seal:`,
// and the `rev:` and `removed:` an older build kept beside a board); this turns them into what the
// pane holds (the `others` value of $.state: the boards a new session may take over), and words
// what the pane says after an action.

import { sessionOfKey, summarizeBoard, candidatesOf, metaKey, sealKey, BOARD_PREFIX, META_PREFIX, SEAL_PREFIX } from './boards.js'
import { LEGACY_PREFIXES, BOARD_NAME } from './board.js'

// Every prefix of the mod's keys, each followed by a session id
const PREFIXES = [BOARD_PREFIX, META_PREFIX, SEAL_PREFIX, ...LEGACY_PREFIXES]

/** The `others` value when nothing is known yet. */
export const NO_OTHERS = { boards: [], more: 0, bytes: 0, notice: '' }

/** What the pane says when the board it was drawn from is not there any more. */
export const goneText = () => `この${BOARD_NAME}は、もうありません（消されたか、片付けられました）`
/** What the pane says when a button's board is not in the list the state holds (the list is old). */
export const OLD_LIST = 'この一覧は古くなっています。もう一度開き直してください'
/** What the pane says when the board was taken over by another session in the meantime. */
export const ALREADY = (sealed) => `この${BOARD_NAME}は、すでに別のセッション（${sealed.toCwdName} · ID ${sealed.toSid8}）に引き継がれています`
/** What the pane says when the board was taken over by this session already (the list is old). */
export const alreadyMineText = () => `この${BOARD_NAME}は、すでにこのセッションに引き継いであります`

/** Whether two state values are the same (compared as JSON), so a write is made only when the value changed. */
export const isSame = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** The JSON length of a stored value (0 for none). */
export const sizeOf = (value) => (value === undefined ? 0 : JSON.stringify(value).length)

// The session id of one of the mod's keys, or null for any other key
const ownerOfKey = (key) => {
  if (typeof key !== 'string') return null
  const prefix = PREFIXES.find((p) => key.startsWith(p) && key.length > p.length)
  return prefix === undefined ? null : key.slice(prefix.length)
}

/** Whether a key is one of the mod's own (a board, a meta, a seal, or a key an older build kept beside a board). */
export const isMine = (key) => ownerOfKey(key) !== null

/**
 * Every other session's board from the store's `keys` and a Map of their `values` (by key):
 * { entries: the summaries, bytes: the JSON length of all the other sessions' keys of the mod }.
 * The session `me` is left out; a key whose board is gone still counts for its size.
 */
export function scanEntries(me, keys, values) {
  const entries = []
  let bytes = 0
  for (const key of keys) {
    const owner = ownerOfKey(key)
    if (owner === null || owner === me) continue
    bytes += sizeOf(values.get(key))
    const sid = sessionOfKey(key)
    if (sid !== null) entries.push(summarizeBoard(sid, values.get(key), values.get(metaKey(sid)), values.get(sealKey(sid))))
  }
  return { entries, bytes }
}

/**
 * The `others` value for a scan: the boards that may be taken over (the first few, how many more
 * there are), the size, and the line about the last action. `handover` false leaves the boards out.
 */
export function othersOf(scanned, { me, cwdName, notice = '', handover = true } = {}) {
  const { boards, more } = handover ? candidatesOf(scanned.entries, { me, cwdName }) : { boards: [], more: 0 }
  return { boards, more, bytes: scanned.bytes, notice }
}
