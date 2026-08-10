<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { BOM_ORDER_CANCEL_BLOCK_LABELS } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  useBomOrderCancelPreview,
  useCancelBomOrder,
} from '../../../admin/useAdminBomOrders';
import { smartbomFmtWon } from '../../../admin/smartbom';

const props = defineProps<{ quoteId: string }>();
const emit = defineEmits<{ close: []; done: []; openCase: [] }>();

const quoteIdRef = computed<string | null>(() => props.quoteId);
const previewQuery = useBomOrderCancelPreview(quoteIdRef);
const preview = computed(() => previewQuery.data.value?.data ?? null);
const reason = ref('');
const validationError = ref('');
const cancelOrder = useCancelBomOrder();
const dialogEl = ref<HTMLElement | null>(null);
const reasonEl = ref<HTMLTextAreaElement | null>(null);
const closeButtonEl = ref<HTMLButtonElement | null>(null);
let previousFocus: HTMLElement | null = null;
let previousBodyOverflow = '';

const actionError = computed(() => {
  const error = cancelOrder.error.value;
  if (error === null) return '';
  return error instanceof ApiRequestError
    ? (error.payload?.message ?? error.message)
    : 'BOM 주문 취소에 실패했습니다.';
});

const previewError = computed(() => {
  const error = previewQuery.error.value;
  if (error === null) return '';
  return error instanceof ApiRequestError
    ? (error.payload?.message ?? error.message)
    : '취소 가능 여부를 확인하지 못했습니다.';
});

async function submit(): Promise<void> {
  const value = reason.value.trim();
  if (value.length < 2) {
    validationError.value = '취소 사유를 2자 이상 입력해 주세요.';
    return;
  }
  validationError.value = '';
  try {
    await cancelOrder.mutateAsync({ quoteId: props.quoteId, reason: value });
  } catch {
    // mutation.error를 본문에 표시한다.
  }
}

function close(): void {
  if (cancelOrder.isPending.value) return;
  if (cancelOrder.isSuccess.value) emit('done');
  else emit('close');
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(): HTMLElement[] {
  const dialog = dialogEl.value;
  if (dialog === null) return [];
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'Tab') return;

  const dialog = dialogEl.value;
  if (dialog === null) return;
  const focusable = focusableElements();
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
};

onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  window.addEventListener('keydown', onKeydown);
  await nextTick();
  dialogEl.value?.focus();
});

watch(preview, async (value) => {
  if (value?.cancelable !== true || cancelOrder.isSuccess.value) return;
  await nextTick();
  if (document.activeElement === dialogEl.value) reasonEl.value?.focus();
});

