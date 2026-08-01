<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiGet, apiGetBlob } from '@sp/shared';
import { BomQuotePrintResponse, apiRoutes } from '@sp/api-contract';
import type { BomQuoteItemType, BomQuoteStatusType } from '@sp/api-contract';
import type { AdminBomPoViewType, AdminBomRfqViewType, BomRfqReplyBodyType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  useAdminBomQuote,
  useAdminBomQuoteCandidates,
  usePatchAdminBomQuote,
} from '../../admin/useAdminBomQuotes';
import {
  useAdminBomRfqs,
  useAdminRfqReply,
  useReissueRfqMagicLink,
} from '../../admin/useAdminBomRfqs';
import {
  useAdminBomPos,
  useCloseBomPo,
  useCreateBomPos,
  useDeleteBomPo,
  useExecuteExternalPo,
} from '../../admin/useAdminBomPos';
import {
  SMARTBOM_STATUS_META,
  SMARTBOM_STEPS,
  smartbomCaseNo,
  smartbomFmtDate,
  smartbomFmtWon,
  smartbomStepOf,
} from '../../admin/smartbom';
import BomCandidateDrawer from '../../components/admin/bom/BomCandidateDrawer.vue';
import BomEstimateModal from '../../components/smartbom/BomEstimateModal.vue';
import BomPoCreateModal from '../../components/admin/smartbom/BomPoCreateModal.vue';
import BomPoPanel from '../../components/admin/smartbom/BomPoPanel.vue';
import BomShipmentModal from '../../components/admin/smartbom/BomShipmentModal.vue';
import BomRfqCompareModal from '../../components/admin/smartbom/BomRfqCompareModal.vue';
import BomRfqPanel from '../../components/admin/smartbom/BomRfqPanel.vue';
import BomRfqSendModal from '../../components/admin/smartbom/BomRfqSendModal.vue';
import RfqReplyForm, { type RfqReplyFormRow } from '../../components/smartbom/RfqReplyForm.vue';

// 스마트 BOM Case 상세 — 고객 견적요청 1건의 운영 화면(docs/SMARTBOM_PARTNER_RFQ.md §3.4).
// 데이터·검토 로직은 /api/admin/bom-quotes 그대로(BOM 견적요청 화면과 동일 계약).
// 협력사 RFQ 패널·발송 모달·비교 뷰는 이 화면 위에 단계적으로 확장한다(§5-4~6).

const route = useRoute();
const detailId = computed(() => {
  const raw = route.params.id;
  return typeof raw === 'string' && raw !== '' ? raw : null;
});

const detailQuery = useAdminBomQuote(detailId);
const detail = computed(() => detailQuery.data.value?.data ?? null);

// 역할별 메뉴 진입 컨텍스트(§6.12 개정) — ?from=quotes|orders|pos|logistics 로 들어오면
// 무관 섹션을 한 줄 접힘 바로 축소(존재 신호+한 클릭 복원). 접힘만으로 관련 섹션이
// 화면 상단에 오므로 별도 스크롤·강조는 두지 않는다(사용자 결정으로 제거).
// 진행현황·북마크(from 없음)는 전체 표시. 상세는 여전히 단일 척추 — 렌더만 다르다.
type CaseSection = 'rfq' | 'po' | 'items';
type CaseFrom = 'quotes' | 'orders' | 'pos' | 'logistics';
const fromParam = ((): CaseFrom | null => {
  const raw = route.query.from;
  return raw === 'quotes' || raw === 'orders' || raw === 'pos' || raw === 'logistics'
    ? raw
    : null;
})();
const INITIAL_COLLAPSED: Record<CaseFrom, CaseSection[]> = {
  quotes: ['po'], // 견적 담당 — 품목·검토+RFQ 가 본업
  orders: ['rfq', 'items'], // 경리 — 주문 정보(요약 스트립)+발주 현황만
  pos: ['rfq', 'items'], // 구매 — 발주 패널이 본업(선정가는 발주 스냅샷에 박제됨)
  logistics: ['rfq', 'items'], // 물류 — 발주 패널의 [선적 관리]가 진입점
};
const collapsed = ref<Set<CaseSection>>(
  new Set(fromParam === null ? [] : INITIAL_COLLAPSED[fromParam]),
);
const expandSection = (section: CaseSection): void => {
  const next = new Set(collapsed.value);
  next.delete(section);
  collapsed.value = next;
};

