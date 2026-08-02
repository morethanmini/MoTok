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
    // 슬라이더 자체가 0~100 눈금이다. 예전에는 옆에 "60%" 글자(.vol-val)도 있었지만
    // 메뉴가 개편되며 사라졌다 — 규약은 눈금이고 글자는 표시였으므로 눈금만 못박는다.
    expect((slider.element as HTMLInputElement).value).toBe('60')

    await slider.setValue('25')
    // .at(-1) 대신 인덱싱 — tsconfig lib가 ES2022 미만이라 Array.at 타입이 없다
    const emitted = tile.emitted('volume') ?? []
    expect(emitted[emitted.length - 1]).toEqual([0.25])
  })

  it('0으로 내리면 음소거 상태로 보인다', () => {
    // 예전에는 버튼에 .muted 클래스가 붙었는데, 지금은 아이콘의 X 하나로 표시한다.
    // (버튼이 볼륨 전용에서 참가자 메뉴로 바뀌면서 배경색을 쓸 수 없게 됐다)
    expect(mountTile({ volume: 0 }).find('.vol-btn .mute-x').exists()).toBe(true)
    expect(mountTile({ volume: 0.6 }).find('.vol-btn .mute-x').exists()).toBe(false)
  })
})
