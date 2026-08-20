<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQueryClient } from '@tanstack/vue-query';
import {
  ADMIN_BOM_LIVE_SUPPLIERS,
  type AdminBomLiveSupplierType,
  type AdminBomRfqSelectionBodyType,
  type AdminBomRfqViewType,
  type AdminBomSupplierComparisonOfferType,
  type AdminBomSupplierRefreshViewType,
  type BomQuoteItemType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  useAdminSupplierOfferRefresh,
  useSelectRfqReply,
  useStartAdminSupplierOfferRefresh,
} from '../../../admin/useAdminBomRfqs';
import BomRfqChoiceCheckbox from './BomRfqChoiceCheckbox.vue';

// 품목 × 조달처 매트릭스 비교·선정. 행=부품행, 열=[현재 선정]+
// [선정 부품 MPN의 DigiKey·Mouser·UniKeyIC 강제 최신조회]+[사람 협력사 회신].
// 적용은 행별 선정 API 순차 호출 — 서버가 스냅샷 박제+재계산(감사 이벤트 포함)한다.

const props = defineProps<{
  open: boolean;
  quoteId: string;
  rfqs: AdminBomRfqViewType[]; // quoted 만 열로 쓴다
  scopeItems: BomQuoteItemType[];
}>();
const emit = defineEmits<{ close: [] }>();

const quotedRfqs = computed(() => props.rfqs.filter((r) => r.status === 'quoted'));
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

