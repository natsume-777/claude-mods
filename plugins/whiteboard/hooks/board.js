// The board's rules, kept apart from the host calls: what a card is, the limits, how the four
// tools change a list of cards and what they answer, and how the band fits a narrow line.
// Pure: no $ here, so register.js keeps every $ call itself.

/** What the board holds at most; a call over a limit is refused with the reason. */
export const LIMITS = {
  cards: 20,
  id: 40,
  title: 60,
  body: 4000,
}

/** Ids are short and plain, so Claude can name a card again without guessing at its spelling. */
export const ID_PATTERN = /^[A-Za-z0-9_-]+$/

/** The $.store key a session's cards are kept under. */
export const storeKey = (sessionId) => 'board:' + sessionId

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

/** The cards of a stored value: the well-formed ones, each id once, up to the limit; [] for anything else. */
export function sanitizeCards(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const cards = []
  for (const c of value) {
    if (!isCard(c) || seen.has(c.id)) continue
    seen.add(c.id)
    cards.push({ id: c.id, title: c.title, body: c.body, updatedAt: c.updatedAt })
    if (cards.length >= LIMITS.cards) break
  }
  return cards
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

/** set_card: adds a card, or overwrites the one with the same id in place. */
export function applySet(cards, input, now) {
  const { id, error } = idOf(input)
  if (error) return { error }
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (title === '') return { error: 'title が空です。カードの見出しを指定してください' }
  if (title.length > LIMITS.title) return { error: `title は ${LIMITS.title} 文字までです（受け取ったのは ${title.length} 文字）。短くしてください` }
  const body = typeof input.body === 'string' ? input.body : ''
  if (body.length > LIMITS.body) {
    return { error: `body は ${LIMITS.body} 文字までです（受け取ったのは ${body.length} 文字）。要点に絞るか、カードを分けてください` }
  }
  const card = { id, title, body, updatedAt: now }
  const index = cards.findIndex((c) => c.id === id)
  if (index < 0) {
    if (cards.length >= LIMITS.cards) {
      return { error: `カードは ${LIMITS.cards} 枚までで、いっぱいです。済んだカードを remove_card で消してから追加してください` }
    }
    return { cards: [...cards, card], text: `追加しました: ${id}（全 ${cards.length + 1} 件）` }
  }
  return { cards: cards.map((c, i) => (i === index ? card : c)), text: `上書きしました: ${id}（全 ${cards.length} 件）` }
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

/** list_cards: every card's id, title and body, as JSON (a body may hold any line, so no line format is safe). */
export function applyList(cards) {
  if (cards.length === 0) return { cards, text: 'ボードにカードはありません' }
  return { cards, text: JSON.stringify(cards.map(({ id, title, body }) => ({ id, title, body }))) }
}

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

/** The card count's part of the line's label, "ボード 3件". */
export const countLabel = (count) => `ボード ${count}件`

/** The running subagents' part of the line's label, "実行中 2". */
export const runningLabel = (running) => `実行中 ${running}`

/** The line's label: the card count and the running count, each left out at 0 ("ボード 3件 · 実行中 2"). */
export const bandLabel = (count, running = 0) =>
  [count > 0 ? countLabel(count) : '', running > 0 ? runningLabel(running) : ''].filter((s) => s !== '').join(' · ')

// The line's last columns, which the terminal may draw over
const RESERVED_COLUMNS = 2

/**
 * What the band draws in `columns`: { hasLabel, label, buttonLabel }. The wide form is the label
 * (the card count and the running count) and a [開く] button after it. When that does not fit,
 * the button alone, carrying the whole label; when even that does not fit, carrying the running
 * count alone if there is one (it changes while the person looks), else the card count. With no
 * width known (0, absent), the wide form.
 */
export function fitBand({ surface, columns, count, running = 0 }) {
  const label = bandLabel(count, running)
  const wide = { hasLabel: true, label, buttonLabel: '開く' }
  if (!(typeof columns === 'number' && columns > 0)) return wide
  const room = columns - RESERVED_COLUMNS
  if (cells(label) + 1 + buttonCells(surface, wide.buttonLabel) <= room) return wide
  if (buttonCells(surface, label) <= room) return { hasLabel: false, label, buttonLabel: label }
  return { hasLabel: false, label, buttonLabel: running > 0 ? runningLabel(running) : countLabel(count) }
}

/** The local time of a card's last write, `14:05`. */
export function clockOf(ms) {
  const d = new Date(ms)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
