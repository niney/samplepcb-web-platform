import { Prisma } from '@prisma/client';
import type { SpDevelopRequest } from '@prisma/client';
import {
  WorkState,
  emptyWorkState,
  workDefaultTasks,
  workPublishedVersion,
} from '@sp/api-contract';
import type {
  WorkCommandBodyType,
  WorkContextType,
  WorkFileType,
  WorkStateType,
  WorkViewType,
} from '@sp/api-contract';
import { addDevelopEvent, toDevelopAreaCodes } from './develop';
import {
  findWorkDocument,
  publicWorkState,
  reduceWorkflow,
  workAssert,
} from './develop-workflow-domain';
import { prisma } from './prisma';

export const REF_WORKFLOW = 'sp_develop_workflow';
export const workflowJson = (state: WorkStateType): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
export async function workContext(
  tx: Prisma.TransactionClient,
  r: SpDevelopRequest,
): Promise<WorkContextType> {
  const rows = await tx.spDevelopQuote.findMany({
    where: { requestId: r.id },
    include: { items: { orderBy: { seq: 'asc' } }, milestones: { orderBy: { seq: 'asc' } } },
    orderBy: { version: 'desc' },
  });
  const accepted = rows.find((q) => q.status === 'accepted' && q.kind !== 'change');
  const upfront = accepted?.milestones.filter((m) => m.trigger === 'on_accept') ?? [];
  const unlocks = rows
    .filter((q) => q.status === 'accepted')
    .flatMap((q) => q.milestones)
    .filter((m) => m.unlocksDeliverables && m.status !== 'cancelled');
  return {
    title: r.title,
    customer: r.contactCompany ?? r.contactName,
    requestStatus: r.status,
    startedAt: r.startedAt?.toISOString() ?? null,
    contractReady: accepted !== undefined,
    paymentReady: accepted !== undefined && upfront.every((m) => m.status === 'paid'),
    aiConsent: r.aiConsent,
    deliverablesLocked: unlocks.some((m) => m.status !== 'paid'),
    quotes: rows.map((q) => ({
      quoteId: Number(q.id),
      version: q.version,
      kind: q.kind,
      status: q.status,
      title: q.title,
      supplyAmount: q.supplyAmount,
      vatAmount: q.vatAmount,
      totalAmount: q.totalAmount,
      durationDays: q.durationDays,
      scheduleNote: q.scheduleNote,
      terms: q.terms,
      exclusions: q.exclusions,
      warrantyDays: q.warrantyDays,
      reviewDays: q.reviewDays,
      deliverables: Array.isArray(q.deliverables)
        ? q.deliverables.filter((x): x is string => typeof x === 'string')
        : [],
      acceptedAt: q.acceptedAt?.toISOString() ?? null,
      acceptedName: q.acceptedName,
      items: q.items.map((i) => ({ title: i.title, amount: i.amount, description: i.description })),
      milestones: q.milestones.map((m) => ({
        milestoneId: Number(m.id),
        title: m.title,
        amount: m.amount,
        trigger: m.trigger,
        status: m.status,
      })),
    })),
  };
}
export async function workFiles(tx: Prisma.TransactionClient, id: bigint): Promise<WorkFileType[]> {
  const rows = await tx.spFile.findMany({
    where: { refType: REF_WORKFLOW, refId: id },
    orderBy: { id: 'asc' },
  });
  return rows.map((f) => ({
    fileId: Number(f.id),
    name: f.originFileName,
    size: Number(f.size),
    locked: false,
  }));
}
export async function readWorkflow(r: SpDevelopRequest, admin: boolean): Promise<WorkViewType> {
  const empty: WorkViewType = {
    available: true,
    enabled: false,
    revision: 0,
    state: null,
    context: null,
  };
  const row = await prisma.spDevelopWorkflow.findUnique({ where: { requestId: r.id } });
  if (row === null || (!admin && !row.enabled)) return empty;
  const context = await workContext(prisma, r);
  const state = WorkState.parse(row.state);
  if (admin) {
    state.files = await workFiles(prisma, r.id);
    // 잠금은 고객 다운로드 정책이다. 관리자는 잔금 전에도 공개본의 산출물을 확인한다.
    for (const doc of state.documents) for (const version of doc.versions) version.files = version.files.map((file) => ({ ...file, locked: false }));
  }
  else context.quotes = context.quotes.filter((q) => q.status !== 'draft');
  return {
    available: true,
    enabled: row.enabled,
    revision: row.revision,
    context,
    state: admin ? state : publicWorkState(state, context.deliverablesLocked),
  };
}

