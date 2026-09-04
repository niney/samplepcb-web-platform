import type { FastifyBaseLogger } from 'fastify';
import type { SpMarketProject } from '@prisma/client';
import { MARKET_ATTACHMENT_FIELD } from '@sp/api-contract';
import type { MarketDevDiagramType } from '@sp/api-contract';
import { downloadFromFileServer } from '../file-server';
import { getMembersByIds } from '../g5-db';
import { REF_MARKET_PROJECT, marketOwnerNames, toAnswers, toAreaCodes, toDevDiagram } from '../market';
import { buildDevDiagramReadyEmail, sendMarketMail } from '../market-email';
import { prisma } from '../prisma';
import { expandAiArchives } from './archive';
import { prepareAiAttachments } from './attachment-extractor';
import {
  DEV_DIAGRAM_PROMPT_VERSION,
  auditDevDiagramHtml,
  buildDevDiagramPrompt,
  devDiagramGate,
  isDevDiagramAcceptable,
  sanitizeDevDiagramHtml,
} from './dev-diagram';
import { devReviewAttachmentHashes } from './dev-review';
import type { DevReviewSource } from './dev-review';
import { createAiJob, findReusableAiJob, finishAiJob, getAiJob, listRunningAiJobs, updateAiJobResult } from './jobs';
import type { AiJob } from './jobs';
import { chatWithOptionFallback } from './runner';
import { DEV_DIAGRAM_USECASE, getAiConnection, getAiUsecaseRuntime, toOllamaThink } from './usecases';

// ── 시스템 구성도 러너 (docs/AI_DEV_REVIEW.md §13.5·§13.7) ─────────────────────────
// 잡(sp_ai_job) 중심이다: 위저드 3단계에서 검토서 잡과 **병렬로** 시작되므로 그때는 프로젝트가 없다.
// 결과(메타 + 살균 HTML)는 잡 행에 저장되고, 등록 시 `attachDevDiagramJob` 이 프로젝트에 연결한다 —
// 이미 done 이면 즉시 복사, 진행 중이면 완료 순간 러너가 연결된 프로젝트를 찾아 쓴다(메일 포함).
// 프로세스 내 큐(동시 1): 프로빙 실측 141~581초·thinking 2~5만 자라 동시 실행은 비용을 통제할 수 없다.
// 흐름: (게이트) → running → kimi 생성 → 살균·감사 → done | error. 게이트 미달은 잡을 만들지 않는다
// (run 응답의 diagramSkipReason). 다중 인스턴스 배포는 이월(큐가 프로세스 안).

type AiRunLogger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

interface QueueEntry { jobId: string; source: DevReviewSource | null; log: AiRunLogger }
const queue: QueueEntry[] = [];
let draining = false;

const nowIso = (): string => new Date().toISOString();

const baseMeta = (runtime: { model: string; think: string }, attempt: number, corpusChars: number): MarketDevDiagramType => ({
  version: 1,
  status: 'queued',
  jobId: null,
  model: runtime.model,
  promptVersion: DEV_DIAGRAM_PROMPT_VERSION,
  think: runtime.think,
  requestedAt: nowIso(),
  generatedAt: null,
  elapsedSecs: null,
  attempt,
  audit: null,
  error: null,
  skipReason: null,
  corpusChars,
});

const jobResultJson = (meta: MarketDevDiagramType, html = ''): string => JSON.stringify({ meta, html });

// 프로젝트 저장분(설명·답변·첨부 실파일)에서 근거 코퍼스를 다시 만든다 — 재생성·재시작 복구용.
// 첨부는 **1스텝 참고 자료(area = null)만** 읽는다 — 2스텝 분야 슬롯 자료는 AI 분석 대상이 아니다(§13.10).
// 실행 라우트(routes/ai.ts)와 같은 집합이어야 같은 코퍼스가 나온다.
// 이미지(래스터 미리보기)는 **검토서 재생성**이 쓴다 — 구성도는 텍스트 코퍼스만 보므로 버린다.
// (버리고 만들면 재생성본이 원본보다 근거가 빈약해진다 — 첨부 이미지 판독이 통째로 빠진다.)
export async function buildProjectDevReviewSourceWithImages(
  project: SpMarketProject,
): Promise<{ source: DevReviewSource; images: string[]; attachmentHashes: string[] }> {
  const files = await prisma.spFile.findMany({
    where: { refType: REF_MARKET_PROJECT, refId: project.id, area: null },
    orderBy: { id: 'asc' },
  });
  const downloaded = await Promise.all(
    files.map(async (f) => {
      const d = await downloadFromFileServer(f.pathToken);
      if (d === null) return null;
      return { buffer: d.buffer, filename: f.originFileName, mimetype: d.contentType };
    }),
  );
  const present = downloaded.filter((d): d is NonNullable<typeof d> => d !== null);
  const expanded = expandAiArchives(present);
  const prepared = await prepareAiAttachments(
    expanded.files.map((f) => ({ ...f, filename: f.displayPath })),
    { maxFiles: 50 },
  );
  return {
    source: {
      title: project.title,
      serviceAreas: toAreaCodes(project.serviceAreas),
      description: project.description,
      answers: toAnswers(project.answers),
      attachmentContext: prepared.context,
      attachmentFiles: files.map((f) => f.originFileName).slice(0, 20),
    },
    images: prepared.images,
    // 등록 라우트와 **같은 형식**(`attachment:<원본 sha256>` 정렬 앞 10)이라, 등록 직후 재생성은
    // 그때 만든 잡의 캐시에 그대로 맞는다(3분짜리를 헛돌리지 않는다).
    attachmentHashes: devReviewAttachmentHashes(
      present.map((f) => ({ field: MARKET_ATTACHMENT_FIELD, buffer: f.buffer })),
    ),
  };
}

