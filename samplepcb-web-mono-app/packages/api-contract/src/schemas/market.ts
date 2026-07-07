import { z } from 'zod';

// ── PCB 재능마켓(market) 계약 ────────────────────────────────────────────────
// 도메인: 의뢰인(회원)이 프로젝트를 등록하고(역견적=공개 블라인드 입찰 / 지정견적=1:1),
// 승인된 전문가가 견적(입찰)을 제출, 의뢰인이 비교·채택한다. 결제(영카트 연동)는 2차.
// 코드 사전(분야·CAD·구간)과 한글 라벨은 **이 파일이 단일 정본** — sp-market(고객)·
// sp-vue(관리자)·sp-node(메일 빌더) 3곳이 공유한다. DB(sp_market_*)에는 코드만 저장.
// 블라인드/마스킹/NDA 원칙: 민감값(연락처·계좌·의뢰인 원명·타인 입찰)은 응답 스키마에
// 아예 선언하지 않는다 — zod 직렬화에서 구조적으로 탈락(관리자 계약만 예외적으로 노출).

// ── 코드 사전 + 한글 라벨 ────────────────────────────────────────────────────

// 회로개발 세부분야 18종 — 프로토타입 js/data.js `circuitFields` id 그대로.
export const MARKET_CATEGORIES = [
  'arduino',
  'mcu',
  'firmware',
  'software',
  'fpga',
  'digital',
  'power',
  'motor',
  'plc',
  'hv',
  'rf',
  'microwave',
  'robot',
  'led',
  'bms',
  'defense',
  'reverse',
  'etc',
] as const;
export type MarketCategoryCodeType = (typeof MARKET_CATEGORIES)[number];
export const MarketCategoryCode = z.enum(MARKET_CATEGORIES);

export const MARKET_CATEGORY_LABELS = {
  arduino: '아두이노 개발',
  mcu: 'AVR·마이컴 회로',
  firmware: '펌웨어 개발',
  software: '소프트웨어 개발',
  fpga: 'FPGA·VHDL/Verilog',
  digital: '디지털 통신·프로세싱',
  power: '전원회로·SMPS',
  motor: '전력제어(모터·인버터)',
  plc: 'PLC 제어',
  hv: '고전압·대전류',
  rf: 'RF(WiFi·VHF·UHF)',
  microwave: '마이크로웨이브(1G~30GHz)',
  robot: '로봇·계측기',
  led: 'LED·조명',
  bms: 'BMS 보드',
  defense: '국방·항공',
  reverse: '역설계',
  etc: '기타',
} as const satisfies Record<MarketCategoryCodeType, string>;

// PCB 설계 CAD 툴(전문가 보유 스킬 겸 프로젝트 요구 조건).
export const MARKET_CAD_TOOLS = ['altium', 'pads', 'orcad', 'xpedition', 'kicad', 'etc'] as const;
export type MarketCadToolCodeType = (typeof MARKET_CAD_TOOLS)[number];
export const MarketCadToolCode = z.enum(MARKET_CAD_TOOLS);

// 프로젝트 요구 CAD 에만 존재하는 'any'(상관없음) — 선택 시 단독이어야 한다(배타).
export const MARKET_PROJECT_CAD_CODES = ['any', ...MARKET_CAD_TOOLS] as const;
export type MarketProjectCadCodeType = (typeof MARKET_PROJECT_CAD_CODES)[number];
export const MarketProjectCadCode = z.enum(MARKET_PROJECT_CAD_CODES);

export const MARKET_CAD_TOOL_LABELS = {
  any: '상관없음',
  altium: 'Altium Designer',
  pads: 'PADS',
  orcad: 'OrCAD·Allegro',
  xpedition: 'Xpedition (Mentor)',
  kicad: 'KiCad',
  etc: '기타',
} as const satisfies Record<MarketProjectCadCodeType, string>;

// 예산 구간(금액이 아니라 구간 select — 프로토타입 request STEP4).
export const MARKET_BUDGET_RANGES = [
  'under300',
  'r300_700',
  'r700_1500',
  'over1500',
  'undecided',
] as const;
export type MarketBudgetRangeType = (typeof MARKET_BUDGET_RANGES)[number];
export const MarketBudgetRange = z.enum(MARKET_BUDGET_RANGES);

export const MARKET_BUDGET_RANGE_LABELS = {
  under300: '300만원 미만',
  r300_700: '300~700만원',
  r700_1500: '700~1,500만원',
  over1500: '1,500만원 이상',
  undecided: '미정 (견적 후 결정)',
} as const satisfies Record<MarketBudgetRangeType, string>;

