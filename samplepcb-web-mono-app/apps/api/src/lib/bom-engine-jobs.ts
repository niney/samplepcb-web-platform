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
const ingestInFlight = new Map<string, Promise<void>>();

export async function ingestJobResult(jobId: string, log: FastifyBaseLogger): Promise<void> {
  if (ingestedJobs.has(jobId)) return;
  // 동시 호출(폴러+치유+백업 훅)은 같은 인제스트의 "완료"를 기다린다 — 즉시 반환하면
  // 호출부가 절반만 적재된 카탈로그로 재매칭해 부분 반영이 생긴다.
  const inFlight = ingestInFlight.get(jobId);
  if (inFlight !== undefined) return inFlight;
  const run = (async (): Promise<void> => {
    ingestedJobs.add(jobId);
    try {
      const res = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search/result`);
      if (!res.ok) {
        ingestedJobs.delete(jobId);
        return;
      }
      const stats = await ingestSupplierSearchResult(await res.json());
      log.info({ jobId, ...stats }, '부품 카탈로그 자동 인제스트 완료');
    } catch (error) {
      ingestedJobs.delete(jobId); // 다음 기회(백업 훅/재조회)에 재시도
      log.warn({ jobId, err: String(error) }, '부품 카탈로그 자동 인제스트 실패');
    }
  })();
  ingestInFlight.set(jobId, run);
  try {
    await run;
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
            stop();
            await ingestJobResult(jobId, log);
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

// ── 고객(회원) 잡 소유·검색 쿼터 — 인메모리(단일 인스턴스 전제) ─────────────────
// 엔진 잡 자체가 인메모리라 재시작 시 잡·소유가 함께 소멸한다(정합). 일일 검색
// 카운터도 재시작 시 초기화 — 1차 허용(문서화), 남용의 실질 상한은 preflight
// max_calls 클램프가 함께 담당한다.

const jobOwners = new Map<string, string>();

export function recordJobOwner(jobId: string, mbId: string): void {
  jobOwners.set(jobId, mbId);
}

/** 소유 확인 — 미기록·타인 잡은 false(호출부는 404 로 은닉). */
export function jobOwnedBy(jobId: string, mbId: string): boolean {
  return jobOwners.get(jobId) === mbId;
}

const searchCounts = new Map<string, number>(); // `${YYYY-MM-DD}:${mbId}` → count

/** 일일 검색 한도 검사 + 카운트 — 한도 초과면 false(카운트 안 함). */
export function tryCountDailySearch(mbId: string, limit: number): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${day}:${mbId}`;
  // 전날 키 정리(무한 성장 방지)
  for (const k of searchCounts.keys()) {
    if (!k.startsWith(day)) searchCounts.delete(k);
  }
  const count = searchCounts.get(key) ?? 0;
  if (count >= limit) return false;
  searchCounts.set(key, count + 1);
  return true;
}