export async function buildProjectDevReviewSource(project: SpMarketProject): Promise<DevReviewSource> {
  return (await buildProjectDevReviewSourceWithImages(project)).source;
}


// ── 시작 — 잡 생성 + 큐 ───────────────────────────────────────────────────────
export type StartDevDiagramResult =
  | { ok: true; job: AiJob; cached: boolean }
  | { ok: false; reason: 'DISABLED' | 'GATE'; skipReason: string | null };

export async function startDevDiagramJob(options: {
  mbId: string;
  source: DevReviewSource;
  inputHash: string; // 검토서와 같은 입력 해시(제목·분야·설명·답변·첨부) — 등록 시 대조
  log: AiRunLogger;
  force?: boolean; // 관리자 강제 — 유스케이스·게이트 무시
}): Promise<StartDevDiagramResult> {
  const { mbId, source, inputHash, log } = options;
  const runtime = await getAiUsecaseRuntime(DEV_DIAGRAM_USECASE);
  if (!runtime.enabled && options.force !== true) return { ok: false, reason: 'DISABLED', skipReason: null };
  const gate = devDiagramGate(source);
  if (!gate.ok && options.force !== true) return { ok: false, reason: 'GATE', skipReason: gate.reason };

  const jobSource = { model: runtime.model, promptVersion: DEV_DIAGRAM_PROMPT_VERSION, inputHash };
  if (options.force !== true) {
    // 같은 입력이면 진행 중 잡도 재사용 — 3단계 재진입·검토서 재생성이 10분짜리 kimi 를 다시 돌리지 않는다.
    const reusable = await findReusableAiJob(DEV_DIAGRAM_USECASE, mbId, jobSource, { includeRunning: true });
    if (reusable !== null) {
      log.info({ useCase: DEV_DIAGRAM_USECASE, jobId: reusable.id, mbId, status: reusable.status }, 'dev diagram job reuse');
      return { ok: true, job: reusable, cached: true };
    }
  }
  const meta = baseMeta(runtime, 1, gate.corpusChars);
  const job = await createAiJob({
    useCase: DEV_DIAGRAM_USECASE,
    mbId,
    ...jobSource,
    stage: 'diagram',
    resultJson: jobResultJson(meta),
  });
  const withMeta: AiJob = { ...job, diagram: { ...meta, jobId: job.id } };
  queue.push({ jobId: job.id, source, log });
  void drain();
  log.info({ useCase: DEV_DIAGRAM_USECASE, jobId: job.id, mbId, corpusChars: gate.corpusChars }, 'dev diagram job queued');
  return { ok: true, job: withMeta, cached: false };
}

// ── 프로젝트 연결 ─────────────────────────────────────────────────────────────
const writeProjectMeta = async (projectId: bigint, meta: MarketDevDiagramType, html?: string | null): Promise<void> => {
  await prisma.spMarketProject.update({
    where: { id: projectId },
    data: {
      devDiagram: meta,
      ...(html === undefined ? {} : { devDiagramHtml: html }),
    },
  });
};

