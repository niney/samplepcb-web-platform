<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiGet } from '@sp/shared';
import {
  PartDetailResponse,
  apiRoutes,
  type BomQuoteItemType,
  type BomQuoteSelectedOfferType,
  type PartHitType,
} from '@sp/api-contract';
import {
  neededQty,
  pickBreak,
  pickDefaultOffer,
  stampOrderQty,
  toKrw,
  type BomOfferInput,
  type OfferPick,
} from '@sp/utils';
import {
  useBomJob,
  useBomQuote,
  useBuildBomQuote,
  useCancelBomQuote,
  useCatalogMatchBomQuote,
  usePatchBomQuote,
  useRequestBomQuote,
  useSupplierPreflight,
  useSupplierSearchStart,
  useSupplierSearchStatus,
} from '../../bom/useBom';
import BomOfferModal from '../../components/bom/BomOfferModal.vue';
import BomPartSearchModal from '../../components/bom/BomPartSearchModal.vue';

// 고객 스마트 BOM 견적 워크벤치 — 레거시 spSmartBomV2 result 화면의 기본 구조
// (좌 결과 테이블 + 우 주문 패널)를 따르되 재설계: 서버 저장이 단일 진실,
// 계산은 @sp/utils bom-pricing(서버와 동일 함수), 견적요청 후 동결.

const route = useRoute();
const router = useRouter();
const quoteId = computed(() => String(route.params.id ?? ''));

const quote = useBomQuote(computed(() => (quoteId.value === '' ? null : quoteId.value)));
const detail = computed(() => quote.data.value?.data ?? null);
const isDraft = computed(() => detail.value?.status === 'draft');

// ── 파싱 잡 폴링(라인이 아직 없을 때) ─────────────────────────────────────────
const needsBuild = computed(
  () => detail.value !== null && detail.value.status === 'draft' && detail.value.items.length === 0,
);
const job = useBomJob(
  computed(() => detail.value?.engineJobId ?? null),
  needsBuild,
);
const build = useBuildBomQuote();
const buildError = ref('');

watch(
  () => job.data.value?.data.status,
  (status) => {
    if (status === 'completed' && needsBuild.value && !build.isPending.value) {
      build.mutateAsync(quoteId.value).catch(() => {
        buildError.value = '분석 결과를 불러오지 못했습니다. 새 BOM으로 다시 업로드해 주세요.';
      });
    }
    if (status === 'failed') buildError.value = job.data.value?.data.error ?? 'BOM 분석에 실패했습니다.';
  },
);
watch(
  () => job.error.value,
  (err) => {
    if (err !== null && needsBuild.value) {
      buildError.value = '분석 잡을 찾을 수 없습니다(서버 재시작 등). 새 BOM으로 다시 업로드해 주세요.';
    }
  },
);

// ── 로컬 편집 상태(draft) — 서버 응답이 올 때마다 동기화 ─────────────────────
const items = ref<BomQuoteItemType[]>([]);
const setQty = ref(1);
const spareQty = ref(0);
const dirty = ref(false);

watch(
  detail,
  (d) => {
    if (d === null) return;
    items.value = d.items.map((i) => ({ ...i, selectedOffer: i.selectedOffer === null ? null : { ...i.selectedOffer } }));
    setQty.value = d.setQty;
    spareQty.value = d.spareQty;
    dirty.value = false;
  },
  { immediate: true },
);

const rate = computed(() => detail.value?.usdKrwRateUsed ?? null);

// ── 라인 재계산(서버와 동일 함수) ─────────────────────────────────────────────
function recalcLine(item: BomQuoteItemType): void {
  const offer = item.selectedOffer;
  if (offer === null) {
    item.lineTotalKrw = null;
    return;
  }
  const orderQty = Math.max(1, item.orderQty);
  const step = pickBreak(offer.priceBreaks, orderQty);
  if (step !== null) {
    offer.breakQty = step.qty;
    offer.unitPrice = step.price;
  }
  offer.unitPriceKrw = toKrw(offer.unitPrice, offer.currency, rate.value);
  item.lineTotalKrw = offer.unitPriceKrw === null ? null : Math.round(offer.unitPriceKrw * orderQty * 100) / 100;
}

