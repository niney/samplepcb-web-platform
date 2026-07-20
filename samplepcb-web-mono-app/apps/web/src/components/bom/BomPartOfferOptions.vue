<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PartHitType, PartOfferViewType } from '@sp/api-contract';
import {
  applyQtyToOffer,
  pickDefaultOffer,
  type BomOfferInput,
  type OfferPick,
} from '@sp/utils';
import { useBomPartDetail } from '../../bom/useBom';
import { fmtAge } from '../../bom/format';

// 부품 1건의 공급 포장·오퍼 비교(+선택 문맥의 확정 CTA) — BomPartSearchPanel(부품 변경)과
// 단일 검색 행 확장이 공유한다. browse=열람 전용(확정 CTA 숨김, 비교 인터랙션은 유지).

const props = withDefaults(defineProps<{
  part: PartHitType;
  needed?: number;
  usdKrwRate?: number | null;
  selecting?: boolean;
  browse?: boolean;
  currentPartId?: string | null;
}>(), {
  needed: 1,
  usdKrwRate: null,
  selecting: false,
  browse: false,
  currentPartId: null,
});

const emit = defineEmits<{
  select: [part: PartHitType, pick: OfferPick | null];
}>();

interface OfferRow {
  key: string;
  pick: OfferPick;
  recommended: boolean;
}

interface PackagingGroup {
  key: string;
  label: string;
  rows: OfferRow[];
  recommended: boolean;
}

const selectedOfferKey = ref<string | null>(null);
const activePackagingKey = ref<string | null>(null);
const partId = computed<string | null>(() => props.part.id);
const detail = useBomPartDetail(partId);

function toOfferInput(offer: PartOfferViewType): BomOfferInput {
  return {
    supplier: offer.supplier,
    supplierSku: offer.supplierSku,
    packaging: offer.packaging,
    currency: offer.currency,
    stock: offer.stock,
    moq: offer.moq,
    orderMultiple: offer.orderMultiple,
    fetchedAt: offer.fetchedAt,
    priceBreaks: offer.priceBreaks.map((priceBreak) => ({ qty: priceBreak.qty, price: priceBreak.price })),
  };
}

const offerInputs = computed<BomOfferInput[]>(() => {
  const data = detail.data.value?.data;
  if (data === undefined || data.id !== props.part.id) return [];
  return data.offers
    .filter((offer) => offer.supplier !== 'samplepcb')
    .map(toOfferInput);
});

const recommendedPick = computed(() => pickDefaultOffer(offerInputs.value, props.needed, props.usdKrwRate));

function offerKey(pick: OfferPick): string {
  return `${pick.offer.supplier}\u001f${pick.offer.supplierSku}`;
}

function packagingKey(packaging: string | null): string {
  const value = packaging?.trim().toLowerCase();
  return value === undefined || value === '' ? '__unknown__' : value;
}

function packagingLabel(packaging: string | null): string {
  const value = packaging?.trim();
  return value === undefined || value === '' ? '포장 미확인' : value;
}

function lineCost(pick: OfferPick): number {
  return (pick.unitPriceKrw ?? pick.unitPrice) * pick.orderQty;
}

function groupCost(group: PackagingGroup): number {
  const first = group.rows[0];
  return first === undefined ? Number.POSITIVE_INFINITY : lineCost(first.pick);
}

const offerRows = computed<OfferRow[]>(() => {
  const recommendedKey = recommendedPick.value === null ? null : offerKey(recommendedPick.value);
  const rows: OfferRow[] = [];
  for (const offer of offerInputs.value) {
    const pick = applyQtyToOffer(offer, props.needed, props.usdKrwRate);
    if (pick === null) continue;
    const key = offerKey(pick);
    rows.push({ key, pick, recommended: key === recommendedKey });
  }
  return rows.sort((a, b) => Number(b.recommended) - Number(a.recommended) || lineCost(a.pick) - lineCost(b.pick));
});

const packagingGroups = computed<PackagingGroup[]>(() => {
  const groups = new Map<string, PackagingGroup>();
  for (const row of offerRows.value) {
    const key = packagingKey(row.pick.offer.packaging);
    const current = groups.get(key);
    if (current === undefined) {
      groups.set(key, {
        key,
        label: packagingLabel(row.pick.offer.packaging),
        rows: [row],
        recommended: row.recommended,
      });
    } else {
      current.rows.push(row);
      current.recommended ||= row.recommended;
    }
  }
  return [...groups.values()].sort((a, b) =>
    Number(b.recommended) - Number(a.recommended)
      || groupCost(a) - groupCost(b),
  );
});

watch(
  [() => props.part.id, () => recommendedPick.value === null ? null : offerKey(recommendedPick.value)],
  ([, recommendedKey]) => {
    selectedOfferKey.value = recommendedKey;
    const row = recommendedKey === null ? offerRows.value[0] : offerRows.value.find((entry) => entry.key === recommendedKey);
    activePackagingKey.value = row === undefined ? null : packagingKey(row.pick.offer.packaging);
  },
  { immediate: true },
);

const activeRows = computed(() =>
  packagingGroups.value.find((group) => group.key === activePackagingKey.value)?.rows ?? [],
);
const selectedRow = computed(() => offerRows.value.find((row) => row.key === selectedOfferKey.value) ?? null);

function selectPackaging(group: PackagingGroup): void {
  if (props.selecting) return;
  activePackagingKey.value = group.key;
  selectedOfferKey.value = group.rows[0]?.key ?? null;
}

function confirmSelection(): void {
  if (props.selecting || props.browse) return;
  emit('select', props.part, selectedRow.value?.pick ?? null);
}

