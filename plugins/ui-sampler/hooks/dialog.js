// The dialog-style pane: opened with $.ui.open's dialog options (focus, closeOnEscape,
// holdToasts, rows) from three entry points (the main pane's dialogs view button, the [AbovePrompt] band's
// button, /ui-sampler-dialog). Its contents say which entry opened it and where the surface
// seated it, what each option asks for, and give something to try it with: an Input that
// should hold the keys, a toast button for holdToasts, and a close button.

import { DIALOG_PANE, noteCall } from './sites.js'
import { read, update } from 'claude-code'

// The state this file reads and writes (declared in types/index.d.ts): its echo lines
const ECHO = { plugin: 'ui-sampler', key: 'echo' }

// Counts the call, and redraws once (the pane's counts) when a site or surface is new
function noteRender($, id, e) {
  if (noteCall(id, e.surface)) $.ui.invalidate('ui.render')
}

// Writes one of this pane's echo lines from a handler (never while drawing)
function echoTo($, id, text) {
  return update($, { ...ECHO, id }, () => text)
}

// Reading an echo while drawing subscribes the pane, so a write redraws it
async function echoOf($, id) {
  return (await read($, { ...ECHO, id })) ?? 'まだ何もしていない'
}

export function registerDialog(on) {
  // ===== [DialogPane] ui.render { component: 'Pane', requestId: 'ui-sampler-dialog' } =====
  // The matcher is DIALOG_PANE's value as a literal, so `plugin validate` can list it
  on('ui.render', { component: 'Pane', requestId: 'ui-sampler-dialog' }, async ($, e) => {
    noteRender($, 'DialogPane', e)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const dim = text => Text({ dimColor: true, wrap: 'wrap', children: [text] })
    const viewport = e.viewport
      ? `${e.viewport.columns} 桁 × ${e.viewport.rows} 行（isFullscreen: ${e.viewport.isFullscreen ?? '不明'}）`
      : 'なし（まだ測られていない）'

    return Box({
      flexDirection: 'column',
      rowGap: 1,
      width: '100%',
      children: [
        Text({ bold: true, children: ['[DialogPane] ダイアログ風のパネル'] }),
        // Which entry opened it, and where the surface seated it
        Box({
          flexDirection: 'column',
          width: '100%',
          children: [
            Text({ wrap: 'wrap', children: ['開いたところ: ' + (await echoOf($, 'DialogPane:openedBy'))] }),
            dim('$.ui.open の結果: ' + (await echoOf($, 'DialogPane:openResult'))),
            Text({ wrap: 'wrap', children: [`e.props.placement: ${e.props.placement}`] }),
            dim(`e.props: title = ${e.props.title}、isFocused = ${e.props.isFocused}、bodyColumns = ${e.props.bodyColumns}`),
            dim(`e.surface: ${e.surface}、e.viewport: ${viewport}`),
            dim('placement は dock（本体の横）か inline（プロンプト欄の上）のどちらか。型定義には、ダイアログとして重ねて出すよう頼むオプションはない'),
          ],
        }),
        Box({
          flexDirection: 'column',
          width: '100%',
          children: [
            dim('focus: true … 開いたときにキー入力をこのパネルへ移すよう頼む（プロンプト欄が空のときだけ）'),
            dim('closeOnEscape: true … キー入力を持っている間に Esc を押すと閉じる'),
            dim('holdToasts: true … このパネルが出ている間はトーストを止めておき、閉じてから出す'),
            dim('rows: 12 … プロンプト欄の上に出るとき、本文に 12 行ほしいと頼む（横に出るときは使われない）'),
          ],
        }),
        Input({
          key: 'dialog-input',
          label: '[DialogPane] 入力',
          placeholder: '開いてすぐ打てるか試す',
          submitLabel: '写す',
          onSubmit: value => echoTo($, 'DialogPane:submit', value),
        }),
        dim('Enter で確定（onSubmit）: ' + (await echoOf($, 'DialogPane:submit'))),
        Box({
          flexDirection: 'row',
          columnGap: 1,
          alignItems: 'center',
          flexWrap: 'wrap',
          children: [
            Button({
              key: 'dialog-toast',
              label: 'トーストを出す（holdToasts）',
              onPress: () => {
                $.ui.toast('[DialogPane] holdToasts の間に出したトーストです')
                return echoTo($, 'DialogPane:toast', 'トーストを出した。閉じる前に見えたかどうかを確かめる')
              },
            }),
            Button({ key: 'dialog-close', label: '閉じる', onPress: () => $.ui.close({ id: DIALOG_PANE }) }),
          ],
        }),
        dim(await echoOf($, 'DialogPane:toast')),
      ],
    })
  })
}
