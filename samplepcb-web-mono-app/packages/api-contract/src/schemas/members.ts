import { z } from 'zod';

// ── 관리자 회원 관리(/app/admin/members, sp-vue) 계약 ────────────────────────
// 레거시 /adm/member_list.php(그누보드 회원관리)를 sp-vue 로 마이그레이션. 견적 관리
// (admin.ts)와 파일 분리 — 노출 필드·진화 속도가 다르다(AdminMemberDetail 만
// ListItem.extend 로 내부 재사용). 라우트는 전부 requireAdmin(JWT isAdmin) 뒤에 있고,
// 백엔드는 g5_member read-only SELECT(한정 예외 ⑧) + mb_intercept_date·mb_level UPDATE
// (한정 예외 ⑨, lib/g5-db.ts)로 구현한다. 응답은 이 response 스키마로 직렬화되어
// 미선언 필드(민감 컬럼)가 구조적으로 탈락한다.

// 회원 상태(배타) — 탈퇴(leave≠'') > 차단(intercept≠'' AND leave='') > 정상.
export const AdminMemberStatus = z.enum(['normal', 'intercepted', 'left']);
export type AdminMemberStatusType = z.infer<typeof AdminMemberStatus>;

// 목록 쿼리. tab 이 상태 필터를 겸한다(배타 집계):
//   normal|intercepted|left = 상태 1:1 · all = 전체.
//   검색어(q)·가입일(from/to)은 counts 에 반영, 탭 자체는 미반영(견적 관리 관례).
export const AdminMemberListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z.enum(['all', 'normal', 'intercepted', 'left']).default('all'),
  q: z.string().optional(), // mb_id·이름·닉네임·이메일·휴대폰 contains
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(), // 가입일 범위 시작 (KST 해석 — g5 는 KST native 저장)
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(), // 가입일 범위 끝 (해당 일 포함)
  sort: z.enum(['joined', 'lastLogin']).default('joined'), // 가입일↓ / 최근접속↓
});
export type AdminMemberListQueryType = z.infer<typeof AdminMemberListQuery>;

// 탭 카운트 — 검색어·기간은 반영, 탭 자체는 미반영(= 현재 필터된 집합의 분포).
// 배타 집계라 all = normal + intercepted + left (레거시는 차단 수에 탈퇴자 포함 — 개선).
export const AdminMemberCounts = z.object({
  all: z.number(),
  normal: z.number(),
  intercepted: z.number(),
  left: z.number(),
});
export type AdminMemberCountsType = z.infer<typeof AdminMemberCounts>;

// 목록 행. 탈퇴 회원은 member_delete 익명화로 이메일 등이 '' 가능 → ''→null 정규화.
export const AdminMemberListItem = z.object({
  mbId: z.string(),
  name: z.string(),
  nick: z.string(),
  email: z.string().nullable(), // ''→null (익명화 대응)
  phone: z.string().nullable(), // mb_hp || mb_tel 합성, ''→null
  memberType: z.string().nullable(), // mb_1(개인/기업/파트너), ''→null
  companyName: z.string().nullable(), // 해석값: sp 프로필 ?? mb_2(레거시) ?? null
  level: z.number(),
  point: z.number(),
  status: AdminMemberStatus,
  joinedAt: z.string(), // mb_datetime "YYYY-MM-DD HH:mm"
  lastLoginAt: z.string().nullable(), // mb_today_login, zero-date→null
  projectCount: z.number(), // sp_order_spec status='active' 건수
});
export type AdminMemberListItemType = z.infer<typeof AdminMemberListItem>;

export const AdminMemberListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminMemberListItem),
    total: z.number(), // 탭 포함 필터 적용 건수(페이지네이션용)
    page: z.number(),
    pageSize: z.number(),
    counts: AdminMemberCounts,
  }),
});
export type AdminMemberListResponseType = z.infer<typeof AdminMemberListResponse>;

// 주소(mb_zip1+mb_zip2 → zip, mb_addr1~3). 전부 빈 값이면 null(jibeon 은 판정에서 제외).
export const AdminMemberAddress = z.object({
  zip: z.string(),
  addr1: z.string(),
  addr2: z.string(),
  addr3: z.string(),
  jibeon: z.string(), // mb_addr_jibeon(지번 주소 — 주소 검색이 채운 값, '' 가능)
});
export type AdminMemberAddressType = z.infer<typeof AdminMemberAddress>;

