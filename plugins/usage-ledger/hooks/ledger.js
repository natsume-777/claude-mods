// The pure parts usage-ledger's hook files share: its options, the context sizes observed in
// earlier sessions, the live requests turned into aggregate.js's threads, number and time
// formatting, and the handoff's id, file name, draft and marker.
//
// Pure: no $ here, so the hook files keep every $ call themselves.

import { summaryForBand, contextForRuns, IDLE_WARN_MS, isoString, clockOf } from './aggregate.js'

/** The pane's id ($.ui.open, the Pane matcher) and the slash command's name. */
export const PANE = 'usage-ledger'

/** At most this many requests are kept in $.state; the oldest go first. */
export const MAX_REQUESTS = 5000

/** A transcript (main or subagent) larger than this is not read back ($.fs.read refuses over 4 MiB). */
export const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024

/** Always shown beside a weighted figure. */
export const ESTIMATE_NOTE = '*重みは推計。サブスクの計算式は非公開'

/** How the weights are assumed, for the pane. */
export const WEIGHTS_NOTE =
  '公開 API の価格比で推計: 入力 1、キャッシュ読み 0.1、書き 5m 1.25、書き 1h 2、出力 5。モデル比 haiku 1、sonnet 3、opus 5'

/** The pane's views, in the order of its navigation. */
export const VIEWS = [
  { id: 'status', label: '状況' },
  { id: 'overview', label: '概要' },
  { id: 'threads', label: 'スレッド' },
  { id: 'kinds', label: '種類・モデル' },
  { id: 'costly', label: '高い要求' },
  { id: 'gaps', label: '待ちと再書込' },
  { id: 'tools', label: '主のツール' },
  { id: 'handoff', label: '引き継ぎ' },
]

const DEFAULTS = { ttlMain: '1h', ttlSub: '5m', freshCtx: 70000, baseCtx: 40000, handoffDir: '.claude/handoffs/', exportDir: '.claude/usage-ledger/', showBand: true }

// The options register() received, defaults filled in
let config = { ...DEFAULTS }
// Context sizes observed in earlier sessions ($.store 'observed'): { fresh, base } or nulls
let observed = { fresh: null, base: null }

/** Takes register()'s options; a value of the wrong type keeps the default. */
export function setConfig(options = {}) {
  const pick = (key, ok) => (ok(options?.[key]) ? options[key] : DEFAULTS[key])
  const ttl = (v) => v === '1h' || v === '5m'
  const count = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  config = {
    ttlMain: pick('ttlMain', ttl),
    ttlSub: pick('ttlSub', ttl),
    freshCtx: pick('freshCtx', count),
    baseCtx: pick('baseCtx', count),
    handoffDir: pick('handoffDir', (v) => typeof v === 'string' && v.trim() !== ''),
    exportDir: pick('exportDir', (v) => typeof v === 'string' && v.trim() !== ''),
    showBand: pick('showBand', (v) => typeof v === 'boolean'),
  }
  return config
}

export function getConfig() {
  return config
}

/** Takes the store's 'observed' value (anything else is ignored). */
export function setObserved(value) {
  const n = (v) => (typeof v === 'number' && v > 0 ? v : null)
  observed = { fresh: n(value?.fresh), base: n(value?.base) }
}

export function getObserved() {
  return observed
}

/**
 * The fresh-session and base context the break-even assumes: observed first, else the options;
 * the base never above the fresh size.
 */
export function assumed() {
  const freshCtx = observed.fresh ?? config.freshCtx
  return { freshCtx, baseCtx: Math.min(observed.base ?? config.baseCtx, freshCtx) }
}

/** summaryForBand with the options and observations filled in. */
export function summarize(requests, now, { handoff } = {}) {
  return summaryForBand(requests ?? [], { now, ttlMain: config.ttlMain, ...assumed(), handoff })
}

// ---- The gauge: how long the session can go on before a handoff pays

/** The gauge is full where a fresh session pays back within this many requests. */
export const FULL_RUNS = 5
/** At or above this percentage of the gauge, the stage is 'soon'. */
export const SOON_PERCENT = 60

