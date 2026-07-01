import type { RouteLocationRaw } from 'vue-router';

// 사이드바 메뉴(임시 예시). label 은 i18n 키로 두어 다국어에 대비.
export interface AdminMenuItem {
  to: RouteLocationRaw;
  labelKey: string;
}

export const adminMenu: AdminMenuItem[] = [
  { to: { name: 'admin' }, labelKey: 'admin.menu.dashboard' },
  { to: { name: 'admin-quotes' }, labelKey: 'admin.menu.quotes' },
  { to: { name: 'admin-orders' }, labelKey: 'admin.menu.orders' },
  { to: { name: 'admin-products' }, labelKey: 'admin.menu.products' },
  { to: { name: 'admin-stats' }, labelKey: 'admin.menu.stats' },
  { to: { name: 'admin-settings' }, labelKey: 'admin.menu.settings' },
];
