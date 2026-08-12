import { z } from 'zod';
import { PcbPoEqReviewSummary } from './pcb-eq-review';
import { AdminPcbRfqView, PartnerPcbSpecFile } from './pcb-rfq';
import {
  BomInvoiceData,
  BomShipmentFileType,
  BomShipmentMode,
  BomShipmentStatus,
} from './bom-po';

// ── PCB 파트너 트랙 — sp_pcb_po 계약(P2) ─────────────────────────────────────
// 설계 정본: docs/PCB_PARTNER_TRACK.md §5.2-2·§5.2-3. 발주서 status 가 EQ·생산
// 5단계 진행 머신을 겸한다(레거시 승계 — 별도 컬럼 없음). 전이·되돌리기 사전이
// FE 라벨과 서버 검증의 단일 정본이다(레거시 pcbEqWorkflow.ts 대응, D4 영문 코드).

export const PCB_PO_STATUSES = [
  'issued',
  'eq_requested',
  'eq_done',
  'producing',
  'produced',
] as const;
export type PcbPoStatusType = (typeof PCB_PO_STATUSES)[number];
export const PcbPoStatus = z.enum(PCB_PO_STATUSES);

export const PCB_PO_STATUS_LABELS = {
  issued: '발주접수',
  eq_requested: 'EQ 승인요청',
  eq_done: 'EQ 완료',
  producing: '생산시작',
  produced: '생산완료',
} as const satisfies Record<PcbPoStatusType, string>;

// EQ 역할 — RECEIVER=수주 조직(MD 하위 트랙은 MD 가 fallback 대행 가능),
// ORDERER=항상 루트 관리자(§6 D3 — 레거시 실코드 승계, MD 는 승인자가 아니라 다리).
export const PCB_EQ_ROLES = ['RECEIVER', 'ORDERER'] as const;
export type PcbEqRoleType = (typeof PCB_EQ_ROLES)[number];
export const PCB_EQ_ROLE_LABELS = {
  RECEIVER: '수주 협력사',
  ORDERER: '관리자',
} as const satisfies Record<PcbEqRoleType, string>;

export interface PcbEqForwardAction {
  actor: PcbEqRoleType;
  to: PcbPoStatusType;
  label: string;
  /** 반려 지원(ORDERER) — 반려 시 복귀 상태. */
  rejectTo?: PcbPoStatusType;
}

/** 정방향 전이 사전 — 종점(produced)은 null. */
export const PCB_EQ_FORWARD: Record<PcbPoStatusType, PcbEqForwardAction | null> = {
  issued: { actor: 'RECEIVER', to: 'eq_requested', label: 'EQ 승인요청' },
  eq_requested: { actor: 'ORDERER', to: 'eq_done', label: 'EQ 승인', rejectTo: 'issued' },
  eq_done: { actor: 'RECEIVER', to: 'producing', label: '생산 시작' },
  producing: { actor: 'RECEIVER', to: 'produced', label: '생산 완료' },
  produced: null,
};

export interface PcbEqRevertAction {
  actor: PcbEqRoleType; // 그 상태로 진입시킨 주체만 한 칸 되돌릴 수 있다
  to: PcbPoStatusType;
  label: string;
}

/** 역방향(한 칸) 사전 — issued 는 시작 상태라 null. */
export const PCB_EQ_REVERT: Record<PcbPoStatusType, PcbEqRevertAction | null> = {
  issued: null,
  eq_requested: { actor: 'RECEIVER', to: 'issued', label: 'EQ 요청 취소' },
  eq_done: { actor: 'ORDERER', to: 'eq_requested', label: '승인 취소' },
  producing: { actor: 'RECEIVER', to: 'eq_done', label: '생산시작 취소' },
  produced: { actor: 'RECEIVER', to: 'producing', label: '생산완료 취소' },
};

// EQ 첨부 종류 — eq(질의서)·working(작업 파일). 저장은 sp_file(refType 'sp_pcb_po_eq').
// eq·working 은 **협력사 → 관리자** 산출물(질의서·작업 데이터)이고, reply 는 그 반대
// 방향 — 관리자가 반려하며 돌려보내는 회신 첨부(수정지시 도면·마크업)다. 방향을 종류로
// 가르는 이유는 isLatest 가 **종류별**로 계산되기 때문이다: 같은 칸에 섞으면 관리자가 올린
// 지시서가 협력사의 최신 작업도면을 밀어내고, 다음 승인 때 자기 파일을 '협력사 최신 도면'
// 으로 보고 승인하게 된다(EQ 는 생산의 근거 서류라 그대로 만들어진다).
export const PCB_EQ_FILE_TYPES = ['eq', 'working', 'reply'] as const;
export type PcbEqFileTypeType = (typeof PCB_EQ_FILE_TYPES)[number];
export const PcbEqFileType = z.enum(PCB_EQ_FILE_TYPES);