interface Actor {
  mbId: string;
  admin: boolean;
  ip?: string;
}
export async function applyWorkflow(
  id: bigint,
  body: WorkCommandBodyType,
  actor: Actor,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      // 의뢰 행 잠금으로 기존 상태 변경과 작업 진행을 직렬화. revision은 오래 열린 화면도 차단한다.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM sp_develop_request WHERE id = ${id} FOR UPDATE`);
      const r = await tx.spDevelopRequest.findUnique({ where: { id } });
      workAssert(r, 'NOT_FOUND', '의뢰가 없습니다');
      workAssert(actor.admin || r.mbId === actor.mbId, 'FORBIDDEN', '이 의뢰에 접근할 수 없습니다');
      const current = await tx.spDevelopWorkflow.findUnique({ where: { requestId: id } });
      workAssert(
        (current?.revision ?? 0) === body.revision,
        'REVISION_CONFLICT',
        '다른 변경이 저장되었습니다. 최신 내용을 불러온 뒤 다시 적용해 주세요',
      );
      workAssert(
        current?.enabled === true || (actor.admin && body.command.type === 'enable'),
        'WORKFLOW_DISABLED',
        '이 의뢰의 수행관리를 먼저 켜 주세요',
      );
      const input = current === null ? emptyWorkState() : WorkState.parse(current.state);
      if (current === null) input.plan.tasks = workDefaultTasks(toDevelopAreaCodes(r.serviceAreas));
      input.files = await workFiles(tx, id);
      const context = await workContext(tx, r);
      const now = new Date();
      const { state, effect } = reduceWorkflow(input, body.command, context, {
        admin: actor.admin,
        now: now.toISOString(),
      });
      const revision = body.revision + 1;
      const enabled =
        body.command.type === 'enable'
          ? true
          : body.command.type === 'disable'
            ? false
            : (current?.enabled ?? false);
      if (
        effect === 'start' ||
        effect === 'deliver' ||
        effect === 'confirm' ||
        effect === 'changes'
      ) {
        const to =
          effect === 'start' || effect === 'changes'
            ? 'in_progress'
            : effect === 'deliver'
              ? 'delivered'
              : 'completed';
        const upd = await tx.spDevelopRequest.updateMany({
          where: { id, status: r.status },
          data: {
            status: to,
            ...(effect === 'start'
              ? { startedAt: now }
              : effect === 'deliver'
                ? { deliveredAt: now }
                : effect === 'confirm'
                  ? { completedAt: now }
                  : {}),
          },
        });
        workAssert(upd.count === 1, 'REVISION_CONFLICT', '의뢰 상태가 변경되었습니다');
        await addDevelopEvent(tx, id, {
          type: 'status_changed',
          actorMbId: actor.mbId,
          byAdmin: actor.admin,
          title: '수행관리에서 상태를 변경했습니다',
          payload: { from: [r.status], to },
        });
      }
      const command = body.command;
      if (command.type === 'document.publish') {
        const doc = findWorkDocument(state, command.id);
        const version = workPublishedVersion(doc);
        workAssert(version, 'VERSION_NOT_FOUND', '문서가 없습니다');
        const event = await addDevelopEvent(tx, id, {
          type: effect === 'deliver' ? 'deliverable' : 'published',
          actorMbId: actor.mbId,
          byAdmin: true,
          title: `${version.title} · v${String(version.version)} 공개`,
          body: '수행관리에서 문서를 확인해 주세요.',
          payload: {
            workflowDocumentId: doc.id,
            workflowVersion: version.version,
            ...(effect === 'deliver' ? { final: true, locked: true } : {}),
          },
        });
        if (effect === 'deliver') version.deliveryEventId = Number(event.id);
      }
      if (command.type === 'document.decide') {
        const doc = findWorkDocument(state, command.id);
        const version = workPublishedVersion(doc);
        await addDevelopEvent(tx, id, {
          type: command.decision === 'approved' ? 'review_approved' : 'review_changes',
          actorMbId: actor.mbId,
          byAdmin: false,
          title: `${version?.title ?? '문서'} · v${String(command.version)} 고객 응답`,
          body: command.note,
          payload: {
            workflowDocumentId: doc.id,
            workflowVersion: command.version,
            decision: command.decision,
          },
        });
      }
      if (current === null)
        await tx.spDevelopWorkflow.create({
          data: { requestId: id, revision, enabled, state: workflowJson(state) },
        });
      else {
        const upd = await tx.spDevelopWorkflow.updateMany({
          where: { requestId: id, revision: body.revision },
          data: { revision, enabled, state: workflowJson(state) },
        });
        workAssert(upd.count === 1, 'REVISION_CONFLICT', '다른 변경이 저장되었습니다');
      }
      await tx.spDevelopWorkflowAudit.create({
        data: {
          requestId: id,
          revision,
          action: command.type,
          actorMbId: actor.mbId,
          byAdmin: actor.admin,
          payload: JSON.parse(JSON.stringify({ ...command, clientIp: actor.ip ?? null })) as Prisma.InputJsonValue,
        },
      });
    },
    { timeout: 15000 },
  );
}

// 기존 검수기간 경과 자동확정도 최신 납품 공개본에 기록한다. 구버전의 승인은 변경하지 않는다.
export async function syncWorkflowAutoConfirm(requestId: bigint, at: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM sp_develop_request WHERE id = ${requestId} FOR UPDATE`,
    );
    const row = await tx.spDevelopWorkflow.findUnique({ where: { requestId } });
    if (!row?.enabled) return;
    const state = WorkState.parse(row.state);
    let changed = false;
    for (const doc of state.documents) {
      if (doc.kind !== 'delivery') continue;
      const version = workPublishedVersion(doc);
      if (version !== null && version.decision === null) {
        version.decision = {
          decision: 'approved',
          actor: '검수기간 경과',
          note: '기존 검수기간에 따른 자동 확정',
          at: at.toISOString(),
        };
        changed = true;
      }
    }
    if (!changed) return;
    await tx.spDevelopWorkflow.update({
      where: { requestId },
      data: { revision: { increment: 1 }, state: workflowJson(state) },
    });
    await tx.spDevelopWorkflowAudit.create({
      data: {
        requestId,
        revision: row.revision + 1,
        action: 'delivery.auto-confirm',
        actorMbId: 'system',
        byAdmin: false,
        payload: { at: at.toISOString() },
      },
    });
  });
}
