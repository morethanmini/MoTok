<script setup lang="ts">
/** 게임룸 친구 화상 타일 (플레이스홀더). 이름/마이크 상태/오디오 레벨/왕관 표시. */
withDefaults(
  defineProps<{
    name: string
    muted?: boolean
    crown?: boolean
  }>(),
  { muted: false, crown: false },
)
</script>

<template>
  <div class="tile">
    <div class="placeholder">친구 초대</div>
    <div class="label">
      <span class="name">{{ name }}</span>
      <span class="mic" :class="{ muted }">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square">
          <rect x="9" y="3" width="6" height="11" />
          <path d="M5 11a7 7 0 0014 0M12 18v3" />
        </svg>
      </span>
      <span class="bars">
        <i style="height: 5px" /><i style="height: 8px" /><i :style="{ height: '11px', background: muted ? '#e0d6bd' : '#5cbf4a' }" />
      </span>
    </div>
    <div v-if="crown" class="crown">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="#2b2333" stroke-width="1.4">
        <path d="M3 8l4 3.5L12 4l5 7.5L21 8l-2 11H5L3 8z" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.tile {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #fff;
  border: 3px solid var(--c-ink-soft);
  border-radius: 14px 14px 10px 14px;
  box-shadow: 4px 4px 0 rgba(43, 35, 51, 0.2);
}
.placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: #f3ead2;
  color: #a99f86;
  font-size: 11px;
}
.label {
  position: absolute;
  top: 8px;
  left: 8px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 9px;
  background: #fffdf3;
  border: 2px solid var(--c-ink-soft);
  pointer-events: none;
}
.name { font-size: 9px; }
.mic { color: #8a8072; }
.mic.muted { color: #e85d6e; }
.bars { display: flex; align-items: flex-end; gap: 2px; height: 12px; }
.bars i { width: 3px; background: #5cbf4a; }
.crown { position: absolute; top: 7px; right: 8px; color: #f5c518; pointer-events: none; }
</style>
