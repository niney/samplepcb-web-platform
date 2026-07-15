import { z } from 'zod';
import {
  MarketCategoryCode,
  MarketServiceArea,
  MarketToolCode,
  MARKET_CATEGORIES,
  MARKET_SERVICE_AREAS,
  MARKET_TOOL_CODES,
} from './market';
import type { MarketServiceAreaType } from './market';

// ── AI 유스케이스 계약 ───────────────────────────────────────────────────────
// 범용 실행 라우트(/api/ai/:useCase/run)와 관리자 설정(/api/admin/settings/ai)의 계약.
// 정책(입력 스키마·프롬프트 바인딩·권한)은 서버 레지스트리(lib/ai/usecases.ts)가 유스
// 케이스별로 명시한다 — 라우트만 범용, 정책은 케이스별. 연결(sp_config ai_base_url ·
// ai_api_key)과 유스케이스 설정(sp_ai_usecase: enabled·model·promptTemplate)은 분리.
// apiKey 원문은 어떤 응답에도 싣지 않는다(마스킹만) — 서버 밖 유출 원천 차단.

// structurize=인터뷰 답변→구성 명세 JSON(P1), diagram-spec=명세 JSON→구성도 HTML(P2).
// 기존 diagram(설명→HTML 단발)은 인터뷰 비활성 시 폴백으로 유지 — 프롬프트가 DB(관리자
// 소유)에 있어 의미를 바꾸지 않고 유스케이스를 추가하는 쪽이 안전하다.
export const AI_USECASES = [
  'market.request-diagram',
  'market.request-structurize',
  'market.request-diagram-spec',
  'market.request-roc',
  'market.request-postings',
] as const;
export type AiUsecaseKeyType = (typeof AI_USECASES)[number];
export const AiUsecaseKey = z.enum(AI_USECASES);

// ── 공개 상태(비밀 없음) — FE 스텝 게이트용 ─────────────────────────────────
export const AiUsecaseStatusResponse = z.object({
  result: z.literal(true),
  data: z.object({ useCase: AiUsecaseKey, enabled: z.boolean() }),
});
export type AiUsecaseStatusResponseType = z.infer<typeof AiUsecaseStatusResponse>;

// ── 실행(비동기 잡) ─────────────────────────────────────────────────────────
// 생성이 수 분(glm-5.2 ~3분)이라 동기 HTTP 로 못 버틴다 — run 은 jobId 를 즉시 반환하고
// 클라이언트가 폴링한다. 잡은 인메모리(단일 인스턴스 전제, 재시작 시 소실=재시도).

// market.request-diagram 입력 — 사용자 첨부는 절대 보내지 않는다(NDA 원칙, 텍스트만).
export const AiDiagramRunBody = z.object({
  title: z.string().trim().min(2).max(200),
  serviceAreas: z.array(MarketServiceArea).max(MARKET_SERVICE_AREAS.length).default([]),
  categories: z.array(MarketCategoryCode).max(MARKET_CATEGORIES.length).default([]),
  cadTools: z.array(MarketToolCode).max(MARKET_TOOL_CODES.length).default([]),
  description: z.string().trim().min(10).max(20000),
});
export type AiDiagramRunBodyType = z.infer<typeof AiDiagramRunBody>;

// ── 구성 명세(DiagramSpec) — 인터뷰 파이프라인의 피벗 JSON ──────────────────
// LLM 산출을 스키마로 정규화한다: enum 이탈은 .catch 로 안전값으로 흡수(프로빙 실측 —
// glm·deepseek 모두 flow "debug" 슬립), 알 수 없는 키는 zod 기본 strip. 구조 결함
// (미정의 그룹·끊긴 연결)은 normalizeDiagramSpec 이 보정한다 — 실패 대신 복구가 원칙.

export const DIAGRAM_BLOCK_TYPES = [
  'power', 'controller', 'communication', 'sensor', 'input', 'output', 'driver',
  'storage', 'debug', 'ui', 'external', 'mechanical', 'protection', 'other',
] as const;

const specId = z.string().trim().min(1).max(60);

