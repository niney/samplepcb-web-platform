import { z } from 'zod';
import { PCB_PROGRESS_STAGES } from './pcb-eq-review';

// ── 고객 주문 진행(트랙 공용) — od 무접촉 파생(D6) ─────────────────────────────
// PCB(P4.13/P4.14)가 먼저 깔아 둔 "협력 트랙 파생 → 목록·줄·카드 병합" 배관을 BOM 까지
// 넓힌다(2026-08-25 실측 §6.35: 고객은 입금→입고 다섯 단계를 전부 '입금완료'로 봤다).
// 라벨은 서버가 완성한다(PHP·화면은 그대로 출력). 협력사명·발주가·협력사 수는 싣지 않는다.

/** BOM 조달·물류 단계 — 배열 순서가 곧 진행 순서(느린 줄 판정). */
export const BOM_PROGRESS_STAGES = [
  'procure_pending', // 입금 확인됨, 발주 전
  'procuring', // 발주 발행(협력사 확인 전)
  'procure_confirmed', // 협력사 확인 — 발송 대기
  'packing', // 발송 문서·포장(preparing/requested)
  'inbound', // 운송 중(국내 shipping · 국제 shipped/arrived/customs)
  'received', // 자사 입고·검수 완료 — 고객 배송 준비
] as const;
export type BomProgressStageType = (typeof BOM_PROGRESS_STAGES)[number];

export const ORDER_PROGRESS_TRACKS = ['pcb', 'bom'] as const;
export type OrderProgressTrackType = (typeof ORDER_PROGRESS_TRACKS)[number];

export const OrderProgressStage = z.enum([...PCB_PROGRESS_STAGES, ...BOM_PROGRESS_STAGES]);
export type OrderProgressStageType = z.infer<typeof OrderProgressStage>;

export const CustomerOrderProgressItem = z.object({
  track: z.enum(ORDER_PROGRESS_TRACKS),
  /** pcb=sp_order_spec.id · bom=sp_bom_quote.id (문자열 — BigInt 안전). */
  refId: z.string(),
  /** 이 항목의 카트 줄 — 줄 배지 조인 키. */
  ctId: z.number().nullable(),
  /** pcb=프로젝트명 · bom=견적 제목. */
  projectName: z.string(),
  reorderRound: z.number().int(), // pcb 만 의미(0=원주문) — bom 은 0
  stage: OrderProgressStage,
  label: z.string(),
  shortLabel: z.string(),
  /** 여러 발주 중 일부가 앞서 있다(가장 느린 것을 기준으로 삼되 사실은 알린다). */
  partial: z.boolean().default(false),
  /** pcb 좌표파일(P4.13 계약 참조) — bom 은 null. */
  coordFile: z
    .object({ fileId: z.number(), name: z.string(), size: z.number() })
    .nullable()
    .default(null),
});
export type CustomerOrderProgressItemType = z.infer<typeof CustomerOrderProgressItem>;

export const CustomerOrderProgressResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(CustomerOrderProgressItem) }),
});
export type CustomerOrderProgressResponseType = z.infer<typeof CustomerOrderProgressResponse>;

export const CustomerOrderProgressBatchBody = z.object({
  odIds: z.array(z.string().min(1).max(32)).min(1).max(50),
});
export type CustomerOrderProgressBatchBodyType = z.infer<typeof CustomerOrderProgressBatchBody>;

/** 주문마다 가장 느린 줄 하나 — 목록 배지용. */
export const CustomerOrderProgressOrderSummary = z.object({
  odId: z.string(),
  track: z.enum(ORDER_PROGRESS_TRACKS),
  stage: OrderProgressStage,
  label: z.string(),
  shortLabel: z.string(),
  lineCount: z.number().int(),
});
export type CustomerOrderProgressOrderSummaryType = z.infer<typeof CustomerOrderProgressOrderSummary>;

export const CustomerOrderProgressBatchResponse = z.object({
  result: z.literal(true),
  data: z.object({ orders: z.array(CustomerOrderProgressOrderSummary) }),
});
export type CustomerOrderProgressBatchResponseType = z.infer<typeof CustomerOrderProgressBatchResponse>;

// ── od_status → 고객 라벨(웹 /app 쪽 표시용) ────────────────────────────────
// ⚠ PHP `extend/sp_order_status.extend.php sp_order_status_customer()` 가 주문내역(PHP)의
// 정본이고 이것은 그 **사본**이다 — 한쪽을 바꾸면 다른 쪽도 같이. (PHP 는 Node 가 죽어도
// 화면을 그려야 해서 사전을 자기 안에 둔다.)
export const ORDER_STATUS_CUSTOMER_LABELS: Record<string, string> = {
  주문: '입금확인중',
  입금: '입금완료',
  준비: '상품준비중',
  가격확인: '상품준비중',
  파일검사: '파일검사',
  EQ: '제조 확인(EQ)',
  생산시작: '생산시작',
  생산중: '생산중',
  품질시험: '품질시험',
  생산완료: '생산완료',
  'A/S': 'A/S 진행 중',
  배송: '상품배송',
  완료: '배송완료',
  취소: '주문취소',
  반품: '반품',
  품절: '품절',
};
export const orderStatusCustomerLabel = (status: string): string =>
  ORDER_STATUS_CUSTOMER_LABELS[status] ?? status;

/** 결제 뒤·배송 전 — 이 구간에서만 진행 파생이 od 라벨을 덮는다('주문'은 돈이 먼저). PHP 미러. */
export const ORDER_STATUS_PROGRESS_APPLIES = new Set([
  '입금',
  '준비',
  '가격확인',
  '파일검사',
  'EQ',
  '생산시작',
  '생산중',
  '품질시험',
  '생산완료',
]);

/** od 라벨과 진행 파생을 한 줄로 — 웹 /app 화면의 병합 규칙(PHP `sp_order_status_customer` 미러). */
export const mergedOrderCustomerLabel = (
  odStatus: string,
  progress: { stage: string | null; label: string | null; shortLabel?: string | null } | null,
  prefer: 'label' | 'shortLabel' = 'label',
): string => {
  if (progress !== null && progress.stage !== null && ORDER_STATUS_PROGRESS_APPLIES.has(odStatus)) {
    const picked = prefer === 'shortLabel' ? (progress.shortLabel ?? progress.label) : progress.label;
    if (picked !== null && picked !== undefined && picked !== '') return picked;
  }
  return orderStatusCustomerLabel(odStatus);
};
