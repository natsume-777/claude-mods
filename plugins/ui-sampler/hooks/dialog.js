// The dialog-style pane: opened with $.ui.open's dialog options (focus, closeOnEscape,
// holdToasts, rows) from three entry points (the main pane's dialogs view button, the [AbovePrompt] band's
// button, /ui-sampler-dialog). Its contents say which entry opened it and where the surface
// seated it, what each option asks for, and give something to try it with: an Input that
// should hold the keys, a toast button for holdToasts, and a close button.

import { DIALOG_PANE, noteCall } from './sites.js'
import { BUTTON, dim, inline, field, header, section, page } from './style.js'
import { noteInvalidate } from './diag.js'
import { redrawFor } from './redraw.js'
import { guardDrawing } from './press-guard.js'
import { read, update } from 'claude-code'

// The state this file reads and writes (declared in types/index.d.ts): its echo lines
const ECHO = { plugin: 'ui-sampler', key: 'echo' }

// Counts the call, and redraws once when a site or surface is new and the main pane lists
// the site (redraw.js)
function noteRender($, id, e) {
  const isNew = noteCall(id, e.surface)
  if (!redrawFor(id, { isNew }, Date.now())) return
  noteInvalidate(`${id} の初回描画（新しい surface）`)
  $.ui.invalidate('ui.render')
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
    // The guard keeps this drawing's Button closures for [press/再実行] (press-guard.js)
    const guard = guardDrawing(e.requestId)
    const ui = guard.wrap($.ui.resolve(e))
    const { Button, Input } = ui
    const viewport = e.viewport
      ? `${e.viewport.columns} 桁 × ${e.viewport.rows} 行（isFullscreen: ${e.viewport.isFullscreen ?? '不明'}）`
      : 'なし（まだ測られていない）'

    return guard.done(page(ui, [
      header(ui, {
        title: '[DialogPane] ダイアログ風のパネル',
        about: '$.ui.open のダイアログ向けのオプションを付けて開いたパネル。どこから開き、どこに置かれたかを示す',
        nav: [Button({ key: 'dialog-close', label: '閉じる', ...BUTTON.nav, onPress: () => $.ui.close({ id: DIALOG_PANE }) })],
      }),
      // Which entry opened it, and where the surface seated it
      section(ui, 'opened', '開いたところ', [
        field(ui, 'opened-by', '開いた入口', await echoOf($, 'DialogPane:openedBy')),
        field(ui, 'opened-result', '$.ui.open の結果', await echoOf($, 'DialogPane:openResult')),
        field(ui, 'opened-placement', 'e.props.placement', e.props.placement),
        field(ui, 'opened-title', 'e.props.title', String(e.props.title)),
        field(ui, 'opened-focused', 'e.props.isFocused', String(e.props.isFocused)),
        field(ui, 'opened-columns', 'e.props.bodyColumns', String(e.props.bodyColumns)),
        field(ui, 'opened-surface', 'e.surface', e.surface),
        field(ui, 'opened-viewport', 'e.viewport', viewport),
        dim(ui, 'opened-note', 'placement は dock（本体の横）か inline（プロンプト欄の上）のどちらか。型定義には、ダイアログとして重ねて出すよう頼むオプションはない'),
      ]),
      section(ui, 'options', '頼んだオプション', [
        field(ui, 'option-focus', 'focus: true', '開いたときにキー入力をこのパネルへ移すよう頼む（プロンプト欄が空のときだけ）'),
        field(ui, 'option-escape', 'closeOnEscape: true', 'キー入力を持っている間に Esc を押すと閉じる'),
        field(ui, 'option-toasts', 'holdToasts: true', 'このパネルが出ている間はトーストを止めておき、閉じてから出す'),
        field(ui, 'option-rows', 'rows: 12', 'プロンプト欄の上に出るとき、本文に 12 行ほしいと頼む（横に出るときは使われない）'),
      ]),
      section(ui, 'try', '試す', [
        Input({
          key: 'dialog-input',
          label: '[DialogPane] 入力',
          placeholder: '開いてすぐ打てるか試す',
          submitLabel: '写す',
          onSubmit: value => echoTo($, 'DialogPane:submit', value),
        }),
        field(ui, 'try-submit', 'Enter で確定', await echoOf($, 'DialogPane:submit')),
        inline(
          ui,
          'try-buttons',
          [
            Button({
              key: 'dialog-toast',
              label: 'トーストを出す（holdToasts）',
              onPress: () => {
                $.ui.toast('[DialogPane] holdToasts の間に出したトーストです')
                return echoTo($, 'DialogPane:toast', 'トーストを出した。閉じる前に見えたかどうかを確かめる')
              },
            }),
          ],
          1,
        ),
        field(ui, 'try-toast', 'トースト', await echoOf($, 'DialogPane:toast')),
      ]),
    ]))
  })
}
