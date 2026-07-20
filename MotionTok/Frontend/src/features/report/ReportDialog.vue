<script setup lang="ts">
/**
 * 사용자 신고 다이얼로그 (API §7 /reports). 재사용 컴포넌트 — 방·게임룸 등에서 호출.
 *   <ReportDialog :reported-user-id="42" reported-nickname="트롤러" @close="..." />
 */
import { ref } from 'vue'
import { reportsApi, ApiError } from '@/api'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const props = defineProps<{ reportedUserId: number; reportedNickname?: string }>()
const emit = defineEmits<{ close: []; done: [] }>()

const REASONS = [
  { code: 'ABUSE', label: '욕설·비방' },
  { code: 'HARASSMENT', label: '괴롭힘·방해' },
  { code: 'INAPPROPRIATE', label: '부적절한 콘텐츠' },
  { code: 'SPAM', label: '스팸·광고' },
  { code: 'ETC', label: '기타(직접 입력)' },
]
const reasonType = ref('ABUSE')
const reasonText = ref('')
const error = ref<string | null>(null)
const loading = ref(false)

async function submit() {
  loading.value = true
  error.value = null
  try {
    await reportsApi.report({
      reportedUserId: props.reportedUserId,
      reasonType: reasonType.value,
      reasonText: reasonText.value || null,
    })
    emit('done')
    emit('close')
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '신고 실패 (백엔드 미연동)'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <PixelModal @close="emit('close')">
    <h3>사용자 신고</h3>
    <p class="sub">{{ reportedNickname ?? `사용자 #${reportedUserId}` }} 님을 신고합니다.</p>

    <label class="field">
      사유
      <select v-model="reasonType">
        <option v-for="r in REASONS" :key="r.code" :value="r.code">{{ r.label }}</option>
      </select>
    </label>
    <label v-if="reasonType === 'ETC'" class="field">
      상세 사유
      <textarea v-model="reasonText" rows="3" placeholder="신고 사유를 입력해 주세요" />
    </label>

    <p v-if="error" class="err">{{ error }}</p>
    <div class="actions">
      <PixelButton block @click="emit('close')">취소</PixelButton>
      <PixelButton variant="primary" block :disabled="loading" @click="submit">신고하기</PixelButton>
    </div>
  </PixelModal>
</template>

<style scoped>
h3 { margin: 0 0 6px; }
.sub { margin: 0 0 16px; font-size: 11px; color: var(--c-muted); }
.field { display: block; margin-bottom: 12px; font-size: 9px; font-weight: 700; }
.field select, .field textarea {
  width: 100%; margin-top: 6px; padding: 10px 12px;
  border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; outline: 0;
  font: inherit; resize: vertical;
}
.field select { height: 44px; padding: 0 12px; }
.err { font-size: 10px; color: var(--c-coral); margin: 0 0 10px; }
.actions { display: flex; gap: 9px; margin-top: 6px; }
.actions > * { flex: 1; }
</style>
