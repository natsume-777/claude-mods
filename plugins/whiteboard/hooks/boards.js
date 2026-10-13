// The named boards in $.store and which one a session is attached to (pure: no $ here, register.js
// keeps the calls).
//
// A board belongs to no session. It is two keys, under its own id (made when it is created, or
// `s-<sessionId>` for a board moved from 0.10.0, migrate.js):
//   b:<boardId>    the cards, with the board's revision and the cards removed lately (board.js);
//                  absent while there is nothing to keep
//   bm:<boardId>   { name, rootHash?, cwdName, createdAt, updatedAt, count, lastTitle?, lastSid?, old? }
//                  the board's name (Claude gives it, the person may change it), a hash of the
//                  session root's full path it was made under (rootHashOf; the path itself is not
//                  kept) with that root's last folder, when it was made and last written, its card
//                  count, the title of the session that wrote it last (with that session's id,
//                  `lastSid`, so a title the app gives that session later replaces its own title
//                  only), and `old` for a board moved from a read-only 0.10.0 board. A board is listed when its meta is there.
// A session's attachment is `attach:<sessionId>` ({ board, at }): the same session opened again is
// still attached. A new session is attached to nothing. Several sessions may be attached to one board.
//
// The prefixes differ from 0.10.0's (`board:`, `meta:`, `seal:`), so an old key is never read as a new one.

import { BOARD_NAME, boardCardsOf, orderedCards, clockOf, taskProgress } from './board.js'

// The engine clips a long text and appends this marker
const CLIP_MARKER = /\.\.\. \[\+\d+ chars\]\s*$/

/** One line of a text: blanks folded, the engine's "... [+N chars]" marker made …, cut to `max` characters with a trailing …. */
export function clip(value, max = 60) {
  const line = (typeof value === 'string' ? value : '').replace(CLIP_MARKER, '…').replace(/\s+/g, ' ').trim()
  const chars = [...line]
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : line
}

/** What a list row shows and keeps at most. */
export const LIST_LIMITS = {
  /** The titles a closed row shows. */
  titles: 3,
  /** The characters of a title, of a session's title or first request. */
  title: 60,
}

/** The most characters of a board's name. */
export const NAME_LIMIT = 40

/** The word for a folder that is not known. */
export const UNKNOWN_FOLDER = '不明'

const DAY_MS = 24 * 60 * 60 * 1000
const MIB = 1024 * 1024

/** The store holds 4 MiB in all; the pane warns from half of it. */
export const WARN_BYTES = 2 * MIB
const STORE_MIB = 4

// ---- The keys

export const BOARD_PREFIX = 'b:'
export const META_PREFIX = 'bm:'
export const ATTACH_PREFIX = 'attach:'
export const boardKey = (boardId) => BOARD_PREFIX + boardId
export const metaKey = (boardId) => META_PREFIX + boardId
export const attachKey = (sessionId) => ATTACH_PREFIX + sessionId

/** The board id of a `bm:` key, or null for any other key. */
export const boardOfMetaKey = (key) => (typeof key === 'string' && key.startsWith(META_PREFIX) && key.length > META_PREFIX.length ? key.slice(META_PREFIX.length) : null)

/** A new board's id from the time and a random number in [0, 1): `n-<time>-<random>`, plain characters only. */
export const newBoardId = (now, random) => 'n-' + Math.max(0, Math.floor(now)).toString(36) + '-' + Math.floor(random * 36 ** 6).toString(36).padStart(6, '0')

// ---- The root

/** The last folder of a path, nothing above it; UNKNOWN_FOLDER when there is none. */
export function cwdNameOf(path) {
  const parts = String(path ?? '')
    .split(/[\\/]+/)
    .filter((p) => p !== '')
  return parts.at(-1) ?? UNKNOWN_FOLDER
}

/**
 * A session root's full path as it is hashed: separators made `/` and folded, no trailing one;
 * a path with a drive letter (Windows, which does not tell cases apart) lower-cased. '' for none.
 */
export function rootKeyOf(path) {
  const p = String(path ?? '')
    .trim()
    .replace(/[\\/]+/g, '/')
  const key = p.length > 1 ? p.replace(/\/$/, '') : p
  return /^[A-Za-z]:/.test(key) ? key.toLowerCase() : key
}

