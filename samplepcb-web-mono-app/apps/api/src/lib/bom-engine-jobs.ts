import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import { engineFetch } from './engine-client';
import { ingestSupplierSearchResultOnce, type CatalogIngestResult } from './parts-ingest';

// sp-engine 잡 프록시 + 부품 카탈로그 자동 인제스트 — 관리자(admin-bom)와
// 고객(bom) 라우트가 공유한다(admin-bom.ts 에서 동작 무변경 추출).
// sp-node 는 인증 경계 + 얇은 프록시. 엔진은 사설망·무인증이며 잡 상태를 소유한다.

export async function proxyEngine(
  reply: FastifyReply,
  path: string,
  init: RequestInit | undefined,
  okStatus: number,
): Promise<unknown> {
  let res: Response;
  try {
    res = await engineFetch(path, init);
  } catch {
    return reply.status(502).send({ result: false, error: 'BOM_ENGINE_UNREACHABLE' });
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    return reply.status(res.status).send({ result: false, error: 'BOM_ENGINE_ERROR', detail: body });
  }
  return reply.status(okStatus).send({ result: true, data: body });
}

// ── 부품 카탈로그 자동 인제스트 (설계: docs/PARTS_SEARCH.md) ──────────────────
// 주 훅: 검색 시작 202 시 서버측 폴러(5s·최대 10분) — 페이지를 닫아도 저장된다.
// 백업 훅: 결과 GET 200 통과 시 fire-and-forget — 재시작으로 폴러가 유실돼도 조회 순간 복구.
// 견적 스냅샷 반영은 카탈로그 인제스트보다 먼저 끝내 고객 대기시간에서 분리한다.
// 카탈로그는 실제 공급사 결과 fingerprint 원장으로 프로세스·잡 ID를 넘어 중복을 제거한다.
const POLL_MS = 5_000;
const POLL_MAX_TRIES = 120;
const pollers = new Map<string, NodeJS.Timeout>();
const ingestedJobs = new Map<string, CatalogIngestResult>();
const ingestInFlight = new Map<string, Promise<boolean>>();
const catalogIngestInFlight = new Map<string, Promise<CatalogIngestResult | null>>();

export interface IngestPollerHooks {
  onResult?: (envelope: unknown) => Promise<void>;
  onCatalogIngested?: (result: CatalogIngestResult) => Promise<void>;
  onCatalogIngestFailed?: (error?: unknown) => Promise<void>;
}

