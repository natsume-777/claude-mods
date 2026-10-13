// The small state values as $.state holds them (`attached`, `view`, `boards`, `root`, `about`): what
// a drawing or a press reads of each, a value of an older shape filled with the defaults (pure)

import { NO_BOARDS } from './shelf.js'

// The view with no board opened in the list, the list of other boards closed, its groups folded,
// and the name not being edited; the fields it leaves out are kept by a patch
export const NO_VIEW = { pick: '', shown: false, groups: { others: false, old: false }, rename: false }

const objectOr = (value, fallback) => (value != null && typeof value === 'object' && !Array.isArray(value) ? value : fallback)
const textOr = (value, fallback) => (typeof value === 'string' && value !== '' ? value : fallback)

// `attached`: the board the session `owner` is attached to ({ board, name, stamp }, board null for
// none, stamp the meta's time of the last write as read), or null when the value is another
// session's or not there (the store is read then)
export function attachedOf(value, me) {
  const v = objectOr(value, null)
  if (v === null || v.owner !== me) return null
  return { board: textOr(v.board, null), name: textOr(v.name, ''), stamp: typeof v.stamp === 'number' ? v.stamp : 0 }
}

// `view`: the board opened in the list, whether the list is shown over the cards, the groups
// unfolded, whether the name is being edited (and the editor's key), with the fold choices
// (fold.js), the search field's text and key (search.js) and the order (order.js) riding along,
// so a patch of the other fields keeps them
export function viewOf(value) {
  const v = objectOr(value, {})
  const g = objectOr(v.groups, {})
  return {
    pick: typeof v.pick === 'string' ? v.pick : '',
    shown: v.shown === true,
    groups: { others: g.others === true, old: g.old === true },
    rename: v.rename === true,
    renameGen: Number.isSafeInteger(v.renameGen) && v.renameGen >= 0 ? v.renameGen : 0,
    folds: objectOr(v.folds, null),
    filter: objectOr(v.filter, null),
    order: objectOr(v.order, null),
    searchGen: Number.isSafeInteger(v.searchGen) && v.searchGen >= 0 ? v.searchGen : 0,
  }
}

// `boards`: the list (shelf.js scanBoards' rows), the store's size and the sign of the metas read;
// a row of an older shape is left out rather than drawn wrong
export function boardsOf(value, me) {
  const v = objectOr(value, null)
  if (v === null || !Array.isArray(v.rows)) return NO_BOARDS
  return {
    owner: textOr(v.owner, ''),
    rows: v.rows.filter((r) => r != null && typeof r.id === 'string' && typeof r.name === 'string' && Array.isArray(r.titles)),
    bytes: typeof v.bytes === 'number' ? v.bytes : 0,
    sig: typeof v.sig === 'string' ? v.sig : '',
  }
}

// `root`: the session root as the session `owner` first saw it ({ name, hash }), or null
export function rootValueOf(value, me) {
  const v = objectOr(value, null)
  if (v === null || v.owner !== me || typeof v.name !== 'string') return null
  return { name: v.name, hash: typeof v.hash === 'string' ? v.hash : null }
}

// `about`: what the session `owner` is about ({ title, firstPrompt }, each null when not known)
export function aboutOf(value, me) {
  const v = objectOr(value, null)
  if (v === null || v.owner !== me) return { title: null, firstPrompt: null }
  return { title: textOr(v.title, null), firstPrompt: textOr(v.firstPrompt, null) }
}
