<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import {
  PCB_PO_STATUS_LABELS,
  PCB_RFQ_STATUS_LABELS,
  bomShipmentNextStatus,
  bomShipmentStatusLabel,
  type AdminPcbPoViewType,
  type AdminPcbRfqViewType,
  type PcbRfqReplyBodyType,
  type PcbShipmentAdvanceBodyType,
  type PcbShipmentViewType,
} from '@sp/api-contract';
import { downloadAdminFile, useAdminQuoteDetail, useConfirmPrice } from '../../admin/useAdminQuotes';
import { useAdminPartnerList, type AdminPartnerFilters } from '../../admin/useAdminPartners';
import {
  pcbMagicReplyUrl,
  useAdminPcbRfqReply,
  useAdminPcbRfqs,
  useReissuePcbMagicLink,
  useSelectPcbRfq,
  useSendPcbRfqs,
  useUnselectPcbRfq,
} from '../../admin/useAdminPcbRfqs';
import {
  adminPcbInvoiceApi,
  downloadAdminPcbEqFile,
  downloadAdminPcbShipmentFile,
  useAdminPcbPos,
  useAdminPcbShipmentAdvance,
  useAdminPcbShipmentReceive,
  useAdminPcbShipmentRevert,
  useAdminRevertPcbEq,
  useApprovePcbEq,
  useCreatePcbPo,
  useDeletePcbPo,
  useRejectPcbEq,
} from '../../admin/useAdminPcbPos';
import { fmtPcbAmount, pcbKrwSuffix, pcbMoneyWithSub } from '../../lib/pcb-money';
import PcbRfqReplyForm from '../../components/pcb/PcbRfqReplyForm.vue';
import InvoiceEditorModal from '../../components/smartbom/InvoiceEditorModal.vue';

// PCB Case 상세 — docs/PCB_PARTNER_TRACK.md §5.4. 스펙 요약(기존 admin-pcb-projects
// 상세 계약 재사용) + 협력사 RFQ 패널(배정 diff·대리 회신·선정/해제·매직링크).
// 프로세스: 회신 비교 → [선정] → [확정가 등록](기존 PATCH — 담김/주문됨 409) → 고객 주문.

const route = useRoute();
const specId = computed(() => {
  const raw = Number(route.params.id);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
});
const fromRfqs = computed(() => route.query.from === 'rfqs');

const detailQuery = useAdminQuoteDetail(specId);
const detail = computed(() => detailQuery.data.value?.data ?? null);
const rfqsQuery = useAdminPcbRfqs(specId);
const allRows = computed(() => rfqsQuery.data.value?.data.rfqs ?? []);
const adminRows = computed(() => allRows.value.filter((r) => r.parentPartnerId === 0));
const childrenOf = (partnerId: number): AdminPcbRfqViewType[] =>
  allRows.value.filter((r) => r.parentPartnerId === partnerId);
const selectedRow = computed(() => adminRows.value.find((r) => r.status === 'selected') ?? null);

const actionError = ref('');
const surfaceError = (e: unknown, fallback: string): void => {
  actionError.value =
    e instanceof ApiRequestError && e.message !== '' ? e.message : fallback;
};

// ── 스펙 표시 ────────────────────────────────────────────────────────────────
const specEntries = computed(() => {
  const spec = detail.value?.spec ?? {};
  return Object.entries(spec as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .filter(([, v]) => String(v).trim() !== '')
    .map(([k, v]) => ({ key: k, value: String(v) }));
});
const gerberFiles = computed(
  () => (detail.value?.files ?? []).filter((f) => f.fileType !== 'thumbnail'),
);

const QUOTE_LABEL: Record<string, { label: string; cls: string }> = {
  rfq: { label: '견적 대기', cls: 'bg-amber-100 text-amber-700' },
  priced: { label: '자동견적', cls: 'bg-sky-100 text-sky-700' },
  quoted: { label: '견적 확정', cls: 'bg-emerald-100 text-emerald-700' },
};
const CART_LABEL: Record<string, string> = {
  cart: '고객 장바구니에 담김 — 선정·확정 변경 불가',
  ordered: '주문됨 — 선정·확정 변경 불가',
};

// ── 확정가 등록(기존 PATCH 재사용 — 선정행 KRW 환산을 프리필) ────────────────
const priceModalOpen = ref(false);
const priceInput = ref('');
const confirmPrice = useConfirmPrice();
function openPriceModal(): void {
  const prefill = selectedRow.value?.krwAmount ?? detail.value?.price ?? null;
  priceInput.value = prefill === null ? '' : String(prefill);
  priceModalOpen.value = true;
}
async function submitPrice(): Promise<void> {
  actionError.value = '';
  const value = Number(priceInput.value.replaceAll(',', ''));
  if (!Number.isFinite(value) || value <= 0) {
    actionError.value = '확정가(원)를 입력해 주세요.';
    return;
  }
  if (specId.value === null) return;
  try {
    await confirmPrice.mutateAsync({ projectId: specId.value, finalPrice: Math.round(value) });
    priceModalOpen.value = false;
  } catch (e) {
    surfaceError(e, '확정가 등록에 실패했습니다.');
  }
}

// ── 배정 모달 — 승인 + pcb_rfq 능력 협력사만 후보 ────────────────────────────
const assignOpen = ref(false);
const assignSelected = ref<Set<number>>(new Set());
const assignDate = ref('');
const partnerFilters = ref<AdminPartnerFilters>({
  page: 1,
  pageSize: 100,
  tab: 'approved',
  type: 'partner',
  q: '',
});
const partnersQuery = useAdminPartnerList(partnerFilters);
const assignCandidates = computed(() =>
  (partnersQuery.data.value?.data.items ?? []).filter((p) =>
    (p.capabilities as readonly string[]).includes('pcb_rfq'),
  ),
);
const send = useSendPcbRfqs();
function openAssign(): void {
  assignSelected.value = new Set(
    adminRows.value.filter((r) => r.status !== 'unselected').map((r) => r.partnerId),
  );
  const current = adminRows.value.find((r) => r.suggestedDeliveryDate !== null);
  assignDate.value = current?.suggestedDeliveryDate?.slice(0, 10) ?? '';
  assignOpen.value = true;
}
function toggleAssign(partnerId: number): void {
  const next = new Set(assignSelected.value);
  if (next.has(partnerId)) next.delete(partnerId);
  else next.add(partnerId);
  assignSelected.value = next;
}
async function submitAssign(): Promise<void> {
  if (specId.value === null) return;
  actionError.value = '';
  try {
    await send.mutateAsync({
      specId: specId.value,
      body: {
        partnerIds: [...assignSelected.value],
        suggestedDeliveryDate: assignDate.value === '' ? null : assignDate.value,
      },
    });
    assignOpen.value = false;
  } catch (e) {
    surfaceError(e, '견적요청 발송에 실패했습니다.');
  }
}

// ── 대리 회신 모달(포털·매직링크와 같은 저장 코어) ───────────────────────────
const replyTarget = ref<AdminPcbRfqViewType | null>(null);
const adminReply = useAdminPcbRfqReply();
async function submitAdminReply(body: PcbRfqReplyBodyType): Promise<void> {
  if (specId.value === null || replyTarget.value === null) return;
  actionError.value = '';
  try {
    await adminReply.mutateAsync({ specId: specId.value, rfqId: replyTarget.value.rfqId, body });
    replyTarget.value = null;
  } catch (e) {
    surfaceError(e, '대리 회신 저장에 실패했습니다.');
  }
}

// ── 선정/해제 — 외화는 적용 환율 입력(결제통화→KRW 박제) ─────────────────────
const selectTarget = ref<AdminPcbRfqViewType | null>(null);
const selectRate = ref('');
const selectMut = useSelectPcbRfq();
const unselectMut = useUnselectPcbRfq();
function openSelect(row: AdminPcbRfqViewType): void {
  actionError.value = '';
  selectTarget.value = row;
  selectRate.value = '';
}
async function submitSelect(): Promise<void> {
  if (specId.value === null || selectTarget.value === null) return;
  const row = selectTarget.value;
  let exchangeRate: number | undefined;
  if (row.currency !== 'KRW') {
    exchangeRate = Number(selectRate.value.replaceAll(',', ''));
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      actionError.value = `적용 환율(${row.currency}→KRW)을 입력해 주세요.`;
      return;
    }
  }
  actionError.value = '';
  try {
    await selectMut.mutateAsync({
      specId: specId.value,
      rfqId: row.rfqId,
      ...(exchangeRate === undefined ? {} : { exchangeRate }),
    });
    selectTarget.value = null;
  } catch (e) {
    surfaceError(e, '선정에 실패했습니다.');
  }
}
async function submitUnselect(row: AdminPcbRfqViewType): Promise<void> {
  if (specId.value === null) return;
  if (!window.confirm(`${row.partnerName} 선정을 해제할까요? 형제 회신은 다시 열립니다.`)) return;
  actionError.value = '';
  try {
    await unselectMut.mutateAsync({ specId: specId.value, rfqId: row.rfqId });
  } catch (e) {
    surfaceError(e, '선정 해제에 실패했습니다.');
  }
}

