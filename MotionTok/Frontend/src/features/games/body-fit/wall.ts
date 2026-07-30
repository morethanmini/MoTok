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
import { STAGE_DROP, STAGE_SCALE, type SolvedSkeleton } from './skeleton'
import { VIEW, VIEW_SIZE, drawSilhouette } from './silhouette'
import { disposeObject } from './stage'

const TEX_SIZE = 512

// 납작한 룩(2026-07-28): 화강암 albedo(wall-stone.jpg) 대신 단색 석판을 쓴다.
// 에셋 파일은 남겨둔다 — 입체 룩으로 되돌리면 다시 필요하다.
const WALL_FILL = '#4a4038'
const WALL_EDGE = '#7d7059'
const HOLE_OUTLINE_COLOR = '#ffd45d'
const HOLE_OUTLINE_GLOW = '#ffbd3e'
const HOLE_OUTLINE_WIDTH_PX = 1
const HOLE_OUTLINE_SAMPLES = 20

/**
 * 보이는 벽 크기 ÷ 판정 뷰포트 크기.
 *
 * 지금까지 벽 평면이 VIEW_SIZE 정사각형이라 "아바타 = 벽"이었고, 그래서 아바타가
 * 항상 화면을 꽉 채웠다. 판정 마스크는 judge.ts가 자기 캔버스에 따로 그리므로
 * (judge.ts §maskOf) 벽을 키워도 판정은 그대로다 — 순수 시각 값이다.
 * 구멍은 여전히 정확히 VIEW_SIZE 영역에 그려서 3D 아바타와 정렬을 유지한다.
 */
const WALL_W_MUL = 2.2
const WALL_H_MUL = 1.35

/**
 * 디졸브 알갱이 크기 조절 — 노이즈를 벽 UV에 몇 번 반복할지.
 * 값이 크면 곱게(모래), 작으면 굵게(자갈) 부서진다. 화면 크기·기기에 따라 체감이 달라서
 * 눈으로 맞추는 노브다. 64² 노이즈 × 3배 → 벽 폭에 192알, 가까이서 알갱이 하나가 4~5px쯤 된다.
 */
const DISSOLVE_TILES = 3
const DISSOLVE_NOISE_SIZE = 64

/**
 * 디졸브용 노이즈 — 벽 전체가 하나를 공유한다.
 *
 * <p>핸들마다 만들 이유가 없다. 동시에 삭는 벽이 겹치는 일이 거의 없어 같은 패턴이라는 게
 * 눈에 띄지 않고, 벽 4장이 각자 텍스처를 들면 그만큼 메모리만 쓴다(연속 모드가 이미 벽마다
 * 캔버스 2장 + 텍스처 2장을 물고 있다).</p>
 *
 * <p>NearestFilter여야 한다 — 선형 보간을 걸면 알갱이 경계가 뭉개져 가루가 아니라
 * 얼룩이 번지는 그림이 된다.</p>
 */
let dissolveNoise: THREE.DataTexture | null = null
function noiseTexture(): THREE.DataTexture {
  if (dissolveNoise) return dissolveNoise
  const n = DISSOLVE_NOISE_SIZE
  const data = new Uint8Array(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const v = Math.floor(Math.random() * 256)
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, n, n)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = tex.minFilter = THREE.NearestFilter
  tex.needsUpdate = true
  dissolveNoise = tex
  return tex
}

export interface WallHandle {
  mesh: THREE.Mesh
  /** 출제 포즈 → 벽 텍스처 재생성. 구멍(마진 M)·발광 림·목표 유령 실루엣 */
  build(setter: SolvedSkeleton, margin: number, cfg: BodyFitConfig): void
  /**
   * 통과한 벽이 삭아 없어지는 정도 — 0이면 온전, 1이면 완전히 사라진다.
   *
   * <p>연속 모드에서 통과한 벽이 카메라로 다가오며 화면을 덮어 다음 벽 구멍을 미리 읽을 수 없게
   * 만들었다(실기 피드백). 그냥 투명해지는 대신 노이즈 임계값으로 픽셀을 갉아내 가루가 되며
   * 증발하는 모양으로 지운다. 핸들마다 머티리얼이 따로라 다른 벽에 영향이 없다.</p>
   */
  setDissolve(progress: number): void
  dispose(): void
}

