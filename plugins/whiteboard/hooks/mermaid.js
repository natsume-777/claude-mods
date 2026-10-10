// A small mermaid drawer for the cards' ```mermaid fences (pure: no $ here).
//
// The desktop's Markdown shows a mermaid fence as a code block, so the ones this file can read
// are drawn as an SVG for the `Svg` element instead; anything else (another kind of diagram,
// something it cannot parse, a diagram too big) gives null and the fence stays a code block.
//
// Read: flowchart / graph with the directions TD TB BT LR RL; nodes `A`, `A[text]`, `A(text)`,
// `A((text))`, `A([text])`, `A{text}`, with quotes in the text allowed; edges `-->` `---` `-.->`
// `-.-` `==>` `===`, `-- text -->`, `-->|text|`; chains `A --> B --> C`; `A & B --> C`; `;` and
// newlines; `%%` comments; `style`, `classDef`, `class`, `linkStyle` and `click` lines are
// skipped. `subgraph id`, `subgraph id[title]`, `subgraph id["title"]`, `subgraph title words`
// up to `end`, nested, with `direction` inside one read but not followed. A node belongs to the
// innermost subgraph whose own lines mention it first (as mermaid: the subgraph closed first wins).
// An edge to or from a subgraph itself (`A --> sg1`) is not drawn: the diagram gives null, as do a
// `direction` outside a subgraph, an empty subgraph and any other syntax.
// Also sequenceDiagram with participants / actors and the arrows `->>` `-->>` `->` `-->` `-x`
// `--x` `-)` `--)` with a message; notes, loops, activations and the rest give null.
//
// Drawn: layers by the longest path (a cycle's back edge is drawn as a returning curve), nodes
// filled and edges and labels on their own small fills, so it reads on a light and a dark theme.
// A subgraph is a faint rounded box around its members with its title on a small fill in the band
// at the top of the box, left-most where no edge crosses it (a box whose band has no such place is
// widened and laid out again); its members are kept side by side in each layer and the boxes of
// one level are packed next to each other, so they never cross. If the boxes still came out
// crossing a node or each other, or a title still had no clear place, the diagram gives null
// rather than a misleading picture.

import { cells } from './board.js'

/** What a diagram may be at most; a bigger one is left as code. */
export const MERMAID_LIMITS = {
  nodes: 30,
  edges: 60,
  label: 80,
  messages: 40,
  subgraphs: 12,
}

// ---- Parsing

const ID = /^[A-Za-z0-9_぀-ヿ㐀-鿿０-９Ａ-Ｚａ-ｚ]+/

// The shapes: opener, closer, shape. The longer openers first
const SHAPES = [
  ['((', '))', 'circle'],
  ['([', '])', 'stadium'],
  ['[[', ']]', 'rect'],
  ['{{', '}}', 'rect'],
  ['[(', ')]', 'rect'],
  ['[', ']', 'rect'],
  ['(', ')', 'round'],
  ['{', '}', 'diamond'],
]

// The edge forms, the dotted and thick before the plain: [pattern, style, hasHead]
const CONNECTORS = [
  [/^-\.+->/, 'dotted', true],
  [/^-\.+-/, 'dotted', false],
  [/^={2,}>/, 'thick', true],
  [/^={3,}/, 'thick', false],
  [/^-{2,}>/, 'normal', true],
  [/^-{3,}/, 'normal', false],
]

// `-- text -->`: a start, the text, an end
const LABELLED = /^(--|==|-\.)\s+(.+?)\s+(\.+->|\.+-(?!>)|-\.+->|-\.+-|={2,}>|={3,}|-{2,}>|-{3,})/

/** A label as lines: <br> is a line break, quotes and blanks dropped. */
const labelOf = (t) =>
  String(t)
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, all) => l !== '' || all.length === 1)
    .join('\n')
    .trim()

// Splits a source into statements: newlines, and `;` outside brackets and quotes
function statementsOf(source) {
  const out = []
  for (const raw of String(source).split(/\r?\n/)) {
    let line = ''
    let depth = 0
    let quoted = false
    for (const ch of raw) {
      if (ch === '"') quoted = !quoted
      if (!quoted) {
        if ('[({'.includes(ch)) depth++
        if ('])}'.includes(ch)) depth = Math.max(0, depth - 1)
        if (ch === ';' && depth === 0) {
          out.push(line.trim())
          line = ''
          continue
        }
      }
      line += ch
    }
    out.push(line.trim())
  }
  return out.filter((s) => s !== '' && !s.startsWith('%%'))
}

// The shape at s[i], or null: { shape, text, end }
function shapeAt(s, i) {
  for (const [open, close, shape] of SHAPES) {
    if (!s.startsWith(open, i)) continue
    const k = i + open.length
    if (s[k] === '"') {
      const q = s.indexOf('"', k + 1)
      if (q < 0 || !s.startsWith(close, q + 1)) return null
      return { shape, text: s.slice(k + 1, q), end: q + 1 + close.length }
    }
    const c = s.indexOf(close, k)
    if (c < 0) return null
    return { shape, text: s.slice(k, c), end: c + close.length }
  }
  return null
}

// A node at s[i]: { id, text?, shape?, end }, or null
function nodeAt(s, i) {
  const m = ID.exec(s.slice(i))
  if (!m) return null
  let end = i + m[0].length
  const shaped = shapeAt(s, end)
  if (shaped) end = shaped.end
  const klass = /^:::[A-Za-z0-9_-]+/.exec(s.slice(end))
  if (klass) end += klass[0].length
  return { id: m[0], ...(shaped ? { text: shaped.text, shape: shaped.shape } : {}), end }
}

// An edge at s[i] (after blanks): { style, hasHead, label, end }, or null
function connectorAt(s, i) {
  const rest = s.slice(i)
  const named = LABELLED.exec(rest)
  if (named) {
    const style = named[1] === '==' ? 'thick' : named[1] === '-.' ? 'dotted' : 'normal'
    return { style, hasHead: named[3].endsWith('>'), label: named[2], end: i + named[0].length }
  }
  for (const [pattern, style, hasHead] of CONNECTORS) {
    const m = pattern.exec(rest)
    if (!m) continue
    let end = i + m[0].length
    let label = ''
    const piped = /^\s*\|([^|]*)\|/.exec(s.slice(end))
    if (piped) {
      label = piped[1]
      end += piped[0].length
    }
    return { style, hasHead, label, end }
  }
  return null
}

const skipBlanks = (s, i) => {
  while (s[i] === ' ' || s[i] === '\t') i++
  return i
}

