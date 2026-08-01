import { describe, it, expect, beforeEach } from 'vitest'
import { useBgm, DEFAULT_LEVEL } from '@/composables/useBgm'
import { useSpeakerGain } from '@/composables/useSpeakerGain'

describe('저장값이 없을 때 기본 볼륨', () => {
  beforeEach(() => sessionStorage.clear())

  it('로비/게임 음악이 0이 아니라 기본값으로 시작한다', () => {
    const bgm = useBgm()
    bgm.setVolume(0.2) // 로비 진입이 하는 일 — ensureAudio 트리거
    expect(bgm.lobbyMusic.value).toBe(DEFAULT_LEVEL)
    expect(bgm.gameMusic.value).toBe(DEFAULT_LEVEL)
  })

  it('상대 소리가 0이 아니라 기본값으로 시작한다', () => {
    expect(useSpeakerGain().speakerLevel.value).toBe(0.5)
  })
})
