<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQueryClient } from '@tanstack/vue-query';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { ApiRequestError, apiGet, apiGetBlob } from '@sp/shared';
import {
  BomQuotePrintResponse,
  apiRoutes,
  type BomQuoteDetailResponseType,
  type BomQuoteDetailType,
  type BomQuoteItemType,
  type BomQuotePassiveDefaultsBodyType,
  type BomQuoteSearchRequirementsBodyType,
  type BomQuoteSelectedOfferType,
  type BomSearchCartAddBodyType,
  type PartHitType,
} from '@sp/api-contract';
import {
  bomQuoteItemMatchGroup,
  neededQty,
  pickBreak,
  stampOrderQty,
  summarizeBomQuoteItems,
  toKrw,
  type OfferPick,
} from '@sp/utils';
import {
  useBomJob,
  useBomQuote,
  useBomQuoteComparison,
  useBomQuoteCandidates,
  useBuildBomQuote,
  useApplyBomQuotePassiveDefaults,
  useCancelBomQuote,
  useDeleteBomQuote,
  useOrderBomQuote,
  usePatchBomQuote,
  usePrepareBomPartData,
  usePrepareBomQuoteSheets,
  useRequestBomQuote,
  useRemoveBomQuoteManualItem,
  useRunBomQuoteExternalSupplierSearch,
  useSelectBomQuoteCandidate,
  useSupplierSearchStatus,
  useUpdateBomQuoteSheets,
  useUpdateBomQuoteSearchRequirements,
  useUpsertBomQuoteManualItem,
} from '../../bom/useBom';
import { useBomPanels } from '../../bom/usePanels';
import { bomQuoteItemSelection, bomQuoteItemSelectionKey } from '../../bom/search-selection';
import BomCandidateDrawer from '../../components/bom/BomCandidateDrawer.vue';
import BomCompareModal from '../../components/bom/BomCompareModal.vue';
import BomOfferModal from '../../components/bom/BomOfferModal.vue';
import BomQuoteAddWorkspace from '../../components/bom/BomQuoteAddWorkspace.vue';
import BomQuoteCheckbox from '../../components/bom/BomQuoteCheckbox.vue';
import BomQuoteOfferModal from '../../components/bom/BomQuoteOfferModal.vue';
import BomQuoteRow from '../../components/bom/BomQuoteRow.vue';
import BomEstimateModal from '../../components/smartbom/BomEstimateModal.vue';
import icBomCompareEye from '../../assets/bom/ic-bom-compare-eye.svg';
import icDownloadOutline from '../../assets/bom/ic-download-outline.svg';
import icFile from '../../assets/bom/ic-file.svg';
import icPanelAi from '../../assets/bom/ic-panel-ai.svg';
import icPanelMatched from '../../assets/bom/ic-panel-matched.svg';
import icPanelNostock from '../../assets/bom/ic-panel-nostock.svg';
import icPanelOrder from '../../assets/bom/ic-panel-order.svg';
import icPanelQuote from '../../assets/bom/ic-panel-quote.svg';
import icPanelReview from '../../assets/bom/ic-panel-review.svg';
import icPanelTotal from '../../assets/bom/ic-panel-total.svg';
import icPanelUnmatched from '../../assets/bom/ic-panel-unmatched.svg';
import icSearch from '../../assets/bom/ic-search-20.svg';
import icUploadOutline from '../../assets/bom/ic-upload-outline.svg';

// 고객 스마트 BOM 견적 워크벤치 — Figma "02 BOM 파일 분석_검색 결과"(87:12875) 레이아웃에
// 기존 기능(자동저장·구매 조건/부품 모달·자동 보강·견적요청)을 병합. 사용자 지시:
// 채팅·가격순 정렬 제외, Found 대신 기존 매칭 배지, 공급사 배지는 파비콘(vueline 방식),
// 미구현 요소(행 정렬 핸들)는 디자인만.

const route = useRoute();
const router = useRouter();
const qc = useQueryClient();
const quoteId = computed(() => String(route.params.id ?? ''));
// 상단바 우측 접기 버튼과 공유 — 이 페이지의 우측 패널(AI 분석결과·주문 정보·예상 견적)
const { rightOpen, compactLeftOpen, compactRightOpen } = useBomPanels();
const compactPanelCloseButton = ref<HTMLButtonElement | null>(null);
const COMPACT_PANEL_HINT_KEY = 'bom.rightPanelHintSeen';
const compactPanelHintVisible = ref(localStorage.getItem(COMPACT_PANEL_HINT_KEY) !== '1');

function dismissCompactPanelHint(): void {
  if (!compactPanelHintVisible.value) return;
  compactPanelHintVisible.value = false;
  localStorage.setItem(COMPACT_PANEL_HINT_KEY, '1');
}

function openCompactRightPanel(): void {
  compactLeftOpen.value = false;
  compactRightOpen.value = true;
}

function openRightPanelFromEdge(): void {
  if (window.matchMedia('(min-width: 1280px)').matches) {
    rightOpen.value = true;
    dismissCompactPanelHint();
    return;
  }
  openCompactRightPanel();
}

function closeCompactRightPanel(): void {
  compactRightOpen.value = false;
}

function onCompactPanelKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !compactRightOpen.value) return;
  event.preventDefault();
  closeCompactRightPanel();
}

watch(compactRightOpen, (active) => {
  if (!active) return;
  dismissCompactPanelHint();
  void nextTick(() => compactPanelCloseButton.value?.focus());
});

// 자동 보강(searching) 동안 견적을 3초 폴링 — done 은 매칭 라인과 같은 응답으로
// 도착하므로(서버가 한 저장으로 커밋) 링거·타임아웃 휴리스틱이 필요 없다
const quotePolling = ref(false);
const quote = useBomQuote(
  computed(() => (quoteId.value === '' ? null : quoteId.value)),
  computed(() => (quotePolling.value ? 3_000 : false)),
);
const detail = computed(() => quote.data.value?.data ?? null);
const isDraft = computed(() => detail.value?.status === 'draft');
const canDeleteQuote = computed(() => (
  detail.value?.status === 'draft' || detail.value?.status === 'canceled'
));

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

/** 세트/예비수량 변경 — 구매 조건이 있는 모든 라인의 주문수량을 박제(레거시 규칙 보존). */
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
  if (item.quantityState === 'missing') return;
  item.included = !item.included;
  markDirty();
}

function confirmQuantity(item: BomQuoteItemType, qty: number): void {
  if (!isDraft.value || editingLocked.value || item.quantityState !== 'missing') return;
  const confirmedQty = Math.max(1, Math.round(qty));
  item.bomQty = confirmedQty;
  item.orderQty = neededQty(confirmedQty, setQty.value, spareQty.value);
  item.quantityState = 'confirmed';
  item.included = true;
  recalcLine(item);
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
          ...(item.quantityState === 'confirmed'
            ? { confirmedBomQty: item.bomQty }
            : {}),
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
  compactRightOpen.value = false;
  activeResultSheet.value = 'all';
  sheetManagerOpen.value = false;
  managedSheetIndexes.value = [];
  sheetSelectionError.value = '';
});

// 분석 카드는 현재 탭 기준, 금액·견적요청 가능 여부는 전체 견적 기준이다.
const stats = computed(() => summarizeBomQuoteItems(sheetItems.value));
const quoteStats = computed(() => summarizeBomQuoteItems(items.value));
function resultPercent(count: number): number {
  return stats.value.total === 0 ? 0 : Math.round((count / stats.value.total) * 100);
}
const hasPassiveDefaultsOpportunity = computed(() => (
  quoteStats.value.pendingReview > 0
  || quoteStats.value.review > 0
  || quoteStats.value.unmatched > 0
));

const itemsTotal = computed(() => quoteStats.value.itemsTotal);
const finalTotal = computed(() => itemsTotal.value + (detail.value?.shippingFee ?? 0) + (detail.value?.managementFee ?? 0));
const averageSetUnitPrice = computed(() =>
  Math.round(itemsTotal.value / Math.max(1, setQty.value + spareQty.value)),
);

// ── 조용한 자동 보강 상태 — 서버 영속 enrichStatus 가 단일 진실 ─────────────────
// searching 이면 "확인 중" UI + 3초 폴링. done 은 매칭 라인과 원자적으로 도착하고,
// 재시작·잡 유실은 서버의 게으른 치유(조회 시 수렴)가 처리한다.
const compareOpen = ref(false);
const enriching = computed(() => detail.value?.enrichStatus === 'searching');
const compactPanelAttentionCount = computed(() => (
  enriching.value
    ? stats.value.unresolved
    : stats.value.review + stats.value.unmatched + stats.value.nostock
));
const compactPanelAttentionBadge = computed(() => (
  compactPanelAttentionCount.value > 99 ? '99+' : String(compactPanelAttentionCount.value)
));
const compactPanelOpenLabel = computed(() => (
  compactPanelAttentionCount.value === 0
    ? '분석 및 견적 패널 열기'
    : `분석 및 견적 패널 열기, 검토 필요 ${String(compactPanelAttentionCount.value)}개`
));
const partDataPreparing = computed(() => detail.value?.partDataStatus === 'preparing');
// 중간 공급사 결과로 계산된 금액은 최종 합계처럼 오인될 수 있으므로 완료 전에는 숨긴다.
const pricingPending = computed(() => detail.value?.buildStatus !== 'ready' || enriching.value);
// 검색 결과 적용과 사용자의 같은 행 수정이 경합하지 않도록, 결과 반영이 끝날 때까지
// 모든 BOM 변경 동작을 잠그고 읽기 기능만 유지한다.
const editingLocked = computed(() => enriching.value || updateSheets.isPending.value);
const EDIT_LOCK_TITLE = computed(() => updateSheets.isPending.value
  ? '시트 구성을 반영하는 중입니다'
  : '공급사 확인이 완료되면 수정할 수 있습니다');

// 단일검색 견적은 원본 파일명이 없으므로 title이 사용자가 견적을 구분하는 유일한 이름이다.
// DB·PATCH 계약에 이미 있는 title을 재사용하고, 요청 이후 문서 식별자는 변경하지 않는다.
const titleEditing = ref(false);
const titleDraft = ref('');
const titleError = ref('');
const titleSaving = ref(false);
const titleInput = ref<HTMLInputElement | null>(null);
const canRenameTitle = computed(() =>
  detail.value?.sourceKind === 'single_search' && detail.value.status === 'draft',
);

function cancelQuoteTitleEdit(): void {
  if (titleSaving.value) return;
  titleEditing.value = false;
  titleError.value = '';
}

async function openQuoteTitleEdit(): Promise<void> {
  if (!canRenameTitle.value || editingLocked.value || patch.isPending.value) return;
  titleDraft.value = detail.value?.title ?? '';
  titleError.value = '';
  titleEditing.value = true;
  await nextTick();
  titleInput.value?.focus();
  titleInput.value?.select();
}

async function saveQuoteTitle(): Promise<void> {
  if (!canRenameTitle.value || titleSaving.value) return;
  if (editingLocked.value || patch.isPending.value) {
    titleError.value = '다른 변경사항 저장이 끝난 후 다시 시도해 주세요.';
    return;
  }
  const nextTitle = titleDraft.value.trim();
  if (nextTitle === '') {
    titleError.value = '견적명을 입력해 주세요.';
    return;
  }
  if (nextTitle.length > 191) {
    titleError.value = '견적명은 191자 이내로 입력해 주세요.';
    return;
  }
  if (nextTitle === detail.value?.title) {
    titleEditing.value = false;
    titleError.value = '';
    return;
  }

  // 행 자동저장과 제목 PATCH가 같은 상세 캐시를 동시에 갱신하지 않도록 먼저 직렬화한다.
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (dirty.value) {
    await saveNow();
    if (saveState.value === 'error') {
      titleError.value = '저장되지 않은 변경사항이 있습니다. 저장 상태를 확인해 주세요.';
      return;
    }
  }

  const id = quoteId.value;
  titleSaving.value = true;
  titleError.value = '';
  try {
    await patch.mutateAsync({ quoteId: id, body: { title: nextTitle } });
    if (quoteId.value !== id) return;
    titleEditing.value = false;
    saveState.value = 'saved';
  } catch (reason) {
    titleError.value = reason instanceof ApiRequestError && reason.status === 409
      ? '작성 중인 견적만 이름을 변경할 수 있습니다.'
      : '견적명을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    titleSaving.value = false;
  }
}

watch(quoteId, () => {
  titleEditing.value = false;
  titleDraft.value = '';
  titleError.value = '';
});
watch(editingLocked, (locked) => {
  if (locked && !titleSaving.value) cancelQuoteTitleEdit();
});

type RowSearchPhase = 'idle' | 'starting' | 'searching' | 'refreshing' | 'done' | 'failed';
type RowSearchKind = 'requirements' | 'external';
const rowSearchItemId = ref<string | null>(null);
const rowSearchPhase = ref<RowSearchPhase>('idle');
const rowSearchKind = ref<RowSearchKind | null>(null);
const rowSearchNotice = ref('');
const rowSearchPreviousCandidateCount = ref<number | null>(null);
const rowSearchPreviousMatchGroup = ref<SpecificResultMatchFilter | null>(null);
let rowSearchNoticeTimer: ReturnType<typeof setTimeout> | null = null;

const rowSearchRunning = computed(() =>
  rowSearchPhase.value === 'starting'
  || rowSearchPhase.value === 'searching'
  || rowSearchPhase.value === 'refreshing',
);

