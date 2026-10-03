// The pane /ui-sampler opens. One pane whose view ($.state `view`, session only) switches what
// it draws, since a second pane opened from a button may not come to the front:
//   'toc'          the table of contents: where it is drawn, one row per CATEGORIES entry
//   a category id  that category's sites, one line apiece (label, on/off switch, call count,
//                  the API's button, [詳細]), an API's last result under its line, and below
//                  the list one detail block for the site picked with [詳細]: where it shows,
//                  the choice of what [PromptHint], [Spinner] and [CommandOutput] write, the
//                  call count by surface, the props a render site last received, the last result
//   'samples'      the element samples, drawn by elements.js's hook, which wraps this one
// /ui-sampler sets the view back to 'toc' (register.js), the way back from a view that does
// not draw.

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
  if (noteCall(id, e.surface)) $.ui.invalidate('ui.render')
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

/** The detail lines for the props a render site last received, each against its note. */
function propsLines(site) {
  const seen = lastProps(site.id)
  if (!seen) return ['受け取った props: まだ呼ばれていない']
  const names = [...new Set([...Object.keys(site.props), ...Object.keys(seen.props)])]
  const lines = [`受け取った props（最後の 1 回、e.surface: ${seen.surface}）:`]
  for (const name of names) {
    const note = site.props[name] ?? '型定義に説明のない項目'
    lines.push(`・${name} = ${formatValue(seen.props[name])} … ${note}`)
  }
  if (site.propsNote) lines.push(site.propsNote)
  return lines
}

// ===== [Pane] view 'toc': the table of contents =====
async function drawContents($, e) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const dim = (key, text) => Text({ key, dimColor: true, wrap: 'wrap', children: [text] })
  const row = (key, children) =>
    Box({ key, flexDirection: 'row', columnGap: 1, alignItems: 'center', flexWrap: 'wrap', children })

  // Where this drawing is, in two lines
  const surfaces = await $.session.surfaces()
  const viewport = e.viewport
    ? `${e.viewport.columns} 桁 × ${e.viewport.rows} 行（isFullscreen: ${e.viewport.isFullscreen ?? '不明'}）`
    : 'なし（まだ測られていない）'

  // One row per category: name, count, [開く], then the description (which wraps)
  const rows = CATEGORIES.map(category => {
    const count = SITES.filter(site => site.category === category.id).length
    return row('category-' + category.id, [
      Text({ bold: true, children: [category.label] }),
      Text({ dimColor: true, children: [category.isPending ? '未実装' : `${count} 件`] }),
      category.isPending ? null : Button({ key: 'open-' + category.id, label: '開く', onPress: () => go($, category.id) }),
      Text({ dimColor: true, wrap: 'wrap', children: [category.about] }),
    ])
  })

  return Box({
    flexDirection: 'column',
    rowGap: 1,
    width: '100%',
    children: [
      Text({ bold: true, children: ['[Pane] UI 見本市の目次'] }),
      Box({
        key: 'header',
        flexDirection: 'column',
        width: '100%',
        children: [
          dim('where-surface', `e.surface: ${e.surface} ／ $.session.surfaces(): ${surfaces.length > 0 ? surfaces.join(', ') : 'なし'}`),
          dim('where-size', `e.viewport: ${viewport} ／ placement: ${e.props.placement}（本体 ${e.props.bodyColumns} 桁）`),
        ],
      }),
      Box({ key: 'categories', flexDirection: 'column', rowGap: 1, width: '100%', children: rows }),
      Button({ key: 'close', label: '閉じる', role: 'dismiss', onPress: () => $.ui.close({ id: 'ui-sampler' }) }),
    ],
  })
}

