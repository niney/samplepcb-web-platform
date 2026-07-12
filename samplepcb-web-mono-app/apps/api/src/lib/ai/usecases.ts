import type { z } from 'zod';
import {
  AI_INTERVIEW_QUESTIONS,
  AI_USECASES,
  AiDiagramRunBody,
  AiDiagramSpecRunBody,
  AiRocRunBody,
  AiStructurizeRunBody,
  DiagramSpec,
  MARKET_SERVICE_AREA_LABELS,
  normalizeDiagramSpec,
} from '@sp/api-contract';
import type { AiUsecaseKeyType } from '@sp/api-contract';
import { extractHtml, extractJsonObject } from './ollama';
import { prisma } from '../prisma';

// ── AI 유스케이스 레지스트리 ─────────────────────────────────────────────────
// 라우트(/api/ai/:useCase/run)는 범용이되, 정책(입력 스키마·프롬프트 바인딩·기본값)은
// 여기서 유스케이스별로 명시한다. 새 유스케이스 = 계약 AI_USECASES + 이 레지스트리에
// def 추가(설정 행은 lazy 생성이라 마이그레이션 불요).

// LLM 산출 상한 — DB(MEDIUMTEXT)·응답 크기 방어.
const MAX_HTML_BYTES = 512_000;
const MAX_TEXT_BYTES = 200_000; // json(명세)·md(지시서) 공용

export interface AiUsecaseDef {
  defaultModel: string;
  defaultPrompt: string;
  inputSchema: z.ZodTypeAny;
  // 검증 통과한 입력을 관리자 프롬프트 템플릿({{변수}})에 바인딩.
  // 깊은 검증 실패(예: spec JSON 파손)는 throw — 라우트가 400 으로 변환한다.
  buildPrompt: (template: string, input: unknown) => string;
  // 원시 산출 → 저장 가능한 결과. 파싱·검증 실패는 throw — 러너가 retries 만큼 재호출
  // (인터뷰 프로빙 실측: enum 슬립은 스키마 .catch 정규화로 흡수, 완전 파손만 재시도).
  parseResult: (raw: string) => { html: string } | { json: string } | { md: string };
  retries: number;
}

const parseHtmlResult = (raw: string): { html: string } => {
  const html = extractHtml(raw);
  if (html === '') throw new Error('EMPTY_RESULT');
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('RESULT_TOO_LARGE');
  return { html };
};

