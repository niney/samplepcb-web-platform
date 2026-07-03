// 라이브 가격표(gerber_api/pricing_data.json) → 엔진 스냅샷(src/pricing/pricing-data.json) 동기화.
//
// 레거시는 이 파일을 매 요청마다 서버에서 읽고, 관리자(adm/price_adjust.php)가 수시로
// 값을 조정한다. 스냅샷이 낡으면 신규 엔진 가격이 통째로 어긋나므로(2026-07 사례:
// baseline 61,000 vs 라이브 66,000) 표가 바뀔 때마다 이 스크립트로 재동기화한다.
//
// 정규화 규칙(단 한 건): menus[*].diffDesign 표 삭제.
//   라이브 표에는 differentDesign(유효 — 가격 lib 가 읽음)과 diffDesign(사어 — 어디서도
//   안 읽음, 과거 설계 잔재)이 공존한다. 신규 플랫폼은 differentDesign 으로 통일하므로
//   사어 표를 떨궈 이중키 혼란을 차단한다. 그 외는 원문 그대로(verbatim).
//
// 실행: apps/api 에서 `pnpm pricing:sync` (로컬 개발 도메인은 자가서명 인증서라 --insecure 기본)
//   옵션: --url <주소>    가격표 URL (기본: local-gerber)
//         --secure        TLS 검증 켜기 (운영 도메인 대상일 때)
//
// 동기화 후 할 일(스크립트가 출력으로도 안내):
//   1) engine.ts 의 PRICE_VERSION bump  2) 골든/패리티 재캡처 (pnpm pricing:capture)

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_URL = 'https://local-gerber.samplepcb.co.kr/gerber_api/pricing_data.json';

interface PricingMenu {
  name?: string;
  diffDesign?: unknown;
  differentDesign?: unknown;
  [k: string]: unknown;
}
interface PricingFile {
  menus?: PricingMenu[];
  transferCost?: Record<string, string>;
  [k: string]: unknown;
}

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: DEFAULT_URL },
    secure: { type: 'boolean', default: false },
  },
});

if (!values.secure) {
  // 로컬 개발 도메인(local-gerber.samplepcb.co.kr)은 자가서명 인증서
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const outPath = fileURLToPath(new URL('../pricing/pricing-data.json', import.meta.url));

console.log(`라이브 가격표 조회: ${values.url}`);
const res = await fetch(values.url);
if (!res.ok) throw new Error(`가격표 조회 실패: HTTP ${String(res.status)}`);
const live = (await res.json()) as PricingFile;

// 최소 형태 검증 — 엉뚱한 응답(HTML 에러페이지 등)으로 스냅샷을 덮지 않기 위한 가드
if (!Array.isArray(live.menus) || live.menus.length === 0 || typeof live.transferCost !== 'object') {
  throw new Error('가격표 형태가 아님(menus/transferCost 누락) — 스냅샷을 덮지 않고 중단');
}

for (const menu of live.menus) {
  const name = menu.name ?? '(이름없음)';
  if (menu.diffDesign !== undefined) {
    delete menu.diffDesign;
    console.log(`정규화: menus[${name}].diffDesign 사어 표 삭제`);
  }
  if (menu.differentDesign === undefined && name.toLowerCase() === 'standard') {
    console.warn(
      `⚠ menus[${name}] 에 differentDesign 표가 없음 — 파일개수 가산금이 0원이 된다. 라이브 표 상태 확인 필요.`,
    );
  }
}

await writeFile(outPath, JSON.stringify(live), 'utf8');
console.log(`스냅샷 갱신 완료: ${outPath}`);
console.log('다음 할 일: 1) engine.ts PRICE_VERSION bump  2) pnpm pricing:capture 로 골든 재캡처');
