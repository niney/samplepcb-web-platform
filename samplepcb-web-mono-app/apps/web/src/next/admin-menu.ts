import type { Component } from 'vue';
import type { LocationQueryRaw, RouteLocationRaw, RouteParamsRawGeneric } from 'vue-router';
import {
  Banknote,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  FileUp,
  LifeBuoy,
  MessageSquareQuote,
  ShoppingCart,
  Truck,
} from '@lucide/vue';
import { adminModules, type AdminModuleKey } from '@/admin/menu';
import {
  NEXT_PCB_BASE_PATH,
  NEXT_PCB_ROUTES,
  PCB_ADMIN_SECTIONS,
  pcbAdminSectionTo,
  type PcbAdminMemory,
} from '@/next/pcb-navigation';
import { legacySmartbomRouteName, NEXT_SMARTBOM_ROUTES, smartbomSectionOf } from '@/next/smartbom-navigation';

// 리뉴얼 셸(AdminNextLayout)의 모듈·메뉴 정의 — 옛 admin/menu.ts 의 짝. 모듈을 하나 더 리뉴얼할 때는
// 여기 nextModules 에 항목을 더하고 배지 훅(useNextMenuBadges)에 합산식을 옮기면 사이드바·스위처·
// '이전 화면'이 그대로 따라온다. 메뉴 순서·라벨(i18n 키)·배지 식별자는 옛 메뉴와 같게 둔다.

export type NextModuleKey = Extract<AdminModuleKey, 'pcb' | 'smartbom'>;

export type NextMenuBadge =
  | 'pcbRfqPending'
  | 'pcbOrdersAwaiting'
  | 'pcbPosPending'
  | 'pcbRemittancePending'
  | 'pcbShipmentPending'
  | 'pcbClaimsPending'
  | 'bomQuotesRequested'
  | 'bomOrdersAwaiting'
  | 'bomPosAwaiting'
  | 'bomConfirmsNeedsAction'
  | 'bomShipmentPending'
  | 'bomClaimsPending';

/** 메뉴 링크를 만들 때 필요한 셸 상태 — PCB 는 마지막 본 탭을 기억한다. */
export interface NextMenuContext {
  pcbMemory: PcbAdminMemory;
}

export interface NextMenuItem {
  key: string;
  /** 이 메뉴가 가리키는 라우트 이름(활성 판정 기준). */
  routeName: string;
  labelKey: string;
  icon: Component;
  to: (ctx: NextMenuContext) => RouteLocationRaw;
  badge?: NextMenuBadge;
  /** 상세 등 형제 라우트에서도 이 메뉴를 활성 표시할 라우트 이름. */
  activeRouteNames?: readonly string[];
  /** 사용 빈도가 낮은 메뉴는 사이드바 아래쪽에 둔다. */
  placement?: 'bottom';
}

export interface NextModule {
  key: NextModuleKey;
  labelKey: string;
  items: readonly NextMenuItem[];
}

const pcbItem = (
  section: (typeof PCB_ADMIN_SECTIONS)[number],
  labelKey: string,
  icon: Component,
  extra: Pick<NextMenuItem, 'badge' | 'activeRouteNames'> = {},
): NextMenuItem => ({
  key: `pcb-${section}`,
  routeName: NEXT_PCB_ROUTES[section],
  labelKey,
  icon,
  to: (ctx) => pcbAdminSectionTo(ctx.pcbMemory, section),
  ...extra,
});

const smartbomItem = (
  key: keyof typeof NEXT_SMARTBOM_ROUTES,
  labelKey: string,
  icon: Component,
  extra: Pick<NextMenuItem, 'badge' | 'activeRouteNames' | 'placement'> = {},
): NextMenuItem => ({
  key: `smartbom-${key}`,
  routeName: NEXT_SMARTBOM_ROUTES[key],
  labelKey,
  icon,
  to: () => ({ name: NEXT_SMARTBOM_ROUTES[key] }),
  ...extra,
});

const pcbModule: NextModule = {
  key: 'pcb',
  labelKey: 'admin.modules.pcb',
  // 흐름 순서: 진행현황 → 견적요청 → 주문·결제 → 발주·EQ → 송금 → 선적·배송 → A/S.
  items: [
    pcbItem('cases', 'admin.menu.pcbCases', ClipboardList, { activeRouteNames: [NEXT_PCB_ROUTES.case] }),
    pcbItem('rfqs', 'admin.menu.pcbRfqs', MessageSquareQuote, { badge: 'pcbRfqPending' }),
    pcbItem('orders', 'admin.menu.pcbOrders', CreditCard, { badge: 'pcbOrdersAwaiting' }),
    pcbItem('pos', 'admin.menu.pcbPos', FileText, { badge: 'pcbPosPending' }),
    pcbItem('remittances', 'admin.menu.pcbRemittances', Banknote, { badge: 'pcbRemittancePending' }),
    pcbItem('shipments', 'admin.menu.pcbShipments', Truck, { badge: 'pcbShipmentPending' }),
    pcbItem('claims', 'admin.menu.pcbClaims', LifeBuoy, { badge: 'pcbClaimsPending' }),
  ],
};

