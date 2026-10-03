// The pane /ui-sampler opens. One pane whose view ($.state `view`, session only) switches what
// it draws, since a second pane opened from a button may not come to the front:
//   'toc'          the table of contents: where it is drawn, one row per CATEGORIES entry
//   a category id  that category's sites as a table, one row apiece (label, on/off switch,
//                  call count, [詳細], the API's button), an API's last result under its row, and
//                  below the list one detail card for the site picked with [詳細]: where it shows,
//                  the choice of what [PromptHint], [Spinner] and [CommandOutput] write, the
//                  call count by surface, the props a render site last received, the last result
//   'samples'      the element samples, drawn by elements.js's hook, which wraps this one
// /ui-sampler sets the view back to 'toc' (register.js), the way back from a view that does
// not draw. Spacing, columns, colors and button roles come from style.js.

import {
  DIALOG_OPEN,
  CATEGORIES,
  SITES,
  KIND_LABEL,
  toggleValue,
  noteCall,
  callSummary,
  callCount,
  lastProps,
  formatValue,
  noteResult,
  resultOf,
} from './sites.js'
import {
  SPACE,
  WIDTH,
  BUTTON,
  choice,
  dim,
  inline,
  cell,
  fill,
  tableRow,
  field,
  header,
  section,
  card,
  page,
  stateMark,
  table,
} from './style.js'
import { noteDiag, notePaneRender, diagLines, clearDiag } from './diag.js'
import { GRACE_MS, guardDrawing, beginPress, hasStarted, takeOver, endPress } from './press-guard.js'
import { atom, read, update } from 'claude-code'

// The state this file reads and writes (declared in types/index.d.ts): the pane's view, one
// switch per site id, the site each category view details (by category id), which prop
// [PromptHint], [Spinner] and [CommandOutput] write, and [DialogPane]'s echo lines (which entry
// opened it)
const view = atom({ plugin: 'ui-sampler', key: 'view' }, 'toc')
const TOGGLES = { plugin: 'ui-sampler', key: 'toggles' }
const SELECTED = { plugin: 'ui-sampler', key: 'selected' }
const ECHO = { plugin: 'ui-sampler', key: 'echo' }
const promptHintMode = atom({ plugin: 'ui-sampler', key: 'promptHintMode' }, 'hint')
const spinnerMode = atom({ plugin: 'ui-sampler', key: 'spinnerMode' }, 'word')
const commandOutputMode = atom({ plugin: 'ui-sampler', key: 'commandOutputMode' }, 'tree')

/** The ways a site can be drawn, by site id: each choice's stored value and its button text. */
const MODE_CHOICES = {
  PromptHint: [
    { value: 'hint', label: 'hint（行ごと置き換える）' },
    { value: 'tail', label: 'tail（後ろに足す）' },
  ],
  Spinner: [
    { value: 'word', label: 'word を書き換え' },
    { value: 'message', label: 'message を書き換え' },
    { value: 'suffix', label: 'suffix を書き換え' },
    { value: 'tree', label: '自前のツリー（props を並べる）' },
    { value: 'props', label: 'word に props を並べる' },
  ],
  CommandOutput: [
    { value: 'tree', label: '自前のツリー' },
    { value: 'text', label: 'text を書き換え' },
  ],
}

/** The one-shot APIs: the text of each one's button, by site id. runAction does the call. */
const ACTION_BUTTONS = {
  DialogPane: 'ダイアログ風に開く',
  '$.ui.status': 'ステータス行を書き換える',
  '$.ui.status/clear': 'ステータス行を消す',
  '$.ui.toast': 'トーストを出す',
  '$.ui.toast/timeoutMs': '10 秒のトーストを出す',
  '$.ui.log': 'ログ行を出す',
  '$.ui.log/debug': 'デバッグログに書く',
  '$.ui.ask': '質問する',
  '$.ui.copy': 'コピーする',
  '$.ui.panes': '一覧を取る',
  '$.ui.scroll': 'いちばん上へ',
  '$.ui.focus': 'フォーカスを移す',
  '$.session.append': 'system 行を足す',
}

