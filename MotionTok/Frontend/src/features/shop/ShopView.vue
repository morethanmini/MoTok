<script setup lang="ts">
/** 상점 — 아이템 목록·분류 필터·구매 (API §3 /shop/items). */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { shopApi, ApiError, type Item, type ItemCategory } from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import { RouteName } from '@/router/routeNames'
import { useSessionStore } from '@/stores/session'
import AppPage from '@/components/common/AppPage.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import CoinIcon from '@/components/common/CoinIcon.vue'
import { useToast } from '@/composables/useToast'
import PurchaseConfirmModal from './components/PurchaseConfirmModal.vue'
import ChargePointsModal from '@/components/common/ChargePointsModal.vue'

const router = useRouter()
const session = useSessionStore()
const { message: toast, flash } = useToast()

// 현재 포인트 (세션 프로필 기준, 없으면 헤더와 동일한 기본값)
const currentPoints = ref(session.profile?.coins ?? 1250)

// 충전 모달
const showCharge = ref(false)
function onCharged(amount: number) {
  currentPoints.value += amount
  if (session.profile) session.profile.coins = currentPoints.value
  showCharge.value = false // 닫히면 구매 확인 모달이 갱신된 잔액으로 다시 표시됨
}

const MOCK_ITEMS: Item[] = [
  { id: 1, name: '별 가면', category: 'MASK', itemType: 'SHOP', pricePoint: 300, imageUrl: '', owned: false },
  { id: 2, name: '무지개 효과', category: 'EFFECT', itemType: 'SHOP', pricePoint: 500, imageUrl: '', owned: true },
  { id: 3, name: '하트 스티커', category: 'STICKER', itemType: 'SHOP', pricePoint: 150, imageUrl: '', owned: false },
  { id: 4, name: '우주 배경', category: 'BACKGROUND', itemType: 'SHOP', pricePoint: 800, imageUrl: '', owned: false },
  { id: 5, name: '고양이 가면', category: 'MASK', itemType: 'SHOP', pricePoint: 320, imageUrl: '', owned: false },
  { id: 6, name: '반짝임 효과', category: 'EFFECT', itemType: 'SHOP', pricePoint: 450, imageUrl: '', owned: false },
  { id: 7, name: '황금 고양이 스티커', category: 'STICKER', itemType: 'SHOP', pricePoint: 3000, imageUrl: '', owned: false },
]

const CATEGORIES: { key: ItemCategory | 'ALL'; label: string; emoji: string }[] = [
  { key: 'ALL', label: '전체', emoji: '🛍' },
  { key: 'MASK', label: '가면', emoji: '🎭' },
  { key: 'EFFECT', label: '효과', emoji: '✨' },
  { key: 'STICKER', label: '스티커', emoji: '🌟' },
  { key: 'BACKGROUND', label: '배경', emoji: '🌌' },
]
const emojiOf: Record<ItemCategory, string> = { MASK: '🎭', EFFECT: '✨', STICKER: '🌟', BACKGROUND: '🌌' }

const active = ref<ItemCategory | 'ALL'>('ALL')
const { data: items } = useAsyncData(() => shopApi.listItems(), MOCK_ITEMS)

const filtered = computed(() =>
  active.value === 'ALL' ? items.value : items.value.filter((i) => i.category === active.value),
)

// 구매 확인 모달 대상
const selected = ref<Item | null>(null)

function openConfirm(item: Item) {
  if (item.owned) return
  selected.value = item
}

async function confirmPurchase() {
  const item = selected.value
  if (!item) return
  try {
    const res = await shopApi.purchase(item.id)
    currentPoints.value = res.balanceAfter
    flash(`구매 완료! 잔액 ${res.balanceAfter.toLocaleString()}P`)
  } catch (e) {
    // 백엔드 미연동 시에도 UI 흐름 유지 (초안)
    currentPoints.value -= item.pricePoint ?? 0
    flash(e instanceof ApiError ? e.message : `구매 완료(모의)! 잔액 ${currentPoints.value.toLocaleString()}P`)
  }
  item.owned = true
  selected.value = null
}
</script>

<template>
  <AppPage title="상점" subtitle="포인트로 화면 꾸미기 아이템을 구매하세요">
    <template #actions>
      <PixelButton variant="guest" @click="router.push({ name: RouteName.Inventory })">
        🎒 내 아바타
      </PixelButton>
      <PixelButton variant="mint" @click="router.push({ name: RouteName.AiItemCreate })">
        ✎ AI 아이템 만들기
      </PixelButton>
    </template>

    <div class="chips">
      <button
        v-for="c in CATEGORIES"
        :key="c.key"
        class="chip"
        :class="{ on: active === c.key }"
        @click="active = c.key"
      >
        {{ c.emoji }} {{ c.label }}
      </button>
    </div>

    <div class="grid">
      <article v-for="item in filtered" :key="item.id" class="item">
        <div class="thumb">{{ emojiOf[item.category] }}</div>
        <div class="name">{{ item.name }}</div>
        <div class="row">
          <span class="price"><CoinIcon :size="13" /> {{ item.pricePoint?.toLocaleString() ?? '-' }}</span>
          <PixelButton
            :variant="item.owned ? 'secondary' : 'yellow'"
            :disabled="item.owned"
            @click="openConfirm(item)"
          >
            {{ item.owned ? '보유중' : '구매' }}
          </PixelButton>
        </div>
      </article>
    </div>

    <PurchaseConfirmModal
      v-if="selected && !showCharge"
      :item="selected"
      :current-points="currentPoints"
      @close="selected = null"
      @confirm="confirmPurchase"
      @charge="showCharge = true"
    />

    <ChargePointsModal
      v-if="showCharge"
      :current-points="currentPoints"
      @close="showCharge = false"
      @charged="onCharged"
    />

    <PixelToast :message="toast" />
  </AppPage>
</template>

<style scoped>
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.chip { border: 2px solid var(--c-ink); background: #fff; border-radius: 999px; padding: 8px 13px; font-size: 11px; box-shadow: 2px 2px 0 #d8c9d8; }
.chip.on { background: var(--c-yellow); box-shadow: var(--shadow-sm); font-weight: 700; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 14px; }
.item { border: var(--border); border-radius: 17px 17px 13px 17px; background: #fff; box-shadow: var(--shadow-md); padding: 14px; }
.thumb { height: 88px; display: grid; place-items: center; font-size: 42px; border: 2px solid var(--c-ink); border-radius: 12px; background: var(--tone-4); margin-bottom: 10px; }
.name { font-size: 12px; font-weight: 700; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.price { font-size: 11px; color: #d79600; font-weight: 700; }
</style>
