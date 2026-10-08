// The subagents the pane shows above the cards (pure: no $ here, register.js keeps every $ call).
//
// A list of records, kept in $.state for the session only (never in $.store, and never part of
// what the tools answer): { id, type, description, status, startedAt, endedAt?, summary? }.
// `status` is 'running' or 'done'. The text a record holds (type, description, summary) is
// shown as it came; only the summary is cut to one line.

/** What is kept and shown at most. Finished records past `done` are dropped, oldest first. */
export const AGENT_LIMITS = {
  running: 20,
  done: 5,
  summary: 80,
}

/** The `$.agent.list()` statuses after which an agent will not run again. */
const ENDED = new Set(['completed', 'failed', 'killed'])

const text = (v) => (typeof v === 'string' ? v : '')

/**
 * A line with its Markdown marks dropped: a heading, quote, bullet or number at the start, links
 * down to their text, code and emphasis marks. A rule or a code fence is nothing ('').
 */
export function plainLine(line) {
  let s = String(line).trim()
  if (/^(`{3,}|~{3,})/.test(s) || /^([-*_])(\s*\1){2,}$/.test(s)) return ''
  for (let prev = ''; prev !== s; ) {
    prev = s
    s = s.replace(/^(#{1,6}(\s+|$)|>\s*|[-*+](\s+|$)|\d+[.)](\s+|$))/, '')
  }
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/(`+)([^`]*)\1/g, '$2').replace(/`/g, '')
  for (let prev = ''; prev !== s; ) {
    prev = s
    s = s.replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/\*([^*]+)\*/g, '$1').replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1$2')
  }
  return s.replace(/\*+/g, '').trim()
}

/** The first line with text left after its Markdown marks are dropped, cut to `max` characters with a trailing …; '' for none. */
export function firstLine(value, max = AGENT_LIMITS.summary) {
  const line =
    text(value)
      .split(/\r?\n/)
      .map(plainLine)
      .find((l) => l !== '') ?? ''
  const chars = [...line]
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : line
}

/**
 * Whether an event is about a subagent the board shows. The app's own agents (the one that
 * writes the next-prompt suggestion, say) raise the events with an empty `agent_type` and are
 * not in $.agent.list(); they are left out.
 */
export const isShown = (event) => text(event?.agent_id) !== '' && text(event?.agent_type) !== ''

/** The tools a subagent hands its report back with (the report is in their input, not in a message's text). */
const HANDBACK = /handback/i

// The input fields a report is looked for in, in this order
const REPORT_FIELDS = ['message', 'text', 'report', 'content', 'summary', 'result']

/**
 * The report in a handback call's input: the first of the usual fields (`message`, `text`,
 * `report`, `content`, `summary`, `result`) that holds text, else the longest string value.
 */
export function handbackText(input) {
  if (input == null || typeof input !== 'object') return ''
  for (const field of REPORT_FIELDS) {
    if (typeof input[field] === 'string' && input[field].trim() !== '') return input[field]
  }
  return Object.values(input)
    .filter((v) => typeof v === 'string')
    .reduce((longest, v) => (v.length > longest.length ? v : longest), '')
}

/**
 * What an agent's conversation, as $.session.messages({ agentId }) gives it, says as a summary:
 * { text, isReport }, `text` the first line (Markdown marks dropped, cut short), '' when there is none.
 *   1. the newest handback tool call (a tool named like /handback/i): `isReport` is true, and
 *      the text is from its input
 *   2. else the text of the last assistant message
 * A deny, no messages, or nothing with text gives ''; nothing is taken from an earlier message.
 */
export function summaryOfMessages(messages) {
  if (!Array.isArray(messages)) return { text: '', isReport: false }
  const newestFirst = [...messages].reverse()
  const uses = newestFirst.flatMap((m) => (Array.isArray(m?.toolUses) ? [...m.toolUses].reverse() : []))
  const handback = uses.find((u) => HANDBACK.test(text(u?.tool)))
  const report = handback ? firstLine(handbackText(handback.input)) : ''
  if (report !== '') return { text: report, isReport: true }
  return { text: firstLine(newestFirst.find((m) => m?.role === 'assistant')?.text), isReport: false }
}

/**
 * Gives the done record of this id a summary. A report (`isReport`) replaces the one it has; any
 * other summary is added only when it has none. The same list when nothing changes.
 */
export function attachSummary(list, id, summary, isReport = false) {
  const record = list.find((a) => a.id === id)
  if (!summary || !record || record.status !== 'done') return list
  if (record.summary && (!isReport || record.summary === summary)) return list
  return list.map((a) => (a === record ? { ...record, summary } : a))
}

/** The list without the records of agents with no type (the app's own, as an older version kept them). */
export const withoutUnnamed = (list) => (Array.isArray(list) ? list.filter((a) => text(a?.type) !== '') : [])

/** What an event says of its agent (`agent_id`, `agent_type`), with the description $.agent.list() gives it. */
export function infoOf(event, known) {
  const id = text(event?.agent_id)
  const found = (Array.isArray(known) ? known : []).find((a) => a?.id === id)
  return { id, type: text(event?.agent_type) || text(found?.type), description: text(found?.description) }
}

/** The records kept: every running one up to the limit (the newest), the newest few finished ones. */
export function prune(list) {
  const running = list.filter((a) => a.status === 'running').slice(-AGENT_LIMITS.running)
  const done = list
    .filter((a) => a.status === 'done')
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, AGENT_LIMITS.done)
  const keep = new Set([...running, ...done])
  return list.filter((a) => keep.has(a))
}

