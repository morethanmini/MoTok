<script setup lang="ts">
/** 상점 — 아이템 목록·분류 필터·구매 (API §3 /shop/items). */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { shopApi, usersApi, ApiError, type Item, type ItemCategory } from '@/api'
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

// 현재 포인트 — 세션 프로필로 시작하되 마운트 시 서버 값으로 덮어쓴다.
// (충전이 아직 데모라 세션 잔액이 서버와 어긋날 수 있어, 구매 판단은 서버 값을 기준으로 한다)
const currentPoints = ref(session.profile?.pointBalance ?? 0)

/** 잔액을 한 곳에서 갱신 — 헤더가 보는 세션 프로필까지 같이 맞춘다. */
function applyBalance(next: number) {
  currentPoints.value = next
  if (session.profile) session.profile.pointBalance = next
}

/** 서버 잔액 재동기화. 실패하면 화면 값을 그대로 두고 조용히 지나간다(표시용이라 치명적이지 않음). */
async function syncBalance() {
  try {
    applyBalance((await usersApi.getPoints()).pointBalance)
  } catch {
    /* 잔액 조회 실패 — 기존 표시 값 유지 */
  }
}
onMounted(syncBalance)

// 충전 모달
const showCharge = ref(false)
function onCharged(amount: number) {
  // 데모 충전 — 서버 잔액은 늘지 않는다. 표시만 올려 두고 구매 시 서버가 최종 판단한다.
  applyBalance(currentPoints.value + amount)
  showCharge.value = false // 닫히면 구매 확인 모달이 갱신된 잔액으로 다시 표시됨
}

const MOCK_ITEMS: Item[] = [
  { id: 1, name: '별 가면', category: 'MASK', itemType: 'SHOP', pricePoint: 300, imageUrl: '', owned: false },
  { id: 2, name: '무지개 효과', category: 'EFFECT', itemType: 'SHOP', pricePoint: 500, imageUrl: '', owned: true },
  { id: 3, name: '하트 스티커', category: 'STICKER', itemType: 'SHOP', pricePoint: 150, imageUrl: '/assets/item/sticker/heart_1.png', owned: false },
  { id: 4, name: '우주 배경', category: 'BACKGROUND', itemType: 'SHOP', pricePoint: 800, imageUrl: '', owned: false },
  { id: 5, name: '고양이 가면', category: 'MASK', itemType: 'SHOP', pricePoint: 320, imageUrl: '', owned: false },
  { id: 6, name: '반짝임 효과', category: 'EFFECT', itemType: 'SHOP', pricePoint: 450, imageUrl: '', owned: false },
  { id: 7, name: '음표 스티커', category: 'STICKER', itemType: 'SHOP', pricePoint: 200, imageUrl: '/assets/item/sticker/note_1.png', owned: false },
  { id: 8, name: '별 스티커', category: 'STICKER', itemType: 'SHOP', pricePoint: 250, imageUrl: '/assets/item/sticker/star_1.png', owned: false },
  { id: 9, name: '고양이 풍선 스티커', category: 'STICKER', itemType: 'SHOP', pricePoint: 1500, imageUrl: '/assets/item/sticker/cat_balloon.gif', owned: false },
]

const CATEGORIES: { key: ItemCategory | 'ALL'; label: string; emoji: string }[] = [
  { key: 'ALL', label: '전체', emoji: '🛍' },
  { key: 'MASK', label: '가면', emoji: '🎭' },
  { key: 'EFFECT', label: '효과', emoji: '✨' },
  { key: 'STICKER', label: '스티커', emoji: '🌟' },
  { key: 'BACKGROUND', label: '배경', emoji: '🌌' },
]
const artOf: Record<ItemCategory, string> = {
  MASK: '/assets/intro/person.png',
  EFFECT: '/assets/intro/constellation.png',
  STICKER: '/assets/intro/trophy.png',
  BACKGROUND: '/assets/intro/moon.png',
}

// 아이템 이미지가 있으면 그대로, 없으면 분류별 대표 아트로 대체
const thumbOf = (item: Item) => item.imageUrl || artOf[item.category]

const active = ref<ItemCategory | 'ALL'>('ALL')
// loadError면 화면에 보이는 건 서버 목록이 아니라 MOCK_ITEMS다 — 이 상태에선 구매를 막는다.
// (DB에 없는 아이템이라 구매하면 어차피 404다)
const { data: items, error: loadError, reload: reloadItems } = useAsyncData(() => shopApi.listItems(), MOCK_ITEMS)

const filtered = computed(() =>
  active.value === 'ALL' ? items.value : items.value.filter((i) => i.category === active.value),
)

// 구매 확인 모달 대상
const selected = ref<Item | null>(null)
/** 구매 요청 진행 중 — 연타로 같은 아이템에 POST가 두 번 나가는 걸 막는다. */
const purchasing = ref(false)

function openConfirm(item: Item) {
  if (item.owned || loadError.value) return
  selected.value = item
}

/** 보유 표시. items가 shallowRef라 원소 속성만 바꾸면 갱신이 안 걸려 배열을 새로 만든다. */
function markOwned(itemId: number) {
  items.value = items.value.map((i) => (i.id === itemId ? { ...i, owned: true } : i))
}

