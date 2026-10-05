<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import type { AcceptableValue } from 'reka-ui';
import type { BomPartHitType, PartHitType, PartOfferViewType } from '@sp/api-contract';
import { applyQtyToOffer, pickDefaultOffer, type BomOfferInput, type OfferPick } from '@sp/utils';
import { useBomPartDetail } from '@/bom/useBom';
import { fmtAge } from '@/bom/format';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Field, FieldContent, FieldLabel, FieldTitle } from '@/next/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/next/components/ui/radio-group';
import { Spinner } from '@/next/components/ui/spinner';
import Panel from '@/next/components/common/Panel.vue';

// 부품 1건의 공급 포장·구매 조건 비교(+선택 문맥의 확정 CTA) — 옛 components/admin/bom/
// BomPartOfferOptions.vue 의 짝(같은 props·emits). PartSearchPanel(부품 변경)과 단일 검색 행 확장이 공유한다.
// browse=열람 전용(확정 CTA 숨김, 비교 인터랙션은 유지).
const props = withDefaults(
  defineProps<{
    part: BomPartHitType;
    needed?: number;
    usdKrwRate?: number | null;
    selecting?: boolean;
    browse?: boolean;
    selectionAction?: 'change' | 'add';
    currentPartId?: string | null;
  }>(),
  {
    needed: 1,
    usdKrwRate: null,
    selecting: false,
    browse: false,
    selectionAction: 'change',
    currentPartId: null,
  },
);

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

const uid = useId();
const selectedOfferKey = ref<string | null>(null);
const activePackagingKey = ref<string | null>(null);
const hasInlineOffers = computed(() => props.part.inlineOffers !== null);
const partId = computed<string | null>(() => (props.part.source === 'catalog' ? props.part.id : null));
const detailEnabled = computed(() => !hasInlineOffers.value);
const detail = useBomPartDetail(partId, detailEnabled);

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
  if (props.part.inlineOffers !== null) return props.part.inlineOffers.map(toOfferInput);
  const data = detail.data.value?.data;
  if (data?.id !== props.part.id) return [];
  return data.offers.filter((offer) => offer.supplier !== 'samplepcb').map(toOfferInput);
});

const recommendedPick = computed<OfferPick | null>(() => {
  const engineApplied = props.part.source === 'supplier' ? props.part.applied : null;
  if (engineApplied !== null) {
    const offer = offerInputs.value.find(
      (entry) => entry.supplier === engineApplied.supplier && entry.supplierSku === engineApplied.supplierSku,
    );
    if (offer !== undefined) {
      return {
        offer,
        orderQty: engineApplied.orderQty,
        breakQty: engineApplied.breakQty,
        unitPrice: engineApplied.unitPrice,
        currency: engineApplied.currency,
        unitPriceKrw: engineApplied.unitPriceKrw,
        stockShort: engineApplied.stockShort,
      };
    }
  }
  return pickDefaultOffer(offerInputs.value, props.needed, props.usdKrwRate);
});

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
  return [...groups.values()].sort(
    (a, b) => Number(b.recommended) - Number(a.recommended) || groupCost(a) - groupCost(b),
  );
});

watch(
  [() => props.part.id, () => (recommendedPick.value === null ? null : offerKey(recommendedPick.value))],
  ([, recommendedKey]) => {
    selectedOfferKey.value = recommendedKey;
    const row =
      recommendedKey === null ? offerRows.value[0] : offerRows.value.find((entry) => entry.key === recommendedKey);
    activePackagingKey.value = row === undefined ? null : packagingKey(row.pick.offer.packaging);
  },
  { immediate: true },
);

const activeRows = computed(
  () => packagingGroups.value.find((group) => group.key === activePackagingKey.value)?.rows ?? [],
);
const selectedRow = computed(() => offerRows.value.find((row) => row.key === selectedOfferKey.value) ?? null);

function selectPackaging(group: PackagingGroup): void {
  if (props.selecting) return;
  activePackagingKey.value = group.key;
  selectedOfferKey.value = group.rows[0]?.key ?? null;
}