function cancelRowSearchNoticeTimer(): void {
  if (rowSearchNoticeTimer === null) return;
  clearTimeout(rowSearchNoticeTimer);
  rowSearchNoticeTimer = null;
}

function clearRowSearchState(): void {
  cancelRowSearchNoticeTimer();
  rowSearchItemId.value = null;
  rowSearchPhase.value = 'idle';
  rowSearchKind.value = null;
  rowSearchNotice.value = '';
  rowSearchPreviousCandidateCount.value = null;
  rowSearchPreviousMatchGroup.value = null;
}

// ── 매칭 결과 필터 ──────────────────────────────────────────────────────────
// 대표 상태는 서로 배타적이다. 재고 없음·부족·미확인은 선정/검토/미선정보다 먼저 Nostock으로 분류한다.
type SpecificResultMatchFilter = ReturnType<typeof bomQuoteItemMatchGroup>;
type ResultMatchFilter = 'all' | SpecificResultMatchFilter;

const resultMatchFilter = ref<ResultMatchFilter>('all');
const resultSearchLimitedOnly = ref(false);
const resultTextQuery = ref('');
const resultsScrollEl = ref<HTMLElement | null>(null);
const canScrollResultsLeft = ref(false);
const canScrollResultsRight = ref(false);
let resultsScrollResizeObserver: ResizeObserver | null = null;

function syncResultsHorizontalScrollState(): void {
  const element = resultsScrollEl.value;
  if (element === null) {
    canScrollResultsLeft.value = false;
    canScrollResultsRight.value = false;
    return;
  }
  const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
  canScrollResultsLeft.value = element.scrollLeft > 1;
  canScrollResultsRight.value = element.scrollLeft < maxScrollLeft - 1;
}

function scrollResultColumns(direction: 'left' | 'right'): void {
  const element = resultsScrollEl.value;
  if (element === null) return;
  const distance = Math.max(240, Math.floor(element.clientWidth * 0.7));
  element.scrollBy({
    left: direction === 'left' ? -distance : distance,
    behavior: 'smooth',
  });
}

watch(resultsScrollEl, (element) => {
  resultsScrollResizeObserver?.disconnect();
  resultsScrollResizeObserver = null;
  if (element === null) {
    syncResultsHorizontalScrollState();
    return;
  }
  resultsScrollResizeObserver = new ResizeObserver(syncResultsHorizontalScrollState);
  resultsScrollResizeObserver.observe(element);
  void nextTick(syncResultsHorizontalScrollState);
}, { flush: 'post' });

const RESULT_SEARCH_SOURCE_FIELDS = [
  'sheetName',
  'sourceRows',
  'referenceDesignators',
  'packageCode',
  'valueRaw',
  'inputPartNumber',
  'inputManufacturer',
] as const;

function resultSearchValueText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map(resultSearchValueText).filter((entry) => entry !== '').join(' ');
  return '';
}

function normalizeResultSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/gu, ' ').trim();
}

function compactResultSearchText(value: string): string {
  return value.replace(/[\s\-_/.,()[\]{}]+/gu, '');
}

function buildResultSearchText(item: BomQuoteItemType): string {
  const sourceValues = item.sourceRow === null
    ? []
    : RESULT_SEARCH_SOURCE_FIELDS.map((field) => item.sourceRow?.[field]);
  return normalizeResultSearchText([
    item.mpn,
    item.manufacturerName,
    item.description,
    item.identityPreview?.mpn,
    item.identityPreview?.manufacturerName,
    item.identityPreview?.description,
    item.sourceSheetName,
    item.selectedOffer?.supplier,
    item.selectedOffer?.supplierSku,
    item.selectedOffer?.packaging,
    ...sourceValues,
  ].map(resultSearchValueText).filter((entry) => entry !== '').join(' '));
}

const resultSearchTokens = computed(() => normalizeResultSearchText(resultTextQuery.value)
  .split(' ')
  .filter((token) => token !== ''));
const resultTextSearchActive = computed(() => resultSearchTokens.value.length > 0);
const resultSearchIndex = computed(() => {
  const index = new Map<string, { text: string; compact: string }>();
  for (const item of items.value) {
    const text = buildResultSearchText(item);
    index.set(item.id, { text, compact: compactResultSearchText(text) });
  }
  return index;
});

function itemMatchesResultTextQuery(item: BomQuoteItemType): boolean {
  if (!resultTextSearchActive.value) return true;
  const searchable = resultSearchIndex.value.get(item.id);
  if (searchable === undefined) return false;
  return resultSearchTokens.value.every((token) => {
    if (searchable.text.includes(token)) return true;
    const compactToken = compactResultSearchText(token);
    return compactToken !== '' && searchable.compact.includes(compactToken);
  });
}

const RESULT_MATCH_FILTER_LABEL: Record<SpecificResultMatchFilter, string> = {
  matched: 'Matched',
  review: 'Review',
  unmatched: 'Unmatched',
  nostock: 'Nostock',
  excluded: 'Excluded',
};

function itemMatchGroup(item: BomQuoteItemType): SpecificResultMatchFilter {
  return bomQuoteItemMatchGroup(item);
}

function itemHasSupplierSearchLimit(item: BomQuoteItemType): boolean {
  return (item.matchEvidence?.searchTraceSummary?.limitReasons?.length ?? 0) > 0;
}

const searchLimitedItemCount = computed(() =>
  items.value.filter(itemHasSupplierSearchLimit).length,
);

const filteredItems = computed(() => sheetItems.value.filter((item) => {
  if (!itemMatchesResultTextQuery(item)) return false;
  if (resultMatchFilter.value !== 'all' && itemMatchGroup(item) !== resultMatchFilter.value) return false;
  if (resultSearchLimitedOnly.value && !itemHasSupplierSearchLimit(item)) return false;
  return true;
}));

const resultFiltersActive = computed(() =>
  resultTextSearchActive.value
  || resultMatchFilter.value !== 'all'
  || resultSearchLimitedOnly.value,
);

// 정렬 — 시안(87:12875)의 "가격순". 합계가 없는 행(구매 조건 미선정·문의 견적)은 값으로 비교할 수
// 없으니 방향과 무관하게 뒤로 보낸다. 원소 참조는 그대로라 행 격리(재렌더 스킵)가 유지된다.
type ResultSort = 'default' | 'price-desc' | 'price-asc';
const RESULT_SORT_LABEL: Record<ResultSort, string> = {
  default: '기본순',
  'price-desc': '가격 높은순',
  'price-asc': '가격 낮은순',
};
const resultSort = ref<ResultSort>('default');

const sortedItems = computed(() => {
  if (resultSort.value === 'default') return filteredItems.value;
  const dir = resultSort.value === 'price-desc' ? -1 : 1;
  return [...filteredItems.value].sort((a, b) => {
    if (a.lineTotalKrw === null && b.lineTotalKrw === null) return 0;
    if (a.lineTotalKrw === null) return 1;
    if (b.lineTotalKrw === null) return -1;
    return (a.lineTotalKrw - b.lineTotalKrw) * dir;
  });
});

// 전체 선택 — 각 행의 체크박스와 같은 뜻(견적 포함 여부)이다. 수량 미확인 행은 개별 토글에서도
// 막혀 있으므로 대상에서 뺀다. 로컬 편집 후 markDirty 라 저장은 1초 디바운스로 한 번만 나간다.
const includableItems = computed(() => sortedItems.value.filter((item) => item.quantityState !== 'missing'));
const allIncluded = computed(() =>
  includableItems.value.length > 0 && includableItems.value.every((item) => item.included),
);
const someIncluded = computed(() => includableItems.value.some((item) => item.included));

function toggleIncludeAll(): void {
  if (!isDraft.value || editingLocked.value || includableItems.value.length === 0) return;
  const next = !allIncluded.value;
  for (const item of includableItems.value) item.included = next;
  markDirty();
}
const activeMatchFilterLabel = computed(() => (
  resultMatchFilter.value === 'all' ? null : RESULT_MATCH_FILTER_LABEL[resultMatchFilter.value]
));

function scrollResultsToTop(): void {
  void nextTick(() => {
    if (resultsScrollEl.value !== null) resultsScrollEl.value.scrollTop = 0;
  });
}

// 결과 행 가상 스크롤 — 화면에 보이는 행(+ overscan)만 DOM 에 둔다. 행 하나가 50여 노드라
// 수백 행이면 리사이즈·스크롤마다 그 전부를 다시 레이아웃하느라 버벅였다.
// 행 높이는 가격구간 확장·수량 확인 버튼·상태 배지 수에 따라 달라서 고정값을 쓸 수 없고,
// estimateSize 는 첫 배치용 추정치일 뿐 실제 높이는 measureRow 가 ResizeObserver 로 잰다.
const ROW_ESTIMATED_HEIGHT = 128;

const rowVirtualizer = useVirtualizer(computed(() => {
  // 스크롤 요소를 여기서 꺼내 둬야 이 computed 의 의존성으로 등록된다. getScrollElement 안에서만
  // 읽으면 ref 가 null → 요소로 바뀌어도 옵션이 갱신되지 않아 스크롤에 반응하지 않는다.
  const scrollElement = resultsScrollEl.value;
  return {
    count: sortedItems.value.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_ESTIMATED_HEIGHT,
    overscan: 6,
    getItemKey: (index: number) => sortedItems.value[index]?.id ?? index,
  };
}));

// 가상 행과 실제 항목을 짝지어 둔다 — 목록이 줄어드는 순간의 인덱스 불일치를 여기서 흡수한다.
const virtualRowItems = computed(() => rowVirtualizer.value.getVirtualItems().flatMap((row) => {
  const item = sortedItems.value[row.index];
  return item === undefined ? [] : [{ row, item }];
}));

// 위아래 여백은 스페이서 행으로 채운다 — table-fixed 라 열 폭은 렌더된 행 수와 무관하다.
const virtualPaddingTop = computed(() => virtualRowItems.value[0]?.row.start ?? 0);
const virtualPaddingBottom = computed(() => {
  const last = virtualRowItems.value.at(-1);
  return last === undefined ? 0 : rowVirtualizer.value.getTotalSize() - last.row.end;
});

function measureRow(el: unknown): void {
  const dom = el !== null && typeof el === 'object' && '$el' in el ? el.$el : el;
  if (dom instanceof HTMLElement) rowVirtualizer.value.measureElement(dom);
}

function selectResultSheet(key: ResultSheetFilter): void {
  activeResultSheet.value = key;
  scrollResultsToTop();
}

function clearResultFilters(): void {
  resultTextQuery.value = '';
  resultMatchFilter.value = 'all';
  resultSearchLimitedOnly.value = false;
  scrollResultsToTop();
}

function toggleResultMatchFilter(filter: SpecificResultMatchFilter): void {
  resultMatchFilter.value = resultMatchFilter.value === filter ? 'all' : filter;
  scrollResultsToTop();
}

function showSupplierSearchLimitedItems(): void {
  activeResultSheet.value = 'all';
  resultSearchLimitedOnly.value = true;
  scrollResultsToTop();
}

