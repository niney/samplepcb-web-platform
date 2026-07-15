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

// 'firmware'·'software' 는 serviceArea 와 동어반복이라 신규 선택 UI(의뢰 STEP2·전문가 폼)에서
// 숨긴다. enum 에는 잔존 — 기존 전문가 태그 표시·검증 호환용.
export const MARKET_HIDDEN_CATEGORIES = ['firmware', 'software'] as const;
export const MARKET_ACTIVE_CATEGORIES = MARKET_CATEGORIES.filter(
  (c): c is Exclude<MarketCategoryCodeType, (typeof MARKET_HIDDEN_CATEGORIES)[number]> =>
    !(MARKET_HIDDEN_CATEGORIES as readonly string[]).includes(c),
);

// 요구 툴 코드(전문가 보유 스킬 겸 프로젝트 요구 조건) — ECAD·MCAD·디자인 통합 flat 배열.
// DB 물리 컬럼·계약 필드명은 'cadTools' 그대로 유지(호환) — 의미는 "요구 툴 코드 배열"이다.
// 그룹핑은 저장이 아니라 UI 노출·해석 단계에서 MARKET_TOOL_GROUP_CODES 로 한다.
export const MARKET_ECAD_TOOLS = ['altium', 'pads', 'orcad', 'xpedition', 'kicad'] as const;
export const MARKET_MCAD_TOOLS = [
  'solidworks',
  'fusion360',
  'catia',
  'inventor',
  'nx',
  'creo',
  'autocad',
] as const;
export const MARKET_DESIGN_TOOLS = ['rhino', 'keyshot', 'blender', '3dsmax'] as const;
// 'etc' 는 전 그룹 공용 레거시 코드 — 신규 그룹 UI 에는 노출하지 않는다(미선택=무관 원칙과 중복).
export const MARKET_TOOL_CODES = [
  ...MARKET_ECAD_TOOLS,
  ...MARKET_MCAD_TOOLS,
  ...MARKET_DESIGN_TOOLS,
  'etc',
] as const;
export type MarketToolCodeType = (typeof MARKET_TOOL_CODES)[number];
export const MarketToolCode = z.enum(MARKET_TOOL_CODES);

// 'any'(상관없음)는 레거시 프로젝트 데이터 호환용으로만 enum 에 잔존 —
// 신규 UI/저장은 "빈 배열 = 특정 툴 요구 없음"으로 표현한다(마이그레이션에서 ['any']→[] 백필).
export const MARKET_PROJECT_TOOL_CODES = ['any', ...MARKET_TOOL_CODES] as const;
export type MarketProjectToolCodeType = (typeof MARKET_PROJECT_TOOL_CODES)[number];
export const MarketProjectToolCode = z.enum(MARKET_PROJECT_TOOL_CODES);

export const MARKET_TOOL_LABELS = {
  any: '상관없음',
  altium: 'Altium Designer',
  pads: 'PADS',
  orcad: 'OrCAD·Allegro',
  xpedition: 'Xpedition (Mentor)',
  kicad: 'KiCad',
  solidworks: 'SolidWorks',
  fusion360: 'Fusion 360',
  catia: 'CATIA',
  inventor: 'Inventor',
  nx: 'NX (Siemens)',
  creo: 'Creo',
  autocad: 'AutoCAD',
  rhino: 'Rhino',
  keyshot: 'KeyShot',
  blender: 'Blender',
  '3dsmax': '3ds Max',
  etc: '기타',
} as const satisfies Record<MarketProjectToolCodeType, string>;

// 툴 그룹 — 의뢰 STEP2·전문가 폼의 섹션 단위. area → 그룹 → 코드 2단 사전이라
// 회로+PCB 를 함께 선택해도 ecad 그룹은 합집합 계산에서 한 번만 노출된다.
export const MARKET_TOOL_GROUPS = ['ecad', 'mcad', 'design'] as const;
export type MarketToolGroupType = (typeof MARKET_TOOL_GROUPS)[number];

