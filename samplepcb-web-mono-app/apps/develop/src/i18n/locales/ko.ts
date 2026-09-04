// 실서비스 로케일. 도메인 라벨(상태·분야·예산)은 @sp/api-contract 의 DEVELOP_*_LABELS·MARKET_*_LABELS 가 정본이고,
// 여기는 셸(헤더·푸터·내비)의 화면 고유 문구만 둔다. 페이지 카피는 ko 인라인(마켓 관례).
export const ko = {
  app: {
    name: 'SAMPLEPCB 개발의뢰',
    tagline: '아이디어를 회로·PCB·펌웨어·앱·서버까지, 샘플피씨비가 직접 개발합니다',
    tel: '070-8667-1080',
  },
  auth: {
    greeting: '{nick}님',
    login: '로그인',
    logout: '로그아웃',
  },
  nav: {
    how: '진행 방식',
    areas: '개발 분야',
    me: '내 의뢰',
    request: '개발 의뢰하기',
  },
  footer: {
    service: '개발의뢰',
    corp: '주식회사 샘플피씨비 · 대표 오혜영 · 사업자등록번호 331-88-01750 · 통신판매업신고 2024-경기광명-0624 · 경기도 광명시 하안로 60 광명SK테크노파크 A-1303,1407',
  },
  common: {
    loading: '불러오는 중…',
  },
};
