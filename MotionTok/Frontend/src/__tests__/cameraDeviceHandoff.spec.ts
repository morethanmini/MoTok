/**
 * 장치 설정에서 고른 카메라·마이크가 게임룸까지 그대로 이어지는지 — 화면이 바뀌면 useCamera
 * 인스턴스도 새로 생기므로, 선택은 localStorage에 남고 다음 start()가 그 장치를 요청해야 한다.
 * 저장값을 ideal(문자열)로 넣던 시절엔 브라우저가 기본 장치를 돌려줘도 규칙 위반이 아니라
 * "프리뷰는 고른 카메라, 입장하면 기본 카메라"가 됐다 — 그래서 exact로 못박은 것을 고정한다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { useCamera } from '@/composables/useCamera'

type Api = ReturnType<typeof useCamera>

interface FakeTrack {
  kind: string
  enabled: boolean
  stop: () => void
  getSettings: () => { deviceId?: string }
}

const CAMERA_CONSTRAINTS = { video: { width: 640, height: 400 }, audio: false }
const SETUP_CONSTRAINTS = { video: { width: 640, height: 400 }, audio: true }

/** getSettings에 deviceId를 안 채워 주는 브라우저도 있어서 그 여부를 골라 만들 수 있게 둔다. */
function makeTrack(kind: string, deviceId: string, reportSettings = true): FakeTrack {
  return { kind, enabled: true, stop: () => {}, getSettings: () => (reportSettings ? { deviceId } : {}) }
}

function makeStream(tracks: FakeTrack[]) {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  } as unknown as MediaStream
}

/** 요청한 deviceId(exact/ideal 모두)를 꺼낸다 — 없으면 기본 장치를 뜻한다. */
function requestedId(c: boolean | MediaTrackConstraints | undefined): string | null {
  if (!c || typeof c !== 'object') return null
  const id = c.deviceId
  if (!id) return null
  return typeof id === 'string' ? id : ((id as ConstrainDOMStringParameters).exact as string) ?? null
}

/** 없는 장치를 exact로 요구하면 브라우저처럼 OverconstrainedError로 거절한다. */
function overconstrained() {
  return Object.assign(new Error('deviceId'), { name: 'OverconstrainedError', constraint: 'deviceId' })
}

let calls: MediaStreamConstraints[]
/** n번째 getUserMedia 요청의 비디오 제약(호출 순서는 각 테스트가 이미 단언한다). */
const videoOf = (n: number) => (calls[n] as MediaStreamConstraints).video as MediaTrackConstraints
let missing: Set<string>
let reportSettings: boolean

function installFakeMediaDevices() {
  calls = []
  missing = new Set()
  reportSettings = true
  const getUserMedia = vi.fn<(req: MediaStreamConstraints) => Promise<MediaStream>>(async (req) => {
    calls.push(req)
    const videoId = requestedId(req.video as MediaTrackConstraints | undefined) ?? 'cam-default'
    const audioId = requestedId(req.audio as MediaTrackConstraints | undefined) ?? 'mic-default'
    if (missing.has(videoId) || missing.has(audioId)) throw overconstrained()
    const tracks: FakeTrack[] = []
    if (req.video) tracks.push(makeTrack('video', videoId, reportSettings))
    if (req.audio) tracks.push(makeTrack('audio', audioId, reportSettings))
    return makeStream(tracks)
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: async () => [
        { deviceId: 'cam-default', kind: 'videoinput', label: '내장 웹캠' },
        { deviceId: 'cam-usb', kind: 'videoinput', label: 'USB 웹캠' },
        { deviceId: 'mic-default', kind: 'audioinput', label: '내장 마이크' },
        { deviceId: 'mic-usb', kind: 'audioinput', label: 'USB 마이크' },
      ],
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  })
  // 스트림 교체(트랙 갈아끼우기)에 쓰는 생성자 — jsdom에는 없다.
  ;(globalThis as unknown as { MediaStream: unknown }).MediaStream = class {
    private tracks: FakeTrack[]
    constructor(tracks: FakeTrack[]) {
      this.tracks = tracks
    }
    getTracks() {
      return this.tracks
    }
    getVideoTracks() {
      return this.tracks.filter((t) => t.kind === 'video')
    }
    getAudioTracks() {
      return this.tracks.filter((t) => t.kind === 'audio')
    }
  }
}

/** 화면 하나에 해당하는 useCamera 인스턴스(언마운트하면 실제 화면처럼 트랙이 정리된다). */
function mountCamera() {
  let api!: Api
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useCamera()
        return () => null
      },
    }),
    { global: { plugins: [createPinia()] } },
  )
  return { api, unmount: () => wrapper.unmount() }
}

describe('장치 선택 인계 (장치 설정 → 게임룸)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    installFakeMediaDevices()
  })

  it('프리뷰에서 고른 카메라를 다음 화면이 exact로 이어서 요청한다', async () => {
    const setup = mountCamera()
    await setup.api.start(SETUP_CONSTRAINTS)
    await setup.api.selectVideoDevice('cam-usb')
    await setup.api.selectAudioDevice('mic-usb')
    expect(setup.api.videoDeviceId.value).toBe('cam-usb')
    setup.unmount()

    const room = mountCamera()
    await room.api.start(CAMERA_CONSTRAINTS)
    // ideal(문자열)이 아니라 exact여야 브라우저가 기본 카메라로 바꿔치지 못한다
    expect(videoOf(calls.length - 1).deviceId).toEqual({ exact: 'cam-usb' })
    expect(room.api.videoDeviceId.value).toBe('cam-usb')
    // 마이크는 LiveKit이 직접 잡으므로 게임룸의 로컬 캡처엔 없고, 저장값만 넘어간다
    expect(localStorage.getItem('motiontok.audioDeviceId')).toBe('mic-usb')
  })

  it('getSettings().deviceId를 안 채워 주는 브라우저에서도 선택이 남는다', async () => {
    reportSettings = false
    const setup = mountCamera()
    await setup.api.start(SETUP_CONSTRAINTS)
    await setup.api.selectVideoDevice('cam-usb')
    setup.unmount()

    expect(localStorage.getItem('motiontok.videoDeviceId')).toBe('cam-usb')
  })

  it('고른 장치를 뽑았으면 기본 장치로 되돌아가고 저장값도 실제 장치로 고쳐진다', async () => {
    localStorage.setItem('motiontok.videoDeviceId', 'cam-usb')
    missing.add('cam-usb')

    const room = mountCamera()
    const stream = await room.api.start(CAMERA_CONSTRAINTS)

    expect(stream).not.toBeNull()
    expect(room.api.isOn.value).toBe(true)
    expect(room.api.error.value).toBeNull()
    // 첫 시도는 exact로 거절당하고, 두 번째는 장치 지정 없이(=기본 장치) 다시 잡는다
    expect(calls).toHaveLength(2)
    expect(videoOf(1).deviceId).toBeUndefined()
    expect(localStorage.getItem('motiontok.videoDeviceId')).toBe('cam-default')
  })

  it('권한 거부는 되돌림 없이 그대로 거부로 알린다', async () => {
    localStorage.setItem('motiontok.videoDeviceId', 'cam-usb')
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(denied)

    const room = mountCamera()
    expect(await room.api.start(CAMERA_CONSTRAINTS)).toBeNull()
    expect(room.api.error.value).toBe('카메라·마이크 권한을 허용해 주세요')
    // 권한 문제로 저장해 둔 장치를 버리면, 허용한 뒤 기본 카메라로 돌아가 버린다
    expect(localStorage.getItem('motiontok.videoDeviceId')).toBe('cam-usb')
  })
})
