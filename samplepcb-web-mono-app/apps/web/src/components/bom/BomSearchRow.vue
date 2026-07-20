<script setup lang="ts">
import { computed } from 'vue';
import type { BomPartHitType } from '@sp/api-contract';
import PartImage from '../ui/PartImage.vue';
import BomPriceBreaks from './BomPriceBreaks.vue';
import { SUPPLIER_FALLBACK_ICON, SUPPLIER_META } from '../../bom/supplier-meta';

// 단일 검색 결과의 한 행 — BOM 분석 결과 행(BomQuoteRow)의 시각 언어를 공유한다
// (공급사 배지+이미지 76px · 공용 가격구간 셀 · 초록 합계 · 재고 부족 노랑 행).
// BOM 문맥(매칭 배지·선정 이유·제외/복원·수량 편집)은 없다 — 대표 구매 조건은 서버 계산.

const props = defineProps<{
  part: BomPartHitType;
  expanded: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
}>();

const applied = computed(() => props.part.applied);

const rowClass = computed(() => (applied.value?.stockShort === true ? 'bg-[#fdf8e7]' : 'bg-white'));

function fmtMoney(value: number, currency: string): string {
  if (currency === 'KRW') return `${Math.round(value).toLocaleString('ko-KR')}원`;
  const prefix = currency === 'USD' ? '$' : `${currency} `;
  return `${prefix}${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}`;
}

const lineTotal = computed(() => {
  const offer = applied.value;
  return offer === null ? null : fmtMoney(offer.unitPrice * offer.orderQty, offer.currency);
});
</script>

<template>
  <tr class="border-b border-[#e5e8ed] align-top transition-colors" :class="rowClass">
    <!-- 부품: 공급사 배지 + 이미지 + 품번 (BomQuoteRow MPN 열과 동형) -->
    <td class="px-2 py-3">
      <div class="flex gap-2.5">
        <div class="w-[76px] shrink-0">
          <div
            v-if="applied !== null"
            class="mb-1 flex h-[20px] w-full items-center justify-center gap-1 rounded-[3px] border border-gray-200 bg-white px-1 shadow-sm"
            :title="applied.supplierSku"
          >
            <img :src="SUPPLIER_META[applied.supplier]?.icon ?? SUPPLIER_FALLBACK_ICON" alt="" class="size-[12px] rounded-[2px]">
            <span class="truncate text-[10px] font-semibold text-[#3b4252]">{{ SUPPLIER_META[applied.supplier]?.name ?? applied.supplier }}</span>
          </div>
          <PartImage
            :src="part.imageUrl"
            class="size-[76px] rounded-md border border-gray-200"
          />
        </div>
        <div class="min-w-0 pt-[22px]">
          <p class="truncate text-[14px] font-medium leading-[20px] text-[#061023]" :title="part.mpn">{{ part.mpn }}</p>
          <p v-if="part.packageCode" class="mt-0.5 text-[11px] font-medium text-[#5f6777]">{{ part.packageCode }}</p>
        </div>
      </div>
    </td>
    <td class="px-2 py-3 pt-[42px] text-[12px] leading-[16px] text-[#5f6777]">{{ part.manufacturerName }}</td>
    <td class="max-w-[220px] px-2 py-3 pt-[42px]">
      <p class="truncate text-[12px] leading-[16px] text-[#8e97a5]" :title="part.description ?? ''">{{ part.description ?? '—' }}</p>
    </td>
    <!-- UNIT PRICE: 공용 가격구간 셀 — 적용 구간(필요수량 기준)은 서버가 계산 -->
    <td class="px-2 py-2">
      <BomPriceBreaks
        v-if="applied !== null"
        :price-breaks="applied.priceBreaks.length > 0 ? applied.priceBreaks : [{ qty: applied.breakQty, price: applied.unitPrice }]"
        :active-qty="applied.breakQty"
        :currency="applied.currency"
        :fetched-at="applied.fetchedAt"
      />
      <p v-else class="pt-[24px] text-right text-[12px] text-gray-300">—</p>
    </td>
    <!-- 포장 / 주문·재고 -->
    <td class="px-2 py-3 pt-[38px]">
      <p class="truncate text-[13px] font-bold text-[#4c4c4c]">{{ applied?.packaging ?? (applied !== null ? applied.supplier : '오퍼 없음') }}</p>
      <p v-if="applied !== null" class="mt-1 text-[12px] tabular-nums text-[#5f6777]">
        주문 <b class="text-[#3b4252]">{{ applied.orderQty.toLocaleString('ko-KR') }}</b>
        / 재고 {{ applied.stock?.toLocaleString('ko-KR') ?? '—' }}
      </p>
      <p v-if="applied !== null && applied.moq !== null" class="mt-0.5 text-[11px] text-[#8e97a5]">MOQ {{ applied.moq.toLocaleString('ko-KR') }}</p>
    </td>
    <!-- TOTAL: 상태 배지 + 초록 합계 (필요수량 기준) -->
    <td class="px-2 py-3 text-right">
      <div class="flex flex-col items-end gap-1.5 pt-1">
        <span v-if="applied === null" class="rounded-full bg-sky-100 px-2.5 py-0.5 text-[12px] font-medium text-sky-700">가격 확인 필요</span>
        <span v-else-if="applied.stockShort" class="rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-medium text-amber-700">재고 부족</span>
        <span v-else class="rounded-full bg-[#01bd46]/15 px-2.5 py-0.5 text-[12px] font-medium text-[#38b614]">구매 가능</span>
        <span class="text-[14px] font-bold tabular-nums" :class="lineTotal === null ? 'text-gray-300' : 'text-[#38b614]'">
          {{ lineTotal ?? '—' }}
        </span>
      </div>
    </td>
    <!-- 액션: 전체 오퍼·공급 포장 비교 확장 -->
    <td class="px-2 py-3">
      <div class="flex flex-col gap-[5px] pt-1">
        <button
          type="button"
          class="h-[28px] w-[88px] rounded-[5px] border text-[12px] font-bold transition"
          :class="expanded ? 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50' : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'"
          :title="expanded ? '오퍼 비교 접기' : '공급 포장·전체 오퍼 비교'"
          @click="emit('toggle')"
        >
          {{ expanded ? '접기' : '구매 조건' }}
        </button>
      </div>
    </td>
  </tr>
</template>
