// 실서비스 기준 로케일. 다른 로케일(en 등)은 이 shape 를 따른다.
// 분야·CAD 등 도메인 코드의 한글 라벨은 @sp/api-contract 의 MARKET_*_LABELS 가 정본이고,
// 여기는 화면 고유 문구만 둔다.
export const ko = {
  app: {
    name: 'SAMPLEPCB 재능마켓',
    tagline: '아이디어에서 양산까지, 하드웨어 개발의 모든 것',
    tel: '070-8667-1080',
  },
  auth: {
    greeting: '{nick}님',
    login: '로그인',
    logout: '로그아웃',
  },
  nav: {
    projects: '프로젝트 찾기',
    experts: '전문가 찾기',
    guide: '이용안내',
    request: '프로젝트 의뢰하기',
    expertRegister: '전문가 등록',
    me: '마이페이지',
  },
  common: {
    loading: '불러오는 중…',
    search: '검색',
    more: '더보기',
  },
  footer: {
    market: '재능마켓',
    corp: '주식회사 샘플피씨비 · 대표 오혜영 · 사업자등록번호 331-88-01750 · 통신판매업신고 2024-경기광명-0624 · 경기도 광명시 하안로 60 광명SK테크노파크 A-1303,1407',
  },
  home: {
    heroTitle: '아이디어에서 양산까지, 하드웨어 개발의 모든 것',
    heroSubtitle:
      '회로개발·PCB설계 전문가에게 블라인드 견적을 받아보세요. 개발이 끝나면 제작·SMT 양산까지 한 곳에서 이어집니다.',
    browseProjects: '프로젝트 둘러보기',
    recentProjects: '실시간 프로젝트',
    experts: '활동 중인 전문가',
    how: '이용 방법',
    trustTitle: '안심하고 거래할 수 있는 장치',
    noProjects: '아직 등록된 프로젝트가 없습니다.',
    beFirst: '첫 프로젝트 의뢰하기',
    noExperts: '등록된 전문가가 없습니다. 첫 전문가가 되어 주세요.',
  },
  projects: {
    title: '프로젝트 찾기',
    subtitle: '공개된 의뢰를 살펴보고 블라인드 견적을 제출하세요.',
    allCategories: '분야 전체',
    allMethods: '견적방식 전체',
    sortLatest: '최신순',
    sortDeadline: '마감임박순',
    searchPlaceholder: '제목·내용 검색',
    total: '총 {n}건',
    empty: '조건에 맞는 프로젝트가 없습니다.',
  },
  experts: {
    title: '전문가 찾기',
    subtitle: '분야별 전문가를 비교하고 지정견적을 요청하세요.',
    allCategories: '분야 전체',
    allCadTools: 'CAD 전체',
    searchPlaceholder: '이름·소개 검색',
    total: '총 {n}명',
    empty: '조건에 맞는 전문가가 없습니다.',
  },
};