// 프로빙 확정 기본 프롬프트(2026-07-12, glm-5.2 기준 B2 명세 — docs/AI_DIAGRAM.md).
// 부품은 역할명만(구체 모델명 금지) — 사용자 피드백 확정 사항.
const DIAGRAM_DEFAULT_PROMPT = `당신은 하드웨어 시스템 아키텍트입니다. 아래 [의뢰 내용]을 분석해 "시스템 구성도" HTML 문서를 작성하세요.

출력 규칙:
- 외부 리소스(CDN·이미지·폰트·스크립트) 없이 인라인 CSS/SVG만 사용하는 단일 HTML 파일
- 설명 문장 없이 완성된 HTML 코드만 출력

레이아웃 골격(엄수 — 하나의 <svg viewBox="0 0 1400 1000"> 안에 전부 그린다):
- 최상단 중앙: 시스템 제목(영문 대문자)
- 3열 배치. 좌열=로컬 접속·입력 그룹, 중앙=메인 컨트롤러(MCU, 세로로 큰 블록), 우열=통신·제어 대상 그룹
- 다이어그램 맨 오른쪽: 외부 시스템 세로 체인(예: MQTT Broker → Web Dashboard/Admin → Mobile/Web App, 각 블록 아래 기능 불릿 2~4개)
- 최하단 가로: 전원 계통 체인(입력 → 보호/필터 → AC-DC → DC-DC 단계, 배터리 백업은 (Option) 분기)
- 하단 여백: Legend 박스(블록 색·화살표 의미)와 FEATURE HIGHLIGHTS 박스(주요 기능 불릿)
- 연결선은 수평·수직 직교선만 사용(대각선 금지), 꺾임은 직각. 선 중앙에 인터페이스 라벨(UART, GPIO, SPI, I2C, PWM, BLE, LTE-M, MQTT, 3.3V 등)
- 블록·선·텍스트가 서로 겹치지 않게 충분한 간격을 둘 것

블록 규칙:
- 색상: 통신 모듈=#c8e6c9, 인터페이스/입출력=#fff9c4, 전원/공급=#bbdefb, 외부 시스템=흰색+회색 테두리
- 전원 연결선=빨간 화살표, 신호/데이터=검은 화살표
- 부품은 구체 모델명을 쓰지 말고 역할명으로만 표기 — 미확정은 "(TBD)", 선택 사양은 "(Option)"
- 기능 그룹은 점선 테두리 박스로 묶고 박스 상단에 파란 대문자 그룹명

포함 요소(의뢰 내용에 맞게 구체화, 해당 없으면 생략 가능):
- 메인 컨트롤러(MCU) 1개 — 모든 그룹과 연결되는 중심
- 의뢰에 언급된 통신 수단 각각(모듈 블록 + 프로토콜 라벨 + 기능 불릿)
- 제어 대상(드라이버 → 액추에이터 등)과 상태 감지 센서(통상 필요한 것 포함)
- 통상 필요한 보조 요소를 합리적으로 추가: 전원 계통 체인, 저장소/디버그(Flash·SWD), 상태 표시(LED/부저 (Option)), 환경 센서 (Option)
- 서버/앱 등 외부 시스템 패널

[의뢰 제목] {{title}}
[개발 분야] {{serviceAreas}}
[의뢰 내용] {{description}}`;

// 인터뷰 프로빙 확정 P1 프롬프트(2026-07-12, glm-5.2 기준 — .tmp/ai-interview-probing).
// 보강 4건 반영: 그룹 수 상한 / 서버 연동 시 외부 시스템 블록 필수 / 미확정 점검
// 체크리스트 / 모델명 환각 금지. 부품은 역할명만 — 구성도 프로빙 때 사용자 확정 사항.
const STRUCTURIZE_DEFAULT_PROMPT = `당신은 하드웨어 시스템 아키텍트입니다. 아래 [의뢰 내용]과 [고객 인터뷰 답변]을 분석해 시스템 구성 명세 JSON 을 작성하세요.

출력 규칙:
- 설명 문장 없이 JSON 객체 하나만 출력한다.
- 스키마(키 이름 엄수):
{
  "project": { "name": "제품명(영문 권장)", "summary": "한 문장 요약", "stage": "idea|spec|schematic|pcb|gerber|pcba", "service_type": "full|single|review|production" },
  "groups": [{ "id": "소문자_스네이크", "label": "영문 대문자 그룹명" }],
  "blocks": [{ "id": "소문자_스네이크", "group": "groups.id 중 하나", "type": "power|controller|communication|sensor|input|output|driver|storage|debug|ui|external|mechanical|protection|other", "label": "블록 라벨", "status": "confirmed|tbd|option" }],
  "connections": [{ "from": "blocks.id", "to": "blocks.id", "interface": "UART, I2C, GPIO, BLE, 12V 등", "flow": "power|data|control|feedback" }],
  "constraints": ["설계 제약 문장"],
  "feature_highlights": ["주요 기능 불릿"],
  "questions_missing": [{ "topic": "주제", "question": "고객에게 물을 한국어 질문" }]
}

작성 규칙:
- 블록은 답변에서 도출 가능한 것과, 그 구성에 통상 필수인 보조 요소(전원 레귤레이터·보호소자·디버그 포트 등)만 만든다.
- 그룹은 4~7개로 구성한다 — Local Access / Main Controller / Cloud Connectivity / Output Control / Storage·Debug·Sensor / Power Supply / External System 계열에서 제품에 맞는 것만.
- 서버·클라우드·앱 연동이 답변에 있으면 External System 그룹에 해당 블록(서버/대시보드/앱)을 반드시 만든다.
- status: 고객이 확정한 것=confirmed, 필요하지만 사양 미확정=tbd, 선택 사양=option.
- 부품은 역할명으로만 표기한다. 구체 모델명·품번은 고객 답변에 명시된 경우에만 그대로 사용하고, 답변에 없는 모델명을 지어내지 않는다.
- 고객이 요구하지 않은 기능 블록(앱·클라우드·통신 방식 등)을 추가하지 않는다.
- [미응답 항목]과 다음 점검 목록 중 이 제품에 해당하는 미확정 사항은 questions_missing 에 넣는다:
  무선 통신→안테나 방식, 고전류 부하→보호회로·방열, 판매 제품→인증(KC 등), 생산 의뢰→검사 조건, 외부 기기 연결→커넥터 사양, 배터리→소비전류·동작시간.

[의뢰 제목] {{title}}
[개발 분야] {{serviceAreas}}
[의뢰 내용] {{description}}

[고객 인터뷰 답변]
{{answers}}

[미응답 항목]
{{unanswered}}`;

