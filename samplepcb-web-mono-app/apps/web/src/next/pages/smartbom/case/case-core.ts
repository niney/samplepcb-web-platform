import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiGet, apiGetBlob, ApiRequestError } from '@sp/shared';
import { BomQuotePrintResponse, apiRoutes } from '@sp/api-contract';
import { useAdminBomQuote } from '@/admin/useAdminBomQuotes';
import { useAdminBomRfqs } from '@/admin/useAdminBomRfqs';
import { useAdminBomPos } from '@/admin/useAdminBomPos';
import { smartbomCaseNo, smartbomStepOf } from '@/admin/smartbom';
import { NEXT_SMARTBOM_ROUTES, smartbomSectionOf, type SmartbomSection } from '@/next/smartbom-navigation';

// SmartBOM Case 상세의 바탕 상태 — 옛 pages/admin/AdminSmartbomCase.vue 스크립트의 앞부분(조회·오류·
// 진입 접힘·12단계 파생·요청 범위·견적서·원본 다운로드)을 그대로 옮겼다. 판정식·문구는 옛 화면과 같다.

/** 무관 섹션 접힘 대상 — RFQ 패널·발주 패널·품목 표(가장 큰 몸통). */
export type CaseSection = 'rfq' | 'po' | 'items';

// 역할별 메뉴 진입 컨텍스트(§6.12 개정) — ?from= 로 들어오면 무관 섹션을 한 줄 접힘으로 축소한다
// (존재 신호 + 한 클릭 복원). 진행현황·북마크(from 없음)는 전체 표시. 상세는 여전히 단일 척추.
const INITIAL_COLLAPSED: Partial<Record<SmartbomSection, CaseSection[]>> = {
  quotes: ['po'], // 견적 담당 — 품목·검토+RFQ 가 본업
  orders: ['rfq', 'items'], // 경리 — 주문 정보(요약 줄)+발주 현황만
  pos: ['rfq', 'items'], // 구매 — 발주 패널이 본업(선정가는 발주 스냅샷에 박제됨)
  logistics: ['rfq', 'items'], // 물류 — 발주 패널의 [선적 관리]가 진입점
  confirms: ['rfq', 'items'], // 부품 확인(D43) — 확인 요청 패널+발주 현황(패널은 접지 않는다)
};

