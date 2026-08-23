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
import { bomOfferSelection, bomSearchSelectionKey } from '../../bom/search-selection';
import BomSearchCheckbox from './BomSearchCheckbox.vue';

const props = withDefaults(defineProps<{
  items: BomPartHitType[];
  initialQuantity?: number;
  quantityMultiplier?: number;
  usdKrwRate: number | null;
  cartPartIds: Set<string>;
  cartSelectionKeys: Set<string>;
  pendingKey: string | null;
  cartBusy: boolean;
  supplierSearchState: 'idle' | 'searching' | 'complete' | 'failed';
  actionContext?: 'cart' | 'quote';
}>(), {
  initialQuantity: 1,
  quantityMultiplier: 1,
  actionContext: 'cart',
});

const emit = defineEmits<{
  /** 협력사 보유 담기 — 구매 조건이 없어 offer 인자를 주지 않는다. */
  addPartner: [body: BomSearchCartAddBodyType, key: string, part: BomPartHitType];
  add: [
    body: BomSearchCartAddBodyType,
    key: string,
    part: BomPartHitType,
    offer: BomPartOfferOptionType,
  ];
  remove: [partId: string, key: string];
}>();

interface SearchOfferRow {
  key: string;
  part: BomPartHitType;
  offer: BomPartOfferOptionType;
}

function selectionKey(part: BomPartHitType, offer: BomPartOfferOptionType): string {
  return bomSearchSelectionKey(part.id, bomOfferSelection(offer));
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
  () => [props.initialQuantity, props.items.map((part) => part.id).join(',')] as const,
  () => { quantities.value = {}; },
);

function quantityFor(row: SearchOfferRow): number {
  return quantities.value[row.key] ?? props.initialQuantity;
}

function requiredQuantityFor(row: SearchOfferRow): number {
  return Math.max(1, quantityFor(row) * Math.max(1, props.quantityMultiplier));
}

function setQuantity(row: SearchOfferRow, value: number | string): void {
  const numeric = typeof value === 'number' ? value : Number(value);
  quantities.value[row.key] = Number.isFinite(numeric)
    ? Math.min(1_000_000, Math.max(1, Math.floor(numeric)))
    : 1;
}

function setTextQuantity(row: SearchOfferRow, event: Event): void {
  const input = event.target as HTMLInputElement;
  const numericText = input.value.replace(/\D/g, '');
  if (input.value !== numericText) input.value = numericText;
  if (numericText === '') return;
  setQuantity(row, numericText);
}

function restoreQuantity(row: SearchOfferRow, event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.value === '') input.value = quantityFor(row).toString();
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
  return applyQtyToOffer(toOfferInput(row.offer), requiredQuantityFor(row), props.usdKrwRate);
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
  const selection = bomOfferSelection(row.offer);
  emit('add', {
    partId: row.part.id,
    bomQty: quantityFor(row),
    selection,
  }, row.key, row.part, row.offer);
}

function toggleSelection(row: SearchOfferRow): void {
  if (isSelected(row)) {
    emit('remove', row.part.id, selectionKey(row.part, row.offer));
    return;
  }
  add(row);
}

function actionLabel(row: SearchOfferRow, inquiry = false): string {
  if (props.pendingKey === row.key) return '처리 중…';
  if (isSelected(row)) return props.actionContext === 'quote' ? '추가됨' : '적용';
  if (props.cartPartIds.has(row.part.id)) return '변경';
  if (props.actionContext === 'quote') return 'BOM 추가';
  return inquiry ? '견적담기' : '담기';
}

// ── 협력사 보유(docs/PARTNER_PARTS.md) ────────────────────────────────────────
// 구매 조건이 아니라 **부품 단위** 한 줄이다 — 협력사 부품은 가격을 만들지 않아
// offerOptions 에 실리지 않고, 그래서 위 두 표에는 그릴 줄이 없다.
const partnerRows = computed(() => props.items.filter((part) => part.hasPartnerStock));

const PARTNER_SELECTION = { kind: 'partner_stock' } as const;

function partnerKey(part: BomPartHitType): string {
  return bomSearchSelectionKey(part.id, PARTNER_SELECTION);
}

function partnerQuantity(part: BomPartHitType): number {
  return quantities.value[partnerKey(part)] ?? props.initialQuantity;
}

function setPartnerQuantity(part: BomPartHitType, value: string): void {
  const numeric = Number(value);
  quantities.value[partnerKey(part)] = Number.isFinite(numeric)
    ? Math.min(1_000_000, Math.max(1, Math.floor(numeric)))
    : 1;
}

