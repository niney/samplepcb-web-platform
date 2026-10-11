import { PCB_EQ_AI_FAIL_REASONS, PcbEqAiFlag, PcbEqDraft, asPcbEqFileType, orderPcbEqFiles } from '@sp/api-contract';
import type {
  PcbEqAiFailReasonType,
  PcbEqAiFlagType,
  PcbEqAiStateType,
  PcbEqDraftType,
  PcbPoEqAiSummaryType,
} from '@sp/api-contract';
import { PCB_EQ_PARSE_USECASE, getAiUsecaseRuntime } from './ai/usecases';
import type { EqAiApplySkip } from './pcb-eq-review';
import { prisma } from './prisma';

// ── D20 P2 — EQ AI 분석 잡의 **읽기 면** ─────────────────────────────────────
// 정본 docs/PCB_PARTNER_TRACK.md 「D20 P2 설계」. 잡은 sp_ai_job(useCase pcb.eq-parse, target = 발주서)에
// 산다. 돌리는 쪽은 lib/ai/pcb-eq-runner.ts 이고, 여기는 잡 행을 화면이 읽는 모양(PcbEqAiState·행 요약)으로
// 바꾸는 일만 한다 — 발주 목록(pcb-po.ts)이 엑셀 추출기까지 끌어오지 않게 러너와 갈라 둔다.

export const EQ_AI_TARGET_TYPE = 'pcb_po';

/** 분석을 건 계기 — auto=승인요청 때 자동 · manual=관리자가 [AI 분석]. */
export type EqAiTrigger = 'auto' | 'manual';

/** 분석은 됐는데 초안에 안 들어간 사유(잡은 done). 화면은 [AI 결과를 초안에 적용]을 낸다. */
export type EqAiSkipReason = EqAiApplySkip;

/**
 * 잡 resultJson(이 유스케이스 전용 모양 — lib/ai/jobs.ts 의 toAiJob 은 읽지 않는다).
 *
 * **그림 바이트는 싣지 않는다.** EQ 그림은 장당 수 MB 까지 가서 base64 로 실으면 MEDIUMTEXT(16MB)를 넘고,
 * 파일 서버에 미리 올려 두면 초안에 안 들어간 결과의 그림이 주인 없는 파일로 남는다. 대신 **LLM 원출력**
 * (`responses`)을 남긴다 — 같은 파일에 이 출력을 다시 먹이면 추출·사후 검사가 결정적이라 초안·표시·그림이
 * 그대로 다시 나온다(재사용·[AI 결과를 초안에 적용]이 LLM 을 다시 부르지 않는다).
 */
export interface EqAiJobMeta {
  v: 1;
  trigger: EqAiTrigger;
  sourceFileId: number;
  sourceFileName: string;
  /** 열린 초안이 있으면 그 문항을 바꿔도 되는가 — 분석이 도는 중에 관리자가 눌러 올릴 수 있다. */
  replaceDraft: boolean;
  /** 누른 관리자(수동) — 초안 이벤트에 남긴다. */
  actorMbId: string | null;
  /** 실패 사유의 덧말(파일명·오류 한 줄). */
  detail: string | null;
  appliedReviewId: number | null;
  skipped: EqAiSkipReason | null;
  /** LLM 원출력(부른 순서대로) — 재생용. */
  responses: string[];
  /** 분석 결과 사본(감사·디버깅용 — 적용은 재생으로 한다). */
  draft: PcbEqDraftType | null;
  itemFlags: PcbEqAiFlagType[][];
  warnings: string[];
  promptChars: number | null;
}

export const newEqAiJobMeta = (
  init: Pick<EqAiJobMeta, 'trigger' | 'sourceFileId' | 'sourceFileName' | 'replaceDraft' | 'actorMbId'>,
): EqAiJobMeta => ({
  v: 1,
  ...init,
  detail: null,
  appliedReviewId: null,
  skipped: null,
  responses: [],
  draft: null,
  itemFlags: [],
  warnings: [],
  promptChars: null,
});

const SKIP_REASONS: readonly EqAiSkipReason[] = ['PO_NOT_FOUND', 'NOT_EQ_REQUESTED', 'DRAFT_EXISTS', 'ALREADY_OPEN'];

