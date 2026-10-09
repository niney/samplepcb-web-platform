<script setup lang="ts">
import { usePartnerI18n } from '../../partner/i18n';
import { partnerIntlLocale } from '../../partner/i18n-core';
import { nextTick, ref, watch } from 'vue';
import {
  BomRfqReplyBody,
  type BomRfqItemReplyInputType,
  type BomRfqReplyBodyType,
} from '@sp/api-contract';
import { effectiveRfqReplyQty, kstDateInput } from '@sp/utils';
import {
  mdUnitPricePreview,
  type RfqReplyChildOffer,
  type RfqReplyChildOffers,
  type RfqReplyChildSelection,
} from './rfq-reply-md';

const { pt, pn, locale } = usePartnerI18n();

// 협력사 회신 폼 — 포털 회신·관리자 대리 입력 공용(docs/SMARTBOM_PARTNER_RFQ.md §4).
// 행별 단가·재고·D/C·납기·메모 입력. 단가가 비어 있는 행은 미회신으로 제출에서 제외된다.
// 합계는 서버가 재계산·박제하므로 여기서는 참고 표시만 한다.
// MOQ → 회신수량은 한 방향으로만 따라간다(§6.38): MOQ 가 필요수량을 넘으면 회신수량을
// MOQ 로 채우고, 사람이 직접 친 회신수량은 덮지 않는다. 회신수량 < MOQ 는 모순이라 막는다.
// 마스터딜러(childOffers 를 받은 경우)는 품목마다 '직접 회신' 대신 하위 회신을 골라 마진(%)을
// 얹을 수 있다 — 그 행의 단가는 서버가 하위 회신가 × 환율 × (1 + 마진%) 로 산출한다.

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
    /** 마스터딜러가 하위 회신을 골라 만든 행이면 그 근거. */
    childSelection?: RfqReplyChildSelection | null;
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
  /** 마스터딜러 전용 — 품목별로 고를 수 있는 하위 회신. 주면 '공급 경로' 열이 생긴다. */
  childOffers?: RfqReplyChildOffers | null;
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
  /** 회신수량이 MOQ 에서 파생된 값인가 — true 인 동안만 MOQ 변경을 따라간다. */
  replyQtyAuto: boolean;
  /** 마지막으로 동기화에 반영한 MOQ — 변경 감지용(제출에는 안 실린다). */
  lastMoq: number | null;
  /** 마스터딜러: 이 품목을 맡길 하위의 재요청 문서. null = 직접 회신. */
  childRfqId: number | null;
  /** 마스터딜러: 하위 회신가에 얹는 마진(%). */
  marginRate: number | null;
  /** 저장돼 있던 하위 선정 — 같은 하위·같은 회신가면 그때 굳힌 환율로 미리보기를 낸다. */
  keptSelection: RfqReplyChildSelection | null;
}

const editRows = ref<EditRow[]>([]);
const deliveryDateInput = ref('');
const memoInput = ref('');
const validationIssue = ref<{ key: string; message: string } | null>(null);
watch(locale, () => { validationIssue.value = null; });