// A module variable is enough for this: a reload starting it over does no harm
let statusPresses = 0

// Element keys allow a plain set of characters; site ids carry '$', '.' and '/'
const keyOf = (prefix, id) => prefix + '-' + id.replace(/[^A-Za-z0-9_-]/g, '_')

// One function rather than a table of closures: the engine follows $ only into functions
// declared in this file, called by name. `press` is the button's ui.press event.
async function runAction($, id, press) {
  switch (id) {
    // ===== [DialogPane] $.ui.open({ id: 'ui-sampler-dialog', focus, closeOnEscape, holdToasts, rows }) =====
    // One of three entry points (also the band's button and /ui-sampler-dialog), all with
    // DIALOG_OPEN. The opener is written before the open so the pane's first drawing shows it.
    case 'DialogPane': {
      await update($, { ...ECHO, id: 'DialogPane:openedBy' }, () => `「ダイアログ」の一覧のボタン（ui.press、surface: ${press.surface}）`)
      const opened = await $.ui.open(DIALOG_OPEN)
      const result = opened.isPlaced ? 'isPlaced: true' : `isPlaced: false、reason: ${opened.reason}`
      await update($, { ...ECHO, id: 'DialogPane:openResult' }, () => result)
      return opened.isPlaced ? '開いた' : '開いたがまだ表示されていない: ' + opened.reason
    }

    // ===== [$.ui.status] $.ui.status(text) =====
    case '$.ui.status': {
      statusPresses += 1
      $.ui.status(`[$.ui.status] ボタンが ${statusPresses} 回押されました`)
      return `ステータス行を「ボタンが ${statusPresses} 回押されました」にした`
    }

    // ===== [$.ui.status/clear] $.ui.status(undefined) =====
    case '$.ui.status/clear': {
      $.ui.status(undefined)
      return '消した'
    }

    // ===== [$.ui.toast] $.ui.toast(text) =====
    case '$.ui.toast': {
      $.ui.toast('[$.ui.toast] トーストです（既定の 4 秒で消えます）')
      return '出した'
    }

    // ===== [$.ui.toast/timeoutMs] $.ui.toast(text, { timeoutMs: 10000 }) =====
    case '$.ui.toast/timeoutMs': {
      $.ui.toast('[$.ui.toast/timeoutMs] 10 秒出るトーストです', { timeoutMs: 10000 })
      return '出した（timeoutMs: 10000）'
    }

    // ===== [$.ui.log] $.ui.log(text) =====
    case '$.ui.log': {
      $.ui.log('[$.ui.log] 会話欄に出る薄い 1 行です')
      return '出した'
    }

    // ===== [$.ui.log/debug] $.ui.log(text, { to: 'debug' }) =====
    case '$.ui.log/debug': {
      $.ui.log('[$.ui.log/debug] デバッグログにだけ書いた行です', { to: 'debug' })
      return "書いた（to: 'debug'）"
    }

    // ===== [$.ui.ask] $.ui.ask(question, options) =====
    case '$.ui.ask': {
      try {
        return '答え: ' + (await $.ui.ask('[$.ui.ask] どの色が好きですか？', ['赤', '青', '緑']))
      } catch {
        return '閉じられた（答えなし）'
      }
    }

    // ===== [$.ui.copy] $.ui.copy({ text, surface }) =====
    case '$.ui.copy': {
      const copied = await $.ui.copy({ text: '[$.ui.copy] コピーした文字です', surface: press.surface })
      return copied.isCopied
        ? `isCopied: true（surface: ${press.surface}）。どこかに貼り付けて確かめる`
        : `isCopied: false、reason: ${copied.reason}（surface: ${press.surface}）`
    }

    // ===== [$.ui.panes] $.ui.panes() =====
    case '$.ui.panes': {
      const panes = await $.ui.panes()
      if (panes.length === 0) return '開いているパネルはない'
      return panes
        .map(
          pane =>
            `${pane.id}「${pane.title}」isShown: ${pane.isShown}, isFocused: ${pane.isFocused}, isPlaced: ${pane.isPlaced}`,
        )
        .join(' / ')
    }

    // ===== [$.ui.scroll] $.ui.scroll({ in: 'ui-sampler', to: 'start' }) =====
    case '$.ui.scroll': {
      const scrolled = await $.ui.scroll({ in: 'ui-sampler', to: 'start' })
      return scrolled.deny ? '動かなかった: ' + scrolled.deny : '動いた（いちばん上へ）'
    }

    // ===== [$.ui.focus] $.ui.focus({ requestId: 'ui-sampler', key: 'refresh' }) =====
    case '$.ui.focus': {
      const focused = await $.ui.focus({ requestId: 'ui-sampler', key: 'refresh' })
      return focused.deny ? '動かなかった: ' + focused.deny : '動いた（「回数を更新」ボタンへ）'
    }

    // ===== [$.session.append] $.session.append({ message: { type: 'system' } }) =====
    case '$.session.append': {
      try {
        const result = await $.session.append({
          message: { type: 'system', content: [{ type: 'text', text: '[$.session.append] system 通知行です' }] },
        })
        return result?.deny ? '拒否: ' + result.deny : '成功: ' + JSON.stringify(result)
      } catch (error) {
        return 'エラー: ' + String(error?.message ?? error)
      }
    }

    default:
      return '未対応: ' + id
  }
}

