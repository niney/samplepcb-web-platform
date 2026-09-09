// 그누보드 로그인/로그아웃 왕복 URL — SPA 는 서버 리다이렉트를 못 하므로 로그인이 필요한 액션에서
// window.location 으로 직접 이동한다. 같은 오리진이라 되돌아오면 auth.bootstrap() 이 PHPSESSID 를 JWT 로 교환한다.

// vue-router 의 fullPath 는 base(/develop)를 제외하므로 되돌아올 절대 경로로 복원한다.
export function developPath(routeFullPath: string): string {
  const path = routeFullPath.startsWith('/') ? routeFullPath : `/${routeFullPath}`;
  return `/develop${path === '/c' || path.startsWith('/c/') ? path : `/c${path}`}`;
}

export function loginUrl(returnPath: string): string {
  return `/bbs/login.php?url=${encodeURIComponent(returnPath)}`;
}

export function logoutUrl(returnPath: string): string {
  return `/bbs/logout.php?url=${encodeURIComponent(returnPath)}`;
}
