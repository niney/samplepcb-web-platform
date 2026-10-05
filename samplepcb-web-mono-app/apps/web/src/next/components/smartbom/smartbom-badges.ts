import {
  BOM_CLAIM_STATUS_LABELS,
  BOM_CONFIRM_REQUEST_STATUS_LABELS,
  BOM_PART_PACKAGE_STATUS_LABELS,
  BOM_PO_STATUS_LABELS,
  BOM_RFQ_STATUS_LABELS,
  bomShipmentStatusLabel,
  type AdminBomOrderCaseType,
  type AdminBomOrderListItemType,
  type AdminBomPoCrossItemType,
  type AdminBomQuoteSummaryType,
  type AdminBomShipmentCrossItemType,
  type BomClaimStatusType,
  type BomConfirmRequestStatusType,
  type BomPartPackageStatusType,
  type BomPoStatusType,
  type BomQuoteStatusType,
  type BomRfqStatusType,
} from '@sp/api-contract';
import type { BomQuoteAdminAttentionKind, BomQuoteAdminAttentionReason } from '@sp/utils';
import { SMARTBOM_STATUS_META } from '@/admin/smartbom';
import type { BadgeVariant, StatusBadge } from '@/next/components/common/badge-types';
import { odStatusVariant } from '@/next/components/common/order-status';

// SmartBOM 상태 배지 사전 — 화면마다 따로 두던 사전(진행현황·주문·발주·부품 확인·RFQ·클레임·선적·Case 상세)을
// 한 곳으로 모았다. 옛 화면의 색 클래스(bg-amber-100 …) 대신 Badge variant 로 말하고, 뜻은 common/badge-types.ts
// 와 같다: warning=기다림·주의, info=진행, success=끝남, danger=문제, secondary=중립·이력, outline=부가 표지.
// 같은 상태는 화면이 달라도 여기 함수 하나로만 색을 정한다(주문 od 상태는 PCB 와 공용 common/order-status.ts).
// 도메인 판정·글자색 헬퍼(Mouser 카트 상태·부품 확인 품목 글자색)는 각 폴더에 둔다(po/mouser-cart.ts·confirm/confirm-tones.ts).

export type { BadgeVariant, StatusBadge } from '@/next/components/common/badge-types';
/** 주문·발주 화면이 쓰던 이름 — StatusBadge 와 같다. */
export type BomBadge = StatusBadge;

// ── 견적 상태 ───────────────────────────────────────────────────────────────
// 견적요청 = 검토를 시작하지 않은 건(관리자 차례) — 기다림. 라벨은 화면마다 다를 수 있어 색만 공용.
const QUOTE_STATUS: Record<BomQuoteStatusType, BadgeVariant> = {
  draft: 'secondary',
  requested: 'warning',
  reviewing: 'info',
  answered: 'success',
  closed: 'secondary',
  canceled: 'secondary',
};

const isQuoteStatus = (status: string): status is BomQuoteStatusType => status in QUOTE_STATUS;

/** 견적 상태 색 — 모르는 상태(문자열)는 중립. 작업대 머리처럼 라벨을 따로 두는 곳이 쓴다. */
export const smartbomQuoteStatusVariant = (status: string): BadgeVariant =>
  isQuoteStatus(status) ? QUOTE_STATUS[status] : 'secondary';

/** 진행현황·견적관리·Case 머리 — 라벨은 옛 사전(SMARTBOM_STATUS_META) 그대로. */
export const smartbomQuoteStatusBadge = (status: BomQuoteStatusType): StatusBadge => ({
  label: SMARTBOM_STATUS_META[status].label,
  variant: QUOTE_STATUS[status],
});

