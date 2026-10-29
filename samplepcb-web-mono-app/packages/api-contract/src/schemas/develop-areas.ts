import { MARKET_EXPERT_PICK_LABEL, createAreaRegistry, withUnknown } from './area-registry';
import type { MarketAreaDef, MarketQuestionDef, MarketToolOption } from './area-registry';
import { MARKET_AREA_MAP } from './market-areas';

// ── 개발의뢰(sp-develop) 분야 레지스트리 (docs/DEVELOP_FLOW.md §7.2, 2026-09-08 위저드 v2 → 2026-10-30 메뉴 6장) ────────
// 개발의뢰는 마켓과 **메뉴가 다르다**: 1스텝에서 「시스템개발」(배타 — 회로·PCB·펌웨어·기구·앱·서버·시제품을
// 통합 분석) 또는 개별 메뉴(회로 설계·PCB 설계·펌웨어 개발·역설계·앱 및 서버 개발, 복수 선택) 중 하나를 고른다.
// 메뉴 구성은 피그마 01-1(70:566) 6장 그대로다(사용자 결정 2026-10-29) — 기구 설계 메뉴는 없고, 기구는 시스템개발
// 안에서만 다룬다. '앱 및 서버 개발'은 카드 한 장이 계약 두 분야(app·server)를 고르고, 3스텝 첫 문항(범위)으로 줄인다.
// 세부 질문은 비개발자 검토를 거친 확정본(docs/prototypes/develop-menu-questions-plan.html, 2026-10-30)과 같다.
//
// 저장 `serviceAreas` 는 시스템개발이면 **6분야**(circuit·pcb·firmware·mech·app·server — 역설계는 들지 않는다),
// 개별이면 고른 것만이다 — 배지·검토서 분야 카드·프롬프트가 분야 코드만 보고 동작하게(6분야 = 시스템개발 배지).
// 질문은 분야별(개별 메뉴, 선택지+서술 혼합) 또는 시스템개발 전용 문항 — 팩토리 `fullQuestions` 가 6분야 선택 시
// 분야별 질문 대신 이 문항을 낸다. 회로·펌웨어·PCB·앱·서버의 프롬프트 조각·툴·슬롯은 마켓 레지스트리 정의를
// 그대로 재사용한다(정본 하나). 기구설계(mech)·역설계(reverse)만 여기서 새로 정의한다.

const base = (code: string): MarketAreaDef => {
  const def = MARKET_AREA_MAP.get(code);
  if (def === undefined) throw new Error(`market area missing: ${code}`);
  return def;
};

// 개별 메뉴에서 고를 수 있는 분야(레지스트리 순서). 시스템개발은 DEVELOP_SYSTEM_AREA_CODES.
export const DEVELOP_INDIVIDUAL_AREA_CODES: readonly string[] = ['circuit', 'pcb', 'firmware', 'reverse', 'app', 'server'];
export const DEVELOP_INDIVIDUAL_TAG = '전문 질문 제공';
export const DEVELOP_SYSTEM_MENU = {
  label: '시스템 개발',
  hint: '회로·PCB·펌웨어·기구·앱·서버·시제품을 통합 분석',
  tag: '설명과 첨부자료 중심',
} as const;

// 1스텝 개별 메뉴 카드(화면 순서 = 피그마 01-1). 카드 하나가 분야 여러 개를 고를 수 있다('앱 및 서버').
export interface DevelopMenuCard {
  readonly code: string;
  readonly label: string;
  readonly areas: readonly string[];
}
export const DEVELOP_MENU_CARDS: readonly DevelopMenuCard[] = [
  { code: 'circuit', label: '회로 설계', areas: ['circuit'] },
  { code: 'pcb', label: 'PCB 설계', areas: ['pcb'] },
  { code: 'firmware', label: '펌웨어 개발', areas: ['firmware'] },
  { code: 'reverse', label: '역설계', areas: ['reverse'] },
  { code: 'appserver', label: '앱 및 서버 개발', areas: ['app', 'server'] },
];
// 개별 메뉴를 이만큼 고르면 시스템개발을 권하는 안내를 띄운다(질문 수는 줄이지 않는다 — 검토 회신 5, 2026-10-30).
export const DEVELOP_SYSTEM_SUGGEST_CARDS = 3;

const MCAD_TOOLS: readonly MarketToolOption[] = [
  { code: 'solidworks', label: 'SolidWorks' },
  { code: 'fusion360', label: 'Fusion 360' },
  { code: 'inventor', label: 'Inventor' },
  { code: 'catia', label: 'CATIA' },
  { code: 'nx', label: 'NX' },
  { code: 'creo', label: 'Creo' },
];

// ── 공유 문항 ────────────────────────────────────────────────────────────────
// 입력 전원 — 전원 형태와 입력 전압만 묻는다(배터리 용량·충전·보호 회로는 전문가가 제안). 시스템개발·회로 설계가 같은 문장을 쓴다.
const powerQuestion = (code: string): MarketQuestionDef => ({
  code, label: '제품의 입력 전원은 어떻게 준비할까요?', short: '입력 전원', multi: true,
  options: withUnknown([
    { code: 'ac', label: '상용 AC 220V(내장 전원·SMPS)' },
    { code: 'adapter', label: '어댑터' },
    { code: 'battery_rechargeable', label: '충전식 배터리' },
    { code: 'battery_primary', label: '1차 배터리(건전지)' },
    { code: 'usb', label: 'USB 전원' },
    { code: 'other', label: '기타' },
  ], '잘 모르겠어요·전문가 추천'),
  notePlaceholder: '입력 전압 또는 범위 (예: DC 24V, DC 9~36V)',
  why: '전원 형태와 전압에 따라 전원 회로와 보호 회로가 달라집니다. 전원 부품·배터리 용량·충전 회로 같은 상세 설계는 전문가가 검토해 제안합니다.',
  promptHint: '전원 형태·입력 전압은 전원부 구성의 사실 근거다(배터리 용량·충전·보호 회로는 전문가 제안 사항이라 확정하지 않는다)',
});