/** multipart 폼 필드(문자열)를 종류로 좁힌다 — 모르는 값은 null(호출부가 400). */
export const asPcbEqFileType = (v: unknown): PcbEqFileTypeType | null =>
  typeof v === 'string' && (PCB_EQ_FILE_TYPES as readonly string[]).includes(v)
    ? (v as PcbEqFileTypeType)
    : null;

/**
 * 지금 이 종류의 첨부를 올리거나 지울 수 있는가 — 관리자·협력사 라우트가 같은 사전을 쓴다.
 *
 * 협력사 산출물(eq·working)은 **승인요청 뒤 잠긴다**(EQ_LOCKED): 관리자가 검토하는 동안
 * 근거 서류가 바뀌면 무엇을 보고 승인했는지가 사라진다. 반면 관리자 회신(reply)은 **승인요청
 * 을 받은 상태에서도 붙일 수 있어야 한다** — 받아 보고 "이걸 고쳐 달라"고 말하는 그 순간이
 * 곧 eq_requested 이기 때문이다. 생산이 시작된 뒤(eq_done~)에는 양쪽 다 닫힌다.
 */
export const canEditPcbEqFile = (
  fileType: PcbEqFileTypeType,
  status: PcbPoStatusType,
): boolean =>
  fileType === 'reply' ? status === 'issued' || status === 'eq_requested' : status === 'issued';

export const PcbEqFileView = z.object({
  fileId: z.number(),
  name: z.string(),
  size: z.number(),
  fileType: PcbEqFileType,
  uploadedBy: z.string().nullable(), // ADMIN|PARTNER|MASTER_DEALER
  uploadedAt: z.string(),
  /** 같은 종류(eq/working/reply) 중 가장 나중에 올라온 1건 — 여정 22호. orderPcbEqFiles 가 정한다. */
  isLatest: z.boolean(),
  /** 직전 EQ 반려 뒤에 올라온 파일(=보완분). 반려 이력이 없으면 전부 false. */
  afterReject: z.boolean(),
});
export type PcbEqFileViewType = z.infer<typeof PcbEqFileView>;

/**
 * EQ 첨부를 **최신 우선**으로 정리한다(여정 22호 교정).
 *
 * 협력사가 같은 종류를 다시 올려도 이전 파일은 지우지 않는다 — 다층 보드처럼 여러 장을
 * 올리는 실무가 있고, 덮어쓰기는 되돌릴 수 없다(선적 첨부와 규칙이 다른 이유). 대신
 * **어느 것이 최신인지**를 여기서 한 번 정해 관리자 Case·고객확인 패널·협력사 포털이 같은
 * 답을 하게 한다. 그러지 않으면 관리자가 늘어선 버튼 중 **맨 앞(=가장 오래된 것)**을 눌러
 * 옛 도면을 보고 승인한다 — EQ 는 생산의 근거 서류라 그대로 만들어진다.
 *
 * '가장 나중'은 fileId 로 정한다 — writeDate 는 같은 초에 두 건이 들어오면 갈리지 않는다.
 */
export const orderPcbEqFiles = <
  T extends { fileId: number; fileType: string; uploadedAt: string },
>(
  files: readonly T[],
  /** 직전 EQ 반려 시각(ISO) — lastPcbEqRejectedAt 결과. null=반려 이력 없음. */
  rejectedAt: string | null = null,
): (T & { isLatest: boolean; afterReject: boolean })[] => {
  const latestId = new Map<string, number>();
  for (const f of files) {
    const cur = latestId.get(f.fileType);
    if (cur === undefined || f.fileId > cur) latestId.set(f.fileType, f.fileId);
  }
  return files
    .map((f) => ({
      ...f,
      isLatest: latestId.get(f.fileType) === f.fileId,
      // 둘 다 toISOString() 이라 사전식 비교가 곧 시각 비교다.
      afterReject: rejectedAt !== null && f.uploadedAt > rejectedAt,
    }))
    .sort(
      (a, b) =>
        // 최신이 앞 → 종류 순(eq, working) → 이전 것들끼리는 최근 순
        Number(b.isLatest) - Number(a.isLatest) ||
        a.fileType.localeCompare(b.fileType) ||
        b.fileId - a.fileId,
    );
};

/**
 * 가장 최근 EQ **반려** 시각(ISO) — 없으면 null.
 *
 * 반려와 '요청 취소'는 둘 다 `eq_requested → issued` 로 같은 모양이다. 가르는 것은
 * **사유(note)** 다 — 전진·되돌리기는 note 를 남기지 않고 반려만 남긴다. 역할로는 갈리지
 * 않는다: 관리자 대행(D11)이 협력사 몫의 요청 취소를 하면 byRole 도 ADMIN 이다.
 *
 * 쓰임 — "반려했는데 **새 파일이 올라오긴 했나**". EQ 첨부는 승인요청 뒤 잠기므로(EQ_LOCKED)
 * 보완 파일은 반드시 반려와 재요청 **사이**에 올라온다. 그 구간에 아무것도 없으면 협력사가
 * 같은 도면으로 다시 승인을 요청한 것이고, 관리자는 그것을 모른 채 승인하게 된다.
 */