export const DiagramSpec = z.object({
  project: z.object({
    name: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(500).catch(''),
    stage: z.string().trim().max(40).catch(''),
    service_type: z.string().trim().max(40).catch(''),
  }),
  groups: z.array(z.object({ id: specId, label: z.string().trim().min(1).max(80) })).min(1).max(12),
  blocks: z
    .array(
      z.object({
        id: specId,
        group: specId,
        type: z.enum(DIAGRAM_BLOCK_TYPES).catch('other'),
        label: z.string().trim().min(1).max(200),
        status: z.enum(['confirmed', 'tbd', 'option']).catch('tbd'),
      }),
    )
    .min(1)
    .max(80),
  connections: z
    .array(
      z.object({
        from: specId,
        to: specId,
        interface: z.string().trim().max(60).catch(''),
        flow: z.enum(['power', 'data', 'control', 'feedback']).catch('data'),
      }),
    )
    .max(160)
    .catch([]),
  constraints: z.array(z.string().trim().min(1).max(300)).max(20).catch([]),
  feature_highlights: z.array(z.string().trim().min(1).max(200)).max(20).catch([]),
  questions_missing: z
    .array(z.object({ topic: z.string().trim().max(60).catch(''), question: z.string().trim().min(1).max(500) }))
    .max(20)
    .catch([]),
});
export type DiagramSpecType = z.infer<typeof DiagramSpec>;

// 구조 보정 — 블록이 참조하는 미정의 그룹은 자동 생성, 끊긴 연결은 제거, 중복 블록 id 는
// 뒤엣것을 버린다. LLM 재호출 없이 렌더 가능한 상태로 만드는 최소 수리.
export function normalizeDiagramSpec(spec: DiagramSpecType): DiagramSpecType {
  const groupIds = new Set(spec.groups.map((g) => g.id));
  const groups = [...spec.groups];
  const seenBlocks = new Set<string>();
  const blocks = spec.blocks.filter((b) => {
    if (seenBlocks.has(b.id)) return false;
    seenBlocks.add(b.id);
    if (!groupIds.has(b.group)) {
      groupIds.add(b.group);
      groups.push({ id: b.group, label: b.group.replaceAll('_', ' ').toUpperCase() });
    }
    return true;
  });
  const connections = spec.connections.filter(
    (c) => seenBlocks.has(c.from) && seenBlocks.has(c.to) && c.from !== c.to,
  );
  return { ...spec, groups, blocks, connections };
}

// ── 인터뷰 질문 뱅크 — 위저드와 서버 프롬프트 바인딩이 공유하는 정본 ─────────
// 공통 질문 + 선택 분야별 모듈. 전 항목 선택 사항이며, 적용 분야의 미응답만 구조화
// 프롬프트에 전달한다. 순수 소프트웨어 의뢰에 MCU·전원 질문이 섞이지 않게 하는 경계다.

export interface AiInterviewQuestion {
  code: string; // 답변 페이로드 키(짧은 영문)
  bankRef: string; // 기획 문서 질문 코드(U/S) — 추적용
  label: string;
  type: 'single' | 'multi' | 'text';
  options?: readonly string[]; // single/multi 선택지(라벨=값, 프롬프트에 그대로 바인딩)
  placeholder?: string;
  // 미지정이면 모든 의뢰에 적용하는 공통 질문. 하나 이상이면 선택 분야와 교집합일 때 적용.
  areas?: readonly MarketServiceAreaType[];
  // 단순 조건 노출 — 해당 code 의 답이 notValues 중 하나면 숨김(빈 답은 노출 유지)
  hideIf?: { code: string; values: readonly string[] };
}