const named = (id, title) => ({ id, label: labelOf(title).replace(/\n/g, ' ') || id })

// What follows `subgraph`: { id, label }, or null. `id`, `id[title]`, `id ["title"]`, `"title"`,
// and a bare title of several words, which is its own id (no edge can name it)
function subgraphHead(rest) {
  if (rest === '') return null
  const quoted = /^"([^"]*)"$/.exec(rest)
  if (quoted) return named(quoted[1], quoted[1])
  const m = ID.exec(rest)
  if (m) {
    const after = rest.slice(m[0].length).trim()
    if (after === '') return named(m[0], m[0])
    if (after.startsWith('[')) {
      const t = /^\[\s*(?:"([^"]*)"|([^\]"]*))\s*\]$/.exec(after)
      return t ? named(m[0], t[1] ?? t[2]) : null
    }
  }
  if (/[[\](){}"|]/.test(rest)) return null
  return named(rest, rest)
}

/** Parses a flowchart / graph; null when it is not one or uses what is not read. */
function parseFlowchart(source) {
  const statements = statementsOf(source)
  const header = /^(?:flowchart|graph)(?:\s+(TD|TB|BT|LR|RL))?$/i.exec(statements[0] ?? '')
  if (!header) return null
  const direction = (header[1] ?? 'TD').toUpperCase().replace('TB', 'TD')
  const nodes = []
  const edges = []
  // The subgraphs in the order they open: { id, label, parent, nodes }, nodes being the ones
  // directly in it; `open` are those not closed yet (innermost last), `owned` the nodes given out
  const subgraphs = []
  const open = []
  const mentioned = new Map()
  const owned = new Set()
  const find = (id) => nodes.find((n) => n.id === id)
  const note = (n) => {
    let node = find(n.id)
    if (!node) {
      if (nodes.length >= MERMAID_LIMITS.nodes) return null
      node = { id: n.id, label: n.id, shape: 'rect' }
      nodes.push(node)
    }
    if (n.text !== undefined) {
      node.label = labelOf(n.text) || n.id
      node.shape = n.shape
    }
    const inner = open.at(-1)
    if (inner && !mentioned.get(inner).includes(node.id)) mentioned.get(inner).push(node.id)
    return node
  }
  for (const s of statements.slice(1)) {
    if (/^(style|classDef|class|linkStyle|click)\b/.test(s)) continue
    if (/^subgraph\b/.test(s)) {
      const head = subgraphHead(s.slice('subgraph'.length).trim())
      if (!head || subgraphs.length >= MERMAID_LIMITS.subgraphs || subgraphs.some((g) => g.id === head.id)) return null
      const group = { ...head, parent: open.at(-1)?.id ?? null, nodes: [] }
      subgraphs.push(group)
      open.push(group)
      mentioned.set(group, [])
      continue
    }
    if (/^end\b/.test(s)) {
      if (s !== 'end' || open.length === 0) return null
      // The nodes its own lines mention that no subgraph closed before took
      const group = open.pop()
      group.nodes = mentioned.get(group).filter((id) => !owned.has(id))
      for (const id of group.nodes) owned.add(id)
      continue
    }
    if (/^direction\b/.test(s)) {
      // Read inside a subgraph, but the layout keeps the diagram's direction
      if (open.length === 0 || !/^direction\s+(TB|TD|BT|LR|RL)$/i.test(s)) return null
      continue
    }
    let i = 0
    let previous = null
    for (;;) {
      // A group of nodes: A & B & C
      const group = []
      for (;;) {
        i = skipBlanks(s, i)
        const n = nodeAt(s, i)
        if (!n) return null
        const node = note(n)
        if (!node) return null
        group.push(node)
        i = skipBlanks(s, n.end)
        if (s[i] === '&') {
          i++
          continue
        }
        break
      }
      if (previous) {
        for (const from of previous.group) {
          for (const to of group) edges.push({ from: from.id, to: to.id, ...previous.edge })
        }
      }
      if (i >= s.length) break
      const edge = connectorAt(s, i)
      if (!edge) return null
      previous = { group, edge: { style: edge.style, hasHead: edge.hasHead, label: labelOf(edge.label) } }
      i = edge.end
    }
    if (edges.length > MERMAID_LIMITS.edges) return null
  }
  if (nodes.length === 0 || nodes.some((n) => [...n.label].length > MERMAID_LIMITS.label)) return null
  if (edges.some((e) => [...e.label].length > MERMAID_LIMITS.label)) return null
  if (open.length > 0) return null
  // An edge to a subgraph itself (a node of its id) is not drawn; nor is a subgraph with no node
  if (subgraphs.some((g) => find(g.id) || [...g.label].length > MERMAID_LIMITS.label)) return null
  const holds = (g) => g.nodes.length > 0 || subgraphs.some((c) => c.parent === g.id && holds(c))
  if (!subgraphs.every(holds)) return null
  return { kind: 'flowchart', direction, nodes, edges, subgraphs }
}

const MESSAGE = /^([^\s:+-]+?)\s*(--?>>|--?>|--?x|--?\))\s*[+-]?\s*([^\s:]+?)\s*:\s*(.*)$/
const PARTICIPANT = /^(?:participant|actor)\s+([^\s]+)(?:\s+as\s+(.+))?$/

/** Parses a sequence diagram of participants and messages; null otherwise. */
function parseSequence(source) {
  const statements = statementsOf(source)
  if (!/^sequenceDiagram$/i.test(statements[0] ?? '')) return null
  const participants = []
  const messages = []
  const touch = (id, label) => {
    let p = participants.find((x) => x.id === id)
    if (!p) {
      if (participants.length >= MERMAID_LIMITS.nodes) return null
      p = { id, label: id }
      participants.push(p)
    }
    if (label) p.label = labelOf(label) || id
    return p
  }
  for (const s of statements.slice(1)) {
    const decl = PARTICIPANT.exec(s)
    if (decl) {
      if (!touch(decl[1], decl[2])) return null
      continue
    }
    const m = MESSAGE.exec(s)
    if (!m) return null
    if (!touch(m[1]) || !touch(m[3])) return null
    messages.push({ from: m[1], to: m[3], isDashed: m[2].startsWith('--'), hasHead: m[2].endsWith('>>') || m[2].endsWith('x') || m[2].endsWith(')'), text: labelOf(m[4]) })
    if (messages.length > MERMAID_LIMITS.messages) return null
  }
  if (participants.length === 0 || messages.length === 0) return null
  if (participants.some((p) => [...p.label].length > MERMAID_LIMITS.label)) return null
  return { kind: 'sequence', participants, messages }
}