function setPartnerTextQuantity(part: BomPartHitType, event: Event): void {
  const input = event.target as HTMLInputElement;
  const numericText = input.value.replace(/\D/g, '');
  if (input.value !== numericText) input.value = numericText;
  if (numericText === '') return;
  setPartnerQuantity(part, numericText);
}

function restorePartnerQuantity(part: BomPartHitType, event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.value === '') input.value = partnerQuantity(part).toString();
}

function partnerCountText(part: BomPartHitType): string {
  const count = part.partnerStock?.partnerCount ?? 0;
  return count > 1 ? `${String(count)}곳` : '';
}

function partnerStockText(part: BomPartHitType): string {
  const qty = part.partnerStock?.totalStockQty ?? null;
  return qty === null ? '수량 미표기' : `${qty.toLocaleString('ko-KR')}개`;
}

function partnerAgeText(part: BomPartHitType): string {
  const at = part.partnerStock?.updatedAt ?? null;
  if (at === null) return '협력사 재고표 · 견적요청으로 확인';
  const days = Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000));
  return `협력사 재고표 · ${days === 0 ? '오늘' : `${String(days)}일 전`} 기준`;
}

function isPartnerSelected(part: BomPartHitType): boolean {
  return props.cartSelectionKeys.has(partnerKey(part));
}

function addPartner(part: BomPartHitType): void {
  emit('addPartner', {
    partId: part.id,
    bomQty: partnerQuantity(part),
    selection: PARTNER_SELECTION,
  }, partnerKey(part), part);
}

function togglePartnerSelection(part: BomPartHitType): void {
  if (isPartnerSelected(part)) {
    emit('remove', part.id, partnerKey(part));
    return;
  }
  addPartner(part);
}

