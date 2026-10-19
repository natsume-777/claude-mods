// Shows where the session's tokens go and when a fresh session would be cheaper.
//
// register.js  the events: each model request (turn.step) into $.state, which subagent is
//              which ($.agent.list, classic.SubagentStart, the Agent tool's result), the main
//              transcript's path and when to read threads back from their transcripts, the
//              handoff marker in a new session's first prompt, the timers, /usage-ledger's
//              registration
// backfill.js  reading a thread's requests back from its transcript
// pane.js      the pane (one, with views), /usage-ledger, the band above the prompt,
//              [引き継ぐ…] and [書き出す]
// export.js    the two files [書き出す] writes, a .md summary and a .jsonl of the requests (pure)
// meter.js     the gauge line `トークン ■■■□□ OK`, drawn as usage-band draws its meters (pure)
// aggregate.js the aggregation and the break-even (pure; also used outside the mod)
// ledger.js    options, the gauge's stage and advice, formatting, threads, the handoff's draft
//              and marker (pure)
// style.js     the shared look (pure)
// press-guard.js  runs a pane press again that did not reach its Button (pure)
//
// The transcripts are the source of truth. turn.step's live values are provisional ("速報値"):
// a subagent's are replaced by its transcript when it finishes, the main thread's at the end of
// each main turn (classic.Stop) and before [書き出す], which also brings in the main requests
// made before the module loaded. Where the classic hooks do not run (an organisation manages
// Claude Code), or the main transcript is over 4 MiB or unreadable, counting starts when the
// module first loads ("集計開始") and the main thread stays live, labelled as such.

import { normalizeStep, contextOf } from './aggregate.js'
import {
  HANDOFF_MARK,
  handoffKey,
  setConfig,
  getConfig,
  setObserved,
  getObserved,
  addLive,
  summarize,
  assumed,
} from './ledger.js'
import { registerPane } from './pane.js'
import { notePath, backfillSubagent, backfillMain } from './backfill.js'
import { update } from 'claude-code'

// The state this file writes (declared in types/index.d.ts)
const REQUESTS = { plugin: 'usage-ledger', key: 'requests' }
const THREADS = { plugin: 'usage-ledger', key: 'threads' }
const STARTED_AT = { plugin: 'usage-ledger', key: 'startedAt' }
const HANDOFF = { plugin: 'usage-ledger', key: 'handoff' }
const INCOMING = { plugin: 'usage-ledger', key: 'incoming' }

// The $.store key of the context sizes observed in earlier sessions: { fresh, base, at }
const OBSERVED_KEY = 'observed'
// How many of a handed-off session's first requests are reported back
const OBSERVE_FIRST = 3
// How often a drafted handoff looks in the store for the new session's report
const WATCH_MS = 60_000
// The cache's last ten minutes, when the band starts showing while idle
const WARN_BEFORE_MS = 10 * 60_000

// Subagent ids already looked up in $.agent.list(), so each is looked up once
const looked = new Set()
// True when this session had no turn when the module loaded: its first request is the base
let isFreshSession = false
// The redraw at the cache's next edge (ten minutes left, expired), and the handoff watcher
let edgeTimer = null
let watcher = null