watch(quoteId, clearResultFilters);
watch(resultTextQuery, scrollResultsToTop);
watch(enriching, (active) => {
  // 확인 중에는 Review/Unmatched/Nostock 최종 분류가 아직 확정되지 않는다.
  // 단일 행 조건 재검색은 현재 검토 문맥을 유지하고 완료된 행만 목록에서 자연스럽게 빠진다.
  if (
    active
    && !rowSearchRunning.value
    && (
      resultMatchFilter.value === 'review'
      || resultMatchFilter.value === 'unmatched'
      || resultMatchFilter.value === 'nostock'
    )
  ) {
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
const searchRequirementsMutation = useUpdateBomQuoteSearchRequirements();
const searchRequirementsError = ref('');
const externalSupplierSearchMutation = useRunBomQuoteExternalSupplierSearch();
const externalSupplierSearchError = ref('');
const passiveDefaultsMutation = useApplyBomQuotePassiveDefaults();
const passiveDefaultsOpen = ref(false);
const passiveDefaultsError = ref('');
const resistorDefaultTolerance = ref('1%');
const capacitorDefaultTolerance = ref('10%');
const capacitorDefaultVoltage = ref('25V');
const catalogSelectionPending = ref(false);

const candidateRowSearchActive = computed(() =>
  rowSearchItemId.value !== null
  && candidateItemId.value === rowSearchItemId.value
  && selectionSurface.value === 'candidates',
);
const candidateRowSearchLocked = computed(() =>
  candidateRowSearchActive.value && rowSearchRunning.value,
);
const candidateRowSearchProgress = computed(() => {
  if (!candidateRowSearchActive.value) return '';
  if (rowSearchPhase.value === 'starting') {
    return rowSearchKind.value === 'external'
      ? '외부 공급사 추가 검색을 시작하고 있습니다.'
      : '검색 조건을 저장하고 있습니다.';
  }
  if (rowSearchPhase.value === 'searching') {
    return rowSearchKind.value === 'external'
      ? '이 행을 외부 공급사에서 추가 검색하고 있습니다.'
      : '이 행의 공급사 후보를 다시 검색하고 있습니다.';
  }
  if (rowSearchPhase.value === 'refreshing') return '검색이 끝나 새 후보를 반영하고 있습니다.';
  return '';
});

const addWorkspaceOpen = ref(false);
const addWorkspaceOpening = ref(false);
const manualItemUpsert = useUpsertBomQuoteManualItem();
const manualItemRemove = useRemoveBomQuoteManualItem();
const manualPendingKey = ref<string | null>(null);
const manualPendingItemId = ref<string | null>(null);
const manualRemovingItemId = ref<string | null>(null);
const manualItemError = ref<string | null>(null);

watch(quoteId, () => {
  passiveDefaultsOpen.value = false;
  passiveDefaultsError.value = '';
  addWorkspaceOpen.value = false;
  manualItemError.value = null;
  clearRowSearchState();
});

const offerModal = ref<{ lineIdx: number; partId: string } | null>(null);

watch(editingLocked, (locked) => {
  if (!locked) return;
  // 열려 있던 선택 모달에서 검색 도중 변경이 들어가는 경로도 차단한다.
  passiveDefaultsOpen.value = false;
  offerModal.value = null;
  addWorkspaceOpen.value = false;
  // 현재 행 조건 재검색은 패널·필터·스크롤을 유지하되 패널 안의 변경 동작만 잠근다.
  if (candidateRowSearchLocked.value) return;
  candidateItemId.value = null;
  selectionSurface.value = null;
});

function openPassiveDefaults(): void {
  if (!isDraft.value || editingLocked.value) return;
  passiveDefaultsError.value = '';
  passiveDefaultsOpen.value = true;
}

async function applyPassiveDefaults(): Promise<void> {
  if (!isDraft.value || editingLocked.value || passiveDefaultsMutation.isPending.value) return;
  const body: BomQuotePassiveDefaultsBodyType = {
    resistorTolerance: resistorDefaultTolerance.value.trim(),
    capacitorTolerance: capacitorDefaultTolerance.value.trim(),
    capacitorVoltage: capacitorDefaultVoltage.value.trim(),
    capacitorDielectricPolicy: 'capacitance-aware-conservative',
  };
  if (
    body.resistorTolerance === ''
    || body.capacitorTolerance === ''
    || body.capacitorVoltage === ''
  ) {
    passiveDefaultsError.value = '공차와 정격전압 기본값을 모두 입력해 주세요.';
    return;
  }
  if (dirty.value) {
    await saveNow();
    if (saveState.value === 'error') {
      passiveDefaultsError.value = '저장되지 않은 변경사항이 있습니다. 저장 상태를 확인해 주세요.';
      return;
    }
  }
  passiveDefaultsError.value = '';
  try {
    await passiveDefaultsMutation.mutateAsync({ quoteId: quoteId.value, body });
    passiveDefaultsOpen.value = false;
    dirty.value = false;
  } catch (reason) {
    const code = reason instanceof ApiRequestError ? reason.payload?.error : undefined;
    passiveDefaultsError.value = code === 'SUPPLIER_SEARCH_NOT_STARTED'
      ? '기본조건은 확인했지만 공급사 검색을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.'
      : code === 'SUPPLIER_SEARCH_FAILED'
        ? '공급사 검색 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        : '기본 검색조건을 적용하지 못했습니다. 입력값을 확인해 주세요.';
  }
}

function manualItemMutationMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return '부품을 현재 BOM에 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  if (error.status === 409) return error.message || '선택한 구매 조건이 변경되었습니다. 다시 검색해 주세요.';
  if (error.status === 404) return '견적 또는 수동 추가 부품을 찾을 수 없습니다. 화면을 새로고침해 주세요.';
  return error.message || '부품을 현재 BOM에 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

async function openAddWorkspace(): Promise<void> {
  if (editingLocked.value || addWorkspaceOpening.value) return;
  addWorkspaceOpening.value = true;
  manualItemError.value = null;
  try {
    if (dirty.value) {
      await saveNow();
      if (saveState.value === 'error') {
        manualItemError.value = '저장되지 않은 변경사항이 있습니다. 자동저장 상태를 확인한 뒤 다시 시도해 주세요.';
        return;
      }
    }
    addWorkspaceOpen.value = true;
  } finally {
    addWorkspaceOpening.value = false;
  }
}

async function upsertManualItem(
  body: BomSearchCartAddBodyType,
  key: string | null,
  itemId: string | null = null,
): Promise<void> {
  if (editingLocked.value || manualItemUpsert.isPending.value) return;
  manualPendingKey.value = key;
  manualPendingItemId.value = itemId;
  manualItemError.value = null;
  try {
    const saved = await manualItemUpsert.mutateAsync({ quoteId: quoteId.value, body });
    dirty.value = false;
    applyServerDetail(saved.data);
  } catch (error: unknown) {
    manualItemError.value = manualItemMutationMessage(error);
  } finally {
    manualPendingKey.value = null;
    manualPendingItemId.value = null;
  }
}

async function removeManualItem(item: BomQuoteItemType): Promise<void> {
  if (editingLocked.value || manualItemRemove.isPending.value || !/^\d+$/.test(item.id)) return;
  manualRemovingItemId.value = item.id;
  manualItemError.value = null;
  try {
    const saved = await manualItemRemove.mutateAsync({ quoteId: quoteId.value, itemId: item.id });
    dirty.value = false;
    applyServerDetail(saved.data);
  } catch (error: unknown) {
    manualItemError.value = manualItemMutationMessage(error);
  } finally {
    manualRemovingItemId.value = null;
  }
}

async function removeManualSelection(partId: string, key: string): Promise<void> {
  const item = items.value.find((candidate) =>
    candidate.manualEntry === true
    && candidate.partId === partId
    && bomQuoteItemSelectionKey(candidate) === key);
  if (item !== undefined) await removeManualItem(item);
}

function updateManualItemQuantity(item: BomQuoteItemType, quantity: number): void {
  if (item.partId === null) return;
  const selection = bomQuoteItemSelection(item);
  if (selection === null) return;
  void upsertManualItem({ partId: item.partId, bomQty: quantity, selection }, null, item.id);
}

function activateCandidateDrawer(itemId: string, view: CandidateDrawerView): void {
  if (rowSearchItemId.value !== null && rowSearchItemId.value !== itemId && !rowSearchRunning.value) {
    clearRowSearchState();
  }
  candidateSelectionError.value = '';
  searchRequirementsError.value = '';
  externalSupplierSearchError.value = '';
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
  window.addEventListener('keydown', onCompactPanelKeydown);
  window.addEventListener('keydown', onPartDataPreparationKeydown);
});
onBeforeUnmount(() => {
  compactRightOpen.value = false;
  window.removeEventListener('keydown', onCompactPanelKeydown);
  window.removeEventListener('keydown', onPartDataPreparationKeydown);
  resultsScrollResizeObserver?.disconnect();
  cancelRowSearchNoticeTimer();
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
  searchRequirementsError.value = '';
  externalSupplierSearchError.value = '';
  if (!rowSearchRunning.value) clearRowSearchState();
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
        ? '가격이 없는 구매 조건은 선택할 수 없습니다.'
        : '후보 선택을 적용하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    return false;
  }
}

async function selectCandidateAndClose(candidateKey: string, offerKey: string | null): Promise<void> {
  const selected = await selectCandidate(candidateKey, offerKey);
  if (selected) closeSelectionSurface();
}

async function updateSearchRequirements(
  requirements: BomQuoteSearchRequirementsBodyType,
): Promise<void> {
  if (candidateItemId.value === null || editingLocked.value) return;
  if (dirty.value) {
    await saveNow();
    if (saveState.value === 'error') {
      searchRequirementsError.value = '저장되지 않은 변경사항이 있습니다. 저장 상태를 확인해 주세요.';
      return;
    }
  }
  cancelRowSearchNoticeTimer();
  rowSearchItemId.value = candidateItemId.value;
  rowSearchPhase.value = 'starting';
  rowSearchKind.value = 'requirements';
  rowSearchNotice.value = '';
  rowSearchPreviousCandidateCount.value = candidateQuery.data.value?.data.candidates.length ?? null;
  rowSearchPreviousMatchGroup.value = candidateItem.value === null
    ? null
    : itemMatchGroup(candidateItem.value);
  searchRequirementsError.value = '';
  try {
    await searchRequirementsMutation.mutateAsync({
      quoteId: quoteId.value,
      itemId: candidateItemId.value,
      body: requirements,
    });
    rowSearchPhase.value = 'searching';
    dirty.value = false;
  } catch (reason) {
    const code = reason instanceof ApiRequestError ? reason.payload?.error : undefined;
    searchRequirementsError.value = code === 'SUPPLIER_SEARCH_NOT_STARTED'
      ? '검색조건은 저장했지만 공급사 검색을 시작하지 못했습니다. 값을 확인한 뒤 다시 시도해 주세요.'
      : code === 'SEARCH_COMPONENT_NOT_FOUND'
        ? '원본 BOM 컴포넌트와 연결되지 않은 행은 조건 검색을 사용할 수 없습니다.'
        : code === 'SEARCH_REQUIREMENTS_INVALID'
          ? '엔진이 검색조건을 해석하지 못했습니다. 단위와 필수 항목을 확인해 주세요.'
          : code === 'SEARCH_REQUIREMENTS_VALIDATION_FAILED'
            ? '검색 엔진에 조건을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'
            : '검색조건을 저장하거나 행 재검색을 시작하지 못했습니다. 입력값을 확인해 주세요.';
    await Promise.all([quote.refetch(), candidateQuery.refetch()]);
    rowSearchPhase.value = detail.value?.enrichStatus === 'searching' ? 'searching' : 'failed';
  }
}

async function runExternalSupplierSearch(): Promise<void> {
  if (candidateItemId.value === null || editingLocked.value) return;
  if (dirty.value) {
    await saveNow();
    if (saveState.value === 'error') {
      externalSupplierSearchError.value =
        '저장되지 않은 변경사항이 있습니다. 저장 상태를 확인해 주세요.';
      return;
    }
  }
  cancelRowSearchNoticeTimer();
  rowSearchItemId.value = candidateItemId.value;
  rowSearchPhase.value = 'starting';
  rowSearchKind.value = 'external';
  rowSearchNotice.value = '';
  rowSearchPreviousCandidateCount.value =
    candidateQuery.data.value?.data.candidates.length ?? null;
  rowSearchPreviousMatchGroup.value = candidateItem.value === null
    ? null
    : itemMatchGroup(candidateItem.value);
  externalSupplierSearchError.value = '';
  try {
    await externalSupplierSearchMutation.mutateAsync({
      quoteId: quoteId.value,
      itemId: candidateItemId.value,
    });
    rowSearchPhase.value = 'searching';
    dirty.value = false;
  } catch (reason) {
    const code = reason instanceof ApiRequestError
      ? reason.payload?.error
      : undefined;
    externalSupplierSearchError.value =
      code === 'EXTERNAL_SUPPLIER_SEARCH_NOT_AVAILABLE'
        ? '현재 행은 외부 검색 생략 실험 대상이 아닙니다. 후보 정보를 새로고침해 주세요.'
        : code === 'SUPPLIER_SEARCH_NOT_STARTED'
          ? '외부 공급사 검색을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.'
          : '외부 공급사 검색 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    await Promise.all([quote.refetch(), candidateQuery.refetch()]);
    rowSearchPhase.value =
      detail.value?.enrichStatus === 'searching' ? 'searching' : 'failed';
  }
}

function rowSearchMatchLabel(group: SpecificResultMatchFilter): string {
  if (group === 'matched') return '매칭';
  if (group === 'review') return '검토 필요';
  if (group === 'nostock') return '재고 확인 필요';
  if (group === 'excluded') return '검색 제외';
  return '미매칭';
}

function scheduleRowSearchNoticeClear(): void {
  cancelRowSearchNoticeTimer();
  rowSearchNoticeTimer = setTimeout(() => {
    if (rowSearchPhase.value === 'done') clearRowSearchState();
  }, 6_000);
}

watch(
  () => detail.value?.enrichStatus,
  async (now, previous) => {
    const itemId = rowSearchItemId.value;
    if (itemId === null) return;
    if (now === 'searching') {
      rowSearchPhase.value = 'searching';
      return;
    }
    if (previous !== 'searching') return;
    if (now === 'failed') {
      rowSearchPhase.value = 'failed';
      const message = '행 재검색을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      if (rowSearchKind.value === 'external') {
        externalSupplierSearchError.value = message;
      } else {
        searchRequirementsError.value =
          '행 재검색을 완료하지 못했습니다. 입력값은 유지되어 있으니 잠시 후 다시 시도해 주세요.';
      }
      return;
    }
    if (now !== 'done') return;

    rowSearchPhase.value = 'refreshing';
    if (candidateItemId.value === itemId && selectionSurface.value === 'candidates') {
      const refreshed = await candidateQuery.refetch();
      if (rowSearchItemId.value !== itemId) return;
      if (refreshed.isError) {
        rowSearchPhase.value = 'failed';
        const message =
          '재검색은 완료됐지만 새 후보를 불러오지 못했습니다. 패널을 닫았다가 다시 열어 주세요.';
        if (rowSearchKind.value === 'external') {
          externalSupplierSearchError.value = message;
        } else {
          searchRequirementsError.value = message;
        }
        return;
      }
      const nextCandidateCount = refreshed.data?.data.candidates.length ?? 0;
      const previousCandidateCount = rowSearchPreviousCandidateCount.value;
      const countLabel = previousCandidateCount === null || previousCandidateCount === nextCandidateCount
        ? `후보 ${String(nextCandidateCount)}개 갱신`
        : `후보 ${String(previousCandidateCount)}개 → ${String(nextCandidateCount)}개`;
      const nextItem = candidateItem.value;
      const previousGroup = rowSearchPreviousMatchGroup.value;
      const nextGroup = nextItem === null ? null : itemMatchGroup(nextItem);
      const statusLabel = previousGroup !== null && nextGroup !== null && previousGroup !== nextGroup
        ? `${rowSearchMatchLabel(previousGroup)} → ${rowSearchMatchLabel(nextGroup)} · `
        : '';
      rowSearchNotice.value = `재검색 완료 · ${statusLabel}${countLabel}`;
    }
    rowSearchPhase.value = 'done';
    scheduleRowSearchNoticeClear();
  },
);

async function selectQuoteOffer(candidateKey: string, offerKey: string): Promise<void> {
  await selectCandidateAndClose(candidateKey, offerKey);
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

function applyCatalogPart(part: PartHitType, pick: OfferPick | null, lineIdx: number): boolean {
  if (editingLocked.value) return false;
  if (enriching.value) return false;

  const item = items.value[lineIdx];
  if (item === undefined) return false;
  item.mpn = part.mpn;
  item.manufacturerName = part.manufacturerName;
  item.description = part.description;
  item.partImageUrl = part.imageUrl;
  item.partDatasheetUrl = null; // 부품이 바뀌었으니 이전 링크 무효 — 다음 상세 조회 때 재채움
  item.catalogInquiry = part.hasCatalogInquiryOffer && pick === null;
  item.identityPreview = null;
  item.matchStatus = 'manual';
  item.selectedCandidateKey = null;
  item.selectionSource = 'catalog';
  item.partId = part.id;
  item.selectedOffer = null;
  if (pick !== null) {
    // 추천값이어도 고객이 공급 포장·공급사를 확인하고 확정한 직접 선택이다.
    applyOfferPick(pick, true, lineIdx, part.id);
  } else {
    recalcLine(item);
    markDirty();
  }
  return true;
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
    const applied = applyCatalogPart(part, pick, lineIdx);
    if (applied) closeSelectionSurface();
    else candidateSelectionError.value = '선택한 구매 조건을 현재 행에 적용하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    catalogSelectionPending.value = false;
  }
}

// ── 견적요청·취소 ────────────────────────────────────────────────────────────
const request = useRequestBomQuote();
const cancel = useCancelBomQuote();

// ── 주문 전환(D16) — 확정 견적 → 영카트 주문서 직행 ─────────────────────────
const orderMut = useOrderBomQuote();
const orderError = ref('');
const canOrder = computed(
  () =>
    detail.value?.status === 'answered' &&
    detail.value.confirmedTotal !== null &&
    detail.value.orderState !== 'ordered',
);

async function orderNow(): Promise<void> {
  if (detail.value === null) return;
  orderError.value = '';
  try {
    const res = await orderMut.mutateAsync(detail.value.id);
    window.location.href = res.data.redirectUrl; // 영카트 주문서로 전체 이동
  } catch (e) {
    orderError.value =
      e instanceof ApiRequestError && e.status === 409
        ? '주문으로 전환할 수 없습니다 — 새로고침 후 다시 시도해 주세요.'
        : '주문 전환에 실패했습니다.';
  }
}
// ── 견적서 인쇄(§6.8) — 회신 완료+확정가 시만(서버 게이트와 동일 조건) ─────────
const estimateOpen = ref(false);
const canViewEstimate = computed(
  () =>
    detail.value !== null &&
    (detail.value.status === 'answered' || detail.value.status === 'closed') &&
    detail.value.confirmedTotal !== null,
);
const loadEstimatePrint = async () => {
  const res = await apiGet(
    `${apiRoutes.bom}/quotes/${detail.value?.id ?? ''}/print`,
    BomQuotePrintResponse,
  );
  return res.data;
};

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

// 작성 중·취소 견적 삭제 — 하드 삭제(항목·원본 파일 정리).
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
    // 삭제 가능 상태가 아님 등 — 화면 갱신으로 확인
  }
}