/** RFQ 실황 — reviewing 인데 미발송이면 다음 액션이 'RFQ 보내기'임을 큐에서 바로 보이게. 해당 없음은 null. */
export const smartbomRfqBadge = (q: AdminBomQuoteSummaryType): StatusBadge | null => {
  if (q.rfqTotal === 0) return q.status === 'reviewing' ? { label: 'RFQ 미발송', variant: 'warning' } : null;
  return {
    label: `회신 ${String(q.rfqReplied)}/${String(q.rfqTotal)}`,
    variant: q.rfqReplied >= q.rfqTotal ? 'success' : 'info',
  };
};

// ── 주문(영카트 od) ──────────────────────────────────────────────────────────

/** 주문 줄의 진행 상태 — 취소 > 부분취소 > 입금 대기 > od 상태 순(옛 화면 statusLabel 그대로). */
export const bomOrderStatusBadge = (item: AdminBomOrderListItemType): StatusBadge => {
  if (item.odStatus === '취소') return { label: '취소', variant: 'secondary' };
  if (item.cancelPrice > 0) return { label: `부분취소 · ${item.odStatus}`, variant: 'warning' };
  if (!item.isPaid) return { label: '입금 대기', variant: 'warning' };
  return { label: item.odStatus, variant: odStatusVariant(item.odStatus) };
};

/** 주문에 묶인 Case 한 줄의 상태 — 취소·이전 시도는 이력, 살아 있는 줄은 카트행 상태(모르면 진행). */
export const bomOrderCaseBadge = (entry: AdminBomOrderCaseType): StatusBadge => {
  if (entry.isCanceled) {
    return { label: entry.isCurrentAttempt ? '주문 취소' : '이전 주문 · 취소', variant: 'secondary' };
  }
  if (!entry.isCurrentAttempt) return { label: '이전 주문', variant: 'outline' };
  return { label: entry.ctStatus, variant: odStatusVariant(entry.ctStatus, 'info') };
};

// ── 발주서 ─────────────────────────────────────────────────────────────────

/** 발주서 상태 — 확인됨=완료, 발행(확인 대기)=진행, 마감=이력. 공급사 직접 구매(supplierCode)는 '구매' 말로 부른다. */
export const bomPoStatusBadge = (po: { status: BomPoStatusType; supplierCode: string | null }): StatusBadge => {
  const variant: BadgeVariant = po.status === 'confirmed' ? 'success' : po.status === 'issued' ? 'info' : 'secondary';
  if (po.supplierCode !== null && po.status === 'issued') return { label: '구매 확인 대기', variant };
  if (po.supplierCode !== null && po.status === 'confirmed') return { label: '구매 완료', variant };
  return { label: BOM_PO_STATUS_LABELS[po.status], variant };
};

/** 발주서가 속한 선적 — 입고가 끝났으면 끝남, 아니면 진행. 선적이 없으면 null. */
export const bomPoShipmentBadge = (item: AdminBomPoCrossItemType): StatusBadge | null => {
  if (item.shipment === null) return null;
  if (item.shipment.receivedAt !== null) return { label: '입고 완료', variant: 'success' };
  return { label: bomShipmentStatusLabel(item.shipment.mode, item.shipment.status), variant: 'info' };
};

// ── 결제 후 부품 확인 요청(D43) ───────────────────────────────────────────────
// 고객에게 물음(진행) → 고객이 답함(적용·정산이 관리자 차례) → 끝남.
const CONFIRM_STATUS: Record<BomConfirmRequestStatusType, BadgeVariant> = {
  requested: 'info',
  answered: 'warning',
  resolved: 'success',
  canceled: 'secondary',
};

export const bomConfirmStatusVariant = (status: BomConfirmRequestStatusType): BadgeVariant => CONFIRM_STATUS[status];

export const bomConfirmStatusBadge = (status: BomConfirmRequestStatusType): StatusBadge => ({
  label: BOM_CONFIRM_REQUEST_STATUS_LABELS[status],
  variant: CONFIRM_STATUS[status],
});