/** 세트/예비수량 변경 — 오퍼 있는 전 라인의 주문수량을 박제(레거시 규칙 보존). */
function restampAll(): void {
  for (const item of items.value) {
    const offer = item.selectedOffer;
    if (offer === null) continue;
    item.orderQty = stampOrderQty(neededQty(item.bomQty, setQty.value, spareQty.value), offer.moq, offer.orderMultiple);
    recalcLine(item);
  }
  markDirty();
}

function onQtyChange(item: BomQuoteItemType): void {
  recalcLine(item);
  markDirty();
}

// ── 자동저장(1초 디바운스 — 레거시 관례 보존) ────────────────────────────────
const patch = usePatchBomQuote();
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function markDirty(): void {
  if (!isDraft.value) return;
  dirty.value = true;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), 1_000);
}

async function saveNow(): Promise<void> {
  if (!isDraft.value || !dirty.value) return;
  saveState.value = 'saving';
  try {
    await patch.mutateAsync({
      quoteId: quoteId.value,
      body: { setQty: setQty.value, spareQty: spareQty.value, items: items.value },
    });
    dirty.value = false;
    saveState.value = 'saved';
  } catch {
    saveState.value = 'error';
  }
}

// ── 합계(로컬 표시 — 저장 시 서버가 재계산해 동기화) ─────────────────────────
const itemsTotal = computed(() =>
  Math.round(
    items.value.filter((i) => i.included && i.lineTotalKrw !== null).reduce((s, i) => s + (i.lineTotalKrw ?? 0), 0),
  ),
);
const uncostedCount = computed(() => items.value.filter((i) => i.included && i.lineTotalKrw === null).length);
const finalTotal = computed(() => itemsTotal.value + (detail.value?.shippingFee ?? 0) + (detail.value?.managementFee ?? 0));
const stats = computed(() => ({
  total: items.value.length,
  matched: items.value.filter((i) => i.matchStatus !== 'none').length,
  included: items.value.filter((i) => i.included).length,
}));

// ── 공급사 검색(라이브 보강) ─────────────────────────────────────────────────
const preflight = useSupplierPreflight();
const startSearch = useSupplierSearchStart();
const catalogMatch = useCatalogMatchBomQuote();
const searchPolling = ref(false);
const supplierStatus = useSupplierSearchStatus(
  computed(() => detail.value?.engineJobId ?? null),
  searchPolling,
);
const searchError = ref('');
const preflightInfo = ref<string | null>(null);

