// The export [書き出す] writes: the session's numbers as a Markdown summary and as one JSON
// line per request, for the main conversation to read only the part a question needs (the
// format is explained in the usage-ledger-data skill the plugin ships).
//
// Pure: no $ here; pane.js does the writing. Neither file carries conversation text: numbers,
// model ids, tool names, agent types and the Agent tool's short descriptions only.

import { aggregateThreads, TYPES, isoString, modelWeight, DEFAULT_WEIGHTS } from './aggregate.js'
import { MAX_REQUESTS, WEIGHTS_NOTE, ESTIMATE_NOTE, getConfig, summarize, toThreads, duration } from './ledger.js'

/** The skill that explains the files' format. */
export const SKILL = 'usage-ledger-data'

/** The .md's `##` sections, in order. */
export const SECTIONS = ['概要', 'スレッド', '種類とモデル', '高い要求', '主のツール', '待ちと再書込']

/** The .jsonl's fields, in the order each line writes them. */
export const JSONL_FIELDS = ['ts', 'thread', 'agentType', 'description', 'model', ...TYPES, 'context', 'weight', 'tools']

// ---- Names and paths

const isAbsolute = (p) => /^([A-Za-z]:)?[\\/]/.test(p)
const trimDir = (dir) => String(dir).trim().replace(/\\/g, '/').replace(/\/+$/, '')

/**
 * The pair's paths: `shown` is what the toast and the prompt line name (relative to the
 * project unless exportDir is absolute), `md`/`jsonl` what $.fs.write takes (under `root`, the
 * session's project root, when relative). The date is the local day counting started, so a
 * session keeps one pair across midnight.
 */
