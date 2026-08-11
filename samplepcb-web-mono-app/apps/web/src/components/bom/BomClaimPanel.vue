<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_CLAIM_ELIGIBILITY_LABELS,
  BOM_CLAIM_KIND_LABELS,
  BOM_CLAIM_RESOLUTION_LABELS,
  BOM_CLAIM_STATUS_LABELS,
  type BomClaimKindType,
  type BomClaimStatusType,
  type BomQuoteItemType,
} from '@sp/api-contract';
import { useBomClaims, useCreateBomClaim } from '../../bom/useBom';

const props = defineProps<{
  quoteId: string;
  items: BomQuoteItemType[];
}>();

const quoteIdRef = computed(() => props.quoteId);
const claimsEnabled = computed(() => props.quoteId !== '');
const claimsQuery = useBomClaims(quoteIdRef, claimsEnabled);
const createClaim = useCreateBomClaim();
const claims = computed(() => claimsQuery.data.value?.data.claims ?? []);
const eligibility = computed(() => claimsQuery.data.value?.data.eligibility ?? null);
const claimableItems = computed(() => props.items.filter((item) => item.included && item.orderQty > 0));

const formOpen = ref(false);
const kind = ref<BomClaimKindType>('missing');
const subject = ref('');
const description = ref('');
const selectedQuantities = ref<Record<string, number>>({});
const acknowledgeNoAutomaticRefund = ref(false);
const formError = ref('');
const panelEl = ref<HTMLElement | null>(null);
const dialogEl = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
let previousBodyOverflow = '';
let focusPanelAfterClose = false;