// 견적서 인쇄(§6.8) — 모달 open 시 로더 콜백으로 fetch(관리자 print 라우트).
const estimateOpen = ref(false);
const loadEstimatePrint = async () => {
  const res = await apiGet(
    `${apiRoutes.adminBomQuotes}/${detailId.value ?? ''}/print`,
    BomQuotePrintResponse,
  );
  return res.data;
};
const patch = usePatchAdminBomQuote();
const candidateItemId = ref<string | null>(null);
const candidateQuery = useAdminBomQuoteCandidates(detailId, candidateItemId);

// RFQ 반영 파생 단계 — reviewing 에서 RFQ 가 있으면 ③(발송)·④(회신 도착)로 세분화(§3.3).
const rfqQuery = useAdminBomRfqs(detailId);
const rfqs = computed(() => rfqQuery.data.value?.data.rfqs ?? []);
const poQuery = useAdminBomPos(detailId);
const pos = computed(() => poQuery.data.value?.data.pos ?? []);
const currentStep = computed(() => {
  if (detail.value === null) return 0;
  // 주문·발주·물류 파생이 우선(⑥~⑫) — 이후 RFQ 세분화(③④), 마지막이 상태 기반.
  const orderStep = smartbomStepOf(detail.value.status, {
    orderState: detail.value.orderState,
    isPaid: detail.value.orderInfo?.isPaid ?? false,
    poCount: pos.value.length,
    poReceivedCount: pos.value.filter((po) => po.shipment?.receivedAt != null).length,
    hasShipment: pos.value.some((po) => po.shipment !== null),
    odStatus: detail.value.orderInfo?.odStatus,
  });
  if (orderStep >= 6) return orderStep;
  const base = smartbomStepOf(detail.value.status);
  if (detail.value.status !== 'reviewing' || rfqs.value.length === 0) return base;
  return rfqs.value.some((r) => r.status === 'quoted') ? 4 : 3;
});

// 요청 부품행 범위(서버 loadRfqScopeItems 와 동일 파생) — 시트 선택 + included.
const scopeItems = computed(() => {
  if (detail.value === null) return [];
  const sheets = detail.value.sheets;
  const selected = new Set(sheets.filter((s) => s.selected).map((s) => s.sheetIndex));
  return detail.value.items.filter(
    (item) =>
      item.included &&
      (sheets.length === 0 || item.sourceSheetIndex === null || selected.has(item.sourceSheetIndex)),
  );
});

// RFQ 부분 행 선택(§6.13 개정) — 판단 근거(선정 오퍼·매칭)가 있는 품목 테이블에서
// 체크하고, 발송 모달은 요약·확인만 한다(편집 창구 단일). 선택 없음 = 전체 발송.
const rfqItemSelection = ref<Set<string>>(new Set());
const scopeItemIds = computed(() => new Set(scopeItems.value.map((item) => item.id)));
const rfqSelectable = (item: BomQuoteItemType): boolean => scopeItemIds.value.has(item.id);
const allRfqRowsSelected = computed(
  () => scopeItems.value.length > 0 && rfqItemSelection.value.size === scopeItems.value.length,
);

function toggleRfqRow(itemId: string): void {
  const next = new Set(rfqItemSelection.value);
  if (next.has(itemId)) next.delete(itemId);
  else next.add(itemId);
  rfqItemSelection.value = next;
}

function toggleAllRfqRows(): void {
  rfqItemSelection.value = allRfqRowsSelected.value
    ? new Set()
    : new Set(scopeItems.value.map((item) => item.id));
}

// 실무 퀵 액션 — 공급사 오퍼가 없는 행만 협력사에 문의하는 흔한 패턴.
function selectUnofferedRfqRows(): void {
  rfqItemSelection.value = new Set(
    scopeItems.value.filter((item) => item.selectedOffer === null).map((item) => item.id),
  );
}

// ── 발주(D18) — 결제 확인 후 발행, all-or-nothing ───────────────────────────
const poCreateOpen = ref(false);
const poError = ref('');
// 선적 관리(D21) — 대상 발주서를 모달로
const shipmentPo = ref<AdminBomPoViewType | null>(null);
const createPos = useCreateBomPos();
const deletePo = useDeleteBomPo();
const closePo = useCloseBomPo();
const executeExternal = useExecuteExternalPo();
const poBusy = computed(
  () =>
    createPos.isPending.value ||
    deletePo.isPending.value ||
    closePo.isPending.value ||
    executeExternal.isPending.value,
);