const lineTotalOf = (item: BomQuoteItemType, unitPrice: number): number =>
  Math.round(unitPrice * Math.max(1, item.orderQty));

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
        total: lineTotalOf(item, reply.unitPrice),
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
  if (reply?.unitPrice === null || reply?.unitPrice === undefined) return;
  setChoice(item.id, {
    kind: 'partner',
    rfqItemId: reply.rfqItemId,
    total: lineTotalOf(item, reply.unitPrice),
  });
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
      const total = lineTotalOf(item, price);
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
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="emit('close')">
    <div class="flex max-h-[92vh] w-full max-w-[96vw] flex-col rounded-2xl bg-surface p-6 shadow-2xl">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-lg font-bold">협력사 회신·공급사 시세 비교·선정</h2>
        <span class="text-xs text-gray-500">회신 협력사 {{ quotedRfqs.length }}곳 · 선정 부품 {{ refreshData?.selectedItemCount ?? 0 }}행 · 전체 {{ scopeItems.length }}행</span>
        <button
          type="button"
          class="ml-auto rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-40"
          :disabled="refreshRunning"
          @click="pickLowestAll"
        >
          품목별 최저가 일괄 선정
        </button>
        <button type="button" class="text-gray-400 hover:text-gray-700" @click="emit('close')">✕</button>
      </div>

      <div
        class="mt-3 rounded-lg border px-3 py-2 text-xs"
        :class="refreshData?.status === 'failed' || refreshError !== ''
          ? 'border-red-200 bg-red-50 text-red-700'
          : refreshRunning
            ? 'border-blue-200 bg-blue-50 text-blue-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800'"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span v-if="refreshRunning" class="size-3 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />
          <b>{{ refreshError !== '' ? refreshError : (refreshData?.message ?? '공급사 최신 시세 조회를 준비하고 있습니다.') }}</b>
          <span v-if="refreshRunning" class="tabular-nums">{{ refreshData?.progress ?? 0 }}%</span>
          <span
            v-for="supplier in ADMIN_BOM_LIVE_SUPPLIERS"
            :key="supplier"
            class="rounded bg-white/80 px-1.5 py-0.5 font-semibold"
          >
            {{ SUPPLIER_LABELS[supplier] }} {{ supplierStatusLabel(supplier) }}
            <template v-if="(supplierSummary(supplier)?.apiCalls ?? 0) > 0">
              · API {{ supplierSummary(supplier)?.apiCalls }}회
            </template>
          </span>
        </div>
        <div v-if="refreshRunning" class="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100">
          <div class="h-full rounded-full bg-blue-600 transition-all" :style="{ width: `${String(refreshData?.progress ?? 3)}%` }" />
        </div>
      </div>

      <div class="mt-4 min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200">
        <table class="w-full min-w-[1500px] divide-y divide-gray-100 text-xs">
          <thead class="sticky top-0 z-10 bg-gray-50 text-left text-gray-500">
            <tr>
              <th class="px-3 py-2">부품</th>
              <th class="px-3 py-2 text-right">수량</th>
              <th class="bg-blue-50/60 px-3 py-2">현재 선정 구매 조건</th>
              <th
                v-for="supplier in ADMIN_BOM_LIVE_SUPPLIERS"
                :key="supplier"
                class="bg-emerald-50/70 px-3 py-2"
              >
                <span class="block font-bold text-emerald-800">{{ SUPPLIER_LABELS[supplier] }}</span>
                <span class="text-[10px] font-normal text-emerald-600">API 최신 시세 · {{ supplierStatusLabel(supplier) }}</span>
              </th>
              <th v-for="rfq in quotedRfqs" :key="rfq.rfqId" class="px-3 py-2">{{ rfq.partnerName }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr v-for="item in scopeItems" :key="item.id">
              <td class="max-w-52 px-3 py-2">
                <div class="truncate font-medium">{{ item.mpn === '' ? '품번 미기재' : item.mpn }}</div>
                <div class="truncate text-gray-400">{{ item.manufacturerName ?? '' }}</div>
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ fmt(item.orderQty) }}</td>
              <!-- 현재 선정(keep) -->
              <td class="bg-blue-50/40 px-3 py-2">
                <BomRfqChoiceCheckbox
                  :checked="(choices.get(item.id) ?? 'keep') === 'keep'"
                  :label="`${item.mpn === '' ? '품번 미기재' : item.mpn} 현재 선정 유지`"
                  @select="setChoice(item.id, 'keep')"
                >
                  <span>
                    <template v-if="item.selectedOffer !== null">
                      <b>{{ item.selectedOffer.supplier }}</b>
                      <span class="ml-1 tabular-nums">
                        {{ item.selectedOffer.unitPrice }} {{ item.selectedOffer.currency }}
                      </span>
                      <span class="block text-gray-400 tabular-nums">
                        = {{ item.lineTotalKrw === null ? '—' : `${fmt(Math.round(item.lineTotalKrw))}원` }}
                      </span>
                    </template>
                    <span v-else class="text-gray-400">미선정</span>
                    <span
                      v-if="selectionRestoreWarning(item) !== null"
                      class="mt-1 block max-w-48 text-[10px] font-semibold leading-4 text-amber-700"
                      :title="selectionRestoreWarning(item) ?? ''"
                    >
                      이전 선정 조건 최신 결과 미확인
                    </span>
                  </span>
                </BomRfqChoiceCheckbox>
              </td>
              <!-- API 공급사 선정 부품 MPN 강제 최신조회 셀 -->
              <td
                v-for="supplier in ADMIN_BOM_LIVE_SUPPLIERS"
                :key="supplier"
                class="bg-emerald-50/30 px-3 py-2"
              >
                <template v-if="supplierCellOffer(item, supplier) !== null">
                  <BomRfqChoiceCheckbox
                    :checked="isSupplierChoiceFor(choices.get(item.id), item, supplier)"
                    :disabled="refreshRunning"
                    :label="`${item.mpn === '' ? '품번 미기재' : item.mpn} ${SUPPLIER_LABELS[supplier]} 구매조건 선정`"
                    @select="chooseSupplier(item, supplier)"
                  >
                    <span class="min-w-0">
                      <span class="block tabular-nums font-semibold text-emerald-800">
                        {{ fmt(Math.round(supplierCellOffer(item, supplier)?.offer.applied?.lineTotalKrw ?? 0)) }}원
                      </span>
                      <span class="block tabular-nums text-gray-500">
                        {{ supplierCellOffer(item, supplier)?.offer.applied?.unitPrice }}
                        {{ supplierCellOffer(item, supplier)?.offer.applied?.currency }}
                        · {{ supplierCellOffer(item, supplier)?.offer.packaging ?? '포장 미상' }}
                      </span>
                      <span class="block text-[10px] text-gray-400">
                        재고 {{ supplierCellOffer(item, supplier)?.offer.stock === null ? '미확인' : fmt(supplierCellOffer(item, supplier)?.offer.stock ?? 0) }}
                        <template v-if="supplierCellOffer(item, supplier)?.offer.moq !== null">
                          · MOQ {{ fmt(supplierCellOffer(item, supplier)?.offer.moq ?? 0) }}
                        </template>
                      </span>
                      <span class="block text-[10px] text-gray-400">
                        {{ fmtFetchedAt(supplierCellOffer(item, supplier)?.offer.fetchedAt ?? '') }}
                        <template v-if="supplierOfferCount(item.id, supplier) > 1">
                          · 구매조건 {{ supplierOfferCount(item.id, supplier) }}개
                          {{ supplierCellOfferIsBest(item, supplier) ? '중 최저' : '· 기존 선정 조건' }}
                        </template>
                      </span>
                      <span
                        v-if="item.selectedOffer?.offerKey === supplierCellOffer(item, supplier)?.offer.offerKey"
                        class="mt-0.5 inline-block rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-bold text-emerald-700"
                      >
                        현재 선정
                      </span>
                    </span>
                  </BomRfqChoiceCheckbox>
                </template>
                <span v-else class="text-[10px] text-gray-400">
                  {{ emptySupplierCellLabel(supplier) }}
                </span>
              </td>
              <!-- 협력사 회신 셀 -->
              <td v-for="rfq in quotedRfqs" :key="rfq.rfqId" class="px-3 py-2">
                <template v-if="cellOf(item, rfq) !== null">
                  <BomRfqChoiceCheckbox
                    :checked="isPartnerChoice(choices.get(item.id), cellOf(item, rfq)?.rfqItemId ?? -1)"
                    :label="`${item.mpn === '' ? '품번 미기재' : item.mpn} ${rfq.partnerName} 회신 선정`"
                    @select="choosePartner(item, rfq)"
                  >
                    <span>
                      <span class="tabular-nums font-semibold">{{ fmt(cellOf(item, rfq)?.unitPrice ?? 0) }}원</span>
                      <span class="block text-gray-400 tabular-nums">
                        = {{ fmt(lineTotalOf(item, cellOf(item, rfq)?.unitPrice ?? 0)) }}원
                        <template v-if="cellOf(item, rfq)?.moq !== null"> · MOQ {{ fmt(cellOf(item, rfq)?.moq ?? 0) }}</template>
                      </span>
                      <span v-if="isCurrentRfqSelection(item, cellOf(item, rfq)?.rfqItemId ?? -1)" class="mt-0.5 inline-block rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-bold text-emerald-700">
                        선정됨
                      </span>
                    </span>
                  </BomRfqChoiceCheckbox>
                </template>
                <span v-else-if="!isRequested(item, rfq)" class="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-400" title="이 협력사에게 요청하지 않은 부품행입니다">미요청</span>
                <span v-else class="text-gray-300">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span class="text-gray-600">
          현재 부품 합계 <b class="tabular-nums">{{ fmt(currentTotal) }}원</b>
          → 적용 시 <b class="tabular-nums text-blue-700">{{ fmt(previewTotal) }}원</b>
          <span class="text-xs text-gray-400">(합계 정본은 적용 후 서버 재계산)</span>
        </span>
        <span v-if="progress !== ''" class="text-xs text-gray-500">{{ progress }}</span>
        <p v-if="error !== ''" class="text-xs font-semibold text-red-600">{{ error }}</p>
        <div class="ml-auto flex gap-2">
          <button type="button" class="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold hover:bg-gray-50" @click="emit('close')">
            닫기
          </button>
          <button
            type="button"
            class="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="select.isPending.value || refreshRunning"
            @click="apply"
          >
            선정 적용
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