const selectedItems = computed(() => Object.entries(selectedQuantities.value).map(
  ([quoteItemId, affectedQty]) => ({ quoteItemId, affectedQty }),
));
const canSubmit = computed(() =>
  selectedItems.value.length > 0
  && subject.value.trim().length >= 5
  && description.value.trim().length >= 10
  && acknowledgeNoAutomaticRefund.value
  && !createClaim.isPending.value,
);

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(): HTMLElement[] {
  if (dialogEl.value === null) return [];
  return Array.from(dialogEl.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

function restoreDialogEnvironment(): void {
  window.removeEventListener('keydown', onDialogKeydown);
  document.body.style.overflow = previousBodyOverflow;
  const shouldFocusPanel = focusPanelAfterClose;
  focusPanelAfterClose = false;
  if (shouldFocusPanel) void nextTick(() => panelEl.value?.focus());
  else previousFocus?.focus();
  previousFocus = null;
}

function onDialogKeydown(event: KeyboardEvent): void {
  if (!formOpen.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeForm();
    return;
  }
  if (event.key !== 'Tab' || dialogEl.value === null) return;
  const focusable = focusableElements();
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    dialogEl.value.focus();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialogEl.value.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialogEl.value.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

watch(formOpen, async (open) => {
  if (open) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onDialogKeydown);
    await nextTick();
    dialogEl.value?.focus();
    return;
  }
  restoreDialogEnvironment();
});

onBeforeUnmount(() => {
  if (formOpen.value) restoreDialogEnvironment();
});

function resetForm(): void {
  kind.value = 'missing';
  subject.value = '';
  description.value = '';
  selectedQuantities.value = {};
  acknowledgeNoAutomaticRefund.value = false;
  formError.value = '';
  createClaim.reset();
}

function openForm(): void {
  if (eligibility.value?.canSubmit !== true) return;
  resetForm();
  formOpen.value = true;
}

function closeForm(): void {
  if (createClaim.isPending.value) return;
  formOpen.value = false;
}

function toggleItem(itemId: string): void {
  const next = { ...selectedQuantities.value };
  if (next[itemId] === undefined) {
    next[itemId] = 1;
    selectedQuantities.value = next;
    return;
  }
  selectedQuantities.value = Object.fromEntries(
    Object.entries(next).filter(([key]) => key !== itemId),
  );
}

function clampQuantity(itemId: string, max: number): void {
  const current = selectedQuantities.value[itemId];
  if (current === undefined) return;
  selectedQuantities.value = {
    ...selectedQuantities.value,
    [itemId]: Math.min(max, Math.max(1, Math.trunc(current || 1))),
  };
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  formError.value = '';
  try {
    await createClaim.mutateAsync({
      quoteId: props.quoteId,
      body: {
        kind: kind.value,
        subject: subject.value.trim(),
        description: description.value.trim(),
        items: selectedItems.value,
        acknowledgeNoAutomaticRefund: true,
      },
    });
    // 성공 뒤 접수 버튼이 사라지므로, 제거될 버튼이 아니라 새 상태를 담는 패널로 복귀한다.
    focusPanelAfterClose = true;
    formOpen.value = false;
  } catch (error) {
    formError.value = error instanceof ApiRequestError
      ? error.message
      : '문제 접수에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

const fmtDate = (value: string): string => new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

const statusClass = (status: BomClaimStatusType): string =>
  status === 'open'
    ? 'bg-amber-100 text-amber-800'
    : status === 'reviewing'
      ? 'bg-blue-100 text-blue-800'
      : status === 'resolved'
        ? 'bg-emerald-100 text-emerald-800'
        : 'bg-gray-200 text-gray-700';
</script>

<template>
  <section ref="panelEl" tabindex="-1" class="mb-[18px] rounded-[10px] border border-orange-200 bg-orange-50/80 p-3 text-[11px] text-orange-950 outline-none focus-visible:ring-2 focus-visible:ring-orange-500" aria-labelledby="bom-claim-panel-title">
    <div class="flex items-start justify-between gap-2">
      <div>
        <h2 id="bom-claim-panel-title" class="text-[12px] font-bold">배송 후 문제 접수</h2>
        <p class="mt-0.5 leading-[16px] text-orange-800">누락·파손·오배송 부품을 주문 단위로 기록하고 담당자 답변을 확인합니다.</p>
      </div>
      <button
        v-if="eligibility?.canSubmit"
        type="button"
        class="shrink-0 rounded-lg bg-orange-600 px-2.5 py-1.5 font-bold text-white hover:bg-orange-700"
        @click="openForm"
      >
        문제 접수
      </button>
    </div>

    <p v-if="claimsQuery.isLoading.value" class="mt-3 text-orange-700">주문과 접수 이력을 확인하는 중…</p>
    <p v-else-if="claimsQuery.isError.value" role="alert" class="mt-3 font-semibold text-red-700">
      접수 이력을 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.
    </p>
    <template v-else-if="eligibility !== null">
      <p v-if="eligibility.order !== null" class="mt-2 rounded-md bg-white/80 px-2 py-1.5 text-orange-800">
        주문 {{ eligibility.order.odId }} · {{ eligibility.order.odStatus }}
      </p>
      <p
        v-if="!eligibility.canSubmit && eligibility.reason !== null && eligibility.reason !== 'ACTIVE_CLAIM'"
        class="mt-2 leading-[16px] text-orange-800"
      >
        {{ BOM_CLAIM_ELIGIBILITY_LABELS[eligibility.reason] }}
      </p>
    </template>

    <div v-if="claims.length > 0" class="mt-3 space-y-2">
      <article v-for="claim in claims" :key="claim.id" class="rounded-lg border border-orange-200 bg-white p-2.5">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="rounded-full px-2 py-0.5 font-bold" :class="statusClass(claim.status)">
            {{ BOM_CLAIM_STATUS_LABELS[claim.status] }}
          </span>
          <span class="font-semibold text-gray-600">{{ BOM_CLAIM_KIND_LABELS[claim.kind] }}</span>
          <span class="ml-auto text-[10px] text-gray-400">{{ fmtDate(claim.submittedAt) }}</span>
        </div>
        <p class="mt-2 font-bold text-gray-900">{{ claim.subject }}</p>
        <p class="mt-1 whitespace-pre-wrap leading-[16px] text-gray-600">{{ claim.description }}</p>
        <ul class="mt-2 space-y-1 rounded-md bg-gray-50 p-2 text-gray-600">
          <li v-for="item in claim.items" :key="item.id" class="flex justify-between gap-2">
            <span class="min-w-0 truncate">{{ item.mpn }}<span v-if="item.manufacturerName"> · {{ item.manufacturerName }}</span></span>
            <b class="shrink-0">{{ item.affectedQty }}/{{ item.orderedQty }}개</b>
          </li>
        </ul>
        <div v-if="claim.adminResponse !== null" class="mt-2 rounded-md border border-blue-100 bg-blue-50 p-2 text-blue-900">
          <p class="font-bold">
            담당자 답변<span v-if="claim.resolutionKind !== null"> · {{ BOM_CLAIM_RESOLUTION_LABELS[claim.resolutionKind] }}</span>
          </p>
          <p class="mt-1 whitespace-pre-wrap leading-[16px]">{{ claim.adminResponse }}</p>
        </div>
        <details class="mt-2 text-gray-500">
          <summary class="cursor-pointer font-semibold">처리 이력 {{ claim.events.length }}건</summary>
          <ol class="mt-1 space-y-1 border-l border-gray-200 pl-2">
            <li v-for="event in claim.events" :key="event.id">
              {{ BOM_CLAIM_STATUS_LABELS[event.toStatus] }} · {{ fmtDate(event.createdAt) }}
            </li>
          </ol>
        </details>
      </article>
    </div>
  </section>

  <div v-if="formOpen" class="fixed inset-0 z-[90] grid place-items-center p-3 sm:p-6">
    <button type="button" class="absolute inset-0 bg-slate-950/55" aria-label="문제 접수 닫기" @click="closeForm" />
    <section
      ref="dialogEl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bom-claim-form-title"
      tabindex="-1"
      class="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none"
    >
      <header class="border-b border-orange-100 bg-orange-50 px-4 py-4 sm:px-6">
        <p class="text-[11px] font-bold uppercase tracking-wider text-orange-600">배송 후 고객 대응</p>
        <h2 id="bom-claim-form-title" class="mt-1 text-lg font-bold text-gray-950">BOM 부품 문제 접수</h2>
        <p class="mt-1 text-xs leading-5 text-orange-900">접수만으로 주문 취소·환불·재발송이 자동 실행되지는 않습니다. 담당자가 확인 후 답변합니다.</p>
      </header>

      <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
        <label class="block text-sm font-semibold text-gray-800">
          문제 유형
          <select v-model="kind" class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option v-for="(label, value) in BOM_CLAIM_KIND_LABELS" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>

        <fieldset>
          <legend class="text-sm font-semibold text-gray-800">문제가 있는 부품과 수량</legend>
          <div class="mt-2 max-h-60 space-y-2 overflow-y-auto rounded-xl border border-gray-200 p-2">
            <label
              v-for="item in claimableItems"
              :key="item.id"
              class="flex min-w-0 items-center gap-2 rounded-lg p-2 hover:bg-gray-50"
            >
              <input
                type="checkbox"
                :checked="selectedQuantities[item.id] !== undefined"
                :aria-label="`${item.mpn} 문제 부품 선택`"
                @change="toggleItem(item.id)"
              >
              <span class="min-w-0 flex-1">
                <b class="block truncate text-sm text-gray-900">{{ item.mpn }}</b>
                <span class="block truncate text-xs text-gray-500">{{ item.manufacturerName ?? '제조사 미확인' }} · 주문 {{ item.orderQty }}개</span>
              </span>
              <input
                v-if="selectedQuantities[item.id] !== undefined"
                v-model.number="selectedQuantities[item.id]"
                type="number"
                min="1"
                :max="item.orderQty"
                class="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-right text-sm"
                :aria-label="`${item.mpn} 문제 수량`"
                @blur="clampQuantity(item.id, item.orderQty)"
              >
            </label>
          </div>
        </fieldset>

        <label class="block text-sm font-semibold text-gray-800">
          제목
          <input v-model="subject" maxlength="120" class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="예: 커넥터 2개가 누락되었습니다">
        </label>
        <label class="block text-sm font-semibold text-gray-800">
          상세 내용
          <textarea v-model="description" maxlength="2000" rows="5" class="mt-1 w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="포장 상태와 확인한 수량을 구체적으로 적어 주세요." />
        </label>
        <label class="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs leading-5 text-orange-950">
          <input v-model="acknowledgeNoAutomaticRefund" type="checkbox" class="mt-1 shrink-0">
          <span>이 접수는 주문 취소·환불을 자동 처리하지 않으며, 담당자 확인과 별도 안내가 필요함을 확인했습니다.</span>
        </label>
        <p v-if="formError !== ''" role="alert" class="text-sm font-semibold text-red-600">{{ formError }}</p>
      </div>

      <footer class="flex flex-wrap justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-6">
        <button type="button" class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700" :disabled="createClaim.isPending.value" @click="closeForm">취소</button>
        <button type="button" class="rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40" :disabled="!canSubmit" @click="submit">
          {{ createClaim.isPending.value ? '접수 중…' : '문제 접수' }}
        </button>
      </footer>
    </section>
  </div>
</template>
