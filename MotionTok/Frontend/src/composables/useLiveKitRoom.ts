/**
 * LiveKit(SFU) 방 접속 컴포저블.
 *
 * 흐름: sfuApi.videoToken(roomId)로 접속 정보를 받아 Room.connect → 로컬 카메라/마이크 발행 →
 * 원격 참가자 트랙을 구독해 reactive `participants`로 노출한다. 언마운트/재접속 시 자동 정리.
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
  type Participant,
  type Track as LkTrack,
  type TrackPublication,
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
}

export function useLiveKitRoom() {
  let room: Room | null = null

  const state = ref<ConnectionState>(ConnectionState.Disconnected)
  const participants = shallowRef<ParticipantView[]>([])
  const cameraEnabled = ref(false)
  const microphoneEnabled = ref(false)
  const error = ref<string | null>(null)

  function pubFor(p: Participant, kind: Track.Kind): TrackPublication | undefined {
    for (const pub of p.trackPublications.values()) {
      if (pub.kind === kind) return pub
    }
    return undefined
  }

  function toView(p: Participant, isLocal: boolean): ParticipantView {
    const videoPub = pubFor(p, Track.Kind.Video)
    const audioPub = pubFor(p, Track.Kind.Audio)
    return {
      identity: p.identity,
      name: p.name || p.identity,
      isLocal,
      isSpeaking: p.isSpeaking,
      cameraOn: !!videoPub && !videoPub.isMuted && !!videoPub.track,
      micOn: !!audioPub && !audioPub.isMuted,
      videoTrack: videoPub?.track ?? null,
      audioTrack: audioPub?.track ?? null,
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
    opts: { camera?: boolean; microphone?: boolean } = {},
  ): Promise<boolean> {
    const { camera = true, microphone = true } = opts
    await disconnect()
    error.value = null
    try {
      const { url, token } = await sfuApi.videoToken(roomId)
      const r = new Room({ adaptiveStream: true, dynacast: true })
      room = r
      bindEvents(r)
      await r.connect(url, token)
      // 미디어 발행은 best-effort — 권한 거부/장치 없음이 방 연결 자체를 끊지 않도록 개별 처리.
      if (camera) {
        try {
          await r.localParticipant.setCameraEnabled(true)
        } catch {
          error.value = '카메라를 켤 수 없어요(권한/장치 확인)'
        }
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
    r.removeAllListeners()
    await r.disconnect()
    participants.value = []
    state.value = ConnectionState.Disconnected
    cameraEnabled.value = false
    microphoneEnabled.value = false
  }

  async function toggleCamera() {
    if (!room) return
    await room.localParticipant.setCameraEnabled(!cameraEnabled.value)
    refresh()
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
    toggleCamera,
    toggleMicrophone,
  }
}