/** The model of a mermaid source (a flowchart or a sequence diagram), or null for anything not read. */
export function parseMermaid(source) {
  try {
    return parseFlowchart(source) ?? parseSequence(source)
  } catch {
    return null
  }
}

// ---- Layout of a flowchart

const CHAR = 7 // pixels per character cell of the labels (13px type)
const LINE = 17 // pixels per line of a label

const linesOf = (label) => String(label).split('\n')
const textWidth = (label) => Math.max(...linesOf(label).map((l) => cells(l))) * CHAR

/** The pixel size of a node by its shape and label. */
export function sizeOf(node) {
  const w = textWidth(node.label) + 24
  const h = LINE * linesOf(node.label).length + 14
  if (node.shape === 'diamond') return { w: Math.max(56, w * 1.5), h: Math.max(44, h * 1.7) }
  if (node.shape === 'circle') return { w: Math.max(48, w * 1.25), h: Math.max(44, h * 1.5) }
  return { w: Math.max(40, w), h: Math.max(30, h) }
}

/**
 * Layers by the longest path, the edges that close a cycle left out of it:
 * { layers: id[][], isBack: Set of edge indexes, layerOf: Map }.
 */
export function layersOf(model) {
  const ids = model.nodes.map((n) => n.id)
  const out = new Map(ids.map((id) => [id, []]))
  model.edges.forEach((e, i) => {
    if (e.from !== e.to) out.get(e.from).push({ to: e.to, index: i })
  })
  // Depth first in the order the nodes appeared: an edge to a node still open is a back edge
  const state = new Map()
  const isBack = new Set()
  const visit = (id) => {
    state.set(id, 1)
    for (const { to, index } of out.get(id)) {
      if (state.get(to) === 1) isBack.add(index)
      else if (!state.has(to)) visit(to)
    }
    state.set(id, 2)
  }
  for (const id of ids) if (!state.has(id)) visit(id)
  const preds = new Map(ids.map((id) => [id, []]))
  model.edges.forEach((e, i) => {
    if (e.from !== e.to && !isBack.has(i)) preds.get(e.to).push(e.from)
  })
  const layerOf = new Map()
  const depth = (id) => {
    if (!layerOf.has(id)) layerOf.set(id, preds.get(id).reduce((m, p) => Math.max(m, depth(p) + 1), 0))
    return layerOf.get(id)
  }
  ids.forEach(depth)
  const layers = []
  for (const id of ids) (layers[layerOf.get(id)] ??= []).push(id)
  // With subgraphs, each subgraph's members are kept together in every layer after each step
  const regroup = groupOrder(model)
  if (regroup) layers.forEach((l, li) => (layers[li] = regroup(l)))
  // Order inside a layer by the mean place of the neighbours (two sweeps down and up)
  const place = new Map()
  const mark = () => layers.forEach((l) => l.forEach((id, k) => place.set(id, k)))
  mark()
  const succs = new Map(ids.map((id) => [id, []]))
  model.edges.forEach((e, i) => {
    if (e.from !== e.to && !isBack.has(i)) succs.get(e.from).push(e.to)
  })
  const sweep = (list, neighbours) => {
    const keyed = list.map((id, k) => {
      const near = neighbours.get(id)
      return { id, k, key: near.length ? near.reduce((s, n) => s + place.get(n), 0) / near.length : place.get(id) }
    })
    keyed.sort((a, b) => a.key - b.key || a.k - b.k)
    return keyed.map((x) => x.id)
  }
  const step = (list, neighbours) => (regroup ? regroup(sweep(list, neighbours)) : sweep(list, neighbours))
  for (let round = 0; round < 2; round++) {
    for (let l = 1; l < layers.length; l++) {
      layers[l] = step(layers[l], preds)
      mark()
    }
    for (let l = layers.length - 2; l >= 0; l--) {
      layers[l] = step(layers[l], succs)
      mark()
    }
  }
  return { layers, isBack, layerOf }
}

// The subgraphs a node is in, outermost first: Map id -> subgraph ids (none for a node outside)
function chainsOf(model) {
  const parent = new Map(model.subgraphs.map((g) => [g.id, g.parent]))
  const chains = new Map()
  for (const g of model.subgraphs) {
    const chain = []
    for (let at = g.id; at !== null; at = parent.get(at)) chain.unshift(at)
    for (const id of g.nodes) chains.set(id, chain)
  }
  return chains
}

// A function that reorders a layer so each subgraph's members are next to each other (nested
// ones inside theirs), the groups and the loose nodes ordered by their mean place; null without
// subgraphs
function groupOrder(model) {
  if (!model.subgraphs?.length) return null
  const chains = chainsOf(model)
  const arrange = (ids, depth) => {
    const order = []
    const byKey = new Map()
    ids.forEach((id, k) => {
      const chain = chains.get(id) ?? []
      const key = depth < chain.length ? 'g' + chain[depth] : 'n' + id
      if (!byKey.has(key)) {
        byKey.set(key, { isGroup: depth < chain.length, ids: [], sum: 0, first: order.length })
        order.push(byKey.get(key))
      }
      const g = byKey.get(key)
      g.ids.push(id)
      g.sum += k
    })
    order.sort((a, b) => a.sum / a.ids.length - b.sum / b.ids.length || a.first - b.first)
    return order.flatMap((g) => (g.isGroup ? arrange(g.ids, depth + 1) : g.ids))
  }
  return (list) => arrange(list, 0)
}

/**
 * Places the nodes: { boxes: Map id -> { x, y, w, h, shape, label } (centres), groups, layers,
 * isBack, layerOf }. `groups` are the subgraphs' boxes (see layoutGrouped), none without
 * subgraphs; null when they would not fit.
 */
export function layoutFlowchart(model, lanes = new Map()) {
  if (model.subgraphs?.length) return layoutGrouped(model, lanes)
  const { layers, isBack, layerOf } = layersOf(model)
  const isVertical = model.direction === 'TD' || model.direction === 'BT'
  const sizes = new Map(model.nodes.map((n) => [n.id, sizeOf(n)]))
  const main = (id) => (isVertical ? sizes.get(id).h : sizes.get(id).w)
  const cross = (id) => (isVertical ? sizes.get(id).w : sizes.get(id).h)
  const gapMain = isVertical ? 46 : 64
  const gapCross = 28
  const bandOf = layers.map((l) => Math.max(...l.map(main)))
  const totalOf = layers.map((l) => l.reduce((s, id) => s + cross(id), 0) + gapCross * (l.length - 1))
  const widest = Math.max(...totalOf)
  const length = bandOf.reduce((s, b) => s + b, 0) + gapMain * (layers.length - 1)
  const boxes = new Map()
  let at = 0
  layers.forEach((l, li) => {
    let c = (widest - totalOf[li]) / 2
    for (const id of l) {
      const m = at + bandOf[li] / 2
      const k = c + cross(id) / 2
      // BT and RL run the layers the other way
      const mm = model.direction === 'BT' || model.direction === 'RL' ? length - m : m
      const node = model.nodes.find((n) => n.id === id)
      boxes.set(id, { ...sizes.get(id), x: isVertical ? k : mm, y: isVertical ? mm : k, shape: node.shape, label: node.label })
      c += cross(id) + gapCross
    }
    at += bandOf[li] + gapMain
  })
  return { boxes, groups: [], layers, isBack, layerOf }
}

