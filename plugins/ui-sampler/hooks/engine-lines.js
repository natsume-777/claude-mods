// The engine's own lines this mod rewrites or redraws while it is loaded, and the band above
// the prompt it adds to. Each hook counts its call and keeps the props it received first (so
// the pane can tell "not raised" from "raised but not drawn", and list what came in), then
// passes `next(e)` on unchanged when its site is switched off in the pane.

import { DIALOG_OPEN, noteCall, noteProps, formatValue, toggleValue } from './sites.js'
import { atom, read, update } from 'claude-code'

// The state this file reads (declared in types/index.d.ts): one switch per site id, which
// prop [PromptHint], [Spinner] and [CommandOutput] write, and the band's and [DialogPane]'s echo
// lines
const TOGGLES = { plugin: 'ui-sampler', key: 'toggles' }
const ECHO = { plugin: 'ui-sampler', key: 'echo' }
const promptHintMode = atom({ plugin: 'ui-sampler', key: 'promptHintMode' }, 'hint')
const spinnerMode = atom({ plugin: 'ui-sampler', key: 'spinnerMode' }, 'word')
const commandOutputMode = atom({ plugin: 'ui-sampler', key: 'commandOutputMode' }, 'tree')

// Counts the call and keeps the props; redraws once (the pane's list) when either is new
function noteRender($, id, e) {
  const isNewCall = noteCall(id, e.surface)
  const isNewProps = noteProps(id, e)
  if (isNewCall || isNewProps) $.ui.invalidate('ui.render')
}

// Reading the switch while drawing subscribes the hook, so a press in the pane redraws it
async function isOn($, id) {
  return toggleValue(id, await read($, { ...TOGGLES, id }))
}

// Writes one of the band's echo lines from a handler (never while drawing)
function echoTo($, id, text) {
  return update($, { ...ECHO, id }, () => text)
}

// Reading an echo while drawing subscribes the band, so a write redraws it
async function echoOf($, id) {
  return (await read($, { ...ECHO, id })) ?? 'まだ何もしていない'
}

// ===== [DialogPane] $.ui.open({ id: 'ui-sampler-dialog', ... }) from the band =====
// One of three entry points (also the main pane's dialogs view button and /ui-sampler-dialog), all with
// DIALOG_OPEN. The opener is written before the open so the pane's first drawing shows it.
async function openDialogFromBand($, press) {
  await echoTo($, 'DialogPane:openedBy', `[AbovePrompt] の帯のボタン（ui.press、surface: ${press.surface}）`)
  const opened = await $.ui.open(DIALOG_OPEN)
  const result = opened.isPlaced ? 'isPlaced: true' : `isPlaced: false、reason: ${opened.reason}`
  await echoTo($, 'DialogPane:openResult', result)
  return echoTo($, 'AbovePrompt:press', `[DialogPane] を開いた（${result}）`)
}

// `name=value` for every prop received, in the order they came
const propPairs = props =>
  Object.entries(props)
    .map(([name, value]) => `${name}=${formatValue(value)}`)
    .join(' ')

export function registerEngineLines(on) {
  // ===== [Spinner] ui.render { component: 'Spinner' } =====
  // The line that animates while a turn runs. The pane chooses what to write: `word`,
  // `message` or `suffix`; a tree of its own that lists the props received; or that list
  // written into `word`.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    noteRender($, 'Spinner', e)
    if (!(await isOn($, 'Spinner'))) return next(e)
    const mode = await read($, spinnerMode)
    switch (mode) {
      case 'message':
        return next({ ...e, props: { ...e.props, message: '[Spinner] message を書き換え' } })
      case 'suffix':
        return next({ ...e, props: { ...e.props, suffix: ' [Spinner] suffix を書き換え' } })
      case 'tree': {
        const { Text } = $.ui.resolve(e)
        return Text({
          color: 'warning',
          wrap: 'wrap',
          children: ['[Spinner] 自前のツリー: ' + propPairs(e.props)],
        })
      }
      case 'props':
        return next({ ...e, props: { ...e.props, word: '[Spinner] ' + propPairs(e.props) } })
      default:
        return next({ ...e, props: { ...e.props, word: '[Spinner] word を書き換え' } })
    }
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

  // ===== [AbovePrompt] ui.render { component: 'AbovePrompt' } =====
  // The band above the prompt. Other mods draw here too, so this asks `next(e)` for theirs
  // first and puts its own labelled row above it rather than replacing it; while a survey
  // holds the band it passes.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    noteRender($, 'AbovePrompt', e)
    const inner = await next(e)
    if (e.props.hasSurvey || !(await isOn($, 'AbovePrompt'))) return inner
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const ours = Box({
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 1,
          alignItems: 'center',
          flexWrap: 'wrap',
          children: [
            Text({ bold: true, children: ['[AbovePrompt]'] }),
            Button({
              key: 'band-press',
              label: '帯のボタン',
              onPress: press => echoTo($, 'AbovePrompt:press', `押された（e.surface: ${press.surface}）`),
            }),
            Button({
              key: 'band-dialog',
              label: '[DialogPane] を開く',
              onPress: press => openDialogFromBand($, press),
            }),
            Input({
              key: 'band-input',
              label: '帯の入力',
              placeholder: 'ここに入力して Enter',
              submitLabel: '写す',
              onSubmit: value => echoTo($, 'AbovePrompt:submit', value),
            }),
          ],
        }),
        Text({
          dimColor: true,
          wrap: 'wrap',
          children: [
            `ボタン: ${await echoOf($, 'AbovePrompt:press')} / 入力: ${await echoOf($, 'AbovePrompt:submit')}`,
          ],
        }),
        inner ? Text({ dimColor: true, wrap: 'wrap', children: ['[AbovePrompt] この下はほかの mod の帯（next(e) が返したもの）'] }) : null,
      ],
    })
    return inner ? Box({ flexDirection: 'column', children: [ours, inner] }) : ours
  })

  // ===== [CommandOutput] ui.render { component: 'CommandOutput', props: { command: 'ui-sampler' } } =====
  // The row /ui-sampler leaves in the transcript. command.run answered text starting with
  // [command.run]. The pane chooses: a tree that puts [CommandOutput] in front of that text,
  // or a rewrite of `text` the engine draws in its own row. Switched off, the engine draws
  // the plain [command.run] text alone.
  // The matcher is COMMAND's value as a literal, so `plugin validate` can list it
  on('ui.render', { component: 'CommandOutput', props: { command: 'ui-sampler' } }, async ($, e, next) => {
    noteRender($, 'CommandOutput', e)
    if (!(await isOn($, 'CommandOutput'))) return next(e)
    const mode = await read($, commandOutputMode)
    if (mode === 'text') {
      return next({ ...e, props: { ...e.props, text: `[CommandOutput] text を書き換え（元: ${e.props.text}）` } })
    }
    const { Box, Text } = $.ui.resolve(e)
    return Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ color: 'success', bold: true, children: ['[CommandOutput] 自前のツリー'] }),
        Text({ wrap: 'wrap', children: [e.props.text] }),
      ],
    })
  })
}
