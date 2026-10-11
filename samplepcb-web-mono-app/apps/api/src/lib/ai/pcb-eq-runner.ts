import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { resolvePcbPoTrack } from '@sp/api-contract';
import type { PcbEqAiStateType } from '@sp/api-contract';
import { downloadFromFileServer, uploadToFileServer } from '../file-server';
import {
  EQ_AI_TARGET_TYPE,
  ZOMBIE_DETAIL,
  eqAiZombieMs,
  newEqAiJobMeta,
  parseEqAiJobMeta,
  pickEqSourceFile,
  toEqAiState,
  type EqAiJobMeta,
  type EqAiSkipReason,
  type EqAiTrigger,
} from '../pcb-eq-ai';
import { analyzeEqFile, type EqAnalyzeResult, type EqChat } from '../pcb-eq-extract/analyze';
import {
  PCB_EQ_OPEN_STATUSES,
  applyEqAiDraft,
  deleteUnsharedEqFigureBlobs,
  type EqAiDraftFigure,
} from '../pcb-eq-review';
import { prisma } from '../prisma';
import { hashAiBytes, hashAiInput } from './hash';
import type { OllamaChatExtra } from './ollama';
import { chatWithOptionFallback } from './runner';
import {
  PCB_EQ_PARSE_USECASE,
  getAiConnection,
  getAiUsecaseRuntime,
  toOllamaThink,
  type AiUsecaseRuntime,
} from './usecases';

// ── PCB EQ AI 분석 러너(D20 P2) — docs/PCB_PARTNER_TRACK.md 「D20 P2 설계」 ────────────────
// 협력사가 [승인요청]을 누르면(또는 관리자가 [AI 분석]) 발주서의 최신 EQ 질의서를 받아 문항 초안을 만든다.
//   가드 → 잡(sp_ai_job, target = 발주서) → [백그라운드] 내려받은 파일 분석(lib/pcb-eq-extract/analyze — 추출·LLM·
//   결정적 사후 검사) → 열린 회차가 없으면 초안으로 써 넣기(pcb-eq-review applyEqAiDraft — 개정 대조 포함)
// 자동은 **초안까지**다(P2-2). 고객 발송은 관리자가 검토한 뒤다.
//
// ⚠ 이 러너는 승인요청 전이에 **매달려 돈다** — 어떤 실패도 전이·요청을 실패시키지 않는다(autoStartEqAnalysis).
//   분석이 안 되면 잡이 사유(error = 계약 PCB_EQ_AI_FAIL_REASONS)를 남기고 화면이 칩·배너로 알릴 뿐이다(P2-3).

const EQ_REF_TYPE = 'sp_pcb_po_eq';
const EQ_UPLOAD_SERVICE_TYPE = 'pcb_eq';
/** 같은 파일·같은 설정의 완료 결과를 다시 쓰는 창 — 다른 유스케이스와 같은 1시간(jobs.ts REUSE_WINDOW_MS). */
const REUSE_WINDOW_MS = 60 * 60 * 1000;
/** 전송 실패 뒤 다시 부를 만한 최소 잔여 시간 — 이보다 적으면 재시도해도 또 시간 초과다. */
const MIN_RETRY_MS = 10_000;

type AiRunLogger = Pick<FastifyBaseLogger, 'info' | 'warn'>;

export type EqAnalysisError =
  | 'PO_NOT_FOUND'
  | 'NOT_EQ_REQUESTED'
  | 'NOT_EQ_TRACK'
  | 'AI_DISABLED'
  | 'ALREADY_OPEN'
  | 'DRAFT_EXISTS'
  | 'NO_SOURCE';

/** 수동 요청(관리자 라우트)의 오류 → HTTP·문구. 자동은 이 사유들로 **조용히 건너뛴다**(잡도 칩도 없다). */
export const EQ_ANALYSIS_ERRORS: Record<EqAnalysisError, { code: 404 | 409; message: string }> = {
  PO_NOT_FOUND: { code: 404, message: '발주서를 찾을 수 없습니다.' },
  NOT_EQ_REQUESTED: { code: 409, message: 'EQ 승인요청 상태에서만 AI 분석을 할 수 있습니다.' },
  NOT_EQ_TRACK: { code: 409, message: 'EQ 질의가 없는 발주(메탈마스크)라 AI 분석 대상이 아닙니다.' },
  AI_DISABLED: {
    code: 409,
    message: 'AI 분석이 꺼져 있습니다 — 설정 > AI 연동에서 "PCB EQ 분석"을 켜 주세요.',
  },
  ALREADY_OPEN: {
    code: 409,
    message: '이미 고객에게 보낸 확인 요청이 열려 있습니다 — 회신을 받거나 요청을 취소한 뒤 분석해 주세요.',
  },
  DRAFT_EXISTS: {
    code: 409,
    message: '작성 중인 초안이 있습니다 — AI 결과로 문항을 바꾸려면 [AI 결과를 초안에 적용]을 눌러 주세요.',
  },
  NO_SOURCE: { code: 409, message: '분석할 EQ 질의서 첨부가 없습니다.' },
};

