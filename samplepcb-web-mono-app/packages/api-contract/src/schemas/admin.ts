import { z } from 'zod';
import { PcbProjectSpec } from './pcb-project';

// ── 관리자 견적 관리(/app/admin/quotes, sp-vue) 계약 ────────────────────────
// 사용자 계약(PcbProject*)과 의도적으로 분리 — 관리자 화면은 노출 필드·진화 속도가
// 다르다(AdminQuoteDetail 만 ListItem.extend 로 내부 재사용). 라우트는 전부
// requireAdmin(JWT isAdmin 클레임) 뒤에 있다.

// 목록 쿼리. tab 이 상태 필터를 겸한다:
//   rfq|priced|quoted = quoteStatus 1:1 · carted = ctId != null(담김+주문 진행분).
//   cartState(cart/ordered)는 g5_shop_cart 파생이라 SQL 필터가 불가 — 페이지네이션
//   정합이 유지되는 유일한 기준인 ctId 로 묶고, 행 뱃지가 cart/ordered 를 구분한다.
// PCB 전용이던 preorder 탭은 회수됐다(2026-08-05) — PCB 진행현황·대기 큐는 스펙 축
// 전용 계약(pcb-cases.ts)으로 옮겼다. 코어 견적 관리에 PCB 개념을 남기지 않는다.
export const AdminQuoteListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z.enum(['all', 'rfq', 'priced', 'quoted', 'carted']).default('all'),
  status: z.enum(['active', 'deleted', 'all']).default('active'), // 보관함(deleted) 포함 토글
  category: z.string().optional(),
  q: z.string().optional(), // 회원ID·프로젝트명 contains
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(), // 신청일 범위 시작 (KST 해석)
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(), // 신청일 범위 끝 (해당 일 포함)
});
export type AdminQuoteListQueryType = z.infer<typeof AdminQuoteListQuery>;

// 신청자 — g5_member read-only 파생(한정 예외 ⑤, lib/g5-db.ts).
// mbId 가 null(비회원)이면 applicant 자체가 null. 회원 행이 소실(탈퇴)된 경우엔
// mbId 만 채워지고 나머지는 빈 문자열이다.
export const AdminApplicant = z.object({
  mbId: z.string(),
  name: z.string(),
  nick: z.string(),
  email: z.string(),
  phone: z.string(), // mb_hp 우선, 없으면 mb_tel (서버 합성)
});
export type AdminApplicantType = z.infer<typeof AdminApplicant>;

// 탭 카운트 — 검색어·기간·카테고리·보관함 토글은 반영, 탭 자체는 미반영
// (= 현재 필터된 집합의 분포. total 은 "전체" 탭 값과 동일).
export const AdminQuoteCounts = z.object({
  total: z.number(),
  rfq: z.number(),
  priced: z.number(),
  quoted: z.number(),
  carted: z.number(), // ctId != null (담김+주문 진행분)
});
export type AdminQuoteCountsType = z.infer<typeof AdminQuoteCounts>;

// PCB 협력사 RFQ 진행 요약 — 페이지 행 단위 enrich(P3.5, 진행현황 배지용).
// RFQ 행이 없으면 null. 관리자 직속 트랙(parentPartnerId=0)만 집계.
export const AdminQuotePcbRfqSummary = z.object({
  total: z.number(),
  quoted: z.number(), // 회신(가격) 도착 수
  selected: z.boolean(),
});
export type AdminQuotePcbRfqSummaryType = z.infer<typeof AdminQuotePcbRfqSummary>;

