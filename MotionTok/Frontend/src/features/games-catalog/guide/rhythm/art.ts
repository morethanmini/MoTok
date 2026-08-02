/**
 * 캐치캐치리듬 안내 그림 공용 색.
 *
 * 색은 실제 게임 화면(catch-rhythm/render/skins/catCandy.ts)에서 그대로 가져왔다.
 *
 * ⚠️ 이 게임의 안내 문구는 <b>코드보다 오래됐다</b>. 화면의 "주먹을 쥐세요"와 백엔드 시더의
 * "금색 음표만 주먹을 쥐어서 잡습니다"는 둘 다 지금 규칙이 아니다 — 주먹 음표(catch)는
 * 모든 난이도에서 생성 확률이 0이라(generator/presets.ts) 플레이어가 볼 일이 없다.
 * 지금 실제로 하는 일은 "펼친 손을 음표에 대는 것"이라 그림도 그렇게 그린다.
 */

export const VIEW_W = 320
export const VIEW_H = 220

/** 배경 — 복숭아색 그라데이션. */
export const BG_TOP = '#fff3ea'
export const BG_BOT = '#ffe6d8'

/** 음표 색 = 어느 손으로 잡는지. 파랑 왼손(L) · 빨강 오른손(R) · 보라 아무 손. */
export const NOTE_L = { fill: '#9ec5fe', edge: '#1d4ed8' }
export const NOTE_R = { fill: '#ffa8a8', edge: '#c92a2a' }
export const NOTE_ANY = { fill: '#c3aefc', edge: '#6d28d9' }

/** 손을 따라다니는 발바닥 커서 — 왼손은 하늘색, 오른손은 분홍. */
export const PAW_L = { fill: '#bfe8fa', edge: '#4a4a4a' }
export const PAW_R = { fill: '#ffb3b3', edge: '#4a4a4a' }

export const PERFECT = '#ff9e3d'
export const COMBO = '#e07a4f'
export const TEXT = '#5a392d'
export const MUTED = '#7a6a60'
/** 판정 링(다가오는 원이 여기 겹치면 맞히는 순간). */
export const RING = 'rgba(224,122,79,0.7)'

export const SKIN = '#f6cfa8'
export const SKIN_EDGE = '#8d5c38'