export function register(on, options) {
  setConfig(options)

  // Fires on the session's start, and again after a hot reload (which drops the timers)
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usage-ledger', description: 'このセッションのトークンの内訳を開く' })
    const now = await $.clock.now()
    const started = await $.state.get(STARTED_AT)
    if (typeof started.value !== 'number') await $.state.set(STARTED_AT, now)
    try {
      isFreshSession = (await $.session.turns()) === 0
    } catch {
      isFreshSession = false
    }
    try {
      setObserved(await $.store.get(OBSERVED_KEY))
    } catch {}
    try {
      await mapAgents($)
    } catch {}
    const { value: requests } = await $.state.get(REQUESTS)
    scheduleEdges($, requests ?? [], now)
    watcher?.cancel()
    watcher = $.clock.every(WATCH_MS, () => void watchHandoff($))
    return next(e)
  })

  // One model request, of the main thread or a subagent; its result goes on unchanged
  on('turn.step', async function* ($, e, next) {
    let sentAt = null
    try {
      sentAt = await $.clock.now()
    } catch {}
    const result = yield* next(e)
    try {
      await recordStep($, e, result, sentAt)
    } catch {}
    return result
  })

  // The main transcript's path, from the classic hooks that carry it on the main thread
  on('classic.SessionStart', async ($, e, next) => {
    try {
      await notePath($, e)
    } catch {}
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    try {
      await notePath($, e)
    } catch {}
    return next(e)
  }).catch(($, e, next) => next(e))

  // A main turn ended: the main thread's requests read back from its transcript
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    try {
      if (!e.agent_id) {
        await notePath($, e)
        await readBackMain($)
      }
    } catch {}
    return result
  }).catch(($, e, next) => next(e))

  // A subagent starts: its type
  on('classic.SubagentStart', async ($, e, next) => {
    try {
      await noteThread($, e.agent_id, { agentType: e.agent_type })
    } catch {}
    return next(e)
  })

  // The Agent tool: its description and type, by the agentId its result names
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const result = await next(e)
    try {
      const agentId = result?.result?.agentId
      if (typeof agentId === 'string') {
        await noteThread($, agentId, {
          agentType: e.subagent_type ?? result.result.agentType,
          description: typeof e.description === 'string' ? e.description : undefined,
        })
      }
    } catch {}
    return result
  })

  // A subagent finished: its transcript has every request with the exact cache-write split,
  // so its live tally is replaced by it (left as it is when the file is too large to read)
  on('classic.SubagentStop', async ($, e, next) => {
    const result = await next(e)
    try {
      await noteThread($, e.agent_id, { agentType: e.agent_type })
      if (typeof e.agent_id === 'string') await backfillSubagent($, e.agent_id, e.agent_transcript_path)
    } catch {}
    return result
  })

  // A prompt carrying the handoff marker: this session was started from a handoff (unless it
  // is the session that drafted it, sending the draft)
  on('prompt.submit', async ($, e, next) => {
    try {
      const match = HANDOFF_MARK.exec(e.text ?? '')
      if (match) await noteIncoming($, match[1])
    } catch {}
    return next(e)
  })

  // The pane, /usage-ledger and the band
  registerPane(on)
}

// ---- The live tally

async function recordStep($, e, result, sentAt) {
  const now = await $.clock.now()
  const step = normalizeStep(e, result, now, getConfig())
  if (!step) return
  // When it was sent: a read-back keeps the live requests its transcript does not have yet
  const request = typeof sentAt === 'number' ? { ...step, sentAt } : step
  await update($, REQUESTS, (list) => addLive(list, request))
  if (request.thread !== 'main') {
    if (!looked.has(request.thread)) {
      looked.add(request.thread)
      await mapAgents($)
    }
    return
  }
  const { value: requests } = await $.state.get(REQUESTS)
  scheduleEdges($, requests ?? [], now)
  await observeMain($, contextOf(request.tok))
}

// The context of a main request, as an observation: the first of a fresh session is the base
// every session starts with; the first three of a handed-off session go back to the handoff's
// record, the first of them as the size a fresh session starts at
async function observeMain($, context) {
  const { value: incoming } = await $.state.get(INCOMING)
  if (incoming && incoming.observed.length < OBSERVE_FIRST) {
    const observed = [...incoming.observed, context]
    await $.state.set(INCOMING, { ...incoming, observed })
    const record = await $.store.get(handoffKey(incoming.id))
    if (record && typeof record === 'object') await $.store.set(handoffKey(incoming.id), { ...record, observed })
    if (observed.length === 1) await saveObserved($, { fresh: context })
    isFreshSession = false
    return
  }
  // A first request larger than a fresh session's assumed start opened with a long prompt
  // (or is no fresh session at all): it says nothing about the base
  if (isFreshSession) {
    isFreshSession = false
    if (context < assumed().freshCtx) await saveObserved($, { base: context })
  }
}

