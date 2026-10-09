// The boards other sessions left in $.store, and what is done with them (pure: no $ here, shelf.js
// and store.js keep the calls).
//
// A session's board is `board:<sessionId>` (the cards) beside `meta:<sessionId>`, written together:
//   { updatedAt, cwdName, count }              always
//   firstPrompt, title                         what the session began with (to tell boards apart)
//   handedFrom: { sid, sid8, cwdName, updatedAt, count, at }
//                                              set on the board that took cards over
// and, only once the board was taken over, `seal:<sessionId>`:
//   { to, toSid8, toCwdName, at }              the board is sealed (read-only); the cards under
//                                              `board:` are never touched
// The seal has a key of its own because the meta is read, laid over and written back by the session
// that owns the board at every save: a seal kept in it could be written back away. Only the session
// that took the board over writes the seal key, and only [このセッションで書けるように戻す] deletes it.
// 0.9.0 kept the seal in the meta as `handedOver`; that is still read as a seal (never written).
// A new session's pane lists the other boards, so it can copy one over; the copied board stays,
// sealed. Two options (off in this version) keep the store from filling with old boards:
// `archiveDir` (write a board to a Markdown file before it is deleted) and `autoCleanDays`.

import { LIMITS, sanitizeCards, orderedCards, clockOf } from './board.js'
import { clip } from './background.js'

/** What the list shows and keeps at most. */
export const SHELF_LIMITS = {
  boards: 5,
  titles: 3,
  title: 60,
  /** The titles an opened row lists. */
  openTitles: 20,
  /** The characters of the first request that are kept. */
  prompt: 60,
  /** The rows of the clean-up list. */
  cleanup: 20,
}

/** The word for a folder that is not known (a board saved before the meta existed). */
export const UNKNOWN_FOLDER = '不明'

const DAY_MS = 24 * 60 * 60 * 1000
const MIB = 1024 * 1024

/** The store holds 4 MiB in all; the pane warns from half of it. */
export const WARN_BYTES = 2 * MIB
const STORE_MIB = 4

// ---- The options

let config = { handover: true, archiveDir: '', autoCleanDays: 0 }

/**
 * Takes register()'s options. `handover` is on unless it is false. A value of the wrong type for
 * the others is off: no archive folder, no clean.
 */
export function setConfig(options = {}) {
  const days = options?.autoCleanDays
  config = {
    handover: options?.handover !== false,
    archiveDir: typeof options?.archiveDir === 'string' ? options.archiveDir.trim() : '',
    autoCleanDays: typeof days === 'number' && Number.isFinite(days) && days >= 1 ? Math.floor(days) : 0,
  }
  return config
}

export const getConfig = () => config

/** The line under the clean-up list's heading: the two options, on or off. */
export const settingsLine = (c = config) =>
  `自動掃除: ${c.autoCleanDays >= 1 ? `${c.autoCleanDays} 日より古いものを消す` : 'オフ'} · 書き出し: ${c.archiveDir !== '' ? 'オン' : 'オフ'}`

// ---- The keys and the meta

export const BOARD_PREFIX = 'board:'
export const metaKey = (sessionId) => 'meta:' + sessionId
export const SEAL_PREFIX = 'seal:'
export const META_PREFIX = 'meta:'
export const sealKey = (sessionId) => SEAL_PREFIX + sessionId

/** The session id of a `board:` key, or null for any other key. */
export const sessionOfKey = (key) => (typeof key === 'string' && key.startsWith(BOARD_PREFIX) && key.length > BOARD_PREFIX.length ? key.slice(BOARD_PREFIX.length) : null)

/** The first 8 plain characters of a session id: the buttons' keys and the archive's file name. */
export const shortId = (sessionId) => String(sessionId ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || 'session'

/** The last folder of a path, nothing above it; UNKNOWN_FOLDER when there is none. */
export function cwdNameOf(path) {
  const parts = String(path ?? '')
    .split(/[\\/]+/)
    .filter((p) => p !== '')
  return parts.at(-1) ?? UNKNOWN_FOLDER
}

/** A request cut to the length the meta keeps: blanks and line breaks as one blank, `…` at the cut. */
export const promptLine = (text, max = SHELF_LIMITS.prompt) => clip(text, max)

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)
const isText = (s) => typeof s === 'string' && s !== ''