export const lastPcbEqRejectedAt = (
  history: readonly { at: string; fromStatus: string; toStatus: string; note: string | null }[],
): string | null => {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const e = history[i];
    if (e === undefined) continue;
    if (
      e.fromStatus === 'eq_requested' &&
      e.toStatus === 'issued' &&
      e.note !== null &&
      e.note !== '' &&
      e.at !== ''
    ) {
      return e.at;
    }
  }
  return null;
};

export const PcbEqEvent = z.object({
  at: z.string(),
  byRole: z.string(), // ADMIN|PARTNER|MASTER_DEALER
  fromStatus: z.string(),
  toStatus: z.string(),
  note: z.string().nullable(),
});
export type PcbEqEventType = z.infer<typeof PcbEqEvent>;

// ── PCB 선적(P3) — 상태·핑퐁 주체·필수값은 BOM 선적 코드사전(bom-po.ts §D22) 공유 ──
// 재해석 한 가지: BOM 의 actor 'ADMIN'=받는측 / 'PARTNER'=보내는측. PCB 는 받는측이
// MD(입고)일 수 있어 receiverKind 로 실주체를 해석한다(admin=관리자, md=MD 조직).

export const PCB_SHIPMENT_RECEIVER_KINDS = ['admin', 'md'] as const;
export type PcbShipmentReceiverKindType = (typeof PCB_SHIPMENT_RECEIVER_KINDS)[number];

export const PcbShipmentFileView = z.object({
  fileId: z.number(),
  name: z.string(),
  size: z.number(),
  fileType: BomShipmentFileType, // invoice|airwaybill
  uploadedBy: z.string().nullable(),
  uploadedAt: z.string(),
});
export type PcbShipmentFileViewType = z.infer<typeof PcbShipmentFileView>;

export const PcbShipmentView = z.object({
  shipmentId: z.number(),
  poId: z.number(), // 대표(생성) 발주서
  specId: z.number(),
  /** 대표 발주의 A/S 회차 — 0=원발주, 1..=재생산 회차. 박스 합류 키의 한 축이라
   *  (contextKey `받는측:조직:직송지:회차`) 화면이 이걸 못 실으면 회차로 갈린 두 박스의
   *  헤더가 글자까지 같아진다(여정 11호 X7). 관리자 선적 큐 배지와 같은 값이다. */
  reorderRound: z.number().int(),
  mode: BomShipmentMode,
  status: BomShipmentStatus,
  receiverKind: z.enum(PCB_SHIPMENT_RECEIVER_KINDS),
  receiverName: z.string(), // 관리자=자사명, md=MD 조직명
  senderPartnerId: z.number(),
  senderName: z.string(),
  destinationCountry: z.string().nullable(),
  carrier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  shipDate: z.string().nullable(),
  shippedAt: z.string().nullable(),
  receivedAt: z.string().nullable(),
  receivedNote: z.string().nullable(),
  completedAt: z.string().nullable(),
  poIds: z.array(z.number()), // 소속 발주서 전체(조인 기준 — 대표 포함)
  // 소속 발주서 표시 정보 — 묶음 구성이 화면(보내기 보드·상세 발송 카드)에 보여야
  // "무엇이 같이 나가는지"를 확인하고 발송할 수 있다(§9 묶음 재구성).
  groupPos: z.array(
    z.object({
      poId: z.number(),
      projectName: z.string(),
      qty: z.number().int(),
      currency: z.string(),
      priceOriginal: z.number(),
    }),
  ),
  files: z.array(PcbShipmentFileView),
});
export type PcbShipmentViewType = z.infer<typeof PcbShipmentView>;

/**
 * 납기 경과 판정(여정 14호 T2) — 화면이 "이 발주가 납기를 넘겼는가"를 같은 규칙으로 말하게
 * 하는 순수 함수. Case 상세와 발주 큐가 각자 날짜를 비교하면 규칙이 갈라지므로 여기 하나에 둔다.
 *
 * **생산완료(produced)부터는 지연이 아니다** — 납기는 "물건을 언제까지 만드는가"의 약속이고,
 * 그 뒤(발송·입고)는 선적 축이 따로 기한을 가진다. 만들어 놓은 건을 계속 빨간 줄로 두면
 * 진짜 늦은 건이 묻힌다. 납기 미지정(null)도 지연이 아니다(약속 자체가 없다).
 *
 * 날짜만 비교한다(시분 무시) — 납기는 "그날까지"라 당일은 아직 지난 것이 아니다.
 *
 * ⚠ 두 인자 모두 **KST 'YYYY-MM-DD'** 여야 한다(`kstDateOnly`·`kstToday`). 납기는 KST 자정에
 *   앵커해 저장되므로 ISO 문자열을 그냥 잘라 쓰면 하루 앞당겨진다(packages/utils
 *   kst-date.test.ts 의 실측 회귀 — 2026-08-20 납기가 '2026-08-19' 로 보였다).
 */
