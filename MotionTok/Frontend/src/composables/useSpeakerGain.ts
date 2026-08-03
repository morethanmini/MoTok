/**
 * 상대 소리(스피커) 크기 — 100%에서 2배까지 올린다.
 *
 * <p><b>왜 Web Audio가 필요한가.</b> {@code HTMLAudioElement.volume}은 1.0이 상한이라 요소만으로는
 * 증폭이 안 된다. 그래서 LiveKit이 붙여 놓은 {@code <audio>}를 {@code createMediaElementSource}로
 * 감싸고 {@code GainNode}로 키운다.</p>
 *
 * <p><b>요소를 버리지 않는 이유.</b> 트랙을 직접 Web Audio에 넣으면 LiveKit의 자동재생 정책 처리와
 * 트랙 재부착을 우리가 다시 만들어야 한다. 요소를 그대로 두면 그건 LiveKit이 계속 해 주고, 우리는
 * 게인만 얹는다. 덤으로 <b>참가자별 개인 볼륨({@code el.volume})이 그래프 앞단이라 그대로 곱해진다</b> —
 * 합성 로직이 필요 없다.</p>
 *
 * <p>발행(마이크) 경로는 건드리지 않는다 — 여기서 하는 일은 전부 내 귀에만 영향이 있다.</p>
 */
import { readonly, ref } from 'vue'

const KEY = 'motok-speaker-level'
/** 설정 화면의 다른 소리 항목과 같은 기본값 */
const DEFAULT_LEVEL = 0.5
/** 0.5에서 1배, 1.0에서 2배 */
const GAIN_AT_FULL = 2

const level = ref(DEFAULT_LEVEL)

/**
 * 상대 소리 전체 음소거 — 방 하단 스피커 버튼.
 *
 * <p><b>level과 따로 두는 이유.</b> 음소거를 {@code level = 0}으로 구현하면 설정 화면의
 * '상대 소리' 슬라이더 값을 덮어써서(그리고 sessionStorage에 써서) 해제할 때 되돌릴 값이 없다.
 * 두 값을 곱해 쓰면 음소거를 풀었을 때 원래 크기가 그대로 돌아온다.</p>
 *
 * <p>저장하지 않는다 — 새로고침하면 소리가 돌아온다. 버튼이 같은 값을 읽어 그리므로
 * 화면과 어긋나지는 않는다.</p>
 */
const muted = ref(false)

let ctx: AudioContext | null = null
/** 요소당 한 번만 만들 수 있어서(createMediaElementSource 제약) 요소를 키로 캐시한다 */
const nodes = new WeakMap<HTMLMediaElement, GainNode>()
/** WeakMap은 순회가 안 되므로 게인 갱신 대상은 따로 들고 있는다 */
const live = new Set<GainNode>()
/**
 * 음소거는 게인뿐 아니라 <b>요소에도</b> 건다. Web Audio가 없는 환경에서는 게인 그래프가
 * 아예 안 만들어지는데(ensureCtx가 null), 증폭이 빠지는 건 참을 수 있어도
 * <b>음소거가 조용히 실패하는 건 안 된다</b> — 눌렀는데 소리가 계속 나는 게 지금 그 버그다.
 */
const els = new Set<HTMLMediaElement>()

function gainValue(): number {
  return muted.value ? 0 : level.value * GAIN_AT_FULL
}

function applyGain() {
  const v = gainValue()
  live.forEach((g) => {
    g.gain.value = v
  })
}

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx
  // 구형·비지원 환경에서는 조용히 포기한다 — 증폭만 없고 소리는 요소가 그대로 낸다
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  // 자동재생 정책: 사용자 제스처 전에는 suspended 로 시작한다(useBgm 과 같은 재시도 방식)
  const resume = () => void ctx?.resume().catch(() => {})
  document.addEventListener('pointerdown', resume, { capture: true })
  document.addEventListener('keydown', resume, { capture: true })
  return ctx
}

/**
 * 이 요소의 소리를 게인 그래프로 돌린다. 같은 요소로 여러 번 불러도 한 번만 만든다.
 *
 * <p>{@code createMediaElementSource}를 부르면 그 요소의 출력이 그래프로 <b>리라우팅</b>된다 —
 * 요소가 직접 소리를 내지 않으므로 소리가 두 번 들리지 않는다.</p>
 */
export function attachSpeakerGain(el: HTMLMediaElement) {
  // 음소거 중에 들어온 참가자도 조용해야 한다 — 등록과 음소거는 게인 그래프보다 먼저,
  // 그리고 아래 조기 반환보다 먼저 한다(같은 요소로 트랙만 다시 붙는 경우도 지나간다).
  els.add(el)
  el.muted = muted.value
  if (nodes.has(el)) return
  const c = ensureCtx()
  if (!c) return
  try {
    const src = c.createMediaElementSource(el)
    const gain = c.createGain()
    gain.gain.value = gainValue()
    src.connect(gain)
    gain.connect(c.destination)
    nodes.set(el, gain)
    live.add(gain)
  } catch {
    // 이미 다른 그래프에 물린 요소 등 — 증폭 없이 요소 소리를 그대로 쓴다
  }
}

/** 타일이 사라질 때 호출. 끊어 두지 않으면 없어진 요소의 노드가 그래프에 남는다. */
export function detachSpeakerGain(el: HTMLMediaElement) {
  els.delete(el)
  const gain = nodes.get(el)
  if (!gain) return
  gain.disconnect()
  live.delete(gain)
  nodes.delete(el)
}

export function setSpeakerLevel(value: number) {
  level.value = Math.max(0, Math.min(1, value))
  sessionStorage.setItem(KEY, String(level.value))
  applyGain()
}

/**
 * 상대 소리 전체를 끄고 켠다(방 하단 스피커 버튼).
 * 참가자별 개인 볼륨({@code p.setVolume})은 건드리지 않는다 — 해제하면 각자 값이 그대로 돌아온다.
 */
export function setSpeakerMuted(value: boolean) {
  muted.value = value
  els.forEach((el) => {
    el.muted = value
  })
  applyGain()
}

export function useSpeakerGain() {
  // 저장값이 없으면 Number(null)이 0이라 기본값 대신 무음으로 시작한다 — 먼저 걸러낸다.
  const raw = sessionStorage.getItem(KEY)
  const saved = raw === null || raw === '' ? NaN : Number(raw)
  if (Number.isFinite(saved) && saved >= 0 && saved <= 1 && level.value === DEFAULT_LEVEL) {
    level.value = saved
  }
  return {
    speakerLevel: readonly(level),
    setSpeakerLevel,
    speakerMuted: readonly(muted),
    setSpeakerMuted,
  }
}
