// The queue that keeps a read-change-write of the store or of $.state from overlapping another's
// (pure: no $ here; the calls are register.js's).

/** A queue: the calls run one at a time, in the order they came; one that fails does not stop the next. */
export function makeQueue() {
  let queue = Promise.resolve()
  return (fn) => {
    const run = queue.then(fn)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
