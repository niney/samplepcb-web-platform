<script setup lang="ts">
import { computed, ref } from 'vue';
import { MARKET_CONTRACT_STATUS_LABELS } from '@sp/api-contract';
import type { MarketContractStatusType, MarketContractType } from '@sp/api-contract';
import { contractStatusClass, daysUntil, won } from '../lib/market-format';

// 계약 카드 — 채택 후 표면(당사자: 의뢰인·채택 전문가). 거래 스텝(결제→작업→납품→검수→정산)
// 표시 + 역할별 액션. 서버 상태(useMarketContract)는 페이지가 소유하고, 이 카드는 표시와
// 액션 의도(checkout/confirm/cancel/report/download) emit 만 담당한다. 확정·취소는 인라인
// 확인 UI(네이티브 confirm 미사용).

const props = defineProps<{
  contract: MarketContractType;
  isOwner: boolean;
  checkoutPending: boolean;
  confirmPending: boolean;
  cancelPending: boolean;
  error: string;
}>();
const emit = defineEmits<{
  checkout: [];
  confirm: [];
  cancel: [];
  report: [];
  download: [fileId: number, name: string];
}>();

const STEPS: MarketContractStatusType[] = ['pending', 'paid', 'delivered', 'completed', 'settled'];
const currentIndex = computed(() => STEPS.indexOf(props.contract.status));
const isCancelled = computed(() => props.contract.status === 'cancelled');

const feePct = computed(() => (props.contract.feeRateBp / 100).toFixed(1));

// delivered ∧ 미hold 일 때 서버가 채워주는 자동확정 시각 → D-day 문구.
const autoConfirmText = computed<string | null>(() => {
  const at = props.contract.autoConfirmAt;
  if (at === null) return null;
  const d = daysUntil(at);
  return d > 0 ? `${String(d)}일 후 자동 확정됩니다` : '곧 자동 확정됩니다';
});

// pending 이면서 무통장 주문이 걸려 있으면(payment 존재) 재결제 대신 입금 안내를 보인다.
const hasPendingOrder = computed(
  () => props.contract.status === 'pending' && props.contract.payment !== null,
);

const confirmMode = ref<'confirm' | 'cancel' | null>(null);