export const isPcbDeliveryOverdue = (
  status: string,
  deliveryYmd: string | null,
  todayYmd: string,
): boolean => {
  if (deliveryYmd === null || deliveryYmd === '') return false;
  if (status === 'produced') return false;
  return deliveryYmd < todayYmd;
};

/**
 * 직송 판정(D5 · 판정 축 교정 08-11 — 여정 11호 X9) — **입고된 발주들의 직송지**만 받아
 * "이 주문의 종결이 [직송 완료]인가"를 답한다. 종결 대상이 곧 입고 신호를 만든 발주이므로
 * 직송 여부도 같은 발주를 봐야 한다: 구 규칙('최상위·최신 회차 발주')은 원발주가 KR 로
 * 실제 입고 완료된 주문도 뒤에 선 A/S 회차의 직송지로 뒤집어, 실물이 자사 창고에 있는데
 * 운송장 없이 "현지에서 수령했다"로 닫는 경로를 열었다.
 *
 * 혼재(입고된 발주가 여럿인데 직송지가 서로 다름 — 예: 원발주 KR 입고 + 회차 직송 CN 입고)면
 * **보수적으로 '직송 아님'(null)** 이다: [배송 처리]로 보내 운송장을 한 번 더 확인받는 쪽이
 * 잘못 종결하는 것보다 안전하다. 입고분이 없으면(빈 배열) 판정 근거 자체가 없으므로 null.
 */
export const resolvePcbDirectShipCountry = (
  receivedDestinations: readonly (string | null)[],
): string | null => {
  const distinct = new Set(receivedDestinations);
  if (distinct.size !== 1) return null; // 0=근거 없음 · 2+=혼재(보수적으로 직송 아님)
  return distinct.values().next().value ?? null;
};

// ── 공용 뷰(관리자·MD 하위 표시) ─────────────────────────────────────────────
export const AdminPcbPoView = z.object({
  poId: z.number(),
  specId: z.number(),
  partnerId: z.number(),
  partnerName: z.string(),
  /** 이 조직에 연결 계정이 있는가(false = 포털 토큰을 만들 수 없다 → 발주 이후 전 단계가
   *  관리자 대행 몫). RFQ 회신은 매직링크라 계정이 없어도 협력사가 직접 하므로, 이 값이
   *  가르는 것은 **발주 이후**(EQ·생산·선적)다 — 기다려도 오지 않는 건을 구분한다. */
  partnerHasPortal: z.boolean(),
  parentPartnerId: z.number(),
  parentPartnerName: z.string().nullable(),
  reorderRound: z.number().int(),
  rfqId: z.number().nullable(),
  status: PcbPoStatus,
  currency: z.string(),
  priceOriginal: z.number(),
  exchangeRate: z.number().nullable(),
  krwAmount: z.number().nullable(),
  subCurrency: z.string().nullable(),
  subPriceOriginal: z.number().nullable(),
  subExchangeRate: z.number().nullable(),
  destinationCountry: z.string().nullable(),
  paymentTerms: z.string().nullable(),
  remittedAt: z.string().nullable(),
  /** 송금 원장 파생 요약(P3.11 — 원장이 정본, remittedAt 은 마지막 송금일 캐시일 뿐).
   *  날짜만으로는 **부분 송금과 완납이 같은 초록 배지**가 되어 반쯤 나간 돈을 다 준 것처럼
   *  읽힌다(재점검 08-11 확정 #7). 금액은 발주 통화(currency) 기준이다.
   *  ※ 형태를 pcb-remittance.ts 에서 import 하지 않는 건 순환 참조 회피 — 위 remittances 와 같은 이유. */
  remittance: z.object({
    paidAmount: z.number(),
    balance: z.number(),
    count: z.number().int().nonnegative(),
  }),
  deliveryDate: z.string().nullable(),
  memo: z.string().nullable(),
  issuedAt: z.string(),
  eqHistory: z.array(PcbEqEvent),
  eqFiles: z.array(PcbEqFileView),
  /** MD 경유 상위 발주서의 EQ 위임 대상(하위 po). null=자체 진행. */
  eqDelegatePoId: z.number().nullable(),
  /** MD 조직 수주 발주서인데 하위 발주가 아직 없어 EQ 를 시작할 수 없음. */
  eqBlocked: z.boolean(),
  /** MD 경유 표시용 — 하위 발주 수. */
  childCount: z.number().int(),
  /** EQ 고객 확인 요약(P4.4) — 모달을 열지 않아도 행이 상태를 안다. null=미요청. */
  eqReview: PcbPoEqReviewSummary.nullable(),
});
export type AdminPcbPoViewType = z.infer<typeof AdminPcbPoView>;

export const AdminPcbPoListResponse = z.object({
  result: z.literal(true),
  // shipments 는 P3 확장 — 발주 패널이 발주서와 소속 선적을 함께 소비한다.
  data: z.object({ pos: z.array(AdminPcbPoView), shipments: z.array(PcbShipmentView) }),
});
export type AdminPcbPoListResponseType = z.infer<typeof AdminPcbPoListResponse>;

