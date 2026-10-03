// A reference mod for the places a mod can draw. Everything it puts on screen starts with an
// ASCII label in brackets, `[Spinner]`, `[$.ui.toast]`, naming the site or API that drew it;
// the same label is the `id` of its SITES entry (sites.js) and heads the code that draws it.
//
// sites.js         the SITES table, the per-site switches ($.state) and the call counts
// pane.js          [Pane]: one pane whose view switches: the table of contents, or one category's
//                  sites a line each with the [詳細] of one, and the one-shot API buttons
// elements.js      [Pane/samples] [Pane/Text] [Pane/Box] ...: the pane's view of one sample per
//                  element
// dialog.js        [DialogPane]: a second pane, opened with $.ui.open's dialog options
// engine-lines.js  [Spinner] [SessionMode] [PromptHint] [AbovePrompt] [CommandOutput]: the engine's
//                  own lines, and the band above the prompt
// transcript.js    [UserMessage] [AssistantMessage] [ToolUse] [ToolResult] [ToolGroup]: the
//                  transcript's rows; [ToolProgress] [TurnDuration] [InfoNotice]: counted only
// asks.js          [AskUserQuestion] [$.ui.notice]: the question dialog, the permission dialog
// events.js        [command.describe] [turn.complete] [prompt.suggest]: engine events that are
//                  not drawings (the $.prompt buttons are in pane.js)
// redraw.js        when a hook's new call or props are worth redrawing the pane for
// diag.js          [診断/press]: the press, focus and redraw log
// press-guard.js   [press/再実行]: runs a press again that did not reach its onPress
// style.js         the shared look: spacing, column widths, colors, button roles, and pure
//                  builders for headers, sections, table rows, fields and cards

import { COMMAND, DIALOG_COMMAND, DIALOG_OPEN, PANE, noteCall } from './sites.js'
import { registerPane } from './pane.js'
import { registerElements } from './elements.js'
import { registerDialog } from './dialog.js'
import { registerEngineLines } from './engine-lines.js'
import { registerTranscript } from './transcript.js'
import { registerAsks } from './asks.js'
import { registerEvents } from './events.js'
import { atom, update } from 'claude-code'

// The state this file writes (declared in types/index.d.ts): the pane's view, and
// [DialogPane]'s echo lines, which say which entry opened it
const view = atom({ plugin: 'ui-sampler', key: 'view' }, 'toc')
const ECHO = { plugin: 'ui-sampler', key: 'echo' }

export function register(on) {
  // ===== session.start: /ui-sampler, /ui-sampler-dialog and the first [$.ui.status] =====
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'UI の見本パネルを開く' })
    await $.command.register({ name: DIALOG_COMMAND, description: 'ダイアログ風のパネル [DialogPane] を開く' })
    noteCall('$.ui.status')
    $.ui.status('[$.ui.status] セッション開始時に出したステータス行です')
    return next(e)
  })

  // ===== [command.run] on('command.run', { command: 'ui-sampler' }) =====
  // Its text becomes the transcript row [CommandOutput] draws (engine-lines.js). The matcher is
  // a literal (COMMAND's value) so `plugin validate` can list it; an imported const shows as `?`.
  // It starts the pane at the contents, which is also the way back from a view that does not draw.
  on('command.run', { command: 'ui-sampler' }, async $ => {
    noteCall('command.run')
    await update($, view, () => 'toc')
    const opened = await $.ui.open({ id: PANE, title: '[Pane] UI 見本市' })
    const placed = opened.isPlaced ? '' : `（まだ表示されていない: ${opened.reason}）`
    return { text: `[command.run] UI 見本パネルを開きました${placed}` }
  })

  // ===== [command.run] on('command.run', { command: 'ui-sampler-dialog' }) =====
  // Another entry point for [DialogPane], beside the main pane's dialogs view button and the band's: a
  // command the person typed, with the same open options (DIALOG_OPEN). The opener is written
  // before the open so the pane's first drawing shows it.
  on('command.run', { command: 'ui-sampler-dialog' }, async ($, e) => {
    noteCall('command.run')
    const where = `isFullscreen: ${e.presentation.isFullscreen}、${e.presentation.columns} 桁`
    await update($, { ...ECHO, id: 'DialogPane:openedBy' }, () => `/ui-sampler-dialog（command.run、presentation: ${where}）`)
    const opened = await $.ui.open(DIALOG_OPEN)
    const result = opened.isPlaced ? 'isPlaced: true' : `isPlaced: false、reason: ${opened.reason}`
    await update($, { ...ECHO, id: 'DialogPane:openResult' }, () => result)
    return { text: `[command.run] /ui-sampler-dialog で [DialogPane] を開きました（${result}、presentation の ${where}）` }
  })

  // registerElements before registerPane: both hook the pane, and the first registered is the
  // outer link, so the samples view answers 'samples' and passes the rest to [Pane]
  registerElements(on)
  registerPane(on)
  registerDialog(on)
  registerEngineLines(on)
  registerTranscript(on)
  registerAsks(on)
  registerEvents(on)
}
