import type { LocationQuery, RouteLocationRaw } from 'vue-router';
import { DevelopAdminSignal, DevelopAdminTab } from '@sp/api-contract/develop-c';
import type { DevelopAdminSignalType, DevelopAdminTabType } from '@sp/api-contract/develop-c';

// 개발(C) 큐 ↔ 상세 왕복(2026-09-10, G develop-navigation.ts 이식) — 큐의 탭·신호·검색·페이지를 URL 에 두어
// 새로고침·뒤로가기에 살고, 상세로 들어갈 때 `from` + 목록 상태를 쿼리에 실어 「← 목록으로」가 떠난 큐의 그 자리로 돌아간다.
// 순수 함수만 — 라우터 객체는 화면이 든다.

export const DEVELOP_C_QUEUE_ROUTES = [
  'admin-develop-c-home',
  'admin-develop-c-intake',
  'admin-develop-c-contracts',
  'admin-develop-c-projects',
  'admin-develop-c-deliveries',
  'admin-develop-c-inquiries',
  'admin-develop-c-requests',
] as const;
export type DevelopCQueueRoute = (typeof DEVELOP_C_QUEUE_ROUTES)[number];
export const isDevelopCQueueRoute = (value: unknown): value is DevelopCQueueRoute =>
  typeof value === 'string' && (DEVELOP_C_QUEUE_ROUTES as readonly string[]).includes(value);

export interface DevelopCQueueState {
  tab: DevelopAdminTabType | null;
  signal: DevelopAdminSignalType | null;
  q: string;
  page: number;
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** URL 쿼리 → 큐 상태. 모르는 값은 null/기본값으로(임의 문자열이 필터에 들어오지 않게). */
export function developCQueueState(query: LocationQuery): DevelopCQueueState {
  const tab = DevelopAdminTab.safeParse(query.tab);
  const signal = DevelopAdminSignal.safeParse(query.signal);
  const page = Number(str(query.page) ?? '1');
  return {
    tab: tab.success ? tab.data : null,
    signal: signal.success ? signal.data : null,
    q: (str(query.q) ?? '').slice(0, 100),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

/** 큐 상태 → URL 쿼리. 기본값과 같은 것·빈 것은 쓰지 않아 주소가 깨끗하다. */
export function developCQueueQuery(
  state: { tab: DevelopAdminTabType; signal: DevelopAdminSignalType | null; q: string; page: number },
  defaults: { tab: DevelopAdminTabType; signal: DevelopAdminSignalType | null },
): Record<string, string> {
  const out: Record<string, string> = {};
  if (state.tab !== defaults.tab) out.tab = state.tab;
  if (state.signal !== defaults.signal && state.signal !== null) out.signal = state.signal;
  if (state.q.trim() !== '') out.q = state.q.trim();
  if (state.page > 1) out.page = String(state.page);
  return out;
}

/**
 * 상세 딥링크 — `?tab=` 은 상세 탭, `from` 은 떠나는 큐, `lt/ls/lq/lp` 는 그 큐의 탭·신호·검색·페이지.
 * 홈 카드처럼 목록 상태가 없는 곳은 list 를 생략한다.
 */
export function developCDetailTo(
  requestId: number,
  options: { tab?: string | undefined; from?: unknown; list?: DevelopCQueueState | undefined },
): RouteLocationRaw {
  const query: Record<string, string> = {};
  if (options.tab !== undefined) query.tab = options.tab;
  if (isDevelopCQueueRoute(options.from)) {
    query.from = options.from;
    const list = options.list;
    if (list !== undefined) {
      if (list.tab !== null) query.lt = list.tab;
      if (list.signal !== null) query.ls = list.signal;
      if (list.q.trim() !== '') query.lq = list.q.trim();
      if (list.page > 1) query.lp = String(list.page);
    }
  }
  return { name: 'admin-develop-c-request', params: { id: String(requestId) }, query };
}

/** 「← 목록으로」 — 떠난 큐의 그 자리로. from 이 없거나 모르는 값이면 전체 의뢰. */
export function developCBackTo(query: LocationQuery): RouteLocationRaw {
  if (!isDevelopCQueueRoute(query.from)) return { name: 'admin-develop-c-requests' };
  const list = developCQueueState({ tab: query.lt ?? null, signal: query.ls ?? null, q: query.lq ?? null, page: query.lp ?? null });
  const back: Record<string, string> = {};
  if (list.tab !== null) back.tab = list.tab;
  if (list.signal !== null) back.signal = list.signal;
  if (list.q !== '') back.q = list.q;
  if (list.page > 1) back.page = String(list.page);
  return { name: query.from, query: back };
}
