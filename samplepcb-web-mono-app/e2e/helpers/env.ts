// e2e 공용 환경 — apps/api/.env 의 JWT_SECRET(로컬 서명)·DATABASE_URL(직삽입 시드)을
// 빌려 쓴다(pcb-ship-board 스모크 관례). 게이트가 꺼진 수집 단계에서도 import 가
// 안전해야 하므로 여기서는 throw 하지 않고, 값이 필요한 시점(requireXxx)에만 검증한다.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 옵트인 게이트 — 스펙 파일마다 `describe.skipIf(!RUN)` 로 감싼다(PARTS_IT=1 미러). */
export const RUN = process.env.PORTAL_E2E === '1';

const here = dirname(fileURLToPath(import.meta.url));
/** samplepcb-web-mono-app 루트 */
export const monoRoot = join(here, '..', '..');
/** apps/api 디렉터리(.env·생성된 Prisma Client 의 원천) */
export const apiDir = join(monoRoot, 'apps', 'api');
/** 스크린샷 등 산출물(e2e/output — gitignore) */
export const outputDir = join(monoRoot, 'e2e', 'output');

/** 거버 뷰어 오리진(완주 여정 시작점) — nginx → sp-gerber-eye-v3 vite 8040(strictPort).
 *  사전 조건: 거버 리포에서 `pnpm dev` (docs: HANDOFF_E2E_TEST.md 거버 연결 조사). */
export const GERBER_URL = process.env.E2E_GERBER_URL ?? 'https://local-gerber.samplepcb.co.kr';

/** SPA 오리진 — 기본 nginx 통합 도메인(실환경 동형: /app→vite·/api→node·/→PHP,
 *  /bbs 로그인 화면까지 전 경로 동작). mkcert 인증서라 브라우저(시스템 신뢰)는 그대로,
 *  Node 측 fetch 는 e2e 스크립트의 NODE_OPTIONS=--use-system-ca 가 처리한다.
 *  nginx 없이 돌릴 땐 E2E_BASE_URL=http://127.0.0.1:5173 (vite 가 /api·/spcb 프록시,
 *  단 /bbs 는 미프록시라 그누보드 화면 검증 불가). */
export const BASE_URL = process.env.E2E_BASE_URL ?? 'https://local-web.samplepcb.co.kr';
/** Fastify API 직결(브라우저를 안 끼는 API 레벨 검증용) */
export const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:3333';
/** Smart BOM 추출·공급사 검색 엔진 직결(업로드 여정 사전 점검용). */
export const BOM_ENGINE_URL = process.env.E2E_BOM_ENGINE_URL ?? 'http://127.0.0.1:8400';
/** Mailpit REST(docs/LOCAL_MAIL_TESTING.md — SMTP 25 캡처, UI/API 8025) */
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:8025';
/** 브라우저 창을 띄워 관찰(E2E_HEADED=1) — 기본 headless */
export const HEADED = process.env.E2E_HEADED === '1';

function parseEnvFile(path: string): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (m?.[1] !== undefined && m[2] !== undefined) {
        out[m[1]] = m[2].trim().replace(/^"|"$/g, '');
      }
    }
    return out;
  } catch {
    return {};
  }
}

const apiEnv = parseEnvFile(join(apiDir, '.env'));
// 실로그인 자격(e2e/.env.e2e — gitignore): 그누보드 PHP 화면 왕복 전용 로컬 테스트 계정.
// 값은 채팅·코드·커밋에 남기지 않는다 — 사용자가 파일에 직접 기입(README 참조).
const e2eEnv = parseEnvFile(join(monoRoot, 'e2e', '.env.e2e'));

export interface CustomerCreds {
  id: string;
  pw: string;
}

/**
 * 2번째 고객(다중 사용자 여정) 아이디 — 1번 고객 회원 행을 **복제**해 만드는 상설
 * 픽스처라 비밀번호(해시)가 같다. 그래서 자격은 아이디만 갈아끼우면 되고 .env 에
 * 새 비밀번호를 두지 않는다(원문이 어디에도 늘지 않는다). 생성은 ensureSecondCustomer().
 */
export const SECOND_CUSTOMER_ID = 'e2e-customer2';

/**
 * PHP 실로그인용 고객 계정 — 없으면 안내와 함께 중단(여정 스펙의 사전 조건).
 * slot 2 = 다중 사용자 여정의 상대 고객(같은 비밀번호, 다른 아이디).
 */
export function requireCustomerCreds(slot: 1 | 2 = 1): CustomerCreds {
  const id = process.env.E2E_CUSTOMER_ID ?? e2eEnv['E2E_CUSTOMER_ID'];
  const pw = process.env.E2E_CUSTOMER_PW ?? e2eEnv['E2E_CUSTOMER_PW'];
  if (id === undefined || id === '' || pw === undefined || pw === '') {
    throw new Error(
      'e2e/.env.e2e 에 E2E_CUSTOMER_ID / E2E_CUSTOMER_PW 를 기입하세요 — ' +
        '로컬 전용 테스트 회원(e2e-customer) 가입 후. 운영 실계정 금지(HANDOFF §5).',
    );
  }
  if (slot === 1) return { id, pw };
  const id2 =
    process.env.E2E_CUSTOMER2_ID ?? e2eEnv['E2E_CUSTOMER2_ID'] ?? SECOND_CUSTOMER_ID;
  return { id: id2, pw };
}

/** HS256 로컬 서명용 시크릿 — me.php(SPCB_JWT_SECRET)·Fastify 검증과 동일 값(로컬 dev). */
export function requireJwtSecret(): string {
  const v = process.env.JWT_SECRET ?? apiEnv['JWT_SECRET'];
  if (v === undefined || v === '') {
    throw new Error('JWT_SECRET 을 찾지 못했습니다 — apps/api/.env 를 확인하세요');
  }
  return v;
}

/** 직삽입 시드용 DB 연결 문자열(공유 DB — docs 함정 주의: migrate reset 절대 금지). */
export function requireDatabaseUrl(): string {
  const v = process.env.DATABASE_URL ?? apiEnv['DATABASE_URL'];
  if (v === undefined || v === '') {
    throw new Error('DATABASE_URL 을 찾지 못했습니다 — apps/api/.env 를 확인하세요');
  }
  return v;
}

/** Mouser 주문 API 키(apps/api/.env MOUSER_ORDER_API_KEY) — Mouser 카트 인계 e2e(D41,
 *  MOUSER_E2E=1)가 "사라짐·변조"를 실카트에 직접 일으킬 때만 쓴다. 값은 로그·리포트에 남기지 않는다. */
export function requireMouserOrderKey(): string {
  const v = process.env.MOUSER_ORDER_API_KEY ?? apiEnv['MOUSER_ORDER_API_KEY'];
  if (v === undefined || v === '') {
    throw new Error('MOUSER_ORDER_API_KEY 를 찾지 못했습니다 — apps/api/.env 를 확인하세요');
  }
  return v;
}
