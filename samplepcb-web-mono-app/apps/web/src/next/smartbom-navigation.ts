import type { LocationQueryRaw, LocationQueryValue, RouteLocationRaw } from 'vue-router';
import { queryString } from '@/next/lib/list-query';

// 관리자 리뉴얼(src/next) SmartBOM 모듈의 라우트 규약 — pcb-navigation.ts 와 같은 문법.
//
// 리뉴얼 화면은 컷오버 전까지 /admin/next/{smartbom,bom}/* 에서 옛 화면과 나란히 돈다. 라우트 이름은
// 옛 이름의 'admin-' 를 'admin-next-' 로 바꾼 것이고, 화면 코드는 이 파일의 NEXT_SMARTBOM_ROUTES 로만
// 부른다 — 컷오버 때 값만 옛 이름으로 되돌리면 e2e·메일 딥링크·바깥 링크를 고치지 않고 넘어간다.
// 목록 주소 상태(탭·쪽·검색어)는 모듈 공용 next/lib/list-query.ts 를 쓴다.

export const NEXT_SMARTBOM_ROUTES = {
  cases: 'admin-next-smartbom',
  quotes: 'admin-next-smartbom-quotes',
  orders: 'admin-next-smartbom-orders',
  pos: 'admin-next-smartbom-pos',
  confirms: 'admin-next-smartbom-confirms',
  logistics: 'admin-next-smartbom-logistics',
  claims: 'admin-next-smartbom-claims',
  package: 'admin-next-smartbom-package',
  case: 'admin-next-smartbom-case',
  bom: 'admin-next-bom',
  bomQuote: 'admin-next-bom-quote',
} as const;

/** 리뉴얼 라우트 이름 → 옛 라우트 이름('이전 화면' 링크·컷오버 기준). */
export const legacySmartbomRouteName = (nextName: string): string | null =>
  Object.values(NEXT_SMARTBOM_ROUTES).some((name) => name === nextName)
    ? nextName.replace(/^admin-next-/, 'admin-')
    : null;

/** 리뉴얼 SmartBOM 화면의 경로 접두 — 컷오버 때 '/admin/smartbom' 로 바뀐다. */
export const NEXT_SMARTBOM_BASE_PATH = '/admin/next/smartbom';

// 역할별 워크큐(Case 상세 ?from= 의 값) — 옛 화면과 같은 다섯 + 클레임.
export const SMARTBOM_SECTIONS = ['quotes', 'orders', 'pos', 'confirms', 'logistics', 'claims'] as const;
export type SmartbomSection = (typeof SMARTBOM_SECTIONS)[number];

type MaybeQueryValue = LocationQueryValue | LocationQueryValue[] | undefined;

export const smartbomSectionOf = (value: MaybeQueryValue): SmartbomSection | null => {
  const raw = queryString(value);
  return SMARTBOM_SECTIONS.find((section) => section === raw) ?? null;
};

/**
 * Case 상세로 가는 위치 — from 이 있으면 그 워크큐 메뉴가 켜지고 무관 섹션이 접힌다(옛 화면 §6.12 규약).
 * 진행현황·북마크(from 없음)는 전체 표시. hash 는 확인 요청 행 같은 패널 안 앵커.
 */
export const smartbomCaseTo = (
  quoteId: number | string,
  from?: SmartbomSection,
  hash?: string,
): RouteLocationRaw => {
  const query: LocationQueryRaw = from === undefined ? {} : { from };
  return {
    name: NEXT_SMARTBOM_ROUTES.case,
    params: { id: String(quoteId) },
    query,
    ...(hash === undefined ? {} : { hash }),
  };
};

/** 관리자 BOM 작업대(업로드 후 매칭 화면)로 가는 위치. */
export const bomQuoteTo = (quoteId: number | string): RouteLocationRaw => ({
  name: NEXT_SMARTBOM_ROUTES.bomQuote,
  params: { id: String(quoteId) },
});
