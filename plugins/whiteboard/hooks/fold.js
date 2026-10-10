// Long cards folded in the pane (pure). A view only: the cards are never changed, the pane just
// shows the first lines of a long body and a button that opens the rest.
//
// A body is long past FOLD.lines lines (blank lines at its end not counted). Where the pane draws
// pictures (`pictures`: not the terminal), a mermaid fence that mermaid.js can draw counts as one
// line, a picture being compact; a fence it cannot draw stays code and counts its source lines. A
// folded card shows at most FOLD.preview source lines, cut at a line boundary that is never inside
// a fenced code block: a fence that crosses the cut moves the cut to just before the fence (a fence
// closed before it stays whole). A cut that would leave nothing to show does not fold at all: the
// card is drawn whole, with no button.
//
// Whether a long card is folded: what the person chose with the button, else unfolded for a
// pinned card (people pin what they want to see) and folded for the rest. A card Claude changed
// in the current turn (recent.js) is shown unfolded so the change is seen, unless the person
// folded it again after that write (the choice keeps the card's revision, `rev`, it was made at;
// every write that changes a card moves it on). The choices live in the view state for the
// session (`folds`: { owner, cards: { id: { open, rev } } }); every write to the board lets go of
// the choices of cards no longer on it (foldsKept), so a new card under a removed one's id starts
// afresh.

import { mermaidSvg } from './mermaid.js'

export const FOLD = { lines: 12, preview: 6 }

// The body's lines: CRLF read as LF, the blank lines at the end left off
function linesOf(body) {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n')
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  return lines
}

// The fenced code blocks of `lines` as { first, last, picture } (line indexes). A fence opens with
// three or more backticks or tildes (up to three spaces before; a backtick fence's info string has
// no backtick) and closes with a run of the same character at least as long; one never closed runs
// to the end, as Markdown reads it. `picture` is true for a closed ```mermaid fence that mermaid.js
// can draw, when `pictures` is on.
function fencesOf(lines, pictures = false) {
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i])
    if (!open || (open[1][0] === '`' && open[2].includes('`'))) {
      i++
      continue
    }
    const fence = open[1]
    let last = lines.length - 1
    let closed = false
    for (let j = i + 1; j < lines.length; j++) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[j])
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
        last = j
        closed = true
        break
      }
    }
    const picture = pictures && closed && open[2].trim().toLowerCase() === 'mermaid' && mermaidSvg(lines.slice(i + 1, last).join('\n')) !== null
    blocks.push({ first: i, last, picture })
    i = last + 1
  }
  return blocks
}

// The lines a run of fences saves when each picture counts as one line
const savedBy = (blocks) => blocks.reduce((n, b) => n + (b.picture ? b.last - b.first : 0), 0)

/**
 * The lines of a body, as the fold counts them. With `pictures` (the pane draws them), a mermaid
 * fence that can be drawn counts as one line.
 */
export function bodyLines(body, { pictures = false } = {}) {
  const lines = linesOf(body)
  return lines.length - savedBy(fencesOf(lines, pictures))
}

/** True for a body long enough to fold (bodyLines past FOLD.lines). */
export const isLong = (body, options = {}) => bodyLines(body, options) > FOLD.lines

/**
 * The folded view of a body: `text`, the lines shown ('' for none), and `remaining`, the lines
 * left out (the button's count; with `pictures`, a drawable mermaid fence left out counts as one).
 */
export function foldCut(body, { pictures = false } = {}) {
  const lines = linesOf(body)
  const blocks = fencesOf(lines, pictures)
  let cut = Math.min(FOLD.preview, lines.length)
  for (const { first, last } of blocks) {
    if (first >= cut) break
    if (last >= cut) {
      cut = first
      break
    }
  }
  const shown = lines.slice(0, cut)
  while (shown.length > 0 && shown[shown.length - 1].trim() === '') shown.pop()
  return { text: shown.join('\n'), remaining: lines.length - cut - savedBy(blocks.filter((b) => b.first >= cut)) }
}

/** Whether a body folds at all: long, and its folded view leaves something to show. */
export const isFoldable = (body, options = {}) => isLong(body, options) && foldCut(body, options).text.trim() !== ''

/** A card's revision as a choice keeps it (0 for a card written before revisions existed). */
export const revOfCard = (card) => (typeof card.rev === 'number' ? card.rev : 0)

/**
 * Whether `card` is drawn folded: never when its body does not fold (isFoldable, with `options`
 * { pictures }); else the person's `choice` ({ open, rev } or undefined), which a card `marked` in
 * the current turn takes only when it was made after the card's latest write; else unfolded when
 * marked or pinned, folded otherwise.
 */
export function isFolded(card, choice, marked, options = {}) {
  if (!isFoldable(card.body, options)) return false
  if (choice && (!marked || choice.rev === revOfCard(card))) return !choice.open
  if (marked) return false
  return card.pinned !== true
}

const isChoice = (c) => c != null && typeof c === 'object' && typeof c.open === 'boolean' && typeof c.rev === 'number'

/** The choices of the session `me` from the view state's `folds` value; {} for none or another session's. */
export function foldsOf(value, me) {
  if (value == null || typeof value !== 'object' || value.owner !== me) return {}
  const cards = value.cards != null && typeof value.cards === 'object' ? value.cards : {}
  const out = {}
  for (const [id, c] of Object.entries(cards)) if (isChoice(c)) out[id] = { open: c.open, rev: c.rev }
  return out
}

/**
 * The `folds` value with only the choices of the cards in `ids` (the cards on the board), so a
 * removed card's choice goes and a later card under the same id starts afresh. null for no value.
 */
export function foldsKept(value, me, ids) {
  if (value == null || typeof value !== 'object') return null
  const keep = new Set(ids)
  const cards = {}
  for (const [k, c] of Object.entries(foldsOf(value, me))) if (keep.has(k)) cards[k] = c
  return { owner: me, cards }
}

/**
 * The `folds` value after the person chose `open` for the card `id` (at its revision `rev`). Only
 * the cards in `ids` (the ones the pane drew) keep their choices, so a removed card's goes.
 */
export function foldsAfter(value, me, id, open, rev, ids) {
  const keep = new Set(ids)
  const cards = {}
  for (const [k, c] of Object.entries(foldsOf(value, me))) if (keep.has(k)) cards[k] = c
  cards[id] = { open, rev }
  return { owner: me, cards }
}

/** The button's label: the lines left out on a folded card, 畳む on an open one. */
export const foldLabel = (folded, remaining) => (folded ? `続きを表示（残り ${remaining} 行）` : '畳む')
