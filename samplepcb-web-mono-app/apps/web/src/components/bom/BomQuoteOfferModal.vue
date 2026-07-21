<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import type {
  BomQuoteCandidateOfferType,
  BomQuoteCandidateType,
  BomQuoteItemCandidatesType,
} from '@sp/api-contract';

const props = withDefaults(defineProps<{
  open: boolean;
  context: BomQuoteItemCandidatesType | null;
  loading: boolean;
  failed: boolean;
  selecting?: boolean;
  selectionError?: string;
}>(), {
  selecting: false,
  selectionError: '',
});

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

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[75] grid place-items-center bg-slate-950/50 p-4" role="presentation" @mousedown.self="emit('close')">
      <section class="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="quote-offer-modal-title">
        <header class="shrink-0 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-600">Purchase offer</p>
              <h2 id="quote-offer-modal-title" class="mt-1 text-lg font-bold text-slate-950">공급사·포장 선택</h2>
              <p v-if="context !== null" class="mt-1 truncate text-xs text-slate-500">
                {{ context.currentMpn || '선정 부품 없음' }} · 필요수량 {{ context.neededQty.toLocaleString('ko-KR') }}개
              </p>
            </div>
            <button type="button" class="grid size-9 shrink-0 place-items-center rounded-lg text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="공급사·포장 선택 닫기" @click="emit('close')">×</button>
          </div>
          <p class="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
            부품과 물리 패키지는 유지하고, 공급사·SKU·포장 방식에 묶인 구매 오퍼만 변경합니다.
          </p>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <div v-if="selectionError !== ''" class="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">{{ selectionError }}</div>
          <div v-if="loading" class="grid min-h-48 place-items-center text-sm text-slate-500">
            <div class="text-center"><span class="mx-auto mb-3 block size-6 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />오퍼를 불러오는 중입니다.</div>
          </div>
          <div v-else-if="failed" class="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
            공급사 오퍼를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </div>
          <div v-else-if="candidate === null" class="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            현재 선택된 부품의 엔진 후보 정보를 찾지 못했습니다. 전체 후보 비교에서 부품을 다시 선택해 주세요.
          </div>
          <div v-else-if="offers.length === 0" class="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
            현재 부품에서 선택 가능한 공급사 오퍼가 없습니다.
          </div>
          <div v-else class="space-y-2.5">
            <article
              v-for="offer in offers"
              :key="offer.offerKey"
              class="rounded-xl border p-4 transition"
              :class="isCurrent(offer) ? 'border-blue-400 bg-blue-50/50 ring-1 ring-blue-100' : 'border-slate-200 hover:border-blue-300'"
            >
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <strong class="uppercase text-slate-950">{{ offer.supplier }}</strong>
                    <span v-if="offer.recommendation === 'automatic'" class="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800">자동 추천 오퍼</span>
                    <span v-else-if="offer.recommendation === 'manual_review'" class="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">검토 권장 오퍼</span>
                    <span v-else-if="candidate.bestOfferKey === offer.offerKey" class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-700">구매조건 1위</span>
                    <span v-if="isCurrent(offer)" class="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-bold text-blue-700">사용 중</span>
                    <span v-if="offer.applied?.stockShort" class="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">재고 부족</span>
                  </div>
                  <p class="mt-1 truncate text-xs text-slate-500">{{ offer.supplierSku || 'SKU 미확인' }}</p>
                  <div class="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-600">
                    <span class="rounded bg-slate-100 px-2 py-1">포장 <b>{{ offer.packaging ?? '미확인' }}</b></span>
                    <span class="rounded bg-slate-100 px-2 py-1">주문 <b>{{ offer.applied?.orderQty.toLocaleString('ko-KR') ?? '—' }}</b></span>
                    <span class="rounded bg-slate-100 px-2 py-1">재고 <b>{{ offer.stock?.toLocaleString('ko-KR') ?? '—' }}</b></span>
                    <span class="rounded bg-slate-100 px-2 py-1">MOQ <b>{{ offer.moq?.toLocaleString('ko-KR') ?? '—' }}</b></span>
                    <span v-if="offer.purchaseFitRank !== null" class="rounded bg-slate-100 px-2 py-1">구매적합 <b>{{ offer.purchaseFitRank }}위</b></span>
                    <span v-if="offer.priceRank !== null" class="rounded bg-slate-100 px-2 py-1">가격 <b>{{ offer.priceRank }}위</b></span>
                  </div>
                  <p class="mt-2 text-[11px] text-slate-400">공급사 기준 {{ fmtAge(offer.fetchedAt) }}</p>
                </div>
                <div class="shrink-0 sm:text-right">
                  <p class="text-xs text-slate-500">단가 <b class="text-slate-800">{{ fmtUnit(offer) }}</b></p>
                  <strong class="mt-1 block text-lg tabular-nums text-slate-950">{{ fmtWon(offer.applied?.lineTotalKrw ?? null) }}</strong>
                  <div class="mt-2 flex items-center gap-2 sm:justify-end">
                    <a v-if="offer.productUrl" :href="offer.productUrl" target="_blank" rel="noopener noreferrer" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">제품</a>
                    <button
                      type="button"
                      class="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      :disabled="selecting || !offer.purchasable || offer.applied === null || isCurrent(offer)"
                      @click="selectOffer(candidate, offer)"
                    >
                      {{ isCurrent(offer) ? '현재 오퍼' : offer.purchasable ? '이 오퍼 선택' : '선택 불가' }}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </div>

        <footer class="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-[11px] text-slate-500">다른 제조사·MPN·물리 패키지를 검토하려면 후보 비교를 이용하세요.</p>
          <button type="button" class="shrink-0 rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50" @click="emit('compare')">다른 부품 후보 비교</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
