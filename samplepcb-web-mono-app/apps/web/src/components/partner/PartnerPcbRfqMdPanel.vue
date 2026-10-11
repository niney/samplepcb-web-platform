<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  PCB_CURRENCIES,
  PCB_RFQ_STATUS_LABELS,
  pcbMdQuoteAmount,
  roundPcbAmount,
  type AdminPcbRfqViewType,
  type PartnerPcbRfqDetailType,
  type PcbCurrencyType,
} from '@sp/api-contract';
import { kstDateInput } from '@sp/utils';
import { usePartnerI18n } from '../../partner/i18n';
import { usePartnerPcbChildAssign, usePartnerPcbChildSelect } from '../../partner/usePartnerPcbRfqs';
import { confirmDialog } from '../../lib/confirmDialog';

// 마스터딜러: 받은 PCB 견적요청을 하위 협력사에 다시 보내고, 온 회신 중 하나를 골라 마진을 붙여
// 상위에 회신한다(docs/PCB_PARTNER_TRACK.md "마스터딜러 견적 화면"). 세 걸음이 한 카드에 차례로 선다:
//   ① 요청 보내기 → ② 회신 비교 → ③ 마진·납기 정해 회신 저장
// 결과 메시지는 **누른 버튼 바로 아래**에 뜬다 — 예전에는 페이지 맨 위 한 곳이라, 맨 아래에서 누르고
// 맨 위를 봐야 했다. 저장하기 전에도 회신가가 얼마가 될지 보인다(서버와 같은 계약 함수로 계산).

const props = defineProps<{ detail: PartnerPcbRfqDetailType; readOnly: boolean }>();

const { pt, pm, pd, locale } = usePartnerI18n();
const money = (currency: string, value: number | null): string => (value === null ? '—' : pm(value, currency));
const apiMessage = (caught: unknown, fallback: string): string =>
  locale.value === 'ko' && caught instanceof ApiRequestError && caught.message !== '' ? caught.message : fallback;

const asCcy = (value: string): PcbCurrencyType =>
  (PCB_CURRENCIES as readonly string[]).includes(value) ? (value as PcbCurrencyType) : 'USD';
const myCcy = computed(() => asCcy(props.detail.currency));
const children = computed(() => props.detail.children);

// ── ① 하위 협력사에 요청 ─────────────────────────────────────────────────────
// 체크한 집합으로 수렴하는 발송이다 — 새로 고른 곳에만 메일이 가고, 체크를 푼 곳은 아직 회신이 없을
// 때만 회수된다. 회신이 온 곳은 서버가 남기므로 처음부터 풀 수 없게 잠근다(풀리는 듯 보이다 남는 일이 없게).
const sentIds = computed(() => new Set(children.value.map((child) => child.partnerId)));
const lockedIds = computed(
  () => new Set(children.value.filter((child) => child.status !== 'requested').map((child) => child.partnerId)),
);
const picked = ref<number[]>([]);
// 보낸 곳이 달라졌을 때만 서버 상태에 맞춘다 — 창을 다녀올 때마다 도는 재조회가 고르던 체크를 지우지 않게.
watch(
  () => [...sentIds.value].sort((a, b) => a - b).join(','),
  () => {
    picked.value = [...sentIds.value];
  },
  { immediate: true },
);
const targetIds = computed(() => [...new Set([...picked.value, ...lockedIds.value])]);
const assignDirty = computed(
  () => targetIds.value.length !== sentIds.value.size || targetIds.value.some((id) => !sentIds.value.has(id)),
);
const addingCount = computed(() => targetIds.value.filter((id) => !sentIds.value.has(id)).length);
const suggestedDate = ref(kstDateInput(props.detail.suggestedDeliveryDate));

