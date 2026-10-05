import type { LocationQuery, LocationQueryRaw, LocationQueryValue, Router } from 'vue-router';

// 워크큐 목록의 주소 상태(탭·쪽·검색어 등) — 모듈 무관 공용. 새로고침·뒤로가기·링크 공유에서 목록이
// 같은 자리로 돌아오게 쿼리스트링에 싣는다. PCB(pcb-navigation)·SmartBOM(smartbom-navigation)이 함께 쓴다.

type MaybeQueryValue = LocationQueryValue | LocationQueryValue[] | undefined;

export const queryString = (value: MaybeQueryValue): string =>
  typeof value === 'string' ? value : '';

export const queryPage = (value: MaybeQueryValue): number => {
  const parsed = Number(queryString(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

export const queryTab = <T extends string>(
  value: MaybeQueryValue,
  allowed: readonly T[],
  fallback: T,
): T => {
  const parsed = queryString(value);
  return allowed.find((tab) => tab === parsed) ?? fallback;
};

export interface ListQueryState {
  tab: string;
  page: number;
  q: string;
  extra?: Readonly<Record<string, string | number | undefined>>;
}

/** 목록 상태를 주소에 반영 — 1쪽·빈 검색어는 지워 주소를 짧게 둔다(replace 라 히스토리를 쌓지 않음). */
export const replaceListQuery = (router: Router, current: LocationQuery, state: ListQueryState): void => {
  const query: LocationQueryRaw = { ...current, tab: state.tab };
  if (state.page > 1) query.page = String(state.page);
  else delete query.page;
  if (state.q.trim() !== '') query.q = state.q.trim();
  else delete query.q;
  for (const [key, value] of Object.entries(state.extra ?? {})) {
    query[key] = value === undefined || value === '' ? undefined : String(value);
  }
  void router.replace({ query });
};