// ===== [Pane] view <category id>: one category's sites and the [詳細] of one =====
async function drawCategory($, e, category) {
  const sites = SITES.filter(site => site.category === category.id)
  const { Box, Text, Button } = $.ui.resolve(e)
  const redraw = () => $.ui.invalidate('ui.render')
  // Explanations wrap at the pane's edge rather than run past it
  const dim = (key, text) => Text({ key, dimColor: true, wrap: 'wrap', children: [text] })
  const row = (key, children) =>
    Box({ key, flexDirection: 'row', columnGap: 1, alignItems: 'center', flexWrap: 'wrap', children })

  // ----- The list: one line per site, and an API's last result under its line -----
  // Reading each switch and the pick here subscribes the pane, so a press redraws it
  const picked = await selectedOf($, category.id)
  const lines = []
  for (const site of sites) {
    const controls = [Text({ bold: true, children: [site.label] })]
    if (site.toggleable) {
      const isSiteOn = await isOn($, site.id)
      controls.push(
        Button({
          key: keyOf('toggle', site.id),
          label: isSiteOn ? 'オン' : 'オフ',
          variant: isSiteOn ? 'primary' : 'secondary',
          onPress: () => toggle($, site.id),
        }),
      )
    }
    controls.push(Text({ dimColor: true, children: [callCount(site.id)] }))
    const actionLabel = ACTION_BUTTONS[site.id]
    if (actionLabel) {
      controls.push(
        Button({
          key: keyOf('run', site.id),
          label: actionLabel,
          onPress: async press => {
            // A render site's count is its drawings, not the presses that open it
            if (site.kind === 'api') noteCall(site.id, press.surface)
            noteResult(site.id, await runAction($, site.id, press))
            redraw()
          },
        }),
      )
    }
    controls.push(
      Button({
        key: keyOf('detail', site.id),
        label: '詳細',
        variant: picked === site.id ? 'primary' : 'secondary',
        onPress: () => select($, category.id, site.id),
      }),
    )
    lines.push(row(keyOf('line', site.id), controls))
    const result = resultOf(site.id)
    if (result !== undefined) {
      lines.push(
        Text({ key: keyOf('result', site.id), dimColor: true, wrap: 'truncate-end', children: ['　結果: ' + result] }),
      )
    }
  }

  // ----- [詳細] The picked site's detail block -----
  const detail = []
  const site = sites.find(one => one.id === picked)
  if (site) {
    detail.push(
      row('detail-heading', [
        Text({ bold: true, children: [`${site.label} の詳細`] }),
        Text({ dimColor: true, children: [KIND_LABEL[site.kind]] }),
      ]),
      Text({ key: 'detail-where', wrap: 'wrap', children: ['場所: ' + site.where] }),
    )
    const choices = MODE_CHOICES[site.id]
    if (choices) {
      const current = await modeOf($, site.id)
      detail.push(
        row('detail-modes', [
          Text({ dimColor: true, children: ['書き方:'] }),
          ...choices.map(choice =>
            Button({
              key: keyOf('mode-' + choice.value, site.id),
              label: choice.label,
              variant: choice.value === current ? 'primary' : 'secondary',
              onPress: () => setMode($, site.id, choice.value),
            }),
          ),
        ]),
      )
    }
    detail.push(dim('detail-calls', '呼び出し: ' + callSummary(site.id)))
    if (site.props) {
      propsLines(site).forEach((text, index) => detail.push(dim('detail-props' + index, text)))
    }
    const result = resultOf(site.id)
    if (result !== undefined) detail.push(dim('detail-result', '結果: ' + result))
  }

  // The elements category also leads to the samples view; a sample the surface refuses blanks
  // that view only, and /ui-sampler brings back the contents
  const nav = [
    Button({ key: 'contents', label: '目次へ', onPress: () => go($, 'toc') }),
    Button({ key: 'refresh', label: '回数を更新', onPress: redraw }),
  ]
  if (category.id === 'elements') {
    nav.push(Button({ key: 'samples', label: '見本を見る', variant: 'primary', onPress: () => go($, 'samples') }))
  }

  return Box({
    flexDirection: 'column',
    rowGap: 1,
    width: '100%',
    children: [
      Text({ bold: true, children: ['[Pane] ' + category.label] }),
      dim('about', category.about),
      row('nav', nav),
      category.id === 'elements'
        ? dim('samples-howto', '見本でパネルが真っ白になったら、/ui-sampler で目次に戻り、ここで [Pane/…] を 1 つずつオフにすると、どれが断られているか分かる')
        : null,
      Box({ key: 'list', flexDirection: 'column', width: '100%', children: lines }),
      site
        ? Box({
            key: 'detail',
            flexDirection: 'column',
            width: '100%',
            borderStyle: 'round',
            paddingX: 1,
            children: detail,
          })
        : dim('detail-none', '[詳細] を押すと、その項目の場所・受け取った値・結果がここに出る'),
    ],
  })
}

export function registerPane(on) {
  // ===== [Pane] ui.render { component: 'Pane', requestId: 'ui-sampler' } =====
  // The matcher is PANE's value as a literal, so `plugin validate` can list it. The view
  // 'samples' is answered by elements.js's hook on the same matcher, registered before this
  // one so it is the outer link; it passes every other view on to here.
  on('ui.render', { component: 'Pane', requestId: 'ui-sampler' }, async ($, e) => {
    noteRender($, 'Pane', e)
    const current = await read($, view)
    const category = CATEGORIES.find(one => one.id === current && !one.isPending)
    return category ? drawCategory($, e, category) : drawContents($, e)
  })
}