// Counts the call, and redraws once when a site or surface is new
function noteRender($, id, e) {
  if (!noteCall(id, e.surface)) return
  noteDiag('invalidate', `${id} の初回描画（新しい surface）`)
  $.ui.invalidate('ui.render')
}

// Switches the pane's view from a press handler (never while drawing), and brings the new
// view's top into sight
async function go($, next) {
  await update($, view, () => next)
  await $.ui.scroll({ in: 'ui-sampler', to: 'start' })
}

// Reading the switch while drawing subscribes the pane, so a toggle redraws it
async function isOn($, id) {
  return toggleValue(id, await read($, { ...TOGGLES, id }))
}

// Flips a switch from a press handler (never while drawing)
function toggle($, id) {
  return update($, { ...TOGGLES, id }, value => !toggleValue(id, value))
}

// The site a category view details; reading it while drawing subscribes the pane
async function selectedOf($, categoryId) {
  return read($, { ...SELECTED, id: categoryId })
}

// Picks the site to detail, or clears the pick when it is pressed again (never while drawing)
function select($, categoryId, siteId) {
  return update($, { ...SELECTED, id: categoryId }, value => (value === siteId ? undefined : siteId))
}

// Reads the current choice of a site in MODE_CHOICES while drawing (subscribes the pane)
async function modeOf($, id) {
  switch (id) {
    case 'PromptHint':
      return read($, promptHintMode)
    case 'Spinner':
      return read($, spinnerMode)
    case 'CommandOutput':
      return read($, commandOutputMode)
    default:
      return undefined
  }
}

// Stores a choice from a press handler (never while drawing)
function setMode($, id, value) {
  switch (id) {
    case 'PromptHint':
      return update($, promptHintMode, () => value)
    case 'Spinner':
      return update($, spinnerMode, () => value)
    case 'CommandOutput':
      return update($, commandOutputMode, () => value)
    default:
      return undefined
  }
}

/**
 * The props a render site last received, each against its note: `meta` says when and where
 * they came, `entries` one `{ name, value, note }` per prop, `note` the site's line under them.
 */
