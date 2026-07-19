<script setup lang="ts">
import { computed, toRef } from 'vue';
import { applyQtyToOffer, type BomOfferInput, type OfferPick } from '@sp/utils';
import type { PartOfferViewType } from '@sp/api-contract';
import { useBomPartDetail } from '../../bom/useBom';

// 오퍼 변경 모달 — 부품의 실공급사 오퍼를 필요수량 기준 실효가로 비교해 선택한다.
// samplepcb 파생 오퍼는 후보 제외(견적 선정 순환 방지 — docs/BOM_QUOTE.md).

const props = defineProps<{
  partId: string;
  needed: number;
  usdKrwRate: number | null;
}>();

const emit = defineEmits<{
  select: [pick: OfferPick];
  close: [];
}>();

const detail = useBomPartDetail(toRef(props, 'partId'));

function toOfferInput(o: PartOfferViewType): BomOfferInput {
  return {
    supplier: o.supplier,
    supplierSku: o.supplierSku,
    packaging: o.packaging,
    currency: o.currency,
    stock: o.stock,
    moq: o.moq,
    orderMultiple: o.orderMultiple,
    fetchedAt: o.fetchedAt,
    priceBreaks: o.priceBreaks.map((pb) => ({ qty: pb.qty, price: pb.price })),
  };
}

interface OfferRow {
  pick: OfferPick;
  offer: PartOfferViewType;
}

const rows = computed<OfferRow[]>(() => {
  const offers = detail.data.value?.data.offers ?? [];
  const out: OfferRow[] = [];
  for (const o of offers) {
    if (o.supplier === 'samplepcb') continue;
    const pick = applyQtyToOffer(toOfferInput(o), props.needed, props.usdKrwRate);
    if (pick !== null) out.push({ pick, offer: o });
  }
  return out.sort((a, b) => (a.pick.unitPriceKrw ?? Infinity) * a.pick.orderQty - (b.pick.unitPriceKrw ?? Infinity) * b.pick.orderQty);
});

function fmt(n: number | null, currency: string): string {
  if (n === null) return '—';
  const sym = currency === 'KRW' ? '₩' : currency === 'USD' ? '$' : `${currency} `;
  return `${sym}${n.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}`;
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold text-gray-900">오퍼 선택 — {{ detail.data.value?.data.mpn ?? '' }}</h3>
        <button type="button" class="text-gray-400 hover:text-gray-700" @click="emit('close')">✕</button>
      </div>
      <p class="mt-1 text-xs text-gray-500">필요수량 {{ needed.toLocaleString('ko-KR') }}개 기준 실효 단가·주문수량(MOQ·배수 보정)으로 비교합니다.</p>

      <p v-if="detail.isLoading.value" class="mt-6 text-sm text-gray-400">오퍼를 불러오는 중…</p>
      <p v-else-if="rows.length === 0" class="mt-6 text-sm text-gray-400">선택 가능한 오퍼가 없습니다 — 공급사 검색으로 보강해 보세요.</p>

      <div v-else class="mt-4 space-y-2">
        <button
          v-for="row in rows"
          :key="`${row.offer.supplier}-${row.offer.supplierSku}`"
          type="button"
          class="w-full rounded-lg border border-gray-200 p-3 text-left hover:border-blue-400 hover:bg-blue-50/40"
          @click="emit('select', row.pick)"
        >
          <div class="flex flex-wrap items-center gap-3 text-sm">
            <span class="font-semibold">{{ row.offer.supplier }}</span>
            <span class="text-gray-500">{{ row.offer.supplierSku }}</span>
            <span v-if="row.offer.packaging" class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{{ row.offer.packaging }}</span>
            <span v-if="row.pick.stockShort" class="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-600">재고 부족</span>
          </div>
          <div class="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
            <span>단가 <b class="tabular-nums">{{ fmt(row.pick.unitPrice, row.pick.currency) }}</b><template v-if="row.pick.currency !== 'KRW' && row.pick.unitPriceKrw !== null"> (≈₩{{ row.pick.unitPriceKrw.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) }})</template></span>
            <span>주문수량 <b class="tabular-nums">{{ row.pick.orderQty.toLocaleString('ko-KR') }}</b></span>
            <span>재고 <b class="tabular-nums">{{ row.offer.stock?.toLocaleString('ko-KR') ?? '—' }}</b></span>
            <span>MOQ {{ row.offer.moq ?? '—' }}</span>
          </div>
          <div v-if="row.offer.priceBreaks.length > 0" class="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-gray-500">
            <span v-for="pb in row.offer.priceBreaks" :key="pb.qty" class="rounded bg-gray-50 px-1.5 py-0.5 tabular-nums" :class="{ 'bg-blue-100 font-semibold text-blue-700': pb.qty === row.pick.breakQty }">{{ pb.qty }}+ : {{ fmt(pb.price, row.pick.currency) }}</span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
