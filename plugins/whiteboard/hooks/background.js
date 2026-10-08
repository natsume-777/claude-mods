// The background work the pane shows beneath the subagents (pure: no $ here, register.js keeps
// every $ call).
//
// Whatever is in flight besides the subagents: background commands (shell), monitors,
// workflows, and the crons that will wake the session. The only source is the `background_tasks`
// and `session_crons` of a Stop and a SubagentStop, so what is kept is a snapshot as of the
// last of those events; each kind is replaced whole, and nothing that is gone is remembered.
// Kept in $.state for the session only: { tasks, crons }.

/** What is shown at most (tasks and crons together); the rest is counted. */
export const BACKGROUND_LIMITS = {
  rows: 5,
  text: 60,
}

// The engine clips a long command or prompt and appends this marker
const CLIP_MARKER = /\.\.\. \[\+\d+ chars\]\s*$/

const text = (v) => (typeof v === 'string' ? v : '')

/** One line of a text: blanks folded, the engine's "... [+N chars]" marker made …, cut to `max` characters with a trailing …. */
export function clip(value, max = BACKGROUND_LIMITS.text) {
  const line = text(value).replace(CLIP_MARKER, '…').replace(/\s+/g, ' ').trim()
  const chars = [...line]
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : line
}

/**
 * The tasks of a `background_tasks` array that are not subagents (those come from the subagent
 * events), each as { id, type, status, text }: `text` is the description, else the command (cut
 * short), else the name of a workflow or the tool of a monitor.
 */
export function normalizeTasks(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((t) => t != null && typeof t === 'object' && text(t.type) !== 'subagent' && text(t.id) !== '')
    .map((t) => ({
      id: text(t.id),
      type: text(t.type) || 'task',
      status: text(t.status),
      text: text(t.description).trim() !== '' ? clip(t.description, Infinity) : clip(t.command) || clip(t.name) || clip(t.tool),
    }))
}

/** The crons of a `session_crons` array, each as { id, recurring, text }: `text` is the prompt, cut short. */
export function normalizeCrons(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((c) => c != null && typeof c === 'object' && text(c.id) !== '')
    .map((c) => ({ id: text(c.id), recurring: c.recurring === true, text: clip(c.prompt) }))
}

/**
 * The snapshot after an event: each kind the event carries (an array, even an empty one) replaces
 * the one before; a kind it does not carry stays. `before` may be unset (an empty snapshot).
 */
export function replaceSnapshot(before, event) {
  return {
    tasks: Array.isArray(event?.background_tasks) ? normalizeTasks(event.background_tasks) : snapshotOf(before).tasks,
    crons: Array.isArray(event?.session_crons) ? normalizeCrons(event.session_crons) : snapshotOf(before).crons,
  }
}

/** A stored value as a snapshot: the lists it holds, [] for a kind it does not. */
export const snapshotOf = (value) => ({
  tasks: Array.isArray(value?.tasks) ? value.tasks : [],
  crons: Array.isArray(value?.crons) ? value.crons : [],
})

/** What is shown: { rows, more }. A row is { key, kind, text, state, isRunning }; `more` counts those past the limit. */
export function rowsOf(snapshot) {
  const { tasks, crons } = snapshotOf(snapshot)
  const all = [
    ...tasks.map((t) => ({
      key: 'task-' + t.id,
      kind: t.type,
      text: t.text,
      state: t.status === 'running' ? '実行中' : t.status === 'pending' ? '待機中' : t.status,
      isRunning: t.status === 'running',
    })),
    ...crons.map((c) => ({ key: 'cron-' + c.id, kind: '予約', text: c.text, state: c.recurring ? 'くり返し' : '1 回', isRunning: false })),
  ]
  return { rows: all.slice(0, BACKGROUND_LIMITS.rows), more: Math.max(0, all.length - BACKGROUND_LIMITS.rows) }
}
