// The element pane: one labelled sample per 'element' row of SITES, drawn with the element
// table of the surface asking. A tree the surface refuses is not drawn at all, so the samples
// live in a pane of their own (the index stays up) and each has its own on/off switch: switch
// samples off until the pane shows, and the last one switched off is the one refused.

import { ELEMENTS_PANE, SITES, toggleValue, noteCall } from './sites.js'
import { read, update } from 'claude-code'

// The state this file reads and writes (declared in types/index.d.ts): one switch per site id,
// and one echo line per sample (the last press, the typed text, the picked value)
const TOGGLES = { plugin: 'ui-sampler', key: 'toggles' }
const ECHO = { plugin: 'ui-sampler', key: 'echo' }

const LINK_HREF = 'https://example.com/'
const PRESSABLE_HREF = 'https://example.com/press'

// Element keys allow a plain set of characters; site ids carry '/'
const keyOf = (prefix, id) => prefix + '-' + id.replace(/[^A-Za-z0-9_-]/g, '_')

// Counts the call, and redraws once (the index's counts) when a site or surface is new
function noteRender($, id, e) {
  if (noteCall(id, e.surface)) $.ui.invalidate('ui.render')
}

// Reading the switch while drawing subscribes the pane, so a toggle redraws it
async function isOn($, id) {
  return toggleValue(id, await read($, { ...TOGGLES, id }))
}

// Flips a switch from a press handler (never while drawing)
function toggle($, id) {
  return update($, { ...TOGGLES, id }, value => !toggleValue(id, value))
}

// Writes a sample's echo line from a handler (never while drawing)
function echoTo($, id, text) {
  return update($, { ...ECHO, id }, () => text)
}

// Reading an echo while drawing subscribes the pane, so a write redraws it
async function echoOf($, id) {
  return (await read($, { ...ECHO, id })) ?? 'まだ何もしていない'
}

// Whether a tree holds an element of the given type. The table a surface hands out may be
// completed with every element name, an absent one drawing a fragment (a column Box), so a
// name being in the table is not enough to say the surface draws it.
function containsType(node, type) {
  if (!node || typeof node !== 'object') return false
  if (node.type === type) return true
  return (node.children ?? []).some(child => containsType(child, type))
}

const svgBadge = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48" viewBox="0 0 160 48">',
  '<rect x="1" y="1" width="158" height="46" rx="8" fill="#2b6cb0" stroke="#90cdf4" stroke-width="2"/>',
  '<circle cx="24" cy="24" r="12" fill="#f6ad55"/>',
  '<text x="46" y="30" font-family="sans-serif" font-size="16" fill="#ffffff">[Pane/Svg]</text>',
  '</svg>',
].join('')

const svgInteractive = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48" viewBox="0 0 160 48">',
  '<style>.dot { fill: #48bb78 } .dot:hover { fill: #e53e3e }</style>',
  '<title>[Pane/Svg] isInteractive: tooltip</title>',
  '<rect x="1" y="1" width="158" height="46" rx="8" fill="#1a202c" stroke="#a0aec0"/>',
  '<circle class="dot" cx="24" cy="24" r="12">',
  '<animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite"/>',
  '</circle>',
  '<text x="46" y="30" font-family="sans-serif" font-size="14" fill="#ffffff">hover me</text>',
  '</svg>',
].join('')

const markdownText = [
  '### [Pane/Markdown] 見出し',
  '',
  '**太字** と *斜体* と `インラインコード`',
  '',
  '- 箇条書き 1',
  '- 箇条書き 2',
  '',
  '| 列 A | 列 B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```js',
  'const answer = 42',
  '```',
  '',
  `[example.com へのリンク](${LINK_HREF})`,
].join('\n')

const diffSource = [
  '--- a/greet.js',
  '+++ b/greet.js',
  '@@ -1,3 +1,3 @@',
  ' function greet(name) {',
  "-  return 'Hello, ' + name",
  "+  return 'こんにちは、' + name",
  ' }',
].join('\n')

/**
 * The sample of one 'element' row of SITES: a list of nodes drawn under its heading.
 * One function with a switch rather than a table of closures: the engine follows $ only into
 * functions declared in this file, called by name.
 */
