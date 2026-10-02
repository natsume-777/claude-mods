// Tries each place a mod can draw, with placeholder content only.
// /ui-sampler opens a pane whose buttons fire the one-shot kinds (toast, status, log, notice,
// dialog); the engine's own lines (prompt hint, mode label, spinner, command output) are
// rewritten for as long as the mod is loaded.

const PANE = 'ui-sampler'
const COMMAND = 'ui-sampler'

// Module variables are enough here: a reload starting them over does no harm
let presses = 0
let lastAnswer = null
// What the engine's own sites handed this mod, shown in the pane to tell "not raised" from "not drawn"
const seen = { PromptHint: null, SessionMode: null }
let noticeResult = null

function remember($, component, e) {
  const first = seen[component] === null
  seen[component] = { count: (seen[component]?.count ?? 0) + 1, surface: e.surface, props: JSON.stringify(e.props) }
  if (first) $.ui.invalidate('ui.render')
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'UI の見本パネルを開く' })
    $.ui.status('ui-sampler: ステータス行はここに出ます')
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($) => {
    await $.ui.open({ id: PANE, title: 'UI 見本市' })
    return { text: 'UI 見本パネルを開きました' }
  })

  // The pane: a framed region the surface places; the buttons fire the one-shot kinds
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const redraw = () => $.ui.invalidate('ui.render')
    const row = (key, label, note, onPress) =>
      Box({
        key: 'row-' + key,
        flexDirection: 'row',
        columnGap: 1,
        alignItems: 'center',
        children: [Button({ key, label, onPress }), Text({ dimColor: true, children: [note] })],
      })

    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: [
        Text({ bold: true, children: ['ここがパネル（Pane）です'] }),
        Text({ children: ['下のボタンで、それぞれの場所に表示を出します'] }),
        row('toast', 'トースト', '右上に数秒だけ出る小さな箱', () => {
          $.ui.toast('トーストです（4 秒で消えます）')
        }),
        row('status', 'ステータス', 'プロンプト下の行を書き換える', () => {
          presses += 1
          $.ui.status(`ui-sampler: ボタンが ${presses} 回押されました`)
          redraw()
        }),
        row('log', 'ログ行', '会話欄に薄い 1 行（モデルには送られない）', () => {
          $.ui.log('ui-sampler: これは $.ui.log の行です')
        }),
        row('notice', '通知行', '会話に残る system 通知（モデルは読まない）', async () => {
          try {
            const result = await $.session.append({
              message: { type: 'system', content: [{ type: 'text', text: 'ui-sampler: session.append の通知行です' }] },
            })
            noticeResult = result?.deny ? '拒否: ' + result.deny : '成功: ' + JSON.stringify(result)
          } catch (error) {
            noticeResult = 'エラー: ' + String(error?.message ?? error)
          }
          redraw()
        }),
        Text({ dimColor: true, children: ['通知行の結果: ' + (noticeResult ?? 'まだ押していません')] }),
        row('ask', '質問', '標準の質問ダイアログで聞く', async () => {
          try {
            lastAnswer = await $.ui.ask('どの色が好きですか？', ['赤', '青', '緑'])
          } catch {
            lastAnswer = '（閉じられました）'
          }
          redraw()
        }),
        Text({ dimColor: true, children: ['質問の答え: ' + (lastAnswer ?? 'まだ聞いていません')] }),
        Text({ bold: true, children: ['診断: 標準の行のフックが呼ばれたか'] }),
        ...Object.entries(seen).map(([component, s]) =>
          Text({
            key: 'seen-' + component,
            dimColor: true,
            children: [component + ': ' + (s ? `${s.count} 回（${s.surface}） props=${s.props}` : '一度も呼ばれていない')],
          }),
        ),
        Button({ key: 'close', label: '閉じる', role: 'dismiss', onPress: () => $.ui.close({ id: PANE }) }),
      ],
    })
  })

  // The row /ui-sampler leaves in the transcript, drawn as a tree instead of plain text
  on('ui.render', { component: 'CommandOutput', props: { command: COMMAND } }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [Text({ color: 'success', bold: true, children: ['✔'] }), Text({ children: [e.props.text] })],
    })
  })

  // The dim hint line under the prompt
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    remember($, 'PromptHint', e)
    return next({ ...e, props: { ...e.props, hint: e.props.hint + '  ·  ui-sampler: ヒント行' } })
  })

  // The mode labels at the right of the prompt footer. A rewrite of `modes` reached the desktop
  // but drew nothing, so this draws a tree of its own in their place.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    remember($, 'SessionMode', e)
    const { Text } = $.ui.resolve(e)
    const modes = [...e.props.modes, 'sampler']
    return Text({ color: 'warning', children: [modes.join(' & ')] })
  })

  // The line that animates while a turn runs
  on('ui.render', { component: 'Spinner' }, ($, e, next) =>
    next({ ...e, props: { ...e.props, word: '見本市を準備中' } }),
  )
}
