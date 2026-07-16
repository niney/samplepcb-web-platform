import type { MarketRequestTypeType, MarketServiceAreaType } from './market';

// 재능마켓 요구사항 인터뷰 질문은행.
// 정본: /talent_market_ai_requirement_question_policy.md v1.0.0 (§7 공통, §8 분야별).
// 질문은행 전체와 실제 노출 질문은 분리한다. 정책상 한 번에 5개, 견적 전 총 15개를
// 넘기지 않으며, 앞 단계 폼에서 이미 받은 제품명·개발 분야는 반복 질문하지 않는다.

export type AiInterviewQuestionType = 'single' | 'multi' | 'text';
export type AiInterviewQuestionGroup = 'common' | 'integration' | 'domain';

export interface AiInterviewQuestion {
  code: string;
  bankRef: string;
  label: string;
  type: AiInterviewQuestionType;
  group: AiInterviewQuestionGroup;
  priority: 1 | 2 | 3 | 4 | 5 | 6;
  options?: readonly string[];
  placeholder?: string;
  areas?: readonly MarketServiceAreaType[];
  requestTypes?: readonly MarketRequestTypeType[];
  hideIf?: { code: string; values: readonly string[] };
}

interface QuestionBase {
  code: string;
  label: string;
  group: AiInterviewQuestionGroup;
  priority: AiInterviewQuestion['priority'];
  areas?: readonly MarketServiceAreaType[];
  requestTypes?: readonly MarketRequestTypeType[];
  placeholder?: string;
  hideIf?: AiInterviewQuestion['hideIf'];
}

const questionBase = (base: QuestionBase): Omit<AiInterviewQuestion, 'type' | 'options'> => ({
  code: base.code,
  bankRef: base.code,
  label: base.label,
  group: base.group,
  priority: base.priority,
  ...(base.areas === undefined ? {} : { areas: base.areas }),
  ...(base.requestTypes === undefined ? {} : { requestTypes: base.requestTypes }),
  ...(base.placeholder === undefined ? {} : { placeholder: base.placeholder }),
  ...(base.hideIf === undefined ? {} : { hideIf: base.hideIf }),
});

const textQuestion = (base: QuestionBase): AiInterviewQuestion => ({
  ...questionBase(base),
  type: 'text',
});

const selectableOptions = (options: readonly string[]): readonly string[] =>
  options.includes('잘 모르겠습니다') || options.includes('전문가 추천')
    ? options
    : [...options, '잘 모르겠습니다'];

const selectQuestion = (
  type: 'single' | 'multi',
  base: QuestionBase,
  options: readonly string[],
): AiInterviewQuestion => ({
  ...questionBase(base),
  type,
  options: selectableOptions(options),
});

const common = (code: string, label: string, priority: AiInterviewQuestion['priority'], placeholder?: string) =>
  textQuestion({ code, label, group: 'common', priority, ...(placeholder === undefined ? {} : { placeholder }) });

const domainText = (
  code: string,
  label: string,
  priority: AiInterviewQuestion['priority'],
  areas: readonly MarketServiceAreaType[],
  placeholder?: string,
) => textQuestion({
  code,
  label,
  group: 'domain',
  priority,
  areas,
  ...(placeholder === undefined ? {} : { placeholder }),
});

const domainSelect = (
  type: 'single' | 'multi',
  code: string,
  label: string,
  priority: AiInterviewQuestion['priority'],
  areas: readonly MarketServiceAreaType[],
  options: readonly string[],
) => selectQuestion(type, { code, label, group: 'domain', priority, areas }, options);

const systemText = (
  code: string,
  label: string,
  priority: AiInterviewQuestion['priority'],
  placeholder?: string,
) => textQuestion({
  code,
  label,
  group: 'integration',
  priority,
  requestTypes: ['system'],
  ...(placeholder === undefined ? {} : { placeholder }),
});

