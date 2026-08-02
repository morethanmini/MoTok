<script setup lang="ts">
/**
 * 프레임 효과(뽀샤시)의 세기 슬라이더.
 *
 * 스티커는 영상 위 핸들을 끌어 크기를 바꾸지만, 효과는 붙는 자리가 없어 끌 손잡이가 없다.
 * 그래서 크기 조절이 있던 자리를 이 슬라이더가 대신한다. 편집기 세 곳(인벤토리·장치 설정·
 * 게임룸 패널)이 같은 것을 쓰도록 컴포넌트로 뽑았다 — 세 곳에서 각자 만들면 범위·단계가 갈린다.
 *
 * 끌 때마다 값을 올려 보낸다(놓을 때가 아니라) — 영상에 바로 반영돼야 세기를 맞출 수 있고,
 * 방 안에서는 그 값이 참가자들에게도 곧바로 전달된다.
 */
import { MAX_INTENSITY, MIN_INTENSITY } from './cameraEffect'

const props = defineProps<{ intensity: number; label?: string }>()
const emit = defineEmits<{ change: [number] }>()

const STEP = 0.05

function onInput(e: Event) {
  emit('change', Number((e.target as HTMLInputElement).value))
}
</script>

<template>
  <label class="fx-intensity">
    <span class="fx-intensity-label">{{ props.label ?? '뽀샤시 세기' }}</span>
    <input
      type="range"
      :min="MIN_INTENSITY"
      :max="MAX_INTENSITY"
      :step="STEP"
      :value="props.intensity"
      :aria-valuetext="`${Math.round(props.intensity * 100)}%`"
      @input="onInput"
    />
    <output>{{ Math.round(props.intensity * 100) }}%</output>
  </label>
</template>

<style scoped>
.fx-intensity {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: var(--c-muted, #897460);
}
.fx-intensity-label {
  flex: none;
  font-weight: 700;
}
.fx-intensity input {
  flex: 1;
  min-width: 80px;
  accent-color: #e0a34f;
}
.fx-intensity output {
  flex: none;
  min-width: 34px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