const assign = usePartnerPcbChildAssign();
const assignNotice = ref('');
const assignError = ref('');
async function sendAssign(): Promise<void> {
  assignNotice.value = '';
  assignError.value = '';
  try {
    const res = await assign.mutateAsync({
      rfqId: props.detail.rfqId,
      body: {
        partnerIds: targetIds.value,
        suggestedDeliveryDate: suggestedDate.value === '' ? null : suggestedDate.value,
      },
    });
    assignNotice.value = pt('보냄 {added}곳 · 유지 {kept}곳 · 회수 {removed}곳', {
      added: res.data.added,
      kept: res.data.kept,
      removed: res.data.removed,
    });
  } catch (caught) {
    assignError.value = apiMessage(caught, pt('하위 견적요청 발송에 실패했습니다.'));
  }
}

// ── ② 회신 비교 ──────────────────────────────────────────────────────────────
const rateOf = (currency: string): number | null =>
  currency === props.detail.currency ? 1 : (props.detail.childRates[currency] ?? null);
/** 하위 회신가를 내 결제통화로 — 통화가 다른 회신끼리 견주려면 한 통화로 놓아야 한다(오늘 환율). */
const convertedOf = (child: AdminPcbRfqViewType): number | null => {
  const rate = rateOf(child.currency);
  return child.priceOriginal === null || rate === null ? null : roundPcbAmount(child.priceOriginal * rate, myCcy.value);
};
const showConverted = computed(() => children.value.some((child) => child.currency !== props.detail.currency));
const repliedCount = computed(() => children.value.filter((child) => child.priceOriginal !== null).length);
const cheapestId = computed(() => {
  const priced = children.value.flatMap((child) => {
    const amount = convertedOf(child);
    return amount === null ? [] : [{ rfqId: child.rfqId, amount }];
  });
  if (priced.length < 2) return null;
  return priced.reduce((low, row) => (row.amount < low.amount ? row : low)).rfqId;
});

const STATUS_CLS: Record<string, string> = {
  requested: 'bg-blue-100 text-blue-700',
  quoted: 'bg-emerald-100 text-emerald-700',
  selected: 'bg-violet-100 text-violet-700',
  unselected: 'bg-gray-200 text-gray-500',
};

