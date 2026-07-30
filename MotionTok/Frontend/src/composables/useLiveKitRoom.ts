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

/** 데이터 채널 수신 콜백 — from은 보낸 참가자 identity(userId). */
export type DataListener = (payload: string, from: string, topic?: string) => void
/** 참가자 입·퇴장 콜백 */
export type PresenceListener = (identity: string) => void

export function useLiveKitRoom() {
  let room: Room | null = null

  const state = ref<ConnectionState>(ConnectionState.Disconnected)
  const participants = shallowRef<ParticipantView[]>([])
  const cameraEnabled = ref(false)
  const microphoneEnabled = ref(false)
  const error = ref<string | null>(null)
  /**
   * 참가자별 수신 볼륨(identity → 0~1). 내 브라우저에서 재생되는 소리만 줄이는 로컬 설정이라
   * 상대의 마이크 설정과 무관하고, 상대나 다른 참가자에게는 아무 영향이 없다.
   */
  const participantVolumes = ref<Record<string, number>>({})

  // 데이터 채널 — 문자열을 나르는 것까지만 하고, 내용의 뜻은 쓰는 쪽(useDecorSync)이 정한다.
  const dataListeners = new Set<DataListener>()
  const joinListeners = new Set<PresenceListener>()
  const leaveListeners = new Set<PresenceListener>()

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
      // 나갔다 다시 들어오면 LiveKit 참가자 객체가 새로 생겨 볼륨이 기본값으로 돌아간다 — 다시 걸어준다.
      // (마이크를 껐다 켜서 트랙만 다시 붙는 경우는 LiveKit이 알아서 유지한다)
      .on(RoomEvent.ParticipantConnected, (p) => {
        const volume = participantVolumes.value[p.identity]
        if (volume !== undefined) p.setVolume(volume)
        refresh()
        joinListeners.forEach((cb) => cb(p.identity))
      })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        refresh()
        leaveListeners.forEach((cb) => cb(p.identity))
      })
      // 보낸 사람을 모르는 데이터는 버린다 — 누구 타일에 반영할지 정할 수 없다(서버 발신도 여기로 온다).
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        const from = participant?.identity
        if (!from) return
        const text = new TextDecoder().decode(payload)
        dataListeners.forEach((cb) => cb(text, from, topic))
      })
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
    opts: {
      cameraTrack?: MediaStreamTrack | null
      microphone?: boolean
      /** 장치 설정에서 고른 마이크 — 카메라와 달리 마이크 트랙은 LiveKit이 직접 잡으므로 여기로 넘긴다. */
      microphoneDeviceId?: string | null
    } = {},
  ): Promise<boolean> {
    const { cameraTrack = null, microphone = true, microphoneDeviceId = null } = opts
    await disconnect()
    error.value = null
    try {
      const { url, token } = await sfuApi.videoToken(roomId)
      // audioCaptureDefaults로 넣어야 방 안에서 마이크를 껐다 켤 때 새로 잡는 트랙도 같은 장치를 쓴다.
      // exact로 못박는 이유 — 그냥 문자열이면 ideal(희망)이라 브라우저가 기본 마이크를 줘도 규칙
      // 위반이 아니어서, 장치 설정에서 고른 마이크가 조용히 기본 마이크로 바뀐다.
      const r = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: microphoneDeviceId ? { deviceId: { exact: microphoneDeviceId } } : undefined,
      })
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
          // 못박은 마이크가 지금은 없다(뽑았거나 브라우저를 다시 켜 id가 바뀌었다) — 지정을 풀고
          // 기본 마이크로 한 번 더. 소리 없이 방에 남는 것보다 낫다(방 안 토글도 같이 풀린다).
          r.options.audioCaptureDefaults = { ...r.options.audioCaptureDefaults, deviceId: undefined }
          try {
            await r.localParticipant.setMicrophoneEnabled(true)
          } catch {
            /* 마이크 없이도 계속 진행 */
          }
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

  /**
   * 참가자 한 명의 수신 볼륨을 조절한다(0~1). 상대가 마이크를 껐다 켜서 트랙이 새로 붙어도
   * LiveKit이 참가자에 기억해 둔 값을 다시 적용한다.
   */
  function setParticipantVolume(identity: string, volume: number) {
    participantVolumes.value = { ...participantVolumes.value, [identity]: volume }
    room?.remoteParticipants.get(identity)?.setVolume(volume)
  }

  // ── 데이터 채널 송·수신 ─────────────────────
  /** identities를 주면 그 사람들에게만, 없으면 방 전체. 각 구독 함수는 해지 함수를 돌려준다. */
  async function sendData(payload: string, identities?: string[], topic?: string) {
    if (!room) return
    try {
      await room.localParticipant.publishData(new TextEncoder().encode(payload), {
        reliable: true,
        topic,
        destinationIdentities: identities,
      })
    } catch {
      // 채널이 아직 안 열렸거나 방을 나가는 중 — 상태 알림이라 다음 알림이 같은 내용을 다시 보낸다
    }
  }

  function onData(cb: DataListener): () => void {
    dataListeners.add(cb)
    return () => dataListeners.delete(cb)
  }
  function onParticipantJoin(cb: PresenceListener): () => void {
    joinListeners.add(cb)
    return () => joinListeners.delete(cb)
  }
  function onParticipantLeave(cb: PresenceListener): () => void {
    leaveListeners.add(cb)
    return () => leaveListeners.delete(cb)
  }

  onScopeDispose(() => void disconnect())

  return {
    state: readonly(state),
    participants,
    cameraEnabled: readonly(cameraEnabled),
    microphoneEnabled: readonly(microphoneEnabled),
    error: readonly(error),
    participantVolumes: readonly(participantVolumes),
    connect,
    disconnect,
    publishCameraTrack,
    toggleCamera,
    toggleMicrophone,
    setParticipantVolume,
    publishGameScreen,
    setGameScreenMuted,
    unpublishGameScreen,
    sendData,
    onData,
    onParticipantJoin,
    onParticipantLeave,
  }
}
