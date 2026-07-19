<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiRequestError, apiGet } from '@sp/shared';
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
  useBomQuoteCandidates,
  useBuildBomQuote,
  useCancelBomQuote,
  useDeleteBomQuote,
  usePatchBomQuote,
  usePrepareBomQuoteSheets,
  useRequestBomQuote,
  useSelectBomQuoteCandidate,
  useSupplierSearchResult,
  useSupplierSearchStatus,
} from '../../bom/useBom';
import { useBomPanels } from '../../bom/usePanels';
import BomCandidateDrawer from '../../components/bom/BomCandidateDrawer.vue';
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

// 자동 보강(searching) 동안 견적을 3초 폴링 — done 은 매칭 라인과 같은 응답으로
// 도착하므로(서버가 한 저장으로 커밋) 링거·타임아웃 휴리스틱이 필요 없다
const quotePolling = ref(false);
const quote = useBomQuote(
  computed(() => (quoteId.value === '' ? null : quoteId.value)),
  computed(() => (quotePolling.value ? 3_000 : false)),
);
const detail = computed(() => quote.data.value?.data ?? null);
const isDraft = computed(() => detail.value?.status === 'draft');

// ── 전체 시트 파싱 → 고객 시트 선택 → 선택 시트만 계산 ───────────────────────
const isParsing = computed(() => detail.value?.status === 'draft' && detail.value.buildStatus === 'parsing');
const isSelecting = computed(() => detail.value?.status === 'draft' && detail.value.buildStatus === 'selecting');
const isBuilding = computed(() => detail.value?.status === 'draft' && detail.value.buildStatus === 'building');
const isBuildFailed = computed(() => detail.value?.status === 'draft' && detail.value.buildStatus === 'failed');
const job = useBomJob(
  computed(() => detail.value?.engineJobId ?? null),
  isParsing,
);
const prepareSheets = usePrepareBomQuoteSheets();
const build = useBuildBomQuote();
const buildError = ref('');
const selectedSheetIndexes = ref<number[]>([]);
const autoBuildAttempted = ref(false);

const selectableSheets = computed(() => detail.value?.sheets.filter((sheet) => sheet.status === 'parsed') ?? []);
const selectedComponentCount = computed(() => {
  const selected = new Set(selectedSheetIndexes.value);
  return selectableSheets.value
    .filter((sheet) => selected.has(sheet.sheetIndex))
    .reduce((sum, sheet) => sum + sheet.componentCount, 0);
});

