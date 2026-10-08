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
// skipped. A subgraph, `direction` and any other syntax give null.
// Also sequenceDiagram with participants / actors and the arrows `->>` `-->>` `->` `-->` `-x`
// `--x` `-)` `--)` with a message; notes, loops, activations and the rest give null.
//
// Drawn: layers by the longest path (a cycle's back edge is drawn as a returning curve), nodes
// filled and edges and labels on their own small fills, so it reads on a light and a dark theme.

import { cells } from './board.js'

/** What a diagram may be at most; a bigger one is left as code. */
export const MERMAID_LIMITS = {
  nodes: 30,
  edges: 60,
  label: 80,
  messages: 40,
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

/** Parses a flowchart / graph; null when it is not one or uses what is not read. */
function parseFlowchart(source) {
  const statements = statementsOf(source)
  const header = /^(?:flowchart|graph)(?:\s+(TD|TB|BT|LR|RL))?$/i.exec(statements[0] ?? '')
  if (!header) return null
  const direction = (header[1] ?? 'TD').toUpperCase().replace('TB', 'TD')
  const nodes = []
  const edges = []
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
    return node
  }
  for (const s of statements.slice(1)) {
    if (/^(style|classDef|class|linkStyle|click)\b/.test(s)) continue
    if (/^(subgraph|end|direction)\b/.test(s)) return null
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
  return { kind: 'flowchart', direction, nodes, edges }
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
  for (let round = 0; round < 2; round++) {
    for (let l = 1; l < layers.length; l++) {
      layers[l] = sweep(layers[l], preds)
      mark()
    }
    for (let l = layers.length - 2; l >= 0; l--) {
      layers[l] = sweep(layers[l], succs)
      mark()
    }
  }
  return { layers, isBack, layerOf }
}

/** Places the nodes: { boxes: Map id -> { x, y, w, h, shape, label } (centres), layers, isBack, layerOf }. */
export function layoutFlowchart(model) {
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
  return { boxes, layers, isBack, layerOf }
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

/** { source, width, height } of a flowchart's SVG. */
function flowchartSvg(model) {
  const { boxes, isBack, layerOf } = layoutFlowchart(model)
  const parts = { lines: [], heads: [], nodes: [], tags: [] }
  const points = []
  const grow = (x, y) => points.push({ x, y })
  for (const b of boxes.values()) {
    grow(b.x - b.w / 2, b.y - b.h / 2)
    grow(b.x + b.w / 2, b.y + b.h / 2)
  }
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
      if (e.hasHead) parts.heads.push(headSvg(x, a.y + 7, -1, 0.35))
      grow(x + 36, a.y - 30)
      grow(x + 36, a.y + 30)
      if (e.label) {
        parts.tags.push(tagSvg(e.label, x + 40 + textWidth(e.label) / 2, a.y))
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
      grow(mx - textWidth(e.label) / 2 - 8, my - 12)
      grow(mx + textWidth(e.label) / 2 + 8, my + 12)
    }
  })
  for (const b of boxes.values()) parts.nodes.push(nodeSvg(b))
  return wrap(points, [...parts.lines, ...parts.heads, ...parts.nodes, ...parts.tags])
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

/** The drawing of a mermaid source: { source, width, height, alt }, or null when it is not one this file can draw. */
export function mermaidSvg(source) {
  const model = parseMermaid(source)
  if (!model) return null
  try {
    const drawn = model.kind === 'flowchart' ? flowchartSvg(model) : sequenceSvg(model)
    if (!Number.isFinite(drawn.width) || !Number.isFinite(drawn.height) || drawn.source.length > 100_000) return null
    return { ...drawn, alt: altOf(model) }
  } catch {
    return null
  }
}

/** What the drawing says in words, for a reader that cannot see it. */
export function altOf(model) {
  const flat = (s) => String(s).replace(/\n/g, ' ')
  const text =
    model.kind === 'flowchart'
      ? 'フローチャート: ' + model.nodes.map((n) => flat(n.label)).join('、') + ' / ' + model.edges.map((e) => `${flat(model.nodes.find((n) => n.id === e.from).label)} → ${flat(model.nodes.find((n) => n.id === e.to).label)}${e.label ? `（${flat(e.label)}）` : ''}`).join('、')
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
