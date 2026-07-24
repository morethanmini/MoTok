/**
 * 핑거 스타 별자리 데이터 생성·검증 스크립트.
 *
 * 사용: node scripts/generate-constellations.mjs
 * 출력: 별자리별 검증 리포트 + constellations.ts에 붙여넣을 항목 코드.
 *
 * 좌표 산출 — 실제 별의 J2000 적경(RA)/적위(Dec)를 평면 투영:
 *  - x = ΔRA(도) × cos(평균 Dec) : 고위도 적경 수렴 보정(모양 가로 왜곡 방지)
 *  - y = Dec 감소 방향(화면 아래 = 남쪽)
 *  - 두 축 중 큰 span으로 0~1 정규화, 작은 축은 중앙 배치(기존 데이터 컨벤션)
 *
 * 검증 규칙 — 게임 제약(logic.ts 상수)에서 유도:
 *  - 별 개수 5~8 (열 손가락 상한 10의 실용 범위)
 *  - 모든 좌표 0~1 범위
 *  - 최소 점간 거리 ≥ 0.08 : 판정 반경 비율(HIT_RADIUS_RATIO 0.08)과 같은 단위.
 *    기존 오리온 벨트(≈0.069)가 "플레이 가능한 하한"의 실측 기준점이므로
 *    신규 도안은 그보다 여유 있게 잡는다.
 *
 * 난이도 제안은 참고용 — 최종 difficulty는 카탈로그에 직접 기재하고,
 * 플레이테스트 후 조정한다.
 */

