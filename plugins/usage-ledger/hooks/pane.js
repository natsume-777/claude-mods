// The pane /usage-ledger opens, the band above the prompt, and the handoff the pane and the
// band start.
//
// The pane is one, its view ($.state `view`) switching what it draws, since a second pane
// opened from a button may not come to the front. Its first view, 状況, says in plain words
// where the session stands and what to do; the others are tables of one-line rows, a row's
// [▸] opening its details under it ($.state `open`, one row per view). Everything is
// aggregated afresh from $.state at each drawing, and the drawing reads that state, so a new
// request redraws it; nothing here calls $.ui.invalidate (register.js redraws at the cache's
// two edges only, since every redraw rebuilds every mod's drawing in the desktop app).
//
// The band shows whenever the main context is known: a gauge with no number of how far the
// context is from where a handoff pays (ledger.js gaugeOf, drawn by meter.js), the stage's
// word and [詳しく], all on one line; a short phrase and [引き継ぐ…] join it only when there is
// something to do. On a narrow line it gives way as meter.js fitMeter says, without a redraw
// of its own: a change of width draws it again.
// What mods beneath draw in the band (usage-band) stays under it.
//
// [引き継ぐ…] only fills the prompt box with a draft asking the model to write a handoff and
// open a new session; the person reads it and decides whether to send it.

import { aggregateThreads, TYPES, clockOf } from './aggregate.js'
import {
  VIEWS,
  ADVICE,
  gauge,
  ESTIMATE_NOTE,
  WEIGHTS_NOTE,
  handoffKey,
  getConfig,
  getObserved,
  assumed,
  summarize,
  toThreads,
  short,
  pct,
  duration,
  modelShort,
  modelsLine,
  localOffsetMinutes,
  handoffId,
  handoffFile,
  handoffDraft,
} from './ledger.js'
import { SPACE, COLOR, BUTTON, choice, dim, inline, cell, slot, tableRow, field, section, details, page } from './style.js'
import { fitMeter, meterParts, cells } from './meter.js'
import { exportPaths, exportMarkdown, exportJsonl, promptLine } from './export.js'
import { GRACE_MS, guardDrawing, beginPress, hasStarted, takeOver, endPress } from './press-guard.js'
import { atom, read, update } from 'claude-code'

// The state this file reads and writes (declared in types/index.d.ts)
const view = atom({ plugin: 'usage-ledger', key: 'view' }, 'status')
const REQUESTS = { plugin: 'usage-ledger', key: 'requests' }
const THREADS = { plugin: 'usage-ledger', key: 'threads' }
const STARTED_AT = { plugin: 'usage-ledger', key: 'startedAt' }
const OPEN = { plugin: 'usage-ledger', key: 'open' }
const HANDOFF = { plugin: 'usage-ledger', key: 'handoff' }
const INCOMING = { plugin: 'usage-ledger', key: 'incoming' }

const TITLE = 'トークンの内訳'
const TYPE_LABEL = { input: '入力', cache_read: 'キャッシュ読み', cache_write_5m: '書き 5m', cache_write_1h: '書き 1h', output: '出力' }
// Rows a long list shows
const MAX_ROWS = 40

// Element keys allow a plain set of characters; agent ids and tool names may carry others
const keyOf = (prefix, id) => prefix + '-' + String(id).replace(/[^A-Za-z0-9_-]/g, '_')

// ===== Actions: called from press handlers only (never while drawing) =====

async function go($, id) {
  await update($, view, () => id)
  try {
    await $.ui.scroll({ in: 'usage-ledger', to: 'start' })
  } catch {}
}

// Opens the pane at view `id`: /usage-ledger and the band's [詳しく]
async function openPane($, id) {
  await update($, view, () => id)
  return $.ui.open({ id: 'usage-ledger', title: TITLE })
}

// Opens one row's details in a view, or closes them when pressed again
function toggleOpen($, viewId, rowKey) {
  return update($, { ...OPEN, id: viewId }, (value) => (value === rowKey ? '' : rowKey))
}

