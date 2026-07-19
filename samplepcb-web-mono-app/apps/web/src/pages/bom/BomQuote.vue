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
  useSupplierSearchResult,
  useSupplierSearchStatus,
} from '../../bom/useBom';
import { useBomPanels } from '../../bom/usePanels';
import BomCompareModal from '../../components/bom/BomCompareModal.vue';
import BomOfferModal from '../../components/bom/BomOfferModal.vue';
import BomPartSearchModal from '../../components/bom/BomPartSearchModal.vue';
import favDigikey from '../../assets/bom/fav-digikey.png';
import favMouser from '../../assets/bom/fav-mouser.png';
import favUnikeyic from '../../assets/bom/fav-unikeyic.png';
import favSamplepcb from '../../assets/bom/fav-samplepcb.png';

// 고객 스마트 BOM 견적 워크벤치 — Figma "02 BOM 파일 분석_검색 결과"(87:12875) 레이아웃에
// 기존 기능(자동저장·오퍼/부품 모달·자동 보강·견적요청)을 병합. 사용자 지시:
// 채팅·가격순 정렬 제외, Found 대신 기존 매칭 배지, 공급사 배지는 파비콘(vueline 방식),
// 미구현 요소(핸들·이미지·데이터시트·선택 삭제)는 디자인만.

const route = useRoute();
const router = useRouter();
const quoteId = computed(() => String(route.params.id ?? ''));
// 상단바 우측 접기 버튼과 공유 — 이 페이지의 우측 패널(AI 분석결과·주문 정보·예상 견적)
const { rightOpen } = useBomPanels();

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

function stepSet(delta: number): void {
  if (!isDraft.value) return;
  setQty.value = Math.max(1, setQty.value + delta);
  restampAll();
}

function stepSpare(delta: number): void {
  if (!isDraft.value) return;
  spareQty.value = Math.max(0, spareQty.value + delta);
  restampAll();
}

function onQtyChange(item: BomQuoteItemType): void {
  recalcLine(item);
  markDirty();
}