const fmtSize = (bytes: number): string =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024)).toString()}KB`;
</script>

<template>
  <div class="rounded-2xl border border-line bg-white p-5">
    <div class="flex items-center justify-between gap-2">
      <p class="text-sm font-extrabold text-tx-1">계약 진행</p>
      <span
        class="rounded-md px-2 py-0.5 text-[11px] font-bold"
        :class="contractStatusClass[contract.status]"
      >
        {{ MARKET_CONTRACT_STATUS_LABELS[contract.status] }}
      </span>
    </div>

    <!-- 금액 -->
    <div class="mt-3 rounded-xl bg-paper p-3 text-xs text-tx-2">
      <p>
        계약 금액 <b class="text-sm font-extrabold text-tx-1">{{ won(contract.amount) }}</b>
      </p>
      <p v-if="!isOwner" class="mt-1">
        수수료 {{ feePct }}% 공제 후 실수령
        <b class="text-tx-1">{{ won(contract.payoutAmount) }}</b>
      </p>
    </div>

    <!-- 거래 스텝 -->
    <ol v-if="!isCancelled" class="mt-4 grid gap-2">
      <li v-for="(s, i) in STEPS" :key="s" class="flex items-center gap-2.5 text-xs">
        <span
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
          :class="
            i < currentIndex
              ? 'bg-ink-900 text-white'
              : i === currentIndex
                ? 'bg-copper-500 text-white'
                : 'bg-line text-tx-3'
          "
        >
          {{ i < currentIndex ? '✓' : i + 1 }}
        </span>
        <span
          :class="
            i === currentIndex
              ? 'font-bold text-tx-1'
              : i < currentIndex
                ? 'text-tx-2'
                : 'text-tx-3'
          "
        >
          {{ MARKET_CONTRACT_STATUS_LABELS[s] }}
        </span>
      </li>
    </ol>

    <!-- 취소 배너 -->
    <div v-else class="mt-4 rounded-xl bg-gray-100 p-3 text-xs text-tx-2">
      <p class="font-bold text-tx-1">취소된 계약입니다.</p>
      <p v-if="contract.cancelReason !== null" class="mt-1">사유: {{ contract.cancelReason }}</p>
    </div>

    <!-- 산출물 -->
    <div v-if="contract.files.length > 0" class="mt-4">
      <p class="text-xs font-bold text-tx-2">산출물</p>
      <ul class="mt-2 grid gap-2">
        <li
          v-for="f in contract.files"
          :key="f.fileId"
          class="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs"
        >
          <span>📦</span>
          <span class="min-w-0 flex-1 truncate text-tx-1">{{ f.name }}</span>
          <span class="text-tx-3">{{ fmtSize(f.size) }}</span>
          <button
            type="button"
            class="rounded-md border border-line px-2 py-1 font-bold text-tx-2 hover:border-copper-400 hover:text-copper-600"
            @click="emit('download', f.fileId, f.name)"
          >
            받기
          </button>
        </li>
      </ul>
    </div>

    <!-- 전달 메모 -->
    <div
      v-if="contract.deliveryNote !== null && contract.deliveryNote !== ''"
      class="mt-3 whitespace-pre-line rounded-lg bg-paper p-3 text-xs leading-relaxed text-tx-2"
    >
      {{ contract.deliveryNote }}
    </div>

    <!-- ── 의뢰인 액션 ─────────────────────────────────────────────────────── -->
    <template v-if="isOwner">
      <!-- pending: 결제 / 취소 -->
      <template v-if="contract.status === 'pending'">
        <!-- 무통장 입금 대기 안내 -->
        <div
          v-if="hasPendingOrder && contract.payment !== null"
          class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-tx-2"
        >
          <p class="font-bold text-amber-700">무통장 입금 대기 중</p>
          <p class="mt-1">
            주문번호 <b class="text-tx-1">{{ contract.payment.odId }}</b>
          </p>
          <p v-if="contract.payment.misu > 0">
            미입금액 <b class="text-tx-1">{{ won(contract.payment.misu) }}</b>
          </p>
          <p class="mt-1">입금이 확인되면 자동으로 반영됩니다.</p>
          <p class="mt-1 text-tx-3">결제 취소·변경은 고객센터(070-8667-1080)로 문의해 주세요.</p>
        </div>

        <!-- 결제하기 + 계약 취소(입금 대기 없을 때만) -->
        <div v-else class="mt-4 grid gap-2">
          <button
            type="button"
            class="rounded-lg bg-copper-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-copper-600 disabled:opacity-40"
            :disabled="checkoutPending"
            @click="emit('checkout')"
          >
            {{ checkoutPending ? '결제 준비 중…' : '결제하기' }}
          </button>
          <template v-if="confirmMode === 'cancel'">
            <p class="text-xs font-bold text-red-600">계약을 취소할까요? 되돌릴 수 없습니다.</p>
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                :disabled="cancelPending"
                @click="emit('cancel')"
              >
                {{ cancelPending ? '취소 중…' : '취소 확정' }}
              </button>
              <button
                type="button"
                class="flex-1 rounded-lg border border-line px-3 py-2 text-xs font-bold text-tx-2"
                @click="confirmMode = null"
              >
                닫기
              </button>
            </div>
          </template>
          <button
            v-else
            type="button"
            class="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-500 hover:border-red-400"
            @click="confirmMode = 'cancel'"
          >
            계약 취소
          </button>
        </div>
      </template>

      <!-- paid: 작업 진행 안내 -->
      <p v-else-if="contract.status === 'paid'" class="mt-4 text-xs leading-relaxed text-tx-3">
        결제가 완료되어 작업이 진행 중입니다. 전문가가 납품하면 검수해 주세요.
      </p>

      <!-- delivered: 검수 확정 -->
      <div v-else-if="contract.status === 'delivered'" class="mt-4 grid gap-2">
        <p v-if="autoConfirmText !== null" class="text-xs font-semibold text-copper-600">
          {{ autoConfirmText }}
        </p>
        <template v-if="confirmMode === 'confirm'">
          <p class="text-xs font-bold text-tx-2">검수를 확정할까요? 확정 후에는 되돌릴 수 없습니다.</p>
          <div class="flex gap-2">
            <button
              type="button"
              class="flex-1 rounded-lg bg-copper-500 px-3 py-2 text-xs font-bold text-white hover:bg-copper-600 disabled:opacity-40"
              :disabled="confirmPending"
              @click="emit('confirm')"
            >
              {{ confirmPending ? '처리 중…' : '검수 확정' }}
            </button>
            <button
              type="button"
              class="flex-1 rounded-lg border border-line px-3 py-2 text-xs font-bold text-tx-2"
              @click="confirmMode = null"
            >
              취소
            </button>
          </div>
        </template>
        <button
          v-else
          type="button"
          class="rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-ink-800"
          @click="confirmMode = 'confirm'"
        >
          검수 확정
        </button>
      </div>

      <!-- completed / settled -->
      <p v-else-if="contract.status === 'completed'" class="mt-4 text-xs leading-relaxed text-tx-3">
        검수가 확정되었습니다. 전문가 정산 처리를 기다리는 중입니다.
      </p>
      <p v-else-if="contract.status === 'settled'" class="mt-4 text-xs leading-relaxed text-tx-3">
        정산까지 완료된 계약입니다. 이용해 주셔서 감사합니다.
      </p>
    </template>

    <!-- ── 전문가 액션 ─────────────────────────────────────────────────────── -->
    <template v-else>
      <p v-if="contract.status === 'pending'" class="mt-4 text-xs leading-relaxed text-tx-3">
        의뢰인의 결제를 기다리는 중입니다. 결제가 완료되면 작업을 시작할 수 있습니다.
      </p>

      <button
        v-else-if="contract.status === 'paid'"
        type="button"
        class="mt-4 w-full rounded-lg bg-copper-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-copper-600"
        @click="emit('report')"
      >
        작업 완료 보고
      </button>

      <div v-else-if="contract.status === 'delivered'" class="mt-4 grid gap-2">
        <p v-if="autoConfirmText !== null" class="text-xs font-semibold text-copper-600">
          의뢰인 검수 대기 · {{ autoConfirmText }}
        </p>
        <button
          type="button"
          class="rounded-lg border border-line px-4 py-2.5 text-sm font-bold text-tx-2 hover:border-line-2"
          @click="emit('report')"
        >
          산출물 추가 보고
        </button>
      </div>

      <p v-else-if="contract.status === 'completed'" class="mt-4 text-xs leading-relaxed text-tx-3">
        검수가 확정되었습니다. 정산을 준비 중입니다.
      </p>
      <p v-else-if="contract.status === 'settled'" class="mt-4 text-xs leading-relaxed text-tx-3">
        정산이 완료되었습니다. 수고하셨습니다.
      </p>
    </template>

    <p v-if="error !== ''" class="mt-3 text-xs font-semibold text-red-600">{{ error }}</p>
  </div>
</template>
