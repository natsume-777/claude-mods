// Pure builders of the bytes the media samples hand to the engine: the cells of [Pane/Raster],
// the pixels of [Pane/Image], and the short beep [$.audio.play] plays. Each answers base64,
// built with btoa over a binary string (a global of the hooks environment).
//
// Pure: no $ here, so the hook files keep every $ call themselves.

/** The size of [Pane/Raster], in cells. */
export const RASTER = { columns: 24, rows: 6 }

/** The size of [Pane/Image]: its pixels, and the cells it is drawn over. */
export const IMAGE = { width: 8, height: 4, columns: 8, rows: 2 }

// Bytes to base64
function toBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// A hue (0 to 1, wrapping) at a value (0 to 1), saturation fixed, as [r, g, b] 0 to 255
function hsv(hue, value) {
  const h = (((hue % 1) + 1) % 1) * 6
  const s = 0.6
  const c = value * s
  const x = c * (1 - Math.abs((h % 2) - 1))
  const m = value - c
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]
  return [r, g, b].map(part => Math.round((part + m) * 255))
}

// The color of one grid position: the hue runs across, the value falls down, `phase` shifts it
function shade(x, y, width, height, phase) {
  return hsv(x / width + phase, 0.95 - (0.5 * y) / Math.max(1, height - 1))
}

/**
 * The cells of a `columns` x `rows` Raster (RasterProps `cells`): row-major, each cell three
 * little-endian u32 [codePoint, foreground, background]. Each cell is an upper half block, so
 * one cell shows two rows of the gradient (its foreground above, its background below).
 */
export function rasterCells(columns, rows, phase) {
  const view = new DataView(new ArrayBuffer(columns * rows * 12))
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const at = (y * columns + x) * 12
      const [fr, fg, fb] = shade(x, y * 2, columns, rows * 2, phase)
      const [br, bg, bb] = shade(x, y * 2 + 1, columns, rows * 2, phase)
      view.setUint32(at, 0x2580, true)
      view.setUint32(at + 4, (fr << 16) | (fg << 8) | fb, true)
      view.setUint32(at + 8, (br << 16) | (bg << 8) | bb, true)
    }
  }
  return toBase64(new Uint8Array(view.buffer))
}

/** An Image source (ImageSource `{ rgba, width, height }`): the same gradient, opaque. */
export function imageSource(width, height, phase) {
  const bytes = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4
      const [r, g, b] = shade(x, y, width, height, phase)
      bytes[at] = r
      bytes[at + 1] = g
      bytes[at + 2] = b
      bytes[at + 3] = 255
    }
  }
  return { rgba: toBase64(bytes), width, height }
}

/**
 * A short, quiet beep as a WAV file (AudioClip `{ base64, mime }`): 8-bit mono at 8 kHz, a
 * 660 Hz tone of `ms` milliseconds at a low level, faded in and out so it does not click.
 */
export function beepWav(ms = 200) {
  const rate = 8000
  const count = Math.round((rate * ms) / 1000)
  const fade = Math.round(rate * 0.01)
  const view = new DataView(new ArrayBuffer(44 + count))
  const text = (at, word) => {
    for (let i = 0; i < word.length; i += 1) view.setUint8(at + i, word.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + count, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true) // the fmt chunk's size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true) // samples per second
  view.setUint32(28, rate, true) // bytes per second
  view.setUint16(32, 1, true) // bytes per sample
  view.setUint16(34, 8, true) // bits per sample
  text(36, 'data')
  view.setUint32(40, count, true)
  for (let i = 0; i < count; i += 1) {
    const envelope = Math.min(1, i / fade, (count - 1 - i) / fade)
    view.setUint8(44 + i, Math.round(128 + 40 * envelope * Math.sin((2 * Math.PI * 660 * i) / rate)))
  }
  return { base64: toBase64(new Uint8Array(view.buffer)), mime: 'audio/wav' }
}
