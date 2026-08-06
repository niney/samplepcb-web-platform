import type { RouteLocationRaw } from 'vue-router';

// 관리자 사이드바 메뉴 — 헤더 모듈 스위처로 모듈별 메뉴를 전환한다
// (docs/SMARTBOM_PARTNER_RFQ.md §3.1). label 은 i18n 키로 두어 다국어에 대비.
// badge 는 메뉴 옆 카운트 뱃지의 데이터 소스 식별자 — 해석은 AdminLayout 이 한다
// (현재는 rfqCount = 견적 대기 수 하나뿐).
export interface AdminMenuItem {
  to: RouteLocationRaw;
  labelKey: string;
  badge?:
    | 'rfqCount'
    | 'bomOrdersAwaiting'
    | 'bomShipmentPending'
    | 'bomQuotesRequested'
    | 'bomPosAwaiting'
    | 'pcbRfqPending'
    | 'pcbPosPending'
    | 'pcbShipmentPending'
    | 'pcbOrdersAwaiting'
    | 'pcbRemittancePending';
  /** 상세 등 형제 라우트에서도 이 메뉴를 활성 표시할 라우트 이름. */
  activeRouteNames?: readonly string[];
}

export type AdminModuleKey = 'core' | 'smartbom' | 'pcb';

export interface AdminModule {
  key: AdminModuleKey;
  labelKey: string;
  /** 헤더 스위처 클릭 시 이동하는 모듈 홈. */
  homeTo: RouteLocationRaw;
  menu: AdminMenuItem[];
}

// 실제 존재하는 기능만 노출한다 — 미구현 메뉴(주문/상품/통계/설정)는 기능 추가 시
// 라우트와 함께 되살린다(placeholder 나열 금지).
export const adminMenu: AdminMenuItem[] = [
  { to: { name: 'admin' }, labelKey: 'admin.menu.dashboard' },
  { to: { name: 'admin-quotes' }, labelKey: 'admin.menu.quotes', badge: 'rfqCount' },
  { to: { name: 'admin-orders' }, labelKey: 'admin.menu.orders' },
  { to: { name: 'admin-members' }, labelKey: 'admin.menu.members' },
  { to: { name: 'admin-partners' }, labelKey: 'admin.menu.partners' },
  // 재능마켓(/market, sp-market) 관리
  { to: { name: 'admin-market-experts' }, labelKey: 'admin.menu.marketExperts' },
  { to: { name: 'admin-market-projects' }, labelKey: 'admin.menu.marketProjects' },
  { to: { name: 'admin-market-contracts' }, labelKey: 'admin.menu.marketContracts' },
  { to: { name: 'admin-market-settings' }, labelKey: 'admin.menu.marketSettings' },
  {
    to: { name: 'admin-bom' },
    labelKey: 'admin.menu.bom',
    // admin-bom 자체는 RouterLink exact-active가 처리하고 상세 형제 라우트만 보완한다.
    activeRouteNames: ['admin-bom-quote'],
  },
  { to: { name: 'admin-bom-quotes' }, labelKey: 'admin.menu.bomQuotes' },
  { to: { name: 'admin-parts' }, labelKey: 'admin.menu.parts' },
  { to: { name: 'admin-slides' }, labelKey: 'admin.menu.slides' },
  { to: { name: 'admin-seo' }, labelKey: 'admin.menu.seo' },
  { to: { name: 'admin-settings' }, labelKey: 'admin.menu.settings' },
];