// ── 발주 생성/수정(관리자) — paid 게이트는 서버(od isPaid, §5.2-2) ────────────
// rfqId 를 주면 선정 견적행 스냅샷(통화·금액·sub·환율) 프리필, body 값이 우선.
export const AdminPcbPoCreateBody = z.object({
  partnerId: z.number().int().positive(),
  rfqId: z.number().int().positive().nullable().optional(),
  /** 결제통화 기준 발주가 — rfq 생략 시 필수. */
  priceOriginal: z.number().positive().optional(),
  /** 외화 관리자 발주의 KRW 회계 환율 — 생략 시 rfq 선정 박제값 승계. */
  exchangeRate: z.number().positive().optional(),
  paymentTerms: z.string().trim().max(50).nullable().optional(),
  // ⚠ 송금은 여기서 받지 않는다 — 원장(sp_pcb_remittance)이 정본이고 창구는
  //   /pcb-remittances 하나다(P3.11). 발주 바디로도 받으면 금액 없는 기록이 다시 생긴다.
  deliveryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  destinationCountry: z.enum(['KR', 'CN', 'VN']).nullable().optional(),
  memo: z.string().trim().max(2000).nullable().optional(),
});
export type AdminPcbPoCreateBodyType = z.infer<typeof AdminPcbPoCreateBody>;

// 조건 수정 — 금액·환율은 issued 상태에서만 서버가 허용.
export const AdminPcbPoPatchBody = AdminPcbPoCreateBody.omit({
  partnerId: true,
  rfqId: true,
}).partial();
export type AdminPcbPoPatchBodyType = z.infer<typeof AdminPcbPoPatchBody>;

export const AdminPcbPoMutationResponse = z.object({
  result: z.literal(true),
  data: AdminPcbPoView,
});
export type AdminPcbPoMutationResponseType = z.infer<typeof AdminPcbPoMutationResponse>;

export const PcbPoActionResponse = z.object({ result: z.literal(true) });
export type PcbPoActionResponseType = z.infer<typeof PcbPoActionResponse>;

export const PcbPoRejectBody = z.object({ reason: z.string().trim().min(1).max(1000) });
export type PcbPoRejectBodyType = z.infer<typeof PcbPoRejectBody>;

// ── 관리자 횡단 워크큐 (/api/admin/pcb-pos) ──────────────────────────────────
// to_ship = 생산완료인데 아직 발송에 담기지 않은 발주서 = **선적·배송의 "발송 대기"**.
// 다른 탭과 달리 배타적이지 않다(produced 의 부분집합) — 물류가 "이제 보낼 것"을 자기
// 화면 첫 탭에서 보기 위한 절단면이라, 서버는 행별로 소속 탭을 배열로 돌려준다.
export const ADMIN_PCB_PO_TABS = [
  'eq_pending',
  'producing',
  'produced',
  'to_ship',
  'all',
] as const;
export type AdminPcbPoTabType = (typeof ADMIN_PCB_PO_TABS)[number];

export const AdminPcbPoWorkItem = z.object({
  poId: z.number(),
  specId: z.number(),
  projectName: z.string(),
  /** 이 발주가 누구 물건인가 — 협력사 축 목록이라도 운영자는 고객으로 건을 기억한다.
   *  이름 해석은 lib/pcb-customer 단일 사전(od_name > mb_name), 비회원이면 mbId=null. */
  mbId: z.string().nullable(),
  customerName: z.string(),
  partnerName: z.string(),
  /** 연결 계정 없음 = 이 줄은 협력사가 스스로 진행할 수 없다(대행 대기). */
  partnerHasPortal: z.boolean(),
  parentPartnerName: z.string().nullable(),
  reorderRound: z.number().int(),
  status: PcbPoStatus,
  currency: z.string(),
  priceOriginal: z.number(),
  krwAmount: z.number().nullable(),
  deliveryDate: z.string().nullable(),
  issuedAt: z.string(),
  /** 관리자 차례(EQ 승인 대기 — 미러 반영). 고객 확인(D16)을 보내 답을 기다리는 동안은
   *  공이 고객에게 있어 false 이고, 회신 기한이 지나면 재촉이 관리자 몫이라 다시 true 다. */
  adminTurn: z.boolean(),
  /** 생산완료·발송 미편성 — 보내는측이 발송을 시작해야 하는 상태(to_ship 탭 표시용). */
  awaitingShipment: z.boolean(),
  /** EQ 고객 확인 요약(Case 상세와 같은 요약) — 'EQ 승인 대기' 탭에서 지금 승인하면 되는
   *  건(고객 승인)과 고객 확인중·고객 반려·미요청을 목록에서 가른다. null=미요청. */
  eqReview: PcbPoEqReviewSummary.nullable(),
});
export type AdminPcbPoWorkItemType = z.infer<typeof AdminPcbPoWorkItem>;

