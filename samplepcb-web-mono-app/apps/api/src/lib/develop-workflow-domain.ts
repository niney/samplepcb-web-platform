import { WORK_DOCUMENT_TEMPLATES, WorkState, workPublishedVersion } from '@sp/api-contract';
import type {
  WorkCommandType,
  WorkContextType,
  WorkDocumentType,
  WorkPlanType,
  WorkStateType,
  WorkTaskType,
} from '@sp/api-contract';

export class WorkflowError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const workAssert: (
  condition: unknown,
  code: string,
  message: string,
) => asserts condition = (condition, code, message) => {
  if (!condition) throw new WorkflowError(code, message);
};
export function findWorkDocument(state: WorkStateType, id: string): WorkDocumentType {
  const doc = state.documents.find((d) => d.id === id);
  workAssert(doc, 'DOCUMENT_NOT_FOUND', '문서가 없습니다');
  return doc;
}

export function validateWorkPlan(plan: WorkPlanType, state: WorkStateType): void {
  const ids = new Set(plan.tasks.map((t) => t.id));
  workAssert(ids.size === plan.tasks.length, 'DUPLICATE_TASK', '작업 번호가 중복되었습니다');
  for (const task of plan.tasks) {
    workAssert(
      new Set(task.dependencies).size === task.dependencies.length,
      'DUPLICATE_DEPENDENCY',
      '선행 작업이 중복되었습니다',
    );
    workAssert(
      task.dependencies.every((id) => ids.has(id) && id !== task.id),
      'INVALID_DEPENDENCY',
      '선행 작업이 없거나 자기 자신입니다',
    );
    workAssert(
      task.approvalDocumentIds.every((id) => state.documents.some((d) => d.id === id)),
      'DOCUMENT_NOT_FOUND',
      '연결한 승인 문서가 없습니다',
    );
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    workAssert(!visiting.has(id), 'DEPENDENCY_CYCLE', '선행 작업이 서로 순환합니다');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of plan.tasks.find((t) => t.id === id)?.dependencies ?? []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
}

export function workTaskBlockers(
  task: WorkTaskType,
  plan: WorkPlanType,
  state: WorkStateType,
  context: WorkContextType,
): string[] {
  const blockers: string[] = [];
  for (const id of task.dependencies) {
    const predecessor = plan.tasks.find((t) => t.id === id);
    if (predecessor?.status !== 'completed' && predecessor?.status !== 'skipped')
      blockers.push(`선행 작업: ${predecessor?.title ?? id}`);
  }
  for (const id of task.approvalDocumentIds) {
    const doc = findWorkDocument(state, id);
    const version = workPublishedVersion(doc);
    if (version?.requiresApproval !== true || version.decision?.decision !== 'approved')
      blockers.push(
        `고객 승인: ${version?.title ?? doc.draft?.title ?? WORK_DOCUMENT_TEMPLATES[doc.kind].label}`,
      );
    if (doc.kind === 'change' && version?.quote !== null && version?.quote !== undefined) {
      if (
        !context.quotes.some((q) => q.quoteId === version.quote?.quoteId && q.status === 'accepted')
      )
        blockers.push('변경 견적 수락');
    }
  }
  return blockers;
}

export type WorkflowEffect = 'none' | 'start' | 'deliver' | 'confirm' | 'changes';
export interface WorkReduction {
  state: WorkStateType;
  effect: WorkflowEffect;
}

// 상태와 공개 스냅샷은 이 순수 전이에서만 변경한다. DB revision CAS는 서비스가 맡는다.
export function reduceWorkflow(
  input: WorkStateType,
  command: WorkCommandType,
  context: WorkContextType,
  actor: { admin: boolean; now: string },
): WorkReduction {
  const state = structuredClone(input);
  let effect: WorkflowEffect = 'none';
  workAssert(
    actor.admin || command.type === 'document.decide',
    'FORBIDDEN',
    '고객은 공개 문서에만 응답할 수 있습니다',
  );
  workAssert(
    !['cancelled', 'declined'].includes(context.requestStatus) || command.type === 'disable',
    'REQUEST_CLOSED',
    '종료된 의뢰는 수정할 수 없습니다',
  );
  switch (command.type) {
    case 'enable':
    case 'disable':
      break;
    case 'readiness.save':
      state.materialsReady = command.materialsReady;
      state.materialsNote = command.materialsNote;
      break;
    case 'start':
      workAssert(
        context.requestStatus === 'accepted',
        'INVALID_TRANSITION',
        '견적 수락 후 착수할 수 있습니다',
      );
      workAssert(
        context.contractReady && context.paymentReady && state.materialsReady,
        'NOT_READY',
        '견적 수락·착수금·필수자료 준비를 모두 확인해 주세요',
      );
      effect = 'start';
      break;
    case 'milestone.open': {
      const milestone = context.quotes.filter((q) => q.status === 'accepted').flatMap((q) => q.milestones).find((m) => m.milestoneId === command.milestoneId);
      workAssert(milestone?.trigger === 'manual' && milestone.status === 'pending', 'MILESTONE_NOT_OPENABLE', '수락한 견적의 수동 청구 대기 마일스톤만 열 수 있습니다');
      if (!state.openedMilestoneIds.includes(command.milestoneId)) state.openedMilestoneIds.push(command.milestoneId);
      break;
    }
    case 'plan.save': {
      validateWorkPlan(command.plan, state);
      for (const old of state.plan.tasks) {
        workAssert(
          old.progress === 0 || command.plan.tasks.some((t) => t.id === old.id),
          'TASK_HAS_PROGRESS',
          '진행 이력이 있는 작업은 삭제 대신 제외로 변경해 주세요',
        );
      }
      for (const task of command.plan.tasks) {
        const old = state.plan.tasks.find((t) => t.id === task.id);
        const advances =
          task.status !== 'skipped' &&
          (task.progress > (old?.progress ?? 0) ||
            (task.status === 'in_progress' && old?.status !== 'in_progress') ||
            (task.status === 'completed' && old?.status !== 'completed'));
        if (advances) {
          workAssert(
            context.requestStatus === 'in_progress',
            'START_REQUIRED',
            '관리자 착수 처리 후 작업을 진행해 주세요',
          );
          const blockers = workTaskBlockers(task, command.plan, state, context);
          workAssert(
            blockers.length === 0,
            'TASK_BLOCKED',
            `${task.title}: ${blockers.join(', ')} 확인이 필요합니다`,
          );
        }
      }
      state.plan = command.plan;
      break;
    }
    case 'plan.publish': {
      const visible = state.plan.tasks.filter((t) => t.customerVisible);
      const ids = new Set(visible.map((t) => t.id));
      state.publishedPlan = {
        ...structuredClone(state.plan),
        tasks: visible.map((t) => ({
          ...structuredClone(t),
          dependencies: t.dependencies.filter((id) => ids.has(id)),
          approvalDocumentIds: [],
          assignee: '',
          note: '',
        })),
      };
      state.planPublishedAt = actor.now;
      break;
    }
    case 'document.create': {
      workAssert(
        !state.documents.some((d) => d.id === command.id),
        'DUPLICATE_DOCUMENT',
        '이미 생성된 문서입니다',
      );
      const def = WORK_DOCUMENT_TEMPLATES[command.kind];
      const quote = context.quotes.find((q) => q.status === 'accepted' && q.kind !== 'change');
      workAssert(
        command.kind !== 'contract' || quote,
        'ACCEPTED_QUOTE_REQUIRED',
        '견적 수락 후 계약 문서를 만들 수 있습니다',
      );
      state.documents.push({
        id: command.id,
        kind: command.kind,
        publishedVersion: null,
        versions: [],
        draft: {
          title: `${context.title} · ${def.label}`,
          content: {
            fields: Object.fromEntries(def.fields.map((f) => [f, ''])),
            rows: [],
            checks: [],
          },
          requiresApproval: def.approval,
          quoteId: command.kind === 'contract' ? (quote?.quoteId ?? null) : null,
          dueDate: null,
          fileIds: [],
        },
      });
      break;
    }
    case 'document.save': {
      const doc = findWorkDocument(state, command.id);
      const def = WORK_DOCUMENT_TEMPLATES[doc.kind];
      const draft = command.draft;
      workAssert(
        Object.keys(draft.content.fields).every((key) => def.fields.includes(key)) &&
          draft.content.rows.every((row) =>
            Object.keys(row).every((key) => def.columns.includes(key)),
          ) &&
          draft.content.checks.every((s) => def.checks.includes(s)),
        'INVALID_DOCUMENT_FIELD',
        '서식에 없는 입력 항목입니다',
      );
      workAssert(
        draft.fileIds.every((id) => state.files.some((f) => f.fileId === id)),
        'FILE_NOT_FOUND',
        '이 의뢰의 첨부파일만 연결할 수 있습니다',
      );
      if (doc.kind === 'contract')
        workAssert(
          context.quotes.some(
            (q) => q.quoteId === draft.quoteId && q.status === 'accepted' && q.kind !== 'change',
          ),
          'ACCEPTED_QUOTE_REQUIRED',
          '수락한 기본 견적을 선택해 주세요',
        );
      if (doc.kind === 'change' && draft.quoteId !== null)
        workAssert(
          context.quotes.some((q) => q.quoteId === draft.quoteId && q.kind === 'change'),
          'CHANGE_QUOTE_REQUIRED',
          '추가 견적을 선택해 주세요',
        );
      if (doc.kind === 'delivery')
        workAssert(
          draft.requiresApproval,
          'APPROVAL_REQUIRED',
          '납품 문서는 검수 확인이 필요합니다',
        );
      doc.draft = draft;
      break;
    }
    case 'document.publish': {
      const doc = findWorkDocument(state, command.id);
      const draft = doc.draft;
      workAssert(draft !== null, 'DRAFT_REQUIRED', '작업본이 없습니다');
      const quote =
        draft.quoteId === null ? null : context.quotes.find((q) => q.quoteId === draft.quoteId);
      workAssert(draft.quoteId === null || quote, 'QUOTE_NOT_FOUND', '연결 견적이 없습니다');
      workAssert(
        quote === null || quote === undefined || ['sent', 'accepted'].includes(quote.status),
        'QUOTE_NOT_PUBLIC',
        '발송 또는 수락된 견적만 문서에 공개할 수 있습니다',
      );
      if (doc.kind === 'contract')
        workAssert(
          quote?.status === 'accepted',
          'ACCEPTED_QUOTE_REQUIRED',
          '수락한 견적이 필요합니다',
        );
      if (doc.kind === 'delivery') {
        workAssert(
          ['in_progress', 'delivered'].includes(context.requestStatus),
          'INVALID_TRANSITION',
          '진행 중 또는 검수 중에 납품할 수 있습니다',
        );
        const otherDelivery = state.documents.find(
          (d) => d.id !== doc.id && d.kind === 'delivery' && d.publishedVersion !== null,
        );
        workAssert(
          !otherDelivery,
          'DELIVERY_ALREADY_EXISTS',
          '기존 납품 문서를 수정하고 새 버전으로 공개해 주세요',
        );
        effect = 'deliver';
      }
      const version = (doc.versions.at(-1)?.version ?? 0) + 1;
      doc.versions.push({
        version,
        title: draft.title,
        content: structuredClone(draft.content),
        requiresApproval: draft.requiresApproval,
        dueDate: draft.dueDate,
        files: draft.fileIds.map((id) => {
          const file = state.files.find((f) => f.fileId === id);
          workAssert(file, 'FILE_NOT_FOUND', '첨부파일이 없습니다');
          return { ...file, locked: doc.kind === 'delivery' };
        }),
        quote: quote ?? null,
        plan: doc.kind === 'plan' ? structuredClone(state.publishedPlan) : null,
        publishedAt: actor.now,
        decision: null,
        deliveryEventId: null,
      });
      doc.publishedVersion = version;
      break;
    }
    case 'document.withdraw': {
      const doc = findWorkDocument(state, command.id);
      workAssert(
        doc.kind !== 'delivery' || context.requestStatus !== 'delivered',
        'DELIVERY_IN_REVIEW',
        '검수 중인 납품 문서는 새 버전으로 재납품해 주세요',
      );
      doc.publishedVersion = null;
      break;
    }
    case 'document.restore': {
      const doc = findWorkDocument(state, command.id);
      const version = doc.versions.find((v) => v.version === command.version);
      workAssert(version, 'VERSION_NOT_FOUND', '문서 버전이 없습니다');
      doc.draft = {
        title: version.title,
        content: structuredClone(version.content),
        requiresApproval: version.requiresApproval,
        dueDate: version.dueDate,
        quoteId: version.quote?.quoteId ?? null,
        fileIds: version.files.map((f) => f.fileId),
      };
      break;
    }
    case 'document.decide': {
      workAssert(!actor.admin, 'OWNER_DECISION_REQUIRED', '고객 계정으로 승인해 주세요');
      const doc = findWorkDocument(state, command.id);
      const version = workPublishedVersion(doc);
      workAssert(
        version?.version === command.version,
        'STALE_DOCUMENT',
        '새 문서가 공개되었습니다. 최신 버전을 확인해 주세요',
      );
      workAssert(version.requiresApproval, 'APPROVAL_NOT_REQUESTED', '승인 요청 대상이 아닙니다');
      workAssert(
        version.decision === null,
        'ALREADY_DECIDED',
        '이미 응답한 버전입니다. 담당자가 수정본을 공개하면 다시 응답할 수 있습니다',
      );
      workAssert(
        command.decision === 'approved' || command.note !== '',
        'NOTE_REQUIRED',
        '수정·협의·조건부 승인 내용을 적어 주세요',
      );
      if (doc.kind === 'delivery') {
        workAssert(
          context.requestStatus === 'delivered',
          'INVALID_TRANSITION',
          '검수 중인 납품에만 응답할 수 있습니다',
        );
        effect = command.decision === 'approved' ? 'confirm' : 'changes';
      }
      version.decision = {
        decision: command.decision,
        note: command.note,
        actor: '고객',
        at: actor.now,
      };
      break;
    }
  }
  return { state: WorkState.parse(state), effect };
}

export function publicWorkState(input: WorkStateType, locked: boolean): WorkStateType {
  const state = structuredClone(input);
  const lockedFiles = new Set(state.documents.filter((d) => d.kind === 'delivery').flatMap((d) => workPublishedVersion(d)?.files.map((f) => f.fileId) ?? []));
  state.materialsNote = '';
  state.materialsReady = false;
  state.plan = state.publishedPlan ?? {
    baseStart: null,
    baselineEnd: null,
    forecastEnd: null,
    completedReport: '',
    currentReport: '',
    nextReport: '',
    tasks: [],
  };
  state.documents = state.documents.flatMap((doc) => {
    const published = workPublishedVersion(doc);
    return published === null
      ? []
      : [
          {
            ...doc,
            draft: null,
            versions: [
              {
                ...published,
                files: published.files.map((f) => ({
                  ...f,
                  locked: locked && lockedFiles.has(f.fileId),
                })),
              },
            ],
          },
        ];
  });
  state.files = state.documents.flatMap((d) => d.versions.flatMap((v) => v.files));
  return state;
}
