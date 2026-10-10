// The board's rules, kept apart from the host calls: what a card is, the limits, how the seven
// tools change a list of cards and what they answer, the one previous version a card keeps and the
// cards removed lately (undo_card), and how the band fits a narrow line (the count, a hint, the
// title of the pinned card written last, the count of cards changed since the latest prompt, and
// the count of stale cards).
// Pure: no $ here, so register.js keeps every $ call itself.

import { styleOf, styleInput } from './style.js'
import { isStaleCard, staleText } from './stale.js'

/** The board's name in what the person sees (the band, the pane, its title, /whiteboard); what Claude reads says 「ボード」. */
export const BOARD_NAME = 'ホワイトボード'

/**
 * The card limit: the setting `maxCards` (maxCardsOf), `default` when it is not set, kept within
 * min..max. A stored board is read up to `max` whatever the setting (sanitizeCards), so lowering
 * the setting never drops cards: a board over the limit keeps them, and only adding is refused.
 */
export const CARD_LIMIT = { default: 20, min: 5, max: 40 }

/**
 * What the board holds at most; a call over a limit is refused with the reason. `cards` is the
 * default card limit only: the tools, the hand-over and the compaction note take the one the
 * setting gives (maxCardsOf) as an argument.
 */
export const LIMITS = {
  cards: CARD_LIMIT.default,
  id: 40,
  title: 60,
  body: 4000,
}

/**
 * The setting `maxCards`: a number (or a numeric string) rounded down to a whole number and kept
 * within CARD_LIMIT.min..max (below: min, above: max). Absent, empty, or not a finite number: the default.
 */
export function maxCardsOf(options) {
  const raw = options?.maxCards
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : NaN
  if (!Number.isFinite(n)) return CARD_LIMIT.default
  return Math.min(CARD_LIMIT.max, Math.max(CARD_LIMIT.min, Math.floor(n)))
}

/** A card limit as the functions below take it: a whole number within CARD_LIMIT, else the default. */
const limitOf = (n) => (Number.isSafeInteger(n) && n >= CARD_LIMIT.min && n <= CARD_LIMIT.max ? n : CARD_LIMIT.default)

/** Ids are short and plain, so Claude can name a card again without guessing at its spelling. */
export const ID_PATTERN = /^[A-Za-z0-9_-]+$/

/** The $.store key a session's board is kept under. */
export const storeKey = (sessionId) => 'board:' + sessionId

// ---- The stored board: one record under `board:<id>`, written in one store write,
//   { v: 2, cards, rev, removed }
// `cards` the cards (each may carry `prev`, see trackPrev), `rev` the board's revision, `removed`
// the cards removed lately (undo_card). A board that became empty keeps its record (cards []), so
// its revision goes on and its removed cards can still be brought back; the list of boards to take
// over leaves out a board with no cards. Only a record with nothing in it (no cards, revision 0,
// nothing removed) is not written: the key is deleted.
//
// Older boards: up to 0.9.2 the value was the cards alone (a list), and builds in between kept the
// revision and the removed cards under keys of their own (LEGACY_KEYS). Such a board is read as it
// is (readBoard); it is written in the new form at its next write, and those keys are deleted then.
// Reading never rewrites it.

/** The version of the stored record. */
export const BOARD_VERSION = 2

/** The keys an older build kept beside a board: its revision (a number) and its removed cards (a list). */
export const LEGACY_KEYS = {
  rev: (sessionId) => 'rev:' + sessionId,
  removed: (sessionId) => 'removed:' + sessionId,
}

/** The prefixes of LEGACY_KEYS, for the store's size and the clean-up. */
export const LEGACY_PREFIXES = ['rev:', 'removed:']

/** Whether a stored value is the record (as opposed to an older board, a list of cards). */
export const isBoardRecord = (value) => value != null && typeof value === 'object' && !Array.isArray(value) && value.v === BOARD_VERSION && Array.isArray(value.cards)

/** The cards of a stored board, of either form: sanitizeCards of the record's `cards` or of the list. */
export const boardCardsOf = (value) => sanitizeCards(isBoardRecord(value) ? value.cards : value)

/**
 * A stored board as the tools use it: { cards, rev, removed, legacy }. `legacy` holds the values of
 * LEGACY_KEYS ({ rev, removed }, either undefined), read only for a board that is not a record;
 * `legacy` in the answer is true for such a board (its next write deletes those keys).
 */
export function readBoard(value, legacy = {}) {
  const record = isBoardRecord(value)
  const cards = sanitizeCards(record ? value.cards : value)
  const source = record ? value : legacy
  return { cards, rev: boardRevOf(cards, source?.rev), removed: sanitizeRemoved(source?.removed), legacy: !record }
}

/** The record to store for a board, or null when there is nothing in it to keep (the key is deleted then). */
export function boardRecord({ cards, rev, removed }) {
  if (cards.length === 0 && rev === 0 && removed.length === 0) return null
  return { v: BOARD_VERSION, cards, rev, removed }
}