const initRows = (): void => {
  editRows.value = props.rows.map((row) => {
    // 보유 부품 프리필(docs/PARTNER_PARTS.md) — **아직 회신하지 않은 행에만** 제안한다.
    // 이미 쓴 회신은 절대 덮지 않는다(값은 사람이 확정한 것이 정본).
    const suggest = row.reply === null ? (row.myStock ?? null) : null;
    const moq = row.reply?.moq ?? suggest?.moq ?? null;
    const savedReplyQty = row.reply?.replyQty ?? null;
    // MOQ 가 필요수량을 넘는데 회신수량이 비었으면 MOQ 로 파생(§6.38). 저장된 회신수량이
    // 정확히 MOQ 와 같으면 파생값으로 보고 이후 MOQ 변경을 계속 따라가게 둔다.
    const moqAboveNeed = moq !== null && moq > row.orderQty;
    const replyQtyAuto = savedReplyQty === null ? moqAboveNeed : moqAboveNeed && savedReplyQty === moq;
    return {
      quoteItemId: row.quoteItemId,
      mpn: row.mpn,
      manufacturerName: row.manufacturerName,
      description: row.description,
      orderQty: row.orderQty,
      // 단가는 제안하지 않는다 — 재고표 단가는 견적가가 아니고, 프리필이 곧 제시가로
      // 굳어지면 협력사가 손해를 본다(수량·환율·시점이 다르다).
      unitPrice: row.reply?.unitPrice ?? null,
      replyQty: savedReplyQty ?? (moqAboveNeed ? moq : null),
      moq,
      stock: row.reply?.stock ?? suggest?.stockQty ?? null,
      dateCode: row.reply?.dateCode ?? suggest?.dateCode ?? '',
      leadTime: row.reply?.leadTime ?? suggest?.leadTime ?? '',
      memo: row.reply?.memo ?? '',
      prefilled: suggest !== null,
      replyQtyAuto,
      lastMoq: moq,
      childRfqId: row.reply?.childSelection?.childRfqId ?? null,
      marginRate: row.reply?.childSelection?.marginRate ?? null,
      keptSelection: row.reply?.childSelection ?? null,
    };
  });
  deliveryDateInput.value = kstDateInput(props.deliveryDate);
  memoInput.value = props.memo ?? '';
};
watch(() => props.rows, initRows, { immediate: true });
watch([deliveryDateInput, memoInput], () => {
  validationIssue.value = null;
});

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const strOrNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());
const hasValue = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

// MOQ → 회신수량 한 방향 동기화. 사람이 직접 친 회신수량(replyQtyAuto=false·값 있음)은 덮지 않는다.
// MOQ 가 필요수량 이하로 내려가면 파생값은 비워 "미입력 = 필요수량" 의미로 돌아간다.
const syncReplyQtyFromMoq = (row: EditRow): void => {
  if (!row.replyQtyAuto && hasValue(row.replyQty)) return;
  const moq = num(row.moq);
  if (moq !== null && moq > row.orderQty) {
    row.replyQty = moq;
    row.replyQtyAuto = true;
  } else if (row.replyQtyAuto) {
    row.replyQty = null;
    row.replyQtyAuto = false;
  }
};
// 회신수량을 손으로 지우면 다시 MOQ 파생 대상이 된다(비운 채로 MOQ 아래에 둘 수는 없다).
const onReplyQtyChange = (row: EditRow): void => {
  if (!hasValue(row.replyQty)) syncReplyQtyFromMoq(row);
};
watch(editRows, (rows) => {
  validationIssue.value = null;
  for (const row of rows) {
    const moq = num(row.moq);
    if (moq === row.lastMoq) continue;
    row.lastMoq = moq;
    syncReplyQtyFromMoq(row);
  }
}, { deep: true });

// 부품 단가는 센트 아래가 흔하다 — 기본 숫자 표기(3자리)로는 0.0035 가 0.004 로 보인다.
const pu = (value: number): string =>
  new Intl.NumberFormat(partnerIntlLocale(locale.value), { maximumFractionDigits: 4 }).format(value);

// ── 마스터딜러: 하위 회신 선정 ──
const hasMd = (): boolean => props.childOffers != null;
const offersOf = (row: EditRow): RfqReplyChildOffer[] => props.childOffers?.[row.quoteItemId] ?? [];
const pickedOffer = (row: EditRow): RfqReplyChildOffer | null =>
  row.childRfqId === null
    ? null
    : (offersOf(row).find((offer) => offer.childRfqId === row.childRfqId) ?? null);
