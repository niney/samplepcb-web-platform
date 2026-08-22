<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  BOM_PO_STATUS_LABELS,
  BOM_PO_SHORTAGE_REASON_LABELS,
  BOM_SHIPMENT_DOMESTIC_PREPARING_LABEL,
  BOM_SHIPMENT_MODE_LABELS,
  BOM_SHIPMENT_STATUS_LABELS,
  bomPoExternalCheckStale,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  bomShipmentStatusLabel,
  type AdminBomPoViewType,
  type BomPoItemViewType,
} from '@sp/api-contract';
import { smartbomFmtDate, smartbomFmtWon } from '../../../admin/smartbom';

// Case 상세의 협력사 발주서 패널(D18) — 발행·확인·마감 현황.
// 발주서는 박제 문서라 수정이 없고, 재발행 = 미확인(issued) 삭제 후 재생성.

const props = defineProps<{
  pos: AdminBomPoViewType[];
  loading: boolean;
  canIssue: boolean; // 결제 확인(isPaid) 후에만 발행 가능(D18-4)
  issueDisabledReason: string;
  busy: boolean;
  checkingPoId: number | null; // 카트 상태 확인 중인 발주서(D41) — 확인 버튼만 잠근다
}>();
const emit = defineEmits<{
  create: [];
  remove: [po: AdminBomPoViewType];
  confirmSupplier: [po: AdminBomPoViewType];
  close: [po: AdminBomPoViewType];
  external: [po: AdminBomPoViewType]; // 외부 실행 재시도/재발급/다시 담기(D20·D41)
  check: [po: AdminBomPoViewType]; // Mouser 카트 상태 확인(D41)
  importFile: [po: AdminBomPoViewType]; // 공급사 장바구니 가져오기 파일(D41)
  shipment: [po: AdminBomPoViewType]; // 선적 관리(D21)
  recover: [po: AdminBomPoViewType, item: BomPoItemViewType]; // 부족분 대체발주(D31)
}>();

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener');
}

// ── Mouser 카트 인계(D41) — API 카트는 웹 '현재 장바구니'가 아니고 시간이 지나면 비워질 수 있다.
//    그래서 CartKey·담은 시각·실시간 상태를 보여 주고, [다시 담기]·가져오기 파일로 길을 둔다.
type MouserCartHealth = 'unknown' | 'ok' | 'empty' | 'mismatch' | 'error';
function mouserCartHealth(po: AdminBomPoViewType): MouserCartHealth {
  const ref = po.externalRef;
  if (ref?.checkedAt === undefined) return 'unknown';
  if (ref.checkError !== undefined) return 'error';
  if ((ref.liveLineCount ?? 0) === 0) return 'empty';
  if (ref.liveMatches === false) return 'mismatch';
  return 'ok';
}
const mouserCartToneCls = (po: AdminBomPoViewType): string => {
  const health = mouserCartHealth(po);
  if (health === 'ok') {
    return bomPoExternalCheckStale(po.externalRef?.checkedAt)
      ? 'border-gray-200 bg-gray-50 text-gray-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (health === 'unknown') return 'border-gray-200 bg-gray-50 text-gray-700';
  return 'border-amber-300 bg-amber-50 text-amber-800';
};
// 한눈 줄용 짧은 상태 라벨 — 상세(확인 시각·불일치 목록·실패 사유)는 [자세히] 안에서.
function mouserCartHealthLabel(po: AdminBomPoViewType): string {
  const ref = po.externalRef;
  switch (mouserCartHealth(po)) {
    case 'unknown':
      return '상태 미확인';
    case 'error':
      return '⚠ 확인 실패';
    case 'empty':
      return '⚠ 카트 비어 있음';
    case 'mismatch':
      return `⚠ 내용 다름(${String(ref?.liveLineCount ?? 0)}행)`;
    default:
      return `✓ 일치${bomPoExternalCheckStale(ref?.checkedAt) ? '(오래됨)' : ''}`;
  }
}
// 외부 박스 [자세히] 토글 — 기본은 접힘(한눈 줄 + 버튼 줄만).
const externalDetailOpen = ref(new Set<number>());
function toggleExternalDetail(poId: number): void {
  if (externalDetailOpen.value.has(poId)) externalDetailOpen.value.delete(poId);
  else externalDetailOpen.value.add(poId);
}
const shortCartKey = (key: string): string => `${key.slice(0, 8)}…`;
const copiedKey = ref<string | null>(null);
async function copyCartKey(key: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(key);
    copiedKey.value = key;
    window.setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null;
    }, 1500);
  } catch {
    /* 클립보드 거부 — 키는 title 로도 노출돼 있다 */
  }
}
const fmtMoney = (amount: number | null | undefined, currency: string | null | undefined): string =>
  amount === null || amount === undefined
    ? ''
    : `${amount.toLocaleString('ko-KR')} ${currency ?? ''}`.trim();