// ---- Revisions: every write that changes the board moves its revision on by one, and each card
// it changed (added, rewritten, pinned, styled, copied in by a hand-over) carries that number as
// `rev`. A removal moves the board's revision too. list_cards answers the board's revision, and its
// `since` returns only the cards with a greater `rev`. The board's revision is the record's `rev`,
// which an emptied board keeps.

const isRev = (n) => Number.isSafeInteger(n) && n >= 0

/** A stored board revision; 0 for anything else (a board written before revisions existed). */
export const readRev = (value) => (isRev(value) ? value : 0)

/** A card's revision; 0 for a card written before revisions existed. */
export const revOf = (c) => (isRev(c?.rev) ? c.rev : 0)

/** The board's revision: the stored one, or the greatest card's if that is ahead of it. */
export const boardRevOf = (cards, stored) => cards.reduce((m, c) => Math.max(m, revOf(c)), readRev(stored))

// A card's `rev` field as it is kept: present only from revision 1
const revPart = (rev) => (rev > 0 ? { rev } : {})

/** A card's (or a version's) `pinned` and `style` fields as they are kept: each present only when set. */
const looksPart = (c) => ({ ...(c?.pinned === true ? { pinned: true } : {}), ...(styleOf(c) !== null ? { style: styleOf(c) } : {}) })

// Whether two cards say the same: title, body, pin and style (the time is not looked at)
export const sameContent = (a, b) => a.title === b.title && a.body === b.body && (a.pinned === true) === (b.pinned === true) && styleOf(a) === styleOf(b)

/**
 * The cards after a write, with their revisions: `after` is what a tool (or a hand-over) made of
 * `before`, `rev` the board's revision before it. When a card is new or says something else than
 * it did, or a card is gone, the board moves to rev + 1 and each new or changed card carries it;
 * the others keep theirs. A write that changed nothing (the same card set again) keeps `rev`.
 * { cards, rev }.
 */
export function stampRevs(before, after, rev) {
  const was = new Map(before.map((c) => [c.id, c]))
  const next = rev + 1
  const ids = new Set(after.map((c) => c.id))
  let moved = before.some((c) => !ids.has(c.id))
  const cards = after.map((c) => {
    const { rev: _rev, ...rest } = c
    const old = was.get(c.id)
    if (old && sameContent(old, c)) return { ...rest, ...revPart(revOf(old)) }
    moved = true
    return { ...rest, rev: next }
  })
  return { cards, rev: moved ? next : rev }
}

// A card's `arrivedAt` field as it is kept: present only as a finite number
const arrivedPart = (c) => (typeof c?.arrivedAt === 'number' && Number.isFinite(c.arrivedAt) ? { arrivedAt: c.arrivedAt } : {})

const isCard = (c) =>
  c != null &&
  typeof c === 'object' &&
  typeof c.id === 'string' &&
  c.id.length > 0 &&
  c.id.length <= LIMITS.id &&
  ID_PATTERN.test(c.id) &&
  typeof c.title === 'string' &&
  typeof c.body === 'string' &&
  typeof c.updatedAt === 'number'

/**
 * The cards of a stored value: the well-formed ones, each id once, up to CARD_LIMIT.max (not the
 * setting, so a board written under a higher one keeps its cards); [] for anything
 * else. `pinned` is kept only as true; any other value is dropped (the card stays, unpinned). `style`
 * is kept only as one of the styles (style.js); anything else is dropped (the card has none). `rev`
 * is kept only as a positive integer; a card without one reads as revision 0 and is not rewritten for it.
 * `prev` (the previous version, see trackPrev) is kept only when it is well-formed; a card without
 * one has nothing to undo. `arrivedAt` (when a hand-over copied the card in; stale.js) is kept only
 * as a number.
 */
export function sanitizeCards(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const cards = []
  for (const c of value) {
    if (!isCard(c) || seen.has(c.id)) continue
    seen.add(c.id)
    cards.push({ id: c.id, title: c.title, body: c.body, updatedAt: c.updatedAt, ...arrivedPart(c), ...looksPart(c), ...revPart(revOf(c)), ...prevPart(c) })
    if (cards.length >= CARD_LIMIT.max) break
  }
  return cards
}

// ---- Undo: each card keeps one previous version as `prev` ({ title, body, pinned?, style? }), in
// the store only: list_cards, the pane and the band never see it ($.state holds the cards without
// it, shownCards), and a hand-over does not copy it. A card undo_card brought back from the removed
// ones has `prev: { gone: true }` instead (before it the card was not on the board), so that undo
// on it again removes it: the redo. The cards removed lately are the record's `removed`.

/** How many removed cards are kept to bring back: the latest removals, one entry an id. */
export const REMOVED_KEEP = 5

const isVersion = (v) =>
  v != null && typeof v === 'object' && typeof v.title === 'string' && v.title !== '' && v.title.length <= LIMITS.title && typeof v.body === 'string' && v.body.length <= LIMITS.body

/** The `prev` of a card undo_card brought back from the removed cards: before it, the card was not on the board. */
const GONE_PREV = { gone: true }
const isGonePrev = (v) => v != null && typeof v === 'object' && v.gone === true

// A card's version as `prev` keeps it: title, body, pin and style (not the time, the id or the revision)
const versionOf = (c) => ({ title: c.title, body: c.body, ...looksPart(c) })