/** resultJson → 메타. 깨졌거나 옛 모양이면 빈 메타(자동·미적용)로 읽는다 — 조회가 500 으로 죽지 않게. */
export const parseEqAiJobMeta = (json: string | null): EqAiJobMeta => {
  const empty = newEqAiJobMeta({
    trigger: 'auto',
    sourceFileId: 0,
    sourceFileName: '',
    replaceDraft: false,
    actorMbId: null,
  });
  if (json === null) return empty;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return empty;
  }
  if (typeof raw !== 'object' || raw === null) return empty;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const draft = PcbEqDraft.safeParse(r.draft);
  return {
    v: 1,
    trigger: r.trigger === 'manual' ? 'manual' : 'auto',
    sourceFileId: num(r.sourceFileId) ?? 0,
    sourceFileName: str(r.sourceFileName) ?? '',
    replaceDraft: r.replaceDraft === true,
    actorMbId: str(r.actorMbId),
    detail: str(r.detail),
    appliedReviewId: num(r.appliedReviewId),
    skipped: SKIP_REASONS.find((s) => s === r.skipped) ?? null,
    responses: Array.isArray(r.responses) ? r.responses.filter((v): v is string => typeof v === 'string') : [],
    draft: draft.success ? draft.data : null,
    itemFlags: Array.isArray(r.itemFlags)
      ? r.itemFlags.map((flags) =>
          Array.isArray(flags)
            ? flags.flatMap((f) => {
                const parsed = PcbEqAiFlag.safeParse(f);
                return parsed.success ? [parsed.data] : [];
              })
            : [],
        )
      : [],
    warnings: Array.isArray(r.warnings) ? r.warnings.filter((v): v is string => typeof v === 'string') : [],
    promptChars: num(r.promptChars),
  };
};

const asFailReason = (v: string | null): PcbEqAiFailReasonType =>
  PCB_EQ_AI_FAIL_REASONS.find((r) => r === v) ?? 'llm_failed';

/**
 * 멈춘 잡 판정 문턱. 러너는 전체 예산을 `timeout × 2` 로 묶어 돈다(재시도 포함) — 그보다 30초 넘게 running 이면
 * 프로세스가 재시작돼 끊긴 잡이다. 읽을 때 `llm_failed` 로 본다(행은 다음 분석 요청이 정리한다).
 */
export const eqAiZombieMs = (timeoutMs: number): number => timeoutMs * 2 + 30_000;

export const ZOMBIE_DETAIL = '분석이 끝나지 않고 멈췄습니다(서버 재시작) — 다시 분석해 주세요.';

