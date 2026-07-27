/**
 * 게임④ 공용 3D 무대 (기획 §8 — 어두운 무대, 벽과 아바타만 밝다).
 *
 * 컨셉 목업(box/)의 룩을 실시간으로 근사하는 두 층:
 *  1) 씬 — IBL(RoomEnvironment) + 스포트라이트 + 포디움 + 림 라이트 + 안개
 *  2) 후처리 — SSAO(접촉 음영) → 블룸(발광 림·빨강 세그먼트) → 비네트 → 톤맵.
 *     "직접 그린 CSS vs 부트스트랩" 격차의 대부분이 이 마감 공정이다.
 * 전부 three 내장 애드온 — 신규 의존성 없음. 소비자는 stage.render()/setSize()만 쓴다.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

export interface Stage {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** 후처리 체인을 거쳐 한 프레임 그린다 — renderer.render 대신 이걸 쓴다 */
  render(): void
  setSize(width: number, height: number): void
  /** 아바타 발바닥 높이가 바뀌면(팔다리 배율 슬라이더) 포디움을 따라 옮긴다 */
  setFloorY(y: number): void
  dispose(): void
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  const pixelRatio = Math.min(window.devicePixelRatio, 2)
  renderer.setPixelRatio(pixelRatio)
  renderer.shadowMap.enabled = true
  // VSM + radius = 소프트 섀도 — 딱딱한 그림자 경계가 "생짜 3D" 느낌의 주범
  renderer.shadowMap.type = THREE.VSMShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0d0c24) // --bg-sunken
  scene.fog = new THREE.Fog(0x0d0c24, 9, 18)

  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment()).texture
  scene.environmentIntensity = 0.35
  pmrem.dispose()

  // 8.2로 물러서면 아바타가 화면을 꽉 채우지 않고 벽 전체(구멍 + 주변 석판)가
  // 같이 들어온다 — 원래 4.8은 아바타가 뷰포트를 거의 다 가려 벽이 안 보였다(실기 피드백).
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50)
  camera.position.set(0, 0.3, 8.2)
  camera.lookAt(0, -0.5, 0)

  scene.add(new THREE.HemisphereLight(0xbdc7ff, 0x14122e, 0.6))

  const sun = new THREE.DirectionalLight(0xffffff, 1.3)
  sun.position.set(2.5, 4, 3)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = -3
  sun.shadow.camera.right = 3
  sun.shadow.camera.top = 3
  sun.shadow.camera.bottom = -3
  sun.shadow.camera.near = 0.5
  sun.shadow.camera.far = 12
  sun.shadow.radius = 6
  sun.shadow.bias = -0.0004
  scene.add(sun)

  // 림 라이트 — 뒤쪽 역광이 캡슐 윤곽을 배경에서 띄운다
  const rim = new THREE.DirectionalLight(0x7f9dff, 1.6)
  rim.position.set(-2, 2.5, -3.5)
  scene.add(rim)

  // 상단 스포트라이트 — 무대 중앙에 빛 웅덩이 (목업의 극장 조명)
  const spot = new THREE.SpotLight(0xffffff, 26, 0, 0.55, 0.7)
  spot.position.set(0, 5, 2)
  spot.target.position.set(0, -0.8, 0)
  scene.add(spot, spot.target)

  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(1.35, 1.55, 0.22, 48),
    new THREE.MeshStandardMaterial({ color: 0x191734, roughness: 0.9, metalness: 0 }),
  )
  podium.receiveShadow = true
  scene.add(podium)

  const setFloorY = (y: number) => {
    podium.position.y = y - 0.11 // 윗면이 발바닥에 오도록
  }
  setFloorY(-2.3)

  // ── 후처리 체인 ──
  const composer = new EffectComposer(renderer)
  composer.setPixelRatio(pixelRatio)
  composer.addPass(new RenderPass(scene, camera))

  // 접촉 음영 — 관절 틈·포디움 접지에 어두운 밀착감 (씬 스케일에 맞춰 좁게)
  const ssao = new SSAOPass(scene, camera, 1, 1)
  ssao.kernelRadius = 0.35
  ssao.minDistance = 0.0005
  ssao.maxDistance = 0.1
  composer.addPass(ssao)

  // 블룸은 쓰지 않는다 — 순백 아바타가 통째로 임계를 넘어 후광이 생긴다(2026-07-27 실기).
  // 구멍 림 글로우는 벽 텍스처에 canvas shadowBlur로 그려 넣는다 (WallLabView).

  // 비네트 — 가장자리를 살짝 눌러 무대 조명 구도를 강조
  const vignette = new ShaderPass(VignetteShader)
  vignette.uniforms.offset!.value = 0.95
  vignette.uniforms.darkness!.value = 1.0
  composer.addPass(vignette)

  composer.addPass(new OutputPass())

  return {
    renderer,
    scene,
    camera,
    render() {
      composer.render()
    },
    setSize(width: number, height: number) {
      renderer.setSize(width, height, false)
      composer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    },
    setFloorY,
    dispose() {
      composer.dispose()
      podium.geometry.dispose()
      ;(podium.material as THREE.Material).dispose()
      scene.environment?.dispose()
      renderer.dispose()
    },
  }
}
