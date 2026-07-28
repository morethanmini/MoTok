/**
 * LiveKit(SFU) 방 접속 컴포저블.
 *
 * 흐름: sfuApi.videoToken(roomId)로 접속 정보를 받아 Room.connect → 로컬 카메라/마이크 발행 →
 * 원격 참가자 트랙을 구독해 reactive `participants`로 노출한다. 언마운트/재접속 시 자동 정리.
 *
 * 카메라는 뷰가 가진 로컬 캡처 트랙(getUserMedia)의 복제본을 발행한다 — "카메라 끄기"는
 * 발행 트랙 mute + 업스트림 중단이라 다른 사람에게만 꺼져 보이고, 원본 캡처는 계속 살아 있어
 * 프리뷰·모션 인식 게임 입력이 유지된다(꺼도 게임 참여 가능).
 *
 * 뷰에서의 사용 (예):
 *   const lk = useLiveKitRoom()
 *   await lk.connect(roomId)
 *   // 템플릿에서 participants를 순회하며 각 타일에 트랙을 붙인다:
 *   //   watchEffect(() => { if (p.videoTrack && el) p.videoTrack.attach(el) })
 *
 * 주의: LiveKit 트랙 객체는 Vue 프록시로 감싸면 내부 동작이 깨질 수 있어 shallowRef로만 보관한다.
 */
import { onScopeDispose, readonly, ref, shallowRef } from 'vue'
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type LocalVideoTrack,
  type Participant,
  type Track as LkTrack,
} from 'livekit-client'
import { sfuApi } from '@/api'

/** 화면 타일 하나에 대응하는 참가자 뷰모델 (LiveKit 원본을 UI용으로 평탄화) */
export interface ParticipantView {
  identity: string
  name: string
  isLocal: boolean
  isSpeaking: boolean
  /** 카메라 켜짐(발행 중 & 음소거 아님) */
  cameraOn: boolean
  /** 마이크 켜짐(발행 중 & 음소거 아님) */
  micOn: boolean
  videoTrack: LkTrack | null
  audioTrack: LkTrack | null
  /** 게임 화면 송출 트랙(화면공유 소스) — 송출 중이 아니거나 가려져 있으면 null */
  gameTrack: LkTrack | null
}

