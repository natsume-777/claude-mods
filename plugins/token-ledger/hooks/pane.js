// The pane /token-ledger opens, the band above the prompt, and the handoff they both start.
//
// The pane is one, its view ($.state `view`) switching what it draws, since a second pane
// opened from a button may not come to the front. Each view is a table of one-line rows;
// a row's [▸] opens its details under it ($.state `open`, one row per view). Everything is
// aggregated afresh from $.state at each drawing, and the drawing reads that state, so a new
// request redraws it; nothing here calls $.ui.invalidate.
//
// The band shows only when it is worth a look (aggregate.js summaryForBand: a fresh session
// pays back within 10 requests, the context is heavy, or the cache nears its end while idle),
// or while a handoff is under way. What mods beneath draw in the band (usage-band) stays
// under it.
//
// [引き継ぎ…] only fills the prompt box with a draft asking the model to write a handoff and
// open a new session; the person reads it and decides whether to send it.

import { aggregateThreads, TYPES, clockOf } from './aggregate.js'
import {
  VIEWS,
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
  localOffsetMinutes,
  handoffId,
  handoffFile,
  handoffDraft,
} from './ledger.js'
import { SPACE, COLOR, BUTTON, choice, dim, inline, cell, slot, tableRow, field, section, details, page } from './style.js'
import { GRACE_MS, guardDrawing, beginPress, hasStarted, takeOver, endPress } from './press-guard.js'
import { atom, read, update } from 'claude-code'

// The state this file reads and writes (declared in types/index.d.ts)
const view = atom({ plugin: 'token-ledger', key: 'view' }, 'overview')
const REQUESTS = { plugin: 'token-ledger', key: 'requests' }
const THREADS = { plugin: 'token-ledger', key: 'threads' }
const STARTED_AT = { plugin: 'token-ledger', key: 'startedAt' }
const OPEN = { plugin: 'token-ledger', key: 'open' }
const HANDOFF = { plugin: 'token-ledger', key: 'handoff' }
const INCOMING = { plugin: 'token-ledger', key: 'incoming' }

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
    await $.ui.scroll({ in: 'token-ledger', to: 'start' })
  } catch {}
}

async function openPane($, id) {
  await update($, view, () => id)
  await $.ui.open({ id: 'token-ledger', title: TITLE })
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
  return { view: current, requests, threads, startedAt, open, handoff, incoming, now, tz, agg, s, width: e.props?.bodyColumns ?? 84 }
}

function drawHeader($, ui, d) {
  const started = typeof d.startedAt === 'number' ? '集計開始 ' + clockOf(d.startedAt, d.tz) : '集計開始 —'
  const nav = VIEWS.map((v) =>
    ui.Button({ key: 'view-' + v.id, label: v.label, ...choice(d.view === v.id), onPress: () => go($, v.id) }),
  )
  nav.push(ui.Button({ key: 'close', label: '閉じる', role: 'dismiss', ...BUTTON.nav, onPress: () => $.ui.close({ id: 'token-ledger' }) }))
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
  ]
}

function handoffState(h) {
  if (h.status === 'drafted') return '下書きを入力欄に入れた（新しいセッションはまだ）'
  const first = h.observed[0]
  return `済み · 元 ${short(h.ctxAtHandoff)} → 初回 ${short(first)}（予測 ${short(h.predictedCtx)}）`
}

