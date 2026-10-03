// Pure token-usage aggregation for one Claude Code session.
//
// No Node, fs, process or Date: input is already-parsed transcript records
// (or the mod's live tally), output is a plain JSON-serialisable summary.
// Timestamps are read and written by the ISO helpers below, so the module
// runs the same in Node and in a mod's environment. Deterministic, so a mod
// can import it and feed it either transcript records or its own live tally
// (see aggregateThreads, which takes normalized requests directly).
//
// Normalized request: { id, ts (epoch ms), model, tools: [name],
//   tok: { input, cache_read, cache_write_5m, cache_write_1h, output } }

export const TYPES = ['input', 'cache_read', 'cache_write_5m', 'cache_write_1h', 'output'];

// ---- ISO 8601 timestamps without Date (civil-date arithmetic, proleptic Gregorian)

const DAY_MS = 86400000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})$/;

function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400), yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
}

function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const m = mp + (mp < 10 ? 3 : -9);
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, doy - Math.floor((153 * mp + 2) / 5) + 1];
}

/** Epoch ms of an ISO timestamp with a zone (`...Z`, `+09:00`); NaN for anything else. */
export function parseIso(s) {
  const t = ISO_RE.exec(String(s ?? ''));
  if (!t) return NaN;
  const ms = t[7] ? Number((t[7] + '00').slice(0, 3)) : 0;
  let v = daysFromCivil(+t[1], +t[2], +t[3]) * DAY_MS + ((+t[4] * 60 + +t[5]) * 60 + (+t[6] || 0)) * 1000 + ms;
  if (t[8] !== 'Z') {
    const z = t[8].replace(':', '');
    v -= (z[0] === '-' ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5))) * 60000;
  }
  return v;
}