// Puts the handoff draft in the prompt box (never sends it) and records the handoff, here
// ($.state) and for the new session ($.store)
async function startHandoff($) {
  const now = await $.clock.now()
  const tz = localOffsetMinutes()
  const { value: requests } = await $.state.get(REQUESTS)
  const s = summarize(requests, now)
  const id = handoffId(now, tz)
  const file = handoffFile(getConfig().handoffDir, now, tz)
  const text = handoffDraft({ file, id })
  const box = await $.prompt.read()
  const hasDraft = typeof box?.text === 'string' && box.text.trim() !== ''
  const filled = await $.prompt.fill(hasDraft ? { text: '\n\n' + text, mode: 'append' } : { text, mode: 'replace' })
  if (!filled?.isFilled) {
    $.ui.toast('入力欄に下書きを入れられませんでした' + (filled?.refusal ? `（${filled.refusal}）` : ''))
    return
  }
  const predictedCtx = assumed().freshCtx
  await $.store.set(handoffKey(id), { fromSession: await $.session.id(), ctxAtHandoff: s.context, predictedCtx, createdAt: now, observed: [] })
  await $.state.set(HANDOFF, { id, status: 'drafted', createdAt: now, file, ctxAtHandoff: s.context, predictedCtx, observed: [] })
  $.ui.toast('引き継ぎの下書きを入力欄に入れました。読んでから、送るかどうかを決めてください')
}

async function cancelHandoff($) {
  await $.state.set(HANDOFF, null)
}

// Writes the session's numbers to the export folder (export.js: a .md summary and a .jsonl of
// the requests, the pair overwritten on each press), then names the .md in a toast and in a
// line added to the prompt box (never sent). Nothing goes into $.state, so nothing redraws.
async function exportData($) {
  const now = await $.clock.now()
  const tz = localOffsetMinutes()
  const { value: requests = [] } = await $.state.get(REQUESTS)
  const { value: threads = {} } = await $.state.get(THREADS)
  const { value: startedAt } = await $.state.get(STARTED_AT)
  const sessionId = await $.session.id()
  const paths = exportPaths({
    dir: getConfig().exportDir,
    root: await $.session.root(),
    sessionId,
    startedAt: typeof startedAt === 'number' ? startedAt : now,
    tzOffsetMinutes: tz,
  })
  const jsonlName = paths.name + '.jsonl'
  try {
    await $.fs.write(paths.md, exportMarkdown({ requests, threads, startedAt, now, tzOffsetMinutes: tz, sessionId, jsonlName }))
    await $.fs.write(paths.jsonl, exportJsonl(requests, threads, tz))
  } catch (error) {
    $.ui.toast(`集計を書き出せませんでした（${paths.shown.md}）: ${String(error?.message ?? error)}`)
    return
  }
  const line = promptLine(paths.shown.md)
  const box = await $.prompt.read()
  const hasDraft = typeof box?.text === 'string' && box.text.trim() !== ''
  const filled = await $.prompt.fill(hasDraft ? { text: '\n\n' + line, mode: 'append' } : { text: line, mode: 'replace' })
  $.ui.toast(`集計を ${paths.shown.md} に書き出しました` + (filled?.isFilled ? '' : '（入力欄には入れられませんでした）'))
}

// ===== The pane =====

// Reads everything a view draws from; each read subscribes the drawing
async function gather($, e) {
  const current = await read($, view)
  const { value: requests = [] } = await $.state.get(REQUESTS)
  const { value: threads = {} } = await $.state.get(THREADS)
  const { value: startedAt } = await $.state.get(STARTED_AT)
  const { value: open = '' } = await $.state.get({ ...OPEN, id: current })
  const { value: handoff = null } = await $.state.get(HANDOFF)
  const { value: incoming = null } = await $.state.get(INCOMING)
  const now = await $.clock.now()
  const tz = localOffsetMinutes()
  const agg = aggregateThreads(toThreads(requests, threads), { tzOffsetMinutes: tz, top: 15 })
  const s = summarize(requests, now, { handoff: handoff?.status })
  // The pane is not told whether a turn runs: the idle warning is left to the band
  const g = gauge(s, { isWorking: true })
  return { view: current, requests, threads, startedAt, open, handoff, incoming, now, tz, agg, s, g, surface: e.surface, width: widthOf(e) ?? 84 }
}

function drawHeader($, ui, d) {
  const started = typeof d.startedAt === 'number' ? '集計開始 ' + clockOf(d.startedAt, d.tz) : '集計開始 —'
  const nav = VIEWS.map((v) =>
    ui.Button({ key: 'view-' + v.id, label: v.label, ...choice(d.view === v.id), onPress: () => go($, v.id) }),
  )
  nav.push(ui.Button({ key: 'close', label: '閉じる', role: 'dismiss', ...BUTTON.nav, onPress: () => $.ui.close({ id: 'usage-ledger' }) }))
  return ui.Box({
    key: 'header',
    flexDirection: 'column',
    width: '100%',
    children: [
      ui.Text({ bold: true, children: [TITLE] }),
      dim(ui, 'header-about', `${started} · 要求 ${d.agg.total.requests} 回 · 重み計 ${short(d.agg.total.weighted)}*`),
      inline(ui, 'header-nav', nav, 1),
    ],
  })
}