const systemSelect = (
  type: 'single' | 'multi',
  code: string,
  label: string,
  priority: AiInterviewQuestion['priority'],
  options: readonly string[],
) => selectQuestion(type, {
  code,
  label,
  group: 'integration',
  priority,
  requestTypes: ['system'],
}, options);

const CIRCUIT: readonly MarketServiceAreaType[] = ['circuit'];
const PCB: readonly MarketServiceAreaType[] = ['pcb'];
const FIRMWARE: readonly MarketServiceAreaType[] = ['firmware'];
const MECHANICAL: readonly MarketServiceAreaType[] = ['mechanical-design'];
const PRODUCT_DESIGN: readonly MarketServiceAreaType[] = ['product-design'];
const APP: readonly MarketServiceAreaType[] = ['app'];
const SERVER: readonly MarketServiceAreaType[] = ['server'];
const SOFTWARE: readonly MarketServiceAreaType[] = ['software-linux', 'software-windows'];

export const AI_INTERVIEW_QUESTIONS: readonly AiInterviewQuestion[] = [
  // §7 공통 필수 질문. COMMON-01·07은 앞 단계의 제목/설명·개발 분야에서 이미 받지만,
  // 추적 가능한 전체 질문은행을 유지하기 위해 데이터에는 남기고 선택 단계에서 제외한다.
  common('COMMON-01', '만들고 싶은 제품 또는 서비스는 무엇인가요?', 1, '제품이나 서비스를 한 문장으로 설명해 주세요.'),
  common('COMMON-02', '이 제품이나 서비스가 해결해야 하는 가장 중요한 문제는 무엇인가요?', 1),
  selectQuestion('multi', {
    code: 'COMMON-03', label: '누가, 어디에서, 어떤 상황에서 사용하나요?', group: 'common', priority: 3,
  }, ['일반 소비자', '기업 담당자', '관리자', '설치기사', '작업자', '기타', '잘 모르겠습니다']),
  common('COMMON-04', '반드시 필요한 핵심 기능을 최대 5개까지 알려주세요.', 1, '핵심 기능을 최대 5개까지 입력해 주세요.'),
  selectQuestion('single', {
    code: 'COMMON-05', label: '현재 어느 단계까지 진행되었나요?', group: 'common', priority: 5,
  }, [
    '아이디어만 있음', '요구사항 문서가 있음', '제품디자인이 있음', '기구설계가 있음',
    '회로도가 있음', 'PCB 파일이 있음', '펌웨어가 있음', '앱 또는 서버가 있음',
    '시제품이 있음', '기존 제품을 개선하려고 함',
  ]),
  common('COMMON-06', '현재 보유한 자료가 있다면 알려주세요.', 5, '예: 요구사항 문서, 회로도, PCB·BOM, 3D 파일, 소스코드, API 문서'),
  selectQuestion('multi', {
    code: 'COMMON-07', label: '이번에 개발을 요청하는 분야를 선택해 주세요.', group: 'common', priority: 2,
  }, ['시스템 개발', '회로설계', 'PCB 설계', '펌웨어', '기구설계', '제품디자인', '앱', '서버', '잘 모르겠습니다']),
  common('COMMON-08', '원하는 완료 시점과 예상 시제품 또는 생산 수량은 어떻게 되나요?', 5, '예: 2026년 12월, 시제품 10대, 양산 연 1,000대 / 미정'),
  selectQuestion('multi', {
    code: 'COMMON-09', label: '최종적으로 어떤 결과물을 받고 싶나요?', group: 'common', priority: 5,
  }, [
    '검토보고서', '시스템 구성도', '제품디자인 이미지', '3D 기구 파일', '회로도',
    'PCB 설계파일', 'BOM', '제작용 거버파일', '조립된 시제품', '펌웨어 소스코드',
    '앱 소스코드', '서버 소스코드', '테스트 문서', '양산자료', '앱스토어 등록',
    '서버 배포', '전문가 추천',
  ]),
  common('COMMON-10', '반드시 지켜야 하는 크기, 일정, 가격, 부품, 인증 또는 기존 시스템 조건이 있나요?', 3),

  // §8.1 시스템 개발. 실제 모델에서는 serviceArea가 아니라 requestType=system에 대응한다.
  systemText('SYSTEM-01', '제품이 켜진 후 사용이 끝날 때까지 어떻게 동작해야 하나요?', 1),
  systemText('SYSTEM-02', '제품이 받아들이는 정보나 사용자 조작은 무엇인가요?', 4, '예: 센서, 버튼, 카메라, 위치정보, 사용자 입력'),
  systemText('SYSTEM-03', '제품이 어떤 결과를 보여주거나 어떤 장치를 움직여야 하나요?', 4, '예: 화면 표시, 앱 알림, 모터 구동, 데이터 저장'),
  systemSelect('single', 'SYSTEM-04', '다른 장치, 앱, 서버 또는 기존 시스템과 연결되어야 하나요?', 2, [
    '연결 없이 단독 동작', '스마트폰과 연결', '인터넷 서버와 연결', '다른 장비와 연결',
    '기존 회사 시스템과 연동', '잘 모르겠습니다',
  ]),
  systemSelect('single', 'SYSTEM-05', '인터넷이나 장치 연결이 끊겨도 제품이 계속 동작해야 하나요?', 4, [
    '연결이 없어도 정상 동작', '일부 기능만 동작', '연결이 없으면 동작하지 않아도 됨', '잘 모르겠습니다',
  ]),
  systemSelect('multi', 'SYSTEM-06', '전원 차단, 센서 오류 또는 통신 실패가 발생하면 어떤 처리가 필요하나요?', 3, [
    '자동 복구', '오류 저장', '사용자 알림', '관리자 알림', '안전 정지', '전문가 추천',
  ]),
  systemText('SYSTEM-07', '이번 프로젝트에 포함할 영역과 제외할 영역이 정해져 있나요?', 2),

  // §8.2 회로설계
  domainSelect('single', 'CIRCUIT-01', '제품은 어떤 전원을 사용하나요?', 3, CIRCUIT, [
    'USB', '어댑터', '교체형 배터리', '충전식 배터리', '차량 전원', '산업용 전원', '태양광', '아직 정하지 않음',
  ]),
  domainText('CIRCUIT-02', '보드에 연결되는 센서, 버튼, LED, 디스플레이 또는 기타 부품은 무엇인가요?', 1, CIRCUIT),
  domainText('CIRCUIT-03', '모터, 릴레이, 밸브, 히터, 조명 또는 스피커처럼 전력을 사용해 움직이거나 동작시키는 장치가 있나요?', 1, CIRCUIT),
  domainSelect('single', 'CIRCUIT-04', '제품이 스마트폰, 인터넷 또는 다른 장비와 연결되어야 하나요?', 4, CIRCUIT, [
    '연결 없음', '스마트폰 근거리 연결', 'Wi-Fi 환경에서 인터넷 연결',
    '장소와 관계없이 이동통신 연결', '유선 장비 연결', '잘 모르겠습니다',
  ]),
  domainText('CIRCUIT-05', '제품 크기나 배터리 사용시간에 중요한 제한이 있나요?', 6, CIRCUIT, '최대 크기와 목표 사용시간을 아는 범위에서 입력해 주세요.'),
  domainSelect('multi', 'CIRCUIT-06', '제품을 어떤 환경에서 사용하나요?', 3, CIRCUIT, [
    '실내', '실외', '차량', '산업현장', '고온 또는 저온', '물이나 먼지가 많은 곳',
    '진동 또는 충격이 많은 곳', '기타',
  ]),
  domainText('CIRCUIT-07', '반드시 사용해야 하는 부품이나 기존 보드가 있나요?', 6, CIRCUIT),
  domainSelect('multi', 'CIRCUIT-08', '판매 또는 납품을 위해 필요한 인증이 있나요?', 3, CIRCUIT, [
    '국내 판매 예정', '해외 판매 예정', '고객사 납품규격 있음', '아직 정하지 않음',
  ]),

  // §8.3 PCB 설계
  domainSelect('single', 'PCB-01', 'PCB 설계에 사용할 회로도와 BOM이 준비되어 있나요?', 2, PCB, [
    '회로도와 BOM 모두 있음', '회로도만 있음', '기존 PCB 파일이 있음', '자료가 없음', '잘 모르겠습니다',
  ]),
  domainText('PCB-02', 'PCB가 들어갈 수 있는 최대 크기나 정해진 외형이 있나요?', 3, PCB, '가로·세로·높이, 원형/비정형 여부 또는 미정'),
  domainText('PCB-03', '커넥터, 버튼, LED, 디스플레이, 안테나 또는 나사홀의 위치가 정해져 있나요?', 3, PCB),
  domainText('PCB-04', '케이스 도면이나 STEP 파일이 있나요?', 5, PCB),
  domainSelect('multi', 'PCB-05', '무선통신, 카메라, 디스플레이, 고속통신, 모터 또는 높은 전류를 사용하는 기능이 있나요?', 1, PCB, [
    '무선통신', '카메라', '디스플레이', '고속통신', '모터', '높은 전류', '해당 없음',
  ]),
  domainSelect('multi', 'PCB-06', 'PCB 설계만 필요한가요, PCB 제작과 부품 실장까지 필요한가요?', 2, PCB, [
    'PCB 설계파일만', 'PCB 제작 포함', '부품 구매 포함', 'SMT 및 조립 포함', '완성 시제품 포함', '잘 모르겠습니다',
  ]),
  domainSelect('single', 'PCB-07', '시제품과 예상 양산 수량은 각각 어느 정도인가요?', 5, PCB, [
    '1~5개', '6~20개', '21~100개', '101~1,000개', '1,000개 이상', '미정',
  ]),

  // §8.4 펌웨어
  domainSelect('single', 'FIRMWARE-01', '펌웨어를 적용할 보드나 시제품이 준비되어 있나요?', 2, FIRMWARE, [
    '보드와 회로도 모두 있음', '보드만 있음', '회로도만 있음', '새로 개발해야 함', '잘 모르겠습니다',
  ]),
  domainText('FIRMWARE-02', '제품이 수행해야 하는 기능을 동작 순서대로 설명해 주세요.', 1, FIRMWARE),
  domainText('FIRMWARE-03', '버튼, 센서 또는 외부 신호가 들어오면 제품이 어떻게 반응해야 하나요?', 1, FIRMWARE),
  domainSelect('single', 'FIRMWARE-04', '측정, 저장 또는 전송은 얼마나 자주 해야 하나요?', 1, FIRMWARE, [
    '사용자가 요청할 때', '실시간 또는 즉시', '1초 단위', '1분 단위', '1시간 단위', '하루 단위', '조건 발생 시', '잘 모르겠습니다',
  ]),
  domainText('FIRMWARE-05', '앱, 서버 또는 다른 장치와 어떤 정보를 주고받아야 하나요?', 4, FIRMWARE),
  domainText('FIRMWARE-06', '배터리 제품인가요? 충전 또는 교체 없이 어느 정도 사용해야 하나요?', 3, FIRMWARE),
  domainSelect('single', 'FIRMWARE-07', '제품을 회수하지 않고 프로그램을 업데이트해야 하나요?', 4, FIRMWARE, [
    '원격 업데이트 필요', 'USB 또는 케이블 업데이트 가능', '업데이트 기능 불필요', '잘 모르겠습니다',
  ]),
  domainSelect('multi', 'FIRMWARE-08', '제품이 멈추거나 통신에 실패했을 때 자동 복구, 기록 또는 알림이 필요한가요?', 3, FIRMWARE, [
    '자동 재시작', '재연결 시도', '오류기록 저장', '사용자 알림', '안전 정지', '전문가 추천',
  ]),
  domainSelect('multi', 'FIRMWARE-09', '소스코드, 실행파일, 통신문서, 테스트문서 중 어떤 결과물이 필요한가요?', 5, FIRMWARE, [
    '소스코드', '실행파일', '통신문서', '테스트문서', '전문가 추천',
  ]),

  // §8.5 기구설계
  domainText('MECHANICAL-01', '케이스 안에 들어가는 PCB, 배터리, 화면, 센서, 모터 등의 부품은 무엇인가요?', 1, MECHANICAL),
  domainText('MECHANICAL-02', '제품의 최대 크기 또는 설치 가능한 공간이 정해져 있나요?', 3, MECHANICAL),
  domainText('MECHANICAL-03', '버튼, 커넥터, 화면, 카메라, 센서, LED 또는 통풍구의 위치가 정해져 있나요?', 3, MECHANICAL),
  domainSelect('single', 'MECHANICAL-04', '제품을 어떻게 설치하거나 고정하나요?', 3, MECHANICAL, [
    '책상 위', '벽면', '천장', '차량', '장비 내부', '손에 들고 사용', '몸에 착용', '기타', '미정',
  ]),
  domainSelect('multi', 'MECHANICAL-05', '방수, 먼지, 충격, 진동, 고온 또는 저온에 견뎌야 하나요?', 3, MECHANICAL, [
    '방수', '먼지', '충격', '진동', '고온', '저온', '해당 없음',
  ]),
  domainText('MECHANICAL-06', '사용자가 제품을 열거나 배터리, 필터, 센서 등의 부품을 교체해야 하나요?', 6, MECHANICAL),
  domainSelect('single', 'MECHANICAL-07', '외관 확인용 시제품인가요, 기능 시제품인가요, 양산용 설계인가요?', 5, MECHANICAL, [
    '외관 목업', '기능 시제품', '전시용 시제품', '소량 제작', '금형 양산', '잘 모르겠습니다',
  ]),
  domainText('MECHANICAL-08', 'PCB STEP 파일, 부품 3D 파일 또는 기존 케이스 자료가 있나요?', 5, MECHANICAL),

  // §8.6 제품디자인
  domainText('DESIGN-01', '이 제품의 주요 사용자는 누구인가요?', 1, PRODUCT_DESIGN),
  domainSelect('multi', 'DESIGN-02', '사용자가 제품을 처음 봤을 때 어떤 느낌을 받기를 원하나요?', 3, PRODUCT_DESIGN, [
    '전문적인', '견고한', '친근한', '고급스러운', '미래적인', '단순한', '귀여운', '친환경적인', '기타',
  ]),
  domainText('DESIGN-03', '제품 외부에 반드시 보여야 하는 화면, 버튼, LED, 로고 또는 센서가 있나요?', 1, PRODUCT_DESIGN),
  domainText('DESIGN-04', '제품 크기나 형태에 제한이 있나요?', 3, PRODUCT_DESIGN),
  domainText('DESIGN-05', '원하는 색상, 소재 느낌 또는 브랜드 이미지가 있나요?', 3, PRODUCT_DESIGN),
  domainText('DESIGN-06', '선호하는 제품이나 참고하고 싶은 이미지가 있나요?', 5, PRODUCT_DESIGN),
  domainSelect('multi', 'DESIGN-07', '외관 이미지 제안만 필요한가요, 실제 제작 가능한 디자인까지 필요한가요?', 2, PRODUCT_DESIGN, [
    '콘셉트 이미지', '외관 렌더링', 'CMF 제안', '디자인 3D 모델', '기구설계 연계', '양산 가능한 외관 설계', '잘 모르겠습니다',
  ]),
  domainText('DESIGN-08', '로고, 브랜드 가이드 또는 기존 디자인 자료가 있나요?', 5, PRODUCT_DESIGN),

  // §8.7 앱 개발
  domainSelect('multi', 'APP-01', 'Android, iPhone 또는 두 플랫폼 모두 지원해야 하나요?', 2, APP, [
    'Android', 'iPhone', '둘 다', '태블릿 포함', '잘 모르겠습니다',
  ]),
  domainSelect('multi', 'APP-02', '앱을 사용하는 사람은 누구인가요?', 1, APP, [
    '일반 사용자', '관리자', '설치기사', '작업자', '고객사 담당자', '여러 사용자 유형', '기타',
  ]),
  domainText('APP-03', '사용자가 앱에서 반드시 해야 하는 핵심 작업을 최대 5개까지 알려주세요.', 1, APP),
  domainSelect('single', 'APP-04', '앱이 제품과 가까운 거리에서 직접 연결되나요, 인터넷 서버를 통해 연결되나요?', 4, APP, [
    '제품과 직접 연결', '인터넷 서버를 통해 연결', '두 방식 모두', '하드웨어 연결 없음', '잘 모르겠습니다',
  ]),
  domainSelect('multi', 'APP-05', '회원가입, 로그인 또는 사용자별 권한구분이 필요한가요?', 2, APP, [
    '로그인 불필요', '일반 로그인', '소셜 로그인', '관리자와 일반 사용자 구분', '여러 권한 필요', '잘 모르겠습니다',
  ]),
  domainSelect('multi', 'APP-06', '알림, 위치정보, 카메라, QR코드, 결제 또는 파일 업로드 기능이 필요한가요?', 1, APP, [
    '알림', '위치정보', '카메라', 'QR코드', '결제', '파일 업로드', '해당 없음',
  ]),
  domainText('APP-07', '사용자가 확인해야 하는 화면이나 데이터는 무엇인가요?', 1, APP),
  domainText('APP-08', '화면 디자인, 참고 앱 또는 브랜드 가이드가 있나요?', 5, APP),
  domainSelect('single', 'APP-09', '앱스토어와 플레이스토어 등록까지 필요한가요?', 2, APP, [
    '개발만', '내부 테스트 배포', '스토어 등록 포함', '운영 및 업데이트 포함', '잘 모르겠습니다',
  ]),
  domainSelect('multi', 'APP-10', '앱 소스코드와 화면 디자인 원본파일이 모두 필요한가요?', 5, APP, [
    '앱 소스코드', '화면 디자인 원본파일', '둘 다', '전문가 추천',
  ]),

  // §8.8 서버 개발
  domainText('SERVER-01', '서버는 어떤 사용자, 앱 또는 장치에 서비스를 제공하나요?', 1, SERVER),
  domainSelect('multi', 'SERVER-02', '서버에서 저장하거나 처리해야 하는 정보는 무엇인가요?', 1, SERVER, [
    '회원정보', '장치정보', '센서 데이터', '위치정보', '이미지 또는 영상', '주문 및 결제', '로그', '보고서',
  ]),
  domainSelect('single', 'SERVER-03', '초기 예상 사용자 수 또는 연결 장치 수는 어느 정도인가요?', 6, SERVER, [
    '100 이하', '1,000 이하', '10,000 이하', '100,000 이하', '100,000 초과', '잘 모르겠습니다',
  ]),
  domainSelect('single', 'SERVER-04', '앱이나 장치가 데이터를 얼마나 자주 전송하나요?', 1, SERVER, [
    '사용자가 요청할 때', '이벤트 발생 시', '몇 초마다', '몇 분마다', '몇 시간마다', '하루 단위', '잘 모르겠습니다',
  ]),
  domainSelect('multi', 'SERVER-05', '결제, 지도, 문자, 이메일, ERP, 공공데이터 또는 기존 회사 시스템과 연동해야 하나요?', 4, SERVER, [
    '결제', '지도', '문자', '이메일', 'ERP', '공공데이터', '기존 회사 시스템', '해당 없음',
  ]),
  domainText('SERVER-06', '일반 사용자, 관리자, 협력사 등 사용자별 권한 구분이 필요한가요?', 2, SERVER),
  domainSelect('multi', 'SERVER-07', '실시간 상태 확인, 원격제어, 알림 또는 채팅 기능이 필요한가요?', 1, SERVER, [
    '실시간 상태 확인', '원격제어', '알림', '채팅', '해당 없음',
  ]),
  domainSelect('multi', 'SERVER-08', '개인정보, 결제정보, 위치정보 또는 회사의 중요정보를 저장하나요?', 3, SERVER, [
    '개인정보', '결제정보', '위치정보', '회사 중요정보', '해당 없음',
  ]),
  domainSelect('multi', 'SERVER-09', '서버 개발만 필요한가요, 배포와 운영·유지보수까지 필요한가요?', 2, SERVER, [
    '개발만', '테스트 서버 배포', '운영 서버 배포', '모니터링과 백업 포함', '유지보수 포함', '잘 모르겠습니다',
  ]),
  domainText('SERVER-10', '기존 서버, 도메인, 클라우드 계정, 데이터베이스 또는 API가 있나요?', 4, SERVER),

  // 현행 서비스 분야 보존: 정책에 빠진 Linux/Windows 소프트웨어 개발 질문.
  // 정책 확장 전까지 기술 선택이 아닌 실행 환경·외부 연동·납품 범위만 묻는다.
  domainText('SOFTWARE-01', '대상 운영체제와 프로그램의 실행 형태는 무엇인가요?', 2, SOFTWARE, '예: Windows 11 GUI 프로그램 / Ubuntu 백그라운드 서비스'),
  domainText('SOFTWARE-02', '연동할 장비, 기존 시스템 또는 보유 소스가 있나요?', 4, SOFTWARE, '예: USB 계측기, 시리얼 장비, 기존 C++ 소스'),
  domainText('SOFTWARE-03', '설치, 업데이트 또는 배포 범위에 요구가 있나요?', 5, SOFTWARE, '예: 오프라인 설치 파일과 자동 업데이트 필요'),
];

