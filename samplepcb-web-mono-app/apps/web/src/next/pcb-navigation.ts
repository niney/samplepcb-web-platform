import type { LocationQueryRaw, LocationQueryValue, RouteLocationRaw } from 'vue-router';
import { queryString } from '@/next/lib/list-query';

// 관리자 리뉴얼(src/next) PCB 모듈의 라우트·목록 상태 규약 — 옛 admin/pcb-navigation.ts 의 짝.
//
// 2026-10-10 컷오버 — 리뉴얼 화면이 정식 경로(/admin/pcb/*)·이름('admin-pcb-*')을 이어받았고, 옛 화면은
// /admin/legacy/pcb/* · 'admin-legacy-pcb-*' 로 물러났다. 라우트 이름은 전부 이 파일의 NEXT_PCB_ROUTES 로만 부른다.
// 마지막 화면 기억(localStorage)은 옛 화면과 키를 나눠 서로의 탭 기억을 덮어쓰지 않게 한다.

export const NEXT_PCB_ROUTES = {
  cases: 'admin-pcb-cases',
  rfqs: 'admin-pcb-rfqs',
  orders: 'admin-pcb-orders',
  pos: 'admin-pcb-pos',
  remittances: 'admin-pcb-remittances',
  shipments: 'admin-pcb-shipments',
  claims: 'admin-pcb-claims',
  package: 'admin-pcb-package',
  case: 'admin-pcb-case',
} as const;

/** 리뉴얼 PCB 화면의 경로 접두. */
export const NEXT_PCB_BASE_PATH = '/admin/pcb';

export const PCB_ADMIN_SECTIONS = [
  'cases',
  'rfqs',
  'orders',
  'pos',
  'remittances',
  'shipments',
  'claims',
] as const;

export type PcbAdminSection = (typeof PCB_ADMIN_SECTIONS)[number];

export interface PcbAdminMemory {
  section: PcbAdminSection;
  tabs: Partial<Record<PcbAdminSection, string>>;
}

type MaybeQueryValue = LocationQueryValue | LocationQueryValue[] | undefined;

const DEFAULT_MEMORY: PcbAdminMemory = { section: 'cases', tabs: {} };

const isSection = (value: unknown): value is PcbAdminSection =>
  typeof value === 'string' && PCB_ADMIN_SECTIONS.some((section) => section === value);

export const resolvePcbAdminSection = (routeName: string): PcbAdminSection | null =>
  PCB_ADMIN_SECTIONS.find((section) => NEXT_PCB_ROUTES[section] === routeName) ?? null;

const storageKey = (mbId: string | null | undefined): string =>
  `sp:admin-next:pcb-view:${mbId === undefined || mbId === null || mbId === '' ? 'anonymous' : mbId}`;

export const readPcbAdminMemory = (mbId: string | null | undefined): PcbAdminMemory => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey(mbId)) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_MEMORY, tabs: {} };
    const record = raw as Record<string, unknown>;
    const section = isSection(record.section) ? record.section : DEFAULT_MEMORY.section;
    const tabs: Partial<Record<PcbAdminSection, string>> = {};
    if (typeof record.tabs === 'object' && record.tabs !== null) {
      const rawTabs = record.tabs as Record<string, unknown>;
      for (const key of PCB_ADMIN_SECTIONS) {
        const value = rawTabs[key];
        if (typeof value === 'string') tabs[key] = value;
      }
    }
    return { section, tabs };
  } catch {
    return { ...DEFAULT_MEMORY, tabs: {} };
  }
};

export const rememberPcbAdminView = (
  mbId: string | null | undefined,
  section: PcbAdminSection,
  tab?: string,
): PcbAdminMemory => {
  const current = readPcbAdminMemory(mbId);
  const next: PcbAdminMemory = {
    section,
    tabs: tab === undefined ? current.tabs : { ...current.tabs, [section]: tab },
  };
  try {
    localStorage.setItem(storageKey(mbId), JSON.stringify(next));
  } catch {
    // 프라이빗 모드·저장공간 제한에서는 현재 라우팅만 유지한다.
  }
  return next;
};

export const pcbAdminSectionTo = (
  memory: PcbAdminMemory,
  section: PcbAdminSection,
): RouteLocationRaw => {
  const tab = memory.tabs[section];
  return tab === undefined
    ? { name: NEXT_PCB_ROUTES[section] }
    : { name: NEXT_PCB_ROUTES[section], query: { tab } };
};

export const pcbAdminEntryTo = (memory: PcbAdminMemory): RouteLocationRaw =>
  pcbAdminSectionTo(memory, memory.section);

// 목록 주소 상태는 모듈 공용(next/lib/list-query.ts) — PCB 화면이 쓰던 이름 그대로 다시 내보낸다.
export { queryPage, queryString, queryTab } from '@/next/lib/list-query';
export type { ListQueryState as PcbListQueryState } from '@/next/lib/list-query';
export { replaceListQuery as replacePcbListQuery } from '@/next/lib/list-query';

/** Case 상세 진입 쿼리 — from=활성 메뉴 동기화, returnTo=워크큐 복귀 링크. */
export const pcbDetailQuery = (
  from: PcbAdminSection,
  currentFullPath: string,
): LocationQueryRaw => ({ from, returnTo: currentFullPath });

/** Case 상세로 가는 위치 — 목록 행 클릭·진입 버튼이 공통으로 쓴다. */
export const pcbCaseTo = (
  specId: number,
  from: PcbAdminSection,
  currentFullPath: string,
): RouteLocationRaw => ({
  name: NEXT_PCB_ROUTES.case,
  params: { id: String(specId) },
  query: pcbDetailQuery(from, currentFullPath),
});

/** returnTo 는 우리 워크큐 경로만 받는다(열린 리다이렉트 방지). */
export const safePcbReturnTo = (value: MaybeQueryValue): string | null => {
  const target = queryString(value);
  const path = target.split('?', 1)[0];
  const allowedPaths = new Set(PCB_ADMIN_SECTIONS.map((section) => `${NEXT_PCB_BASE_PATH}/${section}`));
  return path !== undefined && allowedPaths.has(path) ? target : null;
};
