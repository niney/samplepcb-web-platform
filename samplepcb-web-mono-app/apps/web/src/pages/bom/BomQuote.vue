<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQueryClient } from '@tanstack/vue-query';
import { ApiRequestError } from '@sp/shared';
import {
  type BomQuoteDetailResponseType,
  type BomQuoteDetailType,
  type BomQuoteItemType,
  type BomQuoteSelectedOfferType,
  type PartHitType,
} from '@sp/api-contract';
import {
  neededQty,
  pickBreak,
  stampOrderQty,
  toKrw,
  type OfferPick,
} from '@sp/utils';
import {
  useBomJob,
  useBomQuote,
  useBomQuoteComparison,
  useBomQuoteCandidates,
  useBuildBomQuote,
  useCancelBomQuote,
  useDeleteBomQuote,
  usePatchBomQuote,
  usePrepareBomPartData,
  usePrepareBomQuoteSheets,
  useRequestBomQuote,
  useSelectBomQuoteCandidate,
  useSupplierSearchStatus,
  useUpdateBomQuoteSheets,
} from '../../bom/useBom';
import { useBomPanels } from '../../bom/usePanels';
import BomCandidateDrawer from '../../components/bom/BomCandidateDrawer.vue';
import BomCompareModal from '../../components/bom/BomCompareModal.vue';
import BomOfferModal from '../../components/bom/BomOfferModal.vue';
import BomPartSearchModal from '../../components/bom/BomPartSearchModal.vue';
import BomQuoteOfferModal from '../../components/bom/BomQuoteOfferModal.vue';
import BomQuoteRow from '../../components/bom/BomQuoteRow.vue';
import icFile from '../../assets/bom/ic-file.svg';
import icPanelAi from '../../assets/bom/ic-panel-ai.svg';
import icPanelNostock from '../../assets/bom/ic-panel-nostock.svg';
import icPanelOrder from '../../assets/bom/ic-panel-order.svg';
import icPanelQuote from '../../assets/bom/ic-panel-quote.svg';

// 고객 스마트 BOM 견적 워크벤치 — Figma "02 BOM 파일 분석_검색 결과"(87:12875) 레이아웃에
// 기존 기능(자동저장·오퍼/부품 모달·자동 보강·견적요청)을 병합. 사용자 지시:
// 채팅·가격순 정렬 제외, Found 대신 기존 매칭 배지, 공급사 배지는 파비콘(vueline 방식),
// 미구현 요소(핸들·이미지·데이터시트·선택 삭제)는 디자인만.

const route = useRoute();
const router = useRouter();
const qc = useQueryClient();
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
const updateSheets = useUpdateBomQuoteSheets();
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
  lastServerItems = new Map();
});

// ── 로컬 편집 상태(draft) — 서버 응답이 올 때마다 동기화 ─────────────────────
const items = ref<BomQuoteItemType[]>([]);
const setQty = ref(1);
const spareQty = ref(0);
const dirty = ref(false);

// 서버 항목 참조 추적 — vue-query structural sharing 은 내용이 안 바뀐 항목을
// 폴링 응답에서도 같은 참조로 유지한다. 그 항목은 로컬 클론을 재사용해
// 행 컴포넌트(BomQuoteRow)의 props 가 그대로 유지되게 하고 재렌더를 건너뛴다.
let lastServerItems = new Map<string, BomQuoteItemType>();

function applyServerDetail(d: BomQuoteDetailType): void {
  const prevLocal = new Map(items.value.map((i) => [i.id, i]));
  const nextServer = new Map<string, BomQuoteItemType>();
  items.value = d.items.map((si) => {
    nextServer.set(si.id, si);
    const cur = prevLocal.get(si.id);
    if (cur !== undefined && lastServerItems.get(si.id) === si) return cur;
    return { ...si, selectedOffer: si.selectedOffer === null ? null : { ...si.selectedOffer } };
  });
  lastServerItems = nextServer;
  setQty.value = d.setQty;
  spareQty.value = d.spareQty;
}

