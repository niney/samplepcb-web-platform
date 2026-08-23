<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import {
  BomRfqReplyBody,
  type BomRfqItemReplyInputType,
  type BomRfqReplyBodyType,
} from '@sp/api-contract';
import { kstDateInput } from '@sp/utils';

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
  /**
   * 내가 올려 둔 보유 부품의 같은 품번 값(docs/PARTNER_PARTS.md) — **제안**이다.
   * 아직 회신하지 않은 행에만 프리필하고, 이미 쓴 값은 절대 덮지 않는다.
   * 관리자 대리 입력 화면에는 넘기지 않는다(협력사 자신의 원장이므로).
   */
  myStock?: {
    stockQty: number | null;
    dateCode: string | null;
    leadTime: string | null;
    unitPrice: number | null;
    currency: string | null;
    moq: number | null;
    uploadedAt: string;
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
  /** 보유 부품에서 값을 채워 넣은 행 — 사람이 확인하도록 표시만 한다. */
  prefilled: boolean;
}

const editRows = ref<EditRow[]>([]);
const deliveryDateInput = ref('');
const memoInput = ref('');
const validationIssue = ref<{ key: string; message: string } | null>(null);

const initRows = (): void => {
  editRows.value = props.rows.map((row) => {
    // 보유 부품 프리필(docs/PARTNER_PARTS.md) — **아직 회신하지 않은 행에만** 제안한다.
    // 이미 쓴 회신은 절대 덮지 않는다(값은 사람이 확정한 것이 정본).
    const suggest = row.reply === null ? (row.myStock ?? null) : null;
    return {
      quoteItemId: row.quoteItemId,
      mpn: row.mpn,
      manufacturerName: row.manufacturerName,
      description: row.description,
      orderQty: row.orderQty,
      // 단가는 제안하지 않는다 — 재고표 단가는 견적가가 아니고, 프리필이 곧 제시가로
      // 굳어지면 협력사가 손해를 본다(수량·환율·시점이 다르다).
      unitPrice: row.reply?.unitPrice ?? null,
      replyQty: row.reply?.replyQty ?? null,
      moq: row.reply?.moq ?? suggest?.moq ?? null,
      stock: row.reply?.stock ?? suggest?.stockQty ?? null,
      dateCode: row.reply?.dateCode ?? suggest?.dateCode ?? '',
      leadTime: row.reply?.leadTime ?? suggest?.leadTime ?? '',
      memo: row.reply?.memo ?? '',
      prefilled: suggest !== null,
    };
  });
  deliveryDateInput.value = kstDateInput(props.deliveryDate);
  memoInput.value = props.memo ?? '';
};
watch(() => props.rows, initRows, { immediate: true });
watch(editRows, () => {
  validationIssue.value = null;
}, { deep: true });
watch([deliveryDateInput, memoInput], () => {
  validationIssue.value = null;
});

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const strOrNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());
const hasValue = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

const lineTotal = (row: EditRow): number | null => {
  const price = num(row.unitPrice);
  if (price === null) return null;
  const qty = num(row.replyQty) ?? row.orderQty;
  return Math.round(price * qty);
};

const repliedCount = (): number => editRows.value.filter((r) => num(r.unitPrice) !== null).length;

const grandTotal = (): number =>
  editRows.value.reduce((sum, row) => sum + (lineTotal(row) ?? 0), 0);

const partLabel = (row: EditRow): string =>
  row.mpn.trim() !== ''
    ? row.mpn
    : (row.manufacturerName ?? row.description ?? `품목 ${row.quoteItemId}`);

const tableScroll = ref<HTMLElement | null>(null);
type NumericField = 'unitPrice' | 'replyQty' | 'moq' | 'stock';

const fieldKey = (row: EditRow, field: NumericField | 'dateCode' | 'leadTime' | 'memo'): string =>
  `${row.quoteItemId}:${field}`;

const isInvalid = (row: EditRow, field: NumericField | 'dateCode' | 'leadTime' | 'memo'): boolean =>
  validationIssue.value?.key === fieldKey(row, field);