// 스마트 BOM 모듈 — 역할별 업무 메뉴(관리자 메뉴 재편): 진행현황(총괄 조감) +
// 견적관리(견적 담당)/주문·결제(경리)/발주(구매)/선적·배송(물류) 워크큐.
// 배지 = 각 역할이 "지금 움직여야 하는 수" 하나씩.
const smartbomMenu: AdminMenuItem[] = [
  {
    to: { name: 'admin-smartbom' },
    labelKey: 'admin.menu.smartbomCases',
    activeRouteNames: ['admin-smartbom-case'],
  },
  // 견적 흐름 워크큐 — 검토 대기 수 배지
  {
    to: { name: 'admin-smartbom-quotes' },
    labelKey: 'admin.menu.smartbomQuotes',
    badge: 'bomQuotesRequested',
  },
  // 주문 축 워크큐(D19, 결제 관점) — 입금 대기 수 배지
  {
    to: { name: 'admin-smartbom-orders' },
    labelKey: 'admin.menu.smartbomOrders',
    badge: 'bomOrdersAwaiting',
  },
  // 발주 워크큐 — 발주 대기(결제 완료+미발주) 수 배지
  {
    to: { name: 'admin-smartbom-pos' },
    labelKey: 'admin.menu.smartbomPos',
    badge: 'bomPosAwaiting',
  },
  // 선적·배송 워크큐 — 관리자 차례 선적 수(D22) 배지(협력사 전이 후 메일을 놓쳐도 인지)
  {
    to: { name: 'admin-smartbom-logistics' },
    labelKey: 'admin.menu.smartbomLogistics',
    badge: 'bomShipmentPending',
  },
];

// PCB 협력 모듈(docs/PCB_PARTNER_TRACK.md §5.4) — SmartBOM 과 같은 골격의 역할별
// 워크큐(구현은 PCB 전용·분리): 진행현황(총괄 조감·모듈 홈)/견적요청(RFQ)/주문·결제
// (경리 — 레거시 이관 주문 이력 포함)/발주·EQ(구매)/선적·배송(물류).
const pcbMenu: AdminMenuItem[] = [
  {
    to: { name: 'admin-pcb-cases' },
    labelKey: 'admin.menu.pcbCases',
    activeRouteNames: ['admin-pcb-case'],
  },
  // 견적요청(RFQ) 워크큐 — 요청 대기 + 선정 대기 수 배지.
  {
    to: { name: 'admin-pcb-rfqs' },
    labelKey: 'admin.menu.pcbRfqs',
    badge: 'pcbRfqPending',
  },
  // 주문·결제 워크큐 — 입금 대기 수 배지(read-only 조감).
  {
    to: { name: 'admin-pcb-orders' },
    labelKey: 'admin.menu.pcbOrders',
    badge: 'pcbOrdersAwaiting',
  },
  // 발주·EQ 워크큐 — 발주 대기 + EQ 승인 대기 수 배지.
  {
    to: { name: 'admin-pcb-pos' },
    labelKey: 'admin.menu.pcbPos',
    badge: 'pcbPosPending',
  },
  // 송금 워크큐(P3.11 — 경리·재무) — 송금 대기(발주됐는데 한 푼도 안 나간 건) 수 배지.
  // 흐름 순서상 발주 다음·선적 앞에 둔다(발주 → 송금 → 선적).
  {
    to: { name: 'admin-pcb-remittances' },
    labelKey: 'admin.menu.pcbRemittances',
    badge: 'pcbRemittancePending',
  },
  // 선적·배송 워크큐 — 발송 대기 + 관리자 차례(입고·수취 처리) 수 배지.
  {
    to: { name: 'admin-pcb-shipments' },
    labelKey: 'admin.menu.pcbShipments',
    badge: 'pcbShipmentPending',
  },
];

// 모듈 사전 — core(통합) = 공용 기준정보와 기존 관리 기능, pcb·smartbom = 업무 모듈.
// 확장 자리(PCBA주문·기술개발)는 각 모듈이 실제로 생길 때 추가한다.
export const adminModules: readonly AdminModule[] = [
  { key: 'core', labelKey: 'admin.modules.core', homeTo: { name: 'admin' }, menu: adminMenu },
  {
    key: 'pcb',
    labelKey: 'admin.modules.pcb',
    homeTo: { name: 'admin-pcb-cases' },
    menu: pcbMenu,
  },
  {
    key: 'smartbom',
    labelKey: 'admin.modules.smartbom',
    homeTo: { name: 'admin-smartbom' },
    menu: smartbomMenu,
  },
];

// 라우트 이름 → 소속 모듈. 스위처 활성 상태는 이 파생이 단일 진실 — 북마크·새로고침
// 진입에서도 메뉴가 어긋나지 않는다(레거시 useAppMode gotcha 회수).
export const resolveAdminModuleKey = (routeName: string): AdminModuleKey =>
  routeName.startsWith('admin-smartbom')
    ? 'smartbom'
    : routeName.startsWith('admin-pcb')
      ? 'pcb'
      : 'core';
