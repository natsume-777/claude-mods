// The pane /ui-sampler opens: where it is being drawn, then one entry per SITES row (what it
// is, where it shows, its on/off switch, how often it was called, the props a render site last
// received), with the choice of what [PromptHint], [Spinner] and [CommandOutput] write, and
// buttons that call the one-shot $ APIs and open the element and dialog panes.

import {
  PANE,
  ELEMENTS_PANE,
  DIALOG_OPEN,
  SITES,
  KIND_LABEL,
  toggleValue,
  noteCall,
  callSummary,
  lastProps,
  formatValue,
} from './sites.js'
import { atom, read, update } from 'claude-code'

// The state this file reads and writes (declared in types/index.d.ts): one switch per site id,
// which prop [PromptHint], [Spinner] and [CommandOutput] write, and [DialogPane]'s echo lines
// (which entry opened it)
const TOGGLES = { plugin: 'ui-sampler', key: 'toggles' }
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

// Module variables are enough for these: a reload starting them over does no harm
let statusPresses = 0
const results = {}

// Element keys allow a plain set of characters; site ids carry '$', '.' and '/'
const keyOf = (prefix, id) => prefix + '-' + id.replace(/[^A-Za-z0-9_-]/g, '_')

/** The one-shot APIs: the text of each one's button, by site id. runAction does the call. */
const ACTION_BUTTONS = {
  ElementsPane: '部品の見本を開く',
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

// One function rather than a table of closures: the engine follows $ only into functions
// declared in this file, called by name. `press` is the button's ui.press event.
async function runAction($, id, press) {
  switch (id) {
    // ===== [ElementsPane] $.ui.open({ id: 'ui-sampler-elements' }) =====
    // A pane of its own, so a sample the surface refuses takes down that pane, not this one
    case 'ElementsPane': {
      const opened = await $.ui.open({ id: ELEMENTS_PANE, title: '[Pane] 部品の見本' })
      return opened.isPlaced ? '開いた' : '開いたがまだ表示されていない: ' + opened.reason
    }

    // ===== [DialogPane] $.ui.open({ id: 'ui-sampler-dialog', focus, closeOnEscape, holdToasts, rows }) =====
    // One of three entry points (also the band's button and /ui-sampler-dialog), all with
    // DIALOG_OPEN. The opener is written before the open so the pane's first drawing shows it.
    case 'DialogPane': {
      await update($, { ...ECHO, id: 'DialogPane:openedBy' }, () => `本体パネルのボタン（ui.press、surface: ${press.surface}）`)
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
      const scrolled = await $.ui.scroll({ in: PANE, to: 'start' })
      return scrolled.deny ? '動かなかった: ' + scrolled.deny : '動いた（いちばん上へ）'
    }

    // ===== [$.ui.focus] $.ui.focus({ requestId: 'ui-sampler', key: 'refresh' }) =====
    case '$.ui.focus': {
      const focused = await $.ui.focus({ requestId: PANE, key: 'refresh' })
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

// Reading the switch while drawing subscribes the pane, so a toggle redraws it
async function isOn($, id) {
  return toggleValue(id, await read($, { ...TOGGLES, id }))
}

// Flips a switch from a press handler (never while drawing)
function toggle($, id) {
  return update($, { ...TOGGLES, id }, value => !toggleValue(id, value))
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

/** The pane's lines for the props a render site last received, each against its note. */
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

export function registerPane(on) {
  // ===== [Pane] ui.render { component: 'Pane', requestId: 'ui-sampler' } =====
  // The matcher is PANE's value as a literal, so `plugin validate` can list it
  on('ui.render', { component: 'Pane', requestId: 'ui-sampler' }, async ($, e) => {
    noteRender($, 'Pane', e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const redraw = () => $.ui.invalidate('ui.render')
    // Explanations wrap at the pane's edge rather than run past it
    const dim = (key, text) => Text({ key, dimColor: true, wrap: 'wrap', children: [text] })
    const row = children => Box({ flexDirection: 'row', columnGap: 1, alignItems: 'center', flexWrap: 'wrap', children })

    // Where this drawing is: the surface asking, its size, and every surface of the session
    const surfaces = await $.session.surfaces()
    const viewport = e.viewport
      ? `${e.viewport.columns} 桁 × ${e.viewport.rows} 行（isFullscreen: ${e.viewport.isFullscreen ?? '不明'}）`
      : 'なし（まだ測られていない）'
    const header = Box({
      key: 'header',
      flexDirection: 'column',
      width: '100%',
      children: [
        dim('surface', 'e.surface: ' + e.surface),
        dim('viewport', 'e.viewport: ' + viewport),
        dim('placement', `e.props.placement: ${e.props.placement}（本体の幅 ${e.props.bodyColumns} 桁）`),
        dim('surfaces', '$.session.surfaces(): ' + (surfaces.length > 0 ? surfaces.join(', ') : 'なし')),
      ],
    })

    // One entry per site. Reading each switch and choice here subscribes the pane, so a press
    // redraws it.
    const entries = []
    for (const site of SITES) {
      const actionButton = ACTION_BUTTONS[site.id]
      const isSiteOn = await isOn($, site.id)
      const controls = [
        Text({ bold: true, children: [site.label] }),
        Text({ dimColor: true, children: [KIND_LABEL[site.kind]] }),
      ]
      if (site.toggleable) {
        controls.push(
          Button({
            key: keyOf('toggle', site.id),
            label: isSiteOn ? 'オン' : 'オフ',
            variant: isSiteOn ? 'primary' : 'secondary',
            onPress: () => toggle($, site.id),
          }),
        )
      }
      if (actionButton) {
        controls.push(
          Button({
            key: keyOf('run', site.id),
            label: actionButton,
            onPress: async press => {
              // A render site's count is its drawings, not the presses that open it
              if (site.kind === 'api') noteCall(site.id, press.surface)
              results[site.id] = await runAction($, site.id, press)
              redraw()
            },
          }),
        )
      }

      const lines = [row(controls), dim(keyOf('where', site.id), '場所: ' + site.where)]
      const choices = MODE_CHOICES[site.id]
      if (choices) {
        const current = await modeOf($, site.id)
        lines.push(
          row([
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
      lines.push(dim(keyOf('calls', site.id), '呼び出し: ' + callSummary(site.id)))
      if (site.props) {
        propsLines(site).forEach((text, index) => lines.push(dim(keyOf('props' + index, site.id), text)))
      }
      if (results[site.id] !== undefined) lines.push(dim(keyOf('result', site.id), '結果: ' + results[site.id]))

      entries.push(Box({ key: keyOf('site', site.id), flexDirection: 'column', width: '100%', children: lines }))
    }

    return Box({
      flexDirection: 'column',
      rowGap: 1,
      width: '100%',
      children: [
        Text({ bold: true, children: ['[Pane] ここがパネルです'] }),
        header,
        row([
          Text({ bold: true, children: ['一覧'] }),
          Button({ key: 'refresh', label: '回数を更新', onPress: redraw }),
        ]),
        ...entries,
        Button({ key: 'close', label: '閉じる', role: 'dismiss', onPress: () => $.ui.close({ id: PANE }) }),
      ],
    })
  })
}