async function drawSample($, table, id) {
  const { Box, Text } = table
  const note = text => Text({ dimColor: true, children: [text] })
  const row = children => Box({ flexDirection: 'row', columnGap: 1, alignItems: 'center', flexWrap: 'wrap', children })

  switch (id) {
    // ===== [Pane/Text] Text { color, backgroundColor, bold, dimColor, italic, underline, strikethrough, inverse, wrap, hover } =====
    case 'Pane/Text': {
      return [
        row([
          Text({ color: 'success', children: ['color: success'] }),
          Text({ color: 'warning', children: ['color: warning'] }),
          Text({ color: '#4f8cc9', children: ['color: #4f8cc9'] }),
          Text({ backgroundColor: '#553c9a', color: '#ffffff', children: ['backgroundColor'] }),
        ]),
        row([
          Text({ bold: true, children: ['bold'] }),
          Text({ dimColor: true, children: ['dimColor'] }),
          Text({ italic: true, children: ['italic'] }),
          Text({ underline: true, children: ['underline'] }),
          Text({ strikethrough: true, children: ['strikethrough'] }),
          Text({ inverse: true, children: ['inverse'] }),
        ]),
        Text({
          children: ['入れ子: ', Text({ bold: true, children: ['太字の中に '] }), Text({ color: 'success', children: ['色'] })],
        }),
        Box({
          width: 24,
          children: [Text({ wrap: 'truncate-end', children: ['wrap: truncate-end の長い行は幅 24 で切られて末尾が省略される'] })],
        }),
        // A Text's hover applies under the nearest keyed Box
        Box({
          key: 'text-hover',
          children: [Text({ hover: { color: 'warning', bold: true }, children: ['hover: この行にポインタを載せると色が変わる'] })],
        }),
      ]
    }

    // ===== [Pane/Box] Box { borderStyle, borderColor, borderDimColor, backgroundColor, padding, hover, position, display } =====
    case 'Pane/Box': {
      return [
        row([
          Box({ borderStyle: 'single', paddingX: 1, children: [Text({ children: ['single'] })] }),
          Box({ borderStyle: 'round', borderColor: 'success', paddingX: 1, children: [Text({ children: ['round + borderColor'] })] }),
          Box({ borderStyle: 'double', borderDimColor: true, paddingX: 1, children: [Text({ children: ['double + borderDimColor'] })] }),
          Box({ borderStyle: 'bold', paddingX: 1, children: [Text({ children: ['bold'] })] }),
        ]),
        Box({ backgroundColor: '#2c5282', padding: 1, children: [Text({ color: '#ffffff', children: ['backgroundColor + padding: 1'] })] }),
        // hover restyles the keyed Box itself while the pointer is over it
        Box({
          key: 'box-hover',
          borderStyle: 'round',
          paddingX: 1,
          hover: { borderColor: 'warning', backgroundColor: '#744210' },
          children: [Text({ children: ['hover: 枠と背景の色が変わる'] })],
        }),
        // A card drawn display: none, revealed by hover over the glyph, placed absolute so
        // revealing it moves nothing
        Box({
          key: 'box-card',
          children: [
            Text({ children: ['position: absolute: ここにポインタを載せると、上にカードが重なって出る'] }),
            Box({
              position: 'absolute',
              top: -3,
              left: 4,
              display: 'none',
              borderStyle: 'round',
              backgroundColor: '#1a202c',
              paddingX: 1,
              hover: { display: 'flex' },
              children: [Text({ children: ['[Pane/Box] 重なったカード'] })],
            }),
          ],
        }),
        // Two Texts in one hover scope: hovering either lights both
        row([
          Text({ hover: { scope: 'ui-sampler-scope', inverse: true }, children: ['hover.scope: こちら'] }),
          Text({ children: ['と'] }),
          Text({ hover: { scope: 'ui-sampler-scope', inverse: true }, children: ['こちらは一緒に光る'] }),
        ]),
      ]
    }

    // ===== [Pane/Button] Button { variant, plain, hotkey, dimColor, autoFocus, role, hover } =====
    case 'Pane/Button': {
      const pressed = label => press => echoTo($, 'Pane/Button', `押したボタン: ${label}（e.surface: ${press.surface}）`)
      return [
        row([
          table.Button({ key: 'btn-default', label: '既定', onPress: pressed('既定') }),
          table.Button({ key: 'btn-primary', label: 'variant: primary', variant: 'primary', onPress: pressed('variant: primary') }),
          table.Button({ key: 'btn-secondary', label: 'variant: secondary', variant: 'secondary', onPress: pressed('variant: secondary') }),
          table.Button({ key: 'btn-dim', label: 'dimColor', dimColor: true, onPress: pressed('dimColor') }),
          table.Button({ key: 'btn-autofocus', label: 'autoFocus', autoFocus: true, onPress: pressed('autoFocus') }),
        ]),
        row([
          table.Button({ key: 'btn-plain', label: 'plain', plain: true, onPress: pressed('plain') }),
          table.Button({ key: 'btn-plain-hotkey', label: 'plain + hotkey 1', plain: true, hotkey: '1', onPress: pressed('plain + hotkey 1') }),
          table.Button({ key: 'btn-hotkey', label: 'hotkey w', hotkey: 'w', onPress: pressed('hotkey w') }),
        ]),
        // A Button's hover applies under the nearest keyed Box
        Box({
          key: 'btn-hover-box',
          flexDirection: 'row',
          columnGap: 1,
          alignItems: 'center',
          children: [
            table.Button({ key: 'btn-hover', label: 'hover', hover: { color: 'warning', bold: true }, onPress: pressed('hover') }),
            note('この行にポインタを載せるとラベルの色が変わる'),
          ],
        }),
        row([
          table.Button({
            key: 'btn-dismiss',
            label: 'role: dismiss（このパネルを閉じる）',
            role: 'dismiss',
            onPress: () => $.ui.close({ id: ELEMENTS_PANE }),
          }),
          note('デスクトップでは枠の端に閉じるボタンとして出る、と型定義にある'),
        ]),
        note(await echoOf($, 'Pane/Button')),
      ]
    }

    // ===== [Pane/Button/action] Button { action: 'app:cycleDiffBase' } =====
    // An unknown action name refuses the tree, so this has a switch of its own
    case 'Pane/Button/action': {
      return [
        row([
          table.Button({
            key: 'btn-action',
            label: 'action: app:cycleDiffBase',
            action: 'app:cycleDiffBase',
            onPress: press => echoTo($, 'Pane/Button/action', `押された（e.surface: ${press.surface}）`),
          }),
          note('プロンプトでその操作のキーを押しても押される'),
        ]),
        note(await echoOf($, 'Pane/Button/action')),
      ]
    }

    // ===== [Pane/Input] Input { label, placeholder, submitLabel, value, onInput, onSubmit } =====
    case 'Pane/Input': {
      return [
        table.Input({
          key: 'input-echo',
          label: '[Pane/Input]',
          placeholder: 'ここに入力（placeholder）',
          submitLabel: '写す',
          onInput: value => echoTo($, 'Pane/Input:change', value),
          onSubmit: value => echoTo($, 'Pane/Input:submit', value),
        }),
        note('入力中（onInput）: ' + (await echoOf($, 'Pane/Input:change'))),
        note('Enter で確定（onSubmit）: ' + (await echoOf($, 'Pane/Input:submit'))),
        table.Input({
          key: 'input-value',
          label: 'value あり',
          value: '最初から入っている文字',
          onSubmit: value => echoTo($, 'Pane/Input:submit', value),
        }),
      ]
    }

    // ===== [Pane/Select] Select { label, options, value, onSelect } =====
    case 'Pane/Select': {
      const picked = await read($, { ...ECHO, id: 'Pane/Select' })
      return [
        table.Select({
          key: 'select-echo',
          label: '[Pane/Select] 色',
          options: [
            { value: 'red', label: '赤' },
            { value: 'blue', label: '青' },
            { value: 'green' },
          ],
          value: picked ?? 'red',
          onSelect: value => echoTo($, 'Pane/Select', value),
        }),
        note('選んだ値（onSelect）: ' + (picked ?? 'まだ選んでいない（value: red）') + '。green は label なしなので値がそのまま出る'),
      ]
    }

    // ===== [Pane/Link] Link { href, label, children } =====
    case 'Pane/Link': {
      return [
        Text({ children: ['文中の ', table.Link({ href: LINK_HREF, children: ['children のリンク'] }), ' です'] }),
        Text({ children: [table.Link({ href: LINK_HREF, label: 'label のリンク' })] }),
        Text({ children: ['どちらもなし: ', table.Link({ href: LINK_HREF })] }),
        Text({ children: ['localhost: ', table.Link({ href: 'http://localhost:3000/', label: 'http://localhost:3000/' })] }),
      ]
    }

    // ===== [Pane/Code] Code { source, language, path, startLine, format, wrap } =====
    case 'Pane/Code': {
      return [
        note('language: js + startLine: 10'),
        table.Code({ source: "function greet(name) {\n  return 'こんにちは、' + name\n}", language: 'js', startLine: 10 }),
        note('path: example.py（language なし、拡張子から推測）'),
        table.Code({ source: 'def greet(name):\n    return f"こんにちは、{name}"', path: 'example.py' }),
        note("format: 'diff'"),
        table.Code({ source: diffSource, format: 'diff' }),
        note("wrap: 'truncate-end'"),
        table.Code({
          source: "const message = 'この行は長いので、パネルの幅に収まらなければ末尾が省略されるはずです。' + '続き'.repeat(20)",
          language: 'js',
          wrap: 'truncate-end',
        }),
      ]
    }

    // ===== [Pane/Markdown] Markdown { text, dimColor, key, onLinkPress, pressableLinks } =====
    case 'Pane/Markdown': {
      return [
        table.Markdown({ text: markdownText }),
        table.Markdown({ text: 'dimColor: 全体が *薄く* 出る', dimColor: true }),
        table.Markdown({
          key: 'md-press',
          text: `onLinkPress: [押すと下に写るリンク](${PRESSABLE_HREF}) と [ふつうに開くリンク](${LINK_HREF})`,
          pressableLinks: [PRESSABLE_HREF],
          onLinkPress: (link, press) => echoTo($, 'Pane/Markdown', `押されたリンク: ${link.href}（e.surface: ${press.surface}）`),
        }),
        note(await echoOf($, 'Pane/Markdown')),
      ]
    }

    // ===== [Pane/Svg] Svg { source, alt, width, height, isInteractive } =====
    case 'Pane/Svg': {
      return [
        row([
          table.Svg({ source: svgBadge, alt: '[Pane/Svg] 画像として描いた SVG' }),
          note('画像として（160×48）'),
        ]),
        row([
          table.Svg({ source: svgBadge, alt: '[Pane/Svg] 縮めた SVG', width: 80, height: 24 }),
          note('width: 80, height: 24'),
        ]),
        row([
          table.Svg({ source: svgInteractive, alt: '[Pane/Svg] isInteractive の SVG', isInteractive: true }),
          note('isInteractive: 丸が動き、ポインタで赤くなり、ツールチップが出る'),
        ]),
      ]
    }

    default:
      return [note('未対応: ' + id)]
  }
}

