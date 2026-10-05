<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQueryClient } from '@tanstack/vue-query';
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleAlertIcon,
  Columns2Icon,
  FileTextIcon,
  LayoutGridIcon,
  ListIcon,
  MinusIcon,
  PackageIcon,
  PackageXIcon,
  PlusIcon,
  ReceiptIcon,
  SparklesIcon,
  UploadIcon,
  XIcon,
} from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import {
  type BomQuoteDetailResponseType,
  type BomQuoteDetailType,
  type BomQuoteItemType,
  type BomQuotePassiveDefaultsBodyType,
  type BomQuoteSearchRequirementsBodyType,
  type BomQuoteSelectedOfferType,
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
  usePatchBomQuote,
  usePrepareBomPartData,
  usePrepareBomQuoteSheets,
  useRequestBomQuote,
  useRunBomQuoteExternalSupplierSearch,
  useSelectBomQuoteCandidate,
  useSupplierSearchStatus,
  useUpdateBomQuoteSheets,
  useUpdateBomQuoteSearchRequirements,
} from '@/bom/useBom';
import { NEXT_SMARTBOM_ROUTES } from '@/next/smartbom-navigation';
import { confirmDialog, promptDialog } from '@/next/lib/dialog';
import CandidateDrawer from '@/next/components/bom/CandidateDrawer.vue';
import CompareDialog from '@/next/components/bom/CompareDialog.vue';
import OfferDialog from '@/next/components/bom/OfferDialog.vue';
import PartSearchDialog from '@/next/components/bom/PartSearchDialog.vue';
import QuoteOfferDialog from '@/next/components/bom/QuoteOfferDialog.vue';
import ResultsBody from '@/next/components/bom/workbench/ResultsBody.vue';
import { sheetStatusBadge, workbenchQuoteStatusBadge } from '@/next/components/bom/workbench/workbench-badges';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import Panel from '@/next/components/common/Panel.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import RowCheckbox from '@/next/components/common/RowCheckbox.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Card } from '@/next/components/ui/card';
import { Checkbox } from '@/next/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/next/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/next/components/ui/input-group';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Spinner } from '@/next/components/ui/spinner';

// 관리자 전용 BOM 견적 워크벤치 — 옛 pages/admin/AdminBomQuote.vue 의 짝. 배치(좌 매칭 결과 표 + 우 정보
// 패널)·문구·로직은 옛 화면 그대로 옮기고 모양만 키트로 바꿨다. 성능 장치 셋도 그대로다 — 행 격리
// 컴포넌트(QuoteRow), 서버 항목 참조가 같으면 로컬 클론을 재사용하는 동기화(applyServerDetail), 가상 스크롤(표 본문
// workbench/ResultsBody — 스크롤 상태를 페이지에서 떼어 냈다). 행 안은 키트 컴포넌트 대신 같은 클래스의 네이티브 원소다
// (workbench/row-classes.ts — 옛/새 실측 근거).
// 결과 표는 shadcn Table 이 아니라 원래 표 구조(colgroup·table-fixed·스페이서 행·sticky 머리)를 쓴다 —
// 가상 스크롤 안에서 열 폭과 머리 고정을 지키려는 것이라 클래스만 토큰으로 바꿨다.
// 옛 화면이 손으로 짓던 모달(시트 관리·누락 조건·부품 정보 준비)은 Dialog 로, 견적명 입력은 promptDialog,
// 삭제의 2단 버튼은 confirmDialog 로 옮겼다(포커스 가두기·Esc·스크롤 잠금은 Dialog 가 한다).

const route = useRoute();
const router = useRouter();
const qc = useQueryClient();
const quoteId = computed(() => String(route.params.id ?? ''));

async function goToUpload(): Promise<void> {
  await router.push({ name: NEXT_SMARTBOM_ROUTES.bom });
}

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
const parsingFailureKind = ref<'none' | 'temporary' | 'terminal'>('none');
const parsingErrorPanel = ref<HTMLElement | null>(null);
const buildFailurePanel = ref<HTMLElement | null>(null);
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
  if (code === 'BOM_ENGINE_UNREACHABLE') return '분석 엔진에 연결할 수 없습니다. 완료된 분석 결과를 다시 불러와 주세요.';
  return '시트 분석 결과를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

function prepareFailureKind(reason: unknown): 'temporary' | 'terminal' {
  if (!(reason instanceof ApiRequestError)) return 'temporary';
  const code = reason.payload?.error;
  if (code === 'ENGINE_JOB_GONE' || code === 'INVALID_ENGINE_RESULT') return 'terminal';
  return reason.status >= 500 ? 'temporary' : 'terminal';
}

function focusParsingError(): void {
  void nextTick(() => parsingErrorPanel.value?.focus());
}

async function prepareCompletedAnalysis(): Promise<void> {
  if (prepareSheets.isPending.value || detail.value?.buildStatus !== 'parsing') return;
  buildError.value = '';
  parsingFailureKind.value = 'none';
  try {
    await prepareSheets.mutateAsync(quoteId.value);
  } catch (reason) {
    buildError.value = sheetErrorMessage(reason);
    parsingFailureKind.value = prepareFailureKind(reason);
    await quote.refetch();
    focusParsingError();
  }
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

function sheetFailureLabel(reason: string | null): string {
  if (reason === null) return '';
  if (reason === 'header_not_found') return '부품 표의 헤더를 찾지 못했습니다.';
  return reason;
}

watch(
  [() => job.data.value?.data.status, () => detail.value?.buildStatus],
  ([status, buildStatus]) => {
    if (status === 'completed' && buildStatus === 'parsing' && !prepareSheets.isPending.value) {
      void prepareCompletedAnalysis();
    }
    if (status === 'failed') {
      buildError.value = job.data.value?.data.error ?? 'BOM 분석에 실패했습니다.';
      parsingFailureKind.value = 'terminal';
      focusParsingError();
    }
  },
  { immediate: true },
);
watch(
  () => job.error.value,
  (err) => {
    if (err !== null && isParsing.value) {
      buildError.value = '분석 잡을 찾을 수 없습니다(서버 재시작 등). 새 BOM으로 다시 업로드해 주세요.';
      parsingFailureKind.value = 'terminal';
      focusParsingError();
    }
  },
);

watch(
  isBuildFailed,
  (failed) => {
    if (failed) void nextTick(() => buildFailurePanel.value?.focus());
  },
  { immediate: true },
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
  parsingFailureKind.value = 'none';
  lastServerItems = new Map();
});

// ── 로컬 편집 상태(draft) — 서버 응답이 올 때마다 동기화 ─────────────────────
const items = ref<BomQuoteItemType[]>([]);
const setQty = ref(1);
const spareQty = ref(0);
const dirty = ref(false);

// 서버 항목 참조 추적 — vue-query structural sharing 은 내용이 안 바뀐 항목을
// 폴링 응답에서도 같은 참조로 유지한다. 그 항목은 로컬 클론을 재사용해
// 행 컴포넌트(QuoteRow)의 props 가 그대로 유지되게 하고 재렌더를 건너뛴다.
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

// 옛 화면의 v-model.number 와 같은 뜻 — 숫자로 읽히면 반영하고, 확정(change)에서 전 행을 다시 박제한다.
function onSetQtyInput(value: string | number): void {
  const parsed = Number.parseFloat(String(value));
  if (!Number.isNaN(parsed)) setQty.value = parsed;
}

