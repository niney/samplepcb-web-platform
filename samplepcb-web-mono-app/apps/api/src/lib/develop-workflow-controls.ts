import { prisma } from './prisma';
import { WorkState, workPublishedVersion } from '@sp/api-contract';

// 수행관리는 기본 제공한다. 스키마는 pnpm dev 준비 단계와 운영 배포에서 백업 후 적용한다.
export async function workflowEnrolled(requestId: bigint): Promise<boolean> {
  return (
    (await prisma.spDevelopWorkflow.findUnique({ where: { requestId }, select: { enabled: true } }))
      ?.enabled === true
  );
}

export async function openedWorkflowMilestones(requestId: bigint): Promise<ReadonlySet<number>> {
  const row = await prisma.spDevelopWorkflow.findUnique({ where: { requestId } });
  return new Set(row?.enabled ? WorkState.parse(row.state).openedMilestoneIds : []);
}

export interface WorkflowHint { opened: ReadonlySet<number>; pendingApproval: boolean }
export async function workflowHints(ids: bigint[]): Promise<Map<string, WorkflowHint>> {
  const result = new Map<string, WorkflowHint>();
  if (ids.length === 0) return result;
  const rows = await prisma.spDevelopWorkflow.findMany({ where: { requestId: { in: ids }, enabled: true } });
  for (const row of rows) {
    const state = WorkState.parse(row.state);
    result.set(String(row.requestId), { opened: new Set(state.openedMilestoneIds), pendingApproval: state.documents.some((doc) => { const version = workPublishedVersion(doc); return version?.requiresApproval === true && version.decision === null; }) });
  }
  return result;
}
