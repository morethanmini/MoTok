/** 상점 API (명세 §3). */
import { http } from '../http'
import type {
  AiItemJobResponse,
  AiItemJobStatusResponse,
  AiItemRequest,
  Item,
  ItemCategory,
  PurchaseResponse,
} from '../types'

export const shopApi = {
  listItems: (category?: ItemCategory) => http.get<Item[]>('/shop/items', { category }),
  purchase: (itemId: number) =>
    http.post<PurchaseResponse>(`/shop/items/${itemId}/purchase`),
  /** AI 아이템 생성 요청 — 큐에 쌓일 뿐, jobId만 즉시 돌아온다(GPU 워커가 비동기 처리). */
  createAiItem: (body: AiItemRequest) => http.post<AiItemJobResponse>('/shop/ai-items', body),
  /** 생성 작업 상태 조회 — DONE/FAILED가 될 때까지 폴링한다. */
  getAiItemJob: (jobId: number) => http.get<AiItemJobStatusResponse>(`/shop/ai-items/${jobId}`),
}