function fmtUnit(pick: OfferPick): string {
  const prefix = pick.currency === 'KRW' ? '₩' : pick.currency === 'USD' ? '$' : `${pick.currency} `;
  return `${prefix}${pick.unitPrice.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}`;
}

function fmtTotal(pick: OfferPick): string {
  if (pick.unitPriceKrw !== null) return `${Math.round(pick.unitPriceKrw * pick.orderQty).toLocaleString('ko-KR')}원`;
  const prefix = pick.currency === 'USD' ? '$' : `${pick.currency} `;
  return `${prefix}${(pick.unitPrice * pick.orderQty).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}`;
}
</script>

<template>
  <div>
    <div v-if="detail.isLoading.value || detail.isFetching.value" class="flex items-center justify-center gap-2 px-4 py-10 text-sm font-medium text-blue-700" aria-live="polite">
      <span class="size-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      공급 포장과 가격을 확인하고 있습니다.
    </div>
    <div v-else-if="detail.isError.value" class="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
      공급사 구매 조건을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
    </div>
    <div v-else-if="offerRows.length === 0" class="p-4">
      <div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
        {{ browse
          ? '가격이 있는 공급사 오퍼가 아직 없습니다. 공급사 검색이 쌓이면 구매 조건이 표시됩니다.'
          : '가격이 있는 공급사 오퍼가 없어 공급 포장을 선택할 수 없습니다. 부품만 변경하면 금액은 미산정 상태로 저장됩니다.' }}
      </div>
      <button v-if="!browse" type="button" class="mt-3 h-11 w-full rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300" :disabled="selecting" @click="confirmSelection">
        {{ selecting ? '적용 중…' : '가격 없이 부품만 변경' }}
      </button>
    </div>
    <div v-else class="p-4">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h4 class="text-sm font-bold text-slate-950">공급 포장 선택</h4>
          <p class="mt-1 text-xs text-slate-500">필요수량 {{ needed.toLocaleString('ko-KR') }}개 기준으로 MOQ·주문배수·재고·총액을 비교합니다.</p>
        </div>
        <span class="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">추천 조건 자동 선택</span>
      </div>

      <div class="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="공급 포장">
        <button
          v-for="group in packagingGroups"
          :key="group.key"
          type="button"
          role="tab"
          class="rounded-xl border px-3 py-2 text-left transition"
          :class="group.key === activePackagingKey ? 'border-blue-500 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'"
          :aria-selected="group.key === activePackagingKey"
          :disabled="selecting"
          @click="selectPackaging(group)"
        >
          <span class="block text-xs font-bold">{{ group.label }}</span>
          <span class="mt-0.5 block text-[10px]" :class="group.key === activePackagingKey ? 'text-blue-100' : 'text-slate-400'">
            {{ group.rows.length }}개 오퍼<span v-if="group.recommended"> · 추천</span>
          </span>
        </button>
      </div>

      <div class="mt-3 space-y-2" role="radiogroup" aria-label="공급사 오퍼">
        <button
          v-for="row in activeRows"
          :key="row.key"
          type="button"
          role="radio"
          class="w-full rounded-xl border bg-white p-3 text-left transition"
          :class="row.key === selectedOfferKey ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 hover:border-blue-300'"
          :aria-checked="row.key === selectedOfferKey"
          :disabled="selecting"
          @click="selectedOfferKey = row.key"
        >
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="grid size-4 place-items-center rounded-full border" :class="row.key === selectedOfferKey ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300'"><span v-if="row.key === selectedOfferKey" class="size-1.5 rounded-full bg-white" /></span>
            <strong class="uppercase text-slate-900">{{ row.pick.offer.supplier }}</strong>
            <span class="text-xs text-slate-500">{{ row.pick.offer.supplierSku }}</span>
            <span v-if="row.recommended" class="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">전체 추천</span>
            <span v-if="row.pick.stockShort" class="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">재고 부족</span>
            <strong class="ml-auto tabular-nums text-blue-700">{{ fmtTotal(row.pick) }}</strong>
          </div>
          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-6 text-[11px] text-slate-500">
            <span>단가 <b class="text-slate-700">{{ fmtUnit(row.pick) }}</b></span>
            <span>필요 {{ needed.toLocaleString('ko-KR') }}개 → 주문 <b class="text-slate-700">{{ row.pick.orderQty.toLocaleString('ko-KR') }}개</b></span>
            <span>MOQ <b class="text-slate-700">{{ row.pick.offer.moq?.toLocaleString('ko-KR') ?? '—' }}</b></span>
            <span>재고 <b class="text-slate-700">{{ row.pick.offer.stock?.toLocaleString('ko-KR') ?? '—' }}</b></span>
            <span class="text-slate-400">기준 {{ fmtAge(row.pick.offer.fetchedAt) }}</span>
          </div>
        </button>
      </div>

      <div v-if="selectedRow !== null" class="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="text-xs text-slate-600">
            선택: <b class="text-slate-950">{{ packagingLabel(selectedRow.pick.offer.packaging) }} · {{ selectedRow.pick.offer.supplier }}</b>
            <span class="ml-1">/ {{ selectedRow.pick.orderQty.toLocaleString('ko-KR') }}개 주문</span>
          </div>
          <strong class="tabular-nums text-blue-700">{{ fmtTotal(selectedRow.pick) }}</strong>
        </div>
      </div>
      <button v-if="!browse" type="button" class="mt-3 h-11 w-full rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300" :disabled="selecting || selectedRow === null" @click="confirmSelection">
        {{ selecting ? '적용 중…' : part.id === currentPartId ? '선택한 공급 포장으로 변경' : '선택한 구매조건으로 부품 변경' }}
      </button>
    </div>
  </div>
</template>