// A card's `prev` field as it is kept: present only when well-formed
const prevPart = (c) => (isVersion(c?.prev) ? { prev: versionOf(c.prev) } : isGonePrev(c?.prev) ? { prev: GONE_PREV } : {})

/** The cards as $.state holds them for the drawings: without `prev`. */
export const shownCards = (cards) => cards.map(({ prev: _prev, ...rest }) => rest)

/**
 * The cards after a write, each with its `prev`: a card that says something else than it did in
 * `before` keeps what it said there; one that says the same keeps the `prev` it had; a card that
 * was not in `before` has none (new, copied in by a hand-over), except a card undo_card brought
 * back, which keeps its `{ gone: true }`. undo_card's swap needs nothing more: the version it
 * brings back differs, so the one it replaced becomes the `prev`, and a second undo brings that back.
 */
export function trackPrev(before, after) {
  const was = new Map(before.map((c) => [c.id, c]))
  return after.map((c) => {
    const { prev, ...rest } = c
    const old = was.get(c.id)
    if (!old) return isGonePrev(prev) ? { ...rest, prev: GONE_PREV } : rest
    if (sameContent(old, c)) return { ...rest, ...prevPart(old) }
    return { ...rest, prev: versionOf(old) }
  })
}

// A removed card as the list keeps it
const removedEntryOf = (c) => ({ id: c.id, title: c.title, body: c.body, updatedAt: c.updatedAt, ...looksPart(c) })

/** The removed cards of a stored value: the well-formed ones, each id once (its latest removal), the last REMOVED_KEEP; [] for anything else. */
export function sanitizeRemoved(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const c of value) {
    if (!isCard(c) || c.title === '' || c.title.length > LIMITS.title || c.body.length > LIMITS.body) continue
    const at = out.findIndex((r) => r.id === c.id)
    if (at >= 0) out.splice(at, 1)
    out.push(removedEntryOf(c))
  }
  return out.slice(-REMOVED_KEEP)
}

/**
 * The removed cards after a write that turned `before` into `after`: the cards gone from the board
 * go to the end (a clear's cards in the order they were last written, so the most recently written
 * are the ones kept), an older entry of the same id gives way, an id that is on the board again is
 * let go, and only the last REMOVED_KEEP stay. { removed, added } (added: a card was removed).
 */
export function removedAfter(removed, before, after) {
  const ids = new Set(after.map((c) => c.id))
  const gone = before.filter((c) => !ids.has(c.id)).sort((a, b) => a.updatedAt - b.updatedAt)
  const goneIds = new Set(gone.map((c) => c.id))
  const kept = removed.filter((c) => !ids.has(c.id) && !goneIds.has(c.id))
  return { removed: [...kept, ...gone.map(removedEntryOf)].slice(-REMOVED_KEEP), added: gone.length > 0 }
}

// ---- Checklists

// A Markdown task-list item: a bullet (- * +) or a number (1. 1)), then [ ], [x] or [X], then a blank or the line's end
const TASK_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s+\[([ xX])\](?:\s|$)/
// A fence's opening or closing line: three or more ` or ~ (an opening ``` may carry an info string without `)
const FENCE_LINE = /^\s*(`{3,}|~{3,})(.*)$/

/**
 * The task-list items of a body: { done, total }, counting `- [ ]` / `- [x]` lines (any bullet or
 * number, any indent). Lines inside a fenced code block (``` or ~~~, mermaid too) are not counted;
 * a fence never closed runs to the end, as Markdown draws it.
 */
export function taskCounts(body) {
  let done = 0
  let total = 0
  let fence = null
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '')
    const f = FENCE_LINE.exec(line)
    if (fence !== null) {
      // Closed by the same character, at least as long, with nothing after it
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && f[2].trim() === '') fence = null
      continue
    }
    if (f && !(f[1][0] === '`' && f[2].includes('`'))) {
      fence = f[1]
      continue
    }
    const t = TASK_LINE.exec(line)
    if (!t) continue
    total++
    if (t[1] !== ' ') done++
  }
  return { done, total }
}

/** The progress of a card's checklist, `3/5` (`5/5 済` when all are done); '' for a body with no task items. */
export function taskProgress(body) {
  const { done, total } = taskCounts(body)
  if (total === 0) return ''
  return `${done}/${total}` + (done === total ? ' 済' : '')
}

// ---- The tools: each takes the cards and the call's input, and answers { cards, text } (the
// new list and the short reply) or { error } (the call is refused with this text). A call that
// changes nothing answers the same `cards` array it was given.

/** The id of an input, or the reason it cannot be one. */
function idOf(input) {
  const id = typeof input?.id === 'string' ? input.id.trim() : ''
  if (id === '') return { error: 'id が空です。短い英数字の id を指定してください（例: plan, urls）' }
  if (id.length > LIMITS.id || !ID_PATTERN.test(id)) {
    return { error: `id は英数字と _ - だけで ${LIMITS.id} 文字までです（受け取ったのは ${id.length} 文字）。例: plan, urls` }
  }
  return { id }
}