export interface StartEqAnalysisOptions {
  /** auto=승인요청 전이에 매달린 자동 분석 · manual=관리자 [AI 분석]. */
  trigger: EqAiTrigger;
  /** 수동이면 누른 관리자. 자동은 null(잡 소유자 'system'). */
  actorMbId: string | null;
  /** 열린 초안이 있으면 그 문항을 AI 결과로 통째 바꾼다. 자동은 늘 false(관리자가 쓰던 초안을 덮지 않는다). */
  replaceDraft: boolean;
  log: AiRunLogger;
}

export type StartEqAnalysisResult =
  | {
      ok: true;
      state: PcbEqAiStateType;
      /** 백그라운드 분석이 끝나면 풀린다(거절되지 않는다) — 테스트·스크립트용. 라우트는 기다리지 않는다. */
      settled: Promise<void>;
    }
  | { ok: false; error: EqAnalysisError };

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const clip = (s: string, n = 300): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const targetWhere = (poId: bigint) =>
  ({ useCase: PCB_EQ_PARSE_USECASE, targetType: EQ_AI_TARGET_TYPE, targetId: poId }) as const;

/** 잡 끝내기 — running 일 때만(이미 다른 경로가 닫았으면 건드리지 않는다). error = 계약 실패 사유 코드. */
const finishEqJob = async (
  jobId: string,
  meta: EqAiJobMeta,
  error: string | null,
): Promise<void> => {
  await prisma.spAiJob.updateMany({
    where: { id: jobId, status: 'running' },
    data: {
      status: error === null ? 'done' : 'error',
      stage: null,
      error,
      resultJson: JSON.stringify(meta),
      finishedAt: new Date(),
    },
  });
};

/**
 * EQ AI 분석 시작. 가드를 통과하면 잡을 만들고(또는 이미 도는 잡을 돌려주고) 분석은 백그라운드로 돈다.
 *
 * 가드(자동은 여기서 걸리면 잡을 만들지 않는다 — 물어볼 것이 없거나 쓰지 않기로 한 것이다):
 *  발주 `eq_requested` · EQ 트랙(스텐실 제외) · 유스케이스 켜짐 · EQ 질의서 첨부 있음.
 *  수동은 더해서 — 이미 발송한 회차가 열려 있으면 `ALREADY_OPEN`, 초안이 있는데 replaceDraft 가 아니면 `DRAFT_EXISTS`.
 */