function propsEntries(site) {
  const seen = lastProps(site.id)
  if (!seen) return { meta: 'まだ呼ばれていない', entries: [], note: undefined }
  const names = [...new Set([...Object.keys(site.props), ...Object.keys(seen.props)])]
  return {
    meta: `最後の 1 回、e.surface: ${seen.surface}`,
    entries: names.map(name => ({
      name,
      value: formatValue(seen.props[name]),
      note: site.props[name] ?? '型定義に説明のない項目',
    })),
    note: site.propsNote,
  }
}

// ===== [Pane] view 'toc': the table of contents =====
// `guard` (press-guard.js) keeps this drawing's Button closures for [press/再実行]
async function drawContents($, e, guard) {
  const ui = guard.wrap($.ui.resolve(e))
  const { Text, Button } = ui

  // Where this drawing is
  const surfaces = await $.session.surfaces()
  const viewport = e.viewport
    ? `${e.viewport.columns} 桁 × ${e.viewport.rows} 行（isFullscreen: ${e.viewport.isFullscreen ?? '不明'}）`
    : 'なし（まだ測られていない）'

  // One row per category: name, count, [開く], then the description, which wraps in its column
  const rows = CATEGORIES.map(category => {
    const count = SITES.filter(site => site.category === category.id).length
    return tableRow(
      ui,
      'category-' + category.id,
      [
        cell(ui, WIDTH.category, [Text({ bold: true, children: [category.label] })]),
        cell(ui, WIDTH.count, [Text({ dimColor: true, children: [category.isPending ? '' : `${count} 件`] })]),
        cell(ui, WIDTH.detail, [
          category.isPending
            ? Text({ dimColor: true, children: ['未実装'] })
            : Button({ key: 'open-' + category.id, label: '開く', ...BUTTON.nav, onPress: () => go($, category.id) }),
        ]),
        fill(ui, [Text({ dimColor: true, wrap: 'wrap', children: [category.about] })], 'column'),
      ],
      'flex-start',
    )
  })

  return page(ui, [
    header(ui, {
      title: '[Pane] UI 見本市の目次',
      about: '分類を開くと、その分類で描ける場所と呼べる API が 1 行ずつ並ぶ',
      nav: [
        Button({ key: 'close', label: '閉じる', role: 'dismiss', ...BUTTON.nav, onPress: () => $.ui.close({ id: 'ui-sampler' }) }),
      ],
    }),
    section(ui, 'categories', '分類', rows, SPACE.item),
    section(ui, 'where', 'この描画の場所', [
      field(ui, 'where-surface', 'e.surface', e.surface),
      field(ui, 'where-surfaces', '$.session.surfaces()', surfaces.length > 0 ? surfaces.join(', ') : 'なし'),
      field(ui, 'where-viewport', 'e.viewport', viewport),
      field(ui, 'where-placement', 'placement', `${e.props.placement}（本体 ${e.props.bodyColumns} 桁）`),
    ]),
  ])
}

