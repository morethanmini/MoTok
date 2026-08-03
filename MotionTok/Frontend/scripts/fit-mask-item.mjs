/**
 * 가면 아이템 그림을 얼굴 추적 규약에 맞춘다 (S15P11A706 가면 아이템).
 *
 *   node scripts/fit-mask-item.mjs public/assets/item/mask/mong_mask.png
 *
 * <b>왜 필요한가.</b> 오버레이는 가면 이미지의 <b>중심</b>을 두 눈의 중앙에 놓고, 폭을
 * `실제 눈 간격 ÷ MASK_EYE_GAP_RATIO`로 잡는다(src/features/decor/faceAnchor.ts).
 * 그래서 그림이 지켜야 하는 건 두 가지다.
 *
 *   ① 두 눈의 중앙이 캔버스의 <b>정중앙</b>(가로·세로 모두)
 *   ② 두 눈 간격이 캔버스 가로 폭의 <b>MASK_EYE_GAP_RATIO</b>
 *
 * 그림쟁이가 이걸 맞춰 그릴 이유는 없다. 그래서 받은 그림에서 눈을 찾아 ①을 투명 여백으로
 * 맞추고, ②는 그림의 성질이라 <b>측정해서 알려 준다</b> — 값이 코드와 다르면 실패시킨다.
 * (여백으로 ②를 맞출 수는 없다: 여백을 넣으면 폭이 늘어 비율이 오히려 내려간다.)
 *
 * 눈은 "어두운 덩어리 중 좌우 대칭인 같은 크기 한 쌍"으로 찾는다. 외곽선은 면적이 압도적이고
 * 코·입은 가운데 하나뿐이라 대칭 짝이 없어 자연히 걸러진다.
 */
import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ANCHOR_TS = resolve(HERE, '../src/features/decor/faceAnchor.ts')

/** 이 값 미만의 알파는 배경으로 본다 — 그림 밖에 거의 안 보이는 후광이 깔려 있는 경우가 있다. */
const ALPHA_FLOOR = 64
/** 눈·코·외곽선을 가르는 밝기 상한(0~255). */
const DARK_MAX = 110
/** 눈 한 쌍으로 인정할 조건 — 면적 비율, 세로 위치 차이(짧은 변 대비), 좌우 대칭 오차. */
const PAIR = { areaRatio: 0.6, dyRatio: 0.06, symmetryRatio: 0.04 }

// ── PNG (RGBA 8bit 비인터레이스) ────────────────────────────
// 프로젝트에 이미지 라이브러리가 없다. 필요한 건 이 한 가지 형식뿐이라 직접 다룬다.

function decodePng(path) {
  const buf = readFileSync(path)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 파일이 아니다')
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  const depth = buf[24]
  const colorType = buf[25]
  const interlace = buf[28]
  if (depth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`지원하지 않는 PNG: depth=${depth} colorType=${colorType} interlace=${interlace}`)
  }
  const channels = colorType === 6 ? 4 : 3

  const idat = []
  let off = 8
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len))
    if (type === 'IEND') break
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))

  const stride = width * channels
  const data = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride))
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = v & 0xff
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels
      const d = (y * width + x) * 4
      data[d] = line[s]
      data[d + 1] = line[s + 1]
      data[d + 2] = line[s + 2]
      data[d + 3] = channels === 4 ? line[s + 3] : 255
    }
    prev = line
  }
  return { width, height, data }
}

function crc32(buf) {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, body) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(body.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([len, typed, crc])
}

/**
 * 스캔라인마다 필터 0~4를 다 재 보고 가장 작은 것을 고른다(PNG 표준 휴리스틱).
 * 무손실인데 이 그림에서 파일이 눈에 띄게 줄어든다 — 필터 없음으로 쓰면 덧없이 크다.
 */
