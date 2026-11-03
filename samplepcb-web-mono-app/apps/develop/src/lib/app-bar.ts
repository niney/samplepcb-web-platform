// 앱 셸 위 바의 자리(id) — AppShellLayout 이 빈 자리를 그리고, 화면은 AppBar 로 제목·안내·버튼을 그 자리에 보낸다(Teleport).
export const APP_BAR = {
  title: 'app-bar-title', // 제목 + 그 옆 버튼(Save Draft)
  guide: 'app-bar-guide', // 안내 한 줄(청록, 오류면 빨강)
  actions: 'app-bar-actions', // 안내 옆 버튼(PREVIOUS/NEXT 등)
  menu: 'app-bar-menu', // 사용자 메뉴 맨 위 항목
} as const;