// ── 매직링크 ─────────────────────────────────────────────────────────────────
const reissue = useReissuePcbMagicLink();
const copiedRfqId = ref<number | null>(null);
async function copyMagicLink(row: AdminPcbRfqViewType): Promise<void> {
  if (row.magicToken === null) return;
  await navigator.clipboard.writeText(pcbMagicReplyUrl(row.magicToken));
  copiedRfqId.value = row.rfqId;
  window.setTimeout(() => {
    if (copiedRfqId.value === row.rfqId) copiedRfqId.value = null;
  }, 1500);
}
async function reissueMagicLink(row: AdminPcbRfqViewType): Promise<void> {
  if (specId.value === null) return;
  if (!window.confirm('매직링크를 재발급할까요? 기존 링크는 즉시 무효화됩니다.')) return;
  actionError.value = '';
  try {
    await reissue.mutateAsync({ specId: specId.value, rfqId: row.rfqId });
  } catch (e) {
    surfaceError(e, '재발급에 실패했습니다.');
  }
}

// ── 발주 패널(P2) — paid 게이트는 서버, 프리필은 선정 견적행 ─────────────────
const posQuery = useAdminPcbPos(specId);
const allPos = computed(() => posQuery.data.value?.data.pos ?? []);
const adminPos = computed(() => allPos.value.filter((p) => p.parentPartnerId === 0));
const childPosOf = (partnerId: number): AdminPcbPoViewType[] =>
  allPos.value.filter((p) => p.parentPartnerId === partnerId);

const poModalOpen = ref(false);
const poPartnerId = ref<number | null>(null);
const poPrice = ref('');
const poRate = ref('');
const poTerms = ref('');
const poRemitted = ref(false);
const poDelivery = ref('');
const poMemo = ref('');
const createPo = useCreatePcbPo();

const poTargetRfq = computed(() =>
  adminRows.value.find((r) => r.partnerId === poPartnerId.value && r.status === 'selected') ??
  adminRows.value.find((r) => r.partnerId === poPartnerId.value && r.priceOriginal !== null) ??
  null,
);
const poCurrencyOf = (partnerId: number | null): string =>
  adminRows.value.find((r) => r.partnerId === partnerId)?.currency ??
  assignCandidates.value.find((p) => p.partnerId === partnerId)?.defaultCurrency ??
  'KRW';

function openPoModal(): void {
  const selected = selectedRow.value;
  poPartnerId.value = selected?.partnerId ?? assignCandidates.value[0]?.partnerId ?? null;
  poPrice.value = '';
  poRate.value = '';
  poTerms.value = '';
  poRemitted.value = false;
  poDelivery.value = selected?.quotedDeliveryDate?.slice(0, 10) ?? '';
  poMemo.value = '';
  poModalOpen.value = true;
}
async function submitPo(): Promise<void> {
  if (specId.value === null || poPartnerId.value === null) return;
  actionError.value = '';
  const priceRaw = poPrice.value.replaceAll(',', '').trim();
  const rateRaw = poRate.value.replaceAll(',', '').trim();
  try {
    await createPo.mutateAsync({
      specId: specId.value,
      body: {
        partnerId: poPartnerId.value,
        rfqId: poTargetRfq.value?.rfqId ?? null,
        ...(priceRaw === '' ? {} : { priceOriginal: Number(priceRaw) }),
        ...(rateRaw === '' ? {} : { exchangeRate: Number(rateRaw) }),
        paymentTerms: poTerms.value.trim() === '' ? null : poTerms.value.trim(),
        remitted: poRemitted.value,
        deliveryDate: poDelivery.value === '' ? null : poDelivery.value,
        memo: poMemo.value.trim() === '' ? null : poMemo.value.trim(),
      },
    });
    poModalOpen.value = false;
  } catch (e) {
    surfaceError(e, '발주서 발행에 실패했습니다.');
  }
}

