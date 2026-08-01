/**
 * 배경음악(BGM) 싱글턴 컴포저블.
 * 프로토타입 bgm.js를 Vue 친화적으로 이식 — 오디오는 앱 전역에서 하나만 유지하고,
 * 재생 상태는 reactive ref로 노출해 어느 컴포넌트에서든 토글/구독할 수 있게 합니다.
 */
import { ref, readonly } from 'vue'

const BGM_SRC = '/assets/bgm/motok-theme.mp3'
const KEY_ENABLED = 'motok-bgm-enabled'
const KEY_TIME = 'motok-bgm-time'
const KEY_LOBBY_MUSIC = 'motok-lobby-music'
const KEY_GAME_MUSIC = 'motok-game-music'

/** 슬라이더 기본값 — 전 항목 50%로 맞춘다(설정 화면의 소리 항목 공통). */
export const DEFAULT_LEVEL = 0.5

// ── 모듈 스코프 싱글턴 (여러 곳에서 useBgm()을 불러도 동일 인스턴스) ──
let audio: HTMLAudioElement | null = null
let suspendedForGame = false
const isPlaying = ref(false)
const isEnabled = ref(true)

/**
 * 트랙 자체의 기준 레벨. 호출부가 {@link setVolume}으로 정한다(로비·게임방 모두 0.2).
 * 트랙마다 마스터링 레벨이 달라 이 값이 곡별 보정이고, 아래 마스터와 곱해져 실제 볼륨이 된다.
 */
let baseVolume = 0.2

/**
 * 사용자가 조절하는 음악 크기 — 로비와 게임을 따로 둔다(설정 화면에서 각각, 게임방 버튼은 게임만).
 *
 * <p><b>0.5가 기본이고 1.0이 2배다.</b> 곡별 기준 레벨(로비 0.2 · 게임 0.28/0.23)에
 * {@code 값 × 2}를 곱하므로 0.5에서 기준 그대로, 1.0에서 두 배가 된다. 기준 레벨이 낮아
 * 2배를 해도 HTMLAudioElement 상한(1.0)에 닿지 않는다(0.4 · 0.56).</p>
 *
 * <p>기준 레벨을 직접 건드리지 않는 이유 — 그 값들은 트랙 RMS를 재서 맞춰 놓은 곡별 보정이라
 * 사용자 조절과 축이 다르다.</p>
 */
const lobbyMusic = ref(DEFAULT_LEVEL)
const gameMusic = ref(DEFAULT_LEVEL)

/** 0.5 = 기준 그대로. 이 배수 덕분에 슬라이더 100%가 2배가 된다. */
const GAIN_AT_FULL = 2

function readLevel(key: string): number {
  // 저장값이 없을 때 Number(null)이 0이 되어 기본값 대신 무음으로 시작하던 문제 — 먼저 걸러낸다.
  const raw = sessionStorage.getItem(key)
  if (raw === null || raw === '') return DEFAULT_LEVEL
  const v = Number(raw)
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_LEVEL
}

/** 로비 테마의 실제 볼륨 — 기준 레벨 × 사용자 값 × 2 */
function lobbyLevel(): number {
  return Math.min(1, baseVolume * lobbyMusic.value * GAIN_AT_FULL)
}

/** 게임 BGM이 곱할 배수. gameBgm·body-fit/audio 가 자기 기준 레벨에 이 값을 곱한다. */
export function gameMusicGain(): number {
  return gameMusic.value * GAIN_AT_FULL
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio
  audio = new Audio(BGM_SRC)
  audio.preload = 'auto'
  audio.loop = true
  lobbyMusic.value = readLevel(KEY_LOBBY_MUSIC)
  gameMusic.value = readLevel(KEY_GAME_MUSIC)
  audio.volume = lobbyLevel()

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

/** 트랙 기준 레벨을 정한다(곡별 보정). 사용자가 조절하는 값은 {@link setLobbyMusic}이다. */
function setVolume(value: number) {
  baseVolume = Math.max(0, Math.min(1, value))
  ensureAudio().volume = lobbyLevel()
}

/**
 * 0에서 올릴 때 꺼둔 음악을 되살린다 — 슬라이더를 올렸는데 아무 소리도 안 나면 고장으로 보인다.
 * 헤더 토글과 설정 슬라이더가 서로를 모르는 상태를 피한다.
 */
function reviveIfSilenced(next: number, wasSilent: boolean) {
  if (next > 0 && (wasSilent || !isEnabled.value)) {
    isEnabled.value = true
    sessionStorage.setItem(KEY_ENABLED, 'true')
    void play()
  }
}

/** 로비 테마 크기(0~1, 0.5가 기본). 게임 중에는 테마가 내려가 있어 들리지 않는다. */
function setLobbyMusic(value: number) {
  const next = Math.max(0, Math.min(1, value))
  const wasSilent = lobbyMusic.value === 0
  lobbyMusic.value = next
  sessionStorage.setItem(KEY_LOBBY_MUSIC, String(next))
  ensureAudio().volume = lobbyLevel()
  reviveIfSilenced(next, wasSilent)
}

/** 게임 BGM 크기(0~1, 0.5가 기본). 게임방 음악 버튼과 설정 화면이 같은 값을 쓴다. */
function setGameMusic(value: number) {
  const next = Math.max(0, Math.min(1, value))
  const wasSilent = gameMusic.value === 0
  gameMusic.value = next
  sessionStorage.setItem(KEY_GAME_MUSIC, String(next))
  reviveIfSilenced(next, wasSilent)
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
    lobbyMusic: readonly(lobbyMusic),
    gameMusic: readonly(gameMusic),
    play,
    pause,
    toggle,
    setVolume,
    setLobbyMusic,
    setGameMusic,
    suspendForGame,
    resumeAfterGame,
  }
}
