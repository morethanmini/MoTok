/**
 * 방 하단 스피커 버튼 = <b>상대 소리 전체 음소거</b>.
 *
 * 예전에는 GameRoomView의 `speakerOn` ref가 버튼 색만 바꾸고 아무 데도 연결되지 않아
 * 눌러도 사람들 말소리가 그대로 났다("데모 상태" 주석 아래 남아 있던 잔재).
 *
 * 여기서 고정하는 것:
 *  - 음소거가 <b>이미 붙어 있는</b> 요소와 <b>나중에 들어온</b> 요소 모두에 걸린다
 *  - 해제하면 설정 화면의 '상대 소리' 값이 그대로 돌아온다 (음소거를 level 0으로 구현하면
 *    슬라이더 값을 덮어써서 되돌릴 값이 없어진다 — 그래서 두 값을 따로 둔다)
 *  - Web Audio가 없어도 음소거는 동작한다 (증폭은 포기해도 음소거는 아니다)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Mod = typeof import('@/composables/useSpeakerGain')

/** GainNode 대역 — gain.value만 본다 */
interface FakeGain {
  gain: { value: number }
  connect: () => void
  disconnect: () => void
}

/**
 * AudioContext는 모듈 스코프에 한 번만 만들어져 캐시된다(요소당 1회 제약 때문에 그래야 한다).
 * 그래서 테스트마다 모듈을 새로 불러와야 앞 테스트의 컨텍스트가 새지 않는다.
 */
async function freshModule(): Promise<Mod> {
  vi.resetModules()
  return import('@/composables/useSpeakerGain')
}

/**
 * jsdom에는 Web Audio가 없다. 게인 경로까지 보려면 최소 구현을 심어야 한다.
 * <b>심지 않은 채로 도는 테스트가 곧 "Web Audio 없는 브라우저" 케이스다.</b>
 */
function stubAudioContext(): FakeGain[] {
  const gains: FakeGain[] = []
  class FakeCtx {
    destination = {}
    createMediaElementSource() {
      return { connect: () => {} }
    }
    createGain(): FakeGain {
      const g: FakeGain = { gain: { value: -1 }, connect: () => {}, disconnect: () => {} }
      gains.push(g)
      return g
    }
    resume() {
      return Promise.resolve()
    }
  }
  vi.stubGlobal('AudioContext', FakeCtx)
  return gains
}

function audioEl(): HTMLAudioElement {
  return document.createElement('audio')
}

describe('상대 소리 음소거 — 요소 경로 (Web Audio 없어도 동작해야 한다)', () => {
  let mod: Mod
  beforeEach(async () => {
    sessionStorage.clear()
    vi.unstubAllGlobals() // AudioContext 없는 환경으로 되돌린다
    mod = await freshModule()
  })

  it('음소거하면 이미 붙어 있는 요소가 조용해진다', () => {
    const { attachSpeakerGain, setSpeakerMuted } = mod
    const el = audioEl()
    attachSpeakerGain(el)
    expect(el.muted).toBe(false)

    setSpeakerMuted(true)
    expect(el.muted).toBe(true)
  })

  /**
   * 이게 이 기능의 핵심이다 — 음소거해 두고 있는데 누가 들어오면 그 사람 소리는 나야 하나?
   * 아니다. 참가자가 나갔다 들어오거나 마이크를 껐다 켜면 요소가 새로 붙는데,
   * 그때마다 소리가 되살아나면 음소거 버튼을 계속 다시 눌러야 한다.
   */
  it('음소거 중에 들어온 참가자도 조용하다', () => {
    const { attachSpeakerGain, setSpeakerMuted } = mod
    setSpeakerMuted(true)

    const late = audioEl()
    attachSpeakerGain(late)

    expect(late.muted).toBe(true)
  })

  it('해제하면 다시 들린다', () => {
    const { attachSpeakerGain, setSpeakerMuted } = mod
    const el = audioEl()
    attachSpeakerGain(el)
    setSpeakerMuted(true)
    setSpeakerMuted(false)
    expect(el.muted).toBe(false)
  })

  it('나간 참가자의 요소는 더 이상 따라오지 않는다', () => {
    const { attachSpeakerGain, detachSpeakerGain, setSpeakerMuted } = mod
    const el = audioEl()
    attachSpeakerGain(el)
    detachSpeakerGain(el)
    el.muted = false

    setSpeakerMuted(true)
    expect(el.muted).toBe(false)
  })
})

describe('상대 소리 음소거 — 게인 경로', () => {
  let mod: Mod
  let gains: FakeGain[]
  beforeEach(async () => {
    sessionStorage.clear()
    vi.unstubAllGlobals()
    gains = stubAudioContext()
    mod = await freshModule()
  })

  it('음소거는 게인을 0으로 만들고, 해제하면 원래 크기가 돌아온다', () => {
    const { attachSpeakerGain, setSpeakerLevel, setSpeakerMuted } = mod
    setSpeakerLevel(0.75) // 0.5에서 1배이므로 1.5배
    attachSpeakerGain(audioEl())
    const g = gains[0]!
    expect(g.gain.value).toBeCloseTo(1.5)

    setSpeakerMuted(true)
    expect(g.gain.value).toBe(0)

    setSpeakerMuted(false)
    expect(g.gain.value).toBeCloseTo(1.5)
  })

  it('음소거 중에 붙은 요소는 처음부터 게인 0으로 시작한다', () => {
    const { attachSpeakerGain, setSpeakerLevel, setSpeakerMuted } = mod
    setSpeakerLevel(0.75)
    setSpeakerMuted(true)

    attachSpeakerGain(audioEl())
    expect(gains).toHaveLength(1)
    expect(gains[0]!.gain.value).toBe(0)
  })

  /**
   * 음소거를 level 0으로 구현하면 sessionStorage의 '상대 소리'까지 0으로 덮어써서
   * 해제할 때 되돌릴 값이 사라진다. 두 값이 따로라는 것을 여기서 못 박는다.
   */
  it("음소거는 설정 화면의 '상대 소리' 값을 건드리지 않는다", () => {
    const { setSpeakerLevel, setSpeakerMuted, useSpeakerGain } = mod
    setSpeakerLevel(0.8)
    setSpeakerMuted(true)

    expect(useSpeakerGain().speakerLevel.value).toBe(0.8)
    expect(sessionStorage.getItem('motok-speaker-level')).toBe('0.8')
  })

  it('음소거 상태가 노출된다 — 버튼이 이 값을 읽어 그린다', () => {
    const { setSpeakerMuted, useSpeakerGain } = mod
    const { speakerMuted } = useSpeakerGain()
    expect(speakerMuted.value).toBe(false)
    setSpeakerMuted(true)
    expect(speakerMuted.value).toBe(true)
  })
})