async function saveObserved($, patch) {
  const now = await $.clock.now()
  const value = { ...getObserved(), ...patch, at: now }
  setObserved(value)
  await $.store.set(OBSERVED_KEY, value)
}

// Redraws the band and the pane when the main cache reaches its last ten minutes and when it
// expires, since what they show changes then without a new request. Nothing else redraws on a
// timer: in the desktop app every redraw rebuilds every mod's drawing, other mods' open panes
// included
function scheduleEdges($, requests, now) {
  edgeTimer?.cancel()
  edgeTimer = null
  const s = summarize(requests, now)
  if (s.expiresAt == null || s.isExpired) return
  const warnAt = s.expiresAt - WARN_BEFORE_MS
  const at = now < warnAt ? warnAt : s.expiresAt
  const own = $.clock.after(Math.max(0, at - now), async () => {
    if (edgeTimer === own) edgeTimer = null
    $.ui.invalidate('ui.render')
    const { value } = await $.state.get(REQUESTS)
    scheduleEdges($, value ?? [], await $.clock.now())
  })
  edgeTimer = own
}

// ---- Which subagent is which

async function mapAgents($) {
  const agents = await $.agent.list()
  if (!Array.isArray(agents) || agents.length === 0) return
  await update($, THREADS, (threads) => {
    const next = { ...(threads ?? {}) }
    for (const a of agents) {
      looked.add(a.id)
      next[a.id] = { ...next[a.id], agentType: next[a.id]?.agentType ?? a.type, description: next[a.id]?.description ?? a.description }
    }
    return next
  })
}

async function noteThread($, agentId, patch) {
  if (typeof agentId !== 'string' || agentId === '') return
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === 'string' && v !== ''))
  await update($, THREADS, (threads) => ({ ...(threads ?? {}), [agentId]: { ...(threads ?? {})[agentId], ...clean } }))
}

// The main thread read back; the cache's edges follow its last request's time
async function readBackMain($) {
  if (!(await backfillMain($))) return
  const { value: requests } = await $.state.get(REQUESTS)
  scheduleEdges($, requests ?? [], await $.clock.now())
}

// ---- Handoff

async function noteIncoming($, id) {
  const { value: current } = await $.state.get(INCOMING)
  if (current) return
  const record = await $.store.get(handoffKey(id))
  const self = await $.session.id()
  if (record && typeof record === 'object' && record.fromSession === self) return
  const { value: drafted } = await $.state.get(HANDOFF)
  if (drafted?.id === id) return
  const known = record && typeof record === 'object'
  await $.state.set(INCOMING, {
    id,
    fromSession: known && typeof record.fromSession === 'string' ? record.fromSession : null,
    ctxAtHandoff: known && typeof record.ctxAtHandoff === 'number' ? record.ctxAtHandoff : null,
    predictedCtx: known && typeof record.predictedCtx === 'number' ? record.predictedCtx : null,
    observed: [],
  })
}

// A drafted handoff turns 'done' once the new session stored its first context; its later
// observations are picked up until there are OBSERVE_FIRST
async function watchHandoff($) {
  try {
    const { value: handoff } = await $.state.get(HANDOFF)
    if (!handoff || handoff.observed.length >= OBSERVE_FIRST) return
    const record = await $.store.get(handoffKey(handoff.id))
    const observed = Array.isArray(record?.observed) ? record.observed.filter((n) => typeof n === 'number') : []
    if (observed.length <= handoff.observed.length) return
    await $.state.set(HANDOFF, { ...handoff, status: 'done', observed })
  } catch {}
}
