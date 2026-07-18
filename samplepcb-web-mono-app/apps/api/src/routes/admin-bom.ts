import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BomSupplierOptions } from '@sp/api-contract';
import { collectMultipart } from '../lib/market';
import { ingestSupplierSearchResult } from '../lib/parts-ingest';

// ── /api/admin/bom — BOM 추출 + 공급사 검색 (sp-engine Python 프록시, requireAdmin) ──
// sp-node 는 인증 경계 + 얇은 프록시. 엔진은 사설망·무인증이며 잡 상태를 소유한다.
// 응답은 엔진 원본(G-shape 등)을 {result:true,data} 봉투로 감싸 그대로 전달(직렬화
// 스키마 미지정 → 방대한 결과가 탈락 없이 통과, 클라이언트가 Zod 로 검증).
const BOM_ENGINE_URL = process.env.BOM_ENGINE_URL ?? 'http://127.0.0.1:8400';
const BOM_ENGINE_TIMEOUT_MS = Number(process.env.BOM_ENGINE_TIMEOUT_MS ?? 120_000);

const IdParams = z.object({ id: z.string().min(1) });

async function engineFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, BOM_ENGINE_TIMEOUT_MS);
  try {
    return await fetch(`${BOM_ENGINE_URL}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function proxy(
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

async function ingestJobResult(jobId: string, log: FastifyBaseLogger): Promise<void> {
  if (ingestedJobs.has(jobId)) return;
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
}

function startIngestPoller(jobId: string, log: FastifyBaseLogger): void {
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

export const adminBomRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // 업로드 → 파싱 잡 생성(멀티파트: file + 선택 engine)
  fastify.post('/bom/jobs', async (request, reply) => {
    if (!request.isMultipart()) return reply.badRequest('multipart/form-data 요청이어야 합니다');
    const { files, fields } = await collectMultipart(request);
    const file = files.find((f) => f.field === 'file') ?? files[0];
    if (file === undefined) return reply.badRequest('file 파트가 없습니다');
    const form = new FormData();
    form.append('file', new File([new Uint8Array(file.buffer)], file.filename, { type: file.mimetype }));
    form.append('engine', fields.engine ?? 'smartbom');
    return proxy(reply, '/jobs', { method: 'POST', body: form }, 202);
  });

  // 잡 상태 폴링
  fastify.get('/bom/jobs/:id', { schema: { params: IdParams } }, async (request, reply) =>
    proxy(reply, `/jobs/${encodeURIComponent(request.params.id)}`, undefined, 200),
  );

  // 추출 결과(G-shape)
  fastify.get('/bom/jobs/:id/result', { schema: { params: IdParams } }, async (request, reply) =>
    proxy(reply, `/jobs/${encodeURIComponent(request.params.id)}/result`, undefined, 200),
  );

  // 공급사 검색은 사전점검으로 호출량·캐시·키 상태를 확인한 뒤에만 실행한다.
  fastify.post(
    '/bom/jobs/:id/supplier-search/preflight',
    { schema: { params: IdParams, body: BomSupplierOptions } },
    async (request, reply) =>
      proxy(
        reply,
        `/jobs/${encodeURIComponent(request.params.id)}/supplier-search/preflight`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request.body),
        },
        200,
      ),
  );

  fastify.post(
    '/bom/jobs/:id/supplier-search',
    { schema: { params: IdParams, body: BomSupplierOptions } },
    async (request, reply) => {
      const out = await proxy(
        reply,
        `/jobs/${encodeURIComponent(request.params.id)}/supplier-search`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request.body),
        },
        202,
      );
      if (reply.statusCode === 202) startIngestPoller(request.params.id, request.log); // 주 훅
      return out;
    },
  );

  fastify.get('/bom/jobs/:id/supplier-search', { schema: { params: IdParams } }, async (request, reply) =>
    proxy(reply, `/jobs/${encodeURIComponent(request.params.id)}/supplier-search`, undefined, 200),
  );

  fastify.get('/bom/jobs/:id/supplier-search/result', { schema: { params: IdParams } }, async (request, reply) => {
    const out = await proxy(reply, `/jobs/${encodeURIComponent(request.params.id)}/supplier-search/result`, undefined, 200);
    if (reply.statusCode === 200) void ingestJobResult(request.params.id, request.log); // 백업 훅
    return out;
  });

  done();
};