// A [▸] button that opens a row's details
function openButton($, ui, d, rowKey) {
  const isOpen = d.open === rowKey
  return ui.Button({ key: keyOf('open-' + d.view, rowKey), label: isOpen ? '▾' : '▸', ...choice(isOpen), onPress: () => toggleOpen($, d.view, rowKey) })
}

const num = (ui, width, text, props = {}) => cell(ui, width, text, props, 'flex-end')
const head = (ui, width, text, align) => cell(ui, width, text, { dimColor: true }, align)
const tokLine = (t) => TYPES.map((k) => `${TYPE_LABEL[k]} ${short(t[k])}`).join(' · ')

// ----- 状況 -----

// What each stage means and what to do, in plain words: [what it is, what to do]
const STATUS_TEXT = {
  ok: [
    'まだ余裕があります。このまま続けて大丈夫です。',
    '会話が長くなるほど、1 回のやり取りで使う量が増えます。目安が右端に近づいたら、新しいセッションに引き継ぐと節約になります。',
  ],
  soon: [
    '会話が長くなってきました。',
    'このまま続けるより、新しいセッションに引き継いだほうが使う量が少なく済むようになってきています。作業の区切りで [引き継ぐ…] を押してください。',
  ],
  switch: [
    '会話がかなり長くなりました。',
    '新しいセッションに引き継いだほうが、使う量が少なく済みます。今の区切りで [引き継ぐ…] を押してください。',
  ],
  expired: [
    '休憩の間に割高になりました。',
    'しばらく操作がなかったので、次の 1 回は会話全体を読み込み直すことになり、使う量が増えます。続きは新しいセッションのほうが安く済みます。[引き継ぐ…] を押してください。',
  ],
}

function drawStatus($, ui, d) {
  const { g } = d
  const lines = []
  if (g.percent == null) {
    lines.push(dim(ui, 'status-empty', 'まだこのセッションの要求がありません。会話を始めると、ここに目安が出ます'))
  } else {
    // The page's padding and the section's indent come off the pane's width
    const fit = fitMeter({ surface: d.surface, stage: g.stage, columns: d.width - 2 * SPACE.page - SPACE.indent })
    lines.push(ui.Box({ key: 'status-meter', flexDirection: 'row', flexWrap: 'nowrap', columnGap: SPACE.inline, alignItems: 'center', children: meterParts(ui, d.surface, fit, g) }))
    const [what, todo] = STATUS_TEXT[g.advice === 'expired' ? 'expired' : g.stage]
    lines.push(ui.Box({ key: 'status-what', children: [ui.Text({ wrap: 'wrap', ...(g.stage === 'ok' ? {} : { bold: true }), children: [what] })] }))
    lines.push(ui.Box({ key: 'status-todo', children: [ui.Text({ wrap: 'wrap', children: [todo] })] }))
  }
  if (d.handoff) lines.push(field(ui, 'status-handoff-state', '引き継ぎ', handoffState(d.handoff), 10))

  const actions = []
  if (d.handoff?.status === 'drafted') {
    actions.push(ui.Button({ key: 'status-cancel', label: '取り消す', ...BUTTON.minor, onPress: () => cancelHandoff($) }))
  } else if (!d.handoff && g.advice) {
    actions.push(ui.Button({ key: 'status-handoff', label: '引き継ぐ…', ...BUTTON.main, onPress: () => startHandoff($) }))
  }
  actions.push(ui.Button({ key: 'status-details', label: '詳しい数字', ...BUTTON.nav, onPress: () => go($, 'overview') }))
  actions.push(ui.Button({ key: 'status-export', label: '書き出す', ...BUTTON.nav, onPress: () => exportData($) }))
  actions.push(ui.Button({ key: 'status-about-handoff', label: '引き継ぎについて', ...BUTTON.nav, onPress: () => go($, 'handoff') }))
  return [section(ui, 'status', '今の状況', lines), inline(ui, 'status-actions', actions)]
}