function filterScanline(line, prev, out) {
  const bpp = 4
  let best = null
  for (let filter = 0; filter <= 4; filter++) {
    const buf = Buffer.alloc(line.length)
    let cost = 0
    for (let i = 0; i < line.length; i++) {
      const a = i >= bpp ? line[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v
      if (filter === 0) v = line[i]
      else if (filter === 1) v = line[i] - a
      else if (filter === 2) v = line[i] - b
      else if (filter === 3) v = line[i] - ((a + b) >> 1)
      else {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = line[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      buf[i] = v & 0xff
      cost += buf[i] < 128 ? buf[i] : 256 - buf[i] // 0에 가까울수록 잘 압축된다
    }
    if (!best || cost < best.cost) best = { filter, buf, cost }
  }
  out[0] = best.filter
  best.buf.copy(out, 1)
}

function encodePng(path, { width, height, data }) {
  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const line = data.subarray(y * stride, (y + 1) * stride)
    filterScanline(line, prev, raw.subarray(y * (stride + 1), (y + 1) * (stride + 1)))
    prev = line
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

/**
 * 알파를 곱해서 평균한 뒤 되돌리는 축소(박스 필터).
 *
 * 알파를 무시하고 RGB만 평균하면 투명 픽셀의 색이 섞여 들어와 <b>테두리에 검은 띠</b>가 생긴다
 * (그림 밖 픽셀의 RGB는 아무 값이나 들어 있다). 곱해서 평균하면 투명한 쪽은 기여하지 않는다.
 */
function downscale({ width, height, data }, scale) {
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const out = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * height) / h)
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * height) / h))
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * width) / w)
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * width) / w))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * width + sx) * 4
          const alpha = data[i + 3]
          r += data[i] * alpha
          g += data[i + 1] * alpha
          b += data[i + 2] * alpha
          a += alpha
          n++
        }
      }
      const d = (y * w + x) * 4
      if (a > 0) {
        out[d] = Math.round(r / a)
        out[d + 1] = Math.round(g / a)
        out[d + 2] = Math.round(b / a)
      }
      out[d + 3] = Math.round(a / n)
    }
  }
  return { width: w, height: h, data: out }
}

// ── 분석 ──────────────────────────────────────────────────

/** 알파가 살아 있는 영역의 최소 사각형. 그림 밖 후광은 ALPHA_FLOOR로 잘라 낸다. */
function opaqueBounds({ width, height, data }) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < ALPHA_FLOOR) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) throw new Error('불투명한 픽셀이 없다 — 빈 그림인가?')
  return { x0, y0, x1, y1 }
}

/** 어두우면서 불투명한 픽셀의 연결요소(4방향). */
function darkComponents(img, box) {
  const { width, data } = img
  const seen = new Uint8Array(width * img.height)
  const isDark = (x, y) => {
    const i = (y * width + x) * 4
    if (data[i + 3] < 128) return false
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] <= DARK_MAX
  }

  const comps = []
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const start = y * width + x
      if (seen[start] || !isDark(x, y)) continue
      seen[start] = 1
      const stack = [start]
      let n = 0, sx = 0, sy = 0, bx0 = width, by0 = img.height, bx1 = -1, by1 = -1
      while (stack.length) {
        const j = stack.pop()
        const px = j % width
        const py = (j - px) / width
        n++; sx += px; sy += py
        if (px < bx0) bx0 = px
        if (px > bx1) bx1 = px
        if (py < by0) by0 = py
        if (py > by1) by1 = py
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx
          const ny = py + dy
          if (nx < box.x0 || ny < box.y0 || nx > box.x1 || ny > box.y1) continue
          const k = ny * width + nx
          if (seen[k] || !isDark(nx, ny)) continue
          seen[k] = 1
          stack.push(k)
        }
      }
      comps.push({ n, cx: sx / n, cy: sy / n, bw: bx1 - bx0 + 1, bh: by1 - by0 + 1 })
    }
  }
  return comps.sort((a, b) => b.n - a.n)
}

/**
 * 좌우 대칭인 같은 크기 한 쌍 = 눈. 큰 것부터 본다(눈은 코·입 다음으로 크다).
 *
 * 대칭의 기준선은 <b>그림의 중심</b>이 아니라 짝 자체의 중점이다 — 귀가 한쪽으로 쏠린 그림도
 * 눈은 서로 대칭이기 때문이다. 대신 그 중점이 그림 중심에서 크게 벗어나면 눈이 아니라고 본다.
 */
function findEyes(comps, box) {
  const shortSide = Math.min(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1)
  const centerX = (box.x0 + box.x1) / 2
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      const [a, b] = comps[i].cx < comps[j].cx ? [comps[i], comps[j]] : [comps[j], comps[i]]
      if (Math.min(a.n, b.n) / Math.max(a.n, b.n) < PAIR.areaRatio) continue
      if (Math.abs(a.cy - b.cy) > shortSide * PAIR.dyRatio) continue
      if (Math.abs((a.cx + b.cx) / 2 - centerX) > shortSide * PAIR.symmetryRatio) continue
      if (a.cx === b.cx) continue
      return { left: a, right: b }
    }
  }
  throw new Error('눈 한 쌍을 찾지 못했다 — DARK_MAX·PAIR 조건을 그림에 맞춰 조정할 것')
}

/** faceAnchor.ts에 박혀 있는 규약 값을 읽어 온다(코드와 그림이 어긋나는 걸 막는다). */
function ratioInCode() {
  const source = readFileSync(ANCHOR_TS, 'utf8')
  const match = source.match(/MASK_EYE_GAP_RATIO\s*=\s*([\d.]+)/)
  if (!match) throw new Error(`${ANCHOR_TS}에서 MASK_EYE_GAP_RATIO를 찾지 못했다`)
  return Number(match[1])
}

// ── 실행 ──────────────────────────────────────────────────

