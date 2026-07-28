<script setup lang="ts">
/** 상점 구매 확인 모달 — 아이템 정보 + 현재/구매 후 포인트 + 취소/구매. */
import { computed } from 'vue'
import type { Item, ItemCategory } from '@/api'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import CoinIcon from '@/components/common/CoinIcon.vue'

/** pending — 구매 요청 진행 중. 버튼을 잠가 연타로 두 번 결제되는 걸 막는다. */
const props = defineProps<{ item: Item; currentPoints: number; pending?: boolean }>()
const emit = defineEmits<{ close: []; confirm: []; charge: [] }>()

const CATEGORY_LABEL: Record<ItemCategory, string> = {
  MASK: '가면', EFFECT: '효과', STICKER: '스티커', BACKGROUND: '배경',
}
const EMOJI: Record<ItemCategory, string> = {
  MASK: '🎭', EFFECT: '✨', STICKER: '🌟', BACKGROUND: '🌌',
}

const price = computed(() => props.item.pricePoint ?? 0)
const after = computed(() => props.currentPoints - price.value)
const short = computed(() => after.value < 0)
</script>

<template>
  <PixelModal @close="emit('close')">
    <div class="pc">
      <button class="close" title="닫기" @click="emit('close')">✕</button>

      <h3>구매하시겠습니까?</h3>

      <div class="item">
        <div class="thumb">
          <img v-if="item.imageUrl" :src="item.imageUrl" alt="" />
          <template v-else>{{ EMOJI[item.category] }}</template>
        </div>
        <div class="info">
          <div class="name">{{ item.name }}</div>
          <div class="cat">{{ CATEGORY_LABEL[item.category] }}</div>
        </div>
        <div class="price"><CoinIcon :size="15" /> {{ price.toLocaleString() }}</div>
      </div>

      <dl class="points">
        <div class="row"><dt>현재 포인트</dt><dd><CoinIcon :size="14" /> {{ currentPoints.toLocaleString() }}</dd></div>
        <div class="row"><dt>구매 후 포인트</dt><dd :class="{ neg: short }"><CoinIcon :size="14" /> {{ after.toLocaleString() }}</dd></div>
      </dl>

      <p v-if="short" class="warn">포인트가 부족해요. 충전 후 구매할 수 있어요.</p>

      <div class="actions">
        <PixelButton block :disabled="pending" @click="emit('close')">취소</PixelButton>
        <PixelButton v-if="short" variant="yellow" block :disabled="pending" @click="emit('charge')">
          포인트 충전
        </PixelButton>
        <PixelButton v-else variant="primary" block :disabled="pending" @click="emit('confirm')">
          {{ pending ? '구매 중…' : '구매' }}
        </PixelButton>
      </div>
    </div>
  </PixelModal>
</template>

<style scoped>
.pc { position: relative; }
.close {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 30px;
  height: 30px;
  border: 2px solid var(--c-ink);
  border-radius: 9px;
  background: #fff;
  box-shadow: 2px 2px 0 var(--c-ink);
  font-size: 12px;
}
h3 { margin: 4px 0 16px; }

.item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 2px solid var(--c-ink);
  border-radius: 13px;
  background: #fffdf3;
}
/* ShopView .thumb와 같은 이유로 flex — grid + auto 행에서는 이미지 height:100%가 auto로 풀려 잘린다. */
.thumb { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 4px; font-size: 26px; border: 2px solid var(--c-ink); border-radius: 11px; background: var(--tone-4); }
.thumb img { width: 100%; height: 100%; object-fit: contain; }
.info { min-width: 0; }
.name { font-size: 13px; font-weight: 700; }
.cat { font-size: 9px; color: var(--c-muted); margin-top: 3px; }
.price { margin-left: auto; font-size: 13px; font-weight: 700; color: #d79600; }

.points { margin: 16px 0; padding: 0; }
.points .row { display: flex; justify-content: space-between; padding: 8px 2px; border-bottom: 2px dashed #eaddea; font-size: 12px; }
.points dt { color: var(--c-muted); font-weight: 700; }
.points dd { margin: 0; font-weight: 700; }
.points dd.neg { color: var(--c-coral); }

.warn { margin: -4px 0 12px; font-size: 10px; color: var(--c-coral); }
.actions { display: flex; gap: 9px; }
</style>