export function exportPaths({ dir, root, sessionId, startedAt, tzOffsetMinutes = 0 }) {
  const d = trimDir(dir || getConfig().exportDir) || '.'
  const day = isoString(startedAt + tzOffsetMinutes * 60000).slice(0, 10).replace(/-/g, '')
  const sid = String(sessionId ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || 'session'
  const name = `${day}-${sid}`
  const shownBase = d === '.' ? name : `${d}/${name}`
  const base = isAbsolute(d) || !root ? shownBase : `${String(root).replace(/[\\/]+$/, '')}/${shownBase}`
  return { name, shown: { md: shownBase + '.md', jsonl: shownBase + '.jsonl' }, md: base + '.md', jsonl: base + '.jsonl' }
}

/** The line [書き出す] adds to the prompt box. */
export const promptLine = (shownMd) => `usage-ledger の集計を ${shownMd} に書き出しました。`

// ---- Formatting

/** `2026-10-03T09:00:00.000+09:00`: local time with its offset, so a grep by hour is local. */
export function isoLocal(ms, tzOffsetMinutes = 0) {
  const sign = tzOffsetMinutes < 0 ? '-' : '+'
  const a = Math.abs(tzOffsetMinutes)
  const zone = `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
  return isoString(ms + tzOffsetMinutes * 60000).slice(0, 23) + zone
}

/** `2026-10-03 09:00`, local. */
const when = (ms, tz) => (Number.isFinite(ms) ? isoString(ms + tz * 60000).slice(0, 16).replace('T', ' ') : '—')
const int = (n) => (Number.isFinite(n) ? String(Math.round(n)) : '—')
const share = (part, whole) => (whole ? ((100 * part) / whole).toFixed(1) + '%' : '—')
// A table cell: one line, its pipes escaped
const esc = (v) => String(v ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
const row = (cells) => `| ${cells.map(esc).join(' | ')} |`
function table(head, rows) {
  const out = [row(head), row(head.map(() => '---'))]
  if (rows.length === 0) out.push(row(head.map((_, i) => (i === 0 ? '（なし）' : ''))))
  else for (const r of rows) out.push(row(r))
  return out
}

/** The weight of one request, as aggregate.js weighs it. */
export function weightOf(tok, model, W = DEFAULT_WEIGHTS) {
  return modelWeight(model, W) * TYPES.reduce((n, t) => n + W.type[t] * (tok?.[t] || 0), 0)
}

const contextOf = (t) => (t.input || 0) + (t.cache_read || 0) + (t.cache_write_5m || 0) + (t.cache_write_1h || 0)

// ---- The two files

/**
 * The .jsonl: one line per request, oldest first, the subagents' read-back requests as they
 * are in state. metas: $.state `threads`.
 */
export function exportJsonl(requests, metas, tzOffsetMinutes = 0) {
  const lines = [...(requests ?? [])]
    .sort((a, b) => a.ts - b.ts)
    .map((q) => {
      const isMain = q.thread === 'main'
      const meta = isMain ? {} : metas?.[q.thread] ?? {}
      const tok = Object.fromEntries(TYPES.map((t) => [t, q.tok?.[t] || 0]))
      return JSON.stringify({
        ts: isoLocal(q.ts, tzOffsetMinutes),
        thread: isMain ? 'main' : String(q.thread),
        agentType: isMain ? '(主)' : meta.agentType || '?',
        description: isMain ? '' : meta.description || '',
        model: q.model ?? '?',
        ...tok,
        context: contextOf(tok),
        weight: Math.round(weightOf(tok, q.model)),
        tools: Array.isArray(q.tools) ? q.tools.map(String) : [],
      })
    })
  return lines.length ? lines.join('\n') + '\n' : ''
}

/**
 * The .md summary. d: { requests, threads (metas), startedAt, now, tzOffsetMinutes, sessionId,
 * jsonlName (the .jsonl's file name, mentioned at the top) }
 */
export function exportMarkdown(d) {
  const tz = d.tzOffsetMinutes ?? 0
  const requests = d.requests ?? []
  const agg = aggregateThreads(toThreads(requests, d.threads), { tzOffsetMinutes: tz, top: 15 })
  const s = summarize(requests, d.now)
  const total = agg.total.weighted
  const keyOf = (t) => (t === 'main' ? 'main' : String(t))
  const out = []

  out.push('# usage-ledger の集計', '')
  out.push(`この形式の説明は、スキル ${SKILL} にあります。`, '')
  out.push(`- 書き出し: ${when(d.now, tz)}（${isoLocal(d.now, tz).slice(23)}）`)
  out.push(`- 集計範囲: 集計開始 ${when(d.startedAt, tz)} から書き出しまで。集計開始は usage-ledger が読み込まれた時刻で、それより前の主スレッドの要求は含まない`)
  if (requests.length >= MAX_REQUESTS) out.push(`- 要求は新しい ${MAX_REQUESTS} 件だけを残している（古いものは捨てた）`)
  out.push(`- セッション: ${d.sessionId ?? '—'}`)
  if (d.jsonlName) out.push(`- 要求ごとの記録: ${d.jsonlName}（1 行 1 要求）`)
  out.push(`- 目次: ${SECTIONS.join(' / ')}`)
  out.push(`- 重み: ${WEIGHTS_NOTE}。サブスクの計算式は非公開なので、あくまで推計`)
  out.push('- 数字: トークン数と重みは丸めない整数、割合は重みの割合、時刻は書き出した PC のローカル時刻', '')

  // ----- 概要
  out.push('## 概要', '', '### 今の文脈', '')
  const now = []
  if (s.context == null) {
    now.push(['主の文脈', 'まだ主スレッドの要求がない'])
  } else {
    const be = s.breakEven
    now.push(['主の文脈', `${s.context}（${s.model}）`])
    now.push(['キャッシュ', s.isExpired ? `切れた（${duration(d.now - s.expiresAt)} 前）` : `残り ${duration(s.remainingMs)}（${getConfig().ttlMain} で計算）`])
    now.push(['次の1回の重み', int(be.next)])
    now.push(['切れたら再書込の重み', int(be.rewrite)])
    now.push([
      '新しいセッション',
      be.applies ? (be.runs === 0 ? 'キャッシュが切れたので、今なら新しいセッションのほうが安い' : `${be.runs} 回の要求で回収できる`) : '今の文脈が新しいセッションの初期文脈より小さく、引き継ぐ得はない',
    ])
  }
  out.push(...table(['項目', '値'], now), '')

  const main = agg.threads.find((t) => t.key === 'main') ?? { requests: 0, weighted: 0 }
  const tax = agg.gapTax.expired
  out.push('### 合計', '')
  out.push(
    ...table(
      ['項目', '値'],
      [
        ['要求', `${agg.total.requests}（主 ${main.requests}・サブ ${agg.total.requests - main.requests}）`],
        ['重み計', `${int(total)}（主 ${share(main.weighted, total)}・サブ ${share(total - main.weighted, total)}）`],
        ['キャッシュ読みの割合', share(agg.total.cacheHitRatio, 1)],
        ['期限切れ後の再書込', `${tax.requests} 回・重み ${int(tax.weighted)}（全体の ${share(tax.weighted, total)}）`],
      ],
    ),
    '',
  )
  out.push('### トークンの種類別', '')
  out.push(...table(['種類', 'トークン', '重み', '割合'], agg.byType.map((r) => [r.type, r.tokens, int(r.weighted), share(r.weighted, total)])), '')

  // ----- スレッド
  out.push('## スレッド', '', '重みの大きい順。スレッドは main か、サブエージェントの agentId。', '')
  out.push(
    ...table(
      ['スレッド', '種類', '説明', 'モデル', '要求', ...TYPES, '重み', '割合'],
      agg.threads.map((t) => [keyOf(t.key), t.agentType, t.description, t.models.join(', ') || '—', t.requests, ...TYPES.map((k) => t.tok[k]), int(t.weighted), share(t.weighted, total)]),
    ),
    '',
  )

  // ----- 種類とモデル
  out.push('## 種類とモデル', '', '### エージェントの種類別', '')
  out.push(
    ...table(
      ['種類', '回', '要求', ...TYPES, '重み', '割合'],
      agg.byAgentType.map((r) => [r.key, r.runs, r.requests, ...TYPES.map((k) => r.tok[k]), int(r.weighted), share(r.weighted, total)]),
    ),
    '',
  )
  out.push('### モデル別', '')
  out.push(
    ...table(
      ['モデル', '要求', ...TYPES, '重み', '割合'],
      agg.byModel.map((r) => [r.key, r.requests, ...TYPES.map((k) => r.tok[k]), int(r.weighted), share(r.weighted, total)]),
    ),
    '',
  )

  // ----- 高い要求
  out.push('## 高い要求', '', `重みの大きい要求（全スレッド、上位 ${agg.biggest.length}）。文脈は入力とキャッシュの読み書きの合計、書込はキャッシュ書き込み。`, '')
  out.push(
    ...table(
      ['時刻', 'スレッド', 'モデル', '文脈', '書込', '出力', '重み', 'ツール'],
      agg.biggest.map((q) => [when(q.ts, tz), keyOf(q.thread), q.model, q.context, q.write, q.output, int(q.weighted), q.tools.join(', ') || '（文字だけ）']),
    ),
    '',
  )

  // ----- 主のツール
  out.push('## 主のツール', '', '主スレッドの要求を、その応答が呼んだツールで分けたもの。text は文字だけの応答、複数は + でつなぐ。', '')
  out.push(...table(['ツール', '要求', '重み', '主の中'], agg.main.byTool.map((r) => [r.key, r.requests, int(r.weighted), share(r.weighted, agg.main.weighted)])), '')

  // ----- 待ちと再書込
  const gt = agg.gapTax
  out.push('## 待ちと再書込', '', '同じスレッドで直前の要求から 5 分を超えて空いた要求。TTL は直前の要求の書き込みで判断（ライブで数えた分の 5m / 1h は設定による推定）。状態 expired はキャッシュが切れた後、within は期限内。', '')
  out.push(
    ...table(
      ['状態', '要求', '書込', '重み', '割合'],
      [
        ['expired', gt.expired.requests, gt.expired.write, int(gt.expired.weighted), share(gt.expired.weighted, total)],
        ['within', gt.within.requests, gt.within.write, int(gt.within.weighted), share(gt.within.weighted, total)],
      ],
    ),
    '',
  )
  out.push(
    ...table(
      ['時刻', 'スレッド', '待ち秒', 'TTL', '状態', '書込', '重み'],
      agg.gaps.map((g) => [when(g.ts, tz), keyOf(g.thread), Math.round(g.gapSeconds), g.ttlSeconds === 3600 ? '1h' : '5m', g.state, g.write, int(g.weighted)]),
    ),
    '',
  )
  out.push(ESTIMATE_NOTE.replace(/^\*/, ''), '')
  return out.join('\n')
}