/** @type {{key: string, name: string, difficulty: 'EASY'|'NORMAL'|'HARD', stars: {n: string, ra: number, dec: number}[]}[]} */
const CATALOG = [
  {
    key: 'big-dipper',
    name: '북두칠성',
    difficulty: 'NORMAL',
    stars: [
      { n: 'Dubhe (α UMa) — 국자 입구 위', ra: 11.062, dec: 61.75 },
      { n: 'Merak (β UMa) — 국자 입구 아래', ra: 11.03, dec: 56.38 },
      { n: 'Phecda (γ UMa) — 국자 바닥', ra: 11.897, dec: 53.69 },
      { n: 'Megrez (δ UMa) — 국자 손잡이 접점', ra: 12.257, dec: 57.03 },
      { n: 'Alioth (ε UMa) — 손잡이', ra: 12.9, dec: 55.96 },
      { n: 'Mizar (ζ UMa) — 손잡이', ra: 13.399, dec: 54.93 },
      { n: 'Alkaid (η UMa) — 손잡이 끝', ra: 13.792, dec: 49.31 },
    ],
  },
  {
    key: 'corona-borealis',
    name: '북쪽왕관자리',
    difficulty: 'EASY',
    stars: [
      { n: 'Nusakan (β CrB)', ra: 15.464, dec: 29.11 },
      { n: 'Alphecca (α CrB) — 가장 밝은 별', ra: 15.578, dec: 26.71 },
      { n: 'Gamma CrB (γ)', ra: 15.712, dec: 26.3 },
      { n: 'Delta CrB (δ)', ra: 15.826, dec: 26.07 },
      { n: 'Epsilon CrB (ε)', ra: 15.96, dec: 26.88 },
      { n: 'Iota CrB (ι)', ra: 16.024, dec: 29.85 },
    ],
  },
  {
    key: 'cepheus',
    name: '세페우스자리',
    difficulty: 'EASY',
    stars: [
      { n: 'Alderamin (α Cep) — 집 왼쪽 아래', ra: 21.31, dec: 62.59 },
      { n: 'Alfirk (β Cep) — 집 왼쪽 위', ra: 21.478, dec: 70.56 },
      { n: 'Errai (γ Cep) — 지붕 꼭대기', ra: 23.656, dec: 77.63 },
      { n: 'Iota Cep (ι) — 집 오른쪽 위', ra: 22.828, dec: 66.2 },
      { n: 'Zeta Cep (ζ) — 집 오른쪽 아래', ra: 22.181, dec: 58.2 },
    ],
  },
  {
    key: 'auriga',
    name: '마차부자리',
    difficulty: 'EASY',
    stars: [
      { n: 'Capella (α Aur) — 가장 밝은 별', ra: 5.278, dec: 46.0 },
      { n: 'Menkalinan (β Aur)', ra: 5.992, dec: 44.95 },
      { n: 'Theta Aur (θ)', ra: 5.995, dec: 37.21 },
      { n: 'Elnath (β Tau, 공유 별)', ra: 5.438, dec: 28.61 },
      { n: 'Hassaleh (ι Aur)', ra: 4.95, dec: 33.17 },
    ],
  },
  {
    key: 'lyra',
    name: '거문고자리',
    difficulty: 'EASY',
    stars: [
      { n: 'Vega (α Lyr) — 직녀성', ra: 18.616, dec: 38.78 },
      { n: 'Zeta Lyr (ζ)', ra: 18.746, dec: 37.61 },
      { n: 'Delta Lyr (δ)', ra: 18.908, dec: 36.9 },
      { n: 'Sulafat (γ Lyr)', ra: 18.982, dec: 32.69 },
      { n: 'Sheliak (β Lyr)', ra: 18.835, dec: 33.36 },
    ],
  },
  {
    key: 'leo',
    name: '사자자리',
    difficulty: 'NORMAL',
    stars: [
      { n: 'Regulus (α Leo) — 낫 손잡이 끝', ra: 10.139, dec: 11.97 },
      { n: 'Eta Leo (η)', ra: 10.122, dec: 16.76 },
      { n: 'Algieba (γ Leo)', ra: 10.333, dec: 19.84 },
      { n: 'Adhafera (ζ Leo)', ra: 10.278, dec: 23.42 },
      { n: 'Rasalas (μ Leo)', ra: 9.879, dec: 26.01 },
      { n: 'Epsilon Leo (ε) — 낫 날 끝', ra: 9.764, dec: 23.77 },
    ],
  },
  {
    key: 'bootes',
    name: '목동자리',
    difficulty: 'NORMAL',
    stars: [
      { n: 'Arcturus (α Boo) — 연 아래 꼭짓점', ra: 14.261, dec: 19.18 },
      { n: 'Izar (ε Boo)', ra: 14.749, dec: 27.07 },
      { n: 'Delta Boo (δ)', ra: 15.258, dec: 33.31 },
      { n: 'Nekkar (β Boo) — 연 꼭대기', ra: 15.032, dec: 40.39 },
      { n: 'Gamma Boo (γ)', ra: 14.535, dec: 38.31 },
      { n: 'Rho Boo (ρ)', ra: 14.53, dec: 30.37 },
    ],
  },
  {
    key: 'scorpius',
    name: '전갈자리',
    difficulty: 'HARD',
    stars: [
      { n: 'Acrab (β Sco) — 집게 머리', ra: 16.091, dec: -19.81 },
      { n: 'Dschubba (δ Sco)', ra: 16.006, dec: -22.62 },
      { n: 'Antares (α Sco) — 심장, 가장 밝은 별', ra: 16.49, dec: -26.43 },
      { n: 'Tau Sco (τ)', ra: 16.598, dec: -28.22 },
      { n: 'Epsilon Sco (ε)', ra: 16.836, dec: -34.29 },
      { n: 'Sargas (θ Sco) — 꼬리 굽이', ra: 17.622, dec: -43.0 },
      { n: 'Shaula (λ Sco) — 독침', ra: 17.56, dec: -37.1 },
    ],
  },
  {
    key: 'taurus',
    name: '황소자리',
    difficulty: 'HARD',
    stars: [
      { n: 'Elnath (β Tau) — 북쪽 뿔 끝', ra: 5.438, dec: 28.61 },
      { n: 'Ain (ε Tau) — 히아데스 위', ra: 4.477, dec: 19.18 },
      { n: 'Gamma Tau (γ) — V자 꼭짓점', ra: 4.33, dec: 15.63 },
      { n: 'Theta² Tau (θ²)', ra: 4.478, dec: 15.87 },
      { n: 'Aldebaran (α Tau) — 황소의 눈', ra: 4.599, dec: 16.51 },
      { n: 'Zeta Tau (ζ) — 남쪽 뿔 끝', ra: 5.628, dec: 21.14 },
    ],
  },
]

