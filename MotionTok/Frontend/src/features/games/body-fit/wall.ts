/**
 * 게임④ 벽 메시 + 텍스처 빌더 — 벽 랩(/dev/wall-lab)과 본 게임 화면이 공유한다.
 *
 * 구멍은 CSG가 아니라 alphaMap(기획 §8): 실루엣 래스터라이저가 그린 캔버스를
 * 그대로 텍스처로 쓰고, 판정 마스크도 같은 함수로 그리므로 보이는 구멍과
 * 판정되는 구멍이 정의상 일치한다. 벽 평면은 실루엣 뷰포트(VIEW)와 같은
 * 정사각형이라 구멍과 아바타가 정확히 정렬된다.
 */
import * as THREE from 'three'
import type { BodyFitConfig } from './config'
import type { SolvedSkeleton } from './skeleton'
import { VIEW, VIEW_SIZE, drawSilhouette } from './silhouette'

const TEX_SIZE = 512

export interface WallHandle {
  mesh: THREE.Mesh
  /** 출제 포즈 → 벽 텍스처 재생성. 구멍(마진 M)·발광 림·목표 유령 실루엣 */
  build(setter: SolvedSkeleton, margin: number, cfg: BodyFitConfig): void
  dispose(): void
}

export function createWall(): WallHandle {
  const mapCanvas = document.createElement('canvas')
  mapCanvas.width = mapCanvas.height = TEX_SIZE
  const alphaCanvas = document.createElement('canvas')
  alphaCanvas.width = alphaCanvas.height = TEX_SIZE
  const map = new THREE.CanvasTexture(mapCanvas)
  const alpha = new THREE.CanvasTexture(alphaCanvas)

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(VIEW_SIZE, VIEW_SIZE),
    // transparent 유지 — 유령 실루엣(#555 알파)이 반투명으로 보여야 목표 가이드가 된다
    new THREE.MeshBasicMaterial({
      map,
      alphaMap: alpha,
      transparent: true,
      side: THREE.DoubleSide,
    }),
  )
  mesh.position.set(0, (VIEW.top + VIEW.bottom) / 2, 0)
  mesh.visible = false

  function build(setter: SolvedSkeleton, margin: number, cfg: BodyFitConfig) {
    const a = alphaCanvas.getContext('2d')!
    a.fillStyle = '#fff' // alphaMap: 흰색 = 불투명 벽
    a.fillRect(0, 0, TEX_SIZE, TEX_SIZE)
    a.fillStyle = '#000' // 구멍 = 투명
    a.strokeStyle = '#000'
    drawSilhouette(a, setter, cfg, margin)
    a.fillStyle = '#555' // 옅은 원본 윤곽 — 반투명 유령 (여기 맞추면 PERFECT)
    a.strokeStyle = '#555'
    drawSilhouette(a, setter, cfg, 0)

    // 어두운 석판 — 수직 그라데이션 + 노이즈 얼룩 (컨셉 목업의 돌벽 질감 근사)
    const m = mapCanvas.getContext('2d')!
    const grad = m.createLinearGradient(0, 0, 0, TEX_SIZE)
    grad.addColorStop(0, '#2e2a58')
    grad.addColorStop(0.5, '#242047')
    grad.addColorStop(1, '#181532')
    m.fillStyle = grad
    m.fillRect(0, 0, TEX_SIZE, TEX_SIZE)
    for (let i = 0; i < 700; i++) {
      m.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${(Math.random() * 0.04).toFixed(3)})`
      const w = 2 + Math.random() * 26
      m.fillRect(Math.random() * TEX_SIZE, Math.random() * TEX_SIZE, w, w * (0.2 + Math.random()))
    }
    // 림 글로우 — 캔버스 shadowBlur 페인트 발광. alpha가 마진 안쪽을 도려내 링만 남는다
    m.shadowColor = '#7fdcff'
    m.shadowBlur = 18
    m.fillStyle = '#b7f1ff'
    m.strokeStyle = '#b7f1ff'
    drawSilhouette(m, setter, cfg, margin + 0.05)
    m.shadowBlur = 0
    m.fillStyle = '#d6d4f6' // 유령(목표) 실루엣 색
    m.strokeStyle = '#d6d4f6'
    drawSilhouette(m, setter, cfg, 0)

    map.needsUpdate = true
    alpha.needsUpdate = true
  }

  return {
    mesh,
    build,
    dispose() {
      map.dispose()
      alpha.dispose()
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    },
  }
}