// 인터뷰 프로빙 확정 P2 프롬프트 — 기존 DIAGRAM_DEFAULT_PROMPT 의 레이아웃·색 규칙을
// 유지하고 입력을 [구성 명세 JSON]으로 바꾼 변형. 렌더 충실도 49/49 실측.
const DIAGRAM_SPEC_DEFAULT_PROMPT = `당신은 하드웨어 시스템 아키텍트입니다. 아래 [구성 명세 JSON]을 "시스템 구성도" HTML 문서로 그리세요.

출력 규칙:
- 외부 리소스(CDN·이미지·폰트·스크립트) 없이 인라인 CSS/SVG만 사용하는 단일 HTML 파일
- 설명 문장 없이 완성된 HTML 코드만 출력

입력 충실도(가장 중요):
- JSON 의 groups/blocks/connections 를 빠짐없이, 라벨 문구 그대로 그린다.
- JSON 에 없는 블록·연결을 추가하지 않는다(제목·Legend·FEATURE HIGHLIGHTS 박스는 예외).
- block.status 가 "tbd"면 라벨 뒤에 "(TBD)", "option"이면 "(Option)"을 붙인다(라벨에 이미 있으면 중복 금지).
- constraints 는 해당 그룹 근처에 작은 주석 텍스트로, feature_highlights 는 FEATURE HIGHLIGHTS 박스에 표시한다. questions_missing 은 그리지 않는다.

레이아웃 골격(엄수 — 하나의 <svg viewBox="0 0 1400 1000"> 안에 전부 그린다):
- 최상단 중앙: 시스템 제목(project.name 영문 대문자)
- 3열 배치. 좌열=로컬 접속·입력 그룹, 중앙=메인 컨트롤러(세로로 큰 블록), 우열=통신·제어 대상 그룹
- 다이어그램 맨 오른쪽: External System 그룹은 세로 체인으로
- 최하단 가로: Power Supply 그룹은 전원 계통 체인(입력 → 보호/필터 → 변환 단계)으로
- 하단 여백: Legend 박스(블록 색·화살표 의미)와 FEATURE HIGHLIGHTS 박스
- 연결선은 수평·수직 직교선만 사용(대각선 금지), 꺾임은 직각. 선 중앙에 connection.interface 라벨
- 블록·선·텍스트가 서로 겹치지 않게 충분한 간격을 둘 것

블록 규칙:
- 색상: 통신 모듈=#c8e6c9, 인터페이스/입출력=#fff9c4, 전원/공급=#bbdefb, 외부 시스템=흰색+회색 테두리
- flow=power 연결선=빨간 화살표, 그 외(data/control/feedback)=검은 화살표
- 기능 그룹은 점선 테두리 박스로 묶고 박스 상단에 파란 대문자 그룹명(group.label)

[구성 명세 JSON]
{{spec}}`;

