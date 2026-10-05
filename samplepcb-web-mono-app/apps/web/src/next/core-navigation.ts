// 관리자 리뉴얼(src/next) 통합(core) 모듈의 라우트 규약 — smartbom-navigation.ts 와 같은 문법.
//
// 리뉴얼 화면은 컷오버 전까지 /admin/next/* 에서 옛 화면(/admin/*)과 나란히 돈다. 라우트 이름은 옛 이름의
// 'admin' 을 'admin-next' 로 바꾼 것이고(대시보드 'admin' → 'admin-next'), 화면 코드는 이 파일의
// NEXT_CORE_ROUTES 로만 부른다 — 컷오버 때 값만 옛 이름으로 되돌리면 e2e·메일 딥링크·바깥 링크를 고치지
// 않고 넘어간다. 견적관리(admin-quotes)는 리뉴얼 대상이 아니라 메뉴가 옛 화면을 그대로 가리킨다.

export const NEXT_CORE_ROUTES = {
  dashboard: 'admin-next',
  orders: 'admin-next-orders',
  members: 'admin-next-members',
  partners: 'admin-next-partners',
  partnerParts: 'admin-next-partner-parts',
  parts: 'admin-next-parts',
  slides: 'admin-next-slides',
  seo: 'admin-next-seo',
  mailLogs: 'admin-next-mail-logs',
  deleteAudits: 'admin-next-delete-audits',
  settings: 'admin-next-settings',
} as const;

/** 리뉴얼하지 않고 옛 화면을 그대로 쓰는 통합 메뉴(견적관리). */
export const LEGACY_CORE_QUOTES_ROUTE = 'admin-quotes';

export const isNextCoreRoute = (routeName: string): boolean =>
  Object.values(NEXT_CORE_ROUTES).some((name) => name === routeName);

/** 리뉴얼 라우트 이름 → 옛 라우트 이름('이전 화면' 링크·컷오버 기준). */
export const legacyCoreRouteName = (nextName: string): string | null =>
  isNextCoreRoute(nextName) ? nextName.replace(/^admin-next/, 'admin') : null;
