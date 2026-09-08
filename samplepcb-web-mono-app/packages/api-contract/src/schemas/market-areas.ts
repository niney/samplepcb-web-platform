import { z } from 'zod';
import { createAreaRegistry, withUnknown, MARKET_EXPERT_PICK_LABEL, MARKET_NEGOTIATE_LABEL } from './area-registry';
import type { MarketAreaDef, MarketQuestionDef, MarketToolOption, MarketToolsType } from './area-registry';

// ── 재능마켓 분야 레지스트리 (docs/AI_DEV_REVIEW.md §13, 2026-09-04 v3) ─────────────
// **분야·질문·희망 툴·추가자료 슬롯·프롬프트 조각의 단일 정본.** 위저드 2단계, 전문가 등록 폼,
// 목록·관리자 필터, 검토서 프롬프트·후처리, 분야 배지, 정밀 구성도 프롬프트가 전부 이 파일에서
// 파생된다. 분야를 더하는 일 = MARKET_AREAS 에 항목 하나 + 프로빙 픽스처 하나. 질문·툴·슬롯을
// 더하는 일 = 해당 분야 항목만 고친다. 다른 파일에 분야 코드를 문자열로 박지 않는다.
//
// 저장 스키마는 z.enum 이 아니라 **문자열 + 레지스트리 검증**이다: 분야를 빼도 옛 저장분 파싱이
// 깨지지 않고 라벨만 "(종료)" 로 바뀐다.
// 2026-09-08: 자료형·파생 함수는 area-registry.ts(팩토리)로 옮겼다 — 개발의뢰(develop-areas.ts)가 같은 모양의
// 레지스트리를 자기 분야·질문으로 만든다. 이 파일의 export 이름·시그니처는 그대로다(MARKET_REGISTRY 바인딩).

export type {
  AreaRegistry,
  AreaRegistryConfig,
  MarketAreaDef,
  MarketAreaKind,
  MarketAttachmentSlotDef,
  MarketAttachmentSlotRef,
  MarketQuestionDef,
  MarketQuestionOption,
  MarketToolOption,
  MarketToolRow,
  MarketAnswerType,
  MarketAnswersType,
  MarketToolsType,
} from './area-registry';
export {
  createAreaRegistry,
  EMPTY_MARKET_TOOLS,
  MARKET_ATTACHMENT_FIELD,
  MARKET_EXPERT_PICK_LABEL,
  MARKET_NEGOTIATE_LABEL,
  MARKET_TOOLS_VERSION,
  MARKET_UNKNOWN_CHOICE,
  MARKET_UNKNOWN_LABEL,
  MarketAnswer,
  MarketAnswers,
  MarketTools,
  isMarketAnswerUnknown,
  isMarketAnswered,
  isTextQuestion,
  marketAttachmentField,
  withUnknown,
} from './area-registry';