export const MARKET_TOOL_GROUP_LABELS = {
  ecad: 'PCB·회로 CAD',
  mcad: '기구 설계 CAD',
  design: '디자인·렌더링 툴',
} as const satisfies Record<MarketToolGroupType, string>;

export const MARKET_TOOL_GROUP_CODES = {
  ecad: MARKET_ECAD_TOOLS,
  mcad: MARKET_MCAD_TOOLS,
  design: MARKET_DESIGN_TOOLS,
} as const satisfies Record<MarketToolGroupType, readonly MarketToolCodeType[]>;

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

// 의뢰 유형(프로젝트 성격)과 실제 작업 분야는 서로 다른 축이다.
export const MARKET_REQUEST_TYPES = ['system', 'individual'] as const;
export const MarketRequestType = z.enum(MARKET_REQUEST_TYPES);
export type MarketRequestTypeType = z.infer<typeof MarketRequestType>;
export const MARKET_REQUEST_TYPE_LABELS = {
  system: '시스템 통합 개발',
  individual: '개별 분야 개발',
} as const satisfies Record<MarketRequestTypeType, string>;

export const MARKET_SERVICE_AREAS = [
  'circuit',
  'pcb',
  'firmware',
  'product-design',
  'mechanical-design',
  'app',
  'server',
  'software-linux',
  'software-windows',
  'etc',
] as const;
export const MarketServiceArea = z.enum(MARKET_SERVICE_AREAS);
export type MarketServiceAreaType = z.infer<typeof MarketServiceArea>;
export const MARKET_SERVICE_AREA_LABELS = {
  circuit: '회로 개발',
  pcb: 'PCB 설계',
  firmware: '펌웨어 개발',
  'product-design': '제품 디자인',
  'mechanical-design': '기구 설계',
  app: '앱 개발',
  server: '서버 개발',
  'software-linux': '소프트웨어 개발 · Linux',
  'software-windows': '소프트웨어 개발 · Windows',
  etc: '기타',
} as const satisfies Record<MarketServiceAreaType, string>;

// ── 분야 → STEP2 질문 그룹 사전 ─────────────────────────────────────────────
// 의뢰 STEP2("전문 기술·도구")는 선택한 분야를 이 두 사전으로 해석해 섹션을 구성한다.
// 사전에 없는 분야(앱·서버·SW·기타)는 물을 것이 없다 — 전 분야가 그러면 STEP2 자체를 스텝
// 목록에서 제거한다(빈 스텝 노출 금지).

// 분야 → 요구 툴 그룹(합집합·중복 제거는 UI 계산).
export const MARKET_AREA_TOOL_GROUPS: Partial<
  Record<MarketServiceAreaType, readonly MarketToolGroupType[]>
> = {
  circuit: ['ecad'],
  pcb: ['ecad'],
  'mechanical-design': ['mcad'],
  'product-design': ['design'],
};

// 분야 → 노출 세부분야(저장 enum 은 MARKET_CATEGORIES 재사용 — 노출만 부분집합).
// 'mcu'(AVR·마이컴 회로)처럼 양쪽 성격인 코드는 중복 소속 허용(합집합 계산이라 무해).
export const MARKET_AREA_SPECIALTIES: Partial<
  Record<MarketServiceAreaType, readonly MarketCategoryCodeType[]>
> = {
  circuit: [
    'arduino',
    'mcu',
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
  ],
  firmware: [
    'arduino',
    'mcu',
    'fpga',
    'digital',
    'motor',
    'plc',
    'robot',
    'led',
    'bms',
    'defense',
    'etc',
  ],
};

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

// ── 계약(2차: 결제·검수·정산) ────────────────────────────────────────────────
// 채택(award) 시 프로젝트당 1건 생성 → 의뢰인 결제(영카트 재사용) → 전문가 납품 →
// 의뢰인 검수(또는 7일 자동확정) → 관리자 정산. 상태·라벨은 이 파일이 단일 정본.
// 민감값(전문가 계좌·pathToken)은 당사자 스키마에 두지 않는다 — 계좌는 Admin Detail 만.