/** The words after a reply when a style changed: `。色を blue にしました` / `。色を外しました`, '' when it did not. */
const styleNote = (was, is) => (was === is ? '' : is === null ? '。色を外しました' : `。色を ${is} にしました`)

/** The cards as the pane shows them: the pinned ones first, then the others; each group in the order added. */
export const orderedCards = (cards) => [...cards.filter((c) => c.pinned === true), ...cards.filter((c) => c.pinned !== true)]

/**
 * set_card: adds a card, or overwrites the one with the same id in place. `pin` fixes it to the top
 * (true), frees it (false), or leaves it as it was (absent). `style` the same way: one of the
 * styles, `none` (removes it), or absent (as it was). A card set again as it is (title, body, pin
 * and style the same) is not written: the same `cards` come back, its time stays. `maxCards` (the
 * setting, maxCardsOf) is how many cards the board may hold: a new card beyond it is refused.
 */
export function applySet(cards, input, now, { maxCards } = {}) {
  const limit = limitOf(maxCards)
  const { id, error } = idOf(input)
  if (error) return { error }
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (title === '') return { error: 'title が空です。カードの見出しを指定してください' }
  if (title.length > LIMITS.title) return { error: `title は ${LIMITS.title} 文字までです（受け取ったのは ${title.length} 文字）。短くしてください` }
  const body = typeof input.body === 'string' ? input.body : ''
  if (body.length > LIMITS.body) {
    return { error: `body は ${LIMITS.body} 文字までです（受け取ったのは ${body.length} 文字）。要点に絞るか、カードを分けてください` }
  }
  if (input.pin !== undefined && typeof input.pin !== 'boolean') return { error: 'pin は true か false で指定してください（省略すると今のまま）' }
  const styled = styleInput(input.style)
  if (styled.error) return { error: styled.error }
  const index = cards.findIndex((c) => c.id === id)
  const was = index >= 0 && cards[index].pinned === true
  const is = input.pin === undefined ? was : input.pin
  const styleWas = index >= 0 ? styleOf(cards[index]) : null
  const styleIs = styled.keep ? styleWas : styled.style
  const card = { id, title, body, updatedAt: now, ...looksPart({ pinned: is, style: styleIs }) }
  if (index >= 0 && sameContent(cards[index], card)) return { cards, text: `${id} は同じ内容なので、書き換えていません（全 ${cards.length} 件）` }
  const pinNote = (is === was ? '' : is ? '。固定しました' : '。固定を外しました') + styleNote(styleWas, styleIs)
  if (index < 0) {
    if (cards.length >= limit) {
      return { error: `カードは ${limit} 枚までで、いっぱいです。済んだカードを remove_card で消してから追加してください` }
    }
    return { cards: [...cards, card], text: `追加しました: ${id}（全 ${cards.length + 1} 件）${pinNote}` }
  }
  return { cards: cards.map((c, i) => (i === index ? card : c)), text: `上書きしました: ${id}（全 ${cards.length} 件）${pinNote}` }
}

/** The card's body with a new text, or the reason it cannot be: the body over the limit is refused with the excess. */
function withBody(cards, index, body, now) {
  if (body.length > LIMITS.body) {
    return { error: `本文が上限の ${LIMITS.body} 文字を ${body.length - LIMITS.body} 文字超えます（${body.length} 文字になります）。要点に絞るか、カードを分けてください` }
  }
  // Title, pin, style and position stay; only the body and the time change
  return { cards: cards.map((c, i) => (i === index ? { ...c, body, updatedAt: now } : c)) }
}

/** The card with a new style (null: none); title, body, pin and position stay. */
function withStyle(cards, index, style, now) {
  return cards.map((c, i) => {
    if (i !== index) return c
    const { style: _old, ...rest } = c
    return { ...rest, updatedAt: now, ...(style !== null ? { style } : {}) }
  })
}

const noCardText = (id) => `${id} というカードはありません。set_card で作ってください`

/**
 * edit_card: replaces `find` in the card's body with `replace`. Like an editor's replace: it
 * must match in exactly one place, unless `all` is true (every place). A `find` that is nowhere
 * in the body, or in several places without `all`, is refused. `replace` may be empty (deletes).
 * `style` (as in set_card) changes the card's style too; with `style` and no `find` / `replace`
 * only the style changes. A call with neither `find` nor `style` is refused.
 */