// 잡을 프로젝트에 연결 — done 이면 본문 복사, 진행 중이면 진행 메타만(완료 시 러너가 채운다).
export async function linkJobToProject(projectId: bigint, job: AiJob, attempt = 1): Promise<MarketDevDiagramType> {
  const meta: MarketDevDiagramType = {
    ...(job.diagram ?? baseMeta({ model: job.model, think: 'high' }, attempt, 0)),
    jobId: job.id,
    attempt,
  };
  if (job.status === 'done' && job.diagramHtml !== null) {
    const done: MarketDevDiagramType = { ...meta, status: 'done' };
    await writeProjectMeta(projectId, done, job.diagramHtml);
    return done;
  }
  if (job.status === 'error') {
    const errored: MarketDevDiagramType = { ...meta, status: meta.status === 'skipped' ? 'skipped' : 'error', error: meta.error ?? job.error };
    await writeProjectMeta(projectId, errored, null);
    return errored;
  }
  const running: MarketDevDiagramType = { ...meta, status: meta.status === 'queued' ? 'queued' : 'running' };
  await writeProjectMeta(projectId, running, null);
  return running;
}

// 등록 라우트용 — 잡 소유자·유스케이스·입력 해시 대조 뒤 연결. 대조 실패는 이유만 돌려주고 등록은 막지
// 않는다(검토서와 달리 구성도는 "있으면 좋은" 산출물).
export async function attachDevDiagramJob(
  projectId: bigint,
  mbId: string,
  jobId: string,
  expectedInputHash: string,
  log: AiRunLogger,
): Promise<'linked' | 'invalid' | 'stale'> {
  const job = await getAiJob(jobId);
  if (job?.mbId !== mbId || job.useCase !== DEV_DIAGRAM_USECASE) return 'invalid';
  if (job.inputHash !== expectedInputHash) return 'stale';
  const meta = await linkJobToProject(projectId, job, 1);
  log.info({ projectId: Number(projectId), jobId, status: meta.status }, 'dev diagram job linked');
  return 'linked';
}

// 프로젝트 기준 (재)생성 — 소유자 상세·관리자 강제·등록 뒤 자동(잡 id 없이 동의만 있을 때). 소스는 저장분에서.
export async function requestDevDiagramForProject(
  project: SpMarketProject,
  log: AiRunLogger,
  options: { force?: boolean } = {},
): Promise<{ ok: true; meta: MarketDevDiagramType } | { ok: false; reason: 'DISABLED' | 'RUNNING' }> {
  const current = toDevDiagram(project.devDiagram);
  if (current !== null && (current.status === 'queued' || current.status === 'running')) {
    return { ok: false, reason: 'RUNNING' };
  }
  const attempt = (current?.attempt ?? 0) + 1;
  const source = await buildProjectDevReviewSource(project);
  const started = await startDevDiagramJob({
    mbId: project.mbId,
    source,
    inputHash: `project:${String(project.id)}:${nowIso()}`, // 재생성은 캐시를 안 탄다
    log,
    ...(options.force === undefined ? {} : { force: options.force }),
  });
  if (!started.ok) {
    if (started.reason === 'DISABLED') return { ok: false, reason: 'DISABLED' };
    const runtime = await getAiUsecaseRuntime(DEV_DIAGRAM_USECASE);
    const skipped: MarketDevDiagramType = { ...baseMeta(runtime, attempt, devDiagramGate(source).corpusChars), status: 'skipped', skipReason: started.skipReason };
    await writeProjectMeta(project.id, skipped, null);
    return { ok: true, meta: skipped };
  }
  const meta = await linkJobToProject(project.id, started.job, attempt);
  return { ok: true, meta };
}

// ── 큐 ──────────────────────────────────────────────────────────────────────
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      try {
        await runOne(next);
      } catch (err) {
        next.log.error({ err, jobId: next.jobId }, 'dev diagram run crashed');
      }
    }
  } finally {
    draining = false;
  }
}

// 이 잡에 연결된 프로젝트(등록 시 devDiagram.jobId 로 연결) — 완료 시 컬럼에 쓰고 메일.
async function linkedProject(jobId: string): Promise<SpMarketProject | null> {
  const rows = await prisma.spMarketProject.findMany({
    where: { devDiagram: { path: '$.jobId', equals: jobId } },
    take: 1,
  });
  return rows[0] ?? null;
}

