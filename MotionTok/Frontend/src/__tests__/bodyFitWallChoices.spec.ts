/**
 * 게임④(-9) 설정 창의 벽 수 선택지 — 혼자냐 아니냐로 갈린다.
 *
 * 혼자면 서버 세션 없이 로컬 연습으로 도니까 무한(0)이 성립하지만, 방에서는 끝나는 시각이
 * 없어 승부가 안 난다(서버도 10·20·30만 받는다). 그래서 "혼자일 때만 무한"이 이 창의 계약이다.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import GameSetupModal from '@/features/game-room/components/GameSetupModal.vue'
import type { GameEntry } from '@/features/game-room/data'

const game = { id: 'shape', name: '그대로 멈춰라', emoji: '🧩', thumb: '#000' } as GameEntry

// 이 창은 인게임 베드를 직접 깐다 — jsdom에는 재생 구현이 없어 play()가 undefined를 준다
beforeAll(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

function open(memberCount: number) {
  return mount(GameSetupModal, { props: { game, memberCount } })
}
/** 선택지 묶음은 모드 · (연속이면) 벽 수 · 난이도 순이라 두 번째가 벽 수다 */
const wallGroup = (w: ReturnType<typeof open>) => w.findAll('.choices')[1]!
const wallLabels = (w: ReturnType<typeof open>) =>
  wallGroup(w).findAll('.choice').map((b) => b.text())

describe('게임④ 설정 창 벽 수', () => {
  it('혼자면 무한을 고를 수 있다', () => {
    const w = open(1) // 혼자면 연속 서바이벌만 남아 벽 수 칸이 바로 보인다
    expect(wallLabels(w)).toEqual(['10개', '20개', '무한'])
  })

  it('둘 이상이면 무한이 없다 — 방에서는 끝나지 않는 판을 만들 수 없다', async () => {
    const w = open(2)
    await w.findAll('.choice').find((b) => b.text() === '연속 서바이벌')!.trigger('click')
    expect(wallLabels(w)).toEqual(['10개', '20개', '30개'])
  })

  it('무한을 고른 뒤 사람이 들어오면 기본값으로 되돌린다', async () => {
    const w = open(1)
    await w.findAll('.choice').find((b) => b.text() === '무한')!.trigger('click')
    await w.setProps({ memberCount: 2 })
    // 둘이 되면 기본 모드(출제 대결)로 돌아가 벽 수 칸이 접힌다 — 다시 펴서 확인한다
    await w.findAll('.choice').find((b) => b.text() === '연속 서바이벌')!.trigger('click')
    expect(wallLabels(w)).toEqual(['10개', '20개', '30개'])
    // 고른 값도 같이 돌아와야 한다 — 안 그러면 방에 0을 보낸다
    expect(wallGroup(w).find('.choice.on').text()).toBe('10개')
  })
})
