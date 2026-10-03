// The event inputs the values view lists, held between the event hooks and their $.state
// write. A hook reduces its input (value-format.js), hands it to holdEvent, and writes the
// batch it gets back, if any, into `{ plugin: 'ui-sampler', key: 'events' }` with mergeHeld.
//
// The write redraws the pane only while the values view is drawn (it reads that state), so
// while it is, a batch is handed back at most once per REDRAW_GAP_MS; the rest waits for the
// view's timer (values.js), which takes it with takeHeld. While the view is not drawn, every
// input is handed back at once.
//
// Pure: no $ here, so the hook files keep every $ call themselves. The hooks of one event live
// in different files (session.start in register.js, turn.complete in events.js, the rest in
// values.js), since a plugin hooks an event without a matcher once.

import { entryOf } from './value-format.js'
import { REDRAW_GAP_MS } from './redraw.js'

// What came since the last write, by event name: the entry, when, and how many calls
const held = new Map()
let lastWrite = -Infinity

/**
 * Holds one event's reduced input. Returns the batch to write now (everything held), or
 * undefined when the values view is shown (`isShown`) and the last write was less than
 * REDRAW_GAP_MS before `now`.
 */
export function holdEvent(name, shape, now, isShown) {
  const before = held.get(name)
  held.set(name, { entry: entryOf(shape), at: now, added: (before?.added ?? 0) + 1 })
  if (isShown && now - lastWrite < REDRAW_GAP_MS) return undefined
  return takeHeld(now)
}

/** Everything held, as a batch to write, or undefined when nothing is. */
export function takeHeld(now) {
  if (held.size === 0) return undefined
  const batch = new Map(held)
  held.clear()
  lastWrite = now
  return batch
}

/** The state's next value: `current` with the batch's entries, their counts added up. */
export function mergeHeld(current, batch) {
  const next = { ...current }
  for (const [name, one] of batch) {
    next[name] = { ...one.entry, at: one.at, count: (current?.[name]?.count ?? 0) + one.added }
  }
  return next
}

/** Puts back a batch whose write failed, under anything that came since. */
export function restoreHeld(batch) {
  for (const [name, one] of batch) {
    const since = held.get(name)
    held.set(name, since ? { ...since, added: since.added + one.added } : one)
  }
}
