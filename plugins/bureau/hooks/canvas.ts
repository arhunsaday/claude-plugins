// A canvas for a hooks module, which has no DOM: just enough of CanvasRenderingContext2D for the office engine of
// Le Bureau des agents to draw unchanged. Integer pixels on an RGBA buffer, with fillStyle (hex, rgb[a] and radial
// gradients), fillRect, drawImage, globalAlpha, the source-over, lighter and multiply composites, save/restore,
// rectangular clips, filled polygons, getImageData, and the translate/scale pair the engine uses to mirror sprites.

type RGBA = [number, number, number, number]

class RadialGradient {
  private stops: { at: number; c: RGBA }[] = []
  constructor(
    readonly x: number,
    readonly y: number,
    readonly r: number,
  ) {}
  addColorStop(at: number, color: string) {
    this.stops.push({ at, c: parseColor(color) })
    this.stops.sort((a, b) => a.at - b.at)
  }
  colorAt(px: number, py: number): RGBA {
    const t = this.r > 0 ? Math.min(1, Math.hypot(px - this.x, py - this.y) / this.r) : 1
    const s = this.stops
    if (s.length === 0) return [0, 0, 0, 0]
    if (t <= s[0]!.at) return s[0]!.c
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1]!
      const b = s[i]!
      if (t <= b.at) {
        const k = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1
        return [a.c[0] + (b.c[0] - a.c[0]) * k, a.c[1] + (b.c[1] - a.c[1]) * k, a.c[2] + (b.c[2] - a.c[2]) * k, a.c[3] + (b.c[3] - a.c[3]) * k]
      }
    }
    return s[s.length - 1]!.c
  }
}

const colorCache = new Map<string, RGBA>()

export function parseColor(s: string): RGBA {
  const hit = colorCache.get(s)
  if (hit) return hit
  let c: RGBA = [0, 0, 0, 1]
  const t = s.trim()
  if (t.startsWith('#')) {
    let h = t.slice(1)
    if (h.length === 3 || h.length === 4) h = h.split('').map(x => x + x).join('')
    const n = parseInt(h.slice(0, 6), 16)
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]
  } else {
    const m = /rgba?\(([^)]+)\)/.exec(t)
    if (m) {
      const p = m[1]!.split(',').map(x => parseFloat(x))
      c = [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1]
    } else if (t === 'transparent') c = [0, 0, 0, 0]
    else if (t === 'white') c = [255, 255, 255, 1]
    else if (t === 'black') c = [0, 0, 0, 1]
  }
  colorCache.set(s, c)
  return c
}

type Composite = 'source-over' | 'lighter' | 'multiply'
type Clip = { x0: number; y0: number; x1: number; y1: number }
type Saved = { alpha: number; op: Composite; fill: string | RadialGradient; clip: Clip; sx: number; sy: number; tx: number; ty: number }

export class Canvas {
  data: Uint8ClampedArray
  private ctx: Ctx | null = null
  constructor(
    public width: number,
    public height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4)
  }
  getContext(_kind?: string, _opts?: unknown): Ctx {
    this.ctx ??= new Ctx(this)
    return this.ctx
  }
}

export class Ctx {
  globalAlpha = 1
  globalCompositeOperation: Composite = 'source-over'
  fillStyle: string | RadialGradient = '#000'
  imageSmoothingEnabled = false
  private clipR: Clip
  private stack: Saved[] = []
  private path: [number, number][][] = []
  // the only transform the engine uses: translate then scale by ±1, to mirror a sprite
  private sx = 1
  private sy = 1
  private tx = 0
  private ty = 0

  constructor(readonly canvas: Canvas) {
    this.clipR = { x0: 0, y0: 0, x1: canvas.width, y1: canvas.height }
  }

