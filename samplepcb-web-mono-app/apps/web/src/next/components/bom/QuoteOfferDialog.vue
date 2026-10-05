<script setup lang="ts">
import { computed } from 'vue';
import { ExternalLinkIcon } from '@lucide/vue';
import type {
  BomQuoteCandidateOfferType,
  BomQuoteCandidateType,
  BomQuoteItemCandidatesType,
} from '@sp/api-contract';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Spinner } from '@/next/components/ui/spinner';

// 공급사·포장 선택 — 옛 components/admin/bom/BomQuoteOfferModal.vue 의 짝(같은 props·emits, open 으로 여닫음).
// 부품과 물리 패키지는 유지하고 공급사·SKU·포장에 묶인 구매 조건만 바꾼다. 다른 부품은 후보 비교로.

const props = withDefaults(
  defineProps<{
    open: boolean;
    context: BomQuoteItemCandidatesType | null;
    loading: boolean;
    failed: boolean;
    selecting?: boolean;
    selectionError?: string;
  }>(),
  {
    selecting: false,
    selectionError: '',
  },
);

const emit = defineEmits<{
  close: [];
  select: [candidateKey: string, offerKey: string];
  compare: [];
}>();

const candidate = computed(() => {
  const context = props.context;
  if (context === null) return null;
  return context.candidates.find((item) => item.candidateKey === context.selectedCandidateKey)
    ?? context.candidates.find((item) => item.selected)
    ?? null;
});

const offers = computed(() => {
  const current = candidate.value;
  if (current === null) return [];
  return [...current.offers].sort((a, b) =>
    (a.purchaseFitRank ?? Number.MAX_SAFE_INTEGER) - (b.purchaseFitRank ?? Number.MAX_SAFE_INTEGER)
    || (a.priceRank ?? Number.MAX_SAFE_INTEGER) - (b.priceRank ?? Number.MAX_SAFE_INTEGER)
    || a.offerKey.localeCompare(b.offerKey));
});

function isCurrent(offer: BomQuoteCandidateOfferType): boolean {
  return offer.offerKey === props.context?.selectedOfferKey;
}

function selectOffer(current: BomQuoteCandidateType, offer: BomQuoteCandidateOfferType): void {
  if (props.selecting || !offer.purchasable || offer.applied === null || isCurrent(offer)) return;
  emit('select', current.candidateKey, offer.offerKey);
}

function fmtWon(value: number | null): string {
  return value === null ? '환산 불가' : `₩${Math.round(value).toLocaleString('ko-KR')}`;
}

function fmtUnit(offer: BomQuoteCandidateOfferType): string {
  if (offer.offerKind === 'manufacturer_catalog') return '문의 견적';
  const applied = offer.applied;
  if (applied === null) return '가격 없음';
  const symbol = applied.currency === 'KRW' ? '₩' : applied.currency === 'USD' ? '$' : `${applied.currency} `;
  return `${symbol}${applied.unitPrice.toLocaleString('ko-KR', { maximumFractionDigits: 6 })}`;
}