function toggleInclude(item: BomQuoteItemType): void {
  if (!isDraft.value) return;
  item.included = !item.included;
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

// ── 통계·합계(로컬 표시 — 저장 시 서버가 재계산해 동기화) ────────────────────
function isStockShort(item: BomQuoteItemType): boolean {
  const o = item.selectedOffer;
  return o !== null && o.stock !== null && o.stock < item.orderQty;
}

const stats = computed(() => {
  const total = items.value.length;
  const matched = items.value.filter((i) => i.matchStatus !== 'none').length;
  const nostock = items.value.filter((i) => i.included && isStockShort(i)).length;
  return {
    total,
    matched,
    matchedPct: total === 0 ? 0 : Math.round((matched / total) * 100),
    nostock,
    unmatched: total - matched,
    included: items.value.filter((i) => i.included).length,
  };
});

const itemsTotal = computed(() =>
  Math.round(
    items.value.filter((i) => i.included && i.lineTotalKrw !== null).reduce((s, i) => s + (i.lineTotalKrw ?? 0), 0),
  ),
);
const uncostedCount = computed(() => items.value.filter((i) => i.included && i.lineTotalKrw === null).length);
const finalTotal = computed(() => itemsTotal.value + (detail.value?.shippingFee ?? 0) + (detail.value?.managementFee ?? 0));

// ── 조용한 자동 보강 상태 — 서버(build)가 판단·시작하므로 FE 는 상태 표시만 ────
const catalogMatch = useCatalogMatchBomQuote();
const compareOpen = ref(false);
const supplierStatus = useSupplierSearchStatus(
  computed(() => detail.value?.engineJobId ?? null),
  computed(() => isDraft.value && !needsBuild.value),
);
const supplierResult = useSupplierSearchResult(
  computed(() => detail.value?.engineJobId ?? null),
  compareOpen,
);
const enriching = computed(() => supplierStatus.data.value?.data.status === 'running');
const refreshedNotice = ref(false);

watch(
  () => supplierStatus.data.value?.data.status,
  (now, prev) => {
    if (prev !== 'running' || now !== 'completed' || !isDraft.value) return;
    void catalogMatch.mutateAsync({ quoteId: quoteId.value, onlyUnmatched: true }).catch(() => undefined);
    setTimeout(() => {
      void quote.refetch();
    }, 7_000);
    refreshedNotice.value = true;
    setTimeout(() => (refreshedNotice.value = false), 5_000);
  },
);

// ── 공급사 배지(vueline 파비콘 방식) ─────────────────────────────────────────
const SUPPLIER_META: Record<string, { name: string; icon: string }> = {
  digikey: { name: 'Digikey', icon: favDigikey },
  mouser: { name: 'Mouser', icon: favMouser },
  unikeyic: { name: 'UniKeyIC', icon: favUnikeyic },
  samplepcb: { name: 'SamplePCB', icon: favSamplepcb },
};

// ── 가격구간 표시(상위 4개 + 가격 상세 확장) ─────────────────────────────────
const expandedPrice = ref<Set<number>>(new Set());

function togglePrice(rowIdx: number): void {
  const next = new Set(expandedPrice.value);
  if (next.has(rowIdx)) next.delete(rowIdx);
  else next.add(rowIdx);
  expandedPrice.value = next;
}

function visibleBreaks(item: BomQuoteItemType): { qty: number; price: number }[] {
  const offer = item.selectedOffer;
  if (offer === null) return [];
  const sorted = [...offer.priceBreaks].sort((a, b) => a.qty - b.qty);
  return expandedPrice.value.has(item.rowIdx) ? sorted : sorted.slice(0, 4);
}

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

function fmtBreakPrice(price: number, currency: string): string {
  if (currency === 'KRW') return `${price.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`;
  const sym = currency === 'USD' ? '$' : `${currency} `;
  return `${sym}${price.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}`;
}

/** 오퍼 데이터 나이 — 정직성 표시(방금 조회한 것처럼 보이지 않게). */
function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return '방금';
  if (ms < 3_600_000) return `${String(Math.floor(ms / 60_000))}분 전`;
  if (ms < 86_400_000) return `${String(Math.floor(ms / 3_600_000))}시간 전`;
  return `${String(Math.floor(ms / 86_400_000))}일 전`;
}

function rowClass(item: BomQuoteItemType): string {
  if (!item.included) return 'opacity-45';
  if (item.matchStatus === 'none') return 'bg-[#fdf2f2]'; // 미매칭 — 시안 분홍
  if (isStockShort(item)) return 'bg-[#fdf8e7]'; // 재고 부족 — 시안 노랑
  return 'bg-white';
}
</script>