  save() {
    this.stack.push({ alpha: this.globalAlpha, op: this.globalCompositeOperation, fill: this.fillStyle, clip: { ...this.clipR }, sx: this.sx, sy: this.sy, tx: this.tx, ty: this.ty })
  }
  restore() {
    const s = this.stack.pop()
    if (!s) return
    this.globalAlpha = s.alpha
    this.globalCompositeOperation = s.op
    this.fillStyle = s.fill
    this.clipR = s.clip
    this.sx = s.sx
    this.sy = s.sy
    this.tx = s.tx
    this.ty = s.ty
  }
  translate(x: number, y: number) {
    this.tx += x * this.sx
    this.ty += y * this.sy
  }
  scale(x: number, y: number) {
    this.sx *= x
    this.sy *= y
  }

  createRadialGradient(_x0: number, _y0: number, _r0: number, x1: number, y1: number, r1: number) {
    return new RadialGradient(x1, y1, r1)
  }

  /** One device pixel: the colour blended in with the alpha and composite of the moment. */
  private put(x: number, y: number, c: RGBA) {
    const cl = this.clipR
    if (x < cl.x0 || y < cl.y0 || x >= cl.x1 || y >= cl.y1) return
    const d = this.canvas.data
    const i = (y * this.canvas.width + x) * 4
    const a = c[3] * this.globalAlpha
    if (a <= 0) return
    const op = this.globalCompositeOperation
    if (op === 'lighter') {
      d[i] = d[i]! + c[0] * a
      d[i + 1] = d[i + 1]! + c[1] * a
      d[i + 2] = d[i + 2]! + c[2] * a
      d[i + 3] = d[i + 3]! + a * 255
      return
    }
    if (op === 'multiply') {
      d[i] = d[i]! * (1 - a) + ((d[i]! * c[0]) / 255) * a
      d[i + 1] = d[i + 1]! * (1 - a) + ((d[i + 1]! * c[1]) / 255) * a
      d[i + 2] = d[i + 2]! * (1 - a) + ((d[i + 2]! * c[2]) / 255) * a
      return
    }
    const da = d[i + 3]! / 255
    const oa = a + da * (1 - a)
    if (oa <= 0) return
    d[i] = (c[0] * a + d[i]! * da * (1 - a)) / oa
    d[i + 1] = (c[1] * a + d[i + 1]! * da * (1 - a)) / oa
    d[i + 2] = (c[2] * a + d[i + 2]! * da * (1 - a)) / oa
    d[i + 3] = oa * 255
  }

  /** A user-space rectangle as device pixels, through the mirror transform. */
  private span(x: number, y: number, w: number, h: number): Clip {
    const ax = this.tx + this.sx * x
    const bx = this.tx + this.sx * (x + w)
    const ay = this.ty + this.sy * y
    const by = this.ty + this.sy * (y + h)
    return { x0: Math.round(Math.min(ax, bx)), x1: Math.round(Math.max(ax, bx)), y0: Math.round(Math.min(ay, by)), y1: Math.round(Math.max(ay, by)) }
  }

  fillRect(x: number, y: number, w: number, h: number) {
    const r = this.span(x, y, w, h)
    const f = this.fillStyle
    if (typeof f === 'string') {
      const c = parseColor(f)
      for (let py = r.y0; py < r.y1; py++) for (let px = r.x0; px < r.x1; px++) this.put(px, py, c)
    } else {
      for (let py = r.y0; py < r.y1; py++) for (let px = r.x0; px < r.x1; px++) this.put(px, py, f.colorAt(px + 0.5, py + 0.5))
    }
  }

  clearRect(x: number, y: number, w: number, h: number) {
    const r = this.span(x, y, w, h)
    const d = this.canvas.data
    for (let py = Math.max(0, r.y0); py < Math.min(this.canvas.height, r.y1); py++)
      for (let px = Math.max(0, r.x0); px < Math.min(this.canvas.width, r.x1); px++) d.fill(0, (py * this.canvas.width + px) * 4, (py * this.canvas.width + px) * 4 + 4)
  }

