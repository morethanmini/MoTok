/**
 * 카메라/마이크 스트림 컴포저블 (getUserMedia).
 * Device Setup·Game Room 공용. 컴포넌트 언마운트 시 자동으로 트랙을 정리합니다.
 */
import { onBeforeUnmount, ref, shallowRef } from 'vue'

export function useCamera() {
  const stream = shallowRef<MediaStream | null>(null)
  const isOn = ref(false)
  const error = ref<string | null>(null)

  async function start(constraints: MediaStreamConstraints = { video: { width: 640, height: 400 }, audio: false }) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(constraints)
      stream.value = s
      isOn.value = true
      error.value = null
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

  onBeforeUnmount(stop)

  return { stream, isOn, error, start, stop }
}