// 통신 — 회로 설계·펌웨어 개발이 공유한다(둘 다 고르면 한 번만 묻는다). 코드 접두가 분야가 아니라 프롬프트 접두가 붙지 않는다.
const COMM_QUESTION: MarketQuestionDef = {
  code: 'hw.comm', label: '어떤 통신 기능이 필요한가요?', short: '통신', multi: true,
  options: withUnknown([
    { code: 'uart', label: 'UART·RS-232' },
    { code: 'rs485', label: 'RS-485·Modbus' },
    { code: 'can', label: 'CAN' },
    { code: 'ethernet', label: 'Ethernet' },
    { code: 'usb', label: 'USB' },
    { code: 'ble', label: 'BLE' },
    { code: 'wifi', label: 'Wi-Fi' },
    { code: 'zigbee', label: 'Zigbee·Thread' },
    { code: 'lora', label: 'LoRa' },
    { code: 'lte', label: 'LTE·LTE-M·NB-IoT' },
    { code: 'g5', label: '5G' },
    { code: 'other', label: '기타' },
    { code: 'none', label: '없음' },
  ]),
  notePlaceholder: '연결할 장비·통신 규격 (규격 문서가 있으면 2단계 참고 자료에 첨부)',
  why: '다른 장비와 통신하면 통신 회로와 주고받는 규칙을 만드는 일이 범위에 들어갑니다. 무선이 있으면 안테나와 전파 인증도 함께 봅니다.',
  promptHint: '통신 방식은 인터페이스 회로·프로토콜 구현 범위의 사실 근거다(무선이면 안테나·전파 인증이 따라온다)',
};

// 앱 및 서버 — 범위·작업 종류는 두 분야가 공유한다(카드 한 장 = 한 번만 묻는다).
export const DEVELOP_APP_SERVER_SCOPE_CODE = 'appserver.scope';
const APP_SERVER_SHARED: readonly MarketQuestionDef[] = [
  {
    code: DEVELOP_APP_SERVER_SCOPE_CODE, label: '어디까지 개발이 필요하신가요?', short: '개발 범위', multi: false,
    options: withUnknown([
      { code: 'app', label: '앱만' },
      { code: 'server', label: '서버만' },
      { code: 'both', label: '앱과 서버 모두' },
    ], '전문가와 상담'),
    why: '고르신 범위의 질문만 아래에 나타납니다. 상담을 고르시면 앱과 서버를 모두 검토합니다.',
    promptHint: '앱·서버 범위는 고객이 고른 것이다(상담이면 둘 다 검토 대상)',
  },
  {
    code: 'appserver.type', label: '새로 개발하시나요, 기존 앱·서버를 고치시나요?', short: '작업 종류', multi: false,
    options: withUnknown([
      { code: 'new', label: '신규 개발' },
      { code: 'improve', label: '기존 앱·서버 개선·기능 추가' },
      { code: 'migrate', label: '기존 시스템 이전·재개발' },
    ], '전문가와 상담'),
    notePlaceholder: '기존 앱·서버가 있으면 사용 중인 기술과 소스 보유 여부',
    why: '기존 시스템이 있으면 소스와 구조를 먼저 파악해야 해서 작업 방식과 비용이 달라집니다.',
    promptHint: '기존 시스템이 있으면 그 자료(소스·DB·API)의 유무가 작업 방식을 정한다',
  },
];

// ── 시스템개발 전용 문항 — 분석 후 추가 확인 5 + 디자인·기구 범위 2(선택지) ────
// 분석 후 추가 확인은 AI 후속 질문이 꺼졌거나 실패했을 때만 보인다(AI 질문이 대신한다). 목적·현재 단계는 2스텝이 받는다.
// 디자인·기구의 담당을 각각 묻는다. 범위 2문항은 견적 전제라 **전문가에게 맡김을 골라도 묻는다**(askOnDelegate).
const DELEGATE_UNKNOWN_LABEL = '잘 모르겠음 (전문가 판단 요청)'; // 피그마 01-3(135:21830) 표기
export const DEVELOP_SYSTEM_COLLAB_QUESTIONS: readonly MarketQuestionDef[] = [
  {
    code: 'system.product_design', label: '제품 외관 디자인은 어떻게 준비하시나요?', short: '제품디자인', multi: false, askOnDelegate: true,
    why: '제품의 외관·형태·사용성을 정하는 디자인입니다.',
    options: withUnknown([
      { code: 'ready', label: '디자인 파일과 사양이 준비됨' },
      { code: 'other_vendor', label: '다른 업체가 진행 중·진행 예정' },
      { code: 'request', label: '샘플피씨비에 제품디자인부터 의뢰' },
      { code: 'modify', label: '기존 디자인을 바탕으로 샘플피씨비에 수정 의뢰' },
      { code: 'none', label: '제품디자인은 필요 없음' },
    ], DELEGATE_UNKNOWN_LABEL),
    notePlaceholder: '업체가 맡는 범위와 자료 전달 예정 시기 (선택)',
    noteVisibleFor: ['other_vendor'],
    promptHint: '제품디자인이 준비됐는지·누가 하는지는 기구·시제품 항목이 이번 범위인지 정한다',
  },
  {
    code: 'system.mech_design', label: '기구설계는 어떻게 준비하시나요?', short: '기구설계', multi: false, askOnDelegate: true,
    why: '케이스 구조·부품 배치·조립 방법을 정하는 설계입니다.',
    options: withUnknown([
      { code: 'ready', label: '기구설계 파일이 준비됨' },
      { code: 'other_vendor', label: '다른 업체가 진행 중·진행 예정' },
      { code: 'request', label: '샘플피씨비에 기구설계부터 의뢰' },
      { code: 'modify', label: '기존 기구자료를 바탕으로 샘플피씨비에 수정 의뢰' },
      { code: 'none', label: '기구설계는 필요 없음' },
    ], DELEGATE_UNKNOWN_LABEL),
    notePlaceholder: '업체가 맡는 범위와 자료 전달 예정 시기 (선택)',
    noteVisibleFor: ['other_vendor'],
    promptHint: '기구설계 자료의 유무·주체는 PCB 외형 제약과 기구 항목의 범위를 정한다',
  },
];
export const DEVELOP_SYSTEM_QUESTIONS: readonly MarketQuestionDef[] = [
  {
    code: 'system.io', label: '제품이 어떤 동작을 해야 하나요?', short: '동작', multi: false, kind: 'text', options: [],
    notePlaceholder: '입력되는 값 → 처리·판단 → 표시·제어 결과',
    promptHint: '입력(센서·통신)과 출력(구동·표시·알림)의 나열이 하드웨어 블록과 펌웨어 기능 명세의 뼈대다',
  },
  {
    code: 'system.env', label: '제품은 어떤 환경에서 사용하나요?', short: '사용 환경', multi: true,
    options: withUnknown([
      { code: 'indoor', label: '실내' },
      { code: 'outdoor', label: '실외' },
      { code: 'industrial', label: '산업 현장' },
      { code: 'vehicle', label: '차량' },
      { code: 'portable', label: '휴대용' },
      { code: 'other', label: '기타' },
    ]),
    notePlaceholder: '온도·방수 조건 등',
    promptHint: '사용 환경은 보호 등급·온도 범위·내구 조건의 사실 근거다',
  },
  powerQuestion('system.power'),
  {
    code: 'system.connect', label: '외부 장비 또는 사용자와 어떻게 연결하나요?', short: '연결', multi: true,
    options: withUnknown([
      { code: 'wired', label: '유선' },
      { code: 'wireless', label: '무선' },
      { code: 'ui', label: '화면·버튼' },
      { code: 'none', label: '연결 필요 없음' },
    ]),
    promptHint: '연결 방식은 통신 회로·펌웨어 프로토콜·앱 필요 여부의 사실 근거다',
  },
  {
    code: 'system.cert', label: '필요한 인증이나 적용 국가가 있나요?', short: '인증', multi: true,
    options: withUnknown([
      { code: 'kc', label: 'KC' },
      { code: 'ce', label: 'CE' },
      { code: 'fcc', label: 'FCC' },
      { code: 'other', label: '기타' },
      { code: 'none', label: '필요 없음' },
    ]),
    notePlaceholder: '수출할 국가, 기타 규격',
    promptHint: '인증·적용 국가는 회로·기구 설계 단계의 대비 항목이다',
  },
  ...DEVELOP_SYSTEM_COLLAB_QUESTIONS,
];
// 시스템개발 "전문가에게 맡김"에서 남기는 문항 코드 — 등록·수정 라우트가 이 밖의 답변을 버린다.
export const DEVELOP_DELEGATE_KEPT_CODES: readonly string[] = DEVELOP_SYSTEM_QUESTIONS.filter((q) => q.askOnDelegate === true).map((q) => q.code);
export const keepDevelopDelegateAnswers = <T extends { code: string }>(answers: readonly T[]): T[] =>
  answers.filter((a) => DEVELOP_DELEGATE_KEPT_CODES.includes(a.code));

