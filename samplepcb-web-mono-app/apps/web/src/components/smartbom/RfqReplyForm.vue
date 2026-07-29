<script setup lang="ts">
import { ref, watch } from 'vue';
import type { BomRfqItemReplyInputType, BomRfqReplyBodyType } from '@sp/api-contract';

// 협력사 회신 폼 — 포털 회신·관리자 대리 입력 공용(docs/SMARTBOM_PARTNER_RFQ.md §4).
// 행별 단가·재고·D/C·납기·메모 입력. 단가가 비어 있는 행은 미회신으로 제출에서 제외된다.
// 합계는 서버가 재계산·박제하므로 여기서는 참고 표시만 한다.

export interface RfqReplyFormRow {
  quoteItemId: string;
  mpn: string;
  manufacturerName: string | null;
  description: string | null;
  orderQty: number;
  reply: {
    unitPrice: number | null;
    replyQty: number | null;
    moq: number | null;
    stock: number | null;
    dateCode: string | null;
    leadTime: string | null;
    memo: string | null;
  } | null;
}

const props = defineProps<{
  rows: RfqReplyFormRow[];
  currency: string;
  deliveryDate: string | null; // ISO — 폼에서는 YYYY-MM-DD
  memo: string | null;
  busy?: boolean;
  readOnly?: boolean;
}>();

const emit = defineEmits<{ submit: [body: BomRfqReplyBodyType] }>();

interface EditRow {
  quoteItemId: string;
  mpn: string;
  manufacturerName: string | null;
  description: string | null;
  orderQty: number;
  unitPrice: number | null;
  replyQty: number | null;
  moq: number | null;
  stock: number | null;
  dateCode: string;
  leadTime: string;
  memo: string;
}

const editRows = ref<EditRow[]>([]);
const deliveryDateInput = ref('');
const memoInput = ref('');

const initRows = (): void => {
  editRows.value = props.rows.map((row) => ({
    quoteItemId: row.quoteItemId,
    mpn: row.mpn,
    manufacturerName: row.manufacturerName,
    description: row.description,
    orderQty: row.orderQty,
    unitPrice: row.reply?.unitPrice ?? null,
    replyQty: row.reply?.replyQty ?? null,
    moq: row.reply?.moq ?? null,
    stock: row.reply?.stock ?? null,
    dateCode: row.reply?.dateCode ?? '',
    leadTime: row.reply?.leadTime ?? '',
    memo: row.reply?.memo ?? '',
  }));
  deliveryDateInput.value = props.deliveryDate?.slice(0, 10) ?? '';
  memoInput.value = props.memo ?? '';
};
watch(() => props.rows, initRows, { immediate: true });

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const intOrNull = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};
const strOrNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

const lineTotal = (row: EditRow): number | null => {
  const price = num(row.unitPrice);
  if (price === null) return null;
  const qty = intOrNull(row.replyQty) ?? row.orderQty;
  return Math.round(price * qty);
};

const repliedCount = (): number => editRows.value.filter((r) => num(r.unitPrice) !== null).length;

const grandTotal = (): number =>
  editRows.value.reduce((sum, row) => sum + (lineTotal(row) ?? 0), 0);

function submit(): void {
  const items: BomRfqItemReplyInputType[] = editRows.value
    .filter((row) => {
      const price = num(row.unitPrice);
      return price !== null && price >= 0;
    })
    .map((row) => ({
      quoteItemId: row.quoteItemId,
      unitPrice: num(row.unitPrice) ?? 0,
      replyQty: intOrNull(row.replyQty),
      moq: intOrNull(row.moq),
      stock: intOrNull(row.stock),
      dateCode: strOrNull(row.dateCode),
      leadTime: strOrNull(row.leadTime),
      memo: strOrNull(row.memo),
    }));
  emit('submit', {
    items,
    deliveryDate: deliveryDateInput.value === '' ? null : deliveryDateInput.value,
    memo: strOrNull(memoInput.value),
  });
}
</script>