// 레거시 여분필드 사업자 정보(mb_1~mb_9) — 라벨 복원 read-only 표시. 전부 빈 값이면 null.
// 정본(레거시 theme/samplepcb/member_info.php): mb_1=회원구분 mb_2=회사명 mb_3=사업자번호
// mb_4=대표자 mb_5=업태 mb_6=종목 mb_7=담당자명 mb_8=세금계산서 이메일 mb_9=담당자 전화.
export const AdminMemberBusiness = z.object({
  memberType: z.string(), // mb_1
  companyName: z.string(), // mb_2
  bizNo: z.string(), // mb_3
  ceoName: z.string(), // mb_4
  bizType: z.string(), // mb_5
  bizItem: z.string(), // mb_6
  managerName: z.string(), // mb_7
  taxEmail: z.string(), // mb_8
  managerPhone: z.string(), // mb_9
});
export type AdminMemberBusinessType = z.infer<typeof AdminMemberBusiness>;

// 최근 견적 미니 리스트(status='active' 최근 5) — 견적 관리 목록 관례 재사용.
export const AdminMemberRecentProject = z.object({
  projectId: z.number(),
  projectName: z.string(),
  quoteStatus: z.enum(['priced', 'rfq', 'quoted']),
  price: z.number().nullable(), // finalPrice ?? autoPrice ?? null
  createdAt: z.string(), // ISO
});
export type AdminMemberRecentProjectType = z.infer<typeof AdminMemberRecentProject>;

export const AdminMemberDetail = AdminMemberListItem.extend({
  // hp/tel 원본(편집 폼 프리필용) — 목록의 phone 은 hp||tel 합성이라 분리 편집 불가.
  hp: z.string(),
  tel: z.string(),
  addr: AdminMemberAddress.nullable(),
  emailCertifiedAt: z.string().nullable(), // mb_email_certify, zero-date→null
  mailAgree: z.boolean(), // mb_mailling
  smsAgree: z.boolean(), // mb_sms
  marketingAgree: z.boolean(), // mb_marketing_agree
  memo: z.string().nullable(), // mb_memo(관리자 메모, read-only), ''→null
  interceptDate: z.string().nullable(), // mb_intercept_date(YYYYMMDD 원값), ''→null
  leaveDate: z.string().nullable(), // mb_leave_date(YYYYMMDD 원값), ''→null
  legacyBusiness: AdminMemberBusiness.nullable(),
  profileCompanyName: z.string().nullable(), // sp 프로필 원값(해석값 companyName 과 별도)
  recentProjects: z.array(AdminMemberRecentProject),
});
export type AdminMemberDetailType = z.infer<typeof AdminMemberDetail>;

export const AdminMemberDetailResponse = z.object({
  result: z.literal(true),
  data: AdminMemberDetail,
});
export type AdminMemberDetailResponseType = z.infer<typeof AdminMemberDetailResponse>;

// ── 쓰기(g5 UPDATE 한정 예외 ⑨) ──────────────────────────────────────────────
// 가드 3종(탈퇴 회원 409 LEFT_MEMBER / 자기 자신 409 SELF_FORBIDDEN / cf_admin 계정 409
// ADMIN_PROTECTED)은 라우트가 강제. 미존재는 404.

// 차단/해제 — intercept true=차단(mb_intercept_date=KST 오늘), false=해제('').
export const AdminMemberInterceptBody = z.object({ intercept: z.boolean() });
export type AdminMemberInterceptBodyType = z.infer<typeof AdminMemberInterceptBody>;

export const AdminMemberInterceptResponse = z.object({
  result: z.literal(true),
  data: z.object({
    mbId: z.string(),
    status: AdminMemberStatus,
    interceptDate: z.string().nullable(), // YYYYMMDD 또는 null(해제)
  }),
});
export type AdminMemberInterceptResponseType = z.infer<typeof AdminMemberInterceptResponse>;

// 레벨 변경 — 1~10. level 10 부여는 레거시와 동등 허용(관리자 판단). sp 관리자 인증
// (isAdmin)은 cf_admin 1인 불변이라 레벨 상향이 관리자 권한을 주지 않는다(me.php).
export const AdminMemberLevelBody = z.object({ level: z.number().int().min(1).max(10) });
export type AdminMemberLevelBodyType = z.infer<typeof AdminMemberLevelBody>;

