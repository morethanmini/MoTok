<script setup lang="ts">
/**
 * 인벤토리 + 화면 꾸미기 (API §2 /users/me/inventory, /users/me/decoration).
 * 보유 아이템을 장착/해제하고, 장착 구성을 화면 꾸미기 설정으로 저장.
 */
import { computed, watch } from 'vue'
import { usersApi, ApiError, type InventoryItem, type ItemCategory, type DecorationConfig } from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import { useToast } from '@/composables/useToast'

const { message: toast, flash } = useToast()

const MOCK_INV: InventoryItem[] = [
  { itemId: 2, name: '무지개 효과', category: 'EFFECT', imageUrl: '', equipped: true, acquiredAt: '2025-07-10T00:00:00Z' },
  { itemId: 5, name: '반짝임 효과', category: 'EFFECT', imageUrl: '', equipped: false, acquiredAt: '2025-07-11T00:00:00Z' },
  { itemId: 7, name: '왕관 스티커', category: 'STICKER', imageUrl: '', equipped: false, acquiredAt: '2025-07-12T00:00:00Z' },
  { itemId: 8, name: '하트 스티커', category: 'STICKER', imageUrl: '', equipped: true, acquiredAt: '2025-07-13T00:00:00Z' },
  { itemId: 9, name: '별 가면', category: 'MASK', imageUrl: '', equipped: false, acquiredAt: '2025-07-14T00:00:00Z' },
  { itemId: 10, name: '고양이 가면', category: 'MASK', imageUrl: '', equipped: false, acquiredAt: '2025-07-15T00:00:00Z' },
  { itemId: 12, name: '우주 배경', category: 'BACKGROUND', imageUrl: '', equipped: false, acquiredAt: '2025-07-16T00:00:00Z' },
]
const emojiOf: Record<ItemCategory, string> = { MASK: '🎭', EFFECT: '✨', STICKER: '🌟', BACKGROUND: '🌌' }
const CATEGORY_ORDER: ItemCategory[] = ['MASK', 'EFFECT', 'STICKER', 'BACKGROUND']
const CATEGORY_LABEL: Record<ItemCategory, string> = { MASK: '가면', EFFECT: '효과', STICKER: '스티커', BACKGROUND: '배경' }

const MOCK_DECORATION: DecorationConfig = { config: { equippedItemIds: [2, 8] } }

const { data: inventory } = useAsyncData(() => usersApi.getInventory(), MOCK_INV)
const { data: decoration } = useAsyncData(() => usersApi.getDecoration(), MOCK_DECORATION)
const equipped = computed(() => inventory.value.filter((i) => i.equipped))

// 저장된 꾸미기(장착 구성)를 인벤토리 장착 상태에 반영. (idempotent → 재적용해도 루프 없음)
function savedEquippedIds(deco: DecorationConfig): number[] | null {
  const ids = deco.config?.equippedItemIds
  return Array.isArray(ids) ? (ids as number[]) : null
}
watch(
  [inventory, decoration],
  ([inv, deco]) => {
    const ids = savedEquippedIds(deco)
    if (!ids) return
    let changed = false
    const next = inv.map((i) => {
      const eq = ids.includes(i.itemId)
      if (eq === i.equipped) return i
      changed = true
      return { ...i, equipped: eq }
    })
    if (changed) inventory.value = next
  },
  { immediate: true },
)