// ---- Layout of a flowchart with subgraphs

// A subgraph's box: the padding around its members (`top` on the title's side), the title chip
// in its top-left corner, and the room kept between a box's edge and what is outside it
const GROUP = { pad: 12, top: 34, chipX: 8, chipY: 6, chipH: 18, clear: 14 }
const chipWidth = (label) => textWidth(label) + 12
const titleRoom = (label) => chipWidth(label) + 2 * GROUP.chipX

/**
 * The layout with subgraphs. The layers and their order are those of layersOf (each subgraph's
 * members kept together); across the layers, the items of one level (the loose nodes and the
 * subgraphs) are packed in their order, a subgraph as one block over all the layers it covers,
 * so sibling boxes lie side by side; along the layers, the gaps grow to make room for the boxes'
 * padding. Each group: { id, label, parent, depth, members (all node ids inside), x, y, w, h
 * (top-left corner and size), chip: { x, y, w, h } }. Null when the result does not pass
 * groupsFit. `lanes` (subgraph id -> pixels) widens a box by that much on its starting side
 * across the title band (left for TD / BT, along the layers' start for LR / RL), its members kept
 * clear of it: the room placeChips finds for a title the edges left no gap for.
 */
function layoutGrouped(model, lanes = new Map()) {
  const { layers, isBack, layerOf } = layersOf(model)
  const isVertical = model.direction === 'TD' || model.direction === 'BT'
  const isReversed = model.direction === 'BT' || model.direction === 'RL'
  const sizes = new Map(model.nodes.map((n) => [n.id, sizeOf(n)]))
  const main = (id) => (isVertical ? sizes.get(id).h : sizes.get(id).w)
  const cross = (id) => (isVertical ? sizes.get(id).w : sizes.get(id).h)
  const gapMain = isVertical ? 46 : 64
  const gapCross = 28
  // A box's padding: along the layers (in their order, before flipping BT / RL) and across them;
  // the title's side gets `top`
  const padMainStart = model.direction === 'TD' ? GROUP.top : GROUP.pad
  const padMainEnd = model.direction === 'BT' ? GROUP.top : GROUP.pad
  const padCrossStart = isVertical ? GROUP.pad : GROUP.top
  const padCrossEnd = GROUP.pad

  // Where the plain layout would put each node across: it orders the items below
  const totalOf = layers.map((l) => l.reduce((s, id) => s + cross(id), 0) + gapCross * (l.length - 1))
  const widest = Math.max(...totalOf)
  const guess = new Map()
  layers.forEach((l, li) => {
    let c = (widest - totalOf[li]) / 2
    for (const id of l) {
      guess.set(id, c + cross(id) / 2)
      c += cross(id) + gapCross
    }
  })

  // Across: pack the items of one level, then place them
  const nodeIndex = new Map(model.nodes.map((n, i) => [n.id, i]))
  const owned = new Set(model.subgraphs.flatMap((g) => g.nodes))
  const childrenOf = (parent) => model.subgraphs.filter((g) => g.parent === parent)
  const descendants = new Map()
  const nodeItem = (id) => ({ id, ids: [id], width: cross(id) })
  const groupItem = (g) => {
    const inner = pack(itemsOf(g))
    const content = isVertical ? Math.max(inner.width, titleRoom(g.label) - padCrossStart - padCrossEnd) : inner.width
    const ids = inner.items.flatMap((it) => it.ids)
    descendants.set(g.id, ids)
    const lane = isVertical ? lanes.get(g.id) ?? 0 : 0
    return { id: g.id, group: g, ids, inner, width: padCrossStart + lane + content + padCrossEnd, offset: padCrossStart + lane + (content - inner.width) / 2 }
  }
  const itemsOf = (g) => [
    ...childrenOf(g ? g.id : null).map(groupItem),
    ...(g ? g.nodes : model.nodes.map((n) => n.id).filter((id) => !owned.has(id))).map(nodeItem),
  ]
  // Items in their order, each started as far as the others of its layers allow and no further
  // than where a centred row would put it
  function pack(items) {
    for (const it of items) {
      it.layers = [...new Set(it.ids.map((id) => layerOf.get(id)))]
      it.key = it.ids.reduce((s, id) => s + guess.get(id), 0) / it.ids.length
      it.first = Math.min(...it.ids.map((id) => nodeIndex.get(id)))
    }
    items.sort((a, b) => a.key - b.key || a.first - b.first)
    const total = new Map()
    for (const it of items) for (const l of it.layers) total.set(l, (total.has(l) ? total.get(l) + gapCross : 0) + it.width)
    const wide = Math.max(...total.values())
    const before = new Map()
    const frontier = new Map()
    for (const it of items) {
      let start = 0
      for (const l of it.layers) {
        start = Math.max(start, (wide - total.get(l)) / 2 + (before.get(l) ?? 0))
        if (frontier.has(l)) start = Math.max(start, frontier.get(l) + gapCross)
      }
      it.start = start
      for (const l of it.layers) {
        before.set(l, (before.get(l) ?? 0) + it.width + gapCross)
        frontier.set(l, start + it.width)
      }
    }
    return { items, width: Math.max(...items.map((it) => it.start + it.width)) }
  }
  const crossAt = new Map()
  const crossSpan = new Map()
  const place = (items, offset) => {
    for (const it of items) {
      const s = offset + it.start
      if (it.group) {
        crossSpan.set(it.id, [s, s + it.width])
        place(it.inner.items, s + it.offset)
      } else crossAt.set(it.id, s + it.width / 2)
    }
  }
  place(pack(itemsOf(null)).items, 0)

  // Along: the layers with the given gaps between them, and each box's extent along them
  const bandOf = layers.map((l) => Math.max(...l.map(main)))
  const lay = (gaps) => {
    const startOf = []
    let at = 0
    layers.forEach((_, li) => {
      startOf.push(at)
      at += bandOf[li] + (li < layers.length - 1 ? gaps[li] : 0)
    })
    const mainAt = (id) => startOf[layerOf.get(id)] + bandOf[layerOf.get(id)] / 2
    const span = new Map()
    const measure = (g) => {
      let lo = Infinity
      let hi = -Infinity
      for (const id of g.nodes) {
        lo = Math.min(lo, mainAt(id) - main(id) / 2)
        hi = Math.max(hi, mainAt(id) + main(id) / 2)
      }
      for (const c of childrenOf(g.id)) {
        const [a, b] = measure(c)
        lo = Math.min(lo, a)
        hi = Math.max(hi, b)
      }
      lo -= padMainStart + (isVertical ? 0 : lanes.get(g.id) ?? 0)
      hi += padMainEnd
      // Left to right, the title's width is along the layers: the box reaches past its last layer
      if (!isVertical) hi = Math.max(hi, lo + titleRoom(g.label))
      span.set(g.id, [lo, hi])
      return [lo, hi]
    }
    childrenOf(null).forEach(measure)
    return { startOf, length: at, mainAt, span }
  }
  const layersIn = (g) => descendants.get(g.id).map((id) => layerOf.get(id))
  const rough = lay(layers.slice(1).map(() => gapMain))
  const gaps = layers.slice(1).map((_, li) => {
    let over = 0
    let under = 0
    for (const g of model.subgraphs) {
      const [lo, hi] = rough.span.get(g.id)
      if (Math.max(...layersIn(g)) === li) over = Math.max(over, hi - (rough.startOf[li] + bandOf[li]))
      if (Math.min(...layersIn(g)) === li + 1) under = Math.max(under, rough.startOf[li + 1] - lo)
    }
    return Math.max(gapMain, over + under + GROUP.clear)
  })
  const final = lay(gaps)

  // On the screen: BT and RL run the layers the other way
  const flip = (m) => (isReversed ? final.length - m : m)
  const boxes = new Map()
  for (const node of model.nodes) {
    const m = flip(final.mainAt(node.id))
    const k = crossAt.get(node.id)
    boxes.set(node.id, { ...sizes.get(node.id), x: isVertical ? k : m, y: isVertical ? m : k, shape: node.shape, label: node.label })
  }
  const depthOf = (g) => (g.parent === null ? 0 : 1 + depthOf(model.subgraphs.find((p) => p.id === g.parent)))
  const groups = model.subgraphs.map((g) => {
    const [lo, hi] = final.span.get(g.id)
    const [a, b] = isReversed ? [final.length - hi, final.length - lo] : [lo, hi]
    const [c0, c1] = crossSpan.get(g.id)
    const box = isVertical ? { x: c0, y: a, w: c1 - c0, h: b - a } : { x: a, y: c0, w: b - a, h: c1 - c0 }
    const chip = { x: box.x + GROUP.chipX, y: box.y + GROUP.chipY, w: chipWidth(g.label), h: GROUP.chipH }
    return { id: g.id, label: g.label, parent: g.parent, depth: depthOf(g), members: descendants.get(g.id), ...box, chip }
  })
  groups.sort((p, q) => p.depth - q.depth)
  if (!groupsFit(boxes, groups)) return null
  return { boxes, groups, layers, isBack, layerOf }
}

