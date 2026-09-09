import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from './prisma';

export type DevelopPrototype = 'g' | 'c';
export const developPrototypeWhere = (
  variant: DevelopPrototype,
): Prisma.SpDevelopRequestWhereInput =>
  variant === 'c'
    ? { prototype: { is: { variant: 'c' } } }
    : { OR: [{ prototype: { is: null } }, { prototype: { is: { variant: 'g' } } }] };

export async function getDevelopPrototype(requestId: bigint): Promise<DevelopPrototype> {
  const row = await prisma.spDevelopPrototype.findUnique({
    where: { requestId },
    select: { variant: true },
  });
  if (row === null) return 'g';
  return z.enum(['g', 'c']).parse(row.variant);
}

const Params = z.object({
  id: z.string().optional(),
  qid: z.string().optional(),
  mid: z.string().optional(),
  docId: z.string().optional(),
  fileId: z.string().optional(),
});
const numeric = (value: string | undefined): bigint | null =>
  value !== undefined && /^\d+$/.test(value) ? BigInt(value) : null;

// 소속은 등록 시 고정된다. 우회 URL로 다른 프로토타입의 조회/상태 전이/파일/결제를 실행하지 못한다.
export function addDevelopPrototypeGuard(app: FastifyInstance, variant: DevelopPrototype): void {
  app.addHook('preHandler', async (request, reply) => {
    const params = Params.parse(request.params ?? {});
    if (Object.values(params).every((value) => value === undefined)) return;
    await app.authenticate(request, reply);
    let requestId = numeric(params.id);
    const quoteId = numeric(params.qid);
    const milestoneId = numeric(params.mid);
    const documentId = numeric(params.docId);
    const fileId = numeric(params.fileId);
    if (requestId === null && quoteId !== null)
      requestId =
        (
          await prisma.spDevelopQuote.findUnique({
            where: { id: quoteId },
            select: { requestId: true },
          })
        )?.requestId ?? null;
    if (requestId === null && milestoneId !== null)
      requestId =
        (
          await prisma.spDevelopMilestone.findUnique({
            where: { id: milestoneId },
            select: { requestId: true },
          })
        )?.requestId ?? null;
    if (requestId === null && documentId !== null)
      requestId =
        (
          await prisma.spDevelopDocument.findUnique({
            where: { id: documentId },
            select: { requestId: true },
          })
        )?.requestId ?? null;
    if (requestId === null && fileId !== null) {
      const file = await prisma.spFile.findUnique({
        where: { id: fileId },
        select: { refType: true, refId: true },
      });
      if (file) {
        if (file.refType === 'sp_develop_request' || file.refType === 'sp_develop_workflow')
          requestId = file.refId;
        else if (file.refType === 'sp_develop_event')
          requestId =
            (
              await prisma.spDevelopEvent.findUnique({
                where: { id: file.refId },
                select: { requestId: true },
              })
            )?.requestId ?? null;
        else if (file.refType === 'sp_develop_quote')
          requestId =
            (
              await prisma.spDevelopQuote.findUnique({
                where: { id: file.refId },
                select: { requestId: true },
              })
            )?.requestId ?? null;
        else if (file.refType === 'sp_develop_document')
          requestId =
            (
              await prisma.spDevelopDocument.findUnique({
                where: { id: file.refId },
                select: { requestId: true },
              })
            )?.requestId ?? null;
      }
    }
    if (requestId === null || (await getDevelopPrototype(requestId)) !== variant) {
      return reply
        .status(404)
        .send({
          result: false,
          error: 'NOT_FOUND',
          message: '이 개발 메뉴에 해당하는 의뢰가 없습니다.',
        });
    }
  });
}
