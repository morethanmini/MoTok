/**
 * 게임 화면 위에 떠 있는 패널을 끌어서 옮긴다(스코어보드 등).
 *
 * 게임마다 화면 구성이 달라 어디에 두든 무언가를 가린다 — 기본 자리를 게임별로 잡아 주는
 * 대신 사용자가 직접 치우게 한다. 옮긴 자리는 localStorage에 남아 다음 판에도 유지된다.
 *
 * 좌표는 `offsetParent`(= position:relative 인 무대) 기준 px이다. 화면 크기가 바뀌면
 * 저장된 자리가 밖으로 나갈 수 있어서 잡을 때·놓을 때·붙을 때 모두 무대 안으로 되돌린다.
 */
import { computed, onScopeDispose, ref, watch, type CSSProperties } from 'vue'

export interface PanelPos {
  x: number
  y: number
}

function load(key: string): PanelPos | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<PanelPos>
    return typeof p?.x === 'number' && typeof p?.y === 'number' ? { x: p.x, y: p.y } : null
  } catch {
    return null // 저장소를 못 쓰는 브라우저(사생활 보호 모드 등) — 기본 자리로 둔다
  }
}

function save(key: string, pos: PanelPos | null) {
  try {
    if (pos) localStorage.setItem(key, JSON.stringify(pos))
    else localStorage.removeItem(key)
  } catch {
    /* 저장 실패해도 이번 판은 옮긴 자리 그대로 쓴다 */
  }
}

export function useDraggablePanel(storageKey: string) {
  const el = ref<HTMLElement | null>(null)
  const pos = ref<PanelPos | null>(load(storageKey))
  const dragging = ref(false)

  /** 패널이 무대 밖으로 나가지 않게 자른다. 최소 24px은 남겨 다시 잡을 수 있게 한다. */
  function clamp(p: PanelPos): PanelPos {
    const node = el.value
    const stage = node?.offsetParent as HTMLElement | null
    if (!node || !stage) return p
    const maxX = Math.max(0, stage.clientWidth - node.offsetWidth)
    const maxY = Math.max(0, stage.clientHeight - node.offsetHeight)
    return { x: Math.min(maxX, Math.max(0, p.x)), y: Math.min(maxY, Math.max(0, p.y)) }
  }

  /**
   * 저장된 자리가 무대 밖이면 되돌린다.
   *
   * 밖으로 나가면 손잡이를 잡을 수 없고, 잡을 수 없으면 더블클릭 초기화도 못 해서 스스로
   * 복구할 방법이 사라진다. 그래서 붙을 때(게임 시작)·창 크기가 바뀔 때·무대가 줄어들 때 모두 자른다.
   * 드래그 중에는 건드리지 않는다 — onHandleMove가 이미 자르고 있다.
   */
  function reclamp() {
    if (!dragging.value && pos.value) pos.value = clamp(pos.value)
  }

  // 창 크기와 별개로 무대만 줄어드는 경우가 있다(나란히 보기 전환·채팅 펼치기 등).
  // 그래서 resize 하나로는 부족해 무대 자체도 관측한다.
  let stageObserver: ResizeObserver | null = null

  watch(el, (node) => {
    stageObserver?.disconnect()
    stageObserver = null
    if (!node) return
    reclamp()
    const stage = node.offsetParent as HTMLElement | null
    if (stage && typeof ResizeObserver !== 'undefined') {
      stageObserver = new ResizeObserver(reclamp)
      stageObserver.observe(stage)
    }
  })

  window.addEventListener('resize', reclamp)
  onScopeDispose(() => {
    window.removeEventListener('resize', reclamp)
    stageObserver?.disconnect()
  })

  let from: { px: number; py: number; x: number; y: number } | null = null

  function onHandleDown(e: PointerEvent) {
    const node = el.value
    const stage = node?.offsetParent as HTMLElement | null
    if (!node || !stage || e.button !== 0) return
    // 아직 옮긴 적 없으면 지금 보이는 자리에서 시작한다(CSS의 top/right로 놓인 자리).
    // 이걸 안 하면 잡는 순간 패널이 0,0으로 튄다.
    const box = node.getBoundingClientRect()
    const base = stage.getBoundingClientRect()
    from = {
      px: e.clientX,
      py: e.clientY,
      x: pos.value?.x ?? box.left - base.left,
      y: pos.value?.y ?? box.top - base.top,
    }
    dragging.value = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function onHandleMove(e: PointerEvent) {
    if (!dragging.value || !from) return
    pos.value = clamp({ x: from.x + (e.clientX - from.px), y: from.y + (e.clientY - from.py) })
  }

  function onHandleUp() {
    if (!dragging.value) return
    dragging.value = false
    from = null
    save(storageKey, pos.value)
  }

  /** 기본 자리로 되돌린다(손잡이 더블클릭). */
  function reset() {
    pos.value = null
    save(storageKey, null)
  }

  const style = computed<CSSProperties | undefined>(() =>
    pos.value ? { left: `${pos.value.x}px`, top: `${pos.value.y}px`, right: 'auto' } : undefined,
  )

  return { el, pos, dragging, style, onHandleDown, onHandleMove, onHandleUp, reset }
}
