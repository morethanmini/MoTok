/**
 * 팝업이 떠 있는 동안 뒤 페이지가 스크롤되지 않게 잠근다.
 *
 * 마운트되면 잠그고 사라지면 되돌린다 — 팝업이 `v-if`로 붙고 떼이는 방식이라 컴포넌트 수명과
 * 잠금 수명이 그대로 맞는다.
 *
 * <b>겹쳐 뜨는 경우를 센다.</b> 팝업 위에 팝업이 뜨는 자리가 있어서(예: 마이페이지 상세 위의
 * 확인창), 나중에 열린 쪽이 닫힐 때 그냥 풀어 버리면 아직 팝업이 떠 있는데도 뒤가 스크롤된다.
 * 그래서 열린 개수를 세고 마지막 하나가 닫힐 때만 되돌린다.
 *
 * <b>원래 값을 기억해 되돌린다.</b> 빈 문자열로 밀어 버리면, 페이지가 스스로 걸어 둔
 * overflow(내부 스크롤러를 쓰는 화면들)를 팝업이 닫히면서 지워 버린다.
 */
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

let openCount = 0
let restore: (() => void) | null = null

function lock() {
  openCount += 1
  if (openCount > 1) return // 이미 잠겨 있다

  const html = document.documentElement
  const body = document.body
  const prev = {
    htmlOverflow: html.style.overflow,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    padding: body.style.paddingRight,
  }
  const y = window.scrollY

  // 스크롤바가 사라지면 뷰포트가 넓어져 뒤 내용이 옆으로 튄다. 사라진 만큼을 padding으로 메운다.
  // 스크롤바가 자리를 차지하지 않는 환경(macOS 오버레이 스크롤바·scrollbar-width:none 화면)에서는
  // 0이 나와 아무것도 하지 않는다.
  const scrollbar = window.innerWidth - html.clientWidth

  /*
   * body를 보고 있던 만큼 끌어올려 고정한다.
   *
   * <b>html에 overflow:hidden만 걸면 안 된다.</b> 루트의 overflow는 뷰포트로 전파되어 뷰포트
   * 자체가 스크롤할 수 없게 되고, 그 순간 스크롤 위치가 0으로 튄다 — 반투명 배경 뒤로 그 점프가
   * 그대로 보이고, 닫은 뒤에도 원래 자리가 아니다(스크립트로도 되돌릴 수 없다).
   * top에 -스크롤값을 주면 보이는 화면은 그대로면서 스크롤만 사라진다.
   */
  body.style.position = 'fixed'
  body.style.top = `${-y}px`
  body.style.left = '0'
  body.style.right = '0'
  html.style.overflow = 'hidden' // 남아 있을 수 있는 스크롤바 제거
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`

  restore = () => {
    html.style.overflow = prev.htmlOverflow
    body.style.position = prev.position
    body.style.top = prev.top
    body.style.left = prev.left
    body.style.right = prev.right
    body.style.paddingRight = prev.padding
    window.scrollTo(0, y) // 고정을 풀면 0으로 돌아가므로 보고 있던 자리로 되돌린다
  }
}

function unlock() {
  openCount = Math.max(0, openCount - 1)
  if (openCount === 0 && restore) {
    restore()
    restore = null
  }
}

export function useScrollLock(): void {
  onMounted(lock)
  onBeforeUnmount(unlock)
}

/**
 * 팝업이 컴포넌트가 아니라 한 화면 안의 `v-if` 블록인 경우에 쓴다(전용 컴포넌트로 빼지 않은 확인창).
 *
 * 켜질 때 잠그고 꺼질 때 푼다. 켜진 채 화면을 떠나도 반드시 풀어 준다 — 안 풀면 다음 화면이
 * 스크롤되지 않는 채로 남는데, 원인이 화면 밖에 있어 찾기 어려운 종류의 고장이 된다.
 */
export function useScrollLockWhen(active: Ref<boolean> | (() => boolean)): void {
  let locked = false
  watch(
    active,
    (on) => {
      if (on === locked) return
      locked = on
      if (on) lock()
      else unlock()
    },
    { immediate: true },
  )
  onBeforeUnmount(() => {
    if (locked) unlock()
  })
}

/** 테스트에서 카운터가 판을 넘어 새지 않게 쓴다. 제품 코드에서는 부르지 않는다. */
export function __resetScrollLock(): void {
  if (restore) restore()
  restore = null
  openCount = 0
}