export const AdminQuoteListItem = z.object({
  projectId: z.number(),
  quoteId: z.string(),
  projectName: z.string(),
  category: z.string(),
  orderCategory: z.enum(['sample', 'mass']),
  qty: z.number(),
  optionSummary: z.string(), // 사용자 목록·cart ct_option 과 같은 요약 문자열(표기 통일)
  thumbnailUrl: z.string().nullable(), // 거버 썸네일 서명 프록시 URL(만료 있음) — pathToken 미노출
  quoteStatus: z.enum(['priced', 'rfq', 'quoted']),
  status: z.enum(['active', 'deleted', 'archived']),
  price: z.number().nullable(), // finalPrice(관리자 확정) ?? autoPrice ?? null
  cartState: z.enum(['none', 'cart', 'ordered']),
  applicant: AdminApplicant.nullable(),
  createdAt: z.string(), // ISO
  pcbRfq: AdminQuotePcbRfqSummary.nullable(), // 협력사 RFQ 진행 — 없으면 null(P3.5)
});
export type AdminQuoteListItemType = z.infer<typeof AdminQuoteListItem>;

export const AdminQuoteListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminQuoteListItem),
    total: z.number(), // 탭 포함 전체 필터 적용 건수(페이지네이션용)
    page: z.number(),
    pageSize: z.number(),
    counts: AdminQuoteCounts,
  }),
});
export type AdminQuoteListResponseType = z.infer<typeof AdminQuoteListResponse>;

// 파일 목록 — pathToken 은 절대 싣지 않는다(무인증 파일서버 삭제 API 까지 여는 토큰).
// 원본 다운로드는 GET /api/admin/pcb-files/:fileId (Bearer 필요)로만.
export const AdminQuoteFile = z.object({
  fileId: z.number(),
  fileType: z.string().nullable(), // gerber | thumbnail (bom | drawing 예정)
  originFileName: z.string(),
  size: z.number(),
  writeDate: z.string(), // ISO
});
export type AdminQuoteFileType = z.infer<typeof AdminQuoteFile>;

export const AdminQuoteDetail = AdminQuoteListItem.extend({
  message: z.string().nullable(),
  // 수신처 회사명 — 서버 해석 규칙 적용값(스냅샷 ?? 회원 프로필). 2층 구조.
  companyName: z.string().nullable(),
  spec: PcbProjectSpec, // specJson 원본 — 드로어 라벨링용
  finalPrice: z.number().nullable(),
  pricedBy: z.string().nullable(),
  pricedAt: z.string().nullable(),
  ctId: z.number().nullable(),
  // sp_quote 는 문자열 조인(FK/relation 없음) — row 소실 대비 nullable
  quote: z
    .object({
      autoPrice: z.number().nullable(),
      eta: z.string().nullable(),
      priceVersion: z.string(),
      expiresAt: z.string(),
      createdAt: z.string(),
    })
    .nullable(),
  files: z.array(AdminQuoteFile),
  updatedAt: z.string(),
  // 주문 요약(P3.5) — ctId → g5 cart/od read-only 파생(BOM D10 동형, 저장 없음).
  // 담김 전·유령이면 null. PCB Case 의 주문 카드와 레거시 이력 열람에 쓰인다.
  order: z
    .object({
      odId: z.string(),
      odStatus: z.string(), // '주문'(미입금)|'입금'|'준비'|…|'완료'|'취소'
      isPaid: z.boolean(), // od_status !== '주문'
      receiptPrice: z.number(),
      cartPrice: z.number(),
      settleCase: z.string(),
      orderedAt: z.string().nullable(),
    })
    .nullable(),
});
export type AdminQuoteDetailType = z.infer<typeof AdminQuoteDetail>;

export const AdminQuoteDetailResponse = z.object({
  result: z.literal(true),
  data: AdminQuoteDetail,
});
export type AdminQuoteDetailResponseType = z.infer<typeof AdminQuoteDetailResponse>;

// 가격 확정(rfq→quoted)·수동 조정·재확정. 장바구니 담김/주문 진행분은 서버가 409 로
// 거부한다(cart 행 io_price 스냅샷과 어긋나므로 — 사용자 수량 PATCH 와 동일 논리).
export const AdminConfirmPriceBody = z.object({
  finalPrice: z.number().int().positive().max(2_000_000_000), // DB Int 범위 내 sanity
});
export type AdminConfirmPriceBodyType = z.infer<typeof AdminConfirmPriceBody>;