/** A stored seal (the `seal:` value, or a 0.9.0 meta's `handedOver`) when it is sound ({ to, toSid8, toCwdName, at }), else null. */
export function readSeal(value) {
  if (value == null || typeof value !== 'object' || !isText(value.to) || !isNum(value.at)) return null
  return { to: value.to, toSid8: isText(value.toSid8) ? value.toSid8 : shortId(value.to), toCwdName: isText(value.toCwdName) ? value.toCwdName : UNKNOWN_FOLDER, at: value.at }
}

/** A stored `handedFrom` when it is sound ({ sid, sid8, cwdName, updatedAt, count, at }), else null. */
function readHandedFrom(value) {
  if (value == null || typeof value !== 'object' || !isText(value.sid) || !isNum(value.at)) return null
  return {
    sid: value.sid,
    sid8: isText(value.sid8) ? value.sid8 : shortId(value.sid),
    cwdName: isText(value.cwdName) ? value.cwdName : UNKNOWN_FOLDER,
    updatedAt: isNum(value.updatedAt) ? value.updatedAt : null,
    count: isNum(value.count) ? value.count : null,
    at: value.at,
  }
}

/**
 * A stored `meta:` value when it is sound, else null: { updatedAt, cwdName, count } and, when
 * they are there and well-formed, firstPrompt, title, handedFrom and, in a meta 0.9.0 wrote, the
 * seal as handedOver. A field it does not know, or one of the wrong type, is let go.
 */
export function readMeta(value) {
  if (value == null || typeof value !== 'object') return null
  if (!isNum(value.updatedAt)) return null
  const handedOver = readSeal(value.handedOver)
  const handedFrom = readHandedFrom(value.handedFrom)
  return {
    updatedAt: value.updatedAt,
    cwdName: typeof value.cwdName === 'string' && value.cwdName !== '' ? value.cwdName : UNKNOWN_FOLDER,
    count: typeof value.count === 'number' ? value.count : null,
    ...(isText(value.firstPrompt) ? { firstPrompt: value.firstPrompt } : {}),
    ...(isText(value.title) ? { title: value.title } : {}),
    ...(handedOver ? { handedOver } : {}),
    ...(handedFrom ? { handedFrom } : {}),
  }
}

/**
 * The meta after a change: `prev` (a meta as readMeta answers it, or null) with `patch` over it.
 * A patch value that is undefined changes nothing, and null removes the field. A first request
 * already there stays: it is written once.
 */
export function mergeMeta(prev, patch) {
  const out = { ...(prev ?? {}) }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === undefined) continue
    if (value === null) delete out[key]
    else out[key] = value
  }
  if (isText(prev?.firstPrompt)) out.firstPrompt = prev.firstPrompt
  if (out.count === null) delete out.count
  return out
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

/** A card's time: `14:05` on the day of `now`, else `10/08 14:05` (an imported card is from another day). */
export const cardStampOf = (ms, now) => (typeof now === 'number' && daysBefore(ms, now) !== 0 ? stampOf(ms) : clockOf(ms))

// ---- The list

/**
 * One other session's board as the list shows it: { sid, sid8, updatedAt, cwdName, count, titles,
 * allTitles, pinnedCount, firstPrompt, title, handedOver }. Without a sound meta the time is that
 * of the newest card (null if there is none) and the folder is unknown; the count is always the
 * cards the board holds. `titles` are the first three in the pane's order, `allTitles` up to 20
 * ({ title, pinned }). `handedOver` is the seal: the `seal:` value, else a 0.9.0 meta's.
 */
