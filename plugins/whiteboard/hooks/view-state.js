// The small state values as $.state holds them (`handover`, `view`, `others`): what a drawing or a
// press reads of each, a value of an older shape filled with the defaults (pure)

import { NO_OTHERS } from './shelf.js'

// The view with no board open and no confirmation step; the fields it leaves out are kept by a patch
export const NO_VIEW = { pick: '', shown: false, confirm: null }

const objectOr = (value, fallback) => (value != null && typeof value === 'object' && !Array.isArray(value) ? value : fallback)

// `handover`: { sealed, from, last }
export function handoverOf(value) {
  const v = objectOr(value, {})
  return { sealed: objectOr(v.sealed, null), from: objectOr(v.from, null), last: objectOr(v.last, null) }
}

// `view`: the board open in the list and the confirmation step, with the fold choices (fold.js),
// the search field's text and key (search.js) and the order (order.js) riding along, so a patch
// of the other fields keeps them
export function viewOf(value) {
  const v = objectOr(value, {})
  return {
    pick: typeof v.pick === 'string' ? v.pick : '',
    shown: v.shown === true,
    confirm: objectOr(v.confirm, null),
    folds: objectOr(v.folds, null),
    filter: objectOr(v.filter, null),
    order: objectOr(v.order, null),
    searchGen: Number.isSafeInteger(v.searchGen) && v.searchGen >= 0 ? v.searchGen : 0,
  }
}

// `others`: the other sessions' boards (shelf.js othersOf); a row of an older shape (no title
// list) is left out rather than drawn wrong
export function othersValueOf(value) {
  if (value == null || typeof value !== 'object' || !Array.isArray(value.boards)) return NO_OTHERS
  return { ...NO_OTHERS, ...value, boards: value.boards.filter((b) => b != null && Array.isArray(b.allTitles)) }
}
