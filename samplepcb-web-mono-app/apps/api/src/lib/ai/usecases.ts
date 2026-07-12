import type { z } from 'zod';
import {
  AI_USECASES,
  AiDiagramRunBody,
  MARKET_SERVICE_AREA_LABELS,
} from '@sp/api-contract';
import type { AiUsecaseKeyType } from '@sp/api-contract';
import { prisma } from '../prisma';

// ── AI 유스케이스 레지스트리 ─────────────────────────────────────────────────
// 라우트(/api/ai/:useCase/run)는 범용이되, 정책(입력 스키마·프롬프트 바인딩·기본값)은
// 여기서 유스케이스별로 명시한다. 새 유스케이스 = 계약 AI_USECASES + 이 레지스트리에
// def 추가(설정 행은 lazy 생성이라 마이그레이션 불요).

export interface AiUsecaseDef {
  defaultModel: string;
  defaultPrompt: string;
  inputSchema: z.ZodTypeAny;
  // 검증 통과한 입력을 관리자 프롬프트 템플릿({{변수}})에 바인딩.
  buildPrompt: (template: string, input: unknown) => string;
}

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