// 경력 구간(프로토타입 expert-register STEP2 select).
export const MARKET_CAREER_RANGES = ['under3', 'r3_5', 'r5_10', 'r10_15', 'over15'] as const;
export type MarketCareerRangeType = (typeof MARKET_CAREER_RANGES)[number];
export const MarketCareerRange = z.enum(MARKET_CAREER_RANGES);

export const MARKET_CAREER_RANGE_LABELS = {
  under3: '3년 미만',
  r3_5: '3~5년',
  r5_10: '5~10년',
  r10_15: '10~15년',
  over15: '15년 이상',
} as const satisfies Record<MarketCareerRangeType, string>;

// 미팅 이동 가능 거리.
export const MARKET_TRAVEL_RANGES = ['remote', 'within30km', 'metro', 'nationwide'] as const;
export type MarketTravelRangeType = (typeof MARKET_TRAVEL_RANGES)[number];
export const MarketTravelRange = z.enum(MARKET_TRAVEL_RANGES);

export const MARKET_TRAVEL_RANGE_LABELS = {
  remote: '이동 불가 (원격만)',
  within30km: '30km 이내',
  metro: '수도권 전체',
  nationwide: '전국',
} as const satisfies Record<MarketTravelRangeType, string>;

// 활동 지역.
export const MARKET_REGIONS = [
  'seoul',
  'gyeonggi',
  'daejeon',
  'busan',
  'daegu',
  'gwangju',
  'remote',
] as const;
export type MarketRegionType = (typeof MARKET_REGIONS)[number];
export const MarketRegion = z.enum(MARKET_REGIONS);

export const MARKET_REGION_LABELS = {
  seoul: '서울',
  gyeonggi: '경기·인천',
  daejeon: '대전·충청',
  busan: '부산·경남',
  daegu: '대구·경북',
  gwangju: '광주·전라',
  remote: '원격만 가능',
} as const satisfies Record<MarketRegionType, string>;

// 견적 마감 프리셋(일). 수동 날짜 지정 시 그 날 23:59:59 KST 로 서버가 계산 저장.
export const MARKET_DEADLINE_PRESETS = [3, 7, 14] as const;

// NDA 전자서명 문구 — 코드로 버전 관리(서명 기록에는 textVersion 만 저장).
export const MARKET_NDA_VERSION = 'v1' as const;
export const MARKET_NDA_TEXT =
  '본인은 이 프로젝트의 첨부 자료와 상세 내용이 의뢰인의 영업비밀임을 확인하며, ' +
  '견적 검토 이외의 목적으로 사용하거나 제3자에게 공개·유출하지 않을 것에 동의합니다. ' +
  '위반 시 관련 법령에 따른 민·형사상 책임을 질 수 있습니다.';

// ── 유형·상태 enum + 라벨 ───────────────────────────────────────────────────

// 전문가 유형 — 지정 1번(당사)/2번(파트너사=기업)/3번(프리랜서=개인). house 는 시드 전용.
export const MarketExpertType = z.enum(['individual', 'company', 'house']);
export type MarketExpertTypeType = z.infer<typeof MarketExpertType>;

export const MARKET_EXPERT_TYPE_LABELS = {
  individual: '개인(프리랜서)',
  company: '기업(파트너사)',
  house: '샘플피씨비',
} as const satisfies Record<MarketExpertTypeType, string>;

export const MarketExpertStatus = z.enum(['pending', 'approved', 'rejected', 'suspended']);
export type MarketExpertStatusType = z.infer<typeof MarketExpertStatus>;

export const MARKET_EXPERT_STATUS_LABELS = {
  pending: '심사 대기',
  approved: '활동 중',
  rejected: '반려',
  suspended: '정지',
} as const satisfies Record<MarketExpertStatusType, string>;

// 견적 방식 — open=역견적(공개 블라인드 입찰), targeted=지정견적(1:1).
export const MarketProjectMethod = z.enum(['open', 'targeted']);
export type MarketProjectMethodType = z.infer<typeof MarketProjectMethod>;

export const MARKET_METHOD_LABELS = {
  open: '역견적',
  targeted: '지정견적',
} as const satisfies Record<MarketProjectMethodType, string>;

export const MarketProjectCategory = z.enum(['circuit', 'artwork', 'both', 'consult']);
export type MarketProjectCategoryType = z.infer<typeof MarketProjectCategory>;

export const MARKET_PROJECT_CATEGORY_LABELS = {
  circuit: '회로개발',
  artwork: 'PCB 설계',
  both: '회로개발+PCB설계',
  consult: '기타·상담',
} as const satisfies Record<MarketProjectCategoryType, string>;