// ── 프로젝트 공통 조건 — 답변(answers)에 저장되는 것 3개(2026-09-04 v5, 참고 사이트 "프로젝트 공통 조건"
// 7항목 중 컬럼이 아닌 것). 예산·견적 방식·NDA 는 sp_market_project 컬럼이라 여기 없다. 전부 필수 —
// 모르면 "협의해서 정할게요"(코드 unknown). 위저드 2스텝 맨 위 "프로젝트 공통 조건" 블록이 그린다.
export const MARKET_COMMON_CONDITIONS: readonly MarketQuestionDef[] = [
  {
    code: 'timeline', label: '언제까지 완성돼야 하나요?', short: '완료 시점', multi: false, required: true,
    why: '기간에 따라 개발 방식과 단계별 계획이 달라집니다.',
    options: withUnknown([
      { code: 'within_1m', label: '1개월 안' },
      { code: 'm2_3', label: '2~3개월' },
      { code: 'm4_6', label: '4~6개월' },
      { code: 'over_6m', label: '6개월 이상' },
    ], MARKET_NEGOTIATE_LABEL),
    notePlaceholder: '예: 10월 전시회 전까지',
  },
  {
    code: 'target_stage', label: '어디까지 만들어 받고 싶나요?', short: '목표 단계', multi: false, required: true,
    why: '시제품이면 검증·조립까지, 양산 준비 이상이면 생산·검사 자료가 범위에 듭니다.',
    options: withUnknown([
      { code: 'design_docs', label: '설계 자료까지' },
      { code: 'working_proto', label: '동작하는 시제품' },
      { code: 'cert_proto', label: '인증 시험용 시제품' },
      { code: 'mass_ready', label: '양산 준비까지' },
      { code: 'mass', label: '초도·본 양산까지' },
    ], MARKET_NEGOTIATE_LABEL),
    promptHint: '목표 단계가 시제품이면 검증·조립까지, 양산 준비 이상이면 생산·검사 자료가 범위에 든다',
  },
  {
    code: 'deliverable_scope', label: '소스·설계 파일은 어디까지 받나요?', short: '인도 범위', multi: false, required: true,
    why: '견적가를 가르는 조건입니다. 산출물 목록이 여기서 정해집니다.',
    options: withUnknown([
      { code: 'full_source', label: '전체 원본과 소스' },
      { code: 'maintainable', label: '제작·유지보수 가능한 범위' },
      { code: 'build_only', label: '실행 파일·제작 파일만' },
    ], '계약 전에 협의할게요'),
    promptHint: '인도 범위는 산출물(소스·원본 설계 파일·제작 파일) 목록을 정한다',
  },
];

// ── 공통 질문 3문항 — 어느 분야든 비전문가가 답할 수 있는 것만(완료 시점은 조건으로 옮겨졌다) ─────
export const MARKET_COMMON_QUESTIONS: readonly MarketQuestionDef[] = [
  {
    code: 'stage', label: '지금 어떤 상태인가요?', short: '현재 상태', multi: false,
    options: withUnknown([
      { code: 'idea', label: '아이디어만 있어요' },
      { code: 'spec', label: '원하는 기능을 정리한 자료가 있어요' },
      { code: 'schematic', label: '회로도가 있어요' },
      { code: 'pcb', label: 'PCB 설계 파일이 있어요' },
      { code: 'production', label: '이미 만든 제품을 고치고 싶어요' },
    ]),
  },
  {
    code: 'quantity', label: '몇 개나 필요한가요?', short: '수량', multi: false,
    options: withUnknown([
      { code: 'proto_1_10', label: '시제품 1~10개' },
      { code: 'proto_11_100', label: '11~100개' },
      { code: 'mass', label: '양산(대량 생산) 예정' },
    ]),
    notePlaceholder: '예: 먼저 3개, 이후 월 200개',
  },
  {
    code: 'external', label: '함께 쓰는 것이 있나요?', short: '함께 쓰는 것', multi: true,
    options: withUnknown([
      { code: 'none', label: '없어요(장치 단독)' },
      { code: 'mobile_app', label: '스마트폰 앱' },
      { code: 'server_cloud', label: '서버·웹(클라우드)' },
      { code: 'pc_software', label: 'PC 프로그램' },
      { code: 'existing_device', label: '기존 장비·설비' },
    ]),
  },
];

// ── 툴 사전 — 같은 목록을 여러 분야가 공유할 수 있다(회로·PCB 의 ECAD) ─────────────
const ECAD_TOOLS: readonly MarketToolOption[] = [
  { code: 'altium', label: 'Altium Designer' },
  { code: 'orcad', label: 'OrCAD · Allegro' },
  { code: 'pads', label: 'PADS' },
  { code: 'xpedition', label: 'Xpedition (Mentor)' },
  { code: 'kicad', label: 'KiCad' },
  { code: 'eagle', label: 'EAGLE' },
];