  drawImage(src: Canvas, ...a: number[]) {
    let sx = 0
    let sy = 0
    let sw = src.width
    let sh = src.height
    let dx: number
    let dy: number
    let dw: number
    let dh: number
    if (a.length >= 8) [sx, sy, sw, sh, dx, dy, dw, dh] = a as [number, number, number, number, number, number, number, number]
    else if (a.length >= 4) [dx, dy, dw, dh] = a as [number, number, number, number]
    else {
      ;[dx, dy] = a as [number, number]
      dw = sw
      dh = sh
    }
    const r = this.span(dx, dy, dw, dh)
    const flipX = this.sx < 0
    const flipY = this.sy < 0
    const s = src.data
    const W = r.x1 - r.x0
    const H = r.y1 - r.y0
    if (W <= 0 || H <= 0) return
    const c: RGBA = [0, 0, 0, 0]
    for (let j = 0; j < H; j++) {
      const v = flipY ? H - 1 - j : j
      const syy = Math.floor(sy + (v * sh) / H)
      if (syy < 0 || syy >= src.height) continue
      for (let i = 0; i < W; i++) {
        const u = flipX ? W - 1 - i : i
        const sxx = Math.floor(sx + (u * sw) / W)
        if (sxx < 0 || sxx >= src.width) continue
        const k = (syy * src.width + sxx) * 4
        const alpha = s[k + 3]!
        if (alpha === 0) continue
        c[0] = s[k]!
        c[1] = s[k + 1]!
        c[2] = s[k + 2]!
        c[3] = alpha / 255
        this.put(r.x0 + i, r.y0 + j, c)
      }
    }
  }

  getImageData(x: number, y: number, w: number, h: number) {
    const out = new Uint8ClampedArray(w * h * 4)
    const d = this.canvas.data
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const sx = x + i
      const sy = y + j
      if (sx < 0 || sy < 0 || sx >= this.canvas.width || sy >= this.canvas.height) continue
      out.set(d.subarray((sy * this.canvas.width + sx) * 4, (sy * this.canvas.width + sx) * 4 + 4), (j * w + i) * 4)
    }
    return { data: out, width: w, height: h }
  }

  // ── paths: rectangles (for clips) and polygons (filled) ──
  beginPath() {
    this.path = []
  }
  moveTo(x: number, y: number) {
    this.path.push([[x, y]])
  }
  lineTo(x: number, y: number) {
    if (this.path.length === 0) this.path.push([])
    this.path[this.path.length - 1]!.push([x, y])
  }
  closePath() {}
  rect(x: number, y: number, w: number, h: number) {
    this.path.push([
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ])
  }
  clip() {
    // the engine clips to one rectangle at a time: its bounds, met with the clip already set
    const pts = this.path.flat()
    if (!pts.length) return
    const r = this.span(Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), 0, 0)
    const r2 = this.span(Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1])), 0, 0)
    const cl = this.clipR
    this.clipR = { x0: Math.max(cl.x0, Math.min(r.x0, r2.x0)), y0: Math.max(cl.y0, Math.min(r.y0, r2.y0)), x1: Math.min(cl.x1, Math.max(r.x0, r2.x0)), y1: Math.min(cl.y1, Math.max(r.y0, r2.y0)) }
  }
  fill() {
    const f = this.fillStyle
    const solid = typeof f === 'string' ? parseColor(f) : null
    for (const poly of this.path) {
      if (poly.length < 3) continue
      const pts = poly.map(([x, y]) => [this.tx + this.sx * x, this.ty + this.sy * y] as [number, number])
      const y0 = Math.floor(Math.min(...pts.map(p => p[1])))
      const y1 = Math.ceil(Math.max(...pts.map(p => p[1])))
      for (let py = y0; py < y1; py++) {
        const cy = py + 0.5
        const xs: number[] = []
        for (let i = 0; i < pts.length; i++) {
          const [ax, ay] = pts[i]!
          const [bx, by] = pts[(i + 1) % pts.length]!
          if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax))
        }
        xs.sort((p, q) => p - q)
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (let px = Math.round(xs[k]!); px < Math.round(xs[k + 1]!); px++) this.put(px, py, solid ?? (f as RadialGradient).colorAt(px + 0.5, cy))
        }
      }
    }
  }
}
