import type { Component } from 'vue';
import type { LocationQueryRaw, RouteLocationRaw, RouteParamsRawGeneric } from 'vue-router';
import {
  Banknote,
  ClipboardCheck,
  ClipboardList,
  Cpu,
  CreditCard,
  FilePenLine,
  FileText,
  FileUp,
  FolderKanban,
  Globe,
  Handshake,
  Images,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  List,
  Mail,
  MessageSquareQuote,
  MessagesSquare,
  PackageCheck,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Truck,
  Users,
  Warehouse,
} from '@lucide/vue';
import { adminModules, type AdminModuleKey } from '@/admin/menu';
import { isNextCoreRoute, LEGACY_CORE_QUOTES_ROUTE, legacyCoreRouteName, NEXT_CORE_ROUTES } from '@/next/core-navigation';
import {
  isNextDevelopQueueRoute,
  legacyDevelopRouteName,
  NEXT_DEVELOP_ROUTES,
} from '@/next/develop-navigation';
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

export type NextModuleKey = Extract<AdminModuleKey, 'core' | 'pcb' | 'smartbom' | 'develop'>;

export type NextMenuBadge =
  | 'rfqCount'
  | 'developReplyOverdue'
  | 'developReceived'
  | 'developAccepted'
  | 'developDocsAwaiting'
  | 'developDelivered'
  | 'developInquiries'
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
  /** 리뉴얼하지 않은 옛 화면으로 가는 메뉴(통합 견적관리) — 사이드바가 '이전 화면' 표지를 붙인다. */
  legacy?: true;
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

const coreItem = (
  key: keyof typeof NEXT_CORE_ROUTES,
  labelKey: string,
  icon: Component,
): NextMenuItem => ({
  key: `core-${key}`,
  routeName: NEXT_CORE_ROUTES[key],
  labelKey,
  icon,
  to: () => ({ name: NEXT_CORE_ROUTES[key] }),
});

const coreModule: NextModule = {
  key: 'core',
  labelKey: 'admin.modules.core',
  // 옛 통합 메뉴와 같은 순서. 견적관리는 리뉴얼하지 않아 옛 화면으로 간다(배지는 그대로).
  items: [
    coreItem('dashboard', 'admin.menu.dashboard', LayoutDashboard),
    {
      key: 'core-quotes',
      routeName: LEGACY_CORE_QUOTES_ROUTE,
      labelKey: 'admin.menu.quotes',
      icon: MessageSquareQuote,
      to: () => ({ name: LEGACY_CORE_QUOTES_ROUTE }),
      badge: 'rfqCount',
      legacy: true,
    },
    coreItem('orders', 'admin.menu.orders', ShoppingBag),
    coreItem('members', 'admin.menu.members', Users),
    coreItem('partners', 'admin.menu.partners', Handshake),
    coreItem('partnerParts', 'admin.menu.partnerParts', Warehouse),
    coreItem('parts', 'admin.menu.parts', Cpu),
    coreItem('slides', 'admin.menu.slides', Images),
    coreItem('seo', 'admin.menu.seo', Globe),
    coreItem('mailLogs', 'admin.menu.mailLogs', Mail),
    coreItem('deleteAudits', 'admin.menu.deleteAudits', Trash2),
    coreItem('settings', 'admin.menu.settings', Settings),
  ],
};

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

const developItem = (
  key: keyof typeof NEXT_DEVELOP_ROUTES,
  labelKey: string,
  icon: Component,
  extra: Pick<NextMenuItem, 'badge' | 'activeRouteNames'> = {},
): NextMenuItem => ({
  key: `develop-${key}`,
  routeName: NEXT_DEVELOP_ROUTES[key],
  labelKey,
  icon,
  to: () => ({ name: NEXT_DEVELOP_ROUTES[key] }),
  ...extra,
});

const developModule: NextModule = {
  key: 'develop',
  labelKey: 'admin.modules.develop',
  // 옛 개발 메뉴와 같은 순서(docs/DEVELOP_FLOW.md §14): 진행현황 → 접수·검토 → 견적·계약 → 진행 프로젝트 →
  // 납품·검수 → 문의·A/S → 전체 의뢰 → 설정. 배지 = "지금 관리자 차례" 하나씩.
  items: [
    developItem('home', 'admin.menu.developHome', ClipboardList, { badge: 'developReplyOverdue' }),
    developItem('intake', 'admin.menu.developIntake', Inbox, { badge: 'developReceived' }),
    developItem('contracts', 'admin.menu.developContracts', FilePenLine, { badge: 'developAccepted' }),
    developItem('projects', 'admin.menu.developProjects', FolderKanban, { badge: 'developDocsAwaiting' }),
    developItem('deliveries', 'admin.menu.developDeliveries', PackageCheck, { badge: 'developDelivered' }),
    developItem('inquiries', 'admin.menu.developInquiries', MessagesSquare, { badge: 'developInquiries' }),
    developItem('requests', 'admin.menu.developRequests', List, { activeRouteNames: [NEXT_DEVELOP_ROUTES.request] }),
    developItem('settings', 'admin.menu.developSettings', Settings),
  ],
};

export const nextModules: readonly NextModule[] = [coreModule, pcbModule, smartbomModule, developModule];

/** 라우트 이름 → 리뉴얼 모듈. 리뉴얼 라우트가 아니면 null. */
export const resolveNextModuleKey = (routeName: string): NextModuleKey | null =>
  isNextCoreRoute(routeName)
    ? 'core'
    : routeName.startsWith('admin-pcb-')
      ? 'pcb'
      : routeName.startsWith('admin-smartbom') || routeName.startsWith('admin-bom')
        ? 'smartbom'
        : routeName.startsWith('admin-develop')
          ? 'develop'
          : null;

export const nextModuleOf = (routeName: string): NextModule => {
  const key = resolveNextModuleKey(routeName);
  return key === 'core' ? coreModule : key === 'smartbom' ? smartbomModule : key === 'develop' ? developModule : pcbModule;
};

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
  // 개발 의뢰 상세는 떠나온 큐(from = 큐 라우트 이름)를 켠다. from 이 없으면 '전체 의뢰'(activeRouteNames).
  if (routeName === NEXT_DEVELOP_ROUTES.request && isNextDevelopQueueRoute(from)) return from;
  return routeName;
};

export const isNextMenuActive = (item: NextMenuItem, effectiveRouteName: string): boolean =>
  item.routeName === effectiveRouteName || item.activeRouteNames?.includes(effectiveRouteName) === true;

// ── '이전 화면' — 리뉴얼 라우트를 같은 params·query 의 옛 화면 라우트(/admin/legacy/*)로 바꾼다.
const LEGACY_PCB_BASE_PATH = '/admin/legacy/pcb';

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
    return { name: `admin-legacy-pcb-${pcbEntry[0]}`, params, query: nextQuery };
  }
  const legacyDevelop = legacyDevelopRouteName(routeName);
  if (legacyDevelop !== null) {
    // 상세의 from(떠나온 큐)도 옛 큐 이름이어야 옛 화면의 「← 목록으로」가 받아 준다.
    const nextQuery: LocationQueryRaw = { ...query };
    const from = nextQuery.from;
    if (typeof from === 'string') {
      const legacyFrom = legacyDevelopRouteName(from);
      if (legacyFrom === null) delete nextQuery.from;
      else nextQuery.from = legacyFrom;
    }
    return { name: legacyDevelop, params, query: nextQuery };
  }
  const legacyName = legacySmartbomRouteName(routeName) ?? legacyCoreRouteName(routeName);
  return legacyName === null ? null : { name: legacyName, params, query };
};