<template>
  <div class="h-full">
    <p v-if="quote.isLoading.value" class="py-16 text-center text-sm text-gray-400">불러오는 중…</p>

    <!-- 파싱 진행 -->
    <section v-else-if="needsBuild" class="m-6 rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-sm">
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

    <!-- 워크벤치 — 시안(87:12875): 좌 매칭 결과 테이블(내부 스크롤) + 우 정보 패널(고정) -->
    <div v-else-if="detail" class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5 xl:flex-row xl:overflow-visible">
      <!-- 좌: 파일명·액션(고정) + 테이블(내부 스크롤) -->
      <section class="flex min-h-0 min-w-0 flex-1 flex-col">
        <!-- file name + 액션 (87:13178~) -->
        <div class="flex flex-wrap items-start justify-between gap-3 px-1">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" class="text-sm text-gray-400 hover:text-gray-700" title="목록으로" @click="router.push({ name: 'bom' })">←</button>
              <h1 class="text-[19px] font-bold text-[#061023]">{{ detail.fileName ?? detail.title }}</h1>
              <button
                type="button"
                class="flex h-[30px] items-center gap-1 rounded-md border border-[#1e64fd] px-2.5 text-[13px] font-semibold text-[#1e64fd] hover:bg-blue-50"
                title="새 BOM 업로드"
                @click="router.push({ name: 'bom' })"
              >
                <span class="text-[14px]">↥</span> 업로드
              </button>
              <span class="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">{{ STATUS_LABEL[detail.status] }}</span>
              <span v-if="enriching" class="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                가격·재고 확인 중… ({{ supplierStatus.data.value?.data.progress ?? 0 }}%)
              </span>
              <span v-if="refreshedNotice" class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">최신 가격·재고로 갱신되었습니다</span>
            </div>
            <p class="mt-1 pl-6 text-[13px] text-[#5f6777]">{{ stats.total }}개 부품</p>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="isDraft" class="mr-1 text-xs text-gray-400">
              <template v-if="saveState === 'saving'">저장 중…</template>
              <template v-else-if="saveState === 'saved' && !dirty">자동 저장됨</template>
              <template v-else-if="saveState === 'error'"><span class="text-red-500">저장 실패</span></template>
            </span>
            <button
              type="button"
              class="flex h-[38px] items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 text-[14px] font-semibold text-[#374151] hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
              title="Excel 원본과 공급사 검색 결과 비교"
              @click="compareOpen = true"
            >
              <span>◫</span> BOM 비교
            </button>
            <button
              v-if="isDraft"
              type="button"
              class="flex h-[38px] items-center gap-1 rounded-lg bg-[#1e64fd] px-4 text-[14px] font-semibold text-white hover:bg-blue-700"
              @click="partModal = { mode: 'add', lineIdx: null, query: '' }"
            >
              <span class="text-[16px] leading-none">+</span> 추가
            </button>
          </div>
        </div>

        <!-- 매칭 결과 헤더 -->
        <div class="mt-4 flex items-center justify-between px-1">
          <p class="text-[15px] font-bold text-[#061023]">매칭 결과</p>
          <!-- 선택 삭제 — 미구현(디자인만) -->
          <button type="button" class="h-[26px] cursor-default rounded border border-gray-300 bg-white px-2.5 text-[12px] text-gray-500 opacity-70" title="선택 삭제 (준비 중)">선택 삭제</button>
        </div>

        <!-- 테이블 (list01 스타일) — 이 영역만 내부 스크롤, 헤더는 sticky -->
        <div class="mt-2 min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200 bg-white">
          <table class="min-w-[980px] w-full">
            <thead class="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e5e8ed]">
              <tr class="text-left text-[11px] uppercase tracking-wide text-[#8e97a5]">
                <th class="w-[36px] px-2 py-2.5" />
                <th class="min-w-[240px] px-2 py-2.5">MPN</th>
                <th class="px-2 py-2.5">Manufacturer</th>
                <th class="px-2 py-2.5">Description</th>
                <th class="w-[130px] px-2 py-2.5 text-right">Unit Price</th>
                <th class="w-[170px] px-2 py-2.5">Quantity / Stock</th>
                <th class="w-[130px] px-2 py-2.5 text-right">Total Price</th>
                <th class="w-[76px] px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, idx) in items" :key="item.rowIdx" class="border-b border-[#e5e8ed] align-top transition-colors" :class="rowClass(item)">
                <!-- 핸들(디자인만) + 포함 체크 -->
                <td class="px-2 py-3">
                  <div class="flex flex-col items-center gap-2 pt-1">
                    <input :checked="item.included" type="checkbox" class="h-4 w-4 rounded border-gray-300" :disabled="!isDraft" title="합계·견적요청 포함" @change="toggleInclude(item)">
                    <span class="cursor-default text-[13px] leading-none text-gray-300" title="정렬 (준비 중)">⋮⋮</span>
                  </div>
                </td>
                <!-- MPN: 공급사 배지 + 이미지 자리 + 품번 + 데이터시트 -->
                <td class="px-2 py-3">
                  <div class="flex gap-2.5">
                    <div class="shrink-0">
                      <div
                        v-if="item.selectedOffer !== null"
                        class="mb-1 flex h-[20px] w-fit items-center gap-1 rounded-[3px] bg-[#131519] px-1.5"
                        :title="item.selectedOffer.supplierSku"
                      >
                        <img :src="SUPPLIER_META[item.selectedOffer.supplier]?.icon ?? favSamplepcb" alt="" class="size-[12px] rounded-[2px]">
                        <span class="text-[10px] font-semibold text-white">{{ SUPPLIER_META[item.selectedOffer.supplier]?.name ?? item.selectedOffer.supplier }}</span>
                      </div>
                      <!-- 부품 이미지 — 데이터 없음(디자인만 플레이스홀더) -->
                      <div class="grid size-[56px] place-items-center rounded-md border border-gray-200 bg-gray-50 text-[10px] text-gray-300">IMG</div>
                    </div>
                    <div class="min-w-0 pt-[22px]">
                      <p class="truncate text-[14px] font-medium leading-[20px] text-[#061023]">{{ item.mpn }}</p>
                      <p class="cursor-default text-[12px] leading-[16px] text-[#9db9dd]" title="데이터시트 (준비 중)">데이터시트</p>
                    </div>
                  </div>
                </td>
                <td class="px-2 py-3 pt-[42px] text-[12px] leading-[16px] text-[#5f6777]">{{ item.manufacturerName ?? '—' }}</td>
                <td class="max-w-[220px] px-2 py-3 pt-[42px]">
                  <p class="truncate text-[12px] leading-[16px] text-[#8e97a5]" :title="item.description ?? ''">{{ item.description ?? '—' }}</p>
                </td>
                <!-- UNIT PRICE 구간(상위 4 + 가격 상세) -->
                <td class="px-2 py-3">
                  <template v-if="item.selectedOffer !== null">
                    <div class="flex flex-col gap-[4px]">
                      <div
                        v-for="pb in visibleBreaks(item)"
                        :key="pb.qty"
                        class="flex items-baseline justify-between gap-3 text-[12px]"
                        :class="pb.qty === item.selectedOffer.breakQty ? 'font-bold text-[#1e64fd]' : 'font-semibold text-[#5f6777]'"
                      >
                        <span>{{ pb.qty }}+</span>
                        <span class="tabular-nums">{{ fmtBreakPrice(pb.price, item.selectedOffer.currency) }}</span>
                      </div>
                    </div>
                    <div v-if="item.selectedOffer.priceBreaks.length > 4" class="mt-1 border-t border-gray-200 pt-1 text-center">
                      <button type="button" class="text-[12px] font-semibold text-[#1e64fd]" @click="togglePrice(item.rowIdx)">
                        가격 상세 {{ expandedPrice.has(item.rowIdx) ? '▴' : '▾' }}
                      </button>
                    </div>
                    <p class="mt-1 text-right text-[10px] text-gray-400" title="이 가격·재고를 공급사에서 가져온 시각">기준 {{ fmtAge(item.selectedOffer.fetchedAt) }}</p>
                  </template>
                  <p v-else class="pt-[24px] text-right text-[12px] text-gray-300">—</p>
                </td>
                <!-- QUANTITY / STOCK: 패키지(→오퍼 모달) + 수량 -->
                <td class="px-2 py-3">
                  <button
                    type="button"
                    class="flex h-[38px] w-[160px] items-center justify-between rounded-[6px] border border-[#d3d5dc] bg-[#f4f4f4] px-3 text-[13px] font-bold text-[#4c4c4c] disabled:cursor-default"
                    :disabled="!isDraft || item.partId === null"
                    :title="item.selectedOffer?.packaging ?? '오퍼 선택'"
                    @click="openOfferModal(idx)"
                  >
                    <span class="truncate">{{ item.selectedOffer?.packaging ?? (item.selectedOffer !== null ? item.selectedOffer.supplier : '오퍼 없음') }}</span>
                    <span class="text-[10px] text-gray-400">▾</span>
                  </button>
                  <div class="mt-[8px] flex h-[38px] w-[160px] items-center justify-between rounded-[6px] border border-[#d6dae7] bg-[#fafcff] pl-1 pr-3">
                    <input
                      v-model.number="item.orderQty"
                      type="number"
                      min="1"
                      class="w-[70px] bg-transparent px-2 text-right text-[15px] font-bold tabular-nums focus:outline-none"
                      :disabled="!isDraft || item.selectedOffer === null"
                      @change="onQtyChange(item)"
                    >
                    <span class="text-[11px] text-[#8e97a5]">/ {{ item.selectedOffer?.stock?.toLocaleString('ko-KR') ?? '—' }}</span>
                  </div>
                </td>
                <!-- TOTAL: 기존 매칭 배지(Found 대체) + 합계 -->
                <td class="px-2 py-3 text-right">
                  <div class="flex flex-col items-end gap-1.5 pt-1">
                    <span v-if="item.matchStatus === 'none'" class="rounded-full bg-red-100 px-2.5 py-0.5 text-[12px] font-medium text-red-600">미매칭</span>
                    <span v-else-if="isStockShort(item)" class="rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-medium text-amber-700">재고 부족</span>
                    <span v-else-if="item.selectedOffer !== null" class="rounded-full bg-[#01bd46]/15 px-2.5 py-0.5 text-[12px] font-medium text-[#38b614]">매칭</span>
                    <span v-if="item.selectedOffer?.pinned" class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700" title="직접 선택한 오퍼 — 수량이 바뀌어도 유지">고정</span>
                    <span class="text-[14px] font-bold tabular-nums" :class="item.lineTotalKrw === null ? 'text-gray-300' : 'text-[#38b614]'">
                      {{ item.lineTotalKrw === null ? '—' : fmtWon(Math.round(item.lineTotalKrw)) }}
                    </span>
                    <span v-if="item.selectedOffer !== null && item.selectedOffer.currency !== 'KRW'" class="text-[10px] text-gray-400">
                      {{ item.selectedOffer.unitPriceKrw === null ? '환산 불가' : `단가 ≈₩${item.selectedOffer.unitPriceKrw.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}` }}
                    </span>
                  </div>
                </td>
                <!-- 액션 3버튼(시안 60×24): 변경=부품 교체 / 삭제=제외 / 상세=오퍼 -->
                <td class="px-2 py-3">
                  <div v-if="isDraft" class="flex flex-col gap-[6px] pt-1">
                    <button type="button" class="h-[24px] w-[60px] rounded-[4px] border border-[#d3d5dc] bg-[#f4f4f4] text-[13px] font-medium text-[#4c4c4c] hover:bg-gray-200" @click="partModal = { mode: 'swap', lineIdx: idx, query: item.mpn }">변경</button>
                    <button type="button" class="h-[24px] w-[60px] rounded-[4px] border border-[#d3d5dc] bg-[#f4f4f4] text-[13px] font-medium text-[#4c4c4c] hover:bg-gray-200" @click="toggleInclude(item)">{{ item.included ? '삭제' : '복원' }}</button>
                    <button type="button" class="h-[24px] w-[60px] rounded-[4px] border border-[#d3d5dc] bg-[#f4f4f4] text-[13px] font-medium text-[#4c4c4c] hover:bg-gray-200 disabled:opacity-40" :disabled="item.partId === null" @click="openOfferModal(idx)">상세</button>
                  </div>
                </td>
              </tr>
              <tr v-if="items.length === 0">
                <td colspan="8" class="px-3 py-10 text-center text-sm text-gray-400">표시할 라인이 없습니다.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 우: 정보 패널 (시안 right side bar — 라이트 치환, 상단바 접기 버튼과 연동).
           패널 자체는 고정, 내용이 길면 패널 안에서만 스크롤 -->
      <aside v-show="rightOpen" class="w-full shrink-0 space-y-3 xl:min-h-0 xl:w-[286px] xl:overflow-y-auto xl:pb-1">
        <!-- 회신(answered) -->
        <div v-if="detail.answerNote !== null || detail.confirmedTotal !== null" class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <p class="font-semibold text-emerald-800">담당자 회신</p>
          <p v-if="detail.answerNote" class="mt-1 whitespace-pre-wrap text-emerald-900">{{ detail.answerNote }}</p>
          <p v-if="detail.confirmedTotal !== null" class="mt-2 text-emerald-900">
            확정 견적: <b class="tabular-nums">{{ fmtWon(detail.confirmedTotal) }}</b>
            <span v-if="detail.confirmedShippingFee !== null" class="ml-1 block text-xs">(운송료 {{ fmtWon(detail.confirmedShippingFee) }} · 관리비 {{ fmtWon(detail.confirmedManagementFee) }})</span>
          </p>
        </div>

        <!-- AI 분석결과 (87:12996) -->
        <div class="rounded-xl border border-gray-200 bg-white p-4">
          <p class="flex items-center gap-1.5 text-[14px] font-bold text-[#061023]"><span>🤖</span> AI 분석결과</p>
          <div class="mt-3 space-y-2">
            <div class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5">
              <span class="text-[11px] font-bold uppercase tracking-wide text-[#5f6777]">Total Lines</span>
              <span class="text-[18px] font-bold tabular-nums text-[#061023]">{{ stats.total }}</span>
            </div>
            <div class="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2.5">
              <span class="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Matched</span>
              <span class="text-[18px] font-bold tabular-nums text-emerald-600">{{ stats.matched }} <span class="text-[12px] font-semibold">{{ stats.matchedPct }}%</span></span>
            </div>
            <div class="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2.5">
              <span class="text-[11px] font-bold uppercase tracking-wide text-amber-700">Nostock</span>
              <span class="text-[18px] font-bold tabular-nums text-amber-600">{{ stats.nostock }}</span>
            </div>
            <div class="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2.5">
              <span class="text-[11px] font-bold uppercase tracking-wide text-red-700">Unmatched</span>
              <span class="text-[18px] font-bold tabular-nums text-red-600">{{ stats.unmatched }}</span>
            </div>
          </div>
        </div>

        <!-- 주문 정보 (87:13013) -->
        <div class="rounded-xl border border-gray-200 bg-white p-4">
          <p class="flex items-center gap-1.5 text-[14px] font-bold text-[#061023]"><span>🛒</span> 주문 정보</p>
          <div class="mt-3 space-y-2.5 text-sm">
            <div class="flex items-center justify-between">
              <span class="text-[13px] text-[#5f6777]">세트 수량</span>
              <div class="flex items-center gap-1">
                <div class="flex h-[32px] w-[92px] items-center rounded-md border border-gray-300 bg-white">
                  <button type="button" class="w-[26px] text-gray-400 hover:text-gray-700 disabled:opacity-40" :disabled="!isDraft" @click="stepSet(-1)">−</button>
                  <input v-model.number="setQty" type="number" min="1" class="w-full min-w-0 border-x border-gray-200 text-center text-[14px] font-semibold tabular-nums focus:outline-none disabled:bg-transparent" :disabled="!isDraft" @change="restampAll">
                  <button type="button" class="w-[26px] text-gray-400 hover:text-gray-700 disabled:opacity-40" :disabled="!isDraft" @click="stepSet(1)">+</button>
                </div>
                <span class="text-[11px] text-gray-400">Set</span>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[13px] text-[#5f6777]">예비 수량</span>
              <div class="flex items-center gap-1">
                <div class="flex h-[32px] w-[92px] items-center rounded-md border border-gray-300 bg-white">
                  <button type="button" class="w-[26px] text-gray-400 hover:text-gray-700 disabled:opacity-40" :disabled="!isDraft" @click="stepSpare(-1)">−</button>
                  <input v-model.number="spareQty" type="number" min="0" class="w-full min-w-0 border-x border-gray-200 text-center text-[14px] font-semibold tabular-nums focus:outline-none disabled:bg-transparent" :disabled="!isDraft" @change="restampAll">
                  <button type="button" class="w-[26px] text-gray-400 hover:text-gray-700 disabled:opacity-40" :disabled="!isDraft" @click="stepSpare(1)">+</button>
                </div>
                <span class="text-[11px] text-gray-400">Set</span>
              </div>
            </div>
            <div class="flex items-center justify-between border-t border-gray-100 pt-2.5">
              <span class="text-[13px] text-[#5f6777]">예상 납기</span>
              <span class="text-[12px] text-gray-500">확정 시 안내</span>
            </div>
            <p class="text-[11px] leading-[16px] text-gray-400">주문수량 = max(BOM수량 × (세트+예비), MOQ) 후 주문배수 올림</p>
          </div>
        </div>

        <!-- 예상 견적 (87:13028) -->
        <div class="rounded-xl border border-gray-200 bg-white p-4">
          <p class="flex items-center gap-1.5 text-[14px] font-bold text-[#061023]"><span>💰</span> 예상 견적</p>
          <div class="mt-3 space-y-1.5 text-[13px]">
            <div class="flex justify-between"><span class="text-[#5f6777]">합계</span><span class="tabular-nums text-[#061023]">{{ fmtWon(itemsTotal) }}</span></div>
            <div class="flex justify-between"><span class="text-[#5f6777]">운송료</span><span class="tabular-nums text-[#061023]">{{ fmtWon(detail.shippingFee) }}</span></div>
            <div class="flex justify-between"><span class="text-[#5f6777]">관리비</span><span class="tabular-nums text-[#061023]">{{ fmtWon(detail.managementFee) }}</span></div>
            <div class="mt-2 rounded-lg bg-[#eef4ff] px-3 py-2.5">
              <div class="flex items-baseline justify-between">
                <span class="text-[12px] font-semibold text-[#5f6777]">최종합계 <span class="font-normal">(VAT 별도)</span></span>
                <span class="text-[20px] font-bold tabular-nums text-[#1e64fd]">{{ fmtWon(finalTotal) }}</span>
              </div>
            </div>
            <p v-if="uncostedCount > 0" class="rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">금액 미산정 라인 {{ uncostedCount }}건 — 미매칭이거나 환산 불가한 통화입니다</p>
            <p class="pt-1 text-[11px] leading-[16px] text-gray-400">· AI로 산출한 가견적입니다.<br>· 정확한 가격은 담당자 확정 시 안내드립니다.</p>
          </div>
        </div>

        <!-- CTA -->
        <div class="space-y-2">
          <button
            v-if="isDraft"
            type="button"
            class="flex h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-[#1e64fd] text-[15px] font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            :disabled="request.isPending.value || stats.included === 0"
            @click="openRequestModal"
          >
            📄 견적요청
          </button>
          <button
            v-if="detail.status === 'draft' || detail.status === 'requested'"
            type="button"
            class="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
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
    <BomCompareModal
      v-if="compareOpen && detail !== null"
      :open="compareOpen"
      :title="detail.fileName ?? detail.title"
      :items="items"
      :result="supplierResult.data.value?.data ?? null"
      :loading="supplierResult.isFetching.value && supplierResult.data.value === undefined"
      :failed="supplierResult.isError.value"
      :engine-job-id="detail.engineJobId"
      :search-status="supplierStatus.data.value?.data.status ?? null"
      @retry="supplierResult.refetch()"
      @close="compareOpen = false"
    />
  </div>
</template>