function onSpareQtyInput(value: string | number): void {
  const parsed = Number.parseFloat(String(value));
  if (!Number.isNaN(parsed)) spareQty.value = parsed;
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
    // 격리(QuoteRow props 참조 유지)가 깨진다. onSuccess 가 이미 setQueryData(structural
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
const sheetManagerError = ref<HTMLElement | null>(null);
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

// 반영 중에는 닫지 않는다(옛 화면과 같음) — Esc·바깥 클릭·닫기 버튼 모두 여기로 온다.
function closeSheetManager(): void {
  if (!updateSheets.isPending.value) sheetManagerOpen.value = false;
}

function onSheetManagerOpenChange(open: boolean): void {
  if (!open) closeSheetManager();
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
    void nextTick(() => sheetManagerError.value?.focus());
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

// QueueTabs 는 문자열 key 라 시트 번호를 'sheet-N' 으로 바꿔 건넨다.
const sheetTabKey = (key: ResultSheetFilter): string => (typeof key === 'number' ? `sheet-${String(key)}` : key);
const resultSheetQueueTabs = computed<QueueTab<string>[]>(() =>
  resultSheetTabs.value.map((tab) => ({ key: sheetTabKey(tab.key), label: tab.label, count: tab.count })),
);
const activeResultSheetTab = computed<string>({
  get: () => sheetTabKey(activeResultSheet.value),
  set: (value) => {
    const tab = resultSheetTabs.value.find((entry) => sheetTabKey(entry.key) === value);
    if (tab !== undefined) selectResultSheet(tab.key);
  },
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

// 분석 카드는 현재 탭 기준, 금액·견적요청 가능 여부는 전체 견적 기준이다.
const stats = computed(() => summarizeBomQuoteItems(sheetItems.value));
const quoteStats = computed(() => summarizeBomQuoteItems(items.value));
const hasPassiveDefaultsOpportunity = computed(() => (
  quoteStats.value.pendingReview > 0
  || quoteStats.value.review > 0
  || quoteStats.value.unmatched > 0
));

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
const resultsScrollEl = ref<HTMLElement | null>(null);

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
  if (resultMatchFilter.value !== 'all' && itemMatchGroup(item) !== resultMatchFilter.value) return false;
  if (resultSearchLimitedOnly.value && !itemHasSupplierSearchLimit(item)) return false;
  return true;
}));

const resultFiltersActive = computed(() =>
  resultMatchFilter.value !== 'all'
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
const RESULT_SORTS = Object.keys(RESULT_SORT_LABEL) as ResultSort[];
const resultSort = ref<ResultSort>('default');

function onResultSortChange(event: Event): void {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
  resultSort.value = RESULT_SORTS.find((sort) => sort === value) ?? 'default';
  scrollResultsToTop();
}

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

// 결과 행 가상 스크롤은 표 본문(workbench/ResultsBody)이 맡는다 — 스크롤마다 바뀌는 가상 행 상태를 그 컴포넌트만
// 읽게 해 페이지(머리·우측 패널)가 스크롤 프레임마다 다시 그려지지 않게 한다.

function selectResultSheet(key: ResultSheetFilter): void {
  activeResultSheet.value = key;
  scrollResultsToTop();
}

function clearResultFilters(): void {
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

// AI 분석결과 칸 6개 — 옛 화면의 손수 지은 버튼 6개를 같은 조건 그대로 한 목록으로 묶었다.
// 숫자 색은 칸의 뜻(전체=주색·매칭=끝남·검토/재고=주의·미매칭=문제·제외=중립)을 따른다.
interface AnalysisTile {
  key: string;
  label: string;
  value: number;
  pct: number | null;
  tone: string;
  icon: Component;
  pressed: boolean;
  disabled: boolean;
  title: string | undefined;
  ariaLabel: string;
  onClick: () => void;
}
const analysisTiles = computed<AnalysisTile[]>(() => {
  const s = stats.value;
  const busy = enriching.value;
  const filter = resultMatchFilter.value;
  const busyTitle = '공급사 확인이 완료되면 필터할 수 있습니다';
  return [
    {
      key: 'total',
      label: 'Total Lines',
      value: s.total,
      pct: null,
      tone: 'text-primary',
      icon: ListIcon,
      pressed: !resultFiltersActive.value,
      disabled: false,
      title: undefined,
      ariaLabel: `전체 ${String(s.total)}개 행 보기`,
      onClick: clearResultFilters,
    },
    {
      key: 'matched',
      label: 'Matched',
      value: s.matched,
      pct: s.matchedPct,
      tone: 'text-success',
      icon: CheckIcon,
      pressed: filter === 'matched',
      disabled: s.matched === 0,
      title: s.matched === 0 ? '매칭 완료 항목이 없습니다' : undefined,
      ariaLabel: `매칭 완료 ${String(s.matched)}개 행 필터`,
      onClick: () => {
        toggleResultMatchFilter('matched');
      },
    },
    {
      key: 'review',
      label: 'Review',
      value: s.review,
      pct: null,
      tone: 'text-warning',
      icon: CircleAlertIcon,
      pressed: !busy && filter === 'review',
      disabled: busy || s.review === 0,
      title: busy ? busyTitle : s.review === 0 ? '검토 필요 항목이 없습니다' : undefined,
      ariaLabel: `검토 필요 ${String(s.review)}개 행 필터`,
      onClick: () => {
        toggleResultMatchFilter('review');
      },
    },
    // 보강 진행 중엔 Checking(주색) — 최종 미매칭 판정과 구분
    {
      key: 'unmatched',
      label: busy ? 'Checking' : 'Unmatched',
      value: busy ? s.unresolved : s.unmatched,
      pct: null,
      tone: busy ? 'text-primary' : 'text-destructive',
      icon: busy ? Spinner : XIcon,
      pressed: !busy && filter === 'unmatched',
      disabled: busy || s.unmatched === 0,
      title: busy ? busyTitle : s.unmatched === 0 ? '미매칭 항목이 없습니다' : undefined,
      ariaLabel: busy ? `확인 중 ${String(s.unresolved)}개 행` : `미매칭 ${String(s.unmatched)}개 행 필터`,
      onClick: () => {
        toggleResultMatchFilter('unmatched');
      },
    },
    {
      key: 'nostock',
      label: 'Nostock',
      value: s.nostock,
      pct: s.nostockPct,
      tone: 'text-warning',
      icon: PackageXIcon,
      pressed: filter === 'nostock',
      disabled: s.nostock === 0,
      title: s.nostock === 0 ? '재고 확인 필요 항목이 없습니다' : undefined,
      ariaLabel: `재고 확인 필요 ${String(s.nostock)}개 행 필터`,
      onClick: () => {
        toggleResultMatchFilter('nostock');
      },
    },
    {
      key: 'excluded',
      label: 'Excluded',
      value: s.excluded,
      pct: null,
      tone: 'text-muted-foreground',
      icon: MinusIcon,
      pressed: !busy && filter === 'excluded',
      disabled: busy || s.excluded === 0,
      title: busy ? busyTitle : s.excluded === 0 ? '검색 제외 항목이 없습니다' : undefined,
      ariaLabel: `검색 제외 ${String(s.excluded)}개 행 필터`,
      onClick: () => {
        toggleResultMatchFilter('excluded');
      },
    },
  ];
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

function openComparison(): void {
  comparisonPage.value = 1;
  comparisonSearch.value = '';
  comparisonStatus.value = 'all';
  comparisonSheet.value = 'all';
  compareOpen.value = true;
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

// ── 후보 비교·선택 서랍 + 카탈로그 폴백 ────────────────────────────────────
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

watch(quoteId, () => {
  passiveDefaultsOpen.value = false;
  passiveDefaultsError.value = '';
  clearRowSearchState();
});

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
  passiveDefaultsOpen.value = false;
  offerModal.value = null;
  partModal.value = null;
  // 현재 행 조건 재검색은 패널·필터·스크롤을 유지하되 패널 안의 변경 동작만 잠근다.
  if (candidateRowSearchLocked.value) return;
  candidateItemId.value = null;
  selectionSurface.value = null;
});

// 누락 조건 기본값 — NativeSelect 는 문자열을 그대로 돌려준다.
const selectValue = (event: Event): string => (event.target instanceof HTMLSelectElement ? event.target.value : '');

function openPassiveDefaults(): void {
  if (!isDraft.value || editingLocked.value) return;
  passiveDefaultsError.value = '';
  passiveDefaultsOpen.value = true;
}

function onPassiveDefaultsOpenChange(open: boolean): void {
  if (!open) passiveDefaultsOpen.value = false;
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

function openPartModal(mode: 'swap' | 'add', lineIdx: number | null, query: string): void {
  if (editingLocked.value) return;
  partModal.value = { mode, lineIdx, query };
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

function onPartDataOpenChange(open: boolean): void {
  if (!open) closePartDataPreparation();
}

onBeforeUnmount(() => {
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
      catalogInquiry: part.hasCatalogInquiryOffer && pick === null,
      quantityState: 'verified',
      identityPreview: null,
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
    item.catalogInquiry = part.hasCatalogInquiryOffer && pick === null;
    item.identityPreview = null;
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

// 견적명 입력 → 마지막 편집 저장 → 요청. 입력 대화상자를 연 채로 저장하고, 실패하면 입력을 둔 채
// 옛 화면과 같은 문구를 보인다(서버 문구 대신 — submit 이 일반 Error 로 바꿔 던진다).
async function openRequestModal(): Promise<void> {
  if (editingLocked.value) return;
  await promptDialog({
    title: '견적요청',
    description: '요청 후에는 내용이 동결되고 담당자가 확정 견적으로 회신합니다.',
    fields: [{ name: 'title', label: '견적명', required: true, placeholder: '견적명', value: detail.value?.title ?? '' }],
    confirmLabel: '견적요청 보내기',
    errorFallback: '견적요청에 실패했습니다. 포함된 라인이 있는지 확인해 주세요.',
    submit: async (values) => {
      if (editingLocked.value) return;
      await saveNow(); // 마지막 편집 반영 후 요청
      try {
        await request.mutateAsync({ quoteId: quoteId.value, title: (values.title ?? '').trim() });
      } catch {
        throw new Error('request-failed');
      }
    },
  });
}

async function onCancel(): Promise<void> {
  try {
    await cancel.mutateAsync(quoteId.value);
  } catch {
    // 상태 전이 불가 등 — 화면 갱신으로 확인
  }
}

// 작성 중·취소 견적 삭제 — 하드 삭제(항목·원본 파일 정리). 되돌릴 수 없어 한 번 더 묻는다
// (옛 화면은 같은 버튼이 5초간 확정 버튼으로 바뀌는 2단계였다).
const del = useDeleteBomQuote();

async function onDelete(): Promise<void> {
  const ok = await confirmDialog({
    title: '견적 삭제',
    message: '정말 삭제 — 되돌릴 수 없습니다. 견적 항목과 원본 파일이 함께 정리됩니다.',
    confirmLabel: '삭제',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await del.mutateAsync(quoteId.value);
    await goToUpload();
  } catch {
    // 삭제 가능 상태가 아님 등 — 화면 갱신으로 확인
  }
}

// ── 표시 헬퍼 ────────────────────────────────────────────────────────────────
function fmtWon(v: number | null): string {
  return v === null ? '—' : `${v.toLocaleString('ko-KR')}원`;
}

function fmtAmount(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('ko-KR');
}
</script>

<template>
  <div class="h-full">
    <p v-if="quote.isLoading.value" class="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
      <Spinner />불러오는 중…
    </p>

    <!-- 전체 워크북 파싱 — 이 단계에서는 계산·공급사 검색을 시작하지 않는다 -->
    <div v-else-if="isParsing" class="p-6">
      <Card class="items-center p-10 text-center">
        <template v-if="buildError === ''">
          <p class="text-lg font-semibold">BOM을 분석하고 있습니다…</p>
          <p class="text-muted-foreground text-sm">{{ job.data.value?.data.message ?? '헤더·품번·수량을 인식하는 중' }}</p>
          <div class="bg-muted h-2 w-64 overflow-hidden rounded-full">
            <div
              class="bg-primary h-full w-(--progress) rounded-full transition-all"
              :style="{ '--progress': `${String(job.data.value?.data.progress ?? 5)}%` }"
            />
          </div>
          <p v-if="prepareSheets.isPending.value" class="text-primary text-sm">시트별 분석 결과를 정리하고 있습니다…</p>
        </template>
        <div
          v-else
          ref="parsingErrorPanel"
          role="alert"
          aria-labelledby="admin-bom-parsing-error-title"
          tabindex="-1"
          class="flex flex-col items-center gap-2 outline-none"
        >
          <p id="admin-bom-parsing-error-title" class="text-destructive text-lg font-semibold">
            BOM 분석 결과를 불러오지 못했습니다
          </p>
          <p class="text-muted-foreground text-sm">{{ buildError }}</p>
          <div class="mt-2 flex flex-col justify-center gap-2 sm:flex-row">
            <Button
              v-if="parsingFailureKind === 'temporary'"
              size="lg"
              :disabled="prepareSheets.isPending.value"
              @click="prepareCompletedAnalysis"
            >
              {{ prepareSheets.isPending.value ? '다시 불러오는 중…' : '분석 결과 다시 불러오기' }}
            </Button>
            <Button size="lg" :variant="parsingFailureKind === 'temporary' ? 'outline' : 'default'" @click="goToUpload()">
              새 BOM 업로드
            </Button>
          </div>
        </div>
      </Card>
    </div>

    <!-- BOM 시트가 둘 이상이면 고객이 계산 대상을 명시한다 -->
    <div v-else-if="isSelecting && detail" class="flex h-full min-h-0 justify-center p-6">
      <Card class="flex min-h-0 w-full max-w-230 flex-col p-6">
        <div class="flex shrink-0 flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-primary text-xs font-bold tracking-widest uppercase">Sheet selection</p>
            <h1 class="mt-1 text-xl font-semibold tracking-tight">계산할 BOM 시트를 선택해 주세요</h1>
            <p class="text-muted-foreground mt-2 text-sm">선택한 시트의 부품만 가격·재고를 검색하고 견적 합계에 반영합니다. 여러 시트를 함께 선택할 수 있습니다.</p>
          </div>
          <Button variant="outline" @click="goToUpload()">다른 파일 업로드</Button>
        </div>

        <div class="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pr-2 md:grid-cols-2">
          <div
            v-for="sheet in detail.sheets"
            :key="sheet.sheetIndex"
            :class="sheet.status !== 'parsed' ? 'cursor-not-allowed opacity-65' : 'cursor-pointer'"
          >
            <FieldLabel :for="`bom-sheet-${String(sheet.sheetIndex)}`" class="h-full">
              <Field orientation="horizontal">
                <Checkbox
                  :id="`bom-sheet-${String(sheet.sheetIndex)}`"
                  :model-value="selectedSheetIndexes.includes(sheet.sheetIndex)"
                  :disabled="sheet.status !== 'parsed' || build.isPending.value"
                  @update:model-value="toggleSheet(sheet.sheetIndex)"
                />
                <FieldContent class="min-w-0">
                  <FieldTitle class="w-full justify-between">
                    <span class="truncate" :title="sheet.sheetName">{{ sheet.sheetName }}</span>
                    <Badge :variant="sheetStatusBadge(sheet.status).variant">{{ sheetStatusBadge(sheet.status).label }}</Badge>
                  </FieldTitle>
                  <p class="text-foreground mt-2 text-2xl font-bold tabular-nums">
                    {{ sheet.componentCount.toLocaleString('ko-KR') }}<small class="text-muted-foreground ml-1 text-xs font-medium">개 부품</small>
                  </p>
                  <FieldDescription v-if="sheet.failureReason">{{ sheetFailureLabel(sheet.failureReason) }}</FieldDescription>
                  <FieldDescription v-else-if="sheet.warnings.length > 0">
                    <span class="text-warning">{{ sheet.warnings.join(' · ') }}</span>
                  </FieldDescription>
                </FieldContent>
              </Field>
            </FieldLabel>
          </div>
        </div>

        <Alert v-if="buildError !== ''" variant="destructive" size="sm">
          <AlertDescription>{{ buildError }}</AlertDescription>
        </Alert>
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t pt-5">
          <p class="text-muted-foreground text-sm">
            <strong class="text-foreground">{{ selectedSheetIndexes.length }}개 시트</strong> · 최대 {{ selectedComponentCount.toLocaleString('ko-KR') }}개 부품 선택
          </p>
          <Button
            size="lg"
            :disabled="selectedSheetIndexes.length === 0 || build.isPending.value"
            @click="submitSheetSelection()"
          >
            <Spinner v-if="build.isPending.value" />
            {{ build.isPending.value ? '선택한 시트를 계산하는 중…' : `선택한 ${String(selectedSheetIndexes.length)}개 시트 계산` }}
          </Button>
        </div>
      </Card>
    </div>

    <div v-else-if="isBuilding" class="p-6">
      <Card class="items-center p-10 text-center">
        <span class="text-primary"><Spinner class="size-6" /></span>
        <p class="text-lg font-semibold">선택한 시트를 계산하고 있습니다…</p>
        <p class="text-muted-foreground text-sm">라인과 주문수량 계산이 끝나면 결과가 표시되고 공급사 검색이 이어집니다.</p>
      </Card>
    </div>

    <div
      v-else-if="isBuildFailed && detail"
      ref="buildFailurePanel"
      role="alert"
      aria-labelledby="admin-bom-build-failed-title"
      tabindex="-1"
      class="p-6 outline-none"
    >
      <Card class="p-8">
        <div>
          <h1 id="admin-bom-build-failed-title" class="text-destructive text-lg font-semibold">계산할 수 있는 BOM 시트를 찾지 못했습니다</h1>
          <p class="text-muted-foreground mt-2 text-sm">시트별 분석 결과를 확인한 후, 헤더에 품번과 수량이 포함된 파일을 다시 업로드해 주세요.</p>
        </div>
        <ul class="divide-y rounded-lg border">
          <li
            v-for="sheet in detail.sheets"
            :key="sheet.sheetIndex"
            class="flex flex-col items-start gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <span class="w-full font-semibold sm:w-auto sm:truncate">{{ sheet.sheetName }}</span>
            <span class="text-muted-foreground text-left text-xs sm:text-right">
              {{ sheetStatusBadge(sheet.status).label }}<span v-if="sheet.failureReason"> · {{ sheetFailureLabel(sheet.failureReason) }}</span>
            </span>
          </li>
        </ul>
        <div>
          <Button @click="goToUpload()">새 BOM 업로드</Button>
        </div>
      </Card>
    </div>

    <!-- 워크벤치 — 시안(87:12875): 좌 매칭 결과 표(내부 스크롤) + 우 정보 패널(고정) -->
    <div
      v-else-if="detail && detail.buildStatus === 'ready'"
      class="bomwide:flex-row bomwide:overflow-visible flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5"
    >
      <!-- 좌: 파일명·동작(고정) + 표(내부 스크롤) -->
      <section class="bomwide:min-h-0 bomwide:flex-1 flex min-h-160 min-w-0 flex-none flex-col">
        <div class="flex flex-wrap items-start justify-between gap-3 px-1">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="icon-sm" title="목록으로" aria-label="목록으로" @click="goToUpload()">
                <ArrowLeftIcon />
              </Button>
              <h1 class="text-lg font-semibold tracking-tight">{{ detail.fileName ?? detail.title }}</h1>
              <Button variant="outline" size="sm" title="새 BOM 업로드" @click="goToUpload()">
                <UploadIcon />업로드
              </Button>
              <Badge :variant="workbenchQuoteStatusBadge(detail.status).variant">{{ workbenchQuoteStatusBadge(detail.status).label }}</Badge>
              <Badge v-if="refreshedNotice" variant="success">가격·재고 확인 완료 — 최신 결과로 갱신되었습니다</Badge>
            </div>
            <div class="text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5 pl-9 text-sm">
              <span>{{ quoteStats.total }}개 부품</span>
              <Badge v-if="showResultSheetTabs" variant="secondary">{{ selectedResultSheets.length }}개 시트</Badge>
              <template v-else>
                <Badge v-for="sheet in selectedResultSheets" :key="sheet.sheetIndex" variant="secondary">{{ sheet.sheetName }}</Badge>
              </template>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="isDraft" class="text-muted-foreground mr-1 text-xs">
              <template v-if="saveState === 'saving'">저장 중…</template>
              <template v-else-if="saveState === 'saved' && !dirty">자동 저장됨</template>
              <span v-else-if="saveState === 'error'" class="text-destructive">저장 실패</span>
            </span>
            <Button
              v-if="isDraft && manageableResultSheets.length > 1"
              variant="outline"
              :disabled="editingLocked || patch.isPending.value"
              :title="editingLocked ? EDIT_LOCK_TITLE : '견적에 포함할 시트 관리'"
              @click="openSheetManager"
            >
              <LayoutGridIcon />
              시트 {{ selectedResultSheets.length }}/{{ manageableResultSheets.length }}
            </Button>
            <Button variant="outline" title="Excel 원본과 공급사 검색 결과 비교" @click="openComparison">
              <Columns2Icon />BOM 비교
            </Button>
            <!-- 사용자 화면에서는 숨기되 재활성화를 위해 누락조건 적용 흐름은 유지한다. -->
            <Button
              v-if="isDraft && hasPassiveDefaultsOpportunity"
              variant="outline"
              class="hidden"
              :disabled="editingLocked"
              :title="editingLocked ? EDIT_LOCK_TITLE : '저항·MLCC의 누락 필수조건을 한 번 확인하고 다시 검색'"
              @click="openPassiveDefaults"
            >
              <CheckIcon />누락 조건 적용
            </Button>
            <Button
              v-if="isDraft"
              :disabled="editingLocked"
              :title="editingLocked ? EDIT_LOCK_TITLE : '부품 추가'"
              @click="openPartModal('add', null, '')"
            >
              <PlusIcon />추가
            </Button>
          </div>
        </div>

        <!-- 자동 보강 진행 띠 — 완료되면 서버가 재매칭한 결과가 폴링으로 자동 반영된다 -->
        <Alert v-if="enriching" variant="info" class="mt-3" role="status">
          <Spinner />
          <AlertTitle>
            <span class="flex items-center justify-between gap-3">
              <span>{{ applying ? '검색 완료 — 결과를 반영하고 있습니다…' : '공급사에서 가격·재고를 확인하고 있습니다 — 완료되면 자동으로 반영됩니다' }}</span>
              <span class="font-semibold tabular-nums">{{ enrichProgress }}%</span>
            </span>
          </AlertTitle>
          <AlertDescription>
            <p class="text-xs">확인 중에는 BOM 편집이 잠시 제한됩니다.</p>
            <div class="bg-info/15 mt-1.5 h-1.5 overflow-hidden rounded-full">
              <div
                class="bg-info h-full w-(--progress) rounded-full transition-all duration-700"
                :style="{ '--progress': `${String(enrichProgress)}%` }"
              />
            </div>
          </AlertDescription>
        </Alert>

        <Alert v-else-if="detail.supplierSearchLimitedCount > 0" variant="warning" class="mt-3">
          <CircleAlertIcon />
          <AlertTitle>공급사 검색이 일부 중단되었습니다</AlertTitle>
          <AlertDescription>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div class="min-w-0">
                <p v-if="(detail.supplierSearchLimitSummary?.jobCallLimitComponentCount ?? 0) > 0">
                  엔진 작업당 호출 상한
                  <strong v-if="typeof detail.supplierSearchLimitSummary?.maxCalls === 'number'">
                    {{ detail.supplierSearchLimitSummary?.maxCalls.toLocaleString('ko-KR') }}회
                  </strong>
                  에 도달해
                  <strong>{{ detail.supplierSearchLimitSummary?.jobCallLimitComponentCount.toLocaleString('ko-KR') }}개 부품</strong>의 일부 공급사 검색이 실행되지 않았습니다.
                </p>
                <p v-if="(detail.supplierSearchLimitSummary?.supplierQuotaComponentCount ?? 0) > 0">
                  공급사 API 자체 한도로
                  <strong>{{ detail.supplierSearchLimitSummary?.supplierQuotaComponentCount.toLocaleString('ko-KR') }}개 부품</strong>의 확인이 제한되었습니다.
                </p>
                <p
                  v-if="detail.supplierSearchLimitSummary === null || (
                    detail.supplierSearchLimitSummary.jobCallLimitComponentCount === 0
                    && detail.supplierSearchLimitSummary.supplierQuotaComponentCount === 0
                  )"
                >
                  검색 한도에 도달해 <strong>{{ detail.supplierSearchLimitedCount.toLocaleString('ko-KR') }}개 부품</strong>의 일부 공급사 확인이 제한되었습니다.
                </p>
                <p class="text-muted-foreground mt-1 text-xs">
                  이는 실제 검색 결과가 없는 경우와 다릅니다. 이미 확인된 후보와 금액은 계속 사용할 수 있습니다.
                  <template v-if="typeof detail.supplierSearchLimitSummary?.actualApiCalls === 'number'">
                    · 실제 API 호출 {{ detail.supplierSearchLimitSummary?.actualApiCalls.toLocaleString('ko-KR') }}회
                  </template>
                </p>
              </div>
              <Button v-if="searchLimitedItemCount > 0" size="sm" class="shrink-0" @click="showSupplierSearchLimitedItems">
                영향받은 {{ searchLimitedItemCount.toLocaleString('ko-KR') }}개 행 보기
              </Button>
            </div>
          </AlertDescription>
        </Alert>

        <!-- 여러 시트 결과를 원본 단위로 탐색하되 견적 합계·선택 상태는 하나로 유지한다 -->
        <QueueTabs v-if="showResultSheetTabs" v-model="activeResultSheetTab" class="mt-3" :tabs="resultSheetQueueTabs" />

        <!-- 매칭 결과 머리 -->
        <div :class="showResultSheetTabs ? 'mt-2' : 'mt-4'" class="flex min-h-7 flex-wrap items-center justify-between gap-2 px-1">
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-sm font-semibold">매칭 결과</p>
            <template v-if="resultFiltersActive">
              <span class="text-muted-foreground text-xs font-medium">{{ stats.total }}개 중 {{ filteredItems.length }}개 표시</span>
              <Badge v-if="activeMatchFilterLabel !== null" variant="info">{{ activeMatchFilterLabel }}</Badge>
              <Badge v-if="resultSearchLimitedOnly" variant="warning">검색 한도 영향</Badge>
              <Button variant="link" size="xs" @click="clearResultFilters">필터 해제</Button>
            </template>
          </div>
          <div class="flex items-center gap-2">
            <!-- 정렬 — 시안 87:12875 의 "가격순" -->
            <label class="sr-only" for="bom-result-sort">결과 정렬</label>
            <NativeSelect
              id="bom-result-sort"
              class="h-7"
              :model-value="resultSort"
              title="매칭 결과 정렬"
              @change="onResultSortChange"
            >
              <NativeSelectOption v-for="(label, value) in RESULT_SORT_LABEL" :key="value" :value="value">{{ label }}</NativeSelectOption>
            </NativeSelect>
            <!-- 선택 삭제 — 미구현(디자인만) -->
            <span title="선택 삭제 (준비 중)">
              <Button variant="outline" size="sm" disabled>선택 삭제</Button>
            </span>
          </div>
        </div>

        <!-- 표 — 이 영역만 내부 스크롤, 머리는 sticky -->
        <div ref="resultsScrollEl" class="bg-card contain-layout contain-paint mt-2 min-h-0 flex-1 overflow-auto rounded-xl border">
          <!-- table-fixed — auto 레이아웃은 폭이 바뀔 때마다 모든 행의 셀 내용을 다시 측정해서
               행이 많아지면 리사이즈가 눈에 띄게 버벅인다. 열 폭은 아래 colgroup 이 단일 소스이고,
               값은 각 td 의 좌우 padding 까지 포함한 실제 필요 폭이다(합 964 + Description 140 = 1104). -->
          <table id="bom-results-table" class="w-full min-w-276 table-fixed text-sm" :aria-busy="editingLocked">
            <colgroup>
              <col class="w-14">
              <col class="w-59"><!-- MPN — 제조사를 독립 열로 뺀 만큼 296→236 -->
              <col class="w-35"><!-- MANUFACTURER -->
              <col><!-- Description — 남는 폭을 가져간다(최소 140px) -->
              <col class="w-32.5">
              <col class="w-44">
              <col class="w-35">
              <col class="w-21.5">
            </colgroup>
            <thead class="bg-card sticky top-0 z-10">
              <tr class="text-muted-foreground text-left text-xs tracking-wide uppercase">
                <th class="border-b px-1 py-2.5 font-medium">
                  <span class="flex justify-center" :title="editingLocked ? EDIT_LOCK_TITLE : allIncluded ? '표시된 행 전체를 견적에서 제외' : '표시된 행 전체를 견적에 포함'">
                    <RowCheckbox
                      :checked="allIncluded ? true : someIncluded ? 'indeterminate' : false"
                      label="표시된 행 전체 포함 및 원본 행"
                      :disabled="!isDraft || editingLocked || includableItems.length === 0"
                      @change="toggleIncludeAll"
                    />
                  </span>
                </th>
                <th class="border-b px-2 py-2.5 font-medium">MPN / 원본 값</th>
                <th class="border-b px-2 py-2.5 font-medium">Manufacturer</th>
                <th class="border-b px-2 py-2.5 font-medium">Description</th>
                <th class="border-b px-2 py-2.5 text-right font-medium">Unit Price</th>
                <th class="border-b px-2 py-2.5 font-medium">Quantity / Stock</th>
                <th class="border-b px-2 py-2.5 text-right font-medium">Total Price</th>
                <th class="border-b px-2 py-2.5" />
              </tr>
            </thead>
            <ResultsBody
              :items="sortedItems"
              :scroll-element="resultsScrollEl"
              :set-qty="setQty"
              :spare-qty="spareQty"
              :is-draft="isDraft"
              :editing-locked="editingLocked"
              :enriching="enriching"
              :empty-text="resultFiltersActive ? '선택한 조건에 해당하는 라인이 없습니다.' : '표시할 라인이 없습니다.'"
              @toggle-include="toggleInclude"
              @qty-change="onRowQtyChange"
              @confirm-quantity="confirmQuantity"
              @open-offers="openQuoteOfferModal"
              @open-candidates="openCandidateDrawer"
              @open-search="openCatalogSearchDrawer"
            />
          </table>
        </div>
      </section>

      <!-- 우: 정보 패널(시안 93:23505) -->
      <aside class="bomwide:min-h-0 bomwide:w-71.5 bomwide:overflow-y-auto bomwide:pb-1 w-full shrink-0">
        <Card class="min-h-full gap-0 p-4">
          <!-- 회신(answered) -->
          <Alert v-if="detail.answerNote !== null || detail.confirmedTotal !== null" variant="success" size="sm" class="mb-4">
            <AlertTitle>담당자 회신</AlertTitle>
            <AlertDescription>
              <p v-if="detail.answerNote" class="whitespace-pre-wrap">{{ detail.answerNote }}</p>
              <p v-if="detail.confirmedTotal !== null" class="mt-1">
                확정 견적: <b class="tabular-nums">{{ fmtWon(detail.confirmedTotal) }}</b>
                <span v-if="detail.confirmedShippingFee !== null" class="mt-1 block text-xs">(운송료 {{ fmtWon(detail.confirmedShippingFee) }} · 관리비 {{ fmtWon(detail.confirmedManagementFee) }})</span>
              </p>
            </AlertDescription>
          </Alert>

          <!-- AI 분석결과 (93:23545) -->
          <section>
            <h2 class="flex items-center gap-2 text-sm font-semibold">
              <SparklesIcon class="text-muted-foreground size-4 shrink-0" />
              AI 분석결과
              <Badge v-if="showResultSheetTabs" variant="info" class="ml-auto" :title="activeResultSheetLabel">
                <span class="block max-w-28 truncate">{{ activeResultSheetLabel }}</span>
              </Badge>
            </h2>
            <div class="mt-2.5 grid grid-cols-2 gap-2">
              <Button
                v-for="tile in analysisTiles"
                :key="tile.key"
                :variant="tile.pressed ? 'secondary' : 'outline'"
                class="h-14 w-full min-w-0 justify-between text-left"
                :disabled="tile.disabled"
                :aria-pressed="tile.pressed"
                :aria-label="tile.ariaLabel"
                aria-controls="bom-results-table"
                :title="tile.title"
                @click="tile.onClick"
              >
                <span class="flex min-w-0 flex-col">
                  <span class="text-muted-foreground truncate text-xs font-medium">{{ tile.label }}</span>
                  <span class="text-lg font-bold tabular-nums" :class="tile.tone">
                    {{ tile.value }}<span v-if="tile.pct !== null" class="ml-1 text-xs font-semibold">{{ tile.pct }}%</span>
                  </span>
                </span>
                <component :is="tile.icon" class="size-4 shrink-0" :class="tile.tone" />
              </Button>
            </div>
          </section>

          <!-- 주문 정보 (93:23562) -->
          <section class="mt-5" title="주문수량은 BOM 수량과 세트·예비 수량을 반영한 뒤 MOQ와 주문배수에 맞춰 계산됩니다.">
            <h2 class="flex items-center gap-2 text-sm font-semibold">
              <PackageIcon class="text-muted-foreground size-4 shrink-0" />
              주문 정보
            </h2>
            <Panel tone="muted" class="mt-2.5 space-y-3">
              <div class="flex items-center justify-between gap-2">
                <span class="text-muted-foreground text-sm">세트 수량</span>
                <div class="flex items-center gap-2">
                  <InputGroup class="w-31">
                    <InputGroupAddon>
                      <InputGroupButton
                        size="icon-xs"
                        :disabled="!isDraft || editingLocked"
                        :title="editingLocked ? EDIT_LOCK_TITLE : undefined"
                        aria-label="세트 수량 줄이기"
                        @click="stepSet(-1)"
                      >
                        <MinusIcon />
                      </InputGroupButton>
                    </InputGroupAddon>
                    <InputGroupInput
                      class="text-center"
                      type="number"
                      min="1"
                      :model-value="setQty"
                      :disabled="!isDraft || editingLocked"
                      :title="editingLocked ? EDIT_LOCK_TITLE : undefined"
                      aria-label="세트 수량"
                      @update:model-value="onSetQtyInput"
                      @change="restampAll"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="icon-xs"
                        :disabled="!isDraft || editingLocked"
                        :title="editingLocked ? EDIT_LOCK_TITLE : undefined"
                        aria-label="세트 수량 늘리기"
                        @click="stepSet(1)"
                      >
                        <PlusIcon />
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <span class="text-muted-foreground w-5 text-xs font-semibold">Set</span>
                </div>
              </div>
              <div class="flex items-center justify-between gap-2">
                <span class="text-muted-foreground text-sm">예비 수량</span>
                <div class="flex items-center gap-2">
                  <InputGroup class="w-31">
                    <InputGroupAddon>
                      <InputGroupButton
                        size="icon-xs"
                        :disabled="!isDraft || editingLocked"
                        :title="editingLocked ? EDIT_LOCK_TITLE : undefined"
                        aria-label="예비 수량 줄이기"
                        @click="stepSpare(-1)"
                      >
                        <MinusIcon />
                      </InputGroupButton>
                    </InputGroupAddon>
                    <InputGroupInput
                      class="text-center"
                      type="number"
                      min="0"
                      :model-value="spareQty"
                      :disabled="!isDraft || editingLocked"
                      :title="editingLocked ? EDIT_LOCK_TITLE : undefined"
                      aria-label="예비 수량"
                      @update:model-value="onSpareQtyInput"
                      @change="restampAll"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="icon-xs"
                        :disabled="!isDraft || editingLocked"
                        :title="editingLocked ? EDIT_LOCK_TITLE : undefined"
                        aria-label="예비 수량 늘리기"
                        @click="stepSpare(1)"
                      >
                        <PlusIcon />
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <span class="text-muted-foreground w-5 text-xs font-semibold">Set</span>
                </div>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-muted-foreground text-sm">예상 납기</span>
                <span class="text-info flex items-center gap-1.5 text-xs font-semibold"><span class="bg-info size-1.5 rounded-full" />확정 시 안내</span>
              </div>
            </Panel>
          </section>

          <!-- 예상 견적 (93:23573) -->
          <section class="mt-5" :aria-busy="pricingPending">
            <h2 class="flex items-center gap-2 text-sm font-semibold">
              <ReceiptIcon class="text-muted-foreground size-4 shrink-0" />
              예상 견적
              <Badge v-if="showResultSheetTabs" variant="secondary" class="ml-auto">전체 견적</Badge>
            </h2>
            <Alert v-if="pricingPending" variant="info" size="sm" class="mt-2.5" aria-live="polite">
              <Spinner />
              <AlertTitle>공급사 가격을 확인하고 있습니다</AlertTitle>
              <AlertDescription><p class="text-xs">모든 결과가 반영되면 합계를 표시합니다.</p></AlertDescription>
            </Alert>
            <div v-else class="mt-2.5 flex flex-col gap-2.5">
              <Panel tone="muted" class="space-y-2 text-sm">
                <div class="flex items-baseline justify-between">
                  <span class="text-muted-foreground">합계</span>
                  <span class="font-semibold tabular-nums">{{ fmtAmount(itemsTotal) }} <small class="text-muted-foreground text-xs font-normal">원</small></span>
                </div>
                <div class="flex items-baseline justify-between">
                  <span class="text-muted-foreground">운송료</span>
                  <span class="font-semibold tabular-nums">{{ fmtAmount(detail.shippingFee) }} <small class="text-muted-foreground text-xs font-normal">원</small></span>
                </div>
                <div class="flex items-baseline justify-between">
                  <span class="text-muted-foreground">관리비</span>
                  <span class="font-semibold tabular-nums">{{ fmtAmount(detail.managementFee) }} <small class="text-muted-foreground text-xs font-normal">원</small></span>
                </div>
              </Panel>
              <Panel tone="info" class="flex flex-col gap-2">
                <span class="text-foreground text-sm font-medium">최종합계 <span class="text-muted-foreground text-xs font-normal">(VAT 별도)</span></span>
                <span class="text-primary self-end text-xl font-bold tabular-nums">{{ fmtAmount(finalTotal) }}<small class="ml-1 text-xs font-semibold">원</small></span>
              </Panel>
              <Alert v-if="uncostedCount > 0" variant="warning" size="sm">
                <AlertDescription><p class="text-xs">금액 미산정 라인 {{ uncostedCount }}건 — 미매칭이거나 환산 불가한 통화입니다</p></AlertDescription>
              </Alert>
              <Alert v-if="quoteStats.pendingReview > 0" variant="warning" size="sm">
                <AlertDescription><p class="text-xs font-semibold">선정됨 · 검토 대기 {{ quoteStats.pendingReview }}건 — 임시 선정 금액이 합계에 포함되어 있습니다</p></AlertDescription>
              </Alert>
              <ul class="text-muted-foreground list-disc pl-4 text-xs">
                <li>AI로 산출한 가견적입니다.</li>
                <li>정확한 가격은 담당자 확정 시 안내드립니다.</li>
              </ul>
            </div>
          </section>

          <!-- CTA -->
          <div class="mt-auto space-y-2 pt-8">
            <Button
              v-if="isDraft"
              size="lg"
              class="w-full"
              :disabled="request.isPending.value || quoteStats.included === 0 || editingLocked"
              :title="editingLocked ? EDIT_LOCK_TITLE : undefined"
              @click="openRequestModal"
            >
              <FileTextIcon />
              {{ updateSheets.isPending.value ? '시트 반영 중…' : editingLocked ? '가격 확인 중…' : '견적요청' }}
            </Button>
            <!-- 작성 중·취소=하드 삭제(확인 후) · 요청됨=요청 취소 -->
            <Button
              v-if="canDeleteQuote"
              variant="outline"
              class="w-full"
              :disabled="del.isPending.value"
              @click="onDelete"
            >
              {{ del.isPending.value ? '삭제 중…' : '견적 삭제' }}
            </Button>
            <Button
              v-else-if="detail.status === 'requested'"
              variant="outline"
              class="w-full"
              @click="onCancel"
            >
              요청 취소
            </Button>
          </div>
        </Card>
      </aside>
    </div>

    <!-- 사용자가 승인한 값만 누락된 저항·MLCC 조건에 적용한다. -->
    <Dialog :open="passiveDefaultsOpen" @update:open="onPassiveDefaultsOpenChange">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>누락된 저항·MLCC 조건 확인</DialogTitle>
          <DialogDescription>
            원본 BOM이나 행별 검색조건에 값이 없는 경우에만 아래 값을 적용해 전체 후보를 다시 확인합니다.
          </DialogDescription>
        </DialogHeader>

        <div class="grid gap-3 sm:grid-cols-3">
          <label class="grid gap-1.5">
            <span class="text-xs font-semibold">저항 허용오차</span>
            <NativeSelect :model-value="resistorDefaultTolerance" @change="resistorDefaultTolerance = selectValue($event)">
              <NativeSelectOption value="0.1%">±0.1%</NativeSelectOption>
              <NativeSelectOption value="0.5%">±0.5%</NativeSelectOption>
              <NativeSelectOption value="1%">±1%</NativeSelectOption>
              <NativeSelectOption value="5%">±5%</NativeSelectOption>
              <NativeSelectOption value="10%">±10%</NativeSelectOption>
            </NativeSelect>
          </label>
          <label class="grid gap-1.5">
            <span class="text-xs font-semibold">MLCC 허용오차</span>
            <NativeSelect :model-value="capacitorDefaultTolerance" @change="capacitorDefaultTolerance = selectValue($event)">
              <NativeSelectOption value="5%">±5%</NativeSelectOption>
              <NativeSelectOption value="10%">±10%</NativeSelectOption>
              <NativeSelectOption value="20%">±20%</NativeSelectOption>
            </NativeSelect>
          </label>
          <label class="grid gap-1.5">
            <span class="text-xs font-semibold">MLCC 최소 정격전압</span>
            <NativeSelect :model-value="capacitorDefaultVoltage" @change="capacitorDefaultVoltage = selectValue($event)">
              <NativeSelectOption value="6.3V">6.3V 이상</NativeSelectOption>
              <NativeSelectOption value="10V">10V 이상</NativeSelectOption>
              <NativeSelectOption value="16V">16V 이상</NativeSelectOption>
              <NativeSelectOption value="25V">25V 이상</NativeSelectOption>
              <NativeSelectOption value="50V">50V 이상</NativeSelectOption>
            </NativeSelect>
          </label>
        </div>

        <Alert variant="info" size="sm">
          <AlertTitle>유전체는 보수적으로 자동 적용합니다.</AlertTitle>
          <AlertDescription>1nF 이하는 C0G, 그보다 큰 MLCC는 X7R로 확인합니다. 전해·탄탈·필름 캐패시터에는 이 기본값을 적용하지 않습니다.</AlertDescription>
        </Alert>
        <ul class="text-muted-foreground list-disc space-y-1 pl-4 text-xs">
          <li>BOM과 사용자가 직접 지정한 값이 항상 우선합니다.</li>
          <li>품번 대체·스펙 후보는 실제 사양이 승인값을 충족할 때만 자동 선정합니다.</li>
          <li>공급사 사양이 없거나 불일치하면 계속 검토 대상으로 남습니다.</li>
        </ul>
        <Alert v-if="passiveDefaultsError !== ''" variant="destructive" size="sm">
          <AlertDescription>{{ passiveDefaultsError }}</AlertDescription>
        </Alert>

        <DialogFooter>
          <Button variant="outline" :disabled="passiveDefaultsMutation.isPending.value" @click="passiveDefaultsOpen = false">
            취소
          </Button>
          <Button :disabled="passiveDefaultsMutation.isPending.value" @click="applyPassiveDefaults">
            {{ passiveDefaultsMutation.isPending.value ? '검색 시작 중…' : '승인하고 다시 검색' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 결과 시트 관리: 제외해도 원본 라인·후보·선택 이력은 보존한다. -->
    <Dialog :open="sheetManagerOpen && detail !== null" @update:open="onSheetManagerOpenChange">
      <DialogContent :show-close-button="!updateSheets.isPending.value">
        <DialogHeader>
          <DialogTitle>견적 시트 관리</DialogTitle>
          <DialogDescription>제외한 시트는 견적·합계에서만 빠지며, 원본과 후보 선택 이력은 유지됩니다.</DialogDescription>
        </DialogHeader>

        <DialogScrollBody>
          <div class="flex flex-col gap-2">
            <FieldLabel
              v-for="sheet in manageableResultSheets"
              :key="sheet.sheetIndex"
              :for="`bom-managed-sheet-${String(sheet.sheetIndex)}`"
            >
              <Field orientation="horizontal">
                <Checkbox
                  :id="`bom-managed-sheet-${String(sheet.sheetIndex)}`"
                  :model-value="managedSheetIndexes.includes(sheet.sheetIndex)"
                  :disabled="updateSheets.isPending.value"
                  @update:model-value="toggleManagedSheet(sheet.sheetIndex)"
                />
                <FieldContent class="min-w-0">
                  <FieldTitle><span class="truncate" :title="sheet.sheetName">{{ sheet.sheetName }}</span></FieldTitle>
                  <FieldDescription>{{ sheet.componentCount }}개 부품</FieldDescription>
                </FieldContent>
                <Badge :variant="managedSheetIndexes.includes(sheet.sheetIndex) ? 'info' : 'secondary'">
                  {{ managedSheetIndexes.includes(sheet.sheetIndex) ? '포함' : '제외' }}
                </Badge>
              </Field>
            </FieldLabel>
          </div>
        </DialogScrollBody>

        <Alert v-if="managedSheetIndexes.length === 0" variant="destructive" size="sm">
          <AlertDescription>최소 1개 시트는 견적에 포함해야 합니다.</AlertDescription>
        </Alert>
        <Alert v-else-if="removedSheetCount > 0" variant="warning" size="sm">
          <AlertDescription>
            {{ removedSheetCount }}개 시트의 {{ removedComponentCount }}개 부품을 견적에서 제외합니다. 나중에 다시 포함할 수 있습니다.
          </AlertDescription>
        </Alert>
        <Alert v-else-if="restoredSheetCount > 0" variant="info" size="sm">
          <AlertDescription>
            {{ restoredSheetCount }}개 시트를 다시 포함하고 현재 수량·가격 기준으로 합계를 갱신합니다.
          </AlertDescription>
        </Alert>
        <div v-if="sheetSelectionError !== ''" ref="sheetManagerError" tabindex="-1" class="outline-none">
          <Alert variant="destructive" size="sm">
            <AlertDescription>{{ sheetSelectionError }}</AlertDescription>
          </Alert>
        </div>

        <DialogFooter class="items-center sm:justify-between">
          <span class="text-muted-foreground text-xs">{{ managedSheetIndexes.length }}개 시트 · {{ managedComponentCount }}개 부품 포함</span>
          <div class="flex gap-2">
            <Button variant="outline" :disabled="updateSheets.isPending.value" @click="closeSheetManager">취소</Button>
            <Button
              :disabled="managedSheetIndexes.length === 0 || updateSheets.isPending.value || patch.isPending.value"
              @click="applyManagedSheets"
            >
              {{ updateSheets.isPending.value ? '반영 중…' : '시트 구성 적용' }}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 부품 정보 준비 — 준비가 끝나면 서랍이 자동으로 열린다 -->
    <Dialog :open="pendingSelection !== null" @update:open="onPartDataOpenChange">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{{ pendingSelection?.view === 'search' ? '부품 변경 준비' : '후보 비교 준비' }}</DialogTitle>
          <DialogDescription v-if="!preparePartData.isPending.value && partDataFailureReason === 'result-gone'">
            이전 부품 정보가 만료되었습니다. 저장된 BOM 분석으로 다시 준비할 수 있습니다.
          </DialogDescription>
          <DialogDescription v-else-if="!preparePartData.isPending.value && partDataFailed">
            부품 정보를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.
          </DialogDescription>
          <DialogDescription v-else>
            추천 후보와 검색에 필요한 부품 정보를 준비하고 있습니다. 완료되면 자동으로 열립니다.
          </DialogDescription>
        </DialogHeader>
        <Alert v-if="preparePartData.isPending.value || !partDataFailed" variant="info" size="sm" aria-live="polite">
          <Spinner />
          <AlertTitle>부품 정보 준비 중</AlertTitle>
        </Alert>
        <DialogFooter v-else>
          <Button variant="outline" @click="closePartDataPreparation">취소</Button>
          <Button :disabled="preparePartData.isPending.value" @click="retryPartDataPreparation">다시 준비</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <CandidateDrawer
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
      @select="selectCandidate"
      @catalog-select="onCatalogPartSelected"
      @catalog-offers="openCatalogOffersFromDrawer"
      @search-requirements="updateSearchRequirements"
      @external-supplier-search="runExternalSupplierSearch"
      @close="closeSelectionSurface"
    />
    <QuoteOfferDialog
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
    <OfferDialog
      v-if="offerModal !== null && detail !== null && !editingLocked"
      :part-id="offerModal.partId"
      :needed="neededQty(items[offerModal.lineIdx]?.bomQty ?? 1, setQty, spareQty)"
      :usd-krw-rate="rate"
      @select="onOfferSelected"
      @close="offerModal = null"
    />
    <PartSearchDialog
      v-if="partModal !== null && !editingLocked"
      :initial-query="partModal.query"
      :mode="partModal.mode"
      :needed="partModalNeeded"
      :usd-krw-rate="rate"
      @select="onPartSelected"
      @close="partModal = null"
    />
    <CompareDialog
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
