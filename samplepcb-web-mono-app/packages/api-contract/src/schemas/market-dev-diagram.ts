import { z } from 'zod';

// ── 정밀 시스템 구성도 (docs/AI_DEV_REVIEW.md §13.5, 2026-09-04) ────────────────
// 재능마켓 의뢰의 AI 산출물 2(비동기). 프로빙(§12.11·kimi-k3 thinking high, 566초)에서 확인한
// "설계자 수준 블록도 + 검토 섹션" HTML 을 의뢰 **등록 뒤** 백그라운드 잡으로 만든다. 위저드는
// 기다리지 않는다 — 검토서(3열 카드 구성도)가 즉시 자리를 채우고, 정밀 구성도는 완성되면 상세에
// 붙고 의뢰인에게 메일이 간다. 본문 HTML 은 sp_market_project.devDiagramHtml(살균 뒤), 이 메타는
// devDiagram(Json). 화면은 sandbox iframe 으로만 렌더한다(LLM 문자열을 v-html 로 흘리지 않는다).

export const DEV_DIAGRAM_VERSION = 1 as const;

// queued → running → done | error. skipped = 게이트(자료 부족)에 걸려 시도하지 않음(관리자가 수동 생성 가능).
export const MARKET_DEV_DIAGRAM_STATUSES = ['queued', 'running', 'done', 'error', 'skipped'] as const;
export const MarketDevDiagramStatus = z.enum(MARKET_DEV_DIAGRAM_STATUSES);
export type MarketDevDiagramStatusType = z.infer<typeof MarketDevDiagramStatus>;

export const MARKET_DEV_DIAGRAM_STATUS_LABELS = {
  queued: '생성 대기',
  running: '생성 중',
  done: '완성',
  error: '생성 실패',
  skipped: '자료 부족으로 생략',
} as const satisfies Record<MarketDevDiagramStatusType, string>;

// 출력 감사 — 프로빙 text-audit 를 그대로 옮겼다. 자료 밖 수치·품번(R2)은 검토서와 같은 함수로 잰다.
export const MarketDevDiagramAudit = z.object({
  svgCount: z.number().int(),
  sectionCount: z.number().int(), // 도면 뒤 검토 섹션(h2/h3) 수
  strippedNodes: z.number().int(), // 살균으로 제거한 script·foreignObject·이벤트 속성 수
  ungroundedTokens: z.array(z.string().max(40)).max(30), // 자료에 없는 수치·품번(제거하지 않고 기록 — 전문가가 본다)
  requiredMissing: z.array(z.string().max(40)).max(20), // 자료의 핵심 용어 중 도면에 없는 것
});
export type MarketDevDiagramAuditType = z.infer<typeof MarketDevDiagramAudit>;

export const MarketDevDiagram = z.object({
  version: z.literal(DEV_DIAGRAM_VERSION),
  status: MarketDevDiagramStatus,
  jobId: z.string().nullable(),
  model: z.string(),
  promptVersion: z.string(),
  think: z.string(), // 'high' 등 effort 단계(프로빙 결정값) — 실행 기록
  requestedAt: z.string(), // ISO
  generatedAt: z.string().nullable(), // ISO — done 일 때
  elapsedSecs: z.number().nullable(),
  attempt: z.number().int(), // 1부터. 재생성마다 +1
  audit: MarketDevDiagramAudit.nullable(),
  error: z.string().max(100).nullable(),
  skipReason: z.string().max(200).nullable(),
  corpusChars: z.number().int(), // 게이트 판정 근거(설명+답변+첨부 텍스트 길이)
});
export type MarketDevDiagramType = z.infer<typeof MarketDevDiagram>;

// 상세 응답에 싣는 형태 — 본문은 done 일 때만, 공개 범위는 검토서와 같다(설명을 볼 수 있는 뷰어 전원).
export const MarketDevDiagramView = z.object({
  meta: MarketDevDiagram.nullable(),
  html: z.string().nullable(),
});
export type MarketDevDiagramViewType = z.infer<typeof MarketDevDiagramView>;

// 잡 결과(sp_ai_job.resultJson) — 메타 + 살균 HTML. 프로젝트에 연결되면 컬럼으로 복사된다.
export const DevDiagramJobResult = z.object({
  meta: MarketDevDiagram,
  html: z.string(),
});
export type DevDiagramJobResultType = z.infer<typeof DevDiagramJobResult>;

// 내 구성도 진행 목록(플로팅 위젯, §13.7) — 진행 중 + 최근 24시간 완료·실패·생략. 소유자 전용.
export const MyDevDiagramItem = z.object({
  projectId: z.number(),
  title: z.string(),
  meta: MarketDevDiagram,
});
export type MyDevDiagramItemType = z.infer<typeof MyDevDiagramItem>;
export const MyDevDiagramsResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(MyDevDiagramItem) }),
});
export type MyDevDiagramsResponseType = z.infer<typeof MyDevDiagramsResponse>;

// (재)생성 요청 응답 — POST /market/projects/:id/dev-diagram · /admin/market/projects/:id/dev-diagram.
export const DevDiagramRequestResponse = z.object({
  result: z.literal(true),
  data: z.object({ projectId: z.number(), status: MarketDevDiagramStatus }),
});
export type DevDiagramRequestResponseType = z.infer<typeof DevDiagramRequestResponse>;

export const DEV_DIAGRAM_DISCLAIMER =
  '고객 자료만으로 AI 가 그린 기술 검토 초안입니다. 인터페이스·부품은 전문가 검토 후 확정되며, 자료에 없는 것은 TBD 로 남겼습니다.';
