// A small framebuffer and the two ways it reaches the screen: terminal cells (one ▀ per two pixels, the top pixel
// as the foreground, the bottom as the background) and, on the desktop, an SVG of pixel runs. The palette is the
// evening office of Le Bureau des agents (src/engine/pixels.ts, MIT).

export const P = {
  ink: 0x15121d,
  wallTop: 0x14111c,
  wallFace: 0x262236,
  wallFace2: 0x2c2740,
  wallLine: 0x1f1b2d,
  baseboard: 0x191523,
  floor1: 0x3f3138,
  floor2: 0x46363d,
  floorSeam: 0x30252c,
  wood: 0xc08a57,
  woodHi: 0xd9a46c,
  woodFront: 0x9b6a3e,
  woodDark: 0x77502e,
  ebony: 0x2a2530,
  ebonyHi: 0x3b3443,
  ebonyFront: 0x1e1a24,
  metal: 0x9a9fb5,
  metalDark: 0x62667c,
  tech: 0x262431,
  screenOff: 0x1a1f2e,
  orange: 0xff8a3d,
  orangeHi: 0xffb27a,
  orangeDark: 0xd9622a,
  leafDark: 0x285e40,
  leaf: 0x348050,
  leafHi: 0x52a868,
  pot: 0xb8643f,
  paper: 0xf6f2e9,
  paperLine: 0xa19a8c,
  white: 0xf7f5fc,
  green: 0x3ddc97,
  red: 0xff5d5d,
}

export class Frame {
  readonly px: Uint32Array
  constructor(
    readonly w: number,
    readonly h: number,
    fill = P.ink,
  ) {
    this.px = new Uint32Array(w * h).fill(fill)
  }
  set(x: number, y: number, c: number) {
    x = Math.round(x)
    y = Math.round(y)
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c
  }
  rect(x: number, y: number, w: number, h: number, c: number) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c)
  }
  get(x: number, y: number): number {
    return this.px[y * this.w + x] ?? P.ink
  }
}

export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t) << s
  return ch(16) | ch(8) | ch(0)
}
export const lighten = (c: number, t: number) => mix(c, 0xffffff, t)
export const darken = (c: number, t: number) => mix(c, 0x100c1c, t)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!
    out += c === undefined ? '=' : B64[c & 63]!
  }
  return out
}

/** The frame as a Raster's cells: `w` columns by `h / 2` rows of ▀. */
export function toCells(f: Frame): string {
  const rows = Math.floor(f.h / 2)
  const words = new Uint32Array(f.w * rows * 3)
  let k = 0
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < f.w; x++) {
      words[k++] = 0x2580
      words[k++] = f.get(x, r * 2)
      words[k++] = f.get(x, r * 2 + 1)
    }
  }
  // little-endian u32s, as the Raster reads them
  const bytes = new Uint8Array(words.length * 4)
  for (let i = 0; i < words.length; i++) {
    const v = words[i]!
    bytes[i * 4] = v & 255
    bytes[i * 4 + 1] = (v >> 8) & 255
    bytes[i * 4 + 2] = (v >> 16) & 255
    bytes[i * 4 + 3] = (v >>> 24) & 255
  }
  return base64(bytes)
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

/** The frame as an SVG of horizontal pixel runs, `scale` screen pixels per frame pixel. */
export function toSvg(f: Frame, scale: number, title: string): string {
  let body = ''
  for (let y = 0; y < f.h; y++) {
    let x = 0
    while (x < f.w) {
      const c = f.get(x, y)
      let run = 1
      while (x + run < f.w && f.get(x + run, y) === c) run++
      body += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${hex(c)}"/>`
      x += run
    }
  }
  const esc = title.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f.w * scale}" height="${f.h * scale}" viewBox="0 0 ${f.w} ${f.h}" shape-rendering="crispEdges">` +
    `<title>${esc}</title>${body}</svg>`
  )
}