// working|completed 는 2차(계약·결제) 예약값 — 1차 라우트는 생성하지 않는다.
export const MarketProjectStatus = z.enum([
  'bidding',
  'closed',
  'awarded',
  'cancelled',
  'working',
  'completed',
]);
export type MarketProjectStatusType = z.infer<typeof MarketProjectStatus>;

export const MARKET_PROJECT_STATUS_LABELS = {
  bidding: '입찰중',
  closed: '견적마감',
  awarded: '작업자 선정',
  cancelled: '취소',
  working: '작업진행중',
  completed: '완료',
} as const satisfies Record<MarketProjectStatusType, string>;

export const MarketBidStatus = z.enum(['submitted', 'awarded', 'rejected', 'withdrawn']);
export type MarketBidStatusType = z.infer<typeof MarketBidStatus>;

export const MARKET_BID_STATUS_LABELS = {
  submitted: '검토중',
  awarded: '채택',
  rejected: '미채택',
  withdrawn: '철회',
} as const satisfies Record<MarketBidStatusType, string>;

// ── 공통 조각 ────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// sp_file 메타(pathToken 은 계약에 존재하지 않는다 — 비노출 불변식).
export const MarketFileMeta = z.object({
  fileId: z.number(),
  fileType: z.string(), // attachment | license | portfolio | bizreg
  name: z.string(), // originFileName
  size: z.number(),
});
export type MarketFileMetaType = z.infer<typeof MarketFileMeta>;

// ── 전문가: 등록/본인/공개 ───────────────────────────────────────────────────

// 등록·수정 공통 편집 필드. bank* 는 2차 정산 대비 수집(폼 필수) — 본인·관리자 외 비노출.
const marketExpertEditableShape = {
  displayName: z.string().trim().min(2).max(100), // 이름(개인)/상호(기업) — 공개 프로필에 비마스킹 노출
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-() ]{9,50}$/),
  careerRange: MarketCareerRange,
  contactHours: z.string().trim().max(100).optional(), // 통화 가능시간(자유 입력)
  region: MarketRegion.optional(),
  travelRange: MarketTravelRange.optional(),
  intro: z.string().trim().min(10).max(5000),
  categories: z.array(MarketCategoryCode).max(MARKET_CATEGORIES.length).default([]),
  cadTools: z.array(MarketCadToolCode).max(MARKET_CAD_TOOLS.length).default([]),
  bankName: z.string().trim().min(1).max(50),
  bankHolder: z.string().trim().min(1).max(50),
  bankAccount: z
    .string()
    .trim()
    .regex(/^[0-9-]{6,50}$/),
} as const;

// multipart 의 payload 파트(JSON 문자열). 파일 파트: license[]·portfolio[](선택),
// bizreg(기업 필수 — 라우트가 강제). house 는 시드 전용이라 등록 불가.
export const MarketExpertRegisterPayload = z
  .object({
    expertType: z.enum(['individual', 'company']),
    ...marketExpertEditableShape,
    termsAgree: z.literal(true), // 약관 + 프로필 공개 동의
  })
  .refine((p) => p.categories.length + p.cadTools.length > 0, {
    message: '전문 분야 또는 CAD 툴을 1개 이상 선택해야 합니다',
    path: ['categories'],
  });
export type MarketExpertRegisterPayloadType = z.infer<typeof MarketExpertRegisterPayload>;

// 본인 수정(pending·rejected 에서만 — 라우트 가드). 보낸 필드만 갱신.
// categories+cadTools "합쳐서 1개 이상" 불변식은 병합 후 상태라 라우트가 재검증한다.
export const MarketExpertUpdatePayload = z.object(marketExpertEditableShape).partial();
export type MarketExpertUpdatePayloadType = z.infer<typeof MarketExpertUpdatePayload>;

export const MarketExpertRegisterResponse = z.object({
  result: z.literal(true),
  data: z.object({ expertId: z.number(), status: MarketExpertStatus }),
});
export type MarketExpertRegisterResponseType = z.infer<typeof MarketExpertRegisterResponse>;

// 본인 조회 — 계좌 포함(본인이니까). 타인에게는 이 스키마를 절대 쓰지 않는다.
export const MarketExpertMe = z.object({
  expertId: z.number(),
  expertType: MarketExpertType,
  displayName: z.string(),
  phone: z.string(),
  identityVerified: z.boolean(),
  careerRange: MarketCareerRange,
  contactHours: z.string().nullable(),
  region: MarketRegion.nullable(),
  travelRange: MarketTravelRange.nullable(),
  intro: z.string().nullable(),
  categories: z.array(MarketCategoryCode),
  cadTools: z.array(MarketCadToolCode),
  bankName: z.string().nullable(),
  bankHolder: z.string().nullable(),
  bankAccount: z.string().nullable(),
  status: MarketExpertStatus,
  statusReason: z.string().nullable(),
  decidedAt: z.string().nullable(), // ISO
  createdAt: z.string(), // ISO
  files: z.array(MarketFileMeta),
});
export type MarketExpertMeType = z.infer<typeof MarketExpertMe>;

