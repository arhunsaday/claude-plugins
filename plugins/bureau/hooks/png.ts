// PNG out of an RGBA buffer, for a hooks module that has no canvas to call toDataURL on: 8-bit RGB, each row
// filtered with Sub, compressed with deflate (LZ77 over a hash chain, fixed Huffman codes). Pixel art is mostly
// runs, so a 352 × 256 frame comes out at a few tens of kilobytes.

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = CRC[(c ^ bytes[i]!) & 255]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

class Bits {
  private out: number[] = []
  private acc = 0
  private n = 0
  /** `count` bits of `value`, least significant first, as deflate packs them. */
  put(value: number, count: number) {
    for (let i = 0; i < count; i++) {
      this.acc |= ((value >> i) & 1) << this.n
      if (++this.n === 8) {
        this.out.push(this.acc)
        this.acc = 0
        this.n = 0
      }
    }
  }
  /** A Huffman code, most significant bit first. */
  code(value: number, count: number) {
    for (let i = count - 1; i >= 0; i--) this.put((value >> i) & 1, 1)
  }
  bytes(): Uint8Array {
    if (this.n > 0) this.out.push(this.acc)
    return Uint8Array.from(this.out)
  }
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

function literal(b: Bits, v: number) {
  if (v < 144) b.code(0x30 + v, 8)
  else if (v < 256) b.code(0x190 + v - 144, 9)
  else if (v < 280) b.code(v - 256, 7)
  else b.code(0xc0 + v - 280, 8)
}

function lengthCode(b: Bits, len: number) {
  let i = LEN_BASE.length - 1
  while (LEN_BASE[i]! > len) i--
  literal(b, 257 + i)
  b.put(len - LEN_BASE[i]!, LEN_EXTRA[i]!)
}

function distCode(b: Bits, dist: number) {
  let i = DIST_BASE.length - 1
  while (DIST_BASE[i]! > dist) i--
  b.code(i, 5)
  b.put(dist - DIST_BASE[i]!, DIST_EXTRA[i]!)
}

/** Raw deflate: one final block of fixed Huffman codes. */
function deflate(data: Uint8Array): Uint8Array {
  const b = new Bits()
  b.put(1, 1) // final block
  b.put(1, 2) // fixed Huffman
  const WIN = 32768
  const head = new Int32Array(1 << 15).fill(-1)
  const prev = new Int32Array(WIN)
  const hash = (i: number) => ((data[i]! << 10) ^ (data[i + 1]! << 5) ^ data[i + 2]!) & 0x7fff
  const insert = (i: number) => {
    if (i + 2 >= data.length) return
    const h = hash(i)
    prev[i % WIN] = head[h]!
    head[h] = i
  }
  let i = 0
  while (i < data.length) {
    let bestLen = 0
    let bestDist = 0
    if (i + 2 < data.length) {
      let j = head[hash(i)]!
      let chain = 48
      while (j >= 0 && i - j <= WIN && chain-- > 0) {
        let l = 0
        while (l < 258 && i + l < data.length && data[j + l] === data[i + l]) l++
        if (l > bestLen) {
          bestLen = l
          bestDist = i - j
          if (l === 258) break
        }
        const nj = prev[j % WIN]!
        if (nj >= j) break
        j = nj
      }
    }
    if (bestLen >= 3) {
      lengthCode(b, bestLen)
      distCode(b, bestDist)
      for (let k = 0; k < bestLen; k++) insert(i + k)
      i += bestLen
    } else {
      literal(b, data[i]!)
      insert(i)
      i++
    }
  }
  literal(b, 256) // end of block
  return b.bytes()
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, body.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  v.setUint32(8 + body.length, crc32(out, 4, 8 + body.length))
  return out
}

/** A PNG of `w × h` RGBA pixels, alpha dropped (the office is opaque). */
export function encodePng(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  // filter Sub on every row: the difference with the pixel to the left, mostly zeros in flat colour
  const raw = new Uint8Array(h * (1 + w * 3))
  let k = 0
  for (let y = 0; y < h; y++) {
    raw[k++] = 1
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) raw[k++] = (rgba[i + c]! - (x > 0 ? rgba[i - 4 + c]! : 0)) & 255
    }
  }
  const z = deflate(raw)
  const zlib = new Uint8Array(2 + z.length + 4)
  zlib[0] = 0x78
  zlib[1] = 0x01
  zlib.set(z, 2)
  new DataView(zlib.buffer).setUint32(2 + z.length, adler32(raw))
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, w)
  hv.setUint32(4, h)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', ihdr), chunk('IDAT', zlib), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64(bytes: Uint8Array): string {
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
