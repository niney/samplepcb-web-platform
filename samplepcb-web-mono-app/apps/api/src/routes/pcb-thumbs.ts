import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { downloadFromFileServer } from '../lib/file-server';
import { verifyThumbSig } from '../lib/thumb-url';
import { prisma } from '../lib/prisma';

// ── GET /api/pcb-thumbs/:fileId — 거버 썸네일 프록시 ────────────────────────
// 견적관리·보관함·장바구니 카드의 <img src> 가 직접 부르는 공개 엔드포인트.
// JWT 없이 서명 쿼리(exp·sig)로 보호 — 발급·검증 근거는 lib/thumb-url.ts 주석 참조.
// pathToken 은 여기서 파일서버로만 전달되고 응답에는 실리지 않는다.
export const pcbThumbRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.get(
    '/pcb-thumbs/:fileId',
    {
      schema: {
        params: z.object({ fileId: z.string().regex(/^\d+$/) }),
        querystring: z.object({ exp: z.coerce.number(), sig: z.string() }),
      },
    },
    async (request, reply) => {
      const { fileId } = request.params;
      const { exp, sig } = request.query;
      if (!verifyThumbSig(fileId, exp, sig)) {
        return reply.status(403).send({ result: false, error: 'INVALID_SIGNATURE' });
      }
      const file = await prisma.spFile.findFirst({
        where: { id: BigInt(fileId), refType: 'sp_order_spec', fileType: 'thumbnail' },
        select: { pathToken: true, originFileName: true },
      });
      if (file === null) return reply.notFound('썸네일이 없습니다');

      const downloaded = await downloadFromFileServer(file.pathToken);
      if (downloaded === null) return reply.notFound('파일이 없습니다');

      // 파일서버가 content-type 을 안 주는 경우 확장자로 보정 (썸네일은 png/jpg)
      let contentType = downloaded.contentType;
      if (contentType === 'application/octet-stream') {
        contentType = /\.png$/i.test(file.originFileName) ? 'image/png' : 'image/jpeg';
      }
      // 서명 만료(15분)와 별개로 브라우저 캐시 1시간 — 같은 목록 재방문 시 재전송 방지
      return reply
        .header('Cache-Control', 'private, max-age=3600')
        .type(contentType)
        .send(downloaded.buffer);
    },
  );
  done();
};
