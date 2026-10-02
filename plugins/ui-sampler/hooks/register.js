// A reference mod for the places a mod can draw. Everything it puts on screen starts with an
// ASCII label in brackets, `[Spinner]`, `[$.ui.toast]`, naming the site or API that drew it;
// the same label is the `id` of its SITES entry (sites.js) and heads the code that draws it.
//
// sites.js         the SITES table, the per-site switches ($.state) and the call counts
// pane.js          [Pane]: where it is drawn, the SITES index, the one-shot API buttons
// engine-lines.js  [Spinner] [SessionMode] [PromptHint] [CommandOutput]: the engine's own lines

import { COMMAND, PANE, noteCall } from './sites.js'
import { registerPane } from './pane.js'
import { registerEngineLines } from './engine-lines.js'

export function register(on) {
  // ===== session.start: /ui-sampler and the first [$.ui.status] =====
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'UI の見本パネルを開く' })
    noteCall('$.ui.status')
    $.ui.status('[$.ui.status] セッション開始時に出したステータス行です')
    return next(e)
  })

  // ===== [command.run] on('command.run', { command: 'ui-sampler' }) =====
  // Its text becomes the transcript row [CommandOutput] draws (engine-lines.js). The matcher is
  // a literal (COMMAND's value) so `plugin validate` can list it; an imported const shows as `?`.
  on('command.run', { command: 'ui-sampler' }, async $ => {
    noteCall('command.run')
    const opened = await $.ui.open({ id: PANE, title: '[Pane] UI 見本市' })
    const placed = opened.isPlaced ? '' : `（まだ表示されていない: ${opened.reason}）`
    return { text: `[command.run] UI 見本パネルを開きました${placed}` }
  })

  registerPane(on)
  registerEngineLines(on)
}
