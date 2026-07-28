/**
 * 게임④ 공용 무대 (기획 §8 — 어두운 무대, 벽과 아바타만 밝다).
 *
 * 납작한 실루엣 룩(2026-07-28 방향 전환). 지오메트리는 3D 그대로지만 재질은 전부
 * unlit(MeshBasicMaterial)이라 조명·그림자·IBL이 없다 — 색이 지정한 값 그대로 나온다.
 * 남은 후처리는 비네트 + 출력 패스뿐이고, 깊이감은 안개와 원근이 담당한다.
 *
 * 이전(입체 룩)에는 IBL(RoomEnvironment) + 스포트/림/디렉셔널 조명 + VSM 그림자 +
 * SSAO를 썼다. 되돌릴 일이 있으면 git 이력을 참고할 것.
 * 소비자는 stage.render()/setSize()만 쓴다.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { BodyFitConfig } from './config'
import { STAGE_DROP, STAGE_SCALE } from './skeleton'

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

/**
 * GLB 재질을 납작한 단색(unlit)으로 교체 — 조명 색은 알베도를 못 이긴다.
 * 석판 프레임이 따뜻한 조명 아래서도 파랗게 남았던 원인이 이것이라, 색 자체를 덮어써야 한다.
 * 무대(포디움)와 벽(석판 프레임)이 공유하므로 여기서 export 한다.
 */
export function flattenMaterials(root: THREE.Object3D, color: number) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const old = mesh.material as THREE.Material
    mesh.material = new THREE.MeshBasicMaterial({ color })
    old.dispose()
    mesh.castShadow = mesh.receiveShadow = false
  })
}

/** GLB 하위 메시 자원 해제 — geometry + material(+map) */
export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return
    const mesh = o as THREE.Mesh
    mesh.geometry.dispose()
    const mat = mesh.material as THREE.MeshStandardMaterial
    mat.map?.dispose()
    mat.dispose()
  })
}

export function createStage(canvas: HTMLCanvasElement, cfg: BodyFitConfig): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  const pixelRatio = Math.min(window.devicePixelRatio, 2)
  renderer.setPixelRatio(pixelRatio)
  // 납작한 룩(2026-07-28): 전 재질이 unlit이라 그림자·톤매핑이 할 일이 없다.
  // 끄면 색이 지정한 값 그대로 나오고(ACES가 밝은 색을 눌러 탁하게 만들던 것도 사라짐) 부하도 준다.
  renderer.shadowMap.enabled = false

  // 무대 전체를 따뜻한 석재 한 계열로 모은다(2026-07-28) — 이전엔 배경·안개가 차가운
  // 인디고(0x0d0c24)라 갈색 포디움·석판과 색이 따로 놀았다. HUD(석재 명판)와도 이어진다.
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1411)
  scene.fog = new THREE.Fog(0x1a1411, 9, 18)

  // 8.2로 물러서면 아바타가 화면을 꽉 채우지 않고 벽 전체(구멍 + 주변 석판)가
  // 같이 들어온다 — 원래 4.8은 아바타가 뷰포트를 거의 다 가려 벽이 안 보였다(실기 피드백).
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50)
  camera.position.set(0, 0.3, 8.2)
  camera.lookAt(0, -0.5, 0)

  // ── 조명: 아바타 전용 ──
  // 무대(벽·포디움)는 전부 MeshBasicMaterial이라 조명과 환경맵을 무시한다.
  // 그래서 아래 광원들은 사실상 아바타 하나만 비춘다 — "납작한 배경 + 입체 주인공".
  // ACES 톤매핑을 꺼둔 상태라 하이라이트가 롤오프 없이 그대로 클리핑된다.
  // 예전(톤매핑 있던 시절) 세기 그대로 쓰면 타므로 전반적으로 낮춰 잡았다.

  // 환경광 — 레퍼런스 마네킹의 부드러운 그늘. PBR 재질에만 적용되므로 무대엔 영향 없다
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment()).texture
  scene.environmentIntensity = 0.28
  pmrem.dispose()

  scene.add(new THREE.HemisphereLight(0xffe8c8, 0x2a1f18, 0.45))

  // 상단 키 라이트 — 무대 위에서 떨어지는 극장 조명. STAGE_DROP만큼 내려앉은
  // 아바타를 겨냥해야 얼굴·어깨에 빛이 얹힌다
  const key = new THREE.SpotLight(0xfff4e2, 10, 0, 0.6, 0.85)
  key.position.set(0.6, 5, 2.5)
  key.target.position.set(0, STAGE_DROP - 0.4, 0)
  scene.add(key, key.target)

  // 쿨 림 — 레퍼런스에서 마네킹 윤곽에 걸리던 푸른 테두리. 따뜻한 키와 대비되어
  // 실루엣이 배경에서 떨어져 나온다
  const rim = new THREE.DirectionalLight(0x8fb4ff, 0.9)
  rim.position.set(-2.2, 1.2, -3)
  scene.add(rim)

  // 2단 원형 석재 포디움(podium.glb) — 그룹 원점이 포디움 윗면이 되도록 자식을
  // 내려 앉혀서, setFloorY(y)가 "윗면 = 발바닥" 계약을 그대로 지킨다
  const podium = new THREE.Group()
  podium.scale.setScalar(STAGE_SCALE) // 아바타와 같은 배율 — 발바닥이 윗면에 계속 맞는다
  scene.add(podium)

  // 가짜 접지 그림자 — 포디움이 unlit이라 진짜 그림자를 못 받는다. 어두운 원반 하나로
  // 아바타가 공중에 뜬 느낌만 없앤다. 포디움 자식이라 setFloorY를 그대로 따라간다.
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(cfg.stage.podium.diameter * 0.3, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }),
  )
  contact.rotation.x = -Math.PI / 2
  contact.position.y = 0.01 // 포디움 윗면 살짝 위 — z-fighting 방지
  podium.add(contact)
  new GLTFLoader().load('/assets/games/body-fit/podium.glb', (gltf) => {
    const model = gltf.scene
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const { diameter, height } = cfg.stage.podium
    const sXZ = diameter / Math.max(size.x, size.z)
    const sY = height / size.y
    model.scale.set(sXZ, sY, sXZ)
    model.position.set(-center.x * sXZ, -box.max.y * sY, -center.z * sXZ)
    flattenMaterials(model, 0x5a4d3d)
    podium.add(model)
  })

  const setFloorY = (y: number) => {
    podium.position.y = y
  }
  setFloorY(-2.3)

  // ── 후처리 체인 ──
  const composer = new EffectComposer(renderer)
  composer.setPixelRatio(pixelRatio)
  composer.addPass(new RenderPass(scene, camera))

  // SSAO 제거(2026-07-28) — 접촉 음영은 입체 셰이딩을 전제하는 효과라, 납작한 룩에서는
  // 단색 면에 회색 얼룩만 남긴다. 빼면서 후처리 비용도 같이 사라진다.

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
      disposeObject(podium)
      scene.environment?.dispose()
      renderer.dispose()
    },
  }
}