// ----- 概要 -----
function drawOverview($, ui, d) {
  const { s, agg } = d
  const be = s.breakEven
  const { freshCtx, baseCtx } = assumed()
  const obs = getObserved()
  const now = []
  if (s.context == null) {
    now.push(dim(ui, 'now-empty', 'まだ主スレッドの要求がありません。集計開始より後の要求だけを数えます'))
  } else {
    now.push(field(ui, 'now-ctx', '主の文脈', `${short(s.context)}（${modelShort(s.model)}）`, 18, s.isHeavy ? { color: COLOR.warn } : {}))
    now.push(
      field(
        ui,
        'now-cache',
        'キャッシュ',
        s.isExpired
          ? `切れた（${duration(d.now - s.expiresAt)} 前）`
          : `残り ${duration(s.remainingMs)}（${getConfig().ttlMain} で計算）`,
        18,
        s.isExpired ? { color: COLOR.bad } : {},
      ),
    )
    now.push(field(ui, 'now-next', '次の1回', `≈${short(be.next)}*`))
    now.push(field(ui, 'now-rewrite', '切れたら再書込', `≈${short(be.rewrite)}*`))
    const premise = `初期 ${short(freshCtx)}・基礎 ${short(baseCtx)} を前提${obs.fresh || obs.base ? '（実測を含む）' : ''}`
    let fresh = '今の文脈が新しいセッションの初期文脈より小さいので、引き継ぐ得はない'
    if (be.applies) fresh = (be.runs === 0 ? 'キャッシュが切れたので、今なら新しいセッションのほうが安い' : `${be.runs} 回の要求で回収できる`) + '。' + premise
    now.push(field(ui, 'now-fresh', '新しいセッション', fresh))
  }
  if (d.handoff) now.push(field(ui, 'now-handoff', '引き継ぎ', handoffState(d.handoff)))

  const main = agg.threads.find((t) => t.key === 'main') ?? { requests: 0, weighted: 0 }
  const subs = { requests: agg.total.requests - main.requests, weighted: agg.total.weighted - main.weighted }
  const tax = agg.gapTax.expired
  const totals = [
    field(ui, 'total-requests', '要求', `${agg.total.requests} 回（主 ${main.requests}・サブ ${subs.requests}）`),
    field(ui, 'total-weighted', '重み*', `${short(agg.total.weighted)}（主 ${pct(main.weighted, agg.total.weighted)}・サブ ${pct(subs.weighted, agg.total.weighted)}）`),
    field(ui, 'total-hit', 'キャッシュ読みの割合', pct(agg.total.cacheHitRatio, 1)),
    field(ui, 'total-expired', '期限切れ後の再書込', `${tax.requests} 回 · 重み ${short(tax.weighted)}*（全体の ${pct(tax.weighted, agg.total.weighted)}）`),
  ]

  const typeRows = [
    tableRow(ui, 'type-head', [head(ui, 16, '種類'), head(ui, 10, 'トークン', 'flex-end'), head(ui, 10, '重み*', 'flex-end'), head(ui, 6, '割合', 'flex-end')]),
    ...agg.byType.map((r) =>
      tableRow(ui, keyOf('type', r.type), [
        cell(ui, 16, TYPE_LABEL[r.type]),
        num(ui, 10, short(r.tokens)),
        num(ui, 10, short(r.weighted)),
        num(ui, 6, pct(r.weighted, agg.total.weighted)),
      ]),
    ),
  ]

  return [
    section(ui, 'now', '今の文脈', now),
    section(ui, 'totals', '集計開始からの合計', totals),
    section(ui, 'types', 'トークンの種類別', typeRows),
    dim(ui, 'weights-note', WEIGHTS_NOTE),
    section(ui, 'export', '書き出し', [
      dim(ui, 'export-about', `この集計を ${getConfig().exportDir} にファイルで書き出し、会話で Claude に読ませられます`),
      inline(ui, 'overview-actions', [ui.Button({ key: 'overview-export', label: '書き出す', ...BUTTON.nav, onPress: () => exportData($) })]),
    ]),
  ]
}

function handoffState(h) {
  if (h.status === 'drafted') return '下書きを入力欄に入れた（新しいセッションはまだ）'
  const first = h.observed[0]
  return `済み · 元 ${short(h.ctxAtHandoff)} → 初回 ${short(first)}（予測 ${short(h.predictedCtx)}）`
}

// ----- スレッド -----

// The widths of the thread list's columns in `room` cells, a row being one line cut at the
// pane's edge: the thread (its description), its kind, its models, 要求, 重み*, 割合 and [▸].
// As room runs out, the thread's text shortens first, then the kind's, then the kind goes,
// then 要求, then 重み*; the models and 割合 stay. 0 is a column left out.
const THREAD_COL = { label: [12, 28], type: [8, 16], model: [6, 13], req: 5, weight: 8, share: 6, open: 3, labelMin: 6 }
export function threadColumns(room, modelCells) {
  const C = THREAD_COL
  let model = Math.min(Math.max(modelCells, C.model[0]), C.model[1])
  const steps = [
    { type: true, req: true, weight: true, labelMin: C.label[0] },
    { type: false, req: true, weight: true, labelMin: C.labelMin },
    { type: false, req: false, weight: true, labelMin: C.labelMin },
    { type: false, req: false, weight: false, labelMin: C.labelMin },
  ]
  for (const [i, s] of steps.entries()) {
    const nums = (s.req ? C.req : 0) + (s.weight ? C.weight : 0) + C.share + C.open
    const count = 4 + (s.type ? 1 : 0) + (s.req ? 1 : 0) + (s.weight ? 1 : 0)
    const free = room - model - nums - SPACE.column * (count - 1)
    const isLast = i === steps.length - 1
    if (s.type) {
      if (free - C.label[0] < C.type[0]) continue
      const type = Math.min(C.type[1], free - C.label[0])
      return { label: Math.min(C.label[1], free - type), type, model, req: C.req, weight: C.weight }
    }
    if (free < s.labelMin && !isLast) continue
    // Last: the models give way to keep the thread's text, then both stay at their least and
    // what does not fit is cut at the edge
    if (free < s.labelMin) model = Math.max(C.model[0] - 2, model - (s.labelMin - free))
    const label = Math.max(s.labelMin, Math.min(C.label[1], room - model - nums - SPACE.column * (count - 1)))
    return { label, type: 0, model, req: s.req ? C.req : 0, weight: s.weight ? C.weight : 0 }
  }
}

