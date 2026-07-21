/**
 * 비동기 로드 + 폴백 헬퍼. 백엔드가 아직 없거나 실패해도 fallback으로 화면이 뜨도록 합니다.
 * (초안 페이지들이 API 미연동 상태에서도 렌더되도록)
 *
 *   const { data, loading, error, reload } = useAsyncData(() => usersApi.getMe(), MOCK_ME)
 */
import { onMounted, ref, shallowRef, type Ref } from 'vue'
import { ApiError } from '@/api'

export function useAsyncData<T>(loader: () => Promise<T>, fallback: T) {
  const data = shallowRef(fallback) as Ref<T>
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function reload() {
    loading.value = true
    error.value = null
    try {
      data.value = await loader()
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : '데이터를 불러오지 못했어요 (백엔드 미연동)'
      // fallback 유지
    } finally {
      loading.value = false
    }
  }

  onMounted(reload)
  return { data, loading, error, reload }
}