/**
 * Whether the subgraphs' boxes can be drawn without misleading: each member node inside its box
 * and clear of its title chip, every other node outside it, a nested box inside its parent and
 * clear of the parent's chip, and boxes that are not nested apart from each other.
 */
export function groupsFit(boxes, groups) {
  const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h
  const meets = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  const byId = new Map(groups.map((g) => [g.id, g]))
  const isAbove = (g, h) => {
    for (let at = h.parent; at !== null && at !== undefined; at = byId.get(at)?.parent) if (at === g.id) return true
    return false
  }
  for (const g of groups) {
    for (const [id, b] of boxes) {
      const r = { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h }
      if (g.members.includes(id)) {
        if (!inside(r, g) || meets(r, g.chip)) return false
      } else if (meets(r, g)) return false
    }
    if (!inside(g.chip, g)) return false
    for (const h of groups) {
      if (h === g || isAbove(h, g)) continue
      if (isAbove(g, h)) {
        if (!inside(h, g) || meets(h, g.chip)) return false
      } else if (meets(g, h)) return false
    }
  }
  return true
}

// ---- Drawing

const esc = (s) =>
  String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const FONT = "system-ui, -apple-system, 'Segoe UI', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', sans-serif"
const COLOR = {
  nodeFill: '#eef2ff',
  nodeStroke: '#6475c9',
  nodeText: '#1e2340',
  line: '#7c869b',
  tagFill: '#f6f7fb',
  tagStroke: '#b8bfd2',
  tagText: '#2b3040',
  groupFill: '#6475c9',
  groupStroke: '#6475c9',
}

const n1 = (v) => Math.round(v * 10) / 10

// A label's lines as <text>, centred on (x, y)
function textAt(label, x, y, color) {
  const lines = linesOf(label)
  const top = y - ((lines.length - 1) * LINE) / 2 + 4.5
  return lines.map((l, i) => `<text x="${n1(x)}" y="${n1(top + i * LINE)}" text-anchor="middle" font-size="13" fill="${color}">${esc(l)}</text>`).join('')
}

// The point on a node's outline in the direction (dx, dy) from its centre
function edgePoint(box, dx, dy) {
  const hw = box.w / 2
  const hh = box.h / 2
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  let t
  if (box.shape === 'circle') t = 1 / Math.hypot(ux / hw, uy / hh)
  else if (box.shape === 'diamond') t = 1 / (Math.abs(ux) / hw + Math.abs(uy) / hh)
  else t = Math.min(hw / (Math.abs(ux) || 1e-9), hh / (Math.abs(uy) || 1e-9))
  return { x: box.x + ux * t, y: box.y + uy * t }
}

function nodeSvg(box) {
  const { x, y, w, h } = box
  const style = `fill="${COLOR.nodeFill}" stroke="${COLOR.nodeStroke}" stroke-width="1.5"`
  let shape
  if (box.shape === 'circle') shape = `<ellipse cx="${n1(x)}" cy="${n1(y)}" rx="${n1(w / 2)}" ry="${n1(h / 2)}" ${style}/>`
  else if (box.shape === 'diamond') {
    shape = `<polygon points="${n1(x)},${n1(y - h / 2)} ${n1(x + w / 2)},${n1(y)} ${n1(x)},${n1(y + h / 2)} ${n1(x - w / 2)},${n1(y)}" ${style}/>`
  } else {
    const r = box.shape === 'stadium' ? h / 2 : box.shape === 'round' ? 10 : 3
    shape = `<rect x="${n1(x - w / 2)}" y="${n1(y - h / 2)}" width="${n1(w)}" height="${n1(h)}" rx="${r}" ${style}/>`
  }
  return shape + textAt(box.label, x, y, COLOR.nodeText)
}