watch(() => cancelOrder.isSuccess.value, async (success) => {
  if (!success) return;
  await nextTick();
  closeButtonEl.value?.focus();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = previousBodyOverflow;
  previousFocus?.focus();
  previousFocus = null;
});
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40" @click="close" />
      <section
        ref="dialogEl"
        class="relative w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bom-order-cancel-title"
        tabindex="-1"
      >
        <header class="border-b border-gray-200 px-5 py-4">
          <h2 id="bom-order-cancel-title" class="text-base font-bold text-red-700">
            Smart BOM 주문 취소
          </h2>
          <p class="mt-0.5 text-xs text-gray-400">
            묶음 주문에서는 선택한 BOM Case의 주문행만 취소할 수 있습니다.
          </p>
        </header>

        <div class="px-5 py-4">
          <div v-if="previewQuery.isLoading.value" class="py-8 text-center text-sm text-gray-400">
            취소 가능 여부를 확인하고 있습니다…
          </div>
          <div
            v-else-if="previewError !== ''"
            class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {{ previewError }}
          </div>
          <template v-else-if="preview !== null">
            <dl class="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 rounded-lg bg-gray-50 px-3 py-3 text-sm">
              <dt class="text-gray-400">대상</dt>
              <dd class="font-semibold text-gray-800">{{ preview.title }}</dd>
              <dt class="text-gray-400">주문번호</dt>
              <dd class="font-mono text-xs text-gray-600">{{ preview.odId }}</dd>
              <dt class="text-gray-400">주문 / 항목</dt>
              <dd class="text-gray-700">{{ preview.odStatus }} / {{ preview.ctStatus }}</dd>
              <dt class="text-gray-400">결제</dt>
              <dd class="text-gray-700">
                {{ preview.settleCase || '—' }} · 수납 {{ smartbomFmtWon(preview.receiptPrice) }}
              </dd>
            </dl>

            <div v-if="cancelOrder.isSuccess.value" class="mt-3 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-700" role="status">
              <p class="font-semibold">BOM 주문 취소가 완료되었습니다.</p>
              <p class="mt-1 text-xs">
                {{ cancelOrder.data.value?.data.orderCancelled === true
                  ? '주문 전체가 취소 상태로 이동했습니다.'
                  : '선택한 BOM 항목만 취소됐고 나머지 주문은 유지됩니다.' }}
              </p>
            </div>

            <template v-else-if="preview.cancelable">
              <div
                class="mt-3 rounded-lg border px-3 py-2.5 text-sm"
                :class="preview.cancelsWholeOrder
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-amber-200 bg-amber-50 text-amber-800'"
              >
                <p v-if="preview.cancelsWholeOrder" class="font-semibold">
                  이 Case가 마지막 활성 항목이어서 주문 전체가 취소됩니다.
                </p>
                <p v-else class="font-semibold">
                  이 BOM 항목만 취소되며 다른 활성 항목 {{ preview.activeSiblingCount }}개는 유지됩니다.
                </p>
                <p class="mt-1 text-xs font-normal opacity-80">
                  취소금액·미수금·세액은 영카트 규칙으로 다시 계산됩니다.
                </p>
              </div>

              <label class="mt-4 block">
                <span class="text-sm font-semibold text-gray-700">취소 사유 <b class="text-red-600">*</b></span>
                <textarea
                  ref="reasonEl"
                  v-model="reason"
                  rows="3"
                  maxlength="500"
                  placeholder="예: 고객 요청으로 결제 전 일부 주문 취소"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none"
                  @input="validationError = ''"
                />
                <span class="mt-1 block text-xs text-gray-400">영카트 주문 변경이력에 기록됩니다.</span>
              </label>
              <p v-if="validationError !== ''" class="mt-2 text-sm text-red-600">
                {{ validationError }}
              </p>
              <p v-if="actionError !== ''" class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {{ actionError }}
              </p>
              <p class="mt-3 text-xs leading-5 text-gray-400">
                고객 안내 메일은 자동 발송되지 않습니다. 취소된 견적은 고객 화면에서 다시 주문할 수 있습니다.
              </p>
            </template>

            <div
              v-else
              class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800"
            >
              <p class="font-semibold">
                {{ preview.blockReason === null
                  ? '이 화면에서 취소할 수 없습니다.'
                  : BOM_ORDER_CANCEL_BLOCK_LABELS[preview.blockReason] }}
              </p>
              <p v-if="preview.poCount > 0" class="mt-1 text-xs">
                연결된 발주서 {{ preview.poCount }}건
              </p>
              <p class="mt-1 text-xs font-normal opacity-80">
                결제 승인 취소나 환불을 확인하기 전에 로컬 주문 상태를 먼저 변경하지 않습니다.
              </p>
            </div>
          </template>
        </div>

        <footer class="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            v-if="preview !== null && !preview.cancelable && preview.blockReason === 'PARTNER_PROCESS_EXISTS'"
            type="button"
            class="rounded-lg border border-blue-200 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"
            @click="emit('openCase')"
          >
            BOM Case 확인
          </button>
          <a
            v-if="preview !== null && !preview.cancelable && (preview.blockReason === 'PAYMENT_RECEIVED' || preview.blockReason === 'YOUNGCART_REQUIRED')"
            :href="preview.youngcartOrderUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-50"
          >
            영카트 주문관리에서 처리 ↗
          </a>
          <button
            ref="closeButtonEl"
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40"
            :disabled="cancelOrder.isPending.value"
            @click="close"
          >
            {{ cancelOrder.isSuccess.value ? '확인' : '닫기' }}
          </button>
          <button
            v-if="preview?.cancelable === true && !cancelOrder.isSuccess.value"
            type="button"
            class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
            :disabled="cancelOrder.isPending.value"
            @click="void submit()"
          >
            {{ cancelOrder.isPending.value ? '취소 처리 중…' : 'BOM 주문 취소' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