const smartbomModule: NextModule = {
  key: 'smartbom',
  labelKey: 'admin.modules.smartbom',
  // 진행현황(총괄 조감) → 견적관리 → 주문·결제 → 발주 → 부품 확인 → 선적·배송 → 클레임, 아래에 BOM 업로드.
  items: [
    smartbomItem('cases', 'admin.menu.smartbomCases', ClipboardList, {
      activeRouteNames: [NEXT_SMARTBOM_ROUTES.case],
    }),
    smartbomItem('quotes', 'admin.menu.smartbomQuotes', MessageSquareQuote, { badge: 'bomQuotesRequested' }),
    smartbomItem('orders', 'admin.menu.smartbomOrders', CreditCard, { badge: 'bomOrdersAwaiting' }),
    smartbomItem('pos', 'admin.menu.smartbomPos', ShoppingCart, { badge: 'bomPosAwaiting' }),
    smartbomItem('confirms', 'admin.menu.smartbomConfirms', ClipboardCheck, { badge: 'bomConfirmsNeedsAction' }),
    smartbomItem('logistics', 'admin.menu.smartbomLogistics', Truck, {
      badge: 'bomShipmentPending',
      activeRouteNames: [NEXT_SMARTBOM_ROUTES.package],
    }),
    smartbomItem('claims', 'admin.menu.smartbomClaims', LifeBuoy, { badge: 'bomClaimsPending' }),
    smartbomItem('bom', 'admin.menu.bom', FileUp, {
      placement: 'bottom',
      activeRouteNames: [NEXT_SMARTBOM_ROUTES.bomQuote],
    }),
  ],
};

export const nextModules: readonly NextModule[] = [pcbModule, smartbomModule];

/** 라우트 이름 → 리뉴얼 모듈. 리뉴얼 라우트가 아니면 null. */
export const resolveNextModuleKey = (routeName: string): NextModuleKey | null =>
  routeName.startsWith('admin-next-pcb')
    ? 'pcb'
    : routeName.startsWith('admin-next-smartbom') || routeName.startsWith('admin-next-bom')
      ? 'smartbom'
      : null;

export const nextModuleOf = (routeName: string): NextModule =>
  resolveNextModuleKey(routeName) === 'smartbom' ? smartbomModule : pcbModule;

export interface NextModuleLink {
  key: AdminModuleKey;
  labelKey: string;
  to: RouteLocationRaw;
}

/** 헤더 모듈 스위처 — 리뉴얼된 모듈은 리뉴얼 화면으로(PCB 는 마지막 본 워크큐), 나머지는 옛 화면 홈으로. */
export const nextModuleLinks = (ctx: NextMenuContext): NextModuleLink[] =>
  adminModules.map((mod) => {
    const renewed = nextModules.find((next) => next.key === mod.key);
    const first = renewed?.items[0];
    return { key: mod.key, labelKey: mod.labelKey, to: first === undefined ? mod.homeTo : first.to(ctx) };
  });

/** Case 상세는 ?from= 의 워크큐 메뉴를 켠다(옛 셸 CASE_FROM_MENU 와 같은 규칙). */
export const effectiveMenuRouteName = (routeName: string, from: unknown): string => {
  if (routeName === NEXT_PCB_ROUTES.case) {
    const section = PCB_ADMIN_SECTIONS.find((entry) => entry === from);
    return section === undefined ? routeName : NEXT_PCB_ROUTES[section];
  }
  if (routeName === NEXT_SMARTBOM_ROUTES.case) {
    const section = smartbomSectionOf(typeof from === 'string' ? from : undefined);
    return section === null ? routeName : NEXT_SMARTBOM_ROUTES[section];
  }
  return routeName;
};

export const isNextMenuActive = (item: NextMenuItem, effectiveRouteName: string): boolean =>
  item.routeName === effectiveRouteName || item.activeRouteNames?.includes(effectiveRouteName) === true;

// ── 전환기 '이전 화면' — 리뉴얼 라우트를 같은 params·query 의 옛 라우트로 바꾼다.
const LEGACY_PCB_BASE_PATH = '/admin/pcb';

export const legacyNextRoute = (
  routeName: string,
  params: RouteParamsRawGeneric,
  query: LocationQueryRaw,
): RouteLocationRaw | null => {
  const pcbEntry = Object.entries(NEXT_PCB_ROUTES).find(([, name]) => name === routeName);
  if (pcbEntry !== undefined) {
    const nextQuery: LocationQueryRaw = { ...query };
    // Case 상세의 복귀 링크도 옛 워크큐를 가리켜야 옛 화면의 safePcbReturnTo 가 받아 준다.
    const returnTo = nextQuery.returnTo;
    if (typeof returnTo === 'string' && returnTo.startsWith(NEXT_PCB_BASE_PATH)) {
      nextQuery.returnTo = LEGACY_PCB_BASE_PATH + returnTo.slice(NEXT_PCB_BASE_PATH.length);
    }
    return { name: `admin-pcb-${pcbEntry[0]}`, params, query: nextQuery };
  }
  const legacySmartbom = legacySmartbomRouteName(routeName);
  return legacySmartbom === null ? null : { name: legacySmartbom, params, query };
};