const approveEq = useApprovePcbEq();
const rejectEq = useRejectPcbEq();
const revertEqAdmin = useAdminRevertPcbEq();
const deletePoMut = useDeletePcbPo();
async function approvePo(po: AdminPcbPoViewType): Promise<void> {
  if (specId.value === null) return;
  actionError.value = '';
  try {
    await approveEq.mutateAsync({ specId: specId.value, poId: po.poId });
  } catch (e) {
    surfaceError(e, 'EQ 승인에 실패했습니다.');
  }
}
async function rejectPo(po: AdminPcbPoViewType): Promise<void> {
  if (specId.value === null) return;
  const reason = window.prompt(`${po.partnerName} EQ 반려 사유를 입력하세요`);
  if (reason === null || reason.trim() === '') return;
  actionError.value = '';
  try {
    await rejectEq.mutateAsync({ specId: specId.value, poId: po.poId, reason: reason.trim() });
  } catch (e) {
    surfaceError(e, 'EQ 반려에 실패했습니다.');
  }
}
async function revertPo(po: AdminPcbPoViewType): Promise<void> {
  if (specId.value === null) return;
  if (!window.confirm('EQ 승인을 취소(한 단계 되돌리기)할까요?')) return;
  actionError.value = '';
  try {
    await revertEqAdmin.mutateAsync({ specId: specId.value, poId: po.poId });
  } catch (e) {
    surfaceError(e, '되돌리기에 실패했습니다.');
  }
}
async function removePo(po: AdminPcbPoViewType): Promise<void> {
  if (specId.value === null) return;
  if (!window.confirm(`${po.partnerName} 발주서를 취소할까요? (발주접수 상태만 가능)`)) return;
  actionError.value = '';
  try {
    await deletePoMut.mutateAsync({ specId: specId.value, poId: po.poId });
  } catch (e) {
    surfaceError(e, '발주 취소에 실패했습니다.');
  }
}

const PO_STATUS_CLS: Record<string, string> = {
  issued: 'bg-blue-100 text-blue-700',
  eq_requested: 'bg-amber-100 text-amber-700',
  eq_done: 'bg-sky-100 text-sky-700',
  producing: 'bg-indigo-100 text-indigo-700',
  produced: 'bg-emerald-100 text-emerald-700',
};

// ── 선적 패널(P3) — 관리자는 받는측 + 양측 만능 대행(서버 isSideActor) ────────
const shipments = computed(() => posQuery.data.value?.data.shipments ?? []);
const shipmentByPo = computed(() => {
  const map = new Map<number, PcbShipmentViewType>();
  for (const s of shipments.value) for (const pid of s.poIds) map.set(pid, s);
  return map;
});
// 서브행 v-for 용 — 대표 발주 행에만 1개(묶음은 대표 행 아래 한 번만 표시).
const shipRowsOf = (poId: number): PcbShipmentViewType[] => {
  const s = shipmentByPo.value.get(poId);
  if (s === undefined) return [];
  return s.poId === poId ? [s] : [];
};

const shipAdvanceAdmin = useAdminPcbShipmentAdvance();
const shipRevertAdmin = useAdminPcbShipmentRevert();
const shipReceiveAdmin = useAdminPcbShipmentReceive();

async function adminShipAdvance(poId: number, s: PcbShipmentViewType): Promise<void> {
  if (specId.value === null) return;
  const next = bomShipmentNextStatus(s.mode, s.status);
  if (next === null) return;
  let body: PcbShipmentAdvanceBodyType = {};
  if (next === 'requested') {
    const d = window.prompt('출고예정일 (YYYY-MM-DD) — Invoice 첨부도 필요합니다');
    if (d === null || d.trim() === '') return;
    body = { shipDate: d.trim() };
  } else if (next === 'shipping') {
    const carrier = window.prompt('택배사');
    if (carrier === null || carrier.trim() === '') return;
    const tn = window.prompt('송장번호');
    if (tn === null || tn.trim() === '') return;
    body = { carrier: carrier.trim(), trackingNumber: tn.trim() };
  } else if (next === 'shipped') {
    const tn = window.prompt('트래킹 번호(AWB/BL)');
    if (tn === null || tn.trim() === '') return;
    body = { trackingNumber: tn.trim() };
  }
  actionError.value = '';
  try {
    await shipAdvanceAdmin.mutateAsync({ specId: specId.value, poId, body });
  } catch (e) {
    surfaceError(e, '선적 진행에 실패했습니다.');
  }
}
async function adminShipRevert(poId: number): Promise<void> {
  if (specId.value === null) return;
  if (!window.confirm('선적을 한 단계 되돌릴까요?')) return;
  actionError.value = '';
  try {
    await shipRevertAdmin.mutateAsync({ specId: specId.value, poId });
  } catch (e) {
    surfaceError(e, '되돌리기에 실패했습니다.');
  }
}
async function adminShipReceive(poId: number): Promise<void> {
  if (specId.value === null) return;
  const note = window.prompt('입고 확인 메모(수량 부족·불량 등 — 없으면 비워두세요)');
  if (note === null) return;
  actionError.value = '';
  try {
    await shipReceiveAdmin.mutateAsync({
      specId: specId.value,
      poId,
      note: note.trim() === '' ? null : note.trim(),
    });
  } catch (e) {
    surfaceError(e, '입고 확인에 실패했습니다.');
  }
}

// 상업송장 모달 — 대표 발주 기준 콜백 주입.
const invoicePoId = ref<number | null>(null);
const adminInvoiceApiRef = computed(() =>
  invoicePoId.value === null || specId.value === null
    ? null
    : adminPcbInvoiceApi(specId.value, invoicePoId.value),
);

