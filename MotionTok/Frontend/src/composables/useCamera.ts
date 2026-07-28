/**
 * 카메라/마이크 스트림 컴포저블 (getUserMedia).
 * Device Setup·Game Room 공용. 컴포넌트 언마운트 시 자동으로 트랙을 정리합니다.
 */
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { useMediaPermissionStore } from '@/stores/mediaPermission'

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

  async function start(constraints: MediaStreamConstraints = { video: { width: 640, height: 400 }, audio: false }) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(constraints)
      stream.value = s
      isOn.value = true
      error.value = null
      camOn.value = s.getVideoTracks().length > 0
      micOn.value = s.getAudioTracks().length > 0
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

  onBeforeUnmount(stop)

  return { stream, isOn, error, camOn, micOn, start, stop, toggleCam, toggleMic }
}
