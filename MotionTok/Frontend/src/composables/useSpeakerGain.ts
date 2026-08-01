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

let ctx: AudioContext | null = null
/** 요소당 한 번만 만들 수 있어서(createMediaElementSource 제약) 요소를 키로 캐시한다 */
const nodes = new WeakMap<HTMLMediaElement, GainNode>()
/** WeakMap은 순회가 안 되므로 게인 갱신 대상은 따로 들고 있는다 */
const live = new Set<GainNode>()

function gainValue(): number {
  return level.value * GAIN_AT_FULL
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
  const gain = nodes.get(el)
  if (!gain) return
  gain.disconnect()
  live.delete(gain)
  nodes.delete(el)
}

export function setSpeakerLevel(value: number) {
  level.value = Math.max(0, Math.min(1, value))
  sessionStorage.setItem(KEY, String(level.value))
  const v = gainValue()
  live.forEach((g) => {
    g.gain.value = v
  })
}

export function useSpeakerGain() {
  // 저장값이 없으면 Number(null)이 0이라 기본값 대신 무음으로 시작한다 — 먼저 걸러낸다.
  const raw = sessionStorage.getItem(KEY)
  const saved = raw === null || raw === '' ? NaN : Number(raw)
  if (Number.isFinite(saved) && saved >= 0 && saved <= 1 && level.value === DEFAULT_LEVEL) {
    level.value = saved
  }
  return { speakerLevel: readonly(level), setSpeakerLevel }
}