// 계약 상태 머신. cancelled = pending 의뢰인 취소 · paid 이후 관리자 운영 취소.
export const MARKET_CONTRACT_STATUSES = [
  'pending',
  'paid',
  'delivered',
  'completed',
  'settled',
  'cancelled',
] as const;
export type MarketContractStatusType = (typeof MARKET_CONTRACT_STATUSES)[number];
export const MarketContractStatus = z.enum(MARKET_CONTRACT_STATUSES);

export const MARKET_CONTRACT_STATUS_LABELS = {
  pending: '결제 대기',
  paid: '작업 진행중',
  delivered: '납품 완료',
  completed: '검수 확정',
  settled: '정산 완료',
  cancelled: '취소',
} as const satisfies Record<MarketContractStatusType, string>;

// confirmedBy — 검수 확정 주체(client=의뢰인 수동 / auto=7일 자동확정). 라벨 불요.
export const MARKET_CONFIRM_TYPES = ['client', 'auto'] as const;
export type MarketConfirmTypeType = (typeof MARKET_CONFIRM_TYPES)[number];
export const MarketConfirmType = z.enum(MARKET_CONFIRM_TYPES);

// 산출물 파일 메타 — 1차 첨부(MarketFileMeta)와 동일 모양(fileType='deliverable').
// pathToken 비노출 불변식 유지. 별칭으로 계약 도메인 의도를 명시한다.
export const MarketContractFileMeta = MarketFileMeta;
export type MarketContractFileMetaType = MarketFileMetaType;

// 결제 파생 정보(영카트 주문 존재 시만) — od 헤더에서 실시간 파생(저장 아님).
// 무통장 입금 대기 안내 + 단방향 승격 래칫과 od 현재 상태의 괴리 가시화.
export const MarketContractPayment = z.object({
  odId: z.string(),
  odStatus: z.string(),
  settleCase: z.string(),
  receiptPrice: z.number().int(),
  misu: z.number().int(),
});
export type MarketContractPaymentType = z.infer<typeof MarketContractPayment>;

// 당사자용 계약 상세(의뢰인·채택 전문가). payout·feeAmount·feeRateBp 는 필드로 항상
// 존재하되, 의뢰인에게 노출할지는 서버 DTO(W2)가 값 구성으로 결정한다.
export const MarketContract = z.object({
  contractId: z.number(),
  projectId: z.number(),
  bidId: z.number(),
  status: MarketContractStatus,
  amount: z.number().int(), // VAT 포함 총액
  feeRateBp: z.number().int(), // 채택 시점 스냅샷
  feeAmount: z.number().int(),
  payoutAmount: z.number().int(),
  paidAt: z.string().nullable(), // ISO
  deliveredAt: z.string().nullable(),
  deliveryNote: z.string().nullable(),
  completedAt: z.string().nullable(),
  confirmedBy: MarketConfirmType.nullable(),
  settledAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  requestSnapshotAt: z.string().nullable(), // 채택 시점 의뢰·산출물 스냅샷 캡처 시각
  // 서버 파생 = deliveredAt+7d. delivered ∧ hold 아닐 때만 값(자동확정 D-day 표시).
  autoConfirmAt: z.string().nullable(),
  files: z.array(MarketContractFileMeta),
  payment: MarketContractPayment.nullable(),
});
export type MarketContractType = z.infer<typeof MarketContract>;

// 뷰어·목록용 경량 요약(프로젝트 상세 viewer 에 부착).
export const MarketContractSummary = z.object({
  contractId: z.number(),
  status: MarketContractStatus,
  amount: z.number().int(),
  deliveredAt: z.string().nullable(),
  autoConfirmAt: z.string().nullable(),
});
export type MarketContractSummaryType = z.infer<typeof MarketContractSummary>;

// FE 파싱용 응답 스키마(회원 라우트는 fastify response 스키마 미선언 — 1차 관례).
export const MarketContractResponse = z.object({
  result: z.literal(true),
  data: MarketContract,
});
export type MarketContractResponseType = z.infer<typeof MarketContractResponse>;