// ===== [Pane] view <category id>: one category's sites and the [詳細] of one =====
async function drawCategory($, e, category, guard) {
  const sites = SITES.filter(site => site.category === category.id)
  const ui = guard.wrap($.ui.resolve(e))
  const { Box, Text, Button } = ui
  const redraw = () => {
    noteDiag('invalidate', 'パネルのボタンから')
    $.ui.invalidate('ui.render')
  }
  const dash = () => Text({ dimColor: true, children: ['—'] })

  // ----- The list: one row per site, columns label · state · count · [詳細] · action -----
  // The action column is there only when some site of the list has a button to run. Each
  // site's row and its last result are one table entry, so the gap falls between sites.
  // Reading each switch and the pick here subscribes the pane, so a press redraws it
  const picked = await selectedOf($, category.id)
  const hasActions = sites.some(site => ACTION_BUTTONS[site.id])
  const headCells = [
    cell(ui, WIDTH.label, [Text({ dimColor: true, children: ['項目'] })]),
    cell(ui, WIDTH.state, [Text({ dimColor: true, children: ['状態'] })]),
    cell(ui, WIDTH.count, [Text({ dimColor: true, children: ['回数'] })]),
    cell(ui, WIDTH.detail, []),
  ]
  if (hasActions) headCells.push(fill(ui, [Text({ dimColor: true, children: ['操作'] })]))
  const entries = [tableRow(ui, 'list-head', headCells)]
  for (const site of sites) {
    let state = dash()
    if (site.toggleable) {
      const isSiteOn = await isOn($, site.id)
      state = inline(
        ui,
        keyOf('state', site.id),
        [
          stateMark(ui, isSiteOn),
          Button({
            key: keyOf('toggle', site.id),
            label: isSiteOn ? 'オン' : 'オフ',
            ...(isSiteOn ? BUTTON.nav : BUTTON.minor),
            onPress: () => toggle($, site.id),
          }),
        ],
        0,
        SPACE.mark,
      )
    }
    const cells = [
      cell(ui, WIDTH.label, [Text({ children: [site.label] })]),
      cell(ui, WIDTH.state, [state]),
      cell(ui, WIDTH.count, [Text({ dimColor: true, children: [callCount(site.id)] })]),
      cell(ui, WIDTH.detail, [
        Button({
          key: keyOf('detail', site.id),
          label: '詳細',
          ...choice(picked === site.id),
          onPress: () => select($, category.id, site.id),
        }),
      ]),
    ]
    const actionLabel = ACTION_BUTTONS[site.id]
    if (hasActions) {
      cells.push(
        fill(ui, [
          actionLabel
            ? Button({
                key: keyOf('run', site.id),
                label: actionLabel,
                onPress: async press => {
                  // A render site's count is its drawings, not the presses that open it
                  if (site.kind === 'api') noteCall(site.id, press.surface)
                  noteResult(site.id, await runAction($, site.id, press))
                  redraw()
                },
              })
            : null,
        ]),
      )
    }
    const result = resultOf(site.id)
    entries.push(
      Box({
        key: keyOf('entry', site.id),
        flexDirection: 'column',
        width: '100%',
        children: [
          tableRow(ui, keyOf('line', site.id), cells),
          result !== undefined
            ? Box({
                key: keyOf('result', site.id),
                paddingLeft: SPACE.indent,
                children: [Text({ dimColor: true, wrap: 'truncate-end', children: ['結果: ' + result] })],
              })
            : null,
        ],
      }),
    )
  }

  // ----- [詳細] The picked site's detail card -----
  const site = sites.find(one => one.id === picked)
  let detail = dim(ui, 'detail-none', '[詳細] を押すと、その項目の場所・受け取った値・結果がここに出る')
  if (site) {
    const fields = [field(ui, 'detail-where', '場所', site.where, WIDTH.prop)]
    const choices = MODE_CHOICES[site.id]
    if (choices) {
      const current = await modeOf($, site.id)
      fields.push(
        field(
          ui,
          'detail-modes',
          '書き方',
          choices.map(one =>
            Button({
              key: keyOf('mode-' + one.value, site.id),
              label: one.label,
              ...choice(one.value === current),
              onPress: () => setMode($, site.id, one.value),
            }),
          ),
          WIDTH.prop,
        ),
      )
    }
    fields.push(field(ui, 'detail-calls', '呼び出し', callSummary(site.id), WIDTH.prop))
    const result = resultOf(site.id)
    if (result !== undefined) fields.push(field(ui, 'detail-result', '結果', result, WIDTH.prop))

    const blocks = [
      inline(ui, 'detail-heading', [
        Text({ bold: true, children: [`${site.label} の詳細`] }),
        Text({ dimColor: true, children: [KIND_LABEL[site.kind]] }),
      ]),
      Box({ key: 'detail-fields', flexDirection: 'column', rowGap: SPACE.row, width: '100%', children: fields }),
    ]
    if (site.props) {
      const props = propsEntries(site)
      blocks.push(
        Box({
          key: 'detail-props',
          flexDirection: 'column',
          rowGap: SPACE.row,
          width: '100%',
          children: [
            inline(ui, 'detail-props-heading', [
              Text({ bold: true, children: ['受け取った props'] }),
              Text({ dimColor: true, children: [props.meta] }),
            ]),
            ...props.entries.map(entry =>
              tableRow(
                ui,
                keyOf('prop', entry.name),
                [
                  cell(ui, WIDTH.prop, [Text({ dimColor: true, children: [entry.name] })]),
                  fill(
                    ui,
                    [
                      Text({ wrap: 'wrap', children: [entry.value] }),
                      Text({ dimColor: true, wrap: 'wrap', children: [entry.note] }),
                    ],
                    'column',
                  ),
                ],
                'flex-start',
              ),
            ),
            props.note ? dim(ui, 'detail-props-note', props.note) : null,
          ],
        }),
      )
    }
    detail = card(ui, 'detail', blocks)
  }

  // The elements category also leads to the samples view; a sample the surface refuses blanks
  // that view only, and /ui-sampler brings back the contents
  const nav = [
    Button({ key: 'contents', label: '目次へ', ...BUTTON.nav, onPress: () => go($, 'toc') }),
    Button({ key: 'refresh', label: '回数を更新', ...BUTTON.nav, onPress: redraw }),
  ]
  if (category.id === 'elements') {
    nav.push(Button({ key: 'samples', label: '見本を見る', ...BUTTON.main, onPress: () => go($, 'samples') }))
  }

  return page(ui, [
    header(ui, {
      title: '[Pane] ' + category.label,
      about: category.about,
      nav,
      note:
        category.id === 'elements'
          ? '見本でパネルが真っ白になったら、/ui-sampler で目次に戻り、ここで [Pane/…] を 1 つずつオフにすると、どれが断られているか分かる'
          : undefined,
    }),
    section(ui, 'list', '一覧', [table(ui, 'list-table', entries)]),
    section(ui, 'detail-section', '詳細', [detail]),
    category.id === 'api' ? diagSection(ui, redraw) : null,
  ])
}