<template>
  <div class="space-y-3">
    <div class="overflow-x-auto rounded-lg border border-gray-200">
      <table class="min-w-full divide-y divide-gray-100 text-xs">
        <thead class="bg-gray-50 text-left text-gray-500">
          <tr>
            <th class="px-2 py-2">부품</th>
            <th class="px-2 py-2 text-right">필요수량</th>
            <th class="px-2 py-2 text-right">단가({{ currency }})</th>
            <th class="px-2 py-2 text-right">회신수량</th>
            <th class="px-2 py-2 text-right">MOQ</th>
            <th class="px-2 py-2 text-right">재고</th>
            <th class="px-2 py-2">D/C</th>
            <th class="px-2 py-2">납기</th>
            <th class="px-2 py-2">메모</th>
            <th class="px-2 py-2 text-right">금액</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          <tr v-for="row in editRows" :key="row.quoteItemId">
            <td class="max-w-56 px-2 py-1.5">
              <div class="truncate font-medium">{{ row.mpn === '' ? '품번 미기재' : row.mpn }}</div>
              <div class="truncate text-gray-400">{{ row.manufacturerName ?? row.description ?? '' }}</div>
            </td>
            <td class="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
              {{ row.orderQty.toLocaleString('ko-KR') }}
            </td>
            <td class="px-2 py-1.5">
              <input v-model.number="row.unitPrice" type="number" min="0" step="any" :disabled="readOnly" class="w-24 rounded border border-gray-300 px-1.5 py-1 text-right tabular-nums">
            </td>
            <td class="px-2 py-1.5">
              <input v-model.number="row.replyQty" type="number" min="1" :disabled="readOnly" :placeholder="String(row.orderQty)" class="w-20 rounded border border-gray-300 px-1.5 py-1 text-right tabular-nums">
            </td>
            <td class="px-2 py-1.5">
              <input v-model.number="row.moq" type="number" min="1" :disabled="readOnly" class="w-16 rounded border border-gray-300 px-1.5 py-1 text-right tabular-nums">
            </td>
            <td class="px-2 py-1.5">
              <input v-model.number="row.stock" type="number" min="0" :disabled="readOnly" class="w-20 rounded border border-gray-300 px-1.5 py-1 text-right tabular-nums">
            </td>
            <td class="px-2 py-1.5">
              <input v-model="row.dateCode" type="text" :disabled="readOnly" class="w-20 rounded border border-gray-300 px-1.5 py-1">
            </td>
            <td class="px-2 py-1.5">
              <input v-model="row.leadTime" type="text" :disabled="readOnly" placeholder="예: 2주" class="w-20 rounded border border-gray-300 px-1.5 py-1">
            </td>
            <td class="px-2 py-1.5">
              <input v-model="row.memo" type="text" :disabled="readOnly" class="w-28 rounded border border-gray-300 px-1.5 py-1">
            </td>
            <td class="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
              {{ lineTotal(row) === null ? '—' : `${(lineTotal(row) ?? 0).toLocaleString('ko-KR')}` }}
            </td>
          </tr>
          <tr v-if="editRows.length === 0">
            <td colspan="10" class="px-2 py-8 text-center text-gray-400">요청 부품행이 없습니다.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex flex-wrap items-end gap-3 text-xs">
      <label class="text-gray-500">납기(전체)
        <input v-model="deliveryDateInput" type="date" :disabled="readOnly" class="mt-1 block h-8 rounded border border-gray-300 px-2">
      </label>
      <label class="min-w-56 flex-1 text-gray-500">회신 메모
        <input v-model="memoInput" type="text" :disabled="readOnly" class="mt-1 block h-8 w-full rounded border border-gray-300 px-2">
      </label>
      <div class="ml-auto text-right">
        <p class="text-gray-500">회신 {{ repliedCount() }} / {{ editRows.length }}행</p>
        <p class="font-bold tabular-nums">합계(참고) {{ grandTotal().toLocaleString('ko-KR') }} {{ currency }}</p>
      </div>
      <button
        v-if="!readOnly"
        type="button"
        class="h-9 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
        :disabled="busy === true"
        @click="submit"
      >
        회신 저장
      </button>
    </div>
  </div>
</template>
