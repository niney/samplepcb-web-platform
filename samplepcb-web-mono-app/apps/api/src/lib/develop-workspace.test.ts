import { describe, expect, it } from 'vitest';
import { emptyWorkState } from '@sp/api-contract';
import { toWorkspaceItem } from './develop-workspace';
import type { WorkspaceRow } from './develop-workspace';

function fixture(): WorkspaceRow {
  return {
    id: 1n,
    title: '프로젝트',
    status: 'in_progress',
    contactName: '고객',
    contactCompany: null,
    assigneeMbId: null,
    updatedAt: new Date('2026-09-08T00:00:00Z'),
    deliveredAt: null,
    reviewDays: 7,
    workflow: {
      enabled: true,
      state: emptyWorkState(),
      updatedAt: new Date('2026-09-09T00:00:00Z'),
    },
    quotes: [],
  };
}
describe('개발 업무 목록 요약', () => {
  it('과거 승인 대신 현재 공개 버전의 응답을 표시하고 본문은 보내지 않는다', () => {
    const row = fixture();
    const state = emptyWorkState();
    const version = {
      version: 1,
      title: '현재 검토서',
      content: { fields: { confidential: 'private' }, rows: [], checks: [] },
      requiresApproval: true,
      dueDate: null,
      files: [],
      quote: null,
      plan: null,
      publishedAt: '2026-09-08T00:00:00Z',
      decision: null,
      deliveryEventId: null,
    };
    state.documents.push({
      id: 'review',
      kind: 'review',
      draft: null,
      publishedVersion: 2,
      versions: [
        {
          ...version,
          decision: {
            decision: 'approved',
            note: '이전 승인',
            actor: '고객',
            at: '2026-09-08T01:00:00Z',
          },
        },
        { ...version, version: 2 },
      ],
    });
    if (row.workflow) row.workflow.state = state;
    const result = toWorkspaceItem(row);
    expect(result.pendingApprovals).toBe(1);
    expect(result.documents[0]).toMatchObject({
      status: 'pending',
      publishedVersion: 2,
      decision: null,
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(result.updatedAt).toBe('2026-09-09T00:00:00.000Z');
  });
  it('한국 날짜를 기준으로 진행 중인 미완료 작업만 지연 집계한다', () => {
    const row = fixture();
    const state = emptyWorkState();
    const task = {
      id: 'late',
      title: '설계',
      assignee: '',
      status: 'in_progress' as const,
      start: null,
      end: '2026-09-09',
      weight: 50,
      progress: 20,
      customerVisible: true,
      dependencies: [],
      approvalDocumentIds: [],
      note: '',
    };
    state.plan.tasks = [
      task,
      { ...task, id: 'done', status: 'completed', progress: 100 },
      { ...task, id: 'skip', status: 'skipped', progress: 0 },
    ];
    if (row.workflow) row.workflow.state = state;
    expect(toWorkspaceItem(row, new Date('2026-09-09T14:59:00Z')).overdueTasks).toBe(0);
    const nextDay = toWorkspaceItem(row, new Date('2026-09-09T15:00:00Z'));
    expect(nextDay).toMatchObject({
      overdueTasks: 1,
      taskCount: 2,
      completedTasks: 1,
      progress: 60,
    });
    row.status = 'cancelled';
    expect(toWorkspaceItem(row).overdueTasks).toBe(0);
    row.status = 'in_progress';
    if (row.workflow) row.workflow.enabled = false;
    expect(toWorkspaceItem(row)).toMatchObject({ overdueTasks: 0, pendingApprovals: 0 });
  });
  it('수락한 견적의 실제 수납과 미수납만 합산하고 폐기 계획은 제외한다', () => {
    const row = fixture();
    const quote = {
      id: 1n,
      version: 1,
      title: '개발비',
      status: 'accepted',
      totalAmount: 300,
      milestones: [
        {
          id: 1n,
          title: '착수금',
          amount: 100,
          status: 'paid',
          trigger: 'on_accept',
          paidAt: new Date(),
        },
        { id: 2n, title: '잔금', amount: 200, status: 'pending', trigger: 'manual', paidAt: null },
        {
          id: 3n,
          title: '취소분',
          amount: 300,
          status: 'cancelled',
          trigger: 'manual',
          paidAt: null,
        },
      ],
    };
    row.quotes = [quote, { ...quote, id: 2n, version: 2, status: 'superseded' }];
    expect(toWorkspaceItem(row)).toMatchObject({ paidAmount: 100, pendingAmount: 200 });
  });
  it('수행관리 전 의뢰도 과장된 진행률 없이 표시한다', () => {
    const row = fixture();
    row.workflow = null;
    expect(toWorkspaceItem(row)).toMatchObject({
      workflowEnabled: false,
      progress: null,
      taskCount: 0,
      documents: [],
    });
  });
});