export function useLiveKitRoom() {
  let room: Room | null = null

  const state = ref<ConnectionState>(ConnectionState.Disconnected)
  const participants = shallowRef<ParticipantView[]>([])
  const cameraEnabled = ref(false)
  const microphoneEnabled = ref(false)
  const error = ref<string | null>(null)

  function toView(p: Participant, isLocal: boolean): ParticipantView {
    // 게임 화면(화면공유 소스) 트랙이 추가되면서 kind만으로는 카메라를 못 가리므로 source로 찾는다.
    const videoPub = p.getTrackPublication(Track.Source.Camera)
    const audioPub = p.getTrackPublication(Track.Source.Microphone)
    // 화면공유 발행이 여러 개일 수 있다(비정상 종료가 남긴 잔여 발행 등). 첫 발행이 죽은
    // 것이면 게임 중인데도 타일이 카메라로 남으므로, 살아 있는(가려지지 않은) 것을 고른다.
    let gamePub: ReturnType<typeof p.getTrackPublication> | undefined
    for (const pub of p.trackPublications.values()) {
      if (pub.source !== Track.Source.ScreenShare) continue
      gamePub = pub
      if (!pub.isMuted && pub.track) break
    }
    return {
      identity: p.identity,
      name: p.name || p.identity,
      isLocal,
      isSpeaking: p.isSpeaking,
      cameraOn: !!videoPub && !videoPub.isMuted && !!videoPub.track,
      micOn: !!audioPub && !audioPub.isMuted,
      videoTrack: videoPub?.track ?? null,
      audioTrack: audioPub?.track ?? null,
      gameTrack: gamePub && !gamePub.isMuted ? (gamePub.track ?? null) : null,
    }
  }

  /** room의 현재 상태로 participants/토글 플래그를 다시 만든다(이벤트마다 호출). */
  function refresh() {
    if (!room) {
      participants.value = []
      return
    }
    const local = room.localParticipant
    const views = [toView(local, true)]
    for (const remote of room.remoteParticipants.values()) {
      views.push(toView(remote, false))
    }
    participants.value = views
    cameraEnabled.value = local.isCameraEnabled
    microphoneEnabled.value = local.isMicrophoneEnabled
  }

  function bindEvents(r: Room) {
    r.on(RoomEvent.ConnectionStateChanged, (s) => (state.value = s))
      .on(RoomEvent.TrackSubscribed, refresh)
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.Disconnected, () => {
        participants.value = []
        cameraEnabled.value = false
        microphoneEnabled.value = false
      })
  }

  /** 방 접속: 토큰 발급 → connect → 카메라/마이크 발행. 실패 시 error 세팅 후 정리. */
  async function connect(
    roomId: string,
    opts: { cameraTrack?: MediaStreamTrack | null; microphone?: boolean } = {},
  ): Promise<boolean> {
    const { cameraTrack = null, microphone = true } = opts
    await disconnect()
    error.value = null
    try {
      const { url, token } = await sfuApi.videoToken(roomId)
      const r = new Room({ adaptiveStream: true, dynacast: true })
      room = r
      bindEvents(r)
      await r.connect(url, token)
      // 미디어 발행은 best-effort — 권한 거부/장치 없음이 방 연결 자체를 끊지 않도록 개별 처리.
      if (cameraTrack && !(await publishCameraTrack(cameraTrack))) {
        error.value = '카메라를 켤 수 없어요(권한/장치 확인)'
      }
      if (microphone) {
        try {
          await r.localParticipant.setMicrophoneEnabled(true)
        } catch {
          /* 마이크 없이도 계속 진행 */
        }
      }
      refresh()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : '방 연결에 실패했어요'
      await disconnect()
      return false
    }
  }

  async function disconnect() {
    if (!room) return
    const r = room
    room = null
    // 발행 중이던 카메라 복제본·게임 화면을 정리한 후 끊는다
    await unpublishCameraTrack()
    await unpublishGameScreen()
    r.removeAllListeners()
    await r.disconnect()
    participants.value = []
    state.value = ConnectionState.Disconnected
    cameraEnabled.value = false
    microphoneEnabled.value = false
  }

  // ── 카메라 발행 — 뷰의 로컬 캡처 트랙 복제본을 발행한다. "끄기"는 발행 mute라서 다른
  // 사람에게만 꺼져 보이고, 원본 캡처(프리뷰·모션 인식 게임 입력)는 계속 살아 있다. ──
  let cameraTrackPub: LocalVideoTrack | null = null

  /** 로컬 캡처 트랙의 복제본을 카메라 소스로 발행한다(이미 발행 중이면 no-op). */
  async function publishCameraTrack(source: MediaStreamTrack): Promise<boolean> {
    if (cameraTrackPub) return true
    if (!room) return false
    const clone = source.clone()
    try {
      const pub = await room.localParticipant.publishTrack(clone, {
        source: Track.Source.Camera,
      })
      cameraTrackPub = pub.videoTrack ?? null
      refresh()
      return !!cameraTrackPub
    } catch {
      clone.stop()
      return false
    }
  }

  /** 카메라 발행 정리 — 복제본만 멈추고 원본 캡처는 건드리지 않는다. */
  async function unpublishCameraTrack() {
    if (!cameraTrackPub) return
    const track = cameraTrackPub
    cameraTrackPub = null
    try {
      await room?.localParticipant.unpublishTrack(track, true)
    } catch {
      // 이미 연결이 끊긴 경우 — 복제본만 정리하면 된다
    }
    track.mediaStreamTrack.stop()
  }

  // ── 게임 화면 송출 — 게임 캔버스를 화면공유 소스의 추가 트랙으로 발행한다(카메라와 동시 송출) ──
  // 수신 측은 타일마다 게임 화면 ↔ 카메라를 골라 보고(ParticipantTile 토글), 표시되지 않는 쪽은
  // adaptiveStream(수신)·dynacast(송신)가 자동으로 쉬게 하므로 부하는 실제로 보는 만큼만 든다.
  let gameScreenTrack: LocalVideoTrack | null = null
  let gameScreenPublishing: Promise<boolean> | null = null

  /** 게임 캔버스 송출 시작(이미 송출 중이면 no-op). 미연결·캡처 실패면 false. */
  async function publishGameScreen(canvas: HTMLCanvasElement): Promise<boolean> {
    if (gameScreenTrack) return true
    // 발행 협상이 끝나기 전에 다시 불리면(호출측 watch 재발화) 진행 중인 발행을 같이 기다린다.
    // 없으면 화면공유 트랙이 두 개 발행되고, 종료 시 하나만 내려가 상대에게 멈춘 화면이 남는다.
    if (gameScreenPublishing) return gameScreenPublishing
    const r = room
    if (!r) return false
    gameScreenPublishing = (async () => {
      const track = canvas.captureStream().getVideoTracks()[0]
      if (!track) return false
      try {
        const pub = await r.localParticipant.publishTrack(track, {
          source: Track.Source.ScreenShare,
          name: 'game-screen',
        })
        gameScreenTrack = pub.videoTrack ?? null
        return !!gameScreenTrack
      } catch {
        track.stop()
        return false
      }
    })()
    try {
      return await gameScreenPublishing
    } finally {
      gameScreenPublishing = null
    }
  }

  /** 로컬 캡처가 멈춘 동안 게임 화면을 가린다 — 새 프레임이 없는 정지 화면을 흘려보내지 않기 위해. */
  async function setGameScreenMuted(muted: boolean) {
    if (!gameScreenTrack || gameScreenTrack.isMuted === muted) return
    if (muted) await gameScreenTrack.mute()
    else await gameScreenTrack.unmute()
  }

  /** 게임 화면 송출 종료 — 발행 해제 + 캡처 트랙 정리. 게임 종료·방 퇴장 시 호출. */
  async function unpublishGameScreen() {
    const track = gameScreenTrack
    gameScreenTrack = null
    if (track) {
      try {
        await room?.localParticipant.unpublishTrack(track, true)
      } catch {
        // 이미 연결이 끊긴 경우 — 발행 해제는 의미 없고 캡처만 정리하면 된다
      }
      track.mediaStreamTrack.stop()
    }
    // 추적 변수와 어긋나게 남은 화면공유 발행이 있으면 소스 기준으로 마저 내린다.
    // 이게 남으면 상대 타일에 멈춘 게임 화면이 카메라 대신 계속 보인다.
    for (const pub of room?.localParticipant.trackPublications.values() ?? []) {
      if (pub.source !== Track.Source.ScreenShare || !pub.track) continue
      const stale = pub.track
      try {
        await room?.localParticipant.unpublishTrack(stale, true)
      } catch {
        // 연결 끊김 — 캡처만 정리
      }
      stale.mediaStreamTrack.stop()
    }
  }

  /**
   * 카메라 표시 토글 — 발행 트랙만 mute(+업스트림 중단)/unmute한다. 발행 트랙은 원본 캡처의
   * 복제본이라 프리뷰·게임 입력은 영향 없다. 발행된 카메라가 없으면 false(호출 측에서
   * publishCameraTrack으로 발행).
   */
  async function toggleCamera(): Promise<boolean> {
    if (!cameraTrackPub) return false
    if (cameraTrackPub.isMuted) {
      await cameraTrackPub.resumeUpstream()
      await cameraTrackPub.unmute()
    } else {
      // mute만으로는 비활성(검은) 프레임이 계속 인코딩·전송되므로 업스트림 자체를 멈춘다
      await cameraTrackPub.mute()
      await cameraTrackPub.pauseUpstream()
    }
    refresh()
    return true
  }

  async function toggleMicrophone() {
    if (!room) return
    await room.localParticipant.setMicrophoneEnabled(!microphoneEnabled.value)
    refresh()
  }

  onScopeDispose(() => void disconnect())

  return {
    state: readonly(state),
    participants,
    cameraEnabled: readonly(cameraEnabled),
    microphoneEnabled: readonly(microphoneEnabled),
    error: readonly(error),
    connect,
    disconnect,
    publishCameraTrack,
    toggleCamera,
    toggleMicrophone,
    publishGameScreen,
    setGameScreenMuted,
    unpublishGameScreen,
  }
}