export function useCaseCore() {
  const route = useRoute();
  const router = useRouter();
  const detailId = computed(() => {
    const raw = route.params.id;
    return typeof raw === 'string' && raw !== '' ? raw : null;
  });

  const detailQuery = useAdminBomQuote(detailId);
  const detail = computed(() => detailQuery.data.value?.data ?? null);
  const reviewEditable = computed(
    () => detail.value?.status === 'requested' || detail.value?.status === 'reviewing',
  );
  const detailNotFound = computed(() => {
    const reason = detailQuery.error.value;
    return reason instanceof ApiRequestError && reason.status === 404;
  });
  const detailErrorMessage = computed(() => {
    const reason = detailQuery.error.value;
    if (!(reason instanceof ApiRequestError)) {
      return '상세 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
    if (reason.status === 401) return '로그인 정보가 만료되었습니다. 다시 로그인해 주세요.';
    if (reason.status === 403) return '이 Case를 조회할 권한이 없습니다.';
    if (reason.status >= 500) {
      return 'Case 상세 조회 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
    }
    return reason.payload?.message ?? reason.message;
  });
  function retryDetail(): void {
    void detailQuery.refetch();
  }

  const caseNo = computed(() =>
    detail.value === null ? '' : smartbomCaseNo(detail.value.id, detail.value.requestedAt, detail.value.createdAt),
  );

  // 영구 삭제 — 삭제되면 이 Case 는 사라지므로 진행현황으로 돌아간다.
  const caseDeleteOpen = ref(false);
  async function onCaseDeleted(): Promise<void> {
    caseDeleteOpen.value = false;
    await router.push({ name: NEXT_SMARTBOM_ROUTES.cases });
  }

  const fromSection = smartbomSectionOf(route.query.from);
  const collapsed = ref<Set<CaseSection>>(
    new Set(fromSection === null ? [] : (INITIAL_COLLAPSED[fromSection] ?? [])),
  );
  const expandSection = (section: CaseSection): void => {
    const next = new Set(collapsed.value);
    next.delete(section);
    collapsed.value = next;
  };

  // 견적서 인쇄(§6.8) — 대화상자가 열릴 때 로더로 관리자 print 라우트를 읽는다.
  const estimateOpen = ref(false);
  // 빠른 메일(§6.15) — 머리 [메일] → 우하단 작성 창.
  const mailOpen = ref(false);
  // 보낸 메일(발송 이력) 섹션 — 조회용이라 기본 접힘.
  const mailLogOpen = ref(false);
  const loadEstimatePrint = async () => {
    const res = await apiGet(`${apiRoutes.adminBomQuotes}/${detailId.value ?? ''}/print`, BomQuotePrintResponse);
    return res.data;
  };

  // RFQ·발주 — 단계 파생과 섹션 패널이 함께 쓴다.
  const rfqQuery = useAdminBomRfqs(detailId);
  const rfqs = computed(() => rfqQuery.data.value?.data.rfqs ?? []);
  const supplierComparisonTargetCount = computed(() => rfqQuery.data.value?.data.supplierComparisonTargetCount ?? 0);
  const poQuery = useAdminBomPos(detailId);
  const pos = computed(() => poQuery.data.value?.data.pos ?? []);

  // RFQ 반영 파생 단계 — reviewing 에서 RFQ 가 있으면 ③(발송)·④(회신 도착)로 세분화(§3.3).
  const currentStep = computed(() => {
    if (detail.value === null) return 0;
    const hasOpenShortage = pos.value.some((po) =>
      po.items.some((item) => item.shortage !== null && item.shortage.recovery === null),
    );
    // 주문·발주·물류 파생이 우선(⑥~⑫) — 이후 RFQ 세분화(③④), 마지막이 상태 기반.
    const orderStep = smartbomStepOf(detail.value.status, {
      orderState: detail.value.orderState,
      isPaid: detail.value.orderInfo?.isPaid ?? false,
      poCount: pos.value.length,
      // 미복구 부족분이 있으면 원 PO가 입고됐더라도 ⑩ 검수 완료로 올리지 않는다.
      poReceivedCount: hasOpenShortage ? 0 : pos.value.filter((po) => po.shipment?.receivedAt != null).length,
      hasShipment: pos.value.some((po) => po.shipment !== null),
      odStatus: detail.value.orderInfo?.odStatus,
    });
    if (orderStep >= 6) return orderStep;
    const base = smartbomStepOf(detail.value.status);
    if (detail.value.status !== 'reviewing' || rfqs.value.length === 0) return base;
    return rfqs.value.some((r) => r.status === 'quoted') ? 4 : 3;
  });
  const orderCanceled = computed(() => detail.value?.orderState === 'canceled');

  // 12단계 줄 — 좁은 화면에서도 현재 단계가 첫 화면 밖에 숨지 않도록 진행이 바뀔 때 가운데로 맞춘다.
  const timelineScroll = ref<HTMLElement | null>(null);
  function moveTimeline(direction: -1 | 1): void {
    timelineScroll.value?.scrollBy({ left: direction * 260, behavior: 'smooth' });
  }
  watch(
    currentStep,
    (step) => {
      if (step <= 0) return;
      void nextTick(() => {
        const container = timelineScroll.value;
        const target = container?.querySelector<HTMLElement>(`[data-smartbom-step="${String(step)}"]`);
        if (container === null || target === undefined || target === null) return;
        container.scrollTo({
          left: Math.max(0, target.offsetLeft - (container.clientWidth - target.offsetWidth) / 2),
          behavior: 'smooth',
        });
      });
    },
    { immediate: true },
  );

  // 요청 부품행 범위(서버 loadRfqScopeItems 와 동일 파생) — 시트 선택 + included.
  const scopeItems = computed(() => {
    if (detail.value === null) return [];
    const sheets = detail.value.sheets;
    const selected = new Set(sheets.filter((s) => s.selected).map((s) => s.sheetIndex));
    return detail.value.items.filter(
      (item) =>
        item.included && (sheets.length === 0 || item.sourceSheetIndex === null || selected.has(item.sourceSheetIndex)),
    );
  });

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

  return {
    detailId,
    detailQuery,
    detail,
    reviewEditable,
    detailNotFound,
    detailErrorMessage,
    retryDetail,
    caseNo,
    caseDeleteOpen,
    onCaseDeleted,
    collapsed,
    expandSection,
    estimateOpen,
    mailOpen,
    mailLogOpen,
    loadEstimatePrint,
    rfqQuery,
    rfqs,
    supplierComparisonTargetCount,
    poQuery,
    pos,
    currentStep,
    orderCanceled,
    timelineScroll,
    moveTimeline,
    scopeItems,
    downloadOriginal,
  };
}

export type CaseCore = ReturnType<typeof useCaseCore>;
