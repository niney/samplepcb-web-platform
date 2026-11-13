import type { LocationQueryRaw, LocationQueryValue, RouteLocationRaw } from 'vue-router';
import { queryString } from '@/next/lib/list-query';

// 관리자 리뉴얼(src/next) SMT 모듈의 라우트 규약 — pcb-navigation.ts 와 같은 문법(docs/SMARTSMT_INTEGRATION.md §4.6).
//
// SmartSMT 가 보낸 견적서를 보는 모듈이다. 처음부터 리뉴얼 셸에만 지었으므로 옛 화면('admin-legacy-smt-*')이 없다 —
// '이전 화면' 버튼이 뜨지 않는다(admin-menu.ts legacyNextRoute). 화면 코드는 이 파일의 NEXT_SMT_ROUTES 로만 부른다.
// 목록 주소 상태(탭·쪽·검색어)는 모듈 공용 next/lib/list-query.ts 를 쓴다.

export const NEXT_SMT_ROUTES = {
  quotes: 'admin-smt-quotes',
  quote: 'admin-smt-quote',
  link: 'admin-smt-link',
} as const;

/** 리뉴얼 SMT 화면의 경로 접두. */
export const NEXT_SMT_BASE_PATH = '/admin/smt';

type MaybeQueryValue = LocationQueryValue | LocationQueryValue[] | undefined;

export const isNextSmtRoute = (routeName: string): boolean =>
  Object.values(NEXT_SMT_ROUTES).some((name) => name === routeName);

// 목록 주소 상태는 모듈 공용 — PCB 화면과 같은 이름으로 다시 내보낸다.
export { queryPage, queryString, queryTab, replaceListQuery as replaceSmtListQuery } from '@/next/lib/list-query';

/**
 * 견적 상세로 가는 위치. id 는 sp_smt_quote 의 행 번호(견적 번호 quote_id 가 아니다).
 * returnTo 는 떠나온 목록 주소(검색·탭·쪽 포함) — 상세의 '받은 견적으로'가 그 자리로 돌아간다.
 */
export const smtQuoteTo = (id: number, returnTo?: string | null): RouteLocationRaw => {
  const query: LocationQueryRaw = returnTo === undefined || returnTo === null ? {} : { returnTo };
  return { name: NEXT_SMT_ROUTES.quote, params: { id: String(id) }, query };
};

/** 받은 견적 목록 — 검색어(주문 번호 등)를 실어 연다. 수신 기록의 주문 번호 링크가 쓴다. */
export const smtQuotesSearchTo = (q: string): RouteLocationRaw => ({ name: NEXT_SMT_ROUTES.quotes, query: { q } });

/** returnTo 는 우리 목록 경로만 받는다(열린 리다이렉트 방지) — safePcbReturnTo 와 같은 생각. */
export const safeSmtReturnTo = (value: MaybeQueryValue): string | null => {
  const target = queryString(value);
  const path = target.split('?', 1)[0];
  return path === `${NEXT_SMT_BASE_PATH}/quotes` ? target : null;
};