export async function startEqAnalysis(
  poId: bigint,
  options: StartEqAnalysisOptions,
): Promise<StartEqAnalysisResult> {
  const { trigger, replaceDraft, actorMbId, log } = options;
  const po = await prisma.spPcbPo.findUnique({
    where: { id: poId },
    select: { status: true, spec: { select: { category: true } } },
  });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  if (po.status !== 'eq_requested') return { ok: false, error: 'NOT_EQ_REQUESTED' };
  if (resolvePcbPoTrack(po.spec.category) !== 'eq') return { ok: false, error: 'NOT_EQ_TRACK' };
  const runtime = await getAiUsecaseRuntime(PCB_EQ_PARSE_USECASE);
  if (!runtime.enabled) return { ok: false, error: 'AI_DISABLED' };

  if (trigger === 'manual') {
    const open = await prisma.spPcbEqReview.findFirst({
      where: { poId, status: { in: [...PCB_EQ_OPEN_STATUSES] } },
      select: { status: true },
    });
    if (open !== null && open.status !== 'draft') return { ok: false, error: 'ALREADY_OPEN' };
    if (open !== null && !replaceDraft) return { ok: false, error: 'DRAFT_EXISTS' };
  }

  const files = await prisma.spFile.findMany({
    where: { refType: EQ_REF_TYPE, refId: poId },
    select: { id: true, fileType: true, writeDate: true, originFileName: true, pathToken: true },
  });
  const source = pickEqSourceFile(files);
  if (source === null) return { ok: false, error: 'NO_SOURCE' };

  // 멈춘 잡(프로세스 재시작으로 끊긴 running)은 여기서 닫는다 — 안 닫으면 "이미 도는 잡"으로 영영 남는다.
  const zombieMs = eqAiZombieMs(runtime.timeoutMs);
  const stuck = await prisma.spAiJob.findMany({
    where: { ...targetWhere(poId), status: 'running', startedAt: { lt: new Date(Date.now() - zombieMs) } },
    select: { id: true, resultJson: true },
  });
  for (const row of stuck) {
    await finishEqJob(row.id, { ...parseEqAiJobMeta(row.resultJson), detail: ZOMBIE_DETAIL }, 'llm_failed');
  }
  // 이미 도는 잡이 있으면 새로 만들지 않고 그것을 돌려준다(연타·자동과 수동의 겹침).
  const running = await prisma.spAiJob.findFirst({
    where: { ...targetWhere(poId), status: 'running' },
    orderBy: { startedAt: 'desc' },
  });
  if (running !== null) return { ok: true, state: await joinRunningJob(running, options, zombieMs), settled: Promise.resolve() };

  // 파일을 먼저 받는다 — 내용 해시가 있어야 "같은 입력"을 알아본다.
  let buf: Buffer | null = null;
  let downloadError: string | null = null;
  try {
    buf = (await downloadFromFileServer(source.pathToken))?.buffer ?? null;
  } catch (err) {
    downloadError = errText(err);
  }
  const inputHash = hashAiInput({
    file: buf === null ? `missing:${source.id.toString()}` : hashAiBytes(buf),
    model: runtime.model,
    think: runtime.think,
    extra: runtime.extraInstructions,
  });
  const jobSource = { model: runtime.model, promptVersion: runtime.def.promptVersion, inputHash };
  const cachedResponses = buf === null ? null : await findReusableResponses(poId, jobSource);

  const meta = newEqAiJobMeta({
    trigger,
    sourceFileId: Number(source.id),
    sourceFileName: source.originFileName,
    replaceDraft,
    actorMbId,
  });
  // 발주서 행을 잡고 한 번 더 본다 — "확인 → 생성" 사이가 비면 동시 요청 둘이 각자 잡을 만든다.
  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM sp_pcb_po WHERE id = ${poId} FOR UPDATE`;
    const again = await tx.spAiJob.findFirst({
      where: { ...targetWhere(poId), status: 'running' },
      orderBy: { startedAt: 'desc' },
    });
    if (again !== null) return { row: again, existing: true };
    const row = await tx.spAiJob.create({
      data: {
        id: randomUUID(),
        ...targetWhere(poId),
        mbId: actorMbId ?? 'system',
        status: 'running',
        stage: 'eqparse',
        ...jobSource,
        resultJson: JSON.stringify(meta),
        startedAt: new Date(),
      },
    });
    return { row, existing: false };
  });
  if (created.existing) {
    return { ok: true, state: await joinRunningJob(created.row, options, zombieMs), settled: Promise.resolve() };
  }
  const job = created.row;

  if (buf === null) {
    // 파일 서버가 파일을 못 준다 — 없으면(404) 읽을 수 없는 파일, 그 밖(순단)은 잠시 뒤 다시 해 볼 일이다.
    const failed: EqAiJobMeta = {
      ...meta,
      detail: clip(
        downloadError === null
          ? `${source.originFileName}: 파일 서버에 파일이 없습니다`
          : `${source.originFileName}: 파일을 받지 못했습니다(${downloadError})`,
      ),
    };
    const reason = downloadError === null ? 'unreadable' : 'llm_failed';
    await finishEqJob(job.id, failed, reason);
    log.warn({ jobId: job.id, poId: poId.toString(), reason, downloadError }, 'eq ai source download failed');
    return {
      ok: true,
      state: toEqAiState(
        { ...job, status: 'error', error: reason, finishedAt: new Date(), resultJson: JSON.stringify(failed) },
        zombieMs,
      ),
      settled: Promise.resolve(),
    };
  }

  const settled = runEqJob({
    jobId: job.id,
    poId,
    buf,
    sourceFileId: source.id,
    fileName: source.originFileName,
    runtime,
    meta,
    cachedResponses,
    log,
  }).catch(async (err: unknown) => {
    log.warn({ err, jobId: job.id, poId: poId.toString() }, 'eq ai analysis failed');
    try {
      await finishEqJob(job.id, { ...meta, detail: clip(`분석 중 오류: ${errText(err)}`) }, 'llm_failed');
    } catch (finishErr) {
      // 실패 원인이 DB 순단이면 이 기록도 같이 실패한다 — 놓친 거절로 올리지 않는다(멈춘 잡 판정이 거둔다).
      log.warn({ err: finishErr, jobId: job.id }, 'eq ai job failure could not be recorded');
    }
  });

  log.info(
    { jobId: job.id, poId: poId.toString(), trigger, model: runtime.model, file: source.originFileName, reuse: cachedResponses !== null },
    'eq ai analysis started',
  );
  return { ok: true, state: toEqAiState(job, zombieMs), settled };
}

/**
 * 이미 도는 잡에 합류. 수동 요청이 `replaceDraft` 를 들고 왔으면 그 뜻을 잡에 적어 둔다 — 러너가 써 넣기 직전에
 * 다시 읽는다(자동 분석이 도는 중에 관리자가 [AI 결과를 초안에 적용]을 누른 경우, 끝나자마자 적용되게).
 */
const joinRunningJob = async (
  row: { id: string; status: string; error: string | null; model: string; startedAt: Date; finishedAt: Date | null; resultJson: string | null },
  options: StartEqAnalysisOptions,
  zombieMs: number,
): Promise<PcbEqAiStateType> => {
  if (options.trigger === 'manual' && options.replaceDraft) {
    const meta = parseEqAiJobMeta(row.resultJson);
    if (!meta.replaceDraft) {
      await prisma.spAiJob.updateMany({
        where: { id: row.id, status: 'running' },
        data: { resultJson: JSON.stringify({ ...meta, replaceDraft: true, actorMbId: options.actorMbId }) },
      });
    }
  }
  return toEqAiState(row, zombieMs);
};

/** 같은 발주서·같은 파일·같은 설정의 완료 결과(1시간 안) — LLM 원출력을 돌려준다(없으면 null). */
const findReusableResponses = async (
  poId: bigint,
  source: { model: string; promptVersion: string; inputHash: string },
): Promise<string[] | null> => {
  const row = await prisma.spAiJob.findFirst({
    where: {
      ...targetWhere(poId),
      ...source,
      status: 'done',
      startedAt: { gte: new Date(Date.now() - REUSE_WINDOW_MS) },
    },
    orderBy: { startedAt: 'desc' },
    select: { resultJson: true },
  });
  if (row === null) return null;
  const { responses } = parseEqAiJobMeta(row.resultJson);
  return responses.length === 0 ? null : responses;
};

interface RunEqJobContext {
  jobId: string;
  poId: bigint;
  buf: Buffer;
  sourceFileId: bigint;
  fileName: string;
  runtime: AiUsecaseRuntime;
  meta: EqAiJobMeta;
  /** 같은 입력의 이전 LLM 출력 — 있으면 LLM 을 부르지 않고 이것을 다시 먹인다. */
  cachedResponses: string[] | null;
  log: AiRunLogger;
}

/**
 * 전송 실패를 한 번 더 불러 볼 만한가. 응답을 못 받았거나(시간 초과·연결 끊김) 서버 쪽 사정(5xx·429·408)이면
 * 그렇다. 인증·요청 오류(401·403·400 등)는 다시 불러도 같은 답이라 바로 실패로 둔다.
 */
export const isRetryableChatError = (err: unknown): boolean => {
  const status = /HTTP (\d{3})/.exec(errText(err))?.[1];
  if (status === undefined) return true;
  const code = Number(status);
  return code >= 500 || code === 429 || code === 408;
};

/**
 * 분석 실행 — LLM 은 analyze 가 부르는 `chat` 하나로만 닿는다.
 *  · 재사용: 이전 출력을 순서대로 돌려주는 chat 을 준다(추출·사후 검사가 결정적이라 결과가 그대로 나온다).
 *    코드가 바뀌어 재생이 안 맞으면 실제 호출로 넘어간다.
 *  · 실제 호출: 역할이 갈린다 — **출력이 계약을 못 넘으면 analyze 가 한 번 더 부르고**(chat 최대 2번),
 *    **전송 실패(시간 초과·5xx·429)는 여기 chat 이 한 번 더 부른다**(프로빙 §7.1 — 120초 + 재시도 1회).
 *    analyze 는 chat 이 던지면 다시 부르지 않고 llm_failed 로 끝낸다.
 *  · **전체 예산은 timeout × 2** 로 묶는다 — 호출마다 남은 시간만큼만 기다리고, 예산이 바닥나면 던진다.
 *    멈춘 잡 판정(eqAiZombieMs)이 이 상한을 믿는다.
 */
const analyzeWithPolicy = async (
  ctx: RunEqJobContext,
): Promise<{ result: EqAnalyzeResult; responses: string[]; replayed: boolean }> => {
  const { runtime, log } = ctx;
  const input = {
    buf: ctx.buf,
    fileName: ctx.fileName,
    ...(runtime.extraInstructions === '' ? {} : { extraInstructions: runtime.extraInstructions }),
  };
  if (ctx.cachedResponses !== null) {
    const queue = [...ctx.cachedResponses];
    const replay: EqChat = () => {
      const next = queue.shift();
      return next === undefined
        ? Promise.reject(new Error('재생할 AI 출력이 없습니다'))
        : Promise.resolve(next);
    };
    const replayed = await analyzeEqFile(input, replay);
    if (replayed.ok) return { result: replayed, responses: ctx.cachedResponses, replayed: true };
    log.warn({ jobId: ctx.jobId, reason: replayed.reason }, 'eq ai replay did not reproduce — calling the model');
  }

  const conn = await getAiConnection();
  const deadline = Date.now() + runtime.timeoutMs * 2;
  const recorded: string[] = [];
  const callModel = async (prompt: string, jsonSchema: unknown): Promise<string> => {
    const remaining = deadline - Date.now();
    if (remaining < 1_000) throw new Error('시간 초과(분석 예산 소진)');
    const extra: OllamaChatExtra = {
      think: toOllamaThink(runtime.think),
      ...(isRecord(jsonSchema) ? { format: jsonSchema } : {}),
      ...(runtime.def.temperature === undefined ? {} : { temperature: runtime.def.temperature }),
      ...(runtime.def.seed === undefined ? {} : { seed: runtime.def.seed }),
    };
    const res = await chatWithOptionFallback(
      conn, runtime.model, prompt, Math.min(runtime.timeoutMs, remaining), [], extra, log,
    );
    return res.text;
  };
  const chat: EqChat = async (prompt, jsonSchema) => {
    let text: string;
    try {
      text = await callModel(prompt, jsonSchema);
    } catch (err) {
      if (!isRetryableChatError(err) || deadline - Date.now() < MIN_RETRY_MS) throw err;
      log.warn({ jobId: ctx.jobId, err: errText(err).slice(0, 160) }, 'eq ai model call failed — retrying once');
      text = await callModel(prompt, jsonSchema);
    }
    recorded.push(text);
    return text;
  };
  const result = await analyzeEqFile(input, chat);
  return { result, responses: recorded, replayed: false };
};

const runEqJob = async (ctx: RunEqJobContext): Promise<void> => {
  const { jobId, poId, runtime, log } = ctx;
  const startedAt = Date.now();
  const { result, responses, replayed } = await analyzeWithPolicy(ctx);

  if (!result.ok) {
    await finishEqJob(jobId, { ...ctx.meta, detail: result.detail }, result.reason);
    log.warn({ jobId, poId: poId.toString(), reason: result.reason, detail: result.detail }, 'eq ai analysis produced no draft');
    return;
  }

  // 분석이 도는 중에 관리자가 [초안에 적용]을 눌렀을 수 있다 — 잡에 적힌 최신 뜻을 읽는다(joinRunningJob).
  const latest = parseEqAiJobMeta(
    (await prisma.spAiJob.findUnique({ where: { id: jobId }, select: { resultJson: true } }))?.resultJson ?? null,
  );
  const replaceDraft = ctx.meta.replaceDraft || latest.replaceDraft;
  const actorMbId = ctx.meta.actorMbId ?? latest.actorMbId;
  const done: EqAiJobMeta = {
    ...ctx.meta,
    replaceDraft,
    actorMbId,
    responses,
    draft: result.draft,
    itemFlags: result.itemFlags,
    warnings: result.warnings,
    promptChars: result.promptChars,
  };

  // 써 넣지 않을 것이 뻔하면 그림을 올리지 않는다(주인 없는 파일을 만들지 않는다). 확정은 applyEqAiDraft 가
  // 발주서 행을 잡고 다시 한다.
  const open = await prisma.spPcbEqReview.findFirst({
    where: { poId, status: { in: [...PCB_EQ_OPEN_STATUSES] } },
    select: { status: true },
  });
  const skip: EqAiSkipReason | null =
    open === null ? null : open.status !== 'draft' ? 'ALREADY_OPEN' : replaceDraft ? null : 'DRAFT_EXISTS';
  if (skip !== null) {
    await finishEqJob(jobId, { ...done, skipped: skip }, null);
    log.info({ jobId, poId: poId.toString(), skip }, 'eq ai analysis done — not applied');
    return;
  }

  // 그림은 문항이 부른 것만 온다(로고는 analyze 가 버렸다) — 파일 서버에 올리고 초안의 회차 그림이 된다.
  const figures: EqAiDraftFigure[] = [];
  const uploadedTokens = (): string[] => figures.map((f) => f.pathToken);
  let applied: Awaited<ReturnType<typeof applyEqAiDraft>>;
  try {
    for (const img of result.images) {
      const [uploaded] = await uploadToFileServer(
        [{ buffer: img.data, filename: img.name, mimetype: img.mime }],
        EQ_UPLOAD_SERVICE_TYPE,
      );
      if (uploaded === undefined) throw new Error('그림 업로드에 실패했습니다');
      figures.push({
        ref: img.ref,
        uploadFileName: uploaded.uploadFileName,
        pathToken: uploaded.pathToken,
        originFileName: img.name,
        size: img.data.length,
      });
    }
    const noteLines = [
      `${runtime.model} · ${runtime.def.promptVersion} · 문항 ${String(result.draft.items.length)}개` +
        (figures.length === 0 ? '' : ` · 그림 ${String(figures.length)}장`) +
        (replayed ? ' · 같은 파일의 이전 분석 재사용' : ''),
      ...result.warnings.map((w) => `주의: ${w}`),
    ];
    applied = await applyEqAiDraft(poId, {
      replaceDraft,
      sourceFileId: ctx.sourceFileId,
      actorMbId,
      note: clip(noteLines.join('\n'), 1500),
      items: result.draft.items.map((item, i) => ({ ...item, aiFlags: result.itemFlags[i] ?? [] })),
      figures,
    });
  } catch (err) {
    // 올려 둔 그림은 어느 회차에도 안 붙었다 — 거둔다(트랜잭션이 되돌려졌으므로 가리키는 행이 없다).
    await deleteUnsharedEqFigureBlobs(uploadedTokens());
    throw new Error(`초안에 써 넣지 못했습니다: ${errText(err)}`, { cause: err });
  }

  if (!applied.ok) {
    // 그사이 관리자가 초안을 열었거나 EQ 가 움직였다 — 결과는 남기고(재사용) 올린 그림만 거둔다.
    const failedTokens = await deleteUnsharedEqFigureBlobs(uploadedTokens());
    if (failedTokens.length > 0) log.warn({ jobId, failedTokens }, 'eq ai orphan figure cleanup failed');
    await finishEqJob(jobId, { ...done, skipped: applied.reason }, null);
    log.info({ jobId, poId: poId.toString(), skip: applied.reason }, 'eq ai analysis done — not applied');
    return;
  }
  // 초안을 바꿔 끼웠으면 옛 그림 실파일을 거둔다(다른 회차가 같이 쓰는 것은 남는다).
  const failedTokens = await deleteUnsharedEqFigureBlobs(applied.staleTokens);
  if (failedTokens.length > 0) log.warn({ jobId, failedTokens }, 'eq ai stale figure cleanup failed');
  await finishEqJob(jobId, { ...done, appliedReviewId: Number(applied.reviewId) }, null);
  log.info(
    {
      jobId,
      poId: poId.toString(),
      reviewId: applied.reviewId.toString(),
      replaced: applied.replaced,
      replayed,
      items: result.draft.items.length,
      figures: figures.length,
      flagged: result.itemFlags.filter((f) => f.length > 0).length,
      elapsedMs: Date.now() - startedAt,
    },
    'eq ai draft applied',
  );
};

/**
 * 승인요청 전이에 매다는 자동 분석 — **기다리지도, 던지지도 않는다**. 전이가 커밋된 뒤에 부를 것.
 * 가드에 걸리면(꺼짐·스텐실·첨부 없음) 아무 일도 일어나지 않는다.
 */
export function autoStartEqAnalysis(poId: bigint, log: AiRunLogger): void {
  void startEqAnalysis(poId, { trigger: 'auto', actorMbId: null, replaceDraft: false, log }).catch(
    (err: unknown) => {
      log.warn({ err, poId: poId.toString() }, 'eq ai auto analysis could not start');
    },
  );
}