export function applyEdit(cards, input, now) {
  const { id, error } = idOf(input)
  if (error) return { error }
  const styled = styleInput(input.style)
  if (styled.error) return { error: styled.error }
  if (input.find === undefined && input.replace === undefined) {
    if (styled.keep) return { error: 'find（本文の置き換え）か style（色）を指定してください。本文を置き換えるなら find と replace、色だけを変えるなら style だけでよい' }
    return editStyle(cards, id, styled.style, now)
  }
  if (typeof input.find !== 'string' || input.find === '') return { error: 'find が空です。本文の中で置き換えたい文字列を指定してください' }
  if (typeof input.replace !== 'string') return { error: 'replace は文字列で指定してください（空にすると find の部分を消します）' }
  if (input.all !== undefined && typeof input.all !== 'boolean') return { error: 'all は true か false で指定してください' }
  const index = cards.findIndex((c) => c.id === id)
  if (index < 0) return { cards, text: noCardText(id) }
  const parts = cards[index].body.split(input.find)
  const found = parts.length - 1
  if (found === 0) return { error: `${id} の本文に find が見つかりませんでした。list_cards の id で本文を読んで、一字一句合わせてください（改行も含めて）` }
  if (found > 1 && input.all !== true) {
    return { error: `find が ${id} の本文に ${found} 箇所あります。すべて置き換えるなら all: true、1 箇所だけなら前後も含めて一意になる find にしてください` }
  }
  const body = (input.all === true ? parts : [parts[0], parts.slice(1).join(input.find)]).join(input.replace)
  const changed = withBody(cards, index, body, now)
  if (changed.error) return changed
  const text = `編集しました: ${id}（${input.all === true ? found : 1} 箇所）`
  if (styled.keep) return { cards: changed.cards, text }
  const styleWas = styleOf(cards[index])
  return { cards: withStyle(changed.cards, index, styled.style, now), text: text + styleNote(styleWas, styled.style) }
}

/** edit_card with `style` alone: the card's style, nothing else. The same style again changes nothing. */
function editStyle(cards, id, style, now) {
  const index = cards.findIndex((c) => c.id === id)
  if (index < 0) return { cards, text: noCardText(id) }
  const was = styleOf(cards[index])
  if (was === style) return { cards, text: style === null ? `${id} に色はありません` : `${id} はすでに ${style} です` }
  return { cards: withStyle(cards, index, style, now), text: style === null ? `色を外しました: ${id}` : `色を ${style} にしました: ${id}` }
}

/**
 * append_card: adds `text` to the end of the card's body, on a line of its own (one newline
 * between, none when the body is empty or already ends with one).
 */
export function applyAppend(cards, input, now) {
  const { id, error } = idOf(input)
  if (error) return { error }
  if (typeof input.text !== 'string' || input.text === '') return { error: 'text が空です。足したい文を指定してください' }
  const index = cards.findIndex((c) => c.id === id)
  if (index < 0) return { cards, text: noCardText(id) }
  const old = cards[index].body
  const body = old + (old === '' || old.endsWith('\n') ? '' : '\n') + input.text
  const changed = withBody(cards, index, body, now)
  if (changed.error) return changed
  return { cards: changed.cards, text: `追記しました: ${id}（本文 ${body.length} 文字）` }
}

/** remove_card: removes the card with this id; says so when there is none. */
export function applyRemove(cards, input) {
  const { id, error } = idOf(input)
  if (error) return { error }
  if (!cards.some((c) => c.id === id)) return { cards, text: `${id} というカードはありません` }
  const rest = cards.filter((c) => c.id !== id)
  return { cards: rest, text: `削除しました: ${id}（残り ${rest.length} 件）` }
}

/** clear: removes every card. */
export function applyClear(cards) {
  if (cards.length === 0) return { cards, text: 'ボードはすでに空です' }
  return { cards: [], text: `全部で ${cards.length} 件を削除しました` }
}

/**
 * undo_card: a card on the board goes back to its `prev` (title, body, pin, style; its place
 * stays), and the version it had becomes the `prev` (trackPrev), so a second call redoes. A card
 * not on the board is brought back from `removed` (the context's removed cards), at the end, while
 * the limit leaves room, with `prev: { gone: true }`: a second call removes it again (it goes back
 * to the removed cards, so a third brings it back). One level only. `maxCards` as in applySet.
 */
export function applyUndo(cards, input, now, { removed = [], maxCards } = {}) {
  const limit = limitOf(maxCards)
  const { id, error } = idOf(input)
  if (error) return { error }
  const index = cards.findIndex((c) => c.id === id)
  if (index >= 0) {
    const p = cards[index].prev
    if (isGonePrev(p)) {
      const rest = cards.filter((c) => c.id !== id)
      return { cards: rest, text: `戻した ${id} を、もう一度消しました（残り ${rest.length} 件）。もう一度 undo_card を呼ぶと、また戻します` }
    }
    if (!isVersion(p)) return { cards, text: `${id} に戻せる前の版はありません（戻せるのは、最後の書き換えの 1 つ前だけです）` }
    const back = { id, title: p.title, body: p.body, updatedAt: now, ...looksPart(p) }
    return {
      cards: cards.map((c, i) => (i === index ? back : c)),
      text: `${id} を 1 つ前の版に戻しました（全 ${cards.length} 件）。もう一度 undo_card を呼ぶと、戻す前の版にやり直します`,
    }
  }
  const entry = removed.find((c) => c.id === id)
  if (!entry) {
    const others = removed.filter((c) => !cards.some((d) => d.id === c.id)).map((c) => c.id)
    return { cards, text: `${id} というカードはなく、消したカードにもありません` + (others.length > 0 ? `（戻せる消したカード: ${others.join(', ')}）` : '') }
  }
  if (cards.length >= limit) {
    return { error: `カードは ${limit} 枚までで、いっぱいなので ${id} を戻せません。済んだカードを remove_card で消してから、もう一度 undo_card を呼んでください` }
  }
  const back = { id, title: entry.title, body: entry.body, updatedAt: now, ...looksPart(entry), prev: GONE_PREV }
  return { cards: [...cards, back], text: `消したカードを戻しました: ${id}（全 ${cards.length + 1} 件）。もう一度 undo_card を呼ぶと、また消します` }
}