/** 하위를 고른 행인데 그 하위 회신이 지금은 없다(회수·재회신으로 사라짐) — 다시 골라야 한다. */
const childMissing = (row: EditRow): boolean => row.childRfqId !== null && pickedOffer(row) === null;
/** 하위를 고른 행의 상위 회신가 미리보기. 환율을 모르면 null(저장하면 서버가 산출). */
const mdPrice = (row: EditRow): number | null => {
  const offer = pickedOffer(row);
  return offer === null ? null : mdUnitPricePreview(offer, num(row.marginRate) ?? 0, row.keptSelection);
};
/** 이 행의 단가 — 하위를 골랐으면 산출값, 아니면 직접 입력값. */
const priceOf = (row: EditRow): number | null =>
  row.childRfqId === null ? num(row.unitPrice) : mdPrice(row);
const offerLabel = (offer: RfqReplyChildOffer): string =>
  offer.unitPriceInMine === null || offer.currency === props.currency
    ? `${offer.partnerName} · ${pu(offer.unitPrice)} ${offer.currency}`
    : `${offer.partnerName} · ${pu(offer.unitPrice)} ${offer.currency} (≈ ${pu(offer.unitPriceInMine)} ${props.currency})`;
// 하위를 고르는 순간 그 회신의 수량·재고·D/C·납기를 가져온다(사람이 고른 행동이라 덮어쓴다).
const onChildChange = (row: EditRow): void => {
  const offer = pickedOffer(row);
  if (offer === null) {
    row.marginRate = null;
    return;
  }
  row.marginRate ??= 0;
  row.moq = offer.moq;
  row.replyQty = offer.replyQty;
  row.replyQtyAuto = false;
  row.lastMoq = offer.moq;
  row.stock = offer.stock;
  row.dateCode = offer.dateCode ?? '';
  row.leadTime = offer.leadTime ?? '';
  row.unitPrice = null;
};

// 서버 박제와 같은 자릿수 — 원화 0자리·외화 2자리.
const roundMoney = (amount: number): number =>
  props.currency === 'KRW' ? Math.round(amount) : Math.round(amount * 100) / 100;

const lineTotal = (row: EditRow): number | null => {
  const price = priceOf(row);
  if (price === null) return null;
  // 서버 합계·관리자 비교표와 같은 공식 — 회신수량(?? 필요수량)에 MOQ 바닥.
  const qty = effectiveRfqReplyQty(row.orderQty, num(row.replyQty), num(row.moq));
  return roundMoney(price * qty);
};

const repliedCount = (): number =>
  editRows.value.filter((r) => r.childRfqId !== null || num(r.unitPrice) !== null).length;

const grandTotal = (): number =>
  roundMoney(editRows.value.reduce((sum, row) => sum + (lineTotal(row) ?? 0), 0));

const partLabel = (row: EditRow): string =>
  row.mpn.trim() !== ''
    ? row.mpn
    : (row.manufacturerName ?? row.description ?? pt('품목 {value1}', { value1: row.quoteItemId }));

const tableScroll = ref<HTMLElement | null>(null);
type NumericField = 'unitPrice' | 'replyQty' | 'moq' | 'stock' | 'marginRate';

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
    pt('{value1} {value2}은 {value3} 이상의 정수로 입력해 주세요.', { value1: partLabel(row), value2: label, value3: String(minimum) }),
  );
}