// A small arrowhead with its tip at (x, y), pointing along (dx, dy)
function headSvg(x, y, dx, dy) {
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const bx = x - ux * 9
  const by = y - uy * 9
  return `<polygon points="${n1(x)},${n1(y)} ${n1(bx - uy * 4.5)},${n1(by + ux * 4.5)} ${n1(bx + uy * 4.5)},${n1(by - ux * 4.5)}" fill="${COLOR.line}"/>`
}

const tagSvg = (label, x, y) => {
  const w = textWidth(label) + 12
  const h = LINE * linesOf(label).length + 4
  return `<rect x="${n1(x - w / 2)}" y="${n1(y - h / 2)}" width="${n1(w)}" height="${n1(h)}" rx="4" fill="${COLOR.tagFill}" stroke="${COLOR.tagStroke}" stroke-width="1"/>` + textAt(label, x, y, COLOR.tagText)
}

// A subgraph's box, faint enough for nested ones to show, its title on a small fill
function groupSvg(g) {
  const { chip } = g
  return (
    `<rect x="${n1(g.x)}" y="${n1(g.y)}" width="${n1(g.w)}" height="${n1(g.h)}" rx="8" fill="${COLOR.groupFill}" fill-opacity="0.07" stroke="${COLOR.groupStroke}" stroke-opacity="0.6" stroke-width="1"/>` +
    `<rect x="${n1(chip.x)}" y="${n1(chip.y)}" width="${n1(chip.w)}" height="${n1(chip.h)}" rx="4" fill="${COLOR.tagFill}" stroke="${COLOR.tagStroke}" stroke-width="1"/>` +
    `<text x="${n1(chip.x + 6)}" y="${n1(chip.y + 13)}" font-size="12" font-weight="600" fill="${COLOR.tagText}">${esc(g.label)}</text>`
  )
}

// The rectangle of an edge's label drawn by tagSvg at (x, y)
const tagRect = (label, x, y) => {
  const w = textWidth(label) + 12
  const h = LINE * linesOf(label).length + 4
  return { x: x - w / 2, y: y - h / 2, w, h }
}

// Points along a quadratic (p0, c, p1) or a cubic (p0, c1, c2, p1) curve, ends included
function curvePoints(...ps) {
  const out = []
  for (let k = 0; k <= 16; k++) {
    const t = k / 16
    let row = ps
    while (row.length > 1) row = row.slice(1).map((p, i) => ({ x: row[i].x + (p.x - row[i].x) * t, y: row[i].y + (p.y - row[i].y) * t }))
    out.push(row[0])
  }
  return out
}

/** Whether the segment p–q meets the rectangle r ({ x, y, w, h }), its inside included. */
export function segmentMeetsRect(p, q, r) {
  // Liang–Barsky: clip the segment's parameter range to the rectangle's four sides
  let t0 = 0
  let t1 = 1
  const dx = q.x - p.x
  const dy = q.y - p.y
  const sides = [
    [-dx, p.x - r.x],
    [dx, r.x + r.w - p.x],
    [-dy, p.y - r.y],
    [dy, r.y + r.h - p.y],
  ]
  for (const [a, b] of sides) {
    if (a === 0) {
      if (b < 0) return false
      continue
    }
    const t = b / a
    if (a < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 > t1) return false
  }
  return true
}

// The room kept between a title chip and an edge or an edge's label (the line's width, a head)
const CHIP_CLEAR = 4
// How many times a box is widened for its title before the diagram is left as code
const CHIP_ROUNDS = 3

/**
 * Moves each subgraph's title chip along its title band (the strip at the top of the box that no
 * node or inner box reaches) to the leftmost place where no edge and no edge label comes within
 * CHIP_CLEAR of it; the chip keeps its place when it is clear there already. Returns the groups
 * whose band has no such place.
 */
function placeChips(groups, routes, labels) {
  const blocked = []
  for (const g of groups) {
    const free = (x) => {
      const r = { x: x - CHIP_CLEAR, y: g.chip.y - CHIP_CLEAR, w: g.chip.w + 2 * CHIP_CLEAR, h: g.chip.h + 2 * CHIP_CLEAR }
      for (const route of routes) for (let i = 1; i < route.length; i++) if (segmentMeetsRect(route[i - 1], route[i], r)) return false
      return !labels.some((t) => t.x < r.x + r.w && r.x < t.x + t.w && t.y < r.y + r.h && r.y < t.y + t.h)
    }
    const first = g.x + GROUP.chipX
    const last = g.x + g.w - GROUP.chipX - g.chip.w
    let at = null
    for (let x = first; x <= last + 1e-6 && at === null; x += 2) if (free(x)) at = x
    if (at === null && last > first && free(last)) at = last
    if (at === null) blocked.push(g)
    else g.chip = { ...g.chip, x: at }
  }
  return blocked
}

/**
 * { source, width, height } of a flowchart's SVG, or null when its subgraphs do not fit. With
 * subgraphs, no edge is drawn across a title: a title the edges leave no room for widens its box
 * (layoutFlowchart's lanes) and the layout is made again, up to CHIP_ROUNDS times.
 */
function flowchartSvg(model) {
  let lanes = new Map()
  for (let round = 0; ; round++) {
    const layout = layoutFlowchart(model, lanes)
    if (!layout) return null
    const edges = edgesSvg(model, layout)
    const blocked = placeChips(layout.groups, edges.routes, edges.labels)
    if (blocked.length === 0) return groupsFit(layout.boxes, layout.groups) ? pictureOf(layout, edges) : null
    if (round === CHIP_ROUNDS) return null
    lanes = new Map(lanes)
    for (const g of blocked) lanes.set(g.id, (lanes.get(g.id) ?? 0) + titleRoom(g.label))
  }
}