export const AdminMemberLevelResponse = z.object({
  result: z.literal(true),
  data: z.object({ mbId: z.string(), level: z.number() }),
});
export type AdminMemberLevelResponseType = z.infer<typeof AdminMemberLevelResponse>;

// 회사명(sp 프로필층) 저장 — '' = 프로필 회사명 삭제. 견적 스냅샷(SpOrderSpec.companyName)은
// 불변, 이 프로필층만 갱신. 응답 companyName 은 해석값(프로필 ?? mb_2).
export const AdminMemberProfileBody = z.object({
  companyName: z.string().trim().max(255), // '' = 프로필 삭제
});
export type AdminMemberProfileBodyType = z.infer<typeof AdminMemberProfileBody>;

export const AdminMemberProfileResponse = z.object({
  result: z.literal(true),
  data: z.object({
    mbId: z.string(),
    companyName: z.string().nullable(), // 해석값(프로필 ?? mb_2)
  }),
});
export type AdminMemberProfileResponseType = z.infer<typeof AdminMemberProfileResponse>;

// ── 회원 정보 편집(g5 UPDATE — 카탈로그 ⑨ 확장) ──────────────────────────────
// info/memo 는 차단/레벨과 가드가 다르다: 미존재 404 + 탈퇴 409 LEFT_MEMBER **2종만**
// (self·cf_admin 허용 — 권한 공격 벡터가 아니고 관리자가 자기 연락처를 고치는 게 자연스러움).
// 코어(adm/member_form_update.php) 정합성 이식: 닉 형식·중복, 이메일 형식·중복, hp 하이픈
// 정규화·중복, zip 3+2 분해, 주소 변경 시 mb_addr_jibeon 초기화, nick_date 미갱신.

// 부분 갱신 — 보낸 필드만 UPDATE. 전 필드 optional, 최소 1개(refine). 모르는 키는 strip.
export const AdminMemberInfoBody = z
  .object({
    name: z.string().trim().min(1).max(255), // '' 불허(trim 후 min1)
    // 닉네임 = 한글·영문·숫자만(공백 불가, 코어 valid_mb_nick). trim 하지 않는다 —
    // 공백 포함 입력을 코어처럼 400 으로 거부(트림하면 조용히 통과되어 코어와 어긋남).
    nick: z
      .string()
      .regex(/^[가-힣a-zA-Z0-9]+$/)
      .max(255),
    email: z.string().trim().email().max(255), // '' 불허(코어상 사실상 필수)
    hp: z.string().trim().max(20), // '' 허용(비움) — 라우트에서 하이픈 정규화
    tel: z.string().trim().max(20), // '' 허용, 자유 문자열
    zip: z.union([z.string().regex(/^\d{5}$/), z.literal('')]), // 5자리 또는 '' — 서버가 3+2 분해
    addr1: z.string().max(255), // '' 허용(비움)
    addr2: z.string().max(255),
    addr3: z.string().max(255),
    // 주소 형식 플래그 — 코어 win_zip(js/common.js)이 이 컬럼에 저장하는 값과 동일:
    // 'R'(도로명)/'J'(지번). print_address 도 플래그로 해석하므로 주소 문자열을 넣지 않는다
    // (감사 판정 2026-07-04 — 지번주소 문자열안 폐기). 검색 제공 시 저장(우선),
    // 미제공 + 기본주소(addr1) 수동 변경 시에만 라우트가 '' 로 초기화(형식 미상).
    addrJibeon: z.enum(['R', 'J', '']),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: '최소 한 개 필드가 필요합니다' });
export type AdminMemberInfoBodyType = z.infer<typeof AdminMemberInfoBody>;

// 부분 갱신이라 에코 대신 FE 가 invalidate/refetch — 응답은 mbId 만.
export const AdminMemberInfoResponse = z.object({
  result: z.literal(true),
  data: z.object({ mbId: z.string() }),
});
export type AdminMemberInfoResponseType = z.infer<typeof AdminMemberInfoResponse>;

// 관리자 메모 — 평문 저장, 부수효과 없음. '' = 비움.
export const AdminMemberMemoBody = z.object({ memo: z.string().max(10000) });
export type AdminMemberMemoBodyType = z.infer<typeof AdminMemberMemoBody>;

export const AdminMemberMemoResponse = z.object({
  result: z.literal(true),
  data: z.object({
    mbId: z.string(),
    memo: z.string().nullable(), // ''→null
  }),
});
export type AdminMemberMemoResponseType = z.infer<typeof AdminMemberMemoResponse>;
