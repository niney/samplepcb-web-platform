// 관리자 리뉴얼(src/next) 통합(core) 모듈의 라우트 규약 — smartbom-navigation.ts 와 같은 문법.
//
// 2026-10-10 컷오버 — 리뉴얼 화면이 정식 경로(/admin/*)·이름('admin', 'admin-*')을 이어받았고, 옛 화면은
// /admin/legacy/* · 'admin-legacy', 'admin-legacy-*' 로 물러났다. 화면 코드는 이 파일의 NEXT_CORE_ROUTES 로만 부른다.
// 견적관리(admin-quotes)는 리뉴얼 대상이 아니라 정식 경로 그대로 옛 셸에 남고, 메뉴가 그 화면을 가리킨다.

export const NEXT_CORE_ROUTES = {
  dashboard: 'admin',
  orders: 'admin-orders',
  members: 'admin-members',
  partners: 'admin-partners',
  partnerParts: 'admin-partner-parts',
  parts: 'admin-parts',
  slides: 'admin-slides',
  seo: 'admin-seo',
  mailLogs: 'admin-mail-logs',
  deleteAudits: 'admin-delete-audits',
  settings: 'admin-settings',
} as const;

/** 리뉴얼하지 않고 옛 화면을 그대로 쓰는 통합 메뉴(견적관리). */
export const LEGACY_CORE_QUOTES_ROUTE = 'admin-quotes';

export const isNextCoreRoute = (routeName: string): boolean =>
  Object.values(NEXT_CORE_ROUTES).some((name) => name === routeName);

/** 리뉴얼 라우트 이름 → 옛 화면 라우트 이름('이전 화면' 링크). */
export const legacyCoreRouteName = (nextName: string): string | null =>
  isNextCoreRoute(nextName) ? nextName.replace(/^admin/, 'admin-legacy') : null;
