// 영카트 쇼핑몰설정 저장 시의 코어 순수함수 이식 — 관리자 "사업자정보" 탭 저장 규칙.
// 원본: samplepcb-web/lib/common.lib.php. 이 파일은 DB 를 만지지 않는 순수 함수만 담아
// 단위테스트로 코어 스펙을 고정한다(shop-config.test.ts). 라우트(admin-settings.ts)가
// 저장 전에 이 함수들로 검증·정제한 뒤 g5-db.updateBusinessInfo 로 넘긴다.

// ── 발신번호 유효성 (check_vaild_callback 이식) ─────────────────────────────
// common.lib.php:4362-4384. 대표전화번호(de_admin_company_tel)는 SMS 발신번호로도
// 쓰이므로 사전등록 발신번호 형식을 강제한다. 숫자만 추출한 뒤 검사하므로 입력의
// 하이픈/공백은 무시된다(정규식의 -? 는 숫자만 남은 값에선 항상 미매칭 = 무해).
export function isValidCallback(callback: string): boolean {
  const c = callback.replace(/[^0-9]/g, '');

  // 1588 은 총 8자리 · 02 는 9~10자리 · 030 은 10~11자리(자릿수 우선 차단).
  if (c.startsWith('1588') && c.length !== 8) return false;
  if (c.startsWith('02') && c.length !== 9 && c.length !== 10) return false;
  if (c.startsWith('030') && c.length !== 10 && c.length !== 11) return false;

  // 지역/휴대폰/인터넷전화 국번 화이트리스트 + 대표번호(15/16/18) 계열.
  const general = /^(02|0[3-6]\d|01(0|1|3|5|6|7|8|9)|070|080|007)-?\d{3,4}-?\d{4,5}$/;
  const special = /^(15|16|18)\d{2}-?\d{4,5}$/;
  // 중간 국번이 전부 0 인 번호(예: 02-0000-1234)는 거부.
  const allZeroMiddle = /^(02|0[3-6]\d|01(0|1|3|5|6|7|8|9)|070|080)-?0{3,4}-?\d{4}$/;

  if (!general.test(c) && !special.test(c)) return false;
  if (allZeroMiddle.test(c)) return false;
  return true;
}

// ── XSS 태그/스킴 제거 (clean_xss_tags 이식) ────────────────────────────────
// common.lib.php:3833-3871. 관리자 저장값 정제 — configformupdate.php:248-254 의
// 호출 clean_xss_tags(str, check_entities=1, is_remove_tags=1) 을 고정 이식한다.
// 코어의 addslashes/stripslashes 는 레거시 문자열 이스케이프라 미이식(mysql2 파라미터
// 바인딩이 대체). 순서: 제어문자 제거 → strip_tags → 위험태그/엔티티/스킴/속성 루프.
export function cleanXssTags(input: string): string {
  // tab·formfeed·vertical tab·newline·carriage return 제거(is_trim_both).
  let str = input.replace(/[\t\f\v\n\r]/g, '');

  // strip_tags 근사(is_remove_tags=1) — 주석·완결 태그·닫히지 않은 말미 태그 제거.
  str = stripTags(str);

  // PHP 는 strlen(바이트) 을 루프 상한으로 쓴다 — 여기선 결과에 영향 없는 안전장치라
  // str.length(코드유닛) 로 충분하다. 변화가 없으면 즉시 break 하므로 보통 1~2회.
  const strLen = str.length;
  let i = 0;
  while (i <= strLen) {
    let result = str.replace(
      /<\/*(?:applet|b(?:ase|gsound|link)|embed|frame(?:set)?|i(?:frame|layer)|l(?:ayer|ink)|meta|object|s(?:cript|tyle)|title|xml)[^>]*>/gi,
      '',
    );
    // check_entities=1 — 콜론/괄호/개행 엔티티로 스킴 우회 차단.
    result = result.replace(/&colon;|&lpar;|&rpar;|&NewLine;|&Tab;/g, '');
    // javascript:/vbscript: 등 위험 스킴 제거(경계 문자 $1·종결 문자 $2 는 보존).
    result = result.replace(
      /([^\p{L}]|^)(?:javascript|jar|applescript|vbscript|vbs|wscript|jscript|behavior|mocha|livescript|view-source)\s*:(?:.*?([/\\;()'">]|$))/gisu,
      '$1$2',
    );
    // 따옴표 + on*/style 속성으로 강제 진입 차단(예: "onerror=, 'style=).
    result = result.replace(/["']\s*(?:on\w+|style)\s*=\s*/gi, '');

    if (result === str) break;
    str = result;
    i++;
  }

  return str;
}

// PHP strip_tags 근사. 사업자정보 필드(회사명·주소·전화 등)엔 태그가 들어올 일이
// 거의 없고 방어가 목적이라 완전한 파서 재현은 불필요 — 완결 태그 <...>, 닫히지 않은
// 말미 태그 <...(EOF), 주석 <!-- --> 를 제거한다. 개행은 앞 단계에서 이미 제거됨.
function stripTags(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/<[^>]*$/g, '');
}