/** The stages' words, for the band and the pane. */
export const STAGE_LABEL = { ok: 'OK', soon: 'Soon', switch: 'Switch' }

/**
 * The band's short phrases, by gaugeOf's `advice`. The band stays one line; the pane's 状況
 * view says the same in full sentences.
 */
export const ADVICE = {
  soon: '区切りで引き継ぐと節約に',
  switch: '今引き継ぐと節約に',
  idle: '10 分操作がないと割高に',
  expired: '続きは新しいセッションが安い',
}

/**
 * Where the main context sits on the gauge, from summaryForBand's `s`.
 * opts: { freshCtx, baseCtx, ttl, isWorking }
 *   percent  0 at a fresh session's context, 100 at contextForRuns(FULL_RUNS), linear between;
 *            100 once the cache expired (when a fresh session is smaller at all); null with no
 *            main request yet
 *   stage    'ok' below SOON_PERCENT, 'soon' below 100, 'switch' at 100
 *   advice   which ADVICE phrase to show, or null: expired, else idle in the cache's last ten
 *            minutes, else the stage's own ('soon', 'switch')
 * A context no larger than a fresh session's stays at 0 and never advises: a fresh session
 * would not be cheaper.
 */
export function gaugeOf(s, { freshCtx, baseCtx, ttl = '1h', isWorking = false }) {
  const full = contextForRuns({ runs: FULL_RUNS, base: baseCtx, fresh: freshCtx, ttl })
  if (s?.context == null) return { percent: null, stage: null, advice: null, fullAt: full }
  const pays = s.context > freshCtx
  let percent = pays ? Math.min(100, (100 * (s.context - freshCtx)) / (full - freshCtx)) : 0
  if (pays && s.isExpired) percent = 100
  const stage = percent >= 100 ? 'switch' : percent >= SOON_PERCENT ? 'soon' : 'ok'
  let advice = null
  if (pays && s.isExpired) advice = 'expired'
  else if (pays && !isWorking && s.remainingMs != null && s.remainingMs <= IDLE_WARN_MS) advice = 'idle'
  else if (stage !== 'ok') advice = stage
  return { percent, stage, advice, fullAt: full }
}

/** gaugeOf with the options and observations filled in. */
export function gauge(s, { isWorking = false } = {}) {
  return gaugeOf(s, { ...assumed(), ttl: config.ttlMain, isWorking })
}

/** Appends one request, dropping the oldest beyond MAX_REQUESTS. */
export function appendRequest(list, request) {
  const next = [...(list ?? []), request]
  return next.length > MAX_REQUESTS ? next.slice(next.length - MAX_REQUESTS) : next
}

/** Replaces one thread's requests with `requests` (read back from its transcript). */
export function replaceThread(list, thread, requests) {
  const next = [...(list ?? []).filter((q) => q.thread !== thread), ...requests].sort((a, b) => a.ts - b.ts)
  return next.length > MAX_REQUESTS ? next.slice(next.length - MAX_REQUESTS) : next
}

/**
 * One thread's requests as parseThread read them from its transcript, in the shape $.state
 * keeps: the response's message id as `id`, the exact 5m / 1h split, `src` 'transcript'.
 */
export function transcriptRequests(parsed, thread) {
  return (parsed ?? []).map((q) => ({ id: String(q.id), ts: q.ts, model: q.model, tools: q.tools, tok: q.tok, thread, src: 'transcript' }))
}

// When a live main request was sent: `sentAt` (the step's start), else its `ts`
const sentOf = (q) => (typeof q.sentAt === 'number' ? q.sentAt : q.ts)

/**
 * The main thread's requests replaced by `requests`, the ones its transcript records. A live
 * main request stays only when it was sent after the newest of them started, so it is one the
 * transcript does not have yet; every request the transcript has started after its step was
 * sent (the main thread makes one request at a time), so none is counted twice.
 */
export function mergeMain(list, requests) {
  let newest = -Infinity
  for (const q of requests) if (Number.isFinite(q.ts) && q.ts > newest) newest = q.ts
  const live = (list ?? []).filter((q) => q.thread === 'main' && q.src !== 'transcript' && sentOf(q) > newest)
  return replaceThread(list, 'main', [...requests, ...live])
}