async function confirmPurchase() {
  const item = selected.value
  if (!item || purchasing.value) return

  purchasing.value = true
  try {
    const res = await shopApi.purchase(item.id)
    applyBalance(res.balanceAfter)
    markOwned(item.id)
    flash(`구매 완료! 잔액 ${res.balanceAfter.toLocaleString()}P`)
    selected.value = null
  } catch (e) {
    if (!(e instanceof ApiError)) {
      flash('구매에 실패했어요. 잠시 후 다시 시도해 주세요.')
      return
    }
    // 서버가 이미 보유라고 하면 화면이 뒤처진 것이므로 표시를 맞춰 준다.
    if (e.code === 'ITEM_ALREADY_OWNED') {
      markOwned(item.id)
      selected.value = null
    }
    // 잔액 부족은 화면 잔액이 서버와 어긋났다는 뜻(데모 충전) — 서버 값으로 되돌린다.
    if (e.code === 'INSUFFICIENT_POINT') await syncBalance()
    if (e.code === 'ITEM_NOT_FOUND') await reloadItems()
    flash(e.message)
  } finally {
    purchasing.value = false
  }
}
</script>

<template>
  <AppPage title="상점" subtitle="포인트로 화면 꾸미기 아이템을 구매하세요">
    <template #actions>
      <div class="balance bottom-balance">
        <small>MY POINT</small>
        <b><CoinIcon :size="17" /> {{ currentPoints.toLocaleString() }}</b>
      </div>
    </template>

    <template #hero>
      <section class="shop-hero">
        <div>
          <span class="px-kicker">NEW ITEM DROP!</span>
          <h2>나만의 플레이 화면을 꾸며봐요</h2>
          <p>가면, 반짝이는 효과, 배경까지 모션 파티에 개성을 더해요.</p>
        </div>
        <div class="hero-actions">
          <PixelButton variant="guest" @click="router.push({ name: RouteName.Inventory })">
            🎒 내 아바타
          </PixelButton>
          <PixelButton variant="mint" @click="router.push({ name: RouteName.AiItemCreate })">
            ✎ AI 아이템 만들기
          </PixelButton>
        </div>
        <img src="/assets/intro/sketchbook.png" alt="꾸미기 아이템" />
      </section>
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

    <!-- 목록을 못 불러온 상태 — 아래 카드는 예시(목) 데이터라 구매할 수 없음을 밝힌다. -->
    <p v-if="loadError" class="load-error">
      <span>{{ loadError }} · 아래 목록은 예시라 구매할 수 없어요.</span>
      <PixelButton @click="reloadItems()">다시 시도</PixelButton>
    </p>

    <div class="grid">
      <article v-for="item in filtered" :key="item.id" class="item">
        <div class="thumb">
          <img :src="thumbOf(item)" alt="" />
          <i v-if="item.owned">OWNED</i>
        </div>
        <div class="name">{{ item.name }}</div>
        <div class="row">
          <span class="price"><CoinIcon :size="13" /> {{ item.pricePoint?.toLocaleString() ?? '-' }}</span>
          <PixelButton
            :variant="item.owned ? 'secondary' : 'yellow'"
            :disabled="item.owned || !!loadError"
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
      :pending="purchasing"
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
.shop-hero { position: relative; height: 150px; margin-bottom: 18px; padding: 22px 28px; display: flex; align-items: center; overflow: hidden; border: var(--border); border-radius: 21px 21px 15px 21px; background: linear-gradient(115deg, #ffe1d4, #fff2be); box-shadow: var(--shadow-lg); }
.shop-hero h2 { margin: 12px 0 6px; font-size: 18px; }
.shop-hero p { margin: 0; color: var(--c-muted); font-size: 10px; }
.shop-hero > img { width: 180px; margin-left: 14px; transform: translateY(19px) rotate(5deg); }
.hero-actions { margin-left: auto; display: flex; gap: 9px; }
.balance { min-width: 130px; margin-left: 18px; padding: 13px 15px; border: var(--border); border-radius: 14px; background: #fff; box-shadow: var(--shadow-md); }
.bottom-balance { margin-left: 0; }
.balance small { display: block; margin-bottom: 7px; color: var(--c-muted); font-size: 8px; }
.balance b { display: flex; align-items: center; gap: 7px; color: #d79600; font-size: 15px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.chip { border: 2px solid var(--c-ink); background: #fff; border-radius: 999px; padding: 8px 13px; font-size: 11px; box-shadow: 2px 2px 0 #d8c9d8; }
.chip.on { background: var(--c-yellow); box-shadow: var(--shadow-sm); font-weight: 700; }

.load-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 14px; padding: 11px 14px; border: 2px solid var(--c-ink); border-radius: 12px; background: #ffe9e4; font-size: 11px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
.item { border: var(--border); border-radius: 17px 17px 13px 17px; background: #fff; box-shadow: var(--shadow-md); padding: 11px 14px; transition: var(--t-fast); }
.item:hover { transform: translate(-2px,-2px); box-shadow: var(--shadow-lg); }
/* grid + auto 행이면 이미지의 height:100%가 순환 참조라 auto로 풀려 세로가 넘쳐 잘린다.
   flex는 컨테이너 높이가 확정이라 100%가 96px-padding으로 제대로 풀리고 contain이 동작한다. */
.thumb { position: relative; height: 96px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 2px solid var(--c-ink); border-radius: 12px; background: linear-gradient(135deg, var(--tone-4), #fff4d5); margin-bottom: 9px; }
/* 50% — 나머지가 여백이 된다(별도 padding 불필요). */
.thumb img { width: 50%; height: 50%; object-fit: contain; }
.thumb i { position: absolute; left: 7px; top: 7px; padding: 4px 6px; border: 2px solid var(--c-ink); border-radius: 7px; background: var(--c-mint-soft); font-size: 7px; font-style: normal; font-weight: 700; }
.name { font-size: 12px; font-weight: 700; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.price { font-size: 11px; color: #d79600; font-weight: 700; }
</style>
