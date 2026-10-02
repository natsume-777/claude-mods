// The engine's own lines this mod rewrites or redraws while it is loaded. Each hook counts its
// call first (so the pane can tell "not raised" from "raised but not drawn"), then passes
// `next(e)` on unchanged when its site is switched off in the pane.

import { noteCall, toggleValue } from './sites.js'
import { atom, read } from 'claude-code'

// The state this file reads (declared in types/index.d.ts): one switch per site id, and which
// PromptHint prop to write ('hint' replaces the line, 'tail' adds after it)
const TOGGLES = { plugin: 'ui-sampler', key: 'toggles' }
const promptHintMode = atom({ plugin: 'ui-sampler', key: 'promptHintMode' }, 'hint')

// Counts the call, and redraws once (the pane's counts) when a site or surface is new
function noteRender($, id, e) {
  if (noteCall(id, e.surface)) $.ui.invalidate('ui.render')
}

// Reading the switch while drawing subscribes the hook, so a press in the pane redraws it
async function isOn($, id) {
  return toggleValue(id, await read($, { ...TOGGLES, id }))
}

export function registerEngineLines(on) {
  // ===== [Spinner] ui.render { component: 'Spinner' } =====
  // The line that animates while a turn runs: a rewrite of `word`
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    noteRender($, 'Spinner', e)
    if (!(await isOn($, 'Spinner'))) return next(e)
    return next({ ...e, props: { ...e.props, word: '[Spinner] 見本市を準備中' } })
  })

  // ===== [SessionMode] ui.render { component: 'SessionMode' } =====
  // The mode labels in the prompt footer. A tree of our own in their place, which still
  // shows the labels the engine handed over.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    noteRender($, 'SessionMode', e)
    if (!(await isOn($, 'SessionMode'))) return next(e)
    const { Text } = $.ui.resolve(e)
    const original = e.props.modes.length > 0 ? e.props.modes.join(' & ') : 'なし'
    return Text({ color: 'warning', children: [`[SessionMode] モード表示を描き替え（元: ${original}）`] })
  })

  // ===== [PromptHint] ui.render { component: 'PromptHint' } =====
  // The dim hint line under the prompt. The pane chooses which prop to write:
  // `hint` replaces the whole line, `tail` adds text after the engine's own line.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    noteRender($, 'PromptHint', e)
    if (!(await isOn($, 'PromptHint'))) return next(e)
    const mode = await read($, promptHintMode)
    if (mode === 'tail') {
      return next({ ...e, props: { ...e.props, tail: '[PromptHint] tail に足した文字' } })
    }
    return next({ ...e, props: { ...e.props, hint: `[PromptHint] hint を書き換え（元: ${e.props.hint}）` } })
  })

  // ===== [CommandOutput] ui.render { component: 'CommandOutput', props: { command: 'ui-sampler' } } =====
  // The row /ui-sampler leaves in the transcript. command.run answered text starting with
  // [command.run]; this draws a tree that puts [CommandOutput] in front of it, so the row shows
  // both layers. Switched off, the engine draws the plain [command.run] text alone.
  // The matcher is COMMAND's value as a literal, so `plugin validate` can list it
  on('ui.render', { component: 'CommandOutput', props: { command: 'ui-sampler' } }, async ($, e, next) => {
    noteRender($, 'CommandOutput', e)
    if (!(await isOn($, 'CommandOutput'))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ color: 'success', bold: true, children: ['[CommandOutput]'] }),
        Text({ children: [e.props.text] }),
      ],
    })
  })
}
