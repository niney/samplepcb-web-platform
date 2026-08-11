import { BomClaim, type BomClaimType } from '@sp/api-contract';
import type { Prisma } from '@prisma/client';

export const bomClaimInclude = {
  items: { orderBy: { id: 'asc' } },
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.SpBomClaimInclude;

export type BomClaimWithRelations = Prisma.SpBomClaimGetPayload<{
  include: typeof bomClaimInclude;
}>;

/** DB 문자열 상태와 JSON 스냅샷도 공유 Zod 계약을 통과한 뒤에만 응답한다. */
export function toBomClaimDto(claim: BomClaimWithRelations): BomClaimType {
  return BomClaim.parse({
    id: String(claim.id),
    quoteId: String(claim.quoteId),
    quoteTitle: claim.quoteTitle,
    mbId: claim.mbId,
    odId: claim.odId,
    ctId: claim.ctId,
    status: claim.status,
    kind: claim.kind,
    subject: claim.subject,
    description: claim.description,
    orderSnapshot: claim.orderSnapshot,
    version: claim.version,
    adminMbId: claim.adminMbId,
    adminResponse: claim.adminResponse,
    resolutionKind: claim.resolutionKind,
    submittedAt: claim.submittedAt.toISOString(),
    reviewStartedAt: claim.reviewStartedAt?.toISOString() ?? null,
    closedAt: claim.closedAt?.toISOString() ?? null,
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString(),
    items: claim.items.map((item) => ({
      id: String(item.id),
      quoteItemId: String(item.quoteItemId),
      mpn: item.mpn,
      manufacturerName: item.manufacturerName,
      description: item.description,
      orderedQty: item.orderedQty,
      affectedQty: item.affectedQty,
    })),
    events: claim.events.map((event) => ({
      id: String(event.id),
      action: event.action,
      actorRole: event.actorRole,
      actorMbId: event.actorMbId,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}