export const MarketExpertMeResponse = z.object({
  result: z.literal(true),
  data: MarketExpertMe,
});
export type MarketExpertMeResponseType = z.infer<typeof MarketExpertMeResponse>;

// 공개 프로필(비로그인 열람 가능) — 연락처·계좌·mbId 는 스키마에 없다(자동 탈락).
export const MarketExpertPublic = z.object({
  expertId: z.number(),
  displayName: z.string(),
  expertType: MarketExpertType,
  careerRange: MarketCareerRange,
  region: MarketRegion.nullable(),
  categories: z.array(MarketCategoryCode),
  cadTools: z.array(MarketCadToolCode),
  intro: z.string().nullable(),
});
export type MarketExpertPublicType = z.infer<typeof MarketExpertPublic>;

export const MarketExpertListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  expertType: MarketExpertType.optional(),
  category: MarketCategoryCode.optional(),
  cadTool: MarketCadToolCode.optional(),
  q: z.string().optional(), // displayName·intro contains
});
export type MarketExpertListQueryType = z.infer<typeof MarketExpertListQuery>;

export const MarketExpertListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(MarketExpertPublic),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});
export type MarketExpertListResponseType = z.infer<typeof MarketExpertListResponse>;

export const MarketExpertDetailResponse = z.object({
  result: z.literal(true),
  data: MarketExpertPublic,
});
export type MarketExpertDetailResponseType = z.infer<typeof MarketExpertDetailResponse>;

// ── 프로젝트(의뢰) ───────────────────────────────────────────────────────────

// 견적 마감 — 프리셋 N일 뒤 or 지정 날짜(그 날 23:59:59 KST). 서버가 절대 시각으로 계산.
export const MarketProjectDeadline = z.union([
  z.object({ days: z.union([z.literal(3), z.literal(7), z.literal(14)]) }),
  z.object({ date: z.string().regex(DATE_RE) }),
]);
export type MarketProjectDeadlineType = z.infer<typeof MarketProjectDeadline>;

const marketProjectEditableShape = {
  title: z.string().trim().min(2).max(200),
  category: MarketProjectCategory,
  cadTools: z.array(MarketProjectCadCode).min(1).max(MARKET_PROJECT_CAD_CODES.length),
  description: z.string().trim().min(10).max(20000),
  ndaRequired: z.boolean().default(true),
  budgetRange: MarketBudgetRange,
  startHopeDate: z.string().regex(DATE_RE).optional(),
  dueHopeDate: z.string().regex(DATE_RE).optional(),
  deadline: MarketProjectDeadline,
} as const;

const cadAnyExclusive = (cadTools: readonly string[] | undefined): boolean =>
  cadTools === undefined || !cadTools.includes('any') || cadTools.length === 1;

// multipart 의 payload 파트(JSON 문자열). 파일 파트: attachment[](선택 — 권장이지만 강제 아님).
export const MarketProjectCreatePayload = z
  .object({
    ...marketProjectEditableShape,
    method: MarketProjectMethod,
    targetExpertId: z.number().int().positive().optional(), // targeted 필수 / open 금지
  })
  .refine((p) => cadAnyExclusive(p.cadTools), {
    message: "'상관없음'은 단독으로만 선택할 수 있습니다",
    path: ['cadTools'],
  })
  .superRefine((p, ctx) => {
    if (p.method === 'targeted' && p.targetExpertId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '지정견적은 대상 전문가가 필요합니다',
        path: ['targetExpertId'],
      });
    }
    if (p.method === 'open' && p.targetExpertId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '역견적은 대상 전문가를 지정할 수 없습니다',
        path: ['targetExpertId'],
      });
    }
  });
export type MarketProjectCreatePayloadType = z.infer<typeof MarketProjectCreatePayload>;

