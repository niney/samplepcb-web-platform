import type { Prisma } from '@prisma/client';
import {
  AdminDevelopWorkspaceItem,
  DEVELOP_REQUEST_STATUSES,
  WorkState,
  workProgress,
  workPublishedVersion,
} from '@sp/api-contract';
import type {
  AdminDevelopWorkspaceItemType,
  DevelopAdminTabType,
  DevelopWorkspaceSectionType,
} from '@sp/api-contract';

// 목록은 현재 업무 요약만 보낸다. 문서 본문·과거 버전·AI 결과는 상세에서 읽는다.
export const workspaceSelect = {
  id: true,
  title: true,
  status: true,
  contactName: true,
  contactCompany: true,
  assigneeMbId: true,
  updatedAt: true,
  deliveredAt: true,
  reviewDays: true,
  workflow: { select: { enabled: true, state: true, updatedAt: true } },
  quotes: {
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      title: true,
      status: true,
      totalAmount: true,
      milestones: {
        orderBy: { seq: 'asc' },
        select: { id: true, title: true, amount: true, status: true, trigger: true, paidAt: true },
      },
    },
  },
} satisfies Prisma.SpDevelopRequestSelect;
export type WorkspaceRow = Prisma.SpDevelopRequestGetPayload<{ select: typeof workspaceSelect }>;

export function workspaceScope(
  section: DevelopWorkspaceSectionType,
): Prisma.SpDevelopRequestWhereInput {
  switch (section) {
    case 'overview':
      return {};
    case 'quotes':
      return {
        OR: [{ status: { in: ['reviewing', 'quoted', 'accepted'] } }, { quotes: { some: {} } }],
      };
    case 'schedule':
      return {
        OR: [
          { status: { in: ['accepted', 'in_progress', 'delivered', 'completed'] } },
          { workflow: { is: {} } },
        ],
      };
    case 'documents':
      return {
        OR: [
          { status: { in: ['accepted', 'in_progress', 'delivered', 'completed'] } },
          { workflow: { is: {} } },
        ],
      };
    case 'delivery':
      return { status: { in: ['in_progress', 'delivered', 'completed'] } };
    case 'payments':
      return { quotes: { some: { status: 'accepted', milestones: { some: {} } } } };
  }
}
export function workspaceStatuses(tab: DevelopAdminTabType): readonly string[] {
  return tab === 'all'
    ? DEVELOP_REQUEST_STATUSES
    : tab === 'closed'
      ? ['cancelled', 'declined']
      : [tab];
}
export function toWorkspaceItem(
  row: WorkspaceRow,
  now = new Date(),
): AdminDevelopWorkspaceItemType {
  const state = row.workflow === null ? null : WorkState.parse(row.workflow.state);
  const enabled = row.workflow?.enabled === true;
  const active = enabled && !['cancelled', 'declined', 'completed'].includes(row.status);
  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const tasks = state?.plan.tasks.filter((task) => task.status !== 'skipped') ?? [];
  const documents = (state?.documents ?? []).map((doc) => {
    const published = workPublishedVersion(doc);
    return {
      id: doc.id,
      kind: doc.kind,
      title: published?.title ?? doc.draft?.title ?? '',
      publishedVersion: doc.publishedVersion,
      dueDate: published?.dueDate ?? doc.draft?.dueDate ?? null,
      status:
        published === null
          ? 'draft'
          : (published.decision?.decision ??
            (published.requiresApproval ? 'pending' : 'published')),
      decision: published?.decision ?? null,
    };
  });
  // 폐기·대체된 견적의 결제 계획을 미수금으로 합산하지 않는다.
  const milestones = row.quotes
    .filter((quote) => quote.status === 'accepted')
    .flatMap((quote) =>
      quote.milestones.map((milestone) => ({
        id: Number(milestone.id),
        quoteVersion: quote.version,
        title: milestone.title,
        amount: milestone.amount,
        status: milestone.status,
        trigger: milestone.trigger,
        paidAt: milestone.paidAt?.toISOString() ?? null,
      })),
    );
  return AdminDevelopWorkspaceItem.parse({
    requestId: Number(row.id),
    title: row.title,
    status: row.status,
    contactName: row.contactName,
    contactCompany: row.contactCompany,
    assignee: row.assigneeMbId,
    updatedAt: new Date(
      Math.max(row.updatedAt.getTime(), row.workflow?.updatedAt.getTime() ?? 0),
    ).toISOString(),
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    reviewDays: row.reviewDays,
    workflowEnabled: enabled,
    materialsReady: state?.materialsReady ?? false,
    progress: tasks.length === 0 ? null : workProgress(tasks),
    taskCount: tasks.length,
    completedTasks: tasks.filter((task) => task.status === 'completed').length,
    overdueTasks: active
      ? tasks.filter((task) => task.status !== 'completed' && task.end !== null && task.end < today)
          .length
      : 0,
    forecastEnd: state?.plan.forecastEnd ?? state?.plan.baselineEnd ?? null,
    pendingApprovals: active ? documents.filter((doc) => doc.status === 'pending').length : 0,
    documents,
    quotes: row.quotes.map((quote) => ({
      id: Number(quote.id),
      version: quote.version,
      title: quote.title,
      status: quote.status,
      amount: quote.totalAmount,
    })),
    milestones,
    paidAmount: milestones.filter((m) => m.status === 'paid').reduce((sum, m) => sum + m.amount, 0),
    pendingAmount: milestones
      .filter((m) => m.status === 'pending')
      .reduce((sum, m) => sum + m.amount, 0),
  });
}
