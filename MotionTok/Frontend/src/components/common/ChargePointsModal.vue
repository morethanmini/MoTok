<script setup lang="ts">
/**
 * 포인트 충전 모달 (초안).
 * 1단계: 충전 금액 선택 (100/500/1000/2000/5000/10000 P)
 * 2단계: 결제창 초안 (결제 수단 선택 + 금액 확인 + 결제)
 * 실제 결제(PG 연동)는 TODO — confirm 시 charged(amount) emit.
 */
import { computed, ref } from 'vue'
import PixelModal from './PixelModal.vue'
import PixelButton from './PixelButton.vue'
import CoinIcon from './CoinIcon.vue'

const props = defineProps<{ currentPoints: number }>()
const emit = defineEmits<{ close: []; charged: [amount: number] }>()

const AMOUNTS = [100, 500, 1000, 2000, 5000, 10000]
// 충전 금액별 보너스 포인트
const BONUS: Record<number, number> = { 2000: 100, 5000: 500, 10000: 2000 }
const bonusOf = (a: number) => BONUS[a] ?? 0
const METHODS = [
  { key: 'card', label: '신용/체크카드', emoji: '💳' },
  { key: 'kakao', label: '카카오페이', emoji: '🟡' },
  { key: 'toss', label: '토스페이', emoji: '🔵' },
  { key: 'naver', label: '네이버페이', emoji: '🟢' },
]

const step = ref<'select' | 'pay'>('select')
const amount = ref<number>(1000)
const method = ref('card')

// 1P = 1원 가정 (초안). 결제 금액은 기본 금액 기준, 지급 포인트는 보너스 포함.
const bonus = computed(() => bonusOf(amount.value))
const totalPoints = computed(() => amount.value + bonus.value)
const won = computed(() => amount.value.toLocaleString())
const afterPoints = computed(() => (props.currentPoints + totalPoints.value).toLocaleString())

function pay() {
  // TODO: 실제 PG 결제 연동 (결제 성공 콜백에서 charged emit)
  emit('charged', totalPoints.value)
  emit('close')
}
</script>

<template>
  <PixelModal @close="emit('close')">
    <div class="charge">
      <button class="close" title="닫기" @click="emit('close')">✕</button>

      <!-- ── 1단계: 금액 선택 ── -->
      <template v-if="step === 'select'">
        <h3>포인트 충전</h3>

        <div class="balance">
          <CoinIcon :size="34" />
          <div>
            <div class="bal-cap">현재 보유 포인트</div>
            <div class="bal-val">{{ currentPoints.toLocaleString() }} P</div>
          </div>
        </div>

        <div class="amounts">
          <button
            v-for="a in AMOUNTS"
            :key="a"
            class="amount"
            :class="{ on: amount === a }"
            @click="amount = a"
          >
            <CoinIcon :size="20" />
            <span class="p">{{ a.toLocaleString() }} P</span>
            <span v-if="bonusOf(a)" class="bonus">+{{ bonusOf(a).toLocaleString() }} P</span>
            <span class="w">₩{{ a.toLocaleString() }}</span>
          </button>
        </div>

        <div class="summary">
          <span>충전 후 보유</span>
          <b><CoinIcon :size="16" /> {{ afterPoints }} P</b>
        </div>

        <div class="actions">
          <PixelButton block @click="emit('close')">취소</PixelButton>
          <PixelButton variant="primary" block @click="step = 'pay'">결제하기</PixelButton>
        </div>
      </template>

      <!-- ── 2단계: 결제창 초안 ── -->
      <template v-else>
        <h3>결제</h3>

        <div class="pay-summary">
          <div class="row"><span>충전 포인트</span><b><CoinIcon :size="16" /> {{ amount.toLocaleString() }} P</b></div>
          <div v-if="bonus" class="row"><span>보너스</span><b class="bonus-txt">+{{ bonus.toLocaleString() }} P</b></div>
          <div v-if="bonus" class="row"><span>총 지급</span><b><CoinIcon :size="16" /> {{ totalPoints.toLocaleString() }} P</b></div>
          <div class="row total"><span>결제 금액</span><b>₩ {{ won }}</b></div>
        </div>

        <div class="methods">
          <button
            v-for="m in METHODS"
            :key="m.key"
            class="method"
            :class="{ on: method === m.key }"
            @click="method = m.key"
          >
            <span class="emoji">{{ m.emoji }}</span>{{ m.label }}
          </button>
        </div>

        <p class="notice">※ 결제창은 초안입니다. 실제 결제(PG) 연동은 추후 붙일 예정이에요.</p>

        <div class="actions">
          <PixelButton block @click="step = 'select'">← 이전</PixelButton>
          <PixelButton variant="primary" block @click="pay">₩{{ won }} 결제하기</PixelButton>
        </div>
      </template>
    </div>
  </PixelModal>
</template>

<style scoped>
.charge { position: relative; }
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

.balance {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 2px solid var(--c-ink);
  border-radius: 13px;
  background: #fff7d9;
  margin-bottom: 16px;
}
.bal-cap { font-size: 9px; color: var(--c-muted); }
.bal-val { font-size: 16px; font-weight: 700; color: #d79600; margin-top: 2px; }

.amounts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }
.amount {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 6px;
  border: 2px solid var(--c-ink);
  border-radius: 12px;
  background: #fff;
  box-shadow: var(--shadow-sm);
}
.amount.on { background: #fff0b9; box-shadow: var(--shadow-md); }
.amount .p { font-size: 12px; font-weight: 700; }
.amount .bonus { font-size: 9px; font-weight: 700; color: #f0821e; }
.amount .w { font-size: 9px; color: var(--c-muted); }
.bonus-txt { color: #f0821e; }

.summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 16px 0;
  padding: 11px 14px;
  border: 2px solid var(--c-ink);
  border-radius: 12px;
  background: var(--c-mint-soft);
  font-size: 12px;
}
.summary b { display: inline-flex; align-items: center; gap: 5px; color: #2f8f6f; }

/* 결제 단계 */
.pay-summary { border: 2px solid var(--c-ink); border-radius: 13px; overflow: hidden; margin-bottom: 16px; }
.pay-summary .row { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; font-size: 12px; }
.pay-summary .row + .row { border-top: 2px dashed #eaddea; }
.pay-summary .row b { display: inline-flex; align-items: center; gap: 5px; }
.pay-summary .total { background: #fff7d9; }
.pay-summary .total b { font-size: 15px; color: #d79600; }

.methods { display: grid; gap: 8px; }
.method {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 14px;
  border: 2px solid var(--c-ink);
  border-radius: 12px;
  background: #fff;
  font-size: 12px;
  font-weight: 700;
}
.method.on { background: #fff0b9; box-shadow: var(--shadow-sm); }
.method .emoji { font-size: 18px; }

.notice { margin: 14px 0; font-size: 9px; color: var(--c-muted); line-height: 1.6; }
.actions { display: flex; gap: 9px; margin-top: 6px; }
</style>
