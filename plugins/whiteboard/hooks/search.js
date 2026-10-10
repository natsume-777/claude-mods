// The pane's search field (pure): the person narrows the cards drawn by words, the view only.
// Nothing about the cards changes and nothing is stored: the text lives in the view state for the
// session (`filter`: { owner, text }), so after /clear (another session id) it reads as none.
//
// The field is drawn only when there are SEARCH_MIN cards or more (fewer need no search) and the
// surface draws an Input (not the mobile app). The filter applies only while the field is drawn, so it never hides cards
// with no field to undo it; it is let go when the pane is opened and when the board falls below
// SEARCH_MIN cards (register.js), so an old filter does not come back unnoticed. The words are split as list_cards' query splits them (board.js
// queryTerms) and matched much as its searchCards does (every word, any case, part of a word), but in
// the title and body only: the pane does not show a card's id, so a card must not match on a word the
// person cannot see.

import { queryTerms } from './board.js'

/** The fewest cards that bring the search field. */
export const SEARCH_MIN = 6

/** The field's placeholder, the clear button's label, the line when nothing matches. */
export const SEARCH_PLACEHOLDER = 'カードを絞り込む（語を空白で区切る）'
export const SEARCH_CLEAR = '絞り込みを解く'
export const SEARCH_NONE = '一致するカードはありません'

/** The dim line under the field while it narrows: all the cards, then the ones drawn. */
export const searchCount = (total, shown) => `${total} 件中 ${shown} 件`

/** The text of the session `me` from the view state's `filter` value; '' for none or another session's. */
export function filterOf(value, me) {
  if (value == null || typeof value !== 'object' || value.owner !== me) return ''
  return typeof value.text === 'string' ? value.text : ''
}

/** The `filter` value after the person typed `text`. Kept as typed (not trimmed); null once it is empty. */
export const filterAfter = (me, text) => (typeof text === 'string' && text !== '' ? { owner: me, text } : null)

// The surfaces that draw no Input field. The mobile app's element table still hands out an Input,
// but it draws as an empty Box there, so the surface is named rather than the table looked at.
const NO_INPUT = new Set(['mobile'])

// The field owns its text: it is drawn with no `value`, since a drawing that hands back what was
// typed a moment ago would put the field back to it and lose the keys typed since. To empty it the
// field is drawn under a new key (`searchGen` in the view, moved on at each clear), so it starts
// again empty.

/** The field's key for the view's `searchGen`: `search-input`, then `search-input-1` and on. */
export const inputKey = (gen) => (Number.isSafeInteger(gen) && gen > 0 ? 'search-input-' + gen : 'search-input')

/** The view with the filter let go and the field drawn anew (a new key); the same view when there is no filter. */
export const filterCleared = (view) => (view.filter == null ? view : { ...view, filter: null, searchGen: (Number.isSafeInteger(view.searchGen) ? view.searchGen : 0) + 1 })

/** Whether the pane draws the field: enough cards, and an Input the surface draws. */
export const hasSearch = (cards, ui, surface) =>
  Array.isArray(cards) && cards.length >= SEARCH_MIN && typeof ui?.Input === 'function' && !NO_INPUT.has(surface)

/** Whether `text` narrows at all: one word or more. */
export const isFiltering = (text) => queryTerms(text).length > 0

/** The cards of `cards` (in their order) holding every word of `text` in their title or body; all of them for no word. */
export function filterCards(cards, text) {
  const terms = queryTerms(text).map((t) => t.toLowerCase())
  if (terms.length === 0) return cards
  return cards.filter((c) => {
    const seen = (c.title + '\n' + c.body).toLowerCase()
    return terms.every((t) => seen.includes(t))
  })
}