// 인자 없음 — 석판 프레임 GLB를 걷어내면서 cfg.stage.slabFrame이 유일한 용처였던
// 생성자 인자가 필요 없어졌다. 라운드마다 바뀌는 값은 build(setter, margin, cfg)가 받는다.
export function createWall(): WallHandle {
  // 캔버스는 벽 평면과 같은 비율 — 정사각 텍스처를 가로로 늘리면 구멍이 찌그러진다
  const CW = Math.round(TEX_SIZE * WALL_W_MUL)
  const CH = Math.round(TEX_SIZE * WALL_H_MUL)
  const mapCanvas = document.createElement('canvas')
  mapCanvas.width = CW
  mapCanvas.height = CH
  const alphaCanvas = document.createElement('canvas')
  alphaCanvas.width = CW
  alphaCanvas.height = CH
  const outlineCanvas = document.createElement('canvas')
  outlineCanvas.width = CW
  outlineCanvas.height = CH
  const map = new THREE.CanvasTexture(mapCanvas)
  // 캔버스 텍스처는 기본이 선형 색공간이라 sRGB 출력에서 밝게 뜬다 — 예전 주석의
  // "albedo가 밝은 라벤더로 뜬다"가 이 증상이었고 어두운 multiply로 덮고 있었다.
  // 톤매핑(ACES)까지 걷어내자 그대로 드러나서, 여기서 제대로 잡는다.
  map.colorSpace = THREE.SRGBColorSpace
  // alphaMap은 색이 아니라 데이터라 선형 유지가 맞다
  const alpha = new THREE.CanvasTexture(alphaCanvas)

  // transparent 유지 — 유령 실루엣(#555 알파)이 반투명으로 보여야 목표 가이드가 된다
  const material = new THREE.MeshBasicMaterial({
    map,
    alphaMap: alpha,
    transparent: true,
    side: THREE.DoubleSide,
  })

  /**
   * 디졸브 진행도. 셰이더 유니폼과 같은 객체를 공유하므로 값만 바꾸면 다음 프레임에 반영된다
   * (재컴파일 없음 — 분기는 셰이더에 항상 들어 있다).
   */
  const dissolve = { value: 0 }
  // 기본 재질(MeshBasicMaterial)에 알파 컷 세 줄만 얹는다. 커스텀 ShaderMaterial로 갈아타면
  // 납작한 룩·알파맵·톤매핑 설정을 전부 손으로 재현해야 해서 얻는 것보다 잃는 게 많다.
  // vMapUv·alphamap_fragment는 three 0.185의 실제 청크 이름이다(버전 올릴 때 확인 필요).
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = dissolve
    shader.uniforms.uNoise = { value: noiseTexture() }
    shader.uniforms.uTiles = { value: DISSOLVE_TILES }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uDissolve;
         uniform float uTiles;
         uniform sampler2D uNoise;
         void main() {`,
      )
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
         if ( uDissolve > 0.0 ) {
           float grain = texture2D( uNoise, vMapUv * uTiles ).r;
           // 임계값보다 옅은 알갱이는 이미 날아갔다
           if ( grain <= uDissolve ) discard;
           // 곧 날아갈 알갱이는 미리 옅어진다 — 경계가 칼로 자른 듯 하지 않고 삭아 보인다
           diffuseColor.a *= smoothstep( uDissolve, uDissolve + 0.18, grain );
         }`,
      )
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(VIEW_SIZE * WALL_W_MUL, VIEW_SIZE * WALL_H_MUL),
    material,
  )
  // 벽 평면 자체는 제자리 — 아바타·구멍만 STAGE_DROP만큼 내려간다(구멍은 텍스처에서 이동).
  // 뷰포트 중심 높이에는 축소분만 반영한다.
  mesh.position.set(0, ((VIEW.top + VIEW.bottom) / 2) * STAGE_SCALE, 0)
  mesh.visible = false

  // 석판 프레임(wall-slab.glb)은 쓰지 않는다(2026-07-28) — 울퉁불퉁한 입체 바 4개가
  // 납작한 룩과 안 맞았다. 테두리는 텍스처에 얇은 선 하나로 그린다(build 참고).
  // 에셋과 cfg.stage.slabFrame 설정은 남겨둠 — 입체 룩으로 되돌리면 다시 쓴다.

  /**
   * 판정 뷰포트(VIEW_SIZE)를 캔버스 한가운데 TEX_SIZE 정사각 영역에 그린다.
   * drawSilhouette는 `ctx.canvas.width / VIEW_SIZE`로 배율을 잡으므로, 넓어진
   * 캔버스에서는 1/WALL_W_MUL로 되돌려야 원래 월드 크기가 유지된다 —
   * 이래야 구멍이 3D 아바타와 계속 정렬된다.
   */
  function inViewport(ctx: CanvasRenderingContext2D, draw: () => void) {
    // drawSilhouette는 VIEW_SIZE를 canvas.width(=CW) 전체에 매핑하고, 뷰포트 중심을
    // (CW/2, CW/2)에 놓는다(가로세로 모두 width 기준). 그 중심을 캔버스 한가운데로
    // 옮기면서 k배 줄이면, 구멍이 3D 아바타와 같은 월드 크기·위치가 된다.
    const k = STAGE_SCALE / WALL_W_MUL
    // STAGE_DROP(월드, 음수=아래)을 텍셀로 환산. 벽 평면은 VIEW_SIZE*WALL_H_MUL 월드가
    // CH 텍셀이라 텍셀/월드 = TEX_SIZE/VIEW_SIZE. 캔버스 y는 아래가 +라 부호를 뒤집는다.
    // 스케일 바깥에서 더해야 순수 픽셀 이동이 된다.
    const dropPx = -STAGE_DROP * (TEX_SIZE / VIEW_SIZE)
    ctx.save()
    ctx.translate(CW / 2, CH / 2 + dropPx)
    ctx.scale(k, k)
    ctx.translate(-CW / 2, -CW / 2)
    draw()
    ctx.restore()
  }

  function build(setter: SolvedSkeleton, margin: number, cfg: BodyFitConfig) {
    const a = alphaCanvas.getContext('2d')!
    a.fillStyle = '#fff' // alphaMap: 흰색 = 불투명 벽
    a.fillRect(0, 0, CW, CH)
    inViewport(a, () => {
      a.fillStyle = '#000' // 구멍 = 투명
      a.strokeStyle = '#000'
      drawSilhouette(a, setter, cfg, margin)
      a.fillStyle = '#555' // 옅은 원본 윤곽 — 반투명 유령 (여기 맞추면 PERFECT)
      a.strokeStyle = '#555'
      drawSilhouette(a, setter, cfg, 0)
    })

    // The target shape is a hole, not a semi-transparent person illustration.
    inViewport(a, () => {
      a.fillStyle = '#000'
      a.strokeStyle = '#000'
      drawSilhouette(a, setter, cfg, 0)
    })

    const o = outlineCanvas.getContext('2d')!
    o.clearRect(0, 0, CW, CH)
    inViewport(o, () => {
      o.fillStyle = HOLE_OUTLINE_COLOR
      o.strokeStyle = HOLE_OUTLINE_COLOR
      drawSilhouette(o, setter, cfg, margin)
    })

    // 단색 석판 — 질감 없이 평면 한 색 + 얇은 테두리 한 줄(GLB 프레임 대체)
    const m = mapCanvas.getContext('2d')!
    m.fillStyle = WALL_FILL
    m.fillRect(0, 0, CW, CH)
    m.strokeStyle = WALL_EDGE
    m.lineWidth = 6
    m.strokeRect(9, 9, CW - 18, CH - 18)

    inViewport(m, () => {
      // 림 글로우 — 캔버스 shadowBlur 페인트 발광. alpha가 마진 안쪽을 도려내 링만 남는다
      m.shadowColor = HOLE_OUTLINE_GLOW
      m.shadowBlur = 4
      // outlineCanvas is already in texture-pixel coordinates.
      m.save()
      m.setTransform(1, 0, 0, 1, 0, 0)
      for (let i = 0; i < HOLE_OUTLINE_SAMPLES; i++) {
        const angle = (Math.PI * 2 * i) / HOLE_OUTLINE_SAMPLES
        const x = Math.cos(angle) * HOLE_OUTLINE_WIDTH_PX
        const y = Math.sin(angle) * HOLE_OUTLINE_WIDTH_PX
        m.drawImage(outlineCanvas, x, y)
      }
      m.restore()
      m.shadowBlur = 0
      // 유령(목표) 실루엣은 아바타보다 어둡게 — 같은 사암 톤이면 납작한 화면에서
      // 아바타와 겹쳤을 때 서로 안 갈린다
    })

    map.needsUpdate = true
    alpha.needsUpdate = true
  }

  return {
    mesh,
    build,
    setDissolve(progress: number) {
      // 1에서 남는 알갱이가 없어야 한다 — grain <= uDissolve 비교라 임계값이 1에 닿으면 전부 버려진다
      dissolve.value = Math.min(1, Math.max(0, progress))
    },
    dispose() {
      map.dispose()
      alpha.dispose()
      disposeObject(mesh) // 평면 + 석판 프레임 바 전부
    },
  }
}