export const AdminPcbPoWorkListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminPcbPoWorkItem),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    counts: z.object({
      eq_pending: z.number().int(),
      producing: z.number().int(),
      produced: z.number().int(),
      to_ship: z.number().int(),
      all: z.number().int(),
    }),
  }),
});
export type AdminPcbPoWorkListResponseType = z.infer<typeof AdminPcbPoWorkListResponse>;

// ── 협력사 포털 (/api/partner/pcb-pos, requirePartner) ───────────────────────
export const PartnerPcbPoListItem = z.object({
  poId: z.number(),
  projectName: z.string(),
  qty: z.number().int(),
  reorderRound: z.number().int(), // 0=원발주, 1..=A/S 회차(화면 배지)
  status: PcbPoStatus,
  /** received=내 조직이 수주 / issued=내 조직(MD)이 하위에 발주. */
  direction: z.enum(['received', 'issued']),
  counterpartyName: z.string(), // received=발주처, issued=하위 협력사
  currency: z.string(),
  priceOriginal: z.number(),
  subCurrency: z.string().nullable(),
  subPriceOriginal: z.number().nullable(),
  deliveryDate: z.string().nullable(),
  remittedAt: z.string().nullable(),
  issuedAt: z.string(),
  /** 내 차례(수주 방향 RECEIVER 액션 — 위임·차단 반영). */
  myTurn: z.boolean(),
});
export type PartnerPcbPoListItemType = z.infer<typeof PartnerPcbPoListItem>;

export const PartnerPcbPoListResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(PartnerPcbPoListItem), partnerName: z.string() }),
});
export type PartnerPcbPoListResponseType = z.infer<typeof PartnerPcbPoListResponse>;

export const PartnerPcbPoDetail = z.object({
  poId: z.number(),
  specId: z.number(),
  reorderRound: z.number().int(), // 0=원발주, 1..=A/S 회차
  status: PcbPoStatus,
  direction: z.enum(['received', 'issued']),
  requesterName: z.string(),
  currency: z.string(),
  priceOriginal: z.number(),
  subCurrency: z.string().nullable(),
  subPriceOriginal: z.number().nullable(),
  subExchangeRate: z.number().nullable(),
  paymentTerms: z.string().nullable(),
  remittedAt: z.string().nullable(),
  /** 수금 내역(P3.11) — 협력사가 **자기 발주서 건만** 본다. 날짜·금액·메모까지 공개하는
   *  이유는 "언제 얼마 들어왔나" 문의가 전화로 오기 때문이다. 증빙 파일은 내부 자료라
   *  싣지 않는다(관리자 화면 전용).
   *  ※ 형태를 pcb-remittance.ts 에서 import 하지 않고 여기 두는 건 순환 참조 회피다
   *    (그쪽이 이 파일의 PcbPoStatus 를 쓴다). 필드는 관리자 뷰의 부분집합이다. */
  remittances: z
    .array(
      z.object({
        id: z.number(),
        remittedOn: z.string(),
        currency: z.string(),
        amount: z.number(),
        memo: z.string().nullable(),
      }),
    )
    .default([]),
  remittanceSummary: z
    .object({
      currency: z.string(),
      poAmount: z.number(),
      paidAmount: z.number(),
      balance: z.number(),
      status: z.enum(['unpaid', 'partial', 'paid', 'over']),
      count: z.number().int().nonnegative(),
      lastRemittedOn: z.string().nullable(),
    })
    .nullable()
    .default(null),
  deliveryDate: z.string().nullable(),
  memo: z.string().nullable(),
  issuedAt: z.string(),
  eq: z.object({
    files: z.array(PcbEqFileView),
    history: z.array(PcbEqEvent),
    /** 이 발주서에서 내 EQ 역할 — null=차례 아님(관리자 몫 등). */
    myRole: z.enum(PCB_EQ_ROLES).nullable(),
    /** true=MD 가 하위 수주자 대신 진행(보조 스타일 표시). */
    fallback: z.boolean(),
    /** MD 경유 상위 — EQ 는 하위 발주서에서 진행(delegatePoId). */
    delegatePoId: z.number().nullable(),
    /** MD 수주인데 하위 발주 전 — "하위에 발주하면 EQ 가 시작됩니다". */
    blocked: z.boolean(),
  }),
  spec: z.object({
    projectName: z.string(),
    category: z.string(),
    orderCategory: z.string(),
    qty: z.number().int(),
    message: z.string().nullable(),
    specJson: z.record(z.string(), z.unknown()),
    files: z.array(PartnerPcbSpecFile),
  }),
  /** MD 전용 — 내가 발주한 하위 발주서. */
  children: z.array(AdminPcbPoView),
  /** MD 전용 — 하위 발주 프리필 후보(내 하위 트랙의 회신 견적행). */
  childRfqs: z.array(AdminPcbRfqView),
  /** MD 전용·A/S 회차(수주 A′) — 원회차(round 0) 하위 발주 요약. 회차 하위 RFQ 가 없어도
   *  [원발주 조건으로 하위 발주](childRfqId 없는 조건 복사 경로)의 대상 후보가 된다. */
  originChildPos: z
    .array(
      z.object({
        poId: z.number(),
        partnerId: z.number(),
        partnerName: z.string(),
        currency: z.string(),
        priceOriginal: z.number(),
        subCurrency: z.string().nullable(),
        subPriceOriginal: z.number().nullable(),
        paymentTerms: z.string().nullable(),
      }),
    )
    .default([]),
  /** P3 — 이 발주서가 소속된 발송(없으면 null). */
  shipment: PcbShipmentView.nullable(),
  /** P3 — 발송 시작 가능(produced·미배정·출고 게이팅 통과). */
  canShip: z.boolean(),
  /** P3 — MD 출고 게이팅에 걸림(하위 입고 미완료). */
  outboundBlocked: z.boolean(),
  /** 같은 사양의 다른 A/S 회차 발주(내가 볼 수 있는 것만, 회차당 1건 — 원발주 상세의
   *  회차 역링크 재점검 #16). MD 는 같은 회차의 상위·하위가 다 보이므로 수주(내 문서)
   *  우선으로 하나만 고른다. */
  asRounds: z
    .array(
      z.object({
        poId: z.number(),
        reorderRound: z.number().int(),
        status: PcbPoStatus,
      }),
    )
    .default([]),
});
export type PartnerPcbPoDetailType = z.infer<typeof PartnerPcbPoDetail>;

