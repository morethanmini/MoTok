/**
 * 참가자별 개인 볼륨 — 내 쪽에서만 적용되는 값이라 UI가 "내가 고른 값"을 그대로 올려보내야 한다.
 * 슬라이더는 0~100(%)로 보여주고 0~1로 emit한다는 규약을 고정한다(LiveKit setVolume 규격).
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ParticipantTile from '@/features/game-room/components/ParticipantTile.vue'
import type { ParticipantView } from '@/composables/useLiveKitRoom'

const VIEW: ParticipantView = {
  identity: 'u-7',
  name: '수아',
  isLocal: false,
  isSpeaking: false,
  cameraOn: false,
  micOn: true,
  videoTrack: null,
  audioTrack: null,
  gameTrack: null,
}

const mountTile = (props: Record<string, unknown> = {}) =>
  mount(ParticipantTile, { props: { view: VIEW, playAudio: true, ...props } })

describe('ParticipantTile 개인 볼륨', () => {
  it('소리를 재생하는 원격 타일에만 볼륨 조절이 붙는다', () => {
    expect(mountTile().find('.vol-btn').exists()).toBe(true)
    // 내 타일은 에코 방지로 오디오를 재생하지 않으므로 조절할 것도 없다
    expect(mountTile({ playAudio: false }).find('.vol-btn').exists()).toBe(false)
    // 빈 슬롯("대기 중")에도 붙지 않는다
    expect(mountTile({ view: null }).find('.vol-btn').exists()).toBe(false)
  })

  it('슬라이더는 퍼센트로 보여주고 0~1로 올려보낸다', async () => {
    const tile = mountTile({ volume: 0.6 })
    expect(tile.find('.vol-bar').exists()).toBe(false)

    await tile.find('.vol-btn').trigger('click')
    const slider = tile.find('.vol-bar input')
    expect((slider.element as HTMLInputElement).value).toBe('60')
    expect(tile.find('.vol-val').text()).toBe('60%')

    await slider.setValue('25')
    expect(tile.emitted('volume')?.at(-1)).toEqual([0.25])
  })

  it('0으로 내리면 음소거 상태로 보인다', () => {
    const tile = mountTile({ volume: 0 })
    expect(tile.find('.vol-btn').classes()).toContain('muted')
  })
})