// 작업검토지시서(Phase 2) — 인터뷰 프로빙 P4(서식 10/10) 프롬프트를 의뢰 분야 일반형으로.
// 확정 안 된 값은 (TBD) + 9번 수집, 모델명 환각 금지 — 구성도와 동일한 규율.
const ROC_DEFAULT_PROMPT = `당신은 하드웨어 개발 PM 입니다. 아래 [의뢰 내용], [고객 인터뷰 답변], [구성 명세 JSON]을 바탕으로, 이 프로젝트에 견적을 낼 개발자와 검수자가 참고할 "작업검토지시서" 마크다운 문서를 작성하세요.

문서 구조(섹션 제목·번호 고정, 10개 전부 포함):
## 1. 프로젝트 식별
## 2. 첨부자료 목록
## 3. 작업 목적
## 4. 입력 조건
## 5. 작업 범위
## 6. 기술 요구사항
## 7. 산출물
## 8. 검수 기준
## 9. 미확정 항목
## 10. 완료 조건

작성 규칙:
- 개발자가 견적과 수행 가능성을 판단할 수 있는 구체적 언어로 쓴다(요구 수치·인터페이스·보호조건 명시).
- 확정되지 않은 값은 지어내지 말고 (TBD)로 표기하고 "9. 미확정 항목"에 모은다. 구성 명세의 questions_missing 도 9번에 반영한다.
- 작업 범위는 [개발 분야] 기준으로 포함/제외/고객 책임/플랫폼 책임으로 나눈다.
- 답변에 없는 구체 모델명·수치를 지어내지 않는다.
- 코드펜스 없이 마크다운 본문만 출력한다.

[의뢰 제목] {{title}}
[개발 분야] {{serviceAreas}}
[의뢰 내용] {{description}}

[고객 인터뷰 답변]
{{answers}}

[구성 명세 JSON]
{{spec}}`;

const QUESTION_BY_CODE = new Map(AI_INTERVIEW_QUESTIONS.map((q) => [q.code, q]));

// 인터뷰 답변 → 프롬프트 라인(질문 라벨 매칭, 보강 답변은 원문 그대로).
const buildAnswerLines = (answers: { code: string; answer: string }[]): string =>
  answers
    .map((a) => {
      const q = QUESTION_BY_CODE.get(a.code);
      return q !== undefined ? `- ${q.label}: ${a.answer}` : `- (보강 답변) ${a.answer}`;
    })
    .join('\n') || '- (없음)';

// 명세 문자열 검증·정규화 — buildPrompt(라우트, 400 변환)와 프로젝트 저장 검증이 공유.
export function parseDiagramSpecString(spec: string) {
  return normalizeDiagramSpec(DiagramSpec.parse(JSON.parse(spec)));
}

