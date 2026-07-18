import type { RouteLocationRaw } from 'vue-router';

// 관리자 사이드바 메뉴. label 은 i18n 키로 두어 다국어에 대비.
// badge 는 메뉴 옆 카운트 뱃지의 데이터 소스 식별자 — 해석은 AdminLayout 이 한다
// (현재는 rfqCount = 견적 대기 수 하나뿐).
export interface AdminMenuItem {
  to: RouteLocationRaw;
  labelKey: string;
  badge?: 'rfqCount';
}

// 실제 존재하는 기능만 노출한다 — 미구현 메뉴(주문/상품/통계/설정)는 기능 추가 시
// 라우트와 함께 되살린다(placeholder 나열 금지).
export const adminMenu: AdminMenuItem[] = [
  { to: { name: 'admin' }, labelKey: 'admin.menu.dashboard' },
  { to: { name: 'admin-quotes' }, labelKey: 'admin.menu.quotes', badge: 'rfqCount' },
  { to: { name: 'admin-orders' }, labelKey: 'admin.menu.orders' },
  { to: { name: 'admin-members' }, labelKey: 'admin.menu.members' },
  // 재능마켓(/market, sp-market) 관리
  { to: { name: 'admin-market-experts' }, labelKey: 'admin.menu.marketExperts' },
  { to: { name: 'admin-market-projects' }, labelKey: 'admin.menu.marketProjects' },
  { to: { name: 'admin-market-contracts' }, labelKey: 'admin.menu.marketContracts' },
  { to: { name: 'admin-market-settings' }, labelKey: 'admin.menu.marketSettings' },
  { to: { name: 'admin-bom' }, labelKey: 'admin.menu.bom' },
  { to: { name: 'admin-slides' }, labelKey: 'admin.menu.slides' },
  { to: { name: 'admin-seo' }, labelKey: 'admin.menu.seo' },
  { to: { name: 'admin-settings' }, labelKey: 'admin.menu.settings' },
];
