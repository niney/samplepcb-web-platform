import type { LocationQuery, RouteLocationRaw } from 'vue-router';
import { developQueueState, type DevelopQueueState } from '@/admin/develop-navigation';

// 관리자 리뉴얼(src/next) 개발 모듈의 라우트 규약 — smartbom-navigation.ts·core-navigation.ts 와 같은 문법.
//
// 리뉴얼 화면은 컷오버 전까지 /admin/next/develop/* 에서 옛 화면(/admin/develop/*)과 나란히 돈다. 라우트 이름은
// 옛 이름의 'admin-' 를 'admin-next-' 로 바꾼 것이고, 화면 코드는 이 파일의 NEXT_DEVELOP_ROUTES 로만 부른다 —
// 컷오버 때 값만 옛 이름으로 되돌리면 e2e·메일 딥링크·바깥 링크를 고치지 않고 넘어간다.
// 큐 ↔ 상세 왕복 규약(큐 상태를 URL 에, 상세 `?from=`+`lt/ls/lq/lp` 로 「← 목록으로」)은 옛 admin/develop-navigation.ts
// 와 같다 — 쿼리 해석(developQueueState·developQueueQuery)은 라우트 이름과 무관한 순수 함수라 그대로 쓴다.

export { developQueueQuery, developQueueState, type DevelopQueueState } from '@/admin/develop-navigation';

export const NEXT_DEVELOP_ROUTES = {
  home: 'admin-next-develop',
  intake: 'admin-next-develop-intake',
  contracts: 'admin-next-develop-contracts',
  projects: 'admin-next-develop-projects',
  deliveries: 'admin-next-develop-deliveries',
  inquiries: 'admin-next-develop-inquiries',
  requests: 'admin-next-develop-requests',
  request: 'admin-next-develop-request',
  settings: 'admin-next-develop-settings',
} as const;

/** 리뉴얼 화면의 경로 접두 — 컷오버 때 '/admin/develop' 로 바뀐다. */
export const NEXT_DEVELOP_BASE_PATH = '/admin/next/develop';

/** 큐 화면(홈 포함) — 상세의 `from` 이 될 수 있는 라우트. */
export const NEXT_DEVELOP_QUEUE_ROUTES = [
  NEXT_DEVELOP_ROUTES.home,
  NEXT_DEVELOP_ROUTES.intake,
  NEXT_DEVELOP_ROUTES.contracts,
  NEXT_DEVELOP_ROUTES.projects,
  NEXT_DEVELOP_ROUTES.deliveries,
  NEXT_DEVELOP_ROUTES.inquiries,
  NEXT_DEVELOP_ROUTES.requests,
] as const;
export type NextDevelopQueueRoute = (typeof NEXT_DEVELOP_QUEUE_ROUTES)[number];
export const isNextDevelopQueueRoute = (value: unknown): value is NextDevelopQueueRoute =>
  typeof value === 'string' && (NEXT_DEVELOP_QUEUE_ROUTES as readonly string[]).includes(value);

/** 리뉴얼 라우트 이름 → 옛 라우트 이름('이전 화면' 링크·컷오버 기준). */
export const legacyDevelopRouteName = (nextName: string): string | null =>
  Object.values(NEXT_DEVELOP_ROUTES).some((name) => name === nextName) ? nextName.replace(/^admin-next-/, 'admin-') : null;

/**
 * 상세 딥링크 — `?tab=` 은 상세 탭, `from` 은 떠나는 큐, `lt/ls/lq/lp` 는 그 큐의 탭·신호·검색·페이지.
 * 홈 카드처럼 목록 상태가 없는 곳은 list 를 생략한다.
 */
export function developDetailTo(
  requestId: number,
  options: { tab?: string | undefined; from?: unknown; list?: DevelopQueueState | undefined },
): RouteLocationRaw {
  const query: Record<string, string> = {};
  if (options.tab !== undefined) query.tab = options.tab;
  if (isNextDevelopQueueRoute(options.from)) {
    query.from = options.from;
    const list = options.list;
    if (list !== undefined) {
      if (list.tab !== null) query.lt = list.tab;
      if (list.signal !== null) query.ls = list.signal;
      if (list.q.trim() !== '') query.lq = list.q.trim();
      if (list.page > 1) query.lp = String(list.page);
    }
  }
  return { name: NEXT_DEVELOP_ROUTES.request, params: { id: String(requestId) }, query };
}

/** 「← 목록으로」 — 떠난 큐의 그 자리로. from 이 없거나 모르는 값이면 전체 의뢰. */
export function developBackTo(query: LocationQuery): RouteLocationRaw {
  if (!isNextDevelopQueueRoute(query.from)) return { name: NEXT_DEVELOP_ROUTES.requests };
  const list = developQueueState({ tab: query.lt ?? null, signal: query.ls ?? null, q: query.lq ?? null, page: query.lp ?? null });
  const back: Record<string, string> = {};
  if (list.tab !== null) back.tab = list.tab;
  if (list.signal !== null) back.signal = list.signal;
  if (list.q !== '') back.q = list.q;
  if (list.page > 1) back.page = String(list.page);
  return { name: query.from, query: back };
}
