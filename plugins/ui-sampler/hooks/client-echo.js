// [Pane/Client] the surface module the samples view's Client draws (elements.js): a counter
// and a button. The button posts the count to the hooks module (`surface.post`), whose
// ui.message hook answers `{ props: { reply } }`; the reply arrives here as the next props.
// It runs on the drawing side, with no $: `surface` is all it has.

export default function ClientEcho(props, surface) {
  const { Box, Text, Button } = surface.elements
  const sent = surface.state ?? 0
  return Box({
    flexDirection: 'column',
    children: [
      Text({ children: [`[Pane/Client] surface module が描いた行（送った回数: ${sent}）`] }),
      Text({ dimColor: true, wrap: 'wrap', children: ['ui.message の答え: ' + (props?.reply ?? 'まだない')] }),
      Box({
        flexDirection: 'row',
        children: [
          Button({
            key: 'client-send',
            label: '送る',
            onPress: () => {
              surface.setState(sent + 1)
              surface.post({ count: sent + 1 })
            },
          }),
        ],
      }),
    ],
  })
}
