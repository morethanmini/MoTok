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
import catAccessories from '@/assets/shop/cat-accessories.png'
import { useToast } from '@/composables/useToast'
import PurchaseConfirmModal from './components/PurchaseConfirmModal.vue'
import ItemPreviewModal from './components/ItemPreviewModal.vue'
import ChargePointsModal from '@/components/common/ChargePointsModal.vue'
import { POINT_CHARGE_ENABLED } from '@/config/features'

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

/**
 * 미리보기 대상 — 사기 전에 내 카메라에 걸어 보는 창(ItemPreviewModal).
 * 구매 확인창과 동시에 뜨지 않게 템플릿에서 하나만 그린다.
 */
const previewItem = ref<Item | null>(null)

/** 미리보기에서 바로 구매로 — 창을 갈아탄다(둘이 겹쳐 뜨면 뒤 창을 못 닫는다). */
function buyFromPreview() {
  const item = previewItem.value
  previewItem.value = null
  if (item) openConfirm(item)
}

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
  <AppPage class="shop-page" title="상점" :back="false" title-style="none" max-width="1460px" :zoom="1">
    <template #hero>
      <section class="shop-hero">
        <div class="shop-copy">
          <span class="shop-kicker">MOTION BOUTIQUE</span>
          <h1>나만의 플레이를 <em>꾸며봐요</em></h1>
          <p>가면, 반짝이는 효과, 배경까지 모션 파티에 개성을 더해요.</p>
        </div>
        <div class="shop-hero-side">
          <div class="hero-actions">
            <PixelButton variant="guest" @click="router.push({ name: RouteName.Inventory })">내 아바타</PixelButton>
          </div>
        </div>
        <img class="shop-art" src="/assets/shop-boutique-cat.png" alt="리본을 맨 고양이" />
        <div class="hero-floats" aria-hidden="true">
          <i class="accessory float-paw" :style="{ backgroundImage: `url(${catAccessories})` }" />
          <i class="accessory float-fish" :style="{ backgroundImage: `url(${catAccessories})` }" />
          <i class="accessory float-bell" :style="{ backgroundImage: `url(${catAccessories})` }" />
          <i class="accessory float-beanie" :style="{ backgroundImage: `url(${catAccessories})` }" />
        </div>
      </section>
    </template>

    <section class="shop-controls">
      <div class="section-label">
        <span>ITEM SHELF</span>
        <div class="section-title-row">
          <h2>꾸미기 아이템</h2>
          <div class="balance section-balance">
            <b><CoinIcon :size="15" /> {{ currentPoints.toLocaleString() }}</b>
          </div>
        </div>
      </div>
      <div class="chips">
      <button
        v-for="c in CATEGORIES"
        :key="c.key"
        class="chip"
        :class="{ on: active === c.key }"
        @click="active = c.key"
      >
        {{ c.label }}
      </button>
      </div>
    </section>

    <!-- 목록을 못 불러온 상태 — 아래 카드는 예시(목) 데이터라 구매할 수 없음을 밝힌다. -->
    <p v-if="loadError" class="load-error">
      <span>{{ loadError }} · 아래 목록은 예시라 구매할 수 없어요.</span>
      <PixelButton @click="reloadItems()">다시 시도</PixelButton>
    </p>

    <div class="grid">
      <article class="item ai-avatar-item">
        <div class="thumb ai-avatar-thumb" aria-hidden="true">
          <span class="avatar-spark spark-one">✦</span>
          <span class="avatar-spark spark-two">✧</span>
          <span class="avatar-face">◕ᴥ◕</span>
          <span class="avatar-wand">✦</span>
        </div>
        <div class="name">AI 아바타 만들기</div>
        <div class="row">
          <span class="price"><CoinIcon :size="13" /> 1,500</span>
          <PixelButton variant="mint" @click="router.push({ name: RouteName.AiItemCreate })">
            제작하기
          </PixelButton>
        </div>
      </article>
      <article v-for="item in filtered" :key="item.id" class="item">
        <div class="thumb">
          <img :src="thumbOf(item)" alt="" />
          <i v-if="item.owned">OWNED</i>
        </div>
        <div class="name">{{ item.name }}</div>
        <div class="row">
          <span class="price"><CoinIcon :size="13" /> {{ item.pricePoint?.toLocaleString() ?? '-' }}</span>
          <div class="row-actions">
            <!-- 보유 중인 아이템은 인벤토리에서 실제로 걸어 볼 수 있으므로 여기서는 감춘다 -->
            <PixelButton v-if="!item.owned" class="try-btn" @click="previewItem = item">보기</PixelButton>
            <PixelButton
              :variant="item.owned ? 'secondary' : 'yellow'"
              :disabled="item.owned || !!loadError"
              @click="openConfirm(item)"
            >
              {{ item.owned ? '보유중' : '구매' }}
            </PixelButton>
          </div>
        </div>
      </article>
    </div>

    <!-- 미리보기에서 바로 구매로 넘어갈 수 있다. 두 창이 겹치지 않게 미리보기를 먼저 닫는다. -->
    <ItemPreviewModal
      v-if="previewItem && !selected"
      :key="previewItem.id"
      :item="previewItem"
      @close="previewItem = null"
      @buy="buyFromPreview"
    />

    <PurchaseConfirmModal
      v-if="selected && !showCharge"
      :item="selected"
      :current-points="currentPoints"
      :pending="purchasing"
      @close="selected = null"
      @confirm="confirmPurchase"
      @charge="showCharge = POINT_CHARGE_ENABLED"
    />

    <!-- 이중 방어 — 진입 버튼이 숨겨져도 다른 경로로 켜지면 결제 화면이 열린다 -->
    <ChargePointsModal
      v-if="POINT_CHARGE_ENABLED && showCharge"
      :current-points="currentPoints"
      @close="showCharge = false"
      @charged="onCharged"
    />

    <PixelToast :message="toast" />
  </AppPage>
