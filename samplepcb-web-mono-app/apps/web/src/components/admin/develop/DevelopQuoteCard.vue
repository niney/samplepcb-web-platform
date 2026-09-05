<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEVELOP_MILESTONE_STATUS_LABELS,
  DEVELOP_MILESTONE_TRIGGER_LABELS,
  DEVELOP_QUOTE_KIND_LABELS,
  DEVELOP_QUOTE_STATUS_LABELS,
  DEVELOP_VAT_MODE_LABELS,
} from '@sp/api-contract';
import type { DevelopQuoteViewType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import {
  useAdminDevelopMilestoneMarkPaid,
  useAdminDevelopQuoteWithdraw,
} from '../../../admin/useAdminDevelop';
import { formatDateTime, formatKrw } from '../../../lib/format';

// 견적서 한 장(읽기) — 항목·금액·결제 조건·수락 흔적. 초안이면 편집으로 넘기고,
// 발송분은 철회만 할 수 있다(고친 값을 보내려면 수정 견적을 새로 만든다).
// 마일스톤의 `payment` 는 영카트 주문(od) 파생이라 결제 화면 대신 여기서 읽기만 한다.
const props = defineProps<{ quote: DevelopQuoteViewType & { internalNote: string | null } }>();

const emit = defineEmits<{ edit: [] }>();

const { t } = useI18n();
const withdraw = useAdminDevelopQuoteWithdraw();
const markPaid = useAdminDevelopMilestoneMarkPaid();

const notice = ref('');
const noticeError = ref(false);
const confirmWithdraw = ref(false);
const payingId = ref<number | null>(null);
const payNote = ref('');

const setNotice = (message: string, isError: boolean): void => {
  notice.value = message;
  noticeError.value = isError;
};

const statusClass = computed(() => {
  switch (props.quote.status) {
    case 'accepted':
      return 'bg-emerald-100 text-emerald-700';
    case 'sent':
      return 'bg-blue-100 text-blue-700';
    case 'draft':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-gray-100 text-gray-500';
  }
});

const milestoneStatusClass = (status: string): string => {
  switch (status) {
    case 'paid':
      return 'bg-emerald-100 text-emerald-700';
    case 'pending':
      return 'bg-amber-100 text-amber-700';
    case 'cancelled':
      return 'bg-red-100 text-red-600';
    default:
      return 'bg-gray-100 text-gray-500';
  }
};

const errorCodes = computed(() => ({
  QUOTE_NOT_OPEN: t('admin.develop.quote.errNotOpen'),
  NOT_PAYABLE: t('admin.develop.quote.errNotPayable'),
  ALREADY_PAID: t('admin.develop.quote.errAlreadyPaid'),
}));

async function onWithdraw(): Promise<void> {
  confirmWithdraw.value = false;
  try {
    await withdraw.mutateAsync(props.quote.quoteId);
    setNotice(t('admin.develop.quote.withdrawn'), false);
  } catch (error) {
    setNotice(apiErrorMessage(error, t('admin.develop.quote.withdrawFail'), errorCodes.value), true);
  }
}

function openPay(milestoneId: number): void {
  payingId.value = milestoneId;
  payNote.value = '';
  notice.value = '';
}

async function onMarkPaid(): Promise<void> {
  const id = payingId.value;
  if (id === null) return;
  const note = payNote.value.trim();
  try {
    await markPaid.mutateAsync({ milestoneId: id, body: note === '' ? {} : { note } });
    payingId.value = null;
    setNotice(t('admin.develop.quote.markPaidDone'), false);
  } catch (error) {
    setNotice(apiErrorMessage(error, t('admin.develop.quote.markPaidFail'), errorCodes.value), true);
  }
}
</script>

<template>
  <article class="rounded-lg border border-gray-200 bg-white p-3">
    <!-- 머리 -->
    <div class="flex flex-wrap items-center gap-1.5">
      <b class="text-base text-gray-900">v{{ quote.version }}</b>
      <span class="text-xs text-gray-500">{{ DEVELOP_QUOTE_KIND_LABELS[quote.kind] }}</span>
      <span class="rounded-full px-2 py-0.5 text-[11px] font-bold" :class="statusClass">
        {{ DEVELOP_QUOTE_STATUS_LABELS[quote.status] }}
      </span>
      <span class="ml-auto text-base font-bold text-gray-900">{{ formatKrw(quote.totalAmount) }}</span>
      <span class="text-xs text-gray-500">{{ DEVELOP_VAT_MODE_LABELS[quote.vatMode] }}</span>
    </div>
    <p class="mt-0.5 text-sm text-gray-700">{{ quote.title }}</p>
    <p class="mt-0.5 text-xs text-gray-500">
      {{ t('admin.develop.quote.validUntil') }} {{ quote.validUntil }}
      <template v-if="quote.durationDays !== null"> · {{ t('admin.develop.quote.durationDaysShort', { days: quote.durationDays }) }}</template>
      <template v-if="quote.sentAt !== null"> · {{ t('admin.develop.quote.sentAt') }} {{ formatDateTime(quote.sentAt) }}</template>
      <template v-if="quote.acceptedAt !== null"> · {{ t('admin.develop.quote.acceptedAt') }} {{ formatDateTime(quote.acceptedAt) }}<template v-if="quote.acceptedName !== null"> ({{ quote.acceptedName }})</template></template>
      <template v-if="quote.declinedAt !== null"> · {{ t('admin.develop.quote.declinedAt') }} {{ formatDateTime(quote.declinedAt) }}</template>
    </p>
    <p v-if="quote.declineReason !== null" class="mt-0.5 text-xs text-red-600">
      {{ t('admin.develop.quote.declineReason') }}: {{ quote.declineReason }}
    </p>
    <p v-if="quote.poFile !== null" class="mt-0.5 text-xs text-gray-500">
      {{ t('admin.develop.quote.poFile') }}: {{ quote.poFile.name }}
    </p>

    <!-- 항목 -->
    <ul class="mt-2 grid gap-0.5 border-t border-gray-100 pt-2 text-sm">
      <li v-for="it in quote.items" :key="it.itemId" class="flex flex-wrap items-baseline gap-2">
        <span class="min-w-0 flex-1 truncate text-gray-800">{{ it.title }}</span>
        <span v-if="it.durationDays !== null" class="text-xs text-gray-400">{{ t('admin.develop.quote.durationDaysShort', { days: it.durationDays }) }}</span>
        <span class="font-semibold text-gray-700">{{ formatKrw(it.amount) }}</span>
      </li>
    </ul>
    <dl class="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 border-t border-gray-100 pt-1.5 text-xs">
      <dt class="text-gray-500">{{ t('admin.develop.quote.supply') }}</dt>
      <dd class="text-right text-gray-700">{{ formatKrw(quote.supplyAmount) }}</dd>
      <dt class="text-gray-500">{{ t('admin.develop.quote.vat') }}</dt>
      <dd class="text-right text-gray-700">{{ formatKrw(quote.vatAmount) }}</dd>
    </dl>

    <!-- 결제 조건 -->
    <div class="mt-2 border-t border-gray-100 pt-2">
      <h4 class="text-xs font-bold text-gray-600">{{ t('admin.develop.quote.milestones') }}</h4>
      <ul class="mt-1 grid gap-1">
        <li v-for="m in quote.milestones" :key="m.milestoneId" class="rounded-md bg-gray-50 px-2 py-1.5 text-xs">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="font-semibold text-gray-800">{{ m.title }}</span>
            <span class="text-gray-500">{{ DEVELOP_MILESTONE_TRIGGER_LABELS[m.trigger] }}</span>
            <span v-if="m.unlocksDeliverables" class="rounded-full bg-indigo-100 px-1.5 py-0.5 font-bold text-indigo-700">
              {{ t('admin.develop.quote.unlocks') }}
            </span>
            <span class="rounded-full px-1.5 py-0.5 font-bold" :class="milestoneStatusClass(m.status)">
              {{ DEVELOP_MILESTONE_STATUS_LABELS[m.status] }}
            </span>
            <span class="ml-auto font-bold text-gray-800">{{ formatKrw(m.amount) }}</span>
          </div>
          <p v-if="m.payment !== null" class="mt-0.5 text-gray-500">
            {{ t('admin.develop.quote.payment', {
              odId: m.payment.odId,
              status: m.payment.odStatus,
              receipt: formatKrw(m.payment.receiptPrice),
            }) }}
            <template v-if="m.payment.misu > 0"> · {{ t('admin.develop.quote.misu', { amount: formatKrw(m.payment.misu) }) }}</template>
          </p>
          <p v-if="m.paidAt !== null" class="mt-0.5 text-emerald-700">
            {{ t('admin.develop.quote.paidAt') }} {{ formatDateTime(m.paidAt) }}
          </p>
          <div v-if="m.status === 'pending' && payingId !== m.milestoneId" class="mt-1">
            <button
              type="button"
              class="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50"
              @click="openPay(m.milestoneId)"
            >
              {{ t('admin.develop.quote.markPaid') }}
            </button>
          </div>
          <div v-if="payingId === m.milestoneId" class="mt-1 grid gap-1 rounded-md border border-amber-300 bg-amber-50 p-2">
            <p class="font-bold text-amber-900">{{ t('admin.develop.quote.markPaidConfirm') }}</p>
            <input
              v-model="payNote"
              type="text"
              :maxlength="500"
              :placeholder="t('admin.develop.quote.markPaidNote')"
              class="h-9 w-full rounded-md border border-gray-300 px-2 text-xs"
            >
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
                :disabled="markPaid.isPending.value"
                @click="onMarkPaid"
              >
                {{ t('admin.develop.quote.confirmYes') }}
              </button>
              <button
                type="button"
                class="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50"
                @click="payingId = null"
              >
                {{ t('admin.develop.quote.confirmNo') }}
              </button>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <p v-if="quote.internalNote !== null" class="mt-2 rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-600">
      {{ t('admin.develop.quote.internalNote') }}: {{ quote.internalNote }}
    </p>

    <!-- 철회 확인 -->
    <div v-if="confirmWithdraw" class="mt-2 rounded-md border border-red-300 bg-red-50 p-2">
      <p class="text-xs font-bold text-red-800">{{ t('admin.develop.quote.withdrawConfirm') }}</p>
      <div class="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          class="rounded-md bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-40"
          :disabled="withdraw.isPending.value"
          @click="onWithdraw"
        >
          {{ t('admin.develop.quote.confirmYes') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50"
          @click="confirmWithdraw = false"
        >
          {{ t('admin.develop.quote.confirmNo') }}
        </button>
      </div>
    </div>

    <div class="mt-2 flex flex-wrap items-center gap-2">
      <button
        v-if="quote.status === 'draft'"
        type="button"
        class="rounded-md border border-blue-300 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50"
        @click="emit('edit')"
      >
        {{ t('admin.develop.quote.edit') }}
      </button>
      <button
        v-if="quote.status === 'sent'"
        type="button"
        class="rounded-md border border-red-200 px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-50"
        @click="confirmWithdraw = true"
      >
        {{ t('admin.develop.quote.withdraw') }}
      </button>
      <span v-if="notice !== ''" class="text-xs font-semibold" :class="noticeError ? 'text-red-600' : 'text-emerald-700'">{{ notice }}</span>
    </div>
  </article>
</template>
