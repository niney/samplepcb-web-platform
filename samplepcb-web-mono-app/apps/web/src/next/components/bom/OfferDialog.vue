<script setup lang="ts">
import { computed, toRef } from 'vue';
import { applyQtyToOffer, type BomOfferInput, type OfferPick } from '@sp/utils';
import type { PartOfferViewType } from '@sp/api-contract';
import { useBomPartDetail } from '@/bom/useBom';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import { Badge } from '@/next/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/next/components/ui/item';
import { Spinner } from '@/next/components/ui/spinner';

// 구매 조건 변경 — 옛 components/admin/bom/BomOfferModal.vue 의 짝(같은 props·emits, v-if 로 열린 채 마운트).
// 부품의 실공급사 구매 조건을 필요수량 기준 실효가로 비교해 선택한다.
// samplepcb 파생 구매 조건은 후보 제외(견적 선정 순환 방지 — docs/BOM_QUOTE.md).

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

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>구매 조건 선택 — {{ detail.data.value?.data.mpn ?? '' }}</DialogTitle>
        <DialogDescription>
          필요수량 {{ needed.toLocaleString('ko-KR') }}개 기준 실효 단가·주문수량(MOQ·배수 보정)으로 비교합니다.
        </DialogDescription>
      </DialogHeader>

      <p v-if="detail.isLoading.value" class="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner />구매 조건을 불러오는 중…
      </p>
      <p v-else-if="rows.length === 0" class="text-muted-foreground text-sm">
        선택 가능한 구매 조건이 없습니다 — 공급사 검색으로 보강해 보세요.
      </p>

      <DialogScrollBody v-else>
        <div class="flex flex-col gap-2">
          <Item
            v-for="row in rows"
            :key="`${row.offer.supplier}-${row.offer.supplierSku}`"
            as="button"
            type="button"
            variant="outline"
            class="w-full text-left"
            @click="emit('select', row.pick)"
          >
            <ItemContent>
              <ItemTitle>
                {{ row.offer.supplier }}
                <span class="text-muted-foreground font-normal">{{ row.offer.supplierSku }}</span>
                <Badge v-if="row.offer.packaging" variant="secondary">{{ row.offer.packaging }}</Badge>
                <Badge v-if="row.pick.stockShort" variant="danger">재고 부족</Badge>
              </ItemTitle>
              <ItemDescription>
                <span class="flex flex-wrap gap-x-5 gap-y-1">
                  <span>단가 <b class="text-foreground tabular-nums">{{ fmt(row.pick.unitPrice, row.pick.currency) }}</b><template v-if="row.pick.currency !== 'KRW' && row.pick.unitPriceKrw !== null"> (≈₩{{ row.pick.unitPriceKrw.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) }})</template></span>
                  <span>주문수량 <b class="text-foreground tabular-nums">{{ row.pick.orderQty.toLocaleString('ko-KR') }}</b></span>
                  <span>재고 <b class="text-foreground tabular-nums">{{ row.offer.stock?.toLocaleString('ko-KR') ?? '—' }}</b></span>
                  <span>MOQ {{ row.offer.moq ?? '—' }}</span>
                </span>
              </ItemDescription>
              <span v-if="row.offer.priceBreaks.length > 0" class="mt-1 flex flex-wrap gap-1.5">
                <Badge
                  v-for="pb in row.offer.priceBreaks"
                  :key="pb.qty"
                  :variant="pb.qty === row.pick.breakQty ? 'info' : 'outline'"
                >
                  <span class="tabular-nums">{{ pb.qty }}+ : {{ fmt(pb.price, row.pick.currency) }}</span>
                </Badge>
              </span>
            </ItemContent>
          </Item>
        </div>
      </DialogScrollBody>
    </DialogContent>
  </Dialog>
</template>