function fmtAge(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return '시각 미확인';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${String(minutes)}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}시간 전`;
  return `${String(Math.floor(hours / 24))}일 전`;
}

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>공급사·포장 선택</DialogTitle>
        <DialogDescription v-if="context !== null">
          {{ context.currentMpn || '선정 부품 없음' }} · 필요수량 {{ context.neededQty.toLocaleString('ko-KR') }}개 —
          부품과 물리 패키지는 유지하고, 공급사·SKU·포장 방식에 묶인 구매 조건만 변경합니다.
        </DialogDescription>
      </DialogHeader>

      <DialogScrollBody>
        <div class="flex flex-col gap-2.5">
          <Alert v-if="selectionError !== ''" variant="destructive" size="sm">
            <AlertDescription>{{ selectionError }}</AlertDescription>
          </Alert>
          <p v-if="loading" class="text-muted-foreground flex min-h-48 items-center justify-center gap-2 text-sm">
            <Spinner />구매 조건을 불러오는 중입니다.
          </p>
          <Alert v-else-if="failed" variant="destructive">
            <AlertDescription>공급사 구매 조건을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</AlertDescription>
          </Alert>
          <Alert v-else-if="candidate === null" variant="warning">
            <AlertDescription>
              현재 선택된 부품의 엔진 후보 정보를 찾지 못했습니다. 전체 후보 비교에서 부품을 다시 선택해 주세요.
            </AlertDescription>
          </Alert>
          <Alert v-else-if="offers.length === 0" variant="muted">
            <AlertDescription>현재 부품에서 선택 가능한 공급사 구매 조건이 없습니다.</AlertDescription>
          </Alert>
          <template v-else>
            <Panel v-for="offer in offers" :key="offer.offerKey" size="md" :tone="isCurrent(offer) ? 'info' : 'default'">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <strong class="text-foreground uppercase">{{ offer.supplier }}</strong>
                    <Badge v-if="offer.offerKind === 'manufacturer_catalog'" variant="info">취급 가능 · 재고 확인</Badge>
                    <Badge v-if="offer.recommendation === 'automatic'" variant="success">자동 추천 구매 조건</Badge>
                    <Badge v-else-if="offer.recommendation === 'manual_review'" variant="warning">검토 권장 구매 조건</Badge>
                    <Badge v-else-if="candidate.bestOfferKey === offer.offerKey" variant="secondary">구매 조건 1위</Badge>
                    <Badge v-if="isCurrent(offer)" variant="info">사용 중</Badge>
                    <Badge v-if="offer.applied?.stockShort" variant="danger">재고 부족</Badge>
                  </div>
                  <p class="text-muted-foreground mt-1 truncate text-xs">{{ offer.supplierSku || 'SKU 미확인' }}</p>
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="outline">포장 {{ offer.packaging ?? '미확인' }}</Badge>
                    <Badge variant="outline">주문 {{ offer.applied?.orderQty.toLocaleString('ko-KR') ?? '—' }}</Badge>
                    <Badge variant="outline">재고 {{ offer.offerKind === 'manufacturer_catalog' ? '확인 필요' : (offer.stock?.toLocaleString('ko-KR') ?? '—') }}</Badge>
                    <Badge variant="outline">MOQ {{ offer.moq?.toLocaleString('ko-KR') ?? '—' }}</Badge>
                    <Badge v-if="offer.purchaseFitRank !== null" variant="outline">구매적합 {{ offer.purchaseFitRank }}위</Badge>
                    <Badge v-if="offer.priceRank !== null" variant="outline">가격 {{ offer.priceRank }}위</Badge>
                  </div>
                  <p class="text-muted-foreground mt-2 text-xs">공급사 기준 {{ fmtAge(offer.fetchedAt) }}</p>
                </div>
                <div class="shrink-0 sm:text-right">
                  <p class="text-muted-foreground text-xs">단가 <b class="text-foreground">{{ fmtUnit(offer) }}</b></p>
                  <strong class="text-foreground mt-1 block text-lg tabular-nums">
                    {{ offer.offerKind === 'manufacturer_catalog' ? '문의 견적' : fmtWon(offer.applied?.lineTotalKrw ?? null) }}
                  </strong>
                  <div class="mt-2 flex items-center gap-2 sm:justify-end">
                    <Button v-if="offer.productUrl" as-child variant="outline" size="sm">
                      <a :href="offer.productUrl" target="_blank" rel="noopener noreferrer">
                        제품
                        <ExternalLinkIcon />
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      :disabled="selecting || !offer.purchasable || offer.applied === null || isCurrent(offer)"
                      @click="selectOffer(candidate, offer)"
                    >
                      {{ isCurrent(offer) ? '현재 구매 조건' : offer.offerKind === 'manufacturer_catalog' ? '문의 견적' : offer.purchasable ? '이 구매 조건 선택' : '선택 불가' }}
                    </Button>
                  </div>
                </div>
              </div>
            </Panel>
          </template>
        </div>
      </DialogScrollBody>

      <DialogFooter class="items-center sm:justify-between">
        <p class="text-muted-foreground text-xs">다른 제조사·MPN·물리 패키지를 검토하려면 후보 비교를 이용하세요.</p>
        <Button variant="outline" size="sm" @click="emit('compare')">다른 부품 후보 비교</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