export function summarizeBoard(sid, boardValue, metaStored, sealStored) {
  const cards = sanitizeCards(boardValue)
  const meta = readMeta(metaStored)
  const newest = cards.reduce((m, c) => Math.max(m, c.updatedAt), -Infinity)
  const ordered = orderedCards(cards)
  return {
    sid,
    sid8: shortId(sid),
    updatedAt: meta?.updatedAt ?? (cards.length > 0 ? newest : null),
    cwdName: meta?.cwdName ?? UNKNOWN_FOLDER,
    count: cards.length,
    titles: ordered.slice(0, SHELF_LIMITS.titles).map((c) => clip(c.title, SHELF_LIMITS.title)),
    allTitles: ordered.slice(0, SHELF_LIMITS.openTitles).map((c) => ({ title: clip(c.title, SHELF_LIMITS.title), pinned: c.pinned === true })),
    pinnedCount: cards.filter((c) => c.pinned === true).length,
    firstPrompt: meta?.firstPrompt ?? null,
    title: meta?.title ?? null,
    handedOver: readSeal(sealStored) ?? meta?.handedOver ?? null,
  }
}

const byNewest = (a, b) => (b.updatedAt ?? -Infinity) - (a.updatedAt ?? -Infinity)

/**
 * The boards a new session may take over, in the order the pane lists them: not this session's
 * own, not empty, not sealed; those of the same folder first, then the rest, each newest first
 * (one with no time last). { boards: the first `limit`, more: how many are left out }.
 */
export function candidatesOf(entries, { me, cwdName, limit = SHELF_LIMITS.boards } = {}) {
  const open = entries.filter((e) => e.sid !== me && e.count > 0 && !e.handedOver)
  const same = (e) => cwdName !== undefined && cwdName !== UNKNOWN_FOLDER && e.cwdName === cwdName
  const sorted = [...open.filter(same).sort(byNewest), ...open.filter((e) => !same(e)).sort(byNewest)]
  return { boards: sorted.slice(0, limit), more: Math.max(0, sorted.length - limit) }
}

/** The rows of the clean-up list: every other session's board, sealed ones too (`sealed`), newest first. */
export function cleanupOf(entries, { me, limit = SHELF_LIMITS.cleanup } = {}) {
  return entries
    .filter((e) => e.sid !== me)
    .sort(byNewest)
    .slice(0, limit)
    .map((e) => ({ sid: e.sid, sid8: e.sid8, updatedAt: e.updatedAt, cwdName: e.cwdName, count: e.count, sealed: e.handedOver !== null }))
}

/** The warning about the store's size: only from half of the 4 MiB, else ''. */
export function storeWarning(bytes) {
  if (!(bytes > WARN_BYTES)) return ''
  const mb = Math.round((bytes / MIB) * 10) / 10
  return `保存できる量の半分を超えています（${mb.toFixed(1)} MB / ${STORE_MIB} MB）。これ以上増えると、ボードを保存できなくなります`
}

// ---- Taking a board over

const entryOf = (c) => ({ id: c.id, title: c.title, pinned: c.pinned === true })

/**
 * The cards of `source` put after those of `current`: a card whose id is there already is skipped
 * (the present one stays), and only as many go in as the limit leaves room for; `pinned` and
 * `updatedAt` are carried. { cards, added, duplicates, overflow }, the last three as lists of
 * { id, title, pinned }.
 */
export function planHandover(current, source, limit = LIMITS.cards) {
  const have = new Set(current.map((c) => c.id))
  const cards = [...current]
  const added = []
  const duplicates = []
  const overflow = []
  for (const card of source) {
    if (have.has(card.id)) duplicates.push(entryOf(card))
    else if (cards.length >= limit) overflow.push(entryOf(card))
    else {
      have.add(card.id)
      cards.push({ ...card })
      added.push(entryOf(card))
    }
  }
  return { cards, added, duplicates, overflow }
}

/** The sign of a list of cards (ids, times, pins): it differs when anything on the board changed. */
export const cardsSig = (cards) => cards.map((c) => c.id + ':' + c.updatedAt + ':' + (c.pinned === true ? 1 : 0)).join(',')

/** The words for a skipped / not-fitting count after a hand-over: `（1 枚は同じ id があるので飛ばしました、…）` or ''. */
function skippedText({ duplicates, overflow }) {
  const skipped = []
  if (duplicates.length > 0) skipped.push(`${duplicates.length} 枚は同じ id があるので飛ばしました`)
  if (overflow.length > 0) skipped.push(`${overflow.length} 枚は上限（${LIMITS.cards} 枚）に達したので入りませんでした`)
  return skipped.length > 0 ? `（${skipped.join('、')}）` : ''
}