function onOfferChange(value: AcceptableValue): void {
  if (typeof value === 'string') selectedOfferKey.value = value;
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

const rowId = (key: string): string => `${uid}-offer-${key.replace(/[^\w-]/g, '_')}`;
</script>

<template>
  <div>
    <div
      v-if="!hasInlineOffers && (detail.isLoading.value || detail.isFetching.value)"
      class="text-info flex items-center justify-center gap-2 px-4 py-10 text-sm font-medium"
      aria-live="polite"
    >
      <Spinner />
      공급 포장과 가격을 확인하고 있습니다.
    </div>
    <div v-else-if="!hasInlineOffers && detail.isError.value" class="p-4">
      <Alert variant="destructive" size="sm">
        <AlertDescription>공급사 구매 조건을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</AlertDescription>
      </Alert>
    </div>
    <div v-else-if="offerRows.length === 0" class="flex flex-col gap-3 p-4">
      <Alert v-if="part.hasCatalogInquiryOffer" variant="info">
        <AlertTitle>취급 가능 · 재고 확인</AlertTitle>
        <AlertDescription>
          제조사 카탈로그에 확인된 부품입니다. 실제 재고와 가격은 문의가 필요하며, 가격은 <b>문의 견적</b>으로 저장됩니다.
        </AlertDescription>
      </Alert>
      <Alert v-else variant="warning">
        <AlertDescription>
          {{
            browse
              ? '가격이 있는 공급사 구매 조건이 아직 없습니다. 공급사 검색이 쌓이면 구매 조건이 표시됩니다.'
              : '가격이 있는 공급사 구매 조건이 없어 공급 포장을 선택할 수 없습니다. 부품만 변경하면 금액은 미산정 상태로 저장됩니다.'
          }}
        </AlertDescription>
      </Alert>
      <Button v-if="!browse" size="lg" class="w-full" :disabled="selecting" @click="confirmSelection">
        {{
          selecting
            ? '적용 중…'
            : part.hasCatalogInquiryOffer
              ? selectionAction === 'add'
                ? '문의 견적으로 부품 추가'
                : '문의 견적으로 부품 선택'
              : selectionAction === 'add'
                ? '가격 없이 부품 추가'
                : '가격 없이 부품만 변경'
        }}
      </Button>
    </div>
    <div v-else class="flex flex-col gap-3 p-4">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h4 class="text-sm font-semibold">공급 포장 선택</h4>
          <p class="text-muted-foreground mt-1 text-xs">
            필요수량 {{ needed.toLocaleString('ko-KR') }}개 기준으로 MOQ·주문배수·재고·총액을 비교합니다.
          </p>
        </div>
        <Badge variant="success">추천 조건 자동 선택</Badge>
      </div>

      <div class="flex flex-wrap gap-2" role="tablist" aria-label="공급 포장">
        <Button
          v-for="group in packagingGroups"
          :key="group.key"
          role="tab"
          size="sm"
          :variant="group.key === activePackagingKey ? 'default' : 'outline'"
          :aria-selected="group.key === activePackagingKey"
          :disabled="selecting"
          @click="selectPackaging(group)"
        >
          {{ group.label }}
          <span class="opacity-70">· {{ group.rows.length }}개 구매 조건<template v-if="group.recommended"> · 추천</template></span>
        </Button>
      </div>

      <RadioGroup
        :model-value="selectedOfferKey"
        :disabled="selecting"
        aria-label="공급사 구매 조건"
        @update:model-value="onOfferChange"
      >
        <FieldLabel v-for="row in activeRows" :key="row.key" :for="rowId(row.key)">
          <Field orientation="horizontal">
            <RadioGroupItem :id="rowId(row.key)" :value="row.key" />
            <FieldContent>
              <FieldTitle class="w-full">
                <span class="flex w-full flex-wrap items-center gap-2">
                  <strong class="uppercase">{{ row.pick.offer.supplier }}</strong>
                  <span class="text-muted-foreground text-xs font-normal">{{ row.pick.offer.supplierSku }}</span>
                  <Badge v-if="row.recommended" variant="success">전체 추천</Badge>
                  <Badge v-if="row.pick.stockShort" variant="danger">재고 부족</Badge>
                  <strong class="text-primary ml-auto tabular-nums">{{ fmtTotal(row.pick) }}</strong>
                </span>
              </FieldTitle>
              <span class="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span>단가 <b class="text-foreground">{{ fmtUnit(row.pick) }}</b></span>
                <span>
                  필요 {{ needed.toLocaleString('ko-KR') }}개 → 주문
                  <b class="text-foreground">{{ row.pick.orderQty.toLocaleString('ko-KR') }}개</b>
                </span>
                <span>MOQ <b class="text-foreground">{{ row.pick.offer.moq?.toLocaleString('ko-KR') ?? '—' }}</b></span>
                <span>재고 <b class="text-foreground">{{ row.pick.offer.stock?.toLocaleString('ko-KR') ?? '—' }}</b></span>
                <span>기준 {{ fmtAge(row.pick.offer.fetchedAt) }}</span>
              </span>
            </FieldContent>
          </Field>
        </FieldLabel>
      </RadioGroup>

      <Panel v-if="selectedRow !== null" tone="info" class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-foreground text-xs">
          선택: <b>{{ packagingLabel(selectedRow.pick.offer.packaging) }} · {{ selectedRow.pick.offer.supplier }}</b>
          <span class="ml-1">/ {{ selectedRow.pick.orderQty.toLocaleString('ko-KR') }}개 주문</span>
        </span>
        <strong class="tabular-nums">{{ fmtTotal(selectedRow.pick) }}</strong>
      </Panel>
      <Button v-if="!browse" size="lg" class="w-full" :disabled="selecting || selectedRow === null" @click="confirmSelection">
        {{
          selecting
            ? '적용 중…'
            : selectionAction === 'add'
              ? '선택한 구매 조건으로 부품 추가'
              : part.id === currentPartId
                ? '선택한 공급 포장으로 변경'
                : '선택한 구매 조건으로 부품 변경'
        }}
      </Button>
    </div>
  </div>
</template>
