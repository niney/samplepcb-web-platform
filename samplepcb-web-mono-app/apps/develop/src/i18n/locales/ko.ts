// 실서비스 로케일. 도메인 라벨(상태·분야·예산)은 @sp/api-contract 의 DEVELOP_*_LABELS·MARKET_*_LABELS 가 정본이고,
// 여기는 셸(헤더·푸터·내비)의 화면 고유 문구만 둔다. 페이지 카피는 ko 인라인(마켓 관례).
export const ko = {
  app: {
    name: 'SAMPLEPCB 개발의뢰',
  },
  auth: {
    login: '로그인',
    logout: '로그아웃',
    register: '회원가입',
  },
  nav: {
    how: '진행 방식',
    areas: '개발 분야',
    me: '내 의뢰',
    request: '개발 의뢰하기',
  },
  common: {
    loading: '불러오는 중…',
  },
};
