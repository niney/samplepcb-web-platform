<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQueryClient } from '@tanstack/vue-query';
import { ArrowDownWideNarrowIcon } from '@lucide/vue';
import {
  ADMIN_BOM_LIVE_SUPPLIERS,
  type AdminBomLiveSupplierType,
  type AdminBomRfqItemViewType,
  type AdminBomRfqSelectionBodyType,
  type AdminBomRfqViewType,
  type AdminBomSupplierComparisonOfferType,
  type AdminBomSupplierRefreshViewType,
  type BomQuoteItemType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  childSelectionText,
  isForeignCurrency,
  partnerAmountText,
  partnerFxOf,
  partnerFxText,
  partnerUnitPriceText,
  rfqReplyLineTotalKrw,
  rfqReplyLineTotalOriginal,
} from '@/admin/bom-partner-money';
import { useBomPartnerFxEditor } from '@/admin/useBomPartnerFxEditor';
import {
  useAdminSupplierOfferRefresh,
  useSelectRfqReply,
  useStartAdminSupplierOfferRefresh,
} from '@/admin/useAdminBomRfqs';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Input } from '@/next/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Spinner } from '@/next/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import RfqChoiceCheckbox from './RfqChoiceCheckbox.vue';

// 공급사 비교·선정 — 옛 components/admin/smartbom/BomRfqCompareModal.vue 의 짝(같은 props·emits).
// 품목 × 공급처 매트릭스. 행=부품행, 열=[현재 선정]+[선정 부품 MPN 의 DigiKey·Mouser·UniKeyIC 강제 최신조회]
// +[사람 협력사 회신]. 적용은 행별 선정 API 순차 호출 — 서버가 스냅샷 박제+재계산(감사 이벤트 포함)한다.
// 행 합계는 단가가 아니라 MOQ·주문배수·회신수량을 반영한 실효 금액으로 비교한다(§6.38).

const props = defineProps<{
  open: boolean;
  quoteId: string;
  rfqs: AdminBomRfqViewType[]; // quoted 만 열로 쓴다
  scopeItems: BomQuoteItemType[];
}>();
const emit = defineEmits<{ close: [] }>();


