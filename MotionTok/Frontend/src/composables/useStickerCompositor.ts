/**
 * 카메라 영상 + 장착 스티커를 캔버스에 합성해 <b>발행용 트랙</b>을 만든다.
 *
 * 왜 필요한가 — 지금까지는 getUserMedia 원본 트랙의 복제본을 그대로 발행해서, 스티커를 화면에
 * 얹어도 나만 보였다. 다른 참가자에게 보이려면 보내는 픽셀 자체에 스티커가 들어가야 한다.
 *
 * 원본 캡처는 건드리지 않는다 — 모션 인식 게임이 원본 <video>를 입력으로 쓰기 때문에,
 * 여기서는 자체 <video>에 스트림을 물려 프레임만 읽어 간다.
 *
 *   const comp = useStickerCompositor()
 *   const track = await comp.start(stream, () => sprites.value)   // 발행할 트랙
 *   comp.stop()
 */
import { onBeforeUnmount, ref } from 'vue'
import { drawSprites, preloadSprites, type StickerSprite } from '@/features/decor/sticker'

/** requestVideoFrameCallback을 지원하는 브라우저용 최소 타입(TS lib에 아직 없음). */
type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

const FALLBACK_FPS = 30

export function useStickerCompositor() {
  const active = ref(false)
  /** 현재 합성 트랙 — 이미 발행 중이면 다시 만들지 않고 이걸 재사용해야 한다. */
  const track = ref<MediaStreamTrack | null>(null)

  let video: VideoFrameCallbackVideo | null = null
  let canvas: HTMLCanvasElement | null = null
  let ctx: CanvasRenderingContext2D | null = null
  let outputTrack: MediaStreamTrack | null = null
  let rafHandle = 0
  let frameHandle = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let getSprites: () => StickerSprite[] = () => []

  function drawFrame() {
    if (!ctx || !canvas || !video) return
    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return

    // 카메라 해상도가 바뀌면(장치 교체 등) 캔버스도 따라간다.
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    ctx.drawImage(video, 0, 0, w, h)

    const sprites = getSprites()
    preloadSprites(sprites)
    // 발행되는 화면은 좌우 반전이 아니다(내 미리보기만 CSS로 뒤집혀 보인다) → mirrored=false.
    drawSprites(ctx, w, h, sprites, false)
  }

  /** 프레임 루프 — 새 영상 프레임에 맞춰 그리고, 지원하지 않으면 rAF로 대체한다. */
  function loop() {
    drawFrame()
    if (!active.value || !video) return
    if (video.requestVideoFrameCallback) {
      frameHandle = video.requestVideoFrameCallback(loop)
    } else {
      rafHandle = requestAnimationFrame(loop)
    }
  }

  /**
   * 합성 시작. 반환값은 발행에 쓸 트랙이며, 실패하면 null(호출 측은 원본 트랙으로 넘어간다).
   * sprites는 매 프레임 콜백으로 읽으므로 장착을 바꾸면 다음 프레임부터 바로 반영된다.
   */
  async function start(
    stream: MediaStream,
    sprites: () => StickerSprite[],
  ): Promise<MediaStreamTrack | null> {
    stop()
    const source = stream.getVideoTracks()[0]
    if (!source) return null

    getSprites = sprites
    video = document.createElement('video')
    video.srcObject = new MediaStream([source])
    video.muted = true
    video.playsInline = true
    try {
      await video.play()
    } catch {
      // 자동재생이 막히면 합성할 프레임을 못 얻는다 — 원본 발행으로 떨어지게 null.
      stop()
      return null
    }

    canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 400
    ctx = canvas.getContext('2d')
    if (!ctx) {
      stop()
      return null
    }

    active.value = true
    drawFrame() // captureStream 전에 첫 프레임을 채워 둔다(빈 검은 프레임 발행 방지)
    outputTrack = canvas.captureStream(FALLBACK_FPS).getVideoTracks()[0] ?? null
    if (!outputTrack) {
      stop()
      return null
    }

    track.value = outputTrack
    loop()
    // requestVideoFrameCallback이 없고 탭이 백그라운드면 rAF가 멈춰 상대 화면이 정지한다.
    // 낮은 주기 타이머로 최소한의 갱신을 유지한다.
    if (!video.requestVideoFrameCallback) {
      timer = setInterval(drawFrame, 1000 / 10)
    }
    return outputTrack
  }

  /** 합성 정리. 발행 해제는 호출 측(LiveKit) 몫이고 여기서는 캔버스·루프만 거둔다. */
  function stop() {
    active.value = false
    if (rafHandle) cancelAnimationFrame(rafHandle)
    if (frameHandle && video?.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameHandle)
    if (timer) clearInterval(timer)
    rafHandle = 0
    frameHandle = 0
    timer = undefined

    outputTrack?.stop()
    outputTrack = null
    track.value = null
    if (video) {
      video.srcObject = null
      video = null
    }
    canvas = null
    ctx = null
  }

  onBeforeUnmount(stop)

  return { active, track, start, stop }
}
