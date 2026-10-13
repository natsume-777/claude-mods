// Pure analysis for usage-audit: many sessions' transcripts -> totals, cache gap tax,
// context statistics and findings ranked by estimated saving.
//
// No fs, process or Date here: audit.js reads the transcripts and the agent definitions and
// passes them in, so this module runs on in-memory records (and in tests).
//
// Every "weighted" number uses aggregate.js's DEFAULT_WEIGHTS: token-type ratios from public
// API prices (input 1, cache read 0.1, cache write 5m 1.25, cache write 1h 2, output 5) times a
// model ratio (haiku 1, sonnet 3, opus 5). The subscription's real formula is not public, so
// every saving below is an estimate in those units, not a measured saving.
//
// Output contains counts, tool names, agent types, model names, plugin names, file basenames
// and session id prefixes only; never prompt, response or tool-result text, nor agent or skill
// descriptions.

import { parseThread, aggregateThreads, modelWeight, contextOf, DEFAULT_WEIGHTS, HANDOFF_OUTPUT } from './aggregate.js';

/** Tool-result characters per token, rough for mixed Japanese/English text. */
export const CHARS_PER_TOKEN = 3;
/** Findings whose estimated saving is below this share of the total weight are omitted. */
export const MIN_SHARE = 0.005;
/** A tool result at or above this many characters counts as "large". */
export const LARGE_RESULT_CHARS = 10000;
/** Tokens assumed for the handoff summary a fresh session starts with. */
export const HANDOFF_CONTEXT = 5000;
/** Tokens assumed to stay in the main context when a large result is delegated or narrowed. */
export const SUMMARY_TOKENS = 1000;
/** Requests needed before and after a task boundary for /clear to be mentioned. */
export const BOUNDARY_BEFORE = 20, BOUNDARY_AFTER = 30;

// Finding kinds:
//   'mechanical' a definition or settings edit that can be applied as written (with the
//                person's consent)
//   'warning'    a usage habit that is costly in most cases and has no file to edit; the skill
//                tells it as a warning (警告), adding when the old way is still fine
//   'judgement'  a trade-off (quality, effort, needed context) the person decides (検討)

const FIVE_MIN = 300, HOUR = 3600;
const BUILT_IN = new Set(['general-purpose', 'Explore', 'Plan', 'statusline-setup', 'claude-code-guide', 'output-style-setup']);

const basename = (p) => String(p).replace(/\\/g, '/').split('/').pop();
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, q) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
/** Thousands separators without Intl, so the output does not depend on the locale. */
export const fmt = (x) => {
  const v = Math.round(Number(x) || 0), s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return v < 0 ? '-' + s : s;
};
const pctOf = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');

/**
 * What a user record is, for telling resumes from waits:
 *   'prompt'       a message to the thread: a typed prompt (origin.kind 'human' where present),
 *                  a SendMessage to a subagent (an isMeta user record with origin.kind
 *                  'coordinator'), or a message from another session (isMeta, origin 'peer')
 *   'notification' a background task's completion notice (origin.kind 'task-notification')
 *   'result'       tool results
 *   null           anything else: meta notices (skill bodies, reminders), interruption markers
 */
function userKind(r) {
  const c = r.message && r.message.content;
  if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return 'result';
  const origin = r.origin && r.origin.kind;
  if (origin === 'coordinator' || origin === 'peer' || origin === 'human') return 'prompt';
  if (origin === 'task-notification') return 'notification';
  if (r.isMeta || r.isCompactSummary) return null;
  const text = typeof c === 'string' ? c
    : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => String(b.text || '')).join('') : '';
  if (!text || text.startsWith('[Request interrupted')) return null;
  return 'prompt';
}

/** Display target of a tool call: a file basename, a URL host or an agent type; never content. */
function targetOfCall(name, inp = {}) {
  if ((name === 'Read' || name === 'Edit' || name === 'Write' || name === 'NotebookEdit') && inp.file_path) return basename(inp.file_path);
  if (name === 'WebFetch' && inp.url) { try { return new URL(String(inp.url)).host; } catch { return ''; } }
  if ((name === 'Agent' || name === 'Task') && inp.subagent_type) return String(inp.subagent_type);
  return '';
}

/** Full path a tool call touches (for task-boundary detection only; never output). */
function pathOfCall(name, inp = {}) {
  const p = inp.file_path || inp.notebook_path || ((name === 'Grep' || name === 'Glob') && inp.path) || '';
  return p ? String(p).replace(/\\/g, '/').toLowerCase() : '';
}

/**
 * Positional pass over one thread, complementing aggregate.js's parseThread. Request ids are
 * taken the same way parseThread takes them. Returns:
 *   triggers: request id -> what started it:
 *     'start'        the first request
 *     'resume'       a new prompt arrived after the thread's turn had ended (the previous
 *                    request called no tool, its tool result carried toolEndsTurn, as the
 *                    final-report tool does, or an API error such as the usage limit stopped
 *                    it). For a subagent this is a SendMessage resume: the gap before it is the
 *                    coordinator's idle time
 *     'tool'         tool results, i.e. a step inside a turn; the gap before it is the tool's
 *                    run time (a long Bash, a permission prompt), even if a message was
 *                    injected meanwhile
 *     'notification' a background task's completion notice
 *     'other'        none of these
 *   resumeIds: the ids whose trigger is 'resume'
 *   results: where each tool result enters the context (`at`: how many requests came before
 *     it, so request #at is the first that carries it)
 *   touches: [{ at, path }] files the thread's tool calls touched, by request index
 *   attachments: [{ type, at, chars, isInitial, content }] context the harness added (see
 *     ATTACHMENT_KINDS); `at` as for results. `content` is kept for skill listings only, to
 *     split them by plugin; it never reaches the output
 *   skillCalls: [{ at, name }] Skill tool calls (`at`: the request that made the call)
 *   commands: [{ at, name }] slash commands typed by the person (`at`: the request after)
 */
