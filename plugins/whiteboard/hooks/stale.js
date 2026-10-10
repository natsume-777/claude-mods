// Cards that have gone stale: not pinned and not written for `staleHours` hours (the setting;
// 0 turns it off). The pane marks them with a dim 古い and draws their title dim, the band counts
// them (`· 古い N枚`, the first part to go on a narrow line), and list_cards' titles_only adds
// `stale: true`. Nothing is ever removed for it: the person (or Claude, when asked) decides.
// Pure: no $ here. The mark is worked out at each drawing from the clock's time; there is no timer,
// so it shows at the next redraw (a write, the person's next prompt, the pane opened again).

/** The setting's default: three hours. */
export const STALE_DEFAULT_HOURS = 3

const HOUR_MS = 60 * 60 * 1000

/**
 * The setting `staleHours` from register()'s options: a number of hours (a fraction will do), or
 * the same written as a string ("3", " 1.5 "). 0 turns the mark off. Anything else (absent, empty,
 * negative, not a number) is the default.
 */
export function staleHoursOf(options) {
  const raw = options?.staleHours
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : NaN
  return Number.isFinite(n) && n >= 0 ? n : STALE_DEFAULT_HOURS
}

/**
 * Whether a card is stale at `now`: the mark is on (`hours` > 0), the card is not pinned, not
 * marked 新規 / 更新 in the current turn (`marked`), and the later of its last write and the time it
 * came in by a hand-over (`arrivedAt`, boards.js planHandover) is more than `hours` hours before
 * `now`. So a card taken over from an old board is fresh on arrival, while it keeps its own time
 * for display. A card or a time that cannot be read is never stale.
 */
export function isStaleCard(card, now, hours, marked = false) {
  if (!(typeof hours === 'number' && hours > 0) || marked) return false
  if (card == null || card.pinned === true || typeof card.updatedAt !== 'number' || typeof now !== 'number') return false
  const since = typeof card.arrivedAt === 'number' ? Math.max(card.updatedAt, card.arrivedAt) : card.updatedAt
  return now - since > hours * HOUR_MS
}

/** How many of the cards are stale; `marks` are the current turn's marks by id (recent.js). */
export const staleCount = (cards, now, hours, marks = {}) =>
  Array.isArray(cards) ? cards.filter((c) => isStaleCard(c, now, hours, marks[c?.id] !== undefined)).length : 0

/** The pane's word in a stale card's header. */
export const STALE_LABEL = '古い'

/** The band's word for the stale cards, `· 古い 2枚`. */
export const staleText = (n) => `· 古い ${n}枚`