// 선적 요약 라벨 — 국내 preparing 은 '배송 준비'
function shipmentLabel(po: AdminBomPoViewType): string {
  const shipment = po.shipment;
  if (shipment === null) return '—';
  const statusText =
    shipment.mode === 'domestic' && shipment.status === 'preparing'
      ? BOM_SHIPMENT_DOMESTIC_PREPARING_LABEL
      : BOM_SHIPMENT_STATUS_LABELS[shipment.status];
  return `${BOM_SHIPMENT_MODE_LABELS[shipment.mode]} · ${statusText}`;
}

// 핑퐁 차례(D22 인지) — 다음 단계 주체가 관리자면 행·버튼 강조, 협력사면 대기 힌트.
function shipmentNextActor(po: AdminBomPoViewType): 'ADMIN' | 'PARTNER' | null {
  const shipment = po.shipment;
  if (shipment === null) return null;
  if (shipment.receivedAt !== null) return null;
  const next = bomShipmentNextStatus(shipment.mode, shipment.status);
  return next === null ? null : bomShipmentActorOf(shipment.mode, next);
}
function shipmentNextLabel(po: AdminBomPoViewType): string {
  const shipment = po.shipment;
  if (shipment === null) return '';
  const next = bomShipmentNextStatus(shipment.mode, shipment.status);
  return next === null ? '' : bomShipmentStatusLabel(shipment.mode, next);
}
function shipmentCaseRefPending(po: AdminBomPoViewType): boolean {
  const shipment = po.shipment;
  return (
    shipment !== null &&
    shipment.receivedAt === null &&
    shipment.caseRefRequestedAt !== null &&
    (shipment.caseRef === null || shipment.caseRef === '')
  );
}
function shipmentAdminPending(po: AdminBomPoViewType): boolean {
  return shipmentCaseRefPending(po) || shipmentNextActor(po) === 'ADMIN';
}
const adminPendingCount = computed(
  () => props.pos.filter(shipmentAdminPending).length,
);
const openShortageCount = computed(() =>
  props.pos.reduce(
    (count, po) =>
      count + po.items.filter((item) => item.shortage !== null && item.shortage.recovery === null).length,
    0,
  ),
);
const procurementItems = (po: AdminBomPoViewType): BomPoItemViewType[] =>
  po.items.filter((item) => item.shortage !== null || item.recoverySource !== null);

const statusCls = (status: AdminBomPoViewType['status']): string =>
  status === 'confirmed'
    ? 'bg-emerald-100 text-emerald-700'
    : status === 'issued'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-gray-200 text-gray-600';

const statusLabel = (po: AdminBomPoViewType): string => {
  if (po.supplierCode === null) return BOM_PO_STATUS_LABELS[po.status];
  if (po.status === 'issued') return '구매 확인 대기';
  if (po.status === 'confirmed') return '구매 완료';
  return BOM_PO_STATUS_LABELS[po.status];
};