// ── 협력사 RFQ ──────────────────────────────────────────────────────────────
const RFQ_STATUS: Record<BomRfqStatusType, BadgeVariant> = {
  requested: 'info',
  quoted: 'success',
  closed: 'secondary',
};

export const bomRfqStatusBadge = (status: BomRfqStatusType): StatusBadge => ({
  label: BOM_RFQ_STATUS_LABELS[status],
  variant: RFQ_STATUS[status],
});

/** 선정 구매처 종류 — API 공급사(자동 시세)·협력사 회신(RFQ)·기타 구매처. */
export type ProcurementProviderKind = 'supplier' | 'partner' | 'other';

const PROVIDER_KIND: Record<ProcurementProviderKind, { short: string; label: string; variant: BadgeVariant }> = {
  supplier: { short: 'API', label: 'API 공급사', variant: 'success' },
  partner: { short: 'RFQ', label: '협력사 회신', variant: 'info' },
  other: { short: '기타', label: '기타 구매처', variant: 'secondary' },
};

export const procurementKindBadge = (
  kind: ProcurementProviderKind,
): { short: string; label: string; variant: BadgeVariant } => PROVIDER_KIND[kind];

// ── 클레임 ─────────────────────────────────────────────────────────────────
// PCB 클레임과 같은 색 배치(접수=기다림, 검토=진행, 완료=끝남, 불가=이력).
const CLAIM_STATUS: Record<BomClaimStatusType, BadgeVariant> = {
  open: 'warning',
  reviewing: 'info',
  resolved: 'success',
  rejected: 'secondary',
};

export const bomClaimStatusBadge = (status: BomClaimStatusType): StatusBadge => ({
  label: BOM_CLAIM_STATUS_LABELS[status],
  variant: CLAIM_STATUS[status],
});

// ── 선적·배송·입고 ───────────────────────────────────────────────────────────

/** 조달 선적 상태 — 입고가 끝났으면 완료, 아니면 단계 이름(진행). */
export const bomShipmentRowBadge = (item: AdminBomShipmentCrossItemType): StatusBadge =>
  item.receivedAt !== null
    ? { label: '입고 완료', variant: 'success' }
    : { label: bomShipmentStatusLabel(item.mode, item.status), variant: 'info' };

/** 공급사 봉투 스캔 누적(D42) — 0=아직, 일부=기다림, 전량=끝남, 초과=문제. */
export const receivingScanVariant = (scannedQty: number, orderedQty: number): BadgeVariant =>
  scannedQty === 0
    ? 'secondary'
    : scannedQty < orderedQty
      ? 'warning'
      : scannedQty === orderedQty
        ? 'success'
        : 'danger';

/** 같은 판정을 글자색으로(표 칸 안 숫자) — 0=흐림, 일부=주의, 전량=완료, 초과=오류. */
export const receivingScanTextClass = (item: { orderedQty: number; scannedQty: number }): string =>
  item.scannedQty === 0
    ? 'text-muted-foreground'
    : item.scannedQty < item.orderedQty
      ? 'text-warning'
      : item.scannedQty === item.orderedQty
        ? 'text-success'
        : 'text-destructive';

type OrderCase = AdminBomOrderListItemType['cases'][number];

/** 고객 배송 표의 연결 Case 칩 — 대체발주 대기=문제, 입고 완료=끝남, 그 밖=입고 진행(기다림). */
export const orderCaseBadge = (entry: OrderCase): StatusBadge =>
  entry.openShortageCount > 0
    ? { label: `대체발주 대기 ${String(entry.openShortageCount)}`, variant: 'danger' }
    : entry.poCount > 0 && entry.poReceivedCount >= entry.poCount
      ? { label: '입고 완료', variant: 'success' }
      : { label: `입고 ${String(entry.poReceivedCount)}/${String(entry.poCount)}`, variant: 'warning' };

