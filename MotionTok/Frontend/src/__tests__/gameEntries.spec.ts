/**
 * 서버 카탈로그 ⨝ 프론트 구현 레지스트리(`toGameEntries`).
 *
 * 전에는 방 안 게임 목록이 하드코딩 배열이었고, 그 배열이 "어떤 게임이 존재하나"까지 답했다.
 * 그래서 서버에 없는 게임 6개가 목록에 남아 있었고 이름·인원이 서버와 어긋났다.
 *
 * 여기서 고정하는 건 두 가지다.
 * ① <b>이름·인원·점검 여부는 서버 값을 쓴다</b>(프론트 사본이 다시 생기지 않게).
 * ② <b>구현이 없는 서버 게임은 지우지 않고 잠근다</b> — 백엔드가 게임을 추가했을 때 프론트가
 *    아무것도 안 하면 화면이 빈 채로 열리기 때문이다. 잠긴 카드로 보이면 왜 못 하는지 알 수 있다.
 */
import { describe, expect, it } from 'vitest'
import { toGameEntries } from '@/features/game-room/data'
import type { Game } from '@/api'

const game = (over: Partial<Game> & Pick<Game, 'id' | 'name'>): Game => ({
  description: '설명', mode: 'VERSUS', minPlayers: 1, maxPlayers: 8, supportsBot: false,
  category: '모션', thumbnailUrl: '', playable: true, active: true, ...over,
})

describe('toGameEntries', () => {
  it('구현이 있는 게임은 슬러그를 얻는다 — 이 값으로 게임 컴포넌트가 갈린다', () => {
    const entries = toGameEntries([
      game({ id: 1, name: '핑거 스타' }),
      game({ id: 2, name: '캐치캐치리듬' }),
      game({ id: 4, name: '몸 끼워 맞추기' }),
      game({ id: 10, name: '그림으로 말해요', minPlayers: 3 }),
      game({ id: 11, name: '모션 낚시' }),
    ])

    expect(entries.map((e) => e.id)).toEqual(['finger', 'rhythm', 'shape', 'draw', 'fish'])
    expect(entries.every((e) => e.implemented)).toBe(true)
  })

  it('이름·인원·점검 여부는 서버 값을 그대로 쓴다', () => {
    const [entry] = toGameEntries([
      game({ id: 10, name: '그림으로 말해요', minPlayers: 3, maxPlayers: 6, active: false }),
    ])

    expect(entry).toMatchObject({
      name: '그림으로 말해요',
      minPlayers: 3,
      maxPlayers: 6,
      active: false, // 관리자가 닫았다(-106) — 목록에는 남는다
      implemented: true,
    })
  })

  it('구현이 없는 서버 게임은 남기되 슬러그가 없다 — 어떤 게임 컴포넌트에도 걸리지 않는다', () => {
    const entries = toGameEntries([
      game({ id: 1, name: '핑거 스타' }),
      game({ id: 7, name: '새로 붙은 게임' }),
    ])

    expect(entries).toHaveLength(2) // 조용히 지우지 않는다
    const unknown = entries[1]!
    expect(unknown.implemented).toBe(false)
    expect(unknown.id).toBeNull()
    // 슬러그가 null이라 'finger'·'shape' 같은 어떤 분기와도 같지 않다
    expect(unknown.id === 'finger').toBe(false)
    expect(unknown.id === 'shape').toBe(false)
    // 자리는 지키되 특정 게임처럼 보이지는 않게 — 태그는 서버 설명으로 떨어진다
    expect(unknown.tag).toBe('설명')
    expect(unknown.emoji).toBeTruthy()
  })

  it('서버가 준 순서를 바꾸지 않는다 — 프론트가 다시 정렬하면 화면끼리 순서가 갈린다', () => {
    const entries = toGameEntries([
      game({ id: 11, name: '모션 낚시' }),
      game({ id: 1, name: '핑거 스타' }),
      game({ id: 4, name: '몸 끼워 맞추기' }),
    ])

    expect(entries.map((e) => e.gameId)).toEqual([11, 1, 4])
  })

  it('빈 목록이면 빈 배열 — 조회 전에도 안전하게 그린다', () => {
    expect(toGameEntries([])).toEqual([])
  })
})