export const MarketCheckoutResponse = z.object({
  result: z.literal(true),
  data: z.object({ redirectUrl: z.string() }),
});
export type MarketCheckoutResponseType = z.infer<typeof MarketCheckoutResponse>;

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
  serviceAreas: z.array(MarketServiceArea).min(1).max(MARKET_SERVICE_AREAS.length),
  categories: z.array(MarketCategoryCode).max(MARKET_CATEGORIES.length).default([]),
  cadTools: z.array(MarketToolCode).max(MARKET_TOOL_CODES.length).default([]),
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
  ;
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
  serviceAreas: z.array(MarketServiceArea),
  categories: z.array(MarketCategoryCode),
  cadTools: z.array(MarketToolCode),
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
  serviceAreas: z.array(MarketServiceArea),
  categories: z.array(MarketCategoryCode),
  cadTools: z.array(MarketToolCode),
  intro: z.string().nullable(),
});
export type MarketExpertPublicType = z.infer<typeof MarketExpertPublic>;

export const MarketExpertListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  expertType: MarketExpertType.optional(),
  serviceArea: MarketServiceArea.optional(),
  category: MarketCategoryCode.optional(),
  cadTool: MarketToolCode.optional(),
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

// ── 분야별 포스팅 카드(Phase 3) — market.request-postings 산출 ───────────────
// 단일 의뢰를 유지한 채(사용자 확정 — 분리 입찰 아님) 분야별 전문가 관점의 요약 카드를
// 상세에 표시한다. 공개 범위는 description 과 동일. ai.ts 가 market.ts 를 import 하는
// 방향이므로 여기 정의(역방향 순환 금지).
export const MarketPostingCard = z.object({
  serviceArea: MarketServiceArea,
  summary: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  scope: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
  // .catch 는 vue-tsc 추론이 unknown 으로 무너져 .default 사용(누락만 보정, 파손은 재시도).
  deliverables: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  notes: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
});
export type MarketPostingCardType = z.infer<typeof MarketPostingCard>;
export const MarketPostingCards = z
  .array(MarketPostingCard)
  .min(1)
  .max(MARKET_SERVICE_AREAS.length);
export type MarketPostingCardsType = z.infer<typeof MarketPostingCards>;

export const MarketAiInterviewAnswer = z.object({
  code: z.string().trim().min(1).max(30),
  answer: z.string().trim().min(1).max(2000),
});
export type MarketAiInterviewAnswerType = z.infer<typeof MarketAiInterviewAnswer>;

// AI 산출물 출처 표시 — 저장 메타데이터와 현재 산출물 해시를 서버가 대조한 결과만 응답한다.
// 메타데이터가 없는 레거시/직접 입력은 unverified, 생성 뒤 원천·출력이 달라지면 customer-modified.
export const MarketAiArtifactProvenance = z.object({
  state: z.enum(['ai-generated', 'deterministic', 'customer-modified', 'unverified']),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  generatedAt: z.string().nullable(),
});
export type MarketAiArtifactProvenanceType = z.infer<typeof MarketAiArtifactProvenance>;

export const MarketAiProvenance = z.object({
  diagramSpec: MarketAiArtifactProvenance.nullable(),
  diagramHtml: MarketAiArtifactProvenance.nullable(),
  rocMd: MarketAiArtifactProvenance.nullable(),
  postings: MarketAiArtifactProvenance.nullable(),
});
export type MarketAiProvenanceType = z.infer<typeof MarketAiProvenance>;

