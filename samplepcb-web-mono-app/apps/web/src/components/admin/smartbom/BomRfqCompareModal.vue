<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AdminBomRfqViewType, BomQuoteItemType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useSelectRfqReply } from '../../../admin/useAdminBomRfqs';

// 품목 × 협력사 회신 매트릭스 비교·선정(시안 채택, docs/SMARTBOM_PARTNER_RFQ.md §3.4).
// 행=부품행 · 열=[현재 선정 오퍼]+[회신한 협력사]. 셀 라디오로 품목별 선정 후 일괄 적용.
// 적용은 행별 선정 API 순차 호출 — 서버가 스냅샷 박제+재계산(감사 이벤트 포함)한다.

const props = defineProps<{
  open: boolean;
  quoteId: string;
  rfqs: AdminBomRfqViewType[]; // quoted 만 열로 쓴다
  scopeItems: BomQuoteItemType[];
}>();
const emit = defineEmits<{ close: [] }>();

const quotedRfqs = computed(() => props.rfqs.filter((r) => r.status === 'quoted'));

// 협력사 회신 셀 조회: quoteItemId → rfqId → 회신
const cellOf = (item: BomQuoteItemType, rfq: AdminBomRfqViewType) => {
  const reply = rfq.items.find((r) => r.quoteItemId === item.id);
  const price = reply?.unitPrice ?? null;
  return reply === undefined || price === null ? null : reply;
};

const lineTotalOf = (item: BomQuoteItemType, unitPrice: number): number =>
  Math.round(unitPrice * Math.max(1, item.orderQty));

// 선정 상태 — 'keep' = 현재 유지, number = rfqItemId
type Choice = 'keep' | number;
const choices = ref<Map<string, Choice>>(new Map());

const isCurrentRfqSelection = (item: BomQuoteItemType, rfqItemId: number): boolean =>
  item.selectedOffer?.offerKey === `rfq:${String(rfqItemId)}`;

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const next = new Map<string, Choice>();
    for (const item of props.scopeItems) next.set(item.id, 'keep');
    choices.value = next;
    error.value = '';
    progress.value = '';
  },
);

function setChoice(itemId: string, choice: Choice): void {
  const next = new Map(choices.value);
  next.set(itemId, choice);
  choices.value = next;
}

// 품목별 최저가 일괄 선정 — 회신 중 라인합계 최저를 고른다(현재 선정과의 비교는
// 미리보기 합계로 확인 — 자동으로 '유지'를 이기게 하지 않는다: 관리자 명시 적용).
function pickLowestAll(): void {
  const next = new Map(choices.value);
  for (const item of props.scopeItems) {
    let best: { rfqItemId: number; total: number } | null = null;
    for (const rfq of quotedRfqs.value) {
      const reply = cellOf(item, rfq);
      const price = reply?.unitPrice ?? null;
      if (reply === null || price === null) continue;
      const total = lineTotalOf(item, price);
      if (best === null || total < best.total) best = { rfqItemId: reply.rfqItemId, total };
    }
    if (best !== null) next.set(item.id, best.rfqItemId);
  }
  choices.value = next;
}

// 합계 미리보기 — keep 은 기존 lineTotalKrw, 선택은 회신 단가 × 주문수량.
const previewTotal = computed(() => {
  let sum = 0;
  for (const item of props.scopeItems) {
    const choice = choices.value.get(item.id) ?? 'keep';
    if (choice === 'keep') {
      sum += item.lineTotalKrw === null ? 0 : Math.round(item.lineTotalKrw);
      continue;
    }
    for (const rfq of quotedRfqs.value) {
      const reply = cellOf(item, rfq);
      if (reply !== null && reply.rfqItemId === choice && reply.unitPrice !== null) {
        sum += lineTotalOf(item, reply.unitPrice);
        break;
      }
    }
  }
  return sum;
});

const currentTotal = computed(() =>
  props.scopeItems.reduce(
    (sum, item) => sum + (item.lineTotalKrw === null ? 0 : Math.round(item.lineTotalKrw)),
    0,
  ),
);

const select = useSelectRfqReply();
const error = ref('');
const progress = ref('');

async function apply(): Promise<void> {
  error.value = '';
  const changes: { itemId: string; rfqItemId: number }[] = [];
  for (const item of props.scopeItems) {
    const choice = choices.value.get(item.id) ?? 'keep';
    if (choice === 'keep') continue;
    if (isCurrentRfqSelection(item, choice)) continue; // 이미 그 회신으로 선정됨
    changes.push({ itemId: item.id, rfqItemId: choice });
  }
  if (changes.length === 0) {
    error.value = '변경할 선정이 없습니다.';
    return;
  }
  try {
    for (const [idx, change] of changes.entries()) {
      progress.value = `적용 중 ${String(idx + 1)}/${String(changes.length)}…`;
      await select.mutateAsync({
        quoteId: props.quoteId,
        body: { itemId: change.itemId, rfqItemId: change.rfqItemId },
      });
    }
    progress.value = '';
    emit('close');
  } catch (e) {
    progress.value = '';
    error.value = e instanceof ApiRequestError ? e.message : '선정 적용에 실패했습니다.';
  }
}