// ── 분야 5종 — 순서 = 화면 순서(위저드 카드·배지·검토서 분야 카드) ───────────────────
export const MARKET_AREAS: readonly MarketAreaDef[] = [
  {
    code: 'circuit',
    label: '회로 개발',
    short: '회로',
    hint: '어떤 부품을 어떻게 연결할지 설계(회로도·부품 목록)',
    kind: 'hardware',
    questions: [
      {
        code: 'circuit.load', label: '제품이 직접 켜거나 움직여야 하는 것이 있나요?', short: '구동 부하', multi: true,
        why: '부하 종류에 따라 전원과 보호 회로 구성이 달라집니다.',
        options: withUnknown([
          { code: 'motor_fan', label: '모터·팬' },
          { code: 'relay_valve', label: '릴레이·밸브' },
          { code: 'speaker_light', label: '스피커·조명' },
          { code: 'none', label: '없어요(측정·표시만)' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '모터·릴레이·조명 같은 부하가 있으면 구동 회로와 보호(퓨즈·서지) 항목이 든다',
      },
      {
        code: 'circuit.priority', label: '가장 중요하게 지켜야 할 조건은 무엇인가요?', short: '우선 조건', multi: false,
        why: '우선 조건에 따라 부품과 회로 구성을 달리 제안합니다.',
        options: withUnknown([
          { code: 'small_size', label: '작은 크기' },
          { code: 'battery_life', label: '긴 배터리 시간' },
          { code: 'low_cost', label: '낮은 원가' },
          { code: 'industrial', label: '산업 환경에서의 안정성' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '우선 조건은 부품 선정과 전원 구성의 트레이드오프 기준이다(검토 관찰에서 이어 쓸 사실)',
      },
    ],
    tools: { label: '회로 설계 툴', options: ECAD_TOOLS },
    attachmentSlots: [
      { code: 'schematic', label: '회로도·부품 목록', hint: '있으면 그대로(손그림도 좋아요)' },
      { code: 'reference', label: '참고 제품·사진', hint: '비슷한 제품, 카탈로그, 원하는 모양' },
      { code: 'spec', label: '요구사항·사양서', hint: '기능 목록, 동작 시나리오, 조건' },
    ],
    prompt: {
      what: '부품을 고르고 연결해 회로도와 부품 목록을 만드는 일',
      specItems: ['입력부', '전원부', '통신', '출력·구동부', '보호·절연', '측정·센싱'],
      checks: [
        '상용 AC 전원이나 모터·히터·릴레이·펌프 같은 큰 부하를 제어하면 절연·보호(퓨즈·서지) 방식',
        '전원 입력 종류(어댑터·배터리·AC)가 자료에 없으면 전원 방식',
        '무선(Wi-Fi·BLE·LTE·LoRa)이 있으면 안테나 형태(내장·외장)와 전파 인증',
      ],
    },
  },
  {
    code: 'pcb',
    label: 'PCB 설계',
    short: 'PCB',
    hint: '실제 기판 도면과 제작 파일(아트웍·거버)',
    kind: 'hardware',
    questions: [
      {
        code: 'pcb.outline', label: '기판이 들어갈 최대 크기가 정해져 있나요?', short: '기판 크기', multi: false,
        why: '정확한 치수를 모르면 케이스나 참고 제품 자료를 올려 주세요.',
        options: withUnknown([
          { code: 'fixed', label: '정확히 정해져 있어요(아래에 적어 주세요)' },
          { code: 'approx', label: '대략만 있어요' },
          { code: 'with_enclosure', label: '기구 설계와 함께 정해요' },
          { code: 'free', label: '제한 없어요' },
        ], MARKET_EXPERT_PICK_LABEL),
        notePlaceholder: '예: 80×50mm, 케이스에 맞춰야 함',
        noteRequiredFor: ['fixed'],
      },
      {
        code: 'pcb.placement', label: '커넥터·버튼·LED·안테나 위치가 정해져 있나요?', short: '외부 부품 위치', multi: false,
        why: '외부와 맞닿는 부품 위치는 기판 배치에 중요합니다.',
        options: withUnknown([
          { code: 'all_fixed', label: '모두 정해져 있어요' },
          { code: 'partial', label: '일부만 정해져 있어요' },
          { code: 'in_drawing', label: '기구 자료에 표시돼 있어요' },
        ], '전문가가 배치해요'),
        promptHint: '외부와 맞닿는 부품 위치가 정해져 있으면 배치 제약, 아니면 배치도 설계 범위다',
      },
      {
        code: 'pcb.special', label: '기판에 이런 기능이 들어가나요?', short: '특수 기능', multi: true,
        why: '층수나 임피던스는 전문가가 기능을 보고 결정합니다.',
        options: withUnknown([
          { code: 'wireless', label: '무선 통신·안테나' },
          { code: 'high_speed', label: '카메라·고속 통신' },
          { code: 'high_current', label: '모터·큰 전류' },
          { code: 'none', label: '일반 저속 제어만' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '무선·고속·대전류가 있으면 층수·임피던스·방열은 전문가 결정 사항이라 검토서는 사실만 적는다',
      },
    ],
    tools: { label: 'PCB 설계 툴', options: ECAD_TOOLS },
    attachmentSlots: [
      { code: 'gerber', label: 'PCB 설계 파일·거버', hint: '기존 설계가 있으면' },
      { code: 'outline', label: '외형·치수 도면', hint: '기판 크기, 구멍 위치, 케이스 도면' },
      { code: 'schematic', label: '회로도', hint: '아트웍의 근거가 되는 회로도' },
    ],
    prompt: {
      what: '회로도를 실제 기판 도면(아트웍)과 제작 파일(거버)로 만드는 일',
      specItems: ['기판 크기·외형', '고정·커넥터 위치', '층수·재질', '제작 수량', '조립·실장'],
      checks: [
        '설치 환경(옥외·고온·다습·진동)이 자료에 없으면 설치 환경',
        '기판 크기·케이스 제약이 자료에 없으면 크기·외형 제약',
      ],
    },
  },
  {
    code: 'firmware',
    label: '펌웨어 개발',
    short: '펌웨어',
    hint: '보드를 동작시키는 프로그램',
    kind: 'hardware',
    questions: [
      {
        code: 'firmware.board', label: '펌웨어를 올릴 보드가 준비돼 있나요?', short: '보드 준비', multi: false,
        why: '하드웨어가 없으면 회로·PCB 개발을 함께 요청할 수 있습니다.',
        options: withUnknown([
          { code: 'have_board', label: '동작하는 보드가 있어요' },
          { code: 'schematic_only', label: '회로도만 있어요' },
          { code: 'in_progress', label: '만드는 중이에요' },
          { code: 'need_hw', label: '하드웨어부터 필요해요' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '보드가 없으면 회로·PCB 개발이 선행돼야 하고 펌웨어는 그 뒤에 시작된다',
      },
      {
        code: 'firmware.update', label: '제품을 회수하지 않고 프로그램을 업데이트해야 하나요?', short: '업데이트 방식', multi: false,
        why: '원격 업데이트가 필요하면 메모리와 통신 구성을 함께 검토합니다.',
        options: withUnknown([
          { code: 'remote_required', label: '원격 업데이트 필수' },
          { code: 'cable', label: '케이블로 하면 돼요' },
          { code: 'none', label: '업데이트 필요 없어요' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '원격 업데이트가 필수면 OTA 절차·부트로더·메모리 여유가 명세 항목이다',
      },
      {
        code: 'firmware.failure', label: '제품이 멈추거나 통신에 실패하면 어떻게 해야 하나요?', short: '장애 시 동작', multi: false,
        why: '복구 요구사항은 산업용·무인 제품에서 특히 중요합니다.',
        options: withUnknown([
          { code: 'auto_recover', label: '스스로 재시작·복구' },
          { code: 'retry_alert', label: '다시 시도하고 알림' },
          { code: 'log', label: '오류 기록만 남김' },
        ], '기본 안전 동작을 추천받을게요'),
        promptHint: '장애 시 동작은 오류 복구·워치독·알림 경로를 정한다(무인·산업용이면 특히)',
      },
    ],
    tools: {
      label: '언어·개발환경',
      options: [
        { code: 'c_cpp', label: 'C / C++' },
        { code: 'rust', label: 'Rust' },
        { code: 'micropython', label: 'Python · MicroPython' },
        { code: 'stm32cube', label: 'STM32CubeIDE' },
        { code: 'esp_idf', label: 'ESP-IDF' },
        { code: 'zephyr', label: 'nRF Connect SDK · Zephyr' },
        { code: 'arduino', label: 'Arduino IDE' },
      ],
    },
    attachmentSlots: [
      { code: 'source', label: '기존 펌웨어·소스', hint: '고칠 제품이 있으면' },
      { code: 'protocol', label: '통신 규약·동작 시나리오', hint: '명령 목록, 상태 흐름, 연동 규격' },
    ],
    prompt: {
      what: '보드 위 MCU 가 동작하도록 만드는 프로그램(제어·통신·저장·업데이트)',
      specItems: ['제어 동작', '통신 처리', '데이터 저장', '업데이트(OTA)', '오류 복구', '사용자 조작'],
      checks: [
        'RS-485·CAN 등 외부 장비와 유선 통신이 있으면 통신 규약과 절연 여부',
        '기록·저장 요구가 있으면 보관 기간과 저장 위치(보드·서버)',
      ],
    },
  },
  {
    code: 'app',
    label: '앱 개발',
    short: '앱',
    hint: '휴대폰·태블릿에서 보고 조작하는 화면',
    kind: 'software',
    questions: [
      {
        code: 'app.platform', label: '어떤 기기에서 쓰나요?', short: '앱 기기', multi: false,
        why: '개발 도구는 전문가가 지원 범위에 맞춰 선택합니다.',
        options: withUnknown([
          { code: 'android', label: '안드로이드' },
          { code: 'ios', label: '아이폰' },
          { code: 'both', label: '둘 다' },
          { code: 'tablet', label: '태블릿·전용 단말' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '기기 범위는 지원 플랫폼과 개발 방식(네이티브·크로스플랫폼) 선택의 사실 근거다',
      },
      {
        code: 'app.users', label: '앱을 쓰는 사람은 누구인가요?', short: '앱 사용자', multi: false,
        why: '사용자 유형이 다르면 화면과 권한을 구분해야 합니다.',
        options: withUnknown([
          { code: 'consumer', label: '일반 사용자' },
          { code: 'admin', label: '관리자' },
          { code: 'field', label: '설치·AS 기사' },
          { code: 'mixed', label: '여러 유형이 함께' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '사용자 유형이 여럿이면 화면·권한 구분(계정 구조)이 명세 항목이다',
      },
      {
        code: 'app.core', label: '앱에서 가장 자주 하는 일은 무엇인가요?', short: '핵심 작업', multi: false,
        why: '핵심 작업을 기준으로 첫 화면을 설계합니다.',
        options: withUnknown([
          { code: 'monitor', label: '상태 확인' },
          { code: 'control', label: '제품 제어' },
          { code: 'reports', label: '데이터·보고서 조회' },
          { code: 'settings', label: '설정·사용자 관리' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '핵심 작업이 첫 화면과 장치 연결 방식(실시간 제어인지 조회인지)을 정한다',
      },
    ],
    tools: {
      label: '앱 개발 방식',
      options: [
        { code: 'flutter', label: 'Flutter · Dart' },
        { code: 'react_native', label: 'React Native · TypeScript' },
        { code: 'kotlin', label: 'Android · Kotlin' },
        { code: 'swift', label: 'iOS · Swift' },
        { code: 'maui', label: '.NET MAUI · C#' },
      ],
    },
    attachmentSlots: [
      { code: 'screens', label: '화면 시안·참고 앱', hint: '손그림, 캡처, 비슷한 앱' },
      { code: 'flow', label: '기능 흐름·시나리오', hint: '사용자가 무엇을 누르면 무엇이 되는지' },
    ],
    prompt: {
      what: '장치와 연결해 보고 조작하는 스마트폰·태블릿·웹 화면',
      specItems: ['화면·기능', '장치 연결 방식', '사용자 계정', '알림', '오프라인 동작'],
      checks: [
        '앱이 장치와 직접 연결되는지(블루투스) 서버를 거치는지 자료에 없으면 연결 경로',
        '사용자 계정·여러 사람이 함께 쓰는지 자료에 없으면 사용자 구조',
      ],
    },
  },
  {
    code: 'server',
    label: '서버 개발',
    short: '서버',
    hint: '데이터를 모아 두고 여러 기기가 함께 쓰는 곳',
    kind: 'software',
    questions: [
      {
        code: 'server.scale', label: '몇 대·몇 명이 함께 쓰나요?', short: '사용 규모', multi: false,
        why: '정확한 수치를 모르면 예상 범위를 선택해 주세요.',
        options: withUnknown([
          { code: 'small', label: '장치 몇 대, 나 혼자·소수' },
          { code: 'medium', label: '수십~수백 대, 여러 사용자' },
          { code: 'large', label: '수천 대 이상·서비스 규모' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '규모는 서버 구성(단일·확장)과 운영 비용의 사실 근거다',
      },
      {
        code: 'server.realtime', label: '데이터 확인이나 원격 제어가 실시간이어야 하나요?', short: '실시간성', multi: false,
        why: '실시간성에 따라 서버 비용과 통신 구조가 달라집니다.',
        options: withUnknown([
          { code: 'sub_second', label: '1초 안' },
          { code: 'seconds', label: '수초~1분' },
          { code: 'periodic', label: '주기적으로 확인하면 돼요' },
        ], MARKET_EXPERT_PICK_LABEL),
        promptHint: '실시간이 필요하면 상시 연결(MQTT·WebSocket 류) 통신 구조가, 주기적이면 폴링·배치가 명세 항목이다',
      },
      {
        code: 'server.ops', label: '개발 후 서버 운영·유지보수도 필요한가요?', short: '운영 범위', multi: false,
        why: '기존 클라우드 계정이나 서버가 있다면 자료를 공유해 주세요.',
        options: withUnknown([
          { code: 'dev_only', label: '개발만' },
          { code: 'deploy', label: '초기 구축·배포까지' },
          { code: 'operate', label: '지속 운영·유지보수까지' },
        ], '운영 방식은 상담할게요'),
        promptHint: '운영 범위는 배포·모니터링·백업이 이번 의뢰 범위인지 정한다',
      },
    ],
    tools: {
      label: '서버 개발 방식',
      options: [
        { code: 'node', label: 'Node.js · TypeScript' },
        { code: 'spring', label: 'Java · Spring' },
        { code: 'python', label: 'Python · FastAPI/Django' },
        { code: 'dotnet', label: 'C# · .NET' },
        { code: 'go', label: 'Go' },
        { code: 'php', label: 'PHP · Laravel' },
      ],
    },
    attachmentSlots: [
      { code: 'api', label: 'API·데이터 명세', hint: '주고받을 데이터, 기존 연동 규격' },
      { code: 'infra', label: '기존 서버·운영 환경', hint: '이미 쓰는 클라우드·서버가 있으면' },
    ],
    prompt: {
      what: '장치·앱이 주고받는 데이터를 저장하고 관리하는 서버(API·데이터베이스·관리 화면)',
      specItems: ['데이터 수집·저장', 'API·연동', '사용자·권한', '관리 화면', '운영 환경'],
      checks: [
        '데이터를 얼마나 오래 보관하는지 자료에 없으면 보관 기간',
        '기존 서버·클라우드가 있는지 자료에 없으면 운영 환경',
      ],
    },
  },
];

// ── 레지스트리 바인딩 — 파생 사전·판정 함수는 area-registry.ts 의 팩토리가 만든다 ──────────
// 풀 개발(전 분야)일 때 분야당 묻는 질문 수 상한 — 5분야 × 3 = 15 는 너무 길다. 배열 앞 순서가 우선순위.
export const MARKET_FULL_AREA_QUESTION_CAP = 2;

export const MARKET_REGISTRY = createAreaRegistry({
  areas: MARKET_AREAS,
  conditions: MARKET_COMMON_CONDITIONS,
  common: MARKET_COMMON_QUESTIONS,
  fullAreaQuestionCap: MARKET_FULL_AREA_QUESTION_CAP,
  // 분야 배지 — 전부="풀 개발(회로·PCB·펌웨어·앱·서버)".
  fullBadge: (shorts) => `풀 개발(${shorts.join('·')})`,
});

export const MARKET_AREA_CODES: readonly string[] = MARKET_REGISTRY.codes;
export const MARKET_AREA_MAP: ReadonlyMap<string, MarketAreaDef> = MARKET_REGISTRY.map;

export const isMarketAreaCode = MARKET_REGISTRY.isAreaCode;
export const marketArea = MARKET_REGISTRY.area;
export const marketAreaLabel = MARKET_REGISTRY.areaLabel;
export const marketAreaShort = MARKET_REGISTRY.areaShort;
export const sortMarketAreas = MARKET_REGISTRY.sortAreas;
export const marketAreaBadge = MARKET_REGISTRY.areaBadge;

// 분야 코드 스키마 — 문자열 + 레지스트리 검증(신규 입력용). 읽기는 MarketAreaCodeLoose.
export const MarketAreaCode = MARKET_REGISTRY.AreaCode;
export const MarketAreaCodeLoose = z.string().max(32);
export const MarketAreaCodes = MARKET_REGISTRY.AreaCodes;

// ── 질문 사전(공통 + 분야별) ────────────────────────────────────────────────
export const MARKET_QUESTIONS: readonly MarketQuestionDef[] = MARKET_REGISTRY.questions;
export const isFullMarketAreas = MARKET_REGISTRY.isFull;
export const MARKET_QUESTION_MAP: ReadonlyMap<string, MarketQuestionDef> = MARKET_REGISTRY.questionMap;
export const marketQuestion = MARKET_REGISTRY.question;
export const marketQuestionArea = MARKET_REGISTRY.questionArea;
export const marketAreaQuestionsFor = MARKET_REGISTRY.areaQuestionsFor;
export const marketQuestionsFor = MARKET_REGISTRY.questionsFor;
export const marketRequiredMissing = MARKET_REGISTRY.requiredMissing;
export const marketAnswerIssues = MARKET_REGISTRY.answerIssues;
export const marketAnswerText = MARKET_REGISTRY.answerText;

// ── 희망 툴 ───────────────────────────────────────────────────────────────
export const marketToolLabel = MARKET_REGISTRY.toolLabel;
export const marketToolIssues = MARKET_REGISTRY.toolIssues;
export const normalizeMarketTools = MARKET_REGISTRY.normalizeTools;
export const marketToolRows = MARKET_REGISTRY.toolRows;
export const MARKET_TOOL_LABELS: Readonly<Record<string, string>> = MARKET_REGISTRY.toolLabels;
export const marketToolCodesOf = (tools: MarketToolsType): string[] =>
  [...new Set(Object.values(tools.byArea).flat())];

// ── 첨부 슬롯 ─────────────────────────────────────────────────────────────
export const parseMarketAttachmentField = MARKET_REGISTRY.parseAttachmentField;
export const marketSlotLabel = MARKET_REGISTRY.slotLabel;