export const AI_INTERVIEW_QUESTIONS: readonly AiInterviewQuestion[] = [
  { code: 'stage', bankRef: 'U-04', label: '현재 어느 단계에서 시작하나요?', type: 'single',
    options: ['아이디어만 있음', '요구사항·기능 명세 보유', '기존 설계·소스 보유', '시제품·테스트 중', '출시·양산 준비'] },
  { code: 'delivery', bankRef: 'U-02', label: '원하는 최종 결과물은 무엇인가요?', type: 'text',
    placeholder: '예: 회로도와 거버, iOS/Android 앱, API 서버와 운영 문서' },
  { code: 'assets', bankRef: 'U-03', label: '현재 보유한 자료·설계·소스가 있나요?', type: 'text',
    placeholder: '예: 기능명세서, 기존 회로도, 3D 도면, 소스 저장소, API 문서' },
  { code: 'qty', bankRef: 'U-08', label: '시제품 수량과 목표 양산 수량은?', type: 'text',
    placeholder: '예: 시제품 20대, 양산 연 1,000대',
    areas: ['circuit', 'pcb', 'firmware', 'product-design', 'mechanical-design'] },
  { code: 'power', bankRef: 'S-02/S-04', label: '전원은 무엇을 사용하나요?', type: 'multi',
    options: ['AC 220V', 'DC 어댑터', 'USB 전원', 'PoE', '차량 전원', '배터리(주 전원)', '배터리(정전 백업용)', '미정'],
    areas: ['circuit', 'pcb', 'firmware'] },
  { code: 'powerDetail', bankRef: 'S-03', label: '입력 전압 범위·최대 소비전류(아는 만큼)', type: 'text',
    placeholder: '예: 12V(9~16V 허용), 최대 1A', areas: ['circuit', 'pcb', 'firmware'] },
  { code: 'mcu', bankRef: 'S-05', label: '정해진 메인 컨트롤러(MCU/모듈)가 있나요?', type: 'text',
    placeholder: '예: nRF52840 인증 모듈 — 미정이면 비워두세요(추천받기)', areas: ['circuit', 'firmware'] },
  { code: 'sensors', bankRef: 'S-06', label: '감지하거나 입력받을 것은 무엇인가요?', type: 'text',
    placeholder: '예: 온습도 1개, 문열림 센서, 키 스위치', areas: ['circuit', 'firmware'] },
  { code: 'outputs', bankRef: 'S-07/S-08', label: '제어할 출력·부하는 무엇인가요? (전압/전류 아는 만큼)', type: 'text',
    placeholder: '예: 12V 솔레노이드 락 500mA 1개, LED 3개', areas: ['circuit', 'firmware'] },
  { code: 'comm', bankRef: 'S-09', label: '장치에 필요한 통신 방식은?', type: 'multi',
    options: ['BLE', 'Wi-Fi', 'LTE-M/LTE', 'LoRa', 'RS485/RS232', 'CAN', 'Ethernet', 'USB', '없음', '미정'],
    areas: ['circuit', 'pcb', 'firmware'] },
  { code: 'server', bankRef: 'S-10/S-11', label: '서버·앱 연동이 필요한가요?', type: 'multi',
    options: ['기존 서버 연동', '신규 서버 필요', '모바일 앱', '웹 관리자 화면', '없음', '미정'],
    areas: ['circuit', 'firmware'] },
  { code: 'ui', bankRef: 'S-13', label: '물리적인 상태 표시·조작 요소가 있나요?', type: 'multi',
    options: ['LED', '버튼/스위치', '디스플레이', '부저', '없음', '미정'],
    areas: ['circuit', 'firmware', 'product-design'] },
  { code: 'enclosure', bankRef: 'S-16', label: '케이스는 어떻게 제작하나요?', type: 'single',
    options: ['기성품 케이스 가공', '신규 디자인(3D프린팅 시제품)', '신규 디자인(양산 사출)', '미정'],
    areas: ['product-design', 'mechanical-design'] },
  { code: 'env', bankRef: 'U-06/S-15', label: '사용 환경·방수방진·인증 요구가 있나요?', type: 'text',
    placeholder: '예: 실외 IP65, KC 인증 필요',
    areas: ['circuit', 'pcb', 'firmware', 'product-design', 'mechanical-design'] },
  { code: 'pcbInputs', bankRef: 'P-01', label: 'PCB 설계에 제공할 입력 자료는 무엇인가요?', type: 'multi',
    options: ['회로도', '부품목록(BOM)', '기구 외형·배치도', '기존 PCB/거버', '없음', '미정'], areas: ['pcb'] },
  { code: 'pcbConstraints', bankRef: 'P-02', label: '기판 크기·층수·특수 제약이 있나요?', type: 'text',
    placeholder: '예: 80×50mm, 4층, 임피던스 제어 필요', areas: ['pcb'] },
  { code: 'mechanical', bankRef: 'M-01/M-02', label: '목표 크기·재질·제작 방식이 정해졌나요?', type: 'text',
    placeholder: '예: 120×80×30mm, ABS, 시제품 3D프린팅 후 사출', areas: ['product-design', 'mechanical-design'] },
  { code: 'mechanicalAssets', bankRef: 'M-03', label: '기존 도면·3D 데이터·참고 제품이 있나요?', type: 'text',
    placeholder: '예: STEP 파일과 제품 스케치 보유', areas: ['product-design', 'mechanical-design'] },
  { code: 'appPlatform', bankRef: 'A-01', label: '앱의 대상 플랫폼은 무엇인가요?', type: 'multi',
    options: ['웹', 'iOS', 'Android', '태블릿', '미정'], areas: ['app'] },
  { code: 'appScope', bankRef: 'A-02', label: '주요 사용자와 꼭 필요한 화면·기능은 무엇인가요?', type: 'text',
    placeholder: '예: 일반 사용자/관리자, 회원가입·장치등록·상태조회·푸시알림', areas: ['app'] },
  { code: 'appExisting', bankRef: 'A-03', label: '연동할 기존 API·디자인·앱이 있나요?', type: 'text',
    placeholder: '예: REST API 문서와 Figma 디자인 보유', areas: ['app'] },
  { code: 'serverScope', bankRef: 'B-01', label: '서버 개발 범위는 무엇인가요?', type: 'multi',
    options: ['API', 'DB 설계', '관리자 화면', '실시간 통신', '배치·스케줄러', '인프라·배포', '미정'], areas: ['server'] },
  { code: 'serverScale', bankRef: 'B-02', label: '예상 사용자·장치 수와 트래픽 규모는?', type: 'text',
    placeholder: '예: 장치 1만 대, 동시접속 500명, 초당 메시지 100건', areas: ['server'] },
  { code: 'serverEnv', bankRef: 'B-03', label: '운영 환경·외부 연동·보안 요구가 있나요?', type: 'text',
    placeholder: '예: AWS, 사내 ERP 연동, 개인정보 암호화와 감사로그 필요', areas: ['server'] },
  { code: 'softwareTarget', bankRef: 'W-01', label: '대상 OS·버전과 실행 형태는 무엇인가요?', type: 'text',
    placeholder: '예: Windows 11 GUI 프로그램 / Ubuntu 24.04 백그라운드 서비스', areas: ['software-linux', 'software-windows'] },
  { code: 'softwareIntegration', bankRef: 'W-02', label: '연동할 장비·드라이버·프로토콜·기존 소스가 있나요?', type: 'text',
    placeholder: '예: USB 계측기, 시리얼 통신, 기존 C++ 소스 보유', areas: ['software-linux', 'software-windows'] },
  { code: 'softwareDelivery', bankRef: 'W-03', label: '설치·업데이트·배포 방식에 요구가 있나요?', type: 'text',
    placeholder: '예: 오프라인 설치 파일과 자동 업데이트 필요', areas: ['software-linux', 'software-windows'] },
] as const;

