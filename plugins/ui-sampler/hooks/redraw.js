// When a hook's new call or new props are worth redrawing the pane for.
//
// $.ui.invalidate('ui.render') redraws every render site of this plugin: the whole pane (its
// Buttons replaced, which can lose a press in flight), the band, every transcript row it
// labels. The Spinner's props can change many times while a turn runs, so a redraw per
// change keeps the pane redrawing for the whole turn. So a hook asks here first, and redraws
// only when the pane's last drawing showed what changed:
//   - a site's first call (or a new surface): when the pane shows the site's category, whose
//     list has the site's count
//   - new props or a new event input: when the pane shows that site's [詳細] card, at most
//     once per REDRAW_GAP_MS across all sites
// Anything else waits for the next drawing; [回数を更新] draws the pane again on request.
// The values view (values.js) needs no invalidate: it reads what it shows from $.state, so a
// write redraws it only while it is the drawing that read it.
//
// Pure: no $ here, so the hook files keep every $ call themselves. The pane's drawings write
// what they show into module variables, since $.state.set is refused while drawing.

import { siteOf } from './sites.js'

/** The shortest time between two redraws asked for because props changed. */
export const REDRAW_GAP_MS = 2000

// What the main pane showed at its last drawing: its view, and the site whose [詳細] card was
// open there. Both undefined while the pane is closed.
let shownView
let shownDetail
let lastPropsRedraw = -Infinity

/** Called by each drawing of the main pane: the view it drew, and the site it details. */
export function notePaneShows(view, detail) {
  shownView = view
  shownDetail = detail
}

/** Called when the main pane closes: nothing of it is on screen any more. */
export function notePaneClosed() {
  shownView = undefined
  shownDetail = undefined
}

/**
 * Whether the pane's last drawing was the view `view` (and the pane is still open). The values
 * view's timer runs only while it is.
 */
export function paneShowsView(view) {
  return shownView === view
}

/** Whether the pane's last drawing listed the site (its category's view). */
export function paneLists(id) {
  return shownView !== undefined && shownView === siteOf(id).category
}

/**
 * Whether a site's call should redraw the pane, and why: 'first' (a new site or surface the
 * pane lists), 'props' (new props in the open [詳細] card), or undefined for no redraw.
 * `now` is the time in milliseconds; a 'props' answer starts the next gap.
 */
export function redrawFor(id, { isNew = false, isChanged = false }, now) {
  if (!paneLists(id)) return undefined
  if (isNew) return 'first'
  if (!isChanged || shownDetail !== id) return undefined
  if (now - lastPropsRedraw < REDRAW_GAP_MS) return undefined
  lastPropsRedraw = now
  return 'props'
}
