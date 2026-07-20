/**
 * 배경음악(BGM) 싱글턴 컴포저블.
 * 프로토타입 bgm.js를 Vue 친화적으로 이식 — 오디오는 앱 전역에서 하나만 유지하고,
 * 재생 상태는 reactive ref로 노출해 어느 컴포넌트에서든 토글/구독할 수 있게 합니다.
 */
import { ref, readonly } from 'vue'

const BGM_SRC = '/assets/bgm/motok-theme.mp3'
const KEY_ENABLED = 'motok-bgm-enabled'
const KEY_TIME = 'motok-bgm-time'

// ── 모듈 스코프 싱글턴 (여러 곳에서 useBgm()을 불러도 동일 인스턴스) ──
let audio: HTMLAudioElement | null = null
let suspendedForGame = false
const isPlaying = ref(false)
const isEnabled = ref(true)

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio
  audio = new Audio(BGM_SRC)
  audio.preload = 'auto'
  audio.loop = true
  audio.volume = 0.2

  const savedTime = Number(sessionStorage.getItem(KEY_TIME))
  if (Number.isFinite(savedTime) && savedTime > 0) audio.currentTime = savedTime
  isEnabled.value = sessionStorage.getItem(KEY_ENABLED) !== 'false'

  const sync = () => { isPlaying.value = !audio!.paused }
  audio.addEventListener('play', sync)
  audio.addEventListener('pause', sync)

  // 브라우저 자동재생 정책: 첫 사용자 상호작용에서 재생 재시도
  const retry = () => { void play() }
  document.addEventListener('pointerdown', retry, { once: true, capture: true })
  document.addEventListener('keydown', retry, { once: true, capture: true })
  window.addEventListener('pagehide', () => {
    if (audio) sessionStorage.setItem(KEY_TIME, String(audio.currentTime))
  })

  return audio
}

async function play() {
  const a = ensureAudio()
  if (!isEnabled.value || suspendedForGame) return
  try {
    await a.play()
  } catch {
    /* 자동재생 차단 — 다음 상호작용에서 재시도 */
  }
}

function pause() {
  ensureAudio().pause()
}

function toggle() {
  const a = ensureAudio()
  isEnabled.value = a.paused
  sessionStorage.setItem(KEY_ENABLED, String(isEnabled.value))
  if (isEnabled.value) void play()
  else pause()
}

function setVolume(value: number) {
  ensureAudio().volume = Math.max(0, Math.min(1, value))
}

/** 게임 실행 중 BGM 일시 정지 (게임 자체 사운드와 겹치지 않도록) */
function suspendForGame() {
  suspendedForGame = true
  pause()
}

/** 게임 종료 후 BGM 복귀 */
function resumeAfterGame() {
  suspendedForGame = false
  void play()
}

export function useBgm() {
  return {
    isPlaying: readonly(isPlaying),
    isEnabled: readonly(isEnabled),
    play,
    pause,
    toggle,
    setVolume,
    suspendForGame,
    resumeAfterGame,
  }
}