const marketProjectEditableShape = {
  title: z.string().trim().min(2).max(200),
  requestType: MarketRequestType,
  serviceAreas: z.array(MarketServiceArea).max(MARKET_SERVICE_AREAS.length),
  // 세부분야(회로·펌웨어) — 빈 배열 = 지정 없음. 분야-코드 정합성은 클라 pruning 신뢰(서버는 enum 만).
  categories: z.array(MarketCategoryCode).max(MARKET_CATEGORIES.length).default([]),
  // 빈 배열 = 특정 툴 요구 없음('any' 는 레거시 데이터에만 존재).
  cadTools: z.array(MarketProjectToolCode).max(MARKET_PROJECT_TOOL_CODES.length),
  description: z.string().trim().min(10).max(20000),
  // 시스템 구성도 단일 HTML — DiagramSpec 결정적 렌더 또는 전자 분야 legacy AI 산출.
  // 공개 범위는 description 과 동일. 렌더는 반드시 sandbox iframe(srcdoc).
  diagramHtml: z.string().max(512_000).optional(),
  // 구성 명세 JSON(DiagramSpec 직렬화 — market.request-structurize 산출). 구성도의
  // 원천 데이터로, 재생성·후속 문서(ROC·포스팅 요약) 파생의 근원. 공개 범위 동일.
  diagramSpec: z.string().max(200_000).optional(),
  // 작업검토지시서 마크다운(market.request-roc 산출, Phase 2) — 견적 낼 전문가·검수자용.
  // 공개 범위는 description 과 동일. 렌더는 이스케이프 라인 파서(v-html 금지).
  rocMd: z.string().max(200_000).optional(),
  // 인터뷰 답변 원본(ai.ts AiInterviewAnswer 와 동형 — ai.ts 가 market.ts 를 import 하는
  // 순환을 피해 인라인 정의). 어떤 응답에도 노출하지 않는 저장 전용 원천 데이터 —
  // 향후 명세·문서 재생성(Phase 3)의 근원.
  interviewAnswers: z
    .array(MarketAiInterviewAnswer)
    .max(60)
    .optional(),
  // 답변 원문을 견적 가능한 전문가에게 공개한다는 신규 등록 시점의 명시 동의.
  shareInterviewAnswers: z.literal(true).optional(),
  // 분야별 포스팅 카드(Phase 3) — 서버가 의뢰 분야 밖 카드를 걸러 저장.
  postings: MarketPostingCards.optional(),
  // 서버가 인메모리 잡의 소유자·유스케이스·입력·출력을 직접 대조하는 참조값이다.
  // 이 필드 자체는 출처 메타데이터로 신뢰하거나 DB에 그대로 저장하지 않는다.
  aiJobIds: z
    .object({
      structurize: z.string().uuid().optional(),
      legacyDiagram: z.string().uuid().optional(),
      roc: z.string().uuid().optional(),
      postings: z.string().uuid().optional(),
    })
    .optional(),
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
    if (p.requestType === 'individual' && p.serviceAreas.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '개별 분야 개발은 개발 분야를 1개 선택해야 합니다',
        path: ['serviceAreas'],
      });
    }
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
    if (p.diagramSpec === undefined && p.rocMd !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '작업검토지시서는 구성 명세가 필요합니다',
        path: ['rocMd'],
      });
    }
    if (p.diagramSpec === undefined && p.postings !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '분야별 작업 안내 카드는 구성 명세가 필요합니다',
        path: ['postings'],
      });
    }
    if ((p.interviewAnswers?.length ?? 0) > 0 && p.shareInterviewAnswers !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AI 인터뷰 답변을 저장하려면 전문가 공개 동의가 필요합니다',
        path: ['shareInterviewAnswers'],
      });
    }
  });
export type MarketProjectCreatePayloadType = z.infer<typeof MarketProjectCreatePayload>;