// ── 역설계 — 권리 확인(필수) · 잠긴 칩 미추출 ──────────────────────────────────
// 묶음 맨 위 안내(검토 회신 2, 2026-10-30). 권리 확인이 '유지보수 목적'·'상담'이면 담당자가 견적 전에 작업 가능 여부를 확인한다.
export const DEVELOP_REVERSE_NOTICE = '권리자 허락 없이 타사 제품을 복제하는 의뢰는 받지 않습니다. 잠긴 칩의 프로그램은 추출하지 않습니다.';
export const DEVELOP_REVERSE_RIGHTS_CODE = 'reverse.rights';
export const DEVELOP_REVERSE_RIGHTS_CHECK_CHOICES: readonly string[] = ['maintenance', 'consult'];
// 관리자 신호 — 역설계 권리 확인을 담당자가 해야 하는 의뢰(접수 목록 배지·상세 첫 줄).
export const developReverseRightsCheckNeeded = (answers: readonly { code: string; choices: readonly string[] }[]): boolean =>
  answers.some((a) => a.code === DEVELOP_REVERSE_RIGHTS_CODE && a.choices.some((c) => DEVELOP_REVERSE_RIGHTS_CHECK_CHOICES.includes(c)));

// ── 분야 7종(레지스트리 순서 = 배지·검토서 카드 순서) ────────────────────────────────
export const DEVELOP_AREAS: readonly MarketAreaDef[] = [
  {
    ...base('circuit'),
    label: '회로 설계',
    questions: [
      {
        code: 'circuit.type', label: '어떤 회로 설계가 필요하신가요?', short: '작업 종류', multi: false,
        options: withUnknown([
          { code: 'new', label: '신규 회로 설계' },
          { code: 'modify', label: '기존 회로 수정·개선' },
          { code: 'eol', label: '단종 부품 대체' },
        ], '전문가와 상담'),
        notePlaceholder: '바꿀 범위가 있으면 적어 주세요',
        why: '고치는 일이면 기존 회로 자료와 바꿀 범위에 따라 작업량이 달라집니다.',
        promptHint: '수정·대체면 기존 회로 자료의 형태와 변경 범위가 작업량을 정한다',
      },
      powerQuestion('circuit.power'),
      {
        code: 'circuit.parts', label: '반드시 사용해야 하는 부품이 있나요?', short: '지정 부품', multi: false,
        options: withUnknown([
          { code: 'fixed', label: '정해진 부품 있음' },
          { code: 'candidate', label: '후보 부품 있음' },
          { code: 'none', label: '지정 없음' },
        ], MARKET_EXPERT_PICK_LABEL),
        notePlaceholder: '부품명·모델명 (후보가 있으면 모두)',
        why: '정해진 부품이 있으면 부품을 고르는 일이 줄어듭니다.',
        promptHint: '지정 부품이 있으면 그 부품이 회로 구성의 전제다(대체 검토는 상의 항목)',
      },
      {
        code: 'circuit.input', label: '어떤 입력·표시 장치가 들어가나요?', short: '입력·표시', multi: true,
        options: withUnknown([
          { code: 'sensor', label: '센서 입력' },
          { code: 'button', label: '버튼·스위치' },
          { code: 'display', label: '화면 표시' },
          { code: 'other', label: '기타' },
          { code: 'none', label: '없음' },
        ]),
        notePlaceholder: '센서 종류, 화면 크기 등',
        why: '들어가는 장치 목록이 회로 구성의 뼈대입니다.',
        promptHint: '입력·표시 장치 목록이 회로 블록 구성의 사실 근거다',
      },
      {
        code: 'circuit.output', label: '제품에서 직접 제어할 대상이 있나요?', short: '제어 대상', multi: true,
        options: withUnknown([
          { code: 'motor', label: '모터·팬' },
          { code: 'relay', label: '릴레이·밸브' },
          { code: 'heater', label: '히터' },
          { code: 'led', label: 'LED·조명' },
          { code: 'speaker', label: '스피커' },
          { code: 'none', label: '없음' },
        ]),
        why: '모터나 히터처럼 큰 전기를 쓰는 부품이 있으면 구동 회로와 보호 장치가 더 들어갑니다.',
        promptHint: '구동 부하(모터·히터·릴레이)는 구동 회로·보호 소자·방열의 사실 근거다',
      },
      COMM_QUESTION,
      {
        code: 'circuit.cert', label: '필요한 인증이나 적용 규격이 있나요?', short: '인증', multi: true,
        options: withUnknown([
          { code: 'kc', label: 'KC' },
          { code: 'ce', label: 'CE' },
          { code: 'fcc', label: 'FCC' },
          { code: 'safety', label: '전기안전' },
          { code: 'other', label: '기타' },
          { code: 'none', label: '필요 없음' },
        ]),
        notePlaceholder: '수출할 국가, 기타 규격',
        why: '인증을 받아야 하면 회로를 설계할 때부터 대비해야 합니다.',
        promptHint: '인증·규격은 회로 설계 단계의 대비 항목(절연 거리·EMC 대책·부품 등급)이다',
      },
      {
        code: 'circuit.deliver', label: '어떤 결과물을 받고 싶으신가요?', short: '납품 결과물', multi: true,
        options: withUnknown([
          { code: 'source', label: '회로도 원본' },
          { code: 'pdf', label: '회로도 PDF' },
          { code: 'bom', label: 'BOM' },
        ], MARKET_EXPERT_PICK_LABEL),
        notePlaceholder: '설계 프로그램(Altium, OrCAD, KiCad 등)',
        why: '무엇을 받으실지에 따라 작업 범위와 비용이 정해집니다.',
        promptHint: '납품 결과물 목록은 산출물 범위 그대로다',
      },
    ],
  },
  {
    ...base('pcb'),
    label: 'PCB 설계',
    hint: '회로자료 검토, 회로도 복원·작성, PCB Layout',
    questions: [
      {
        code: 'pcb.source', label: '회로도와 부품 정보가 준비되어 있나요?', short: '회로 자료', multi: false,
        options: withUnknown([
          { code: 'editable', label: '편집 가능한 회로도·BOM 있음' },
          { code: 'pdf_image', label: 'PDF·이미지 회로도만 있음' },
          { code: 'partial', label: '일부 자료만 있음' },
          { code: 'none', label: '자료 없음' },
        ], '상담 필요'),
        why: '회로도가 PDF나 이미지뿐이면 설계 프로그램에 다시 그리는 작업이 먼저 필요합니다.',
        promptHint: '편집 가능한 회로도가 없으면 회로도 작성(재입력)이 PCB 설계 앞에 선다',
      },
      {
        code: 'pcb.type', label: 'PCB 설계 작업 범위는 무엇인가요?', short: '작업 종류', multi: false,
        options: withUnknown([
          { code: 'new', label: '신규 설계' },
          { code: 'modify', label: '기존 PCB 수정' },
        ], '전문가와 상담'),
        notePlaceholder: '변경 범위가 있으면 적어 주세요',
        promptHint: '수정이면 기존 설계 자료의 형태와 변경 범위가 작업량을 정한다',
      },
      {
        code: 'pcb.size', label: '원하는 PCB 크기와 형태가 있나요?', short: '크기·형태', multi: false,
        options: withUnknown([
          { code: 'fixed', label: '크기 지정' },
          { code: 'drawing', label: '기구 도면 제공' },
          { code: 'free', label: '제한 없음' },
        ], '상담 필요'),
        notePlaceholder: '가로×세로(mm), 고정홀·커넥터 위치, 높이 제한',
        why: '크기와 고정 위치가 정해져 있으면 그 안에서 부품을 배치합니다.',
        promptHint: '외형·고정홀·커넥터·높이 제한은 배치 제약으로 명세에 적는다',
      },
      {
        code: 'pcb.board', label: 'PCB 층수와 종류가 정해져 있나요?', short: '층수·종류', multi: false,
        options: withUnknown([
          { code: 'l1', label: '1층' },
          { code: 'l2', label: '2층' },
          { code: 'l4', label: '4층' },
          { code: 'l6', label: '6층 이상' },
          { code: 'flex', label: 'FPCB·Rigid-Flex' },
        ], MARKET_EXPERT_PICK_LABEL),
        notePlaceholder: '두께 등 다른 조건',
        promptHint: '기판 종류·층수는 제작 방식과 배선 밀도의 사실 근거다',
      },
      {
        code: 'pcb.signal', label: '특별히 고려해야 할 회로가 있나요?', short: '주의 회로', multi: true,
        options: withUnknown([
          { code: 'rf', label: 'RF·안테나' },
          { code: 'hdi', label: 'HDI' },
          { code: 'buildup', label: 'Build-up' },
          { code: 'impedance', label: '임피던스 제어' },
          { code: 'highspeed', label: '고속 신호' },
          { code: 'power', label: '고전압·대전류' },
          { code: 'analog', label: '정밀 아날로그' },
          { code: 'none', label: '해당 없음' },
        ]),
        promptHint: '고속·RF·대전류 신호가 있으면 임피던스·길이 정합·방열은 전문가 결정 사항이라 검토서는 사실만 적는다',
      },
      {
        code: 'pcb.tool', label: '사용해야 하는 PCB 설계 프로그램이 있나요?', short: '설계 툴', multi: false,
        options: withUnknown([
          { code: 'altium', label: 'Altium' },
          { code: 'orcad', label: 'OrCAD·Allegro' },
          { code: 'pads', label: 'PADS' },
          { code: 'kicad', label: 'KiCad' },
          { code: 'other', label: '기타' },
        ], '제한 없음'),
        notePlaceholder: '버전, 기타 프로그램 이름',
        promptHint: '설계 툴은 납품 원본 파일 형식을 정한다(고객 사내 툴과 맞춰야 이어서 수정할 수 있다)',
      },
      {
        code: 'pcb.deliver', label: '어떤 결과물을 받고 싶으신가요?', short: '납품 결과물', multi: true,
        options: withUnknown([
          { code: 'source', label: 'PCB 설계 원본' },
          { code: 'gerber', label: 'Gerber·드릴' },
          { code: 'bom', label: 'BOM' },
          { code: 'pnp', label: '부품 배치 자료' },
          { code: 'step', label: '3D 자료' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '납품 결과물 목록은 산출물 범위 그대로다',
      },
    ],
  },
  {
    ...base('firmware'),
    questions: [
      {
        code: 'firmware.board', label: '펌웨어를 개발할 하드웨어가 준비되어 있나요?', short: '하드웨어', multi: false,
        options: withUnknown([
          { code: 'ready', label: '동작하는 보드 보유' },
          { code: 'schematic', label: '회로도만 보유' },
          { code: 'developing', label: '보드 개발 중' },
          { code: 'need_hw', label: '하드웨어 개발도 필요' },
        ], '상담 필요'),
        why: "보드가 없으면 회로와 PCB부터 만들어야 합니다. '하드웨어 개발도 필요'라면 1단계에서 회로 설계·PCB 설계도 함께 골라 주세요.",
        promptHint: '보드가 없으면 펌웨어 검증 시점이 하드웨어 일정에 묶인다',
      },
      {
        code: 'firmware.mcu', label: '사용하려는 MCU 또는 개발 플랫폼이 있나요?', short: 'MCU', multi: false,
        options: withUnknown([
          { code: 'stm32', label: 'STM32' },
          { code: 'nrf', label: 'Nordic nRF' },
          { code: 'esp32', label: 'ESP32' },
          { code: 'linux', label: 'Linux 기반 보드' },
          { code: 'other', label: '기타' },
        ], MARKET_EXPERT_PICK_LABEL),
        notePlaceholder: '정확한 모델명',
        why: '어떤 칩을 쓰는지에 따라 개발 방법과 기간이 달라집니다.',
        promptHint: 'MCU·플랫폼은 개발 환경과 재사용 가능한 드라이버 범위를 정한다',
      },
      {
        code: 'firmware.flow', label: '제품이 어떤 순서로 동작해야 하나요?', short: '동작 순서', multi: false, kind: 'text', options: [],
        notePlaceholder: '입력값 → 판단 조건 → 동작 결과 / 동작 주기',
        why: '동작 순서가 개발할 기능 목록이 됩니다.',
        promptHint: '동작 순서 나열이 펌웨어 기능 명세의 뼈대다',
      },
      COMM_QUESTION,
      {
        code: 'firmware.update', label: '펌웨어를 어떻게 업데이트하나요?', short: '업데이트', multi: false,
        options: withUnknown([
          { code: 'ota', label: '원격 업데이트(OTA·FOTA)' },
          { code: 'cable', label: '케이블 연결' },
          { code: 'none', label: '업데이트 필요 없음' },
        ], MARKET_EXPERT_PICK_LABEL),
        why: '원격 업데이트가 필요하면 처음부터 그 기능을 넣어 설계해야 합니다.',
        promptHint: '원격 업데이트는 부트로더·메모리 분할·실패 복구가 설계 전제다',
      },
      {
        code: 'firmware.failure', label: '통신 오류나 제품 이상이 발생하면 어떻게 동작해야 하나요?', short: '이상 시 동작', multi: true,
        options: withUnknown([
          { code: 'retry', label: '재시도' },
          { code: 'alert', label: '오류 알림' },
          { code: 'safe', label: '안전 상태 전환' },
          { code: 'recover', label: '자동 복구' },
          { code: 'log', label: '오류 기록' },
        ], MARKET_EXPERT_PICK_LABEL),
        why: '고장 났을 때의 동작은 무인·산업용 제품에서 특히 중요합니다.',
        promptHint: '이상 시 동작은 안전 상태 정의·워치독·재접속 정책으로 이어진다',
      },
      {
        code: 'firmware.deliver', label: '어떤 결과물을 받고 싶으신가요?', short: '납품 결과물', multi: true,
        options: withUnknown([
          { code: 'source', label: '소스 코드' },
          { code: 'binary', label: '실행 파일' },
          { code: 'flashing', label: '다운로드 방법' },
          { code: 'manual', label: '사용자 매뉴얼' },
          { code: 'test', label: '시험 결과' },
        ], MARKET_EXPERT_PICK_LABEL),
        notePlaceholder: '개발 환경(STM32CubeIDE, ESP-IDF 등)',
        why: '무엇을 받으실지에 따라 작업 범위와 비용이 정해집니다.',
        promptHint: '납품 결과물 목록은 산출물 범위 그대로다',
      },
    ],
  },
  {
    code: 'reverse',
    label: '역설계',
    short: '역설계',
    hint: '보유한 PCB를 분석해 회로도·BOM·설계 자료 복원',
    kind: 'hardware',
    questions: [
      {
        code: DEVELOP_REVERSE_RIGHTS_CODE, label: '분석 대상 제품에 대한 권리 또는 분석 허락을 확인해 주세요.', short: '권리 확인', multi: false, required: true,
        options: [
          { code: 'own', label: '자사 제품이며 관련 권리 보유' },
          { code: 'permitted', label: '권리자의 분석 또는 복원 허락을 받음' },
          { code: 'maintenance', label: '단종 제품 유지보수 목적으로 권리 확인이 어려움' },
          { code: 'consult', label: '권리 확인을 위해 상담' },
        ],
        notePlaceholder: '제품 출처, 허락받은 범위 (선택)',
        why: '권리를 확인하기 전에는 분석 범위를 정하지 않습니다. 셋째·넷째를 고르시면 담당자가 견적 전에 작업 가능 여부를 확인합니다.',
        promptHint: '권리 확인 답이 유지보수 목적·상담이면 담당자가 견적 전에 작업 가능 여부를 확인해야 한다',
      },
      {
        code: 'reverse.target', label: '어떤 PCB를 제공하실 예정인가요?', short: '제공 샘플', multi: true,
        options: withUnknown([
          { code: 'board', label: 'PCB 단품' },
          { code: 'product', label: '케이스에 조립된 완제품' },
          { code: 'working', label: '동작하는 샘플' },
          { code: 'broken', label: '고장 난 샘플' },
          { code: 'photo', label: '사진·자료로 먼저 상담' },
        ]),
        notePlaceholder: '제품명·모델명, PCB 크기, 제공 가능한 수량',
        why: '대상에 따라 분해·분석 방법과 필요한 장비가 달라집니다.',
        promptHint: '제공 샘플의 형태·상태·수량은 분석 방법과 검증 가능 범위의 사실 근거다',
      },
      {
        code: 'reverse.work', label: '어떤 작업이 필요하신가요?', short: '필요 작업', multi: true,
        options: withUnknown([
          { code: 'schematic', label: '회로도 작성' },
          { code: 'bom', label: 'BOM 작성' },
          { code: 'layout', label: 'PCB Layout 복원' },
          { code: 'gerber', label: 'Gerber 파일 생성' },
          { code: 'firmware', label: '펌웨어 추출' },
          { code: 'pcba', label: 'PCBA 제작 및 검증' },
          { code: 'improve', label: '기존 제품 개선' },
        ], '전문가와 상담'),
        why: 'Gerber 파일은 PCB Layout 자료가 있어야 만들 수 있어, 없으면 Layout 복원을 함께 검토합니다.',
        promptHint: '필요 작업 목록이 역설계 산출 범위다 — Gerber 는 Layout 복원이 전제, 개선은 회로·PCB 설계 견적으로 이어진다',
      },
      {
        code: 'reverse.board', label: 'PCB에 대해 알고 있는 정보를 알려주세요.', short: '기판 정보', multi: true,
        options: withUnknown([
          { code: 'l2', label: '1~2층' },
          { code: 'l4', label: '4층 이상' },
          { code: 'layers_unknown', label: '층수 모름' },
          { code: 'bga', label: 'BGA 등 하부 단자 부품' },
          { code: 'unmarked', label: '부품 표기 확인 어려움' },
          { code: 'flex', label: 'FPCB·Rigid-Flex' },
        ]),
        notePlaceholder: 'PCB 크기, 대략적인 부품 수, 주요 IC 모델명',
        why: '층수와 부품 크기에 따라 분석 난이도와 기간이 달라집니다.',
        promptHint: '층수·하부 단자 부품·표기 지워짐은 분석 난이도와 파괴 분석 필요성의 사실 근거다',
      },
      {
        code: 'reverse.destructive', label: '샘플을 분해하거나 파괴 분석할 수 있나요?', short: '분해 허용', multi: false,
        options: withUnknown([
          { code: 'non_destructive', label: '비파괴 분석만 가능' },
          { code: 'disassemble', label: '부품 탈착 등 분해 가능' },
          { code: 'destructive', label: 'PCB 절단·층별 분리 등 파괴 분석 가능' },
          { code: 'decide_later', label: '분석 방법 확인 후 결정' },
        ]),
        why: '여러 층으로 된 기판은 속을 보려면 분해가 필요할 수 있습니다. 분해·파괴 분석에 동의한 샘플은 돌려드리지 못할 수 있습니다. 샘플은 보내 주시고 돌려받는 택배비는 고객 부담이며, 견적은 실물 샘플을 받은 뒤 확정합니다.',
        promptHint: '분해 허용 범위는 내층 확인 가능 여부와 샘플 반환 가능 여부를 정한다',
      },
      {
        code: 'reverse.firmware', label: '펌웨어 추출 관련 자료가 있나요?', short: '펌웨어 자료', multi: true,
        showWhen: { code: 'reverse.work', anyOf: ['firmware'] },
        options: withUnknown([
          { code: 'known_part', label: 'MCU·메모리 부품명을 알고 있음' },
          { code: 'has_source', label: '원본 파일 또는 소스 보유' },
          { code: 'known_tool', label: '다운로드 장비·방법을 알고 있음' },
          { code: 'none', label: '관련 자료 없음' },
        ]),
        notePlaceholder: 'MCU·메모리 모델명, 보유 파일 형식, 읽기 보호 여부',
        why: '읽기 보호가 걸려 있으면 추출하지 않고 새 펌웨어 개발을 안내합니다. 추출은 자사 제품이거나 권리자 허락을 받은 경우에만 진행합니다.',
        promptHint: '읽기 보호된 칩은 추출하지 않는다 — 보호 여부를 확인하고, 보호돼 있으면 신규 펌웨어 개발로 안내한다',
      },
      {
        code: 'reverse.pcba', label: '어떤 PCBA 검증이 필요한가요?', short: 'PCBA 검증', multi: true,
        showWhen: { code: 'reverse.work', anyOf: ['pcba'] },
        options: withUnknown([
          { code: 'compare', label: '기존 PCB와 동작 비교' },
          { code: 'basic', label: '전원·기본 입출력' },
          { code: 'comm', label: '통신 기능' },
          { code: 'full', label: '전체 기능' },
          { code: 'spec', label: '시험 기준서에 따른 검증' },
        ], '전문가와 상담'),
        notePlaceholder: '시험 방법, 연결 장비, 합격 기준',
        why: '원본 샘플과 시험 환경에 따라 검증 범위를 협의합니다. 제작 수량은 4단계에서 알려 주세요.',
        promptHint: 'PCBA 검증 기준은 시험 장비·원본 샘플 대조 범위를 정한다',
      },
      {
        code: 'reverse.deliver', label: '어떤 형태로 결과물을 받고 싶으신가요?', short: '납품 결과물', multi: true,
        options: withUnknown([
          { code: 'pdf', label: '회로도 PDF' },
          { code: 'schematic_source', label: '회로도 원본' },
          { code: 'bom', label: 'BOM' },
          { code: 'layout', label: 'PCB Layout 원본' },
          { code: 'gerber', label: 'Gerber·드릴' },
          { code: 'firmware', label: '추출한 펌웨어 파일(가능한 경우)' },
          { code: 'pcba', label: '제작된 PCBA' },
          { code: 'test_report', label: 'PCBA 시험 결과서' },
        ], '전문가와 상담'),
        notePlaceholder: '원하는 설계 프로그램 및 파일 형식',
        why: '무엇을 받으실지에 따라 작업 범위와 비용이 정해집니다.',
        promptHint: '납품 결과물 목록은 산출물 범위 그대로다',
      },
    ],
    tools: { label: 'PCB 설계 툴', options: [] },
    attachmentSlots: [
      { code: 'photo', label: '제품·PCB 사진', hint: '앞·뒷면, 주요 IC 표기' },
      { code: 'docs', label: '기존 자료', hint: '회로도·부품 목록·매뉴얼 일부' },
    ],
    prompt: {
      what: '고객이 제공한 PCB·제품 샘플을 분석해 회로도·BOM·PCB Layout·Gerber 같은 설계 자료를 복원하는 일(권리 확인 전제, 읽기 보호된 펌웨어는 추출하지 않음)',
      specItems: ['분석 대상 샘플·수량', '복원 범위(회로도·BOM·Layout·Gerber)', '분해·파괴 분석 허용 범위', '펌웨어 처리 방식', 'PCBA 검증 기준', '납품 형식'],
      checks: [
        '권리 확인 답이 유지보수 목적·상담이면 견적 전에 작업 가능 여부를 확인해야 한다는 상의 항목을 맨 앞에',
        '샘플 수량·분해 허용이 자료에 없으면 분석 방법과 샘플 반환 여부',
        '펌웨어 추출을 원하면 읽기 보호 여부 — 보호돼 있으면 추출하지 않고 신규 펌웨어 개발로 안내',
        'Gerber 를 원하는데 Layout 자료가 없으면 Layout 복원 범위',
      ],
    },
  },
  // 기구 — 시스템개발 안에서만(개별 메뉴 없음, 2026-10-30). 분야별 질문은 없다(시스템개발 외관·기구 2문항이 대신한다).
  {
    code: 'mech',
    label: '기구 설계',
    short: '기구',
    hint: '케이스·내부 구조·방열·시제품·양산 설계',
    kind: 'hardware',
    questions: [],
    tools: { label: '기구 설계 툴', options: MCAD_TOOLS },
    attachmentSlots: [
      { code: 'step', label: '3D 자료·STEP', hint: '기존 설계, PCB 3D, 참고 형상' },
      { code: 'dxf', label: '2D 도면·DXF', hint: '외형·치수 도면' },
      { code: 'photo', label: '실물·참고 사진', hint: '복원 대상, 비슷한 제품' },
      { code: 'internals', label: '내부 구성품 자료', hint: 'PCB 외형, 배터리·디스플레이 규격' },
    ],
    prompt: {
      what: '케이스·내부 구조·방열·고정 구조를 설계해 3D·2D 도면과 제작 자료를 만드는 일',
      specItems: ['외형 크기·무게', '내부 구성품 배치', '재질·제작 방식', '방수·방진·환경', '방열', '조립·고정'],
      checks: [
        '재질·제작 방식(사출·판금·3D프린팅)이 자료에 없으면 제작 방식과 수량',
        '방수·방진·온도 같은 사용 환경이 자료에 없으면 보호 등급',
        '발열 부품이 있으면 냉각 방식과 표면 온도 제한',
      ],
    },
  },
  {
    ...base('app'),
    label: '앱 개발',
    hint: '모바일·태블릿·웹 화면과 장치·서버 연동',
    questions: [
      ...APP_SERVER_SHARED,
      {
        code: 'app.platform', label: '어떤 플랫폼에서 사용할 앱인가요?', short: '플랫폼', multi: true,
        options: withUnknown([
          { code: 'android', label: 'Android' },
          { code: 'ios', label: 'iOS' },
          { code: 'tablet', label: '태블릿' },
          { code: 'web', label: '웹앱' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '플랫폼 범위는 개발 방식(네이티브·크로스플랫폼) 선택의 사실 근거다',
      },
      {
        code: 'app.features', label: '앱에서 어떤 기능이 필요한가요?', short: '앱 기능', multi: true,
        options: withUnknown([
          { code: 'device', label: '장치 연결·제어' },
          { code: 'status', label: '상태 확인' },
          { code: 'data', label: '데이터 표시' },
          { code: 'notify', label: '알림' },
          { code: 'settings', label: '설정 변경' },
          { code: 'other', label: '기타' },
        ]),
        notePlaceholder: '주요 화면·사용 순서 (예: 로그인 → 기기 등록 → 상태 확인)',
        promptHint: '기능 목록과 사용 순서가 화면 목록의 명세 항목이다',
      },
      {
        code: 'app.connect', label: '앱이 장치와 직접 연결되나요?', short: '장치 연결', multi: true,
        options: withUnknown([
          { code: 'ble', label: 'BLE' },
          { code: 'wifi', label: 'Wi-Fi' },
          { code: 'usb', label: 'USB' },
          { code: 'none', label: '직접 연결 없음' },
        ]),
        promptHint: '앱이 장치와 직접 연결되는지 서버를 거치는지가 연결 경로 명세다',
      },
      {
        code: 'app.auth', label: '로그인과 사용자 관리가 필요한가요?', short: '로그인', multi: false,
        options: withUnknown([
          { code: 'login', label: '로그인 필요' },
          { code: 'roles', label: '관리자·사용자 구분' },
          { code: 'none', label: '로그인 불필요' },
        ], '상담 필요'),
        promptHint: '사용자 구분이 있으면 화면·권한 구분(계정 구조)이 명세 항목이다',
      },
      {
        code: 'app.design', label: '화면 디자인이나 기획 자료가 있나요?', short: '화면 디자인', multi: false,
        options: withUnknown([
          { code: 'done', label: '완성된 디자인 보유' },
          { code: 'plan', label: '기획서만 있음' },
          { code: 'new', label: '새로 제작 필요' },
        ], '상담 필요'),
        why: '화면 디자인을 새로 만들어야 하면 기획·디자인 작업이 개발 앞에 들어갑니다.',
        promptHint: '디자인이 없으면 화면 기획·디자인이 개발 범위에 들어간다',
      },
      {
        code: 'app.release', label: '앱 배포와 유지보수도 필요한가요?', short: '배포·유지보수', multi: true,
        options: withUnknown([
          { code: 'store', label: '앱스토어 등록' },
          { code: 'internal', label: '내부 배포' },
          { code: 'maintenance', label: '유지보수 필요' },
          { code: 'dev_only', label: '개발만 필요' },
        ], '상담 필요'),
        promptHint: '배포 경로와 유지보수 여부는 산출물·운영 범위 그대로다',
      },
    ],
  },
  {
    ...base('server'),
    label: '서버 개발',
    hint: 'API·데이터베이스·관리자 화면·운영 환경',
    questions: [
      ...APP_SERVER_SHARED,
      {
        code: 'server.features', label: '서버에서 어떤 기능이 필요한가요?', short: '서버 기능', multi: true,
        options: withUnknown([
          { code: 'collect', label: '장치 데이터 수집' },
          { code: 'store', label: '데이터 저장' },
          { code: 'admin', label: '관리자 화면' },
          { code: 'users', label: '사용자 관리' },
          { code: 'notify', label: '알림' },
          { code: 'integration', label: '외부 시스템 연동' },
        ]),
        promptHint: '서버 기능 목록이 API·관리 화면의 기능 명세다',
      },
      {
        code: 'server.connect', label: '어떤 장치 또는 서비스와 연결하나요?', short: '연결 대상', multi: true,
        options: withUnknown([
          { code: 'iot', label: 'IoT 장치' },
          { code: 'mobile', label: '모바일 앱' },
          { code: 'web', label: '웹 서비스' },
          { code: 'api', label: '외부 API' },
          { code: 'other', label: '기타' },
        ], '상담 필요'),
        notePlaceholder: '연결할 장치·사용자 수 (처음과 앞으로 예상)',
        why: '연결할 장치와 사용자 수에 따라 서버 구성과 운영 비용이 달라집니다.',
        promptHint: '연결 대상과 규모는 서버 구성(단일·확장)과 운영 비용의 사실 근거다',
      },
      {
        code: 'server.protocol', label: '통신 방식이 정해져 있나요?', short: '통신 방식', multi: true,
        options: withUnknown([
          { code: 'mqtt', label: 'MQTT' },
          { code: 'http', label: 'HTTP·REST API' },
          { code: 'websocket', label: 'WebSocket' },
          { code: 'other', label: '기타' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '통신 방식은 연동 규격 정의가 이번 범위인지 정한다',
      },
      {
        code: 'server.hosting', label: '서버를 어디에 운영할 예정인가요?', short: '운영 위치', multi: false,
        options: withUnknown([
          { code: 'aws', label: 'AWS' },
          { code: 'azure', label: 'Azure' },
          { code: 'gcp', label: 'Google Cloud' },
          { code: 'onprem', label: '고객사 서버' },
        ], '미정'),
        promptHint: '운영 위치는 배포 구성과 운영 비용 주체를 정한다',
      },
      {
        code: 'server.data', label: '데이터 보관과 조회 기능이 필요한가요?', short: '데이터 조회', multi: true,
        options: withUnknown([
          { code: 'realtime', label: '실시간 조회' },
          { code: 'history', label: '이력 저장' },
          { code: 'chart', label: '그래프·통계' },
          { code: 'download', label: '파일 다운로드' },
        ], '상담 필요'),
        promptHint: '보관·조회 요구는 DB 설계와 저장 용량의 사실 근거다',
      },
      {
        code: 'server.ops', label: '운영과 유지보수도 필요한가요?', short: '운영·유지보수', multi: false,
        options: withUnknown([
          { code: 'build', label: '구축만 필요' },
          { code: 'deploy', label: '배포까지 필요' },
          { code: 'operate', label: '운영·유지보수 필요' },
        ], '상담 필요'),
        promptHint: '운영 범위는 배포·유지보수 산출물 범위 그대로다',
      },
    ],
  },
];

// 시스템개발 = 이 6분야(역설계 제외). 개별 견적은 DEVELOP_INDIVIDUAL_AREA_CODES 의 부분집합.
export const DEVELOP_SYSTEM_AREA_CODES: readonly string[] = ['circuit', 'pcb', 'firmware', 'mech', 'app', 'server'];

export const DEVELOP_REGISTRY = createAreaRegistry({
  areas: DEVELOP_AREAS,
  conditions: [],
  common: [],
  fullAreaQuestionCap: 0,
  fullQuestions: DEVELOP_SYSTEM_QUESTIONS,
  fullCodes: DEVELOP_SYSTEM_AREA_CODES,
  fullBadge: () => DEVELOP_SYSTEM_MENU.label,
});

export const DEVELOP_AREA_CODES: readonly string[] = DEVELOP_REGISTRY.codes;
export const DEVELOP_AREA_MAP = DEVELOP_REGISTRY.map;

export const isDevelopAreaCode = DEVELOP_REGISTRY.isAreaCode;
export const developArea = DEVELOP_REGISTRY.area;
export const developAreaLabel = DEVELOP_REGISTRY.areaLabel;
export const developAreaShort = DEVELOP_REGISTRY.areaShort;
export const sortDevelopAreas = DEVELOP_REGISTRY.sortAreas;
export const developAreaBadge = DEVELOP_REGISTRY.areaBadge;
export const isDevelopSystemAreas = DEVELOP_REGISTRY.isFull;
export const DEVELOP_QUESTIONS = DEVELOP_REGISTRY.questions;
export const developQuestion = DEVELOP_REGISTRY.question;
export const developQuestionsFor = DEVELOP_REGISTRY.questionsFor;
export const developAreaQuestionsFor = DEVELOP_REGISTRY.areaQuestionsFor;
export const isDevelopQuestionVisible = DEVELOP_REGISTRY.isQuestionVisible;
export const developVisibleQuestionsFor = DEVELOP_REGISTRY.visibleQuestionsFor;
export const pruneDevelopHiddenAnswers = DEVELOP_REGISTRY.pruneHiddenAnswers;
export const developRequiredMissing = DEVELOP_REGISTRY.requiredMissing;
export const developAnswerIssues = DEVELOP_REGISTRY.answerIssues;
export const developAnswerText = DEVELOP_REGISTRY.answerText;
export const developToolIssues = DEVELOP_REGISTRY.toolIssues;
export const normalizeDevelopTools = DEVELOP_REGISTRY.normalizeTools;
export const developToolRows = DEVELOP_REGISTRY.toolRows;
export const parseDevelopAttachmentField = DEVELOP_REGISTRY.parseAttachmentField;
export const developSlotLabel = DEVELOP_REGISTRY.slotLabel;

// '앱 및 서버' 범위 답 → 저장 분야. 앱·서버 중 하나라도 있으면 범위 답대로 줄이거나 채운다(답이 없거나 상담이면 둘 다).
export function applyDevelopAppServerScope(areas: readonly string[], answers: readonly { code: string; choices: readonly string[] }[]): string[] {
  if (!areas.includes('app') && !areas.includes('server')) return sortDevelopAreas(areas);
  const scope = answers.find((a) => a.code === DEVELOP_APP_SERVER_SCOPE_CODE)?.choices[0];
  const keep = scope === 'app' ? ['app'] : scope === 'server' ? ['server'] : ['app', 'server'];
  return sortDevelopAreas([...areas.filter((c) => c !== 'app' && c !== 'server'), ...keep]);
}

// 4스텝 '제작 계획'을 묻는 의뢰 — 만들 하드웨어가 있는 분야가 하나라도 있을 때(펌웨어·앱·서버만이면 건너뛴다, 검토 회신 7).
const PRODUCTION_AREA_CODES: readonly string[] = ['circuit', 'pcb', 'reverse', 'mech'];
export const developNeedsProduction = (areas: readonly string[]): boolean => areas.some((c) => PRODUCTION_AREA_CODES.includes(c));
// 2스텝 '현재 단계 → 목표 단계'를 묻는 의뢰 — 역설계만 고른 의뢰는 이미 실물이 있어 맞는 선택지가 없다(검토 회신 7).
export const developNeedsStages = (areas: readonly string[]): boolean => !(areas.length > 0 && areas.every((c) => c === 'reverse'));

// 개별 메뉴 분야 정의(레지스트리 순서).
export const DEVELOP_INDIVIDUAL_AREAS: readonly MarketAreaDef[] = DEVELOP_INDIVIDUAL_AREA_CODES.map((c) => {
  const def = DEVELOP_AREA_MAP.get(c);
  if (def === undefined) throw new Error(`develop area missing: ${c}`);
  return def;
});