/** What list_cards' search shows of a match: at most this many lines a card, each cut to this many characters. */
export const SEARCH = { matches: 5, text: 120 }

const cut = (line, max) => {
  const chars = [...String(line)]
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : String(line)
}
// What titles_only adds for a card with a checklist: `tasks: "3/5"` (done/total)
const tasksPart = (c) => {
  const { done, total } = taskCounts(c.body)
  return total > 0 ? { tasks: `${done}/${total}` } : {}
}

/** The matches of a card for these (lower-cased) terms: the title or id first (line 0), then the body lines holding any term. */
function matchesOf(card, terms) {
  const out = []
  const holds = (text) => terms.some((t) => text.toLowerCase().includes(t))
  if (holds(card.title) || holds(card.id)) out.push({ line: 0, text: cut(card.title, SEARCH.text) })
  const lines = card.body.split(/\r?\n/)
  for (let i = 0; i < lines.length && out.length < SEARCH.matches; i++) {
    if (holds(lines[i])) out.push({ line: i + 1, text: cut(lines[i], SEARCH.text) })
  }
  return out.slice(0, SEARCH.matches)
}

/** The words of a list_cards query: split on blanks, the empty ones let go. */
export const queryTerms = (query) => (typeof query === 'string' ? query.split(/\s+/).filter((t) => t !== '') : [])

/**
 * list_cards' search: the cards of `cards` (in the order given) holding every one of `terms` in
 * their id, title or body (any case, part of a word will do), each as { id, title, pinned?,
 * style?, matches } (no `matches` with `titlesOnly`). Also used for the other sessions' boards (others.js).
 */
export function searchCards(cards, terms, titlesOnly = false) {
  const lower = terms.map((t) => t.toLowerCase())
  return cards
    .filter((c) => {
      const text = (c.id + '\n' + c.title + '\n' + c.body).toLowerCase()
      return lower.every((t) => text.includes(t))
    })
    .map((c) => ({ id: c.id, title: c.title, ...looksPart(c), ...(titlesOnly ? {} : { matches: matchesOf(c, lower) }) }))
}

/**
 * list_cards, in the order the pane shows the cards (the pinned first). The answer's first line is
 * always the board's revision, `rev: 42` (then `notice`, the read-only line, when there is one).
 * With no argument, every card's id, title and body as JSON (a body may hold any line, so no line
 * format is safe); a pinned card adds `pinned: true`, a card with a style its `style`. Arguments:
 *   id          wins over all the others: that one card, { id, title, body, pinned? }
 *   since       a revision read before: only the cards changed after it (rev > since), after a
 *               line `ids: a, b, c` of every card on the board (a card not there was removed).
 *               With nothing changed, one line says so. A `since` ahead of the board's revision
 *               (from another board, or a board reset) reads every card, with a line saying so.
 *               The two below apply to those cards only.
 *   query       the cards holding every one of its words (split on blanks; in the id, title or body,
 *               any case, part of a word will do), { id, title, pinned?, matches: [{ line, text }] }
 *               (without `matches` when titles_only is there too)
 *   titles_only { id, title, chars (the body's length), pinned?, style?, tasks?, stale? } of every card,
 *               `tasks` ("3/5", done/total) for a card whose body has task-list items, `stale: true`
 *               for a card not written for `staleHours` hours at `now` (stale.js; none when either is absent)
 */
export function applyList(cards, input = {}, { rev = 0, notice = '', now, staleHours = 0 } = {}) {
  const wrong = (name, type) => ({ error: `${name} は${type}で指定してください` })
  if (input.id !== undefined && typeof input.id !== 'string') return wrong('id', '文字列')
  if (input.query !== undefined && typeof input.query !== 'string') return wrong('query', '文字列')
  if (input.titles_only !== undefined && typeof input.titles_only !== 'boolean') return wrong('titles_only', ' true か false')
  if (input.since !== undefined && !isRev(input.since)) return wrong('since', ' 0 以上の整数（前に読んだときの rev）')
  const answer = (...lines) => ({ cards, text: [`rev: ${rev}`, ...(notice !== '' ? [notice] : []), ...lines].join('\n') })
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  if (id !== '') {
    const card = cards.find((c) => c.id === id)
    if (!card) return answer(`${id} というカードはありません`)
    return answer(JSON.stringify({ id: card.id, title: card.title, body: card.body, ...looksPart(card) }))
  }
  if (cards.length === 0) return answer('ボードにカードはありません')
  const ordered = orderedCards(cards)
  // With `since`, the cards changed after it, and the lines above them
  const head = []
  let pool = ordered
  let within = ''
  if (input.since !== undefined) {
    const since = input.since
    if (since === rev) return answer(`rev ${rev} から変更はありません`)
    head.push('ids: ' + ordered.map((c) => c.id).join(', '))
    if (since > rev) {
      head.push(`since ${since} が今の rev より大きいので、全カードを返します`)
    } else {
      pool = ordered.filter((c) => revOf(c) > since)
      if (pool.length === 0) return answer(...head, `rev ${since} の後に書き換えられたカードはありません（ids に無いカードは消されています）`)
      within = `（rev ${since} の後に変わったカードの中）`
    }
  }
  const terms = queryTerms(input.query)
  if (terms.length > 0) {
    const rows = searchCards(pool, terms, input.titles_only === true)
    if (rows.length === 0) return answer(...head, `見つかりませんでした${within}: ${terms.join(' ')}`)
    return answer(...head, JSON.stringify(rows))
  }
  if (input.titles_only === true) {
    const stalePart = (c) => (isStaleCard(c, now, staleHours) ? { stale: true } : {})
    return answer(...head, JSON.stringify(pool.map((c) => ({ id: c.id, title: c.title, chars: c.body.length, ...looksPart(c), ...tasksPart(c), ...stalePart(c) }))))
  }
  return answer(...head, JSON.stringify(pool.map((c) => ({ id: c.id, title: c.title, body: c.body, ...looksPart(c) }))))
}

