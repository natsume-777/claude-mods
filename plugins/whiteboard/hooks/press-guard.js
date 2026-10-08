// Runs a pane's Button press again when it did not reach the Button's onPress (the same file
// as in usage-ledger and ui-sampler, kept here so the mods do not depend on each other).
//
// A Button's onPress stays in this mod's environment under a handle the host holds for the
// life of one drawing. A pane is drawn again whenever its props change, so a press that comes
// in just as the drawing it was aimed at is replaced (the first click on an unfocused pane
// focuses it, and `isFocused` changes) can find its handle gone and never reach the closure.
//
// So each guarded drawing keeps its own Buttons' closures here, by requestId and key, and wraps
// each onPress so that a run of it is seen. The ui.press hook (pane.js) opens a press record
// before next(e); if the chain settles, fails, or stays silent past a grace without the
// Button's onPress having started, the hook takes the press over and runs the closure the
// latest drawing holds under the same key. A press runs at most once: a closure the engine
// starts after the take-over finds the record taken and does nothing.
//
// Pure: no $ here, so the hook files keep every $ call themselves.

/** How long the hook waits for the press to reach an onPress before it takes it over. */
export const GRACE_MS = 2000

// The closures of the latest finished drawing, by requestId, then key
const drawn = new Map()
// The press in flight per `requestId key`: { started, takenOver }
const pending = new Map()

const slot = (requestId, key) => requestId + ' ' + key

/**
 * Starts one drawing of the pane `requestId`. `wrap(table)` hands back the element table with
 * its Button keeping each onPress here; `done(tree)` makes this drawing the latest and returns
 * the tree. A drawing that fails before done() leaves the previous one in place.
 */
export function guardDrawing(requestId) {
  const handlers = new Map()
  return {
    wrap(table) {
      const Button = props => {
        const onPress = props.onPress
        if (typeof onPress !== 'function') return table.Button(props)
        handlers.set(props.key, onPress)
        return table.Button({ ...props, onPress: press => runGuarded(requestId, props.key, onPress, press) })
      }
      return { ...table, Button }
    },
    done(tree) {
      drawn.set(requestId, handlers)
      return tree
    },
  }
}

// The onPress the surface runs: marks the press as reached, unless the hook already took it
// over, in which case it does nothing (the press has run once already)
function runGuarded(requestId, key, onPress, press) {
  const record = pending.get(slot(requestId, key))
  if (record?.takenOver) return undefined
  if (record) record.started = true
  return onPress(press)
}

/**
 * Opens the record of one press before next(e). Undefined when the latest drawing of that
 * pane has no guarded Button under the key (another site, or a key this mod does not keep):
 * such a press is only watched.
 */
export function beginPress(e) {
  if (!drawn.get(e.requestId)?.has(e.element)) return undefined
  const record = { started: false, takenOver: false }
  pending.set(slot(e.requestId, e.element), record)
  return record
}

/** Whether the press has reached (started) its Button's onPress. */
export function hasStarted(record) {
  return record.started
}

/**
 * Takes the press over and runs the latest drawing's closure for its key with `press` (the
 * ui.press argument). Marks the record first, so the engine's own onPress, if it still
 * comes, does nothing. Resolves to what the closure returned.
 */
export function takeOver(record, press) {
  record.takenOver = true
  const onPress = drawn.get(press.requestId)?.get(press.element)
  return onPress ? onPress(press) : undefined
}

/**
 * Closes the record of a press the engine ran itself. A taken-over record stays until the
 * next press on the key replaces it, so the engine's own onPress, arriving late, still finds it.
 */
export function endPress(press, record) {
  const key = slot(press.requestId, press.element)
  if (!record.takenOver && pending.get(key) === record) pending.delete(key)
}
