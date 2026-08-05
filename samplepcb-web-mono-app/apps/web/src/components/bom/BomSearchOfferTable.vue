<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
  BomPartHitType,
  BomPartOfferOptionType,
  BomSearchCartAddBodyType,
} from '@sp/api-contract';
import { applyQtyToOffer, type BomOfferInput, type OfferPick } from '@sp/utils';
import PartImage from '../ui/PartImage.vue';
import { SUPPLIER_FALLBACK_ICON, SUPPLIER_META } from '../../bom/supplier-meta';
import BomSearchCheckbox from './BomSearchCheckbox.vue';

const props = defineProps<{
  items: BomPartHitType[];
  needed: number;
  usdKrwRate: number | null;
  cartPartIds: Set<string>;
  cartSelectionKeys: Set<string>;
  pendingKey: string | null;
  cartBusy: boolean;
}>();

const emit = defineEmits<{
  add: [body: BomSearchCartAddBodyType, key: string];
  remove: [partId: string];
}>();

interface SearchOfferRow {
  key: string;
  part: BomPartHitType;
  offer: BomPartOfferOptionType;
}

function selectionKey(part: BomPartHitType, offer: BomPartOfferOptionType): string {
  return offer.offerKind === 'manufacturer_catalog'
    ? `${part.id}\u001fmanufacturer_catalog`
    : `${part.id}\u001fsupplier_offer\u001f${offer.supplier}\u001f${offer.supplierSku}`;
}

function rowKey(part: BomPartHitType, offer: BomPartOfferOptionType): string {
  return `${selectionKey(part, offer)}\u001f${offer.fetchedAt}`;
}

const allRows = computed<SearchOfferRow[]>(() => props.items.flatMap((part) =>
  part.offerOptions.map((offer) => ({ key: rowKey(part, offer), part, offer }))));
const pricedRows = computed(() => allRows.value.filter((row) =>
  row.offer.offerKind === 'supplier_offer' && pickFor(row) !== null));
const inquiryRows = computed(() => allRows.value.filter((row) =>
  row.offer.offerKind === 'manufacturer_catalog'));
const pricedSupplierCount = computed(() => new Set(
  pricedRows.value.map((row) => row.offer.supplier),
).size);

const quantities = ref<Record<string, number>>({});
watch(
  () => [props.needed, props.items.map((part) => part.id).join(',')] as const,
  () => { quantities.value = {}; },
);

function quantityFor(row: SearchOfferRow): number {
  return quantities.value[row.key] ?? props.needed;
}

function setQuantity(row: SearchOfferRow, value: number | string): void {
  const numeric = typeof value === 'number' ? value : Number(value);
  quantities.value[row.key] = Number.isFinite(numeric)
    ? Math.min(1_000_000, Math.max(1, Math.floor(numeric)))
    : 1;
}

function toOfferInput(offer: BomPartOfferOptionType): BomOfferInput {
  return {
    supplier: offer.supplier,
    supplierSku: offer.supplierSku,
    packaging: offer.packaging,
    currency: offer.currency,
    stock: offer.stock,
    moq: offer.moq,
    orderMultiple: offer.orderMultiple,
    fetchedAt: offer.fetchedAt,
    priceBreaks: offer.priceBreaks.map((priceBreak) => ({
      ...priceBreak,
      currency: offer.currency ?? '',
    })),
  };
}

function pickFor(row: SearchOfferRow): OfferPick | null {
  if (row.offer.offerKind === 'manufacturer_catalog') return null;
  return applyQtyToOffer(toOfferInput(row.offer), quantityFor(row), props.usdKrwRate);
}