const copied = ref<number | null>(null);
async function copyLink(child: AdminPcbRfqViewType): Promise<void> {
  if (child.magicToken === null) return;
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/app/pcb-rfq-reply/${child.magicToken}`);
    copied.value = child.rfqId;
  } catch {
    assignError.value = pt('링크를 복사하지 못했습니다.');
  }
}

// ── ③ 마진·납기 정해 회신 저장 ───────────────────────────────────────────────
const saved = computed(() => props.detail.mdQuote);
const pickedChild = ref<number | null>(null);
const marginText = ref('');
const deliveryDate = ref('');
const memo = ref('');
// 저장된 선정이 달라졌을 때만 입력을 서버 값으로 맞춘다(재조회가 고르던 라디오·마진을 되돌리지 않게).
watch(
  () =>
    [
      props.detail.rfqId,
      saved.value?.childRfqId ?? '',
      saved.value?.marginRate ?? '',
      props.detail.quotedDeliveryDate ?? '',
      props.detail.memo ?? '',
    ].join('|'),
  () => {
    pickedChild.value = saved.value?.childRfqId ?? null;
    marginText.value = saved.value === null ? '' : String(saved.value.marginRate);
    deliveryDate.value = saved.value === null ? '' : kstDateInput(props.detail.quotedDeliveryDate);
    memo.value = props.detail.memo ?? '';
  },
  { immediate: true },
);

const chosen = computed(() => children.value.find((child) => child.rfqId === pickedChild.value) ?? null);
function choose(child: AdminPcbRfqViewType): void {
  pickedChild.value = child.rfqId;
  // 납기는 하위 납기에서 출발한다 — 여유 일수는 마스터딜러가 여기서 더한다.
  deliveryDate.value = kstDateInput(child.quotedDeliveryDate);
}
const margin = computed(() => {
  const text = marginText.value.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const value = Number(text);
  return value <= 500 ? value : null;
});
const formMatchesSaved = computed(
  () =>
    saved.value !== null &&
    pickedChild.value === saved.value.childRfqId &&
    margin.value === saved.value.marginRate &&
    deliveryDate.value === kstDateInput(props.detail.quotedDeliveryDate) &&
    memo.value.trim() === (props.detail.memo ?? ''),
);
/** 금액 근거가 저장된 것과 같은가 — 같으면 그때 박제된 환율·금액을, 다르면 오늘 환율의 예상값을 보인다. */
const amountMatchesSaved = computed(
  () => saved.value !== null && pickedChild.value === saved.value.childRfqId && margin.value === saved.value.marginRate,
);
const quote = computed(() => {
  const child = chosen.value;
  const price = child?.priceOriginal ?? null;
  if (child === null || price === null) return null;
  if (amountMatchesSaved.value && saved.value !== null && props.detail.priceOriginal !== null)
    return {
      amount: props.detail.priceOriginal,
      source: saved.value.sourceAmount,
      sourceCurrency: saved.value.sourceCurrency,
      rate: saved.value.sourceRate,
      margin: saved.value.marginRate,
      stamped: true,
    };
  const rate = rateOf(child.currency);
  if (margin.value === null || rate === null) return null;
  return {
    amount: pcbMdQuoteAmount(price, rate, margin.value, myCcy.value),
    source: price,
    sourceCurrency: child.currency,
    rate,
    margin: margin.value,
    stamped: false,
  };
});
const formula = computed(() => {
  const q = quote.value;
  if (q === null) return '';
  const parts = [money(q.sourceCurrency, q.source)];
  if (q.sourceCurrency !== props.detail.currency) parts.push(String(q.rate));
  parts.push((1 + q.margin / 100).toFixed(2));
  return parts.join(' × ');
});
const rateMissing = computed(() => chosen.value !== null && rateOf(chosen.value.currency) === null);
const earlierThanChild = computed(() => {
  const childDate = kstDateInput(chosen.value?.quotedDeliveryDate);
  return childDate !== '' && deliveryDate.value !== '' && deliveryDate.value < childDate;
});

const select = usePartnerPcbChildSelect();
const saveNotice = ref('');
const saveError = ref('');
async function save(): Promise<void> {
  saveNotice.value = '';
  saveError.value = '';
  const child = chosen.value;
  if (child === null) {
    saveError.value = pt('선정할 하위 회신을 선택해 주세요.');
    return;
  }
  if (margin.value === null) {
    saveError.value = pt('마진율(정수 %)을 입력해 주세요.');
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate.value)) {
    saveError.value = pt('예상 배송일을 선택해 주세요(필수).');
    return;
  }
  // 직접 입력해 둔 회신이 있으면 이 저장이 그것을 대신한다 — 한 번 묻는다.
  if (props.detail.priceOriginal !== null && saved.value === null) {
    const ok = await confirmDialog({
      title: pt('직접 입력한 회신을 바꿉니다'),
      message: pt('지금 회신({value1})이 이 하위 견적으로 계산한 값으로 바뀝니다.', {
        value1: money(props.detail.currency, props.detail.priceOriginal),
      }),
      confirmLabel: pt('이 견적으로 회신 저장'),
    });
    if (!ok) return;
  }
  try {
    await select.mutateAsync({
      rfqId: props.detail.rfqId,
      body: {
        childRfqId: child.rfqId,
        marginRate: margin.value,
        quotedDeliveryDate: deliveryDate.value,
        memo: memo.value.trim() === '' ? null : memo.value.trim(),
      },
    });
    saveNotice.value = pt('회신이 저장되었습니다 — 선정 전까지 다시 수정할 수 있습니다.');
  } catch (caught) {
    saveError.value = apiMessage(caught, pt('하위 선정에 실패했습니다.'));
  }
}
async function clear(): Promise<void> {
  saveNotice.value = '';
  saveError.value = '';
  const ok = await confirmDialog({
    title: pt('하위 선정 해제'),
    message: pt('하위 선정을 풀면 지금 회신도 함께 지워집니다.'),
    confirmLabel: pt('선정 해제'),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await select.mutateAsync({ rfqId: props.detail.rfqId, body: { childRfqId: null } });
    saveNotice.value = pt('하위 선정을 해제했습니다 — 회신도 함께 초기화되었습니다.');
  } catch (caught) {
    saveError.value = apiMessage(caught, pt('선정 해제에 실패했습니다.'));
  }
}

// Clear transient feedback on language changes; preserve entered form values.
watch(locale, () => {
  assignNotice.value = '';
  assignError.value = '';
  saveNotice.value = '';
  saveError.value = '';
});
</script>

<template>
  <div class="space-y-5" data-testid="partner-pcb-md-panel">
    <!-- ① 요청 보내기 -->
    <section v-if="detail.myChildPartners.length > 0 && !readOnly" data-testid="partner-pcb-md-assign">
      <h3 class="flex items-center gap-2 text-sm font-bold text-gray-800">
        <span class="flex size-5 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">1</span>
        {{ pt('하위 협력사에 요청') }}
      </h3>
      <div class="mt-2 flex flex-wrap gap-2">
        <label
          v-for="child in detail.myChildPartners"
          :key="child.partnerId"
          class="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm"
          :class="lockedIds.has(child.partnerId) ? 'border-gray-200 bg-gray-50 text-gray-500' : 'cursor-pointer border-gray-200 hover:bg-gray-50'"
          :title="lockedIds.has(child.partnerId) ? pt('회신이 온 곳은 회수할 수 없습니다.') : undefined"
        >
          <input
            v-model="picked"
            type="checkbox"
            class="size-4 accent-indigo-600"
            :value="child.partnerId"
            :disabled="lockedIds.has(child.partnerId)"
            :data-testid="`partner-pcb-md-pick-${String(child.partnerId)}`"
          >
          <span class="font-medium text-gray-800">{{ child.name }}</span>
          <span class="text-xs text-gray-400">{{ child.settlementCurrency ?? 'USD' }}</span>
        </label>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-1.5 text-sm text-gray-600">
          {{ pt('제시 납기') }}
          <input
            v-model="suggestedDate"
            type="date"
            class="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
            data-testid="partner-pcb-md-suggested"
          >
        </label>
        <button
          type="button"
          class="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
          :disabled="assign.isPending.value || !assignDirty"
          data-testid="partner-pcb-md-send"
          @click="void sendAssign()"
        >
          {{ pt('선택한 협력사에 요청 보내기') }}
        </button>
        <span class="text-xs text-gray-400">{{ addingCount > 0 ? pt('새로 고른 {value1}곳에만 메일이 갑니다 · 제시 납기는 새 요청에만 적용', { value1: addingCount }) : pt('체크를 풀면 회신이 없는 요청만 회수됩니다') }}</span>
      </div>
      <p v-if="assignNotice !== ''" class="mt-2 text-sm font-semibold text-emerald-700" role="status" data-testid="partner-pcb-md-assign-notice">{{ assignNotice }}</p>
      <p v-if="assignError !== ''" class="mt-2 text-sm font-semibold text-red-600" role="alert" data-testid="partner-pcb-md-assign-error">{{ assignError }}</p>
    </section>

    <!-- ② 회신 비교 -->
    <section data-testid="partner-pcb-md-compare">
      <h3 class="flex items-center gap-2 text-sm font-bold text-gray-800">
        <span class="flex size-5 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">2</span>
        {{ pt('회신 비교') }}
        <span v-if="children.length > 0" class="text-xs font-normal text-gray-400">{{ pt('회신 {value1}/{value2}', { value1: repliedCount, value2: children.length }) }}</span>
      </h3>
      <p v-if="children.length === 0" class="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">{{ pt('아직 보낸 요청이 없습니다 — 위에서 협력사를 골라 요청을 보내 주세요.') }}</p>
      <div v-else class="mt-2 overflow-x-auto rounded-lg border border-gray-200">
        <table class="min-w-full divide-y divide-gray-100 text-sm">
          <thead class="bg-gray-50 text-left text-xs text-gray-500">
            <tr class="whitespace-nowrap">
              <th class="px-3 py-2">{{ pt('선정') }}</th>
              <th class="px-3 py-2">{{ pt('하위 협력사') }}</th>
              <th class="px-3 py-2">{{ pt('상태') }}</th>
              <th class="px-3 py-2 text-right">{{ pt('회신가') }}</th>
              <th v-if="showConverted" class="px-3 py-2 text-right">{{ pt('{value1} 환산', { value1: detail.currency }) }}</th>
              <th class="px-3 py-2">{{ pt('납기일') }}</th>
              <th class="px-3 py-2">{{ pt('메모') }}</th>
              <th class="px-3 py-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              v-for="child in children"
              :key="child.rfqId"
              :class="pickedChild === child.rfqId ? 'bg-violet-50/60' : ''"
              data-testid="partner-pcb-md-child-row"
              :data-child-rfq="child.rfqId"
            >
              <td class="px-3 py-2">
                <input
                  type="radio"
                  name="partner-pcb-md-child"
                  class="size-4 accent-violet-600"
                  :checked="pickedChild === child.rfqId"
                  :disabled="child.priceOriginal === null || readOnly"
                  :aria-label="pt('{value1} 선정', { value1: child.partnerName })"
                  @change="choose(child)"
                >
              </td>
              <td class="px-3 py-2 font-medium text-gray-800">{{ child.partnerName }}</td>
              <td class="px-3 py-2">
                <span class="whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[child.status]">
                  {{ pt(PCB_RFQ_STATUS_LABELS[child.status]) }}
                </span>
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {{ money(child.currency, child.priceOriginal) }}<span v-if="child.priceOriginal !== null && child.subCurrency !== null && child.subPriceOriginal !== null" class="text-xs text-gray-400"> ({{ money(child.subCurrency, child.subPriceOriginal) }})</span>
              </td>
              <td v-if="showConverted" class="whitespace-nowrap px-3 py-2 text-right tabular-nums" data-testid="partner-pcb-md-converted">
                {{ money(detail.currency, convertedOf(child)) }}
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-gray-600">{{ pd(child.quotedDeliveryDate) }}</td>
              <td class="max-w-[14rem] truncate px-3 py-2 text-xs text-gray-500" :title="child.memo ?? undefined">{{ child.memo ?? '—' }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right">
                <span v-if="cheapestId === child.rfqId" class="mr-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700" data-testid="partner-pcb-md-cheapest">{{ pt('최저가') }}</span>
                <button
                  v-if="child.magicToken !== null && !readOnly && (child.status === 'requested' || child.status === 'quoted')"
                  type="button"
                  class="rounded border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                  :title="pt('로그인 없이 회신할 수 있는 링크입니다. 이 협력사에게만 전달해 주세요.')"
                  @click="void copyLink(child)"
                >
                  {{ copied === child.rfqId ? pt('복사됨') : pt('회신 링크 복사') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="showConverted && children.length > 0" class="mt-1 text-xs text-gray-400">{{ pt('환산은 오늘 환율 기준입니다 — 저장하는 순간의 환율로 확정됩니다.') }}</p>
    </section>

    <!-- ③ 마진·납기 -->
    <section v-if="!readOnly" data-testid="partner-pcb-md-quote">
      <h3 class="flex items-center gap-2 text-sm font-bold text-gray-800">
        <span class="flex size-5 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">3</span>
        {{ pt('마진 · 납기 정해 회신') }}
      </h3>
      <p v-if="repliedCount === 0" class="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">{{ pt('하위 회신이 오면 여기서 골라 마진을 붙여 회신합니다.') }}</p>
      <template v-else>
        <div class="mt-2 grid gap-3 sm:grid-cols-[auto_auto_1fr]">
          <label class="block">
            <span class="text-xs font-semibold text-gray-500">{{ pt('마진 (%) *') }}</span>
            <input
              v-model="marginText"
              type="text"
              inputmode="numeric"
              class="mt-1 block w-24 rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-violet-500 focus:outline-none"
              placeholder="8"
              data-testid="partner-pcb-md-margin"
            >
          </label>
          <label class="block">
            <span class="text-xs font-semibold text-gray-500">{{ pt('예상 배송일 *') }}<span v-if="chosen !== null && chosen.quotedDeliveryDate !== null" class="ml-1 font-normal text-gray-400">{{ pt('(하위 납기 {value1})', { value1: pd(chosen.quotedDeliveryDate) }) }}</span></span>
            <input
              v-model="deliveryDate"
              type="date"
              class="mt-1 block rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
              data-testid="partner-pcb-md-delivery"
            >
          </label>
          <label class="block">
            <span class="text-xs font-semibold text-gray-500">{{ pt('메모') }}</span>
            <input
              v-model="memo"
              type="text"
              class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
              :placeholder="pt('재질/납기 조건 등 참고 사항')"
              data-testid="partner-pcb-md-memo"
            >
          </label>
        </div>
        <p v-if="earlierThanChild" class="mt-1 text-xs font-semibold text-amber-700" data-testid="partner-pcb-md-early">{{ pt('하위 납기보다 이른 날짜입니다.') }}</p>

        <div class="mt-3 rounded-lg border px-3 py-2" :class="quote === null ? 'border-gray-200 bg-gray-50' : 'border-violet-200 bg-violet-50/60'" data-testid="partner-pcb-md-preview">
          <template v-if="quote !== null">
            <p class="text-xs font-semibold text-gray-500">{{ quote.stamped ? pt('저장된 회신가') : pt('예상 회신가') }}</p>
            <p class="text-lg font-bold tabular-nums text-violet-800" data-testid="partner-pcb-md-preview-amount">{{ money(detail.currency, quote.amount) }}</p>
            <p class="text-xs tabular-nums text-gray-500">{{ formula }}<template v-if="!quote.stamped && quote.sourceCurrency !== detail.currency"> · {{ pt('오늘 환율 기준') }}</template></p>
          </template>
          <p v-else-if="rateMissing" class="text-sm text-amber-700">{{ pt('환율 정보가 준비되지 않아 미리 계산할 수 없습니다.') }}</p>
          <p v-else class="text-sm text-gray-500">{{ chosen === null ? pt('위 표에서 회신을 고르면 회신가를 미리 계산합니다.') : pt('마진을 입력하면 회신가를 미리 계산합니다.') }}</p>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-40"
            :disabled="select.isPending.value || formMatchesSaved"
            data-testid="partner-pcb-md-save"
            @click="void save()"
          >
            {{ select.isPending.value ? pt('저장 중…') : pt('이 견적으로 회신 저장') }}
          </button>
          <button
            v-if="saved !== null"
            type="button"
            class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            :disabled="select.isPending.value"
            data-testid="partner-pcb-md-clear"
            @click="void clear()"
          >
            {{ pt('선정 해제') }}
          </button>
        </div>
      </template>
      <p v-if="saveNotice !== ''" class="mt-2 text-sm font-semibold text-emerald-700" role="status" data-testid="partner-pcb-md-save-notice">{{ saveNotice }}</p>
      <p v-if="saveError !== ''" class="mt-2 text-sm font-semibold text-red-600" role="alert" data-testid="partner-pcb-md-save-error">{{ saveError }}</p>
    </section>
  </div>
</template>