export const AdminConfirmPriceResponse = z.object({
  result: z.literal(true),
  data: z.object({
    projectId: z.number(),
    quoteStatus: z.literal('quoted'),
    finalPrice: z.number(),
    pricedBy: z.string(),
    pricedAt: z.string(), // ISO
  }),
});
export type AdminConfirmPriceResponseType = z.infer<typeof AdminConfirmPriceResponse>;

// 수신처 회사명 저장(2층 구조) — 스냅샷(SpOrderSpec.companyName) 저장 + 회원이면 프로필
// (SpMemberProfile) 기억. 빈 문자열(트림 후)은 스냅샷 삭제(null 저장) 신호이며 프로필은
// 건드리지 않는다. 가격(/price)과 달리 담김/주문/보관 상태 가드가 없다(문서 메타데이터).
export const AdminCompanyNameBody = z.object({
  companyName: z.string().trim().max(255), // '' = 스냅샷 삭제
});
export type AdminCompanyNameBodyType = z.infer<typeof AdminCompanyNameBody>;

export const AdminCompanyNameResponse = z.object({
  result: z.literal(true),
  data: z.object({
    projectId: z.number(),
    companyName: z.string().nullable(), // 저장 후 해석 규칙 적용값(스냅샷 ?? 프로필)
  }),
});
export type AdminCompanyNameResponseType = z.infer<typeof AdminCompanyNameResponse>;

// ── 관리자 견적서(A4 인쇄) 계약 ─────────────────────────────────────────────
// GET /api/admin/pcb-projects/:id/estimate. 순수 표시 컴포넌트(EstimateSheet.vue)에
// props 로 주입한다. 향후 고객용 견적서 라우트에서 같은 스키마를 재사용할 수 있도록
// 화면이 필요로 하는 표시 데이터를 서버가 완성해서 내려준다(FE 계산 없음).

// 부가세 정석(내가·역산). 합계 = finalPrice ?? autoPrice(부가세 포함액)이며,
//   공급가액 = round(합계/1.1) · 부가세 = 합계 − 공급가액 → 합이 정확히 합계(1원 오차 없음,
//   영카트 orderformupdate.php 와 동일 공식). 서버에서 계산하며 FE 재계산 금지.
export const AdminEstimateAmounts = z.object({
  supply: z.number(), // 공급가액
  vat: z.number(), // 부가세
  total: z.number(), // 합계(부가세 포함)
});
export type AdminEstimateAmountsType = z.infer<typeof AdminEstimateAmounts>;

// 발신(공급자) 정보 — 영카트 기본환경설정(g5_shop_default) 재사용(하드코딩 아님).
// 로컬 DB 는 설치 더미값("회사명" 등)이 그대로 표시되는 게 정상(실값 입력은 운영 절차).
export const AdminEstimateCompany = z.object({
  name: z.string(),
  owner: z.string(),
  tel: z.string(),
  zip: z.string(),
  addr: z.string(),
  managerName: z.string(),
  managerEmail: z.string(),
  bankAccount: z.string(), // 빈 값이면 시트에서 결제계좌 행 생략
});
export type AdminEstimateCompanyType = z.infer<typeof AdminEstimateCompany>;

export const AdminEstimate = z.object({
  projectId: z.number(),
  estimateNo: z.string(), // "Q{projectId}"
  issuedAt: z.string(), // 발행일 (오늘, KST YYYY-MM-DD)
  validUntil: z.string(), // 유효기간 (확정가는 발행일+30일 · 자동견적만 quote.expiresAt KST, YYYY-MM-DD)
  projectName: z.string(),
  category: z.string(),
  orderCategory: z.enum(['sample', 'mass']),
  qty: z.number(),
  optionSummary: z.string(),
  spec: PcbProjectSpec, // 상세 드로어와 동일 원본 — 라벨링은 FE specKeys i18n
  eta: z.string().nullable(),
  applicant: AdminApplicant.nullable(),
  // 수신처 회사명 — 서버 해석 규칙 적용값(스냅샷 ?? 회원 프로필). 시트 recipientCompany 프리필용.
  companyName: z.string().nullable(),
  amounts: AdminEstimateAmounts.nullable(), // 가격 미확정(rfq)이면 null
  company: AdminEstimateCompany,
});
export type AdminEstimateType = z.infer<typeof AdminEstimate>;