/** Where a board came from, in a few words: `今日 14:05 · my-project`. */
export const originText = (row, now) => `${typeof row.updatedAt === 'number' ? dayStampOf(row.updatedAt, now) : '時刻不明'} · ${row.cwdName}`

/** The one line the pane shows after a hand-over. */
export function handoverText(plan, row, now) {
  return `${plan.added.length} 枚を引き継ぎました（${originText(row, now)} のボードから）。元のボードは読み取り専用になりました。` + skippedText(plan)
}

/** Where a sealed board went: `別のセッション（my-project · ID b7de12ab）`. */
const sealedTo = (sealed) => `別のセッション（${sealed.toCwdName} · ID ${sealed.toSid8}）`

/** What a write to a sealed board is refused with (read by Claude). */
export const sealedDenyText = (sealed) =>
  `このボードは読み取り専用です。${stampOf(sealed.at)} に、${sealedTo(sealed)}へ引き継がれました。` +
  'カードの追加・書き換え・削除はできません（list_cards で読むことはできます）。続きは引き継ぎ先のセッションで書くよう、利用者に伝えてください。'

/** What a write is refused with when the seal could not be read (read by Claude): a board that may be sealed is not written. */
export const sealUnreadableText = (message) =>
  `ボードの状態（読み取り専用かどうか）を読めなかったので、書き込みを止めました（${message}）。もう一度試してください。何度やっても同じなら、そのことを利用者に伝えてください。`

/** The line for the frame when [引き継ぐ] is pressed on a board that is read-only itself. */
export const SELF_SEALED = 'このボードは読み取り専用なので、引き継げません。先に [このセッションで書けるように戻す] を押してください'

/** The first line of list_cards on a sealed board. */
export const sealedListLine = (sealed) => `（このボードは読み取り専用です。${stampOf(sealed.at)} に${sealedTo(sealed)}へ引き継がれました）`

// ---- The archive

const isAbsolute = (p) => /^([A-Za-z]:)?[\\/]/.test(p)
const trimDir = (dir) => String(dir).trim().replace(/\\/g, '/').replace(/\/+$/, '')

/** `whiteboard-20261008-1a2b3c4d.md`: the day the board was last written (local) and the session's short id. */
export function archiveName(sid, updatedAt) {
  const d = new Date(typeof updatedAt === 'number' ? updatedAt : 0)
  const day = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
  return `whiteboard-${day}-${shortId(sid)}.md`
}

/** Where $.fs.write puts a board's file: under `root` (the project) unless `dir` is absolute. */
export function archivePath(dir, root, name) {
  const d = trimDir(dir) || '.'
  const shown = d === '.' ? name : `${d}/${name}`
  return isAbsolute(d) || !root ? shown : `${String(root).replace(/[\\/]+$/, '')}/${shown}`
}

const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim()

/** A board as Markdown: a heading, when it was written and where, then each card with its title, id, time and body. */
export function archiveMarkdown({ sid, updatedAt, cwdName, cards }) {
  const ordered = orderedCards(cards)
  const lines = [`# whiteboard のボード ${shortId(sid)}`, '', `- 更新: ${typeof updatedAt === 'number' ? fullStampOf(updatedAt) : '不明'}`, `- フォルダ: ${cwdName}`, `- カード: ${cards.length} 枚`]
  for (const c of ordered) {
    lines.push('', `## ${oneLine(c.title)}`, '', `${c.id} · ${fullStampOf(c.updatedAt)}${c.pinned === true ? ' · 固定' : ''}`)
    if (c.body.trim() !== '') lines.push('', c.body.replace(/\s+$/, ''))
  }
  return lines.join('\n') + '\n'
}

/** Whether a board last written at `updatedAt` is older than `days` days at `now` (exactly `days` is not). */
export const isStale = (updatedAt, now, days) => typeof updatedAt === 'number' && days >= 1 && now - updatedAt > days * DAY_MS