/** SubagentStart: the agent is running (a record of the same id is taken up again). */
export function startAgent(list, info, now) {
  if (info.id === '') return list
  const prev = list.find((a) => a.id === info.id)
  const record = {
    id: info.id,
    type: info.type || prev?.type || '',
    description: info.description || prev?.description || '',
    status: 'running',
    startedAt: prev?.status === 'running' ? prev.startedAt : now,
    // A summary once held stays with the id (it is shown again when the agent is done)
    ...(prev?.summary ? { summary: prev.summary } : {}),
  }
  return prev ? list.map((a) => (a === prev ? record : a)) : [...list, record]
}

/**
 * SubagentStop: the agent is done. A start that was missed is added. The summary is not set here
 * (attachSummary does, once it is read); one the record has stays.
 */
export function stopAgent(list, info, now) {
  if (info.id === '') return list
  const prev = list.find((a) => a.id === info.id)
  const record = {
    id: info.id,
    type: info.type || prev?.type || '',
    description: info.description || prev?.description || '',
    status: 'done',
    startedAt: prev?.startedAt ?? now,
    // A stop seen again keeps the first one's time
    endedAt: prev?.status === 'done' ? prev.endedAt : now,
    ...(prev?.summary ? { summary: prev.summary } : {}),
  }
  return prev ? list.map((a) => (a === prev ? record : a)) : [...list, record]
}

/**
 * Running records that $.agent.list() already calls ended (an agent that was killed raises no
 * SubagentStop) become done. `exceptId` is the agent whose event is being handled.
 */
export function reconcile(list, known, now, exceptId = '') {
  const ended = new Set((Array.isArray(known) ? known : []).filter((a) => ENDED.has(a?.status)).map((a) => a.id))
  if (!list.some((a) => a.status === 'running' && a.id !== exceptId && ended.has(a.id))) return list
  return list.map((a) => (a.status === 'running' && a.id !== exceptId && ended.has(a.id) ? { ...a, status: 'done', endedAt: now } : a))
}

/** Whether two lists hold the same records (a write is made only when they do not). */
export const isSame = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** What is shown: { running, done }, the running ones in the order they started, the finished newest first. */
export function viewOf(list) {
  const all = Array.isArray(list) ? list : []
  return {
    running: all.filter((a) => a.status === 'running').sort((a, b) => a.startedAt - b.startedAt),
    done: all
      .filter((a) => a.status === 'done')
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, AGENT_LIMITS.done),
  }
}

/** How many agents are running. */
export const runningOf = (list) => (Array.isArray(list) ? list.filter((a) => a.status === 'running').length : 0)