async function retryExternalPo(po: { poId: number; partnerName: string }): Promise<void> {
  if (detailId.value === null) return;
  poError.value = '';
  try {
    await executeExternal.mutateAsync({ quoteId: detailId.value, poId: po.poId });
  } catch (e) {
    poError.value = e instanceof ApiRequestError ? e.message : '외부 실행에 실패했습니다.';
  }
}
const canIssuePo = computed(() => detail.value?.orderInfo?.isPaid === true);
const issueDisabledReason = computed(() => {
  if (detail.value?.orderState !== 'ordered') return '고객 주문 후에 발주할 수 있습니다';
  if (detail.value.orderInfo?.isPaid !== true) return '결제 확인(입금) 후에 발주할 수 있습니다';
  return '';
});

async function removePo(po: { poId: number; partnerName: string }): Promise<void> {
  if (detailId.value === null) return;
  if (!window.confirm(`'${po.partnerName}' 발주서 발행을 취소할까요? (미확인 발주서만 가능)`)) return;
  poError.value = '';
  try {
    await deletePo.mutateAsync({ quoteId: detailId.value, poId: po.poId });
  } catch (e) {
    poError.value = e instanceof ApiRequestError ? e.message : '발행 취소에 실패했습니다.';
  }
}

async function closePoRow(po: { poId: number; partnerName: string }): Promise<void> {
  if (detailId.value === null) return;
  if (!window.confirm(`'${po.partnerName}' 발주서를 마감할까요?`)) return;
  poError.value = '';
  try {
    await closePo.mutateAsync({ quoteId: detailId.value, poId: po.poId });
  } catch (e) {
    poError.value = e instanceof ApiRequestError ? e.message : '마감에 실패했습니다.';
  }
}

// ── RFQ 발송·대리 입력·비교 선정 ────────────────────────────────────────────
const sendOpen = ref(false);
const compareOpen = ref(false);
const replyRfq = ref<AdminBomRfqViewType | null>(null);
const replyError = ref('');
const rfqReply = useAdminRfqReply();

// 매직링크 재발급(§6.9) — 확인은 패널이 담당, 여기선 호출만.
const reissueLink = useReissueRfqMagicLink();
function reissueMagicLink(rfq: AdminBomRfqViewType): void {
  if (detailId.value === null) return;
  void reissueLink.mutateAsync({ quoteId: detailId.value, rfqId: rfq.rfqId });
}

const replyRows = computed<RfqReplyFormRow[]>(() => {
  const rfq = replyRfq.value;
  if (rfq === null) return [];
  const replyByItem = new Map(rfq.items.map((item) => [item.quoteItemId, item]));
  return scopeItems.value.map((item) => {
    const reply = replyByItem.get(item.id);
    const price = reply?.unitPrice ?? null;
    return {
      quoteItemId: item.id,
      mpn: item.mpn,
      manufacturerName: item.manufacturerName,
      description: item.description,
      orderQty: item.orderQty,
      reply:
        reply === undefined || price === null
          ? null
          : {
              unitPrice: price,
              replyQty: reply.replyQty,
              moq: reply.moq,
              stock: reply.stock,
              dateCode: reply.dateCode,
              leadTime: reply.leadTime,
              memo: reply.memo,
            },
    };
  });
});

async function submitReply(body: BomRfqReplyBodyType): Promise<void> {
  if (detailId.value === null || replyRfq.value === null) return;
  replyError.value = '';
  try {
    await rfqReply.mutateAsync({ quoteId: detailId.value, rfqId: replyRfq.value.rfqId, body });
    replyRfq.value = null;
  } catch (e) {
    replyError.value = e instanceof ApiRequestError ? e.message : '저장에 실패했습니다.';
  }
}

// 검토 폼(상세 로드 시 프리필) — BOM 견적요청 화면과 동일 로직.
const form = ref({
  adminMemo: '',
  answerNote: '',
  confirmedShippingFee: null as number | null,
  confirmedManagementFee: null as number | null,
  confirmedTotal: null as number | null,
});
const actionError = ref('');

// 확정가 = 토글식 직접 입력 — 기본은 예상(자동) 금액만 보여 관리자 혼동을 막는다.
// 토글 OFF 저장 = 확정 해제(고객에게 예상 금액 안내), ON 시 예상값으로 프리필.
const confirmedOverride = ref(false);

