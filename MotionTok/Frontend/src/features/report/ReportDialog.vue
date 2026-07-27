<script setup lang="ts">
/**
 * 사용자 신고 다이얼로그 (API §7 /reports). 재사용 컴포넌트 — 방·게임룸 등에서 호출.
 *   <ReportDialog :reported-user-id="42" reported-nickname="트롤러" @close="..." />
 */
import { computed, ref } from 'vue'
import { reportsApi, ApiError, type ReportReason } from '@/api'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const props = defineProps<{ reportedUserId: number; reportedNickname?: string }>()
const emit = defineEmits<{ close: []; done: [] }>()

/**
 * 사유는 서버 ReportReason enum과 값이 같아야 한다 — 없는 코드를 보내면 역직렬화에서 400이다.
 * 채팅 신고(-132)와 같은 목록을 쓴다: 같은 관리자 화면에서 함께 다루는데 어휘가 갈리면 통계도 갈린다.
 */
const REASONS: { code: ReportReason; label: string }[] = [
  { code: 'ABUSE', label: '욕설·비방' },
  { code: 'HATE', label: '혐오·차별' },
  { code: 'SEXUAL', label: '음란·성희롱' },
  { code: 'SPAM', label: '도배·광고' },
  { code: 'ETC', label: '기타(직접 입력)' },
]
/** 서버 @Size(max = 200)과 같게 유지한다 — 넘겨 보내면 400으로 되돌아온다. */
const DETAIL_MAX = 200

const reasonType = ref<ReportReason>('ABUSE')
const reasonText = ref('')
const error = ref<string | null>(null)
const loading = ref(false)

// '기타'는 코드만으로 무엇이 문제인지 알 수 없어 관리자가 판단할 수 없다.
const detailRequired = computed(() => reasonType.value === 'ETC')
const canSubmit = computed(
  () => !loading.value && (!detailRequired.value || reasonText.value.trim().length > 0),
)

async function submit() {
  if (!canSubmit.value) return
  loading.value = true
  error.value = null
  try {
    await reportsApi.report({
      reportedUserId: props.reportedUserId,
      reasonType: reasonType.value,
      reasonText: reasonText.value.trim() || null,
    })
    emit('done')
    emit('close')
  } catch (e) {
    // 409(이미 처리 중인 신고)는 실패라기보다 "이미 접수됐다"는 안내라 서버 문구를 그대로 보여준다.
    error.value = e instanceof ApiError ? e.message : '신고를 접수하지 못했어요. 잠시 후 다시 시도해 주세요.'
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
    <label class="field">
      상세 사유{{ detailRequired ? '' : ' (선택)' }}
      <textarea
        v-model="reasonText"
        rows="3"
        :maxlength="DETAIL_MAX"
        :placeholder="detailRequired ? '어떤 점이 문제였는지 적어 주세요 (필수)' : '자세한 내용을 적어 주시면 검토에 도움이 돼요'"
      />
      <span class="count">{{ reasonText.length }} / {{ DETAIL_MAX }}</span>
    </label>

    <p v-if="error" class="err">{{ error }}</p>
    <div class="actions">
      <PixelButton block @click="emit('close')">취소</PixelButton>
      <PixelButton variant="primary" block :disabled="!canSubmit" @click="submit">
        {{ loading ? '접수 중…' : '신고하기' }}
      </PixelButton>
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
.count { display: block; margin-top: 4px; text-align: right; font-size: 9px; font-weight: 400; color: var(--c-muted); }
.err { font-size: 10px; color: var(--c-coral); margin: 0 0 10px; }
.actions { display: flex; gap: 9px; margin-top: 6px; }
.actions > * { flex: 1; }
</style>
