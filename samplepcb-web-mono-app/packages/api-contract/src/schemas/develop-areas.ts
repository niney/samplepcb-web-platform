import { MARKET_EXPERT_PICK_LABEL, createAreaRegistry, withUnknown } from './area-registry';
import type { MarketAreaDef, MarketQuestionDef, MarketToolOption } from './area-registry';
import { MARKET_AREA_MAP } from './market-areas';

// ── 개발의뢰(sp-develop) 분야 레지스트리 (docs/DEVELOP_FLOW.md §7.2, 2026-09-08 위저드 v2) ────────
// 개발의뢰는 마켓과 **메뉴가 다르다**: 1스텝에서 「시스템개발」(배타 — 회로·PCB·펌웨어·기구·앱·서버·시제품을
// 통합 분석) 또는 「개별 견적」(PCB설계·기구설계·앱개발·서버개발 복수 선택) 중 하나를 고른다. 회로·펌웨어는
// 개별 메뉴에 없고 시스템개발 안에서만 다룬다(사용자 결정 2026-09-08).
//
// 저장 `serviceAreas` 는 시스템개발이면 **6분야 전부**(circuit·pcb·firmware·mech·app·server), 개별이면 고른
// 것만이다 — 배지·검토서 분야 카드·프롬프트가 분야 코드만 보고 동작하게(전 분야 = 시스템개발 배지).
// 질문은 분야별(개별 견적, 선택지+서술 혼합) 또는 시스템개발 전용 3문항(서술) — 팩토리 `fullQuestions` 가
// 전 분야 선택 시 분야별 질문 대신 이 3문항을 낸다. 회로·펌웨어·PCB·앱·서버의 프롬프트 조각·툴·슬롯은
// 마켓 레지스트리 정의를 그대로 재사용한다(정본 하나). 기구설계(mech)만 여기서 새로 정의한다.

const base = (code: string): MarketAreaDef => {
  const def = MARKET_AREA_MAP.get(code);
  if (def === undefined) throw new Error(`market area missing: ${code}`);
  return def;
};

// 개별 메뉴에서 고를 수 있는 분야(화면 순서). 시스템개발은 전 분야.
export const DEVELOP_INDIVIDUAL_AREA_CODES: readonly string[] = ['pcb', 'mech', 'app', 'server'];
export const DEVELOP_INDIVIDUAL_TAG = '전문 질문 제공';
export const DEVELOP_SYSTEM_MENU = {
  label: '시스템개발',
  hint: '회로·PCB·펌웨어·기구·앱·서버·시제품을 통합 분석',
  tag: '설명과 첨부자료 중심',
} as const;

const MCAD_TOOLS: readonly MarketToolOption[] = [
  { code: 'solidworks', label: 'SolidWorks' },
  { code: 'fusion360', label: 'Fusion 360' },
  { code: 'inventor', label: 'Inventor' },
  { code: 'catia', label: 'CATIA' },
  { code: 'nx', label: 'NX' },
  { code: 'creo', label: 'Creo' },
];

// ── 시스템개발 전용 문항 — 서술 3 + 디자인·기구 범위 2(선택지) ────
// 디자인·기구의 담당을 각각 묻고, 같은 내용을 합쳐 묻던 system.collab 은 제거했다.
// 범위 2문항은 견적 전제라 **전문가에게 맡김을 골라도 묻는다**(askOnDelegate).
const DELEGATE_UNKNOWN_LABEL = '잘 모르겠음·전문가 판단 요청';
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
    code: 'system.use', label: '제품은 누가, 어디에서, 어떻게 사용하나요?', short: '사용 상황', multi: false, kind: 'text', options: [],
    notePlaceholder: '사용자 / 설치 장소 / 하루 사용 횟수 / 실내·실외',
    promptHint: '사용자·설치 장소·사용 빈도는 전원 방식·보호 등급·내구 조건의 사실 근거다',
  },
  {
    code: 'system.io', label: '어떤 정보를 받아서 무엇을 움직이거나 알려줘야 하나요?', short: '입력·출력', multi: false, kind: 'text', options: [],
    notePlaceholder: '입력되는 값 → 판단 조건 → 출력·제어 결과',
    promptHint: '입력(센서·통신)과 출력(구동·표시·알림)의 나열이 하드웨어 블록과 펌웨어 기능 명세의 뼈대다',
  },
  {
    code: 'system.safety', label: '고장이나 통신 중단 시 제품은 어떻게 동작해야 하나요?', short: '장애 시 동작', multi: false, kind: 'text', options: [],
    notePlaceholder: '정지 / 알림 / 재시도 / 안전 상태 유지',
    promptHint: '장애 시 동작은 안전 상태 정의·워치독·재접속 정책 같은 펌웨어·회로 보호 항목으로 이어진다',
  },
  ...DEVELOP_SYSTEM_COLLAB_QUESTIONS,
];
// 시스템개발 "전문가에게 맡김"에서 남기는 문항 코드 — 등록·수정 라우트가 이 밖의 답변을 버린다.
export const DEVELOP_DELEGATE_KEPT_CODES: readonly string[] = DEVELOP_SYSTEM_QUESTIONS.filter((q) => q.askOnDelegate === true).map((q) => q.code);
export const keepDevelopDelegateAnswers = <T extends { code: string }>(answers: readonly T[]): T[] =>
  answers.filter((a) => DEVELOP_DELEGATE_KEPT_CODES.includes(a.code));