watch(
  detail,
  (d) => {
    if (d === null) return;
    if (dirty.value) return; // 편집 중(자동저장 대기) — 폴링 응답이 로컬 편집을 덮지 않게
    applyServerDetail(d);
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

function onRowQtyChange(item: BomQuoteItemType, qty: number): void {
  if (editingLocked.value) return;
  item.orderQty = qty;
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
  const id = quoteId.value;
  saveState.value = 'saving';
  try {
    const saved = await patch.mutateAsync({
      quoteId: id,
      body: {
        setQty: setQty.value,
        spareQty: spareQty.value,
        items: items.value.map((item) => ({
          id: /^\d+$/.test(item.id) ? item.id : null,
          included: item.included,
          orderQty: item.orderQty,
          ...(item.selectionSource === 'catalog' && item.partId !== null
            ? {
                catalogSelection: {
                  mpn: item.mpn,
                  manufacturerName: item.manufacturerName,
                  description: item.description,
                  partId: item.partId,
                  selectedOffer: item.selectedOffer,
                },
              }
            : {}),
        })),
      },
    });
    dirty.value = false;
    saveState.value = 'saved';
    // 저장 응답(raw)은 전 항목이 새 참조라, 이 응답을 그대로 적용하면 행 단위 재렌더
    // 격리(BomQuoteRow props 참조 유지)가 깨진다. onSuccess 가 이미 setQueryData(structural
    // sharing)로 갱신한 상세 캐시에서 다시 읽어, 안 바뀐 항목의 참조 안정을 유지한다.
    // observer(quote.data) 반영은 notifyManager 배치라 resolve 시점에 보장되지 않으므로
    // getQueryData 로 직접 조회한다. 저장 중 다른 견적으로 이동했다면 이전 응답으로 새
    // 화면의 items 를 덮지 않도록 건너뛴다.
    if (quoteId.value !== id) return;
    const cached = qc.getQueryData<BomQuoteDetailResponseType>(['bom', 'quote', id]);
    applyServerDetail(cached?.data ?? saved.data);
  } catch {
    saveState.value = 'error';
  }
}

// ── 결과 시트 탭·통계·합계(로컬 표시 — 저장 시 서버가 재계산해 동기화) ───────
function hasEngineStockConstraint(item: BomQuoteItemType): boolean {
  const reason = item.matchEvidence?.procurementUnavailabilityReason;
  return reason === 'out_of_stock'
    || reason === 'insufficient_stock'
    || reason === 'stock_unverified';
}

function isStockShort(item: BomQuoteItemType): boolean {
  const reason = item.matchEvidence?.procurementUnavailabilityReason;
  if (reason === 'out_of_stock' || reason === 'insufficient_stock') return true;
  const o = item.selectedOffer;
  return o !== null && o.stock !== null && o.stock < item.orderQty;
}

type ResultSheetFilter = 'all' | 'manual' | number;

interface ResultSheetTab {
  key: ResultSheetFilter;
  label: string;
  count: number;
}

const activeResultSheet = ref<ResultSheetFilter>('all');
const selectedResultSheets = computed(() => detail.value?.sheets.filter((sheet) => sheet.selected) ?? []);
const manageableResultSheets = computed(() => detail.value?.sheets.filter((sheet) => sheet.hasItems) ?? []);
const sheetManagerOpen = ref(false);
const managedSheetIndexes = ref<number[]>([]);
const sheetSelectionError = ref('');
const managedComponentCount = computed(() => {
  const selected = new Set(managedSheetIndexes.value);
  return manageableResultSheets.value
    .filter((sheet) => selected.has(sheet.sheetIndex))
    .reduce((sum, sheet) => sum + sheet.componentCount, 0);
});
const removedComponentCount = computed(() => {
  const selected = new Set(managedSheetIndexes.value);
  return manageableResultSheets.value
    .filter((sheet) => sheet.selected && !selected.has(sheet.sheetIndex))
    .reduce((sum, sheet) => sum + sheet.componentCount, 0);
});
const removedSheetCount = computed(() => {
  const selected = new Set(managedSheetIndexes.value);
  return manageableResultSheets.value.filter((sheet) => sheet.selected && !selected.has(sheet.sheetIndex)).length;
});
const restoredSheetCount = computed(() => {
  const selected = new Set(managedSheetIndexes.value);
  return manageableResultSheets.value.filter((sheet) => !sheet.selected && selected.has(sheet.sheetIndex)).length;
});

function openSheetManager(): void {
  if (!isDraft.value || editingLocked.value || manageableResultSheets.value.length < 2) return;
  managedSheetIndexes.value = manageableResultSheets.value
    .filter((sheet) => sheet.selected)
    .map((sheet) => sheet.sheetIndex);
  sheetSelectionError.value = '';
  sheetManagerOpen.value = true;
}

function toggleManagedSheet(sheetIndex: number): void {
  if (updateSheets.isPending.value) return;
  managedSheetIndexes.value = managedSheetIndexes.value.includes(sheetIndex)
    ? managedSheetIndexes.value.filter((index) => index !== sheetIndex)
    : [...managedSheetIndexes.value, sheetIndex];
  sheetSelectionError.value = '';
}

function closeSheetManager(): void {
  if (!updateSheets.isPending.value) sheetManagerOpen.value = false;
}

async function applyManagedSheets(): Promise<void> {
  if (managedSheetIndexes.value.length === 0 || updateSheets.isPending.value) return;
  if (patch.isPending.value) {
    sheetSelectionError.value = '자동 저장이 끝난 후 다시 시도해 주세요.';
    return;
  }
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (dirty.value) await saveNow();
  if (dirty.value) {
    sheetSelectionError.value = '변경사항을 저장하지 못해 시트 구성을 바꾸지 않았습니다.';
    return;
  }
  const id = quoteId.value;
  try {
    const saved = await updateSheets.mutateAsync({
      quoteId: id,
      body: { sheetIndexes: [...managedSheetIndexes.value].sort((a, b) => a - b) },
    });
    // 저장 중 다른 견적으로 이동했다면 이 응답·뷰 리셋으로 새 화면을 건드리지 않는다.
    if (quoteId.value !== id) return;
    // saveNow 와 같은 이유 — 캐시(structural sharing)에서 읽어 참조 안정을 유지한다.
    const cached = qc.getQueryData<BomQuoteDetailResponseType>(['bom', 'quote', id]);
    applyServerDetail(cached?.data ?? saved.data);
    activeResultSheet.value = 'all';
    clearResultFilters();
    sheetManagerOpen.value = false;
  } catch (reason) {
    const code = reason instanceof ApiRequestError ? reason.payload?.error : undefined;
    sheetSelectionError.value = code === 'INVALID_SHEET_SELECTION'
      ? '현재 견적에서 제외하거나 복원할 수 없는 시트가 포함되어 있습니다.'
      : '시트 구성을 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
}
const resultSheetCounts = computed(() => {
  const byIndex = new Map<number, number>();
  let manual = 0;
  for (const item of items.value) {
    if (item.sourceSheetIndex === null) manual += 1;
    else byIndex.set(item.sourceSheetIndex, (byIndex.get(item.sourceSheetIndex) ?? 0) + 1);
  }
  return { byIndex, manual };
});
const resultSheetTabs = computed<ResultSheetTab[]>(() => {
  const tabs: ResultSheetTab[] = [{ key: 'all', label: '전체', count: items.value.length }];
  for (const sheet of selectedResultSheets.value) {
    tabs.push({
      key: sheet.sheetIndex,
      label: sheet.sheetName,
      count: resultSheetCounts.value.byIndex.get(sheet.sheetIndex) ?? 0,
    });
  }
  if (resultSheetCounts.value.manual > 0) {
    tabs.push({ key: 'manual', label: '직접 추가', count: resultSheetCounts.value.manual });
  }
  return tabs;
});
const showResultSheetTabs = computed(() => resultSheetTabs.value.length > 2);
const activeResultSheetLabel = computed(() => (
  resultSheetTabs.value.find((tab) => tab.key === activeResultSheet.value)?.label ?? '전체'
));
const sheetItems = computed(() => {
  if (activeResultSheet.value === 'all') return items.value;
  if (activeResultSheet.value === 'manual') return items.value.filter((item) => item.sourceSheetIndex === null);
  return items.value.filter((item) => item.sourceSheetIndex === activeResultSheet.value);
});

watch(
  resultSheetTabs,
  (tabs) => {
    if (!tabs.some((tab) => tab.key === activeResultSheet.value)) activeResultSheet.value = 'all';
  },
  { immediate: true },
);
watch(quoteId, () => {
  activeResultSheet.value = 'all';
  sheetManagerOpen.value = false;
  managedSheetIndexes.value = [];
  sheetSelectionError.value = '';
});

// 통계·합계를 한 번의 순회로 — 행 속성 하나가 바뀔 때마다 같은 범위를 여러 번 훑지 않게
function calculateStats(sourceItems: readonly BomQuoteItemType[]) {
  let total = 0;
  let matched = 0;
  let review = 0;
  let unmatched = 0;
  let nostock = 0;
  let included = 0;
  let uncosted = 0;
  let pendingReview = 0;
  let lineSum = 0;
  for (const i of sourceItems) {
    total += 1;
    if (i.matchStatus !== 'none') matched += 1;
    else if (!hasEngineStockConstraint(i) && i.matchEvidence?.selectionMode === 'review') review += 1;
    else unmatched += 1;
    if (i.included) {
      included += 1;
      if (
        i.selectionSource === 'auto'
        && i.matchEvidence?.selectionApplicationState === 'provisional_selected'
        && i.matchEvidence.confirmationRequired
      ) pendingReview += 1;
      if (isStockShort(i)) nostock += 1;
      if (i.lineTotalKrw === null) uncosted += 1;
      else lineSum += i.lineTotalKrw;
    }
  }
  return {
    total,
    matched,
    matchedPct: total === 0 ? 0 : Math.round((matched / total) * 100),
    nostock,
    nostockPct: total === 0 ? 0 : Math.round((nostock / total) * 100),
    review,
    unmatched,
    unresolved: total - matched,
    included,
    uncosted,
    pendingReview,
    itemsTotal: Math.round(lineSum),
  };
}

// 분석 카드는 현재 탭 기준, 금액·견적요청 가능 여부는 전체 견적 기준이다.
const stats = computed(() => calculateStats(sheetItems.value));
const quoteStats = computed(() => calculateStats(items.value));

const itemsTotal = computed(() => quoteStats.value.itemsTotal);
const uncostedCount = computed(() => quoteStats.value.uncosted);
const finalTotal = computed(() => itemsTotal.value + (detail.value?.shippingFee ?? 0) + (detail.value?.managementFee ?? 0));

// ── 조용한 자동 보강 상태 — 서버 영속 enrichStatus 가 단일 진실 ─────────────────
// searching 이면 "확인 중" UI + 3초 폴링. done 은 매칭 라인과 원자적으로 도착하고,
// 재시작·잡 유실은 서버의 게으른 치유(조회 시 수렴)가 처리한다.
const compareOpen = ref(false);
const enriching = computed(() => detail.value?.enrichStatus === 'searching');
const partDataPreparing = computed(() => detail.value?.partDataStatus === 'preparing');
// 중간 공급사 결과로 계산된 금액은 최종 합계처럼 오인될 수 있으므로 완료 전에는 숨긴다.
const pricingPending = computed(() => detail.value?.buildStatus !== 'ready' || enriching.value);
// 검색 결과 적용과 사용자의 같은 행 수정이 경합하지 않도록, 결과 반영이 끝날 때까지
// 모든 BOM 변경 동작을 잠그고 읽기 기능만 유지한다.
const editingLocked = computed(() => enriching.value || updateSheets.isPending.value);
const EDIT_LOCK_TITLE = computed(() => updateSheets.isPending.value
  ? '시트 구성을 반영하는 중입니다'
  : '공급사 확인이 완료되면 수정할 수 있습니다');

// ── 매칭 결과 필터 ──────────────────────────────────────────────────────────
// 매칭 상태는 서로 배타적이다. 엔진이 대표 사유를 재고로 판정한 미선정 행은
// Review 대신 Unmatched에 두고, 재고 부족은 매칭 상태와 독립적으로 함께 집계한다.
type ResultMatchFilter = 'all' | 'matched' | 'review' | 'unmatched';
type SpecificResultMatchFilter = Exclude<ResultMatchFilter, 'all'>;

const resultMatchFilter = ref<ResultMatchFilter>('all');
const resultNostockOnly = ref(false);
const resultsScrollEl = ref<HTMLElement | null>(null);

const RESULT_MATCH_FILTER_LABEL: Record<SpecificResultMatchFilter, string> = {
  matched: 'Matched',
  review: 'Review',
  unmatched: 'Unmatched',
};

function itemMatchGroup(item: BomQuoteItemType): SpecificResultMatchFilter {
  if (item.matchStatus !== 'none') return 'matched';
  if (!hasEngineStockConstraint(item) && item.matchEvidence?.selectionMode === 'review') return 'review';
  return 'unmatched';
}

const filteredItems = computed(() => sheetItems.value.filter((item) => {
  if (resultMatchFilter.value !== 'all' && itemMatchGroup(item) !== resultMatchFilter.value) return false;
  // Nostock 집계는 견적 합계에 포함된 행만 세므로 필터도 같은 규칙을 따른다.
  if (resultNostockOnly.value && (!item.included || !isStockShort(item))) return false;
  return true;
}));

const resultFiltersActive = computed(() => resultMatchFilter.value !== 'all' || resultNostockOnly.value);
const activeMatchFilterLabel = computed(() => (
  resultMatchFilter.value === 'all' ? null : RESULT_MATCH_FILTER_LABEL[resultMatchFilter.value]
));

function scrollResultsToTop(): void {
  void nextTick(() => {
    if (resultsScrollEl.value !== null) resultsScrollEl.value.scrollTop = 0;
  });
}

function selectResultSheet(key: ResultSheetFilter): void {
  activeResultSheet.value = key;
  scrollResultsToTop();
}

function clearResultFilters(): void {
  resultMatchFilter.value = 'all';
  resultNostockOnly.value = false;
  scrollResultsToTop();
}

function toggleResultMatchFilter(filter: SpecificResultMatchFilter): void {
  resultMatchFilter.value = resultMatchFilter.value === filter ? 'all' : filter;
  scrollResultsToTop();
}

function toggleResultNostockFilter(): void {
  resultNostockOnly.value = !resultNostockOnly.value;
  scrollResultsToTop();
}

watch(quoteId, clearResultFilters);
watch(enriching, (active) => {
  // 확인 중에는 Review/Unmatched 최종 분류가 아직 확정되지 않는다.
  if (active && (resultMatchFilter.value === 'review' || resultMatchFilter.value === 'unmatched')) {
    resultMatchFilter.value = 'all';
    scrollResultsToTop();
  }
});
const supplierStatus = useSupplierSearchStatus(
  computed(() => (quoteId.value === '' ? null : quoteId.value)),
  enriching, // 진행률(%) 표시에만 필요
);
const comparisonPage = ref(1);
const comparisonSearch = ref('');
const comparisonStatus = ref<'all' | 'matched' | 'attention' | 'not_found'>('all');
const comparisonSheet = ref('all');
const quoteComparison = useBomQuoteComparison(
  quoteId,
  compareOpen,
  {
    page: comparisonPage,
    search: comparisonSearch,
    status: comparisonStatus,
    sheet: comparisonSheet,
  },
);

function onComparisonQueryChange(query: {
  page: number;
  search: string;
  status: 'all' | 'matched' | 'attention' | 'not_found';
  sheet: string;
}): void {
  comparisonPage.value = query.page;
  comparisonSearch.value = query.search;
  comparisonStatus.value = query.status;
  comparisonSheet.value = query.sheet;
}
// 검색은 끝났고 서버가 결과를 견적에 반영(인제스트→재매칭)하는 중
const applying = computed(() => enriching.value && supplierStatus.data.value?.data.status === 'completed');
const enrichProgress = computed(() => (applying.value ? 100 : (supplierStatus.data.value?.data.progress ?? 3)));
const refreshedNotice = ref(false);

// 공급사 보강뿐 아니라 동기 build 요청 도중 새로고침·다른 탭으로 진입한 경우도
// 서버 ready 전이를 스스로 따라가도록 견적 상태를 폴링한다.
watch(
  [enriching, isBuilding, partDataPreparing],
  ([isEnriching, isQuoteBuilding, isPartDataPreparing]) => (
    quotePolling.value = isEnriching || isQuoteBuilding || isPartDataPreparing
  ),
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

// ── 후보 비교·선택 드로어 + 카탈로그 폴백 ────────────────────────────────────
type SelectionSurface = 'candidates' | 'offers';
type CandidateDrawerView = 'candidates' | 'search';
interface PendingSelection {
  itemId: string;
  view: CandidateDrawerView;
}
const candidateItemId = ref<string | null>(null);
const selectionSurface = ref<SelectionSurface | null>(null);
const candidateDrawerView = ref<CandidateDrawerView>('candidates');
const pendingSelection = ref<PendingSelection | null>(null);
const preparePartData = usePrepareBomPartData();
type PartDataFailureReason = BomQuoteDetailType['partDataFailureReason'];
const preparePartDataError = ref<PartDataFailureReason>(null);
const partDataFailureReason = computed<PartDataFailureReason>(() =>
  preparePartDataError.value ?? detail.value?.partDataFailureReason ?? null,
);
const partDataFailed = computed(() =>
  detail.value?.partDataStatus === 'failed' || preparePartDataError.value !== null,
);
const candidateOpen = computed(() => candidateItemId.value !== null && selectionSurface.value === 'candidates');
const quoteOfferOpen = computed(() => candidateItemId.value !== null && selectionSurface.value === 'offers');
const selectionOpen = computed(() => candidateItemId.value !== null && selectionSurface.value !== null);
const candidateItem = computed(() =>
  candidateItemId.value === null
    ? null
    : (items.value.find((item) => item.id === candidateItemId.value) ?? null),
);
const candidateQuery = useBomQuoteCandidates(
  computed(() => (quoteId.value === '' ? null : quoteId.value)),
  candidateItemId,
  selectionOpen,
);
const candidateSelection = useSelectBomQuoteCandidate();
const candidateSelectionError = ref('');
const catalogSelectionPending = ref(false);

const offerModal = ref<{ lineIdx: number; partId: string } | null>(null);
const partModal = ref<{ mode: 'swap' | 'add'; lineIdx: number | null; query: string } | null>(null);
const partModalNeeded = computed(() => {
  const target = partModal.value;
  if (target?.lineIdx === undefined || target.lineIdx === null) return neededQty(1, setQty.value, spareQty.value);
  return neededQty(items.value[target.lineIdx]?.bomQty ?? 1, setQty.value, spareQty.value);
});

watch(editingLocked, (locked) => {
  if (!locked) return;
  // 열려 있던 선택 모달에서 검색 도중 변경이 들어가는 경로도 차단한다.
  candidateItemId.value = null;
  selectionSurface.value = null;
  offerModal.value = null;
  partModal.value = null;
});

function openPartModal(mode: 'swap' | 'add', lineIdx: number | null, query: string): void {
  if (editingLocked.value) return;
  partModal.value = { mode, lineIdx, query };
}

function activateCandidateDrawer(itemId: string, view: CandidateDrawerView): void {
  candidateSelectionError.value = '';
  candidateItemId.value = itemId;
  candidateDrawerView.value = view;
  selectionSurface.value = 'candidates';
}

function requestCandidateDrawer(item: BomQuoteItemType, view: CandidateDrawerView): void {
  if (updateSheets.isPending.value) return;
  preparePartDataError.value = null;
  if (detail.value?.partDataStatus === 'ready') {
    activateCandidateDrawer(item.id, view);
    return;
  }
  pendingSelection.value = { itemId: item.id, view };
}

function openCandidateDrawer(item: BomQuoteItemType): void {
  requestCandidateDrawer(item, 'candidates');
}

function openCatalogSearchDrawer(item: BomQuoteItemType): void {
  requestCandidateDrawer(item, 'search');
}

function closePartDataPreparation(): void {
  pendingSelection.value = null;
  preparePartDataError.value = null;
}

function onPartDataPreparationKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || pendingSelection.value === null) return;
  event.preventDefault();
  closePartDataPreparation();
}

onMounted(() => {
  window.addEventListener('keydown', onPartDataPreparationKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onPartDataPreparationKeydown);
});

async function retryPartDataPreparation(): Promise<void> {
  if (quoteId.value === '' || preparePartData.isPending.value) return;
  preparePartDataError.value = null;
  try {
    await preparePartData.mutateAsync(quoteId.value);
  } catch (error) {
    preparePartDataError.value = error instanceof ApiRequestError
      && error.payload?.error === 'PART_DATA_RESULT_GONE'
      ? 'result-gone'
      : 'preparation-failed';
    await quote.refetch();
  }
}

watch(
  [() => detail.value?.partDataStatus, pendingSelection],
  ([status, pending]) => {
    if (status !== 'ready' || pending === null) return;
    if (!items.value.some((item) => item.id === pending.itemId)) {
      closePartDataPreparation();
      return;
    }
    pendingSelection.value = null;
    activateCandidateDrawer(pending.itemId, pending.view);
  },
);

function closeSelectionSurface(): void {
  candidateItemId.value = null;
  selectionSurface.value = null;
  candidateSelectionError.value = '';
}

function openQuoteOfferModal(item: BomQuoteItemType): void {
  if (editingLocked.value) return;
  const lineIdx = items.value.findIndex((entry) => entry.id === item.id);
  if (item.selectedCandidateKey === null && item.partId !== null) {
    if (lineIdx >= 0) openOfferModal(lineIdx);
    return;
  }
  candidateSelectionError.value = '';
  candidateItemId.value = item.id;
  selectionSurface.value = 'offers';
}

function openCandidateDrawerFromOfferModal(): void {
  if (candidateItemId.value === null) return;
  candidateSelectionError.value = '';
  candidateDrawerView.value = 'candidates';
  selectionSurface.value = 'candidates';
}

async function selectCandidate(candidateKey: string, offerKey: string | null): Promise<boolean> {
  if (candidateItemId.value === null || editingLocked.value) return false;
  if (dirty.value) {
    await saveNow();
    if (saveState.value === 'error') {
      candidateSelectionError.value = '저장되지 않은 변경사항이 있습니다. 저장 상태를 확인해 주세요.';
      return false;
    }
  }
  candidateSelectionError.value = '';
  try {
    await candidateSelection.mutateAsync({
      quoteId: quoteId.value,
      itemId: candidateItemId.value,
      body: { candidateKey, offerKey },
    });
    dirty.value = false;
    await Promise.all([quote.refetch(), candidateQuery.refetch()]);
    return true;
  } catch (reason) {
    const code = reason instanceof ApiRequestError ? reason.payload?.error : undefined;
    candidateSelectionError.value = code === 'CANDIDATE_BLOCKED'
      ? '충돌하거나 필수 정보가 부족한 후보는 고객 화면에서 선택할 수 없습니다.'
      : code === 'OFFER_NOT_PRICED'
        ? '가격이 없는 오퍼는 선택할 수 없습니다.'
        : '후보 선택을 적용하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    return false;
  }
}

async function selectQuoteOffer(candidateKey: string, offerKey: string): Promise<void> {
  const selected = await selectCandidate(candidateKey, offerKey);
  if (selected) closeSelectionSurface();
}

function openCatalogOffersFromDrawer(): void {
  const item = candidateItem.value;
  if (item === null) return;
  const lineIdx = items.value.findIndex((entry) => entry.id === item.id);
  closeSelectionSurface();
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

interface CatalogSelectionTarget {
  mode: 'swap' | 'add';
  lineIdx: number | null;
}

function applyCatalogPart(part: PartHitType, pick: OfferPick | null, target: CatalogSelectionTarget): boolean {
  if (editingLocked.value) return false;
  if (enriching.value) return false;

  let lineIdx = target.lineIdx;
  if (target.mode === 'add' || lineIdx === null) {
    const rowIdx = items.value.reduce((m, i) => Math.max(m, i.rowIdx), -1) + 1;
    items.value.push({
      id: `new:${String(rowIdx)}`,
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
      partImageUrl: part.imageUrl,
      partDatasheetUrl: null, // 검색 히트엔 없음 — 다음 상세 조회 때 서버가 카탈로그에서 채움
    });
    lineIdx = items.value.length - 1;
  } else {
    const item = items.value[lineIdx];
    if (item === undefined) return false;
    item.mpn = part.mpn;
    item.manufacturerName = part.manufacturerName;
    item.description = part.description;
    item.partImageUrl = part.imageUrl;
    item.partDatasheetUrl = null; // 부품이 바뀌었으니 이전 링크 무효 — 다음 상세 조회 때 재채움
    item.matchStatus = 'manual';
    item.selectedCandidateKey = null;
    item.selectionSource = 'catalog';
    item.partId = part.id;
    item.selectedOffer = null;
  }

  const item = items.value[lineIdx];
  if (item === undefined) return false;
  if (pick !== null) {
    // 추천값이어도 고객이 공급 포장·공급사를 확인하고 확정한 직접 선택이다.
    applyOfferPick(pick, true, lineIdx, part.id);
  } else {
    recalcLine(item);
    markDirty();
  }
  return true;
}

function onPartSelected(part: PartHitType, pick: OfferPick | null): void {
  const modal = partModal.value;
  if (modal === null || editingLocked.value) return;
  partModal.value = null;
  applyCatalogPart(part, pick, modal);
}

function onCatalogPartSelected(part: PartHitType, pick: OfferPick | null): void {
  const item = candidateItem.value;
  if (item === null || editingLocked.value || catalogSelectionPending.value) return;
  const lineIdx = items.value.findIndex((entry) => entry.id === item.id);
  if (lineIdx < 0) {
    candidateSelectionError.value = '변경할 견적 행을 찾지 못했습니다. 패널을 닫고 다시 시도해 주세요.';
    return;
  }

  candidateSelectionError.value = '';
  catalogSelectionPending.value = true;
  try {
    const applied = applyCatalogPart(part, pick, { mode: 'swap', lineIdx });
    if (applied) closeSelectionSurface();
    else candidateSelectionError.value = '선택한 구매 조건을 현재 행에 적용하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    catalogSelectionPending.value = false;
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

function fmtAmount(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('ko-KR');
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
      <p class="mt-2 text-sm text-gray-500">라인과 주문수량 계산이 끝나면 결과가 표시되고 공급사 검색이 이어집니다.</p>
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
              <span>{{ quoteStats.total }}개 부품</span>
              <span v-if="showResultSheetTabs" class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{{ selectedResultSheets.length }}개 시트</span>
              <template v-else>
                <span v-for="sheet in selectedResultSheets" :key="sheet.sheetIndex" class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{{ sheet.sheetName }}</span>
              </template>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="isDraft" class="mr-1 text-xs text-gray-400">
              <template v-if="saveState === 'saving'">저장 중…</template>
              <template v-else-if="saveState === 'saved' && !dirty">자동 저장됨</template>
              <template v-else-if="saveState === 'error'"><span class="text-red-500">저장 실패</span></template>
            </span>
            <button
              v-if="isDraft && manageableResultSheets.length > 1"
              type="button"
              class="flex h-[38px] items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-[13px] font-semibold text-[#374151] hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-45"
              :disabled="editingLocked || patch.isPending.value"
              :title="editingLocked ? EDIT_LOCK_TITLE : '견적에 포함할 시트 관리'"
              @click="openSheetManager"
            >
              <span aria-hidden="true">⊞</span>
              시트 {{ selectedResultSheets.length }}/{{ manageableResultSheets.length }}
            </button>
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

        <div
          v-else-if="detail.supplierSearchLimitedCount > 0"
          class="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900"
          role="status"
        >
          <span class="mt-0.5 shrink-0 text-amber-600" aria-hidden="true">!</span>
          <p>
            검색 한도에 도달해 <strong>{{ detail.supplierSearchLimitedCount.toLocaleString('ko-KR') }}개 부품</strong>의 일부 공급사 확인이 제한되었습니다.
            <span class="text-amber-800/80">표시된 후보는 확인이 완료된 결과 기준입니다.</span>
          </p>
        </div>

        <!-- 여러 시트 결과를 원본 단위로 탐색하되 견적 합계·선택 상태는 하나로 유지한다 -->
        <div v-if="showResultSheetTabs" class="mt-3 overflow-x-auto border-b border-[#e1e6ef] [scrollbar-width:thin]" role="tablist" aria-label="BOM 결과 시트">
          <div class="flex min-w-max items-end gap-1 px-1">
            <button
              v-for="tab in resultSheetTabs"
              :key="tab.key"
              type="button"
              role="tab"
              class="relative flex h-[34px] max-w-[240px] items-center gap-1.5 rounded-t-md px-3 text-[12px] font-semibold transition after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full"
              :class="activeResultSheet === tab.key ? 'bg-blue-50/70 text-[#1e64fd] after:bg-[#1e64fd]' : 'text-[#687386] after:bg-transparent hover:bg-gray-50 hover:text-[#334155]'"
              :aria-selected="activeResultSheet === tab.key"
              aria-controls="bom-results-table"
              @click="selectResultSheet(tab.key)"
            >
              <span class="truncate" :title="tab.label">{{ tab.label }}</span>
              <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums" :class="activeResultSheet === tab.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'">{{ tab.count }}</span>
            </button>
          </div>
        </div>

        <!-- 매칭 결과 헤더 -->
        <div :class="showResultSheetTabs ? 'mt-2' : 'mt-4'" class="flex min-h-[26px] flex-wrap items-center justify-between gap-2 px-1">
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-[15px] font-bold text-[#061023]">매칭 결과</p>
            <template v-if="resultFiltersActive">
              <span class="text-[12px] font-medium text-[#5f6777]">{{ stats.total }}개 중 {{ filteredItems.length }}개 표시</span>
              <span v-if="activeMatchFilterLabel !== null" class="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{{ activeMatchFilterLabel }}</span>
              <span v-if="resultNostockOnly" class="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">재고 부족</span>
              <button type="button" class="text-[11px] font-semibold text-[#2477f4] underline-offset-2 hover:underline" @click="clearResultFilters">필터 해제</button>
            </template>
          </div>
          <!-- 선택 삭제 — 미구현(디자인만) -->
          <button type="button" class="h-[26px] cursor-default rounded border border-gray-300 bg-white px-2.5 text-[12px] text-gray-500 opacity-70" title="선택 삭제 (준비 중)">선택 삭제</button>
        </div>

        <!-- 테이블 (list01 스타일) — 이 영역만 내부 스크롤, 헤더는 sticky -->
        <div ref="resultsScrollEl" class="mt-2 min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200 bg-white">
          <table id="bom-results-table" class="min-w-[1120px] w-full" :aria-busy="editingLocked">
            <thead class="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e5e8ed]">
              <tr class="text-left text-[11px] uppercase tracking-wide text-[#8e97a5]">
                <th class="w-[52px] px-1 py-2.5"><span class="sr-only">포함 및 원본 행</span></th>
                <th class="w-[280px] max-w-[280px] px-2 py-2.5">MPN / 원본 값</th>
                <th class="w-[104px] min-w-[96px] px-2 py-2.5">Manufacturer</th>
                <th class="min-w-[140px] px-2 py-2.5">Description</th>
                <th class="w-[130px] min-w-[124px] px-2 py-2.5 text-right">Unit Price</th>
                <th class="w-[170px] px-2 py-2.5">Quantity / Stock</th>
                <th class="w-[140px] min-w-[132px] px-2 py-2.5 text-right">Total Price</th>
                <th class="w-[100px] px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              <BomQuoteRow
                v-for="item in filteredItems"
                :key="item.id"
                :item="item"
                :is-draft="isDraft"
                :editing-locked="editingLocked"
                :enriching="enriching"
                @toggle-include="toggleInclude(item)"
                @qty-change="onRowQtyChange(item, $event)"
                @open-offers="openQuoteOfferModal(item)"
                @open-candidates="openCandidateDrawer(item)"
                @open-search="openCatalogSearchDrawer(item)"
              />
              <tr v-if="filteredItems.length === 0">
                <td colspan="8" class="px-3 py-10 text-center text-sm text-gray-400">{{ resultFiltersActive ? '선택한 조건에 해당하는 라인이 없습니다.' : '표시할 라인이 없습니다.' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 우: Figma right side bar(93:23505)의 치수·위계를 라이트 테마로 번역 -->
      <aside v-show="rightOpen" class="w-full shrink-0 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#cbd3df] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-[6px] xl:min-h-0 xl:w-[286px] xl:overflow-y-auto xl:pb-1">
        <div class="flex min-h-full flex-col rounded-xl border border-[#e1e6ef] bg-white p-[15px] shadow-[0_4px_18px_rgba(19,33,68,0.06)]">
          <!-- 회신(answered) -->
          <div v-if="detail.answerNote !== null || detail.confirmedTotal !== null" class="mb-[18px] rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-3 text-[12px]">
            <p class="font-bold text-emerald-800">담당자 회신</p>
            <p v-if="detail.answerNote" class="mt-1 whitespace-pre-wrap leading-[18px] text-emerald-900">{{ detail.answerNote }}</p>
            <p v-if="detail.confirmedTotal !== null" class="mt-2 text-emerald-900">
              확정 견적: <b class="tabular-nums">{{ fmtWon(detail.confirmedTotal) }}</b>
              <span v-if="detail.confirmedShippingFee !== null" class="mt-1 block text-[10px] text-emerald-700">(운송료 {{ fmtWon(detail.confirmedShippingFee) }} · 관리비 {{ fmtWon(detail.confirmedManagementFee) }})</span>
            </p>
          </div>

          <!-- AI 분석결과 (93:23545) -->
          <section>
            <h2 class="flex h-[22px] items-center gap-[7px] text-[12px] font-bold leading-[14px] text-[#151b28]">
              <img :src="icPanelAi" alt="" class="size-[16px] shrink-0 brightness-0 opacity-75">
              AI 분석결과
              <span v-if="showResultSheetTabs" class="ml-auto max-w-[120px] truncate rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold text-blue-600" :title="activeResultSheetLabel">{{ activeResultSheetLabel }}</span>
            </h2>
            <div class="mt-[10px] space-y-[11px]">
              <button
                type="button"
                class="relative flex h-[51px] w-full cursor-pointer items-center justify-between overflow-hidden rounded-[8px] border border-[#dce7f8] bg-[#f8faff] px-[12px] text-left transition after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-gradient-to-r after:from-[#2f7eff] after:to-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2477f4] focus-visible:ring-offset-1"
                :class="!resultFiltersActive ? 'ring-2 ring-[#2477f4] ring-offset-1 shadow-sm' : 'hover:-translate-y-px hover:shadow-sm'"
                :aria-pressed="!resultFiltersActive"
                :aria-label="`전체 ${String(stats.total)}개 행 보기`"
                aria-controls="bom-results-table"
                @click="clearResultFilters"
              >
                <div class="flex h-full flex-col justify-center pt-px">
                  <span class="text-[10px] font-medium uppercase leading-[12px] tracking-[1.1px] text-[#5f697a]">Total Lines</span>
                  <span class="mt-[1px] text-[18px] font-extrabold leading-[21px] tabular-nums text-[#2477f4]">{{ stats.total }}</span>
                </div>
                <span class="grid size-[28px] place-items-center rounded-[6px] bg-[#e7f0ff] text-[19px] leading-none text-[#2477f4]">≋</span>
              </button>
              <button
                type="button"
                class="relative flex h-[51px] w-full cursor-pointer items-center justify-between overflow-hidden rounded-[8px] border border-[#d7eee6] bg-[#f6fcf9] px-[12px] text-left transition after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-gradient-to-r after:from-[#08b77f] after:to-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#08ad79] focus-visible:ring-offset-1"
                :class="resultMatchFilter === 'matched' ? 'ring-2 ring-[#08ad79] ring-offset-1 shadow-sm' : 'hover:-translate-y-px hover:shadow-sm'"
                :aria-pressed="resultMatchFilter === 'matched'"
                :aria-label="`매칭 완료 ${String(stats.matched)}개 행 필터`"
                aria-controls="bom-results-table"
                @click="toggleResultMatchFilter('matched')"
              >
                <div class="flex h-full flex-col justify-center pt-px">
                  <span class="text-[10px] font-medium uppercase leading-[12px] tracking-[1.1px] text-[#5f697a]">Matched</span>
                  <span class="mt-[1px] text-[18px] font-extrabold leading-[21px] tabular-nums text-[#08ad79]">{{ stats.matched }} <span class="text-[12px] font-semibold">{{ stats.matchedPct }}%</span></span>
                </div>
                <span class="grid size-[28px] place-items-center rounded-[6px] bg-[#e4f7ef] text-[19px] font-semibold leading-none text-[#08ad79]">✓</span>
              </button>
              <button
                type="button"
                class="relative flex h-[51px] w-full cursor-pointer items-center justify-between overflow-hidden rounded-[8px] border border-[#f1e8b9] bg-[#fffdf3] px-[12px] text-left transition after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-gradient-to-r after:from-[#e2c100] after:to-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8aa00] focus-visible:ring-offset-1"
                :class="resultNostockOnly ? 'ring-2 ring-[#c8aa00] ring-offset-1 shadow-sm' : 'hover:-translate-y-px hover:shadow-sm'"
                :aria-pressed="resultNostockOnly"
                :aria-label="`재고 부족 ${String(stats.nostock)}개 행 필터`"
                aria-controls="bom-results-table"
                @click="toggleResultNostockFilter"
              >
                <div class="flex h-full flex-col justify-center pt-px">
                  <span class="text-[10px] font-medium uppercase leading-[12px] tracking-[1.1px] text-[#5f697a]">Nostock</span>
                  <span class="mt-[1px] text-[18px] font-extrabold leading-[21px] tabular-nums text-[#c8aa00]">{{ stats.nostock }} <span class="text-[12px] font-semibold">{{ stats.nostockPct }}%</span></span>
                </div>
                <img :src="icPanelNostock" alt="" class="size-[28px] shrink-0">
              </button>
              <button
                v-if="!enriching && stats.review > 0"
                type="button"
                class="relative flex h-[51px] w-full cursor-pointer items-center justify-between overflow-hidden rounded-[8px] border border-orange-200 bg-orange-50/60 px-[12px] text-left transition after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-gradient-to-r after:from-orange-400 after:to-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1"
                :class="resultMatchFilter === 'review' ? 'ring-2 ring-orange-400 ring-offset-1 shadow-sm' : 'hover:-translate-y-px hover:shadow-sm'"
                :aria-pressed="resultMatchFilter === 'review'"
                :aria-label="`검토 필요 ${String(stats.review)}개 행 필터`"
                aria-controls="bom-results-table"
                @click="toggleResultMatchFilter('review')"
              >
                <div class="flex h-full flex-col justify-center pt-px">
                  <span class="text-[10px] font-medium uppercase leading-[12px] tracking-[1.1px] text-[#5f697a]">Review</span>
                  <span class="mt-[1px] text-[18px] font-extrabold leading-[21px] tabular-nums text-orange-500">{{ stats.review }}</span>
                </div>
                <span class="grid size-[28px] place-items-center rounded-[6px] bg-orange-100 text-[17px] font-bold text-orange-500">!</span>
              </button>
              <!-- 보강 진행 중엔 Checking(파랑) — 최종 미매칭 판정과 구분 -->
              <button
                type="button"
                class="relative flex h-[51px] w-full items-center justify-between overflow-hidden rounded-[8px] px-[12px] text-left transition after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-gradient-to-r after:to-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-wait"
                :class="[
                  enriching ? 'border border-[#dce7f8] bg-[#f8faff] after:from-[#2f7eff]' : 'cursor-pointer border border-[#f2dce3] bg-[#fff7f9] after:from-[#f23a6b] focus-visible:ring-[#e73362]',
                  !enriching && resultMatchFilter === 'unmatched' ? 'ring-2 ring-[#e73362] ring-offset-1 shadow-sm' : !enriching ? 'hover:-translate-y-px hover:shadow-sm' : '',
                ]"
                :disabled="enriching"
                :aria-pressed="!enriching && resultMatchFilter === 'unmatched'"
                :aria-label="enriching ? `확인 중 ${String(stats.unresolved)}개 행` : `미매칭 ${String(stats.unmatched)}개 행 필터`"
                aria-controls="bom-results-table"
                :title="enriching ? '공급사 확인이 완료되면 필터할 수 있습니다' : undefined"
                @click="toggleResultMatchFilter('unmatched')"
              >
                <div class="flex h-full flex-col justify-center pt-px">
                  <span class="text-[10px] font-medium uppercase leading-[12px] tracking-[1.1px] text-[#5f697a]">{{ enriching ? 'Checking' : 'Unmatched' }}</span>
                  <span class="mt-[1px] text-[18px] font-extrabold leading-[21px] tabular-nums" :class="enriching ? 'text-[#2477f4]' : 'text-[#e73362]'">{{ enriching ? stats.unresolved : stats.unmatched }}</span>
                </div>
                <span class="grid size-[28px] place-items-center rounded-[6px] text-[20px] leading-none" :class="enriching ? 'bg-[#e7f0ff] text-[#2477f4]' : 'bg-[#fbe6ec] text-[#e73362]'">{{ enriching ? '…' : '×' }}</span>
              </button>
            </div>
          </section>

          <div class="my-[18px] h-px shrink-0 bg-[#e8ebf0]" />

          <!-- 주문 정보 (93:23562) -->
          <section title="주문수량은 BOM 수량과 세트·예비 수량을 반영한 뒤 MOQ와 주문배수에 맞춰 계산됩니다.">
            <h2 class="flex h-[20px] items-center gap-[7px] text-[12px] font-bold leading-[14px] text-[#151b28]">
              <img :src="icPanelOrder" alt="" class="size-[16px] shrink-0 brightness-0 opacity-75">
              주문 정보
            </h2>
            <div class="mt-[10px] space-y-[11px] rounded-[8px] border border-[#e1e6ef] bg-[#f8fafc] px-[11px] py-[11px]">
              <div class="flex items-center justify-between">
                <span class="text-[12px] font-normal leading-[14px] tracking-[-0.48px] text-[#5f6777]">세트 수량</span>
                <div class="flex items-center gap-[7px]">
                  <div class="flex h-[32px] w-[124px] overflow-hidden rounded-[5px] border border-[#cfd7e4] bg-white shadow-[inset_0_1px_1px_rgba(20,35,65,0.03)] focus-within:border-[#4d8df7] focus-within:ring-2 focus-within:ring-[#4d8df7]/15">
                    <button type="button" class="w-[27px] shrink-0 border-r border-[#e1e6ef] bg-[#f3f6fa] text-[14px] text-[#9aa5b5] transition hover:bg-[#eaf1fb] hover:text-[#315f9f] disabled:cursor-not-allowed disabled:opacity-35" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" aria-label="세트 수량 줄이기" @click="stepSet(-1)">−</button>
                    <input v-model.number="setQty" type="number" min="1" class="min-w-0 flex-1 appearance-none bg-white text-center text-[14px] font-semibold tabular-nums text-[#172033] outline-none [appearance:textfield] disabled:cursor-not-allowed disabled:bg-[#f8fafc] disabled:text-[#9aa5b5] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" aria-label="세트 수량" @change="restampAll">
                    <button type="button" class="w-[27px] shrink-0 border-l border-[#e1e6ef] bg-[#f3f6fa] text-[14px] text-[#9aa5b5] transition hover:bg-[#eaf1fb] hover:text-[#315f9f] disabled:cursor-not-allowed disabled:opacity-35" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" aria-label="세트 수량 늘리기" @click="stepSet(1)">+</button>
                  </div>
                  <span class="w-[18px] text-[10px] font-semibold text-[#9aa3b2]">Set</span>
                </div>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-[12px] font-normal leading-[14px] tracking-[-0.48px] text-[#5f6777]">예비 수량</span>
                <div class="flex items-center gap-[7px]">
                  <div class="flex h-[32px] w-[124px] overflow-hidden rounded-[5px] border border-[#cfd7e4] bg-white shadow-[inset_0_1px_1px_rgba(20,35,65,0.03)] focus-within:border-[#4d8df7] focus-within:ring-2 focus-within:ring-[#4d8df7]/15">
                    <button type="button" class="w-[27px] shrink-0 border-r border-[#e1e6ef] bg-[#f3f6fa] text-[14px] text-[#9aa5b5] transition hover:bg-[#eaf1fb] hover:text-[#315f9f] disabled:cursor-not-allowed disabled:opacity-35" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" aria-label="예비 수량 줄이기" @click="stepSpare(-1)">−</button>
                    <input v-model.number="spareQty" type="number" min="0" class="min-w-0 flex-1 appearance-none bg-white text-center text-[14px] font-semibold tabular-nums text-[#172033] outline-none [appearance:textfield] disabled:cursor-not-allowed disabled:bg-[#f8fafc] disabled:text-[#9aa5b5] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" aria-label="예비 수량" @change="restampAll">
                    <button type="button" class="w-[27px] shrink-0 border-l border-[#e1e6ef] bg-[#f3f6fa] text-[14px] text-[#9aa5b5] transition hover:bg-[#eaf1fb] hover:text-[#315f9f] disabled:cursor-not-allowed disabled:opacity-35" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" aria-label="예비 수량 늘리기" @click="stepSpare(1)">+</button>
                  </div>
                  <span class="w-[18px] text-[10px] font-semibold text-[#9aa3b2]">Set</span>
                </div>
              </div>
              <div class="flex h-[19px] items-center justify-between pt-px">
                <span class="text-[12px] font-normal leading-[14px] tracking-[-0.48px] text-[#5f6777]">예상 납기</span>
                <span class="flex items-center gap-[6px] text-[11px] font-semibold text-[#169ab6]"><span class="size-[6px] rounded-full bg-[#20aeca]" />확정 시 안내</span>
              </div>
            </div>
          </section>

          <div class="my-[18px] h-px shrink-0 bg-[#e8ebf0]" />

          <!-- 예상 견적 (93:23573) -->
          <section :aria-busy="pricingPending">
            <h2 class="flex h-[20px] items-center gap-[7px] text-[12px] font-bold leading-[14px] text-[#151b28]">
              <img :src="icPanelQuote" alt="" class="size-[16px] shrink-0 brightness-0 opacity-75">
              예상 견적
              <span v-if="showResultSheetTabs" class="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold text-gray-500">전체 견적</span>
            </h2>
            <div v-if="pricingPending" class="mt-[10px] rounded-[8px] border border-[#d9e6fb] bg-[#f4f8ff] px-3 py-4 text-center" aria-live="polite">
              <span class="mx-auto block size-[7px] animate-pulse rounded-full bg-[#4d8df7]" />
              <p class="mt-2 text-[12px] font-semibold text-[#315f9f]">공급사 가격을 확인하고 있습니다</p>
              <p class="mt-1 text-[10px] leading-[15px] text-[#7c94b7]">모든 결과가 반영되면 합계를 표시합니다.</p>
            </div>
            <div v-else class="mt-[10px]">
              <div class="space-y-[8px] rounded-[8px] border border-[#e1e6ef] bg-[#f8fafc] px-[11px] py-[11px] text-[12px]">
                <div class="flex items-baseline justify-between"><span class="text-[#5f6777]">합계</span><span class="font-bold tabular-nums text-[#293346]">{{ fmtAmount(itemsTotal) }} <small class="text-[9px] font-normal text-[#9aa3b2]">원</small></span></div>
                <div class="flex items-baseline justify-between"><span class="text-[#5f6777]">운송료</span><span class="font-bold tabular-nums text-[#293346]">{{ fmtAmount(detail.shippingFee) }} <small class="text-[9px] font-normal text-[#9aa3b2]">원</small></span></div>
                <div class="flex items-baseline justify-between"><span class="text-[#5f6777]">관리비</span><span class="font-bold tabular-nums text-[#293346]">{{ fmtAmount(detail.managementFee) }} <small class="text-[9px] font-normal text-[#9aa3b2]">원</small></span></div>
              </div>
              <div class="relative mt-[11px] h-[70px] rounded-[8px] border border-[#d6e3fb] bg-[#f4f7ff] px-[11px] py-[11px]">
                <span class="text-[12px] font-medium text-[#263248]">최종합계 <span class="text-[10px] font-normal text-[#8a95a6]">(VAT 별도)</span></span>
                <span class="absolute bottom-[11px] right-[11px] text-[20px] font-bold leading-[22px] tabular-nums text-[#287cff]">{{ fmtAmount(finalTotal) }}<small class="ml-[3px] text-[11px] font-semibold">원</small></span>
              </div>
              <p v-if="uncostedCount > 0" class="mt-[9px] rounded-[5px] bg-amber-50 px-2 py-1.5 text-[10px] leading-[15px] text-amber-700">
                금액 미산정 라인 {{ uncostedCount }}건 — 미매칭이거나 환산 불가한 통화입니다
              </p>
              <p v-if="quoteStats.pendingReview > 0" class="mt-[9px] rounded-[5px] border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-semibold leading-[15px] text-amber-800">
                선정됨 · 검토 대기 {{ quoteStats.pendingReview }}건 — 임시 선정 금액이 합계에 포함되어 있습니다
              </p>
              <ul class="mt-[11px] list-disc pl-[14px] text-[10px] leading-[15px] text-[#8993a2]">
                <li>AI로 산출한 가견적입니다.</li>
                <li>정확한 가격은 담당자 확정 시 안내드립니다.</li>
              </ul>
            </div>
          </section>

          <!-- CTA -->
          <div class="mt-auto space-y-2 pt-[30px]">
            <button
              v-if="isDraft"
              type="button"
              class="flex h-[40px] w-full items-center justify-center gap-[8px] rounded-[7px] bg-[#287cff] text-[14px] font-bold text-white shadow-[0_6px_14px_rgba(40,124,255,0.24)] transition hover:bg-[#176ff5] disabled:cursor-not-allowed disabled:opacity-45"
              :disabled="request.isPending.value || quoteStats.included === 0 || editingLocked"
              :title="editingLocked ? EDIT_LOCK_TITLE : undefined"
              @click="openRequestModal"
            >
              <img :src="icFile" alt="" class="size-[14px] brightness-0 invert">
              {{ updateSheets.isPending.value ? '시트 반영 중…' : editingLocked ? '가격 확인 중…' : '견적요청' }}
            </button>
            <!-- draft=하드 삭제(2단계 확인) · requested=요청 취소(관리자 워크플로 존중) -->
            <template v-if="detail.status === 'draft'">
              <button
                v-if="!deleteArm"
                type="button"
                class="w-full rounded-[7px] border border-[#dbe1ea] bg-white px-4 py-2 text-[12px] text-[#7a8493] transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                :disabled="del.isPending.value"
                @click="armDelete"
              >
                {{ del.isPending.value ? '삭제 중…' : '견적 삭제' }}
              </button>
              <button
                v-else
                type="button"
                class="w-full rounded-[7px] bg-red-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-red-700"
                @click="onDelete"
              >
                정말 삭제 — 되돌릴 수 없습니다
              </button>
            </template>
            <button
              v-else-if="detail.status === 'requested'"
              type="button"
              class="w-full rounded-[7px] border border-[#dbe1ea] bg-white px-4 py-2 text-[12px] text-[#7a8493] transition hover:bg-gray-50 hover:text-[#273248]"
              @click="onCancel"
            >
              요청 취소
            </button>
          </div>
        </div>
      </aside>
    </div>

    <!-- 결과 시트 관리: 제외해도 원본 라인·후보·선택 이력은 보존한다. -->
    <div
      v-if="sheetManagerOpen && detail !== null"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="closeSheetManager"
    >
      <div class="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl" role="dialog" aria-modal="true" aria-labelledby="sheet-manager-title">
        <div class="border-b border-gray-100 px-5 py-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 id="sheet-manager-title" class="text-base font-semibold text-gray-900">견적 시트 관리</h3>
              <p class="mt-1 text-xs leading-5 text-gray-500">제외한 시트는 견적·합계에서만 빠지며, 원본과 후보 선택 이력은 유지됩니다.</p>
            </div>
            <button
              type="button"
              class="grid size-8 shrink-0 place-items-center rounded-lg text-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
              :disabled="updateSheets.isPending.value"
              aria-label="닫기"
              @click="closeSheetManager"
            >
              ×
            </button>
          </div>
        </div>

        <div class="max-h-[55vh] space-y-2 overflow-y-auto px-5 py-4 [scrollbar-width:thin]">
          <button
            v-for="sheet in manageableResultSheets"
            :key="sheet.sheetIndex"
            type="button"
            class="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition disabled:cursor-wait disabled:opacity-60"
            :class="managedSheetIndexes.includes(sheet.sheetIndex) ? 'border-blue-300 bg-blue-50/70' : 'border-gray-200 bg-gray-50 hover:border-gray-300'"
            :disabled="updateSheets.isPending.value"
            :aria-pressed="managedSheetIndexes.includes(sheet.sheetIndex)"
            @click="toggleManagedSheet(sheet.sheetIndex)"
          >
            <span
              class="grid size-5 shrink-0 place-items-center rounded border text-[12px] font-bold"
              :class="managedSheetIndexes.includes(sheet.sheetIndex) ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-transparent'"
              aria-hidden="true"
            >✓</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold text-gray-800" :title="sheet.sheetName">{{ sheet.sheetName }}</span>
              <span class="mt-0.5 block text-[11px] text-gray-500">{{ sheet.componentCount }}개 부품</span>
            </span>
            <span
              class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
              :class="managedSheetIndexes.includes(sheet.sheetIndex) ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'"
            >{{ managedSheetIndexes.includes(sheet.sheetIndex) ? '포함' : '제외' }}</span>
          </button>
        </div>

        <div class="border-t border-gray-100 bg-gray-50 px-5 py-4">
          <p v-if="managedSheetIndexes.length === 0" class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">최소 1개 시트는 견적에 포함해야 합니다.</p>
          <p v-else-if="removedSheetCount > 0" class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            {{ removedSheetCount }}개 시트의 {{ removedComponentCount }}개 부품을 견적에서 제외합니다. 나중에 다시 포함할 수 있습니다.
          </p>
          <p v-else-if="restoredSheetCount > 0" class="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700">
            {{ restoredSheetCount }}개 시트를 다시 포함하고 현재 수량·가격 기준으로 합계를 갱신합니다.
          </p>
          <p v-if="sheetSelectionError !== ''" class="mb-3 text-xs text-red-600">{{ sheetSelectionError }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-xs text-gray-500">{{ managedSheetIndexes.length }}개 시트 · {{ managedComponentCount }}개 부품 포함</span>
            <div class="flex gap-2">
              <button
                type="button"
                class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                :disabled="updateSheets.isPending.value"
                @click="closeSheetManager"
              >
                취소
              </button>
              <button
                type="button"
                class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45"
                :disabled="managedSheetIndexes.length === 0 || updateSheets.isPending.value || patch.isPending.value"
                @click="applyManagedSheets"
              >
                {{ updateSheets.isPending.value ? '반영 중…' : '시트 구성 적용' }}
              </button>
            </div>
          </div>
        </div>
      </div>
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

    <div v-if="pendingSelection !== null" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-labelledby="part-data-title" @click.self="closePartDataPreparation">
      <div class="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3 id="part-data-title" class="text-[16px] font-bold text-slate-900">
              {{ pendingSelection.view === 'candidates' ? '후보 비교 준비' : '부품 변경 준비' }}
            </h3>
            <p v-if="!preparePartData.isPending.value && partDataFailureReason === 'result-gone'" class="mt-2 text-[13px] leading-5 text-slate-600">
              이전 부품 정보가 만료되었습니다. 저장된 BOM 분석으로 다시 준비할 수 있습니다.
            </p>
            <p v-else-if="!preparePartData.isPending.value && partDataFailed" class="mt-2 text-[13px] leading-5 text-slate-600">
              부품 정보를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.
            </p>
            <p v-else class="mt-2 text-[13px] leading-5 text-slate-600">
              추천 후보와 검색에 필요한 부품 정보를 준비하고 있습니다. 완료되면 자동으로 열립니다.
            </p>
          </div>
          <button type="button" class="shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold text-slate-500 hover:bg-slate-100" aria-label="준비 화면 닫기" @click="closePartDataPreparation">닫기</button>
        </div>
        <div v-if="preparePartData.isPending.value || !partDataFailed" class="mt-5 flex items-center gap-3 rounded-xl bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-700" aria-live="polite">
          <span class="size-4 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" aria-hidden="true" />
          부품 정보 준비 중
        </div>
        <div v-else class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded-lg border border-slate-300 px-3 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50" @click="closePartDataPreparation">
            취소
          </button>
          <button type="button" class="rounded-lg bg-blue-600 px-3 py-2 text-[13px] font-bold text-white hover:bg-blue-700 disabled:opacity-50" :disabled="preparePartData.isPending.value" @click="retryPartDataPreparation">다시 준비</button>
        </div>
      </div>
    </div>

    <BomCandidateDrawer
      :open="candidateOpen"
      :context="candidateQuery.data.value?.data ?? null"
      :loading="candidateQuery.isLoading.value"
      :failed="candidateQuery.isError.value"
      :selecting="candidateSelection.isPending.value"
      :catalog-selecting="catalogSelectionPending"
      :selection-error="candidateSelectionError"
      :initial-view="candidateDrawerView"
      :search-initial-query="candidateItem?.mpn ?? ''"
      :current-part-id="candidateItem?.partId ?? null"
      :needed="candidateItem === null ? 1 : neededQty(candidateItem.bomQty, setQty, spareQty)"
      :usd-krw-rate="rate"
      :has-catalog-part="candidateItem !== null && candidateItem.partId !== null && candidateItem.selectedCandidateKey === null"
      @select="selectCandidate"
      @catalog-select="onCatalogPartSelected"
      @catalog-offers="openCatalogOffersFromDrawer"
      @close="closeSelectionSurface"
    />
    <BomQuoteOfferModal
      :open="quoteOfferOpen"
      :context="candidateQuery.data.value?.data ?? null"
      :loading="candidateQuery.isLoading.value"
      :failed="candidateQuery.isError.value"
      :selecting="candidateSelection.isPending.value"
      :selection-error="candidateSelectionError"
      @select="selectQuoteOffer"
      @compare="openCandidateDrawerFromOfferModal"
      @close="closeSelectionSurface"
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
      :needed="partModalNeeded"
      :usd-krw-rate="rate"
      @select="onPartSelected"
      @close="partModal = null"
    />
    <BomCompareModal
      v-if="compareOpen && detail !== null"
      :open="compareOpen"
      :title="detail.fileName ?? detail.title"
      :items="items"
      :comparison="quoteComparison.data.value?.data ?? null"
      :loading="quoteComparison.isFetching.value && quoteComparison.data.value === undefined"
      :failed="quoteComparison.isError.value"
      @retry="quoteComparison.refetch()"
      @query-change="onComparisonQueryChange"
      @close="compareOpen = false"
    />
  </div>
</template>