// ===== [診断/press] the press, focus and redraw log (diag.js), in the API view =====
// What arrived around a press: ui.press and ui.focus as this mod's hooks saw them, each
// drawing of this pane with e.props.isFocused, and each $.ui.invalidate this mod made. As of
// this drawing; [記録を更新] draws it again.
function diagSection(ui, redraw) {
  const { Button } = ui
  const lines = diagLines()
  return section(ui, 'diag', '[診断/press] 押下・フォーカス・再描画の記録（新しい順）', [
    dim(
      ui,
      'diag-about',
      'press は ui.press フックに届いた押下と next(e) の結果、[press/再実行] は onPress まで届かなかった押下をこの mod が最新の描画で実行し直したこと、focus は ui.focus フック、render はこのパネルの描画、invalidate はこの mod が頼んだ再描画。表示はこの描画の時点のもので、[記録を更新] で最新になる',
    ),
    inline(ui, 'diag-nav', [
      Button({ key: 'diag-refresh', label: '記録を更新', ...BUTTON.nav, onPress: redraw }),
      Button({
        key: 'diag-clear',
        label: '記録を消す',
        ...BUTTON.minor,
        onPress: () => {
          clearDiag()
          redraw()
        },
      }),
    ]),
    lines.length > 0
      ? ui.Box({
          key: 'diag-lines',
          flexDirection: 'column',
          width: '100%',
          children: lines.map((line, index) => ui.Text({ key: 'diag-line-' + index, wrap: 'wrap', children: [line] })),
        })
      : dim(ui, 'diag-empty', 'まだ何も記録されていない'),
  ])
}