export function getApplicableAiInterviewQuestions(
  serviceAreas: readonly MarketServiceAreaType[],
): AiInterviewQuestion[] {
  const selected = new Set<MarketServiceAreaType>(serviceAreas);
  return AI_INTERVIEW_QUESTIONS.filter(
    (q) => q.areas === undefined || q.areas.some((area) => selected.has(area)),
  );
}

export const AiInterviewAnswer = z.object({
  code: z.string().trim().min(1).max(30),
  answer: z.string().trim().min(1).max(2000),
});
export type AiInterviewAnswerType = z.infer<typeof AiInterviewAnswer>;

// market.request-structurize 입력 — 인터뷰 답변(있는 것만) + 제목·분야·설명 텍스트.
export const AiStructurizeRunBody = z.object({
  title: z.string().trim().min(2).max(200),
  serviceAreas: z.array(MarketServiceArea).max(MARKET_SERVICE_AREAS.length).default([]),
  categories: z.array(MarketCategoryCode).max(MARKET_CATEGORIES.length).default([]),
  cadTools: z.array(MarketToolCode).max(MARKET_TOOL_CODES.length).default([]),
  description: z.string().trim().min(10).max(20000),
  answers: z.array(AiInterviewAnswer).max(40).default([]),
});
export type AiStructurizeRunBodyType = z.infer<typeof AiStructurizeRunBody>;

// market.request-diagram-spec 입력 — 구성 명세 JSON 문자열(서버가 재검증·정규화).
export const AiDiagramSpecRunBody = z.object({
  spec: z.string().min(2).max(200_000),
});
export type AiDiagramSpecRunBodyType = z.infer<typeof AiDiagramSpecRunBody>;