// 수정 — 입찰 0건 && bidding && 마감 전(라우트 가드). method/지정 대상은 변경 불가.
// 희망일은 null 로 비울 수 있다.
export const MarketProjectUpdateBody = z
  .object({
    title: marketProjectEditableShape.title,
    category: marketProjectEditableShape.category,
    cadTools: marketProjectEditableShape.cadTools,
    description: marketProjectEditableShape.description,
    ndaRequired: z.boolean(),
    budgetRange: marketProjectEditableShape.budgetRange,
    startHopeDate: z.string().regex(DATE_RE).nullable(),
    dueHopeDate: z.string().regex(DATE_RE).nullable(),
    deadline: MarketProjectDeadline,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: '최소 한 개 필드가 필요합니다' })
  .refine((b) => cadAnyExclusive(b.cadTools), {
    message: "'상관없음'은 단독으로만 선택할 수 있습니다",
    path: ['cadTools'],
  });
export type MarketProjectUpdateBodyType = z.infer<typeof MarketProjectUpdateBody>;

export const MarketProjectCreateResponse = z.object({
  result: z.literal(true),
  data: z.object({ projectId: z.number() }),
});
export type MarketProjectCreateResponseType = z.infer<typeof MarketProjectCreateResponse>;

export const MarketProjectListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
  // open=입찰 가능(bidding && 마감 전), closed=마감(수동 closed 포함 파생), awarded=선정 완료.
  tab: z.enum(['open', 'closed', 'awarded', 'all']).default('open'),
  category: MarketProjectCategory.optional(),
  method: MarketProjectMethod.optional(),
  q: z.string().optional(), // 제목·설명 contains
  sort: z.enum(['latest', 'deadline']).default('latest'),
});
export type MarketProjectListQueryType = z.infer<typeof MarketProjectListQuery>;

// 공개 목록 행 — 의뢰인은 마스킹된 표시명만(원명·mbId 는 응답에 없음), 입찰은 개수만(블라인드).
export const MarketProjectListItem = z.object({
  projectId: z.number(),
  title: z.string(),
  category: MarketProjectCategory,
  cadTools: z.array(MarketProjectCadCode),
  budgetRange: MarketBudgetRange,
  method: MarketProjectMethod,
  ndaRequired: z.boolean(),
  ownerName: z.string(), // maskName 적용값(예: 박*한)
  bidCount: z.number(), // withdrawn 제외
  viewCount: z.number(),
  bidDeadlineAt: z.string(), // ISO
  // 파생: "지금 입찰 접수 중인가"의 부정 — status!=bidding 이거나 마감 시각 경과면 true.
  biddingClosed: z.boolean(),
  status: MarketProjectStatus,
  createdAt: z.string(), // ISO
});
export type MarketProjectListItemType = z.infer<typeof MarketProjectListItem>;

export const MarketProjectListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(MarketProjectListItem),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});
export type MarketProjectListResponseType = z.infer<typeof MarketProjectListResponse>;

// 로그인 사용자 개인화(비로그인 null) — FE 는 이걸로 버튼 상태를 그리고,
// 실제 강제는 서버 가드가 한다(UI 숨김은 보안이 아니다).
export const MarketProjectViewer = z.object({
  isOwner: z.boolean(),
  isApprovedExpert: z.boolean(),
  isTargetExpert: z.boolean(), // targeted 에서 내가 지정 대상(open 이면 false)
  ndaSigned: z.boolean(),
  myBidStatus: MarketBidStatus.nullable(), // 내 입찰 없으면 null
});
export type MarketProjectViewerType = z.infer<typeof MarketProjectViewer>;

// 첨부 — NDA 게이트: 열람 자격이 없으면 files=null(개수만 노출, 파일명 자체가 기밀 힌트).
export const MarketProjectAttachments = z.object({
  count: z.number(),
  files: z.array(MarketFileMeta).nullable(),
});
export type MarketProjectAttachmentsType = z.infer<typeof MarketProjectAttachments>;

export const MarketProjectDetail = MarketProjectListItem.extend({
  description: z.string(),
  startHopeDate: z.string().nullable(),
  dueHopeDate: z.string().nullable(),
  awardedAt: z.string().nullable(), // ISO
  attachments: MarketProjectAttachments,
  ndaText: z.string(), // 현재 버전 NDA 문구(서명 모달 표시용)
  ndaTextVersion: z.string(),
  viewer: MarketProjectViewer.nullable(), // null = 비로그인
});
export type MarketProjectDetailType = z.infer<typeof MarketProjectDetail>;

export const MarketProjectDetailResponse = z.object({
  result: z.literal(true),
  data: MarketProjectDetail,
});
export type MarketProjectDetailResponseType = z.infer<typeof MarketProjectDetailResponse>;

// 내 의뢰 목록 — 본인 것이라 마스킹 없음(ownerName 은 그대로 마스킹값이지만 무의미).
export const MarketMyProjectListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z.enum(['all', 'bidding', 'awarded', 'closed', 'cancelled']).default('all'),
});
export type MarketMyProjectListQueryType = z.infer<typeof MarketMyProjectListQuery>;