// The picture of a layout and its edges: boxes behind, then lines, heads, nodes and labels
function pictureOf(layout, edges) {
  const { boxes, groups: frames } = layout
  const points = [...edges.points]
  const grow = (x, y) => points.push({ x, y })
  for (const b of boxes.values()) {
    grow(b.x - b.w / 2, b.y - b.h / 2)
    grow(b.x + b.w / 2, b.y + b.h / 2)
  }
  for (const g of frames) {
    grow(g.x, g.y)
    grow(g.x + g.w, g.y + g.h)
  }
  const nodes = [...boxes.values()].map(nodeSvg)
  return wrap(points, [...frames.map(groupSvg), ...edges.lines, ...edges.heads, ...nodes, ...edges.tags])
}

/**
 * The edges of a layout: their SVG parts (lines, heads, tags), the points the picture must hold,
 * and for placeChips the course of each edge as points (`routes`, curves sampled) and the
 * rectangles of their labels (`labels`).
 */
function edgesSvg(model, layout) {
  const { boxes, isBack, layerOf } = layout
  const parts = { lines: [], heads: [], tags: [], points: [], routes: [], labels: [] }
  const grow = (x, y) => parts.points.push({ x, y })
  // Edges between the same two nodes are spread to either side
  const groups = new Map()
  model.edges.forEach((e, i) => {
    const key = [e.from, e.to].sort().join('\u0000')
    groups.set(key, [...(groups.get(key) ?? []), i])
  })
  model.edges.forEach((e, i) => {
    const a = boxes.get(e.from)
    const b = boxes.get(e.to)
    const dash = e.style === 'dotted' ? ' stroke-dasharray="5 4"' : ''
    const width = e.style === 'thick' ? 3 : 1.5
    const stroke = `fill="none" stroke="${COLOR.line}" stroke-width="${width}"${dash}`
    if (e.from === e.to) {
      const x = a.x + a.w / 2
      parts.lines.push(`<path d="M ${n1(x)} ${n1(a.y - 7)} C ${n1(x + 34)} ${n1(a.y - 30)} ${n1(x + 34)} ${n1(a.y + 30)} ${n1(x)} ${n1(a.y + 7)}" ${stroke}/>`)
      parts.routes.push(curvePoints({ x, y: a.y - 7 }, { x: x + 34, y: a.y - 30 }, { x: x + 34, y: a.y + 30 }, { x, y: a.y + 7 }))
      if (e.hasHead) parts.heads.push(headSvg(x, a.y + 7, -1, 0.35))
      grow(x + 36, a.y - 30)
      grow(x + 36, a.y + 30)
      if (e.label) {
        parts.tags.push(tagSvg(e.label, x + 40 + textWidth(e.label) / 2, a.y))
        parts.labels.push(tagRect(e.label, x + 40 + textWidth(e.label) / 2, a.y))
        grow(x + 52 + textWidth(e.label), a.y)
      }
      return
    }
    const members = groups.get([e.from, e.to].sort().join('\u0000'))
    const spread = (members.indexOf(i) - (members.length - 1) / 2) * 30
    const span = Math.abs(layerOf.get(e.to) - layerOf.get(e.from))
    const bend = spread + (span > 1 ? 40 : 0) + (isBack.has(i) ? 30 : 0)
    // The bend is measured from the pair's own direction, so the two ways of a pair part
    const [first, second] = [e.from, e.to].sort()
    const p = boxes.get(first)
    const q = boxes.get(second)
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
    const nx = -(q.y - p.y) / len
    const ny = (q.x - p.x) / len
    const cx = (a.x + b.x) / 2 + nx * bend
    const cy = (a.y + b.y) / 2 + ny * bend
    const isCurved = bend !== 0
    const start = edgePoint(a, (isCurved ? cx : b.x) - a.x, (isCurved ? cy : b.y) - a.y)
    const end = edgePoint(b, (isCurved ? cx : a.x) - b.x, (isCurved ? cy : a.y) - b.y)
    parts.lines.push(isCurved ? `<path d="M ${n1(start.x)} ${n1(start.y)} Q ${n1(cx)} ${n1(cy)} ${n1(end.x)} ${n1(end.y)}" ${stroke}/>` : `<line x1="${n1(start.x)}" y1="${n1(start.y)}" x2="${n1(end.x)}" y2="${n1(end.y)}" ${stroke}/>`)
    parts.routes.push(isCurved ? curvePoints(start, { x: cx, y: cy }, end) : [start, end])
    if (e.hasHead) parts.heads.push(isCurved ? headSvg(end.x, end.y, end.x - cx, end.y - cy) : headSvg(end.x, end.y, end.x - start.x, end.y - start.y))
    if (isCurved) {
      grow(cx, cy)
      grow(start.x, start.y)
      grow(end.x, end.y)
    }
    if (e.label) {
      const mx = isCurved ? 0.25 * start.x + 0.5 * cx + 0.25 * end.x : (start.x + end.x) / 2
      const my = isCurved ? 0.25 * start.y + 0.5 * cy + 0.25 * end.y : (start.y + end.y) / 2
      parts.tags.push(tagSvg(e.label, mx, my))
      parts.labels.push(tagRect(e.label, mx, my))
      grow(mx - textWidth(e.label) / 2 - 8, my - 12)
      grow(mx + textWidth(e.label) / 2 + 8, my + 12)
    }
  })
  return parts
}

// The document around drawn parts: the points' box with a margin, the origin moved to it
function wrap(points, body) {
  const pad = 12
  const minX = Math.min(...points.map((p) => p.x)) - pad
  const minY = Math.min(...points.map((p) => p.y)) - pad
  const width = Math.ceil(Math.max(...points.map((p) => p.x)) + pad - minX)
  const height = Math.ceil(Math.max(...points.map((p) => p.y)) + pad - minY)
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n1(minX)} ${n1(minY)} ${width} ${height}" font-family="${esc(FONT)}">` + body.join('') + '</svg>'
  return { source, width, height }
}