export const AdminEstimateResponse = z.object({
  result: z.literal(true),
  data: AdminEstimate,
});
export type AdminEstimateResponseType = z.infer<typeof AdminEstimateResponse>;

// ── 관리자 견적서 발송 계약 (POST .../:id/send-estimate) ──────────────────────
// 레거시 sendFileMail(estimate.php) 이식 — 한 번에 메일 + 알림톡을 발송한다. 견적서는 PDF
// 없이 메일 본문에 직접 임베드한다. 전송은 sp-node 직송(메일=nodemailer→로컬 Mailpit,
// 알림톡=iwinv fetch)이라 발송 결과를 채널별로 정직하게 반환한다.
// 가격 미확정(rfq=amounts null)이면 라우트가 409(NOT_PRICED).
// 채널 게이트는 독립: 메일=cf_email_use(0이면 mail:'skipped'), 알림톡=ALIMTALK_ENABLED
// (로컬 기본 false → alimtalk:'skipped', 실발송 0). 비회원/무효번호도 alimtalk:'skipped'.
export const AdminNotifyChannelStatus = z.enum(['sent', 'failed', 'skipped']);
export type AdminNotifyChannelStatusType = z.infer<typeof AdminNotifyChannelStatus>;

// 수신자 이메일은 명시 파라미터(관리자가 화면에서 확인·수정 가능) — 회원 이메일에 암묵 의존 금지.
export const AdminSendEstimateBody = z.object({
  email: z.string().trim().email(),
});
export type AdminSendEstimateBodyType = z.infer<typeof AdminSendEstimateBody>;

export const AdminSendEstimateResponse = z.object({
  result: z.literal(true),
  data: z.object({
    email: z.string(), // 실제 발송 대상(요청값 반영)
    mail: AdminNotifyChannelStatus, // sent=성공 · failed=SMTP 실패 · skipped=cf_email_use=0
    alimtalk: AdminNotifyChannelStatus, // sent=성공 · failed=vendor 오류 · skipped=비활성/무효번호
  }),
});
export type AdminSendEstimateResponseType = z.infer<typeof AdminSendEstimateResponse>;

// ── 관리자 견적 배치 완전삭제 계약 ──────────────────────────────────────────
// "경고만 주고 관련 데이터 모두 삭제"(1단계 즉시 완전삭제) — 단건/다중 공통(ids 1개 =
// 단건). 되돌릴 수 없어 삭제 전 POST .../delete-preview 로 무엇이 지워지는지 집계해
// danger 모달에 보여준 뒤 POST .../delete 로 실행한다. 결제완료(입금/배송/완료) 주문이
// 묶인 견적은 PG환불 포함 취소 도메인이라 삭제 차단(deletable=false)하고 나머지만 지운다.
// 견적↔주문 1:N — 같은 미입금 주문에 묶인 선택 견적은 주문을 1회만 삭제하고, 선택 안 된
// 형제 견적은 함께 영향받는다고 경고한다.
export const AdminDeleteBatchBody = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
});
export type AdminDeleteBatchBodyType = z.infer<typeof AdminDeleteBatchBody>;

/** 실행 바디 — 프리뷰(위 Body)와 달리 되돌릴 수 없는 실행이라 사유·확인을 요구한다.
 *  감사 원장 sp_delete_audit(subjectType='pcb_case')에 건별로 남는다. */