const fmt = (v: number): string => v.toLocaleString('ko-KR');
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="emit('close')">
    <div class="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-2xl bg-surface p-6 shadow-2xl">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-lg font-bold">협력사 회신 비교·선정</h2>
        <span class="text-xs text-gray-500">회신 협력사 {{ quotedRfqs.length }}곳 · 품목 {{ scopeItems.length }}행</span>
        <button
          type="button"
          class="ml-auto rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50"
          @click="pickLowestAll"
        >
          품목별 최저가 일괄 선정
        </button>
        <button type="button" class="text-gray-400 hover:text-gray-700" @click="emit('close')">✕</button>
      </div>

      <div class="mt-4 min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200">
        <table class="min-w-full divide-y divide-gray-100 text-xs">
          <thead class="sticky top-0 z-10 bg-gray-50 text-left text-gray-500">
            <tr>
              <th class="px-3 py-2">부품</th>
              <th class="px-3 py-2 text-right">수량</th>
              <th class="bg-blue-50/60 px-3 py-2">현재 선정 오퍼</th>
              <th v-for="rfq in quotedRfqs" :key="rfq.rfqId" class="px-3 py-2">{{ rfq.partnerName }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr v-for="item in scopeItems" :key="item.id">
              <td class="max-w-52 px-3 py-2">
                <div class="truncate font-medium">{{ item.mpn === '' ? '품번 미기재' : item.mpn }}</div>
                <div class="truncate text-gray-400">{{ item.manufacturerName ?? '' }}</div>
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ fmt(item.orderQty) }}</td>
              <!-- 현재 선정(keep) -->
              <td class="bg-blue-50/40 px-3 py-2">
                <label class="flex cursor-pointer items-start gap-1.5">
                  <input
                    type="radio"
                    class="mt-0.5"
                    :checked="(choices.get(item.id) ?? 'keep') === 'keep'"
                    @change="setChoice(item.id, 'keep')"
                  >
                  <span>
                    <template v-if="item.selectedOffer !== null">
                      <b>{{ item.selectedOffer.supplier }}</b>
                      <span class="ml-1 tabular-nums">
                        {{ item.selectedOffer.unitPrice }} {{ item.selectedOffer.currency }}
                      </span>
                      <span class="block text-gray-400 tabular-nums">
                        = {{ item.lineTotalKrw === null ? '—' : `${fmt(Math.round(item.lineTotalKrw))}원` }}
                      </span>
                    </template>
                    <span v-else class="text-gray-400">미선정</span>
                  </span>
                </label>
              </td>
              <!-- 협력사 회신 셀 -->
              <td v-for="rfq in quotedRfqs" :key="rfq.rfqId" class="px-3 py-2">
                <template v-if="cellOf(item, rfq) !== null">
                  <label class="flex cursor-pointer items-start gap-1.5">
                    <input
                      type="radio"
                      class="mt-0.5"
                      :checked="choices.get(item.id) === cellOf(item, rfq)?.rfqItemId
                        || ((choices.get(item.id) ?? 'keep') === 'keep' && isCurrentRfqSelection(item, cellOf(item, rfq)?.rfqItemId ?? -1))"
                      @change="setChoice(item.id, cellOf(item, rfq)?.rfqItemId ?? -1)"
                    >
                    <span>
                      <span class="tabular-nums font-semibold">{{ fmt(cellOf(item, rfq)?.unitPrice ?? 0) }}원</span>
                      <span class="block text-gray-400 tabular-nums">
                        = {{ fmt(lineTotalOf(item, cellOf(item, rfq)?.unitPrice ?? 0)) }}원
                        <template v-if="cellOf(item, rfq)?.moq !== null"> · MOQ {{ fmt(cellOf(item, rfq)?.moq ?? 0) }}</template>
                      </span>
                      <span v-if="isCurrentRfqSelection(item, cellOf(item, rfq)?.rfqItemId ?? -1)" class="mt-0.5 inline-block rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-bold text-emerald-700">
                        선정됨
                      </span>
                    </span>
                  </label>
                </template>
                <span v-else class="text-gray-300">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span class="text-gray-600">
          현재 부품 합계 <b class="tabular-nums">{{ fmt(currentTotal) }}원</b>
          → 적용 시 <b class="tabular-nums text-blue-700">{{ fmt(previewTotal) }}원</b>
          <span class="text-xs text-gray-400">(합계 정본은 적용 후 서버 재계산)</span>
        </span>
        <span v-if="progress !== ''" class="text-xs text-gray-500">{{ progress }}</span>
        <p v-if="error !== ''" class="text-xs font-semibold text-red-600">{{ error }}</p>
        <div class="ml-auto flex gap-2">
          <button type="button" class="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold hover:bg-gray-50" @click="emit('close')">
            닫기
          </button>
          <button
            type="button"
            class="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="select.isPending.value"
            @click="apply"
          >
            선정 적용
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
