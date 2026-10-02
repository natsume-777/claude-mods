// The pane /ui-sampler opens: where it is being drawn, then one entry per SITES row (what it
// is, where it shows, its on/off switch, how often it was called), with buttons that call the
// one-shot $ APIs and open the element pane (elements.js).

import { PANE, ELEMENTS_PANE, SITES, KIND_LABEL, toggleValue, noteCall, callSummary } from './sites.js'
import { atom, read, update } from 'claude-code'

// The state this file reads and writes (declared in types/index.d.ts): one switch per site id,
// and which PromptHint prop [PromptHint] writes ('hint' replaces the line, 'tail' adds after it)
const TOGGLES = { plugin: 'ui-sampler', key: 'toggles' }
const promptHintMode = atom({ plugin: 'ui-sampler', key: 'promptHintMode' }, 'hint')

// Module variables are enough for these: a reload starting them over does no harm
let statusPresses = 0
const results = {}

// Element keys allow a plain set of characters; site ids carry '$' and '.'
const keyOf = (prefix, id) => prefix + '-' + id.replace(/[^A-Za-z0-9_-]/g, '_')

/** The one-shot APIs: the text of each one's button, by site id. runAction does the call. */
const ACTION_BUTTONS = {
  ElementsPane: '部品の見本を開く',
  '$.ui.status': 'ステータス行を書き換える',
  '$.ui.toast': 'トーストを出す',
  '$.ui.log': 'ログ行を出す',
  '$.ui.ask': '質問する',
  '$.session.append': 'system 行を足す',
}

// One function rather than a table of closures: the engine follows $ only into functions
// declared in this file, called by name.
async function runAction($, id) {
  switch (id) {
    // ===== [ElementsPane] $.ui.open({ id: 'ui-sampler-elements' }) =====
    // A pane of its own, so a sample the surface refuses takes down that pane, not this one
    case 'ElementsPane': {
      const opened = await $.ui.open({ id: ELEMENTS_PANE, title: '[Pane] 部品の見本' })
      return opened.isPlaced ? '開いた' : '開いたがまだ表示されていない: ' + opened.reason
    }

    // ===== [$.ui.status] $.ui.status(text) =====
    case '$.ui.status': {
      statusPresses += 1
      $.ui.status(`[$.ui.status] ボタンが ${statusPresses} 回押されました`)
      return `ステータス行を「ボタンが ${statusPresses} 回押されました」にした`
    }

    // ===== [$.ui.toast] $.ui.toast(text) =====
    case '$.ui.toast': {
      $.ui.toast('[$.ui.toast] トーストです（4 秒で消えます）')
      return '出した'
    }

    // ===== [$.ui.log] $.ui.log(text) =====
    case '$.ui.log': {
      $.ui.log('[$.ui.log] 会話欄に出る薄い 1 行です')
      return '出した'
    }

    // ===== [$.ui.ask] $.ui.ask(question, options) =====
    case '$.ui.ask': {
      try {
        return '答え: ' + (await $.ui.ask('[$.ui.ask] どの色が好きですか？', ['赤', '青', '緑']))
      } catch {
        return '閉じられた（答えなし）'
      }
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

export function registerPane(on) {
  // ===== [Pane] ui.render { component: 'Pane', requestId: 'ui-sampler' } =====
  // The matcher is PANE's value as a literal, so `plugin validate` can list it
  on('ui.render', { component: 'Pane', requestId: 'ui-sampler' }, async ($, e) => {
    noteRender($, 'Pane', e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const redraw = () => $.ui.invalidate('ui.render')
    const dim = (key, text) => Text({ key, dimColor: true, children: [text] })

    // Where this drawing is: the surface asking, its size, and every surface of the session
    const surfaces = await $.session.surfaces()
    const viewport = e.viewport
      ? `${e.viewport.columns} 桁 × ${e.viewport.rows} 行（isFullscreen: ${e.viewport.isFullscreen ?? '不明'}）`
      : 'なし（まだ測られていない）'
    const header = Box({
      key: 'header',
      flexDirection: 'column',
      children: [
        dim('surface', 'e.surface: ' + e.surface),
        dim('viewport', 'e.viewport: ' + viewport),
        dim('placement', `e.props.placement: ${e.props.placement}（本体の幅 ${e.props.bodyColumns} 桁）`),
        dim('surfaces', '$.session.surfaces(): ' + (surfaces.length > 0 ? surfaces.join(', ') : 'なし')),
      ],
    })

    // [PromptHint] writes either `hint` or `tail`; reading the atom here redraws on a switch
    const mode = await read($, promptHintMode)
    const hintMode = Box({
      key: 'hint-mode',
      flexDirection: 'row',
      columnGap: 1,
      alignItems: 'center',
      children: [
        Text({
          children: [
            mode === 'tail' ? '[PromptHint] の書き方: tail（元の行の後ろに足す）' : '[PromptHint] の書き方: hint（行ごと置き換える）',
          ],
        }),
        Button({
          key: 'hint-mode',
          label: mode === 'tail' ? 'hint に切り替え' : 'tail に切り替え',
          onPress: () => update($, promptHintMode, value => (value === 'tail' ? 'hint' : 'tail')),
        }),
      ],
    })

    // One entry per site. Reading each switch here subscribes the pane, so a toggle redraws it.
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
              results[site.id] = await runAction($, site.id)
              redraw()
            },
          }),
        )
      }
      entries.push(
        Box({
          key: keyOf('site', site.id),
          flexDirection: 'column',
          children: [
            Box({ flexDirection: 'row', columnGap: 1, alignItems: 'center', children: controls }),
            dim(keyOf('where', site.id), '場所: ' + site.where),
            dim(keyOf('calls', site.id), '呼び出し: ' + callSummary(site.id)),
            results[site.id] !== undefined ? dim(keyOf('result', site.id), '結果: ' + results[site.id]) : null,
          ],
        }),
      )
    }

    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: [
        Text({ bold: true, children: ['[Pane] ここがパネルです'] }),
        header,
        hintMode,
        Box({
          flexDirection: 'row',
          columnGap: 1,
          alignItems: 'center',
          children: [
            Text({ bold: true, children: ['一覧'] }),
            Button({ key: 'refresh', label: '回数を更新', onPress: redraw }),
          ],
        }),
        ...entries,
        Button({ key: 'close', label: '閉じる', role: 'dismiss', onPress: () => $.ui.close({ id: PANE }) }),
      ],
    })
  })
}
