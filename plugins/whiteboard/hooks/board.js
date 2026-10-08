// The board's rules, kept apart from the host calls: what a card is, the limits, how the six
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

/**
 * The cards of a stored value: the well-formed ones, each id once, up to the limit; [] for anything
 * else. `pinned` is kept only as true; any other value is dropped (the card stays, unpinned).
 */
export function sanitizeCards(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const cards = []
  for (const c of value) {
    if (!isCard(c) || seen.has(c.id)) continue
    seen.add(c.id)
    cards.push({ id: c.id, title: c.title, body: c.body, updatedAt: c.updatedAt, ...(c.pinned === true ? { pinned: true } : {}) })
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

/** The cards as the pane shows them: the pinned ones first, then the others; each group in the order added. */
export const orderedCards = (cards) => [...cards.filter((c) => c.pinned === true), ...cards.filter((c) => c.pinned !== true)]

/** set_card: adds a card, or overwrites the one with the same id in place. `pin` fixes it to the top (true), frees it (false), or leaves it as it was (absent). */
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
  if (input.pin !== undefined && typeof input.pin !== 'boolean') return { error: 'pin は true か false で指定してください（省略すると今のまま）' }
  const index = cards.findIndex((c) => c.id === id)
  const was = index >= 0 && cards[index].pinned === true
  const is = input.pin === undefined ? was : input.pin
  const card = { id, title, body, updatedAt: now, ...(is ? { pinned: true } : {}) }
  const pinNote = is === was ? '' : is ? '。固定しました' : '。固定を外しました'
  if (index < 0) {
    if (cards.length >= LIMITS.cards) {
      return { error: `カードは ${LIMITS.cards} 枚までで、いっぱいです。済んだカードを remove_card で消してから追加してください` }
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
  // Title, pin and position stay; only the body and the time change
  return { cards: cards.map((c, i) => (i === index ? { ...c, body, updatedAt: now } : c)) }
}

const noCardText = (id) => `${id} というカードはありません。set_card で作ってください`

/**
 * edit_card: replaces `find` in the card's body with `replace`. Like an editor's replace: it
 * must match in exactly one place, unless `all` is true (every place). A `find` that is nowhere
 * in the body, or in several places without `all`, is refused. `replace` may be empty (deletes).
 */
export function applyEdit(cards, input, now) {
  const { id, error } = idOf(input)
  if (error) return { error }
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
  return { cards: changed.cards, text: `編集しました: ${id}（${input.all === true ? found : 1} 箇所）` }
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

/** What list_cards' search shows of a match: at most this many lines a card, each cut to this many characters. */
export const SEARCH = { matches: 5, text: 120 }

const cut = (line, max) => {
  const chars = [...String(line)]
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : String(line)
}
const pinnedPart = (c) => (c.pinned === true ? { pinned: true } : {})

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

/**
 * list_cards, in the order the pane shows the cards (the pinned first). With no argument, every
 * card's id, title and body as JSON (a body may hold any line, so no line format is safe); a
 * pinned card adds `pinned: true`. Arguments narrow it, the first that applies winning:
 *   id          that one card, { id, title, body, pinned? }
 *   query       the cards holding every one of its words (split on blanks; in the id, title or body,
 *               any case, part of a word will do), { id, title, pinned?, matches: [{ line, text }] }
 *               (without `matches` when titles_only is there too)
 *   titles_only { id, title, chars (the body's length), pinned? } of every card
 */
export function applyList(cards, input = {}) {
  const wrong = (name, type) => ({ error: `${name} は${type}で指定してください` })
  if (input.id !== undefined && typeof input.id !== 'string') return wrong('id', '文字列')
  if (input.query !== undefined && typeof input.query !== 'string') return wrong('query', '文字列')
  if (input.titles_only !== undefined && typeof input.titles_only !== 'boolean') return wrong('titles_only', ' true か false')
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  if (id !== '') {
    const card = cards.find((c) => c.id === id)
    if (!card) return { cards, text: `${id} というカードはありません` }
    return { cards, text: JSON.stringify({ id: card.id, title: card.title, body: card.body, ...pinnedPart(card) }) }
  }
  if (cards.length === 0) return { cards, text: 'ボードにカードはありません' }
  const ordered = orderedCards(cards)
  const terms = typeof input.query === 'string' ? input.query.split(/\s+/).filter((t) => t !== '') : []
  if (terms.length > 0) {
    const lower = terms.map((t) => t.toLowerCase())
    const found = ordered.filter((c) => {
      const text = (c.id + '\n' + c.title + '\n' + c.body).toLowerCase()
      return lower.every((t) => text.includes(t))
    })
    if (found.length === 0) return { cards, text: `見つかりませんでした: ${terms.join(' ')}` }
    const rows = found.map((c) => ({ id: c.id, title: c.title, ...pinnedPart(c), ...(input.titles_only === true ? {} : { matches: matchesOf(c, lower) }) }))
    return { cards, text: JSON.stringify(rows) }
  }
  if (input.titles_only === true) {
    return { cards, text: JSON.stringify(ordered.map((c) => ({ id: c.id, title: c.title, chars: c.body.length, ...pinnedPart(c) }))) }
  }
  return { cards, text: JSON.stringify(ordered.map((c) => ({ id: c.id, title: c.title, body: c.body, ...pinnedPart(c) }))) }
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

/** The line's label, "ボード 3件" (and "ボード 0件" while the board is empty). */
export const countLabel = (count) => `ボード ${count}件`

// The line's last columns, which the terminal may draw over
const RESERVED_COLUMNS = 2

/**
 * What the band draws in `columns`: { hasLabel, label, buttonLabel }. The wide form is the label
 * (the card count) and a [開く] button after it. When that does not fit, the button alone,
 * carrying the label. With no width known (0, absent), the wide form. The same at any count,
 * 0 included.
 */
export function fitBand({ surface, columns, count }) {
  const label = countLabel(count)
  const wide = { hasLabel: true, label, buttonLabel: '開く' }
  if (!(typeof columns === 'number' && columns > 0)) return wide
  const room = columns - RESERVED_COLUMNS
  if (cells(label) + 1 + buttonCells(surface, wide.buttonLabel) <= room) return wide
  return { hasLabel: false, label, buttonLabel: label }
}

/** The local time of a card's last write, `14:05`. */
export function clockOf(ms) {
  const d = new Date(ms)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