export const MarketMyProjectListItem = MarketProjectListItem.extend({
  awardedBid: z
    .object({
      bidId: z.number(),
      amount: z.number(),
      expertDisplayName: z.string(),
    })
    .nullable(),
});
export type MarketMyProjectListItemType = z.infer<typeof MarketMyProjectListItem>;

export const MarketMyProjectListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(MarketMyProjectListItem),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});
export type MarketMyProjectListResponseType = z.infer<typeof MarketMyProjectListResponse>;

export const MarketProjectStatusResponse = z.object({
  result: z.literal(true),
  data: z.object({ projectId: z.number(), status: MarketProjectStatus }),
});
export type MarketProjectStatusResponseType = z.infer<typeof MarketProjectStatusResponse>;

export const MarketProjectFilesResponse = z.object({
  result: z.literal(true),
  data: z.object({ files: z.array(MarketFileMeta) }),
});
export type MarketProjectFilesResponseType = z.infer<typeof MarketProjectFilesResponse>;

// 파일 삭제 공용 응답 — 프로젝트 첨부·전문가 증빙 모두 사용.
export const MarketFileDeleteResponse = z.object({
  result: z.literal(true),
  data: z.object({ fileId: z.number() }),
});
export type MarketFileDeleteResponseType = z.infer<typeof MarketFileDeleteResponse>;

// ── NDA ─────────────────────────────────────────────────────────────────────

export const MarketNdaSignBody = z.object({
  agree: z.literal(true),
  signedName: z.string().trim().min(2).max(100), // 감사 스냅샷(회원 탈퇴 후에도 보존)
});
export type MarketNdaSignBodyType = z.infer<typeof MarketNdaSignBody>;

export const MarketNdaSignResponse = z.object({
  result: z.literal(true),
  data: z.object({
    projectId: z.number(),
    signedAt: z.string(), // ISO (재서명 요청은 멱등 — 기존 기록 반환)
    textVersion: z.string(),
  }),
});
export type MarketNdaSignResponseType = z.infer<typeof MarketNdaSignResponse>;

// ── 입찰(견적 제출) ──────────────────────────────────────────────────────────

// 제출·재제출(PATCH) 공용 — 재제출은 전체 필드 교체(소규모 폼이라 부분 갱신 불필요).
export const MarketBidSubmitBody = z.object({
  amount: z.number().int().positive().max(2_000_000_000), // 원 단위 KRW
  durationDays: z.number().int().positive().max(3650),
  warranty: z.string().trim().max(255).optional(), // 하자보수 문구(예: 납품 후 90일)
  message: z.string().trim().min(10).max(10000), // 제안 메시지
});
export type MarketBidSubmitBodyType = z.infer<typeof MarketBidSubmitBody>;

export const MarketMyBid = z.object({
  bidId: z.number(),
  projectId: z.number(),
  amount: z.number(),
  durationDays: z.number(),
  warranty: z.string().nullable(),
  message: z.string(),
  status: MarketBidStatus,
  createdAt: z.string(), // ISO
  updatedAt: z.string(), // ISO (재제출 최종 시각)
});
export type MarketMyBidType = z.infer<typeof MarketMyBid>;

// data=null → 아직 이 프로젝트에 내 입찰 없음(404 대신 — FE 분기 단순화).
export const MarketMyBidResponse = z.object({
  result: z.literal(true),
  data: MarketMyBid.nullable(),
});
export type MarketMyBidResponseType = z.infer<typeof MarketMyBidResponse>;

export const MarketBidSubmitResponse = z.object({
  result: z.literal(true),
  data: MarketMyBid,
});
export type MarketBidSubmitResponseType = z.infer<typeof MarketBidSubmitResponse>;

// 소유자 전용 비교 목록(블라인드의 핵심 지점) — 전문가 연락처·mbId 는 없다(채택 전
// 우회 직거래 차단). 채택 후 연락은 2차(메시지룸/계약)에서 열린다.
export const MarketProjectBidItem = z.object({
  bidId: z.number(),
  amount: z.number(),
  durationDays: z.number(),
  warranty: z.string().nullable(),
  message: z.string(),
  status: MarketBidStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
  expert: z.object({
    expertId: z.number(),
    displayName: z.string(),
    expertType: MarketExpertType,
    careerRange: MarketCareerRange,
    region: MarketRegion.nullable(),
  }),
});
export type MarketProjectBidItemType = z.infer<typeof MarketProjectBidItem>;

