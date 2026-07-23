/**
 * 핑거 스타 별자리 정의.
 * 실제 주요 별의 적경(RA)/적위(Dec) 상대 비율을 0~1 정규화한 좌표.
 * 배열 순서 = 안내선이 이어지는 순서 = 손가락이 배정되는 별 번호.
 */
export interface Constellation {
  key: string
  name: string
  /** [x, y] 0~1 정규화 좌표 (y는 아래 방향) */
  pts: [number, number][]
}

export const CONSTELLATIONS: Constellation[] = [
  {
    key: 'cassiopeia',
    name: '카시오페아자리',
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
]

export function constellationByKey(key: string): Constellation {
  return CONSTELLATIONS.find((c) => c.key === key) ?? CONSTELLATIONS[0]!
}
