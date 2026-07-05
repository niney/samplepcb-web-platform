import { z } from 'zod';

// ── 관리자 설정(/app/admin/settings, sp-vue) 계약 ───────────────────────────
// 영카트 "쇼핑몰관리 > 쇼핑몰설정"을 탭 단위로 점진 이식하는 설정 도메인. 현재 첫 탭인
// "사업자정보"(business-info)만 구현 — 결제/배송/알림 탭은 이 파일에 계약을 이어 붙인다.
// 라우트는 전부 requireAdmin(JWT isAdmin 클레임) 뒤에 있다.
//
// 사업자정보 11필드는 영카트 g5_shop_default 의 de_admin_* 컬럼(설치 후 항상 1행인
// 싱글턴)에 저장된다 — cf_* (g5_config)가 아니다. 값은 스토어프론트 푸터·견적서 발신처·
// 주문 인쇄·SMS 발신번호로 두루 쓰인다. 원본: adm/shop_admin/configform.php·
// configformupdate.php 의 "사업자정보" 섹션. 컬럼 매핑:
//   companyName=de_admin_company_name · ownerName=de_admin_company_owner ·
//   businessNo=de_admin_company_saupja_no · tel=de_admin_company_tel(SMS 발신번호 겸용) ·
//   fax=de_admin_company_fax · mailOrderNo=de_admin_tongsin_no · bugaNo=de_admin_buga_no ·
//   zip=de_admin_company_zip · addr=de_admin_company_addr ·
//   infoManagerName=de_admin_info_name · infoManagerEmail=de_admin_info_email
//
// admin.ts 의 AdminEstimateCompany(견적서 발신처)와 name/owner/tel/zip/addr/manager* 가
// 겹치지만 의도적으로 분리 유지한다: EstimateCompany 는 read-only(카탈로그 ⑦) + bankAccount
// 포함이고, 사업자정보는 writable + businessNo/fax/mailOrderNo/bugaNo 4필드를 더 가진
// 상위집합이며 진화 속도가 다르다(admin.ts 의 "의도적 분리" 철학과 동일).

// read/write 응답 공용 — 저장 후엔 sanitize 반영값을 그대로 에코해 FE 캐시를 즉시 정합화한다.
export const BusinessInfo = z.object({
  companyName: z.string(), // 회사명
  ownerName: z.string(), // 대표자명
  businessNo: z.string(), // 사업자등록번호
  tel: z.string(), // 대표전화번호 (= SMS 발신번호)
  fax: z.string(), // 팩스번호
  mailOrderNo: z.string(), // 통신판매업 신고번호
  bugaNo: z.string(), // 부가통신 사업자번호
  zip: z.string(), // 사업장우편번호
  addr: z.string(), // 사업장주소
  infoManagerName: z.string(), // 정보관리책임자명(개인정보 보호책임자)
  infoManagerEmail: z.string(), // 정보책임자 e-mail
});
export type BusinessInfoType = z.infer<typeof BusinessInfo>;

export const BusinessInfoResponse = z.object({
  result: z.literal(true),
  data: BusinessInfo, // GET 은 현재값, PATCH 은 저장(정제 후) 값
});
export type BusinessInfoResponseType = z.infer<typeof BusinessInfoResponse>;

// 저장 요청 — 구조 검증만(varchar(255) 반영, trim). tel 형식(check_vaild_callback)·
// ownerName 공백 가드·XSS 새니타이즈는 라우트 핸들러가 코어 순서대로 처리한다
// (계약에 도메인 로직을 넣지 않는다 — admin-settings.ts 참조).
export const BusinessInfoUpdate = z.object({
  companyName: z.string().trim().max(255),
  ownerName: z.string().trim().max(255),
  businessNo: z.string().trim().max(255),
  tel: z.string().trim().max(255),
  fax: z.string().trim().max(255),
  mailOrderNo: z.string().trim().max(255),
  bugaNo: z.string().trim().max(255),
  zip: z.string().trim().max(255),
  addr: z.string().trim().max(255),
  infoManagerName: z.string().trim().max(255),
  infoManagerEmail: z.string().trim().max(255),
});
export type BusinessInfoUpdateType = z.infer<typeof BusinessInfoUpdate>;
