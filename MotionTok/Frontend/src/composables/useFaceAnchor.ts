/**
 * 내 카메라 영상에서 얼굴을 따라가는 앵커 하나를 만들어 준다 — 가면 아이템 전용.
 *
 *   const face = useFaceAnchor(() => videoEl.value, () => camOn && hasMask)
 *   <StickerOverlay :sprites="…" :face="face.anchor.value" />
 *
 * 화면 세 곳(인벤토리·장치 설정·게임룸 셀프 타일)이 같은 방식으로 쓰므로 여기 한 번만 둔다.
 *
 * 원격 참가자 타일에는 쓰지 않는다 — 검출기 인스턴스가 영상 하나만 다룰 수 있고(타임스탬프
 * 단조 증가), 8명분을 각자 돌리는 비용도 감당할 수 없다. 그래서 지금은 <b>내 화면에서만</b>
 * 가면이 보인다(남에게도 보이게 하려면 앵커를 데이터 채널로 흘려보내야 한다 — 후속 작업).
 */
import { onScopeDispose, ref, watch } from 'vue'
import { useFaceDetector } from './useFaceDetector'
import { FaceAnchorTracker, type FaceAnchor } from '@/features/decor/faceAnchor'

export function useFaceAnchor(video: () => HTMLVideoElement | null | undefined, enabled: () => boolean) {
  const anchor = ref<FaceAnchor | null>(null)
  const detector = useFaceDetector()
  const tracker = new FaceAnchorTracker()

  function stop() {
    detector.stop()
    tracker.reset()
    anchor.value = null
  }

  async function startOn(el: HTMLVideoElement) {
    await detector.start(el, (result, nowMs) => {
      // 여러 명이 잡히면 가장 큰 얼굴 — 카메라 앞에 앉은 사람이 나다.
      const face = result.detections.reduce<(typeof result.detections)[number] | null>(
        (best, d) => ((d.boundingBox?.width ?? 0) > (best?.boundingBox?.width ?? 0) ? d : best),
        null,
      )
      anchor.value = tracker.update(face?.keypoints, el.videoWidth, el.videoHeight, nowMs)
    })
  }

  // 카메라를 켜거나 가면을 장착한 순간부터 돌린다 — 필요 없을 때 GPU를 물고 있지 않게.
  watch(
    [video, enabled],
    ([el, on]) => {
      stop()
      if (on && el) void startOn(el)
    },
    { immediate: true },
  )

  onScopeDispose(stop)

  return { anchor, error: detector.error }
}