// ----- スレッド -----
function drawThreads($, ui, d) {
  const { agg } = d
  const rows = [
    tableRow(ui, 'thread-head', [
      head(ui, 22, 'スレッド'),
      head(ui, 16, '種類'),
      head(ui, 5, '要求', 'flex-end'),
      head(ui, 8, '重み*', 'flex-end'),
      head(ui, 6, '割合', 'flex-end'),
    ]),
  ]
  for (const t of agg.threads.slice(0, MAX_ROWS)) {
    const meta = d.threads[t.key] ?? {}
    rows.push(
      tableRow(ui, keyOf('thread', t.key), [
        cell(ui, 22, t.label, t.key === 'main' ? { bold: true } : {}),
        cell(ui, 16, t.agentType, { dimColor: true }),
        num(ui, 5, t.requests),
        num(ui, 8, short(t.weighted)),
        num(ui, 6, pct(t.weighted, agg.total.weighted)),
        slot(ui, 3, [openButton($, ui, d, t.key)]),
      ]),
    )
    if (d.open === t.key) {
      const span = t.start != null ? `${clockOf(t.start, d.tz)}–${clockOf(t.end, d.tz)}` : '—'
      rows.push(
        details(ui, keyOf('thread-details', t.key), [
          t.description ? field(ui, 'd-desc', '説明', t.description, 14) : null,
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
      '[引き継ぎ…] は、引き継ぎ文を書いて新しいセッションを開くよう頼む文を、入力欄に入れるだけです。送るかどうかはあなたが決めます。新しいセッションを開く前にも、Claude があなたに確認します',
    ),
    section(ui, 'handoff-setup', '設定', [
      field(ui, 'handoff-dir', '置き場', getConfig().handoffDir),
      field(ui, 'handoff-premise', '前提', `初期文脈 ${short(freshCtx)}・基礎部分 ${short(baseCtx)}`),
    ]),
    inline(ui, 'handoff-actions', [ui.Button({ key: 'handoff-start', label: '引き継ぎ…', ...BUTTON.main, onPress: () => startHandoff($) })]),
  ]
  const h = d.handoff
  if (h) {
    const lines = [
      field(ui, 'out-state', '状態', handoffState(h)),
      field(ui, 'out-file', 'ファイル', h.file),
      field(ui, 'out-id', '目印', `[token-ledger handoff ${h.id}]`),
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
    default:
      return drawOverview($, ui, d)
  }
}

// ===== The band =====

function drawBand($, ui, s, handoff) {
  const { Box, Text, Button } = ui
  const toPane = Button({ key: 'band-details', label: '詳細', ...BUTTON.nav, onPress: () => openPane($, s.handoff ? 'handoff' : 'overview') })
  let text
  let buttons
  if (s.handoff === 'drafted') {
    text = '引き継ぎの下書きを入力欄に入れました。送るかどうかはあなたが決めます'
    buttons = [toPane, Button({ key: 'band-cancel', label: '取り消す', ...BUTTON.minor, onPress: () => cancelHandoff($) })]
  } else if (s.handoff === 'done') {
    text = `引き継ぎ済み · 新しいセッションの初回 ${short(handoff?.observed?.[0])}（予測 ${short(handoff?.predictedCtx)}）`
    buttons = [toPane]
  } else {
    const be = s.breakEven
    text = s.isExpired
      ? `キャッシュ切れ · 次の1回で再書込 ≈${short(be.rewrite)}* · 新規なら今が安い`
      : `次の1回 ≈${short(be.next)}* · 切れたら再書込 ≈${short(be.rewrite)}* · 新規なら ${be.runs} 回で回収`
    buttons = [toPane, Button({ key: 'band-handoff', label: '引き継ぎ…', ...BUTTON.main, onPress: () => startHandoff($) })]
  }
  const color = s.isExpired || s.isHeavy ? { color: COLOR.warn } : {}
  return Box({
    key: 'token-ledger-band',
    flexDirection: 'column',
    children: [
      Box({
        key: 'band-line',
        flexDirection: 'row',
        columnGap: SPACE.column,
        alignItems: 'center',
        flexWrap: 'wrap',
        children: [Text({ ...color, wrap: 'wrap', children: [text] }), ...buttons],
      }),
      s.handoff ? null : Text({ dimColor: true, children: [ESTIMATE_NOTE] }),
    ],
  })
}

export function registerPane(on) {
  on('ui.render', { component: 'Pane', requestId: 'token-ledger' }, async ($, e) => {
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
    const s = summarize(requests, await $.clock.now(), { isWorking: e.props.isWorking, handoff: handoff?.status })
    if (!s.show) return rest
    const ui = $.ui.resolve(e)
    const mine = drawBand($, ui, s, handoff)
    if (!rest) return mine
    return ui.Box({ flexDirection: 'column', children: [mine, rest] })
  })

  // A press on this mod's elements (the pane and the band). On the pane (press-guard.js) it
  // also checks that the press reached the Button's onPress; when the chain settled, threw, or
  // stayed silent for GRACE_MS without it, the press runs once with the latest drawing's
  // closure under the same key.
  on('ui.press', { plugin: 'token-ledger' }, async ($, e, next) => {
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