interface EqAiJobHead {
  status: string;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** 잡 행 → 화면 상태(running·done·failed). 멈춘 running 은 failed(llm_failed). */
export const eqAiJobStatus = (
  row: EqAiJobHead,
  zombieMs: number,
  now: Date,
): { status: 'running' | 'done' | 'failed'; reason: PcbEqAiFailReasonType | null; zombie: boolean } => {
  if (row.status === 'done') return { status: 'done', reason: null, zombie: false };
  if (row.status === 'error') return { status: 'failed', reason: asFailReason(row.error), zombie: false };
  return now.getTime() - row.startedAt.getTime() > zombieMs
    ? { status: 'failed', reason: 'llm_failed', zombie: true }
    : { status: 'running', reason: null, zombie: false };
};

/** 성공한 분석의 주의 사항 → 화면 덧말 한 줄(여러 건은 ' · ', 300자에서 자른다). 없으면 null. */
export const eqAiWarningDetail = (warnings: readonly string[]): string | null => {
  const joined = warnings
    .map((w) => w.trim())
    .filter((w) => w !== '')
    .join(' · ');
  if (joined === '') return null;
  return joined.length > 300 ? `${joined.slice(0, 299)}…` : joined;
};

export const toEqAiState = (
  row: EqAiJobHead & { id: string; model: string; resultJson: string | null },
  zombieMs: number,
  now: Date = new Date(),
): PcbEqAiStateType => {
  const meta = parseEqAiJobMeta(row.resultJson);
  const { status, reason, zombie } = eqAiJobStatus(row, zombieMs, now);
  return {
    jobId: row.id,
    status,
    trigger: meta.trigger,
    reason,
    // 실패면 사유의 덧말, 성공이면 분석이 남긴 주의(표 규칙엔 있는데 AI 초안에 빠진 문항 등) — 초안이
    // 만들어졌어도 관리자가 알아야 하는 것이라 버리지 않는다.
    detail:
      status === 'failed'
        ? zombie
          ? ZOMBIE_DETAIL
          : meta.detail
        : status === 'done'
          ? eqAiWarningDetail(meta.warnings)
          : null,
    model: row.model,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt === null ? null : row.finishedAt.toISOString(),
    appliedReviewId: status === 'done' ? meta.appliedReviewId : null,
  };
};

/**
 * 분석 대상 = 이 발주서 EQ 첨부 중 **질의서(eq)의 최신 1건** — 화면이 '최신'이라 부르는 바로 그 파일
 * (계약 orderPcbEqFiles: 가장 나중 = fileId). Working 데이터·관리자 회신·좌표파일은 물어볼 원문이 아니다.
 * 종류가 비어 있는 옛 행은 eq 로 읽는다(pcb-po asEqFileType 과 같은 규칙).
 */
export const pickEqSourceFile = <T extends { id: bigint; fileType: string | null; writeDate: Date }>(
  files: readonly T[],
): T | null => {
  const ordered = orderPcbEqFiles(
    files.map((f) => ({
      fileId: Number(f.id),
      fileType: asPcbEqFileType(f.fileType) ?? 'eq',
      uploadedAt: f.writeDate.toISOString(),
    })),
  );
  const latest = ordered.find((f) => f.fileType === 'eq' && f.isLatest);
  return latest === undefined ? null : (files.find((f) => Number(f.id) === latest.fileId) ?? null);
};

/** 유스케이스가 켜져 있는가(설정 > AI 연동) — 관리자 화면 `aiEnabled`. */
export const isEqAiEnabled = async (): Promise<boolean> =>
  (await getAiUsecaseRuntime(PCB_EQ_PARSE_USECASE)).enabled;

/** 멈춘 잡 문턱(ms) — 지금 설정의 타임아웃 기준. */
export const loadEqAiZombieMs = async (): Promise<number> =>
  eqAiZombieMs((await getAiUsecaseRuntime(PCB_EQ_PARSE_USECASE)).timeoutMs);

/**
 * 발주서의 **이번 승인요청**에 대한 최신 분석 상태. `since` = 마지막으로 승인요청에 들어선 시각
 * (pcb-po eqRoundStartOf) — 반려 뒤 다시 올라오면 지난 요청의 분석은 이력일 뿐이다. null 이면 전 이력.
 */
export const loadEqAiState = async (poId: bigint, since: Date | null): Promise<PcbEqAiStateType | null> => {
  const row = await prisma.spAiJob.findFirst({
    where: {
      useCase: PCB_EQ_PARSE_USECASE,
      targetType: EQ_AI_TARGET_TYPE,
      targetId: poId,
      ...(since === null ? {} : { startedAt: { gte: since } }),
    },
    orderBy: { startedAt: 'desc' },
  });
  if (row === null) return null;
  return toEqAiState(row, await loadEqAiZombieMs());
};

/**
 * 발주 행·워크큐의 AI 요약 — **분석 중이거나 안 됐을 때만**(됐으면 회차 요약의 aiDraft 가 말한다).
 * 승인요청 상태인 발주서만, 이번 승인요청 뒤의 최신 잡만 본다. 결과 본문(resultJson, MEDIUMTEXT)은 읽지
 * 않는다 — 목록 한 번에 쿼리 하나(running 이 있을 때만 타임아웃 설정을 한 번 더 읽는다).
 */
export const loadEqAiRowSummaries = async (
  pos: readonly { id: bigint; status: string; roundStart: Date | null }[],
): Promise<Map<string, PcbPoEqAiSummaryType>> => {
  const out = new Map<string, PcbPoEqAiSummaryType>();
  const targets = pos.filter((p) => p.status === 'eq_requested');
  if (targets.length === 0) return out;
  const rows = await prisma.spAiJob.findMany({
    where: {
      useCase: PCB_EQ_PARSE_USECASE,
      targetType: EQ_AI_TARGET_TYPE,
      targetId: { in: targets.map((p) => p.id) },
    },
    orderBy: { startedAt: 'desc' },
    select: { targetId: true, status: true, error: true, startedAt: true, finishedAt: true },
  });
  if (rows.length === 0) return out;
  const roundStart = new Map(targets.map((p) => [p.id.toString(), p.roundStart]));
  const zombieMs = rows.some((r) => r.status === 'running') ? await loadEqAiZombieMs() : 0;
  const now = new Date();
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.targetId === null) continue;
    const key = row.targetId.toString();
    if (seen.has(key)) continue; // startedAt desc — 발주서별 첫 행이 최신
    const since = roundStart.get(key) ?? null;
    if (since !== null && row.startedAt < since) continue; // 지난 승인요청의 분석
    seen.add(key);
    const { status, reason } = eqAiJobStatus(row, zombieMs, now);
    if (status === 'done') continue;
    out.set(key, {
      status,
      reason,
      at: (status === 'failed' ? (row.finishedAt ?? row.startedAt) : row.startedAt).toISOString(),
    });
  }
  return out;
};