function sheetErrorMessage(reason: unknown): string {
  const code = reason instanceof ApiRequestError ? reason.payload?.error : undefined;
  if (code === 'NO_COMPONENTS_IN_SELECTED_SHEETS') return '선택한 시트에서 부품 행을 찾지 못했습니다. 다른 시트를 선택해 주세요.';
  if (code === 'SELECTED_SHEETS_ITEM_LIMIT') return '선택한 시트의 부품이 2,000개를 초과합니다. 시트 수를 줄여 주세요.';
  if (code === 'INVALID_SHEET_SELECTION') return '선택할 수 없는 시트가 포함되어 있습니다. 시트 상태를 다시 확인해 주세요.';
  if (code === 'ENGINE_JOB_GONE') return '분석 작업이 만료되었습니다. 새 BOM으로 다시 업로드해 주세요.';
  return '시트 분석 결과를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

async function submitSheetSelection(indexes = selectedSheetIndexes.value): Promise<void> {
  if (indexes.length === 0 || build.isPending.value) return;
  buildError.value = '';
  try {
    await build.mutateAsync({ quoteId: quoteId.value, body: { sheetIndexes: [...indexes].sort((a, b) => a - b) } });
  } catch (reason) {
    buildError.value = sheetErrorMessage(reason);
  }
}

function toggleSheet(sheetIndex: number): void {
  if (build.isPending.value) return;
  selectedSheetIndexes.value = selectedSheetIndexes.value.includes(sheetIndex)
    ? selectedSheetIndexes.value.filter((index) => index !== sheetIndex)
    : [...selectedSheetIndexes.value, sheetIndex];
  buildError.value = '';
}

function sheetStatusLabel(status: 'parsed' | 'not_bom' | 'error'): string {
  if (status === 'parsed') return 'BOM 인식 완료';
  if (status === 'not_bom') return 'BOM 헤더 미탐';
  return '분석 오류';
}

function sheetFailureLabel(reason: string | null): string {
  if (reason === null) return '';
  if (reason === 'header_not_found') return '부품 표의 헤더를 찾지 못했습니다.';
  return reason;
}

watch(
  [() => job.data.value?.data.status, () => detail.value?.buildStatus],
  ([status, buildStatus]) => {
    if (status === 'completed' && buildStatus === 'parsing' && !prepareSheets.isPending.value) {
      prepareSheets.mutateAsync(quoteId.value).catch((reason: unknown) => {
        buildError.value = sheetErrorMessage(reason);
        void quote.refetch();
      });
    }
    if (status === 'failed') buildError.value = job.data.value?.data.error ?? 'BOM 분석에 실패했습니다.';
  },
  { immediate: true },
);
watch(
  () => job.error.value,
  (err) => {
    if (err !== null && isParsing.value) {
      buildError.value = '분석 잡을 찾을 수 없습니다(서버 재시작 등). 새 BOM으로 다시 업로드해 주세요.';
    }
  },
);

watch(
  [() => detail.value?.buildStatus, () => detail.value?.sheets],
  ([status, sheets]) => {
    if (status !== 'selecting' || sheets === undefined) return;
    const parsed = sheets.filter((sheet) => sheet.status === 'parsed');
    const persisted = parsed.filter((sheet) => sheet.selected).map((sheet) => sheet.sheetIndex);
    if (persisted.length > 0) selectedSheetIndexes.value = persisted;
    if (parsed.length === 1 && !autoBuildAttempted.value) {
      const only = parsed[0];
      if (only === undefined) return;
      autoBuildAttempted.value = true;
      selectedSheetIndexes.value = [only.sheetIndex];
      void submitSheetSelection([only.sheetIndex]);
    }
  },
  { immediate: true },
);

watch(quoteId, () => {
  autoBuildAttempted.value = false;
  selectedSheetIndexes.value = [];
  buildError.value = '';
});

// ── 로컬 편집 상태(draft) — 서버 응답이 올 때마다 동기화 ─────────────────────
const items = ref<BomQuoteItemType[]>([]);
const setQty = ref(1);
const spareQty = ref(0);
const dirty = ref(false);

watch(
  detail,
  (d) => {
    if (d === null) return;
    if (dirty.value) return; // 편집 중(자동저장 대기) — 폴링 응답이 로컬 편집을 덮지 않게
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
  if (editingLocked.value) return;
  for (const item of items.value) {
    const offer = item.selectedOffer;
    if (offer === null) continue;
    item.orderQty = stampOrderQty(neededQty(item.bomQty, setQty.value, spareQty.value), offer.moq, offer.orderMultiple);
    recalcLine(item);
  }
  markDirty();
}

function stepSet(delta: number): void {
  if (!isDraft.value || editingLocked.value) return;
  setQty.value = Math.max(1, setQty.value + delta);
  restampAll();
}

function stepSpare(delta: number): void {
  if (!isDraft.value || editingLocked.value) return;
  spareQty.value = Math.max(0, spareQty.value + delta);
  restampAll();
}

function onQtyChange(item: BomQuoteItemType): void {
  if (editingLocked.value) return;
  recalcLine(item);
  markDirty();
}

function toggleInclude(item: BomQuoteItemType): void {
  if (!isDraft.value || editingLocked.value) return;
  item.included = !item.included;
  markDirty();
}

// ── 자동저장(1초 디바운스 — 레거시 관례 보존) ────────────────────────────────
const patch = usePatchBomQuote();
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function markDirty(): void {
  if (!isDraft.value || editingLocked.value) return;
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
  const review = items.value.filter((i) => i.matchStatus === 'none' && i.matchEvidence?.selectionMode === 'review').length;
  const nostock = items.value.filter((i) => i.included && isStockShort(i)).length;
  return {
    total,
    matched,
    matchedPct: total === 0 ? 0 : Math.round((matched / total) * 100),
    nostock,
    review,
    unmatched: total - matched - review,
    unresolved: total - matched,
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

// ── 조용한 자동 보강 상태 — 서버 영속 enrichStatus 가 단일 진실 ─────────────────
// searching 이면 "확인 중" UI + 3초 폴링. done 은 매칭 라인과 원자적으로 도착하고,
// 재시작·잡 유실은 서버의 게으른 치유(조회 시 수렴)가 처리한다.
const compareOpen = ref(false);
const enriching = computed(() => detail.value?.enrichStatus === 'searching');
// PATCH가 라인 전체 replace-all 계약이므로 일부 행만 열어도 확인 중 데이터를 덮을 수 있다.
// 검색·결과 반영이 끝날 때까지 모든 BOM 변경 동작을 잠그고 읽기 기능만 유지한다.
const editingLocked = computed(() => enriching.value);
const EDIT_LOCK_TITLE = '공급사 확인이 완료되면 수정할 수 있습니다';
const supplierStatus = useSupplierSearchStatus(
  computed(() => detail.value?.engineJobId ?? null),
  enriching, // 진행률(%) 표시에만 필요
);
const supplierResult = useSupplierSearchResult(
  computed(() => detail.value?.engineJobId ?? null),
  compareOpen,
);
// 검색은 끝났고 서버가 결과를 견적에 반영(인제스트→재매칭)하는 중
const applying = computed(() => enriching.value && supplierStatus.data.value?.data.status === 'completed');
const enrichProgress = computed(() => (applying.value ? 100 : (supplierStatus.data.value?.data.progress ?? 3)));
const refreshedNotice = ref(false);

// 공급사 보강뿐 아니라 동기 build 요청 도중 새로고침·다른 탭으로 진입한 경우도
// 서버 ready 전이를 스스로 따라가도록 견적 상태를 폴링한다.
watch(
  [enriching, isBuilding],
  ([isEnriching, isQuoteBuilding]) => (quotePolling.value = isEnriching || isQuoteBuilding),
  { immediate: true },
);

// searching → done 전환: 엔진 판정과 기술·가격 하이브리드 선정 결과가 한 번에 도착한다.
// 여기서 카탈로그 재매칭을 다시 호출하면 ambiguous/input_conflict 판정을 덮어쓰므로 금지한다.
watch(
  () => detail.value?.enrichStatus,
  (now, prev) => {
    if (prev !== 'searching' || now !== 'done') return;
    refreshedNotice.value = true;
    setTimeout(() => (refreshedNotice.value = false), 6_000);
  },
);

// ── 공급사 배지(vueline 파비콘 방식) ─────────────────────────────────────────
const SUPPLIER_META: Record<string, { name: string; icon: string }> = {
  digikey: { name: 'Digikey', icon: favDigikey },
  mouser: { name: 'Mouser', icon: favMouser },
  unikeyic: { name: 'UniKeyIC', icon: favUnikeyic },
  samplepcb: { name: 'SamplePCB', icon: favSamplepcb },
};

// ── 후보 비교·선택 드로어 + 카탈로그 폴백 ────────────────────────────────────
const candidateRowIdx = ref<number | null>(null);
const candidateOpen = computed(() => candidateRowIdx.value !== null);
const candidateItem = computed(() =>
  candidateRowIdx.value === null
    ? null
    : (items.value.find((item) => item.rowIdx === candidateRowIdx.value) ?? null),
);
const candidateQuery = useBomQuoteCandidates(
  computed(() => (quoteId.value === '' ? null : quoteId.value)),
  candidateRowIdx,
  candidateOpen,
);
const candidateSelection = useSelectBomQuoteCandidate();
const candidateSelectionError = ref('');

const offerModal = ref<{ lineIdx: number; partId: string } | null>(null);
const partModal = ref<{ mode: 'swap' | 'add'; lineIdx: number | null; query: string } | null>(null);

watch(editingLocked, (locked) => {
  if (!locked) return;
  // 열려 있던 선택 모달에서 검색 도중 변경이 들어가는 경로도 차단한다.
  candidateRowIdx.value = null;
  offerModal.value = null;
  partModal.value = null;
});

function openPartModal(mode: 'swap' | 'add', lineIdx: number | null, query: string): void {
  if (editingLocked.value) return;
  partModal.value = { mode, lineIdx, query };
}

function openCandidateDrawer(item: BomQuoteItemType): void {
  candidateSelectionError.value = '';
  candidateRowIdx.value = item.rowIdx;
}

function closeCandidateDrawer(): void {
  candidateRowIdx.value = null;
  candidateSelectionError.value = '';
}

async function selectCandidate(candidateKey: string, offerKey: string | null): Promise<void> {
  if (candidateRowIdx.value === null || editingLocked.value) return;
  if (dirty.value) {
    await saveNow();
    if (saveState.value === 'error') {
      candidateSelectionError.value = '저장되지 않은 변경사항이 있습니다. 저장 상태를 확인해 주세요.';
      return;
    }
  }
  candidateSelectionError.value = '';
  try {
    await candidateSelection.mutateAsync({
      quoteId: quoteId.value,
      rowIdx: candidateRowIdx.value,
      body: { candidateKey, offerKey },
    });
    dirty.value = false;
    await Promise.all([quote.refetch(), candidateQuery.refetch()]);
  } catch (reason) {
    const code = reason instanceof ApiRequestError ? reason.payload?.error : undefined;
    candidateSelectionError.value = code === 'CANDIDATE_BLOCKED'
      ? '충돌하거나 필수 정보가 부족한 후보는 고객 화면에서 선택할 수 없습니다.'
      : code === 'OFFER_NOT_PRICED'
        ? '가격이 없는 오퍼는 선택할 수 없습니다.'
        : '후보 선택을 적용하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

function openCatalogSearchFromDrawer(): void {
  const item = candidateItem.value;
  if (item === null) return;
  const lineIdx = items.value.findIndex((entry) => entry.rowIdx === item.rowIdx);
  closeCandidateDrawer();
  openPartModal('swap', lineIdx < 0 ? null : lineIdx, item.mpn);
}

function openCatalogOffersFromDrawer(): void {
  const item = candidateItem.value;
  if (item === null) return;
  const lineIdx = items.value.findIndex((entry) => entry.rowIdx === item.rowIdx);
  closeCandidateDrawer();
  if (lineIdx >= 0) openOfferModal(lineIdx);
}

function openOfferModal(idx: number): void {
  if (editingLocked.value) return;
  const partId = items.value[idx]?.partId;
  if (partId === undefined || partId === null) return;
  offerModal.value = { lineIdx: idx, partId };
}

function applyOfferPick(pick: OfferPick, pinned: boolean, lineIdx: number, partId?: string): void {
  if (editingLocked.value) return;
  const item = items.value[lineIdx];
  if (item === undefined) return;
  const snapshot: BomQuoteSelectedOfferType = {
    offerKey: null,
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
  item.matchStatus = 'manual';
  item.selectedCandidateKey = null;
  item.selectionSource = 'catalog';
  item.selectedOffer = snapshot;
  item.orderQty = pick.orderQty;
  recalcLine(item);
  markDirty();
}

function onOfferSelected(pick: OfferPick): void {
  if (offerModal.value === null || editingLocked.value) return;
  applyOfferPick(pick, true, offerModal.value.lineIdx);
  offerModal.value = null;
}

async function onPartSelected(part: PartHitType): Promise<void> {
  const modal = partModal.value;
  if (modal === null || editingLocked.value) return;
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
  if (enriching.value) return; // 상세 조회 사이 검색이 시작된 경우 변경 폐기

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
      matchEvidence: null,
      recommendedCandidateKey: null,
      selectedCandidateKey: null,
      selectionSource: 'catalog',
      partId: part.id,
      selectedOffer: null,
      sourceRow: null,
      sourceSheetIndex: null,
      sourceSheetName: null,
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
    item.selectedCandidateKey = null;
    item.selectionSource = 'catalog';
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
  if (editingLocked.value) return;
  requestTitle.value = detail.value?.title ?? '';
  requestError.value = '';
  requestModal.value = true;
}

async function submitRequest(): Promise<void> {
  if (editingLocked.value) {
    requestModal.value = false;
    return;
  }
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

// draft 삭제 — 하드 삭제(항목·원본 파일 정리, 사용자 결정: 취소 대신 삭제 제공).
// 되돌릴 수 없어 같은 버튼이 확정으로 변전하는 2단계 확인.
const del = useDeleteBomQuote();
const deleteArm = ref(false);

function armDelete(): void {
  deleteArm.value = true;
  setTimeout(() => (deleteArm.value = false), 5_000); // 5초 내 미확정 시 해제
}

async function onDelete(): Promise<void> {
  deleteArm.value = false;
  try {
    await del.mutateAsync(quoteId.value);
    await router.push({ name: 'bom' });
  } catch {
    // draft 아님 등 — 화면 갱신으로 확인
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
  // 보강 진행 중엔 분홍(경고) 대신 중립 — 미매칭은 아직 최종 판정이 아니다
  if (item.matchStatus === 'none') {
    if (enriching.value) return 'bg-white';
    return item.matchEvidence?.selectionMode === 'review' ? 'bg-amber-50/60' : 'bg-[#fdf2f2]';
  }
  if (isStockShort(item)) return 'bg-[#fdf8e7]'; // 재고 부족 — 시안 노랑
  return 'bg-white';
}

function engineEvidenceTitle(item: BomQuoteItemType): string {
  const evidence = item.matchEvidence;
  if (evidence === null) return '';
  const details = [
    `엔진 판정: ${evidence.componentStatus}`,
    `안전 후보: ${String(evidence.eligibleCandidateCount)}/${String(evidence.candidateCount)}`,
  ];
  if (evidence.conflicts.length > 0) details.push(`충돌: ${evidence.conflicts.join(', ')}`);
  if (evidence.missingRequirements.length > 0) details.push(`누락: ${evidence.missingRequirements.join(', ')}`);
  return details.join('\n');
}

function selectionSourceLabel(item: BomQuoteItemType): string {
  if (item.selectionSource === 'customer') return '고객 선택';
  if (item.selectionSource === 'catalog') return '직접 검색';
  if (item.selectionSource === 'admin') return '관리자 선택';
  if (item.matchEvidence?.recommendationType === 'price') return '가격 최적';
  if (item.matchEvidence?.recommendationType === 'purchase-fit') return '구매조건 우선';
  if (item.matchEvidence?.recommendationType === 'lifecycle') return '수명주기 추천';
  if (item.matchEvidence?.selectionMode === 'exact') return '정확 일치';
  if (item.matchEvidence?.selectionMode === 'variant') return '검증 변형';
  if (item.matchEvidence?.selectionMode === 'spec-compatible') return '기술 추천';
  return item.matchStatus === 'manual' ? '직접 선택' : '자동 매칭';
}

function selectionReasonSummary(item: BomQuoteItemType): string {
  const evidence = item.matchEvidence;
  if (evidence === null) return item.matchStatus === 'manual' ? '카탈로그에서 직접 선택' : '후보 근거 없음';
  if (item.selectionSource === 'customer') {
    if (evidence.decisionReasonCodes.includes('offer-choice')) return '공급사 오퍼 직접 선택';
    return evidence.selectedTechnicalRank === null
      ? '후보 직접 선택'
      : `기술 ${String(evidence.selectedTechnicalRank)}순위 후보 직접 선택`;
  }
  if (evidence.recommendationType === 'price' && evidence.priceEvidence?.savingsKrw !== null) {
    const saving = evidence.priceEvidence?.savingsKrw ?? null;
    const rateValue = evidence.priceEvidence?.savingsRate ?? null;
    return saving === null
      ? '필수 스펙 검증 후 가격 최적'
      : `기술 1위 대비 ${Math.round(saving).toLocaleString('ko-KR')}원 절감${rateValue === null ? '' : ` · ${(rateValue * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`}`;
  }
  if (evidence.recommendationType === 'lifecycle') return '기술 1순위 NRND/EOL · 활성 부품 추천';
  if (evidence.recommendationType === 'purchase-fit') {
    const price = evidence.priceEvidence;
    return price === null
      ? '동급 후보 중 구매조건 우선 · 일부 확인 필요'
      : `동급 후보 중 필요 ${price.neededQty.toLocaleString('ko-KR')}개 → 주문 ${price.orderQty.toLocaleString('ko-KR')}개 · 일부 확인 필요`;
  }
  const required = evidence.requiredRequirementCount;
  return required > 0
    ? `확인된 항목 ${String(evidence.verifiedRequirementCount)}/${String(required)} · 충돌 없음`
    : `안전 후보 ${String(evidence.eligibleCandidateCount)}개 중 기술 우선`;
}

function sourceRows(item: BomQuoteItemType): number[] {
  const value = item.sourceRow?.sourceRows;
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is number => typeof row === 'number' && Number.isInteger(row) && row > 0);
}

function sourceRowLabel(item: BomQuoteItemType): string {
  const rows = sourceRows(item);
  if (rows.length === 0) return item.sourceSheetName === null ? '수동 추가' : '행 번호 없음';
  return `${rows.join(', ')}행`;
}

function sourceValue(item: BomQuoteItemType): string | null {
  const value = item.sourceRow?.valueRaw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function partLabel(item: BomQuoteItemType): string {
  const mpn = item.mpn.trim();
  const description = item.description?.trim() ?? '';
  return mpn !== '' ? mpn : (sourceValue(item) ?? (description !== '' ? description : '품번 미기재'));
}
</script>

<template>
  <div class="h-full">
    <p v-if="quote.isLoading.value" class="py-16 text-center text-sm text-gray-400">불러오는 중…</p>

    <!-- 전체 워크북 파싱 — 이 단계에서는 계산·공급사 검색을 시작하지 않는다 -->
    <section v-else-if="isParsing" class="m-6 rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-sm">
      <template v-if="buildError === ''">
        <p class="text-lg font-semibold text-gray-900">BOM을 분석하고 있습니다…</p>
        <p class="mt-2 text-sm text-gray-500">{{ job.data.value?.data.message ?? '헤더·품번·수량을 인식하는 중' }}</p>
        <div class="mx-auto mt-6 h-2 w-64 overflow-hidden rounded-full bg-gray-100">
          <div class="h-full rounded-full bg-blue-500 transition-all" :style="{ width: `${String(job.data.value?.data.progress ?? 5)}%` }" />
        </div>
        <p v-if="prepareSheets.isPending.value" class="mt-4 text-sm text-blue-600">시트별 분석 결과를 정리하고 있습니다…</p>
      </template>
      <template v-else>
        <p class="text-lg font-semibold text-red-600">분석 실패</p>
        <p class="mt-2 text-sm text-gray-500">{{ buildError }}</p>
        <button type="button" class="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700" @click="router.push({ name: 'bom' })">새 BOM 업로드</button>
      </template>
    </section>

    <!-- BOM 시트가 둘 이상이면 고객이 계산 대상을 명시한다 -->
    <section v-else-if="isSelecting && detail" class="m-6 mx-auto w-[min(920px,calc(100%-3rem))] rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.14em] text-blue-600">Sheet selection</p>
          <h1 class="mt-1 text-xl font-bold text-gray-950">계산할 BOM 시트를 선택해 주세요</h1>
          <p class="mt-2 text-sm leading-6 text-gray-500">선택한 시트의 부품만 가격·재고를 검색하고 견적 합계에 반영합니다. 여러 시트를 함께 선택할 수 있습니다.</p>
        </div>
        <button type="button" class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50" @click="router.push({ name: 'bom' })">다른 파일 업로드</button>
      </div>

      <div class="mt-6 grid gap-3 md:grid-cols-2">
        <label
          v-for="sheet in detail.sheets"
          :key="sheet.sheetIndex"
          class="relative flex min-h-[116px] gap-3 rounded-xl border p-4 transition"
          :class="[
            sheet.status !== 'parsed' ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-65' : 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/30',
            selectedSheetIndexes.includes(sheet.sheetIndex) ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : '',
          ]"
        >
          <input
            type="checkbox"
            class="mt-1 size-4 rounded border-gray-300 text-blue-600 disabled:cursor-not-allowed"
            :checked="selectedSheetIndexes.includes(sheet.sheetIndex)"
            :disabled="sheet.status !== 'parsed' || build.isPending.value"
            @change="toggleSheet(sheet.sheetIndex)"
          >
          <span class="min-w-0 flex-1">
            <span class="flex items-start justify-between gap-3">
              <strong class="truncate text-sm text-gray-900" :title="sheet.sheetName">{{ sheet.sheetName }}</strong>
              <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="sheet.status === 'parsed' ? 'bg-emerald-100 text-emerald-700' : sheet.status === 'not_bom' ? 'bg-gray-200 text-gray-600' : 'bg-red-100 text-red-700'">{{ sheetStatusLabel(sheet.status) }}</span>
            </span>
            <span class="mt-3 block text-2xl font-bold tabular-nums text-gray-950">{{ sheet.componentCount.toLocaleString('ko-KR') }}<small class="ml-1 text-xs font-medium text-gray-500">개 부품</small></span>
            <span v-if="sheet.failureReason" class="mt-2 block text-xs text-gray-500">{{ sheetFailureLabel(sheet.failureReason) }}</span>
            <span v-else-if="sheet.warnings.length > 0" class="mt-2 block text-xs text-amber-700">{{ sheet.warnings.join(' · ') }}</span>
          </span>
        </label>
      </div>

      <p v-if="buildError !== ''" class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{{ buildError }}</p>
      <div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-5">
        <p class="text-sm text-gray-500"><strong class="text-gray-900">{{ selectedSheetIndexes.length }}개 시트</strong> · 최대 {{ selectedComponentCount.toLocaleString('ko-KR') }}개 부품 선택</p>
        <button
          type="button"
          class="min-w-[210px] rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          :disabled="selectedSheetIndexes.length === 0 || build.isPending.value"
          @click="submitSheetSelection()"
        >
          {{ build.isPending.value ? '선택한 시트를 계산하는 중…' : `선택한 ${String(selectedSheetIndexes.length)}개 시트 계산` }}
        </button>
      </div>
    </section>

    <section v-else-if="isBuilding" class="m-6 rounded-2xl border border-blue-100 bg-blue-50 p-10 text-center shadow-sm">
      <span class="mx-auto block size-3 animate-pulse rounded-full bg-blue-500" />
      <p class="mt-4 text-lg font-semibold text-gray-900">선택한 시트를 계산하고 있습니다…</p>
      <p class="mt-2 text-sm text-gray-500">부품 카탈로그 매칭과 주문수량 계산이 끝나면 결과가 표시됩니다.</p>
    </section>

    <section v-else-if="isBuildFailed && detail" class="m-6 rounded-2xl border border-red-100 bg-white p-8 shadow-sm">
      <h1 class="text-lg font-bold text-red-700">계산할 수 있는 BOM 시트를 찾지 못했습니다</h1>
      <p class="mt-2 text-sm text-gray-500">시트별 분석 결과를 확인한 후, 헤더에 품번과 수량이 포함된 파일을 다시 업로드해 주세요.</p>
      <ul class="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-200">
        <li v-for="sheet in detail.sheets" :key="sheet.sheetIndex" class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
          <span class="truncate font-semibold text-gray-800">{{ sheet.sheetName }}</span>
          <span class="text-right text-xs text-gray-500">{{ sheetStatusLabel(sheet.status) }}<span v-if="sheet.failureReason"> · {{ sheetFailureLabel(sheet.failureReason) }}</span></span>
        </li>
      </ul>
      <button type="button" class="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700" @click="router.push({ name: 'bom' })">새 BOM 업로드</button>
    </section>

    <!-- 워크벤치 — 시안(87:12875): 좌 매칭 결과 테이블(내부 스크롤) + 우 정보 패널(고정) -->
    <div v-else-if="detail && detail.buildStatus === 'ready'" class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5 xl:flex-row xl:overflow-visible">
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
              <span v-if="refreshedNotice" class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">가격·재고 확인 완료 — 최신 결과로 갱신되었습니다</span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-1.5 pl-6 text-[13px] text-[#5f6777]">
              <span>{{ stats.total }}개 부품</span>
              <span v-for="sheet in detail.sheets.filter((item) => item.selected)" :key="sheet.sheetIndex" class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{{ sheet.sheetName }}</span>
            </div>
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
              class="flex h-[38px] items-center gap-1 rounded-lg bg-[#1e64fd] px-4 text-[14px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:hover:bg-blue-300"
              :disabled="editingLocked"
              :title="editingLocked ? EDIT_LOCK_TITLE : '부품 추가'"
              @click="openPartModal('add', null, '')"
            >
              <span class="text-[16px] leading-none">+</span> 추가
            </button>
          </div>
        </div>

        <!-- 자동 보강 진행 배너 — 완료되면 서버가 재매칭한 결과가 폴링으로 자동 반영된다 -->
        <div v-if="enriching" class="mt-3 rounded-lg bg-blue-50 px-4 py-2.5 ring-1 ring-blue-100">
          <div class="flex items-center justify-between gap-3 text-[13px] text-blue-700">
            <span class="flex items-center gap-2">
              <span class="size-2 animate-pulse rounded-full bg-blue-500" />
              <span>
                <span class="block">{{ applying ? '검색 완료 — 결과를 반영하고 있습니다…' : '공급사에서 가격·재고를 확인하고 있습니다 — 완료되면 자동으로 반영됩니다' }}</span>
                <span class="mt-0.5 block text-[11px] text-blue-600/80">확인 중에는 BOM 편집이 잠시 제한됩니다.</span>
              </span>
            </span>
            <span class="font-semibold tabular-nums">{{ enrichProgress }}%</span>
          </div>
          <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-blue-100">
            <div class="h-full rounded-full bg-blue-500 transition-all duration-700" :style="{ width: `${String(enrichProgress)}%` }" />
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
          <table class="min-w-[1100px] w-full" :aria-busy="editingLocked">
            <thead class="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e5e8ed]">
              <tr class="text-left text-[11px] uppercase tracking-wide text-[#8e97a5]">
                <th class="w-[36px] px-2 py-2.5" />
                <th class="w-[110px] px-2 py-2.5">Excel 위치</th>
                <th class="min-w-[220px] px-2 py-2.5">MPN / 원본 값</th>
                <th class="px-2 py-2.5">Manufacturer</th>
                <th class="px-2 py-2.5">Description</th>
                <th class="w-[130px] px-2 py-2.5 text-right">Unit Price</th>
                <th class="w-[170px] px-2 py-2.5">Quantity / Stock</th>
                <th class="w-[130px] px-2 py-2.5 text-right">Total Price</th>
                <th class="w-[76px] px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in items" :key="item.rowIdx" class="border-b border-[#e5e8ed] align-top transition-colors" :class="rowClass(item)">
                <!-- 핸들(디자인만) + 포함 체크 -->
                <td class="px-2 py-3">
                  <div class="flex flex-col items-center gap-2 pt-1">
                    <input
                      :checked="item.included"
                      type="checkbox"
                      class="h-4 w-4 rounded border-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
                      :disabled="!isDraft || editingLocked"
                      :title="editingLocked ? EDIT_LOCK_TITLE : '합계·견적요청 포함'"
                      @change="toggleInclude(item)"
                    >
                    <span class="cursor-default text-[13px] leading-none text-gray-300" title="정렬 (준비 중)">⋮⋮</span>
                  </div>
                </td>
                <!-- 원본 Excel 위치 — 표시 순서와 함께 감사 가능한 기준 -->
                <td class="px-2 py-3 pt-[38px]">
                  <p class="max-w-[100px] truncate text-[11px] font-semibold text-blue-600" :title="item.sourceSheetName ?? '수동 추가'">
                    {{ item.sourceSheetName ?? '수동 추가' }}
                  </p>
                  <p class="mt-0.5 text-[12px] font-bold tabular-nums text-[#3b4252]">{{ sourceRowLabel(item) }}</p>
                </td>
                <!-- MPN: 공급사 배지 + 이미지 자리 + 품번 + 데이터시트 -->
                <td class="px-2 py-3">
                  <div class="flex gap-2.5">
                    <!-- 고정폭 76px(최장 공급사명 UniKeyIC 기준) — 배지 유무와 무관하게 열 폭 일관 -->
                    <div class="w-[76px] shrink-0">
                      <div
                        v-if="item.selectedOffer !== null"
                        class="mb-1 flex h-[20px] w-full items-center justify-center gap-1 rounded-[3px] border border-gray-200 bg-white px-1 shadow-sm"
                        :title="item.selectedOffer.supplierSku"
                      >
                        <img :src="SUPPLIER_META[item.selectedOffer.supplier]?.icon ?? favSamplepcb" alt="" class="size-[12px] rounded-[2px]">
                        <span class="truncate text-[10px] font-semibold text-[#3b4252]">{{ SUPPLIER_META[item.selectedOffer.supplier]?.name ?? item.selectedOffer.supplier }}</span>
                      </div>
                      <!-- 부품 이미지 — 데이터 없음(디자인만 플레이스홀더). 실사진이 정사각이라 1:1 유지 -->
                      <div class="grid size-[76px] place-items-center rounded-md border border-gray-200 bg-gray-50 text-[10px] text-gray-300">IMG</div>
                    </div>
                    <div class="min-w-0 pt-[22px]">
                      <p class="truncate text-[14px] font-medium leading-[20px] text-[#061023]" :title="partLabel(item)">{{ partLabel(item) }}</p>
                      <p v-if="item.mpn.trim() === ''" class="truncate text-[10px] font-medium text-amber-600">MPN 미기재 · 원본 값</p>
                      <p class="cursor-default text-[12px] leading-[16px] text-[#9db9dd]" title="데이터시트 (준비 중)">데이터시트</p>
                    </div>
                  </div>
                </td>
                <td class="px-2 py-3 pt-[42px] text-[12px] leading-[16px] text-[#5f6777]">{{ item.manufacturerName ?? '—' }}</td>
                <td class="max-w-[220px] px-2 py-3 pt-[42px]">
                  <p class="truncate text-[12px] leading-[16px] text-[#8e97a5]" :title="item.description ?? ''">{{ item.description ?? '—' }}</p>
                </td>
                <!-- 적용 가격 — 전체 가격구간·후보 비교는 통합 드로어에서 제공 -->
                <td class="px-2 py-3">
                  <template v-if="item.selectedOffer !== null">
                    <p class="pt-4 text-right text-[15px] font-bold tabular-nums text-[#1e64fd]">{{ fmtBreakPrice(item.selectedOffer.unitPrice, item.selectedOffer.currency) }}</p>
                    <p class="mt-1 text-right text-[11px] text-gray-500">{{ item.selectedOffer.breakQty.toLocaleString('ko-KR') }}+ 적용 · MOQ {{ item.selectedOffer.moq?.toLocaleString('ko-KR') ?? '—' }}</p>
                    <p class="mt-1 text-right text-[10px] text-gray-400" title="이 가격·재고를 공급사에서 가져온 시각">기준 {{ fmtAge(item.selectedOffer.fetchedAt) }}</p>
                  </template>
                  <p v-else class="pt-[24px] text-right text-[12px] text-gray-300">—</p>
                </td>
                <!-- QUANTITY / STOCK: 패키지(→오퍼 모달) + 수량 -->
                <td class="px-2 py-3">
                  <button
                    type="button"
                    class="flex h-[38px] w-[160px] items-center justify-between rounded-[6px] border border-[#d3d5dc] bg-[#f4f4f4] px-3 text-[13px] font-bold text-[#4c4c4c] disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="!isDraft || editingLocked"
                    :title="editingLocked ? EDIT_LOCK_TITLE : (item.selectedOffer?.packaging ?? '오퍼 선택')"
                    @click="openCandidateDrawer(item)"
                  >
                    <span class="truncate">{{ item.selectedOffer?.packaging ?? (item.selectedOffer !== null ? item.selectedOffer.supplier : '오퍼 없음') }}</span>
                    <span class="text-[10px] text-gray-400">▾</span>
                  </button>
                  <div class="mt-[8px] flex h-[38px] w-[160px] items-center justify-between rounded-[6px] border border-[#d6dae7] bg-[#fafcff] pl-1 pr-3">
                    <input
                      v-model.number="item.orderQty"
                      type="number"
                      min="1"
                      class="w-[70px] bg-transparent px-2 text-right text-[15px] font-bold tabular-nums focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="!isDraft || editingLocked || item.selectedOffer === null"
                      :title="editingLocked ? EDIT_LOCK_TITLE : undefined"
                      @change="onQtyChange(item)"
                    >
                    <span class="text-[11px] text-[#8e97a5]">/ {{ item.selectedOffer?.stock?.toLocaleString('ko-KR') ?? '—' }}</span>
                  </div>
                </td>
                <!-- TOTAL: 기존 매칭 배지(Found 대체) + 합계 -->
                <td class="px-2 py-3 text-right">
                  <div class="flex flex-col items-end gap-1.5 pt-1">
                    <!-- 보강 진행 중엔 "확인 중"(파랑) — 빨간 미매칭은 보강이 끝난 뒤의 최종 판정 -->
                    <span v-if="item.matchStatus === 'none' && enriching" class="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-[12px] font-medium text-blue-600">
                      <span class="size-1.5 animate-pulse rounded-full bg-blue-500" />확인 중
                    </span>
                    <span v-else-if="item.matchStatus === 'none' && item.matchEvidence?.selectionMode === 'review'" class="rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-medium text-amber-700" :title="engineEvidenceTitle(item)">검토 필요</span>
                    <span v-else-if="item.matchStatus === 'none'" class="rounded-full bg-red-100 px-2.5 py-0.5 text-[12px] font-medium text-red-600" :title="engineEvidenceTitle(item)">미매칭</span>
                    <span v-else-if="isStockShort(item)" class="rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-medium text-amber-700">재고 부족</span>
                    <span v-else-if="item.selectedOffer !== null" class="rounded-full bg-[#01bd46]/15 px-2.5 py-0.5 text-[12px] font-medium text-[#38b614]" :title="engineEvidenceTitle(item)">매칭</span>
                    <span v-else class="rounded-full bg-sky-100 px-2.5 py-0.5 text-[12px] font-medium text-sky-700" :title="engineEvidenceTitle(item)">가격 확인 필요</span>
                    <span v-if="item.matchStatus !== 'none'" class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{{ selectionSourceLabel(item) }}</span>
                    <span v-if="item.matchEvidence?.recommendationType === 'purchase-fit'" class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" :title="engineEvidenceTitle(item)">일부 확인 필요</span>
                    <span v-if="item.selectedOffer?.pinned" class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700" title="직접 선택한 오퍼 — 수량이 바뀌어도 유지">고정</span>
                    <p v-if="item.matchStatus !== 'none'" class="max-w-[190px] text-right text-[10px] leading-4 text-slate-500" :title="selectionReasonSummary(item)">{{ selectionReasonSummary(item) }}</p>
                    <span v-if="(item.matchEvidence?.alternativeCandidateCount ?? 0) > 0" class="text-[10px] font-semibold text-blue-600">대체 후보 {{ item.matchEvidence?.alternativeCandidateCount }}개</span>
                    <span class="text-[14px] font-bold tabular-nums" :class="item.lineTotalKrw === null ? 'text-gray-300' : 'text-[#38b614]'">
                      {{ item.lineTotalKrw === null ? '—' : fmtWon(Math.round(item.lineTotalKrw)) }}
                    </span>
                    <span v-if="item.selectedOffer !== null && item.selectedOffer.currency !== 'KRW'" class="text-[10px] text-gray-400">
                      {{ item.selectedOffer.unitPriceKrw === null ? '환산 불가' : `단가 ≈₩${item.selectedOffer.unitPriceKrw.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}` }}
                    </span>
                  </div>
                </td>
                <!-- 후보 비교가 변경+상세+오퍼 선택을 통합. 삭제는 실제 삭제가 아니라 견적 제외. -->
                <td class="px-2 py-3">
                  <div v-if="isDraft" class="flex flex-col gap-[6px] pt-1">
                    <button type="button" class="h-[30px] w-[88px] rounded-[5px] border border-blue-300 bg-blue-50 text-[12px] font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40" :disabled="editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : '선정 이유·가격·차순위 후보 비교'" @click="openCandidateDrawer(item)">후보 비교</button>
                    <button type="button" class="h-[26px] w-[88px] rounded-[4px] border border-[#d3d5dc] bg-[#f4f4f4] text-[12px] font-medium text-[#4c4c4c] hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#f4f4f4]" :disabled="editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : (item.included ? '합계·견적요청에서 제외' : '합계·견적요청에 복원')" @click="toggleInclude(item)">{{ item.included ? '제외' : '복원' }}</button>
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
            <div v-if="!enriching && stats.review > 0" class="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2.5">
              <span class="text-[11px] font-bold uppercase tracking-wide text-amber-700">검토 필요</span>
              <span class="text-[18px] font-bold tabular-nums text-amber-600">{{ stats.review }}</span>
            </div>
            <!-- 보강 진행 중엔 "확인 중"(파랑) — 최종 미매칭 판정과 구분 -->
            <div class="flex items-center justify-between rounded-lg px-3 py-2.5" :class="enriching ? 'bg-blue-50' : 'bg-red-50'">
              <span class="text-[11px] font-bold uppercase tracking-wide" :class="enriching ? 'text-blue-700' : 'text-red-700'">{{ enriching ? '확인 중' : 'Unmatched' }}</span>
              <span class="text-[18px] font-bold tabular-nums" :class="enriching ? 'text-blue-600' : 'text-red-600'">{{ enriching ? stats.unresolved : stats.unmatched }}</span>
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
                  <button type="button" class="w-[26px] text-gray-400 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" @click="stepSet(-1)">−</button>
                  <input v-model.number="setQty" type="number" min="1" class="w-full min-w-0 border-x border-gray-200 text-center text-[14px] font-semibold tabular-nums focus:outline-none disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-50" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" @change="restampAll">
                  <button type="button" class="w-[26px] text-gray-400 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" @click="stepSet(1)">+</button>
                </div>
                <span class="text-[11px] text-gray-400">Set</span>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[13px] text-[#5f6777]">예비 수량</span>
              <div class="flex items-center gap-1">
                <div class="flex h-[32px] w-[92px] items-center rounded-md border border-gray-300 bg-white">
                  <button type="button" class="w-[26px] text-gray-400 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" @click="stepSpare(-1)">−</button>
                  <input v-model.number="spareQty" type="number" min="0" class="w-full min-w-0 border-x border-gray-200 text-center text-[14px] font-semibold tabular-nums focus:outline-none disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-50" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" @change="restampAll">
                  <button type="button" class="w-[26px] text-gray-400 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" @click="stepSpare(1)">+</button>
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
            <p v-if="uncostedCount > 0" class="rounded px-2 py-1.5 text-[11px]" :class="enriching ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'">
              <template v-if="enriching">가격 확인 중인 라인 {{ uncostedCount }}건 — 완료되면 합계에 반영됩니다</template>
              <template v-else>금액 미산정 라인 {{ uncostedCount }}건 — 미매칭이거나 환산 불가한 통화입니다</template>
            </p>
            <p class="pt-1 text-[11px] leading-[16px] text-gray-400">· AI로 산출한 가견적입니다.<br>· 정확한 가격은 담당자 확정 시 안내드립니다.</p>
          </div>
        </div>

        <!-- CTA -->
        <div class="space-y-2">
          <button
            v-if="isDraft"
            type="button"
            class="flex h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-[#1e64fd] text-[15px] font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="request.isPending.value || stats.included === 0 || editingLocked"
            :title="editingLocked ? '가격·재고 확인이 끝나면 요청할 수 있습니다' : undefined"
            @click="openRequestModal"
          >
            {{ editingLocked ? '가격 확인 중…' : '📄 견적요청' }}
          </button>
          <!-- draft=하드 삭제(2단계 확인) · requested=요청 취소(관리자 워크플로 존중) -->
          <template v-if="detail.status === 'draft'">
            <button
              v-if="!deleteArm"
              type="button"
              class="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
              :disabled="del.isPending.value"
              @click="armDelete"
            >
              {{ del.isPending.value ? '삭제 중…' : '견적 삭제' }}
            </button>
            <button
              v-else
              type="button"
              class="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
              @click="onDelete"
            >
              정말 삭제 — 되돌릴 수 없습니다
            </button>
          </template>
          <button
            v-else-if="detail.status === 'requested'"
            type="button"
            class="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
            @click="onCancel"
          >
            요청 취소
          </button>
        </div>
      </aside>
    </div>

    <!-- 견적명 모달 -->
    <div v-if="requestModal && !editingLocked" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="requestModal = false">
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

    <BomCandidateDrawer
      :open="candidateOpen"
      :context="candidateQuery.data.value?.data ?? null"
      :loading="candidateQuery.isLoading.value"
      :failed="candidateQuery.isError.value"
      :selecting="candidateSelection.isPending.value"
      :selection-error="candidateSelectionError"
      :has-catalog-part="candidateItem?.partId !== null && candidateItem?.selectedCandidateKey === null"
      @select="selectCandidate"
      @catalog-search="openCatalogSearchFromDrawer"
      @catalog-offers="openCatalogOffersFromDrawer"
      @close="closeCandidateDrawer"
    />
    <BomOfferModal
      v-if="offerModal !== null && detail !== null && !editingLocked"
      :part-id="offerModal.partId"
      :needed="neededQty(items[offerModal.lineIdx]?.bomQty ?? 1, setQty, spareQty)"
      :usd-krw-rate="rate"
      @select="onOfferSelected"
      @close="offerModal = null"
    />
    <BomPartSearchModal
      v-if="partModal !== null && !editingLocked"
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
