/**
 * 관리자 게임 관리(-106) 싱글/멀티 분류.
 *
 * 여기서 고정하는 것: 분류 기준은 `mode`가 아니라 인원이고, 싱글과 멀티는 <b>배타적이지 않다</b>.
 * 이게 어긋나면 관리자가 닫으려는 게임이 엉뚱한 탭에서만 보인다.
 */
import { describe, expect, it } from 'vitest'
import type { AdminGame } from '@/api'
import { filterByScope, inScope, scopeBadges } from '@/features/admin/games'

function game(over: Partial<AdminGame> = {}): AdminGame {
  return {
    id: 1,
    name: '핑거 스타',
    mode: 'VERSUS',
    category: 'MOTION',
    minPlayers: 1,
    maxPlayers: 8,
    roundDurationSec: 30,
    supportsBot: true,
    soloCapable: true,
    active: true,
    ...over,
  }
}

describe('싱글/멀티 분류', () => {
  it('전체 범위는 아무것도 걸러내지 않는다', () => {
    const games = [game({ id: 1 }), game({ id: 2, soloCapable: false, minPlayers: 3 })]
    expect(filterByScope(games, 'all')).toHaveLength(2)
  })

  it('싱글 기준은 soloCapable — mode가 VERSUS여도 혼자 되면 싱글이다', () => {
    // 핑거 스타는 대결 모드지만 min 1이라 혼자서도 플레이된다.
    expect(inScope(game({ mode: 'VERSUS', soloCapable: true }), 'solo')).toBe(true)
    // 그림으로 말해요는 협동 모드이고 3명부터라 싱글 목록에 없다.
    expect(inScope(game({ mode: 'COOP', soloCapable: false, minPlayers: 3 }), 'solo')).toBe(false)
  })

  it('멀티 기준은 최대 인원 — 정원이 1이면 멀티에 없다', () => {
    expect(inScope(game({ maxPlayers: 8 }), 'multi')).toBe(true)
    expect(inScope(game({ maxPlayers: 1 }), 'multi')).toBe(false)
  })

  it('싱글과 멀티는 배타적이지 않다 — 양쪽에 뜨는 게임이 있다', () => {
    // 한쪽으로 몰아 두면 그 게임을 닫으려는 관리자가 다른 탭에서 찾지 못한다.
    const both = game({ soloCapable: true, maxPlayers: 8 })
    expect(inScope(both, 'solo')).toBe(true)
    expect(inScope(both, 'multi')).toBe(true)
    expect(scopeBadges(both)).toEqual(['싱글 플레이', '멀티 플레이'])
  })

  it('3인 이상 협동 게임은 멀티 배지만 붙는다', () => {
    expect(scopeBadges(game({ soloCapable: false, minPlayers: 3, maxPlayers: 8 }))).toEqual([
      '멀티 플레이',
    ])
  })

  it('닫힌 게임도 범위에서 빠지지 않는다 — 목록에 남아야 다시 열 수 있다', () => {
    const closed = game({ active: false })
    expect(inScope(closed, 'solo')).toBe(true)
    expect(filterByScope([closed], 'all')).toHaveLength(1)
  })
})