function drawThreads($, ui, d) {
  const { agg } = d
  const shown = agg.threads.slice(0, MAX_ROWS)
  const models = new Map(shown.map((t) => [t.key, modelsLine(t.models)]))
  // The page's padding and the section's indent come off the pane's width
  const col = threadColumns(d.width - 2 * SPACE.page - SPACE.indent, Math.max(0, ...[...models.values()].map(cells)))
  const rows = [
    tableRow(ui, 'thread-head', [
      head(ui, col.label, 'スレッド'),
      col.type ? head(ui, col.type, '種類') : null,
      head(ui, col.model, 'モデル'),
      col.req ? head(ui, col.req, '要求', 'flex-end') : null,
      col.weight ? head(ui, col.weight, '重み*', 'flex-end') : null,
      head(ui, THREAD_COL.share, '割合', 'flex-end'),
    ].filter(Boolean)),
  ]
  for (const t of shown) {
    const meta = d.threads[t.key] ?? {}
    rows.push(
      tableRow(ui, keyOf('thread', t.key), [
        cell(ui, col.label, t.label, t.key === 'main' ? { bold: true } : {}),
        col.type ? cell(ui, col.type, t.agentType, { dimColor: true }) : null,
        cell(ui, col.model, models.get(t.key)),
        col.req ? num(ui, col.req, t.requests) : null,
        col.weight ? num(ui, col.weight, short(t.weighted)) : null,
        num(ui, THREAD_COL.share, pct(t.weighted, agg.total.weighted)),
        slot(ui, THREAD_COL.open, [openButton($, ui, d, t.key)]),
      ].filter(Boolean)),
    )
    if (d.open === t.key) {
      const span = t.start != null ? `${clockOf(t.start, d.tz)}–${clockOf(t.end, d.tz)}` : '—'
      rows.push(
        details(ui, keyOf('thread-details', t.key), [
          t.description ? field(ui, 'd-desc', '説明', t.description, 14) : null,
          // What the row leaves out on a narrow pane
          col.type ? null : field(ui, 'd-type', '種類', t.agentType, 14),
          col.req && col.weight ? null : field(ui, 'd-weight', '要求・重み', `${t.requests} 回 · 重み ${short(t.weighted)}*`, 14),
          field(ui, 'd-id', 'id', t.key, 14),
          field(ui, 'd-models', 'モデル', t.models.map(modelShort).join('、') || '—', 14),
          field(ui, 'd-span', '期間', span, 14),
          field(ui, 'd-ctx', '文脈', `初回 ${short(t.firstContext)} → 最後 ${short(t.lastContext)}`, 14),
          field(ui, 'd-tok', 'トークン', tokLine(t.tok), 14),
          field(
            ui,
            'd-source',
            '数え方',
            t.key === 'main' ? 'ライブ（書き込みの 5m / 1h は設定で振り分け）' : meta.isBackfilled ? '終了後に記録から読み直した' : 'ライブ（書き込みの 5m / 1h は設定で振り分け）',
            14,
          ),
        ]),
      )
    }
  }
  if (agg.threads.length > MAX_ROWS) rows.push(dim(ui, 'thread-more', `ほか ${agg.threads.length - MAX_ROWS} 件`))
  return [section(ui, 'threads', '主スレッドとサブエージェント（重みの大きい順）', rows)]
}