/**
 * The meta's `rootHash`: FNV-1a (64 bits) of rootKeyOf's UTF-8 bytes, 16 hex digits, so boards of
 * one project match without the path being kept; null when the path is empty.
 */
export function rootHashOf(path) {
  const key = rootKeyOf(path)
  if (key === '') return null
  let h = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(key)) {
    h ^= BigInt(byte)
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h.toString(16).padStart(16, '0')
}

/** The root a session keeps for its whole life (register.js fixes it at the first look): { name, hash }. */
export const rootOf = (path) => ({ name: cwdNameOf(path), hash: rootHashOf(path) })

const ROOT_HASH = /^[0-9a-f]{16}$/

// ---- The values

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)
export const isText = (s) => typeof s === 'string' && s !== ''

/** A request or a title cut to the length the meta keeps: blanks and line breaks as one blank, `…` at the cut. */
export const promptLine = (text, max = LIST_LIMITS.title) => clip(text, max)

/** A board's name as given (by Claude or the person): { name } (blanks folded, trimmed) or { error } (read by whoever gave it). */
export function nameOf(value) {
  if (typeof value !== 'string') return { error: 'name は文字列で指定してください' }
  const name = value.replace(/\s+/g, ' ').trim()
  if (name === '') return { error: 'name が空です。ボードの名前を指定してください（例: whiteboard 開発）' }
  if ([...name].length > NAME_LIMIT) return { error: `name は ${NAME_LIMIT} 文字までです（受け取ったのは ${[...name].length} 文字）。短くしてください` }
  return { name }
}

/** A name as names are compared: width and case folded. */
export const nameKey = (name) => String(name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * A stored `bm:` value when it is sound, else null: { name, updatedAt, createdAt, count, cwdName,
 * rootHash (null when it has none), lastTitle (null), lastSid (null), old }. A field it does not know, or one of the
 * wrong type, is let go.
 */
export function readMeta(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  if (!isText(value.name) || !isNum(value.updatedAt)) return null
  return {
    name: value.name,
    updatedAt: value.updatedAt,
    createdAt: isNum(value.createdAt) ? value.createdAt : value.updatedAt,
    count: Number.isSafeInteger(value.count) && value.count >= 0 ? value.count : 0,
    cwdName: isText(value.cwdName) ? value.cwdName : UNKNOWN_FOLDER,
    rootHash: typeof value.rootHash === 'string' && ROOT_HASH.test(value.rootHash) ? value.rootHash : null,
    lastTitle: isText(value.lastTitle) ? value.lastTitle : null,
    lastSid: isText(value.lastSid) ? value.lastSid : null,
    old: value.old === true,
  }
}

/**
 * The meta to store after a change: `prev` (as readMeta answers it) with `patch` over it. A patch
 * value that is undefined changes nothing, null removes the field; a null or false field is not kept.
 */
export function mergeMeta(prev, patch) {
  const out = { ...(prev ?? {}) }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === undefined) continue
    if (value === null) delete out[key]
    else out[key] = value
  }
  for (const [key, value] of Object.entries(out)) if (value === null || value === false) delete out[key]
  return out
}

/** A stored `attach:` value when it is sound ({ board, at }), else null. */
export function readAttach(value) {
  if (value == null || typeof value !== 'object' || !isText(value.board)) return null
  return { board: value.board, at: isNum(value.at) ? value.at : 0 }
}

// ---- The time

const dayStart = (ms) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** How many calendar days (local) `ms` lies before `now`: 0 today, 1 yesterday, negative for the future. */
const daysBefore = (ms, now) => Math.round((dayStart(now) - dayStart(ms)) / DAY_MS)

/** `10/08 23:01`, local. */
export function stampOf(ms) {
  const d = new Date(ms)
  return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + ' ' + clockOf(ms)
}

/** `2026-10-08 23:01`, local. */
export const fullStampOf = (ms) => new Date(ms).getFullYear() + '-' + stampOf(ms).replace('/', '-')