export const AI_USECASE_DEFS: Record<AiUsecaseKeyType, AiUsecaseDef> = {
  'market.request-diagram': {
    defaultModel: 'glm-5.2:cloud', // 프로빙 1위(사용자 확정) — 차선 deepseek-v4-pro:cloud
    defaultPrompt: DIAGRAM_DEFAULT_PROMPT,
    inputSchema: AiDiagramRunBody,
    buildPrompt: (template, input) => {
      const p = AiDiagramRunBody.parse(input);
      return template
        .replaceAll('{{title}}', p.title)
        .replaceAll(
          '{{serviceAreas}}',
          p.serviceAreas.map((a) => MARKET_SERVICE_AREA_LABELS[a]).join(', ') || '미지정',
        )
        .replaceAll('{{description}}', p.description);
    },
    parseResult: parseHtmlResult,
    retries: 0,
  },
  'market.request-structurize': {
    defaultModel: 'glm-5.2:cloud',
    defaultPrompt: STRUCTURIZE_DEFAULT_PROMPT,
    inputSchema: AiStructurizeRunBody,
    buildPrompt: (template, input) => {
      const p = AiStructurizeRunBody.parse(input);
      const answered = new Set(p.answers.map((a) => a.code));
      const answerLines = buildAnswerLines(p.answers);
      // 미응답 = 뱅크 질문 중 답이 없고, hideIf 조건(예: 보드만 납품이면 케이스 질문)에도
      // 걸리지 않는 것 — 조건부 숨김을 미응답으로 넘기면 허위 questions_missing 이 생긴다.
      const answerOf = (code: string): string =>
        p.answers.find((a) => a.code === code)?.answer ?? '';
      const unansweredLines =
        AI_INTERVIEW_QUESTIONS.filter((q) => {
          if (answered.has(q.code)) return false;
          const hide = q.hideIf;
          const hidden =
            hide === undefined ? false : hide.values.some((v) => answerOf(hide.code).includes(v));
          return !hidden;
        })
          .map((q) => `- ${q.label}`)
          .join('\n') || '- (없음)';
      return template
        .replaceAll('{{title}}', p.title)
        .replaceAll(
          '{{serviceAreas}}',
          p.serviceAreas.map((a) => MARKET_SERVICE_AREA_LABELS[a]).join(', ') || '미지정',
        )
        .replaceAll('{{description}}', p.description)
        .replaceAll('{{answers}}', answerLines)
        .replaceAll('{{unanswered}}', unansweredLines);
    },
    parseResult: (raw) => {
      const spec = normalizeDiagramSpec(DiagramSpec.parse(extractJsonObject(raw)));
      const json = JSON.stringify(spec);
      if (Buffer.byteLength(json, 'utf8') > MAX_TEXT_BYTES) throw new Error('RESULT_TOO_LARGE');
      return { json };
    },
    retries: 1, // JSON 완전 파손만 재시도 — enum 슬립은 스키마 .catch 가 흡수
  },
  'market.request-diagram-spec': {
    defaultModel: 'glm-5.2:cloud',
    defaultPrompt: DIAGRAM_SPEC_DEFAULT_PROMPT,
    inputSchema: AiDiagramSpecRunBody,
    buildPrompt: (template, input) => {
      const p = AiDiagramSpecRunBody.parse(input);
      // 깊은 검증 — 파손 JSON 은 여기서 throw(라우트가 400 변환), 잡 시작 전에 거른다.
      const spec = parseDiagramSpecString(p.spec);
      return template.replaceAll('{{spec}}', JSON.stringify(spec, null, 2));
    },
    parseResult: parseHtmlResult,
    retries: 0,
  },
  'market.request-roc': {
    defaultModel: 'glm-5.2:cloud',
    defaultPrompt: ROC_DEFAULT_PROMPT,
    inputSchema: AiRocRunBody,
    buildPrompt: (template, input) => {
      const p = AiRocRunBody.parse(input);
      const spec = parseDiagramSpecString(p.spec); // 파손 spec 은 400
      return template
        .replaceAll('{{title}}', p.title)
        .replaceAll(
          '{{serviceAreas}}',
          p.serviceAreas.map((a) => MARKET_SERVICE_AREA_LABELS[a]).join(', ') || '미지정',
        )
        .replaceAll('{{description}}', p.description)
        .replaceAll('{{answers}}', buildAnswerLines(p.answers))
        .replaceAll('{{spec}}', JSON.stringify(spec, null, 2));
    },
    parseResult: (raw) => {
      // 코드펜스로 감싸 오면 벗긴다(마크다운 본문만 저장).
      const fence = /```(?:markdown|md)?\s*([\s\S]*?)```/i.exec(raw);
      const md = (fence?.[1] ?? raw).trim();
      if (md === '') throw new Error('EMPTY_RESULT');
      // 서식 게이트 — 10개 섹션 중 8개 미만이면 재시도 대상(프로빙 P4 는 첫 시도 10/10).
      const sections = new Set([...md.matchAll(/^##\s*(\d+)\./gm)].map((m) => Number(m[1])));
      if (sections.size < 8) throw new Error('FORMAT_MISMATCH');
      if (Buffer.byteLength(md, 'utf8') > MAX_TEXT_BYTES) throw new Error('RESULT_TOO_LARGE');
      return { md };
    },
    retries: 1,
  },
};

// ── 연결 설정 — 우선순위: env(.env) > 관리자 저장값(sp_config) > 기본값 ──────
// 운영은 .env 파일 관리 권장(키가 DB 에 남지 않음). env 가 잡혀 있으면 관리자 화면
// 저장값은 무시되며, 화면에는 fromEnv 플래그로 그 사실을 표시한다.

const AI_BASE_URL_KEY = 'ai_base_url';
const AI_API_KEY_KEY = 'ai_api_key';
export const AI_DEFAULT_BASE_URL = 'http://127.0.0.1:11434'; // 로컬 데몬(클라우드 프록시)

const envOrNull = (name: string): string | null => {
  const v = process.env[name]?.trim();
  return v !== undefined && v !== '' ? v : null;
};

export interface AiConnectionInfo {
  baseUrl: string;
  apiKey: string | null;
  baseUrlFromEnv: boolean;
  apiKeyFromEnv: boolean;
}

export async function getAiConnection(): Promise<AiConnectionInfo> {
  const envBaseUrl = envOrNull('AI_BASE_URL');
  const envApiKey = envOrNull('AI_API_KEY');
  const rows = await prisma.spConfig.findMany({
    where: { key: { in: [AI_BASE_URL_KEY, AI_API_KEY_KEY] } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    baseUrl: envBaseUrl ?? map.get(AI_BASE_URL_KEY) ?? AI_DEFAULT_BASE_URL,
    apiKey: envApiKey ?? map.get(AI_API_KEY_KEY) ?? null,
    baseUrlFromEnv: envBaseUrl !== null,
    apiKeyFromEnv: envApiKey !== null,
  };
}

export async function setAiConnection(patch: {
  baseUrl?: string | undefined;
  apiKey?: string | null | undefined; // null=삭제, undefined=유지
}): Promise<void> {
  if (patch.baseUrl !== undefined) {
    await prisma.spConfig.upsert({
      where: { key: AI_BASE_URL_KEY },
      create: { key: AI_BASE_URL_KEY, value: patch.baseUrl },
      update: { value: patch.baseUrl },
    });
  }
  if (patch.apiKey !== undefined) {
    if (patch.apiKey === null) {
      await prisma.spConfig.deleteMany({ where: { key: AI_API_KEY_KEY } });
    } else {
      await prisma.spConfig.upsert({
        where: { key: AI_API_KEY_KEY },
        create: { key: AI_API_KEY_KEY, value: patch.apiKey },
        update: { value: patch.apiKey },
      });
    }
  }
}

// 마스킹 — 원문은 어떤 응답에도 싣지 않는다.
export const maskApiKey = (key: string | null): string | null =>
  key === null || key === '' ? null : `****${key.slice(-4)}`;

// ── 유스케이스 행 lazy 보장 + 조회 ──────────────────────────────────────────

// 레지스트리에 있는데 DB 에 없는 행을 기본값(비활성)으로 생성 — 마이그레이션에 INSERT 를
// 두지 않아 기본 프롬프트 정본이 코드 한 곳(이 파일)에 유지된다.
export async function ensureAiUsecaseRows(): Promise<void> {
  const existing = await prisma.spAiUsecase.findMany({ select: { useCase: true } });
  const have = new Set(existing.map((r) => r.useCase));
  for (const key of AI_USECASES) {
    if (have.has(key)) continue;
    const def = AI_USECASE_DEFS[key];
    await prisma.spAiUsecase.create({
      data: { useCase: key, enabled: false, model: def.defaultModel, promptTemplate: def.defaultPrompt },
    });
  }
}

export async function getAiUsecase(key: AiUsecaseKeyType) {
  await ensureAiUsecaseRows();
  return prisma.spAiUsecase.findUnique({ where: { useCase: key } });
}