const args = process.argv.slice(2)
const maxWidthArg = args.find((a) => a.startsWith('--max-width='))
const [input, output = input] = args.filter((a) => !a.startsWith('--'))
if (!input) {
  console.error('사용법: node scripts/fit-mask-item.mjs <가면.png> [출력.png] [--max-width=N]')
  process.exit(1)
}

/**
 * 화면에 그려지는 폭은 `실제 눈 간격 ÷ 비율`이라 프리뷰(640px)에서 200px 안쪽, 큰 셀프 타일에서도
 * 400px 정도다. 고해상도 화면을 위해 2배를 남겨도 이 정도면 충분하고, 원본 그대로는 파일이 크다.
 */
const MAX_WIDTH = Number(maxWidthArg?.split('=')[1] ?? 512)

/**
 * 눈을 찾아 "눈 중앙이 정중앙"인 캔버스를 만든다.
 *
 * 모자란 쪽에만 투명 여백을 넣고 <b>잘라 내지 않는다</b> — 규약을 맞추려고 그림을 깎으면
 * 볼·귀가 사라진다. 여백은 렌더링에 영향이 없다(중심이 곧 눈 중앙이라는 약속만 지키면 된다).
 */
function fit(img) {
  const box = opaqueBounds(img)
  const eyes = findEyes(darkComponents(img, box), box)
  const gap = Math.hypot(eyes.right.cx - eyes.left.cx, eyes.right.cy - eyes.left.cy)
  const eyeX = Math.round((eyes.left.cx + eyes.right.cx) / 2)
  const eyeY = Math.round((eyes.left.cy + eyes.right.cy) / 2)

  const radiusX = Math.max(eyeX - box.x0, box.x1 - eyeX)
  const radiusY = Math.max(eyeY - box.y0, box.y1 - eyeY)
  const width = radiusX * 2 + 1
  const height = radiusY * 2 + 1
  const offsetX = radiusX - (eyeX - box.x0)
  const offsetY = radiusY - (eyeY - box.y0)

  const data = Buffer.alloc(width * height * 4)
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const src = (y * img.width + x) * 4
      if (img.data[src + 3] < ALPHA_FLOOR) continue // 후광은 옮기지 않는다
      const dst = ((y - box.y0 + offsetY) * width + (x - box.x0 + offsetX)) * 4
      img.data.copy(data, dst, src, src + 4)
    }
  }
  return { width, height, data, eyes, gap, ratio: gap / width }
}

const source = decodePng(resolve(input))
/*
 * 두 번 잰다. 상한은 <b>최종 가면 폭</b>이지 원본 캔버스 폭이 아니다 — 원본은 그림 밖 여백이
 * 얼마든지 있을 수 있어서(이 그림은 1024 중 731만 그림이었다) 원본 기준으로 줄이면 가면이
 * 의도보다 작아진다. 그래서 한 번 맞춰 최종 폭을 보고, 그 값으로 배율을 정해 다시 맞춘다.
 */
const first = fit(source)
const scale = first.width > MAX_WIDTH ? MAX_WIDTH / first.width : 1
const img = scale < 1 ? downscale(source, scale) : source
const fitted = scale < 1 ? fit(img) : first
const { width, height, ratio, eyes, gap } = fitted

const inCode = ratioInCode()

console.log(`${resolve(output)}`)
console.log(`  ${source.width}x${source.height} → ${width}x${height}`
  + (scale < 1 ? ` (최종 폭 ${MAX_WIDTH}px 상한, 배율 ${scale.toFixed(3)})` : ''))
console.log(`  눈 (${eyes.left.cx.toFixed(1)}, ${eyes.left.cy.toFixed(1)}) (${eyes.right.cx.toFixed(1)}, ${eyes.right.cy.toFixed(1)})`)
console.log(`  눈 간격 ${gap.toFixed(1)}px · 눈 중앙 ((${width}-1)/2, (${height}-1)/2) = 캔버스 정중앙`)
console.log(`  눈 간격 비율 ${ratio.toFixed(4)} (faceAnchor.ts: ${inCode})`)

// 비율은 그림의 성질이라 여백으로 못 맞춘다 — 코드를 그림에 맞춰야 한다.
if (Math.abs(ratio - inCode) > 0.002) {
  console.error(
    `\n✗ 규약이 어긋난다. faceAnchor.ts의 MASK_EYE_GAP_RATIO를 ${ratio.toFixed(4)}로 바꾼 뒤 다시 실행할 것.\n` +
      '  (이 값이 틀리면 가면의 눈 구멍이 실제 눈에 맞지 않는다. 파일은 쓰지 않았다.)',
  )
  process.exit(1)
}

encodePng(resolve(output), { width, height, data: fitted.data })
console.log(`  ✓ ${(Buffer.byteLength(readFileSync(resolve(output))) / 1024).toFixed(1)}KB`)
