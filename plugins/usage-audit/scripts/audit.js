#!/usr/bin/env node
// usage-audit: reads past Claude Code session transcripts (main thread + subagents), finds what
// weighs on the usage limits, and proposes fixes ranked by estimated saving.
//
//   node audit.js [--project DIR | --all-projects] [--session ID]... [--since YYYY-MM-DD]
//                 [--until YYYY-MM-DD] [--tz local|utc] [--top N] [--json]
//
// --project defaults to <config>/projects/<cwd with every non-alphanumeric character replaced
// by '-'>, where <config> is CLAUDE_CONFIG_DIR or ~/.claude. --since/--until are calendar days
// in --tz (default local), both inclusive. --session takes a session id or a prefix of one and
// can be repeated.
//
// Prints counts, tool names, agent types, model names, file basenames and session id prefixes
// only; never conversation text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { audit, fmt } from './audit-core.js';

const USAGE = 'usage: node audit.js [--project DIR | --all-projects] [--session ID]... [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--tz local|utc] [--top N] [--json]';

function parseArgs(argv) {
  const a = { top: 10, tz: 'local', json: false, sessions: [], allProjects: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--project') a.project = argv[++i];
    else if (v === '--all-projects') a.allProjects = true;
    else if (v === '--session') a.sessions.push(String(argv[++i] || ''));
    else if (v === '--since') a.since = argv[++i];
    else if (v === '--until') a.until = argv[++i];
    else if (v === '--tz') a.tz = argv[++i];
    else if (v === '--top') a.top = Number(argv[++i]);
    else if (v === '--json') a.json = true;
    else if (v === '-h' || v === '--help') a.help = true;
    else a.bad = v;
  }
  return a;
}

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

