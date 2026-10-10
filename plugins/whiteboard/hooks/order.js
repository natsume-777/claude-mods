// The order of the cards in the pane (pure): the order they were added (the default), or the
// latest write first. A view only: the cards and their order on the board are never changed. The
// pinned cards come first in both orders; within the pinned and within the rest, the second order
// sorts by `updatedAt`, newest first, cards written at the same moment keeping the added order.
//
// The choice lives in the view state for the session (`order`: { owner, by }), so after /clear
// (another session id) it reads as the default, like the fold choices. The button is drawn with
// ORDER_MIN cards or more; with fewer the pane draws the added order whatever was chosen.

import { orderedCards } from './board.js'

/** The fewest cards that bring the order button. */
export const ORDER_MIN = 3

/** The button's label for each order: it names the order drawn now, a press switches it. */
export const ORDER_LABELS = { added: '並び: 追加順', updated: '並び: 更新の新しい順' }

/** The order of the session `me` from the view state's `order` value: 'updated', else 'added'. */
export const orderOf = (value, me) => (value != null && typeof value === 'object' && value.owner === me && value.by === 'updated' ? 'updated' : 'added')

/** The `order` value for the order `by`; null for the default. */
export const orderAfter = (me, by) => (by === 'updated' ? { owner: me, by: 'updated' } : null)

/** Whether the pane draws the button. */
export const hasOrder = (cards) => Array.isArray(cards) && cards.length >= ORDER_MIN

const timeOf = (card) => (typeof card.updatedAt === 'number' ? card.updatedAt : 0)

/** The cards as the pane draws them in the order `by`: the pinned first, then the rest. */
export function sortCards(cards, by) {
  const ordered = orderedCards(cards)
  if (by !== 'updated') return ordered
  const newest = (list) => [...list].sort((a, b) => timeOf(b) - timeOf(a))
  return [...newest(ordered.filter((c) => c.pinned === true)), ...newest(ordered.filter((c) => c.pinned !== true))]
}
