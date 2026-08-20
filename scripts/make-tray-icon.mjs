/**
 * 从彩色 logo PNG 生成 macOS 菜单栏模板图标(纯黑 + alpha)。
 * 用法: node scripts/make-tray-icon.mjs <彩色输入.png> <输出.png>
 * 模板图标规则: RGB 必须全为 0,形状完全由 alpha 通道决定。
 */
import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'

const [, , src, dst] = process.argv
if (!src || !dst) {
  console.error('usage: node scripts/make-tray-icon.mjs <in.png> <out.png>')
  process.exit(1)
}

const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

// ---- 解码 ----
const raw = readFileSync(src)
const w = raw.readUInt32BE(16)
const h = raw.readUInt32BE(20)
const bitDepth = raw[24]
const colorType = raw[25]
if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
  console.error(`unsupported PNG: ${w}x${h} bitDepth=${bitDepth} colorType=${colorType}`)
  process.exit(1)
}
const bpp = colorType === 6 ? 4 : 3
const stride = w * bpp + 1
const idat = []
for (let i = 8; i < raw.length;) {
  const len = raw.readUInt32BE(i)
  const type = raw.toString('ascii', i + 4, i + 8)
  if (type === 'IDAT') idat.push(raw.subarray(i + 8, i + 8 + len))
  i += 12 + len
}
const data = inflateSync(Buffer.concat(idat))

// 反滤波(支持 0-4 五种 PNG 滤波)
const px = Buffer.alloc(w * h * 4) // 展开为 RGBA
const row = Buffer.alloc(stride)
const prev = Buffer.alloc(stride)
for (let y = 0; y < h; y++) {
  data.copy(row, 0, y * stride, (y + 1) * stride)
  const f = row[0]
  for (let x = 1; x < stride; x++) {
    const a = x - bpp >= 1 ? row[x - bpp] : 0
    const b = y > 0 ? prev[x] : 0
    const c = x - bpp >= 1 && y > 0 ? prev[x - bpp] : 0
    let v = row[x]
    if (f === 1) v = (v + a) & 0xff
    else if (f === 2) v = (v + b) & 0xff
    else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff
    else if (f === 4) {
      const p = a + b - c
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
    }
    row[x] = v
  }
  row.copy(prev)
  // 写入 RGBA:RGB 全置 0,保留 alpha(模板图要求)
  for (let x = 0; x < w; x++) {
    const si = 1 + x * bpp
    px[(y * w + x) * 4] = 0
    px[(y * w + x) * 4 + 1] = 0
    px[(y * w + x) * 4 + 2] = 0
    px[(y * w + x) * 4 + 3] = bpp === 4 ? row[si + 3] : 255
  }
}

// ---- 编码(filter 0,不压缩损失) ----
const out = Buffer.alloc(h * (w * 4 + 1))
for (let y = 0; y < h; y++) {
  out[y * (w * 4 + 1)] = 0
  px.copy(out, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(w, 0)
ihdr.writeUInt32BE(h, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
writeFileSync(dst, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(out)),
  chunk('IEND', Buffer.alloc(0)),
]))
console.log(`tray icon written: ${dst} (${w}x${h}, template: black + alpha)`)