// ----- 種類・モデル -----
function drawKinds($, ui, d) {
  const { agg } = d
  const kindRows = [
    tableRow(ui, 'kind-head', [head(ui, 22, '種類'), head(ui, 4, '回', 'flex-end'), head(ui, 5, '要求', 'flex-end'), head(ui, 8, '重み*', 'flex-end'), head(ui, 6, '割合', 'flex-end')]),
    ...agg.byAgentType.map((r) =>
      tableRow(ui, keyOf('kind', r.key), [
        cell(ui, 22, r.key),
        num(ui, 4, r.runs),
        num(ui, 5, r.requests),
        num(ui, 8, short(r.weighted)),
        num(ui, 6, pct(r.weighted, agg.total.weighted)),
      ]),
    ),
  ]
  const modelRows = [
    tableRow(ui, 'model-head', [head(ui, 28, 'モデル'), head(ui, 5, '要求', 'flex-end'), head(ui, 8, '重み*', 'flex-end'), head(ui, 6, '割合', 'flex-end')]),
    ...agg.byModel.map((r) =>
      tableRow(ui, keyOf('model', r.key), [
        cell(ui, 28, modelShort(r.key)),
        num(ui, 5, r.requests),
        num(ui, 8, short(r.weighted)),
        num(ui, 6, pct(r.weighted, agg.total.weighted)),
      ]),
    ),
  ]
  return [section(ui, 'kinds', 'エージェントの種類別', kindRows), section(ui, 'models', 'モデル別', modelRows)]
}

// ----- 高い要求 -----
function drawCostly($, ui, d) {
  const { agg } = d
  const label = Object.fromEntries(agg.threads.map((t) => [t.key, t.label]))
  const rows = [
    tableRow(ui, 'costly-head', [
      head(ui, 5, '時刻'),
      head(ui, 18, 'スレッド'),
      head(ui, 7, '文脈', 'flex-end'),
      head(ui, 7, '書込', 'flex-end'),
      head(ui, 6, '出力', 'flex-end'),
      head(ui, 8, '重み*', 'flex-end'),
    ]),
  ]
  agg.biggest.forEach((q, i) => {
    const rowKey = String(i)
    rows.push(
      tableRow(ui, keyOf('costly', i), [
        cell(ui, 5, clockOf(q.ts, d.tz), { dimColor: true }),
        cell(ui, 18, label[q.thread] ?? q.thread),
        num(ui, 7, short(q.context)),
        num(ui, 7, short(q.write), q.write > 0.5 * q.context ? { color: COLOR.warn } : {}),
        num(ui, 6, short(q.output)),
        num(ui, 8, short(q.weighted)),
        slot(ui, 3, [openButton($, ui, d, rowKey)]),
      ]),
    )
    if (d.open === rowKey) {
      rows.push(
        details(ui, keyOf('costly-details', i), [
          field(ui, 'd-model', 'モデル', modelShort(q.model), 14),
          field(ui, 'd-tools', 'ツール', q.tools.length ? q.tools.join('、') : '（文字だけ）', 14),
        ]),
      )
    }
  })
  if (agg.biggest.length === 0) rows.push(dim(ui, 'costly-empty', 'まだ要求がありません'))
  return [section(ui, 'costly', '重みの大きい要求（全スレッド、上位 15）', rows)]
}

// ----- 待ちと再書込 -----
function drawGaps($, ui, d) {
  const { agg } = d
  const label = Object.fromEntries(agg.threads.map((t) => [t.key, t.label]))
  const tax = agg.gapTax
  const summary = [
    field(ui, 'gap-expired', '期限切れの後', `${tax.expired.requests} 回 · 書込 ${short(tax.expired.write)} · 重み ${short(tax.expired.weighted)}*（全体の ${pct(tax.expired.weighted, agg.total.weighted)}）`),
    field(ui, 'gap-within', '期限内', `${tax.within.requests} 回 · 書込 ${short(tax.within.write)} · 重み ${short(tax.within.weighted)}*`),
  ]
  const rows = [
    tableRow(ui, 'gap-head', [
      head(ui, 5, '時刻'),
      head(ui, 18, 'スレッド'),
      head(ui, 7, '待ち', 'flex-end'),
      head(ui, 3, 'TTL'),
      head(ui, 4, '状態'),
      head(ui, 7, '書込', 'flex-end'),
      head(ui, 8, '重み*', 'flex-end'),
    ]),
  ]
  for (const g of [...agg.gaps].reverse().slice(0, MAX_ROWS)) {
    const expired = g.state === 'expired'
    rows.push(
      tableRow(ui, keyOf('gap', g.thread + '-' + g.ts), [
        cell(ui, 5, clockOf(g.ts, d.tz), { dimColor: true }),
        cell(ui, 18, label[g.thread] ?? g.thread),
        num(ui, 7, duration(g.gapSeconds * 1000)),
        cell(ui, 3, g.ttlSeconds === 3600 ? '1h' : '5m', { dimColor: true }),
        cell(ui, 4, expired ? '切れ' : '内', expired ? { color: COLOR.bad } : { dimColor: true }),
        num(ui, 7, short(g.write)),
        num(ui, 8, short(g.weighted)),
      ]),
    )
  }
  if (agg.gaps.length === 0) rows.push(dim(ui, 'gap-empty', '5 分を超えて間が空いた要求はまだありません'))
  return [
    section(ui, 'gap-summary', 'キャッシュの再書込', summary),
    section(ui, 'gaps', '5 分を超えて間が空いた要求（新しい順）', rows),
    dim(ui, 'gap-note', 'TTL は同じスレッドの直前の要求の書き込みで判断します。ライブで数えた分の 5m / 1h は設定による推定です'),
  ]
}

