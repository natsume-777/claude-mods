// The boards other sessions left in $.store, and what is done with them (pure: no $ here, shelf.js
// and store.js keep the calls).
//
// A session's board is `board:<sessionId>` (the cards) beside `meta:<sessionId>`
// ({ updatedAt, cwdName, count }), written together. The pane lists the others, newest first, so
// a new session can take one over; two options keep the store from filling with old ones:
// `archiveDir` (write a board to a Markdown file before it is deleted) and `autoCleanDays`.

import { LIMITS, sanitizeCards, orderedCards, clockOf } from './board.js'
import { clip } from './background.js'

/** What the list shows and keeps at most. */
export const SHELF_LIMITS = {
  boards: 5,
  titles: 3,
  title: 60,
}

/** The word for a folder that is not known (a board saved before the meta existed). */
export const UNKNOWN_FOLDER = '不明'

const DAY_MS = 24 * 60 * 60 * 1000

// ---- The options

let config = { archiveDir: '', autoCleanDays: 0 }

/** Takes register()'s options. A value of the wrong type is off: no archive folder, no clean. */
export function setConfig(options = {}) {
  const days = options?.autoCleanDays
  config = {
    archiveDir: typeof options?.archiveDir === 'string' ? options.archiveDir.trim() : '',
    autoCleanDays: typeof days === 'number' && Number.isFinite(days) && days >= 1 ? Math.floor(days) : 0,
  }
  return config
}

export const getConfig = () => config

/** The line under the list's heading: the two options, on or off. */
export const settingsLine = (c = config) =>
  `自動掃除: ${c.autoCleanDays >= 1 ? `${c.autoCleanDays} 日より古いものを消す` : 'オフ'} · 書き出し: ${c.archiveDir !== '' ? 'オン' : 'オフ'}`

// ---- The keys and the meta

export const BOARD_PREFIX = 'board:'
export const metaKey = (sessionId) => 'meta:' + sessionId

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

/** The `meta:` value written with a board. */
export const metaValue = (cards, cwdName, now) => ({ updatedAt: now, cwdName, count: cards.length })

/** A stored `meta:` value when it is sound ({ updatedAt, cwdName, count }), else null. */
export function readMeta(value) {
  if (value == null || typeof value !== 'object') return null
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) return null
  return {
    updatedAt: value.updatedAt,
    cwdName: typeof value.cwdName === 'string' && value.cwdName !== '' ? value.cwdName : UNKNOWN_FOLDER,
    count: typeof value.count === 'number' ? value.count : null,
  }
}

// ---- The list

/**
 * One other session's board as the list shows it: { sid, sid8, updatedAt, cwdName, count, titles }.
 * Without a sound meta the time is that of the newest card (null if there is none) and the folder
 * is unknown; the count is always the cards the board holds.
 */
export function summarizeBoard(sid, boardValue, metaStored) {
  const cards = sanitizeCards(boardValue)
  const meta = readMeta(metaStored)
  const newest = cards.reduce((m, c) => Math.max(m, c.updatedAt), -Infinity)
  return {
    sid,
    sid8: shortId(sid),
    updatedAt: meta?.updatedAt ?? (cards.length > 0 ? newest : null),
    cwdName: meta?.cwdName ?? UNKNOWN_FOLDER,
    count: cards.length,
    titles: orderedCards(cards)
      .slice(0, SHELF_LIMITS.titles)
      .map((c) => clip(c.title, SHELF_LIMITS.title)),
  }
}

/** The newest first (a board with no time last); { boards: the first few, more: how many are left out }. */
export function shelfOf(entries) {
  const sorted = [...entries].sort((a, b) => (b.updatedAt ?? -Infinity) - (a.updatedAt ?? -Infinity))
  return { boards: sorted.slice(0, SHELF_LIMITS.boards), more: Math.max(0, sorted.length - SHELF_LIMITS.boards) }
}

/** The store's size in the words the heading uses: characters of JSON in KB, never 0 for something. */
export const sizeText = (chars) => `ストア ${chars <= 0 ? 0 : Math.max(1, Math.round(chars / 1024))} KB`

/** `10/08 23:01`, local. */
export function stampOf(ms) {
  const d = new Date(ms)
  return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + ' ' + clockOf(ms)
}

/** `2026-10-08 23:01`, local. */
export const fullStampOf = (ms) => new Date(ms).getFullYear() + '-' + stampOf(ms).replace('/', '-')

// ---- Taking a board over

/**
 * The cards of `source` added to `current`: a card whose id is there already is skipped (the
 * present one stays), and only as many go in as the limit leaves room for; `pinned` is carried.
 * { cards, added, duplicates, overflow }.
 */
export function importCards(current, source, limit = LIMITS.cards) {
  const have = new Set(current.map((c) => c.id))
  const cards = [...current]
  let added = 0
  let duplicates = 0
  let overflow = 0
  for (const card of source) {
    if (have.has(card.id)) duplicates++
    else if (cards.length >= limit) overflow++
    else {
      have.add(card.id)
      cards.push({ ...card })
      added++
    }
  }
  return { cards, added, duplicates, overflow }
}

/** The one line the list shows after an import. */
export function importText({ added, duplicates, overflow }) {
  if (added === 0 && duplicates === 0 && overflow === 0) return '取り込めるカードがありませんでした'
  const skipped = []
  if (duplicates > 0) skipped.push(`${duplicates} 枚は同じ id があるので飛ばしました`)
  if (overflow > 0) skipped.push(`${overflow} 枚は上限（${LIMITS.cards} 枚）に達したので入りませんでした`)
  return `${added} 枚を取り込みました` + (skipped.length > 0 ? `（${skipped.join('、')}）` : '')
}

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