function displayPrice(row: SearchOfferRow): { amount: string; unit: string; title: string } | null {
  const pick = pickFor(row);
  if (pick === null) return null;
  const converted = pick.unitPriceKrw !== null;
  const value = pick.unitPriceKrw ?? pick.unitPrice;
  const currency = converted ? 'KRW' : pick.currency;
  const amount = currency === 'KRW'
    ? Math.round(value).toLocaleString('ko-KR')
    : value.toLocaleString('ko-KR', { maximumFractionDigits: 4 });
  const title = converted && pick.currency !== 'KRW'
    ? `환산 전 ${pick.currency === 'USD' ? '$' : `${pick.currency} `}${pick.unitPrice.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}`
    : currency === 'KRW' ? `${amount}원` : `${currency} ${amount}`;
  return { amount, unit: currency === 'KRW' ? '원' : currency, title };
}

function supplierName(supplier: string): string {
  return SUPPLIER_META[supplier]?.name ?? supplier;
}

function supplierDetail(row: SearchOfferRow): string {
  return [row.offer.supplierSku, row.offer.packaging]
    .filter((value): value is string => value !== null && value.trim() !== '')
    .join(' · ');
}

function stockText(row: SearchOfferRow): string {
  return row.offer.stock === null
    ? '재고 확인 필요'
    : `재고 ${row.offer.stock.toLocaleString('ko-KR')}개`;
}

function stockClass(row: SearchOfferRow): string {
  if (row.offer.stock === null) return 'text-ink-muted';
  return pickFor(row)?.stockShort === true ? 'text-state-review' : 'text-state-matched';
}

function orderCondition(row: SearchOfferRow, inquiry = false): string {
  const moq = row.offer.moq === null ? '—' : row.offer.moq.toLocaleString('ko-KR');
  const leadTime = row.offer.leadTime?.trim();
  return `MOQ ${moq}, ${leadTime === undefined || leadTime === '' ? (inquiry ? '납기 협의' : '납기 확인') : leadTime}`;
}

function isSelected(row: SearchOfferRow): boolean {
  return props.cartSelectionKeys.has(selectionKey(row.part, row.offer));
}

function add(row: SearchOfferRow): void {
  const selection: BomSearchCartAddBodyType['selection'] = row.offer.offerKind === 'manufacturer_catalog'
    ? { kind: 'manufacturer_catalog' }
    : {
        kind: 'supplier_offer',
        supplier: row.offer.supplier,
        supplierSku: row.offer.supplierSku,
      };
  emit('add', {
    partId: row.part.id,
    bomQty: quantityFor(row),
    selection,
  }, row.key);
}

function toggleSelection(row: SearchOfferRow): void {
  if (isSelected(row)) {
    emit('remove', row.part.id);
    return;
  }
  add(row);
}

function actionLabel(row: SearchOfferRow, inquiry = false): string {
  if (props.pendingKey === row.key) return '처리 중…';
  if (isSelected(row)) return '적용';
  if (props.cartPartIds.has(row.part.id)) return '변경';
  return inquiry ? '견적담기' : '담기';
}
</script>

