/** 상점 API (명세 §3). */
import { http } from '../http'
import type { AiItemRequest, Item, ItemCategory, PurchaseResponse } from '../types'

export const shopApi = {
  listItems: (category?: ItemCategory) => http.get<Item[]>('/shop/items', { category }),
  purchase: (itemId: number) =>
    http.post<PurchaseResponse>(`/shop/items/${itemId}/purchase`),
  createAiItem: (body: AiItemRequest) => http.post<Item>('/shop/ai-items', body),
}
