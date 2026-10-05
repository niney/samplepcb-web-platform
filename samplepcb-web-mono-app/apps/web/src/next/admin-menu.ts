import type { Component } from 'vue';
import type { LocationQueryRaw, RouteLocationRaw, RouteParamsRawGeneric } from 'vue-router';
import {
  Banknote,
  ClipboardList,
  CreditCard,
  FileText,
  LifeBuoy,
  MessageSquareQuote,
  Truck,
} from '@lucide/vue';
import { adminModules, type AdminModuleKey } from '@/admin/menu';
import {
  NEXT_PCB_BASE_PATH,
  NEXT_PCB_ROUTES,
  PCB_ADMIN_SECTIONS,
  type PcbAdminSection,
} from '@/next/pcb-navigation';

// 리뉴얼 셸(AdminNextLayout)의 모듈·메뉴 정의 — 옛 admin/menu.ts 의 PCB 메뉴 짝.
// 메뉴 순서·라벨(i18n 키)·배지 식별자는 옛 메뉴와 같게 둔다(흐름 순서: 진행현황 → 견적요청 →
// 주문·결제 → 발주·EQ → 송금 → 선적·배송 → A/S). 배지 값의 해석은 usePcbMenuBadges 가 한다.

export type NextMenuBadge =
  | 'pcbRfqPending'
  | 'pcbOrdersAwaiting'
  | 'pcbPosPending'
  | 'pcbRemittancePending'
  | 'pcbShipmentPending'
  | 'pcbClaimsPending';

export interface NextMenuItem {
  section: PcbAdminSection;
  labelKey: string;
  icon: Component;
  badge?: NextMenuBadge;
  /** 상세 등 형제 라우트에서도 이 메뉴를 활성 표시할 라우트 이름. */
  activeRouteNames?: readonly string[];
  /** 사용 빈도가 낮은 메뉴는 사이드바 아래쪽에 둔다(현재 PCB 엔 없음 — 셸은 지원만). */
  placement?: 'bottom';
}

export const nextPcbMenu: readonly NextMenuItem[] = [
  {
    section: 'cases',
    labelKey: 'admin.menu.pcbCases',
    icon: ClipboardList,
    activeRouteNames: [NEXT_PCB_ROUTES.case],
  },
  { section: 'rfqs', labelKey: 'admin.menu.pcbRfqs', icon: MessageSquareQuote, badge: 'pcbRfqPending' },
  { section: 'orders', labelKey: 'admin.menu.pcbOrders', icon: CreditCard, badge: 'pcbOrdersAwaiting' },
  { section: 'pos', labelKey: 'admin.menu.pcbPos', icon: FileText, badge: 'pcbPosPending' },
  {
    section: 'remittances',
    labelKey: 'admin.menu.pcbRemittances',
    icon: Banknote,
    badge: 'pcbRemittancePending',
  },
  { section: 'shipments', labelKey: 'admin.menu.pcbShipments', icon: Truck, badge: 'pcbShipmentPending' },
  { section: 'claims', labelKey: 'admin.menu.pcbClaims', icon: LifeBuoy, badge: 'pcbClaimsPending' },
];

export interface NextModuleLink {
  key: AdminModuleKey;
  labelKey: string;
  to: RouteLocationRaw;
}

/** 헤더 모듈 스위처 — PCB 는 리뉴얼 화면(마지막 본 워크큐), 나머지는 아직 옛 화면 홈으로 간다. */
export const nextModuleLinks = (pcbEntry: RouteLocationRaw): NextModuleLink[] =>
  adminModules.map((mod) => ({
    key: mod.key,
    labelKey: mod.labelKey,
    to: mod.key === 'pcb' ? pcbEntry : mod.homeTo,
  }));

/** Case 상세는 ?from= 의 워크큐 메뉴를 켠다(옛 셸 CASE_FROM_MENU 와 같은 규칙). */
export const effectiveMenuRouteName = (routeName: string, from: unknown): string => {
  if (routeName !== NEXT_PCB_ROUTES.case) return routeName;
  const section = PCB_ADMIN_SECTIONS.find((entry) => entry === from);
  return section === undefined ? routeName : NEXT_PCB_ROUTES[section];
};

export const isNextMenuActive = (item: NextMenuItem, effectiveRouteName: string): boolean =>
  NEXT_PCB_ROUTES[item.section] === effectiveRouteName ||
  item.activeRouteNames?.includes(effectiveRouteName) === true;

// ── 전환기 '이전 화면' — 리뉴얼 라우트를 같은 params·query 의 옛 라우트로 바꾼다.
// 옛 라우트 이름은 'admin-pcb-' + NEXT_PCB_ROUTES 의 키(cases·rfqs … package·case)다.
const LEGACY_PCB_BASE_PATH = '/admin/pcb';

export const legacyPcbRoute = (
  routeName: string,
  params: RouteParamsRawGeneric,
  query: LocationQueryRaw,
): RouteLocationRaw | null => {
  const entry = Object.entries(NEXT_PCB_ROUTES).find(([, name]) => name === routeName);
  if (entry === undefined) return null;
  const nextQuery: LocationQueryRaw = { ...query };
  // Case 상세의 복귀 링크도 옛 워크큐를 가리켜야 옛 화면의 safePcbReturnTo 가 받아 준다.
  const returnTo = nextQuery.returnTo;
  if (typeof returnTo === 'string' && returnTo.startsWith(NEXT_PCB_BASE_PATH)) {
    nextQuery.returnTo = LEGACY_PCB_BASE_PATH + returnTo.slice(NEXT_PCB_BASE_PATH.length);
  }
  return { name: `admin-pcb-${entry[0]}`, params, query: nextQuery };
};