/**
 * Adds one live request. A main request whose response the transcript already had when it was
 * last read (a read-back request that started after this step was sent: read mid-response, its
 * output not final yet) is not added again; that request takes the larger output instead.
 */
export function addLive(list, request) {
  if (request.thread === 'main') {
    const at = sentOf(request)
    const i = (list ?? []).findIndex((q) => q.thread === 'main' && q.src === 'transcript' && q.ts >= at)
    if (i >= 0) {
      const next = [...list]
      const q = next[i]
      next[i] = {
        ...q,
        tok: { ...q.tok, output: Math.max(q.tok.output || 0, request.tok.output || 0) },
        tools: (q.tools ?? []).length >= request.tools.length ? q.tools : request.tools,
      }
      return next
    }
  }
  return appendRequest(list, request)
}

// Why the main thread was not read back, as a sentence
const MAIN_REASON = {
  noPath: '記録の場所が分からないため、読み直せない',
  tooLarge: '記録が 4 MiB を超えるため、読み直せない',
  unreadable: '記録を読めなかった',
  pending: 'ターンが終わると、記録から読み直す',
}

/**
 * How the main thread is counted, for the pane and the export. source: $.state `mainSource`
 * (unset before the first read-back was tried); hasPath: whether the transcript's path is known.
 *   isBackfilled  read back from the transcript at least once: the totals cover the session
 *   isCurrent     and the last read-back worked
 *   method        the sentence for 数え方
 *   label, note   the same split for a narrow pane: a short label, and the rest (may be '')
 *   live          which of main is provisional (速報値), for the totals' headings: null when
 *                 none is, else 'HH:MM 以降の主' after a read-back that stopped, else '主'
 */
export function mainSourceOf(source, { hasPath = false, tzOffsetMinutes = 0 } = {}) {
  const at = typeof source?.backfilledAt === 'number' ? source.backfilledAt : null
  const reasonKey = source?.reason && MAIN_REASON[source.reason] ? source.reason : source?.reason === 'empty' || hasPath ? 'pending' : 'noPath'
  const reason = MAIN_REASON[reasonKey]
  if (at != null && !source.reason) {
    return { isBackfilled: true, isCurrent: true, at, live: null, method: '記録から読み直した（ターンの終わりごと）', label: '記録から（ターンごと）', note: '' }
  }
  if (at != null) {
    const t = clockOf(at, tzOffsetMinutes)
    return {
      isBackfilled: true,
      isCurrent: false,
      at,
      live: `${t} 以降の主`,
      method: `${t} までは記録から読み直した値、その後は速報値（記録と未照合）。${reason}`,
      label: `${t} まで記録・以降は速報値`,
      note: `速報値は記録と未照合。${reason}`,
    }
  }
  return {
    isBackfilled: false,
    isCurrent: false,
    at: null,
    live: '主',
    method: `速報値（記録と未照合）。${reason}。書き込みの 5m / 1h は設定で振り分け`,
    label: '速報値',
    note: `記録と未照合。${reason}。書き込みの 5m / 1h は設定で振り分け`,
  }
}

/** A JSONL text as records; a line that does not parse (a partial last line) is skipped. */
export function parseJsonl(text) {
  const out = []
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {}
  }
  return out
}

/** A subagent's label: its description cut short, else its id's first 8 characters. */
export function threadLabel(key, meta) {
  if (key === 'main') return '主'
  const d = meta?.description?.trim()
  if (d) return d
  return String(key).replace(/^agent-/, '').slice(0, 8)
}

/**
 * The live requests as aggregate.js's threads: main first, then each subagent in order of its
 * first request; each thread's requests oldest first.
 */
export function toThreads(requests, metas) {
  const by = new Map([['main', []]])
  for (const q of requests ?? []) {
    if (!by.has(q.thread)) by.set(q.thread, [])
    by.get(q.thread).push(q)
  }
  const out = []
  for (const [key, list] of by) {
    list.sort((a, b) => a.ts - b.ts)
    const meta = key === 'main' ? {} : metas?.[key] ?? {}
    out.push({
      key,
      label: threadLabel(key, meta),
      agentType: key === 'main' ? '(主)' : meta.agentType || '?',
      description: meta.description || '',
      requests: list,
    })
  }
  return out
}