export function scanThread(records) {
  const seen = new Set(), triggers = new Map(), resumeIds = new Set(), results = [], touches = [];
  const attachments = [], skillCalls = [], commands = [];
  const toolName = new Map(), toolTarget = new Map();
  let sawPrompt = false, sawResult = false, sawNotice = false, prevCalledTool = false, turnEnded = false;
  for (const r of records || []) {
    if (!r || typeof r !== 'object') continue;
    if (r.type === 'assistant') {
      const m = r.message || {};
      // An API error (such as the usage limit) stops the turn where it is, even mid-tool-loop;
      // the next prompt is then a resume.
      if (r.isApiErrorMessage && seen.size) turnEnded = true;
      if (m.model === '<synthetic>' || !m.usage) continue;
      const id = m.id || r.requestId || r.uuid;
      if (!seen.has(id)) {
        const ended = !seen.size || turnEnded || !prevCalledTool;
        const trig = !seen.size ? 'start' : (sawPrompt && ended) ? 'resume' : sawResult ? 'tool' : sawNotice ? 'notification' : 'other';
        seen.add(id);
        triggers.set(id, trig);
        if (trig === 'resume') resumeIds.add(id);
        sawPrompt = sawResult = sawNotice = prevCalledTool = turnEnded = false;
      }
      for (const b of m.content || []) {
        if (!b || b.type !== 'tool_use') continue;
        prevCalledTool = true;
        const name = b.name || '?', inp = b.input || {};
        toolName.set(b.id, name);
        toolTarget.set(b.id, targetOfCall(name, inp));
        const p = pathOfCall(name, inp);
        if (p) touches.push({ at: seen.size - 1, path: p });
        if (name === 'Skill' && inp.skill) skillCalls.push({ at: seen.size - 1, name: String(inp.skill) });
      }
    } else if (r.type === 'attachment') {
      const a = r.attachment;
      const chars = a && ATTACHMENT_KINDS[a.type] ? ATTACHMENT_KINDS[a.type](a) : 0;
      if (chars) attachments.push({ type: a.type, at: seen.size, chars, isInitial: a.isInitial !== false,
        content: a.type === 'skill_listing' ? String(a.content) : '' });
    } else if (r.type === 'user') {
      const c = r.message && r.message.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => String(b.text || '')).join('') : '';
      for (const m of text.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) commands.push({ at: seen.size, name: m[1] });
      const kind = userKind(r);
      if (kind === 'result') {
        sawResult = true;
        if (r.toolEndsTurn === true) turnEnded = true;
        for (const b of r.message.content) {
          if (!b || b.type !== 'tool_result') continue;
          const ct = b.content;
          const chars = Array.isArray(ct) ? ct.reduce((n, x) => n + ((x && typeof x.text === 'string') ? x.text.length : 0), 0)
            : (typeof ct === 'string' ? ct.length : 0);
          results.push({ tool: toolName.get(b.tool_use_id) || '?', target: toolTarget.get(b.tool_use_id) || '', chars, at: seen.size });
        }
      } else if (kind === 'prompt') sawPrompt = true;
      else if (kind === 'notification') sawNotice = true;
    }
  }
  return { triggers, resumeIds, results, touches, attachments, skillCalls, commands };
}

/**
 * Attachments measured here, with the characters each puts into the context:
 *   skill_listing           the "- name: description" list of the skills the thread may load
 *   deferred_tools_delta    the lines naming tools that can be loaded on demand
 *   mcp_instructions_delta  the MCP servers' instruction blocks
 */
const joined = (xs) => (Array.isArray(xs) ? xs.map(String).join('\n').length : 0);
const ATTACHMENT_KINDS = {
  skill_listing: (a) => String(a.content || '').length,
  deferred_tools_delta: (a) => joined(a.addedLines),
  mcp_instructions_delta: (a) => joined(a.addedBlocks),
};
/** Names of the start-breakdown parts, by attachment type. */
const PARTS = { skill_listing: 'skillListing', deferred_tools_delta: 'deferredTools', mcp_instructions_delta: 'mcpInstructions' };

/**
 * A skill listing split into entries: each "- " line starts one (continuation lines belong to
 * it), name = the text before ": " or " (". chars include the line breaks.
 */