// 수정 — 입찰 0건 && bidding && 마감 전(라우트 가드). method/지정 대상은 변경 불가.
// 희망일은 null 로 비울 수 있다.
export const MarketProjectUpdateBody = z
  .object({
    title: marketProjectEditableShape.title,
    requestType: marketProjectEditableShape.requestType,
    serviceAreas: marketProjectEditableShape.serviceAreas,
    categories: z.array(MarketCategoryCode).max(MARKET_CATEGORIES.length), // default 없이 — 미전송=변경 없음
    cadTools: marketProjectEditableShape.cadTools,
    description: marketProjectEditableShape.description,
    diagramHtml: z.string().max(512_000).nullable(), // null = 구성도 제거(spec 도 함께 제거됨)
    diagramSpec: z.string().max(200_000).nullable(),
    rocMd: z.string().max(200_000).nullable(), // null = 지시서 제거(spec 제거 시 동반 제거)
    postings: MarketPostingCards.nullable(), // null = 카드 제거(spec 제거 시 동반 제거)
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
  })
  .refine(
    (b) => b.requestType === undefined || b.serviceAreas === undefined || b.requestType !== 'individual' || b.serviceAreas.length === 1,
    { message: '개별 분야 개발은 개발 분야를 1개 선택해야 합니다', path: ['serviceAreas'] },
  )
  .superRefine((b, ctx) => {
    if (b.diagramSpec === null && b.rocMd !== undefined && b.rocMd !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '구성 명세를 제거하면서 작업검토지시서를 유지할 수 없습니다',
        path: ['rocMd'],
      });
    }
    if (b.diagramSpec === null && b.postings !== undefined && b.postings !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '구성 명세를 제거하면서 분야별 작업 안내 카드를 유지할 수 없습니다',
        path: ['postings'],
      });
    }
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
  requestType: MarketRequestType.optional(),
  serviceArea: MarketServiceArea.optional(),
  method: MarketProjectMethod.optional(),
  q: z.string().optional(), // 제목·설명 contains
  sort: z.enum(['latest', 'deadline']).default('latest'),
});
export type MarketProjectListQueryType = z.infer<typeof MarketProjectListQuery>;

// 공개 목록 행 — 의뢰인은 마스킹된 표시명만(원명·mbId 는 응답에 없음), 입찰은 개수만(블라인드).
export const MarketProjectListItem = z.object({
  projectId: z.number(),
  title: z.string(),
  requestType: MarketRequestType,
  serviceAreas: z.array(MarketServiceArea),
  categories: z.array(MarketCategoryCode),
  cadTools: z.array(MarketProjectToolCode),
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
  contract: MarketContractSummary.nullable(), // 당사자(의뢰인·채택 전문가) 아니면 null
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
  diagramHtml: z.string().nullable(), // 자동 생성 구성도 — sandbox iframe 렌더 전용
  diagramSpec: z.string().nullable(), // 구성 명세 JSON — 공개 범위는 description 동일
  rocMd: z.string().nullable(), // AI 작업검토지시서 — 공개 범위는 description 동일
  postings: MarketPostingCards.nullable(), // 분야별 포스팅 카드 — 공개 범위 동일
  aiProvenance: MarketAiProvenance,
  interviewAnswers: z.array(MarketAiInterviewAnswer).nullable(),
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
  tab: z
    .enum(['all', 'bidding', 'awarded', 'working', 'completed', 'closed', 'cancelled'])
    .default('all'),
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
  contractStatus: MarketContractStatus.nullable(), // 계약 없으면(미채택) null
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
  contractStatus: MarketContractStatus.nullable(), // 채택 계약 없으면 null
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
  serviceAreas: z.array(MarketServiceArea),
  categories: z.array(MarketCategoryCode),
  cadTools: z.array(MarketToolCode),
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
  requestType: MarketRequestType,
  serviceAreas: z.array(MarketServiceArea),
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
  categories: z.array(MarketCategoryCode),
  cadTools: z.array(MarketProjectToolCode),
  budgetRange: MarketBudgetRange,
  description: z.string(),
  diagramHtml: z.string().nullable(),
  diagramSpec: z.string().nullable(),
  rocMd: z.string().nullable(),
  postings: MarketPostingCards.nullable(),
  aiProvenance: MarketAiProvenance,
  interviewAnswers: z.array(MarketAiInterviewAnswer).nullable(),
  interviewAnswersSharedAt: z.string().nullable(),
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

// ── 관리자: 계약(2차) ────────────────────────────────────────────────────────
// requireAdmin 뒤. 관리자는 블라인드·마스킹 예외(운영 감독) — 당사자 원 식별자·계좌 노출.

export const AdminMarketContractListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z
    .enum(['all', 'pending', 'paid', 'delivered', 'completed', 'settled', 'cancelled'])
    .default('all'),
  q: z.string().optional(), // 프로젝트명·의뢰인/전문가 mbId contains
});
export type AdminMarketContractListQueryType = z.infer<typeof AdminMarketContractListQuery>;