async function runOne(entry: QueueEntry): Promise<void> {
  const { jobId, log } = entry;
  const job = await getAiJob(jobId);
  if (job?.status !== 'running') return; // 취소·경합 — 조용히 지난다
  const runtime = await getAiUsecaseRuntime(DEV_DIAGRAM_USECASE);
  const startedAt = Date.now();
  let meta: MarketDevDiagramType = { ...(job.diagram ?? baseMeta(runtime, 1, 0)), jobId, status: 'running', model: runtime.model, think: runtime.think };
  await updateAiJobResult(jobId, jobResultJson(meta));
  const project = await linkedProject(jobId);
  if (project !== null) await writeProjectMeta(project.id, meta);

  // 소스 — 큐 항목(3단계·재생성)에 있거나, 재시작 복구면 연결된 프로젝트에서 다시 만든다.
  let source = entry.source;
  if (source === null) {
    if (project === null) {
      meta = { ...meta, status: 'error', error: 'SOURCE_LOST' };
      await finishAiJob(jobId, { error: 'SOURCE_LOST', diagram: meta });
      return;
    }
    source = await buildProjectDevReviewSource(project);
  }
  meta = { ...meta, corpusChars: devDiagramGate(source).corpusChars };

  const prompt = buildDevDiagramPrompt(source, runtime.extraInstructions);
  const conn = await getAiConnection();
  let lastError = 'GENERATION_FAILED';
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      const raw = await chatWithOptionFallback(
        conn,
        runtime.model,
        prompt,
        runtime.def.timeoutMs,
        [],
        {
          think: toOllamaThink(runtime.think),
          ...(runtime.def.temperature === undefined ? {} : { temperature: runtime.def.temperature }),
          ...(runtime.def.seed === undefined ? {} : { seed: runtime.def.seed }),
        },
        log,
      );
      if (raw.text.trim() === '') {
        lastError = 'EMPTY_RESULT';
        continue;
      }
      const { html, stripped } = sanitizeDevDiagramHtml(raw.text);
      const audit = auditDevDiagramHtml(html, source, stripped);
      if (!isDevDiagramAcceptable(audit)) {
        lastError = 'NO_SVG';
        log.warn({ jobId, attempt, audit }, 'dev diagram has no svg — retrying');
        continue;
      }
      const elapsedSecs = Math.round((Date.now() - startedAt) / 1000);
      meta = { ...meta, status: 'done', generatedAt: nowIso(), elapsedSecs, audit, error: null };
      await finishAiJob(jobId, { diagram: meta, html });
      log.info({ jobId, elapsedSecs, thinkingChars: raw.thinkingChars, audit }, 'dev diagram done');
      const target = await linkedProject(jobId);
      if (target !== null) {
        await writeProjectMeta(target.id, meta, html);
        await notifyOwner(target, meta, log);
      }
      return;
    } catch (err) {
      lastError = err instanceof Error && /timeout|abort/i.test(err.message) ? 'TIMEOUT' : 'GENERATION_FAILED';
      log.warn({ err, jobId, attempt }, 'dev diagram generation failed');
    }
  }
  meta = { ...meta, status: 'error', error: lastError, elapsedSecs: Math.round((Date.now() - startedAt) / 1000) };
  await finishAiJob(jobId, { error: lastError, diagram: meta });
  const target = await linkedProject(jobId);
  if (target !== null) await writeProjectMeta(target.id, meta, null);
}

async function notifyOwner(project: SpMarketProject, meta: MarketDevDiagramType, log: AiRunLogger): Promise<void> {
  const [members, owners] = await Promise.all([getMembersByIds([project.mbId]), marketOwnerNames([project.mbId])]);
  await sendMarketMail(
    log as FastifyBaseLogger,
    members.get(project.mbId)?.email,
    buildDevDiagramReadyEmail({
      ownerName: owners.get(project.mbId) ?? '회원',
      projectId: Number(project.id),
      projectTitle: project.title,
      elapsedSecs: meta.elapsedSecs,
    }),
    {
      kind: 'market_dev_diagram_ready',
      refType: 'market_project',
      refId: project.id,
      sentBy: null,
      toMbId: project.mbId,
    },
  );
}

// ── 서버 재시작 복구 ─────────────────────────────────────────────────────────
// running 으로 남은 dev-diagram 잡: 프로젝트에 연결된 것은 저장분에서 소스를 다시 만들어 재실행,
// 연결 안 된 것(위저드 3단계에서만 시작)은 소스가 메모리에만 있었으므로 복구 불가 → error(ABANDONED).
// 위저드가 살아 있으면 "다시 만들기"로 새 잡을 시작한다(파일은 브라우저에 있다).
export async function resumeDevDiagramQueue(log: AiRunLogger): Promise<number> {
  const running = await listRunningAiJobs(DEV_DIAGRAM_USECASE);
  let count = 0;
  for (const job of running) {
    const project = await linkedProject(job.id);
    if (project === null) {
      const meta: MarketDevDiagramType = { ...(job.diagram ?? baseMeta({ model: job.model, think: 'high' }, 1, 0)), jobId: job.id, status: 'error', error: 'ABANDONED' };
      await finishAiJob(job.id, { error: 'ABANDONED', diagram: meta });
      continue;
    }
    queue.push({ jobId: job.id, source: null, log });
    count += 1;
  }
  if (count > 0) void drain();
  return count;
}