export function registerElements(on) {
  // ===== [ElementsPane] ui.render { component: 'Pane', requestId: 'ui-sampler-elements' } =====
  // The matcher is ELEMENTS_PANE's value as a literal, so `plugin validate` can list it
  on('ui.render', { component: 'Pane', requestId: 'ui-sampler-elements' }, async ($, e) => {
    noteRender($, 'ElementsPane', e)
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const dim = (key, text) => Text({ key, dimColor: true, children: [text] })

    const sections = []
    for (const site of SITES) {
      if (site.kind !== 'element') continue
      const isSiteOn = await isOn($, site.id)
      const heading = Box({
        flexDirection: 'row',
        columnGap: 1,
        alignItems: 'center',
        children: [
          Text({ bold: true, children: [site.label] }),
          Button({
            key: keyOf('toggle', site.id),
            label: isSiteOn ? 'オン' : 'オフ',
            variant: isSiteOn ? 'primary' : 'secondary',
            onPress: () => toggle($, site.id),
          }),
        ],
      })

      let body
      if (!isSiteOn) {
        body = [dim(keyOf('off', site.id), 'オフにしてあるので描いていない')]
      } else if (typeof table[site.element] !== 'function') {
        body = [Text({ color: 'warning', children: [`${site.label} この surface にはない（表に ${site.element} がない）`] })]
      } else {
        const sample = await drawSample($, table, site.id)
        if (sample.some(node => containsType(node, site.element))) {
          noteCall(site.id, e.surface)
          body = sample
        } else {
          body = [Text({ color: 'warning', children: [`${site.label} この surface にはない（表の ${site.element} が別の要素を返した）`] })]
        }
      }

      sections.push(
        Box({
          key: keyOf('sample', site.id),
          flexDirection: 'column',
          children: [heading, dim(keyOf('where', site.id), site.where), ...body],
        }),
      )
    }

    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: [
        Text({ bold: true, children: ['[ElementsPane] 部品の見本'] }),
        Box({
          flexDirection: 'column',
          children: [
            dim('surface', 'e.surface: ' + e.surface),
            dim('table', '$.ui.resolve(e) の表: ' + Object.keys(table).join(', ')),
            dim('howto', 'このパネルが出ないときは、最初のパネルの一覧で [Pane/…] を 1 つずつオフにすると、どれが断られているか分かる'),
          ],
        }),
        ...sections,
        Button({ key: 'close', label: '閉じる', onPress: () => $.ui.close({ id: ELEMENTS_PANE }) }),
      ],
    })
  })
}
