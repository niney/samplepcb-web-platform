<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { PCB_ORDER_CANCEL_BLOCK_LABELS } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useCancelPcbOrder, usePcbOrderCancelPreview } from '../../../admin/useAdminPcbOrders';
import { fmtPcbAmount } from '../../../lib/pcb-money';

const props = defineProps<{ specId: number }>();
const emit = defineEmits<{ close: []; done: []; openCase: [] }>();

const specIdRef = computed<number | null>(() => props.specId);
const previewQuery = usePcbOrderCancelPreview(specIdRef);
const preview = computed(() => previewQuery.data.value?.data ?? null);
const reason = ref('');
const validationError = ref('');
const cancelOrder = useCancelPcbOrder();

const actionError = computed(() => {
  const error = cancelOrder.error.value;
  if (error === null) return '';
  return error instanceof ApiRequestError
    ? (error.payload?.message ?? error.message)
    : '주문 취소에 실패했습니다.';
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
    await cancelOrder.mutateAsync({ specId: props.specId, reason: value });
  } catch {
    // mutation.error를 본문에 표시한다. 버튼 이벤트 Promise rejection은 여기서 소비한다.
  }
}

function close(): void {
  if (cancelOrder.isPending.value) return;
  if (cancelOrder.isSuccess.value) emit('done');
  else emit('close');
}

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') close();
};
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40" @click="close" />
      <section
        class="relative w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pcb-order-cancel-title"
      >
        <header class="border-b border-gray-200 px-5 py-4">
          <h2 id="pcb-order-cancel-title" class="text-base font-bold text-red-700">
            PCB 주문 취소
          </h2>
          <p class="mt-0.5 text-xs text-gray-400">
            영카트 주문행과 PCB 협력 진행 상태를 함께 확인합니다.
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
            <dl
              class="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 rounded-lg bg-gray-50 px-3 py-3 text-sm"
            >
              <dt class="text-gray-400">대상</dt>
              <dd class="font-semibold text-gray-800">
                Q{{ preview.specId }} · {{ preview.projectName }}
              </dd>
              <dt class="text-gray-400">주문번호</dt>
              <dd class="font-mono text-xs text-gray-600">{{ preview.odId }}</dd>
              <dt class="text-gray-400">주문 / 항목</dt>
              <dd class="text-gray-700">{{ preview.odStatus }} / {{ preview.ctStatus }}</dd>
              <dt class="text-gray-400">결제</dt>
              <dd class="text-gray-700">
                {{ preview.settleCase || '—' }} · 수납
                {{ fmtPcbAmount('KRW', preview.receiptPrice) }}
              </dd>
            </dl>

            <template v-if="preview.cancelable && !cancelOrder.isSuccess.value">
              <div
                class="mt-3 rounded-lg border px-3 py-2.5 text-sm"
                :class="
                  preview.cancelsWholeOrder
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                "
              >
                <p v-if="preview.cancelsWholeOrder" class="font-semibold">
                  이 PCB가 마지막 활성 항목이어서 주문 전체가 취소됩니다.
                </p>
                <p v-else class="font-semibold">
                  이 PCB 항목만 취소되며 다른 활성 항목 {{ preview.activeSiblingCount }}개는
                  유지됩니다.
                </p>
                <p class="mt-1 text-xs font-normal opacity-80">
                  취소금액·미수금·세액과 재고는 영카트 규칙으로 다시 계산됩니다.
                </p>
              </div>

              <p
                v-if="preview.rfqCount > 0"
                class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700"
              >
                협력사 견적 이력 {{ preview.rfqCount }}건은 감사 이력으로 유지되며, 취소 후 신규
                발주는 차단됩니다.
              </p>

              <label class="mt-4 block">
                <span class="text-sm font-semibold text-gray-700">취소 사유 <b class="text-red-600">*</b></span>
                <textarea
                  v-model="reason"
                  rows="3"
                  maxlength="500"
                  placeholder="예: 고객 요청으로 결제 전 주문 취소"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none"
                  @input="validationError = ''"
                />
                <span class="mt-1 block text-xs text-gray-400">관리자 주문 변경이력에 기록됩니다.</span>
              </label>
              <p v-if="validationError !== ''" class="mt-2 text-sm text-red-600">
                {{ validationError }}
              </p>
              <p
                v-if="actionError !== ''"
                class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {{ actionError }}
              </p>
              <p class="mt-3 text-xs leading-5 text-gray-400">
                영카트 관리자 취소와 동일하게 고객 안내 메일은 자동 발송되지 않습니다.
              </p>
            </template>

            <div
              v-else-if="!preview.cancelable"
              class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800"
            >
              <p class="font-semibold">
                {{
                  preview.blockReason === null
                    ? '이 화면에서 취소할 수 없습니다.'
                    : PCB_ORDER_CANCEL_BLOCK_LABELS[preview.blockReason]
                }}
              </p>
              <p v-if="preview.poCount > 0" class="mt-1 text-xs">
                연결된 협력사 발주서 {{ preview.poCount }}건
              </p>
              <p class="mt-1 text-xs font-normal opacity-80">
                결제 승인 취소나 환불을 확인하기 전에 로컬 주문 상태를 먼저 변경하지 않습니다.
              </p>
            </div>

            <div v-else class="mt-3 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
              <p class="font-semibold">주문 취소가 완료되었습니다.</p>
              <p class="mt-1 text-xs">
                {{
                  cancelOrder.data.value?.data.orderCancelled === true
                    ? '주문 전체가 취소 상태로 이동했습니다.'
                    : '선택한 PCB 항목이 취소되었습니다.'
                }}
              </p>
            </div>
          </template>
        </div>

        <footer class="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            v-if="
              preview !== null &&
                !preview.cancelable &&
                preview.blockReason === 'PARTNER_PROCESS_EXISTS'
            "
            type="button"
            class="rounded-lg border border-blue-200 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"
            @click="emit('openCase')"
          >
            PCB Case 확인
          </button>
          <a
            v-if="
              preview !== null &&
                !preview.cancelable &&
                (preview.blockReason === 'PAYMENT_RECEIVED' ||
                  preview.blockReason === 'YOUNGCART_REQUIRED')
            "
            :href="preview.youngcartOrderUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-50"
          >
            영카트 주문관리에서 처리 ↗
          </a>
          <button
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
            {{ cancelOrder.isPending.value ? '취소 처리 중…' : 'PCB 주문 취소' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
