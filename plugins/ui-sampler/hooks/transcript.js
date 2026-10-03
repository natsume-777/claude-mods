// The transcript's rows: the person's and Claude's messages, tool calls, their results and the
// folded runs of calls, plus the lines the type declarations say only the terminal raises.
// A row site switched on keeps the engine's row (what `next(e)` returns) and puts one labelled
// line above it; switched off it passes `next(e)` on unchanged. The terminal-only sites only
// count their calls and keep their props.
//
// Many rows share one site, so these hooks redraw (the pane's counts) only when a site or a
// surface is new, never because the props changed: with several rows each would take its turn
// as "changed", and every redraw draws every row again.

import { noteCall, keepProps, toggleValue } from './sites.js'
import { read } from 'claude-code'

// The state this file reads (declared in types/index.d.ts): one switch per site id
const TOGGLES = { plugin: 'ui-sampler', key: 'toggles' }

// Counts the call and keeps the props; redraws once when the site or the surface is new
function noteRow($, id, e) {
  keepProps(id, e)
  if (noteCall(id, e.surface)) $.ui.invalidate('ui.render')
}

// Reading the switch while drawing subscribes the row, so a press in the pane redraws it
async function isOn($, id) {
  return toggleValue(id, await read($, { ...TOGGLES, id }))
}

// The engine's row with the labelled lines above it
function labelled($, e, inner, lines) {
  const { Box, Text } = $.ui.resolve(e)
  return Box({
    flexDirection: 'column',
    children: [
      ...lines.map((text, index) => Text({ key: 'label' + index, color: 'warning', wrap: 'wrap', children: [text] })),
      inner,
    ],
  })
}

/** A tool call's name list for a label: `Read, Read, Bash`, cut after a few. */
function toolNames(calls) {
  const names = calls.slice(0, 5).map(call => call.tool)
  return names.join(', ') + (calls.length > 5 ? ` ほか ${calls.length - 5} 件` : '')
}

export function registerTranscript(on) {
  // ===== [UserMessage] ui.render { component: 'UserMessage' } =====
  // The person's prompt, a background task's notification, a message another agent or session
  // sent. The label says which, by origin.kind.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    noteRow($, 'UserMessage', e)
    if (!(await isOn($, 'UserMessage'))) return next(e)
    const inner = await next(e)
    const { origin, isExpanded } = e.props
    return labelled($, e, inner, [
      `[UserMessage] ui-sampler が足した行（origin.kind: ${origin?.kind ?? '（なし）'}、isExpanded: ${isExpanded}）`,
    ])
  })

  // ===== [AssistantMessage] ui.render { component: 'AssistantMessage' } =====
  // One text block of a reply; a reply of several blocks gets a label above each
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    noteRow($, 'AssistantMessage', e)
    if (!(await isOn($, 'AssistantMessage'))) return next(e)
    const inner = await next(e)
    return labelled($, e, inner, [
      `[AssistantMessage] ui-sampler が足した行（isFirstOfReply: ${e.props.isFirstOfReply}、${e.props.text.length} 文字）`,
    ])
  })

  // ===== [ToolUse] ui.render { component: 'ToolUse' } =====
  // A tool call's row; also each row an expanded [ToolGroup] unfolds into
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    noteRow($, 'ToolUse', e)
    if (!(await isOn($, 'ToolUse'))) return next(e)
    const inner = await next(e)
    const { tool, isRunning, isErrored, isInterrupted } = e.props
    return labelled($, e, inner, [
      `[ToolUse] ui-sampler が足した行（tool: ${tool}、isRunning: ${isRunning}、isErrored: ${isErrored}、isInterrupted: ${isInterrupted}）`,
    ])
  })

  // ===== [ToolResult] ui.render { component: 'ToolResult' } =====
  // The result block under a standalone tool row
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    noteRow($, 'ToolResult', e)
    if (!(await isOn($, 'ToolResult'))) return next(e)
    const inner = await next(e)
    return labelled($, e, inner, [
      `[ToolResult] ui-sampler が足した行（tool: ${e.props.tool}、isErrored: ${e.props.isErrored}）`,
    ])
  })

  // ===== [ToolGroup] [ToolGroup/isExpanded] ui.render { component: 'ToolGroup' } =====
  // The one-line count of a run of calls. Two switches: [ToolGroup] labels the row;
  // [ToolGroup/isExpanded] hands next(e) isExpanded: true, the one prop whose rewrite the
  // type declarations say changes the screen, so the run unfolds into [ToolUse] rows.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    noteRow($, 'ToolGroup', e)
    const isLabelOn = await isOn($, 'ToolGroup')
    const isExpandOn = await isOn($, 'ToolGroup/isExpanded')
    if (!isLabelOn && !isExpandOn) return next(e)
    if (isExpandOn) noteCall('ToolGroup/isExpanded', e.surface)
    const inner = await next(isExpandOn ? { ...e, props: { ...e.props, isExpanded: true } } : e)
    const { calls, isActive, isExpanded } = e.props
    const lines = []
    if (isLabelOn) {
      lines.push(
        `[ToolGroup] ui-sampler が足した行（calls: ${calls.length} 件 ${toolNames(calls)}、isActive: ${isActive}、isExpanded: ${isExpanded}）`,
      )
    }
    if (isExpandOn) lines.push(`[ToolGroup/isExpanded] isExpanded を true にして next(e) に渡した（元: ${isExpanded}）`)
    return labelled($, e, inner, lines)
  })

  // ===== [ToolProgress] ui.render { component: 'ToolProgress' } =====
  // Declared terminal-only: counted, props kept, drawn as the engine draws it
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    noteRow($, 'ToolProgress', e)
    return next(e)
  })

  // ===== [TurnDuration] ui.render { component: 'TurnDuration' } =====
  // Declared terminal-only: counted, props kept, drawn as the engine draws it
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    noteRow($, 'TurnDuration', e)
    return next(e)
  })

  // ===== [InfoNotice] ui.render { component: 'InfoNotice' } =====
  // Declared terminal-only: counted, props kept, drawn as the engine draws it
  on('ui.render', { component: 'InfoNotice' }, async ($, e, next) => {
    noteRow($, 'InfoNotice', e)
    return next(e)
  })
}
