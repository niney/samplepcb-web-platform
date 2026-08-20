// 그누보드 로그인/로그아웃 왕복 URL — SPA 는 서버 리다이렉트를 못 하므로 로그인이
// 필요한 화면 진입 가드에서 window.location 으로 직접 이동한다(sp-market 관례 이식).
// 같은 오리진이라 로그인 후 되돌아오면 auth.bootstrap() 이 PHPSESSID 를 JWT 로 교환한다.

// vue-router 의 fullPath 는 base(/app)를 제외하므로 되돌아올 절대 경로로 복원한다.
export function appPath(routeFullPath: string): string {
  return `/app${routeFullPath.startsWith('/') ? routeFullPath : `/${routeFullPath}`}`;
}

export function loginUrl(returnPath: string): string {
  return `/bbs/login.php?url=${encodeURIComponent(returnPath)}`;
}

export function logoutUrl(returnPath: string): string {
  return `/bbs/logout.php?url=${encodeURIComponent(returnPath)}`;
}

export function memberInfoUrl(): string {
  return `/bbs/member_confirm.php?url=${encodeURIComponent('/bbs/register_form.php')}`;
}

// 견적관리(/shop/quotes) — PCB(거버)·부품 BOM 을 한 목록으로 묶는 고객 견적 정본이자
// 주문 종점이다. sp-php 화면이라 SPA 라우터가 아닌 전체 이동으로만 갈 수 있다.
export function quotesUrl(): string {
  return '/shop/quotes';
}

// 시스템 관리자(그누보드/영카트 관리자) — sp-php 프로젝트의 /adm/. 같은 오리진(nginx catch-all→sp-php)
// 이라 공유 PHPSESSID 관리자 세션 그대로 진입한다. 슈퍼관리자(cf_admin=me.isAdmin) 에게만 노출.
export function systemAdminUrl(): string {
  return '/adm/';
}
