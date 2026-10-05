import type { FastifyError, FastifyInstance } from 'fastify';

// 예상하지 못한 예외(Prisma·mysql2·TypeError 등)의 원문을 응답에 싣지 않는다.
// Fastify 기본 핸들러는 500 이어도 error.message 를 그대로 내보내는데, Prisma 메시지에는
// 소스 경로·코드 조각·컬럼명이, mysql2 메시지에는 SQL 조각이 들어 있다. 무인증 라우트
// (가격 계산·매직링크)도 같은 핸들러를 타므로 원문은 로그에만 남긴다.
//
// 의도된 오류는 건드리지 않는다 — statusCode 가 붙은 오류(@fastify/sensible httpErrors,
// 요청 검증 400, 응답 직렬화 오류 등)는 기본 핸들러로 넘겨 지금과 같은 본문이 나간다.
// 판정 축은 "코드가 상태 코드를 정했는가" 하나다.
export const INTERNAL_ERROR_MESSAGE = '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (typeof error.statusCode === 'number' && error.statusCode >= 400) {
      // 같은 오류를 다시 보내면 Fastify 가 상위(기본) 핸들러로 넘긴다 — 본문·로그 수준 불변.
      return reply.send(error);
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: INTERNAL_ERROR_MESSAGE,
    });
  });
}
