/**
 * 카메라/마이크 스트림 컴포저블 (getUserMedia).
 * Device Setup·Game Room 공용. 컴포넌트 언마운트 시 자동으로 트랙을 정리합니다.
 */
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { useMediaPermissionStore } from '@/stores/mediaPermission'

/** 장치 설정에서 고른 카메라·마이크를 게임룸까지 이어 쓰기 위한 저장 키. */
const VIDEO_DEVICE_KEY = 'motiontok.videoDeviceId'
const AUDIO_DEVICE_KEY = 'motiontok.audioDeviceId'

/** 저장된 마이크 선택 — 게임룸은 LiveKit이 직접 마이크를 잡으므로 여기서만 읽어 간다. */
export function preferredAudioDeviceId(): string | null {
  return localStorage.getItem(AUDIO_DEVICE_KEY)
}

export function useCamera() {
  // getUserMedia의 성공·실패가 곧 권한 상태다 — 카메라를 여는 모든 화면이 전역 상태를 갱신하도록
  // 여기 한 곳에서 알린다(화면마다 따로 기록하면 어느 한 곳이 빠졌을 때 상태가 어긋난다).
  const permission = useMediaPermissionStore()
  const stream = shallowRef<MediaStream | null>(null)
  const isOn = ref(false)
  const error = ref<string | null>(null)
  // 스트림 전체를 껐다 켜지 않고도 카메라/마이크를 개별로 끄고 켤 수 있도록(트랙 enabled 토글).
  const camOn = ref(true)
  const micOn = ref(true)
  /** 연결된 장치 목록. 라벨은 권한 허용 후에만 채워지므로 start() 성공 후에 읽는다. */
  const videoDevices = ref<MediaDeviceInfo[]>([])
  const audioDevices = ref<MediaDeviceInfo[]>([])
  /** 지금 쓰고 있는 장치 — 저장값으로 시작해 실제 트랙 기준으로 맞춘다. */
  const videoDeviceId = ref<string | null>(localStorage.getItem(VIDEO_DEVICE_KEY))
  const audioDeviceId = ref<string | null>(preferredAudioDeviceId())
  /** 장치 전환 시 같은 조건으로 다시 잡으려고 마지막 요청 조건을 들고 있는다. */
  let lastVideoConstraints: MediaTrackConstraints = {}
  let lastAudioConstraints: MediaTrackConstraints = {}

  async function refreshDevices() {
    const list = await navigator.mediaDevices.enumerateDevices()
    videoDevices.value = list.filter((d) => d.kind === 'videoinput')
    audioDevices.value = list.filter((d) => d.kind === 'audioinput')
  }

  /** 실제로 잡힌 장치를 선택 상태로 반영한다 — 요청한 장치가 거절될 수 있어 트랙이 기준이다. */
  function syncDeviceIds(s: MediaStream) {
    const videoId = s.getVideoTracks()[0]?.getSettings().deviceId
    if (videoId) {
      videoDeviceId.value = videoId
      localStorage.setItem(VIDEO_DEVICE_KEY, videoId)
    }
    const audioId = s.getAudioTracks()[0]?.getSettings().deviceId
    if (audioId) {
      audioDeviceId.value = audioId
      localStorage.setItem(AUDIO_DEVICE_KEY, audioId)
    }
  }

  async function start(constraints: MediaStreamConstraints = { video: { width: 640, height: 400 }, audio: false }) {
    const video = typeof constraints.video === 'object' ? constraints.video : {}
    const audio = typeof constraints.audio === 'object' ? constraints.audio : {}
    lastVideoConstraints = video
    lastAudioConstraints = audio
    // 앞서 고른 장치가 있으면 이어서 쓴다(장치 설정 → 게임룸). exact가 아닌 ideal이라
    // 그 사이 장치를 뽑았어도 기본 장치로 떨어질 뿐 실패하지 않는다.
    const req: MediaStreamConstraints = { ...constraints }
    if (constraints.video && videoDeviceId.value) req.video = { ...video, deviceId: videoDeviceId.value }
    if (constraints.audio && audioDeviceId.value) req.audio = { ...audio, deviceId: audioDeviceId.value }
    try {
      const s = await navigator.mediaDevices.getUserMedia(req)
      stream.value = s
      isOn.value = true
      error.value = null
      camOn.value = s.getVideoTracks().length > 0
      micOn.value = s.getAudioTracks().length > 0
      syncDeviceIds(s)
      await refreshDevices()
      permission.markGranted()
      return s
    } catch (e) {
      // 권한 거부와 그 밖의 실패(장치 없음·다른 앱이 점유·제약 불일치)를 구분한다 —
      // 전부 '거부'로 기록하면 카메라를 잠깐 뺏겼을 뿐인데 설정 화면이 "차단됨"이라고 말한다.
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      error.value = denied
        ? '카메라·마이크 권한을 허용해 주세요'
        : '카메라·마이크 장치를 열 수 없어요(다른 앱이 쓰고 있는지 확인해 주세요)'
      isOn.value = false
      if (denied) permission.markDenied()
      return null
    }
  }

  /**
   * 한 종류의 트랙만 갈아끼운다 — 나머지 트랙은 그대로라 반대쪽 권한을 다시 묻지 않는다.
   * 트랙만 바꿔치면 <video>가 다시 그리지 않는 브라우저가 있어 스트림 객체를 새로 만든다.
   */
  function swapTrack(current: MediaStream, next: MediaStreamTrack) {
    const kind = next.kind
    const kept = current.getTracks().filter((t) => t.kind !== kind)
    current.getTracks().forEach((t) => {
      if (t.kind === kind) t.stop()
    })
    const swapped = new MediaStream([...kept, next])
    stream.value = swapped
    error.value = null
    syncDeviceIds(swapped)
  }

  /** 카메라 전환 — 프리뷰가 즉시 그 카메라로 바뀐다. */
  async function selectVideoDevice(deviceId: string) {
    const current = stream.value
    if (!current || !deviceId || deviceId === videoDeviceId.value) return
    let next: MediaStream
    try {
      next = await navigator.mediaDevices.getUserMedia({
        video: { ...lastVideoConstraints, deviceId: { exact: deviceId } },
      })
    } catch {
      error.value = '선택한 카메라를 사용할 수 없어요'
      return
    }
    const track = next.getVideoTracks()[0]
    if (!track) return
    // 카메라를 꺼 둔 상태로 바꿨다면 새 트랙도 꺼진 채로 이어져야 한다.
    track.enabled = camOn.value
    swapTrack(current, track)
  }

  /** 마이크 전환. */
  async function selectAudioDevice(deviceId: string) {
    const current = stream.value
    if (!current || !deviceId || deviceId === audioDeviceId.value) return
    let next: MediaStream
    try {
      next = await navigator.mediaDevices.getUserMedia({
        audio: { ...lastAudioConstraints, deviceId: { exact: deviceId } },
      })
    } catch {
      error.value = '선택한 마이크를 사용할 수 없어요'
      return
    }
    const track = next.getAudioTracks()[0]
    if (!track) return
    track.enabled = micOn.value
    swapTrack(current, track)
  }

  function stop() {
    stream.value?.getTracks().forEach((t) => t.stop())
    stream.value = null
    isOn.value = false
  }

  /** 권한 재요청 없이 비디오 트랙만 껐다 켠다(입장 전 미리보기에서 카메라만 끄고 싶을 때). */
  function toggleCam() {
    const tracks = stream.value?.getVideoTracks()
    if (!tracks?.length) return
    const next = !camOn.value
    tracks.forEach((t) => (t.enabled = next))
    camOn.value = next
  }

  /** 권한 재요청 없이 오디오 트랙만 껐다 켠다. */
  function toggleMic() {
    const tracks = stream.value?.getAudioTracks()
    if (!tracks?.length) return
    const next = !micOn.value
    tracks.forEach((t) => (t.enabled = next))
    micOn.value = next
  }

  // 장치를 꽂거나 뽑으면 목록을 다시 읽는다(권한 허용 후에 연결한 웹캠·헤드셋도 선택지에 나오도록).
  const onDeviceChange = () => void refreshDevices()
  navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)

  onBeforeUnmount(() => {
    navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange)
    stop()
  })

  return {
    stream,
    isOn,
    error,
    camOn,
    micOn,
    videoDevices,
    audioDevices,
    videoDeviceId,
    audioDeviceId,
    start,
    stop,
    toggleCam,
    toggleMic,
    selectVideoDevice,
    selectAudioDevice,
  }
}