async function onSupplierSearch(): Promise<void> {
  const jobId = detail.value?.engineJobId;
  if (jobId === undefined || jobId === null) return;
  searchError.value = '';
  try {
    const pf = await preflight.mutateAsync({ jobId, options: { max_calls: 60, cache_only: false, reset_cache: false } });
    const plan = pf.data.plan;
    preflightInfo.value = `부품 ${String(plan.component_count)}건 · 예상 API 호출 ${String(plan.estimated_api_calls)}회 (캐시 활용 ${String(plan.fresh_cache_requests)}건)`;
  } catch {
    searchError.value = '공급사 검색 사전점검에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

async function confirmSupplierSearch(): Promise<void> {
  const jobId = detail.value?.engineJobId;
  if (jobId === undefined || jobId === null) return;
  preflightInfo.value = null;
  try {
    await startSearch.mutateAsync({ jobId, options: { max_calls: 60, cache_only: false, reset_cache: false } });
    searchPolling.value = true;
  } catch (reason) {
    searchError.value =
      reason instanceof Error && reason.message.includes('429')
        ? '오늘 공급사 검색 한도에 도달했습니다. 내일 다시 시도해 주세요.'
        : '공급사 검색 시작에 실패했습니다.';
  }
}

watch(
  () => supplierStatus.data.value?.data.status,
  (status) => {
    if (!searchPolling.value) return;
    if (status === 'completed') {
      searchPolling.value = false;
      // 자동 인제스트된 신규 오퍼를 카탈로그 재매칭으로 반영
      void catalogMatch.mutateAsync({ quoteId: quoteId.value, onlyUnmatched: true });
    }
    if (status === 'failed') {
      searchPolling.value = false;
      searchError.value = supplierStatus.data.value?.data.error ?? '공급사 검색에 실패했습니다.';
    }
  },
);

// ── 오퍼 변경·부품 교체/추가 모달 ────────────────────────────────────────────
const offerModal = ref<{ lineIdx: number; partId: string } | null>(null);
const partModal = ref<{ mode: 'swap' | 'add'; lineIdx: number | null; query: string } | null>(null);

function openOfferModal(idx: number): void {
  const partId = items.value[idx]?.partId;
  if (partId === undefined || partId === null) return;
  offerModal.value = { lineIdx: idx, partId };
}

function applyOfferPick(pick: OfferPick, pinned: boolean, lineIdx: number, partId?: string): void {
  const item = items.value[lineIdx];
  if (item === undefined) return;
  const snapshot: BomQuoteSelectedOfferType = {
    supplier: pick.offer.supplier,
    supplierSku: pick.offer.supplierSku,
    packaging: pick.offer.packaging,
    breakQty: pick.breakQty,
    unitPrice: pick.unitPrice,
    currency: pick.currency,
    unitPriceKrw: pick.unitPriceKrw,
    moq: pick.offer.moq,
    orderMultiple: pick.offer.orderMultiple,
    stock: pick.offer.stock,
    priceBreaks: pick.offer.priceBreaks.map((pb) => ({ qty: pb.qty, price: pb.price })),
    fetchedAt: pick.offer.fetchedAt,
    pinned,
  };
  if (partId !== undefined) item.partId = partId;
  item.selectedOffer = snapshot;
  item.orderQty = pick.orderQty;
  recalcLine(item);
  markDirty();
}

function onOfferSelected(pick: OfferPick): void {
  if (offerModal.value === null) return;
  applyOfferPick(pick, true, offerModal.value.lineIdx);
  offerModal.value = null;
}

async function onPartSelected(part: PartHitType): Promise<void> {
  const modal = partModal.value;
  if (modal === null) return;
  partModal.value = null;

  // 선택 부품의 오퍼를 불러와 기본 오퍼 자동 선정(matchStatus=manual)
  let offers: BomOfferInput[];
  try {
    const res = await apiGet(`${apiRoutes.bom}/parts/${part.id}`, PartDetailResponse);
    offers = res.data.offers
      .filter((o) => o.supplier !== 'samplepcb')
      .map((o) => ({
        supplier: o.supplier,
        supplierSku: o.supplierSku,
        packaging: o.packaging,
        currency: o.currency,
        stock: o.stock,
        moq: o.moq,
        orderMultiple: o.orderMultiple,
        fetchedAt: o.fetchedAt,
        priceBreaks: o.priceBreaks.map((pb) => ({ qty: pb.qty, price: pb.price })),
      }));
  } catch {
    return;
  }

  let lineIdx = modal.lineIdx;
  if (modal.mode === 'add' || lineIdx === null) {
    const rowIdx = items.value.reduce((m, i) => Math.max(m, i.rowIdx), -1) + 1;
    items.value.push({
      rowIdx,
      included: true,
      mpn: part.mpn,
      manufacturerName: part.manufacturerName,
      description: part.description,
      bomQty: 1,
      orderQty: 0,
      matchStatus: 'manual',
      partId: part.id,
      selectedOffer: null,
      sourceRow: null,
      lineTotalKrw: null,
    });
    lineIdx = items.value.length - 1;
  } else {
    const item = items.value[lineIdx];
    if (item === undefined) return;
    item.mpn = part.mpn;
    item.manufacturerName = part.manufacturerName;
    item.description = part.description;
    item.matchStatus = 'manual';
    item.partId = part.id;
    item.selectedOffer = null;
  }

  const item = items.value[lineIdx];
  if (item === undefined) return;
  const pick = pickDefaultOffer(offers, neededQty(item.bomQty, setQty.value, spareQty.value), rate.value);
  if (pick !== null) {
    applyOfferPick(pick, false, lineIdx, part.id);
  } else {
    recalcLine(item);
    markDirty();
  }
}

// ── 견적요청·취소 ────────────────────────────────────────────────────────────
const request = useRequestBomQuote();
const cancel = useCancelBomQuote();
const requestModal = ref(false);
const requestTitle = ref('');
const requestError = ref('');

function openRequestModal(): void {
  requestTitle.value = detail.value?.title ?? '';
  requestError.value = '';
  requestModal.value = true;
}

async function submitRequest(): Promise<void> {
  if (requestTitle.value.trim() === '') {
    requestError.value = '견적명을 입력해 주세요.';
    return;
  }
  await saveNow(); // 마지막 편집 반영 후 요청
  try {
    await request.mutateAsync({ quoteId: quoteId.value, title: requestTitle.value.trim() });
    requestModal.value = false;
  } catch {
    requestError.value = '견적요청에 실패했습니다. 포함된 라인이 있는지 확인해 주세요.';
  }
}

async function onCancel(): Promise<void> {
  try {
    await cancel.mutateAsync(quoteId.value);
  } catch {
    // 상태 전이 불가 등 — 화면 갱신으로 확인
  }
}

// ── 표시 헬퍼 ────────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  draft: '작성 중',
  requested: '견적요청 접수',
  reviewing: '담당자 검토 중',
  answered: '견적 회신 완료',
  closed: '종료',
  canceled: '취소됨',
};

function fmtWon(v: number | null): string {
  return v === null ? '—' : `${v.toLocaleString('ko-KR')}원`;
}

function fmtUnit(offer: BomQuoteSelectedOfferType): string {
  const sym = offer.currency === 'KRW' ? '₩' : offer.currency === 'USD' ? '$' : `${offer.currency} `;
  return `${sym}${offer.unitPrice.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}`;
}
</script>

<template>
  <div class="space-y-4">
    <!-- 헤더 -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <button type="button" class="text-sm text-gray-500 hover:text-gray-800" @click="router.push({ name: 'bom' })">← 목록</button>
        <h1 class="text-xl font-semibold text-gray-900">{{ detail?.title ?? '' }}</h1>
        <span v-if="detail" class="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">{{ STATUS_LABEL[detail.status] }}</span>
      </div>
      <div v-if="isDraft" class="text-xs text-gray-400">
        <span v-if="saveState === 'saving'">저장 중…</span>
        <span v-else-if="saveState === 'saved' && !dirty">자동 저장됨</span>
        <span v-else-if="saveState === 'error'" class="text-red-500">저장 실패 — 네트워크 확인</span>
      </div>
    </div>

    <p v-if="quote.isLoading.value" class="py-16 text-center text-sm text-gray-400">불러오는 중…</p>

    <!-- 파싱 진행 -->
    <section v-else-if="needsBuild" class="rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-sm">
      <template v-if="buildError === ''">
        <p class="text-lg font-semibold text-gray-900">BOM을 분석하고 있습니다…</p>
        <p class="mt-2 text-sm text-gray-500">{{ job.data.value?.data.message ?? '헤더·품번·수량을 인식하는 중' }}</p>
        <div class="mx-auto mt-6 h-2 w-64 overflow-hidden rounded-full bg-gray-100">
          <div class="h-full rounded-full bg-blue-500 transition-all" :style="{ width: `${String(job.data.value?.data.progress ?? 5)}%` }" />
        </div>
        <p v-if="build.isPending.value" class="mt-4 text-sm text-blue-600">부품 카탈로그에서 가격·재고를 매칭하는 중…</p>
      </template>
      <template v-else>
        <p class="text-lg font-semibold text-red-600">분석 실패</p>
        <p class="mt-2 text-sm text-gray-500">{{ buildError }}</p>
        <button type="button" class="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700" @click="router.push({ name: 'bom' })">새 BOM 업로드</button>
      </template>
    </section>

    <!-- 워크벤치: 좌 결과 테이블 + 우 주문 패널 (레거시 기본 구조) -->
    <div v-else-if="detail" class="grid gap-4 lg:grid-cols-[1fr_310px]">
      <!-- 결과 테이블 -->
      <section class="space-y-3">
        <!-- 회신(answered) 안내 -->
        <div v-if="detail.answerNote !== null || detail.confirmedTotal !== null" class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <p class="font-semibold text-emerald-800">담당자 회신</p>
          <p v-if="detail.answerNote" class="mt-1 whitespace-pre-wrap text-emerald-900">{{ detail.answerNote }}</p>
          <p v-if="detail.confirmedTotal !== null" class="mt-2 text-emerald-900">
            확정 견적: <b class="tabular-nums">{{ fmtWon(detail.confirmedTotal) }}</b>
            <span v-if="detail.confirmedShippingFee !== null" class="ml-2 text-xs">(운송료 {{ fmtWon(detail.confirmedShippingFee) }} · 관리비 {{ fmtWon(detail.confirmedManagementFee) }})</span>
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            v-if="isDraft"
            type="button"
            class="rounded-lg border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
            :disabled="preflight.isPending.value || searchPolling"
            @click="onSupplierSearch"
          >
            {{ searchPolling ? '공급사 검색 중…' : '공급사 검색으로 보강' }}
          </button>
          <button
            v-if="isDraft"
            type="button"
            class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            @click="partModal = { mode: 'add', lineIdx: null, query: '' }"
          >
            + 부품 추가
          </button>
          <span v-if="searchPolling" class="text-xs text-blue-600">{{ supplierStatus.data.value?.data.message ?? '공급사 조회 중' }} ({{ supplierStatus.data.value?.data.progress ?? 0 }}%)</span>
          <span v-if="searchError !== ''" class="text-xs text-red-600">{{ searchError }}</span>
        </div>

        <!-- preflight 확인 -->
        <div v-if="preflightInfo !== null" class="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          <span>{{ preflightInfo }}</span>
          <button type="button" class="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700" @click="confirmSupplierSearch">검색 실행</button>
          <button type="button" class="text-xs text-blue-600 hover:underline" @click="preflightInfo = null">취소</button>
        </div>

        <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th class="px-3 py-2.5">포함</th>
                <th class="px-3 py-2.5">부품</th>
                <th class="px-3 py-2.5">오퍼</th>
                <th class="whitespace-nowrap px-3 py-2.5">BOM</th>
                <th class="whitespace-nowrap px-3 py-2.5">주문수량</th>
                <th class="whitespace-nowrap px-3 py-2.5">합계</th>
                <th class="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr v-for="(item, idx) in items" :key="item.rowIdx" :class="{ 'opacity-45': !item.included }">
                <td class="px-3 py-2">
                  <input v-model="item.included" type="checkbox" class="h-4 w-4 rounded border-gray-300" :disabled="!isDraft" @change="markDirty">
                </td>
                <td class="px-3 py-2">
                  <div class="font-medium text-gray-900">{{ item.mpn }}</div>
                  <div class="text-xs text-gray-500">{{ item.manufacturerName }}</div>
                  <div class="max-w-56 truncate text-xs text-gray-400" :title="item.description ?? ''">{{ item.description }}</div>
                </td>
                <td class="px-3 py-2">
                  <template v-if="item.selectedOffer !== null">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">{{ item.selectedOffer.supplier }}</span>
                      <span v-if="item.selectedOffer.pinned" class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700" title="직접 선택한 오퍼 — 수량이 바뀌어도 유지">고정</span>
                      <span v-if="item.selectedOffer.stock !== null && item.selectedOffer.stock < item.orderQty" class="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">재고 부족</span>
                    </div>
                    <div class="mt-0.5 text-xs tabular-nums text-gray-600">
                      {{ fmtUnit(item.selectedOffer) }} <span class="text-gray-400">@{{ item.selectedOffer.breakQty }}+</span>
                      <span v-if="item.selectedOffer.currency !== 'KRW'" class="text-gray-400"> · {{ item.selectedOffer.unitPriceKrw === null ? '환산 불가' : `≈₩${item.selectedOffer.unitPriceKrw.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}` }}</span>
                    </div>
                  </template>
                  <span v-else-if="item.matchStatus === 'none'" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">미매칭</span>
                  <span v-else class="text-xs text-gray-400">오퍼 없음</span>
                </td>
                <td class="px-3 py-2 tabular-nums text-gray-600">{{ item.bomQty }}</td>
                <td class="px-3 py-2">
                  <input
                    v-model.number="item.orderQty"
                    type="number"
                    min="1"
                    class="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
                    :disabled="!isDraft || item.selectedOffer === null"
                    @change="onQtyChange(item)"
                  >
                </td>
                <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ fmtWon(item.lineTotalKrw === null ? null : Math.round(item.lineTotalKrw)) }}</td>
                <td class="whitespace-nowrap px-3 py-2 text-right text-xs">
                  <template v-if="isDraft">
                    <button v-if="item.partId !== null" type="button" class="text-blue-600 hover:underline" @click="openOfferModal(idx)">오퍼</button>
                    <button type="button" class="ml-2 text-gray-500 hover:underline" @click="partModal = { mode: 'swap', lineIdx: idx, query: item.mpn }">교체</button>
                  </template>
                </td>
              </tr>
              <tr v-if="items.length === 0">
                <td colspan="7" class="px-3 py-10 text-center text-sm text-gray-400">표시할 라인이 없습니다.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 주문 패널 -->
      <aside class="space-y-4 self-start rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div class="grid grid-cols-3 gap-2 text-center text-sm">
          <div class="rounded-lg bg-gray-50 p-2"><div class="text-lg font-semibold tabular-nums">{{ stats.total }}</div><div class="text-xs text-gray-500">전체</div></div>
          <div class="rounded-lg bg-emerald-50 p-2"><div class="text-lg font-semibold tabular-nums text-emerald-700">{{ stats.matched }}</div><div class="text-xs text-gray-500">매칭</div></div>
          <div class="rounded-lg bg-blue-50 p-2"><div class="text-lg font-semibold tabular-nums text-blue-700">{{ stats.included }}</div><div class="text-xs text-gray-500">포함</div></div>
        </div>

        <div class="space-y-2 border-t border-gray-100 pt-3 text-sm">
          <label class="flex items-center justify-between gap-2">
            <span class="text-gray-600">세트수량</span>
            <input v-model.number="setQty" type="number" min="1" class="w-24 rounded-md border border-gray-300 px-2 py-1 text-right tabular-nums disabled:bg-gray-50" :disabled="!isDraft" @change="restampAll">
          </label>
          <label class="flex items-center justify-between gap-2">
            <span class="text-gray-600">예비수량</span>
            <input v-model.number="spareQty" type="number" min="0" class="w-24 rounded-md border border-gray-300 px-2 py-1 text-right tabular-nums disabled:bg-gray-50" :disabled="!isDraft" @change="restampAll">
          </label>
          <p class="text-xs text-gray-400">주문수량 = max(BOM수량 × (세트+예비), MOQ) 후 주문배수 올림</p>
        </div>

        <div class="space-y-1.5 border-t border-gray-100 pt-3 text-sm">
          <div class="flex justify-between"><span class="text-gray-600">부품 합계</span><span class="tabular-nums">{{ fmtWon(itemsTotal) }}</span></div>
          <div class="flex justify-between"><span class="text-gray-600">운송료(예상)</span><span class="tabular-nums">{{ fmtWon(detail.shippingFee) }}</span></div>
          <div class="flex justify-between"><span class="text-gray-600">관리비(예상)</span><span class="tabular-nums">{{ fmtWon(detail.managementFee) }}</span></div>
          <div class="flex justify-between border-t border-gray-200 pt-2 text-base font-semibold"><span>예상 합계</span><span class="tabular-nums">{{ fmtWon(finalTotal) }}</span></div>
          <p class="text-xs text-gray-400">VAT 별도 · 예상 견적 — 담당자 확정 시 변동될 수 있습니다</p>
          <p v-if="uncostedCount > 0" class="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-700">금액 미산정 라인 {{ uncostedCount }}건 — 미매칭이거나 환산 불가한 통화입니다</p>
          <p class="text-xs text-gray-400">납기는 견적 확정 시 안내드립니다</p>
        </div>

        <div class="space-y-2 border-t border-gray-100 pt-3">
          <button
            v-if="isDraft"
            type="button"
            class="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            :disabled="request.isPending.value || stats.included === 0"
            @click="openRequestModal"
          >
            견적요청
          </button>
          <button
            v-if="detail.status === 'draft' || detail.status === 'requested'"
            type="button"
            class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            @click="onCancel"
          >
            {{ detail.status === 'draft' ? '작성 취소' : '요청 취소' }}
          </button>
        </div>
      </aside>
    </div>

    <!-- 견적명 모달 -->
    <div v-if="requestModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="requestModal = false">
      <div class="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h3 class="text-base font-semibold text-gray-900">견적요청</h3>
        <p class="mt-1 text-xs text-gray-500">요청 후에는 내용이 동결되고 담당자가 확정 견적으로 회신합니다.</p>
        <input v-model="requestTitle" type="text" placeholder="견적명" class="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
        <p v-if="requestError !== ''" class="mt-2 text-xs text-red-600">{{ requestError }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50" @click="requestModal = false">취소</button>
          <button type="button" class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50" :disabled="request.isPending.value" @click="submitRequest">
            {{ request.isPending.value ? '요청 중…' : '견적요청 보내기' }}
          </button>
        </div>
      </div>
    </div>

    <BomOfferModal
      v-if="offerModal !== null && detail !== null"
      :part-id="offerModal.partId"
      :needed="neededQty(items[offerModal.lineIdx]?.bomQty ?? 1, setQty, spareQty)"
      :usd-krw-rate="rate"
      @select="onOfferSelected"
      @close="offerModal = null"
    />
    <BomPartSearchModal
      v-if="partModal !== null"
      :initial-query="partModal.query"
      :mode="partModal.mode"
      @select="onPartSelected"
      @close="partModal = null"
    />
  </div>
</template>