/** Epoch ms of 00:00 of a YYYY-MM-DD day in the given offset, plus `days`. */
function dayStart(s, tzOffsetMinutes, days = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  const check = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10);
  if (!m || check !== s) fail(`not a date (YYYY-MM-DD): ${s}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3] + days) - tzOffsetMinutes * 60000;
}

function readJsonl(file) {
  const out = [];
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* partial last line */ }
  }
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

const home = os.homedir();
/** A path for display: the home folder as ~, forward slashes. */
const shown = (p) => {
  const rel = path.relative(home, p);
  const s = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? '~/' + rel : p;
  return s.replace(/\\/g, '/');
};

function loadSession(dir, id) {
  const main = readJsonl(path.join(dir, id + '.jsonl'));
  const subDir = path.join(dir, id, 'subagents');
  const subagents = [];
  if (fs.existsSync(subDir)) {
    for (const f of fs.readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).sort()) {
      const aid = f.slice(0, -6);
      subagents.push({ id: aid, meta: readJson(path.join(subDir, aid + '.meta.json')), records: readJsonl(path.join(subDir, f)) });
    }
  }
  let cwd = '';
  for (const r of main) if (r && typeof r.cwd === 'string') { cwd = r.cwd; break; }
  return { id, cwd, project: cwd ? path.basename(cwd) : '', main, subagents };
}

// ---- agent definitions: <project>/.claude/agents/**/*.md and <config>/agents/**/*.md

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const fm = m[1];
  const field = (k) => {
    const x = new RegExp('^' + k + ':[ \\t]*(.*)$', 'm').exec(fm);
    return x ? x[1].trim().replace(/^["']|["']$/g, '') : '';
  };
  const ttl = /^[ \t]+cacheTtl:[ \t]*["']?([0-9a-z]+)/m.exec(fm) || /^cacheTtl:[ \t]*["']?([0-9a-z]+)/m.exec(fm);
  let tools = field('tools');
  if (!tools && /^tools:[ \t]*$/m.test(fm)) {
    const list = /^tools:[ \t]*\r?\n((?:[ \t]+-.*\r?\n?)+)/m.exec(fm);
    if (list) tools = list[1].split(/\r?\n/).map((l) => l.replace(/^[ \t]+-[ \t]*/, '').trim()).filter(Boolean).join(', ');
  }
  return { name: field('name'), tools, model: field('model'), cacheTtl: ttl ? ttl[1] : '' };
}

function listMd(dir, depth = 2) {
  const out = [];
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0) out.push(...listMd(p, depth - 1));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function locateAgents(agentTypes, cwds, configDir) {
  const dirs = [...new Set(cwds.filter(Boolean))].map((c) => path.join(c, '.claude', 'agents'));
  dirs.push(path.join(configDir, 'agents'));
  const found = {};
  for (const dir of dirs) {
    for (const file of listMd(dir)) {
      let fm;
      try { fm = frontmatter(fs.readFileSync(file, 'utf8')); } catch { continue; }
      if (!fm) continue;
      const name = fm.name || path.basename(file, '.md');
      if (agentTypes.has(name) && !found[name]) found[name] = { path: shown(file), tools: fm.tools, model: fm.model, cacheTtl: fm.cacheTtl };
    }
  }
  return found;
}

// ---- main

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(USAGE); process.exit(0); }
if (args.bad) fail(`unknown argument: ${args.bad}\n${USAGE}`);
if (!(args.top > 0)) fail('--top takes a positive number');
if (args.tz !== 'local' && args.tz !== 'utc') fail('--tz takes local or utc');
const tzOffsetMinutes = args.tz === 'utc' ? 0 : -new Date().getTimezoneOffset();
const since = args.since ? dayStart(args.since, tzOffsetMinutes) : undefined;
const until = args.until ? dayStart(args.until, tzOffsetMinutes, 1) : undefined;

const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
const projectsRoot = path.join(configDir, 'projects');
let projectDirs;
if (args.allProjects) {
  try {
    projectDirs = fs.readdirSync(projectsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(projectsRoot, e.name));
  } catch { fail(`no projects folder: ${shown(projectsRoot)}`); }
} else {
  const dir = args.project || path.join(projectsRoot, process.cwd().replace(/[^A-Za-z0-9]/g, '-'));
  if (!fs.existsSync(dir)) fail(`not found: ${shown(dir)} (use --project DIR or --all-projects)`);
  projectDirs = [dir];
}

const sessions = [];
for (const dir of projectDirs) {
  let ids;
  try { ids = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)); } catch { continue; }
  for (const id of ids.sort()) {
    if (args.sessions.length && !args.sessions.some((s) => s && id.startsWith(s))) continue;
    sessions.push(loadSession(dir, id));
  }
}
if (!sessions.length) fail('no sessions matched');

const agentTypes = new Set(sessions.flatMap((s) => s.subagents.map((a) => (a.meta && a.meta.agentType) || '?')));
const agentDefs = locateAgents(agentTypes, sessions.map((s) => s.cwd), configDir);
const r = audit(sessions, { since, until, top: args.top, agentDefs });

if (args.json) {
  console.log(JSON.stringify(r, null, 1));
  process.exit(0);
}

// ---- text rendering
const L = [];
const p = (x = '') => L.push(x);
const pct = (x) => (100 * x).toFixed(1) + '%';
const pad = (x, w) => String(x).padStart(w);
const padr = (x, w) => String(x).slice(0, w).padEnd(w);
const day = (ms) => new Date(ms + tzOffsetMinutes * 60000).toISOString().slice(0, 16).replace('T', ' ');
const gw = r.total.weighted;

p(`Usage audit: ${r.scope.sessions} sessions, ${r.scope.threads} threads, ${fmt(r.total.requests)} API requests` +
  (r.scope.span ? `  (${day(r.scope.span.start)} .. ${day(r.scope.span.end)}, tz=${args.tz})` : ''));
p('weighted* = rough limit weight in Haiku-input-token equivalents. The subscription\'s real formula is NOT public,');
p(' so every saving below is an estimate. Assumed: input 1, cache read 0.1, cache write 5m 1.25, cache write 1h 2,');
p(' output 5, times model ratio (haiku 1, sonnet 3, opus 5).');
if (!r.total.requests) { p(); p('No requests in the selected range.'); console.log(L.join('\n')); process.exit(0); }
p();
p('== 1. Totals by token type ==');
p(`${padr('type', 16)}${pad('tokens', 16)}${pad('share(raw)', 12)}${pad('weighted*', 16)}${pad('share(w)', 10)}`);
for (const t of r.byType) p(`${padr(t.type, 16)}${pad(fmt(t.tokens), 16)}${pad(pct(r.total.all ? t.tokens / r.total.all : 0), 12)}${pad(fmt(t.weighted), 16)}${pad(pct(gw ? t.weighted / gw : 0), 10)}`);
p(`${padr('total', 16)}${pad(fmt(r.total.all), 16)}${pad('', 12)}${pad(fmt(gw), 16)}`);
p(`cache hit ratio (read / all input-side): ${pct(r.total.cacheHitRatio)}`);
p();
p('== 2. Share by thread kind (main vs each agent type) ==');
p(`${padr('kind', 28)}${pad('runs', 6)}${pad('reqs', 8)}${pad('weighted*', 16)}${pad('share', 8)}`);
for (const k of r.byThreadKind.slice(0, args.top * 2)) p(`${padr(k.kind, 28)}${pad(k.runs, 6)}${pad(fmt(k.requests), 8)}${pad(fmt(k.weighted), 16)}${pad(pct(k.share), 8)}`);
p();
p('== 3. Share by model ==');
p(`${padr('model', 28)}${pad('reqs', 8)}${pad('weighted*', 16)}${pad('share', 8)}`);
for (const m of r.byModel) p(`${padr(m.model, 28)}${pad(fmt(m.requests), 8)}${pad(fmt(m.weighted), 16)}${pad(pct(m.share), 8)}`);
p();
p('== 4. Cache gap tax (requests after > 5 min idle) ==');
p('  "expired": the gap passed the TTL the previous request wrote with, so its cache write is (mostly) a rewrite.');
p('  "after": what started the request: resume = a new prompt / SendMessage after the turn ended, tool = a long tool wait.');
p(`${padr('thread', 12)}${padr('state', 9)}${pad('reqs', 6)}${pad('cache write', 14)}${pad('weighted*', 14)}${pad('share', 8)}  after`);
for (const kind of ['main', 'sub']) for (const st of ['expired', 'within']) {
  const t = r.gapTax[kind][st];
  const by = Object.entries(t.byTrigger || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  p(`${padr(kind === 'main' ? 'main' : 'subagents', 12)}${padr(st, 9)}${pad(t.requests, 6)}${pad(fmt(t.write), 14)}${pad(fmt(t.weighted), 14)}${pad(pct(gw ? t.weighted / gw : 0), 8)}  ${by}`);
}
p();
p('== 5. Main thread context per request (input + cache read + cache write) ==');
const c = r.mainContext;
p(`requests ${fmt(c.requests)}  mean ${fmt(c.mean)}  median ${fmt(c.median)}  p90 ${fmt(c.p90)}  max ${fmt(c.max)}  fresh start ~${fmt(c.freshStart)}`);
p(`cache reads on main: ${fmt(c.cacheReadWeighted)} weighted (${pct(gw ? c.cacheReadWeighted / gw : 0)})  context drops > 40%: ${c.drops}`);
p(`${padr('session', 10)}${padr('project', 22)}${pad('reqs', 6)}${pad('mean ctx', 11)}${pad('max ctx', 11)}${pad('weighted*', 14)}`);
for (const x of c.sessions) p(`${padr(x.session, 10)}${padr(x.project, 22)}${pad(x.requests, 6)}${pad(fmt(x.meanContext), 11)}${pad(fmt(x.maxContext), 11)}${pad(fmt(x.weighted), 14)}`);
p(`carried by the main thread: (a) large tool results (${c.largeResults.count}) ~${fmt(c.largeResults.carry)} weighted (${pct(gw ? c.largeResults.carry / gw : 0)}), (b) the rest ~${fmt(c.otherCarry)} (${pct(gw ? c.otherCarry / gw : 0)})`);
if (c.largeResults.top.length) {
  p('Large tool results in the main thread (carried until the next context drop):');
  p(`${padr('tool', 16)}${padr('target', 30)}${padr('session', 10)}${pad('tokens~', 9)}${pad('reqs', 6)}${pad('weighted*', 13)}`);
  for (const x of c.largeResults.top) p(`${padr(x.tool, 16)}${padr(x.target, 30)}${padr(x.session, 10)}${pad(fmt(x.tokens), 9)}${pad(x.requests, 6)}${pad(fmt(x.carry), 13)}`);
}
if (c.idleResumes.length) {
  p('Resumes after the 1-hour cache expired:');
  p(`${padr('session', 10)}${pad('resumes', 8)}${pad('rewrite w*', 14)}  gaps (h) / context at resume`);
  for (const x of c.idleResumes) p(`${padr(x.session, 10)}${pad(x.resumes, 8)}${pad(fmt(x.rewriteWeighted), 14)}  ${x.gapsHours.map((h, i) => h + ' h / ' + fmt(x.contexts[i])).join(', ')}`);
}
p();
p('== 6. Subagents per agent type: first and last context ==');
p(`${padr('agentType', 24)}${pad('runs', 5)}${pad('reqs/run', 9)}${pad('first med', 11)}${pad('first max', 11)}${pad('last med', 10)}${pad('last max', 10)}${pad('resumes', 9)}${pad('expired', 8)}  model / definition`);
for (const a of r.agentTypes.slice(0, args.top * 2)) {
  p(`${padr(a.agentType, 24)}${pad(a.runs, 5)}${pad(a.requestsPerRun, 9)}${pad(fmt(a.firstContext.median), 11)}${pad(fmt(a.firstContext.max), 11)}${pad(fmt(a.lastContext.median), 10)}${pad(fmt(a.lastContext.max), 10)}${pad(a.resumes, 9)}${pad(a.resumesExpired, 8)}  ${a.models.map((m) => m.replace('claude-', '')).join('+')} / ${a.definition}`);
}
const PART_NAME = { skillListing: 'skill listing', deferredTools: 'deferred tools', mcpInstructions: 'MCP instructions' };
const PERMISSION = { skill: 'tools include Skill', 'all-tools': 'no tools line (all tools)', restricted: 'tools without Skill', 'not-editable': 'definition not editable here' };
p('What tool permissions add (median tokens per run that had it, weighted* over all runs; * = removed by the agent-tools action):');
for (const a of r.agentTypes.slice(0, args.top * 2)) {
  const b = a.startBreakdown;
  const parts = Object.entries(b.parts).filter(([, x]) => x.runs)
    .map(([k, x]) => `${PART_NAME[k]}${b.removable.includes(k) ? '*' : ''} ${x.runs}/${a.runs} runs ~${fmt(x.tokens)} tok ${fmt(x.cost)}`);
  p(`  ${padr(a.agentType, 22)}${padr(PERMISSION[b.permission], 30)}${parts.length ? parts.join('; ') : 'none'}`);
}
p();
p('== 7. Skill listing in the main thread (carried until the next context drop) ==');
const sl = r.skillListing;
if (!sl || !sl.main.listings) p('No skill listing in the main threads.');
else {
  p(`${sl.main.sessions} sessions: at start median ~${fmt(sl.main.startTokens)} tokens (${fmt(sl.main.startChars)} chars); full listing sent again ${sl.main.reinjections} times later in ${sl.main.sessionsWithReinjection} sessions, ${sl.main.additions} small additions`);
  p(`carried: ${fmt(sl.main.carry)} weighted (${pct(sl.main.share)})  writes ${fmt(sl.main.write)}  reads ${fmt(sl.main.read)}`);
  p(`${padr('session', 10)}${pad('start chars', 12)}${pad('again', 7)}${pad('added', 7)}${pad('weighted*', 14)}`);
  for (const x of sl.sessions) p(`${padr(x.session, 10)}${pad(fmt(x.startChars), 12)}${pad(x.reinjections, 7)}${pad(x.additions, 7)}${pad(fmt(x.carry), 14)}`);
  p(`${padr('plugin', 38)}${pad('skills', 7)}${pad('chars', 9)}${pad('uses', 6)}${pad('weighted*', 14)}${pad('share', 8)}`);
  for (const x of sl.plugins) p(`${padr(x.plugin, 38)}${pad(x.skills, 7)}${pad(fmt(x.chars), 9)}${pad(x.uses, 6)}${pad(fmt(x.carry), 14)}${pad(pct(x.share), 8)}`);
  p(`not used in this range: ${sl.unusedPlugins.length ? sl.unusedPlugins.join(', ') : 'none'}`);
  p(`subagents received ${sl.subagents.listings} listings (${fmt(sl.subagents.chars)} chars); counted in section 6 / agent-tools`);
}
p();
p('== 8. Tool results kept in context (weight while carried until the next clear/compact) ==');
p(`${padr('where', 11)}${padr('tool', 28)}${pad('calls', 7)}${pad('chars', 13)}${pad('large', 7)}${pad('weighted*', 14)}`);
for (const g of r.toolResults.slice(0, args.top)) p(`${padr(g.where, 11)}${padr(g.tool, 28)}${pad(g.calls, 7)}${pad(fmt(g.chars), 13)}${pad(g.largeCalls, 7)}${pad(fmt(g.cost), 14)}`);
p('Read files by weight (basename):');
p(`${padr('file', 36)}${pad('reads', 7)}${pad('threads', 8)}${pad('chars', 13)}${pad('weighted*', 14)}`);
for (const f of r.files) p(`${padr(f.file, 36)}${pad(f.reads, 7)}${pad(f.threads, 8)}${pad(fmt(f.chars), 13)}${pad(fmt(f.cost), 14)}`);
p();
p('== 9. Findings, largest estimated saving first ==');
if (!r.findings.length) p('No finding above ' + pct(0.005) + ' of the total.');
r.findings.forEach((f, i) => {
  p();
  p(`${i + 1}. [${f.id}] ${f.title}`);
  p(`   estimated saving: ${fmt(f.saving)} weighted* (${pct(f.share)} of all)   ${f.kind === 'mechanical' ? 'mechanical edit' : f.kind === 'warning' ? 'warning' : 'judgement call'}`);
  if (f.target.agentType) p(`   target: ${f.target.agentType}  definition: ${f.target.definition}`);
  else p(`   target: ${f.target.thread === 'main' ? 'main thread' : 'subagents'}${f.target.tool ? ' / ' + f.target.tool : ''}`);
  for (const e of f.evidence) p(`   - ${e}`);
  p(`   action: ${f.action}`);
});
if (r.omittedFindings) p(`\n(${r.omittedFindings} smaller findings omitted: below 0.5% of the total or past --top)`);
console.log(L.join('\n'));