// ---- The note after a compaction

/** The compaction note's size: at most this many characters in all, a title cut no shorter than `minTitle`. */
export const COMPACTION_NOTE = { chars: 1500, minTitle: 8 }

/**
 * The text added to the summary of a compaction, so the model still knows the board and what is on
 * it: a first line, then `- id: title` for each card in the pane's order (pinned first, marked
 * （固定）). Titles only; they are cut shorter, all alike, until the whole fits COMPACTION_NOTE.chars.
 * `sealed` adds that the board is read-only. At most `maxCards` cards (the setting, maxCardsOf).
 * '' for a board with no cards.
 */
export function compactionNote(cards, { sealed = false, maxCards } = {}) {
  if (!Array.isArray(cards) || cards.length === 0) return ''
  const ordered = orderedCards(cards).slice(0, limitOf(maxCards))
  const head =
    `（whiteboard）このセッションのボードに ${ordered.length} 枚のカードがあります` +
    (sealed ? '（読み取り専用: 別のセッションに引き継がれたため、書き換えはできません）' : '') +
    '。続きの作業で必要なら mcp__whiteboard__list_cards で読めます（id を渡すとその 1 枚の本文）:'
  const lineOf = (c, max) => `- ${c.id}: ${cut(String(c.title).replace(/\s+/g, ' ').trim(), max)}${c.pinned === true ? '（固定）' : ''}`
  let text = ''
  for (let max = LIMITS.title; max >= COMPACTION_NOTE.minTitle; max--) {
    text = [head, ...ordered.map((c) => lineOf(c, max))].join('\n')
    if (text.length <= COMPACTION_NOTE.chars) break
  }
  return text
}

/**
 * Whether a `session.append` row is the summary a compaction leaves, as opposed to its boundary
 * marker: a user row a request carries (the boundary is a `system` notice that no request carries),
 * in the main conversation, with its blocks as a list.
 */
export const isCompactionSummary = (e) =>
  e != null && e.door === 'compaction' && e.agentId === undefined && e.message?.type === 'user' && e.message?.role === 'user' && Array.isArray(e.message?.content)

// ---- The band

/** Character cells a text takes: two for a wide (CJK, full-width) character, one otherwise. */
export function cells(text) {
  let n = 0
  for (const ch of String(text)) {
    const c = ch.codePointAt(0)
    n += c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6)) ? 2 : 1
  }
  return n
}

/** The cells a Button takes: its label in brackets on a terminal, inside a frame elsewhere (an estimate). */
export const buttonCells = (surface, label) => cells(label) + (surface === 'terminal' ? 2 : 4)

/** The line's label, "ホワイトボード 3件" (and "ホワイトボード 0件" while the board is empty). */
export const countLabel = (count) => `${BOARD_NAME} ${count}件`

// The line's last columns, which the terminal may draw over
const RESERVED_COLUMNS = 2

/** The band's label with its hint: "ホワイトボード 0件 · 引き継げます" ("ホワイトボード 3件" with none). */
export const bandLabel = (count, hint = '') => countLabel(count) + (hint !== '' ? ` · ${hint}` : '')

/**
 * What the band draws in `columns`: { hasLabel, label, buttonLabel }. The wide form is the label
 * (the card count, and the hint after it when there is one) and a [開く] button after it. When
 * that does not fit, the button alone, carrying the count only (the hint is let go). With no
 * width known (0, absent), the wide form. The same at any count, 0 included.
 */
export function fitBand({ surface, columns, count, hint = '' }) {
  const label = bandLabel(count, hint)
  const wide = { hasLabel: true, label, buttonLabel: '開く' }
  if (!(typeof columns === 'number' && columns > 0)) return wide
  const room = columns - RESERVED_COLUMNS
  if (cells(label) + 1 + buttonCells(surface, wide.buttonLabel) <= room) return wide
  const short = countLabel(count)
  return { hasLabel: false, label: short, buttonLabel: short }
}

/**
 * The card whose title the band shows: of the pinned cards, the one written last (the greatest
 * updatedAt; on a tie the greater revision, then the later in the list). null when none is pinned.
 */