// ----- 主のツール -----
function drawTools($, ui, d) {
  const { agg } = d
  const rows = [
    tableRow(ui, 'tool-head', [head(ui, 30, '応答で呼んだツール'), head(ui, 5, '要求', 'flex-end'), head(ui, 8, '重み*', 'flex-end'), head(ui, 6, '主の中', 'flex-end')]),
    ...agg.main.byTool.slice(0, MAX_ROWS).map((r) =>
      tableRow(ui, keyOf('tool', r.key), [
        cell(ui, 30, r.key === 'text' ? '（文字だけ）' : r.key),
        num(ui, 5, r.requests),
        num(ui, 8, short(r.weighted)),
        num(ui, 6, pct(r.weighted, agg.main.weighted)),
      ]),
    ),
  ]
  if (agg.main.byTool.length === 0) rows.push(dim(ui, 'tool-empty', 'まだ主スレッドの要求がありません'))
  return [section(ui, 'tools', '主スレッドの要求を、その応答が呼んだツールで分けたもの', rows)]
}

// ----- 引き継ぎ -----
function drawHandoff($, ui, d) {
  const { freshCtx, baseCtx } = assumed()
  const blocks = [
    dim(
      ui,
      'handoff-about',
      '[引き継ぐ…] は、引き継ぎ文を書いて新しいセッションを開くよう頼む文を、入力欄に入れるだけです。送るかどうかはあなたが決めます。新しいセッションを開く前にも、Claude があなたに確認します',
    ),
    section(ui, 'handoff-setup', '設定', [
      field(ui, 'handoff-dir', '置き場', getConfig().handoffDir),
      field(ui, 'handoff-premise', '前提', `初期文脈 ${short(freshCtx)}・基礎部分 ${short(baseCtx)}`),
    ]),
    inline(ui, 'handoff-actions', [ui.Button({ key: 'handoff-start', label: '引き継ぐ…', ...BUTTON.main, onPress: () => startHandoff($) })]),
  ]
  const h = d.handoff
  if (h) {
    const lines = [
      field(ui, 'out-state', '状態', handoffState(h)),
      field(ui, 'out-file', 'ファイル', h.file),
      field(ui, 'out-id', '目印', `[usage-ledger handoff ${h.id}]`),
    ]
    if (h.observed.length > 0) lines.push(field(ui, 'out-observed', '新しいセッション', h.observed.map(short).join(' → ')))
    blocks.push(section(ui, 'handoff-out', 'このセッションからの引き継ぎ', lines))
    if (h.status === 'drafted') {
      blocks.push(inline(ui, 'handoff-out-actions', [ui.Button({ key: 'handoff-cancel', label: '取り消す', ...BUTTON.minor, onPress: () => cancelHandoff($) })]))
    }
  }
  const inc = d.incoming
  if (inc) {
    const first = inc.observed[0]
    blocks.push(
      section(ui, 'handoff-in', 'このセッションへの引き継ぎ', [
        field(ui, 'in-result', '文脈', `元 ${short(inc.ctxAtHandoff)} → 初回 ${first == null ? '—' : short(first)}（予測 ${short(inc.predictedCtx)}）`),
        field(ui, 'in-observed', '最初の要求', inc.observed.length ? inc.observed.map(short).join(' → ') : 'まだありません'),
        field(ui, 'in-id', '目印', inc.id),
      ]),
    )
  }
  return blocks
}

function drawView($, ui, d) {
  switch (d.view) {
    case 'threads':
      return drawThreads($, ui, d)
    case 'kinds':
      return drawKinds($, ui, d)
    case 'costly':
      return drawCostly($, ui, d)
    case 'gaps':
      return drawGaps($, ui, d)
    case 'tools':
      return drawTools($, ui, d)
    case 'handoff':
      return drawHandoff($, ui, d)
    case 'overview':
      return drawOverview($, ui, d)
    default:
      return drawStatus($, ui, d)
  }
}

// ===== The band =====

// The cells across a drawing: the site's own width, else what the surface measured; null when
// neither is known
function widthOf(e) {
  const n = e.props?.bodyColumns
  if (typeof n === 'number' && n > 0) return n
  const v = e.viewport?.columns
  return typeof v === 'number' && v > 0 ? v : null
}