// 탭 카운트 — 검색어 반영, 탭 자체는 미반영(관리자 목록 관례).
export const AdminMarketContractCounts = z.object({
  all: z.number(),
  pending: z.number(),
  paid: z.number(),
  delivered: z.number(),
  completed: z.number(),
  settled: z.number(),
  cancelled: z.number(),
});
export type AdminMarketContractCountsType = z.infer<typeof AdminMarketContractCounts>;

// 목록 행 — 계약 scalar 전부 + 프로젝트/당사자 표시 + hold(자동확정 정지).
// 장문(deliveryNote)·계좌·정산메모·산출물·결제파생은 Detail 에서(목록 경량화 관례).
export const AdminMarketContractListItem = z.object({
  contractId: z.number(),
  projectId: z.number(),
  bidId: z.number(),
  projectTitle: z.string(),
  clientMbId: z.string(),
  clientName: z.string(), // g5_member 표시명(탈퇴 시 '')
  expertDisplayName: z.string(),
  status: MarketContractStatus,
  amount: z.number().int(),
  feeRateBp: z.number().int(),
  feeAmount: z.number().int(),
  payoutAmount: z.number().int(),
  paidAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  confirmedBy: MarketConfirmType.nullable(),
  holdAt: z.string().nullable(),
  holdReason: z.string().nullable(),
  settledAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  autoConfirmAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminMarketContractListItemType = z.infer<typeof AdminMarketContractListItem>;

export const AdminMarketContractList = z.object({
  items: z.array(AdminMarketContractListItem),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  counts: AdminMarketContractCounts,
});
export type AdminMarketContractListType = z.infer<typeof AdminMarketContractList>;

export const AdminMarketContractListResponse = z.object({
  result: z.literal(true),
  data: AdminMarketContractList,
});
export type AdminMarketContractListResponseType = z.infer<typeof AdminMarketContractListResponse>;

// 드로어 상세 — 목록 행 + 납품 노트 + od 파생 결제 + 전문가 계좌(관리자만) + 정산 기록 +
// 산출물 + 프로젝트 요약.
export const AdminMarketContractDetail = AdminMarketContractListItem.extend({
  expertMbId: z.string(), // 운영 감독(원 식별자)
  deliveryNote: z.string().nullable(),
  payment: MarketContractPayment.nullable(), // 항상 조회 시도(주문 없으면 null)
  bankName: z.string().nullable(), // 전문가 정산 계좌 — Admin Detail 에만 노출
  bankHolder: z.string().nullable(),
  bankAccount: z.string().nullable(),
  settledBy: z.string().nullable(),
  settleNote: z.string().nullable(),
  files: z.array(MarketContractFileMeta), // 산출물(deliverable) — 다운로드는 계약 파일 프록시
  project: z.object({
    projectId: z.number(),
    title: z.string(),
    requestType: MarketRequestType,
    serviceAreas: z.array(MarketServiceArea),
    method: MarketProjectMethod,
    status: MarketProjectStatus,
  }),
});
export type AdminMarketContractDetailType = z.infer<typeof AdminMarketContractDetail>;

export const AdminMarketContractDetailResponse = z.object({
  result: z.literal(true),
  data: AdminMarketContractDetail,
});
export type AdminMarketContractDetailResponseType = z.infer<
  typeof AdminMarketContractDetailResponse
>;

// settle=정산 완료 기록(이체는 수동), hold/unhold=자동확정 정지/해제, cancel=운영 취소.
export const AdminContractSettleBody = z.object({
  note: z.string().trim().max(500).optional(),
});
export type AdminContractSettleBodyType = z.infer<typeof AdminContractSettleBody>;

export const AdminContractHoldBody = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type AdminContractHoldBodyType = z.infer<typeof AdminContractHoldBody>;

export const AdminContractCancelBody = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type AdminContractCancelBodyType = z.infer<typeof AdminContractCancelBody>;