const quotedRfqs = computed(() => props.rfqs.filter((r) => r.status === 'quoted'));
const fxEditor = useBomPartnerFxEditor(
  computed(() => props.quoteId),
  quotedRfqs,
);
const queryClient = useQueryClient();
const quoteIdRef = computed(() => props.quoteId);
const refreshPolling = ref(false);
const refreshSnapshot = ref<AdminBomSupplierRefreshViewType | null>(null);
const refreshError = ref('');
const startSupplierRefresh = useStartAdminSupplierOfferRefresh();
const supplierRefresh = useAdminSupplierOfferRefresh(quoteIdRef, computed(
  () => props.open && refreshPolling.value,
));
const refreshData = computed(
  () => refreshPolling.value
    ? (supplierRefresh.data.value?.data ?? refreshSnapshot.value)
    : refreshSnapshot.value,
);
const refreshRunning = computed(
  () => startSupplierRefresh.isPending.value || refreshData.value?.status === 'running',
);
const invalidatedRefreshRunId = ref<string | null>(null);
watch(
  () => [refreshData.value?.runId ?? null, refreshData.value?.status ?? 'idle'] as const,
  ([runId, status]) => {
    if (
      runId === null
      || runId === invalidatedRefreshRunId.value
      || (status !== 'completed' && status !== 'failed')
    ) return;
    invalidatedRefreshRunId.value = runId;
    void queryClient.invalidateQueries({
      queryKey: ['admin', 'bom-quotes', 'detail', props.quoteId],
    });
    void queryClient.invalidateQueries({
      queryKey: ['admin', 'bom-quotes', 'candidates', props.quoteId],
    });
  },
);
const supplierOfferIndex = computed(() => {
  const best = new Map<string, AdminBomSupplierComparisonOfferType>();
  const counts = new Map<string, number>();
  for (const row of refreshData.value?.rows ?? []) {
    for (const entry of row.offers) {
      const rawSupplier = entry.offer.supplier.toLocaleLowerCase();
      const supplier = ADMIN_BOM_LIVE_SUPPLIERS.find((code) => code === rawSupplier);
      if (supplier === undefined) continue;
      const key = `${row.itemId}\u0000${supplier}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (
        !entry.candidateManualSelectable
        || !entry.offer.purchasable
        || entry.offer.applied === null
      ) continue;
      const current = best.get(key);
      const entryTotal = entry.offer.applied.lineTotalKrw;
      if (entryTotal === null) continue;
      const currentTotal = current?.offer.applied?.lineTotalKrw ?? Number.MAX_SAFE_INTEGER;
      if (
        current === undefined
        || entryTotal < currentTotal
        || (
          entryTotal === currentTotal
          && (entry.offer.purchaseFitRank ?? Number.MAX_SAFE_INTEGER)
            < (current.offer.purchaseFitRank ?? Number.MAX_SAFE_INTEGER)
        )
        || (
          entryTotal === currentTotal
          && entry.offer.purchaseFitRank === current.offer.purchaseFitRank
          && entry.offer.offerKey.localeCompare(current.offer.offerKey) < 0
        )
      ) best.set(key, entry);
    }
  }
  return { best, counts };
});
const supplierRowsByItem = computed(() => new Map(
  (refreshData.value?.rows ?? []).map((row) => [row.itemId, row] as const),
));

const SUPPLIER_LABELS: Record<AdminBomLiveSupplierType, string> = {
  digikey: 'DigiKey',
  mouser: 'Mouser',
  unikeyic: 'UniKeyIC',
};

const supplierSummary = (supplier: AdminBomLiveSupplierType) =>
  refreshData.value?.suppliers.find((entry) => entry.supplier === supplier) ?? null;

function supplierStatusLabel(supplier: AdminBomLiveSupplierType): string {
  const outcome = supplierSummary(supplier)?.outcome;
  if (refreshRunning.value || outcome === 'pending') return '조회 중';
  if (outcome === 'results') return '최신 확인';
  if (outcome === 'partial_error') return '일부 실패';
  if (outcome === 'empty') return '결과 없음';
  if (outcome === 'error') return '일부/전체 실패';
  return '미실행';
}

function emptySupplierCellLabel(supplier: AdminBomLiveSupplierType): string {
  if (refreshRunning.value) return '조회 중…';
  const outcome = supplierSummary(supplier)?.outcome;
  if (outcome === 'error') return '조회 실패';
  if (outcome === 'partial_error') return '결과 없음/일부 실패';
  if (outcome === 'skipped') return '미실행';
  if (outcome === 'results') return '정확 품번 구매조건 없음';
  return '해당 품번 결과 없음';
}

function bestSupplierOffer(
  itemId: string,
  supplier: AdminBomLiveSupplierType,
): AdminBomSupplierComparisonOfferType | null {
  return supplierOfferIndex.value.best.get(`${itemId}\u0000${supplier}`) ?? null;
}

function supplierOfferCount(itemId: string, supplier: AdminBomLiveSupplierType): number {
  return supplierOfferIndex.value.counts.get(`${itemId}\u0000${supplier}`) ?? 0;
}

function supplierCellOfferIsBest(
  item: BomQuoteItemType,
  supplier: AdminBomLiveSupplierType,
): boolean {
  const displayed = supplierCellOffer(item, supplier);
  const best = bestSupplierOffer(item.id, supplier);
  return displayed !== null && best !== null
    && displayed.candidateKey === best.candidateKey
    && displayed.offer.offerKey === best.offer.offerKey;
}

// 협력사 회신 셀 조회: quoteItemId → rfqId → 회신
const cellOf = (item: BomQuoteItemType, rfq: AdminBomRfqViewType) => {
  const reply = rfq.items.find((r) => r.quoteItemId === item.id);
  const price = reply?.unitPrice ?? null;
  return reply === undefined || price === null ? null : reply;
};

// 부분 행 선택(§6.13) — 요청하지 않은 칸은 "미요청"으로 구분(회신율 오독 방지).
const isRequested = (item: BomQuoteItemType, rfq: AdminBomRfqViewType): boolean =>
  rfq.requestedItemIds === null || rfq.requestedItemIds.includes(item.id);

// 협력사 회신 행합계 — 3사 칸(applied.lineTotalKrw)처럼 MOQ·회신수량을 반영한 실효 수량으로 센다.
// 단가 × 필요수량으로만 세면 MOQ 4000 회신이 100개 값으로 최저가에 뽑힌다(§6.38).
const lineTotalOf = (
  item: BomQuoteItemType,
  reply: Pick<AdminBomRfqItemViewType, 'unitPriceKrw' | 'replyQty' | 'moq'>,
): number | null => rfqReplyLineTotalKrw(item.orderQty, reply);

// 외화 회신은 견적 고정 환율로 환산한 원화로 비교한다. 환율이 아직 없으면 null — 고를 수 없다.
const partnerLineTotalOf = (item: BomQuoteItemType, rfq: AdminBomRfqViewType): number | null => {
  const reply = cellOf(item, rfq);
  return reply === null ? null : lineTotalOf(item, reply);
};

/** 협력사가 실제로 받는 금액(결제통화) — 외화 회신 칸에 곁들인다. */
const partnerLineOriginalOf = (item: BomQuoteItemType, rfq: AdminBomRfqViewType): number | null => {
  const reply = cellOf(item, rfq);
  return reply === null ? null : rfqReplyLineTotalOriginal(item.orderQty, reply);
};

interface PartnerChoice { kind: 'partner'; rfqItemId: number; total: number }
interface SupplierChoice {
  kind: 'supplier';
  candidateKey: string;
  offerKey: string;
  total: number;
  fetchedAt: string;
}
type Choice = 'keep' | PartnerChoice | SupplierChoice;
const choices = ref<Map<string, Choice>>(new Map());
const manuallyChangedItemIds = ref<Set<string>>(new Set());

function liveSupplierCode(value: string): AdminBomLiveSupplierType | null {
  const normalized = value.toLocaleLowerCase();
  return ADMIN_BOM_LIVE_SUPPLIERS.find((supplier) => supplier === normalized) ?? null;
}

function currentSupplierOffer(
  item: BomQuoteItemType,
): AdminBomSupplierComparisonOfferType | null {
  const current = item.selectedOffer;
  if (
    current?.offerKey === undefined
    || current.offerKey === null
    || current.offerKey.startsWith('rfq:')
    || liveSupplierCode(current.supplier) === null
  ) return null;
  const eligible = supplierRowsByItem.value.get(item.id)?.offers.filter((entry) =>
    entry.candidateManualSelectable
    && entry.offer.purchasable
    && entry.offer.applied !== null
    && entry.offer.applied.lineTotalKrw !== null) ?? [];
  const exact = eligible.find((entry) => entry.offer.offerKey === current.offerKey);
  if (exact !== undefined) return exact;
  return eligible.find((entry) =>
    entry.offer.supplier.toLocaleLowerCase() === current.supplier.toLocaleLowerCase()
    && entry.offer.supplierSku === current.supplierSku
    && entry.offer.packaging === current.packaging) ?? null;
}

function supplierCellOffer(
  item: BomQuoteItemType,
  supplier: AdminBomLiveSupplierType,
): AdminBomSupplierComparisonOfferType | null {
  const current = currentSupplierOffer(item);
  return current !== null && current.offer.supplier.toLocaleLowerCase() === supplier
    ? current
    : bestSupplierOffer(item.id, supplier);
}

const isCurrentRfqSelection = (item: BomQuoteItemType, rfqItemId: number): boolean =>
  item.selectedOffer?.offerKey === `rfq:${String(rfqItemId)}`;

const isPartnerChoice = (choice: Choice | undefined, rfqItemId: number): boolean =>
  choice !== undefined && choice !== 'keep' && choice.kind === 'partner'
  && choice.rfqItemId === rfqItemId;

const isSupplierChoice = (
  choice: Choice | undefined,
  entry: AdminBomSupplierComparisonOfferType,
): boolean => choice !== undefined && choice !== 'keep' && choice.kind === 'supplier'
  && choice.candidateKey === entry.candidateKey && choice.offerKey === entry.offer.offerKey;

const isSupplierChoiceFor = (
  choice: Choice | undefined,
  item: BomQuoteItemType,
  supplier: AdminBomLiveSupplierType,
): boolean => {
  const entry = supplierCellOffer(item, supplier);
  return entry !== null && isSupplierChoice(choice, entry);
};

function persistedChoice(item: BomQuoteItemType): Choice {
  for (const rfq of quotedRfqs.value) {
    const reply = cellOf(item, rfq);
    if (
      reply?.unitPrice !== null
      && reply?.unitPrice !== undefined
      && isCurrentRfqSelection(item, reply.rfqItemId)
    ) {
      return {
        kind: 'partner',
        rfqItemId: reply.rfqItemId,
        total: lineTotalOf(item, reply) ?? 0,
      };
    }
  }
  const supplier = currentSupplierOffer(item);
  const total = supplier?.offer.applied?.lineTotalKrw ?? null;
  if (supplier !== null && total !== null) {
    return {
      kind: 'supplier',
      candidateKey: supplier.candidateKey,
      offerKey: supplier.offer.offerKey,
      total,
      fetchedAt: supplier.offer.fetchedAt,
    };
  }
  return 'keep';
}

function restorePersistedChoices(): void {
  if (!props.open) return;
  const next = new Map(choices.value);
  for (const item of props.scopeItems) {
    if (manuallyChangedItemIds.value.has(item.id)) continue;
    next.set(item.id, persistedChoice(item));
  }
  choices.value = next;
}

function selectionRestoreWarning(item: BomQuoteItemType): string | null {
  const current = item.selectedOffer;
  if (current?.offerKey?.startsWith('rfq:') === true) {
    const found = quotedRfqs.value.some((rfq) => {
      const reply = cellOf(item, rfq);
      return reply !== null && isCurrentRfqSelection(item, reply.rfqItemId);
    });
    return found ? null : '이전 선정 협력사 회신을 현재 비교표에서 찾지 못했습니다.';
  }
  if (current === null || liveSupplierCode(current.supplier) === null) return null;
  if (refreshData.value === null || refreshRunning.value) return null;
  return currentSupplierOffer(item) === null
    ? '이전 선정 공급사 구매조건을 최신 결과에서 찾지 못했습니다.'
    : null;
}

watch(
  [refreshData, () => props.scopeItems, () => props.rfqs],
  restorePersistedChoices,
);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    const next = new Map<string, Choice>();
    for (const item of props.scopeItems) next.set(item.id, 'keep');
    choices.value = next;
    manuallyChangedItemIds.value = new Set();
    restorePersistedChoices();
    error.value = '';
    progress.value = '';
    refreshError.value = '';
    refreshSnapshot.value = null;
    refreshPolling.value = false;
    try {
      const response = await startSupplierRefresh.mutateAsync({ quoteId: props.quoteId });
      refreshSnapshot.value = response.data;
      refreshPolling.value = response.data.runId !== null;
    } catch (reason) {
      refreshError.value = reason instanceof ApiRequestError
        ? reason.message
        : '공급사 최신 시세 조회를 시작하지 못했습니다.';
    }
  },
);

function setChoice(itemId: string, choice: Choice): void {
  const next = new Map(choices.value);
  next.set(itemId, choice);
  choices.value = next;
  manuallyChangedItemIds.value = new Set(manuallyChangedItemIds.value).add(itemId);
}

function chooseSupplier(item: BomQuoteItemType, supplier: AdminBomLiveSupplierType): void {
  const entry = supplierCellOffer(item, supplier);
  const total = entry?.offer.applied?.lineTotalKrw ?? null;
  if (entry === null || total === null) return;
  setChoice(item.id, {
    kind: 'supplier',
    candidateKey: entry.candidateKey,
    offerKey: entry.offer.offerKey,
    total,
    fetchedAt: entry.offer.fetchedAt,
  });
}

function choosePartner(item: BomQuoteItemType, rfq: AdminBomRfqViewType): void {
  const reply = cellOf(item, rfq);
  const total = reply === null ? null : lineTotalOf(item, reply);
  if (reply === null || total === null) return;
  setChoice(item.id, { kind: 'partner', rfqItemId: reply.rfqItemId, total });
}

// 현재 선정·3사 실효 행합계·협력사 회신 합계 중 최저. 단가가 아니라
// MOQ·주문배수를 이미 적용한 엔진 applied.lineTotalKrw를 사용한다.
function pickLowestAll(): void {
  const next = new Map(choices.value);
  for (const item of props.scopeItems) {
    let best: { choice: Choice; total: number } | null = item.lineTotalKrw === null
      ? null
      : { choice: 'keep', total: item.lineTotalKrw };
    for (const supplier of ADMIN_BOM_LIVE_SUPPLIERS) {
      const entry = bestSupplierOffer(item.id, supplier);
      const total = entry?.offer.applied?.lineTotalKrw ?? null;
      if (entry === null || total === null) continue;
      if (best === null || total < best.total) {
        best = {
          total,
          choice: {
            kind: 'supplier',
            candidateKey: entry.candidateKey,
            offerKey: entry.offer.offerKey,
            total,
            fetchedAt: entry.offer.fetchedAt,
          },
        };
      }
    }
    for (const rfq of quotedRfqs.value) {
      const reply = cellOf(item, rfq);
      const price = reply?.unitPrice ?? null;
      if (reply === null || price === null) continue;
      const total = lineTotalOf(item, reply);
      if (total === null) continue; // 환율 없는 외화 회신 — 값을 모르니 최저가 후보가 아니다
      if (best === null || total < best.total) {
        best = { choice: { kind: 'partner', rfqItemId: reply.rfqItemId, total }, total };
      }
    }
    if (best !== null) next.set(item.id, best.choice);
  }
  choices.value = next;
  manuallyChangedItemIds.value = new Set([
    ...manuallyChangedItemIds.value,
    ...next.keys(),
  ]);
}

const previewTotal = computed(() => {
  let sum = 0;
  for (const item of props.scopeItems) {
    const choice = choices.value.get(item.id) ?? 'keep';
    if (choice === 'keep') {
      sum += item.lineTotalKrw === null ? 0 : Math.round(item.lineTotalKrw);
      continue;
    }
    sum += Math.round(choice.total);
  }
  return sum;
});

const currentTotal = computed(() =>
  props.scopeItems.reduce(
    (sum, item) => sum + (item.lineTotalKrw === null ? 0 : Math.round(item.lineTotalKrw)),
    0,
  ),
);

const select = useSelectRfqReply();
const error = ref('');
const progress = ref('');

async function apply(): Promise<void> {
  error.value = '';
  const changes: AdminBomRfqSelectionBodyType[] = [];
  for (const item of props.scopeItems) {
    const choice = choices.value.get(item.id) ?? 'keep';
    if (choice === 'keep') continue;
    if (choice.kind === 'partner') {
      if (isCurrentRfqSelection(item, choice.rfqItemId)) continue;
      changes.push({ kind: 'partner', itemId: item.id, rfqItemId: choice.rfqItemId });
      continue;
    }
    if (
      item.selectedOffer?.offerKey === choice.offerKey
      && item.selectedOffer.fetchedAt === choice.fetchedAt
    ) continue;
    changes.push({
      kind: 'supplier',
      itemId: item.id,
      candidateKey: choice.candidateKey,
      offerKey: choice.offerKey,
    });
  }
  if (changes.length === 0) {
    error.value = '변경할 선정이 없습니다.';
    return;
  }
  try {
    for (const [idx, change] of changes.entries()) {
      progress.value = `적용 중 ${String(idx + 1)}/${String(changes.length)}…`;
      await select.mutateAsync({
        quoteId: props.quoteId,
        body: change,
      });
    }
    progress.value = '';
    emit('close');
  } catch (e) {
    progress.value = '';
    error.value = e instanceof ApiRequestError ? e.message : '선정 적용에 실패했습니다.';
  }
}

const fmt = (v: number): string => v.toLocaleString('ko-KR');
const fmtFetchedAt = (value: string): string => new Date(value).toLocaleString('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

// 시세 조회 상태 한 줄 — 실패면 오류, 조회 중이면 진행, 끝났으면 완료 톤.
const refreshTone = computed<'destructive' | 'info' | 'success'>(() =>
  refreshData.value?.status === 'failed' || refreshError.value !== ''
    ? 'destructive'
    : refreshRunning.value
      ? 'info'
      : 'success',
);
const refreshMessage = computed(() =>
  refreshError.value !== '' ? refreshError.value : (refreshData.value?.message ?? '공급사 최신 시세 조회를 준비하고 있습니다.'),
);
const mpnLabel = (item: BomQuoteItemType): string => (item.mpn === '' ? '품번 미기재' : item.mpn);

const onOpenChange = (open: boolean): void => {
  if (!open && !select.isPending.value) emit('close');
};
</script>

<template>
  <Dialog :open="props.open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-7xl">
      <DialogHeader>
        <DialogTitle>공급사 비교·선정</DialogTitle>
        <DialogDescription>
          회신 협력사 {{ quotedRfqs.length }}곳 · 선정 부품 {{ refreshData?.selectedItemCount ?? 0 }}행 · 전체
          {{ props.scopeItems.length }}행
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-wrap items-start gap-3">
        <Alert :variant="refreshTone" size="sm" class="min-w-0 flex-1">
          <AlertDescription>
            <span class="flex flex-wrap items-center gap-2">
              <Spinner v-if="refreshRunning" />
              <b>{{ refreshMessage }}</b>
              <span v-if="refreshRunning" class="tabular-nums">{{ refreshData?.progress ?? 0 }}%</span>
              <Badge v-for="supplier in ADMIN_BOM_LIVE_SUPPLIERS" :key="supplier" variant="outline">
                {{ SUPPLIER_LABELS[supplier] }} {{ supplierStatusLabel(supplier) }}
                <template v-if="(supplierSummary(supplier)?.apiCalls ?? 0) > 0">
                  · API {{ supplierSummary(supplier)?.apiCalls }}회
                </template>
              </Badge>
            </span>
            <progress
              v-if="refreshRunning"
              class="mt-2 block h-1.5 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
              :value="refreshData?.progress ?? 3"
              max="100"
              aria-label="공급사 최신 시세 조회 진행률"
            />
          </AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" :disabled="refreshRunning" @click="pickLowestAll">
          <ArrowDownWideNarrowIcon />
          품목별 최저가 일괄 선정
        </Button>
      </div>

      <!-- 협력사 외화 환율 — 이 견적에 한 번 굳혀 비교와 고객가에 같이 쓴다 -->
      <Alert v-if="fxEditor.currencies.value.length > 0" variant="warning" size="sm">
        <AlertDescription>
          <span class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <b>협력사 외화 환율(이 견적에 고정)</b>
            <span
              v-for="currency in fxEditor.currencies.value"
              :key="currency"
              class="flex flex-wrap items-center gap-1.5"
            >
              <span class="font-semibold">1 {{ currency }} =</span>
              <span v-if="partnerFxOf(fxEditor.partnerFx.value, currency) !== null" class="tabular-nums">
                {{ partnerFxText(partnerFxOf(fxEditor.partnerFx.value, currency)!) }}
              </span>
              <b v-else class="text-destructive">환율을 가져오지 못했습니다 — 입력해 주세요</b>
              <Input
                v-model="fxEditor.drafts.value[currency]"
                type="number"
                min="0"
                step="0.01"
                inputmode="decimal"
                class="h-7 w-28 text-right tabular-nums"
                :aria-label="`${currency} 환율 직접 입력`"
                placeholder="직접 입력"
              />
              <Button
                variant="outline"
                size="sm"
                :disabled="fxEditor.pending.value || fxEditor.drafts.value[currency] === ''"
                @click="void fxEditor.apply(currency)"
              >
                환율 적용
              </Button>
            </span>
          </span>
          <span class="mt-1 block text-xs">
            고객가는 이 환율로 계산합니다. 발주 장부에는 발주서를 발행하는 날의 실제 환율을 적습니다.
          </span>
          <b v-if="fxEditor.error.value !== ''" class="text-destructive mt-1 block text-xs">
            {{ fxEditor.error.value }}
          </b>
        </AlertDescription>
      </Alert>

      <DialogScrollBody>
        <!-- 머리줄을 고정하려고 표 자체의 스크롤 상자를 풀고 이 본문이 두 축을 함께 스크롤한다. -->
        <div class="[&_[data-slot=table-container]]:overflow-visible">
          <Table>
            <TableHeader class="sticky top-0 z-10">
              <TableRow>
                <TableHead class="bg-muted">부품</TableHead>
                <TableHead class="bg-muted text-right">수량</TableHead>
                <TableHead class="bg-muted">현재 선정 구매 조건</TableHead>
                <TableHead v-for="supplier in ADMIN_BOM_LIVE_SUPPLIERS" :key="supplier" class="bg-muted">
                  <span class="text-success block font-semibold">{{ SUPPLIER_LABELS[supplier] }}</span>
                  <span class="text-muted-foreground block text-xs font-normal">
                    API 최신 시세 · {{ supplierStatusLabel(supplier) }}
                  </span>
                </TableHead>
                <TableHead v-for="rfq in quotedRfqs" :key="rfq.rfqId" class="bg-muted">
                  <span class="inline-flex items-center gap-1">
                    {{ rfq.partnerName }}
                    <Badge
                      v-if="isForeignCurrency(rfq.currency)"
                      variant="warning"
                      title="이 협력사는 외화로 회신합니다 — 비교는 견적 고정 환율로 환산한 원화입니다"
                    >
                      {{ rfq.currency }}
                    </Badge>
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="item in props.scopeItems" :key="item.id">
                <TableCell>
                  <span class="block max-w-52 truncate font-medium">{{ mpnLabel(item) }}</span>
                  <span class="text-muted-foreground block max-w-52 truncate text-xs">{{ item.manufacturerName ?? '' }}</span>
                </TableCell>
                <TableCell class="text-right tabular-nums">{{ fmt(item.orderQty) }}</TableCell>
                <!-- 현재 선정(keep) -->
                <TableCell class="align-top">
                  <RfqChoiceCheckbox
                    :checked="(choices.get(item.id) ?? 'keep') === 'keep'"
                    :label="`${mpnLabel(item)} 현재 선정 유지`"
                    @select="setChoice(item.id, 'keep')"
                  >
                    <span class="text-xs">
                      <template v-if="item.selectedOffer !== null">
                        <b>{{ item.selectedOffer.supplier }}</b>
                        <span class="ml-1 tabular-nums">{{ item.selectedOffer.unitPrice }} {{ item.selectedOffer.currency }}</span>
                        <span class="text-muted-foreground block tabular-nums">
                          = {{ item.lineTotalKrw === null ? '—' : `${fmt(Math.round(item.lineTotalKrw))}원` }}
                        </span>
                      </template>
                      <template v-else-if="item.selectionSource === 'partner'">
                        <b class="text-info">협력사 보유</b>
                        <span class="text-muted-foreground block">견적요청 후 가격 확정</span>
                      </template>
                      <span v-else class="text-muted-foreground">미선정</span>
                      <span
                        v-if="selectionRestoreWarning(item) !== null"
                        class="text-warning mt-1 block max-w-48 font-medium whitespace-normal"
                        :title="selectionRestoreWarning(item) ?? ''"
                      >
                        이전 선정 조건 최신 결과 미확인
                      </span>
                    </span>
                  </RfqChoiceCheckbox>
                </TableCell>
                <!-- API 공급사 — 선정 부품 MPN 강제 최신조회 칸 -->
                <TableCell v-for="supplier in ADMIN_BOM_LIVE_SUPPLIERS" :key="supplier" class="align-top">
                  <RfqChoiceCheckbox
                    v-if="supplierCellOffer(item, supplier) !== null"
                    :checked="isSupplierChoiceFor(choices.get(item.id), item, supplier)"
                    :disabled="refreshRunning"
                    :label="`${mpnLabel(item)} ${SUPPLIER_LABELS[supplier]} 구매조건 선정`"
                    @select="chooseSupplier(item, supplier)"
                  >
                    <span class="min-w-0 text-xs">
                      <span class="text-success block font-semibold tabular-nums">
                        {{ fmt(Math.round(supplierCellOffer(item, supplier)?.offer.applied?.lineTotalKrw ?? 0)) }}원
                      </span>
                      <span class="text-muted-foreground block tabular-nums">
                        {{ supplierCellOffer(item, supplier)?.offer.applied?.unitPrice }}
                        {{ supplierCellOffer(item, supplier)?.offer.applied?.currency }}
                        · {{ supplierCellOffer(item, supplier)?.offer.packaging ?? '포장 미상' }}
                      </span>
                      <span class="text-muted-foreground block">
                        재고
                        {{ supplierCellOffer(item, supplier)?.offer.stock === null ? '미확인' : fmt(supplierCellOffer(item, supplier)?.offer.stock ?? 0) }}
                        <template v-if="supplierCellOffer(item, supplier)?.offer.moq !== null">
                          · MOQ {{ fmt(supplierCellOffer(item, supplier)?.offer.moq ?? 0) }}
                        </template>
                      </span>
                      <span class="text-muted-foreground block">
                        {{ fmtFetchedAt(supplierCellOffer(item, supplier)?.offer.fetchedAt ?? '') }}
                        <template v-if="supplierOfferCount(item.id, supplier) > 1">
                          · 구매조건 {{ supplierOfferCount(item.id, supplier) }}개
                          {{ supplierCellOfferIsBest(item, supplier) ? '중 최저' : '· 기존 선정 조건' }}
                        </template>
                      </span>
                      <Badge
                        v-if="item.selectedOffer?.offerKey === supplierCellOffer(item, supplier)?.offer.offerKey"
                        variant="success"
                        class="mt-0.5"
                      >
                        현재 선정
                      </Badge>
                    </span>
                  </RfqChoiceCheckbox>
                  <span v-else class="text-muted-foreground text-xs">{{ emptySupplierCellLabel(supplier) }}</span>
                </TableCell>
                <!-- 협력사 회신 칸 -->
                <TableCell v-for="rfq in quotedRfqs" :key="rfq.rfqId" class="align-top">
                  <RfqChoiceCheckbox
                    v-if="cellOf(item, rfq) !== null"
                    :checked="isPartnerChoice(choices.get(item.id), cellOf(item, rfq)?.rfqItemId ?? -1)"
                    :disabled="partnerLineTotalOf(item, rfq) === null"
                    :label="`${mpnLabel(item)} ${rfq.partnerName} 회신 선정`"
                    @select="choosePartner(item, rfq)"
                  >
                    <span class="text-xs">
                      <span class="font-semibold tabular-nums">
                        {{ partnerUnitPriceText(cellOf(item, rfq)?.unitPrice ?? 0, rfq.currency) }}
                      </span>
                      <span v-if="isForeignCurrency(rfq.currency)" class="text-muted-foreground block tabular-nums">
                        <template v-if="cellOf(item, rfq)?.unitPriceKrw !== null">
                          ≈ {{ fmt(cellOf(item, rfq)?.unitPriceKrw ?? 0) }}원
                        </template>
                        <b v-else class="text-destructive">환율 필요</b>
                      </span>
                      <span class="text-muted-foreground block tabular-nums">
                        = {{ partnerAmountText(partnerLineTotalOf(item, rfq), 'KRW') }}
                        <template v-if="isForeignCurrency(rfq.currency)">
                          ({{ partnerAmountText(partnerLineOriginalOf(item, rfq), rfq.currency) }})
                        </template>
                        <template v-if="cellOf(item, rfq)?.moq !== null"> · MOQ {{ fmt(cellOf(item, rfq)?.moq ?? 0) }}</template>
                      </span>
                      <!-- 마스터딜러가 하위 회신을 골라 만든 값이면 그 근거(하위·원가·환율·마진) -->
                      <span
                        v-if="cellOf(item, rfq)?.childSelection != null"
                        class="text-info block text-xs"
                        :title="cellOf(item, rfq)?.childSelection?.stale === true ? '선정 뒤 하위 회신이 바뀌었습니다 — 마스터딜러가 다시 저장해야 반영됩니다' : '마스터딜러가 하위 협력사 회신에 마진을 더한 값입니다'"
                      >
                        {{ childSelectionText(cellOf(item, rfq)!.childSelection!) }}
                        <b v-if="cellOf(item, rfq)?.childSelection?.stale === true"> · 하위 회신 변경됨</b>
                      </span>
                      <Badge v-if="isCurrentRfqSelection(item, cellOf(item, rfq)?.rfqItemId ?? -1)" variant="success" class="mt-0.5">
                        선정됨
                      </Badge>
                    </span>
                  </RfqChoiceCheckbox>
                  <Badge v-else-if="!isRequested(item, rfq)" variant="outline" title="이 협력사에게 요청하지 않은 부품행입니다">
                    미요청
                  </Badge>
                  <span v-else class="text-muted-foreground">—</span>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </DialogScrollBody>

      <p class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span>
          현재 부품 합계 <b class="text-foreground tabular-nums">{{ fmt(currentTotal) }}원</b>
          → 적용 시 <b class="text-primary tabular-nums">{{ fmt(previewTotal) }}원</b>
        </span>
        <span class="text-xs">(합계 정본은 적용 후 서버 재계산)</span>
        <span v-if="progress !== ''" class="inline-flex items-center gap-1.5 text-xs">
          <Spinner />
          {{ progress }}
        </span>
      </p>
      <Alert v-if="error !== ''" variant="destructive" size="sm">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <DialogFooter>
        <Button variant="outline" :disabled="select.isPending.value" @click="emit('close')">닫기</Button>
        <Button :disabled="select.isPending.value || refreshRunning" @click="void apply()">선정 적용</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
