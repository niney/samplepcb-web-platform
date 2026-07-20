import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import { engineFetch } from './engine-client';
import { ingestSupplierSearchResult } from './parts-ingest';

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
// 인제스트는 idempotent upsert 라 중복 실행이 안전하다(ingestedJobs 는 중복 작업 절약용).
const POLL_MS = 5_000;
const POLL_MAX_TRIES = 120;
const pollers = new Map<string, NodeJS.Timeout>();
const ingestedJobs = new Set<string>();
const ingestInFlight = new Map<string, Promise<boolean>>();

export async function ingestJobResult(jobId: string, log: FastifyBaseLogger): Promise<boolean> {
  // 진행 중 Promise를 완료 캐시보다 먼저 확인해야 한다. 완료 전에 ingestedJobs만 보고
  // 반환하면 호출부가 순차 인제스트 도중의 부분 카탈로그로 견적을 재매칭하게 된다.
  const inFlight = ingestInFlight.get(jobId);
  if (inFlight !== undefined) return inFlight;
  if (ingestedJobs.has(jobId)) return true;
  const run = (async (): Promise<boolean> => {
    try {
      const res = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search/result`);
      if (!res.ok) return false; // completed 직후 결과 준비 지연 — 다음 폴/조회에서 재시도
      const stats = await ingestSupplierSearchResult(await res.json());
      ingestedJobs.add(jobId); // 전체 인제스트 성공 후에만 완료 캐시
      log.info({ jobId, ...stats }, '부품 카탈로그 자동 인제스트 완료');
      return true;
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
 * 검색 완료 감지 → 카탈로그 인제스트 폴러. onDone 은 인제스트 뒤 후처리(고객 견적
 * 자동 재매칭 등) — 실패해도 인제스트에는 영향 없다.
 */
export function startIngestPoller(jobId: string, log: FastifyBaseLogger, onDone?: () => Promise<void>): void {
  if (pollers.has(jobId)) return;
  let tries = 0;
  const stop = (): void => {
    const timer = pollers.get(jobId);
    if (timer !== undefined) clearInterval(timer);
    pollers.delete(jobId);
  };
  const timer = setInterval(() => {
    void (async () => {
      tries += 1;
      try {
        const res = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search`);
        if (res.ok) {
          const body = (await res.json()) as { status?: string | null };
          if (body.status === 'completed') {
            const ingested = await ingestJobResult(jobId, log);
            if (!ingested) {
              if (tries >= POLL_MAX_TRIES) stop();
              return; // 결과가 아직 준비되지 않았으면 폴러 유지
            }
            stop();
            if (onDone !== undefined) {
              try {
                await onDone();
              } catch (error) {
                log.warn({ jobId, err: String(error) }, '검색 완료 후처리 실패');
              }
            }
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
    })();
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