const isGlobalInvalid = (key: string): boolean => validationIssue.value?.key === key;

function rejectInput(key: string, message: string): false {
  validationIssue.value = { key, message };
  void nextTick(() => {
    const input = tableScroll.value?.querySelector<HTMLInputElement>(`[data-rfq-key="${key}"]`)
      ?? document.querySelector<HTMLInputElement>(`[data-rfq-key="${key}"]`);
    input?.focus();
    input?.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
  return false;
}

function validateInteger(
  row: EditRow,
  field: 'replyQty' | 'moq' | 'stock',
  label: string,
  minimum: 0 | 1,
): boolean {
  const value = row[field];
  if (!hasValue(value)) return true;
  const parsed = num(value);
  if (parsed !== null && Number.isInteger(parsed) && parsed >= minimum) return true;
  return rejectInput(
    fieldKey(row, field),
    `${partLabel(row)} ${label}은 ${String(minimum)} 이상의 정수로 입력해 주세요.`,
  );
}

function validateRows(): boolean {
  for (const row of editRows.value) {
    const priceEntered = hasValue(row.unitPrice);
    const hasReplyDetail =
      hasValue(row.replyQty)
      || hasValue(row.moq)
      || hasValue(row.stock)
      || row.dateCode.trim() !== ''
      || row.leadTime.trim() !== ''
      || row.memo.trim() !== '';
    if (!priceEntered) {
      if (hasReplyDetail) {
        return rejectInput(
          fieldKey(row, 'unitPrice'),
          `${partLabel(row)}의 회신 내용을 저장하려면 단가를 입력해 주세요.`,
        );
      }
      continue;
    }

    const price = num(row.unitPrice);
    if (price === null || price < 0) {
      return rejectInput(
        fieldKey(row, 'unitPrice'),
        `${partLabel(row)} 단가는 0 이상의 숫자로 입력해 주세요.`,
      );
    }
    if (!validateInteger(row, 'replyQty', '회신수량', 1)) return false;
    if (!validateInteger(row, 'moq', 'MOQ', 1)) return false;
    if (!validateInteger(row, 'stock', '재고', 0)) return false;
    if (row.dateCode.trim().length > 100) {
      return rejectInput(fieldKey(row, 'dateCode'), `${partLabel(row)} Date Code는 100자 이내로 입력해 주세요.`);
    }
    if (row.leadTime.trim().length > 64) {
      return rejectInput(fieldKey(row, 'leadTime'), `${partLabel(row)} 납기는 64자 이내로 입력해 주세요.`);
    }
    if (row.memo.trim().length > 500) {
      return rejectInput(fieldKey(row, 'memo'), `${partLabel(row)} 회신 메모는 500자 이내로 입력해 주세요.`);
    }
  }
  if (memoInput.value.trim().length > 2000) {
    return rejectInput('rfq:memo', '전체 회신 메모는 2,000자 이내로 입력해 주세요.');
  }
  return true;
}

function moveTable(direction: -1 | 1): void {
  tableScroll.value?.scrollBy({ left: direction * 280, behavior: 'smooth' });
}

function submit(): void {
  validationIssue.value = null;
  if (!validateRows()) return;
  const items: BomRfqItemReplyInputType[] = editRows.value
    .filter((row) => {
      const price = num(row.unitPrice);
      return price !== null && price >= 0;
    })
    .map((row) => ({
      quoteItemId: row.quoteItemId,
      unitPrice: num(row.unitPrice) ?? 0,
      replyQty: num(row.replyQty),
      moq: num(row.moq),
      stock: num(row.stock),
      dateCode: strOrNull(row.dateCode),
      leadTime: strOrNull(row.leadTime),
      memo: strOrNull(row.memo),
    }));
  const result = BomRfqReplyBody.safeParse({
    items,
    deliveryDate: deliveryDateInput.value === '' ? null : deliveryDateInput.value,
    memo: strOrNull(memoInput.value),
  });
  if (!result.success) {
    rejectInput('rfq:memo', '입력값을 다시 확인해 주세요. 숫자와 글자 수가 허용 범위여야 합니다.');
    return;
  }
  emit('submit', result.data);
}
</script>

<template>
  <div class="space-y-3">
    <div
      ref="tableScroll"
      class="overflow-x-auto rounded-lg border border-gray-200 [scrollbar-color:theme(colors.blue.300)_theme(colors.gray.100)] [scrollbar-width:thin]"
    >
      <div class="sticky left-0 z-[1] flex items-center gap-2 border-b border-blue-100 bg-blue-50/95 px-3 py-1.5 text-[10px] font-medium text-blue-700 min-[1280px]:hidden">
        <span class="min-w-0 flex-1">좌우로 이동해 회신수량·재고·D/C·납기·메모와 금액을 확인하세요.</span>
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded border border-blue-200 bg-white text-sm hover:bg-blue-100"
          aria-label="RFQ 회신 표 왼쪽으로 이동"
          @click="moveTable(-1)"
        >
          ←
        </button>
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded border border-blue-200 bg-white text-sm hover:bg-blue-100"
          aria-label="RFQ 회신 표 오른쪽으로 이동"
          @click="moveTable(1)"
        >
          →
        </button>
      </div>
      <table class="min-w-[960px] divide-y divide-gray-100 text-xs">
        <thead class="bg-gray-50 text-left text-gray-500">
          <tr class="whitespace-nowrap">
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
              <!-- 보유 부품에서 채운 행 — 값은 제안이므로 확인하고 고칠 수 있게 알린다 -->
              <div
                v-if="row.prefilled"
                class="mt-0.5 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                title="올려 두신 보유 부품 목록에서 재고·D/C·납기를 채웠습니다. 확인하고 고쳐 주세요 (단가는 채우지 않습니다)."
              >
                보유 목록에서 채움
              </div>
            </td>
            <td class="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
              {{ row.orderQty.toLocaleString('ko-KR') }}
            </td>
            <td class="px-2 py-1.5">
              <input
                v-model.number="row.unitPrice"
                type="number"
                min="0"
                step="any"
                :disabled="readOnly"
                :aria-label="`${partLabel(row)} 단가(${currency})`"
                :aria-invalid="isInvalid(row, 'unitPrice')"
                :aria-describedby="isInvalid(row, 'unitPrice') ? 'rfq-reply-validation-error' : undefined"
                :data-rfq-key="fieldKey(row, 'unitPrice')"
                class="w-24 rounded border border-gray-300 px-1.5 py-1 text-right tabular-nums"
                :class="{ 'border-red-500 ring-1 ring-red-200': isInvalid(row, 'unitPrice') }"
              >
            </td>
            <td class="px-2 py-1.5">
              <input
                v-model.number="row.replyQty"
                type="number"
                min="1"
                step="1"
                :disabled="readOnly"
                :placeholder="String(row.orderQty)"
                :aria-label="`${partLabel(row)} 회신수량`"
                :aria-invalid="isInvalid(row, 'replyQty')"
                :aria-describedby="isInvalid(row, 'replyQty') ? 'rfq-reply-validation-error' : undefined"
                :data-rfq-key="fieldKey(row, 'replyQty')"
                class="w-20 rounded border border-gray-300 px-1.5 py-1 text-right tabular-nums"
                :class="{ 'border-red-500 ring-1 ring-red-200': isInvalid(row, 'replyQty') }"
              >
            </td>
            <td class="px-2 py-1.5">
              <input
                v-model.number="row.moq"
                type="number"
                min="1"
                step="1"
                :disabled="readOnly"
                :aria-label="`${partLabel(row)} MOQ`"
                :aria-invalid="isInvalid(row, 'moq')"
                :aria-describedby="isInvalid(row, 'moq') ? 'rfq-reply-validation-error' : undefined"
                :data-rfq-key="fieldKey(row, 'moq')"
                class="w-16 rounded border border-gray-300 px-1.5 py-1 text-right tabular-nums"
                :class="{ 'border-red-500 ring-1 ring-red-200': isInvalid(row, 'moq') }"
              >
            </td>
            <td class="px-2 py-1.5">
              <input
                v-model.number="row.stock"
                type="number"
                min="0"
                step="1"
                :disabled="readOnly"
                :aria-label="`${partLabel(row)} 재고`"
                :aria-invalid="isInvalid(row, 'stock')"
                :aria-describedby="isInvalid(row, 'stock') ? 'rfq-reply-validation-error' : undefined"
                :data-rfq-key="fieldKey(row, 'stock')"
                class="w-20 rounded border border-gray-300 px-1.5 py-1 text-right tabular-nums"
                :class="{ 'border-red-500 ring-1 ring-red-200': isInvalid(row, 'stock') }"
              >
            </td>
            <td class="px-2 py-1.5">
              <input
                v-model="row.dateCode"
                type="text"
                maxlength="100"
                :disabled="readOnly"
                :aria-label="`${partLabel(row)} Date Code`"
                :aria-invalid="isInvalid(row, 'dateCode')"
                :aria-describedby="isInvalid(row, 'dateCode') ? 'rfq-reply-validation-error' : undefined"
                :data-rfq-key="fieldKey(row, 'dateCode')"
                class="w-20 rounded border border-gray-300 px-1.5 py-1"
                :class="{ 'border-red-500 ring-1 ring-red-200': isInvalid(row, 'dateCode') }"
              >
            </td>
            <td class="px-2 py-1.5">
              <input
                v-model="row.leadTime"
                type="text"
                maxlength="64"
                :disabled="readOnly"
                placeholder="예: 2주"
                :aria-label="`${partLabel(row)} 납기`"
                :aria-invalid="isInvalid(row, 'leadTime')"
                :aria-describedby="isInvalid(row, 'leadTime') ? 'rfq-reply-validation-error' : undefined"
                :data-rfq-key="fieldKey(row, 'leadTime')"
                class="w-20 rounded border border-gray-300 px-1.5 py-1"
                :class="{ 'border-red-500 ring-1 ring-red-200': isInvalid(row, 'leadTime') }"
              >
            </td>
            <td class="px-2 py-1.5">
              <input
                v-model="row.memo"
                type="text"
                maxlength="500"
                :disabled="readOnly"
                :aria-label="`${partLabel(row)} 회신 메모`"
                :aria-invalid="isInvalid(row, 'memo')"
                :aria-describedby="isInvalid(row, 'memo') ? 'rfq-reply-validation-error' : undefined"
                :data-rfq-key="fieldKey(row, 'memo')"
                class="w-28 rounded border border-gray-300 px-1.5 py-1"
                :class="{ 'border-red-500 ring-1 ring-red-200': isInvalid(row, 'memo') }"
              >
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

    <p
      v-if="validationIssue !== null"
      id="rfq-reply-validation-error"
      role="alert"
      class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
    >
      {{ validationIssue.message }}
    </p>

    <div class="flex flex-wrap items-end gap-3 text-xs">
      <label class="text-gray-500">납기(전체)
        <input v-model="deliveryDateInput" type="date" :disabled="readOnly" class="mt-1 block h-8 rounded border border-gray-300 px-2">
      </label>
      <label class="min-w-56 flex-1 text-gray-500">회신 메모
        <input
          v-model="memoInput"
          type="text"
          maxlength="2000"
          :disabled="readOnly"
          :aria-invalid="isGlobalInvalid('rfq:memo')"
          :aria-describedby="isGlobalInvalid('rfq:memo') ? 'rfq-reply-validation-error' : undefined"
          data-rfq-key="rfq:memo"
          class="mt-1 block h-8 w-full rounded border border-gray-300 px-2"
          :class="{ 'border-red-500 ring-1 ring-red-200': isGlobalInvalid('rfq:memo') }"
        >
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
