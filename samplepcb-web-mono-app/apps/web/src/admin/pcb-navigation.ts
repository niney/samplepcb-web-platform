import type {
  LocationQuery,
  LocationQueryRaw,
  LocationQueryValue,
  RouteLocationRaw,
  Router,
} from 'vue-router';

type MaybeQueryValue = LocationQueryValue | LocationQueryValue[] | undefined;

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

const DEFAULT_MEMORY: PcbAdminMemory = { section: 'cases', tabs: {} };
const SECTION_ROUTES: Record<PcbAdminSection, string> = {
  cases: 'admin-pcb-cases',
  rfqs: 'admin-pcb-rfqs',
  orders: 'admin-pcb-orders',
  pos: 'admin-pcb-pos',
  remittances: 'admin-pcb-remittances',
  shipments: 'admin-pcb-shipments',
  claims: 'admin-pcb-claims',
};

const isSection = (value: unknown): value is PcbAdminSection =>
  typeof value === 'string' && PCB_ADMIN_SECTIONS.some((section) => section === value);

export const resolvePcbAdminSection = (routeName: string): PcbAdminSection | null => {
  const match = PCB_ADMIN_SECTIONS.find((section) => SECTION_ROUTES[section] === routeName);
  return match ?? null;
};

const storageKey = (mbId: string | null | undefined): string =>
  `sp:admin:pcb-view:${mbId === undefined || mbId === null || mbId === '' ? 'anonymous' : mbId}`;

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
        if (typeof rawTabs[key] === 'string') tabs[key] = rawTabs[key];
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
    ? { name: SECTION_ROUTES[section] }
    : { name: SECTION_ROUTES[section], query: { tab } };
};

export const pcbAdminEntryTo = (memory: PcbAdminMemory): RouteLocationRaw =>
  pcbAdminSectionTo(memory, memory.section);

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
  return allowed.some((tab) => tab === parsed) ? (parsed as T) : fallback;
};

export interface PcbListQueryState {
  tab: string;
  page: number;
  q: string;
  extra?: Readonly<Record<string, string | number | undefined>>;
}

export const replacePcbListQuery = (
  router: Router,
  current: LocationQuery,
  state: PcbListQueryState,
): void => {
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

export const pcbDetailQuery = (
  from: PcbAdminSection,
  currentFullPath: string,
): LocationQueryRaw => ({ from, returnTo: currentFullPath });

export const safePcbReturnTo = (value: MaybeQueryValue): string | null => {
  const target = queryString(value);
  const path = target.split('?', 1)[0];
  const allowedPaths = new Set(Object.keys(SECTION_ROUTES).map((section) => {
    const routeName = SECTION_ROUTES[section as PcbAdminSection];
    return routeName === 'admin-pcb-cases'
      ? '/admin/pcb/cases'
      : `/admin/pcb/${section}`;
  }));
  return path !== undefined && allowedPaths.has(path) ? target : null;
};
