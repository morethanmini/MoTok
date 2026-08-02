/**
 * 닫아 본 친구 요청 기억하기.
 *
 * 요청은 수락·거절 전까지 서버에 남아 있어서, 한 번 닫았다는 사실은 클라이언트만 안다.
 * 여기서 못박는 건 두 가지 — 계정끼리 섞이지 않을 것, 죽은 id를 계속 들고 있지 않을 것.
 * 후자는 저장소가 자라는 문제이기도 하지만, id가 재사용되면 새 요청이 뜨지도 않고 묻힌다.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { addDismissed, loadDismissed, pruneDismissed } from '@/features/lobby/dismissedRequests'

const ME = 1
const OTHER = 2

beforeEach(() => localStorage.clear())

describe('dismissedRequests', () => {
  it('닫은 요청을 기억한다', () => {
    addDismissed(ME, 10)
    addDismissed(ME, 11)
    expect(loadDismissed(ME)).toEqual(new Set([10, 11]))
  })

  it('같은 요청을 두 번 닫아도 한 번만 쌓인다', () => {
    addDismissed(ME, 10)
    addDismissed(ME, 10)
    expect([...loadDismissed(ME)]).toEqual([10])
  })

  it('계정이 다르면 섞이지 않는다 — 남의 요청 id를 물려받으면 안 된다', () => {
    addDismissed(ME, 10)
    expect(loadDismissed(OTHER).size).toBe(0)
  })

  it('처리된 요청 id는 걷어낸다', () => {
    addDismissed(ME, 10)
    addDismissed(ME, 11)
    addDismissed(ME, 12)

    // 11번만 아직 대기 중 — 10·12는 수락·거절돼 사라졌다
    expect(pruneDismissed(ME, [11])).toEqual(new Set([11]))
    expect(loadDismissed(ME)).toEqual(new Set([11]))
  })

  it('걷어낸 뒤에는 같은 번호가 새 요청으로 와도 다시 뜬다', () => {
    addDismissed(ME, 10)
    pruneDismissed(ME, []) // 10번 처리됨

    // 서버가 언젠가 10번을 다시 쓰더라도 "이미 닫은 것"으로 묻히면 안 된다
    expect(loadDismissed(ME).has(10)).toBe(false)
  })

  it('저장된 값이 깨져 있어도 죽지 않는다 — 매번 뜨는 쪽이 놓치는 것보다 낫다', () => {
    localStorage.setItem('motiontok:dismissed-friend-requests:1', '{not json')
    expect(loadDismissed(ME).size).toBe(0)
  })
})