/** { source, width, height } of a sequence diagram's SVG. */
function sequenceSvg(model) {
  const ps = model.participants
  const boxW = ps.map((p) => Math.max(72, textWidth(p.label) + 24))
  const index = new Map(ps.map((p, i) => [p.id, i]))
  // The distance between the lifelines: wide enough for the boxes and for each message's text
  const x = [boxW[0] / 2]
  const need = ps.map(() => 0)
  for (let i = 1; i < ps.length; i++) need[i] = Math.max(110, (boxW[i - 1] + boxW[i]) / 2 + 24)
  const spans = model.messages
    .map((m) => ({ a: Math.min(index.get(m.from), index.get(m.to)), b: Math.max(index.get(m.from), index.get(m.to)), w: textWidth(m.text) + 36 }))
    .filter((s) => s.a !== s.b)
    .sort((s, t) => s.b - s.a - (t.b - t.a))
  for (const s of spans) {
    let have = 0
    for (let i = s.a + 1; i <= s.b; i++) have += need[i]
    if (have < s.w) need[s.b] += s.w - have
  }
  for (let i = 1; i < ps.length; i++) x.push(x[i - 1] + need[i])
  const headH = 32
  const rowH = 38
  const bottom = headH + 24 + model.messages.length * rowH + 8
  const body = []
  const points = [{ x: 0, y: 0 }]
  ps.forEach((p, i) => {
    body.push(`<line x1="${n1(x[i])}" y1="${headH}" x2="${n1(x[i])}" y2="${bottom}" stroke="${COLOR.line}" stroke-width="1" stroke-dasharray="4 4"/>`)
  })
  model.messages.forEach((m, k) => {
    const y = headH + 24 + k * rowH + rowH / 2
    const a = x[index.get(m.from)]
    const b = x[index.get(m.to)]
    const dash = m.isDashed ? ' stroke-dasharray="6 4"' : ''
    const stroke = `fill="none" stroke="${COLOR.line}" stroke-width="1.5"${dash}`
    if (a === b) {
      body.push(`<path d="M ${n1(a)} ${n1(y - 6)} C ${n1(a + 44)} ${n1(y - 8)} ${n1(a + 44)} ${n1(y + 12)} ${n1(a)} ${n1(y + 10)}" ${stroke}/>`)
      if (m.hasHead) body.push(headSvg(a, y + 10, -1, 0))
      if (m.text) body.push(tagSvg(m.text, a + 52 + textWidth(m.text) / 2, y))
      points.push({ x: a + 56 + textWidth(m.text), y })
      return
    }
    const dir = b > a ? 1 : -1
    body.push(`<line x1="${n1(a)}" y1="${n1(y)}" x2="${n1(b)}" y2="${n1(y)}" ${stroke}/>`)
    if (m.hasHead) body.push(headSvg(b, y, dir, 0))
    if (m.text) body.push(tagSvg(m.text, (a + b) / 2, y - 12))
  })
  // The participants' boxes, above and below the lifelines
  for (const top of [0, bottom]) {
    ps.forEach((p, i) => {
      body.push(nodeSvg({ x: x[i], y: top + headH / 2, w: boxW[i], h: headH - 4, shape: 'rect', label: p.label.replace(/\n/g, ' ') }))
    })
  }
  points.push({ x: x[ps.length - 1] + boxW[ps.length - 1] / 2, y: bottom + headH })
  return wrap(points, body)
}

// The drawings of the latest sources, by source (null kept too): the pane draws every card at each
// redraw, and a source drawn once is not parsed and laid out again. A Map keeps the order of
// insertion; a hit moves to the end, and past MERMAID_MEMO the oldest goes
const MERMAID_MEMO = 32
const drawings = new Map()

/**
 * The drawing of a mermaid source: { source, width, height, alt }, or null when it is not one this
 * file can draw. The same source gives the same object back while it is among the latest
 * MERMAID_MEMO drawn (do not change it).
 */
export function mermaidSvg(source) {
  const key = String(source)
  if (drawings.has(key)) {
    const hit = drawings.get(key)
    drawings.delete(key)
    drawings.set(key, hit)
    return hit
  }
  const drawn = drawMermaid(key)
  drawings.set(key, drawn)
  if (drawings.size > MERMAID_MEMO) drawings.delete(drawings.keys().next().value)
  return drawn
}

// mermaidSvg without the memo
function drawMermaid(source) {
  const model = parseMermaid(source)
  if (!model) return null
  try {
    const drawn = model.kind === 'flowchart' ? flowchartSvg(model) : sequenceSvg(model)
    if (!drawn || !Number.isFinite(drawn.width) || !Number.isFinite(drawn.height) || drawn.source.length > 100_000) return null
    return { ...drawn, alt: altOf(model) }
  } catch {
    return null
  }
}

/** What the drawing says in words, for a reader that cannot see it. */
export function altOf(model) {
  const flat = (s) => String(s).replace(/\n/g, ' ')
  const labelOfNode = (id) => flat(model.nodes.find((n) => n.id === id).label)
  // A subgraph in words: its title and what is directly in it
  const groupText = (g) => `${g.label}（${[...model.subgraphs.filter((c) => c.parent === g.id).map((c) => c.label), ...g.nodes.map(labelOfNode)].join('、')}）`
  const groups = model.subgraphs?.length ? ' / グループ: ' + model.subgraphs.map(groupText).join('、') : ''
  const text =
    model.kind === 'flowchart'
      ? 'フローチャート: ' + model.nodes.map((n) => flat(n.label)).join('、') + ' / ' + model.edges.map((e) => `${flat(model.nodes.find((n) => n.id === e.from).label)} → ${flat(model.nodes.find((n) => n.id === e.to).label)}${e.label ? `（${flat(e.label)}）` : ''}`).join('、') + groups
      : 'シーケンス図: ' +
        model.messages
          .map((m) => `${flat(model.participants.find((p) => p.id === m.from).label)} → ${flat(model.participants.find((p) => p.id === m.to).label)}${m.text ? `: ${flat(m.text)}` : ''}`)
          .join('、')
  return text.length > 300 ? text.slice(0, 299) + '…' : text
}

// ---- Fences in a body

/**
 * A card's body as pieces: { type: 'md', text } and { type: 'mermaid', source, raw }. Only a
 * ```mermaid fence (``` or ~~~) is its own piece; another fence is kept whole inside the text, so
 * a mermaid fence shown inside it is left alone. A fence never closed stays text.
 */
export function splitFences(body) {
  const lines = String(body).split('\n')
  const pieces = []
  let buffer = []
  const flush = () => {
    if (buffer.length > 0) pieces.push({ type: 'md', text: buffer.join('\n') })
    buffer = []
  }
  let i = 0
  while (i < lines.length) {
    const open = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/.exec(lines[i].replace(/\r$/, ''))
    if (!open) {
      buffer.push(lines[i++])
      continue
    }
    const fence = open[1]
    let closed = -1
    for (let j = i + 1; j < lines.length; j++) {
      const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[j].replace(/\r$/, ''))
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) {
        closed = j
        break
      }
    }
    if (closed < 0) {
      buffer.push(...lines.slice(i))
      break
    }
    if (open[2].toLowerCase() === 'mermaid') {
      flush()
      pieces.push({ type: 'mermaid', source: lines.slice(i + 1, closed).join('\n'), raw: lines.slice(i, closed + 1).join('\n') })
    } else {
      buffer.push(...lines.slice(i, closed + 1))
    }
    i = closed + 1
  }
  flush()
  return pieces
}