function partnerActionLabel(part: BomPartHitType): string {
  if (props.pendingKey === partnerKey(part)) return '처리 중…';
  if (isPartnerSelected(part)) return props.actionContext === 'quote' ? '추가됨' : '적용';
  if (props.actionContext === 'quote') return 'BOM 추가';
  return '견적담기';
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
        <table class="w-full min-w-[900px] table-fixed border-collapse 2xl:min-w-[1140px]">
          <colgroup>
            <col class="w-[3%]">
            <col class="w-[24%]">
            <col class="w-[24%]">
            <col class="w-[11%]">
            <col class="w-[10%]">
            <col class="w-[12%]">
            <col class="w-[96px]">
            <col class="w-[80px]">
          </colgroup>
          <thead>
            <tr class="h-[40px] border-b border-line-soft bg-search-head text-left text-[10px] font-normal uppercase leading-[24px] text-ink-subtle">
              <th class="px-[14px] text-center"><span class="sr-only">선택</span></th>
              <th class="px-[8px]">MPN</th>
              <th class="px-[8px]">Distributor</th>
              <th class="px-[8px]">Unit price</th>
              <th class="px-[8px]">Stock</th>
              <th class="px-[8px]">Quantity</th>
              <th class="px-[8px] text-center"><span class="sr-only">{{ actionContext === 'quote' ? 'BOM 수량' : '구매 수량' }}</span></th>
              <th class="sticky right-0 z-[2] bg-search-head px-[8px] text-center shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.45)] lg:static lg:shadow-none"><span class="sr-only">카트</span></th>
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
                <p class="flex min-w-0 items-center gap-[5px] text-[14px] font-medium leading-[20px] text-ink-strong">
                  <img :src="SUPPLIER_META[row.offer.supplier]?.icon ?? SUPPLIER_FALLBACK_ICON" alt="" class="size-[12px] shrink-0 rounded-[2px]">
                  <span class="truncate">{{ supplierName(row.offer.supplier) }}</span>
                </p>
                <p class="mt-[2px] truncate text-[11px] font-normal leading-[16px] text-ink-muted" :title="supplierDetail(row)">{{ supplierDetail(row) }}</p>
              </td>
              <td class="px-[8px]">
                <p v-if="displayPrice(row) !== null" class="whitespace-nowrap font-noto leading-[16px] text-brand-soft" :title="displayPrice(row)?.title">
                  <strong class="text-[20px] font-bold leading-[16px] tabular-nums">{{ displayPrice(row)?.amount }}</strong>
                  <span class="ml-[3px] text-[14px] font-normal leading-[16px]">{{ displayPrice(row)?.unit }}</span>
                </p>
                <span v-else class="text-[12px] text-ink-subtle">—</span>
              </td>
              <td class="px-[8px] text-[14px] font-normal leading-[20px]" :class="stockClass(row)">
                {{ stockText(row) }}
              </td>
              <td class="px-[8px] text-[14px] font-normal leading-[20px] text-ink-muted">
                {{ orderCondition(row) }}
              </td>
              <td class="px-[8px]">
                <input
                  :value="quantityFor(row)"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  autocomplete="off"
                  spellcheck="false"
                  class="mx-auto block h-[38px] w-[90px] rounded-[6px] border border-line-strong bg-search-input text-center font-sans text-[16px] font-bold tabular-nums text-ink-strong outline-none focus:border-brand-soft"
                  :aria-label="actionContext === 'quote' ? 'BOM 수량' : '담을 수량'"
                  @input="setTextQuantity(row, $event)"
                  @blur="restoreQuantity(row, $event)"
                >
              </td>
              <td class="sticky right-0 z-[1] bg-search-row px-[8px] text-center shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.45)] lg:static lg:shadow-none">
                <button
                  type="button"
                  class="h-[24px] min-w-[70px] rounded-[4px] bg-search-apply px-[8px] font-sans text-[13px] font-medium text-white transition hover:opacity-85 disabled:cursor-wait disabled:opacity-50"
                  :disabled="pendingKey !== null || cartBusy"
                  @click="add(row)"
                >
                  {{ actionLabel(row) }}
                </button>
              </td>
            </tr>
            <tr v-if="pricedRows.length === 0 && supplierSearchState === 'complete'">
              <td colspan="8" class="h-[94px] px-4 text-center text-[12px] text-ink-subtle">가격과 재고가 확인된 공급사 구매 조건이 없습니다.</td>
            </tr>
            <tr v-else-if="pricedRows.length === 0 && supplierSearchState === 'failed'">
              <td colspan="8" class="h-[94px] px-4 text-center text-[12px] text-state-danger">공급사 검색을 완료하지 못했습니다. 상단에서 다시 검색해 주세요.</td>
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
        <table class="w-full min-w-[900px] table-fixed border-collapse 2xl:min-w-[1140px]">
          <colgroup>
            <col class="w-[3%]">
            <col class="w-[24%]">
            <col class="w-[31%]">
            <col class="w-[14%]">
            <col class="w-[11%]">
            <col class="w-[96px]">
            <col class="w-[80px]">
          </colgroup>
          <thead>
            <tr class="h-[40px] border-b border-line-soft bg-search-head text-left text-[10px] font-normal uppercase leading-[24px] text-ink-subtle">
              <th class="px-[14px] text-center"><span class="sr-only">선택</span></th>
              <th class="px-[8px]">MPN</th>
              <th class="px-[8px]">Distributor</th>
              <th class="px-[8px]">Quantity / Stock</th>
              <th class="px-[8px]">Response</th>
              <th class="px-[8px] text-center"><span class="sr-only">{{ actionContext === 'quote' ? 'BOM 수량' : '견적 수량' }}</span></th>
              <th class="sticky right-0 z-[2] bg-search-head px-[8px] text-center shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.45)] lg:static lg:shadow-none"><span class="sr-only">견적 담기</span></th>
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
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  autocomplete="off"
                  spellcheck="false"
                  class="mx-auto block h-[38px] w-[90px] rounded-[6px] border border-line-strong bg-search-input text-center font-sans text-[16px] font-bold tabular-nums text-ink-strong outline-none focus:border-brand-soft"
                  :aria-label="actionContext === 'quote' ? 'BOM 수량' : '견적 수량'"
                  @input="setTextQuantity(row, $event)"
                  @blur="restoreQuantity(row, $event)"
                >
              </td>
              <td class="sticky right-0 z-[1] bg-search-row px-[8px] text-center shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.45)] lg:static lg:shadow-none">
                <button type="button" class="h-[24px] min-w-[70px] rounded-[4px] border border-line-strong bg-search-row px-[7px] font-sans text-[12px] font-medium text-ink-neutral hover:border-brand-soft hover:text-brand-soft disabled:cursor-wait disabled:opacity-50" :disabled="pendingKey !== null || cartBusy" @click="add(row)">
                  {{ actionLabel(row, true) }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <!--
      협력사 보유(docs/PARTNER_PARTS.md) — 위 두 표는 **구매 조건 한 줄씩**을 그린다. 협력사
      부품은 설계상 가격을 만들지 않아 그릴 줄이 없고, 그래서 검색에는 잡히는데 화면은 비어
      보였다(사용자 신고). 부품 단위로 한 줄을 세워 "있다"는 사실과 담기 버튼만 준다.
      가격·납기는 견적요청 회신이 정본이라 여기서 약속하지 않는다.
    -->
    <section v-if="partnerRows.length > 0" class="overflow-hidden rounded-[10px] border border-line-search-strong bg-search-row">
      <div class="flex h-[40px] items-center border-b border-line-search-strong bg-search-section px-[14px]">
        <h3 class="text-[13px] font-medium leading-[16px] text-ink-neutral">
          협력사 보유
          <strong class="font-bold text-brand-soft">({{ partnerRows.length.toLocaleString('ko-KR') }})</strong>
        </h3>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[900px] table-fixed border-collapse 2xl:min-w-[1140px]">
          <colgroup>
            <col class="w-[3%]">
            <col class="w-[24%]">
            <col class="w-[31%]">
            <col class="w-[14%]">
            <col class="w-[11%]">
            <col class="w-[96px]">
            <col class="w-[80px]">
          </colgroup>
          <thead>
            <tr class="h-[40px] border-b border-line-soft bg-search-head text-left text-[10px] font-normal uppercase leading-[24px] text-ink-subtle">
              <th class="px-[14px] text-center"><span class="sr-only">선택</span></th>
              <th class="px-[8px]">MPN</th>
              <th class="px-[8px]">Distributor</th>
              <th class="px-[8px]">Stock</th>
              <th class="px-[8px]">Unit price</th>
              <th class="px-[8px] text-center"><span class="sr-only">{{ actionContext === 'quote' ? 'BOM 수량' : '견적 수량' }}</span></th>
              <th class="sticky right-0 z-[2] bg-search-head px-[8px] text-center shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.45)] lg:static lg:shadow-none"><span class="sr-only">견적 담기</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="part in partnerRows" :key="partnerKey(part)" class="h-[94px] border-b border-line-soft bg-search-row align-middle last:border-b-0">
              <td class="px-[14px] text-center">
                <BomSearchCheckbox
                  :checked="isPartnerSelected(part)"
                  :disabled="pendingKey !== null || cartBusy"
                  :label="`${part.mpn} 협력사 보유 선택`"
                  @change="togglePartnerSelection(part)"
                />
              </td>
              <td class="px-[8px] py-[9px]">
                <div class="flex min-w-0 items-center gap-[24px]">
                  <PartImage :src="part.imageUrl" class="size-[64px] shrink-0 rounded-[8px] bg-surface-neutral" />
                  <div class="min-w-0">
                    <p class="truncate text-[14px] font-medium leading-[20px] text-ink-strong" :title="part.mpn">{{ part.mpn }}</p>
                    <p class="truncate text-[12px] font-normal leading-[16px] text-ink-subtle">{{ part.manufacturerName }}</p>
                  </div>
                </div>
              </td>
              <td class="px-[8px]">
                <p class="truncate text-[14px] font-medium leading-[20px] text-ink-strong">협력사 보유 {{ partnerCountText(part) }}</p>
                <!-- 협력사가 스스로 올린 재고표다. 나이를 늘 함께 보여 그대로 믿지 않게 한다. -->
                <p class="mt-[2px] truncate text-[11px] leading-[16px] text-ink-muted">{{ partnerAgeText(part) }}</p>
              </td>
              <td class="px-[8px] text-[14px] font-normal leading-[20px] text-ink-muted">{{ partnerStockText(part) }}</td>
              <td class="px-[8px] text-[12px] leading-[16px] text-ink-muted">견적요청 후 확정</td>
              <td class="px-[8px]">
                <input
                  :value="partnerQuantity(part)"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  autocomplete="off"
                  spellcheck="false"
                  class="mx-auto block h-[38px] w-[90px] rounded-[6px] border border-line-strong bg-search-input text-center font-sans text-[16px] font-bold tabular-nums text-ink-strong outline-none focus:border-brand-soft"
                  :aria-label="actionContext === 'quote' ? 'BOM 수량' : '견적 수량'"
                  @input="setPartnerTextQuantity(part, $event)"
                  @blur="restorePartnerQuantity(part, $event)"
                >
              </td>
              <td class="sticky right-0 z-[1] bg-search-row px-[8px] text-center shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.45)] lg:static lg:shadow-none">
                <button type="button" class="h-[24px] min-w-[70px] rounded-[4px] border border-line-strong bg-search-row px-[7px] font-sans text-[12px] font-medium text-ink-neutral hover:border-brand-soft hover:text-brand-soft disabled:cursor-wait disabled:opacity-50" :disabled="pendingKey !== null || cartBusy" @click="addPartner(part)">
                  {{ partnerActionLabel(part) }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>