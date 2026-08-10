<script setup lang="ts">
import { ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import { usePcbShipCustomerOrder } from '../../../admin/useAdminPcbOrders';
import { nowLocalDateTime, toG5DateTime } from '../../../admin/useAdminOrders';
import { confirmDialog } from '../../../lib/confirmDialog';

// 고객 배송 처리 모달(P4.6) — 입고확인 끝난 PCB 주문을 고객에게 발송한다.
// 운송장 입력 → 코어 force-status '배송'(운송장 반영+재고 앵커, 조작 경로 단일).
// 선적·배송 워크큐(고객 배송 대기 탭)와 Case 상세('배송 처리 대기' 배지)가 공용.

const props = defineProps<{
  /** null 이면 닫힘. 열 때마다 입력을 초기화한다. */
  odId: string | null;
  /** 입고확인이 끝나지 않은 발주가 남았는지 — 경고 + 제출 시 confirm. */
  incompleteReceipt: boolean;
  /**
   * 누구 것인지 — 주문번호 20자리만으로는 확인이 안 된다. 묶음 발송이면 회원이 다른
   * 두 주문을 연달아 처리하게 되므로(여정 9호), 송장을 붙이기 전에 사람이 읽을 이름이
   * 화면에 있어야 오배송이 안 난다.
   */
  customerLabel?: string;
  projectName?: string;
}>();
const emit = defineEmits<{ close: [] }>();

const shipMut = usePcbShipCustomerOrder();
const company = ref('');
const invoiceNo = ref('');
const invoiceTime = ref('');
const error = ref('');

watch(
  () => props.odId,
  (odId) => {
    if (odId === null) return;
    company.value = '';
    invoiceNo.value = '';
    invoiceTime.value = nowLocalDateTime();
    error.value = '';
  },
);

async function submit(): Promise<void> {
  if (props.odId === null) return;
  error.value = '';
  if (company.value.trim() === '' || invoiceNo.value.trim() === '') {
    error.value = '택배사와 송장번호를 입력해 주세요.';
    return;
  }
  if (
    props.incompleteReceipt &&
    !(await confirmDialog('아직 입고 확인되지 않은 발주가 있습니다. 그래도 배송 처리할까요?'))
  ) {
    return;
  }
  try {
    await shipMut.mutateAsync({
      odId: props.odId,
      delivery: {
        deliveryCompany: company.value.trim(),
        invoiceNo: invoiceNo.value.trim(),
        invoiceTime: toG5DateTime(invoiceTime.value),
      },
    });
    emit('close');
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '배송 처리에 실패했습니다.';
  }
}
</script>

<template>
  <div
    v-if="odId !== null"
    class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold">
          배송 처리
          <span v-if="customerLabel !== undefined && customerLabel !== ''"> — {{ customerLabel }}</span>
        </h2>
        <button type="button" class="text-gray-400 hover:text-gray-700" @click="emit('close')">✕</button>
      </div>
      <p class="mt-0.5 text-xs text-gray-500">
        <span class="font-mono">{{ odId }}</span>
        <template v-if="projectName !== undefined && projectName !== ''"> · {{ projectName }}</template>
      </p>
      <p v-if="incompleteReceipt" class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
        입고 확인이 끝나지 않은 발주가 있습니다 — 검수 후 발송을 권장합니다.
      </p>
      <div class="mt-3 grid gap-2 text-xs">
        <label class="text-gray-500">택배사
          <input v-model="company" type="text" maxlength="50" placeholder="예: CJ대한통운" class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2">
        </label>
        <label class="text-gray-500">송장번호
          <input v-model="invoiceNo" type="text" maxlength="100" class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2 font-mono">
        </label>
        <label class="text-gray-500">발송일시
          <input v-model="invoiceTime" type="datetime-local" class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2">
        </label>
        <p class="text-[11px] text-gray-400">
          알림 메일은 발송되지 않습니다 — 배송 안내가 필요하면
          <RouterLink
            :to="{ name: 'admin-orders' }"
            target="_blank"
            class="font-semibold text-blue-600 hover:underline"
          >
            통합 주문내역
          </RouterLink>
          에서 이 주문번호로 찾아 발송해 주세요.
        </p>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold hover:bg-gray-50" @click="emit('close')">
          취소
        </button>
        <button
          type="button"
          class="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="shipMut.isPending.value"
          @click="submit"
        >
          배송 처리
        </button>
      </div>
      <p v-if="error !== ''" class="mt-2 text-xs font-semibold text-red-600">{{ error }}</p>
    </div>
  </div>
</template>