export const MarketProjectBidsResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(MarketProjectBidItem) }),
});
export type MarketProjectBidsResponseType = z.infer<typeof MarketProjectBidsResponse>;

export const MarketAwardResponse = z.object({
  result: z.literal(true),
  data: z.object({
    projectId: z.number(),
    status: MarketProjectStatus, // awarded
    awardedBidId: z.number(),
    awardedAt: z.string(), // ISO
  }),
});
export type MarketAwardResponseType = z.infer<typeof MarketAwardResponse>;

export const MarketBidWithdrawResponse = z.object({
  result: z.literal(true),
  data: z.object({ bidId: z.number(), status: MarketBidStatus }),
});
export type MarketBidWithdrawResponseType = z.infer<typeof MarketBidWithdrawResponse>;

// 내 입찰 목록(전문가).
export const MarketMyBidListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: MarketBidStatus.optional(),
});
export type MarketMyBidListQueryType = z.infer<typeof MarketMyBidListQuery>;

export const MarketMyBidListItem = z.object({
  bidId: z.number(),
  amount: z.number(),
  durationDays: z.number(),
  status: MarketBidStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
  project: z.object({
    projectId: z.number(),
    title: z.string(),
    status: MarketProjectStatus,
    biddingClosed: z.boolean(),
    bidDeadlineAt: z.string(),
    method: MarketProjectMethod,
  }),
});
export type MarketMyBidListItemType = z.infer<typeof MarketMyBidListItem>;

export const MarketMyBidListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(MarketMyBidListItem),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});
export type MarketMyBidListResponseType = z.infer<typeof MarketMyBidListResponse>;

// 나를 지정한 의뢰 인박스(전문가) — 목록 행 + 내 입찰 상태.
export const MarketTargetedProjectListItem = MarketProjectListItem.extend({
  myBidStatus: MarketBidStatus.nullable(),
});
export type MarketTargetedProjectListItemType = z.infer<typeof MarketTargetedProjectListItem>;

export const MarketTargetedProjectListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(MarketTargetedProjectListItem),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});
export type MarketTargetedProjectListResponseType = z.infer<
  typeof MarketTargetedProjectListResponse
>;

// ── 마켓 설정 ────────────────────────────────────────────────────────────────

// 수수료율 basis point(1000=10.00%) — 전문가 측 단일 공제(2026-07-08 정책 확정).
export const MarketSettings = z.object({
  feeRateBp: z.number().int().min(0).max(10000),
});
export type MarketSettingsType = z.infer<typeof MarketSettings>;

export const MarketSettingsResponse = z.object({
  result: z.literal(true),
  data: MarketSettings,
});
export type MarketSettingsResponseType = z.infer<typeof MarketSettingsResponse>;

// ── 관리자: 전문가 심사 ──────────────────────────────────────────────────────

export const AdminMarketExpertListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z.enum(['all', 'pending', 'approved', 'rejected', 'suspended']).default('pending'),
  q: z.string().optional(), // displayName·mbId contains
});
export type AdminMarketExpertListQueryType = z.infer<typeof AdminMarketExpertListQuery>;

// 탭 카운트 — 검색어 반영, 탭 자체는 미반영(회원 관리 관례).
export const AdminMarketExpertCounts = z.object({
  all: z.number(),
  pending: z.number(),
  approved: z.number(),
  rejected: z.number(),
  suspended: z.number(),
});
export type AdminMarketExpertCountsType = z.infer<typeof AdminMarketExpertCounts>;

export const AdminMarketExpertListItem = z.object({
  expertId: z.number(),
  mbId: z.string(), // 관리자는 원 식별자 열람(운영 감독)
  displayName: z.string(),
  expertType: MarketExpertType,
  careerRange: MarketCareerRange,
  region: MarketRegion.nullable(),
  status: MarketExpertStatus,
  identityVerified: z.boolean(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  member: z
    .object({
      name: z.string(),
      nick: z.string(),
      email: z.string(),
      hp: z.string(),
    })
    .nullable(), // g5_member 표시정보(탈퇴 등으로 없을 수 있음)
});
export type AdminMarketExpertListItemType = z.infer<typeof AdminMarketExpertListItem>;

export const AdminMarketExpertListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminMarketExpertListItem),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    counts: AdminMarketExpertCounts,
  }),
});
export type AdminMarketExpertListResponseType = z.infer<typeof AdminMarketExpertListResponse>;

