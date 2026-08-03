/**
 * 캐치캐치리듬의 <b>오디오 소유 신호</b>(`started`/`ended`)가 모든 경로에서 나가는지.
 *
 * 이 게임만 로비 테마를 내리는 방식이 다르다 — GameRoomView의 AUDIO_OWNING_GAMES에
 * 'rhythm'이 없고, <b>started~ended 사이에만</b> 소유한다(곡 고르는 시작 화면이 무음이라
 * 카드만 열어도 내리면 정적이 흐른다는 제보 때문, -168). 그래서 이 두 신호가 곧 음악 정책이고,
 * 하나만 빠져도 로비 테마 + 리듬 곡 + 판정음이 겹치거나 반대로 정적이 남는다.
 *
 * 실제로 두 경로에서 빠져 있었다 — <b>비방장 전원</b>(감시자에 immediate가 없어 이미 열린
 * 라운드의 전이를 못 봤다)과 <b>솔로</b>(서버 라운드 경로에만 신호가 붙어 있었다).
 * 방장만 멀쩡해서 오래 안 보였다. 아래 대조군이 그 비대칭을 같이 고정한다.
 */
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import CatchRhythmGame from '@/features/games/catch-rhythm/CatchRhythmGame.vue'
import { stashRhythmStart } from '@/features/games/catch-rhythm/useRhythmSession'
import type { RhythmStartEvent } from '@/features/games/catch-rhythm/rhythmTypes'

vi.mock('@/composables/useHandLandmarker', () => ({
  preloadHandLandmarker: vi.fn().mockResolvedValue(true),
  useHandLandmarker: () => ({
    isLoading: { value: false },
    isRunning: { value: false },
    error: { value: null },
    start: vi.fn().mockResolvedValue(true),
    stop: vi.fn(),
  }),
}))

const ROOM = 'R1AB2C'

function startEvent(): RhythmStartEvent {
  const now = Date.now()
  return {
    type: 'RHYTHM_START',
    sessionId: 'rs-1',
    seed: '123456789',
    difficulty: 'NORMAL',
    mode: 'catch',
    song: null,
    serverNow: now,
    startAt: now + 3_000,
    endAt: now + 60_000,
  }
}

/** 방 채팅(STOMP) 대역 — 구독 콜백을 붙잡아 서버 프레임을 흉내 낸다 */
function fakeChat(connected: boolean) {
  const sinks: ((body: string) => void)[] = []
  return {
    connected: ref(connected),
    subscribeRaw: (_d: string, cb: (body: string) => void) => {
      sinks.push(cb)
      return { unsubscribe: () => {} }
    },
    publishRaw: () => true,
    deliver: (event: RhythmStartEvent) => sinks.forEach((cb) => cb(JSON.stringify(event))),
  }
}

function mountGame(chat: ReturnType<typeof fakeChat>, isHost: boolean) {
  return mount(CatchRhythmGame, {
    props: { video: null, roomId: ROOM, isHost, myUserId: 'u1', roomChat: chat },
    global: { stubs: { CatchRhythmStage: true, EarnedPoints: true } },
  })
}

describe('started — 로비 테마를 내리는 유일한 근거', () => {
  it('방장: 화면을 먼저 열고 시작하면 신호가 나간다 (대조군)', async () => {
    const chat = fakeChat(true)
    const wrapper = mountGame(chat, true)
    await flushPromises()

    // 방장은 마운트 뒤에 RHYTHM_START를 받는다 → round가 null→id로 바뀐다
    chat.deliver(startEvent())
    await flushPromises()

    expect(wrapper.emitted('started')).toBeTruthy()
  })

  /**
   * 비방장은 시작 신호를 받은 **뒤에** 화면이 열린다(useRhythmAutoJoin). 놓친 신호는
   * 모듈 스코프 버퍼에 맡겨지고 useRhythmSession()이 생성되는 순간 동기적으로 꺼내 쓴다.
   * 그래서 화면이 열릴 때 round는 이미 채워져 있다 —
   * sessionId를 보는 watch에 immediate가 없으면 그 전이를 못 본다.
   */
  it('비방장 자동 입장: 라운드가 이미 열린 채로 마운트돼도 신호가 나가야 한다', async () => {
    stashRhythmStart(ROOM, startEvent())
    const chat = fakeChat(true)
    const wrapper = mountGame(chat, false)
    await flushPromises()

    expect(wrapper.emitted('started')).toBeTruthy()
  })

  it('솔로(STOMP 미연결): 시작을 누르면 신호가 나가야 한다', async () => {
    const chat = fakeChat(false)
    const wrapper = mountGame(chat, true)
    await flushPromises()

    const startBtn = wrapper.findAll('button').find((b) => b.text().includes('시작'))
    expect(startBtn, '시작 버튼을 찾지 못했다').toBeTruthy()
    await startBtn!.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('started')).toBeTruthy()
  })
})

describe('ended — 테마를 되돌리는 유일한 근거', () => {
  /** 스테이지는 스텁이라 판정을 돌리지 않는다 — 완주 신호만 대신 쏜다 */
  function finishStage(wrapper: ReturnType<typeof mountGame>) {
    const stage = wrapper.findComponent({ name: 'CatchRhythmStage' })
    expect(stage.exists(), '스테이지가 열리지 않았다 — playing이 false다').toBe(true)
    stage.vm.$emit('finished', {
      score: 1000,
      maxCombo: 10,
      counts: { perfect: 10, good: 0, miss: 0 },
    })
  }

  /**
   * 솔로는 서버 정산(RHYTHM_END)이 없다. started만 나가고 ended가 없으면 로비 테마가
   * 게임을 닫을 때까지 안 돌아온다 — 결과 화면이 무음이 된다.
   */
  it('솔로: 완주하면 신호가 나간다 (지급 포인트는 0)', async () => {
    const chat = fakeChat(false)
    const wrapper = mountGame(chat, true)
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('시작'))!.trigger('click')
    await flushPromises()

    finishStage(wrapper)
    await flushPromises()

    expect(wrapper.emitted('ended')).toEqual([[0]])
  })

  /** 대전은 서버 정산을 기다린다 — 완주만으로 테마를 되돌리면 남이 아직 뛰는 동안 겹친다 */
  it('대전: 완주만으로는 신호가 나가지 않는다 (RHYTHM_END를 기다린다)', async () => {
    const chat = fakeChat(true)
    const wrapper = mountGame(chat, true)
    await flushPromises()
    chat.deliver(startEvent())
    await flushPromises()

    finishStage(wrapper)
    await flushPromises()

    expect(wrapper.emitted('ended')).toBeUndefined()
  })
})
