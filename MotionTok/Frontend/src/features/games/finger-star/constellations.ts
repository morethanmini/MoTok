/**
 * 핑거 스타 별자리 정의.
 * 실제 주요 별의 적경(RA)/적위(Dec) 상대 비율을 0~1 정규화한 좌표.
 * 배열 순서 = 안내선이 이어지는 순서 = 손가락이 배정되는 별 번호.
 *
 * 신규 항목은 scripts/generate-constellations.mjs로 생성·검증한다
 * (좌표 산출 규칙·기하 검증 기준은 스크립트 헤더 참조).
 * 난이도는 60초 매치의 출제 순서에 쓰인다(처음 3개는 쉬움·보통만) — 명세의 난이도 어휘를 재사용.
 */
export type Difficulty = 'EASY' | 'NORMAL' | 'HARD'

export interface Constellation {
  key: string
  name: string
  difficulty: Difficulty
  /** [x, y] 0~1 정규화 좌표 (y는 아래 방향) */
  pts: [number, number][]
}

export const CONSTELLATIONS: Constellation[] = [
  {
    key: 'cassiopeia',
    name: '카시오페아자리',
    difficulty: 'EASY',
    pts: [
      [0.0, 0.536], // Caph (β)
      [0.298, 0.636], // Schedar (α)
      [0.452, 0.477], // Gamma Cas (γ)
      [0.728, 0.495], // Ruchbah (δ)
      [1.0, 0.364], // Segin (ε)
    ],
  },
  {
    key: 'orion',
    name: '오리온자리',
    difficulty: 'HARD',
    pts: [
      [0.376, 0.183], // Bellatrix (γ) — 왼쪽 어깨
      [0.504, 0.0], // Meissa (λ) — 머리
      [0.759, 0.129], // Betelgeuse (α) — 오른쪽 어깨
      [0.575, 0.606], // Alnitak (ζ) — 벨트 오른쪽
      [0.517, 0.568], // Alnilam (ε) — 벨트 중앙
      [0.464, 0.522], // Mintaka (δ) — 벨트 왼쪽
      [0.241, 0.925], // Rigel (β) — 왼쪽 발
      [0.665, 1.0], // Saiph (κ) — 오른쪽 발
    ],
  },
  {
    key: 'gemini',
    name: '쌍둥이자리',
    difficulty: 'NORMAL',
    pts: [
      [0.253, 0.843], // Alhena (γ)
      [0.721, 0.596], // Wasat (δ)
      [1.0, 0.328], // Pollux (β)
      [0.882, 0.157], // Castor (α)
      [0.321, 0.456], // Mebsuta (ε)
      [0.089, 0.572], // Tejat (μ)
      [0.0, 0.572], // Propus (η)
    ],
  },
  {
    key: 'big-dipper',
    name: '북두칠성',
    difficulty: 'NORMAL',
    pts: [
      [0.012, 0.234], // Dubhe (α UMa) — 국자 입구 위
      [0.0, 0.464], // Merak (β UMa) — 국자 입구 아래
      [0.314, 0.579], // Phecda (γ UMa) — 국자 바닥
      [0.444, 0.436], // Megrez (δ UMa) — 국자 손잡이 접점
      [0.677, 0.482], // Alioth (ε UMa) — 손잡이
      [0.858, 0.526], // Mizar (ζ UMa) — 손잡이
      [1.0, 0.766], // Alkaid (η UMa) — 손잡이 끝
    ],
  },
  {
    key: 'corona-borealis',
    name: '북쪽왕관자리',
    difficulty: 'EASY',
    pts: [
      [0.0, 0.346], // Nusakan (β CrB)
      [0.204, 0.668], // Alphecca (α CrB) — 가장 밝은 별
      [0.443, 0.723], // Gamma CrB (γ)
      [0.646, 0.754], // Delta CrB (δ)
      [0.886, 0.645], // Epsilon CrB (ε)
      [1.0, 0.246], // Iota CrB (ι)
    ],
  },
  {
    key: 'cepheus',
    name: '세페우스자리',
    difficulty: 'EASY',
    pts: [
      [0.147, 0.774], // Alderamin (α Cep) — 집 왼쪽 아래
      [0.197, 0.364], // Alfirk (β Cep) — 집 왼쪽 위
      [0.853, 0.0], // Errai (γ Cep) — 지붕 꼭대기
      [0.604, 0.588], // Iota Cep (ι) — 집 오른쪽 위
      [0.409, 1.0], // Zeta Cep (ζ) — 집 오른쪽 아래
    ],
  },
  {
    key: 'auriga',
    name: '마차부자리',
    difficulty: 'EASY',
    pts: [
      [0.368, 0.0], // Capella (α Aur) — 가장 밝은 별
      [0.853, 0.06], // Menkalinan (β Aur)
      [0.855, 0.505], // Theta Aur (θ)
      [0.477, 1.0], // Elnath (β Tau, 공유 별)
      [0.145, 0.738], // Hassaleh (ι Aur)
    ],
  },
  {
    key: 'lyra',
    name: '거문고자리',
    difficulty: 'EASY',
    pts: [
      [0.135, 0.0], // Vega (α Lyr) — 직녀성
      [0.394, 0.192], // Zeta Lyr (ζ)
      [0.718, 0.309], // Delta Lyr (δ)
      [0.865, 1.0], // Sulafat (γ Lyr)
      [0.572, 0.89], // Sheliak (β Lyr)
    ],
  },
  {
    key: 'leo',
    name: '사자자리',
    difficulty: 'NORMAL',
    pts: [
      [0.591, 1.0], // Regulus (α Leo) — 낫 손잡이 끝
      [0.574, 0.659], // Eta Leo (η)
      [0.785, 0.439], // Algieba (γ Leo)
      [0.73, 0.184], // Adhafera (ζ Leo)
      [0.33, 0.0], // Rasalas (μ Leo)
      [0.215, 0.16], // Epsilon Leo (ε) — 낫 날 끝
    ],
  },
  {
    key: 'bootes',
    name: '목동자리',
    difficulty: 'NORMAL',
    pts: [
      [0.199, 1.0], // Arcturus (α Boo) — 연 아래 꼭짓점
      [0.494, 0.628], // Izar (ε Boo)
      [0.801, 0.334], // Delta Boo (δ)
      [0.664, 0.0], // Nekkar (β Boo) — 연 꼭대기
      [0.365, 0.098], // Gamma Boo (γ)
      [0.362, 0.472], // Rho Boo (ρ)
    ],
  },
  {
    key: 'scorpius',
    name: '전갈자리',
    difficulty: 'HARD',
    pts: [
      [0.096, 0.0], // Acrab (β Sco) — 집게 머리
      [0.048, 0.121], // Dschubba (δ Sco)
      [0.319, 0.285], // Antares (α Sco) — 심장, 가장 밝은 별
      [0.379, 0.363], // Tau Sco (τ)
      [0.512, 0.624], // Epsilon Sco (ε)
      [0.952, 1.0], // Sargas (θ Sco) — 꼬리 굽이
      [0.917, 0.746], // Shaula (λ Sco) — 독침
    ],
  },
  {
    key: 'taurus',
    name: '황소자리',
    difficulty: 'HARD',
    pts: [
      [0.854, 0.146], // Elnath (β Tau) — 북쪽 뿔 끝
      [0.113, 0.66], // Ain (ε Tau) — 히아데스 위
      [0.0, 0.854], // Gamma Tau (γ) — V자 꼭짓점
      [0.114, 0.841], // Theta² Tau (θ²)
      [0.207, 0.806], // Aldebaran (α Tau) — 황소의 눈
      [1.0, 0.553], // Zeta Tau (ζ) — 남쪽 뿔 끝
    ],
  },
  {
    key: 'aquila',
    name: '독수리자리',
    difficulty: 'NORMAL',
    pts: [
      [0.0, 0.05], // Zeta Aql (ζ) — 서쪽 날개
      [0.62, 0.249], // Tarazed (γ Aql)
      [0.689, 0.356], // Altair (α Aql) — 견우성
      [0.758, 0.507], // Alshain (β Aql)
      [1.0, 0.95], // Theta Aql (θ) — 동쪽 날개
    ],
  },
  {
    key: 'delphinus',
    name: '돌고래자리',
    difficulty: 'EASY',
    pts: [
      [0.163, 1.0], // Epsilon Del (ε) — 꼬리
      [0.38, 0.317], // Rotanev (β Del) — 마름모 아래
      [0.485, 0.044], // Sualocin (α Del) — 마름모 왼쪽
      [0.837, 0.0], // Gamma Del (γ) — 마름모 위
      [0.675, 0.218], // Delta Del (δ) — 마름모 오른쪽
    ],
  },
  {
    key: 'corvus',
    name: '까마귀자리',
    difficulty: 'EASY',
    pts: [
      [0.131, 1.0], // Alchiba (α Crv) — 부리
      [0.18, 0.743], // Epsilon Crv (ε) — 돛 왼쪽 아래
      [0.341, 0.125], // Gienah (γ Crv) — 돛 왼쪽 위
      [0.741, 0.0], // Algorab (δ Crv) — 돛 오른쪽 위
      [0.869, 0.838], // Kraz (β Crv) — 돛 오른쪽 아래
    ],
  },
  {
    key: 'canis-major',
    name: '큰개자리',
    difficulty: 'NORMAL',
    pts: [
      [0.669, 0.018], // Muliphein (γ CMa) — 목
      [0.366, 0.095], // Sirius (α CMa) — 밤하늘 최고 밝은 별
      [0.0, 0.182], // Mirzam (β CMa) — 앞발
      [0.585, 0.958], // Adhara (ε CMa) — 뒷다리
      [0.744, 0.777], // Wezen (δ CMa) — 몸통
      [1.0, 0.982], // Aludra (η CMa) — 꼬리
    ],
  },
  {
    key: 'pegasus',
    name: '페가수스자리',
    difficulty: 'NORMAL',
    pts: [
      [0.0, 0.771], // Enif (ε Peg) — 코
      [0.384, 0.744], // Homam (ζ Peg) — 목
      [0.54, 0.621], // Markab (α Peg) — 사각형 남서
      [0.534, 0.257], // Scheat (β Peg) — 사각형 북서
      [0.967, 0.229], // Alpheratz (α And, 공유 별) — 사각형 북동
      [1.0, 0.621], // Algenib (γ Peg) — 사각형 남동
    ],
  },
  {
    key: 'perseus',
    name: '페르세우스자리',
    difficulty: 'NORMAL',
    pts: [
      [0.69, 1.0], // Zeta Per (ζ) — 남쪽 끝
      [0.721, 0.624], // Epsilon Per (ε)
      [0.596, 0.264], // Delta Per (δ)
      [0.442, 0.169], // Mirfak (α Per) — 가장 밝은 별
      [0.307, 0.58], // Algol (β Per) — 악마의 별
      [0.279, 0.0], // Gamma Per (γ)
    ],
  },
  {
    key: 'virgo',
    name: '처녀자리',
    difficulty: 'EASY',
    pts: [
      [0.0, 0.428], // Zavijava (β Vir)
      [0.49, 0.552], // Porrima (γ Vir)
      [0.624, 0.365], // Auva (δ Vir)
      [0.687, 0.075], // Vindemiatrix (ε Vir)
      [1.0, 0.519], // Heze (ζ Vir)
      [0.909, 0.925], // Spica (α Vir) — 가장 밝은 별
    ],
  },
  {
    key: 'southern-dipper',
    name: '남두육성',
    difficulty: 'NORMAL',
    pts: [
      [0.0, 0.13], // Mu Sgr (μ) — 손잡이 끝
      [0.267, 0.496], // Lambda Sgr (λ) — 손잡이
      [0.6, 0.627], // Phi Sgr (φ) — 국자 입구
      [0.78, 0.569], // Nunki (σ Sgr) — 국자 위
      [1.0, 0.684], // Tau Sgr (τ) — 국자 아래
      [0.919, 0.87], // Ascella (ζ Sgr) — 국자 바닥
    ],
  },
]

export function constellationByKey(key: string): Constellation {
  return CONSTELLATIONS.find((c) => c.key === key) ?? CONSTELLATIONS[0]!
}