export const AdminDeleteExecuteBody = AdminDeleteBatchBody.extend({
  reason: z.string().trim().min(2).max(1000),
  acknowledgeIrreversible: z.literal(true),
  /** PAID_ORDER 차단만 해제한다. PO_ISSUED·SHIPMENT_EXISTS·SHARED_ORDER 는 우회 불가. */
  forceDeletePaidOrder: z.boolean().optional(),
});
export type AdminDeleteExecuteBodyType = z.infer<typeof AdminDeleteExecuteBody>;

/** 견적 상태보다 우선하는 거래·협력 무결성 차단(BOM §Case 삭제와 같은 위계).
 *  ⚠ 우회(강제 삭제)는 PAID_ORDER 하나뿐이다 — 결제는 우리 DB 안의 문제지만
 *  발주·선적은 협력사와 합의된 기록이라 관리자 체크 하나로 넘길 수 없다. */
export const AdminDeleteBlockReason = z.enum([
  'PAID_ORDER', // 결제 완료 주문(강제 해제 가능)
  'PO_ISSUED', // 협력사 발주서 존재 — 발주 취소 먼저
  'SHIPMENT_EXISTS', // 선적 문서 존재 — 물류 정리 먼저
  'SHARED_ORDER', // 같은 주문에 선택되지 않은 형제 견적이 있음
]);
export type AdminDeleteBlockReasonType = z.infer<typeof AdminDeleteBlockReason>;

export const ADMIN_DELETE_BLOCK_TEXT: Record<AdminDeleteBlockReasonType, string> = {
  PAID_ORDER:
    '결제(입금)가 확인된 주문입니다. 강제 삭제를 선택하면 주문·결제 기록까지 함께 지웁니다.',
  PO_ISSUED:
    '협력사 발주서가 있습니다. 금액·납기가 합의된 문서라 Case 상세에서 발주를 먼저 취소해 주세요.',
  SHIPMENT_EXISTS:
    '선적(발송) 문서가 있습니다. 물류가 이미 움직인 건이라 선적을 먼저 정리해 주세요.',
  SHARED_ORDER:
    '같은 주문에 선택되지 않은 다른 견적이 있습니다. 그 견적까지 함께 선택하거나 주문에서 분리해 주세요.',
};

/** 삭제해도 되지만 되돌릴 수 없는 부수효과 — 실행 전 1차 경고 레이어에 표시한다. */
export const AdminDeleteWarning = z.enum([
  'RFQ_EMAILS_REMAIN', // 이미 발송된 견적요청 메일·매직링크는 회수되지 않는다
  'PCB_ATTACHMENTS_DELETED', // EQ·Working·상업송장·AWB 첨부가 영구 삭제된다
  'UNPAID_ORDER_DELETED', // 단독 미입금 주문·장바구니 행도 함께 삭제된다
  'LEGACY_CASE', // 레거시 이관 건 — 원장 대조 근거가 사라진다
]);
export type AdminDeleteWarningType = z.infer<typeof AdminDeleteWarning>;

export const ADMIN_DELETE_WARNING_TEXT: Record<AdminDeleteWarningType, string> = {
  RFQ_EMAILS_REMAIN: '이미 발송된 협력사 견적요청 메일과 매직링크는 회수되지 않습니다.',
  PCB_ATTACHMENTS_DELETED: 'EQ·Working·상업송장 등 협력 트랙 첨부가 영구 삭제됩니다.',
  UNPAID_ORDER_DELETED: '단독 미입금 주문과 연결 장바구니 행도 함께 영구 삭제합니다.',
  LEGACY_CASE: '레거시에서 이관된 견적입니다 — 삭제하면 이관 원장과의 대조 근거가 사라집니다.',
};

