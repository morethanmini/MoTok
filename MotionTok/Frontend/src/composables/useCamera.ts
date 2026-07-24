/**
 * 카메라/마이크 스트림 컴포저블 (getUserMedia).
 * Device Setup·Game Room 공용. 컴포넌트 언마운트 시 자동으로 트랙을 정리합니다.
 */
import { onBeforeUnmount, ref, shallowRef } from 'vue'

export function useCamera() {
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
      return s
    } catch {
      error.value = '카메라·마이크 권한을 허용해 주세요'
      isOn.value = false
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
