import type { AiUsecaseKeyType } from '@sp/api-contract';

// 관리자 프롬프트 테스트는 개인정보·실제 프로젝트를 전송하지 않고 코드 버전으로 고정한
// 대표 샘플을 사용한다. 유스케이스별 계약과 함께 단위 테스트해 샘플 자체의 노후화를 막는다.

const softwareSpec = JSON.stringify({
  project: {
    name: 'SMART INVENTORY PLATFORM',
    summary: '창고 작업자가 모바일로 재고를 처리하고 관리자가 현황을 보는 시스템',
    stage: 'spec',
    service_type: 'full',
  },
  groups: [
    { id: 'client', label: 'CLIENT' },
    { id: 'application', label: 'APPLICATION' },
    { id: 'data', label: 'DATA' },
    { id: 'operations', label: 'OPERATIONS' },
  ],
  blocks: [
    { id: 'mobile_app', group: 'client', type: 'client', label: '모바일 작업 앱', status: 'confirmed' },
    { id: 'admin_web', group: 'client', type: 'client', label: '웹 관리자', status: 'confirmed' },
    { id: 'inventory_api', group: 'application', type: 'api', label: '재고 관리 API', status: 'confirmed' },
    { id: 'notification_worker', group: 'application', type: 'worker', label: '알림 작업자', status: 'tbd' },
    { id: 'inventory_db', group: 'data', type: 'database', label: '재고 데이터베이스', status: 'confirmed' },
    { id: 'deployment', group: 'operations', type: 'operations', label: '배포·모니터링', status: 'tbd' },
  ],
  connections: [
    { from: 'mobile_app', to: 'inventory_api', interface: 'HTTPS JSON', flow: 'data' },
    { from: 'admin_web', to: 'inventory_api', interface: 'HTTPS JSON', flow: 'data' },
    { from: 'inventory_api', to: 'inventory_db', interface: 'SQL', flow: 'data' },
    { from: 'inventory_api', to: 'notification_worker', interface: 'Queue', flow: 'control' },
    { from: 'deployment', to: 'inventory_api', interface: 'Deploy / Metrics', flow: 'control' },
  ],
  constraints: ['개인정보 최소 수집', '모바일 네트워크 단절 후 재동기화 필요'],
  feature_highlights: ['바코드 기반 입출고', '재고 부족 알림', '관리자 이력 조회'],
  questions_missing: [
    { topic: '트래픽', question: '예상 동시 사용자 수와 일일 입출고 건수는 얼마인가요?' },
  ],
});

const electronicsInput = {
  title: '저온 창고 환경 모니터링 장치',
  serviceAreas: ['circuit', 'pcb', 'firmware'],
  categories: ['mcu', 'digital'],
  cadTools: ['altium'],
  description:
    '저온 창고의 온도와 문 열림 상태를 측정해 서버로 전송하는 장치입니다. 12V 전원과 이더넷을 사용하며 시제품 10대를 제작하려고 합니다.',
};

const softwareInput = {
  title: '스마트 물류 재고 관리 시스템',
  requestType: 'system',
  serviceAreas: ['app', 'server'],
  categories: [],
  cadTools: [],
  description:
    '창고 작업자가 모바일에서 바코드로 입출고를 처리하고 관리자가 웹에서 재고와 작업 이력을 확인하는 시스템을 개발합니다.',
  questionCodes: ['COMMON-05', 'COMMON-09', 'APP-01', 'SERVER-02', 'SERVER-03'],
  answers: [
    { code: 'COMMON-05', answer: '요구사항 문서가 있음' },
    { code: 'COMMON-09', answer: '앱 소스코드, 서버 소스코드, 서버 배포' },
    { code: 'APP-01', answer: 'Android, iPhone' },
    { code: 'SERVER-02', answer: '회원정보, 장치정보, 주문 및 결제, 로그' },
    { code: 'SERVER-03', answer: '1,000 이하' },
  ],
};

const documentInput = {
  ...softwareInput,
  budgetRange: 'r700_1500',
  startHopeDate: '2026-08-03',
  dueHopeDate: '2026-10-30',
  deadline: { days: 7 },
  method: 'open',
  spec: softwareSpec,
};

export function getAiAdminSampleInput(useCase: AiUsecaseKeyType): unknown {
  switch (useCase) {
    case 'market.request-diagram':
      return electronicsInput;
    case 'market.request-structurize':
      return softwareInput;
    case 'market.request-roc':
    case 'market.request-postings':
      return documentInput;
    case 'rnd.file-classify':
      return {
        requirements: '회로도와 PCB 제조 자료가 섞인 파일 묶음을 분류합니다.',
        files: [{
          id: 'F0001',
          path: 'prototype/board.kicad_pcb',
          extension: '.kicad_pcb',
          size: 1024,
          extracted: true,
        }],
        attachmentContext: '[첨부 F0001]\n- 분석 상태: 텍스트 추출\n- 추출 텍스트: (kicad_pcb 보드 파일)',
      };
  }
}