const SHIP_STATUS_CLS: Record<string, string> = {
  preparing: 'bg-gray-100 text-gray-600',
  requested: 'bg-blue-100 text-blue-700',
  shipped: 'bg-indigo-100 text-indigo-700',
  arrived: 'bg-sky-100 text-sky-700',
  customs: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
  shipping: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-emerald-100 text-emerald-700',
};

// ── 표시 헬퍼 ────────────────────────────────────────────────────────────────
const STATUS_CLS: Record<string, string> = {
  requested: 'bg-blue-100 text-blue-700',
  quoted: 'bg-emerald-100 text-emerald-700',
  selected: 'bg-violet-100 text-violet-700',
  unselected: 'bg-gray-200 text-gray-500',
};
const dateOnly = (iso: string | null): string => (iso === null ? '—' : iso.slice(0, 10));
// 납기 신호(레거시 승계) — 제시≠회신이면 '변경', 회신일이 과거면 경고.
const deliverySignal = (row: AdminPcbRfqViewType): { label: string; cls: string } | null => {
  if (row.quotedDeliveryDate === null) return null;
  const quoted = row.quotedDeliveryDate.slice(0, 10);
  if (quoted < new Date().toISOString().slice(0, 10))
    return { label: '지난 날짜', cls: 'bg-red-100 text-red-700' };
  if (row.suggestedDeliveryDate !== null) {
    const suggested = row.suggestedDeliveryDate.slice(0, 10);
    if (suggested !== quoted) {
      const days = Math.round(
        (Date.parse(quoted) - Date.parse(suggested)) / 86_400_000,
      );
      return {
        label: `변경 ${days > 0 ? '+' : ''}${String(days)}일`,
        cls: 'bg-amber-100 text-amber-700',
      };
    }
  }
  return null;
};
const editableRow = (row: AdminPcbRfqViewType): boolean =>
  row.status === 'requested' || row.status === 'quoted';
</script>

