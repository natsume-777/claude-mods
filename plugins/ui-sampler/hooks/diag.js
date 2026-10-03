// [診断/press]: a short log of what reaches this mod around a press, for the pane to list.
// Kept in module variables, not $.state: a render hook may not write $.state, and a state
// write on every entry would redraw the pane, which is the very thing being watched. The pane
// shows the log as of its last drawing; [記録を更新] draws it again. A reload starts it over.
// Pure: no $ here, so the hook files keep every $ call themselves.

/** How many entries the log keeps; older ones fall off. */
const LIMIT = 100

const entries = []
let paneRenders = 0
let lastFocused // the main pane's e.props.isFocused at its last drawing

// The Spinner's redraws can recur all through a turn and would push the press and
// focus lines out of the log, so they are left out unless the diag section's switch keeps
// them. `noisePending`: the last redraw this mod asked for came from the Spinner, so the
// pane's next drawing is its echo.
let noiseKept = false
let noisePending = false

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

/** Whether the Spinner's redraw lines are kept in the log. Off until the switch turns it on. */
export function isNoiseKept() {
  return noiseKept
}

/** Flips the switch that keeps the Spinner's redraw lines in the log. */
export function toggleNoise() {
  noiseKept = !noiseKept
}

/**
 * Notes one $.ui.invalidate this mod makes. `isNoise` marks one the Spinner caused: left out
 * of the log unless the switch keeps it, along with the pane drawing it brings.
 */
export function noteInvalidate(text, isNoise = false) {
  noisePending = isNoise
  if (!isNoise || noiseKept) noteDiag('invalidate', text)
}

/**
 * Notes one drawing of the main pane: its running count and e.props.isFocused, with a mark
 * when the focus changed since the drawing before. A drawing that follows a Spinner's
 * redraw with the focus unchanged is noise.
 */
export function notePaneRender(e) {
  paneRenders += 1
  const isFocused = e.props.isFocused
  const isFocusChanged = lastFocused !== undefined && lastFocused !== isFocused
  const change = isFocusChanged ? `（${lastFocused} → ${isFocused}）` : ''
  lastFocused = isFocused
  const isNoise = noisePending && !isFocusChanged
  noisePending = false
  if (!isNoise || noiseKept) noteDiag('render', `Pane #${paneRenders} isFocused: ${isFocused}${change}`)
}

/** The log's lines, newest first. */
export function diagLines() {
  return entries.map(entry => `${entry.time} ${entry.kind}: ${entry.text}`).reverse()
}

/** Empties the log (the render count goes on). */
export function clearDiag() {
  entries.length = 0
}