// 카테고리별 그룹 (아이템 없는 카테고리는 제외)
const grouped = computed(() =>
  CATEGORY_ORDER.map((cat) => ({
    cat,
    label: CATEGORY_LABEL[cat],
    items: inventory.value.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0),
)

async function toggle(item: InventoryItem) {
  const next = !item.equipped
  try {
    await usersApi.setEquipped(item.itemId, next)
    item.equipped = next
  } catch (e) {
    // 백엔드 미연동 시에도 UI는 반영 (초안)
    item.equipped = next
    if (e instanceof ApiError) flash(e.message)
  }
}

async function saveDecoration() {
  const config = { equippedItemIds: equipped.value.map((i) => i.itemId) }
  try {
    await usersApi.saveDecoration({ config })
    flash('화면 꾸미기를 저장했어요')
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '저장 실패 (백엔드 미연동)')
  }
}
</script>

<template>
  <AppPage title="인벤토리 · 화면 꾸미기" subtitle="보유 아이템을 장착해 게임 화면을 꾸며요">
    <template #actions>
      <PixelButton variant="primary" @click="saveDecoration">꾸미기 저장</PixelButton>
    </template>

    <div class="grid">
      <PixelCard title="미리보기">
        <div class="preview">
          <div class="cam">
            <span class="preview-status">LIVE PREVIEW</span>
            <img src="/assets/intro/person.png" alt="내 아바타 미리보기" />
            <i>🙂</i>
          </div>
          <div class="equipped">
            <span v-for="i in equipped" :key="i.itemId" class="badge">{{ emojiOf[i.category] }} {{ i.name }}</span>
            <span v-if="equipped.length === 0" class="empty">장착된 아이템이 없어요</span>
          </div>
        </div>
      </PixelCard>

      <PixelCard title="보유 아이템">
        <!-- 카테고리별 세로 섹션 -->
        <div v-for="g in grouped" :key="g.cat" class="cat-group">
          <div class="cat-head">
            <span class="cat-emoji">{{ emojiOf[g.cat] }}</span>
            <span class="cat-label">{{ g.label }}</span>
            <span class="cat-count">{{ g.items.length }}</span>
          </div>
          <div class="items">
            <article v-for="item in g.items" :key="item.itemId" class="item" :class="{ on: item.equipped }">
              <div class="thumb">{{ emojiOf[item.category] }}</div>
              <div class="name">{{ item.name }}</div>
              <PixelButton :variant="item.equipped ? 'mint' : 'secondary'" @click="toggle(item)">
                {{ item.equipped ? '장착됨' : '장착' }}
              </PixelButton>
            </article>
          </div>
        </div>
        <p v-if="grouped.length === 0" class="empty-inv">보유한 아이템이 없어요. 상점에서 구매해보세요!</p>
      </PixelCard>
    </div>
    <PixelToast :message="toast" />
  </AppPage>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: 320px 1fr; gap: 18px; }
@media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }

.preview { text-align: center; }
.cam { position: relative; height: 210px; display: grid; place-items: center; overflow: hidden; border: var(--border); border-radius: var(--radius-md); background: linear-gradient(135deg, #dff3ee, #fff0c4); }
.cam img { width: 78%; height: 88%; object-fit: contain; transform: translateY(15px); }
.cam i { position: absolute; font-size: 38px; font-style: normal; transform: translateY(-5px); }
.preview-status { position: absolute; z-index: 2; left: 9px; top: 9px; padding: 5px 7px; border: 2px solid var(--c-ink); border-radius: 8px; background: #fff; font-size: 7px; font-weight: 700; }
.equipped { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 12px; }
.badge { font-size: 9px; padding: 5px 8px; border: 2px solid var(--c-ink); border-radius: 999px; background: var(--c-mint-soft); }
.empty { font-size: 10px; color: var(--c-muted); }

/* 카테고리 세로 섹션 */
.cat-group + .cat-group { margin-top: 20px; }
.cat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--c-ink);
}
.cat-emoji { font-size: 16px; }
.cat-label { font-size: 13px; font-weight: 700; }
.cat-count {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  display: grid;
  place-items: center;
  border: 2px solid var(--c-ink);
  border-radius: 999px;
  background: var(--c-yellow);
  font-size: 9px;
  font-weight: 700;
}

.items { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
.item { border: 2px solid var(--c-ink); border-radius: 14px; background: #fff; box-shadow: var(--shadow-sm); padding: 12px; text-align: center; }
.item.on { background: #f5fbf8; border-color: var(--c-mint); }
.thumb { height: 70px; display: grid; place-items: center; margin-bottom: 8px; border-radius: 10px; background: linear-gradient(135deg, var(--tone-4), #fff5d6); font-size: 36px; }
.name { font-size: 11px; font-weight: 700; margin-bottom: 10px; }
.empty-inv { text-align: center; color: var(--c-muted); font-size: 11px; padding: 20px; }
</style>