<template>
  <div class="space-y-[12px] pb-8 font-noto">
    <section class="overflow-hidden rounded-[10px] border border-line-search-strong bg-search-row">
      <div class="flex h-[40px] items-center border-b border-line-search-strong bg-search-section px-[14px]">
        <h3 class="text-[13px] font-medium leading-[16px] text-ink-neutral">
          가격 재고 확인됨
          <strong class="font-bold text-brand-soft">({{ pricedSupplierCount.toLocaleString('ko-KR') }}업체)</strong>
        </h3>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[1140px] table-fixed border-collapse">
          <colgroup>
            <col class="w-[3%]">
            <col class="w-[24%]">
            <col class="w-[24%]">
            <col class="w-[11%]">
            <col class="w-[10%]">
            <col class="w-[12%]">
            <col class="w-[9%]">
            <col class="w-[7%]">
          </colgroup>
          <thead>
            <tr class="h-[40px] border-b border-line-soft bg-search-head text-left text-[10px] font-normal uppercase leading-[24px] text-ink-subtle">
              <th class="px-[14px] text-center"><span class="sr-only">선택</span></th>
              <th class="px-[8px]">MPN</th>
              <th class="px-[8px]">Distributor</th>
              <th class="px-[8px]">Unit price</th>
              <th class="px-[8px]">Stock</th>
              <th class="px-[8px]">Quantity</th>
              <th class="px-[8px] text-center"><span class="sr-only">구매 수량</span></th>
              <th class="px-[8px] text-center"><span class="sr-only">카트</span></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in pricedRows"
              :key="row.key"
              class="h-[94px] border-b border-line-soft bg-search-row align-middle last:border-b-0"
            >
              <td class="px-[14px] text-center">
                <BomSearchCheckbox
                  :checked="isSelected(row)"
                  :disabled="pendingKey !== null || cartBusy"
                  :label="`${row.part.mpn} ${supplierName(row.offer.supplier)} 구매 조건 선택`"
                  @change="toggleSelection(row)"
                />
              </td>
              <td class="px-[8px] py-[9px]">
                <div class="flex min-w-0 items-center gap-[24px]">
                  <PartImage :src="row.part.imageUrl" class="size-[64px] shrink-0 rounded-[8px] bg-surface-neutral" />
                  <div class="min-w-0">
                    <p class="truncate text-[14px] font-medium leading-[20px] text-ink-strong" :title="row.part.mpn">{{ row.part.mpn }}</p>
                    <p class="truncate text-[12px] font-normal leading-[16px] text-ink-subtle" :title="row.part.manufacturerName">{{ row.part.manufacturerName }}</p>
                  </div>
                </div>
              </td>
              <td class="px-[8px]">
                <p class="flex min-w-0 items-center gap-[5px] text-[12px] font-medium leading-[20px] text-ink-strong">
                  <img :src="SUPPLIER_META[row.offer.supplier]?.icon ?? SUPPLIER_FALLBACK_ICON" alt="" class="size-[12px] shrink-0 rounded-[2px]">
                  <span class="truncate">{{ supplierName(row.offer.supplier) }}</span>
                </p>
                <p class="mt-[2px] truncate text-[11px] font-normal leading-[16px] text-ink-muted" :title="supplierDetail(row)">{{ supplierDetail(row) }}</p>
              </td>
              <td class="px-[8px]">
                <p v-if="displayPrice(row) !== null" class="whitespace-nowrap text-brand-soft" :title="displayPrice(row)?.title">
                  <strong class="font-sans text-[20px] font-bold leading-[24px] tabular-nums text-ink-strong">{{ displayPrice(row)?.amount }}</strong>
                  <span class="ml-[3px] text-[14px] font-normal leading-[16px]">{{ displayPrice(row)?.unit }}</span>
                </p>
                <span v-else class="text-[12px] text-ink-subtle">—</span>
              </td>
              <td class="px-[8px] text-[12px] font-normal leading-[16px]" :class="stockClass(row)">
                {{ stockText(row) }}
              </td>
              <td class="px-[8px] text-[12px] font-normal leading-[16px] text-ink-muted">
                {{ orderCondition(row) }}
              </td>
              <td class="px-[8px]">
                <input
                  :value="quantityFor(row)"
                  type="number"
                  min="1"
                  max="1000000"
                  class="mx-auto block h-[38px] w-[90px] rounded-[6px] border border-line-strong bg-search-input text-center font-sans text-[16px] font-bold tabular-nums text-ink-strong outline-none focus:border-brand-soft"
                  aria-label="담을 수량"
                  @input="setQuantity(row, ($event.target as HTMLInputElement).value)"
                >
              </td>
              <td class="px-[8px] text-center">
                <button
                  type="button"
                  class="h-[24px] min-w-[70px] rounded-[4px] bg-ink-muted px-[8px] font-sans text-[13px] font-medium text-white transition hover:opacity-85 disabled:cursor-wait disabled:opacity-50"
                  :disabled="pendingKey !== null || cartBusy"
                  @click="add(row)"
                >
                  {{ actionLabel(row) }}
                </button>
              </td>
            </tr>
            <tr v-if="pricedRows.length === 0">
              <td colspan="8" class="h-[94px] px-4 text-center text-[12px] text-ink-subtle">가격과 재고가 확인된 공급사 구매 조건이 없습니다.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="inquiryRows.length > 0" class="overflow-hidden rounded-[10px] border border-line-search-strong bg-search-row">
      <div class="flex h-[40px] items-center border-b border-line-search-strong bg-search-section px-[14px]">
        <h3 class="text-[13px] font-medium leading-[16px] text-ink-neutral">
          직접견적 가능 공급사
          <strong class="font-bold text-brand-soft">({{ inquiryRows.length.toLocaleString('ko-KR') }})</strong>
        </h3>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[1140px] table-fixed border-collapse">
          <colgroup>
            <col class="w-[3%]">
            <col class="w-[24%]">
            <col class="w-[31%]">
            <col class="w-[14%]">
            <col class="w-[11%]">
            <col class="w-[10%]">
            <col class="w-[7%]">
          </colgroup>
          <thead>
            <tr class="h-[40px] border-b border-line-soft bg-search-head text-left text-[10px] font-normal uppercase leading-[24px] text-ink-subtle">
              <th class="px-[14px] text-center"><span class="sr-only">선택</span></th>
              <th class="px-[8px]">MPN</th>
              <th class="px-[8px]">Distributor</th>
              <th class="px-[8px]">Quantity / Stock</th>
              <th class="px-[8px]">Response</th>
              <th class="px-[8px] text-center"><span class="sr-only">견적 수량</span></th>
              <th class="px-[8px] text-center"><span class="sr-only">견적 담기</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in inquiryRows" :key="row.key" class="h-[94px] border-b border-line-soft bg-search-row align-middle last:border-b-0">
              <td class="px-[14px] text-center">
                <BomSearchCheckbox
                  :checked="isSelected(row)"
                  :disabled="pendingKey !== null || cartBusy"
                  :label="`${row.part.mpn} 직접견적 선택`"
                  @change="toggleSelection(row)"
                />
              </td>
              <td class="px-[8px] py-[9px]">
                <div class="flex min-w-0 items-center gap-[24px]">
                  <PartImage :src="row.part.imageUrl" class="size-[64px] shrink-0 rounded-[8px] bg-surface-neutral" />
                  <div class="min-w-0">
                    <p class="truncate text-[14px] font-medium leading-[20px] text-ink-strong" :title="row.part.mpn">{{ row.part.mpn }}</p>
                    <p class="truncate text-[12px] font-normal leading-[16px] text-ink-subtle">{{ row.part.manufacturerName }}</p>
                  </div>
                </div>
              </td>
              <td class="px-[8px]">
                <p class="truncate text-[14px] font-medium leading-[20px] text-ink-strong">{{ row.part.manufacturerName ?? supplierName(row.offer.supplier) }} 직접 견적</p>
                <p class="mt-[2px] truncate text-[11px] leading-[16px] text-ink-muted">{{ row.part.description ?? '재고 및 납기 확인 후 회신' }}</p>
              </td>
              <td class="px-[8px] text-[12px] leading-[16px] text-ink-muted">{{ orderCondition(row, true) }}</td>
              <td class="px-[8px] text-[12px] leading-[16px] text-ink-muted">{{ row.offer.leadTime ?? '담당자 확인' }}</td>
              <td class="px-[8px]">
                <input
                  :value="quantityFor(row)"
                  type="number"
                  min="1"
                  max="1000000"
                  class="mx-auto block h-[38px] w-[90px] rounded-[6px] border border-line-strong bg-search-input text-center font-sans text-[16px] font-bold tabular-nums text-ink-strong outline-none focus:border-brand-soft"
                  aria-label="견적 수량"
                  @input="setQuantity(row, ($event.target as HTMLInputElement).value)"
                >
              </td>
              <td class="px-[8px] text-center">
                <button type="button" class="h-[24px] min-w-[70px] rounded-[4px] border border-line-strong bg-search-row px-[7px] font-sans text-[12px] font-medium text-ink-neutral hover:border-brand-soft hover:text-brand-soft disabled:cursor-wait disabled:opacity-50" :disabled="pendingKey !== null || cartBusy" @click="add(row)">
                  {{ actionLabel(row, true) }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
