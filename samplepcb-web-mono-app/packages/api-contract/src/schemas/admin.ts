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
