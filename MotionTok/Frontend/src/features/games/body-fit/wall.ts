/**
 * 게임④ 벽 메시 + 텍스처 빌더 — 벽 랩(/dev/wall-lab)과 본 게임 화면이 공유한다.
 *
 * 구멍은 CSG가 아니라 alphaMap(기획 §8): 실루엣 래스터라이저가 그린 캔버스를
 * 그대로 텍스처로 쓰고, 판정 마스크도 같은 함수로 그리므로 보이는 구멍과
 * 판정되는 구멍이 정의상 일치한다. 벽 평면은 실루엣 뷰포트(VIEW)와 같은
 * 정사각형이라 구멍과 아바타가 정확히 정렬된다.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { BodyFitConfig } from './config'
import type { SolvedSkeleton } from './skeleton'
import { VIEW, VIEW_SIZE, drawSilhouette } from './silhouette'
import { disposeObject } from './stage'

const TEX_SIZE = 512

// 석판 albedo — 모듈 로드 시 한 번만 받아서 매 라운드 build()가 재사용한다
const stoneImg = new Image()
stoneImg.src = '/assets/games/body-fit/wall-stone.jpg'

export interface WallHandle {
  mesh: THREE.Mesh
  /** 출제 포즈 → 벽 텍스처 재생성. 구멍(마진 M)·발광 림·목표 유령 실루엣 */
  build(setter: SolvedSkeleton, margin: number, cfg: BodyFitConfig): void
  dispose(): void
}

export function createWall(cfg: BodyFitConfig): WallHandle {
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

  // 석판 프레임(wall-slab.glb) — 구멍 평면 둘레 4개 바. mesh의 자식이라
  // 접근 z 애니메이션·visible 토글을 그대로 상속하고, 평면(정사각 뷰포트)
  // 바깥에만 놓여 구멍·아바타 정렬에는 관여하지 않는다.
  new GLTFLoader().load('/assets/games/body-fit/wall-slab.glb', (gltf) => {
    const src = gltf.scene
    const box = new THREE.Box3().setFromObject(src)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const { barWidth: w, depth, inset } = cfg.stage.slabFrame
    const half = VIEW_SIZE / 2 + w / 2 - inset // 바 중심까지 거리 — inset만큼 평면 위로 겹쳐 깨진 모서리 틈을 가린다
    const long = VIEW_SIZE + 2 * w // 세로 바가 네 모서리까지 덮는다
    const bars: [number, number, number, number][] = [
      [-half, 0, w, long],
      [half, 0, w, long],
      [0, half, VIEW_SIZE, w],
      [0, -half, VIEW_SIZE, w],
    ]
    for (const [cx, cy, sx, sy] of bars) {
      const bar = src.clone()
      const kx = sx / size.x
      const ky = sy / size.y
      const kz = depth / size.z
      bar.scale.set(kx, ky, kz)
      bar.position.set(cx - center.x * kx, cy - center.y * ky, -center.z * kz)
      mesh.add(bar)
    }
  })

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

    // 어두운 석판 — wall-stone.jpg albedo (컨셉 키비주얼의 인디고 화강암)
    const m = mapCanvas.getContext('2d')!
    if (stoneImg.complete && stoneImg.naturalWidth) {
      m.drawImage(stoneImg, 0, 0, TEX_SIZE, TEX_SIZE)
      // albedo가 unlit 재질에 그대로 얹히면 밝은 라벤더로 떠서, 어둡게 눌러
      // 석판 프레임(GLB, 어두운 씬 조명)과 한 덩어리 톤으로 맞춘다 (2026-07-28 실기)
      m.globalCompositeOperation = 'multiply'
      m.fillStyle = '#57527f'
      m.fillRect(0, 0, TEX_SIZE, TEX_SIZE)
      m.globalCompositeOperation = 'source-over'
    } else {
      // 이미지가 아직이면 기존 그라데이션으로 폴백 — 첫 라운드는 캡처 3초 뒤라 사실상 안 탄다
      const grad = m.createLinearGradient(0, 0, 0, TEX_SIZE)
      grad.addColorStop(0, '#2e2a58')
      grad.addColorStop(0.5, '#242047')
      grad.addColorStop(1, '#181532')
      m.fillStyle = grad
      m.fillRect(0, 0, TEX_SIZE, TEX_SIZE)
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
      disposeObject(mesh) // 평면 + 석판 프레임 바 전부
    },
  }
}
