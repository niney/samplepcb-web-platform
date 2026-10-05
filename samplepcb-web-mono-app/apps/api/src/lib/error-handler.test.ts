import Fastify from 'fastify';
import fastifySensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { INTERNAL_ERROR_MESSAGE, registerErrorHandler } from './error-handler';

// server.ts 와 같은 조합(sensible + zod 컴파일러)에서 핸들러만 얹어 본다.
const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();

beforeAll(async () => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifySensible);
  registerErrorHandler(app);

  app.get('/unexpected', () => {
    // Prisma 가 던지는 모양 — code 는 있고 statusCode 는 없다.
    throw Object.assign(
      new Error('Invalid `prisma.spQuote.findMany()` invocation in D:\\app\\dist\\server.js:1234:56'),
      { code: 'P2022' },
    );
  });
  app.get('/conflict', (_request, reply) => reply.conflict('이미 처리된 요청입니다'));
  app.get('/bad-gateway', (_request, reply) => reply.badGateway('파일 서버 오류'));
  app.get('/thrown-http-error', () => {
    throw app.httpErrors.notFound('견적을 찾을 수 없습니다');
  });
  app.get('/validated', { schema: { querystring: z.object({ page: z.coerce.number().int() }) } }, () => ({ ok: true }));
  app.get(
    '/declared-409',
    { schema: { response: { 409: z.object({ statusCode: z.number(), error: z.string(), message: z.string() }) } } },
    async (_request, reply) => {
      await reply.conflict('선언된 409');
    },
  );
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('registerErrorHandler', () => {
  it('statusCode 없는 예외는 500 으로 가리고 원문을 싣지 않는다', async () => {
    const res = await app.inject({ method: 'GET', url: '/unexpected' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: INTERNAL_ERROR_MESSAGE,
    });
    expect(res.body).not.toContain('prisma');
    expect(res.body).not.toContain('P2022');
  });

  it('sensible 4xx 는 본문 그대로 나간다', async () => {
    const res = await app.inject({ method: 'GET', url: '/conflict' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ statusCode: 409, error: 'Conflict', message: '이미 처리된 요청입니다' });
  });

  it('의도된 5xx(reply.badGateway)는 가리지 않는다', async () => {
    const res = await app.inject({ method: 'GET', url: '/bad-gateway' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ statusCode: 502, message: '파일 서버 오류' });
  });

  it('던진 httpErrors 도 그대로 나간다', async () => {
    const res = await app.inject({ method: 'GET', url: '/thrown-http-error' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ statusCode: 404, message: '견적을 찾을 수 없습니다' });
  });

  it('요청 검증 오류는 400 그대로다', async () => {
    const res = await app.inject({ method: 'GET', url: '/validated?page=abc' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ statusCode: 400, error: 'Bad Request' });
  });

  it('응답 스키마가 선언된 상태 코드도 기존처럼 직렬화된다', async () => {
    const res = await app.inject({ method: 'GET', url: '/declared-409' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ statusCode: 409, error: 'Conflict', message: '선언된 409' });
  });
});