const externalFailureResolved = (po: AdminBomPoViewType): boolean =>
  po.externalRef?.state === 'failed' && po.status !== 'issued';

const externalFailureRetryable = (po: AdminBomPoViewType): boolean =>
  po.externalRef?.state === 'failed'
  && po.status === 'issued'
  && (po.externalRef.skippedNoSku ?? 0) < po.itemCount;

const tableScroll = ref<HTMLElement | null>(null);
function moveTable(direction: -1 | 1): void {
  tableScroll.value?.scrollBy({ left: direction * 280, behavior: 'smooth' });
}
</script>

<template>
  <div class="rounded-xl border border-gray-200 bg-surface">
    <div class="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
      <p class="text-sm font-bold text-gray-800">조달 발주 (PO)</p>
      <p v-if="pos.length > 0" class="text-xs text-gray-500">
        발주서 <b>{{ pos.length }}</b> ·
        확인 <b class="text-emerald-600">{{ pos.filter((p) => p.status !== 'issued').length }}</b>
        <template v-if="adminPendingCount > 0">
          · <b class="text-blue-700">선적 처리 필요 {{ adminPendingCount }}</b>
        </template>
        <template v-if="openShortageCount > 0">
          · <b class="text-red-700">대체발주 대기 {{ openShortageCount }}</b>
        </template>
      </p>
      <button
        type="button"
        class="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
        :disabled="!canIssue"
        :title="canIssue ? '' : issueDisabledReason"
        @click="emit('create')"
      >
        발주서 생성
      </button>
    </div>

    <p v-if="loading && pos.length === 0" class="px-4 py-6 text-center text-xs text-gray-400">불러오는 중…</p>
    <p v-else-if="pos.length === 0" class="px-4 py-6 text-center text-xs text-gray-400">
      아직 발행한 발주서가 없습니다{{ canIssue ? '' : ` — ${issueDisabledReason}` }}.
    </p>
    <div v-else ref="tableScroll" class="overflow-x-auto [scrollbar-color:theme(colors.emerald.300)_theme(colors.gray.100)] [scrollbar-width:thin]">
      <div class="sticky left-0 z-[1] flex items-center gap-2 border-b border-emerald-100 bg-emerald-50/95 px-3 py-1.5 text-[10px] font-medium text-emerald-800 min-[1280px]:hidden">
        <span class="min-w-0 flex-1">좌우로 이동해 선적·입고 상태와 작업 버튼을 확인할 수 있습니다.</span>
        <button type="button" class="grid size-6 shrink-0 place-items-center rounded border border-emerald-200 bg-white text-sm hover:bg-emerald-100" aria-label="발주 표 왼쪽으로 이동" @click="moveTable(-1)">←</button>
        <button type="button" class="grid size-6 shrink-0 place-items-center rounded border border-emerald-200 bg-white text-sm hover:bg-emerald-100" aria-label="발주 표 오른쪽으로 이동" @click="moveTable(1)">→</button>
      </div>
      <table class="w-full min-w-[960px] divide-y divide-gray-100 text-xs">
        <thead class="bg-gray-50 text-left text-gray-500">
          <tr>
            <th class="whitespace-nowrap px-3 py-2">구매처</th>
            <th class="whitespace-nowrap px-3 py-2">상태</th>
            <th class="whitespace-nowrap px-3 py-2 text-right">품목</th>
            <th class="whitespace-nowrap px-3 py-2 text-right">발주 문서 / 실제 공급(VAT 별도)</th>
            <th class="whitespace-nowrap px-3 py-2">선적·입고</th>
            <th class="whitespace-nowrap px-3 py-2">발행/확인</th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          <tr v-for="po in pos" :key="po.poId">
            <td class="px-3 py-2 font-medium text-gray-900">
              {{ po.partnerName }}
              <span v-if="po.supplierCode !== null" class="ml-1 rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-500">{{ po.supplierCode }}</span>
              <div
                v-for="item in procurementItems(po)"
                :key="`procurement-${String(item.poItemId)}`"
                class="mt-1.5 rounded border px-2 py-1.5 text-[10px] font-normal leading-4"
                :class="item.shortage !== null ? 'border-red-200 bg-red-50 text-red-800' : 'border-indigo-200 bg-indigo-50 text-indigo-800'"
              >
                <template v-if="item.shortage !== null">
                  <p class="font-bold">
                    {{ item.mpn || '품번 미기재' }} · {{ BOM_PO_SHORTAGE_REASON_LABELS[item.shortage.reason] }}
                    · 부족 {{ item.shortage.shortageQty.toLocaleString('ko-KR') }}개
                  </p>
                  <p>원 PO 공급 {{ item.shortage.suppliedQty.toLocaleString('ko-KR') }}/{{ item.qty.toLocaleString('ko-KR') }}개</p>
                  <p class="font-semibold">실제 공급 금액 {{ smartbomFmtWon(item.shortage.suppliedAmount) }}</p>
                  <p v-if="item.shortage.recovery !== null" class="font-semibold text-emerald-700">
                    → {{ item.shortage.recovery.partnerName }} 대체 PO #{{ item.shortage.recovery.poId }}
                    <template v-if="item.shortage.recovery.receivedAt !== null"> · 입고 완료</template>
                  </p>
                  <button
                    v-else
                    type="button"
                    class="mt-1 rounded bg-red-600 px-2 py-0.5 font-bold text-white hover:bg-red-700 disabled:opacity-40"
                    :disabled="busy"
                    @click="emit('recover', po, item)"
                  >
                    잔량 대체발주
                  </button>
                </template>
                <template v-else-if="item.recoverySource !== null">
                  <b>{{ item.mpn || '품번 미기재' }} · 대체발주 {{ item.qty.toLocaleString('ko-KR') }}개</b>
                  <p>{{ item.recoverySource.sourcePartnerName }} 공급 부족분 회복</p>
                </template>
              </div>
              <!-- 외부 실행 결과(D20) — 카트/리스트까지, 실결제는 공급사 사이트에서 -->
              <div v-if="po.externalRef !== null" class="mt-1 text-[11px] font-normal">
                <template v-if="po.externalRef.state === 'ok' && po.externalRef.cartKey !== undefined">
                  <!-- Mouser 카트(D41) — 한눈 줄(사실·상태) + 버튼 줄, 식별자·상세·안내는 [자세히] -->
                  <div class="mt-1 rounded border px-2 py-1 leading-4" :class="mouserCartToneCls(po)" data-testid="mouser-cart-box">
                    <p class="flex flex-wrap items-center gap-x-1.5">
                      <b>Mouser 카트 담김 · {{ po.externalRef.lineCount ?? 0 }}행</b>
                      <span class="text-gray-500">{{ fmtMoney(po.externalRef.merchandiseTotal, po.externalRef.currencyCode) }} · {{ smartbomFmtDate(po.externalRef.executedAt) }}</span>
                      <span class="font-semibold" data-testid="mouser-cart-health" :title="po.externalRef.checkError ?? (po.externalRef.liveDiff ?? []).join('\n')">{{ mouserCartHealthLabel(po) }}</span>
                      <span v-if="(po.externalRef.errors?.length ?? 0) > 0" class="text-amber-700" :title="po.externalRef.errors?.join('\n')">행 오류 {{ po.externalRef.errors?.length }}</span>
                    </p>
                    <p class="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                      <button v-if="po.status === 'issued'" type="button" class="font-semibold text-blue-700 underline disabled:opacity-40" :disabled="busy || checkingPoId === po.poId" @click="emit('check', po)">
                        {{ checkingPoId === po.poId ? '확인 중…' : '카트 상태 확인' }}
                      </button>
                      <button v-if="po.status === 'issued'" type="button" class="font-semibold text-blue-700 underline disabled:opacity-40" :disabled="busy" title="같은 CartKey 카트를 발주 품목으로 다시 채웁니다(전체 교체)" @click="emit('external', po)">
                        다시 담기
                      </button>
                      <button v-if="po.externalRef.cartWebUrl !== undefined" type="button" class="text-blue-600 underline" @click="openExternal(po.externalRef.cartWebUrl)">
                        Mouser 열기
                      </button>
                      <button type="button" class="text-gray-500 underline" :aria-expanded="externalDetailOpen.has(po.poId)" @click="toggleExternalDetail(po.poId)">
                        {{ externalDetailOpen.has(po.poId) ? '접기' : '자세히' }}
                      </button>
                    </p>
                    <div v-if="externalDetailOpen.has(po.poId)" class="mt-1 border-t border-black/5 pt-1 text-[10px]" data-testid="mouser-cart-detail">
                      <p class="font-mono text-gray-600" :title="po.externalRef.cartKey">
                        CartKey {{ shortCartKey(po.externalRef.cartKey) }}
                        <button type="button" class="ml-1 font-sans underline" @click="copyCartKey(po.externalRef.cartKey)">
                          {{ copiedKey === po.externalRef.cartKey ? '복사됨' : '복사' }}
                        </button>
                        <span v-if="(po.externalRef.refilledCount ?? 0) > 0" class="font-sans"> · 다시 담기 {{ po.externalRef.refilledCount }}회</span>
                      </p>
                      <p v-if="po.externalRef.checkedAt !== undefined" class="mt-0.5">
                        <template v-if="po.externalRef.checkError !== undefined">확인 실패 · {{ po.externalRef.checkError }}</template>
                        <template v-else-if="(po.externalRef.liveLineCount ?? 0) === 0">카트가 비어 있습니다(만료·삭제됨) — [다시 담기] 뒤 바로 주문하세요.</template>
                        <template v-else-if="po.externalRef.liveMatches === false">발주와 다름 · {{ (po.externalRef.liveDiff ?? []).join(', ') }}</template>
                        <template v-else>카트 {{ po.externalRef.liveLineCount }}행 일치 · {{ smartbomFmtDate(po.externalRef.checkedAt) }} 확인</template>
                      </p>
                      <p v-else class="mt-0.5 text-gray-500">아직 확인 전 — API 카트는 시간이 지나면 비워질 수 있습니다.</p>
                      <p v-if="po.status === 'issued'" class="mt-0.5">
                        <button type="button" class="text-blue-600 underline disabled:opacity-40" :disabled="busy" title="API 카트와 무관하게 Mouser 장바구니 '스프레드시트 업로드'에 올리는 .csv" @click="emit('importFile', po)">
                          가져오기 파일(.csv)
                        </button>
                        <span class="text-gray-500"> · SamplePCB 계정 로그인 → '저장한 장바구니'에서 이 CartKey 카트 선택. 비어 있으면 [다시 담기] 또는 .csv 업로드.</span>
                      </p>
                    </div>
                  </div>
                </template>
                <template v-else-if="po.externalRef.state === 'ok' && po.externalRef.singleUseUrl !== undefined">
                  <!-- DigiKey 리스트(D20·D41) — Mouser 카트 박스와 같은 틀: 한눈 줄 + 버튼 줄, 식별자·안내는 [자세히] -->
                  <div class="mt-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 leading-4 text-emerald-800" data-testid="digikey-list-box">
                    <p class="flex flex-wrap items-center gap-x-1.5">
                      <b>DigiKey 리스트 생성됨 · {{ po.externalRef.lineCount ?? 0 }}행</b>
                      <span class="text-gray-500">{{ smartbomFmtDate(po.externalRef.executedAt) }}</span>
                      <span class="font-semibold" data-testid="digikey-list-health" title="열면 담당자 본인 DigiKey 계정 myLists 에 담기며 URL 은 소진됩니다">1회용 URL</span>
                    </p>
                    <p class="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                      <button type="button" class="font-semibold text-blue-700 underline" title="1회용 URL — 열면 소진되며 [재발급]으로 다시 만들 수 있습니다" @click="openExternal(po.externalRef.singleUseUrl)">
                        DigiKey 리스트 열기(1회용)
                      </button>
                      <button v-if="po.status === 'issued'" type="button" class="font-semibold text-blue-700 underline disabled:opacity-40" :disabled="busy" title="새 single-use URL 을 발급합니다(이전 URL 은 그대로 소진)" @click="emit('external', po)">
                        재발급
                      </button>
                      <button type="button" class="text-gray-500 underline" :aria-expanded="externalDetailOpen.has(po.poId)" @click="toggleExternalDetail(po.poId)">
                        {{ externalDetailOpen.has(po.poId) ? '접기' : '자세히' }}
                      </button>
                    </p>
                    <div v-if="externalDetailOpen.has(po.poId)" class="mt-1 border-t border-black/5 pt-1 text-[10px]" data-testid="digikey-list-detail">
                      <p class="font-mono text-gray-600" :title="po.externalRef.listName ?? ''">
                        리스트 {{ po.externalRef.listName ?? '—' }}
                        <span v-if="(po.externalRef.refilledCount ?? 0) > 0" class="font-sans"> · 재발급 {{ po.externalRef.refilledCount }}회</span>
                      </p>
                      <p class="mt-0.5">열면 담당자 본인 DigiKey 계정 myLists 에 담기며 URL 은 소진됩니다. 소진됐으면 [재발급]으로 새 URL 을 만듭니다.</p>
                      <p v-if="po.status === 'issued'" class="mt-0.5">
                        <button type="button" class="text-blue-600 underline disabled:opacity-40" :disabled="busy" title="리스트와 무관하게 DigiKey 장바구니 업로드에 쓰는 .csv" @click="emit('importFile', po)">
                          가져오기 파일(.csv)
                        </button>
                        <span class="text-gray-500"> · 리스트와 무관하게 DigiKey 장바구니 업로드에 쓰는 .csv</span>
                      </p>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div
                    class="mt-1 rounded border px-2 py-1.5 leading-4"
                    :class="externalFailureResolved(po)
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-red-200 bg-red-50 text-red-700'"
                  >
                    <p class="font-bold">
                      {{ externalFailureResolved(po)
                        ? '자동 실행 실패 · 수동 구매 완료'
                        : '자동 실행 실패 · 수동 주문 필요' }}
                    </p>
                    <p class="break-words text-[10px]" :title="po.externalRef.error">
                      {{ po.externalRef.error ?? '공급사 자동 실행을 완료하지 못했습니다.' }}
                    </p>
                    <button
                      v-if="externalFailureRetryable(po)"
                      type="button"
                      class="mt-0.5 font-semibold text-blue-700 underline"
                      :disabled="busy"
                      @click="emit('external', po)"
                    >
                      자동 실행 재시도
                    </button>
                  </div>
                </template>
                <span v-if="(po.externalRef.skippedNoSku ?? 0) > 0" class="ml-1 text-amber-700">SKU 없음 {{ po.externalRef.skippedNoSku }}행 제외</span>
              </div>
            </td>
            <td class="whitespace-nowrap px-3 py-2">
              <span class="whitespace-nowrap rounded px-1.5 py-0.5 font-semibold" :class="statusCls(po.status)">
                {{ statusLabel(po) }}
              </span>
            </td>
            <td class="px-3 py-2 text-right tabular-nums">{{ po.itemCount }}</td>
            <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">
              <p>{{ smartbomFmtWon(po.totalAmount) }}</p>
              <p
                v-if="po.actualSupplyAmount !== po.totalAmount"
                class="mt-0.5 text-[10px] font-bold text-amber-700"
              >
                실제 공급 {{ smartbomFmtWon(po.actualSupplyAmount) }}
              </p>
            </td>
            <!-- 선적(D21·D22) — 모드·상태·송장 + 차례 표시 + 입고 확인 -->
            <td class="whitespace-nowrap px-3 py-2">
              <span :class="po.shipment === null ? 'text-gray-300' : shipmentAdminPending(po) ? 'font-bold text-blue-700' : 'text-gray-700'">{{ shipmentLabel(po) }}</span>
              <span
                v-if="shipmentCaseRefPending(po)"
                class="ml-1 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700"
                title="협력사가 샘플피씨비 운송의 발송 참조번호(Case ID)를 기다리고 있습니다."
              >Case ID 요청</span>
              <span
                v-else-if="shipmentNextActor(po) === 'ADMIN'"
                class="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700"
                :title="`협력사가 단계를 넘겼습니다 — [선적 관리]에서 '${shipmentNextLabel(po)}' 처리를 진행해 주세요`"
              >
                {{ shipmentNextLabel(po) }} 처리 필요
              </span>
              <span
                v-else-if="shipmentNextActor(po) === 'PARTNER'"
                class="ml-1 text-[10px] text-gray-400"
                :title="`협력사의 '${shipmentNextLabel(po)}' 처리를 기다리는 중`"
              >
                협력사 차례
              </span>
              <!-- 선적 그룹(§6.10) — 여러 발주서 한 물류 묶음 -->
              <span
                v-if="(po.shipment?.groupPos.length ?? 0) > 1"
                class="ml-1 rounded bg-indigo-100 px-1 py-0.5 text-[10px] font-bold text-indigo-700"
                :title="po.shipment?.groupPos.map((g) => g.quoteTitle).join('\n')"
              >
                📦 묶음 {{ po.shipment?.groupPos.length }}건
              </span>
              <span v-if="po.shipment?.trackingNumber != null" class="ml-1 font-mono text-[10px] text-gray-400" :title="po.shipment.carrier ?? ''">
                {{ po.shipment.trackingNumber }}
              </span>
              <span v-if="po.shipment?.receivedAt != null" class="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-bold text-emerald-700" :title="po.shipment.receivedNote ?? ''">
                입고 완료
              </span>
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-gray-400">
              {{ smartbomFmtDate(po.issuedAt) }}
              <template v-if="po.confirmedAt !== null"> → {{ smartbomFmtDate(po.confirmedAt) }}</template>
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-right">
              <button
                type="button"
                class="rounded px-2 py-1 font-semibold disabled:opacity-40"
                :class="shipmentAdminPending(po) ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-blue-200 text-blue-700 hover:bg-blue-50'"
                :disabled="busy || po.status === 'issued'"
                :title="po.status === 'issued'
                  ? po.supplierCode !== null
                    ? '공급사 구매 완료 처리 후 선적을 진행할 수 있습니다'
                    : '협력사가 발주 확인을 완료한 뒤 선적을 진행할 수 있습니다'
                  : ''"
                @click="emit('shipment', po)"
              >
                선적 관리
              </button>
              <button
                v-if="po.supplierCode !== null && po.status === 'issued'"
                type="button"
                class="ml-1 rounded bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                :disabled="busy"
                @click="emit('confirmSupplier', po)"
              >
                구매 완료 처리
              </button>
              <button
                v-if="po.status === 'issued'"
                type="button"
                class="rounded border border-red-200 px-2 py-1 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
                :disabled="busy"
                title="미확인 발주서 발행 취소(재발행 = 삭제 후 재생성)"
                @click="emit('remove', po)"
              >
                발행 취소
              </button>
              <button
                v-if="po.status !== 'closed'"
                type="button"
                class="ml-1 rounded border border-gray-300 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                :disabled="busy"
                @click="emit('close', po)"
              >
                마감
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