// market.request-roc 입력 — 작업검토지시서(Phase 2). 구성 명세 + 의뢰 텍스트 + 인터뷰
// 답변으로 개발자/검수자용 마크다운 문서를 생성한다. 산출은 잡의 md 필드.
export const AiRocRunBody = z.object({
  title: z.string().trim().min(2).max(200),
  serviceAreas: z.array(MarketServiceArea).max(MARKET_SERVICE_AREAS.length).default([]),
  categories: z.array(MarketCategoryCode).max(MARKET_CATEGORIES.length).default([]),
  cadTools: z.array(MarketToolCode).max(MARKET_TOOL_CODES.length).default([]),
  description: z.string().trim().min(10).max(20000),
  spec: z.string().min(2).max(200_000),
  answers: z.array(AiInterviewAnswer).max(60).default([]),
});
export type AiRocRunBodyType = z.infer<typeof AiRocRunBody>;

// market.request-postings 입력 — ROC 와 동일한 원천(명세+답변+의뢰 텍스트)에서 분야별
// 포스팅 카드(JSON, market.ts MarketPostingCards)를 생성한다. 산출은 잡의 json 필드.
export const AiPostingsRunBody = AiRocRunBody;
export type AiPostingsRunBodyType = AiRocRunBodyType;

export const AiRunResponse = z.object({
  result: z.literal(true),
  data: z.object({ jobId: z.string() }),
});
export type AiRunResponseType = z.infer<typeof AiRunResponse>;

export const AiJobStatus = z.enum(['running', 'done', 'error']);
export type AiJobStatusType = z.infer<typeof AiJobStatus>;

export const AiJobResponse = z.object({
  result: z.literal(true),
  data: z.object({
    jobId: z.string(),
    status: AiJobStatus,
    html: z.string().nullable(), // done 일 때만 — 렌더는 반드시 sandbox iframe(srcdoc)
    json: z.string().nullable(), // done 일 때만 — JSON 산출 유스케이스(정규화된 명세 문자열)
    md: z.string().nullable(), // done 일 때만 — 마크다운 산출 유스케이스(작업검토지시서)
    error: z.string().nullable(),
    elapsedSecs: z.number(),
  }),
});
export type AiJobResponseType = z.infer<typeof AiJobResponse>;

// ── 관리자 설정 ─────────────────────────────────────────────────────────────

export const AiUsecaseConfig = z.object({
  useCase: AiUsecaseKey,
  enabled: z.boolean(),
  model: z.string(),
  promptTemplate: z.string(),
  updatedAt: z.string(), // ISO
});
export type AiUsecaseConfigType = z.infer<typeof AiUsecaseConfig>;

export const AiSettingsResponse = z.object({
  result: z.literal(true),
  data: z.object({
    baseUrl: z.string(),
    apiKeyMasked: z.string().nullable(), // 예: '****abcd' — 원문은 절대 미노출
    // 연결 우선순위는 env(.env) > 관리자 저장값 > 기본값 — env 가 잡혀 있으면 true,
    // 화면은 해당 입력을 잠그고 ".env 값이 우선 적용 중" 안내를 띄운다.
    baseUrlFromEnv: z.boolean(),
    apiKeyFromEnv: z.boolean(),
    usecases: z.array(AiUsecaseConfig),
  }),
});
export type AiSettingsResponseType = z.infer<typeof AiSettingsResponse>;

// 부분 저장 — 보낸 필드만 갱신. apiKey: 문자열=교체, null=삭제, 미전송=유지.
export const AiSettingsUpdate = z.object({
  baseUrl: z.string().trim().url().max(300).optional(),
  apiKey: z.string().trim().min(1).max(300).nullable().optional(),
  usecases: z
    .array(
      z.object({
        useCase: AiUsecaseKey,
        enabled: z.boolean(),
        model: z.string().trim().min(1).max(100),
        promptTemplate: z.string().trim().min(10).max(20000),
      }),
    )
    .optional(),
});
export type AiSettingsUpdateType = z.infer<typeof AiSettingsUpdate>;

// 모델 목록(연결 테스트 겸용) — 현재 연결(baseUrl·apiKey)로 /api/tags 조회.
export const AiModelsResponse = z.object({
  result: z.literal(true),
  data: z.object({ models: z.array(z.string()) }),
});
export type AiModelsResponseType = z.infer<typeof AiModelsResponse>;