export interface AiInterviewSelectionContext {
  requestType: MarketRequestTypeType;
  serviceAreas: readonly MarketServiceAreaType[];
  knownQuestionCodes?: readonly string[];
}

const byPriority = (questions: readonly AiInterviewQuestion[]): AiInterviewQuestion[] =>
  questions
    .map((question, index) => ({ question, index }))
    .sort((a, b) => a.question.priority - b.question.priority || a.index - b.index)
    .map(({ question }) => question);

export function getApplicableAiInterviewQuestions(
  serviceAreas: readonly MarketServiceAreaType[],
  requestType: MarketRequestTypeType = 'individual',
): AiInterviewQuestion[] {
  const selected = new Set(serviceAreas);
  return AI_INTERVIEW_QUESTIONS.filter((question) => {
    if (question.requestTypes !== undefined && !question.requestTypes.includes(requestType)) return false;
    if (question.areas !== undefined && !question.areas.some((area) => selected.has(area))) return false;
    return true;
  });
}

const roundRobinDomainQuestions = (
  questions: readonly AiInterviewQuestion[],
  serviceAreas: readonly MarketServiceAreaType[],
  limit: number,
): AiInterviewQuestion[] => {
  const queues = serviceAreas.map((area) =>
    byPriority(questions.filter((question) => question.areas?.includes(area) === true)),
  );
  const offsets = queues.map(() => 0);
  const chosen: AiInterviewQuestion[] = [];
  const seen = new Set<string>();
  let progressed = true;
  while (chosen.length < limit && progressed) {
    progressed = false;
    for (let i = 0; i < queues.length && chosen.length < limit; i += 1) {
      const queue = queues[i];
      if (queue === undefined) continue;
      while ((offsets[i] ?? 0) < queue.length) {
        const offset = offsets[i] ?? 0;
        const question = queue[offset];
        offsets[i] = offset + 1;
        if (question === undefined || seen.has(question.code)) continue;
        seen.add(question.code);
        chosen.push(question);
        progressed = true;
        break;
      }
    }
  }
  return chosen;
};

