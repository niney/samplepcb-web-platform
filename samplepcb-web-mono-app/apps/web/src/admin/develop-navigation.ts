import type { LocationQuery, RouteLocationRaw } from 'vue-router';
import { DevelopAdminTab } from '@sp/api-contract';
import type { DevelopWorkspaceSectionType } from '@sp/api-contract';

export type DevelopAdminSection = DevelopWorkspaceSectionType | 'requests' | 'settings';
export const DEVELOP_ADMIN_SECTIONS = [
  { key: 'overview', route: 'admin-develop', label: 'admin.menu.developOverview' },
  { key: 'requests', route: 'admin-develop-requests', label: 'admin.menu.developRequests' },
  { key: 'quotes', route: 'admin-develop-quotes', label: 'admin.menu.developQuotes' },
  { key: 'schedule', route: 'admin-develop-schedule', label: 'admin.menu.developSchedule' },
  { key: 'documents', route: 'admin-develop-documents', label: 'admin.menu.developDocuments' },
  { key: 'delivery', route: 'admin-develop-delivery', label: 'admin.menu.developDelivery' },
  { key: 'payments', route: 'admin-develop-payments', label: 'admin.menu.developPayments' },
  { key: 'settings', route: 'admin-develop-settings', label: 'admin.menu.developSettings' },
] as const;

export function developAdminSection(routeName: unknown, from?: unknown): DevelopAdminSection {
  return (
    (routeName === 'admin-develop-request'
      ? DEVELOP_ADMIN_SECTIONS.find((item) => item.key === from)
      : DEVELOP_ADMIN_SECTIONS.find((item) => item.route === routeName)
    )?.key ?? 'requests'
  );
}
export function developSectionRoute(section: DevelopAdminSection): string {
  return (
    DEVELOP_ADMIN_SECTIONS.find((item) => item.key === section)?.route ?? 'admin-develop-requests'
  );
}
export function developListFilters(query: LocationQuery) {
  const page = typeof query.page === 'string' ? Number(query.page) : 1;
  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: 20,
    tab: DevelopAdminTab.catch('all').parse(query.tab),
    q: typeof query.q === 'string' ? query.q.slice(0, 100) : '',
  };
}
export function developDetailTo(
  id: number,
  section: DevelopAdminSection,
  query: LocationQuery = {},
  extra: Record<string, string> = {},
): RouteLocationRaw {
  const filters = developListFilters(query);
  const tab = {
    overview: 'content',
    requests: 'review',
    quotes: 'quotes',
    schedule: 'plan',
    documents: 'documents',
    delivery: 'delivery',
    payments: 'quotes',
    settings: 'content',
  }[section];
  return {
    name: 'admin-develop-request',
    params: { id: String(id) },
    query: {
      from: section,
      tab,
      listTab: filters.tab,
      listPage: String(filters.page),
      listQ: filters.q,
      ...extra,
    },
  };
}
export function developBackTo(query: LocationQuery): RouteLocationRaw {
  const section = developAdminSection('admin-develop-request', query.from);
  const filters = developListFilters({
    tab: query.listTab ?? null,
    page: query.listPage ?? null,
    q: query.listQ ?? null,
  });
  return {
    name: developSectionRoute(section),
    query: {
      tab: filters.tab,
      page: String(filters.page),
      ...(filters.q === '' ? {} : { q: filters.q }),
    },
  };
}