// The band, one line: the gauge, the stage's word, a short phrase and its button when there is
// something to do (or a handoff under way), then [詳しく]. The longer details are the pane's.
// null before the main context is known.
function drawBand($, ui, s, g, surface, columns) {
  const { Box, Text, Button } = ui
  if (g.percent == null) return null
  let phrase = null
  let color = null
  let action = null
  if (s.handoff === 'drafted') {
    phrase = '引き継ぎの下書きを入力欄に入れました'
    action = { key: 'band-cancel', label: '取り消す', ...BUTTON.minor, onPress: () => cancelHandoff($) }
  } else if (s.handoff === 'done') {
    phrase = '引き継ぎ済み'
  } else if (g.advice) {
    phrase = ADVICE[g.advice]
    color = g.advice === 'expired' || g.advice === 'switch' ? COLOR.bad : COLOR.warn
    action = { key: 'band-handoff', label: '引き継ぐ…', ...BUTTON.main, onPress: () => startHandoff($) }
  }
  const actions = [...(action ? [action] : []), { key: 'band-details', label: '詳しく', ...BUTTON.nav, onPress: () => openPane($, 'status') }]

  const fit = fitMeter({ surface, stage: g.stage, columns, phrase, buttons: actions.map((a) => a.label) })
  const children = meterParts(ui, surface, fit, g)
  if (fit.hasPhrase) {
    children.push(Box({ key: 'band-sep', flexShrink: 0, children: [Text({ dimColor: true, children: ['·'] })] }))
    // The only part that shrinks: cut with an ellipsis, never wrapped
    children.push(Box({ key: 'band-phrase', flexShrink: 1, minWidth: 0, children: [Text({ wrap: 'truncate-end', ...(color ? { color } : {}), children: [phrase] })] }))
  }
  children.push(...actions.map((a) => Box({ key: a.key + '-slot', flexShrink: 0, children: [Button(a)] })))
  return Box({ key: 'usage-ledger-band', flexDirection: 'row', flexWrap: 'nowrap', columnGap: 1, alignItems: 'center', children })
}

export function registerPane(on) {
  // /usage-ledger opens the pane at its first view, 状況
  on('command.run', { command: 'usage-ledger' }, async ($) => {
    const opened = await openPane($, 'status')
    return { text: opened.isPlaced ? 'トークンの内訳を開きました' : 'トークンの内訳を開きました（まだ表示されていません）' }
  })

  on('ui.render', { component: 'Pane', requestId: 'usage-ledger' }, async ($, e) => {
    const guard = guardDrawing(e.requestId)
    const ui = guard.wrap($.ui.resolve(e))
    const d = await gather($, e)
    return guard.done(page(ui, [drawHeader($, ui, d), ...drawView($, ui, d), dim(ui, 'estimate-note', ESTIMATE_NOTE)]))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (!getConfig().showBand || e.props.hasSurvey) return rest
    const { value: requests } = await $.state.get(REQUESTS)
    const { value: handoff } = await $.state.get(HANDOFF)
    const s = summarize(requests, await $.clock.now(), { handoff: handoff?.status })
    const ui = $.ui.resolve(e)
    const mine = drawBand($, ui, s, gauge(s, { isWorking: e.props.isWorking }), e.surface, widthOf(e))
    if (!mine) return rest
    if (!rest) return mine
    return ui.Box({ flexDirection: 'column', children: [mine, rest] })
  })

  // A press on this mod's elements (the pane and the band). On the pane
  // (press-guard.js) it also checks that the press reached the Button's onPress; when the chain
  // settled, threw, or stayed silent for GRACE_MS without it, the press runs once with the
  // latest drawing's closure under the same key.
  on('ui.press', { plugin: 'usage-ledger' }, async ($, e, next) => {
    const record = beginPress(e)
    const chain = next(e).then(
      (value) => ({ kind: 'value', value }),
      (error) => ({ kind: 'error', error }),
    )
    let outcome
    if (record) {
      const timer = new AbortController()
      const grace = $.clock.sleep(GRACE_MS, { signal: timer.signal }).then(
        () => ({ kind: 'grace' }),
        () => new Promise(() => {}),
      )
      outcome = await Promise.race([chain, grace])
      timer.abort()
      if (outcome.kind === 'grace' && hasStarted(record)) outcome = await chain
    } else {
      outcome = await chain
    }
    if (!record || hasStarted(record)) {
      if (record) endPress(e, record)
      if (outcome.kind === 'error') throw outcome.error
      return outcome.value
    }
    try {
      await takeOver(record, e)
    } catch {}
    return { element: e.element }
  })
}