/** `YYYY-MM-DDTHH:MM:SS.sssZ` for epoch ms, as Date#toISOString writes it (4-digit years). */
export function isoString(ms) {
  if (!Number.isFinite(ms)) return 'Invalid';
  const days = Math.floor(ms / DAY_MS), rest = ms - days * DAY_MS;
  const [y, m, d] = civilFromDays(days);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(y, 4)}-${p(m)}-${p(d)}T${p(Math.floor(rest / 3600000))}:${p(Math.floor(rest / 60000) % 60)}:` +
    `${p(Math.floor(rest / 1000) % 60)}.${p(rest % 1000, 3)}Z`;
}

/** `HH:MM` of epoch ms shifted by `tzOffsetMinutes` (local time when that is the local offset). */
export function clockOf(ms, tzOffsetMinutes = 0) {
  return isoString(ms + tzOffsetMinutes * 60000).slice(11, 16);
}

// Rough "limit weight" (assumption, NOT the subscription formula, which is
// not public). Token-type ratios follow public API prices relative to an
// uncached input token; model ratios follow public input prices per MTok
// (Haiku 4.5 $1, Sonnet 4.5 $3, Opus 4.5 $5), unverified for newer models.
export const DEFAULT_WEIGHTS = {
  type: { input: 1, cache_read: 0.1, cache_write_5m: 1.25, cache_write_1h: 2, output: 5 },
  model: [['haiku', 1], ['sonnet', 3], ['opus', 5]],
  modelFallback: 5,
};

/** The model ratio of DEFAULT_WEIGHTS (or `W`) for a model id: the first name it contains. */
export function modelWeight(model, W = DEFAULT_WEIGHTS) {
  const s = String(model || '').toLowerCase();
  for (const [k, w] of W.model) if (s.includes(k)) return w;
  return W.modelFallback;
}

const zero = () => ({ input: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, output: 0 });
const addTok = (acc, t) => { for (const k of TYPES) acc[k] += t[k] || 0; return acc; };
const ctxOf = (t) => t.input + t.cache_read + t.cache_write_5m + t.cache_write_1h;
const writeOf = (t) => t.cache_write_5m + t.cache_write_1h;
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const basename = (p) => String(p).replace(/\\/g, '/').split('/').pop();

export function usageToTok(u) {
  const cc = u.cache_creation || {};
  let w5 = cc.ephemeral_5m_input_tokens || 0;
  const w1 = cc.ephemeral_1h_input_tokens || 0;
  const total = u.cache_creation_input_tokens || 0;
  if (w5 + w1 < total) w5 += total - w5 - w1; // no TTL split reported: count as 5m
  return { input: u.input_tokens || 0, cache_read: u.cache_read_input_tokens || 0,
    cache_write_5m: w5, cache_write_1h: w1, output: u.output_tokens || 0 };
}

// One thread's transcript records -> requests, tool results, skills, errors.
// Streamed responses repeat one message id over several records; the copy
// with the largest output_tokens carries the final counts.
export function parseThread(records) {
  const reqs = new Map();
  const toolName = new Map(), readTarget = new Map();
  const results = [], errors = [], skills = {};
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    if (r.type === 'assistant') {
      const m = r.message || {};
      if (r.isApiErrorMessage) {
        errors.push({ ts: parseIso(r.timestamp), status: r.apiErrorStatus ?? null,
          limit: (r.quotaLimits && r.quotaLimits.rateLimitType) || null });
      }
      if (m.model === '<synthetic>' || !m.usage) continue;
      const id = m.id || r.requestId || r.uuid;
      const tok = usageToTok(m.usage);
      let q = reqs.get(id);
      if (!q) {
        q = { id, ts: parseIso(r.timestamp), model: m.model || '?', tools: [], tok, stop: m.stop_reason || null };
        reqs.set(id, q);
      } else if (tok.output >= q.tok.output) {
        q.tok = tok;
        q.stop = m.stop_reason || q.stop;
      }
      for (const b of m.content || []) {
        if (b && b.type === 'tool_use') {
          const name = b.name || '?', inp = b.input || {};
          toolName.set(b.id, name);
          q.tools.push(name);
          if (name === 'Skill') skills[String(inp.skill)] = (skills[String(inp.skill)] || 0) + 1;
          if (name === 'Read' && inp.file_path) readTarget.set(b.id, basename(inp.file_path));
        }
      }
    } else if (r.type === 'user') {
      const c = r.message && r.message.content;
      if (!Array.isArray(c)) continue;
      for (const b of c) {
        if (!b || b.type !== 'tool_result') continue;
        const ct = b.content;
        const chars = Array.isArray(ct)
          ? ct.reduce((n, x) => n + ((x && x.text) ? x.text.length : 0), 0)
          : (ct || '').length;
        results.push({ tool: toolName.get(b.tool_use_id) || '?', target: readTarget.get(b.tool_use_id) || '', chars });
      }
    }
  }
  const requests = [...reqs.values()].sort((a, b) => a.ts - b.ts);
  return { requests, results, skills, errors };
}

// input: { main: records[], subagents: [{ id, meta, records }] }
export function aggregate(input, opts = {}) {
  const threads = [{ key: 'main', label: 'main', agentType: '(main)', description: '', ...parseThread(input.main || []) }];
  for (const s of input.subagents || []) {
    const meta = s.meta || {};
    threads.push({ key: s.id, label: String(s.id).replace(/^agent-/, '').slice(0, 8),
      agentType: meta.agentType || '?', description: meta.description || '', toolUseId: meta.toolUseId || null,
      ...parseThread(s.records || []) });
  }
  return aggregateThreads(threads, opts);
}

// threads: [{ key, label, agentType, description, requests, results?, skills?, errors? }]
// opts: { weights, top, tzOffsetMinutes (for hour buckets), gapSeconds }
export function aggregateThreads(threads, opts = {}) {
  const W = opts.weights || DEFAULT_WEIGHTS;
  const top = opts.top ?? 15;
  const tzOff = (opts.tzOffsetMinutes || 0) * 60000;
  const gapMin = opts.gapSeconds ?? 300;
  const modelW = (m) => modelWeight(m, W);
  const weighOf = (tok, model) => modelW(model) * TYPES.reduce((n, t) => n + W.type[t] * (tok[t] || 0), 0);
  const writeWeigh = (tok, model) => modelW(model) * (W.type.cache_write_5m * tok.cache_write_5m + W.type.cache_write_1h * tok.cache_write_1h);
  const hourKey = (ts) => isoString(ts + tzOff).slice(0, 13); // shifted ISO, "YYYY-MM-DDTHH"

  const all = [];
  for (const t of threads) for (const q of t.requests) all.push({ ...q, thread: t.key });
  const sumUp = (reqs) => {
    const tok = zero(); let weighted = 0;
    for (const q of reqs) { addTok(tok, q.tok); weighted += weighOf(q.tok, q.model); }
    return { requests: reqs.length, tok, weighted };
  };
  const total = sumUp(all);
  const ctxTotal = ctxOf(total.tok);
  const byType = TYPES.map((t) => ({ type: t, tokens: total.tok[t],
    weighted: all.reduce((n, q) => n + modelW(q.model) * W.type[t] * q.tok[t], 0) }));

  const threadRows = threads.map((t) => ({
    key: t.key, label: t.label, agentType: t.agentType, description: t.description,
    models: [...new Set(t.requests.map((q) => q.model))].sort(),
    start: t.requests.length ? t.requests[0].ts : null,
    end: t.requests.length ? t.requests[t.requests.length - 1].ts : null,
    firstContext: t.requests.length ? ctxOf(t.requests[0].tok) : 0,
    lastContext: t.requests.length ? ctxOf(t.requests[t.requests.length - 1].tok) : 0,
    ...sumUp(t.requests),
  })).sort((a, b) => b.weighted - a.weighted);

  const group = (rows, keyFn) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      const e = m.get(k) || { key: k, runs: 0, requests: 0, tok: zero(), weighted: 0 };
      e.runs += 1; e.requests += r.requests; addTok(e.tok, r.tok); e.weighted += r.weighted;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.weighted - a.weighted);
  };
  const byAgentType = group(threadRows, (r) => r.agentType);
  const byModel = group(all.map((q) => ({ requests: 1, tok: q.tok, weighted: weighOf(q.tok, q.model), model: q.model })), (r) => r.model)
    .map(({ runs, ...e }) => e);

  const main = (threads.find((t) => t.key === 'main') || { requests: [] }).requests;
  const mainWeighted = main.reduce((n, q) => n + weighOf(q.tok, q.model), 0);
  const byTool = group(main.map((q) => ({ requests: 1, tok: q.tok, weighted: weighOf(q.tok, q.model),
    tool: q.tools.length ? [...new Set(q.tools)].sort().join('+') : 'text' })), (r) => r.tool).map(({ runs, ...e }) => e);

  const biggest = [...all].sort((a, b) => weighOf(b.tok, b.model) - weighOf(a.tok, a.model)).slice(0, top)
    .map((q) => ({ ts: q.ts, thread: q.thread, model: q.model, context: ctxOf(q.tok), write: writeOf(q.tok),
      output: q.tok.output, weighted: weighOf(q.tok, q.model), tools: q.tools }));

  const toolResults = new Map(), reads = new Map(), skills = {};
  for (const t of threads) {
    const where = t.key === 'main' ? 'main' : 'subagents';
    for (const r of t.results || []) {
      const k = where + '\u0000' + r.tool;
      const e = toolResults.get(k) || { where, tool: r.tool, calls: 0, chars: 0 };
      e.calls += 1; e.chars += r.chars; toolResults.set(k, e);
      if (r.tool === 'Read' && r.target) {
        const f = reads.get(r.target) || { file: r.target, reads: 0, chars: 0, threads: new Set() };
        f.reads += 1; f.chars += r.chars; f.threads.add(t.key); reads.set(r.target, f);
      }
    }
    for (const [k, v] of Object.entries(t.skills || {})) {
      const kk = (t.key === 'main' ? 'main:' : 'sub:') + k;
      skills[kk] = (skills[kk] || 0) + v;
    }
  }

  const hours = new Map();
  for (const q of [...all].sort((a, b) => a.ts - b.ts)) {
    const k = hourKey(q.ts);
    const e = hours.get(k) || { hour: k, requests: 0, cache_read: 0, cache_write: 0, output: 0, weighted: 0 };
    e.requests += 1; e.cache_read += q.tok.cache_read; e.cache_write += writeOf(q.tok);
    e.output += q.tok.output; e.weighted += weighOf(q.tok, q.model);
    hours.set(k, e);
  }

  // Gaps: TTL follows what the previous request of the same thread wrote.
  const gaps = [];
  const tax = { expired: { requests: 0, write: 0, weighted: 0 }, within: { requests: 0, write: 0, weighted: 0 } };
  for (const t of threads) {
    let ttl = 300;
    for (let i = 1; i < t.requests.length; i++) {
      const prev = t.requests[i - 1], cur = t.requests[i];
      if (prev.tok.cache_write_1h) ttl = 3600; else if (prev.tok.cache_write_5m) ttl = 300;
      const gap = (cur.ts - prev.ts) / 1000;
      if (gap <= gapMin) continue;
      const state = gap > ttl ? 'expired' : 'within';
      const ww = writeWeigh(cur.tok, cur.model);
      gaps.push({ ts: cur.ts, thread: t.key, gapSeconds: gap, ttlSeconds: ttl, context: ctxOf(cur.tok),
        write: writeOf(cur.tok), cacheRead: cur.tok.cache_read, weighted: ww, state });
      tax[state].requests += 1; tax[state].write += writeOf(cur.tok); tax[state].weighted += ww;
    }
  }
  gaps.sort((a, b) => a.ts - b.ts);
  const writeWeightTotal = all.reduce((n, q) => n + writeWeigh(q.tok, q.model), 0);

  const ctxs = main.map((q) => ctxOf(q.tok));
  const drops = [];
  for (let i = 1; i < ctxs.length; i++) if (ctxs[i] < 0.6 * ctxs[i - 1]) drops.push({ ts: main[i].ts, from: ctxs[i - 1], to: ctxs[i] });
  const ctxHours = new Map();
  for (const q of main) {
    const k = hourKey(q.ts);
    const e = ctxHours.get(k) || [];
    e.push(ctxOf(q.tok)); ctxHours.set(k, e);
  }
  const buckets = [[0, 50e3], [50e3, 100e3], [100e3, 150e3], [150e3, 200e3], [200e3, Infinity]]
    .map(([lo, hi]) => ({ from: lo, to: hi === Infinity ? null : hi, requests: ctxs.filter((c) => c >= lo && c < hi).length }));

  return {
    weights: W,
    span: all.length ? { start: Math.min(...all.map((q) => q.ts)), end: Math.max(...all.map((q) => q.ts)) } : null,
    threadCount: threads.length,
    total: { ...total, all: ctxTotal + total.tok.output, cacheHitRatio: ctxTotal ? total.tok.cache_read / ctxTotal : 0 },
    byType,
    errors: threads.flatMap((t) => (t.errors || []).map((e) => ({ ...e, thread: t.key }))).sort((a, b) => a.ts - b.ts),
    threads: threadRows,
    byAgentType,
    byModel,
    main: { weighted: mainWeighted, byTool },
    biggest,
    toolResults: [...toolResults.values()].sort((a, b) => b.chars - a.chars),
    reads: [...reads.values()].map((f) => ({ file: f.file, reads: f.reads, chars: f.chars, threads: f.threads.size }))
      .sort((a, b) => b.chars - a.chars),
    skills,
    cacheByHour: [...hours.values()],
    gaps,
    gapTax: { ...tax, writeWeightTotal },
    context: {
      requests: ctxs.length,
      min: ctxs.length ? Math.min(...ctxs) : 0, max: ctxs.length ? Math.max(...ctxs) : 0,
      median: median(ctxs), mean: ctxs.length ? ctxs.reduce((a, b) => a + b, 0) / ctxs.length : 0,
      sum: ctxs.reduce((a, b) => a + b, 0),
      drops, buckets,
      byHour: [...ctxHours.entries()].map(([hour, v]) => ({ hour, requests: v.length, min: Math.min(...v),
        median: median(v), max: Math.max(...v), sum: v.reduce((a, b) => a + b, 0) })),
    },
  };
}

// ---- Live use (token-ledger): one turn.step result, the break-even, the band's summary

const TTL_MS = { '5m': 300000, '1h': 3600000 };
/** Context at or above this is "heavy": the footer turns to the warning color, the band shows. */
export const HEAVY_CONTEXT = 300000;
/** The band shows while a fresh session pays back within this many requests. */
export const SHOW_RUNS = 10;
/** The band shows while idle once the main cache has this much or less left. */
export const IDLE_WARN_MS = 600000;
/** Output tokens assumed for the one turn that writes the handoff. */
export const HANDOFF_OUTPUT = 2000;

const ctxOfTok = (t) => (t.input || 0) + (t.cache_read || 0) + (t.cache_write_5m || 0) + (t.cache_write_1h || 0);
export { ctxOfTok as contextOf };

/**
 * One turn.step as a normalized request, or null when the response carried no usage.
 * `e` is the step's input (turnId, index, model, agentId?), `result` what next(e) returned,
 * `now` the clock's ms. turn.step does not say which lifetime a cache write used, so the
 * thread's assumed TTL decides: `ttlMain` for the main thread, `ttlSub` for a subagent.
 */
export function normalizeStep(e, result, now, opts = {}) {
  const u = result && result.usage;
  if (!u) return null;
  const thread = e.agentId == null ? 'main' : String(e.agentId);
  const ttl = thread === 'main' ? (opts.ttlMain || '1h') : (opts.ttlSub || '5m');
  const write = u.cache_creation_input_tokens || 0;
  return {
    id: `${e.turnId}:${e.index}`,
    ts: now,
    model: u.model || e.model || '?',
    tools: (result.toolUses || []).map((t) => String(t.name)),
    tok: {
      input: u.input_tokens || 0,
      cache_read: u.cache_read_input_tokens || 0,
      cache_write_5m: ttl === '1h' ? 0 : write,
      cache_write_1h: ttl === '1h' ? write : 0,
      output: u.output_tokens || 0,
    },
    thread,
  };
}

/**
 * When a fresh session pays for itself, in the weights' units (model ratio included).
 *   r context now, b the base every session starts with (cached elsewhere), n a fresh
 *   session's first context, m the model ratio, w the cache-write weight of `ttl`.
 *   next    = 0.1·m·r            one more request on a live cache
 *   rewrite = w·m·(r−b)          the next request once the cache has expired
 *   saving  = 0.1·m·(r−n)        what each later request saves in a fresh session
 *   fixed   = w·m·(n−b) + 0.1·m·r + 5·m·HANDOFF_OUTPUT   writing the fresh cache + the handoff turn
 *   runs    = ⌈fixed/saving⌉, 0 once expired ("now"); null when r ≤ n (applies: false)
 */
export function breakEven({ context, base, fresh, model, ttl = '1h', isExpired = false, weights = DEFAULT_WEIGHTS }) {
  const m = modelWeight(model, weights), T = weights.type;
  const w = ttl === '5m' ? T.cache_write_5m : T.cache_write_1h;
  const next = T.cache_read * m * context;
  const rewrite = w * m * Math.max(0, context - base);
  if (!(context > fresh)) return { applies: false, next, rewrite, saving: 0, fixed: 0, runs: null };
  const saving = T.cache_read * m * (context - fresh);
  const fixed = w * m * Math.max(0, fresh - base) + T.cache_read * m * context + T.output * m * HANDOFF_OUTPUT;
  return { applies: true, next, rewrite, saving, fixed, runs: isExpired ? 0 : Math.ceil(fixed / saving) };
}

/**
 * What the footer and the band show, from the live requests.
 * opts: { now, ttlMain, freshCtx, baseCtx, isWorking, handoff ('drafted' | 'done' | undefined) }
 * `show` is why the band shows ('handoff', 'runs', 'heavy', 'idle'), or null.
 */
export function summaryForBand(requests, opts = {}) {
  let last = null;
  for (const q of requests) if (q.thread === 'main' && (!last || q.ts >= last.ts)) last = q;
  const ttlMs = TTL_MS[opts.ttlMain] || TTL_MS['1h'];
  const out = { context: null, model: null, lastMainAt: null, expiresAt: null, remainingMs: null,
    isExpired: false, isHeavy: false, breakEven: null, handoff: opts.handoff || null, show: null };
  if (opts.handoff) out.show = 'handoff';
  if (!last) return out;
  const now = opts.now ?? last.ts;
  out.context = ctxOfTok(last.tok);
  out.model = last.model;
  out.lastMainAt = last.ts;
  out.expiresAt = last.ts + ttlMs;
  out.remainingMs = Math.max(0, out.expiresAt - now);
  out.isExpired = now >= out.expiresAt;
  out.isHeavy = out.context >= HEAVY_CONTEXT;
  out.breakEven = breakEven({ context: out.context, base: opts.baseCtx ?? 40000, fresh: opts.freshCtx ?? 70000,
    model: last.model, ttl: opts.ttlMain || '1h', isExpired: out.isExpired });
  if (out.show) return out;
  const be = out.breakEven;
  if (be.applies && be.runs <= SHOW_RUNS) out.show = 'runs';
  else if (be.applies && out.isHeavy) out.show = 'heavy';
  else if (be.applies && !opts.isWorking && out.remainingMs <= IDLE_WARN_MS) out.show = 'idle';
  return out;
}