export function selectAiInterviewQuestions(
  context: AiInterviewSelectionContext,
): AiInterviewQuestion[] {
  // COMMON-01(제품)과 COMMON-07(개발 분야)은 의뢰 마법사의 앞 단계 필수값이다.
  const alwaysKnown = new Set(['COMMON-01', 'COMMON-07']);
  const applicable = getApplicableAiInterviewQuestions(context.serviceAreas, context.requestType)
    .filter((question) => !alwaysKnown.has(question.code));
  const commonQuestions = byPriority(applicable.filter((question) => question.group === 'common')).slice(0, 8);
  const integrationQuestions = context.requestType === 'system'
    ? byPriority(applicable.filter((question) => question.group === 'integration')).slice(0, 4)
    : [];
  // 전체 개발은 정책 권장치(분야별 3개), 개별 개발은 남은 총량까지 핵심 질문을 사용한다.
  const domainLimit = context.requestType === 'system'
    ? 3
    : Math.max(0, 15 - commonQuestions.length);
  const domainQuestions = roundRobinDomainQuestions(
    applicable.filter((question) => question.group === 'domain'),
    context.serviceAreas,
    domainLimit,
  );
  // 선분석에서 이미 답이 확인된 질문은 최초 후보를 만든 뒤 제거한다. 제거한 자리를 낮은
  // 우선순위 질문으로 다시 채우지 않아 실제 질문 수가 줄어드는 정책을 보장한다.
  const known = new Set(context.knownQuestionCodes ?? []);
  return [...commonQuestions, ...integrationQuestions, ...domainQuestions]
    .slice(0, 15)
    .filter((question) => !known.has(question.code));
}

