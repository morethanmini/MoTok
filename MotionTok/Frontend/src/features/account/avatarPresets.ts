/**
 * 기본 프로필 아이콘 목록.
 *
 * 파일은 `public/assets/icons/profile/` 에 있다. `public/` 은 번들러가 훑지 않으므로
 * (`import.meta.glob` 은 `src/` 아래만 본다) 목록을 여기에 적는다 —
 * 아이콘을 추가·삭제하면 이 배열도 함께 고쳐야 한다.
 *
 * 값은 확장자를 뺀 파일명이고, 그대로 서버에 preset으로 보낸다.
 * 서버는 형식만 검사한 뒤 정적 경로를 붙여 avatarUrl로 저장한다(UserService.resolveAvatarUrl).
 */
export const AVATAR_PRESETS = [
  '1_boy',
  '2_girl',
  '3_mushroom',
  '4_cat',
  '5_heart',
  '6_star',
  '7_bubbletea',
  '8_game',
  '9_dino',
  '10_bunny',
  '11_com',
  '12_dog',
  '13_cherry',
  '14_moon',
  '15_cake',
  '16_planet',
  '17_abo',
  '18_cloud',
  '19_present',
] as const

export type AvatarPreset = (typeof AVATAR_PRESETS)[number]

/** 서버가 avatarUrl로 저장하는 경로와 같아야 한다(UserService.AVATAR_PRESET_PATH). */
export const avatarPresetUrl = (preset: string) => `/assets/icons/profile/${preset}.png`