export function bandCard(cards) {
  let best = null
  for (const c of Array.isArray(cards) ? cards : []) {
    if (c?.pinned !== true || typeof c.title !== 'string') continue
    if (best === null || c.updatedAt > best.updatedAt || (c.updatedAt === best.updatedAt && revOf(c) >= revOf(best))) best = c
  }
  return best
}

/** The band's title: at most `chars` characters (… included); let go when fewer than `minCells` cells are left for it. */
export const BAND_TITLE = { chars: 40, minCells: 6 }

// What goes before the title in the band
const TITLE_LEAD = '· '

// A text cut to `max` cells, … taking the last one
function cutCells(text, max) {
  if (cells(text) <= max) return text
  let out = ''
  for (const ch of text) {
    if (cells(out + ch) + 1 > max) break
    out += ch
  }
  return out + '…'
}

// The band's parts take the room in this order: the label (with its hint) and [開く], then
// `· 更新 N枚`, then `· 古い N枚`, then the pinned card's title with what is left. They are drawn
// in the order label · 更新 · 古い · title · [開く].

// The cells the label, [開く] and the counts as fitted (`recent`, `old`: '' for none) take, gaps included
const takenCells = (fit, surface, recent = '', old = '') =>
  cells(fit.label) + 1 + buttonCells(surface, fit.buttonLabel) + (recent !== '' ? 1 + cells(recent) : 0) + (old !== '' ? 1 + cells(old) : 0)

/**
 * The pinned card's title in the band, drawn as "· title progress" after the label (and its hint)
 * and the counts, before [開く]: { title, progress }, the title on one line, cut to
 * BAND_TITLE.chars and then to the room the line has left after the label, [開く], `· 更新 N枚`
 * (`recent`, fitBandRecent's answer) and `· 古い N枚` (`old`, fitBandStale's answer); the progress
 * is never cut. null when it is let go: no title, the band in its narrow form (the button alone),
 * or fewer than BAND_TITLE.minCells left (a short title that fits is kept). Lowest in priority:
 * the hint and the counts keep their place and the title gives way first. With no width known,
 * the title is only cut to BAND_TITLE.chars.
 */
export function fitBandTitle({ surface, columns, count, hint = '', title, progress = '', recent = '', old = '', shape = '' }) {
  const capped = cut(String(title ?? '').replace(/\s+/g, ' ').trim(), BAND_TITLE.chars)
  if (capped === '') return null
  const fit = fitBand({ surface, columns, count, hint })
  if (!fit.hasLabel) return null
  if (!(typeof columns === 'number' && columns > 0)) return { title: capped, progress }
  // A style's shape (`shape`, the setting styleMarks) and its blank: counted as two cells and one,
  // as the shapes are of ambiguous width and some fonts draw them wide
  const used = takenCells(fit, surface, recent, old) + 1 + cells(TITLE_LEAD) + (shape !== '' ? 3 : 0) + (progress !== '' ? 1 + cells(progress) : 0)
  const left = columns - RESERVED_COLUMNS - used
  if (cells(capped) > left && left < BAND_TITLE.minCells) return null
  return { title: cutCells(capped, left), progress }
}

/** The band's word for the cards changed since the person's latest prompt, `· 更新 2枚`. */
export const recentText = (n) => `· 更新 ${n}枚`

/**
 * The band's `· 更新 N枚` after the label (and its hint): the text, or '' when no card is marked or
 * it does not fit. First after the label and [開く]: drawn only in the wide form and only in the
 * room those two leave, so it never cuts or drops the hint; the stale count and the title take
 * what it leaves. With no width known, drawn.
 */
export function fitBandRecent({ surface, columns, count, hint = '', changed = 0 }) {
  if (!(Number.isSafeInteger(changed) && changed > 0)) return ''
  const fit = fitBand({ surface, columns, count, hint })
  if (!fit.hasLabel) return ''
  const text = recentText(changed)
  if (!(typeof columns === 'number' && columns > 0)) return text
  return takenCells(fit, surface) + 1 + cells(text) <= columns - RESERVED_COLUMNS ? text : ''
}

/**
 * The band's `· 古い N枚` (stale.js) after `· 更新 N枚`: the text, or '' when no card is stale or it
 * does not fit. After 更新: drawn only in the wide form and only in the room the label, [開く] and
 * `· 更新 N枚` as fitted (`recent`, fitBandRecent's answer) leave; the title takes what it leaves.
 * With no width known, drawn.
 */
export function fitBandStale({ surface, columns, count, hint = '', recent = '', stale = 0 }) {
  if (!(Number.isSafeInteger(stale) && stale > 0)) return ''
  const fit = fitBand({ surface, columns, count, hint })
  if (!fit.hasLabel) return ''
  const text = staleText(stale)
  if (!(typeof columns === 'number' && columns > 0)) return text
  return takenCells(fit, surface, recent) + 1 + cells(text) <= columns - RESERVED_COLUMNS ? text : ''
}

/** The local time of a card's last write, `14:05`. */
export function clockOf(ms) {
  const d = new Date(ms)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