</template>

<style scoped>
/*
 * 스크롤바만 숨기고 스크롤은 문서가 맡는다(랭킹 화면과 같은 방식).
 *
 * 전에는 html·body에 overflow:hidden을 걸고 `.shop-page :deep(.app-shell)`을 내부 스크롤러로
 * 삼으려 했는데, 그 선택자는 매칭되지 않는다 — `class="shop-page"`는 AppPage의 루트에 붙고
 * 그 루트가 바로 `.app-shell`이다(한 요소인데 자손으로 찾고 있었다). 그래서 내부 스크롤러는
 * 만들어지지 않고 html·body 잠금만 걸려 상점이 아예 스크롤되지 않았다.
 *
 * 셀프 선택자로 고치는 길도 있지만 문서 스크롤로 되돌린다 — 팝업이 뜰 때 뒤를 잠그는
 * useScrollLock이 문서 스크롤을 기준으로 동작하고, 모달 오버레이가 `.app-shell` 안에 있어
 * 내부 스크롤러로 두면 오버레이 위에서 굴려도 뒤가 그대로 움직인다.
 */
:global(html:has(.shop-page)), :global(body:has(.shop-page)) { scrollbar-width: none; }
:global(html:has(.shop-page)::-webkit-scrollbar), :global(body:has(.shop-page)::-webkit-scrollbar) { display: none; }
.shop-page { background: #fff8e9; }.shop-page :deep(.app-page) { padding: 28px 0 48px; }.shop-page :deep(.hero), .shop-page :deep(.body) { padding-right: clamp(18px, 4vw, 58px); padding-left: clamp(18px, 4vw, 58px); }.shop-page :deep(.page-sticker) { display: none; }
.shop-hero { position: relative; display: flex; min-height: 262px; overflow: hidden; border-radius: 18px; background: url('/assets/shop-hero-bg.png') center / cover; color: #4c3d44; }.shop-hero::before { display: none; }.shop-copy { position: relative; z-index: 2; padding: 38px 46px; }.shop-kicker, .section-label span { display: block; color: #a87069; font-size: 10px; letter-spacing: 1px; }.shop-copy h1 { margin: 11px 0 9px; font-size: clamp(30px, 3vw, 43px); letter-spacing: -.8px; }.shop-copy h1 em { color: #d77c7a; font-style: normal; }.shop-copy p { margin: 0; color: #705e61; font-size: 14px; }.shop-hero-side { position: relative; z-index: 3; display: flex; margin: auto 32px 25px auto; flex-direction: column; align-items: end; gap: 10px; }.balance { min-width: 142px; padding: 12px 14px; border: 2px solid #c79b83; border-radius: 9px; background: rgba(255,253,246,.78); box-shadow: 2px 2px 0 rgba(148,105,84,.2); }.balance small { display: block; margin-bottom: 5px; color: #aa8272; font-size: 8px; }.balance b { display: flex; align-items: center; gap: 7px; color: #c47b35; font-size: 15px; }.hero-actions { display: flex; gap: 8px; }.hero-actions :deep(.px-btn) { border: 2px solid #b98771; border-radius: 7px; box-shadow: 2px 2px 0 rgba(130,82,62,.2); font-size: 10px; }.shop-art { position: absolute; right: 20%; bottom: -38px; z-index: 2; width: 400px; filter: drop-shadow(5px 6px 0 rgba(116,79,76,.14)); }
.shop-controls { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }.section-label h2 { margin: 5px 0 0; font-size: 19px; }.chips { display: flex; flex-wrap: wrap; justify-content: end; gap: 6px; }.chip { padding: 8px 11px; border: 2px solid #cfbbc5; border-radius: 7px; background: #fffdf9; color: #856d75; font-size: 10px; transition: var(--t-fast); }.chip:hover { background: #f8eef1; }.chip.on { border-color: #bd8d9c; background: #e8cbd5; color: #5e414c; box-shadow: inset 0 -3px #bd8d9c; }
.load-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 14px; padding: 11px 14px; border: 2px solid #d7abb0; border-radius: 10px; background: #fff0eb; font-size: 11px; }.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(205px, 1fr)); gap: 14px; }.item { padding: 10px; border: 2px solid #e0cfd7; border-radius: 12px; background: #fffdf9; box-shadow: 3px 3px 0 #eadde1; transition: var(--t-fast); }.item:hover { transform: translate(-2px,-2px); border-color: #cba7b5; box-shadow: 5px 5px 0 #dcc5ce; }.thumb { position: relative; display: flex; height: 142px; align-items: center; justify-content: center; overflow: hidden; border-radius: 8px; background: linear-gradient(135deg, #ede4f4, #ffe7ca); }.thumb::before { position: absolute; inset: 0; opacity: .48; background-image: radial-gradient(rgba(255,255,255,.9) 1px, transparent 1px); background-size: 11px 11px; content: ''; }.thumb img { position: relative; z-index: 1; width: 65%; height: 65%; object-fit: contain; transition: transform .15s ease; }.item:hover .thumb img { transform: translateY(-3px) rotate(-2deg); }.thumb i { position: absolute; z-index: 2; top: 8px; left: 8px; padding: 4px 6px; border-radius: 4px; background: #b5ddca; color: #527565; font-size: 7px; font-style: normal; }.name { margin: 12px 3px 0; color: #554149; font-size: 13px; }.row { display: flex; align-items: center; justify-content: space-between; margin: 9px 3px 2px; }
/* 가격 왼쪽 · 버튼 둘은 오른쪽에 나란히. 좁아지면 가격 아래로 접힌다 */
.row { flex-wrap: wrap; gap: 6px; }
.row-actions { display: flex; align-items: center; gap: 6px; }
.price { display: flex; align-items: center; color: #c47b35; font-size: 11px; }.row :deep(.px-btn) { min-height: 29px; padding: 5px 8px; border-radius: 6px; font-size: 9px; }
.row :deep(.px-btn) {
  min-width: 54px;
  border: 2px solid #925c47;
  border-radius: 6px;
  background: #f4cf77;
  box-shadow: inset 2px 2px 0 rgba(255,255,255,.42), inset -2px -2px 0 rgba(120,58,47,.18), 3px 3px 0 #a66b50;
  color: #4a3328;
}
/*
 * '보기'는 구매를 재촉하지 않는 보조 버튼이라 노란 구매 버튼과 색을 나눈다.
 * 위 .row :deep(.px-btn)이 노란 배경을 주므로 반드시 그 뒤에 와야 한다(같은 특정도라 순서로 이긴다).
 */
/* '보기'는 구매를 재촉하지 않는 보조 버튼이라 노란 구매 버튼과 색을 나눈다 */
.row :deep(.try-btn) {
  background: #fdf6e6;
  box-shadow: inset 2px 2px 0 rgba(255, 255, 255, .8), inset -2px -2px 0 rgba(146, 92, 71, .12), 3px 3px 0 #c9a98f;
  color: #7a5540;
}
.row :deep(.try-btn:hover) { background: #fffdf7; }
.row :deep(.px-btn:hover:not(:disabled)) {
  transform: translate(-2px, -2px);
  box-shadow: inset 2px 2px 0 rgba(255,255,255,.42), inset -2px -2px 0 rgba(120,58,47,.18), 3px 3px 0 #a66b50;
}
.row :deep(.px-btn:active:not(:disabled)) {
  transform: translate(1px, 1px);
  box-shadow: inset 2px 2px 0 rgba(255,255,255,.42), inset -2px -2px 0 rgba(120,58,47,.18), 1px 1px 0 #a66b50;
}
.row :deep(.px-btn:disabled) { border-color: #a59080; background: #e4ddd5; color: #887b72; box-shadow: 2px 2px 0 #c8b9ac; }
.item .name { font-size: 16px; }
.item .price { font-size: 14px; }
.item .row { align-items: flex-end; }
.row :deep(.px-btn) { min-height: 36px; padding: 6px 11px; font-size: 12px; }
@media (max-width: 760px) {
  .item .name { font-size: 14px; }
  .item .price { font-size: 12px; }
  .row :deep(.px-btn) { min-height: 33px; font-size: 11px; }
}
.chip { padding: 10px 15px; font-size: 14px; }
.chip { border-color: #d6a46c; background: #fff0b9; color: #6d513b; box-shadow: 2px 2px 0 rgba(166,107,80,.22); }
.chip:hover { background: #ffe59a; }
.chip.on { border-color: #a96d45; background: #f4cf77; color: #4a3328; box-shadow: inset 0 -3px rgba(169,109,69,.3); }
@media (max-width: 760px) { .chip { padding: 8px 12px; font-size: 12px; } }
.hero-floats { position: absolute; inset: 0; z-index: 1; pointer-events: none; overflow: hidden; }
.accessory { position: absolute; display: block; width: 96px; height: 96px; background-repeat: no-repeat; background-size: 200% 200%; filter: drop-shadow(3px 4px 0 rgba(116,79,76,.16)); animation: boutique-float 4.5s ease-in-out infinite; }
.float-paw { top: 8px; left: 48%; background-position: 0 0; }
.float-fish { top: 39px; right: 10%; background-position: 100% 0; animation-delay: -1.2s !important; }
.float-bell { bottom: 8px; left: 40%; background-position: 0 100%; animation-delay: -2.4s !important; }
.float-beanie { top: 86px; right: 29%; background-position: 100% 100%; animation-delay: -3.1s !important; }
@keyframes boutique-float { 0%, 100% { transform: translateY(0) rotate(-4deg); } 50% { transform: translateY(-10px) rotate(4deg); } }
@media (max-width: 760px) { .float-bell, .float-beanie { display: none; } .accessory { width: 74px; height: 74px; } .float-paw { left: 56%; } .float-fish { right: 26%; } }
@media (max-width: 760px) { .shop-page :deep(.app-page) { padding-top: 20px; }.shop-hero { min-height: 310px; }.shop-copy { padding: 28px 25px; }.shop-copy h1 { max-width: 86%; font-size: 31px; }.shop-copy p { max-width: 76%; font-size: 12px; }.shop-art { right: -54px; bottom: -20px; width: 280px; opacity: .85; }.shop-hero-side { right: 15px; bottom: 14px; margin: 0; position: absolute; }.hero-actions { display: none; }.shop-controls { align-items: start; flex-direction: column; }.chips { justify-content: start; }.grid { grid-template-columns: repeat(auto-fill, minmax(175px, 1fr)); } }
.ai-avatar-item { border-color: #b69ad5; background: #fffaff; box-shadow: 3px 3px 0 #dacbe8; }
.ai-avatar-thumb { background: linear-gradient(135deg, #e6dcff, #cfeef1); }
.ai-avatar-thumb::before { opacity: .32; }
.avatar-face { position: relative; z-index: 1; display: grid; width: 78px; height: 70px; place-items: center; border: 3px solid #6a5079; border-radius: 48% 48% 42% 42%; background: #ffd9b3; color: #5b405e; font-size: 24px; letter-spacing: -4px; box-shadow: inset 0 -7px rgba(181,122,102,.2); }
.avatar-wand { position: absolute; z-index: 2; right: 23%; bottom: 20%; color: #9a72d8; font-size: 29px; transform: rotate(22deg); }
.avatar-spark { position: absolute; z-index: 2; color: #f2aa4c; font-size: 21px; animation: avatar-sparkle 1.8s steps(2) infinite; }
.spark-one { top: 17%; left: 22%; }
.spark-two { right: 18%; top: 27%; color: #9a72d8; animation-delay: -.8s; }
.ai-avatar-item .row :deep(.px-btn) { background: #b99ae0; color: #fff; }
@keyframes avatar-sparkle { 0%,100% { transform: scale(.85) rotate(0); } 50% { transform: scale(1.14) rotate(14deg); } }
.section-title-row { display: flex; align-items: center; gap: 10px; }
.section-balance { min-width: 0; display: flex; align-items: center; gap: 7px; padding: 6px 9px; border-color: #d6a46c; background: #fff9df; box-shadow: 2px 2px 0 rgba(166,107,80,.18); }
.section-balance small { display: inline; margin: 0; font-size: 9px; }
.section-balance b { font-size: 13px; }
@media (max-width: 760px) { .section-title-row { gap: 8px; } .section-balance { padding: 5px 7px; } }
.shop-copy { position: relative; z-index: 2; padding: 38px 46px; }
.shop-kicker { display: inline; color: #a8704f; font-size: 10px; letter-spacing: 1px; }
.shop-copy h1 { font-family: var(--font-pixel); font-weight: 400; }
.hero-actions :deep(.px-btn) { min-width: 112px; height: 45px; border: 3px solid #925c47; border-radius: 7px; background: #f4cf77; box-shadow: inset 2px 2px 0 rgba(255,255,255,.45), inset -2px -3px 0 rgba(120,58,47,.2), 4px 4px 0 #a66b50; color: #4a3328; font-size: 14px; letter-spacing: .4px; text-shadow: 1px 1px rgba(255,255,255,.45); }
.hero-actions :deep(.px-btn:hover:not(:disabled)) { transform: translate(-2px, -2px); box-shadow: inset 2px 2px 0 rgba(255,255,255,.45), inset -2px -3px 0 rgba(120,58,47,.2), 4px 4px 0 #a66b50; }
@media (max-width: 760px) { .shop-copy { padding: 28px 25px; } }
</style>
