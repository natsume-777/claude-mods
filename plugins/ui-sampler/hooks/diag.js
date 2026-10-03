// [診断/press]: a short log of what reaches this mod around a press, for the pane to list.
// Kept in module variables, not $.state: a render hook may not write $.state, and a state
// write on every entry would redraw the pane, which is the very thing being watched. The pane
// shows the log as of its last drawing; [記録を更新] draws it again. A reload starts it over.
// Pure: no $ here, so the hook files keep every $ call themselves.

/** How many entries the log keeps; older ones fall off. */
const LIMIT = 30

const entries = []
let paneRenders = 0
let lastFocused // the main pane's e.props.isFocused at its last drawing

// `12:34:56.789`, local time
function stamp() {
  const now = new Date()
  const pad = (n, width = 2) => String(n).padStart(width, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
}

/** Adds one line to the log: `kind` is a short tag (press, focus, render, invalidate). */
export function noteDiag(kind, text) {
  entries.push({ time: stamp(), kind, text })
  if (entries.length > LIMIT) entries.shift()
}

/**
 * Notes one drawing of the main pane: its running count and e.props.isFocused, with a mark
 * when the focus changed since the drawing before.
 */
export function notePaneRender(e) {
  paneRenders += 1
  const isFocused = e.props.isFocused
  const change = lastFocused === undefined || lastFocused === isFocused ? '' : `（${lastFocused} → ${isFocused}）`
  lastFocused = isFocused
  noteDiag('render', `Pane #${paneRenders} isFocused: ${isFocused}${change}`)
}

/** The log's lines, newest first. */
export function diagLines() {
  return entries.map(entry => `${entry.time} ${entry.kind}: ${entry.text}`).reverse()
}

/** Empties the log (the render count goes on). */
export function clearDiag() {
  entries.length = 0
}