// 건별 삭제 판정(프리뷰)
export const AdminDeletePreviewItem = z.object({
  projectId: z.number(),
  projectName: z.string(),
  cartState: z.enum(['none', 'cart', 'ordered']),
  deletable: z.boolean(), // false = 차단 사유가 하나 이상 있음
  /** 대표 차단 사유(표시용) — 전체는 blockReasons. */
  blockReason: AdminDeleteBlockReason.nullable(),
  blockReasons: z.array(AdminDeleteBlockReason),
  warnings: z.array(AdminDeleteWarning),
  fileCount: z.number(), // 삭제될 sp_file(거버·썸네일) 수 = 파일서버 실파일 수
  /** PCB 협력 트랙 동반 삭제분 — 화면이 "무엇이 함께 사라지는지" 말하는 근거. */
  pcb: z.object({
    rfqs: z.number().int().nonnegative(),
    pos: z.number().int().nonnegative(),
    shipments: z.number().int().nonnegative(),
    attachments: z.number().int().nonnegative(), // EQ·선적 첨부 파일 수
  }),
  isLegacy: z.boolean(),
  removesCartRow: z.boolean(), // 담김(cart) → 장바구니 행 제거 동반
  deletesOrder: z.boolean(), // 미입금 주문 → 주문(g5_shop_order)까지 삭제 동반
  odId: z.string().nullable(), // 주문됨이면 연결된 주문번호
  odStatus: z.string().nullable(),
});
export type AdminDeletePreviewItemType = z.infer<typeof AdminDeletePreviewItem>;

// 같은 주문(od_id)에 선택 견적이 묶인 그룹 — 주문 1회 삭제 + 미선택 형제 경고
export const AdminDeleteOrderGroup = z.object({
  odId: z.string(),
  odStatus: z.string(),
  isPaid: z.boolean(), // true 면 이 그룹의 견적들은 삭제 차단
  receiptPrice: z.number(), // 수납액
  selectedCount: z.number(), // 이 주문에 묶인 "선택된" 견적 수
  unselectedSiblings: z.array(z.string()), // 선택 안 됐지만 함께 영향받는 다른 견적명
});
export type AdminDeleteOrderGroupType = z.infer<typeof AdminDeleteOrderGroup>;

export const AdminDeletePreviewResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminDeletePreviewItem),
    orderGroups: z.array(AdminDeleteOrderGroup),
    notFound: z.array(z.number()), // 존재하지 않는(또는 이미 삭제된) projectId
    summary: z.object({
      deletableCount: z.number(),
      blockedCount: z.number(),
      totalFileCount: z.number(),
      /** 선택분 전체에서 모인 차단·경고(중복 제거) — 모달 요약 레이어가 읽는다. */
      blockReasons: z.array(AdminDeleteBlockReason),
      warnings: z.array(AdminDeleteWarning),
      /** 강제 해제 체크로 살릴 수 있는 건수(= PAID_ORDER 만 걸린 건). */
      forceableCount: z.number().int().nonnegative(),
    }),
  }),
});
export type AdminDeletePreviewResponseType = z.infer<typeof AdminDeletePreviewResponse>;

// 건별 삭제 결과
export const AdminDeleteResultItem = z.object({
  projectId: z.number(),
  outcome: z.enum(['deleted', 'blocked', 'failed']),
  /** blocked 일 때 왜 막혔는지 — 프리뷰 이후 상태가 바뀐 레이스도 이 값으로 드러난다. */
  blockReason: AdminDeleteBlockReason.nullable(),
  orderDeleted: z.boolean(), // 미입금 주문(g5_shop_order)까지 삭제됨
  cartRemoved: z.boolean(), // 담김 장바구니 행 제거됨
});
export type AdminDeleteResultItemType = z.infer<typeof AdminDeleteResultItem>;

export const AdminDeleteResponse = z.object({
  result: z.literal(true),
  data: z.object({
    results: z.array(AdminDeleteResultItem),
    summary: z.object({
      deleted: z.number(),
      blocked: z.number(),
      failed: z.number(),
    }),
  }),
});
export type AdminDeleteResponseType = z.infer<typeof AdminDeleteResponse>;