export const PartnerPcbPoDetailResponse = z.object({
  result: z.literal(true),
  data: PartnerPcbPoDetail,
});
export type PartnerPcbPoDetailResponseType = z.infer<typeof PartnerPcbPoDetailResponse>;

// MD 하위 발주 — 하위 회신 견적행 기준(대상·통화·금액 유도, 수정 가능).
// A/S 회차(parentPo.reorderRound>0)는 회차 하위 RFQ 를 만들 경로가 없으므로 childRfqId
// 없이 발주할 수 있다 — 대신 partnerId(대상)를 주면 서버가 원회차(round 0)의 같은 대상
// 하위 발주 조건을 복사한다(proceed 의 A′ 복사와 대칭·레거시 동형 — 회차는 하위 RFQ 없이
// 직발주였다). 원발주(round 0)는 childRfqId 필수 규율 유지(서버 CHILD_RFQ_REQUIRED 400).
export const PartnerPcbChildPoCreateBody = z.object({
  childRfqId: z.number().int().positive().optional(),
  /** childRfqId 생략(회차 조건 복사) 시 대상 하위 협력사 — 원회차 하위 발주와 일치 검증. */
  partnerId: z.number().int().positive().optional(),
  priceOriginal: z.number().positive().optional(),
  paymentTerms: z.string().trim().max(50).nullable().optional(),
  deliveryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  memo: z.string().trim().max(2000).nullable().optional(),
});
export type PartnerPcbChildPoCreateBodyType = z.infer<typeof PartnerPcbChildPoCreateBody>;

// 발송 전이(보내는측 포털) — 대표 po 경유, 발송(묶음) 단위로 전이한다. 묶음 구성은
// 전이 파라미터가 아니라 **preparing 박스에 담는 행위**(보내기 보드·발송 준비 합류)로
// 확정된다 — 구 withPoIds(전이 순간 일회성 묶기)는 실사용 도달 불가로 폐기(§9 재구성).
export const PcbShipmentAdvanceBody = z.object({
  shipDate: z.string().trim().max(10).nullish(),
  carrier: z.string().trim().max(50).nullish(),
  trackingNumber: z.string().trim().max(100).nullish(),
  trackingUrl: z.string().trim().max(500).nullish(),
});
export type PcbShipmentAdvanceBodyType = z.infer<typeof PcbShipmentAdvanceBody>;

// ── [📦 PCB 보내기] 보드(/app/partner/pcb-ship) — BOM §6.11 두 칸 모델의 PCB 일반화 ──
// BOM 과 달리 받는 곳이 갈릴 수 있어(관리자/직송 KR·CN·VN/MD) 박스는 **컨텍스트당 1개**다.
// contextKey = 받는측:받는조직:직송지:회차 — 선반 카드가 어느 박스로 담기는지의 매칭 축
// (서버가 담기 시 같은 키의 preparing 발송에 합류시키고, 없으면 새로 만든다).

export const PartnerPcbShipShelfItem = z.object({
  poId: z.number(),
  projectName: z.string(),
  qty: z.number().int(),
  currency: z.string(),
  priceOriginal: z.number(),
  reorderRound: z.number().int(),
  receiverLabel: z.string(), // '샘플피씨비' | '직송 CN' | 'MD ○○'
  contextKey: z.string(), // countryReady=false 면 빈 문자열(컨텍스트 해석 불가)
  outboundBlocked: z.boolean(), // MD 출고 게이팅 — 하위 입고 완료 전 담기 불가
  countryReady: z.boolean(), // 조직 소재 국가 미비 — 담기 불가(관리자 문의)
});
export type PartnerPcbShipShelfItemType = z.infer<typeof PartnerPcbShipShelfItem>;