export function listingEntries(content) {
  const out = [];
  for (const line of String(content || '').split('\n')) {
    if (line.startsWith('- ')) {
      const m = /^[^\s(]+?(?=: | \(|:?$)/.exec(line.slice(2));
      out.push({ name: m ? m[0] : line.slice(2), chars: line.length + 1 });
    } else if (out.length) out[out.length - 1].chars += line.length + 1;
  }
  // the last piece of split() has no line break after it
  if (out.length) out[out.length - 1].chars -= 1;
  return out;
}
/** The plugin a skill comes from: the part before ':', or '' for project and user skills. */
const pluginOf = (name) => (String(name).includes(':') ? String(name).split(':')[0] : '');

/**
 * A task boundary in one main thread, if the transcript shows one: request index k such that
 * no file touched before k is touched again from k on, with at least BOUNDARY_BEFORE requests
 * and 3 files before, and BOUNDARY_AFTER requests and 3 files after, before the next context
 * drop. Among such k the one whose later requests carry the most earlier context is returned:
 *   carried = sum over requests j in [k, next drop) of m_j * 0.1 * max(0, ctx(k-1) - fresh)
 * Files are the only evidence the transcript gives; whether the conversation before k was
 * needed later cannot be seen, so this is shown as an option, never as a saving.
 */
function taskBoundary(t, fresh, mw, T) {
  const n = t.rows.length;
  if (n < BOUNDARY_BEFORE + BOUNDARY_AFTER) return null;
  const span = new Map();
  for (const x of t.touches) {
    const s = span.get(x.path) || { first: x.at, last: x.at };
    s.first = Math.min(s.first, x.at); s.last = Math.max(s.last, x.at); span.set(x.path, s);
  }
  // cover[k] > 0 when some file is touched both before k and at or after k
  const diff = new Array(n + 1).fill(0);
  for (const s of span.values()) if (s.last > s.first) { diff[s.first + 1] += 1; diff[s.last + 1] -= 1; }
  const firsts = [...span.values()].map((s) => s.first);
  // the stretch around k: from the last context drop at or before k to the next one after it
  const prevDrop = new Array(n).fill(0), nextDrop = new Array(n).fill(n);
  for (let i = 1; i < n; i++) prevDrop[i] = t.rows[i].drop ? i : prevDrop[i - 1];
  for (let i = n - 2; i >= 0; i--) nextDrop[i] = t.rows[i + 1].drop ? i + 1 : nextDrop[i + 1];
  let cover = 0, best = null;
  for (let k = 0; k < n; k++) {
    cover += diff[k];
    if (cover > 0 || t.rows[k].drop) continue;
    const from = prevDrop[k], stop = nextDrop[k];
    if (k - from < BOUNDARY_BEFORE || stop - k < BOUNDARY_AFTER) continue;
    const before = firsts.filter((f) => f >= from && f < k).length;
    const after = firsts.filter((f) => f >= k && f < stop).length;
    if (before < 3 || after < 3) continue;
    const excess = Math.max(0, t.rows[k - 1].ctx - fresh);
    let carried = 0;
    for (let j = k; j < stop; j++) if (t.rows[j].inRange) carried += mw(t.rows[j].q) * T.cache_read * excess;
    if (carried > 0 && (!best || carried > best.carried)) best = { request: k + 1, after: stop - k, context: t.rows[k - 1].ctx, carried };
  }
  return best;
}

/**
 * sessions: [{ id, project, main: records[], subagents: [{ id, meta, records }] }]
 * opts: { since, until (epoch ms, until exclusive), top, weights,
 *   agentDefs: { [agentType]: { path, cacheTtl, tools, model } } (located by audit.js) }
 *
 * A request counts when its timestamp is in [since, until). Thread-shape facts (first and last
 * context, gaps, resumes) are read on the whole thread so a range boundary does not invent a gap.
 */
export function audit(sessions, opts = {}) {
  const W = opts.weights || DEFAULT_WEIGHTS;
  const T = W.type;
  const top = opts.top ?? 10;
  const defs = opts.agentDefs || {};
  const inRange = (ts) => (opts.since == null || ts >= opts.since) && (opts.until == null || ts < opts.until);
  const mw = (q) => modelWeight(q.model, W);
  const weigh = (q) => mw(q) * (T.input * q.tok.input + T.cache_read * q.tok.cache_read + T.cache_write_5m * q.tok.cache_write_5m
    + T.cache_write_1h * q.tok.cache_write_1h + T.output * q.tok.output);
  const writeTok = (q) => q.tok.cache_write_5m + q.tok.cache_write_1h;
  const writeWeigh = (q) => mw(q) * (T.cache_write_5m * q.tok.cache_write_5m + T.cache_write_1h * q.tok.cache_write_1h);

  // ---- threads with per-request annotations
  const threads = [];
  for (const s of sessions) {
    const parts = [{ id: 'main', kind: 'main', agentType: '(main)', records: s.main || [] }]
      .concat((s.subagents || []).map((a) => ({ id: a.id, kind: 'sub', agentType: (a.meta && a.meta.agentType) || '?', records: a.records || [] })));
    for (const p of parts) {
      const { requests } = parseThread(p.records);
      if (!requests.length) continue;
      const { triggers, results, touches, attachments, skillCalls, commands } = scanThread(p.records);
      let ttl = FIVE_MIN;
      const rows = requests.map((q, i) => {
        const prev = requests[i - 1];
        if (prev) { if (prev.tok.cache_write_1h) ttl = HOUR; else if (prev.tok.cache_write_5m) ttl = FIVE_MIN; }
        const ctx = contextOf(q.tok);
        const trigger = triggers.get(q.id) || 'other';
        return { q, i, ctx, inRange: inRange(q.ts), weighted: weigh(q), gap: prev ? (q.ts - prev.ts) / 1000 : 0, ttl: prev ? ttl : null,
          trigger, resume: p.kind === 'sub' && trigger === 'resume', prevCtx: prev ? contextOf(prev.tok) + prev.tok.output : 0,
          drop: !!prev && ctx < 0.6 * contextOf(prev.tok) };
      });
      const w5 = sum(requests.map((q) => q.tok.cache_write_5m)), w1 = sum(requests.map((q) => q.tok.cache_write_1h));
      threads.push({ key: `${s.id}/${p.id}`, session: s.id, project: s.project || '', kind: p.kind, agentType: p.agentType,
        rows, results, touches, attachments, skillCalls, commands, writeType: w1 > w5 ? 'cache_write_1h' : 'cache_write_5m' });
    }
  }
  /**
   * Weight of `tokens` that enter a thread before request #at and stay until the next context
   * drop: written once by request #at (at the thread's write weight), then read by each later
   * request. Only requests in range count.
   */
  const carryOf = (t, at, tokens) => {
    const out = { write: 0, read: 0, requests: 0 };
    if (at >= t.rows.length) return out;
    const r0 = t.rows[at];
    if (r0.inRange) out.write = mw(r0.q) * T[t.writeType] * tokens;
    for (let j = at + 1; j < t.rows.length && !t.rows[j].drop; j++) {
      if (!t.rows[j].inRange) continue;
      out.read += mw(t.rows[j].q) * T.cache_read * tokens; out.requests += 1;
    }
    return out;
  };
  const live = threads.filter((t) => t.rows.some((r) => r.inRange));
  const agg = aggregateThreads(live.map((t) => ({ key: t.key, label: t.key, agentType: t.agentType, description: '',
    requests: t.rows.filter((r) => r.inRange).map((r) => r.q) })), { weights: W, top });
  const total = agg.total.weighted;
  const sessionIds = [...new Set(live.map((t) => t.session))];

  // ---- cache gap tax: requests after > 5 min idle; "expired" when the gap passed the TTL the
  // thread's previous request wrote with, so that request's cache write is (mostly) a rewrite
  const tax = {};
  // byTrigger: what started the request after the gap (see scanThread): 'resume' is a new
  // prompt or SendMessage after the turn ended, 'tool' a long tool wait inside a turn.
  const taxEntry = () => ({ requests: 0, write: 0, weighted: 0, byTrigger: {} });
  for (const kind of ['main', 'sub']) tax[kind] = { expired: taxEntry(), within: taxEntry() };
  for (const t of live) for (const r of t.rows) {
    if (!r.inRange || r.i === 0 || r.gap <= FIVE_MIN) continue;
    const e = tax[t.kind][r.gap > r.ttl ? 'expired' : 'within'];
    e.requests += 1; e.write += writeTok(r.q); e.weighted += writeWeigh(r.q);
    e.byTrigger[r.trigger] = (e.byTrigger[r.trigger] || 0) + 1;
  }

  // ---- main thread context
  const mains = live.filter((t) => t.kind === 'main');
  const mainRows = mains.flatMap((t) => t.rows.filter((r) => r.inRange));
  const ctxs = mainRows.map((r) => r.ctx);
  const firstMain = mains.map((t) => t.rows[0].ctx);
  // A fresh session's starting context: the median first request of the sessions in scope.
  const fresh = firstMain.length ? median(firstMain) : 40000;
  const mainReadWeight = sum(mainRows.map((r) => mw(r.q) * T.cache_read * r.q.tok.cache_read));
  const mainModels = new Map();
  for (const r of mainRows) mainModels.set(r.q.model, (mainModels.get(r.q.model) || 0) + 1);
  const mainModel = [...mainModels.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])[0] || '';
  const bySession = mains.map((t) => {
    const rs = t.rows.filter((r) => r.inRange);
    return { session: t.session.slice(0, 8), project: t.project, requests: rs.length, meanContext: sum(rs.map((r) => r.ctx)) / rs.length,
      maxContext: Math.max(...rs.map((r) => r.ctx)), weighted: sum(rs.map((r) => r.weighted)) };
  }).sort((a, b) => b.weighted - a.weighted);
  const mainContext = {
    requests: ctxs.length, mean: ctxs.length ? sum(ctxs) / ctxs.length : 0, median: median(ctxs), p90: quantile(ctxs, 0.9),
    max: ctxs.length ? Math.max(...ctxs) : 0, freshStart: fresh, cacheReadWeighted: mainReadWeight,
    drops: sum(mains.map((t) => t.rows.filter((r) => r.inRange && r.drop).length)), sessions: bySession.slice(0, top),
  };

  // ---- subagents per agent type
  const typeMap = new Map();
  for (const t of live.filter((x) => x.kind === 'sub')) {
    const e = typeMap.get(t.agentType) || { agentType: t.agentType, threads: [] };
    e.threads.push(t); typeMap.set(t.agentType, e);
  }
  const agentTypes = [...typeMap.values()].map((e) => {
    const ts = e.threads, rows = ts.flatMap((t) => t.rows.filter((r) => r.inRange));
    const firsts = ts.map((t) => t.rows[0].ctx), lasts = ts.map((t) => t.rows[t.rows.length - 1].ctx);
    const resumes = ts.flatMap((t) => t.rows.filter((r) => r.inRange && r.resume));
    const models = [...new Set(rows.map((r) => r.q.model))].sort();
    return {
      agentType: e.agentType, runs: ts.length, requests: rows.length, weighted: sum(rows.map((r) => r.weighted)), models,
      firstContext: { min: Math.min(...firsts), median: median(firsts), max: Math.max(...firsts) },
      lastContext: { median: median(lasts), max: Math.max(...lasts) },
      growth: median(ts.map((t) => t.rows[t.rows.length - 1].ctx / Math.max(1, t.rows[0].ctx))),
      requestsPerRun: median(ts.map((t) => t.rows.length)),
      resumes: resumes.length,
      resumesExpired: resumes.filter((r) => r.gap > r.ttl).length,
      write5m: sum(rows.map((r) => r.q.tok.cache_write_5m)), write1h: sum(rows.map((r) => r.q.tok.cache_write_1h)),
      definition: targetOf(e.agentType, defs).definition,
      _threads: ts,
    };
  }).sort((a, b) => b.weighted - a.weighted);

  // ---- findings
  const findings = [];
  const add = (f) => findings.push({ ...f, share: total ? f.saving / total : 0 });

  // 1. What the main thread carries from request to request, split in two:
  //    (a) large tool results that entered the main thread (Read, Bash, WebFetch, Grep, subagent
  //        reports, ...; >= LARGE_RESULT_CHARS, tokens = chars / CHARS_PER_TOKEN). Per result:
  //          carry = sum over the later main requests up to the next context drop > 40% (or the
  //                  session end), in range, of  m * 0.1 * tokens
  //          saving = the same with max(0, tokens - SUMMARY_TOKENS): what stays out if only the
  //                  point enters (a subagent's summary, a narrow read, a WebFetch answer).
  //        The 1h write when it entered and the delegate's own cost are left out (the first is
  //        saved, the second spent; they roughly offset), so this is rough.
  //    (b) everything else: main cache reads minus (a): the conversation itself, the system
  //        prompt and tool definitions, smaller results. It is the work's own context, so no
  //        saving is claimed for it: the measure is the cost of finishing the work, and a fresh
  //        session refills to what the work needs and loses context that must be re-explained.
  //    /clear or a fresh session is mentioned only where taskBoundary() finds a stretch after
  //    which the earlier files were not touched again; never as the default.
  const large = [];
  for (const t of mains) {
    const nextDrop = new Array(t.rows.length).fill(t.rows.length);
    for (let i = t.rows.length - 2; i >= 0; i--) nextDrop[i] = t.rows[i + 1].drop ? i + 1 : nextDrop[i + 1];
    for (const x of t.results) {
      if (x.chars < LARGE_RESULT_CHARS || x.at >= t.rows.length) continue;
      const tokens = x.chars / CHARS_PER_TOKEN;
      let carry = 0, saving = 0, n = 0;
      for (let j = x.at + 1; j < nextDrop[x.at]; j++) {
        const r = t.rows[j];
        if (!r.inRange) continue;
        n += 1;
        carry += mw(r.q) * T.cache_read * tokens;
        saving += mw(r.q) * T.cache_read * Math.max(0, tokens - SUMMARY_TOKENS);
      }
      if (n) large.push({ tool: x.tool, target: x.target, session: t.session.slice(0, 8), chars: x.chars, tokens, requests: n, carry, saving });
    }
  }
  large.sort((a, b) => b.carry - a.carry);
  const largeCarry = sum(large.map((x) => x.carry));
  const restCarry = Math.max(0, mainReadWeight - largeCarry);
  const boundaries = mains.map((t) => ({ session: t.session.slice(0, 8), ...(taskBoundary(t, fresh, mw, T) || {}) }))
    .filter((b) => b.carried).sort((a, b) => b.carried - a.carried);
  mainContext.largeResults = { count: large.length, carry: largeCarry, top: large.slice(0, top) };
  mainContext.otherCarry = restCarry;
  mainContext.taskBoundaries = boundaries.slice(0, top);
  if (large.length) {
    const saving = sum(large.map((x) => x.saving));
    const label = (x) => `${x.tool}${x.target ? ' ' + x.target : ''} in ${x.session}: ~${fmt(x.tokens)} tokens x ${x.requests} req = ${fmt(x.carry)}`;
    add({ id: 'main-context', title: 'Large one-off output carried in the main conversation', saving, kind: 'judgement',
      target: { thread: 'main' },
      evidence: [
        `${fmt(mainRows.length)} main requests in ${mains.length} sessions; context mean ${fmt(mainContext.mean)}, median ${fmt(mainContext.median)}, p90 ${fmt(mainContext.p90)}, max ${fmt(mainContext.max)} tokens`,
        `main-thread cache reads: ${fmt(mainReadWeight)} weighted = ${pctOf(mainReadWeight, total)} of all; of that, (a) large tool results (>= ${fmt(LARGE_RESULT_CHARS)} chars, ${large.length} of them) carry ~${fmt(largeCarry)} = ${pctOf(largeCarry, total)}, (b) the conversation itself, system prompt and tools, smaller results ~${fmt(restCarry)} = ${pctOf(restCarry, total)}`,
        'heaviest large results (carried weight until the next context drop): ' + large.slice(0, 5).map(label).join('; '),
        ...(boundaries.length ? ['possible task boundaries (files touched before are not touched again after): '
          + boundaries.slice(0, 3).map((b) => `${b.session} at request #${b.request} (context ${fmt(b.context)}, ${b.after} requests after, ~${fmt(b.carried)} carried)`).join('; ')] : []),
      ],
      action: 'Keep one-off large output out of the main conversation: delegate the reading to a subagent that returns only the point, write large output to a file and read only the needed part, ask WebFetch a question that returns only the answer. '
        + 'The rest, (b), is the context the work needs: do not cut it; fewer requests help (batch tool calls in one turn, fewer background-completion notices).'
        + (boundaries.length ? ' At the task boundaries listed above, if the next work did not need the earlier conversation, /clear or a fresh session was also an option (the transcript cannot show whether it was needed).' : '') });
  }

  // 2. Subagents resumed after their 5m cache expired, per agent type.
  //    Per such resume (5m TTL, gap > 5 min and <= 1 h, so a 1h TTL would still have been alive):
  //      R = min(cache write of the resume, previous context + previous output)  (the rewrite)
  //      avoided = m * (1.25 - 0.1) * R     (written again at 1.25 instead of read at 0.1)
  //    cost of switching the type to 1h:  extra = m * (2 - 1.25) * (all 5m writes of the type - sum R)
  //    saving = sum avoided - extra; reported only when positive. Gaps over 1 h are not avoidable.
  for (const a of agentTypes) {
    if (a.write1h > a.write5m) continue;
    let avoided = 0, rTok = 0, k = 0, over = 0, within = 0, extra = 0;
    for (const t of a._threads) for (const r of t.rows) {
      if (!r.inRange) continue;
      extra += mw(r.q) * (T.cache_write_1h - T.cache_write_5m) * r.q.tok.cache_write_5m;
      if (!r.resume) continue;
      if (r.gap <= r.ttl) { within += 1; continue; }
      if (r.gap > HOUR || r.ttl !== FIVE_MIN || !r.q.tok.cache_write_5m) { over += 1; continue; }
      const R = Math.min(r.q.tok.cache_write_5m, r.prevCtx);
      avoided += mw(r.q) * (T.cache_write_5m - T.cache_read) * R;
      extra -= mw(r.q) * (T.cache_write_1h - T.cache_write_5m) * R;
      rTok += R; k += 1;
    }
    const saving = avoided - extra;
    if (!k || saving <= 0) continue;
    const tg = targetOf(a.agentType, defs);
    const def = defs[a.agentType];
    const alreadyHour = def && String(def.cacheTtl || '') === '1h';
    const editable = tg.custom && !alreadyHour;
    add({ id: `subagent-ttl:${a.agentType}`, title: `${a.agentType}: resumed after its 5-minute cache expired`, saving,
      kind: editable ? 'mechanical' : 'judgement', target: tg,
      evidence: [
        `${a.runs} runs, ${a.resumes} resumes: ${k} after 5 min-1 h (avoidable), ${over} after > 1 h, ${within} within the TTL`,
        `rewritten on the avoidable resumes: ${fmt(rTok)} tokens, ${fmt(avoided)} weighted more than reading them`,
        `extra cost of 1h writes on this type: ${fmt(extra)} weighted`,
      ],
      action: alreadyHour
        ? 'The definition already sets cacheTtl: 1h but the transcripts show 5-minute writes: check the subagentPromptCacheTtl setting / CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL (they take precedence) or usage credits (1h ignored). Or ask follow-ups in one batch.'
        : tg.custom
          ? `Add "cacheTtl: 1h" under "experimental:" in the frontmatter of ${tg.definition}, or ask follow-up questions in one batch.`
          : 'Built-in definitions cannot be edited: make a custom agent for this role with experimental.cacheTtl: 1h, or ask follow-ups in one batch / re-read in the main thread instead of resuming after 5 min.' });
  }

  // 3. Main thread resumed after more than an hour idle (its 1h cache had expired).
  //    Per such request: saving = m * w * max(0, rewrite - (fresh + HANDOFF_CONTEXT)) - m * 5 * HANDOFF_OUTPUT
  //    (w = the write weight it paid), i.e. rewriting only a fresh start plus a handoff summary
  //    instead of the whole conversation, minus writing the handoff. Later requests of the fresh
  //    session being cheaper is not counted (conservative).
  //    Listed per session (resumes, each gap in hours, the context at each resume, the rewrite
  //    weight), heaviest rewrite first. kind 'warning': a habit, nothing to edit.
  {
    let saving = 0, k = 0, rw = 0, rwW = 0;
    const idle = [];
    for (const t of mains) {
      const e = { session: t.session.slice(0, 8), project: t.project, resumes: 0, gapsHours: [], contexts: [], rewriteTokens: 0, rewriteWeighted: 0 };
      for (const r of t.rows) {
        if (!r.inRange || r.i === 0 || r.gap <= HOUR || r.gap <= r.ttl) continue;
        const wt = writeTok(r.q);
        if (!wt) continue;
        const w = r.q.tok.cache_write_1h >= r.q.tok.cache_write_5m ? T.cache_write_1h : T.cache_write_5m;
        k += 1; rw += wt; rwW += writeWeigh(r.q);
        saving += Math.max(0, mw(r.q) * w * Math.max(0, wt - (fresh + HANDOFF_CONTEXT)) - mw(r.q) * T.output * HANDOFF_OUTPUT);
        e.resumes += 1; e.gapsHours.push(Math.round(r.gap / 360) / 10); e.contexts.push(r.ctx);
        e.rewriteTokens += wt; e.rewriteWeighted += writeWeigh(r.q);
      }
      if (e.resumes) idle.push(e);
    }
    idle.sort((a, b) => b.rewriteWeighted - a.rewriteWeighted);
    mainContext.idleResumes = idle.slice(0, top);
    if (k && saving > 0) {
      add({ id: 'main-idle', title: 'Main conversation resumed after its 1-hour cache expired', saving, kind: 'warning',
        target: { thread: 'main' },
        evidence: [
          `${k} resumes after > 1 h idle in ${idle.length} sessions rewrote ${fmt(rw)} tokens (${fmt(rwW)} weighted = ${pctOf(rwW, total)} of all)`,
          `a fresh start with a handoff would write about ${fmt(fresh + HANDOFF_CONTEXT)} tokens`,
          ...idle.slice(0, 5).map((x) => `${x.session}: ${x.resumes} resume${x.resumes > 1 ? 's' : ''}, gaps ${x.gapsHours.map((h) => h + ' h').join(', ')}; context ${x.contexts.map(fmt).join(', ')}; rewrite ${fmt(x.rewriteWeighted)} weighted (${pctOf(x.rewriteWeighted, total)})`),
        ],
        action: 'When coming back after an hour or more, start a new session with a handoff note written before leaving (while the cache is warm); do not reopen the old session just to ask it for a handoff. If the earlier conversation is really needed, continuing is fine.' });
    }
  }

  let skillListing = null;
  // 4. What an agent type's tool permissions bring into its context (agent-tools).
  //    Measured from the attachments in its transcripts (see ATTACHMENT_KINDS): the skill
  //    listing (sent when the definition allows Skill or sets no tools), the deferred-tools and
  //    MCP-instructions deltas (sent when it sets no tools). Per attachment:
  //      tokens = chars / CHARS_PER_TOKEN
  //      cost   = carryOf(): m * w * tokens for the request that writes it (w = the run's write
  //               weight) + m * 0.1 * tokens for each later request of the run until a drop
  //    A part's cost is the sum over the type's runs; saving = the cost of the parts the action
  //    removes:
  //      definition file with Skill in tools      -> remove Skill: the skill listing
  //      definition file without tools (all tools) -> list only the tools it needs: all three
  //      built-in / plugin / not located           -> an own definition with restricted tools: all three
  //      definition file with tools and no Skill   -> nothing to remove, no finding
  //    Subagents' skill listings are counted here only; the skill-listing finding (4b) covers
  //    the main threads, so the same listing is never counted twice.
  for (const a of agentTypes) {
    const tg = targetOf(a.agentType, defs);
    const def = defs[a.agentType] || {};
    const tools = String(def.tools || '').trim();
    const allTools = !tools || tools === '*';
    const permission = !tg.custom ? 'not-editable' : allTools ? 'all-tools' : /\bSkill\b/.test(tools) ? 'skill' : 'restricted';
    const removable = permission === 'skill' ? ['skillListing'] : permission === 'restricted' ? [] : ['skillListing', 'deferredTools', 'mcpInstructions'];
    const parts = {};
    // per part: runs that had it, median chars per such run, how many were sent after the
    // run's first request (later), and the weight they cost
    for (const key of Object.values(PARTS)) parts[key] = { runs: 0, chars: [], later: 0, write: 0, read: 0, cost: 0 };
    for (const t of a._threads) {
      const perRun = {};
      for (const x of t.attachments) {
        const key = PARTS[x.type];
        if (!key || x.at >= t.rows.length) continue;
        const e = parts[key], c = carryOf(t, x.at, x.chars / CHARS_PER_TOKEN);
        perRun[key] = (perRun[key] || 0) + x.chars;
        if (x.at > 0) e.later += 1;
        e.write += c.write; e.read += c.read; e.cost += c.write + c.read;
      }
      for (const [key, n] of Object.entries(perRun)) { parts[key].runs += 1; parts[key].chars.push(n); }
    }
    for (const e of Object.values(parts)) { e.chars = median(e.chars); e.tokens = e.chars / CHARS_PER_TOKEN; }
    // skills the type loaded in range: when it did, dropping Skill is a trade-off, not an edit
    const loaded = new Map();
    for (const t of a._threads) for (const c of t.skillCalls) if (c.at < t.rows.length && t.rows[c.at].inRange) loaded.set(c.name, (loaded.get(c.name) || 0) + 1);
    const skillCalls = sum([...loaded.values()]);
    const saving = sum(removable.map((k) => parts[k].cost));
    a.startBreakdown = { permission, tools: tg.custom ? (tools || null) : null, parts, removable, saving,
      skillCalls, skillsLoaded: [...loaded.entries()].sort((x, y) => y[1] - x[1]).map(([name, n]) => ({ name, calls: n })) };
    if (!(saving > 0)) continue;
    const label = { skillListing: 'skill listing', deferredTools: 'deferred tools list', mcpInstructions: 'MCP server instructions' };
    const partLine = (k) => `${label[k]}: in ${parts[k].runs} of ${a.runs} runs, median ~${fmt(parts[k].tokens)} tokens per run (${fmt(parts[k].chars)} chars)`
      + `${parts[k].later ? `, ${parts[k].later} of them sent after the first request` : ''}; ${fmt(parts[k].cost)} weighted (${pctOf(parts[k].cost, total)})${removable.includes(k) ? '' : ', stays'}`;
    add({ id: `agent-tools:${a.agentType}`, title: `${a.agentType}: what its tool permissions add to every run`, saving,
      kind: tg.custom && !skillCalls ? 'mechanical' : 'judgement', target: tg,
      evidence: [
        `${a.runs} runs, median ${a.requestsPerRun} requests per run on ${a.models.join(', ')}; first-request context median ${fmt(a.firstContext.median)} (min ${fmt(a.firstContext.min)}, max ${fmt(a.firstContext.max)})`,
        ...Object.keys(parts).filter((k) => parts[k].runs).map(partLine),
        tg.custom ? `${tg.definition}: ${tools ? `tools: ${tools}` : 'no tools line (all tools)'}`
          : `${tg.definition} definition: cannot be edited`,
        skillCalls ? `it loaded skills in this range: ${a.startBreakdown.skillsLoaded.map((x) => `${x.name} ${x.calls}x`).join(', ')}` : 'it loaded no skill in this range',
      ],
      action: permission === 'skill'
        ? (skillCalls
          ? `${a.agentType} loads skills: remove "Skill" from "tools:" in ${tg.definition} only if what it loads can be given in the prompt instead.`
          : `If ${a.agentType} does not need to load skills, remove "Skill" from "tools:" in ${tg.definition} (give it what it needs in the prompt instead).`)
        : permission === 'all-tools'
          ? `Add a "tools:" line to ${tg.definition} that lists only the tools ${a.agentType} needs (leave out Skill unless it loads skills).`
          : `This definition cannot be edited: make an own agent definition for this role whose "tools:" lists only the tools it needs (without Skill unless it loads skills), and use it instead of ${a.agentType}.` });
  }

  // 4b. The skill listing in the main threads (skill-listing).
  //    Every skill_listing attachment in a main thread: the one at the start, re-injections of
  //    the full listing later in the session (isInitial), and small additions (isInitial false).
  //    Per listing: carry = carryOf() with tokens = chars / CHARS_PER_TOKEN, i.e. its write plus
  //    its reads by the later requests up to the next context drop (the start listing's write is
  //    included too: turning a plugin off removes it from that write as well).
  //    Each listing is split by plugin (listingEntries / pluginOf); a plugin's carry = sum over
  //    listings of carry * its chars / the listing's chars. A plugin is "used" when one of its
  //    skills was invoked in range in any thread (Skill tool call or slash command; a bare name
  //    matches a listed "<plugin>:<name>").
  //    saving = the carry of the plugins with no use in range. Project and user skills (no
  //    prefix) are never counted as saving. Subagents' listings are left to agent-tools (4).
  {
    const listedNames = new Set();
    for (const t of live) for (const x of t.attachments) if (x.type === 'skill_listing') for (const e of listingEntries(x.content)) listedNames.add(e.name);
    const resolve = (name) => {
      const n = String(name).replace(/^\//, '').trim();
      if (n.includes(':')) return [pluginOf(n)];
      if (listedNames.has(n)) return [''];
      return [...listedNames].filter((x) => x.endsWith(':' + n)).map(pluginOf);
    };
    const uses = new Map();
    for (const t of live) for (const c of [...t.skillCalls, ...t.commands]) {
      if (c.at >= t.rows.length || !t.rows[c.at].inRange) continue;
      for (const p of resolve(c.name)) uses.set(p, (uses.get(p) || 0) + 1);
    }
    const plugins = new Map();
    const plug = (p) => plugins.get(p) || plugins.set(p, { plugin: p, skills: new Set(), chars: 0, uses: uses.get(p) || 0, carry: 0 }).get(p);
    const perSession = [];
    let write = 0, read = 0, listings = 0, chars = 0;
    for (const t of mains) {
      const s = { session: t.session.slice(0, 8), startChars: 0, reinjections: 0, additions: 0, carry: 0 };
      for (const x of t.attachments) {
        if (x.type !== 'skill_listing' || x.at >= t.rows.length) continue;
        const c = carryOf(t, x.at, x.chars / CHARS_PER_TOKEN), carry = c.write + c.read;
        if (!carry) continue;
        listings += 1; chars += x.chars; write += c.write; read += c.read; s.carry += carry;
        if (x.at === 0) s.startChars += x.chars; else if (x.isInitial) s.reinjections += 1; else s.additions += 1;
        const byPlugin = new Map();
        for (const e of listingEntries(x.content)) {
          const p = plug(pluginOf(e.name));
          p.skills.add(e.name);
          byPlugin.set(p, (byPlugin.get(p) || 0) + e.chars);
        }
        for (const [p, n] of byPlugin) { p.chars = Math.max(p.chars, n); p.carry += carry * n / x.chars; }
      }
      if (s.carry) perSession.push(s);
    }
    perSession.sort((a, b) => b.carry - a.carry);
    const table = [...plugins.values()].map((p) => ({ plugin: p.plugin || '(no prefix: project and user skills)', skills: p.skills.size, chars: p.chars,
      uses: p.uses, used: p.uses > 0, carry: p.carry, share: total ? p.carry / total : 0, _prefix: p.plugin })).sort((a, b) => b.carry - a.carry);
    const unused = table.filter((p) => p._prefix && !p.used);
    const saving = sum(unused.map((p) => p.carry));
    const carry = write + read;
    const subs = live.filter((t) => t.kind === 'sub').flatMap((t) => t.attachments.filter((x) => x.type === 'skill_listing' && x.at < t.rows.length));
    const starts = perSession.map((x) => x.startChars).filter(Boolean);
    const reinjections = sum(perSession.map((x) => x.reinjections)), additions = sum(perSession.map((x) => x.additions));
    skillListing = {
      main: { sessions: perSession.length, listings, chars, startChars: median(starts), startTokens: median(starts) / CHARS_PER_TOKEN,
        reinjections, sessionsWithReinjection: perSession.filter((x) => x.reinjections).length, additions, write, read, carry, share: total ? carry / total : 0 },
      sessions: perSession.slice(0, top),
      plugins: table.map(({ _prefix, ...p }) => p),
      unusedPlugins: unused.map((p) => p.plugin),
      saving,
      subagents: { listings: subs.length, chars: sum(subs.map((x) => x.chars)), countedUnder: 'agent-tools' },
    };
    if (saving > 0) {
      add({ id: 'skill-listing', title: 'Skill descriptions of unused plugins sent in the main conversation', saving, kind: 'mechanical',
        target: { thread: 'main' },
        evidence: [
          `${perSession.length} sessions: listing at start median ~${fmt(skillListing.main.startTokens)} tokens (${fmt(skillListing.main.startChars)} chars); the full listing was sent again ${reinjections} times later in ${skillListing.main.sessionsWithReinjection} sessions${additions ? `, plus ${additions} small additions` : ''}`,
          `carried until the next context drop: ${fmt(carry)} weighted = ${pctOf(carry, total)} of all (writes ${fmt(write)}, reads ${fmt(read)})`,
          'by plugin: ' + table.slice(0, 8).map((p) => `${p.plugin} ${p.skills} skills ${fmt(p.chars)} chars ${p.used ? `used ${p.uses}x` : 'not used'} ${fmt(p.carry)}`).join('; '),
          `subagents received ${subs.length} listings (${fmt(skillListing.subagents.chars)} chars): counted under agent-tools, not here`,
        ],
        action: `Turn off the plugins none of whose skills was used in this range: ${unused.map((p) => `${p.plugin} (${p.skills} skills)`).join(', ')}. Their skill descriptions are part of every skill listing. `
          + 'A plugin shown by "claude plugin list" is turned off in the project settings (this project only); a plugin enabled on the claude.ai account is turned off in the claude.ai settings (every project). For a plugin in neither, name it only.' });
    }
  }

  // 5. Single-shot agent types that could be skills.
  //    Candidates: >= 3 runs, never resumed, median growth last/first <= 1.5, <= 10 requests per run.
  //    agentCost = their actual weight. skillCost per run (work done in the main thread instead):
  //      m_main * (requests * 0.1 * median main context + 2 * (last - first) + 5 * output)
  //    (each step reads the main context; what the run adds is written once at 1h; same output).
  //    saving = agentCost - sum skillCost; reported only when positive. Later main requests
  //    re-reading what the run added are not counted.
  for (const a of agentTypes) {
    if (a.runs < 3 || a.resumes || a.growth > 1.5 || a.requestsPerRun > 10) continue;
    const mm = modelWeight(mainModel, W);
    let skillCost = 0;
    for (const t of a._threads) {
      const rs = t.rows.filter((r) => r.inRange);
      if (!rs.length) continue;
      const out = sum(rs.map((r) => r.q.tok.output));
      skillCost += mm * (rs.length * T.cache_read * mainContext.median
        + T.cache_write_1h * Math.max(0, t.rows[t.rows.length - 1].ctx - t.rows[0].ctx) + T.output * out);
    }
    const saving = a.weighted - skillCost;
    if (saving <= 0) continue;
    add({ id: `skill-instead:${a.agentType}`, title: `${a.agentType}: single-shot runs could be a skill`, saving, kind: 'judgement',
      target: targetOf(a.agentType, defs),
      evidence: [
        `${a.runs} runs, never resumed, median ${a.requestsPerRun} requests per run, context growth x${a.growth.toFixed(2)}`,
        `actual ${fmt(a.weighted)} weighted vs about ${fmt(skillCost)} if done in the main thread (median main context ${fmt(mainContext.median)})`,
      ],
      action: 'Turn the task into a skill: it runs on the main thread\'s 1h cache with no start-up write. Use "context: fork" if its output is large.' });
  }

  // 6. Subagents on the most expensive model tier (quality trade-off, suggestion only).
  //    saving = weight of the type's top-tier requests * (1 - next tier ratio / top ratio)
  {
    const ratios = [...new Set(W.model.map((x) => x[1]))].sort((a, b) => b - a);
    const topR = ratios[0], next = ratios[1];
    if (next) for (const a of agentTypes) {
      const rs = a._threads.flatMap((t) => t.rows.filter((r) => r.inRange && mw(r.q) === topR));
      if (!rs.length) continue;
      const wTop = sum(rs.map((r) => r.weighted));
      const saving = wTop * (1 - next / topR);
      const tg = targetOf(a.agentType, defs);
      const nextName = (W.model.find((x) => x[1] === next) || [''])[0];
      add({ id: `model:${a.agentType}`, title: `${a.agentType}: runs on the most expensive model tier`, saving, kind: 'judgement', target: tg,
        evidence: [`${fmt(rs.length)} requests on ${[...new Set(rs.map((r) => r.q.model))].join(', ')}: ${fmt(wTop)} weighted; model ratio ${next}/${topR} for ${nextName}`],
        action: `Only if the task does not need the top tier: set "model: ${nextName}" in ${tg.custom ? tg.definition : 'a custom definition for this role'} (quality trade-off).` });
    }
  }

  // 7. Large tool results kept in context.
  //    Per large result (>= LARGE_RESULT_CHARS): tokens = chars / CHARS_PER_TOKEN, carried by
  //    n = requests from the one that first sees it up to the next context drop (clear/compact)
  //    cost = m * tokens * (w + 0.1 * (n - 1)), w = the thread's write weight.
  //    saving = cost / 2 (assumes narrower reads or delegated exploration halve them).
  const toolGroups = new Map(), files = new Map();
  for (const t of live) {
    const dropAt = t.rows.filter((r) => r.drop).map((r) => r.i);
    for (const x of t.results) {
      if (x.at >= t.rows.length) continue;
      const r0 = t.rows[x.at];
      if (!r0.inRange) continue;
      const end = dropAt.find((i) => i > x.at) ?? t.rows.length;
      const tokens = x.chars / CHARS_PER_TOKEN;
      const cost = mw(r0.q) * tokens * (T[t.writeType] + T.cache_read * Math.max(0, end - x.at - 1));
      const where = t.kind === 'main' ? 'main' : 'subagents';
      const k = where + '\u0000' + x.tool;
      const g = toolGroups.get(k) || { where, tool: x.tool, calls: 0, chars: 0, cost: 0, largeCalls: 0, largeChars: 0, largeCost: 0, files: new Map() };
      g.calls += 1; g.chars += x.chars; g.cost += cost;
      if (x.chars >= LARGE_RESULT_CHARS) {
        g.largeCalls += 1; g.largeChars += x.chars; g.largeCost += cost;
        if (x.target) g.files.set(x.target, (g.files.get(x.target) || 0) + x.chars);
      }
      toolGroups.set(k, g);
      if (x.target && x.tool === 'Read') {
        const f = files.get(x.target) || { file: x.target, reads: 0, chars: 0, cost: 0, threads: new Set() };
        f.reads += 1; f.chars += x.chars; f.cost += cost; f.threads.add(t.key); files.set(x.target, f);
      }
    }
  }
  // Findings for subagents only: large results in the main thread are main-context's (a), so
  // counting them here too would double the saving. The table (toolResults) keeps both.
  for (const g of toolGroups.values()) {
    if (!g.largeCalls || g.where === 'main') continue;
    const topFiles = [...g.files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    add({ id: `tool-results:${g.where}:${g.tool}`, title: `Large ${g.tool} results in the subagents`,
      saving: g.largeCost / 2, kind: 'judgement', target: { thread: g.where, tool: g.tool },
      evidence: [
        `${fmt(g.largeCalls)} of ${fmt(g.calls)} results >= ${fmt(LARGE_RESULT_CHARS)} chars: ${fmt(g.largeChars)} chars (~${fmt(g.largeChars / CHARS_PER_TOKEN)} tokens), ${fmt(g.largeCost)} weighted while kept in context`,
        ...(topFiles.length ? ['largest targets: ' + topFiles.map(([f, c]) => `${f} ${fmt(c)} chars`).join(', ')] : []),
      ],
      action: 'Tell the agent (in its definition or prompt) to read narrowly: offset/limit, search before reading whole files.' });
  }

  findings.sort((a, b) => b.saving - a.saving);
  const shown = findings.filter((f) => f.share >= MIN_SHARE);

  return {
    disclaimer: 'Weighted = rough limit weight from public API price ratios x model ratio; the subscription formula is not public, so savings are estimates.',
    weights: W,
    scope: { sessions: sessionIds.length, threads: live.length, span: agg.span, since: opts.since ?? null, until: opts.until ?? null },
    total: agg.total,
    byType: agg.byType,
    byThreadKind: agg.byAgentType.map((e) => ({ kind: e.key, runs: e.runs, requests: e.requests, weighted: e.weighted, share: total ? e.weighted / total : 0 })),
    byModel: agg.byModel.map((e) => ({ model: e.key, requests: e.requests, weighted: e.weighted, share: total ? e.weighted / total : 0 })),
    gapTax: tax,
    mainContext,
    agentTypes: agentTypes.map(({ _threads, ...a }) => a),
    skillListing,
    toolResults: [...toolGroups.values()].map(({ files: _f, ...g }) => g).sort((a, b) => b.cost - a.cost),
    files: [...files.values()].map((f) => ({ file: f.file, reads: f.reads, chars: f.chars, cost: f.cost, threads: f.threads.size }))
      .sort((a, b) => b.cost - a.cost).slice(0, top),
    findings: shown.slice(0, top),
    omittedFindings: findings.length - Math.min(shown.length, top),
  };
}

/** Where an agent type's definition is, as far as audit.js could locate it. */
export function targetOf(agentType, defs = {}) {
  const d = defs[agentType];
  if (d && d.path) return { agentType, definition: d.path, custom: true };
  if (String(agentType).includes(':')) return { agentType, definition: 'plugin agent (definition inside the plugin, not located)', custom: false };
  return { agentType, definition: BUILT_IN.has(agentType) ? 'built-in' : 'not found / built-in', custom: false };
}