/** 고객 배송 상태 — 배송 중=진행, 발송 가능=끝남(보낼 차례), 조달 복구·입고 대기=기다림. */
export const orderShipStateBadge = (shipping: boolean, allReceived: boolean, openShortage: number): StatusBadge =>
  shipping
    ? { label: '배송 중', variant: 'info' }
    : allReceived
      ? { label: '발송 가능', variant: 'success' }
      : { label: openShortage > 0 ? '조달 복구 대기' : '입고 대기', variant: 'warning' };

/** 실물 포장(QR) 상태 — 무효=문제, 출고=이력, 보관=끝남, 준비=부가 표지, 그 밖(입고·검수)=진행. */
export const bomPackageStatusBadge = (status: BomPartPackageStatusType): StatusBadge => ({
  label: BOM_PART_PACKAGE_STATUS_LABELS[status],
  variant:
    status === 'voided'
      ? 'danger'
      : status === 'issued'
        ? 'secondary'
        : status === 'stored'
          ? 'success'
          : status === 'prepared'
            ? 'outline'
            : 'info',
});

// ── Case 상세 — 품목 확인·RFQ 칩·회신 메일 결과 ───────────────────────────────
// 옛 화면은 행 바탕·왼쪽 막대로도 칠했지만, 리뉴얼은 상태를 배지 하나로만 말한다(docs/ADMIN_NEXT_UI.md §8).

export const ADMIN_ATTENTION_META: Record<
  BomQuoteAdminAttentionKind,
  { label: string; variant: BadgeVariant; priority: number }
> = {
  blocking: { label: '즉시 처리', variant: 'danger', priority: 0 },
  procurement: { label: '구매 확인', variant: 'warning', priority: 1 },
  technical: { label: '기술 검토', variant: 'warning', priority: 2 },
  inquiry: { label: '문의 진행', variant: 'info', priority: 3 },
  ready: { label: '정상', variant: 'success', priority: 4 },
  excluded: { label: '제외', variant: 'secondary', priority: 5 },
};

export const ADMIN_ATTENTION_REASON_LABEL: Record<BomQuoteAdminAttentionReason, string> = {
  quantity_missing: '수량 확인 필요',
  unmatched: '매칭 없음',
  uncosted: '금액 미산출',
  out_of_stock: '재고 없음',
  insufficient_stock: '재고 부족',
  stock_unverified: '재고 미확인',
  selected_stock_short: '선정 재고 부족',
  replacement_pending: '대체품 확인 필요',
  confirmation_required: '엔진 선정 확인 필요',
  engine_review: '엔진 검토 대상',
  lifecycle_attention: '단종·수명주기 확인',
  requirement_conflict: '스펙 정보 충돌',
  requirement_missing: '필수 스펙 누락',
  technical_fallback: '구매 가능 차순위 선정',
  supplier_search_limited: '일부 공급사 미검색',
  catalog_inquiry: '가격·재고 문의',
};

/** 품목 관점 RFQ 현황 칩 — 요청중=진행, 회신=끝남, 행 미회신=주의(문서는 회신됐는데 이 행만 빈칸), 마감=이력. */
export type ItemRfqBadgeTone = 'waiting' | 'replied' | 'missing' | 'closed';

export const ITEM_RFQ_BADGE_VARIANT: Record<ItemRfqBadgeTone, BadgeVariant> = {
  waiting: 'info',
  replied: 'success',
  missing: 'warning',
  closed: 'secondary',
};

export const ITEM_RFQ_BADGE_ORDER: Record<ItemRfqBadgeTone, number> = {
  missing: 0,
  waiting: 1,
  replied: 2,
  closed: 3,
};

/** 고객 회신 이메일 결과 안내 — Alert variant. */
export type EmailFeedbackTone = 'success' | 'warning' | 'error';

export const EMAIL_FEEDBACK_VARIANT: Record<EmailFeedbackTone, 'success' | 'warning' | 'destructive'> = {
  success: 'success',
  warning: 'warning',
  error: 'destructive',
};