export async function fetchSupplierSearchResult(jobId: string): Promise<Record<string, unknown> | null> {
  const result = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search/result`);
  if (!result.ok) return null;
  const body: unknown = await result.json();
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
}

export async function ingestSupplierEnvelopeForJob(
  jobId: string,
  envelope: unknown,
  log: FastifyBaseLogger,
): Promise<CatalogIngestResult | null> {
  const completed = ingestedJobs.get(jobId);
  if (completed !== undefined) return completed;
  const inFlight = catalogIngestInFlight.get(jobId);
  if (inFlight !== undefined) return inFlight;
  const run = (async (): Promise<CatalogIngestResult | null> => {
    try {
      const result = await ingestSupplierSearchResultOnce(envelope, jobId);
      if (result.runId === null) {
        throw new Error('공급사 검색 결과에서 준비할 부품 정보를 읽지 못했습니다.');
      }
      ingestedJobs.set(jobId, result);
      log.info(
        { jobId, ingestRunId: result.runId, reused: result.reused, ...result.stats, ...result.timing },
        '부품 카탈로그 백그라운드 인제스트 완료',
      );
      return result;
    } catch (error) {
      log.warn({ jobId, err: String(error) }, '부품 카탈로그 백그라운드 인제스트 실패');
      return null;
    }
  })();
  catalogIngestInFlight.set(jobId, run);
  try {
    return await run;
  } finally {
    catalogIngestInFlight.delete(jobId);
  }
}

export async function ingestJobResult(jobId: string, log: FastifyBaseLogger): Promise<boolean> {
  // 진행 중 Promise를 완료 캐시보다 먼저 확인해야 한다. 완료 전에 ingestedJobs만 보고
  // 반환하면 호출부가 순차 인제스트 도중의 부분 카탈로그로 견적을 재매칭하게 된다.
  const inFlight = ingestInFlight.get(jobId);
  if (inFlight !== undefined) return inFlight;
  if (ingestedJobs.has(jobId)) return true;
  const run = (async (): Promise<boolean> => {
    try {
      const envelope = await fetchSupplierSearchResult(jobId);
      if (envelope === null) return false; // completed 직후 결과 준비 지연 — 다음 폴/조회에서 재시도
      return (await ingestSupplierEnvelopeForJob(jobId, envelope, log)) !== null;
    } catch (error) {
      log.warn({ jobId, err: String(error) }, '부품 카탈로그 자동 인제스트 실패');
      return false; // 다음 기회(폴러·치유·백업 훅)에 재시도
    }
  })();
  ingestInFlight.set(jobId, run);
  try {
    return await run;
  } finally {
    ingestInFlight.delete(jobId);
  }
}

/**
 * 검색 완료 감지 폴러. 견적 스냅샷(onResult)을 먼저 반영하고, 카탈로그 인제스트와
 * partId 보강(onCatalogIngested)은 사용자 응답 경로 밖에서 이어간다.
 */
export function startIngestPoller(jobId: string, log: FastifyBaseLogger, hooks: IngestPollerHooks = {}): void {
  if (pollers.has(jobId)) return;
  let tries = 0;
  let polling = false;
  const stop = (): void => {
    const timer = pollers.get(jobId);
    if (timer !== undefined) clearInterval(timer);
    pollers.delete(jobId);
  };
  const timer = setInterval(() => {
    if (polling) return;
    polling = true;
    void (async () => {
      tries += 1;
      try {
        const res = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search`);
        if (res.ok) {
          const body = (await res.json()) as { status?: string | null };
          if (body.status === 'completed') {
            const envelope = await fetchSupplierSearchResult(jobId);
            if (envelope === null) {
              if (tries >= POLL_MAX_TRIES) stop();
              return; // 결과가 아직 준비되지 않았으면 폴러 유지
            }
            stop();
            if (hooks.onResult !== undefined) {
              try {
                await hooks.onResult(envelope);
              } catch (error) {
                log.warn({ jobId, err: String(error) }, '검색 결과 견적 반영 실패');
              }
            }
            void (async () => {
              try {
                const result = await ingestSupplierEnvelopeForJob(jobId, envelope, log);
                if (result !== null) {
                  if (hooks.onCatalogIngested !== undefined) await hooks.onCatalogIngested(result);
                } else if (hooks.onCatalogIngestFailed !== undefined) {
                  await hooks.onCatalogIngestFailed();
                }
              } catch (error) {
                if (hooks.onCatalogIngestFailed !== undefined) {
                  try {
                    await hooks.onCatalogIngestFailed(error);
                  } catch (hookError) {
                    log.warn({ jobId, err: String(hookError) }, '부품 정보 준비 실패 상태 저장 실패');
                  }
                }
                log.warn({ jobId, err: String(error) }, '부품 카탈로그 백그라운드 인제스트 실패');
              }
            })();
            return;
          }
          if (body.status === 'failed') {
            stop();
            return;
          }
        }
      } catch {
        // 엔진 일시 불가 — 다음 틱 재시도
      }
      if (tries >= POLL_MAX_TRIES) stop();
    })().finally(() => {
      polling = false;
    });
  }, POLL_MS);
  timer.unref(); // 서버 종료를 막지 않는다(유실은 백업 훅이 보완)
  pollers.set(jobId, timer);
}

// ── 고객(회원) 잡 소유 — 엔진 인메모리 잡과 같은 수명 ────────────────────────
// 회원 일일 검색 사용량은 bom-supplier-operations의 DB 원장이 담당한다.

const jobOwners = new Map<string, string>();

export function recordJobOwner(jobId: string, mbId: string): void {
  jobOwners.set(jobId, mbId);
}

/** 소유 확인 — 미기록·타인 잡은 false(호출부는 404 로 은닉). */
export function jobOwnedBy(jobId: string, mbId: string): boolean {
  return jobOwners.get(jobId) === mbId;
}