const downloadPending = ref(false);
const downloadError = ref('');

async function downloadOriginal(): Promise<void> {
  if (downloadPending.value || quoteId.value === '') return;
  downloadPending.value = true;
  downloadError.value = '';
  try {
    const blob = await apiGetBlob(
      `${apiRoutes.bom}/quotes/${encodeURIComponent(quoteId.value)}/file`,
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = detail.value?.fileName ?? 'bom.xlsx';
    anchor.click();
    URL.revokeObjectURL(url);
  } catch {
    downloadError.value = '원본 BOM을 내려받지 못했습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    downloadPending.value = false;
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
    <section v-else-if="isParsing" class="m-6 rounded-2xl border border-gray-200 bg-surface p-10 text-center shadow-sm">
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
    <section v-else-if="isSelecting && detail" class="m-6 mx-auto flex h-[calc(100%-3rem)] min-h-0 w-[min(920px,calc(100%-3rem))] flex-col rounded-2xl border border-gray-200 bg-surface p-6 shadow-sm">
      <div class="shrink-0 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.14em] text-blue-600">Sheet selection</p>
          <h1 class="mt-1 text-xl font-bold text-gray-950">계산할 BOM 시트를 선택해 주세요</h1>
          <p class="mt-2 text-sm leading-6 text-gray-500">선택한 시트의 부품만 가격·재고를 검색하고 견적 합계에 반영합니다. 여러 시트를 함께 선택할 수 있습니다.</p>
        </div>
        <button type="button" class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50" @click="router.push({ name: 'bom' })">다른 파일 업로드</button>
      </div>

      <div class="mt-6 grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pr-2 md:grid-cols-2">
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
      <div class="mt-6 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-5">
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

    <section v-else-if="isBuildFailed && detail" class="m-6 rounded-2xl border border-red-100 bg-surface p-8 shadow-sm">
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
    <div v-else-if="detail && detail.buildStatus === 'ready'" class="bom-quote-workbench flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5 xl:flex-row xl:gap-[16px] xl:overflow-visible xl:py-[14px] xl:pl-[16px] xl:pr-0">
      <!-- 좌: 파일명·액션(고정) + 테이블(내부 스크롤) -->
      <section class="flex min-h-0 min-w-0 flex-1 flex-col max-md:pb-[68px]">
        <!-- file name + 액션 (87:13178~) -->
        <div class="flex flex-wrap items-start justify-between gap-3 px-1">
          <div class="relative -top-[5px]">
            <div class="flex flex-wrap items-center gap-[10px]">
              <div v-if="titleEditing" class="mr-[6px] flex min-w-0 items-center gap-1">
                <label for="bom-quote-title" class="sr-only">견적명</label>
                <input
                  id="bom-quote-title"
                  ref="titleInput"
                  v-model="titleDraft"
                  type="text"
                  maxlength="191"
                  class="h-8 w-[300px] max-w-[42vw] rounded-[6px] border border-brand-soft bg-surface px-2.5 font-noto text-[16px] font-medium text-ink-strong outline-none ring-2 ring-brand-soft/15 placeholder:text-ink-faint disabled:cursor-wait disabled:opacity-60"
                  placeholder="견적명"
                  :disabled="titleSaving"
                  @input="titleError = ''"
                  @keydown.enter.prevent="saveQuoteTitle"
                  @keydown.esc.prevent="cancelQuoteTitleEdit"
                >
                <button
                  type="button"
                  class="grid size-7 shrink-0 place-items-center rounded-[5px] bg-brand-strong text-[15px] font-bold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-50"
                  :disabled="titleSaving"
                  aria-label="견적명 저장"
                  title="저장"
                  @click="saveQuoteTitle"
                >
                  ✓
                </button>
                <button
                  type="button"
                  class="grid size-7 shrink-0 place-items-center rounded-[5px] border border-line-strong bg-surface text-[17px] leading-none text-ink-muted hover:bg-surface-raised hover:text-ink disabled:opacity-50"
                  :disabled="titleSaving"
                  aria-label="견적명 변경 취소"
                  title="취소"
                  @click="cancelQuoteTitleEdit"
                >
                  ×
                </button>
              </div>
              <div v-else class="mr-[6px] flex min-w-0 items-center gap-1">
                <h1 class="max-w-[360px] truncate text-[18px] font-medium leading-[21px] text-ink-strong" :title="detail.fileName ?? detail.title">{{ detail.fileName ?? detail.title }}</h1>
                <button
                  v-if="canRenameTitle"
                  type="button"
                  class="grid size-7 shrink-0 place-items-center rounded-[5px] text-ink-muted hover:bg-surface-raised hover:text-brand-strong disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="editingLocked || patch.isPending.value"
                  :title="editingLocked ? EDIT_LOCK_TITLE : '견적명 변경'"
                  aria-label="견적명 변경"
                  @click="openQuoteTitleEdit"
                >
                  <svg aria-hidden="true" class="size-[15px]" viewBox="0 0 16 16" fill="none">
                    <path d="M3 11.75V13h1.25L12.6 4.65 11.35 3.4 3 11.75Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
                    <path d="m10.5 4.25 1.25 1.25" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                  </svg>
                </button>
              </div>
              <button
                type="button"
                class="flex h-8 w-[82px] shrink-0 items-center justify-center gap-1 rounded-md border border-brand-soft bg-surface font-noto text-[14px] font-bold leading-6 text-brand-soft hover:bg-surface-brand-soft"
                title="새 BOM 업로드"
                @click="router.push({ name: 'bom' })"
              >
                <img :src="icUploadOutline" alt="" class="size-[15px] shrink-0"> 업로드
              </button>
              <button
                type="button"
                class="flex h-8 w-[91px] shrink-0 items-center justify-center gap-1 rounded-md border border-brand-soft bg-surface font-noto text-[14px] font-bold leading-6 text-brand-soft hover:bg-surface-brand-soft disabled:cursor-wait disabled:opacity-60"
                :disabled="downloadPending"
                :title="downloadPending ? '원본 BOM 다운로드 중' : '원본 BOM 다운로드'"
                @click="downloadOriginal"
              >
                <img :src="icDownloadOutline" alt="" class="size-[15px] shrink-0"> {{ downloadPending ? '준비 중' : '다운로드' }}
              </button>
              <span class="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">{{ STATUS_LABEL[detail.status] }}</span>
              <span v-if="refreshedNotice" class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">가격·재고 확인 완료 — 최신 결과로 갱신되었습니다</span>
            </div>
            <p v-if="titleError !== ''" class="mt-1 text-[11px] font-medium text-red-600" role="alert">{{ titleError }}</p>
            <p v-if="downloadError !== ''" class="mt-1 pl-6 text-xs text-red-600">{{ downloadError }}</p>
            <div class="mt-[-2px] flex flex-wrap items-center gap-1.5 font-noto text-[13px] font-medium leading-[16px] text-ink-muted">
              <span>{{ quoteStats.total }}개 부품</span>
              <span v-if="showResultSheetTabs" class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{{ selectedResultSheets.length }}개 시트</span>
              <template v-else>
                <span v-for="sheet in selectedResultSheets" :key="sheet.sheetIndex" class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{{ sheet.sheetName }}</span>
              </template>
            </div>
          </div>
          <div class="flex items-center gap-[12px]">
            <span v-if="isDraft" class="mr-1 text-xs text-gray-400">
              <template v-if="saveState === 'saving'">저장 중…</template>
              <template v-else-if="saveState === 'saved' && !dirty">자동 저장됨</template>
              <template v-else-if="saveState === 'error'"><span class="text-red-500">저장 실패</span></template>
            </span>
            <button
              v-if="isDraft && manageableResultSheets.length > 1"
              type="button"
              class="flex h-[38px] items-center gap-1.5 rounded-lg border border-gray-300 bg-surface px-3 text-[13px] font-semibold text-ink-soft hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-45"
              :disabled="editingLocked || patch.isPending.value"
              :title="editingLocked ? EDIT_LOCK_TITLE : '견적에 포함할 시트 관리'"
              @click="openSheetManager"
            >
              <span aria-hidden="true">⊞</span>
              시트 {{ selectedResultSheets.length }}/{{ manageableResultSheets.length }}
            </button>
            <button
              type="button"
              class="flex h-[42px] w-[123px] items-center justify-center gap-[5px] rounded-[6px] border border-bom-button-quiet-border bg-bom-button-quiet px-0 font-noto text-[16px] font-bold leading-[24px] text-bom-button-quiet-text transition-colors hover:border-brand-soft hover:bg-surface-raised hover:text-brand-soft"
              title="Excel 원본과 공급사 검색 결과 비교"
              @click="compareOpen = true"
            >
              <span class="flex size-[18px] shrink-0 items-center justify-center" aria-hidden="true">
                <img :src="icBomCompareEye" alt="" class="bom-compare-icon shrink-0">
              </span>
              BOM 비교
            </button>
            <!-- 사용자 화면에서는 숨기되 재활성화를 위해 누락조건 적용 흐름은 유지한다. -->
            <button
              v-if="isDraft && hasPassiveDefaultsOpportunity"
              type="button"
              class="hidden h-[38px] items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 text-[13px] font-semibold text-amber-800 hover:border-amber-400 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45"
              :disabled="editingLocked"
              :title="editingLocked ? EDIT_LOCK_TITLE : '저항·MLCC의 누락 필수조건을 한 번 확인하고 다시 검색'"
              @click="openPassiveDefaults"
            >
              <span aria-hidden="true">✓</span>
              누락 조건 적용
            </button>
            <button
              v-if="isDraft"
              type="button"
              class="flex h-[42px] w-[88px] items-center justify-center gap-[6px] rounded-[6px] bg-brand-strong px-0 font-noto text-[16px] font-bold leading-6 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:hover:bg-blue-300"
              :disabled="editingLocked || addWorkspaceOpening"
              :title="editingLocked ? EDIT_LOCK_TITLE : '단일 검색 방식으로 부품 추가'"
              @click="openAddWorkspace"
            >
              <span class="text-[18px] leading-none">+</span> {{ addWorkspaceOpening ? '준비' : '추가' }}
            </button>
          </div>
        </div>

        <!-- 모바일 요약 — 태블릿은 우측 엣지 핸들로 패널 존재를 지속적으로 알린다. -->
        <div
          v-show="!compactRightOpen"
          class="fixed left-[10px] right-[10px] z-30 flex min-h-[54px] items-center gap-3 rounded-xl border border-bom-panel-border bg-bom-panel px-3 py-2 shadow-[0_10px_30px_rgba(15,23,42,0.2)] md:hidden"
          style="bottom: max(10px, env(safe-area-inset-bottom));"
        >
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2 text-[11px] font-semibold text-bom-panel-label">
              <span class="shrink-0 text-bom-panel-heading">AI 분석</span>
              <span class="truncate">전체 {{ stats.total }} · 검토 {{ stats.review }} · 미매칭 {{ stats.unmatched }}</span>
            </div>
            <p class="mt-0.5 truncate text-[12px] font-bold tabular-nums text-brand">
              {{ pricingPending ? '가격 확인 중…' : `예상 ${fmtAmount(finalTotal)}원` }}
            </p>
          </div>
          <button
            type="button"
            class="h-8 shrink-0 rounded-lg bg-brand-strong px-3 text-[12px] font-bold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            :aria-expanded="compactRightOpen"
            aria-controls="bom-quote-side-panel"
            @click="openCompactRightPanel"
          >
            분석·견적 상세
          </button>
        </div>

        <!-- 자주 쓰는 분석 필터는 패널을 열지 않고도 적용할 수 있다. -->
        <div class="mt-2 flex shrink-0 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin] xl:hidden" aria-label="BOM 분석 결과 빠른 필터">
          <button
            type="button"
            class="h-7 shrink-0 rounded-full border px-3 text-[11px] font-semibold transition"
            :class="!resultFiltersActive ? 'border-blue-600 bg-blue-600 text-white' : 'border-line-strong bg-surface text-ink-muted hover:border-blue-400 hover:text-blue-700'"
            :aria-pressed="!resultFiltersActive"
            aria-controls="bom-results-table"
            @click="clearResultFilters"
          >
            전체 {{ stats.total }}
          </button>
          <button
            type="button"
            class="h-7 shrink-0 rounded-full border px-3 text-[11px] font-semibold transition disabled:cursor-default disabled:opacity-40"
            :class="resultMatchFilter === 'matched' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-line-strong bg-surface text-ink-muted hover:border-emerald-400 hover:text-emerald-700'"
            :disabled="stats.matched === 0"
            :aria-pressed="resultMatchFilter === 'matched'"
            aria-controls="bom-results-table"
            @click="toggleResultMatchFilter('matched')"
          >
            매칭 {{ stats.matched }}
          </button>
          <button
            type="button"
            class="h-7 shrink-0 rounded-full border px-3 text-[11px] font-semibold transition disabled:cursor-default disabled:opacity-40"
            :class="resultMatchFilter === 'review' ? 'border-orange-600 bg-orange-600 text-white' : 'border-line-strong bg-surface text-ink-muted hover:border-orange-400 hover:text-orange-700'"
            :disabled="enriching || stats.review === 0"
            :aria-pressed="!enriching && resultMatchFilter === 'review'"
            aria-controls="bom-results-table"
            @click="toggleResultMatchFilter('review')"
          >
            검토 {{ stats.review }}
          </button>
          <button
            type="button"
            class="h-7 shrink-0 rounded-full border px-3 text-[11px] font-semibold transition disabled:cursor-default disabled:opacity-40"
            :class="resultMatchFilter === 'unmatched' ? 'border-rose-500 bg-rose-500 text-white' : 'border-line-strong bg-surface text-ink-muted hover:border-rose-400 hover:text-rose-700'"
            :disabled="enriching || stats.unmatched === 0"
            :aria-pressed="!enriching && resultMatchFilter === 'unmatched'"
            aria-controls="bom-results-table"
            @click="toggleResultMatchFilter('unmatched')"
          >
            {{ enriching ? '확인 중' : '미매칭' }} {{ enriching ? stats.unresolved : stats.unmatched }}
          </button>
          <button
            type="button"
            class="h-7 shrink-0 rounded-full border px-3 text-[11px] font-semibold transition disabled:cursor-default disabled:opacity-40"
            :class="resultMatchFilter === 'nostock' ? 'border-yellow-600 bg-yellow-500 text-white' : 'border-line-strong bg-surface text-ink-muted hover:border-yellow-400 hover:text-yellow-700'"
            :disabled="stats.nostock === 0"
            :aria-pressed="resultMatchFilter === 'nostock'"
            aria-controls="bom-results-table"
            @click="toggleResultMatchFilter('nostock')"
          >
            재고 {{ stats.nostock }}
          </button>
          <button
            type="button"
            class="h-7 shrink-0 rounded-full border px-3 text-[11px] font-semibold transition disabled:cursor-default disabled:opacity-40"
            :class="resultMatchFilter === 'excluded' ? 'border-slate-600 bg-slate-600 text-white' : 'border-line-strong bg-surface text-ink-muted hover:border-slate-400 hover:text-slate-700'"
            :disabled="enriching || stats.excluded === 0"
            :aria-pressed="!enriching && resultMatchFilter === 'excluded'"
            aria-controls="bom-results-table"
            @click="toggleResultMatchFilter('excluded')"
          >
            제외 {{ stats.excluded }}
          </button>
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
          class="mt-3 overflow-hidden rounded-xl border-2 border-amber-400 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 shadow-[0_8px_24px_rgba(217,119,6,0.16)]"
          role="alert"
        >
          <div class="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-start gap-3">
              <span class="grid size-9 shrink-0 place-items-center rounded-full bg-amber-500 text-xl font-black text-white shadow-sm" aria-hidden="true">!</span>
              <div class="min-w-0">
                <p class="text-[15px] font-extrabold text-amber-950">공급사 검색이 일부 중단되었습니다</p>
                <p
                  v-if="(detail.supplierSearchLimitSummary?.jobCallLimitComponentCount ?? 0) > 0"
                  class="mt-1 text-[13px] font-medium leading-5 text-amber-900"
                >
                  엔진 작업당 호출 상한
                  <strong v-if="typeof detail.supplierSearchLimitSummary?.maxCalls === 'number'">
                    {{ detail.supplierSearchLimitSummary?.maxCalls.toLocaleString('ko-KR') }}회
                  </strong>
                  에 도달해
                  <strong>{{ detail.supplierSearchLimitSummary?.jobCallLimitComponentCount.toLocaleString('ko-KR') }}개 부품</strong>의 일부 공급사 검색이 실행되지 않았습니다.
                </p>
                <p
                  v-if="(detail.supplierSearchLimitSummary?.supplierQuotaComponentCount ?? 0) > 0"
                  class="mt-1 text-[13px] font-medium leading-5 text-amber-900"
                >
                  공급사 API 자체 한도로
                  <strong>{{ detail.supplierSearchLimitSummary?.supplierQuotaComponentCount.toLocaleString('ko-KR') }}개 부품</strong>의 확인이 제한되었습니다.
                </p>
                <p
                  v-if="detail.supplierSearchLimitSummary === null || (
                    detail.supplierSearchLimitSummary.jobCallLimitComponentCount === 0
                    && detail.supplierSearchLimitSummary.supplierQuotaComponentCount === 0
                  )"
                  class="mt-1 text-[13px] font-medium leading-5 text-amber-900"
                >
                  검색 한도에 도달해 <strong>{{ detail.supplierSearchLimitedCount.toLocaleString('ko-KR') }}개 부품</strong>의 일부 공급사 확인이 제한되었습니다.
                </p>
                <p class="mt-1 text-[11px] font-medium text-amber-800/80">
                  이는 실제 검색 결과가 없는 경우와 다릅니다. 이미 확인된 후보와 금액은 계속 사용할 수 있습니다.
                  <template v-if="typeof detail.supplierSearchLimitSummary?.actualApiCalls === 'number'">
                    · 실제 API 호출 {{ detail.supplierSearchLimitSummary?.actualApiCalls.toLocaleString('ko-KR') }}회
                  </template>
                </p>
              </div>
            </div>
            <button
              v-if="searchLimitedItemCount > 0"
              type="button"
              class="h-9 shrink-0 rounded-lg bg-amber-700 px-4 text-[12px] font-bold text-white shadow-sm transition hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2"
              @click="showSupplierSearchLimitedItems"
            >
              영향받은 {{ searchLimitedItemCount.toLocaleString('ko-KR') }}개 행 보기
            </button>
          </div>
        </div>

        <!-- 여러 시트 결과를 원본 단위로 탐색하되 견적 합계·선택 상태는 하나로 유지한다 -->
        <div v-if="showResultSheetTabs" class="mt-3 overflow-x-auto border-b border-line [scrollbar-width:thin]" role="tablist" aria-label="BOM 결과 시트">
          <div class="flex min-w-max items-end gap-1 px-1">
            <button
              v-for="tab in resultSheetTabs"
              :key="tab.key"
              type="button"
              role="tab"
              class="relative flex h-[34px] max-w-[240px] items-center gap-1.5 rounded-t-md px-3 text-[12px] font-semibold transition after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full"
              :class="activeResultSheet === tab.key ? 'bg-blue-50/70 text-brand-strong after:bg-brand-strong' : 'text-ink-muted after:bg-transparent hover:bg-gray-50 hover:text-ink-soft'"
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
        <div :class="showResultSheetTabs ? 'mt-2' : 'mt-[11px]'" class="flex min-h-[24px] flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <p class="translate-y-[4px] font-noto text-[13px] font-medium leading-[16px] text-ink-strong">매칭 결과</p>
            <template v-if="resultFiltersActive">
              <span class="text-[12px] font-medium text-ink-muted">{{ stats.total }}개 중 {{ filteredItems.length }}개 표시</span>
              <span v-if="activeMatchFilterLabel !== null" class="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{{ activeMatchFilterLabel }}</span>
              <span v-if="resultSearchLimitedOnly" class="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-800">검색 한도 영향</span>
              <button type="button" class="text-[11px] font-semibold text-brand underline-offset-2 hover:underline" @click="clearResultFilters">필터 해제</button>
            </template>
          </div>
          <div class="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            <div class="relative min-w-[220px] flex-1 sm:w-[280px] sm:flex-none">
              <label class="sr-only" for="bom-result-search">현재 BOM에서 찾기</label>
              <img :src="icSearch" alt="" class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 opacity-55">
              <input
                id="bom-result-search"
                v-model="resultTextQuery"
                type="search"
                maxlength="120"
                class="h-[24px] w-full rounded-[4px] border border-line-strong bg-surface py-0 pl-8 pr-8 text-[12px] text-ink placeholder:text-ink-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20 [&::-webkit-search-cancel-button]:hidden"
                placeholder="MPN · 원본값 · REFDES 찾기"
                title="공급사 검색 없이 현재 BOM 목록에서 찾습니다"
                @keydown.esc.prevent="resultTextQuery = ''"
              >
              <button
                v-if="resultTextSearchActive"
                type="button"
                class="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-[12px] text-ink-muted hover:bg-gray-100 hover:text-ink-strong"
                aria-label="BOM 검색어 지우기"
                title="검색어 지우기"
                @click="resultTextQuery = ''"
              >
                ✕
              </button>
            </div>
            <!-- 정렬 — 시안 87:12875 의 "가격순" -->
            <label class="sr-only" for="bom-result-sort">결과 정렬</label>
            <select
              id="bom-result-sort"
              v-model="resultSort"
              class="h-[24px] rounded-[4px] border border-line-strong bg-surface-neutral px-2 text-[12px] font-semibold text-ink-neutral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              title="매칭 결과 정렬"
              @change="scrollResultsToTop"
            >
              <option v-for="(label, value) in RESULT_SORT_LABEL" :key="value" :value="value">{{ label }}</option>
            </select>
          </div>
        </div>

        <!-- 테이블 (list01 스타일) — 이 영역만 내부 스크롤, 헤더는 sticky -->
        <div class="relative mt-2 min-h-0 flex-1">
          <div ref="resultsScrollEl" class="h-full overflow-auto rounded-[10px] border border-bom-table-outline bg-bom-table-row [contain:layout_paint] [scrollbar-width:thin] min-[1890px]:overflow-x-hidden [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-line-strong [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-[8px] [&::-webkit-scrollbar]:w-[8px]" @scroll="syncResultsHorizontalScrollState">
            <!-- table-fixed — auto 레이아웃은 폭이 바뀔 때마다 모든 행의 셀 내용을 다시 측정해서
                 행이 많아지면 리사이즈가 눈에 띄게 버벅인다. 열 폭은 아래 colgroup 이 단일 소스이고,
                 Manufacturer는 MPN 셀에 함께 표시하고 Description이 남는 폭을 사용한다. -->
            <table id="bom-results-table" class="w-full min-w-[1338px] table-fixed min-[1920px]:min-w-[1366px]" :aria-busy="editingLocked">
              <colgroup>
                <col class="w-[41px]">
                <col class="w-[364px]"><!-- MPN + Manufacturer — 이미지와 긴 품번을 함께 수용 -->
                <col><!-- DESCRIPTION — 남는 폭을 사용한다 -->
                <col class="w-[160px]">
                <col class="w-[182px]">
                <col class="w-[106px]">
                <col class="w-[90px]">
              </colgroup>
              <thead class="sticky top-0 z-10 bg-bom-table-head shadow-[0_1px_0_var(--color-bom-table-line)] [&_th]:font-normal">
                <tr class="h-[39px] text-left font-noto text-[10px] font-normal uppercase leading-[24px] tracking-normal text-bom-table-heading">
                  <th class="p-0">
                    <div class="flex h-[39px] items-center justify-center">
                      <BomQuoteCheckbox
                        :checked="allIncluded"
                        :indeterminate="someIncluded && !allIncluded"
                        :disabled="!isDraft || editingLocked || includableItems.length === 0"
                        :title="editingLocked ? EDIT_LOCK_TITLE : allIncluded ? '표시된 행 전체를 견적에서 제외' : '표시된 행 전체를 견적에 포함'"
                        :label="editingLocked ? EDIT_LOCK_TITLE : allIncluded ? '표시된 행 전체를 견적에서 제외' : '표시된 행 전체를 견적에 포함'"
                        @change="toggleIncludeAll"
                      />
                      <span class="sr-only">표시된 행 전체 포함</span>
                    </div>
                  </th>
                  <th class="relative p-0"><span>전체 선택</span><span class="absolute left-[100px]">MPN</span></th>
                  <th class="p-0">Description</th>
                  <th class="p-0">Unit Price</th>
                  <th class="p-0">Quantity / Stock</th>
                  <th class="py-0 pl-[12px] pr-0">Total Price</th>
                  <th class="sticky right-0 z-20 border-l border-bom-table-line bg-bom-table-head p-0 shadow-[-10px_0_16px_-14px_rgba(15,23,42,0.65)]">
                    <div class="flex h-[39px] items-center justify-center gap-[2px]">
                      <button
                        type="button"
                        class="grid size-[20px] place-items-center rounded-[4px] text-[17px] leading-none text-brand-soft transition hover:bg-action-quiet disabled:cursor-default disabled:text-ink-faint disabled:opacity-35"
                        :disabled="!canScrollResultsLeft"
                        title="앞쪽 열 보기"
                        aria-label="앞쪽 열 보기"
                        @click="scrollResultColumns('left')"
                      >
                        ‹
                      </button>
                      <span class="text-[10px] text-bom-table-heading">작업</span>
                      <button
                        type="button"
                        class="grid size-[20px] place-items-center rounded-[4px] text-[17px] leading-none text-brand-soft transition hover:bg-action-quiet disabled:cursor-default disabled:text-ink-faint disabled:opacity-35"
                        :disabled="!canScrollResultsRight"
                        title="뒤쪽 열 보기"
                        aria-label="뒤쪽 열 보기"
                        @click="scrollResultColumns('right')"
                      >
                        ›
                      </button>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="virtualPaddingTop > 0" aria-hidden="true">
                  <td colspan="7" :style="{ height: `${String(virtualPaddingTop)}px` }" />
                </tr>
                <BomQuoteRow
                  v-for="entry in virtualRowItems"
                  :key="entry.item.id"
                  :ref="measureRow"
                  :data-index="entry.row.index"
                  :item="entry.item"
                  :needed="neededQty(entry.item.bomQty, setQty, spareQty)"
                  :is-draft="isDraft"
                  :editing-locked="editingLocked"
                  :enriching="enriching"
                  @toggle-include="toggleInclude(entry.item)"
                  @qty-change="onRowQtyChange(entry.item, $event)"
                  @confirm-quantity="confirmQuantity(entry.item, $event)"
                  @open-offers="openQuoteOfferModal(entry.item)"
                  @open-candidates="openCandidateDrawer(entry.item)"
                  @open-search="openCatalogSearchDrawer(entry.item)"
                />
                <tr v-if="virtualPaddingBottom > 0" aria-hidden="true">
                  <td colspan="7" :style="{ height: `${String(virtualPaddingBottom)}px` }" />
                </tr>
                <tr v-if="filteredItems.length === 0">
                  <td colspan="7" class="px-3 py-10 text-center text-sm text-gray-400">{{ resultTextSearchActive ? '검색어에 해당하는 BOM 라인이 없습니다.' : resultFiltersActive ? '선택한 조건에 해당하는 라인이 없습니다.' : '표시할 라인이 없습니다.' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-show="canScrollResultsLeft" class="pointer-events-none absolute inset-y-px left-px z-30 w-[12px] rounded-l-[9px] bg-gradient-to-r from-line-strong/60 to-transparent" aria-hidden="true" />
          <div v-show="canScrollResultsRight" class="pointer-events-none absolute inset-y-px right-[90px] z-30 w-[12px] bg-gradient-to-l from-line-strong/60 to-transparent" aria-hidden="true" />
        </div>
      </section>

      <!-- 닫혀 있어도 패널의 위치와 검토 대상 수를 인지할 수 있는 태블릿·접힌 데스크톱 엣지 핸들 -->
      <button
        v-if="!compactRightOpen"
        type="button"
        :class="rightOpen ? 'xl:hidden' : 'xl:flex'"
        class="fixed right-0 top-1/2 z-[35] hidden h-[128px] w-[42px] -translate-y-1/2 flex-col items-center justify-between rounded-l-[14px] border-y border-l border-blue-700 bg-brand-strong px-1 py-2.5 text-white shadow-[-6px_6px_20px_rgba(15,23,42,0.22)] transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 md:flex"
        :aria-label="compactPanelOpenLabel"
        :title="compactPanelOpenLabel"
        :aria-expanded="false"
        aria-controls="bom-quote-side-panel"
        @click="openRightPanelFromEdge"
      >
        <span
          v-if="compactPanelAttentionCount > 0"
          class="grid min-h-6 min-w-6 place-items-center rounded-full bg-orange-500 px-1 text-[10px] font-extrabold leading-none text-white shadow-sm"
          aria-hidden="true"
        >{{ compactPanelAttentionBadge }}</span>
        <span v-else class="grid size-6 place-items-center rounded-full bg-white/15 text-[10px] font-bold" aria-hidden="true">AI</span>
        <span class="text-center text-[11px] font-extrabold leading-[16px]" aria-hidden="true">분석<br>견적</span>
        <span class="text-[19px] font-bold leading-none" aria-hidden="true">‹</span>
      </button>

      <!-- 최초 1회만 엣지 핸들의 용도를 설명한다. -->
      <div
        v-if="compactPanelHintVisible && !compactRightOpen"
        class="fixed right-[52px] top-1/2 z-[35] hidden w-[250px] -translate-y-1/2 rounded-xl border border-blue-200 bg-surface p-3.5 shadow-[0_12px_32px_rgba(15,23,42,0.2)] md:block xl:hidden"
        role="region"
        aria-label="분석 및 견적 패널 안내"
      >
        <button
          type="button"
          class="absolute right-2 top-2 grid size-6 place-items-center rounded-md text-[15px] text-ink-muted hover:bg-surface-raised hover:text-ink-strong"
          aria-label="패널 안내 닫기"
          @click="dismissCompactPanelHint"
        >
          ×
        </button>
        <p class="pr-6 text-[13px] font-extrabold text-ink-strong">오른쪽에 분석·견적 패널이 있습니다</p>
        <p class="mt-1 text-[11px] leading-[17px] text-ink-muted">AI 분석 결과, 주문 수량과 예상 견적을 확인할 수 있습니다.</p>
        <button
          type="button"
          class="mt-2.5 h-8 rounded-lg bg-brand-strong px-3 text-[11px] font-bold text-white hover:bg-blue-700"
          @click="openCompactRightPanel"
        >
          패널 열어보기
        </button>
      </div>

      <!-- 축소 화면에서는 표를 가리지 않는 기본 닫힘 오버레이로 전환한다. -->
      <div
        v-if="compactRightOpen"
        class="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[1px] xl:hidden"
        aria-hidden="true"
        @click="closeCompactRightPanel"
      />

      <!-- 우: 데스크톱 사이드바 / 태블릿 우측 드로어 / 모바일 바텀시트 -->
      <aside
        id="bom-quote-side-panel"
        :class="[
          compactRightOpen ? 'flex' : 'hidden',
          rightOpen ? 'xl:flex' : 'xl:hidden',
        ]"
        class="bom-quote-responsive-panel fixed inset-x-0 bottom-0 z-50 h-[85dvh] max-h-[720px] min-h-0 w-full shrink-0 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-line-strong [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-[6px] md:inset-x-auto md:right-0 md:top-[58px] md:h-auto md:max-h-none md:w-[360px] xl:static xl:-mt-[14px] xl:h-[calc(100%+28px)] xl:min-h-0 xl:w-[260px] xl:overflow-y-auto"
        :role="compactRightOpen ? 'dialog' : 'complementary'"
        :aria-modal="compactRightOpen ? 'true' : undefined"
        aria-label="BOM 분석 및 예상 견적"
      >
        <button
          ref="compactPanelCloseButton"
          type="button"
          class="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-lg border border-line bg-surface text-[20px] leading-none text-ink-muted shadow-sm hover:bg-surface-raised hover:text-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand xl:hidden"
          aria-label="분석 및 견적 패널 닫기"
          @click="closeCompactRightPanel"
        >
          ×
        </button>
        <div class="flex min-h-full w-full flex-col rounded-t-[16px] border border-bom-panel-border bg-bom-panel px-[15px] pb-[15px] pt-[52px] shadow-[-10px_0_30px_rgba(15,23,42,0.16)] md:rounded-bl-[16px] md:rounded-tl-[16px] md:rounded-tr-none xl:rounded-none xl:border-y-0 xl:border-r-0 xl:pt-[20px] xl:shadow-none">
          <!-- 회신(answered) — 회신 완료 상태면 내용이 없어도 박스를 보여 상태를 설명한다 -->
          <div v-if="detail.status === 'answered' || detail.answerNote !== null || detail.confirmedTotal !== null" class="mb-[18px] rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-3 text-[12px]">
            <p v-if="detail.answerNote" class="whitespace-pre-wrap leading-[18px] text-emerald-900">{{ detail.answerNote }}</p>
            <p v-if="detail.confirmedTotal !== null" class="mt-2 text-emerald-900">
              확정 견적: <b class="tabular-nums">{{ fmtWon(detail.confirmedTotal) }}</b>
              <span v-if="detail.confirmedShippingFee !== null" class="mt-1 block text-[10px] text-emerald-700">(운송료 {{ fmtWon(detail.confirmedShippingFee) }} · 관리비 {{ fmtWon(detail.confirmedManagementFee) }})</span>
            </p>
            <!-- 견적서(§6.8) — 확정 회신을 서식 문서로 열람·인쇄(브라우저에서 PDF 저장 가능) -->
            <button
              v-if="canViewEstimate"
              type="button"
              class="mt-2 w-full rounded-[8px] border border-emerald-300 py-1.5 text-[12px] font-bold text-emerald-800 hover:bg-emerald-100"
              @click="estimateOpen = true"
            >
              🧾 견적서 보기·인쇄
            </button>
            <!-- 주문 전환(D16) — 확정가 있는 회신만. 결제는 영카트 주문서에서(VAT 포함 전환) -->
            <div v-if="detail.orderState === 'ordered'" class="mt-2">
              <span class="inline-block rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white">주문 완료</span>
              <span class="ml-1 text-[10px] text-emerald-700">주문내역에서 진행 상황을 확인하세요.</span>
            </div>
            <template v-else-if="canOrder">
              <button
                type="button"
                class="mt-2 w-full rounded-[8px] bg-emerald-600 py-2 text-[12px] font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                :disabled="orderMut.isPending.value"
                @click="orderNow"
              >
                주문하기 (VAT 포함 {{ fmtWon(Math.round((detail.confirmedTotal ?? 0) * 1.1)) }})
              </button>
              <p class="mt-1 text-center text-[10px] text-emerald-700">주문서에서 결제수단을 선택합니다.</p>
              <p v-if="orderError !== ''" class="mt-1 text-[10px] font-semibold text-red-600">{{ orderError }}</p>
            </template>
            <!-- 확정가 게이트(D16-1) 안내 — 버튼이 "왜 없는지"를 설명한다 -->
            <p v-else-if="detail.status === 'answered'" class="mt-2 rounded bg-emerald-100/70 px-2 py-1.5 text-[11px] leading-[16px] text-emerald-800">
              확정 금액 산정 중입니다 — 담당자가 확정가를 안내하면 여기에 [주문하기] 버튼이 표시됩니다.
            </p>
          </div>

          <BomEstimateModal :open="estimateOpen" :load="loadEstimatePrint" @close="estimateOpen = false" />

          <!-- AI 분석결과 (93:23545) -->
          <section>
            <h2 class="flex h-[16px] items-center gap-[6px] font-noto text-[12px] font-bold leading-[14px] text-bom-panel-heading">
              <img :src="icPanelAi" alt="" class="bom-panel-icon size-[16px] shrink-0">
              AI 분석결과
              <span v-if="showResultSheetTabs" class="ml-auto max-w-[120px] truncate rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold text-blue-600" :title="activeResultSheetLabel">{{ activeResultSheetLabel }}</span>
            </h2>
            <div class="mt-[10px] grid grid-cols-2 gap-[8px]">
              <button
                type="button"
                class="relative flex h-[51px] w-full min-w-0 cursor-pointer items-center justify-between overflow-hidden rounded-[8px] border border-[rgba(66,116,207,0.4)] bg-bom-status-card pl-[9px] pr-[7px] text-left transition-colors after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-gradient-to-r after:from-[#2359bb] after:to-transparent hover:bg-[rgba(66,116,207,0.05)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4274cf] focus-visible:ring-offset-1"
                :aria-pressed="!resultFiltersActive"
                :aria-label="`전체 ${String(stats.total)}개 행 보기`"
                aria-controls="bom-results-table"
                @click="clearResultFilters"
              >
                <div class="flex min-w-0 h-full flex-col justify-center">
                  <span class="truncate text-[10px] font-medium uppercase leading-[normal] tracking-[1.1px] text-bom-status-label">Total Lines</span>
                  <span class="mt-[1px] text-[18px] font-extrabold leading-[normal] tabular-nums text-[#4274cf]">{{ stats.total }}</span>
                </div>
                <span class="grid size-[28px] shrink-0 place-items-center rounded-[6px] bg-[rgba(66,116,207,0.15)]" aria-hidden="true">
                  <img :src="icPanelTotal" alt="" class="h-[11.498px] w-[11.507px]">
                </span>
              </button>
              <button
                type="button"
                class="relative flex h-[51px] w-full min-w-0 items-center justify-between overflow-hidden rounded-[8px] border pl-[9px] pr-[7px] text-left transition-colors after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-gradient-to-r after:from-[#069762] after:to-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ce87] focus-visible:ring-offset-1 disabled:cursor-default"
                :class="resultMatchFilter === 'matched' ? 'cursor-pointer border-[#00ce87] bg-[rgba(0,206,135,0.1)]' : stats.matched > 0 ? 'cursor-pointer border-[rgba(0,206,135,0.4)] bg-bom-status-card hover:bg-[rgba(0,206,135,0.06)]' : 'border-[rgba(0,206,135,0.4)] bg-bom-status-card'"
                :disabled="stats.matched === 0"
                :aria-pressed="resultMatchFilter === 'matched'"
                :aria-label="`매칭 완료 ${String(stats.matched)}개 행 필터`"
                aria-controls="bom-results-table"
                :title="stats.matched === 0 ? '매칭 완료 항목이 없습니다' : undefined"
                @click="toggleResultMatchFilter('matched')"
              >
                <div class="flex min-w-0 h-full flex-col justify-center">
                  <span class="truncate text-[10px] font-medium uppercase leading-[normal] tracking-[1.1px] text-bom-status-label">Matched</span>
                  <span class="mt-[1px] whitespace-nowrap text-[18px] font-extrabold leading-[normal] tabular-nums text-[#00ce87]">{{ stats.matched }} <span class="text-[12px] font-semibold">{{ stats.matchedPct }}%</span></span>
                </div>
                <img :src="icPanelMatched" alt="" class="size-[28px] shrink-0" aria-hidden="true">
              </button>
              <button
                type="button"
                class="relative flex h-[51px] w-full min-w-0 items-center justify-between overflow-hidden rounded-[8px] border pl-[9px] pr-[7px] text-left transition-colors after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-gradient-to-r after:from-[#f06300] after:to-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6900] focus-visible:ring-offset-1 disabled:cursor-default"
                :class="resultMatchFilter === 'review' ? 'cursor-pointer border-[#ff6900] bg-[rgba(255,105,0,0.1)]' : !enriching && stats.review > 0 ? 'cursor-pointer border-[rgba(255,105,0,0.4)] bg-bom-status-card hover:bg-[rgba(255,105,0,0.06)]' : 'border-[rgba(255,105,0,0.4)] bg-bom-status-card'"
                :disabled="enriching || stats.review === 0"
                :aria-pressed="!enriching && resultMatchFilter === 'review'"
                :aria-label="`검토 필요 ${String(stats.review)}개 행 필터`"
                aria-controls="bom-results-table"
                :title="enriching ? '공급사 확인이 완료되면 필터할 수 있습니다' : stats.review === 0 ? '검토 필요 항목이 없습니다' : undefined"
                @click="toggleResultMatchFilter('review')"
              >
                <div class="flex min-w-0 h-full flex-col justify-center">
                  <span class="truncate text-[10px] font-medium uppercase leading-[normal] tracking-[1.1px] text-bom-status-label">Review</span>
                  <span class="mt-[1px] whitespace-nowrap text-[18px] font-extrabold leading-[normal] tabular-nums text-[#ff6900]">{{ stats.review }} <span class="text-[12px] font-semibold">{{ resultPercent(stats.review) }}%</span></span>
                </div>
                <img :src="icPanelReview" alt="" class="size-[28px] shrink-0" aria-hidden="true">
              </button>
              <!-- 보강 진행 중엔 Checking(파랑) — 최종 미매칭 판정과 구분 -->
              <button
                type="button"
                class="relative flex h-[51px] w-full min-w-0 items-center justify-between overflow-hidden rounded-[8px] border pl-[9px] pr-[7px] text-left transition-colors after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-gradient-to-r after:to-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-default"
                :class="[
                  enriching
                    ? 'cursor-wait border-[rgba(66,116,207,0.4)] bg-bom-status-card after:from-[#2359bb] focus-visible:ring-[#4274cf]'
                    : resultMatchFilter === 'unmatched'
                      ? 'cursor-pointer border-[#ff5873] bg-[rgba(255,88,115,0.1)] after:from-[#ff5873] focus-visible:ring-[#ff5873]'
                      : stats.unmatched > 0
                        ? 'cursor-pointer border-[rgba(255,88,115,0.4)] bg-bom-status-card after:from-[#ff5873] hover:bg-[rgba(255,88,115,0.06)] focus-visible:ring-[#ff5873]'
                        : 'border-[rgba(255,88,115,0.4)] bg-bom-status-card after:from-[#ff5873] focus-visible:ring-[#ff5873]',
                ]"
                :disabled="enriching || stats.unmatched === 0"
                :aria-pressed="!enriching && resultMatchFilter === 'unmatched'"
                :aria-label="enriching ? `확인 중 ${String(stats.unresolved)}개 행` : `미매칭 ${String(stats.unmatched)}개 행 필터`"
                aria-controls="bom-results-table"
                :title="enriching ? '공급사 확인이 완료되면 필터할 수 있습니다' : stats.unmatched === 0 ? '미매칭 항목이 없습니다' : undefined"
                @click="toggleResultMatchFilter('unmatched')"
              >
                <div class="flex min-w-0 h-full flex-col justify-center">
                  <span class="truncate text-[10px] font-medium uppercase leading-[normal] tracking-[1.1px] text-bom-status-label">{{ enriching ? 'Checking' : 'Unmatched' }}</span>
                  <span class="mt-[1px] whitespace-nowrap text-[18px] font-extrabold leading-[normal] tabular-nums" :class="enriching ? 'text-[#4274cf]' : 'text-[#ff5873]'">
                    {{ enriching ? stats.unresolved : stats.unmatched }} <span v-if="!enriching" class="text-[12px] font-semibold">{{ resultPercent(stats.unmatched) }}%</span>
                  </span>
                </div>
                <span v-if="enriching" class="grid size-[28px] shrink-0 place-items-center rounded-[6px] bg-[rgba(66,116,207,0.15)] text-[18px] leading-none text-[#4274cf]" aria-hidden="true">…</span>
                <img v-else :src="icPanelUnmatched" alt="" class="size-[28px] shrink-0" aria-hidden="true">
              </button>
              <button
                type="button"
                class="relative flex h-[51px] w-full min-w-0 items-center justify-between overflow-hidden rounded-[8px] border pl-[9px] pr-[7px] text-left transition-colors after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-gradient-to-r after:from-[#b8a900] after:to-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d2c000] focus-visible:ring-offset-1 disabled:cursor-default"
                :class="resultMatchFilter === 'nostock' ? 'cursor-pointer border-[#d2c000] bg-[rgba(226,207,0,0.15)]' : stats.nostock > 0 ? 'cursor-pointer border-[rgba(190,175,12,0.4)] bg-bom-status-card hover:bg-[rgba(226,207,0,0.08)]' : 'border-[rgba(190,175,12,0.4)] bg-bom-status-card'"
                :disabled="stats.nostock === 0"
                :aria-pressed="resultMatchFilter === 'nostock'"
                :aria-label="`재고 확인 필요 ${String(stats.nostock)}개 행 필터`"
                aria-controls="bom-results-table"
                :title="stats.nostock === 0 ? '재고 확인 필요 항목이 없습니다' : undefined"
                @click="toggleResultMatchFilter('nostock')"
              >
                <div class="flex min-w-0 h-full flex-col justify-center">
                  <span class="truncate text-[10px] font-medium uppercase leading-[normal] tracking-[1.1px] text-bom-status-label">Nostock</span>
                  <span class="mt-[1px] whitespace-nowrap text-[18px] font-extrabold leading-[normal] tabular-nums text-[#d2c000]">{{ stats.nostock }} <span class="text-[12px] font-semibold">{{ stats.nostockPct }}%</span></span>
                </div>
                <span class="grid size-[28px] shrink-0 place-items-center rounded-[6px] bg-[rgba(226,207,0,0.15)]" aria-hidden="true">
                  <img :src="icPanelNostock" alt="" class="h-[14.601px] w-[16.001px]">
                </span>
              </button>
              <button
                type="button"
                class="relative flex h-[51px] w-full min-w-0 items-center justify-between overflow-hidden rounded-[8px] border pl-[9px] pr-[7px] text-left transition-colors after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-gradient-to-r after:from-[#777] after:to-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#777] focus-visible:ring-offset-1 disabled:cursor-default"
                :class="resultMatchFilter === 'excluded' ? 'cursor-pointer border-[#777] bg-[rgba(119,119,119,0.1)]' : !enriching && stats.excluded > 0 ? 'cursor-pointer border-[rgba(119,119,119,0.4)] bg-bom-status-card hover:bg-[rgba(119,119,119,0.06)]' : 'border-[rgba(119,119,119,0.4)] bg-bom-status-card'"
                :disabled="enriching || stats.excluded === 0"
                :aria-pressed="!enriching && resultMatchFilter === 'excluded'"
                :aria-label="`검색 제외 ${String(stats.excluded)}개 행 필터`"
                aria-controls="bom-results-table"
                :title="enriching ? '공급사 확인이 완료되면 필터할 수 있습니다' : stats.excluded === 0 ? '검색 제외 항목이 없습니다' : undefined"
                @click="toggleResultMatchFilter('excluded')"
              >
                <div class="flex min-w-0 h-full flex-col justify-center">
                  <span class="truncate text-[10px] font-medium uppercase leading-[normal] tracking-[1.1px] text-bom-status-label">Excluded</span>
                  <span class="mt-[1px] text-[18px] font-extrabold leading-[normal] tabular-nums text-[#777]">{{ stats.excluded }}</span>
                </div>
                <span class="grid size-[28px] shrink-0 place-items-center rounded-[6px] bg-[rgba(119,119,119,0.15)]" aria-hidden="true">
                  <span class="h-[2px] w-[10px] rounded-[10px] bg-[#777]" />
                </span>
              </button>
            </div>
          </section>

          <!-- 주문 정보 (93:23562) -->
          <section class="mt-[18px]" title="주문수량은 BOM 수량과 세트·예비 수량을 반영한 뒤 MOQ와 주문배수에 맞춰 계산됩니다.">
            <h2 class="flex h-[16px] items-center gap-[6px] font-noto text-[12px] font-bold leading-[14px] text-bom-panel-heading">
              <img :src="icPanelOrder" alt="" class="bom-panel-icon size-[16px] shrink-0">
              주문 정보
            </h2>
            <div class="mt-[9px] h-[133px] space-y-[11px] rounded-[8px] border border-bom-panel-card-border bg-bom-panel-card px-[11px] py-[11px]">
              <div class="flex items-center justify-between">
                <span class="font-noto text-[12px] font-normal leading-[14px] tracking-[-0.48px] text-bom-panel-label">세트 수량</span>
                <div class="flex items-center gap-[7px]">
                  <div class="flex h-[32px] w-[124px] overflow-hidden rounded-[5px] border border-bom-panel-control-border bg-bom-panel-control focus-within:border-brand-soft focus-within:ring-2 focus-within:ring-brand-soft/15">
                    <button type="button" class="w-[27px] shrink-0 border-r border-bom-panel-control-divider bg-transparent text-[14px] text-bom-panel-control-action transition hover:text-brand-soft disabled:cursor-not-allowed disabled:opacity-35" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" aria-label="세트 수량 줄이기" @click="stepSet(-1)">−</button>
                    <input v-model.number="setQty" type="number" min="1" class="min-w-0 flex-1 appearance-none bg-transparent text-center text-[14px] font-semibold tabular-nums text-bom-panel-heading outline-none [appearance:textfield] disabled:cursor-not-allowed disabled:text-bom-panel-control-action [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" aria-label="세트 수량" @change="restampAll">
                    <button type="button" class="w-[27px] shrink-0 border-l border-bom-panel-control-divider bg-transparent text-[14px] text-bom-panel-control-action transition hover:text-brand-soft disabled:cursor-not-allowed disabled:opacity-35" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" aria-label="세트 수량 늘리기" @click="stepSet(1)">+</button>
                  </div>
                  <span class="w-[18px] text-[10px] font-semibold text-bom-panel-set">Set</span>
                </div>
              </div>
              <div class="flex items-center justify-between">
                <span class="font-noto text-[12px] font-normal leading-[14px] tracking-[-0.48px] text-bom-panel-label">예비 수량</span>
                <div class="flex items-center gap-[7px]">
                  <div class="flex h-[32px] w-[124px] overflow-hidden rounded-[5px] border border-bom-panel-control-border bg-bom-panel-control focus-within:border-brand-soft focus-within:ring-2 focus-within:ring-brand-soft/15">
                    <button type="button" class="w-[27px] shrink-0 border-r border-bom-panel-control-divider bg-transparent text-[14px] text-bom-panel-control-action transition hover:text-brand-soft disabled:cursor-not-allowed disabled:opacity-35" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" aria-label="예비 수량 줄이기" @click="stepSpare(-1)">−</button>
                    <input v-model.number="spareQty" type="number" min="0" class="min-w-0 flex-1 appearance-none bg-transparent text-center text-[14px] font-semibold tabular-nums text-bom-panel-heading outline-none [appearance:textfield] disabled:cursor-not-allowed disabled:text-bom-panel-control-action [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" aria-label="예비 수량" @change="restampAll">
                    <button type="button" class="w-[27px] shrink-0 border-l border-bom-panel-control-divider bg-transparent text-[14px] text-bom-panel-control-action transition hover:text-brand-soft disabled:cursor-not-allowed disabled:opacity-35" :disabled="!isDraft || editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : undefined" aria-label="예비 수량 늘리기" @click="stepSpare(1)">+</button>
                  </div>
                  <span class="w-[18px] text-[10px] font-semibold text-bom-panel-set">Set</span>
                </div>
              </div>
              <div class="flex h-[19px] items-center justify-between pt-px">
                <span class="font-noto text-[12px] font-normal leading-[14px] tracking-[-0.48px] text-bom-panel-label">예상 납기</span>
                <span class="flex items-center gap-[6px] text-[11px] font-semibold text-bom-delivery"><span class="size-[6px] rounded-full bg-bom-delivery" />확정 시 안내</span>
              </div>
            </div>
          </section>

          <!-- 예상 견적 (93:23573) -->
          <section class="mt-[18px]" :aria-busy="pricingPending">
            <h2 class="flex h-[16px] items-center gap-[6px] font-noto text-[12px] font-bold leading-[14px] text-bom-panel-heading">
              <img :src="icPanelQuote" alt="" class="bom-panel-icon size-[16px] shrink-0">
              예상 견적
              <span v-if="showResultSheetTabs" class="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold text-gray-500">전체 견적</span>
            </h2>
            <div v-if="pricingPending" class="mt-[10px] rounded-[8px] border border-line-brand bg-surface-brand-soft px-3 py-4 text-center" aria-live="polite">
              <span class="mx-auto block size-[7px] animate-pulse rounded-full bg-brand-soft" />
              <p class="mt-2 text-[12px] font-semibold text-brand-deep">공급사 가격을 확인하고 있습니다</p>
              <p class="mt-1 text-[10px] leading-[15px] text-ink-subtle">모든 결과가 반영되면 합계를 표시합니다.</p>
            </div>
            <div v-else class="mt-[9px]">
              <div class="h-[129px] space-y-[13px] rounded-[8px] border border-bom-panel-card-border bg-bom-panel-card px-[11px] pb-[13px] pt-[15px] text-[12px] leading-[14px] [&>:last-child]:-translate-y-px">
                <div class="flex items-baseline justify-between" title="부품 합계를 세트 수량과 예비 수량의 합으로 나눈 평균 단가입니다."><span class="font-noto tracking-[-0.48px] text-bom-panel-label">단가</span><span class="text-[13px] font-bold tabular-nums text-bom-panel-value">{{ fmtAmount(averageSetUnitPrice) }} <small class="text-[10px] font-normal text-bom-panel-unit">원</small></span></div>
                <div class="flex items-baseline justify-between"><span class="font-noto tracking-[-0.48px] text-bom-panel-label">합계</span><span class="text-[13px] font-bold tabular-nums text-bom-panel-value">{{ fmtAmount(itemsTotal) }} <small class="text-[10px] font-normal text-bom-panel-unit">원</small></span></div>
                <div class="flex items-baseline justify-between"><span class="font-noto tracking-[-0.48px] text-bom-panel-label">운송료</span><span class="text-[13px] font-bold tabular-nums text-bom-panel-value">{{ fmtAmount(detail.shippingFee) }} <small class="text-[10px] font-normal text-bom-panel-unit">원</small></span></div>
                <div class="flex items-baseline justify-between"><span class="font-noto tracking-[-0.48px] text-bom-panel-label">관리비</span><span class="text-[13px] font-bold tabular-nums text-bom-panel-value">{{ fmtAmount(detail.managementFee) }} <small class="text-[10px] font-normal text-bom-panel-unit">원</small></span></div>
              </div>
              <div class="relative mt-[12px] h-[74px] rounded-[8px] border border-bom-panel-total-border bg-bom-panel-total px-[11px] py-[11px]">
                <span class="font-noto text-[12px] font-medium leading-[14px] text-bom-panel-heading">최종합계 <span class="text-[10px] font-normal text-bom-panel-vat">(VAT 별도)</span></span>
                <span class="absolute bottom-[12px] right-[11px] text-[19px] font-bold leading-[22px] tabular-nums text-brand">{{ fmtAmount(finalTotal) }}<small class="ml-[3px] text-[12px] font-normal">원</small></span>
              </div>
              <ul class="mt-[11px] list-disc pl-[14px] text-[11px] leading-[16px] text-bom-estimate-notice">
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
              class="flex h-[40px] w-full items-center justify-center gap-[8px] rounded-[7px] bg-bom-cta text-[14px] font-bold text-white shadow-[0_6px_14px_rgba(40,124,255,0.24)] transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-45"
              :disabled="request.isPending.value || quoteStats.included === 0 || editingLocked"
              :title="editingLocked ? EDIT_LOCK_TITLE : undefined"
              @click="openRequestModal"
            >
              <img :src="icFile" alt="" class="size-[14px] brightness-0 invert">
              {{ updateSheets.isPending.value ? '시트 반영 중…' : editingLocked ? '가격 확인 중…' : '견적요청' }}
            </button>
            <!-- 작성 중·취소=하드 삭제(2단계 확인) · 요청됨=요청 취소 -->
            <template v-if="canDeleteQuote">
              <button
                v-if="!deleteArm"
                type="button"
                class="w-full rounded-[7px] border border-line bg-surface px-4 py-2 text-[12px] text-ink-subtle transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
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
              class="w-full rounded-[7px] border border-line bg-surface px-4 py-2 text-[12px] text-ink-subtle transition hover:bg-gray-50 hover:text-ink"
              @click="onCancel"
            >
              요청 취소
            </button>
          </div>
        </div>
      </aside>
    </div>

    <!-- 사용자가 승인한 값만 누락된 저항·MLCC 조건에 적용한다. -->
    <div
      v-if="passiveDefaultsOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      @click.self="passiveDefaultsOpen = false"
    >
      <div class="w-full max-w-lg overflow-hidden rounded-2xl bg-surface shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="passive-defaults-title">
        <div class="border-b border-slate-100 px-5 py-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 id="passive-defaults-title" class="text-base font-bold text-slate-900">누락된 저항·MLCC 조건 확인</h3>
              <p class="mt-1 text-xs leading-5 text-slate-500">
                원본 BOM이나 행별 검색조건에 값이 없는 경우에만 아래 값을 적용해 전체 후보를 다시 확인합니다.
              </p>
            </div>
            <button type="button" class="grid size-8 shrink-0 place-items-center rounded-lg text-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="닫기" @click="passiveDefaultsOpen = false">×</button>
          </div>
        </div>

        <div class="space-y-4 px-5 py-4">
          <div class="grid gap-3 sm:grid-cols-3">
            <label class="block">
              <span class="text-xs font-semibold text-slate-700">저항 허용오차</span>
              <select v-model="resistorDefaultTolerance" class="mt-1.5 w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                <option value="0.1%">±0.1%</option>
                <option value="0.5%">±0.5%</option>
                <option value="1%">±1%</option>
                <option value="5%">±5%</option>
                <option value="10%">±10%</option>
              </select>
            </label>
            <label class="block">
              <span class="text-xs font-semibold text-slate-700">MLCC 허용오차</span>
              <select v-model="capacitorDefaultTolerance" class="mt-1.5 w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                <option value="5%">±5%</option>
                <option value="10%">±10%</option>
                <option value="20%">±20%</option>
              </select>
            </label>
            <label class="block">
              <span class="text-xs font-semibold text-slate-700">MLCC 최소 정격전압</span>
              <select v-model="capacitorDefaultVoltage" class="mt-1.5 w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                <option value="6.3V">6.3V 이상</option>
                <option value="10V">10V 이상</option>
                <option value="16V">16V 이상</option>
                <option value="25V">25V 이상</option>
                <option value="50V">50V 이상</option>
              </select>
            </label>
          </div>

          <div class="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900">
            <p class="font-bold">유전체는 보수적으로 자동 적용합니다.</p>
            <p class="mt-1">1nF 이하는 C0G, 그보다 큰 MLCC는 X7R로 확인합니다. 전해·탄탈·필름 캐패시터에는 이 기본값을 적용하지 않습니다.</p>
          </div>
          <ul class="space-y-1 text-[11px] leading-5 text-slate-500">
            <li>• BOM과 사용자가 직접 지정한 값이 항상 우선합니다.</li>
            <li>• 품번 대체·스펙 후보는 실제 사양이 승인값을 충족할 때만 자동 선정합니다.</li>
            <li>• 공급사 사양이 없거나 불일치하면 계속 검토 대상으로 남습니다.</li>
          </ul>
          <p v-if="passiveDefaultsError !== ''" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{{ passiveDefaultsError }}</p>
        </div>

        <div class="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
          <button type="button" class="rounded-lg border border-slate-300 bg-surface px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50" :disabled="passiveDefaultsMutation.isPending.value" @click="passiveDefaultsOpen = false">
            취소
          </button>
          <button type="button" class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="passiveDefaultsMutation.isPending.value" @click="applyPassiveDefaults">
            {{ passiveDefaultsMutation.isPending.value ? '검색 시작 중…' : '승인하고 다시 검색' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 결과 시트 관리: 제외해도 원본 라인·후보·선택 이력은 보존한다. -->
    <div
      v-if="sheetManagerOpen && detail !== null"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="closeSheetManager"
    >
      <div class="w-full max-w-lg overflow-hidden rounded-2xl bg-surface shadow-xl" role="dialog" aria-modal="true" aria-labelledby="sheet-manager-title">
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
              :class="managedSheetIndexes.includes(sheet.sheetIndex) ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-surface text-transparent'"
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
                class="rounded-lg border border-gray-300 bg-surface px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
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
      <div class="w-full max-w-md rounded-2xl bg-surface p-5 shadow-xl">
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
      <div class="w-full max-w-sm rounded-2xl border border-slate-200 bg-surface p-5 shadow-2xl">
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
      :requirements-saving="searchRequirementsMutation.isPending.value"
      :requirements-error="searchRequirementsError"
      :requirements-progress="candidateRowSearchProgress"
      :requirements-notice="candidateRowSearchActive ? rowSearchNotice : ''"
      :external-search-running="candidateRowSearchActive && rowSearchKind === 'external' && rowSearchRunning"
      :external-search-error="externalSupplierSearchError"
      :interaction-locked="candidateRowSearchLocked"
      :initial-view="candidateDrawerView"
      :search-initial-query="candidateItem?.mpn ?? ''"
      :current-part-id="candidateItem?.partId ?? null"
      :needed="candidateItem === null ? 1 : neededQty(candidateItem.bomQty, setQty, spareQty)"
      :usd-krw-rate="rate"
      :has-catalog-part="candidateItem !== null && candidateItem.partId !== null && candidateItem.selectedCandidateKey === null"
      @select="selectCandidateAndClose"
      @catalog-select="onCatalogPartSelected"
      @catalog-offers="openCatalogOffersFromDrawer"
      @search-requirements="updateSearchRequirements"
      @external-supplier-search="runExternalSupplierSearch"
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
    <BomQuoteAddWorkspace
      v-if="addWorkspaceOpen && detail !== null && !editingLocked"
      :quote-title="detail.fileName ?? detail.title"
      :items="items"
      :set-qty="setQty"
      :spare-qty="spareQty"
      :pending-key="manualPendingKey"
      :pending-item-id="manualPendingItemId"
      :removing-item-id="manualRemovingItemId"
      :action-error="manualItemError"
      @add="(body, key) => upsertManualItem(body, key)"
      @remove-selection="removeManualSelection"
      @remove-item="removeManualItem"
      @quantity="updateManualItemQuantity"
      @close="addWorkspaceOpen = false"
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

<style scoped>
@media (min-width: 1440px) {
  .bom-quote-workbench {
    column-gap: 24px;
    padding-left: 24px;
  }

  .bom-quote-responsive-panel {
    width: 286px;
  }
}
</style>