const MIN_STARS = 5
const MAX_STARS = 8
const MIN_PAIR_DIST = 0.08

/** RA/Dec → 0~1 정규화 좌표 (큰 축 기준, 작은 축 중앙 배치) */
function project(stars) {
  const decMean = stars.reduce((a, s) => a + s.dec, 0) / stars.length
  const cosd = Math.cos((decMean * Math.PI) / 180)
  const xs = stars.map((s) => s.ra * 15 * cosd)
  const ys = stars.map((s) => -s.dec)
  const xMin = Math.min(...xs)
  const yMin = Math.min(...ys)
  const spanX = Math.max(...xs) - xMin
  const spanY = Math.max(...ys) - yMin
  const span = Math.max(spanX, spanY)
  const offX = (1 - spanX / span) / 2
  const offY = (1 - spanY / span) / 2
  return stars.map((s, i) => [offX + (xs[i] - xMin) / span, offY + (ys[i] - yMin) / span])
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

function metrics(pts) {
  let minPair = Infinity
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) minPair = Math.min(minPair, dist(pts[i], pts[j]))
  const segs = pts.slice(1).map((p, i) => dist(p, pts[i]))
  return { minPair, segRatio: Math.max(...segs) / Math.min(...segs) }
}

/** 참고용 난이도 제안 — 별 수·최소 간격·구간 편차의 단순 합산 */
function suggestDifficulty(n, { minPair, segRatio }) {
  let s = 0
  s += n <= 5 ? 0 : n === 6 ? 1 : 2
  s += minPair >= 0.2 ? 0 : minPair >= 0.12 ? 1 : 2
  s += segRatio <= 3 ? 0 : segRatio <= 6 ? 1 : 2
  return s <= 1 ? 'EASY' : s <= 3 ? 'NORMAL' : 'HARD'
}

function validate(c, pts) {
  const errors = []
  if (pts.length < MIN_STARS || pts.length > MAX_STARS)
    errors.push(`별 개수 ${pts.length} — 허용 범위 ${MIN_STARS}~${MAX_STARS}`)
  pts.forEach(([x, y], i) => {
    if (x < -1e-9 || x > 1 + 1e-9 || y < -1e-9 || y > 1 + 1e-9)
      errors.push(`점 ${i} 좌표 범위 이탈 (${x.toFixed(3)}, ${y.toFixed(3)})`)
  })
  const m = metrics(pts)
  if (m.minPair < MIN_PAIR_DIST)
    errors.push(`최소 점간 거리 ${m.minPair.toFixed(3)} < ${MIN_PAIR_DIST} — 판정 원 겹침`)
  return { errors, m }
}

let failed = false
const rows = []
const tsBlocks = []

for (const c of CATALOG) {
  const pts = project(c.stars)
  const { errors, m } = validate(c, pts)
  if (errors.length) {
    failed = true
    console.error(`✗ ${c.key}:`)
    errors.forEach((e) => console.error(`    ${e}`))
  }
  rows.push({
    key: c.key,
    stars: pts.length,
    minPair: m.minPair.toFixed(3),
    segRatio: m.segRatio.toFixed(1),
    suggested: suggestDifficulty(pts.length, m),
    assigned: c.difficulty,
  })
  const ptLines = pts
    .map(([x, y], i) => `      [${x.toFixed(3)}, ${y.toFixed(3)}], // ${c.stars[i].n}`)
    .join('\n')
  tsBlocks.push(
    `  {\n    key: '${c.key}',\n    name: '${c.name}',\n    difficulty: '${c.difficulty}',\n    pts: [\n${ptLines}\n    ],\n  },`,
  )
}

console.log('\n── 검증 리포트 ──')
console.table(rows)

if (failed) {
  console.error('\n검증 실패 — 위 오류를 수정한 뒤 다시 실행하세요.')
  process.exit(1)
}

console.log('\n── constellations.ts 항목 (붙여넣기) ──\n')
console.log(tsBlocks.join('\n'))