/** `今日 14:05`, `昨日 14:05`, else `10/08 14:05` (local), as `now` sees the day. */
export function dayStampOf(ms, now) {
  const days = daysBefore(ms, now)
  if (days === 0) return '今日 ' + clockOf(ms)
  if (days === 1) return '昨日 ' + clockOf(ms)
  return stampOf(ms)
}

/** A card's time: `14:05` on the day of `now`, else `10/08 14:05`. */
export const cardStampOf = (ms, now) => (typeof now === 'number' && daysBefore(ms, now) !== 0 ? stampOf(ms) : clockOf(ms))

// ---- The list

/**
 * One board as the lists show it: { id, name, updatedAt, createdAt, cwdName, rootHash, count,
 * titles, lastTitle, old }. `titles` are every card's in the pane's order (the pinned first), each
 * { title, pinned, progress } (progress: the checklist's `3/7`, '' for none); `count` is the cards the
 * record holds. null when the meta is not sound (such a board is not listed).
 */
export function summarizeBoard(id, recordValue, metaValue) {
  const meta = readMeta(metaValue)
  if (meta === null) return null
  const cards = orderedCards(boardCardsOf(recordValue))
  return {
    id,
    name: meta.name,
    updatedAt: meta.updatedAt,
    createdAt: meta.createdAt,
    cwdName: meta.cwdName,
    rootHash: meta.rootHash,
    count: cards.length,
    titles: cards.map((c) => ({ title: clip(c.title, LIST_LIMITS.title), pinned: c.pinned === true, progress: taskProgress(c.body) })),
    lastTitle: meta.lastTitle,
    old: meta.old,
  }
}

const byNewest = (a, b) => (b.updatedAt ?? -Infinity) - (a.updatedAt ?? -Infinity)

/**
 * The boards in the three groups the lists show, each newest first: `mine`, this project's (the
 * same root hash) that are not old; `others`, the other projects' (or of no known project) that
 * are not old; `old`, the old ones of any project. `except` (a board id, or null) is left out: the
 * board the session is attached to, when it looks for another.
 */
export function groupBoards(rows, { rootHash = null, except = null } = {}) {
  const shown = rows.filter((r) => r != null && r.id !== except)
  const same = (r) => rootHash !== null && r.rootHash === rootHash
  return {
    mine: shown.filter((r) => !r.old && same(r)).sort(byNewest),
    others: shown.filter((r) => !r.old && !same(r)).sort(byNewest),
    old: shown.filter((r) => r.old).sort(byNewest),
  }
}

/**
 * The board named `name` (as nameKey compares names): of this project first, then of any; the
 * newest of those. null when no board has the name.
 */
export function findByName(rows, name, rootHash = null) {
  const key = nameKey(name)
  const named = rows.filter((r) => r != null && nameKey(r.name) === key).sort(byNewest)
  return named.find((r) => rootHash !== null && r.rootHash === rootHash) ?? named[0] ?? null
}

/** A board of this project, other than `id`, that already has the name: the person and Claude are asked for another. */
export const nameTaken = (rows, name, rootHash, id) =>
  rows.some((r) => r != null && r.id !== id && rootHash !== null && r.rootHash === rootHash && nameKey(r.name) === nameKey(name))

/** A row's card titles in one line: the first `max` (`固定: ` before a pinned one, its progress after), then `ほか N 枚`. */
export function titlesLine(row, max = LIST_LIMITS.titles) {
  if (row.count === 0) return 'カードはまだありません'
  const shown = row.titles.slice(0, max).map((t) => (t.pinned ? '固定: ' : '') + t.title + (t.progress !== '' ? ' ' + t.progress : ''))
  const rest = row.count - shown.length
  return shown.join(' ・ ') + (rest > 0 ? ` ほか ${rest} 枚` : '')
}

/** The warning about the store's size: only from half of the 4 MiB, else ''. */
export function storeWarning(bytes) {
  if (!(bytes > WARN_BYTES)) return ''
  const mb = Math.round((bytes / MIB) * 10) / 10
  return `保存できる量の半分を超えています（${mb.toFixed(1)} MB / ${STORE_MIB} MB）。これ以上増えると、${BOARD_NAME}を保存できなくなります`
}
