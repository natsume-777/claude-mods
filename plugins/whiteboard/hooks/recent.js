// Which cards Claude changed since the person's latest prompt (pure: no $ here).
//
// The person's prompts count turns: each one moves the counter on (`turn` in $.state, with the
// session it belongs to). A tool write that changes a card marks it for the current turn: a card
// that was not on the board before the turn's first write to it is new, any other changed. A
// changed card also keeps the body it had before that first write (its base), so the line count
// sums the whole turn, not only the last write. The marks live in the load and are mirrored into
// $.state (`recent`, without the bases) for the drawings; the drawings show them only while their
// turn is the current one, so the next prompt clears them without a write. A counter that is not
// there (never set, or lost) means no marks: nothing is marked and nothing is shown.

import { sameContent } from './board.js'

// The `source` of a classic UserPromptSubmit that counts as the person's own prompt: the composer
// (`user`), an SDK host's turn (`sdk`), or none (older payloads). Whether the desktop app sends
// `sdk` for the person's prompts is not verified; it is accepted so that they count if it does.
const PERSON_SOURCES = new Set(['user', 'sdk'])

/**
 * Whether a classic UserPromptSubmit is the person's own prompt (not a wake-up, a notification or
 * an enqueue pass). One rule for every use: the turns of the marks, the first request kept for the
 * meta, and the guide's lines.
 */
export const isPersonPrompt = (e) => e != null && (e.source === undefined || PERSON_SOURCES.has(e.source))

const isTurn = (n) => Number.isSafeInteger(n) && n > 0

/** The current turn of the `turn` state value for the session `owner`; null when there is none. */
export function readTurn(value, owner) {
  if (value == null || typeof value !== 'object' || value.owner !== owner || !isTurn(value.n)) return null
  return value.n
}

/** The `turn` state value after a prompt: one more than this session's, 1 when there is none. */
export const turnAfter = (value, owner) => ({ owner, n: (readTurn(value, owner) ?? 0) + 1 })

// ---- The line count

// A body's lines; a last newline ends the last line rather than starting an empty one
function linesOf(text) {
  const s = String(text ?? '')
  if (s === '') return []
  const lines = s.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

// Above this many cells (lines before x lines after, once the common ends are cut), the lines are
// matched as multisets rather than in order
const LCS_CELLS = 250_000

// The length of the longest common subsequence of two lists of lines
function lcsLength(a, b) {
  const row = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    let diag = 0
    for (let j = 1; j <= b.length; j++) {
      const up = row[j]
      row[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(row[j], row[j - 1])
      diag = up
    }
  }
  return row[b.length]
}

// How many lines the two lists share, order not looked at
function sharedCount(a, b) {
  const counts = new Map()
  for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1)
  let shared = 0
  for (const line of b) {
    const n = counts.get(line) ?? 0
    if (n > 0) {
      shared++
      counts.set(line, n - 1)
    }
  }
  return shared
}

/**
 * The lines added and removed from `before` to `after`: { added, removed }. A changed line counts
 * as one removed and one added. The lines the two share at their start and end are cut first, the
 * rest matched in order (a longest common subsequence), or as multisets when that would be large.
 */
export function lineDiff(before, after) {
  const a = linesOf(before)
  const b = linesOf(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const x = a.slice(start, endA)
  const y = b.slice(start, endB)
  const common = x.length === 0 || y.length === 0 ? 0 : x.length * y.length <= LCS_CELLS ? lcsLength(x, y) : sharedCount(x, y)
  return { added: y.length - common, removed: x.length - common }
}

// ---- The marks: { [card id]: { base, added, removed } }, base null for a new card (no counts),
// else the card as it was before the turn's first write to it ({ title, body, pinned, style })

// A card's version as a base keeps it
const baseOf = (c) => ({ title: c.title, body: c.body, pinned: c.pinned === true, style: c.style ?? null })

/**
 * The marks after a write that turned `before` into `after`: each card that is new or says
 * something else than it did is marked. A card marked earlier in the turn keeps its base, so its
 * counts compare the body before the turn's first write with the body now, and a card that says
 * again what its base said (undone back to the turn's start) loses its mark; a base not known
 * (undefined, marks taken back from the state after a reload) falls back to the card before this
 * write. Marks of cards that are gone stay (a card removed and brought back in the same turn keeps
 * its base). The same object when nothing changed.
 */
export function markWrite(marks, before, after) {
  const was = new Map(before.map((c) => [c.id, c]))
  let next = marks
  const put = (id, mark) => {
    if (next === marks) next = { ...marks }
    if (mark === undefined) delete next[id]
    else next[id] = mark
  }
  for (const c of after) {
    const old = was.get(c.id)
    if (old && sameContent(old, c)) continue
    const had = marks[c.id]
    const base = had !== undefined && had.base !== undefined ? had.base : old ? baseOf(old) : null
    if (base !== null && sameContent(base, c)) {
      if (had !== undefined) put(c.id, undefined)
      continue
    }
    put(c.id, base === null ? { base: null } : { base, ...lineDiff(base.body, c.body) })
  }
  return next
}

/** The marks as $.state keeps them for the drawings: { kind: 'new' } or { kind: 'changed', added, removed }, no bases. */
export function shownMarks(marks) {
  const out = {}
  for (const [id, m] of Object.entries(marks)) out[id] = m.base === null ? { kind: 'new' } : { kind: 'changed', added: m.added, removed: m.removed }
  return out
}

const isCount = (n) => Number.isSafeInteger(n) && n >= 0

// A state mark that is well-formed, else null
function readMark(m) {
  if (m == null || typeof m !== 'object') return null
  if (m.kind === 'new') return { kind: 'new' }
  if (m.kind === 'changed' && isCount(m.added) && isCount(m.removed)) return { kind: 'changed', added: m.added, removed: m.removed }
  return null
}

/**
 * The marks of the `recent` state value when it is this session's and of the turn `turn`, else {}.
 * Entries of another shape are left out.
 */
export function marksOf(value, owner, turn) {
  if (turn === null || value == null || typeof value !== 'object' || value.owner !== owner || value.turn !== turn) return {}
  const cards = value.cards
  if (cards == null || typeof cards !== 'object' || Array.isArray(cards)) return {}
  const out = {}
  for (const [id, m] of Object.entries(cards)) {
    const mark = readMark(m)
    if (mark !== null) out[id] = mark
  }
  return out
}

/** The load's marks taken back from the state (after a reload): new ones keep base null, changed ones an unknown base. */
export function seedMarks(shown) {
  const out = {}
  for (const [id, m] of Object.entries(shown)) out[id] = m.kind === 'new' ? { base: null } : { base: undefined, added: m.added, removed: m.removed }
  return out
}

/** How many of the cards on the board are marked. */
export const markedCount = (marks, cards) => (Array.isArray(cards) ? cards.filter((c) => marks[c?.id] !== undefined).length : 0)

/** The header's word for a mark: 新規 or 更新; '' for none. */
export const markLabel = (mark) => (mark == null ? '' : mark.kind === 'new' ? '新規' : '更新')

/** The line under the header of a changed card, `+3 −1 行`; '' for a new card, none, or a change that moved no line. */
export function diffLine(mark) {
  if (mark?.kind !== 'changed' || mark.added + mark.removed === 0) return ''
  return `+${mark.added} −${mark.removed} 行`
}