// ---- Formatting

/** 370k, 1.2M, 950: a token count or weight, short. */
export function short(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a < 1000) return String(Math.round(n))
  if (a < 10000) return (n / 1000).toFixed(1) + 'k'
  if (a < 1e6) return Math.round(n / 1000) + 'k'
  return (n / 1e6).toFixed(a < 1e7 ? 2 : 1) + 'M'
}

/** 12%, 0.4%: a share; '—' with no whole. */
export function pct(part, whole) {
  if (!whole) return '—'
  const p = (100 * part) / whole
  return (p < 1 && p > 0 ? p.toFixed(1) : Math.round(p)) + '%'
}

/** 42 分, 1 時間 5 分, 30 秒 */
export function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return s + ' 秒'
  const m = Math.floor(s / 60)
  if (m < 60) return m + ' 分'
  return Math.floor(m / 60) + ' 時間' + (m % 60 ? ' ' + (m % 60) + ' 分' : '')
}

/** The model id without its `claude-` prefix. */
export function modelShort(model) {
  return String(model ?? '?').replace(/^claude-/, '')
}

/** The model's family (opus, sonnet, haiku), else modelShort's name. */
export function modelFamily(model) {
  const s = String(model ?? '').toLowerCase()
  for (const k of ['opus', 'sonnet', 'haiku']) if (s.includes(k)) return k
  return modelShort(model)
}

/** A thread's models in a list row: their families, each once, joined by '/'. */
export const modelsLine = (models) => [...new Set((models ?? []).map(modelFamily))].join('/') || '—'

/** The local offset in minutes; 0 where Date is unavailable. */
export function localOffsetMinutes() {
  try {
    return typeof Date === 'function' ? -new Date().getTimezoneOffset() : 0
  } catch {
    return 0
  }
}

// ---- Handoff

/** The marker the new session's first message carries. */
export const HANDOFF_MARK = /\[usage-ledger handoff ([0-9]{8}-[0-9]{4}-[0-9a-z]{4})\]/

/** The $.store key of one handoff's record. */
export const handoffKey = (id) => 'handoff:' + id

/** `YYYYMMDD-HHMM-xxxx` in local time; xxxx from the clock's milliseconds, so ids rarely repeat. */
export function handoffId(now, tzOffsetMinutes) {
  return stamp(now, tzOffsetMinutes) + '-' + (Math.floor(now) % 1679616).toString(36).padStart(4, '0')
}

function stamp(now, tzOffsetMinutes) {
  const d = isoString(now + tzOffsetMinutes * 60000)
  return d.slice(0, 4) + d.slice(5, 7) + d.slice(8, 10) + '-' + d.slice(11, 13) + d.slice(14, 16)
}

/** `<handoffDir>/handoff-YYYYMMDD-HHMM.md`, with forward slashes. */
export function handoffFile(dir, now, tzOffsetMinutes) {
  const base = String(dir || DEFAULTS.handoffDir).replace(/\\/g, '/').replace(/\/+$/, '')
  return `${base}/handoff-${stamp(now, tzOffsetMinutes)}.md`
}

/** The prompt the band's and the pane's [引き継ぐ…] put in the prompt box. Never sent by the mod. */
export function handoffDraft({ file, id }) {
  return [
    `${file} に引き継ぎ文を書いてください。`,
    '中身は「目標・今の段階・決めたこと・未解決・最初に読むファイル」の 5 項目で、各 5 行以内、全体で 1.5k トークン以内にします。会話の本文は写さないでください。',
    `書いたら、その本文と目印 [usage-ledger handoff ${id}] を最初の発言にして、新しいセッションを開いてください。`,
    '新しいセッションからはこのファイルが見えないことがあるので、本文は最初の発言に含めてください。',
    '開く前に、どのツールで何を開くかを私に確認してください。',
  ].join('\n')
}
