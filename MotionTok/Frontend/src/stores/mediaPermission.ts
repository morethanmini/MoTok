/**
 * 카메라·마이크 권한 상태 (앱 전역).
 *
 * 권한의 실제 주인은 브라우저다 — 여기 저장하는 건 "마지막으로 확인된 상태"를 캐시해서
 * 화면을 옮길 때마다 권한 팝업을 다시 띄우지 않기 위한 것이다. 방에 들어갈 때는 캐시를 믿지 않고
 * ensure()로 실제 상태를 다시 확인하고, 풀렸으면 그 자리에서 다시 요청해 전역 상태를 고친다.
 *
 * sessionStorage에 두는 이유 — 게스트 세션과 같은 수명(탭을 닫으면 소멸)이고, 브라우저 권한 자체가
 * 사이트 설정에서 언제든 바뀔 수 있어 localStorage에 오래 남겨 봐야 신뢰할 수 없다.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type MediaPermissionState = 'unknown' | 'granted' | 'denied'

const STORAGE_KEY = 'motok.mediaPermission'

/** Permissions API의 카메라·마이크 이름은 TS PermissionName에 없어서 캐스팅이 필요하다. */
const CAMERA = 'camera' as PermissionName
const MICROPHONE = 'microphone' as PermissionName

function loadCached(): MediaPermissionState {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  return raw === 'granted' || raw === 'denied' ? raw : 'unknown'
}

export const useMediaPermissionStore = defineStore('mediaPermission', () => {
  const state = ref<MediaPermissionState>(loadCached())
  /** 마지막 확인 시각이 아니라 상태만 쓴다 — 만료 개념은 브라우저 쪽에 있다. */
  const granted = computed(() => state.value === 'granted')
  const denied = computed(() => state.value === 'denied')

  function set(next: MediaPermissionState) {
    state.value = next
    if (next === 'unknown') sessionStorage.removeItem(STORAGE_KEY)
    else sessionStorage.setItem(STORAGE_KEY, next)
  }

  /** getUserMedia 성공/실패를 그대로 전역 상태로 반영한다(useCamera가 호출). */
  const markGranted = () => set('granted')
  const markDenied = () => set('denied')
  const reset = () => set('unknown')

  /**
   * 브라우저에 실제 권한 상태를 물어본다. Permissions API로 카메라·마이크를 조회할 수 없는
   * 브라우저(파이어폭스 등)에서는 null — 이때는 실제로 getUserMedia를 해 보는 수밖에 없다.
   */
  async function query(): Promise<MediaPermissionState | null> {
    if (!navigator.permissions?.query) return null
    try {
      const [cam, mic] = await Promise.all([
        navigator.permissions.query({ name: CAMERA }),
        navigator.permissions.query({ name: MICROPHONE }),
      ])
      // 둘 중 하나라도 거부면 모션 게임을 못 하므로 거부로 본다.
      if (cam.state === 'denied' || mic.state === 'denied') return 'denied'
      if (cam.state === 'granted' && mic.state === 'granted') return 'granted'
      return 'unknown' // prompt — 아직 물어본 적 없음
    } catch {
      // 지원하지 않는 권한 이름이면 예외가 난다(사파리 계열).
      return null
    }
  }

  /**
   * 권한 요청. 스트림은 확인용이라 바로 정리한다 — 실제 사용은 각 화면의 useCamera가 다시 연다.
   * (여기서 스트림을 들고 있으면 카메라 표시등이 계속 켜져 있어 사용자가 불안해한다)
   */
  async function request(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      stream.getTracks().forEach((t) => t.stop())
      markGranted()
      return true
    } catch {
      markDenied()
      return false
    }
  }

  /**
   * 방 입장 전 확인 — 이미 허용돼 있으면 팝업 없이 통과하고, 풀렸으면 다시 요청해서
   * 전역 상태까지 고친다. 결과는 그대로 세션 캐시에 반영된다.
   */
  async function ensure(): Promise<boolean> {
    const actual = await query()
    if (actual === 'granted') {
      markGranted()
      return true
    }
    if (actual === 'denied') {
      // 브라우저가 막아 둔 상태라 다시 물어봐도 팝업이 안 뜬다 — 사이트 설정에서 풀어야 한다.
      markDenied()
      return false
    }
    // 조회 불가(null)거나 아직 안 물어본 상태(unknown) — 실제로 요청해 본다.
    return request()
  }

  return { state, granted, denied, markGranted, markDenied, reset, query, request, ensure }
})