// ── 분야 6종(레지스트리 순서 = 배지·검토서 카드 순서) ────────────────────────────────
export const DEVELOP_AREAS: readonly MarketAreaDef[] = [
  // 회로·펌웨어 — 시스템개발 안에서만(개별 메뉴 없음). 분야별 질문은 없다(시스템개발 3문항이 대신한다).
  { ...base('circuit'), questions: [] },
  {
    ...base('pcb'),
    label: 'PCB설계',
    hint: '회로자료 검토, 회로도 복원·작성, PCB Layout',
    questions: [
      {
        code: 'pcb.type', label: '신규 설계인가요, 기존 PCB 수정·재설계인가요?', short: '작업 종류', multi: false,
        options: withUnknown([
          { code: 'new', label: '신규 설계' },
          { code: 'modify', label: '기존 PCB 수정' },
          { code: 'redesign', label: '재설계' },
        ], MARKET_EXPERT_PICK_LABEL),
        notePlaceholder: '변경 범위가 있으면 적어 주세요',
        promptHint: '수정·재설계면 기존 설계 자료의 형태와 변경 범위가 작업량을 정한다',
      },
      {
        code: 'pcb.tool', label: '희망하는 PCB 설계툴과 버전을 알려주세요.', short: '설계 툴', multi: false,
        options: withUnknown([
          { code: 'altium', label: 'Altium' },
          { code: 'orcad', label: 'OrCAD·Allegro' },
          { code: 'pads', label: 'PADS' },
          { code: 'kicad', label: 'KiCad' },
          { code: 'other', label: '기타' },
        ], MARKET_EXPERT_PICK_LABEL),
        notePlaceholder: '버전, 기타 툴 이름',
        promptHint: '설계 툴은 납품 원본 파일 형식을 정한다(고객 사내 툴과 맞춰야 이어서 수정할 수 있다)',
      },
      {
        code: 'pcb.source', label: 'PCB 설계에 사용할 회로·기판 자료는 어떤 형태인가요?', short: '입력 자료', multi: true,
        options: withUnknown([
          { code: 'editable_schematic', label: '편집 가능한 회로도' },
          { code: 'pdf_image', label: 'PDF·이미지' },
          { code: 'netlist', label: '결선표·핀맵' },
          { code: 'pcb_source', label: 'PCB 원본' },
          { code: 'gerber', label: 'Gerber' },
          { code: 'photo', label: 'PCB 사진·실물' },
          { code: 'none', label: '회로자료 없음' },
        ]),
        promptHint: '편집 가능한 회로도가 없으면 회로도 복원·작성이 PCB 설계 앞에 선다',
      },
      {
        code: 'pcb.board', label: 'PCB 종류, 레이어, 외형과 두께를 알려주세요.', short: '기판 사양', multi: false,
        options: withUnknown([
          { code: 'rigid', label: 'Rigid' },
          { code: 'fpcb', label: 'FPCB' },
          { code: 'rigid_flex', label: 'Rigid-Flex' },
          { code: 'metal', label: 'Metal PCB' },
        ], MARKET_EXPERT_PICK_LABEL),
        notePlaceholder: '층수 / 가로×세로×두께(mm)',
        promptHint: '기판 종류·층수·외형은 제작 방식과 배선 밀도의 사실 근거다',
      },
      {
        code: 'pcb.mech', label: '고정홀, 커넥터, 스위치와 기구 간섭 조건을 알려주세요.', short: '기구 간섭', multi: false, kind: 'text', options: [],
        notePlaceholder: 'DXF·STEP 참조 / 위치·방향 / 높이 제한 / 금지영역',
        promptHint: '고정홀·커넥터 위치·높이 제한·금지영역은 배치 제약으로 명세에 적는다',
      },
      {
        code: 'pcb.signal', label: '주의가 필요한 신호와 배선 조건이 있나요?', short: '주의 신호', multi: true,
        options: withUnknown([
          { code: 'ddr', label: 'DDR' },
          { code: 'usb', label: 'USB' },
          { code: 'ethernet', label: 'Ethernet' },
          { code: 'pcie', label: 'PCIe' },
          { code: 'lvds', label: 'LVDS' },
          { code: 'rf', label: 'RF·안테나' },
          { code: 'power', label: '고전압·대전류' },
          { code: 'none', label: '해당 없음' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '고속·RF·대전류 신호가 있으면 임피던스·길이 정합·방열은 전문가 결정 사항이라 검토서는 사실만 적는다',
      },
      {
        code: 'pcb.deliver', label: '원하는 PCB 설계 납품 결과물을 알려주세요.', short: '납품 결과물', multi: true,
        options: withUnknown([
          { code: 'source', label: '설계 원본' },
          { code: 'gerber', label: 'Gerber·Drill' },
          { code: 'pnp', label: '좌표 파일' },
          { code: 'assembly', label: '조립도' },
          { code: 'step', label: 'STEP·3D' },
          { code: 'spec', label: '제작사양서' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '납품 결과물 목록은 산출물 범위 그대로다',
      },
    ],
  },
  { ...base('firmware'), questions: [] },
  {
    code: 'mech',
    label: '기구설계',
    short: '기구',
    hint: '케이스·내부 구조·방열·시제품·양산 설계',
    kind: 'hardware',
    questions: [
      {
        code: 'mech.type', label: '신규 기구설계인가요, 기존 제품 수정·복원인가요?', short: '작업 종류', multi: false,
        options: withUnknown([
          { code: 'new', label: '신규' },
          { code: 'outline', label: '외형 변경' },
          { code: 'internal', label: '내부 구조 변경' },
          { code: 'restore', label: '실물·사진 기반 복원' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '복원·수정이면 기존 실물·도면 자료의 유무가 작업 방식을 정한다',
      },
      {
        code: 'mech.size', label: '목표 외형 크기와 무게 제한을 알려주세요.', short: '크기·무게', multi: false, kind: 'text', options: [],
        notePlaceholder: '가로×세로×높이(mm) / 최대 무게 / 설치 공간',
        promptHint: '외형 치수·무게 제한은 내부 배치와 재질 선택의 사실 근거다',
      },
      {
        code: 'mech.parts', label: '내부 구성품과 고정된 위치를 알려주세요.', short: '내부 구성품', multi: true,
        options: withUnknown([
          { code: 'pcb', label: 'PCB' },
          { code: 'battery', label: '배터리' },
          { code: 'display', label: '디스플레이' },
          { code: 'sensor', label: '센서' },
          { code: 'motor', label: '모터' },
          { code: 'connector', label: '커넥터' },
        ]),
        notePlaceholder: '고정된 위치, 그 밖의 구성품',
        promptHint: '내부 구성품 목록이 케이스 내부 구조·개구부·고정 방식의 명세 항목이다',
      },
      {
        code: 'mech.build', label: '재질과 제작 방식을 알려주세요.', short: '재질·제작', multi: true,
        options: withUnknown([
          { code: 'plastic', label: '플라스틱' },
          { code: 'metal', label: '금속' },
          { code: 'sheet', label: '판금' },
          { code: 'machining', label: '절삭' },
          { code: 'print3d', label: '3D프린팅' },
          { code: 'injection', label: '사출' },
          { code: 'diecast', label: '다이캐스팅' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '재질·제작 방식은 수량과 함께 금형 필요 여부·단가의 사실 근거다',
      },
      {
        code: 'mech.env', label: '사용환경과 보호 조건을 알려주세요.', short: '사용 환경', multi: true,
        options: withUnknown([
          { code: 'indoor', label: '실내 일반' },
          { code: 'outdoor', label: '실외·온습도' },
          { code: 'dust_water', label: '먼지·물(IP)' },
          { code: 'uv_chem', label: '자외선·오일·약품' },
          { code: 'vibration', label: '진동·충격' },
        ]),
        notePlaceholder: 'IP 등급, 온도 범위 등',
        promptHint: '방수·방진·온도·진동 조건은 실링·재질·고정 구조의 명세 항목이다',
      },
      {
        code: 'mech.heat', label: '발열원과 냉각 방식에 제한이 있나요?', short: '방열', multi: false,
        options: withUnknown([
          { code: 'none', label: '발열 없음' },
          { code: 'passive', label: '자연대류' },
          { code: 'heatsink', label: '방열판' },
          { code: 'fan', label: '팬' },
          { code: 'vent', label: '통풍구' },
        ], MARKET_EXPERT_PICK_LABEL),
        notePlaceholder: '표면 온도 제한 등',
        promptHint: '발열원과 냉각 방식 제한은 방열 구조와 개구부 설계의 사실 근거다',
      },
      {
        code: 'mech.deliver', label: '필요한 기구설계 결과물을 알려주세요.', short: '납품 결과물', multi: true,
        options: withUnknown([
          { code: 'cad3d', label: '3D 원본·STEP' },
          { code: 'dxf', label: '2D·DXF' },
          { code: 'drawings', label: '부품도·조립도' },
          { code: 'bom', label: '기구 BOM' },
          { code: 'prototype', label: '시제품' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '납품 결과물 목록은 산출물 범위 그대로다',
      },
    ],
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
    label: '앱개발',
    hint: '모바일·태블릿·웹 화면과 장치·서버 연동',
    questions: [
      {
        code: 'app.target', label: '사용 기기와 지원 언어·국가를 알려주세요.', short: '사용 기기', multi: true,
        options: withUnknown([
          { code: 'android', label: 'Android' },
          { code: 'iphone', label: 'iPhone' },
          { code: 'tablet', label: '태블릿' },
          { code: 'web', label: '웹' },
        ], MARKET_EXPERT_PICK_LABEL),
        notePlaceholder: '지원 언어·국가',
        promptHint: '기기 범위는 지원 플랫폼과 개발 방식(네이티브·크로스플랫폼) 선택의 사실 근거다',
      },
      {
        code: 'app.flow', label: '필수 기능과 사용 순서를 알려주세요.', short: '기능·순서', multi: false, kind: 'text', options: [],
        notePlaceholder: '로그인 → 제품 등록 → 상태 확인 → 제어 등',
        promptHint: '기능 순서 나열이 화면 목록과 첫 화면의 명세 항목이다',
      },
      {
        code: 'app.role', label: '사용자 역할과 권한을 알려주세요.', short: '사용자 역할', multi: true,
        options: withUnknown([
          { code: 'customer', label: '고객' },
          { code: 'admin', label: '관리자' },
          { code: 'installer', label: '설치기사' },
          { code: 'business', label: '기업 담당자' },
        ]),
        promptHint: '사용자 유형이 여럿이면 화면·권한 구분(계정 구조)이 명세 항목이다',
      },
      {
        code: 'app.connect', label: '제품·서버 연결방식과 사용 범위를 알려주세요.', short: '연결 방식', multi: true,
        options: withUnknown([
          { code: 'ble', label: 'BLE' },
          { code: 'wifi', label: 'Wi-Fi' },
          { code: 'usb', label: 'USB' },
          { code: 'nfc', label: 'NFC' },
          { code: 'server', label: '서버 경유' },
        ], MARKET_EXPERT_PICK_LABEL),
        notePlaceholder: '근거리·원격 등 사용 범위',
        promptHint: '앱이 장치와 직접 연결되는지 서버를 거치는지가 연결 경로 명세다',
      },
      {
        code: 'app.offline', label: '연결이 끊겼을 때 필요한 기능과 복구 동작을 알려주세요.', short: '오프라인', multi: true,
        options: withUnknown([
          { code: 'view', label: '오프라인 조회' },
          { code: 'control', label: '오프라인 조작' },
          { code: 'cache', label: '임시저장' },
          { code: 'resend', label: '재연결 후 전송' },
          { code: 'none', label: '필요 없음' },
        ]),
        promptHint: '오프라인 요구가 있으면 로컬 저장·동기화가 명세 항목이다',
      },
      {
        code: 'app.deliver', label: '배포와 납품 결과물을 알려주세요.', short: '배포·납품', multi: true,
        options: withUnknown([
          { code: 'store', label: '스토어 배포' },
          { code: 'enterprise', label: '사내 배포' },
          { code: 'source', label: '소스' },
          { code: 'design', label: '디자인 원본' },
          { code: 'test', label: '시험 결과' },
          { code: 'manual', label: '매뉴얼' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '배포 경로와 납품 결과물 목록은 산출물 범위 그대로다',
      },
    ],
  },
  {
    ...base('server'),
    label: '서버개발',
    hint: 'API·데이터베이스·관리자 화면·운영 환경',
    questions: [
      {
        code: 'server.type', label: '신규 서버인가요, 기존 시스템 개선·이전인가요?', short: '작업 종류', multi: false,
        options: withUnknown([
          { code: 'new', label: '신규' },
          { code: 'extend', label: '추가 개발' },
          { code: 'rebuild', label: '재개발' },
          { code: 'migrate', label: '서비스·데이터 이전' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '기존 시스템이 있으면 그 자료(소스·DB·API)의 유무가 작업 방식을 정한다',
      },
      {
        code: 'server.scale', label: '연결 대상과 초기·향후 사용 규모를 알려주세요.', short: '사용 규모', multi: false, kind: 'text', options: [],
        notePlaceholder: '장치·사용자 수 / 동시 접속 / 전송 데이터 규모',
        promptHint: '규모는 서버 구성(단일·확장)과 운영 비용의 사실 근거다',
      },
      {
        code: 'server.task', label: '서버와 관리자 화면의 주요 업무를 알려주세요.', short: '주요 업무', multi: true,
        options: withUnknown([
          { code: 'register', label: '등록' },
          { code: 'monitor', label: '상태 감시' },
          { code: 'users', label: '사용자 관리' },
          { code: 'control', label: '원격제어' },
          { code: 'log', label: '기록' },
          { code: 'report', label: '보고서' },
        ]),
        promptHint: '주요 업무 목록이 API·관리 화면의 기능 명세다',
      },
      {
        code: 'server.protocol', label: '통신 프로토콜과 API 명세 상태를 알려주세요.', short: '프로토콜', multi: true,
        options: withUnknown([
          { code: 'mqtt', label: 'MQTT' },
          { code: 'http', label: 'HTTP·HTTPS' },
          { code: 'websocket', label: 'WebSocket' },
          { code: 'tcp_udp', label: 'TCP·UDP' },
        ], MARKET_EXPERT_PICK_LABEL),
        notePlaceholder: '명세 상태: 기존 / 일부 / 신규 정의',
        promptHint: '프로토콜과 명세 상태는 연동 규격 정의가 이번 범위인지 정한다',
      },
      {
        code: 'server.ops', label: '설치환경과 보안·백업·복구 요구사항을 알려주세요.', short: '운영·보안', multi: true,
        options: withUnknown([
          { code: 'cloud', label: '클라우드' },
          { code: 'onprem', label: '사내 서버' },
          { code: 'auth', label: '권한 관리' },
          { code: 'encrypt', label: '암호화' },
          { code: 'backup', label: '백업·복구' },
        ]),
        notePlaceholder: '허용 중단시간 등',
        promptHint: '설치 환경·보안·백업 요구는 배포·운영 범위의 명세 항목이다',
      },
      {
        code: 'server.deliver', label: '필요한 납품 결과물을 알려주세요.', short: '납품 결과물', multi: true,
        options: withUnknown([
          { code: 'source', label: '소스' },
          { code: 'api', label: 'API 명세' },
          { code: 'db', label: 'DB 설계' },
          { code: 'deploy', label: '배포·운영 안내' },
          { code: 'test', label: '시험 결과' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '납품 결과물 목록은 산출물 범위 그대로다',
      },
    ],
  },
];

export const DEVELOP_REGISTRY = createAreaRegistry({
  areas: DEVELOP_AREAS,
  conditions: [],
  common: [],
  fullAreaQuestionCap: 0,
  fullQuestions: DEVELOP_SYSTEM_QUESTIONS,
  fullBadge: () => DEVELOP_SYSTEM_MENU.label,
});

export const DEVELOP_AREA_CODES: readonly string[] = DEVELOP_REGISTRY.codes;
// 시스템개발 = 전 분야. 개별 견적은 DEVELOP_INDIVIDUAL_AREA_CODES 의 부분집합.
export const DEVELOP_SYSTEM_AREA_CODES: readonly string[] = DEVELOP_REGISTRY.codes;
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
export const developRequiredMissing = DEVELOP_REGISTRY.requiredMissing;
export const developAnswerIssues = DEVELOP_REGISTRY.answerIssues;
export const developAnswerText = DEVELOP_REGISTRY.answerText;
export const developToolIssues = DEVELOP_REGISTRY.toolIssues;
export const normalizeDevelopTools = DEVELOP_REGISTRY.normalizeTools;
export const developToolRows = DEVELOP_REGISTRY.toolRows;
export const parseDevelopAttachmentField = DEVELOP_REGISTRY.parseAttachmentField;
export const developSlotLabel = DEVELOP_REGISTRY.slotLabel;

// 개별 메뉴 카드 정의(화면 순서) — 1스텝이 그린다.
export const DEVELOP_INDIVIDUAL_AREAS: readonly MarketAreaDef[] = DEVELOP_INDIVIDUAL_AREA_CODES.map((c) => {
  const def = DEVELOP_AREA_MAP.get(c);
  if (def === undefined) throw new Error(`develop area missing: ${c}`);
  return def;
});