function validateRows(): boolean {
  for (const row of editRows.value) {
    if (row.childRfqId !== null) {
      if (childMissing(row)) {
        return rejectInput(
          fieldKey(row, 'marginRate'),
          pt('{value1}에 고른 하위 협력사 회신이 지금은 없습니다. 다시 골라 주세요.', { value1: partLabel(row) }),
        );
      }
      const margin = num(row.marginRate);
      if (margin === null || margin < 0 || margin > 1000) {
        return rejectInput(
          fieldKey(row, 'marginRate'),
          pt('{value1} 마진율은 0 이상의 숫자(%)로 입력해 주세요.', { value1: partLabel(row) }),
        );
      }
    }
    const priceEntered = row.childRfqId !== null || hasValue(row.unitPrice);
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
          pt('{value1}의 회신 내용을 저장하려면 단가를 입력해 주세요.', { value1: partLabel(row) }),
        );
      }
      continue;
    }

    const price = row.childRfqId !== null ? 0 : num(row.unitPrice);
    if (price === null || price < 0) {
      return rejectInput(
        fieldKey(row, 'unitPrice'),
        pt('{value1} 단가는 0 이상의 숫자로 입력해 주세요.', { value1: partLabel(row) }),
      );
    }
    if (!validateInteger(row, 'replyQty', pt('회신수량'), 1)) return false;
    if (!validateInteger(row, 'moq', 'MOQ', 1)) return false;
    const replyQty = num(row.replyQty);
    const moq = num(row.moq);
    if (replyQty !== null && moq !== null && replyQty < moq) {
      return rejectInput(
        fieldKey(row, 'replyQty'),
        pt('{value1} 회신수량은 MOQ({value2}) 이상이어야 합니다.', { value1: partLabel(row), value2: pn(moq) }),
      );
    }
    if (!validateInteger(row, 'stock', pt('재고'), 0)) return false;
    if (row.dateCode.trim().length > 100) {
      return rejectInput(fieldKey(row, 'dateCode'), pt('{value1} Date Code는 100자 이내로 입력해 주세요.', { value1: partLabel(row) }));
    }
    if (row.leadTime.trim().length > 64) {
      return rejectInput(fieldKey(row, 'leadTime'), pt('{value1} 납기는 64자 이내로 입력해 주세요.', { value1: partLabel(row) }));
    }
    if (row.memo.trim().length > 500) {
      return rejectInput(fieldKey(row, 'memo'), pt('{value1} 회신 메모는 500자 이내로 입력해 주세요.', { value1: partLabel(row) }));
    }
  }
  if (memoInput.value.trim().length > 2000) {
    return rejectInput('rfq:memo', pt('전체 회신 메모는 2,000자 이내로 입력해 주세요.'));
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
      if (row.childRfqId !== null) return true;
      const price = num(row.unitPrice);
      return price !== null && price >= 0;
    })
    .map((row) => ({
      quoteItemId: row.quoteItemId,
      // 하위를 고른 행의 단가는 서버가 산출한다 — 여기 값은 미리보기일 뿐이다.
      unitPrice: priceOf(row) ?? 0,
      replyQty: num(row.replyQty),
      moq: num(row.moq),
      stock: num(row.stock),
      dateCode: strOrNull(row.dateCode),
      leadTime: strOrNull(row.leadTime),
      memo: strOrNull(row.memo),
      ...(row.childRfqId === null
        ? {}
        : { childRfqId: row.childRfqId, marginRate: num(row.marginRate) ?? 0 }),
    }));
  const result = BomRfqReplyBody.safeParse({
    items,
    deliveryDate: deliveryDateInput.value === '' ? null : deliveryDateInput.value,
    memo: strOrNull(memoInput.value),
  });
  if (!result.success) {
    rejectInput('rfq:memo', pt('입력값을 다시 확인해 주세요. 숫자와 글자 수가 허용 범위여야 합니다.'));
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
        <span class="min-w-0 flex-1">{{ pt('좌우로 이동해 회신수량·재고·D/C·납기·메모와 금액을 확인하세요.') }}</span>
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded border border-blue-200 bg-white text-sm hover:bg-blue-100"
          :aria-label="pt('RFQ 회신 표 왼쪽으로 이동')"
          @click="moveTable(-1)"
        >
          ←
        </button>
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded border border-blue-200 bg-white text-sm hover:bg-blue-100"
          :aria-label="pt('RFQ 회신 표 오른쪽으로 이동')"
          @click="moveTable(1)"
        >
          →
        </button>
      </div>
      <table class="divide-y divide-gray-100 text-xs" :class="hasMd() ? 'min-w-[1240px]' : 'min-w-[960px]'">
        <thead class="bg-gray-50 text-left text-gray-500">
          <tr class="whitespace-nowrap">
            <th class="px-2 py-2">{{ pt('부품') }}</th>
            <th class="px-2 py-2 text-right">{{ pt('필요수량') }}</th>
            <th v-if="hasMd()" class="px-2 py-2">{{ pt('공급 경로 · 마진') }}</th>
            <th class="px-2 py-2 text-right">{{ pt('단가({value1})', { value1: currency }) }}</th>
            <th class="px-2 py-2 text-right">{{ pt('회신수량') }}</th>
            <th class="px-2 py-2 text-right">MOQ</th>
            <th class="px-2 py-2 text-right">{{ pt('재고') }}</th>
            <th class="px-2 py-2">D/C</th>
            <th class="px-2 py-2">{{ pt('납기') }}</th>
            <th class="px-2 py-2">{{ pt('메모') }}</th>
            <th class="px-2 py-2 text-right">{{ pt('금액') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          <tr v-for="row in editRows" :key="row.quoteItemId">
            <td class="max-w-56 px-2 py-1.5">
              <div class="truncate font-medium">{{ row.mpn === '' ? pt('품번 미기재') : row.mpn }}</div>
              <div class="truncate text-gray-400">{{ row.manufacturerName ?? row.description ?? '' }}</div>
              <!-- 보유 부품에서 채운 행 — 값은 제안이므로 확인하고 고칠 수 있게 알린다 -->
              <div
                v-if="row.prefilled"
                class="mt-0.5 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                :title="pt('올려 두신 보유 부품 목록에서 재고·D/C·납기를 채웠습니다. 확인하고 고쳐 주세요 (단가는 채우지 않습니다).')"
              >
                {{ pt('보유 목록에서 채움') }}
              </div>
            </td>
            <td class="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
              {{ pn(row.orderQty) }}
            </td>
            <!-- 마스터딜러: 직접 회신하거나, 하위 회신을 골라 마진을 얹는다 -->
            <td v-if="hasMd()" class="px-2 py-1.5">
              <div class="flex items-center gap-1.5">
                <select
                  v-model="row.childRfqId"
                  :disabled="readOnly"
                  :aria-label="pt('{value1} 공급 경로', { value1: partLabel(row) })"
                  class="h-7 max-w-52 rounded border border-gray-300 bg-white px-1.5"
                  @change="onChildChange(row)"
                >
                  <option :value="null">{{ pt('직접 회신') }}</option>
                  <option v-for="offer in offersOf(row)" :key="offer.childRfqId" :value="offer.childRfqId">
                    {{ offerLabel(offer) }}
                  </option>
                  <option v-if="childMissing(row)" :value="row.childRfqId" disabled>
                    {{ pt('회신이 없어진 하위') }}
                  </option>
                </select>
                <template v-if="row.childRfqId !== null">
                  <input
                    v-model.number="row.marginRate"
                    type="number"
                    min="0"
                    step="any"
                    :disabled="readOnly"
                    :aria-label="pt('{value1} 마진율(%)', { value1: partLabel(row) })"
                    :aria-invalid="isInvalid(row, 'marginRate')"
                    :aria-describedby="isInvalid(row, 'marginRate') ? 'rfq-reply-validation-error' : undefined"
                    :data-rfq-key="fieldKey(row, 'marginRate')"
                    class="w-14 rounded border border-gray-300 px-1.5 py-1 text-right tabular-nums"
                    :class="{ 'border-red-500 ring-1 ring-red-200': isInvalid(row, 'marginRate') }"
                  >
                  <span class="text-gray-400">%</span>
                </template>
              </div>
              <p
                v-if="row.keptSelection?.stale === true && row.childRfqId === row.keptSelection.childRfqId"
                class="mt-0.5 text-[10px] font-semibold text-amber-700"
              >
                {{ pt('하위 회신이 바뀌었습니다 — 저장하면 새 값으로 반영됩니다.') }}
              </p>
              <p v-else-if="offersOf(row).length === 0 && row.childRfqId === null" class="mt-0.5 text-[10px] text-gray-400">
                {{ pt('하위 회신 없음') }}
              </p>
            </td>
            <td v-if="row.childRfqId !== null" class="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
              <span :title="pt('하위 회신가에 환율과 마진을 적용한 값입니다. 저장할 때 서버가 확정합니다.')">
                {{ mdPrice(row) === null ? pt('저장 시 산출') : pu(mdPrice(row) ?? 0) }}
              </span>
            </td>
            <td v-else class="px-2 py-1.5">
              <input
                v-model.number="row.unitPrice"
                type="number"
                min="0"
                step="any"
                :disabled="readOnly"
                :aria-label="pt('{value1} 단가({value2})', { value1: partLabel(row), value2: currency })"
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
                :aria-label="pt('{value1} 회신수량', { value1: partLabel(row) })"
                :aria-invalid="isInvalid(row, 'replyQty')"
                :aria-describedby="isInvalid(row, 'replyQty') ? 'rfq-reply-validation-error' : undefined"
                :data-rfq-key="fieldKey(row, 'replyQty')"
                :title="row.replyQtyAuto ? pt('MOQ에 맞춰 자동으로 채운 수량입니다. 직접 고칠 수 있습니다.') : undefined"
                class="w-20 rounded border border-gray-300 px-1.5 py-1 text-right tabular-nums"
                :class="{
                  'border-red-500 ring-1 ring-red-200': isInvalid(row, 'replyQty'),
                  'bg-amber-50': row.replyQtyAuto && !isInvalid(row, 'replyQty'),
                }"
                @input="row.replyQtyAuto = false"
                @change="onReplyQtyChange(row)"
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
                :aria-label="pt('{value1} 재고', { value1: partLabel(row) })"
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
                :placeholder="pt('예: 2주')"
                :aria-label="pt('{value1} 납기', { value1: partLabel(row) })"
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
                :aria-label="pt('{value1} 회신 메모', { value1: partLabel(row) })"
                :aria-invalid="isInvalid(row, 'memo')"
                :aria-describedby="isInvalid(row, 'memo') ? 'rfq-reply-validation-error' : undefined"
                :data-rfq-key="fieldKey(row, 'memo')"
                class="w-28 rounded border border-gray-300 px-1.5 py-1"
                :class="{ 'border-red-500 ring-1 ring-red-200': isInvalid(row, 'memo') }"
              >
            </td>
            <td class="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
              {{ lineTotal(row) === null ? '—' : `${pn(lineTotal(row) ?? 0)}` }}
            </td>
          </tr>
          <tr v-if="editRows.length === 0">
            <td :colspan="hasMd() ? 11 : 10" class="px-2 py-8 text-center text-gray-400">{{ pt('요청 부품행이 없습니다.') }}</td>
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
      <label class="text-gray-500">{{ pt('납기(전체)') }} <input v-model="deliveryDateInput" type="date" :disabled="readOnly" class="mt-1 block h-8 rounded border border-gray-300 px-2">
      </label>
      <label class="min-w-56 flex-1 text-gray-500">{{ pt('회신 메모') }} <input
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
        <p class="text-gray-500">{{ pt('회신 {value1} / {value2}행', { value1: repliedCount(), value2: editRows.length }) }}</p>
        <p class="font-bold tabular-nums">{{ pt('합계(참고) {value1} {value2}', { value1: pn(grandTotal()), value2: currency }) }}</p>
      </div>
      <button
        v-if="!readOnly"
        type="button"
        class="h-9 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
        :disabled="busy === true"
        @click="submit"
      >
        {{ pt('회신 저장') }}
      </button>
    </div>
  </div>
</template>