// What next(e) settled to, as one diag phrase: the value as JSON, or the error's text
function describeOutcome(outcome) {
  if (outcome.kind === 'error') return '例外: ' + errorText(outcome.error)
  return '値: ' + (outcome.value === undefined ? 'undefined' : JSON.stringify(outcome.value))
}

function errorText(error) {
  return String(error?.message ?? error)
}

export function registerPane(on) {
  // ===== [Pane] ui.render { component: 'Pane', requestId: 'ui-sampler' } =====
  // The matcher is PANE's value as a literal, so `plugin validate` can list it. The view
  // 'samples' is answered by elements.js's hook on the same matcher, registered before this
  // one so it is the outer link; it passes every other view on to here.
  on('ui.render', { component: 'Pane', requestId: 'ui-sampler' }, async ($, e) => {
    notePaneRender(e)
    noteRender($, 'Pane', e)
    const current = await read($, view)
    const category = CATEGORIES.find(one => one.id === current && !one.isPending)
    const guard = guardDrawing(e.requestId)
    return guard.done(category ? await drawCategory($, e, category, guard) : await drawContents($, e, guard))
  })

  // ===== [診断/press] [press/再実行] ui.press { plugin: 'ui-sampler' } =====
  // Watches every press on this mod's elements (both panes and the band), noting what next(e)
  // resolved to or threw. On a guarded pane (press-guard.js) it also checks that the press
  // reached the Button's onPress, judged by the wrapper around that onPress rather than by
  // next(e)'s answer, which says only what the chain settled on. When the chain settled, threw,
  // or stayed silent for GRACE_MS without the onPress having started, the press is run once
  // with the closure the latest drawing holds under the same key.
  on('ui.press', { plugin: 'ui-sampler' }, async ($, e, next) => {
    noteDiag('press', `${e.element}（${e.component} ${e.requestId}、surface: ${e.surface}）`)
    const record = beginPress(e)
    const chain = next(e).then(
      value => ({ kind: 'value', value }),
      error => ({ kind: 'error', error }),
    )

    // The grace: a sleep that ends early once the chain settles. A sleep the host refuses
    // never ends the wait, so the chain alone decides.
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

    if (outcome.kind === 'grace') {
      noteDiag('press', `${e.element} の next(e) が ${GRACE_MS}ms 返らず、onPress も始まっていない`)
      chain.then(late => noteDiag('press', `${e.element} の next(e) が後から ${describeOutcome(late)}`))
    } else {
      const reached = record ? (hasStarted(record) ? '、onPress まで届いた' : '、onPress は呼ばれていない') : ''
      noteDiag('press', `${e.element} の next(e) → ${describeOutcome(outcome)}${reached}`)
    }

    if (!record || hasStarted(record)) {
      if (record) endPress(e, record)
      if (outcome.kind === 'error') throw outcome.error
      return outcome.value
    }
    const why = outcome.kind === 'grace' ? 'onPress が始まらない' : 'onPress まで届かなかった'
    try {
      await takeOver(record, e, why)
    } catch (error) {
      noteDiag('[press/再実行]', `${e.element} の再実行で例外: ${errorText(error)}`)
    }
    return { element: e.element }
  })

  // ===== [診断/press] ui.focus { component: 'Pane' } =====
  // Watches every move of a pane's focus ring (a click, Tab, autoFocus, $.ui.focus) and lets
  // it through unchanged, noting whether it landed
  on('ui.focus', { component: 'Pane' }, async ($, e, next) => {
    const origin = e.origin.kind === 'plugin' ? `plugin ${e.origin.name}` : e.origin.kind
    const target = e.element ?? '（エンジンの停止位置）'
    const result = await next(e)
    const outcome = result?.deny ? `deny: ${result.deny}` : '移った'
    noteDiag('focus', `${e.requestId} → ${target}（origin: ${origin}）${outcome}`)
    return result
  })
}
