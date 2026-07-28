/**
 * 마이크 입력 레벨 컴포저블 (WebAudio AnalyserNode).
 * 장치 설정에서 "고른 마이크가 실제로 소리를 받고 있는지" 보여주는 용도.
 * 스트림이 바뀌면 분석 노드를 다시 연결하고, 언마운트 시 정리합니다.
 */
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** @param stream 마이크가 포함된 스트림(없거나 오디오 트랙이 없으면 레벨은 0) */
export function useMicLevel(stream: Ref<MediaStream | null>) {
  /** 0~1 입력 레벨(RMS). 말할 때 0.1~0.5 정도까지 오른다. */
  const level = ref(0)

  let ctx: AudioContext | null = null
  let raf = 0

  function teardown() {
    cancelAnimationFrame(raf)
    raf = 0
    void ctx?.close()
    ctx = null
    level.value = 0
  }

  watch(
    stream,
    (s) => {
      teardown()
      const track = s?.getAudioTracks()[0]
      if (!s || !track) return
      // 스트림 전체를 넣으면 비디오 트랙까지 물고 들어가므로 오디오 트랙만 떼어 연결한다.
      ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      const tick = () => {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += v * v
        // 트랙을 꺼도(enabled=false) 무음이 흐를 뿐이라 레벨은 자연스럽게 0이 된다.
        level.value = Math.sqrt(sum / buf.length)
        raf = requestAnimationFrame(tick)
      }
      tick()
    },
    { immediate: true },
  )

  onBeforeUnmount(teardown)

  return { level }
}