// 교체 이전 저장 데이터의 질문 라벨은 상세/스냅샷에서 계속 사람이 읽을 수 있어야 한다.
export const AI_INTERVIEW_LEGACY_QUESTION_LABELS: Readonly<Record<string, string>> = {
  stage: '현재 어느 단계에서 시작하나요?',
  delivery: '원하는 최종 결과물은 무엇인가요?',
  assets: '현재 보유한 자료·설계·소스가 있나요?',
  qty: '시제품 수량과 목표 양산 수량은?',
  power: '전원은 무엇을 사용하나요?',
  powerDetail: '입력 전압 범위·최대 소비전류',
  mcu: '정해진 메인 컨트롤러가 있나요?',
  sensors: '감지하거나 입력받을 것은 무엇인가요?',
  outputs: '제어할 출력·부하는 무엇인가요?',
  comm: '장치에 필요한 통신 방식은?',
  server: '서버·앱 연동이 필요한가요?',
  ui: '물리적인 상태 표시·조작 요소가 있나요?',
  enclosure: '케이스는 어떻게 제작하나요?',
  env: '사용 환경·방수방진·인증 요구가 있나요?',
  pcbInputs: 'PCB 설계 입력 자료',
  pcbConstraints: '기판 크기·특수 제약',
  mechanical: '목표 크기·재질·제작 방식',
  mechanicalAssets: '기존 도면·3D 데이터·참고 제품',
  appPlatform: '앱 대상 플랫폼',
  appScope: '앱 사용자·필수 화면·기능',
  appExisting: '기존 API·디자인·앱 연동',
  serverScope: '서버 개발 범위',
  serverScale: '예상 사용자·장치 수와 트래픽',
  serverEnv: '운영 환경·외부 연동·보안 요구',
  softwareTarget: '대상 OS·버전과 실행 형태',
  softwareIntegration: '연동 장비·기존 소스',
  softwareDelivery: '설치·업데이트·배포 방식',
};

export function aiInterviewQuestionLabel(code: string): string | undefined {
  return AI_INTERVIEW_QUESTIONS.find((question) => question.code === code)?.label
    ?? AI_INTERVIEW_LEGACY_QUESTION_LABELS[code];
}