export const PartnerPcbShipBox = PcbShipmentView.extend({ contextKey: z.string() });
export type PartnerPcbShipBoxType = z.infer<typeof PartnerPcbShipBox>;

export const PartnerPcbShipBoardResponse = z.object({
  result: z.literal(true),
  data: z.object({
    shelf: z.array(PartnerPcbShipShelfItem), // 보낼 물건 — 수주 produced·미편성
    // 곧 보낼 물건 — 수주했지만 생산완료 전(발주접수~생산시작). BOM 은 확인 즉시
    // 선반이지만 PCB 는 생산 머신이 있어, 확인 시점의 가시성은 이 목록이 담당한다.
    producing: z.array(
      z.object({
        poId: z.number(),
        projectName: z.string(),
        qty: z.number().int(),
        status: PcbPoStatus,
      }),
    ),
    boxes: z.array(PartnerPcbShipBox), // 준비 중(preparing) 발송 — 컨텍스트당 1개
    active: z.array(PcbShipmentView), // 발송 시작 후 진행 중(핑퐁·입고 대기)
    doneCount: z.number(),
  }),
});
export type PartnerPcbShipBoardResponseType = z.infer<typeof PartnerPcbShipBoardResponse>;

// 담기 — 서버가 컨텍스트를 해석해 같은 박스에 합류시키거나 새 박스를 만든다.
export const PartnerPcbShipBoxBody = z.object({ poId: z.number().int().positive() });
export type PartnerPcbShipBoxBodyType = z.infer<typeof PartnerPcbShipBoxBody>;

// 완료된 발송 아카이브(포털 재설계 R2 — BOM §6.11 done 분리 미러) — 누적 목록이라
// 보드가 아니라 별도 페이지+페이지네이션. 완료 = 최종 상태 도달 또는 입고 확인.
export const PartnerPcbShipDoneQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});
export type PartnerPcbShipDoneQueryType = z.infer<typeof PartnerPcbShipDoneQuery>;

export const PartnerPcbShipDoneResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(PcbShipmentView),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});
export type PartnerPcbShipDoneResponseType = z.infer<typeof PartnerPcbShipDoneResponse>;

export const PcbShipmentReceiveBody = z.object({
  note: z.string().trim().max(2000).nullish(),
});
export type PcbShipmentReceiveBodyType = z.infer<typeof PcbShipmentReceiveBody>;

export const PcbInvoiceResponse = z.object({
  result: z.literal(true),
  data: BomInvoiceData,
});
export type PcbInvoiceResponseType = z.infer<typeof PcbInvoiceResponse>;

// ── 관리자 선적 워크큐 (/api/admin/pcb-shipments) ────────────────────────────
export const ADMIN_PCB_SHIPMENT_TABS = ['pending', 'active', 'received', 'all'] as const;
export type AdminPcbShipmentTabType = (typeof ADMIN_PCB_SHIPMENT_TABS)[number];

export const AdminPcbShipmentWorkItem = z.object({
  shipmentId: z.number(),
  poId: z.number(),
  specId: z.number(),
  projectName: z.string(),
  senderName: z.string(),
  receiverKind: z.enum(PCB_SHIPMENT_RECEIVER_KINDS),
  receiverName: z.string(),
  mode: BomShipmentMode,
  status: BomShipmentStatus,
  poCount: z.number().int(),
  /**
   * 묶음 구성 전체(대표 포함) — 묶음은 **고객(Case) 경계를 넘어** 합류하므로(박스 키에
   * 고객 축이 없다), 대표 프로젝트만 실으면 동반 건이 큐에서 통째로 사라진다(여정 9호).
   */
  members: z.array(
    z.object({
      poId: z.number(),
      specId: z.number(),
      projectName: z.string(),
      mbId: z.string().nullable(),
    }),
  ),
  receivedAt: z.string().nullable(),
  /** 직송지(D5) — non-null 이면 실물은 자사가 아니라 이 나라의 고객에게 간다(큐 배지). */
  destinationCountry: z.string().nullable(),
  /** 대표 발주의 A/S 회차 — 0=원주문, 1..=재생산 회차(큐 배지). */
  reorderRound: z.number().int(),
  /** 관리자 차례 — 받는측이 관리자이고 다음 전이 주체가 받는측이거나, 최종인데 입고 미확인. */
  adminTurn: z.boolean(),
  createdAt: z.string(),
});
export type AdminPcbShipmentWorkItemType = z.infer<typeof AdminPcbShipmentWorkItem>;

export const AdminPcbShipmentWorkListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminPcbShipmentWorkItem),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    counts: z.object({
      pending: z.number().int(),
      active: z.number().int(),
      received: z.number().int(),
      all: z.number().int(),
    }),
  }),
});
export type AdminPcbShipmentWorkListResponseType = z.infer<typeof AdminPcbShipmentWorkListResponse>;
