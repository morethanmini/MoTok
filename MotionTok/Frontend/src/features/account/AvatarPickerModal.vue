<script setup lang="ts">
/**
 * 프로필 변경 팝업 — 기본 프로필 아이콘 19개 + '사진 추가' 한 칸을 5열 4줄로 보여준다.
 *
 * 고르는 것만 하고 저장은 부모(MyPageView)가 한다. 저장 경로가 둘로 갈리기 때문이다 —
 * 기본 아이콘은 preset 한 번이면 끝이지만, 사진은 presign → S3 PUT → 확정의 3단계라
 * 파일 input과 업로드 상태를 부모가 이미 쥐고 있다. 여기서 다시 들고 있으면 상태가 두 벌이 된다.
 */
import { AVATAR_PRESETS, avatarPresetUrl } from './avatarPresets'
import PixelModal from '@/components/common/PixelModal.vue'

defineProps<{
  /** 지금 쓰고 있는 avatarUrl — 고른 칸에 표시를 남기려고 받는다 */
  current: string | null
  /** 업로드·저장 중이면 조작을 막는다(중복 요청 방지) */
  busy: boolean
}>()

const emit = defineEmits<{
  close: []
  /** 기본 프로필 아이콘 선택 — 값은 확장자를 뺀 파일명('4_cat') */
  select: [preset: string]
  /** '사진 추가' — 부모가 파일 선택창을 연다 */
  upload: []
  /** 아바타 해제(기본 이모지로) */
  clear: []
}>()
</script>

<template>
  <PixelModal @close="emit('close')">
    <div class="picker">
      <button class="close" title="닫기" @click="emit('close')">✕</button>
      <h3>프로필 변경</h3>

      <div class="grid">
        <button
          v-for="p in AVATAR_PRESETS"
          :key="p"
          class="cell"
          :class="{ on: current === avatarPresetUrl(p) }"
          :disabled="busy"
          :aria-pressed="current === avatarPresetUrl(p)"
          title="이 아이콘으로 변경"
          @click="emit('select', p)"
        >
          <img :src="avatarPresetUrl(p)" alt="" />
        </button>

        <!-- 20번째 칸 — 직접 올리기. 아이콘 19개 + 이 칸으로 5열 4줄이 정확히 채워진다. -->
        <button class="cell add" :disabled="busy" title="내 사진 올리기" @click="emit('upload')">
          <span class="plus" aria-hidden="true">＋</span>
          <span class="add-label">사진 추가</span>
        </button>
      </div>

      <!-- 아바타를 아예 없애는 길도 남겨 둔다 — 사진을 지우면 기본 이모지로 돌아간다. -->
      <button v-if="current" class="clear" :disabled="busy" @click="emit('clear')">
        프로필 지우기
      </button>
    </div>
  </PixelModal>
</template>

<style scoped>
.picker { position: relative; }
.close {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 30px;
  height: 30px;
  border: 2px solid var(--c-ink);
  border-radius: 9px;
  background: #fff;
  box-shadow: 2px 2px 0 var(--c-ink);
  font-size: 12px;
}
h3 { margin: 4px 0 16px; }

.grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.cell {
  aspect-ratio: 1;
  padding: 4px;
  border: 2px solid var(--c-ink);
  border-radius: var(--radius-sm);
  background: #fff;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
}
.cell img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  /* 도트 아이콘이라 부드럽게 늘리면 뭉개진다 */
  image-rendering: pixelated;
}
.cell:hover:not(:disabled) { background: #fff7d9; }
.cell.on { background: var(--c-mint-soft); box-shadow: var(--shadow-md); }
.cell:disabled { cursor: default; opacity: 0.5; }

.add {
  display: grid;
  place-items: center;
  gap: 1px;
  background: var(--c-mint-soft);
}
.add .plus { font-size: 17px; font-weight: 700; line-height: 1; }
.add-label { font-size: 7px; font-weight: 700; color: var(--c-muted); }

.clear {
  display: block;
  margin: 16px auto 0;
  padding: 0;
  border: 0;
  background: none;
  font-size: 10px;
  color: var(--c-muted);
  text-decoration: underline;
  cursor: pointer;
}
.clear:disabled { cursor: default; opacity: 0.5; }
</style>