<template>
  <div class="pcb-readable space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink
        :to="{ name: fromRfqs ? 'admin-pcb-rfqs' : 'admin-quotes' }"
        class="text-sm text-gray-400 hover:text-gray-700"
      >
        ← {{ fromRfqs ? 'PCB 견적요청' : '견적 관리' }}
      </RouterLink>
      <h1 class="text-xl font-bold">
        <span class="font-mono text-base text-gray-400">Q{{ specId }}</span>
        {{ detail?.projectName ?? '' }}
      </h1>
      <span
        v-if="detail !== null"
        class="rounded px-2 py-0.5 text-xs font-semibold"
        :class="QUOTE_LABEL[detail.quoteStatus]?.cls"
      >
        {{ QUOTE_LABEL[detail.quoteStatus]?.label }}
      </span>
      <span v-if="detail !== null && detail.cartState !== 'none'" class="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
        {{ CART_LABEL[detail.cartState] }}
      </span>
    </div>

    <p v-if="actionError !== ''" class="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
      {{ actionError }}
    </p>

    <div v-if="detail !== null" class="grid gap-4 lg:grid-cols-3">
      <!-- 스펙 요약 -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4 lg:col-span-2">
        <h2 class="text-sm font-bold text-gray-700">제작 사양</h2>
        <p class="mt-1 text-sm text-gray-500">
          {{ detail.category }} · {{ detail.orderCategory === 'mass' ? '양산' : '샘플' }} ·
          {{ detail.qty }}매
          <span v-if="detail.applicant !== null" class="ml-2 text-gray-400">
            신청 {{ detail.applicant.name || detail.applicant.mbId }}
          </span>
        </p>
        <p class="mt-1 text-xs text-gray-400">{{ detail.optionSummary }}</p>
        <div v-if="gerberFiles.length > 0" class="mt-3 flex flex-wrap gap-2">
          <button
            v-for="f in gerberFiles"
            :key="f.fileId"
            type="button"
            class="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            @click="void downloadAdminFile(f.fileId, f.originFileName)"
          >
            ⬇ {{ f.originFileName }}
          </button>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          <div v-for="entry in specEntries" :key="entry.key" class="flex justify-between gap-2 border-b border-gray-50 py-1">
            <dt class="text-gray-400">{{ entry.key }}</dt>
            <dd class="truncate font-medium text-gray-700">{{ entry.value }}</dd>
          </div>
        </dl>
        <p v-if="detail.message !== null && detail.message !== ''" class="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
          {{ detail.message }}
        </p>
      </section>

      <!-- 고객 견적(확정가) -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 class="text-sm font-bold text-gray-700">고객 견적</h2>
        <dl class="mt-2 space-y-1.5 text-sm">
          <div class="flex justify-between">
            <dt class="text-gray-500">자동견적가</dt>
            <dd class="tabular-nums">{{ fmtPcbAmount('KRW', detail.quote?.autoPrice ?? null) }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-gray-500">확정가</dt>
            <dd class="font-bold tabular-nums" :class="detail.finalPrice === null ? 'text-gray-300' : 'text-emerald-700'">
              {{ fmtPcbAmount('KRW', detail.finalPrice) }}
            </dd>
          </div>
          <div v-if="selectedRow !== null" class="flex justify-between">
            <dt class="text-gray-500">선정 원가</dt>
            <dd class="tabular-nums text-gray-700">
              {{ pcbMoneyWithSub(selectedRow.currency, selectedRow.priceOriginal, selectedRow.subCurrency, selectedRow.subPriceOriginal) }}{{ pcbKrwSuffix(selectedRow.currency, selectedRow.krwAmount) }}
            </dd>
          </div>
        </dl>
        <button
          type="button"
          class="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
          :disabled="detail.cartState !== 'none' || detail.status !== 'active'"
          @click="openPriceModal"
        >
          {{ detail.finalPrice === null ? '확정가 등록' : '확정가 수정' }}
        </button>
        <p class="mt-1.5 text-[11px] leading-4 text-gray-400">
          확정가를 등록해야 고객이 주문할 수 있습니다(견적 확정). 협력사 선정 시 KRW 환산가가
          프리필됩니다 — 마진을 더해 확정하세요.
        </p>
      </section>
    </div>

    <!-- RFQ 패널 -->
    <section class="rounded-xl border border-gray-200 bg-surface">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <h2 class="text-sm font-bold text-gray-700">
          협력사 견적요청
          <span class="ml-1 text-xs font-normal text-gray-400">{{ adminRows.length }}곳</span>
        </h2>
        <button
          type="button"
          class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="detail?.cartState !== 'none'"
          @click="openAssign"
        >
          협력사 견적요청 {{ adminRows.length > 0 ? '변경' : '보내기' }}
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-100 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="px-4 py-2">협력사</th>
              <th class="px-4 py-2">상태</th>
              <th class="whitespace-nowrap px-4 py-2">회신 견적가</th>
              <th class="whitespace-nowrap px-4 py-2">납기(제시 → 회신)</th>
              <th class="px-4 py-2">메모</th>
              <th class="whitespace-nowrap px-4 py-2">회신일</th>
              <th class="px-4 py-2 text-right">액션</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <template v-for="row in adminRows" :key="row.rfqId">
              <tr :class="row.status === 'selected' ? 'bg-violet-50/40' : ''">
                <td class="px-4 py-2.5">
                  <p class="font-medium text-gray-900">{{ row.partnerName }}</p>
                  <p v-if="row.childCount > 0" class="text-[11px] text-indigo-600">
                    MD 경유 · 하위 {{ row.childQuotedCount }}/{{ row.childCount }} 회신
                    <span v-if="row.marginRate !== null"> · 마진 {{ row.marginRate }}%</span>
                  </p>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5">
                  <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[row.status]">
                    {{ PCB_RFQ_STATUS_LABELS[row.status] }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 tabular-nums">
                  {{ pcbMoneyWithSub(row.currency, row.priceOriginal, row.subCurrency, row.subPriceOriginal) }}
                  <span class="text-xs text-gray-400">{{ pcbKrwSuffix(row.currency, row.krwAmount) }}</span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">
                  {{ dateOnly(row.suggestedDeliveryDate) }} → {{ dateOnly(row.quotedDeliveryDate) }}
                  <span
                    v-if="deliverySignal(row) !== null"
                    class="ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold"
                    :class="deliverySignal(row)?.cls"
                  >
                    {{ deliverySignal(row)?.label }}
                  </span>
                </td>
                <td class="max-w-[16rem] truncate px-4 py-2.5 text-xs text-gray-500" :title="row.memo ?? ''">
                  {{ row.memo ?? '—' }}
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 text-xs text-gray-400">{{ dateOnly(row.respondedAt) }}</td>
                <td class="whitespace-nowrap px-4 py-2.5 text-right text-xs">
                  <button
                    v-if="editableRow(row)"
                    type="button"
                    class="mr-1 rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50"
                    @click="replyTarget = row"
                  >
                    대리 회신
                  </button>
                  <button
                    v-if="row.status === 'quoted'"
                    type="button"
                    class="mr-1 rounded-md bg-violet-600 px-2 py-1 font-semibold text-white hover:bg-violet-700"
                    @click="openSelect(row)"
                  >
                    선정
                  </button>
                  <button
                    v-if="row.status === 'selected'"
                    type="button"
                    class="mr-1 rounded-md border border-violet-300 px-2 py-1 font-semibold text-violet-700 hover:bg-violet-50"
                    @click="void submitUnselect(row)"
                  >
                    선정 해제
                  </button>
                  <button
                    v-if="row.magicToken !== null"
                    type="button"
                    class="mr-1 rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-500 hover:bg-gray-50"
                    :title="'무로그인 회신 링크 복사'"
                    @click="void copyMagicLink(row)"
                  >
                    {{ copiedRfqId === row.rfqId ? '복사됨!' : '링크 복사' }}
                  </button>
                  <button
                    type="button"
                    class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-gray-50"
                    title="매직링크 재발급(기존 링크 무효화)"
                    @click="void reissueMagicLink(row)"
                  >
                    재발급
                  </button>
                </td>
              </tr>
              <!-- MD 하위 트랙(읽기전용 — 조작은 MD 포털 몫) -->
              <tr v-if="childrenOf(row.partnerId).length > 0">
                <td colspan="7" class="bg-indigo-50/30 px-8 py-2">
                  <p class="text-[11px] font-semibold text-indigo-500">하위 협력사 회신(MD {{ row.partnerName }} 경유)</p>
                  <div class="mt-1 grid gap-1">
                    <div
                      v-for="child in childrenOf(row.partnerId)"
                      :key="child.rfqId"
                      class="flex flex-wrap items-center gap-2 text-xs text-gray-600"
                    >
                      <span class="rounded px-1.5 py-0.5 font-semibold" :class="STATUS_CLS[child.status]">
                        {{ PCB_RFQ_STATUS_LABELS[child.status] }}
                      </span>
                      <span class="font-medium">{{ child.partnerName }}</span>
                      <span class="tabular-nums">
                        {{ pcbMoneyWithSub(child.currency, child.priceOriginal, child.subCurrency, child.subPriceOriginal) }}
                      </span>
                      <span class="text-gray-400">납기 {{ dateOnly(child.quotedDeliveryDate) }}</span>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="adminRows.length === 0">
              <td colspan="7" class="px-4 py-8 text-center text-sm text-gray-400">
                아직 배정된 협력사가 없습니다 — [협력사 견적요청 보내기]로 시작하세요.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 발주 패널(P2) — 결제(paid) 후 발행, EQ 승인/반려는 관리자 몫 -->
    <section class="rounded-xl border border-gray-200 bg-surface">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <h2 class="text-sm font-bold text-gray-700">
          발주서 · EQ
          <span class="ml-1 text-xs font-normal text-gray-400">{{ adminPos.length }}건</span>
        </h2>
        <button
          type="button"
          class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-700"
          @click="openPoModal"
        >
          발주서 발행
        </button>
      </div>
      <p class="border-b border-gray-50 px-4 py-2 text-xs text-gray-400">
        발행은 고객 결제(입금 확인) 후에만 가능합니다. 진행:
        발주접수(협력사 EQ·Working 업로드) → EQ 승인요청 → <b>EQ 승인(관리자)</b> → 생산시작 → 생산완료.
      </p>

      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-100 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="px-4 py-2">협력사</th>
              <th class="px-4 py-2">상태</th>
              <th class="whitespace-nowrap px-4 py-2">발주가</th>
              <th class="whitespace-nowrap px-4 py-2">조건/송금</th>
              <th class="whitespace-nowrap px-4 py-2">납기</th>
              <th class="px-4 py-2">EQ 첨부</th>
              <th class="px-4 py-2 text-right">액션</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <template v-for="po in adminPos" :key="po.poId">
              <tr :class="po.status === 'eq_requested' ? 'bg-amber-50/40' : ''">
                <td class="px-4 py-2.5">
                  <p class="font-medium text-gray-900">{{ po.partnerName }}</p>
                  <p v-if="po.eqDelegatePoId !== null" class="text-[11px] text-indigo-600">MD 경유 — EQ는 하위에서 진행(자동 반영)</p>
                  <p v-else-if="po.eqBlocked" class="text-[11px] text-amber-600">MD 하위 발주 대기 — 발주되면 EQ 시작</p>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5">
                  <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="PO_STATUS_CLS[po.status]">
                    {{ PCB_PO_STATUS_LABELS[po.status] }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 tabular-nums">
                  {{ pcbMoneyWithSub(po.currency, po.priceOriginal, po.subCurrency, po.subPriceOriginal) }}
                  <span class="text-xs text-gray-400">{{ pcbKrwSuffix(po.currency, po.krwAmount) }}</span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 text-xs text-gray-600">
                  {{ po.paymentTerms ?? '—' }}
                  <span v-if="po.remittedAt !== null" class="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[11px] font-semibold text-emerald-700">송금완료</span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 text-gray-500">{{ dateOnly(po.deliveryDate) }}</td>
                <td class="px-4 py-2.5">
                  <button
                    v-for="f in po.eqFiles"
                    :key="f.fileId"
                    type="button"
                    class="mr-1 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500 hover:bg-gray-50"
                    :title="`${f.fileType.toUpperCase()} · ${f.name}`"
                    @click="specId !== null && void downloadAdminPcbEqFile(specId, po.poId, f.fileId, f.name)"
                  >
                    ⬇ {{ f.fileType }}
                  </button>
                  <span v-if="po.eqFiles.length === 0" class="text-xs text-gray-300">—</span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 text-right text-xs">
                  <template v-if="po.status === 'eq_requested' && po.eqDelegatePoId === null">
                    <button type="button" class="mr-1 rounded-md bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700" @click="void approvePo(po)">EQ 승인</button>
                    <button type="button" class="mr-1 rounded-md border border-red-300 px-2 py-1 font-semibold text-red-700 hover:bg-red-50" @click="void rejectPo(po)">반려</button>
                  </template>
                  <button
                    v-if="po.status === 'eq_done' && po.eqDelegatePoId === null"
                    type="button"
                    class="mr-1 rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-500 hover:bg-gray-50"
                    @click="void revertPo(po)"
                  >
                    승인 취소
                  </button>
                  <button
                    v-if="po.status === 'issued'"
                    type="button"
                    class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-gray-50 hover:text-red-600"
                    @click="void removePo(po)"
                  >
                    발주 취소
                  </button>
                </td>
              </tr>
              <!-- 선적(P3) — 대표 발주 행 아래 1줄(묶음 포함) -->
              <tr v-for="s in shipRowsOf(po.poId)" :key="`ship-${String(s.shipmentId)}`" class="bg-teal-50/30">
                <td colspan="7" class="px-8 py-2">
                  <div class="flex flex-wrap items-center gap-2 text-xs">
                    <span class="font-bold text-teal-600">🚚 선적</span>
                    <span class="rounded px-1.5 py-0.5 font-semibold" :class="SHIP_STATUS_CLS[s.status]">
                      {{ bomShipmentStatusLabel(s.mode, s.status) }}
                    </span>
                    <span class="text-gray-500">
                      {{ s.mode === 'domestic' ? '국내(택배)' : '국제' }} · {{ s.senderName }} → {{ s.receiverName }}
                      <template v-if="s.destinationCountry !== null"> · 직송 {{ s.destinationCountry }}</template>
                    </span>
                    <span v-if="s.poIds.length > 1" class="rounded bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-700">묶음 {{ s.poIds.length }}건</span>
                    <span v-if="s.shipDate !== null" class="text-gray-500">출고예정 {{ s.shipDate.slice(0, 10) }}</span>
                    <span v-if="s.trackingNumber !== null" class="tabular-nums text-gray-500">{{ s.carrier ?? '' }} {{ s.trackingNumber }}</span>
                    <span v-if="s.receivedAt !== null" class="font-semibold text-emerald-600">
                      입고완료 {{ dateOnly(s.receivedAt) }}<template v-if="s.receivedNote !== null && s.receivedNote !== ''"> · {{ s.receivedNote }}</template>
                    </span>
                    <button
                      v-for="f in s.files"
                      :key="f.fileId"
                      type="button"
                      class="rounded border border-gray-200 px-1.5 py-0.5 font-semibold text-gray-500 hover:bg-gray-50"
                      :title="f.name"
                      @click="specId !== null && void downloadAdminPcbShipmentFile(specId, po.poId, f.fileId, f.name)"
                    >
                      ⬇ {{ f.fileType }}
                    </button>
                    <span class="grow" />
                    <button
                      v-if="bomShipmentNextStatus(s.mode, s.status) !== null"
                      type="button"
                      class="rounded-md bg-teal-600 px-2 py-1 font-semibold text-white hover:bg-teal-700"
                      @click="void adminShipAdvance(po.poId, s)"
                    >
                      {{ bomShipmentStatusLabel(s.mode, bomShipmentNextStatus(s.mode, s.status) ?? s.status) }} 진행
                    </button>
                    <button
                      v-if="bomShipmentNextStatus(s.mode, s.status) === null && s.receivedAt === null && s.receiverKind === 'admin'"
                      type="button"
                      class="rounded-md bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700"
                      @click="void adminShipReceive(po.poId)"
                    >
                      입고 확인
                    </button>
                    <button
                      v-if="s.mode === 'international'"
                      type="button"
                      class="rounded-md border border-teal-300 px-2 py-1 font-semibold text-teal-700 hover:bg-teal-100"
                      @click="invoicePoId = po.poId"
                    >
                      🧾 송장
                    </button>
                    <button
                      v-if="s.status !== 'preparing'"
                      type="button"
                      class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-gray-50"
                      @click="void adminShipRevert(po.poId)"
                    >
                      ↩ 되돌리기
                    </button>
                  </div>
                </td>
              </tr>
              <!-- MD 하위 발주(EQ 실작업 문서) -->
              <tr v-if="childPosOf(po.partnerId).length > 0">
                <td colspan="7" class="bg-indigo-50/30 px-8 py-2">
                  <p class="text-[11px] font-semibold text-indigo-500">하위 발주(MD {{ po.partnerName }} 경유 — 승인/반려는 여기서)</p>
                  <div class="mt-1 grid gap-1">
                    <div v-for="child in childPosOf(po.partnerId)" :key="child.poId" class="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span class="rounded px-1.5 py-0.5 font-semibold" :class="PO_STATUS_CLS[child.status]">
                        {{ PCB_PO_STATUS_LABELS[child.status] }}
                      </span>
                      <span class="font-medium">{{ child.partnerName }}</span>
                      <span class="tabular-nums">{{ pcbMoneyWithSub(child.currency, child.priceOriginal, child.subCurrency, child.subPriceOriginal) }}</span>
                      <template v-for="cs in shipRowsOf(child.poId)" :key="`cship-${String(cs.shipmentId)}`">
                        <span class="rounded px-1.5 py-0.5 font-semibold" :class="SHIP_STATUS_CLS[cs.status]">
                          🚚 {{ bomShipmentStatusLabel(cs.mode, cs.status) }}
                        </span>
                        <span v-if="cs.receivedAt !== null" class="font-semibold text-emerald-600">MD 입고완료</span>
                      </template>
                      <button
                        v-for="f in child.eqFiles"
                        :key="f.fileId"
                        type="button"
                        class="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500 hover:bg-gray-50"
                        @click="specId !== null && void downloadAdminPcbEqFile(specId, child.poId, f.fileId, f.name)"
                      >
                        ⬇ {{ f.fileType }}
                      </button>
                      <template v-if="child.status === 'eq_requested'">
                        <button type="button" class="rounded-md bg-emerald-600 px-2 py-0.5 font-semibold text-white hover:bg-emerald-700" @click="void approvePo(child)">EQ 승인</button>
                        <button type="button" class="rounded-md border border-red-300 px-2 py-0.5 font-semibold text-red-700 hover:bg-red-50" @click="void rejectPo(child)">반려</button>
                      </template>
                      <button
                        v-else-if="child.status === 'eq_done'"
                        type="button"
                        class="rounded-md border border-gray-200 px-2 py-0.5 font-semibold text-gray-500 hover:bg-gray-50"
                        @click="void revertPo(child)"
                      >
                        승인 취소
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="adminPos.length === 0">
              <td colspan="7" class="px-4 py-8 text-center text-sm text-gray-400">
                발주서가 없습니다 — 선정 후 결제가 확인되면 [발주서 발행]으로 시작하세요.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 발주 모달 -->
    <div v-if="poModalOpen" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="poModalOpen = false">
      <div class="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl">
        <h3 class="text-sm font-bold text-gray-800">발주서 발행</h3>
        <p class="mt-1 text-xs text-gray-500">
          선정 회신이 있으면 통화·금액·납기가 자동 승계됩니다(비우면 승계값 사용).
        </p>
        <label class="mt-3 block">
          <span class="text-xs font-semibold text-gray-500">협력사 *</span>
          <select v-model="poPartnerId" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none">
            <option v-for="p in assignCandidates" :key="p.partnerId" :value="p.partnerId">
              {{ p.name }} ({{ p.defaultCurrency }})
            </option>
          </select>
          <span v-if="poTargetRfq !== null" class="mt-1 block text-[11px] text-emerald-600">
            회신 승계: {{ pcbMoneyWithSub(poTargetRfq.currency, poTargetRfq.priceOriginal, poTargetRfq.subCurrency, poTargetRfq.subPriceOriginal) }}
            <template v-if="poTargetRfq.quotedDeliveryDate !== null"> · 납기 {{ poTargetRfq.quotedDeliveryDate.slice(0, 10) }}</template>
          </span>
        </label>
        <div class="mt-2 grid gap-2 sm:grid-cols-2">
          <label class="block">
            <span class="text-xs font-semibold text-gray-500">발주가 ({{ poCurrencyOf(poPartnerId) }})</span>
            <input v-model="poPrice" type="text" inputmode="decimal" :placeholder="poTargetRfq !== null ? '비우면 회신가' : '필수'" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-emerald-500 focus:outline-none">
          </label>
          <label v-if="poCurrencyOf(poPartnerId) !== 'KRW'" class="block">
            <span class="text-xs font-semibold text-gray-500">KRW 회계 환율</span>
            <input v-model="poRate" type="text" inputmode="decimal" :placeholder="poTargetRfq?.exchangeRate !== null && poTargetRfq !== undefined && poTargetRfq !== null ? '비우면 선정 환율' : '필수'" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-emerald-500 focus:outline-none">
          </label>
          <label class="block">
            <span class="text-xs font-semibold text-gray-500">결제조건</span>
            <input v-model="poTerms" type="text" list="pcb-payment-terms" placeholder="T/T in Advance" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none">
            <datalist id="pcb-payment-terms">
              <option value="T/T in Advance" />
              <option value="NET30 DAYS" />
              <option value="50% PRE-PAID" />
            </datalist>
          </label>
          <label class="block">
            <span class="text-xs font-semibold text-gray-500">납기</span>
            <input v-model="poDelivery" type="date" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none">
          </label>
        </div>
        <label class="mt-2 flex items-center gap-2 text-sm text-gray-600">
          <input v-model="poRemitted" type="checkbox" class="size-4 accent-emerald-600"> 송금 완료
        </label>
        <label class="mt-2 block">
          <span class="text-xs font-semibold text-gray-500">메모</span>
          <textarea v-model="poMemo" rows="2" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
        </label>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm" @click="poModalOpen = false">취소</button>
          <button type="button" class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40" :disabled="createPo.isPending.value || poPartnerId === null" @click="void submitPo()">발행</button>
        </div>
      </div>
    </div>

    <!-- 확정가 모달 -->
    <div v-if="priceModalOpen" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="priceModalOpen = false">
      <div class="w-full max-w-sm rounded-xl bg-surface p-5 shadow-xl">
        <h3 class="text-sm font-bold text-gray-800">확정가 등록</h3>
        <p class="mt-1 text-xs text-gray-500">부가세 포함가 역산 체계 — 고객 결제액의 기준이 됩니다.</p>
        <label class="mt-3 block">
          <span class="text-xs font-semibold text-gray-500">확정가 (₩)</span>
          <input v-model="priceInput" type="text" inputmode="numeric" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-emerald-500 focus:outline-none">
        </label>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm" @click="priceModalOpen = false">취소</button>
          <button type="button" class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40" :disabled="confirmPrice.isPending.value" @click="void submitPrice()">등록</button>
        </div>
      </div>
    </div>

    <!-- 배정 모달 -->
    <div v-if="assignOpen" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="assignOpen = false">
      <div class="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl">
        <h3 class="text-sm font-bold text-gray-800">협력사 견적요청</h3>
        <p class="mt-1 text-xs text-gray-500">
          체크 해제된 미회신 요청은 회수됩니다(회신 완료 건은 보존). 신규 협력사에게만 메일이 발송됩니다.
        </p>
        <div class="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-gray-100 p-2">
          <label
            v-for="p in assignCandidates"
            :key="p.partnerId"
            class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50"
          >
            <input type="checkbox" class="size-4 accent-blue-600" :checked="assignSelected.has(p.partnerId)" @change="toggleAssign(p.partnerId)">
            <span class="flex-1 font-medium text-gray-800">{{ p.name }}</span>
            <span class="text-xs text-gray-400">{{ p.defaultCurrency }}<template v-if="p.country !== null"> · {{ p.country }}</template></span>
          </label>
          <p v-if="assignCandidates.length === 0" class="px-2 py-4 text-center text-xs text-gray-400">
            PCB 견적(pcb_rfq) 능력이 있는 승인 협력사가 없습니다 — 파트너 관리에서 등록하세요.
          </p>
        </div>
        <label class="mt-3 block">
          <span class="text-xs font-semibold text-gray-500">희망 납기(제시일 — 선택)</span>
          <input v-model="assignDate" type="date" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
        </label>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm" @click="assignOpen = false">취소</button>
          <button type="button" class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40" :disabled="send.isPending.value" @click="void submitAssign()">
            {{ assignSelected.size }}곳으로 발송
          </button>
        </div>
      </div>
    </div>

    <!-- 대리 회신 모달 -->
    <div v-if="replyTarget !== null" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="replyTarget = null">
      <div class="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl">
        <h3 class="text-sm font-bold text-gray-800">대리 회신 — {{ replyTarget.partnerName }}</h3>
        <p class="mt-1 text-xs text-gray-500">전화·메일로 받은 견적을 관리자가 대신 입력합니다(결제통화 {{ replyTarget.currency }}).</p>
        <div class="mt-3">
          <PcbRfqReplyForm
            :key="replyTarget.rfqId"
            :settlement-currency="replyTarget.currency"
            :initial="{
              priceOriginal: replyTarget.priceOriginal,
              subCurrency: replyTarget.subCurrency,
              subPriceOriginal: replyTarget.subPriceOriginal,
              quotedDeliveryDate: replyTarget.quotedDeliveryDate,
              memo: replyTarget.memo,
            }"
            :suggested-delivery-date="replyTarget.suggestedDeliveryDate"
            :busy="adminReply.isPending.value"
            @submit="(body) => void submitAdminReply(body)"
          />
        </div>
        <div class="mt-3 text-right">
          <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm" @click="replyTarget = null">닫기</button>
        </div>
      </div>
    </div>

    <!-- 선정 모달(외화 환율 입력) -->
    <div v-if="selectTarget !== null" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="selectTarget = null">
      <div class="w-full max-w-sm rounded-xl bg-surface p-5 shadow-xl">
        <h3 class="text-sm font-bold text-gray-800">협력사 선정 — {{ selectTarget.partnerName }}</h3>
        <p class="mt-2 text-sm text-gray-600">
          회신 견적가:
          <b class="tabular-nums">{{ pcbMoneyWithSub(selectTarget.currency, selectTarget.priceOriginal, selectTarget.subCurrency, selectTarget.subPriceOriginal) }}</b>
        </p>
        <label v-if="selectTarget.currency !== 'KRW'" class="mt-3 block">
          <span class="text-xs font-semibold text-gray-500">적용 환율 ({{ selectTarget.currency }} → KRW) *</span>
          <input v-model="selectRate" type="text" inputmode="decimal" placeholder="예) 1444.19" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-violet-500 focus:outline-none">
          <span class="mt-1 block text-[11px] text-gray-400">선정 시점에 박제되어 KRW 환산(원가 회계)에 쓰입니다.</span>
        </label>
        <p class="mt-2 text-xs text-gray-400">선정하면 같은 트랙의 다른 회신은 '미선정'이 됩니다. 판매가는 [확정가 등록]에서 별도로 정합니다.</p>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm" @click="selectTarget = null">취소</button>
          <button type="button" class="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40" :disabled="selectMut.isPending.value" @click="void submitSelect()">선정 확정</button>
        </div>
      </div>
    </div>

    <!-- 상업송장 편집(P3) — BOM InvoiceEditorModal 재사용(콜백 주입) -->
    <InvoiceEditorModal
      v-if="adminInvoiceApiRef !== null"
      :open="invoicePoId !== null"
      :load-draft="adminInvoiceApiRef.loadDraft"
      :save-draft="adminInvoiceApiRef.saveDraft"
      :render-xlsx="adminInvoiceApiRef.renderXlsx"
      :attach-pdf="adminInvoiceApiRef.attachPdf"
      @close="invoicePoId = null"
    />
  </div>
</template>

<style scoped>
/* 장시간 검토 화면 — 밀도보다 판독성 우선(AdminSmartbomCase 가독성 컨벤션과 동일 스케일). */
.pcb-readable :deep([class~='text-[11px]']) {
  font-size: 13px;
  line-height: 18px;
}

.pcb-readable :deep(.text-xs),
.pcb-readable :deep([class~='text-[12px]']) {
  font-size: 14px;
  line-height: 20px;
}

.pcb-readable :deep(.text-sm),
.pcb-readable :deep([class~='text-[13px]']) {
  font-size: 15px;
  line-height: 22px;
}
</style>