export const AdminMarketExpertDetail = AdminMarketExpertListItem.extend({
  phone: z.string(),
  contactHours: z.string().nullable(),
  travelRange: MarketTravelRange.nullable(),
  intro: z.string().nullable(),
  categories: z.array(MarketCategoryCode),
  cadTools: z.array(MarketCadToolCode),
  bankName: z.string().nullable(),
  bankHolder: z.string().nullable(),
  bankAccount: z.string().nullable(),
  termsAgreedAt: z.string(),
  statusReason: z.string().nullable(),
  decidedBy: z.string().nullable(),
  files: z.array(MarketFileMeta), // 증빙(license/portfolio/bizreg) — 다운로드는 adminMarketFiles
});
export type AdminMarketExpertDetailType = z.infer<typeof AdminMarketExpertDetail>;

export const AdminMarketExpertDetailResponse = z.object({
  result: z.literal(true),
  data: AdminMarketExpertDetail,
});
export type AdminMarketExpertDetailResponseType = z.infer<typeof AdminMarketExpertDetailResponse>;

// reject/suspend 는 사유 필수(신청자 통지·감사 기록).
export const AdminMarketExpertDecisionBody = z.object({
  reason: z.string().trim().min(1).max(255),
});
export type AdminMarketExpertDecisionBodyType = z.infer<typeof AdminMarketExpertDecisionBody>;

export const AdminMarketExpertDecisionResponse = z.object({
  result: z.literal(true),
  data: z.object({
    expertId: z.number(),
    status: MarketExpertStatus,
    statusReason: z.string().nullable(),
  }),
});
export type AdminMarketExpertDecisionResponseType = z.infer<
  typeof AdminMarketExpertDecisionResponse
>;

// ── 관리자: 프로젝트 모니터 ──────────────────────────────────────────────────

export const AdminMarketProjectListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z.enum(['all', 'bidding', 'awarded', 'closed', 'cancelled']).default('all'),
  method: MarketProjectMethod.optional(),
  q: z.string().optional(), // 제목·의뢰인 mbId contains
});
export type AdminMarketProjectListQueryType = z.infer<typeof AdminMarketProjectListQuery>;

export const AdminMarketProjectCounts = z.object({
  all: z.number(),
  bidding: z.number(),
  awarded: z.number(),
  closed: z.number(),
  cancelled: z.number(),
});
export type AdminMarketProjectCountsType = z.infer<typeof AdminMarketProjectCounts>;

// 관리자는 블라인드·마스킹 예외(운영 감독) — 의뢰인 원명·이메일 노출.
export const AdminMarketProjectListItem = z.object({
  projectId: z.number(),
  title: z.string(),
  category: MarketProjectCategory,
  method: MarketProjectMethod,
  status: MarketProjectStatus,
  ndaRequired: z.boolean(),
  bidCount: z.number(),
  viewCount: z.number(),
  bidDeadlineAt: z.string(),
  biddingClosed: z.boolean(),
  createdAt: z.string(),
  awardedAt: z.string().nullable(),
  owner: z.object({
    mbId: z.string(),
    name: z.string(),
    email: z.string().nullable(),
  }),
});
export type AdminMarketProjectListItemType = z.infer<typeof AdminMarketProjectListItem>;

export const AdminMarketProjectListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminMarketProjectListItem),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    counts: AdminMarketProjectCounts,
  }),
});
export type AdminMarketProjectListResponseType = z.infer<typeof AdminMarketProjectListResponse>;

export const AdminMarketBidItem = MarketProjectBidItem.extend({
  mbId: z.string(), // 입찰 전문가 회원 식별자(관리자 전용)
});
export type AdminMarketBidItemType = z.infer<typeof AdminMarketBidItem>;

export const AdminMarketProjectDetail = AdminMarketProjectListItem.extend({
  cadTools: z.array(MarketProjectCadCode),
  budgetRange: MarketBudgetRange,
  description: z.string(),
  startHopeDate: z.string().nullable(),
  dueHopeDate: z.string().nullable(),
  targetExpert: z
    .object({ expertId: z.number(), displayName: z.string(), mbId: z.string() })
    .nullable(),
  awardedBidId: z.number().nullable(),
  attachments: z.array(MarketFileMeta),
  bids: z.array(AdminMarketBidItem),
  ndaSigns: z.array(
    z.object({
      mbId: z.string(),
      signedName: z.string(),
      textVersion: z.string(),
      signedAt: z.string(),
    }),
  ),
});
export type AdminMarketProjectDetailType = z.infer<typeof AdminMarketProjectDetail>;

export const AdminMarketProjectDetailResponse = z.object({
  result: z.literal(true),
  data: AdminMarketProjectDetail,
});
export type AdminMarketProjectDetailResponseType = z.infer<typeof AdminMarketProjectDetailResponse>;
