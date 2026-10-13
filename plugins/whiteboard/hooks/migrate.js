// Moving the boards of 0.10.0 and before to the named boards (pure: no $ here; register.js reads
// the store, writes what this plans, reads it back and deletes the old keys).
//
// 0.10.0 kept one board per session: `board:<sessionId>` (the record, or up to 0.9.2 the cards as
// a list), `meta:<sessionId>`, `seal:<sessionId>` (the board was taken over: read-only), and from
// builds in between `rev:<sessionId>` and `removed:<sessionId>`; a 0.9.0 meta held the seal as
// `handedOver`. Each old board with cards becomes one named board:
//   - its id is decided by the old session id (`s-<sessionId>`), so two sessions that start at
//     once and move the same board write the same keys with the same values;
//   - the cards, the revision, the removed cards and each card's previous version go as they are;
//   - the name is the session's title, else its first request, else the title of a pinned card (or
//     the first card), else `<date> のボード`;
//   - the project is the meta's root hash; a meta from before the hash (0.9.1 and before) whose
//     folder name is this session root's is taken as this project, any other as not known;
//   - a board that was read-only (sealed) is an old board: its cards were copied to another;
//   - the session it belonged to is attached to it, so a session open across the update goes on.
// A board with no cards (and the keys left beside none) is not moved: its old keys are deleted.
// One that cannot be read (not a record nor a list, or a list of which no card is sound) is left
// as it is and reported.

import { readBoard, isBoardRecord, boardRecord, orderedCards } from './board.js'
import { clip, isText, NAME_LIMIT, UNKNOWN_FOLDER, stampOf } from './boards.js'

/** The prefixes of the keys of 0.10.0 and before, each followed by a session id. */
export const OLD_PREFIXES = ['board:', 'meta:', 'seal:', 'rev:', 'removed:']

/** The old keys of the session `sid`, by kind. */
export const oldKeysOf = (sid) => ({ board: 'board:' + sid, meta: 'meta:' + sid, seal: 'seal:' + sid, rev: 'rev:' + sid, removed: 'removed:' + sid })

/** The id of the board moved from the session `sid`. */
export const movedBoardId = (sid) => 's-' + sid

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)

/** The session ids that have an old key, in the order their first key comes. */
export function oldSessionsOf(keys) {
  const out = []
  for (const key of keys) {
    if (typeof key !== 'string') continue
    const prefix = OLD_PREFIXES.find((p) => key.startsWith(p) && key.length > p.length)
    if (prefix === undefined) continue
    const sid = key.slice(prefix.length)
    if (!out.includes(sid)) out.push(sid)
  }
  return out
}

/** The name of a moved board: the title, the first request, a pinned or the first card's title, `<date> のボード`. */
export function movedName(meta, cards, updatedAt) {
  const first = orderedCards(cards)[0]
  for (const candidate of [meta?.title, meta?.firstPrompt, first?.title]) {
    const name = clip(candidate, NAME_LIMIT)
    if (name !== '') return name
  }
  return `${stampOf(updatedAt).slice(0, 5)} のボード`
}

/**
 * What to do with the old keys of the session `sid`. `values` holds what the store has under each
 * of oldKeysOf(sid) (undefined for none); `root` this session's { name, hash }; `now` the time.
 *   { kind: 'move', id, record, meta, attach }  write b:<id> (record; null for none), bm:<id> (meta),
 *                                               attach:<sid> (attach), then delete the old keys
 *   { kind: 'drop' }                            nothing to move: delete the old keys
 *   { kind: 'broken', reason }                  leave the old keys as they are
 */
export function planMove(sid, values, root, now) {
  const raw = values.board
  if (raw !== undefined && !isBoardRecord(raw) && !Array.isArray(raw)) return { kind: 'broken', reason: '形が読めません' }
  const board = readBoard(raw, isBoardRecord(raw) ? {} : { rev: values.rev, removed: values.removed })
  const rawCards = isBoardRecord(raw) ? raw.cards : Array.isArray(raw) ? raw : []
  if (board.cards.length === 0 && rawCards.length > 0) return { kind: 'broken', reason: '読めるカードがありません' }
  if (board.cards.length === 0) return { kind: 'drop' }
  const meta = values.meta != null && typeof values.meta === 'object' && !Array.isArray(values.meta) ? values.meta : null
  const newest = board.cards.reduce((m, c) => Math.max(m, c.updatedAt), -Infinity)
  const updatedAt = isNum(meta?.updatedAt) ? meta.updatedAt : Number.isFinite(newest) ? newest : now
  const cwdName = isText(meta?.cwdName) ? meta.cwdName : UNKNOWN_FOLDER
  const rootHash = typeof meta?.rootHash === 'string' && /^[0-9a-f]{16}$/.test(meta.rootHash) ? meta.rootHash : meta !== null && cwdName === root.name ? root.hash : null
  const sealed = (values.seal != null && typeof values.seal === 'object') || (meta?.handedOver != null && typeof meta.handedOver === 'object')
  const lastTitle = isText(meta?.title) ? clip(meta.title) : isText(meta?.firstPrompt) ? `「${clip(meta.firstPrompt)}」` : null
  return {
    kind: 'move',
    id: movedBoardId(sid),
    record: boardRecord(board),
    meta: {
      name: movedName(meta, board.cards, updatedAt),
      ...(rootHash !== null ? { rootHash } : {}),
      cwdName,
      createdAt: updatedAt,
      updatedAt,
      count: board.cards.length,
      ...(lastTitle !== null ? { lastTitle, lastSid: sid } : {}),
      ...(sealed ? { old: true } : {}),
    },
    attach: { board: movedBoardId(sid), at: now },
  }
}