watch(detail, (d) => {
  if (d === null) return;
  form.value = {
    adminMemo: d.adminMemo ?? '',
    answerNote: d.answerNote ?? '',
    confirmedShippingFee: d.confirmedShippingFee,
    confirmedManagementFee: d.confirmedManagementFee,
    confirmedTotal: d.confirmedTotal,
  };
  confirmedOverride.value =
    d.confirmedShippingFee !== null || d.confirmedManagementFee !== null || d.confirmedTotal !== null;
  actionError.value = '';
});

function toggleConfirmedOverride(): void {
  confirmedOverride.value = !confirmedOverride.value;
  const d = detail.value;
  if (!confirmedOverride.value || d === null) return;
  // 켜는 순간 예상값(운송료·관리비 기본값 + 선정 반영 총액)으로 제안 프리필 — 기존 확정값은 유지.
  form.value.confirmedShippingFee ??= d.shippingFee;
  form.value.confirmedManagementFee ??= d.managementFee;
  form.value.confirmedTotal ??= d.finalTotal;
}

// v-model.number 는 빈 입력을 '' 로 만들 수 있어 저장 직전 정규화한다.
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;

// 부가세는 저장·계산하지 않는 정책(전 금액 VAT 별도) — 참고 환산 표시만 한다.
const withVat = (v: number | null): string =>
  v === null ? '—' : `${Math.round(v * 1.1).toLocaleString('ko-KR')}원`;
const confirmedTotalVat = computed(() => withVat(numOrNull(form.value.confirmedTotal)));

function itemRows(item: BomQuoteItemType): number[] {
  const value = item.sourceRow?.sourceRows;
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is number => typeof row === 'number' && Number.isInteger(row) && row > 0);
}

function itemLocation(item: BomQuoteItemType): string {
  const rows = itemRows(item);
  if (item.sourceSheetName === null) return '수동 추가';
  return rows.length === 0 ? item.sourceSheetName : `${item.sourceSheetName} · ${rows.join(', ')}행`;
}

function itemLabel(item: BomQuoteItemType): string {
  if (item.mpn.trim() !== '') return item.mpn;
  const raw = item.sourceRow?.valueRaw;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : '품번 미기재';
}

async function saveReview(nextStatus?: BomQuoteStatusType): Promise<void> {
  if (detailId.value === null) return;
  // 확정가 없이 회신하면 고객 [주문하기](D16-1 게이트)가 열리지 않는다 — 실수 방지 확인.
  if (nextStatus === 'answered') {
    const total = confirmedOverride.value ? numOrNull(form.value.confirmedTotal) : null;
    if (
      total === null &&
      !window.confirm(
        '확정 총액 없이 회신을 완료하면 고객이 [주문하기]를 사용할 수 없습니다.\n확정가 없이 회신할까요?',
      )
    ) {
      return;
    }
  }
  actionError.value = '';
  try {
    await patch.mutateAsync({
      quoteId: detailId.value,
      body: {
        ...(nextStatus !== undefined ? { status: nextStatus } : {}),
        adminMemo: form.value.adminMemo === '' ? null : form.value.adminMemo,
        answerNote: form.value.answerNote === '' ? null : form.value.answerNote,
        // 토글 OFF = 확정 해제(null) — 고객에게는 예상 금액으로 안내된다.
        confirmedShippingFee: confirmedOverride.value ? numOrNull(form.value.confirmedShippingFee) : null,
        confirmedManagementFee: confirmedOverride.value ? numOrNull(form.value.confirmedManagementFee) : null,
        confirmedTotal: confirmedOverride.value ? numOrNull(form.value.confirmedTotal) : null,
      },
    });
  } catch {
    actionError.value = '저장에 실패했습니다 — 상태 전이 가능 여부를 확인하세요.';
  }
}

