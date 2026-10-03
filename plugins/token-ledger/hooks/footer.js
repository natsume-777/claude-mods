// The footer line beside the model name (SessionMode): `ctx 370k · 新規◎4回`, the main
// thread's context and how many requests a fresh session takes to pay back (◎今 once the
// cache expired). It reads the requests and the handoff from $.state, so a new request redraws
// it; register.js redraws it when the cache nears its end or expires. What the engine and any
// mod beneath draw (cache-timer's countdown, the mode labels) stays beside it.

import { HEAVY_CONTEXT } from './aggregate.js'
import { summarize, footerText } from './ledger.js'
import { COLOR } from './style.js'

const REQUESTS = { plugin: 'token-ledger', key: 'requests' }
const HANDOFF = { plugin: 'token-ledger', key: 'handoff' }

export function registerFooter(on) {
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const { value: requests } = await $.state.get(REQUESTS)
    const { value: handoff } = await $.state.get(HANDOFF)
    const beneath = await next(e)
    const s = summarize(requests, await $.clock.now(), { handoff: handoff?.status })
    if (s.context == null) return beneath

    const { Box, Text } = $.ui.resolve(e)
    const color = s.context >= HEAVY_CONTEXT ? { color: COLOR.warn } : {}
    // A Text takes no key; the Box around it carries one
    const line = Box({ key: 'token-ledger', children: [Text({ ...color, children: [footerText(s)] })] })
    // With no modes the engine's drawing has no labels to show; leave it out so no gap trails
    const isEmpty = beneath?.type === 'engine' && e.props.modes.length === 0
    if (!beneath || isEmpty) return line
    return Box({ flexDirection: 'row', columnGap: 2, children: [line, beneath] })
  })
}
