// 실서비스 기준 로케일. 다른 로케일(en 등)은 이 shape 를 따른다.
// 분야·CAD 등 도메인 코드의 한글 라벨은 @sp/api-contract 의 MARKET_*_LABELS 가 정본이고,
// 여기는 화면 고유 문구만 둔다.
export const ko = {
  app: {
    name: 'SAMPLEPCB 재능마켓',
    tagline: '아이디어에서 양산까지, 하드웨어 개발의 모든 것',
  },
  auth: {
    greeting: '{nick}님',
    login: '로그인',
    logout: '로그아웃',
  },
  home: {
    heroTitle: '아이디어에서 양산까지, 하드웨어 개발의 모든 것',
    heroSubtitle: '회로개발·PCB설계 전문가를 만나보세요.',
    scaffoldNote: '재능마켓 화면을 준비 중입니다.',
  },
};