async function downloadOriginal(): Promise<void> {
  const fileUrl = detail.value?.fileUrl ?? null;
  if (fileUrl === null) return;
  const blob = await apiGetBlob(fileUrl);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = detail.value?.fileName ?? 'bom.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="space-y-4">
    <!-- 헤더 -->
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink
        :to="{ name: 'admin-smartbom' }"
        class="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      >
        ← 진행현황
      </RouterLink>
      <template v-if="detail !== null">
        <span class="font-mono text-xs text-gray-500">
          {{ smartbomCaseNo(detail.id, detail.requestedAt, detail.createdAt) }}
        </span>
        <h1 class="text-xl font-bold">{{ detail.title }}</h1>
        <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="SMARTBOM_STATUS_META[detail.status].cls">
          {{ SMARTBOM_STATUS_META[detail.status].label }}
        </span>
        <!-- 견적서(§6.8) — 확정 전이면 시트가 "가안" 표기 -->
        <button
          type="button"
          class="ml-auto rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100"
          @click="estimateOpen = true"
        >
          🧾 견적서
        </button>
      </template>
    </div>

    <BomEstimateModal
      v-if="detailId !== null"
      :open="estimateOpen"
      :load="loadEstimatePrint"
      @close="estimateOpen = false"
    />

    <p v-if="detailQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
    <p v-else-if="detail === null" class="text-sm text-gray-400">Case 를 찾을 수 없습니다.</p>

    <template v-else>
      <!-- 12단계 파생 타임라인 -->
      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface px-4 py-3">
        <ol class="flex min-w-max items-center gap-1">
          <li v-for="(step, idx) in SMARTBOM_STEPS" :key="step" class="flex items-center gap-1">
            <div class="flex flex-col items-center gap-1">
              <span
                class="grid size-5 place-items-center rounded-full text-[10px] font-bold"
                :class="idx + 1 === currentStep
                  ? 'bg-blue-600 text-white'
                  : idx + 1 < currentStep
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-400'"
              >
                {{ idx + 1 }}
              </span>
              <span
                class="whitespace-nowrap text-[10px]"
                :class="idx + 1 === currentStep ? 'font-bold text-blue-700' : idx + 1 < currentStep ? 'text-gray-600' : 'text-gray-400'"
              >
                {{ step }}
              </span>
            </div>
            <span
              v-if="idx < SMARTBOM_STEPS.length - 1"
              class="mb-4 h-px w-4"
              :class="idx + 1 < currentStep ? 'bg-blue-300' : 'bg-gray-200'"
            />
          </li>
        </ol>
      </div>

      <!-- 요약 스트립 -->
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span class="text-gray-600">고객 <b>{{ detail.mbId }}</b></span>
        <span class="text-gray-600">세트 {{ detail.setQty }} · 예비 {{ detail.spareQty }}</span>
        <span class="text-gray-600">부품 합계 <b class="tabular-nums">{{ smartbomFmtWon(detail.itemsTotal) }}</b></span>
        <span class="text-gray-600">
          예상 합계 <b class="tabular-nums">{{ smartbomFmtWon(detail.finalTotal) }}</b>
          <span class="text-xs text-gray-400">
            (운송료 {{ smartbomFmtWon(detail.shippingFee) }} · 관리비 {{ smartbomFmtWon(detail.managementFee) }} · VAT 별도)
          </span>
        </span>
        <span v-if="detail.uncostedCount > 0" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
          미산정 {{ detail.uncostedCount }}건
        </span>
        <span class="text-xs text-gray-400">요청 {{ smartbomFmtDate(detail.requestedAt) }}</span>
        <!-- 주문·결제 파생(D16) — ct/od 조인, 저장 아님 -->
        <span
          v-if="detail.orderInfo !== null"
          class="rounded px-1.5 py-0.5 text-xs font-semibold"
          :class="detail.orderInfo.isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'"
        >
          주문 {{ detail.orderInfo.odId }} · {{ detail.orderInfo.odStatus }}
          <template v-if="detail.orderInfo.isPaid"> · 수납 {{ smartbomFmtWon(detail.orderInfo.receiptPrice) }}</template>
        </span>
        <span v-else-if="detail.orderState === 'cart'" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
          고객 장바구니 담김
        </span>
        <button
          v-if="detail.fileUrl !== null"
          type="button"
          class="text-xs text-blue-600 hover:underline"
          @click="downloadOriginal"
        >
          원본 BOM 다운로드
        </button>
      </div>
      <p v-if="detail.customerMemo" class="rounded bg-surface-sunken p-2 text-xs text-gray-600">
        고객 메모: {{ detail.customerMemo }}
      </p>

      <!-- 협력사 RFQ 현황 — 무관 파트 진입 시 한 줄 접힘(§6.12) -->
      <button
        v-if="collapsed.has('rfq')"
        type="button"
        class="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-surface px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
        @click="expandSection('rfq')"
      >
        <span>▸ 협력사 RFQ ({{ rfqs.length }}건)</span>
        <span class="text-xs text-gray-400">펼치기</span>
      </button>
      <BomRfqPanel
        v-else
        :rfqs="rfqs"
        :loading="rfqQuery.isLoading.value"
        :can-send="detail.status === 'requested' || detail.status === 'reviewing'"
        :busy="reissueLink.isPending.value"
        @send="sendOpen = true"
        @compare="compareOpen = true"
        @reply="(rfq) => { replyRfq = rfq; replyError = ''; }"
        @reissue-link="reissueMagicLink"
      />

      <!-- 협력사 발주(D18) — 결제 확인 후 -->
      <button
        v-if="collapsed.has('po')"
        type="button"
        class="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-surface px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
        @click="expandSection('po')"
      >
        <span>▸ 협력사 발주 ({{ pos.length }}건)</span>
        <span class="text-xs text-gray-400">펼치기</span>
      </button>
      <BomPoPanel
        v-else
        :pos="pos"
        :loading="poQuery.isLoading.value"
        :can-issue="canIssuePo"
        :issue-disabled-reason="issueDisabledReason"
        :busy="poBusy"
        @create="poCreateOpen = true; poError = '';"
        @remove="removePo"
        @close="closePoRow"
        @external="retryExternalPo"
        @shipment="(po) => { shipmentPo = po; }"
      />
      <p v-if="poError !== ''" class="text-xs font-semibold text-red-600">{{ poError }}</p>

      <!-- 품목 표+검토 — 견적 담당 외 진입에선 접힘(가장 큰 몸통, §6.12) -->
      <button
        v-if="collapsed.has('items')"
        type="button"
        class="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-surface px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
        @click="expandSection('items')"
      >
        <span>▸ 품목·검토 ({{ detail.items.length }}행)</span>
        <span class="text-xs text-gray-400">펼치기</span>
      </button>
      <div v-else class="grid gap-4 xl:grid-cols-[1fr_340px]">
        <!-- 품목 -->
        <div class="overflow-hidden rounded-xl border border-gray-200 bg-surface">
          <!-- RFQ 행 선택 툴바(§6.13) — 체크는 이 표에서, 발송 모달은 확인만.
               min-h 로 배지("n행 선택됨") 등장 시 높이 점프 방지(사용자 피드백) -->
          <div class="flex min-h-9 flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50/60 px-3 py-1 text-[11px] text-gray-500">
            <span>협력사 견적요청(RFQ) 행 선택 — 선택 없으면 전체 {{ scopeItems.length }}행 발송</span>
            <span v-if="rfqItemSelection.size > 0" class="rounded bg-blue-100 px-1.5 py-0.5 font-bold text-blue-700">
              {{ rfqItemSelection.size }}행 선택됨
            </span>
            <span class="ml-auto flex gap-2">
              <button type="button" class="text-blue-600 hover:underline" @click="selectUnofferedRfqRows">
                오퍼 없음 행만 선택
              </button>
              <button
                v-if="rfqItemSelection.size > 0"
                type="button"
                class="text-gray-500 hover:underline"
                @click="rfqItemSelection = new Set()"
              >
                선택 해제
              </button>
            </span>
          </div>
          <table class="min-w-full divide-y divide-gray-100 text-xs">
            <thead class="bg-gray-50 text-left text-gray-500">
              <tr>
                <th class="px-2 py-2">
                  <input
                    type="checkbox"
                    class="size-3.5 align-middle"
                    title="견적요청 행 전체 선택/해제"
                    :checked="allRfqRowsSelected"
                    @change="toggleAllRfqRows"
                  >
                </th>
                <th class="px-3 py-2">Excel 위치</th>
                <th class="px-3 py-2">부품</th>
                <th class="px-3 py-2">선정 오퍼</th>
                <th class="px-3 py-2 text-right">주문수량</th>
                <th class="px-3 py-2 text-right">합계</th>
                <th class="px-3 py-2" />
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr v-for="item in detail.items" :key="item.id" :class="{ 'opacity-40': !item.included }">
                <td class="px-2 py-2">
                  <input
                    v-if="rfqSelectable(item)"
                    type="checkbox"
                    class="size-3.5 align-middle"
                    :checked="rfqItemSelection.has(item.id)"
                    @change="toggleRfqRow(item.id)"
                  >
                </td>
                <td class="whitespace-nowrap px-3 py-2 text-gray-500">{{ itemLocation(item) }}</td>
                <td class="px-3 py-2">
                  <div class="font-medium">{{ itemLabel(item) }}</div>
                  <div class="text-gray-400">{{ item.manufacturerName }}</div>
                </td>
                <td class="px-3 py-2">
                  <template v-if="item.selectedOffer !== null">
                    {{ item.selectedOffer.supplier }} · {{ item.selectedOffer.unitPrice }} {{ item.selectedOffer.currency }} @{{ item.selectedOffer.breakQty }}+
                  </template>
                  <span v-else class="text-amber-600">{{ item.matchStatus === 'none' ? '미매칭' : '오퍼 없음' }}</span>
                </td>
                <td class="px-3 py-2 text-right tabular-nums">{{ item.orderQty.toLocaleString('ko-KR') }}</td>
                <td class="px-3 py-2 text-right tabular-nums">
                  {{ item.lineTotalKrw === null ? '—' : smartbomFmtWon(Math.round(item.lineTotalKrw)) }}
                </td>
                <td class="px-3 py-2 text-right">
                  <button
                    type="button"
                    class="rounded border border-blue-200 px-2 py-1 font-semibold text-blue-700 hover:bg-blue-50"
                    @click="candidateItemId = item.id"
                  >
                    후보·근거
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 검토 폼 -->
        <div class="h-fit space-y-3 rounded-xl border border-gray-200 bg-surface p-4 text-sm">
          <p class="text-xs font-bold text-gray-700">검토·고객 회신</p>
          <!-- 비용 — 기본은 예상(자동: 부품 합계 + 설정 기본 운송료·관리비) 읽기 전용 표시.
               확정가는 토글을 켠 경우에만 입력(D9 수동 확정 — 관리자 혼동 방지 UX) -->
          <div class="space-y-0.5 rounded bg-surface-sunken px-2.5 py-2 text-xs text-gray-600">
            <div class="flex justify-between"><span>부품 합계(선정 반영)</span><b class="tabular-nums">{{ smartbomFmtWon(detail.itemsTotal) }}</b></div>
            <div class="flex justify-between"><span>운송료(설정 기본값)</span><span class="tabular-nums">{{ smartbomFmtWon(detail.shippingFee) }}</span></div>
            <div class="flex justify-between"><span>관리비(설정 기본값)</span><span class="tabular-nums">{{ smartbomFmtWon(detail.managementFee) }}</span></div>
            <div class="flex justify-between border-t border-gray-200 pt-1"><span>예상 총액(VAT 별도)</span><b class="tabular-nums">{{ smartbomFmtWon(detail.finalTotal) }}</b></div>
            <div class="flex justify-between text-gray-400"><span>참고: VAT 포함 시</span><span class="tabular-nums">{{ withVat(detail.finalTotal) }}</span></div>
          </div>

          <!-- 확정가 = 고객 주문 게이트(D16-1). "선택적 커스텀"이 아니라 필수 단계임이
               보이도록, 미등록 상태를 경고 톤으로 상시 표시한다(사용자 피드백 반영) -->
          <label class="flex cursor-pointer items-center gap-2 text-xs font-bold text-gray-800">
            <input type="checkbox" class="size-3.5" :checked="confirmedOverride" @change="toggleConfirmedOverride">
            확정가 등록
            <span class="font-medium text-amber-700">— 등록해야 고객 [주문하기]가 열립니다</span>
          </label>
          <p v-if="!confirmedOverride" class="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-[16px] text-amber-800">
            ⚠ 확정가 미등록 — 고객은 예상 금액만 볼 수 있고 주문(결제)할 수 없습니다.
            체크 후 확정 총액을 저장하세요. 끈 채 저장하면 기존 확정가도 해제됩니다.
          </p>
          <template v-else>
            <div class="grid grid-cols-2 gap-2">
              <label class="text-xs text-gray-500">확정 운송료
                <input v-model.number="form.confirmedShippingFee" type="number" min="0" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-right tabular-nums">
              </label>
              <label class="text-xs text-gray-500">확정 관리비
                <input v-model.number="form.confirmedManagementFee" type="number" min="0" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-right tabular-nums">
              </label>
            </div>
            <label class="block text-xs text-gray-500">확정 총액(VAT 별도)
              <input v-model.number="form.confirmedTotal" type="number" min="0" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-right tabular-nums">
            </label>
            <p class="text-[11px] text-gray-400">
              참고: VAT 포함 시 {{ confirmedTotalVat }} — 부가세는 저장하지 않습니다(전 금액 VAT 별도).
              저장하면 고객에게 확정 금액이 안내되고 [주문하기]가 열립니다.
            </p>
          </template>
          <label class="block text-xs text-gray-500">고객 회신 메모(고객에게 표시)
            <textarea v-model="form.answerNote" rows="3" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1" />
          </label>
          <label class="block text-xs text-gray-500">내부 메모(고객 미노출)
            <textarea v-model="form.adminMemo" rows="2" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1" />
          </label>
          <div class="flex flex-wrap gap-2 border-t border-gray-100 pt-2">
            <button
              type="button"
              class="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50"
              :disabled="patch.isPending.value"
              @click="saveReview()"
            >
              저장
            </button>
            <button
              v-if="detail.status === 'requested'"
              type="button"
              class="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
              :disabled="patch.isPending.value"
              @click="saveReview('reviewing')"
            >
              검토 시작
            </button>
            <button
              v-if="detail.status === 'requested' || detail.status === 'reviewing'"
              type="button"
              class="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              :disabled="patch.isPending.value"
              @click="saveReview('answered')"
            >
              회신 완료
            </button>
            <button
              v-if="detail.status === 'answered' || detail.status === 'reviewing'"
              type="button"
              class="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50"
              :disabled="patch.isPending.value"
              @click="saveReview('closed')"
            >
              종료
            </button>
          </div>
          <p v-if="actionError !== ''" class="text-xs text-red-600">{{ actionError }}</p>
        </div>
      </div>
    </template>

    <BomCandidateDrawer
      :open="candidateItemId !== null"
      :context="candidateQuery.data.value?.data ?? null"
      :loading="candidateQuery.isLoading.value"
      :failed="candidateQuery.isError.value"
      read-only
      @close="candidateItemId = null"
    />

    <BomRfqSendModal
      v-if="detail !== null && detailId !== null"
      :open="sendOpen"
      :quote-id="detailId"
      :scope-items="scopeItems"
      :selected-item-ids="[...rfqItemSelection]"
      :rfqs="rfqs"
      @close="sendOpen = false"
      @sent="rfqItemSelection = new Set()"
    />

    <BomRfqCompareModal
      v-if="detail !== null && detailId !== null"
      :open="compareOpen"
      :quote-id="detailId"
      :rfqs="rfqs"
      :scope-items="scopeItems"
      @close="compareOpen = false"
    />

    <BomPoCreateModal
      v-if="detail !== null && detailId !== null"
      :open="poCreateOpen"
      :quote-id="detailId"
      :scope-items="scopeItems"
      :rfqs="rfqs"
      :existing-pos="pos"
      @close="poCreateOpen = false"
    />

    <BomShipmentModal
      v-if="detailId !== null"
      :open="shipmentPo !== null"
      :quote-id="detailId"
      :po="pos.find((entry) => entry.poId === shipmentPo?.poId) ?? shipmentPo"
      @close="shipmentPo = null"
    />

    <!-- 대리 입력(회신 보기·수정) 모달 — 포털 회신과 같은 폼·저장 경로 -->
    <div
      v-if="replyRfq !== null"
      class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4"
      @click.self="replyRfq = null"
    >
      <div class="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-surface p-6 shadow-2xl">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold">
            {{ replyRfq.partnerName }} — 회신 {{ replyRfq.status === 'quoted' ? '수정' : '대리 입력' }}
          </h2>
          <button type="button" class="text-gray-400 hover:text-gray-700" @click="replyRfq = null">✕</button>
        </div>
        <p class="mt-1 text-xs text-gray-500">
          전화·메일로 받은 회신을 기록합니다 — 협력사 포털 회신과 같은 저장 경로(source=manual)입니다.
        </p>
        <div class="mt-4">
          <RfqReplyForm
            :rows="replyRows"
            :currency="replyRfq.currency"
            :delivery-date="replyRfq.deliveryDate"
            :memo="replyRfq.memo"
            :busy="rfqReply.isPending.value"
            @submit="submitReply"
          />
        </div>
        <p v-if="replyError !== ''" class="mt-2 text-xs font-semibold text-red-600">{{ replyError }}</p>
      </div>
    </div>
  </div>
</template>
