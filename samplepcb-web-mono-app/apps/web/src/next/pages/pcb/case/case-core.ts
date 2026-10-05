import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import {
  resolvePcbDirectShipCountry,
  resolvePcbPoTrack,
  type AdminPcbPoViewType,
  type AdminPcbRfqViewType,
  type AdminPcbShipmentViewType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import { useAdminQuoteDetail } from '@/admin/useAdminQuotes';
import { useAdminPcbRfqs } from '@/admin/useAdminPcbRfqs';
import { useAdminPcbPos } from '@/admin/useAdminPcbPos';
import { useConfirmPcbOrderReceipt, usePcbCompleteCustomerOrder } from '@/admin/useAdminPcbOrders';
import { emptyMailLogFilters, useAdminMailLogList } from '@/admin/useAdminMailLogs';
import { pcbSpecEntries } from '@/lib/pcb-spec';
import { confirmDialog } from '@/next/lib/dialog';
import { NEXT_PCB_ROUTES, safePcbReturnTo } from '@/next/pcb-navigation';

// PCB Case 상세의 바탕 상태 — 옛 pages/admin/AdminPcbCase.vue 스크립트의 앞부분(조회·게이트·
// 접힘·견적서 발송 상태·주문 수금·두 축 불일치)을 그대로 옮겼다. 조작별 상태는 case-rfq·case-po·
// case-shipment 가 이 값을 받아 더한다. 판정식·문구는 옛 화면과 같게 둔다(의미 변경 금지).

/** 무관 섹션 접힘 대상 — 표가 가장 큰 RFQ 패널과 발주·EQ 패널 둘. */
export type CaseSection = 'rfq' | 'po';

/** 견적서 발송 상태의 뜻 — 색은 화면이 토큰으로 고른다. */
export type EstimateSendTone = 'warning' | 'success' | 'danger';

const CANCELED_ORDER_ITEM_STATUSES = new Set(['취소', '반품', '품절', '삭제']);

/** YYYY-MM-DD 달력 날짜 덧셈 — 시각/브라우저 타임존을 끼우지 않아 KST 날짜가 밀리지 않는다. */
export const addDateOnlyDays = (value: string, days: number): string => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const dateOnly = (iso: string | null): string => fmtKstDate(iso);

/** 환산 시점 꼬리표 — 같은 외화 금액이 한 화면에 서로 다른 KRW 로 두 번 뜬다(선정 시점·발주 시점
 *  박제가 다르기 때문). 그 말이 없으면 "어느 게 맞느냐"가 매번 질문이 된다(재점검 08-11 #16). */
export const rateNote = (
  currency: string,
  krwAmount: number | null,
  exchangeRate: number | null,
  when: string,
): string =>
  currency !== 'KRW' && krwAmount !== null && exchangeRate !== null
    ? ` @${String(exchangeRate)} ${when}`
    : '';

export function useCaseCore() {
  const route = useRoute();
  const router = useRouter();
  const specId = computed(() => {
    const raw = Number(route.params.id);
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  });

  // 진입 워크큐 복귀 링크 — ?from= 일반화. returnTo 는 우리 워크큐 경로만 받는다.
  const BACK_TARGETS: Record<string, { name: string; label: string }> = {
    cases: { name: NEXT_PCB_ROUTES.cases, label: 'PCB 진행현황' },
    rfqs: { name: NEXT_PCB_ROUTES.rfqs, label: 'PCB 견적요청' },
    orders: { name: NEXT_PCB_ROUTES.orders, label: 'PCB 주문·결제' },
    pos: { name: NEXT_PCB_ROUTES.pos, label: 'PCB 발주·EQ' },
    remittances: { name: NEXT_PCB_ROUTES.remittances, label: 'PCB 송금' },
    shipments: { name: NEXT_PCB_ROUTES.shipments, label: 'PCB 선적·배송' },
  };
  const backTarget = computed<{ name: string; label: string; to: RouteLocationRaw }>(() => {
    const fallback =
      BACK_TARGETS[String(route.query.from ?? '')] ?? { name: 'admin-quotes', label: '견적 관리' };
    const returnTo = safePcbReturnTo(route.query.returnTo);
    return { ...fallback, to: returnTo ?? { name: fallback.name } };
  });

  // 역할별 진입 컨텍스트(§6.12 미러) — 무관 섹션은 한 줄 접힘으로 줄인다(존재 신호 + 한 클릭 복원).
  // 완전히 숨기지 않는 이유: 인접 단계 참조가 잦고, 같은 URL 이 경로에 따라 달라 보이면 버그로 오인된다.
  // 제작 사양은 발주·선적 때 확인이 잦아 접지 않는다. from 없음(진행현황·북마크)=전체 표시.
  const INITIAL_COLLAPSED: Record<string, CaseSection[]> = {
    rfqs: ['po'],
    orders: ['rfq'],
    pos: ['rfq'],
    shipments: ['rfq'],
  };
  const collapsed = ref<Set<CaseSection>>(new Set(INITIAL_COLLAPSED[String(route.query.from ?? '')] ?? []));
  const expandSection = (section: CaseSection): void => {
    const next = new Set(collapsed.value);
    next.delete(section);
    collapsed.value = next;
  };
  const rfqSectionEl = ref<HTMLElement | null>(null);
  const poSelectionGuide = ref('');

  const detailQuery = useAdminQuoteDetail(specId);
  const detail = computed(() => detailQuery.data.value?.data ?? null);
  const rfqsQuery = useAdminPcbRfqs(specId);
  const allRows = computed(() => rfqsQuery.data.value?.data.rfqs ?? []);
  const adminRows = computed(() => allRows.value.filter((r) => r.parentPartnerId === 0));
  const childrenOf = (partnerId: number): AdminPcbRfqViewType[] =>
    allRows.value.filter((r) => r.parentPartnerId === partnerId);
  const selectedRow = computed(() => adminRows.value.find((r) => r.status === 'selected') ?? null);

  const posQuery = useAdminPcbPos(specId);
  const allPos = computed(() => posQuery.data.value?.data.pos ?? []);
  const adminPos = computed(() => allPos.value.filter((p) => p.parentPartnerId === 0));
  const shipments = computed(() => posQuery.data.value?.data.shipments ?? []);
  const shipmentByPo = computed(() => {
    const map = new Map<number, AdminPcbShipmentViewType>();
    for (const s of shipments.value) for (const pid of s.poIds) map.set(pid, s);
    return map;
  });

  // 회차(A/S 재발주) — 회차가 쌓이면 "지나간 발주"와 "지금 발주"가 한 표에서 구분되지 않는다.
  // 최신 회차만 펼치고 이전 회차는 접힘 줄로 내린다(RFQ·발주 두 표가 같은 상태를 쓴다).
  const latestRound = computed(() =>
    Math.max(0, ...adminRows.value.map((r) => r.reorderRound), ...adminPos.value.map((p) => p.reorderRound)),
  );
  const latestRoundRfqs = computed(() => adminRows.value.filter((row) => row.reorderRound === latestRound.value));
  const selectedPoRfq = computed(() => latestRoundRfqs.value.find((row) => row.status === 'selected') ?? null);
  const roundsExpanded = ref(false);
  const inLatestRound = (row: { reorderRound: number }): boolean =>
    roundsExpanded.value || row.reorderRound === latestRound.value;
  const olderRoundCount = computed(
    () =>
      adminRows.value.filter((r) => r.reorderRound !== latestRound.value).length +
      adminPos.value.filter((p) => p.reorderRound !== latestRound.value).length,
  );
  // 헤더 "N건"은 전 회차 합산이라 접힘 중엔 표에 보이는 수와 달라 오해를 산다 — 현재 회차 수를 병기한다.
  const latestPoCount = computed(() => adminPos.value.filter((p) => p.reorderRound === latestRound.value).length);
  const olderRoundsCollapsed = computed(() => olderRoundCount.value > 0 && !roundsExpanded.value);
  // 상위 발주 행 밑의 하위 서브행은 **같은 회차**의 하위만(여정 7호 결함 ② — 서버 childCount 와 같은 규칙).
  const childPosOf = (row: AdminPcbPoViewType): AdminPcbPoViewType[] =>
    allPos.value.filter((p) => p.parentPartnerId === row.partnerId && p.reorderRound === row.reorderRound);

  const actionError = ref('');
  const surfaceError = (e: unknown, fallback: string): void => {
    actionError.value = e instanceof ApiRequestError && e.message !== '' ? e.message : fallback;
  };

  // ── 견적서(A4 보기·인쇄·발송) — 견적 관리 드로어와 같은 대화상자(창구만 둘) ──────────────
  const estimateProjectId = ref<number | null>(null);
  // 견적서를 보냈는가 — 발송 원장(sp_mail_log)을 kind/channel 로 좁혀 최신 1건만 본다. 아래 '보낸 메일'
  // 섹션과 같은 원장이라 두 표시가 어긋날 수 없다. 알림톡은 게이트가 따로라 이메일 축으로만 판정한다.
  // refId '0' 은 specId 미확정 구간에 전역 최신 1건이 딸려오는 것을 막는다(빈 문자열은 '전체'로 읽힌다).
  const estimateMailFilters = computed(() =>
    emptyMailLogFilters({
      refType: 'pcb_spec',
      refId: String(specId.value ?? 0),
      kind: 'estimate',
      channel: 'email',
      pageSize: 1,
    }),
  );
  const estimateMailQuery = useAdminMailLogList(estimateMailFilters);
  const lastEstimateMail = computed(() => estimateMailQuery.data.value?.data.items[0] ?? null);
  const estimateSent = computed(() => lastEstimateMail.value?.status === 'sent');
  // ② 칸의 한 줄 — 미발송을 흐리게 흘리지 않는다(확정만 하고 끝내는 것이 이 트랙의 실제 실수다).
  const estimateSendState = computed<{ label: string; tone: EstimateSendTone; title: string }>(() => {
    const m = lastEstimateMail.value;
    if (m === null) return { label: '미발송', tone: 'warning', title: '아직 고객에게 견적서를 보내지 않았습니다.' };
    const when = fmtKstDate(m.createdAt);
    if (m.status === 'sent') return { label: `${when} 발송함`, tone: 'success', title: `${m.recipient} 로 발송했습니다.` };
    if (m.status === 'failed')
      return {
        label: '발송 실패',
        tone: 'danger',
        title: `${when} 발송 실패(${m.reason ?? '사유 미상'}) — 다시 보내세요.`,
      };
    // skipped = 보내려 했으나 채널이 꺼졌거나 수신처가 없었다.
    return {
      label: '미발송(건너뜀)',
      tone: 'warning',
      title: `${when} 발송 건너뜀(${m.reason ?? '사유 미상'}) — 설정·수신처를 확인하세요.`,
    };
  });
  // 발행 가능 = 활성 ∧ 가격 확정. 버튼은 감추지 않는다(조건부로 숨기면 기능이 있다는 사실이 안 보인다)
  // — 대신 비활성 + 사유 툴팁.
  const estimateEnabled = computed<boolean>(() => {
    const d = detail.value;
    return d !== null && d.status === 'active' && d.price !== null;
  });
  const estimateBlockedReason = computed<string>(() => {
    const d = detail.value;
    if (d === null) return '';
    if (d.status !== 'active') return '보관된 견적은 견적서를 발행할 수 없습니다.';
    if (d.price === null) return '가격 확정 후 견적서를 발행할 수 있습니다.';
    return '견적서를 보고 인쇄·발송합니다.';
  });

  // 영구 삭제 — 삭제되면 이 Case 는 사라지므로 진입 워크큐로 되돌린다.
  const deleteOpen = ref(false);
  async function onDeleted(): Promise<void> {
    deleteOpen.value = false;
    await router.push(backTarget.value.to);
  }
  // 보낸 메일(발송 이력) — 조회용이라 기본 접힘.
  const mailLogOpen = ref(false);

  // ── 스펙 표시 — 명칭·순서·선택지는 거버 앱이 정본(lib/pcb-spec.ts) ──────────────────────
  const specEntries = computed(() => {
    const spec = (detail.value?.spec ?? {}) as Record<string, unknown>;
    return pcbSpecEntries(spec, {
      category: detail.value?.category,
      orderCategory: detail.value?.orderCategory,
      kindPcb: typeof spec.kindPcb === 'string' ? spec.kindPcb : null,
    });
  });
  const gerberFiles = computed(() => (detail.value?.files ?? []).filter((f) => f.fileType !== 'thumbnail'));
  /** 주문 줄의 세액·포인트·환불 — 실측상 대부분 0이라 접어 두고 필요할 때 편다. */
  const orderDetailOpen = ref(false);

  // ── 제작 사양 곁판 — 늘 보는 것이 아니라 확인하는 것이라 우측으로 뺀다. 고정하면 본문이
  //    자리를 내주고, 그 상태는 브라우저에 기억된다. ─────────────────────────────────────
  const SPEC_PIN_KEY = 'sp-admin-pcb-spec-pin';
  const specPanelOpen = ref(false);
  const specPanelPinned = ref(false);
  const writePin = (pinned: boolean): void => {
    try {
      localStorage.setItem(SPEC_PIN_KEY, pinned ? '1' : '0');
    } catch {
      // 저장 불가 환경 — 고정은 이 화면에서만 유지된다.
    }
  };
  onMounted(() => {
    try {
      specPanelPinned.value = localStorage.getItem(SPEC_PIN_KEY) === '1';
    } catch {
      specPanelPinned.value = false;
    }
    if (specPanelPinned.value) specPanelOpen.value = true;
  });
  const toggleSpecPin = (): void => {
    specPanelPinned.value = !specPanelPinned.value;
    writePin(specPanelPinned.value);
    if (specPanelPinned.value) specPanelOpen.value = true;
  };
  /** ✕ 는 고정도 함께 푼다 — 닫아 놓고 다음에 열렸다 놀라지 않게. */
  const closeSpecPanel = (): void => {
    specPanelPinned.value = false;
    writePin(false);
    specPanelOpen.value = false;
  };
  /** Esc 로 닫는다 — 고정은 사용자가 건 잠금이라 풀지 않는다. */
  const onSpecPanelKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !specPanelPinned.value) specPanelOpen.value = false;
  };
  onMounted(() => {
    window.addEventListener('keydown', onSpecPanelKey);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onSpecPanelKey);
  });

  /** 공정 트랙 — 메탈마스크는 EQ 왕복 대신 고객문의사항+좌표파일. 판정 사전은 계약 하나뿐. */
  const isStencilCase = computed(() => resolvePcbPoTrack(detail.value?.category) === 'stencil');

  /** 본문 한 줄에 세우는 값 — 크기·층수·두께·재질·수량(스텐실은 축이 다르다). */
  const specHeadline = computed<{ label: string; value: string; unit?: string }[]>(() => {
    const d = detail.value;
    if (d === null) return [];
    const s = d.spec as Record<string, unknown>;
    const txt = (k: string): string => {
      const v = s[k];
      return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    };
    const trim = (v: string): string => (/^-?\d+(\.\d+)?$/.test(v) ? String(Number(v)) : v);
    const out: { label: string; value: string; unit?: string }[] = [];
    const w = txt('width');
    const l = txt('length');
    if (w !== '' && l !== '') out.push({ label: '크기', value: `${trim(w)} × ${trim(l)}`, unit: 'mm' });
    if (d.category === 'metalMask') {
      if (txt('stencilSide') !== '') out.push({ label: '스텐실 면', value: txt('stencilSide') });
      if (txt('stThickness') !== '') out.push({ label: '스텐실 두께', value: txt('stThickness') });
    } else {
      if (txt('layers') !== '') out.push({ label: '층수', value: trim(txt('layers')), unit: '층' });
      if (txt('pcbThickness') !== '') out.push({ label: '두께', value: txt('pcbThickness'), unit: 'T' });
      const kind = txt('kindPcb');
      const mat = txt('material');
      if (kind !== '' || mat !== '') out.push({ label: '재질', value: [kind, mat].filter((x) => x !== '').join(' ') });
    }
    out.push({ label: '수량', value: String(d.qty), unit: d.orderCategory === 'mass' ? '매(양산)' : '매' });
    return out;
  });

  const isCanceledItem = (ctStatus: string): boolean => CANCELED_ORDER_ITEM_STATUSES.has(ctStatus);
  const orderDisplayStatus = computed(() => {
    const order = detail.value?.order;
    if (order === null || order === undefined) return '';
    return isCanceledItem(order.ctStatus) ? order.ctStatus : order.odStatus;
  });
  // D10 — 진행 중 주문(입금~배송)은 원가 소싱(RFQ) 허용, 판매가(확정가)만 불변. 게이트 정본은 서버.
  const rfqGate = computed<'ok' | 'cart' | 'unpaid' | 'closed'>(() => {
    const d = detail.value;
    if (d === null) return 'ok';
    if (d.cartState === 'cart') return 'cart';
    if (d.cartState !== 'ordered') return 'ok';
    if (d.order === null) return 'ok'; // 유령(주문 헤더 소실) — 서버 게이트가 허용
    if (isCanceledItem(d.order.ctStatus) || d.order.odStatus === '완료' || d.order.odStatus === '취소') return 'closed';
    if (!d.order.isPaid) return 'unpaid';
    return 'ok';
  });
  const RFQ_GATE_NOTES: Record<'cart' | 'unpaid' | 'closed', string> = {
    cart: '고객 장바구니에 담김 — 담김 해제 후 견적요청을 보낼 수 있습니다.',
    unpaid: '입금 확인 전 주문 — 결제 확인 후 소싱을 시작하세요.',
    closed: '완료·취소된 주문 — 재작업은 아래 [A/S 재발주] 섹션에서 회차를 열어 진행합니다.',
  };
  const rfqGateNote = computed(() => (rfqGate.value === 'ok' ? '' : RFQ_GATE_NOTES[rfqGate.value]));

  // 입금확인 — 발주 패널이 바로 아래라(미결제면 NOT_PAID) 여기서 끊기지 않게 같은 화면에 둔다.
  const receipt = useConfirmPcbOrderReceipt();
  const cancelOrderOpen = ref(false);
  const canReviewOrderCancel = computed(() => {
    const status = orderDisplayStatus.value;
    return (
      specId.value !== null && status !== '' && status !== '취소' && status !== '반품' &&
      status !== '품절' && status !== '삭제' && status !== '완료'
    );
  });
  const canConfirmReceipt = computed(() => {
    const order = detail.value?.order;
    return (
      order !== null && order !== undefined && orderDisplayStatus.value === '주문' &&
      !order.isPaid && order.settleCase.includes('무통장')
    );
  });
  async function confirmReceipt(): Promise<void> {
    const order = detail.value?.order;
    if (order === null || order === undefined) return;
    if (
      !(await confirmDialog(
        `주문 ${order.odId} 전체(PCB ${String(order.orderPcbCount)}건 포함)를 입금확인 처리할까요?\n` +
          `이 주문의 결제 가능한 모든 상품이 함께 입금 상태로 변경되고 고객에게 확인 메일이 발송됩니다.`,
      ))
    ) {
      return;
    }
    actionError.value = '';
    try {
      const res = await receipt.mutateAsync({ odId: order.odId, sendMail: true });
      if (res.data.skipped.length > 0) {
        actionError.value = `처리되지 않았습니다: ${res.data.skipped[0]?.reason ?? ''} — 새로고침 후 다시 확인해 주세요.`;
      }
    } catch (e) {
      surfaceError(e, '입금확인에 실패했습니다.');
    }
  }

  // 두 축 불일치 — 주문 축(od_status)과 협력 축(RFQ→발주→선적)은 서로를 게이트하지 않아, 발주 없이
  // 배송되거나 입고가 끝났는데 주문이 배송 전인 상태가 생긴다. 이관 주문 19,665건이 협력 기록 없이
  // '완료'라 강제로 막을 수 없다 — 대신 보이게 한다.
  const axisMismatch = computed<'shipped-without-po' | 'received-not-delivered' | null>(() => {
    const order = detail.value?.order ?? null;
    if (order === null) return null;
    const delivered = order.odStatus === '배송' || order.odStatus === '완료';
    if (delivered && adminPos.value.length === 0) return 'shipped-without-po';
    const anyReceived = shipments.value.some((s) => s.receivedAt !== null);
    if (anyReceived && !delivered) return 'received-not-delivered';
    return null;
  });

  // [배송 처리] — 입고 끝난 주문의 고객 발송을 이 자리에서 바로 연다(선적·배송 워크큐와 같은 대화상자).
  const customerShipOdId = ref<string | null>(null);
  const customerShipAllReceived = computed(
    () =>
      adminPos.value.length > 0 &&
      adminPos.value.every((p) => {
        const s = shipmentByPo.value.get(p.poId);
        return s?.receiverKind === 'admin' && s.receivedAt !== null;
      }),
  );
  function openCustomerShip(): void {
    customerShipOdId.value = detail.value?.order?.odId ?? null;
  }
  // 직송 Case — **입고된 발주**의 직송지(배송 큐 서버 판정과 같은 순수 함수). non-null 이면 관리자가 보낼
  // 실물이 없으니 유도 배지가 '직송 완료 대기'가 되고, 운송장 대신 완료 종결로 간다(여정 11호 X9 교정).
  const caseDirectShipCountry = computed<string | null>(() =>
    resolvePcbDirectShipCountry(
      adminPos.value.flatMap((po) => {
        const s = shipmentByPo.value.get(po.poId);
        if (s?.receiverKind !== 'admin' || s.receivedAt === null) return [];
        return [po.destinationCountry];
      }),
    ),
  );
  const completeCustomerOrder = usePcbCompleteCustomerOrder();
  async function completeDirectShip(): Promise<void> {
    const odId = detail.value?.order?.odId ?? null;
    const country = caseDirectShipCountry.value;
    if (odId === null || country === null) return;
    if (!(await confirmDialog(`직송 건 — 고객이 현지(${country})에서 수령했습니다. 주문을 완료로 종결합니다.`))) return;
    actionError.value = '';
    try {
      await completeCustomerOrder.mutateAsync(odId);
    } catch (e) {
      surfaceError(e, '직송 완료 처리에 실패했습니다.');
    }
  }

  return {
    route,
    router,
    specId,
    backTarget,
    collapsed,
    expandSection,
    rfqSectionEl,
    poSelectionGuide,
    detailQuery,
    detail,
    rfqsQuery,
    allRows,
    adminRows,
    childrenOf,
    selectedRow,
    posQuery,
    allPos,
    adminPos,
    shipments,
    shipmentByPo,
    latestRound,
    latestRoundRfqs,
    selectedPoRfq,
    roundsExpanded,
    inLatestRound,
    olderRoundCount,
    latestPoCount,
    olderRoundsCollapsed,
    childPosOf,
    actionError,
    surfaceError,
    estimateProjectId,
    estimateSent,
    estimateSendState,
    estimateEnabled,
    estimateBlockedReason,
    deleteOpen,
    onDeleted,
    mailLogOpen,
    specEntries,
    gerberFiles,
    orderDetailOpen,
    specPanelOpen,
    specPanelPinned,
    toggleSpecPin,
    closeSpecPanel,
    isStencilCase,
    specHeadline,
    isCanceledItem,
    orderDisplayStatus,
    rfqGate,
    rfqGateNote,
    receipt,
    cancelOrderOpen,
    canReviewOrderCancel,
    canConfirmReceipt,
    confirmReceipt,
    axisMismatch,
    customerShipOdId,
    customerShipAllReceived,
    openCustomerShip,
    caseDirectShipCountry,
    completeDirectShip,
  };
}

export type CaseCore = ReturnType<typeof useCaseCore>;
