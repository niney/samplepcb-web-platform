import { z } from 'zod';

export const WORK_DOCUMENT_KINDS = [
  'contract',
  'kickoff',
  'plan',
  'review',
  'production',
  'test',
  'change',
  'delivery',
  'report',
] as const;
export type WorkDocumentKind = (typeof WORK_DOCUMENT_KINDS)[number];
export interface WorkDocumentTemplate {
  label: string;
  description: string;
  approval: boolean;
  fields: readonly string[];
  columns: readonly string[];
  checks: readonly string[];
}
export const WORK_DOCUMENT_TEMPLATES: Record<WorkDocumentKind, WorkDocumentTemplate> = {
  contract: {
    label: '개발계약서',
    description: '수락한 견적의 금액·기간·조건을 기준으로 작성합니다.',
    approval: false,
    fields: ['개발 목적', '상세 수행범위', '고객 제공사항', '착수 조건', '추가 합의사항'],
    columns: [],
    checks: ['날인본 확인', '고객 제공자료 확인'],
  },
  kickoff: {
    label: '개발착수회의록',
    description: '참석자, 결정사항과 완료 기준을 확정합니다.',
    approval: true,
    fields: [
      '회의일·방식',
      '참석자',
      '프로젝트 목표',
      '완료 판단 기준',
      '업무분담',
      '고객 제공사항',
      '위험요소',
      '고객 승인 담당자',
    ],
    columns: ['결정사항', '담당', '완료 예정일'],
    checks: [],
  },
  plan: {
    label: '수행계획서',
    description: '작업 일정과 고객 협조사항을 공유합니다.',
    approval: true,
    fields: ['수행범위', '일정 기준', '고객 선행 조건', '검토 시점', '위험과 대응'],
    columns: ['주요 단계', '산출물', '완료 기준'],
    checks: [],
  },
  review: {
    label: '중간 개발검토서',
    description: '주요 설계사항과 다음 작업을 검토·승인합니다.',
    approval: true,
    fields: [
      '검토 단계',
      '검토 목적',
      '완료한 업무',
      '주요 설계 결정',
      '미확정 사항',
      '고객 결정 요청사항',
      '비용·일정 영향',
      '승인 후 다음 업무',
    ],
    columns: ['검토 항목', '결정사항', '비고'],
    checks: [],
  },
  production: {
    label: '제작 진행 승인서',
    description: '제작 대상과 리비전을 특정하고 발주 전에 확인합니다.',
    approval: true,
    fields: [
      '제작 대상·리비전',
      '제작 수량',
      'PCB 제작사양',
      '부품 조달·지급자재',
      'SMT·조립·검사 범위',
      '예상기간·입고일',
      '제작자료 목록',
      '승인 후 변경 제한',
      '관련 PCB·BOM 주문번호',
    ],
    columns: [],
    checks: [
      '주요 부품 선발주',
      'PCB 제작',
      '전체 부품 발주',
      'SMT·수삽',
      '완제품 조립',
      '시험·검사',
    ],
  },
  test: {
    label: '시제품 시험검토서',
    description: '시험 기준·결과·증빙과 보완계획을 기록합니다.',
    approval: true,
    fields: [
      '시제품 정보·수량',
      '시험 목적·환경',
      '발견된 문제·원인',
      '수정·보완 계획',
      '고객 확인사항',
      '인증·납품 일정',
    ],
    columns: ['시험항목', '기준', '결과', '비고·증빙'],
    checks: [],
  },
  change: {
    label: '변경요청서',
    description: '변경 영향을 검토하고 비용 변경은 추가 견적과 연결합니다.',
    approval: true,
    fields: [
      '요청자·요청일',
      '기존 요구사항',
      '변경 요청내용',
      '변경 사유',
      '기술적 영향',
      '비용 영향',
      '일정 영향',
      '영향받는 납품물',
      '담당자 검토의견',
    ],
    columns: [],
    checks: [],
  },
  delivery: {
    label: '납품 완료확인서',
    description: '납품물과 계약 범위를 대조합니다. 공개하면 기존 납품·검수 흐름에 연결됩니다.',
    approval: true,
    fields: [
      '계약 범위 대비 완료 결과',
      '납품일·방법',
      '미완료·제외 사항',
      '하자보수 범위·기간',
      '유지보수·추가 개발 안내',
    ],
    columns: ['납품물', '파일·제품명과 버전', '확인'],
    checks: [],
  },
  report: {
    label: '정기 진행보고',
    description: '완료 업무, 현재 진행과 다음 일정을 공유합니다.',
    approval: false,
    fields: ['완료 업무', '현재 진행 업무', '다음 예정 업무', '고객 확인사항', '위험·지연 대응'],
    columns: [],
    checks: [],
  },
};

const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/);
export const WorkDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, '올바른 날짜를 입력해 주세요');
export const WorkTask = z
  .object({
    id: Id,
    title: z.string().trim().min(1).max(160),
    assignee: z.string().max(100),
    status: z.enum(['planned', 'in_progress', 'blocked', 'completed', 'skipped']),
    start: WorkDate.nullable(),
    end: WorkDate.nullable(),
    weight: z.number().min(0).max(100),
    progress: z.number().int().min(0).max(100),
    customerVisible: z.boolean(),
    dependencies: z.array(Id).max(100),
    approvalDocumentIds: z.array(Id).max(50),
    note: z.string().max(2000),
  })
  .refine(
    (t) => t.start === null || t.end === null || t.start <= t.end,
    '완료일은 시작일 이후여야 합니다',
  )
  .refine(
    (t) => (t.status === 'completed') === (t.progress === 100),
    '완료 상태와 진행률 100%를 함께 지정해 주세요',
  )
  .refine((t) => t.status !== 'planned' || t.progress === 0, '예정 작업의 진행률은 0%입니다');
export type WorkTaskType = z.infer<typeof WorkTask>;
export const WORK_TASK_LABELS: Record<WorkTaskType['status'], string> = {
  planned: '예정',
  in_progress: '진행 중',
  blocked: '보류',
  completed: '완료',
  skipped: '제외',
};
export const WorkPlan = z.object({
  baseStart: WorkDate.nullable(),
  baselineEnd: WorkDate.nullable(),
  forecastEnd: WorkDate.nullable(),
  completedReport: z.string().max(4000),
  currentReport: z.string().max(4000),
  nextReport: z.string().max(4000),
  tasks: z.array(WorkTask).max(100),
});
export type WorkPlanType = z.infer<typeof WorkPlan>;
export const WorkFile = z.object({
  fileId: z.number().int().positive(),
  name: z.string(),
  size: z.number().nonnegative(),
  locked: z.boolean().default(false),
});
export type WorkFileType = z.infer<typeof WorkFile>;
export const WorkDocumentContent = z.object({
  fields: z
    .record(z.string().max(80), z.string().max(12000))
    .refine((v) => Object.keys(v).length <= 24),
  rows: z
    .array(
      z.record(z.string().max(80), z.string().max(2000)).refine((v) => Object.keys(v).length <= 8),
    )
    .max(100),
  checks: z.array(z.string().max(80)).max(20),
});
export type WorkDocumentContentType = z.infer<typeof WorkDocumentContent>;
export const WorkQuoteSnapshot = z.object({
  quoteId: z.number().int().positive(),
  version: z.number(),
  kind: z.string(),
  status: z.string(),
  title: z.string(),
  supplyAmount: z.number(),
  vatAmount: z.number(),
  totalAmount: z.number(),
  durationDays: z.number().nullable(),
  scheduleNote: z.string().nullable(),
  terms: z.string(),
  exclusions: z.string().nullable(),
  warrantyDays: z.number().nullable(),
  reviewDays: z.number(),
  deliverables: z.array(z.string()),
  acceptedAt: z.string().nullable(),
  acceptedName: z.string().nullable(),
  items: z.array(
    z.object({ title: z.string(), amount: z.number(), description: z.string().nullable() }),
  ),
  milestones: z.array(
    z.object({ milestoneId: z.number().int(), title: z.string(), amount: z.number(), trigger: z.string(), status: z.string() }),
  ),
});
export type WorkQuoteSnapshotType = z.infer<typeof WorkQuoteSnapshot>;
export const WorkDecision = z.object({
  decision: z.enum(['approved', 'changes', 'discuss', 'conditional']),
  note: z.string().max(2000),
  actor: z.string(),
  at: z.string(),
});
export const WORK_DECISION_LABELS = {
  approved: '승인',
  changes: '수정 요청',
  discuss: '협의 요청',
  conditional: '조건부 승인',
} as const;
export const WorkDocumentDraft = z.object({
  title: z.string().trim().min(1).max(200),
  content: WorkDocumentContent,
  requiresApproval: z.boolean(),
  quoteId: z.number().int().positive().nullable(),
  dueDate: WorkDate.nullable(),
  fileIds: z.array(z.number().int().positive()).max(30),
});
export type WorkDocumentDraftType = z.infer<typeof WorkDocumentDraft>;
export const WorkDocumentVersion = z.object({
  version: z.number().int().positive(),
  title: z.string(),
  content: WorkDocumentContent,
  requiresApproval: z.boolean(),
  dueDate: WorkDate.nullable(),
  files: z.array(WorkFile),
  quote: WorkQuoteSnapshot.nullable(),
  plan: WorkPlan.nullable(),
  publishedAt: z.string(),
  decision: WorkDecision.nullable(),
  deliveryEventId: z.number().nullable(),
});
export type WorkDocumentVersionType = z.infer<typeof WorkDocumentVersion>;
export const WorkDocument = z.object({
  id: Id,
  kind: z.enum(WORK_DOCUMENT_KINDS),
  draft: WorkDocumentDraft.nullable(),
  publishedVersion: z.number().int().positive().nullable(),
  versions: z.array(WorkDocumentVersion).max(200),
});
export type WorkDocumentType = z.infer<typeof WorkDocument>;
export const WorkState = z.object({
  schemaVersion: z.literal(1),
  openedMilestoneIds: z.array(z.number().int().positive()).max(1000).default([]),
  materialsReady: z.boolean(),
  materialsNote: z.string().max(4000),
  plan: WorkPlan,
  publishedPlan: WorkPlan.nullable(),
  planPublishedAt: z.string().nullable(),
  documents: z.array(WorkDocument).max(100),
  files: z.array(WorkFile).max(1000),
});
export type WorkStateType = z.infer<typeof WorkState>;
export const WorkContext = z.object({
  title: z.string(),
  customer: z.string(),
  requestStatus: z.string(),
  startedAt: z.string().nullable(),
  contractReady: z.boolean(),
  paymentReady: z.boolean(),
  aiConsent: z.boolean(),
  deliverablesLocked: z.boolean(),
  quotes: z.array(WorkQuoteSnapshot),
});
export type WorkContextType = z.infer<typeof WorkContext>;
export const WorkResponse = z.object({
  result: z.literal(true),
  data: z.object({
    available: z.boolean(),
    enabled: z.boolean(),
    revision: z.number().int(),
    state: WorkState.nullable(),
    context: WorkContext.nullable(),
  }),
});
export type WorkViewType = z.infer<typeof WorkResponse>['data'];

export const WorkCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('enable') }),
  z.object({ type: z.literal('disable') }),
  z.object({
    type: z.literal('readiness.save'),
    materialsReady: z.boolean(),
    materialsNote: z.string().max(4000),
  }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('milestone.open'), milestoneId: z.number().int().positive() }),
  z.object({ type: z.literal('plan.save'), plan: WorkPlan }),
  z.object({ type: z.literal('plan.publish') }),
  z.object({ type: z.literal('document.create'), kind: z.enum(WORK_DOCUMENT_KINDS), id: Id }),
  z.object({ type: z.literal('document.save'), id: Id, draft: WorkDocumentDraft }),
  z.object({ type: z.literal('document.publish'), id: Id }),
  z.object({ type: z.literal('document.withdraw'), id: Id }),
  z.object({ type: z.literal('document.restore'), id: Id, version: z.number().int().positive() }),
  z.object({
    type: z.literal('document.decide'),
    id: Id,
    version: z.number().int().positive(),
    decision: WorkDecision.shape.decision,
    note: z.string().trim().max(2000),
  }),
]);
export type WorkCommandType = z.infer<typeof WorkCommand>;
export const WorkCommandBody = z.object({
  revision: z.number().int().nonnegative(),
  command: WorkCommand,
});
export type WorkCommandBodyType = z.infer<typeof WorkCommandBody>;
export const WorkDraftRequest = z.object({
  documentId: Id,
  input: z.string().trim().min(1).max(24000),
});
export const WorkDraftResponse = z.object({
  result: z.literal(true),
  data: z.object({ text: z.string(), model: z.string() }),
});
export const WorkMailBody = z.object({
  documentId: Id,
  version: z.number().int().positive(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(16000),
});
export const WorkMailResponse = z.object({
  result: z.literal(true),
  data: z.object({ sent: z.boolean() }),
});

export const emptyWorkPlan = (): WorkPlanType => ({
  baseStart: null,
  baselineEnd: null,
  forecastEnd: null,
  completedReport: '',
  currentReport: '',
  nextReport: '',
  tasks: [],
});
export const emptyWorkState = (): WorkStateType => ({
  schemaVersion: 1,
  openedMilestoneIds: [],
  materialsReady: false,
  materialsNote: '',
  plan: emptyWorkPlan(),
  publishedPlan: null,
  planPublishedAt: null,
  documents: [],
  files: [],
});
export function workPublishedVersion(doc: WorkDocumentType): WorkDocumentVersionType | null {
  return doc.versions.find((v) => v.version === doc.publishedVersion) ?? null;
}
export function workProgress(tasks: readonly WorkTaskType[]): number {
  const active = tasks.filter((t) => t.status !== 'skipped');
  const weight = active.reduce((sum, t) => sum + t.weight, 0);
  return weight === 0
    ? 0
    : Math.round(active.reduce((sum, t) => sum + t.weight * t.progress, 0) / weight);
}
export const workDay = (date: string): number =>
  new Date(`${date}T00:00:00Z`).getTime() / 86_400_000;
export function workTimeline(
  tasks: readonly WorkTaskType[],
): { start: string; end: string; days: number } | null {
  const dates = tasks
    .flatMap((t) =>
      t.start !== null && t.end !== null && t.status !== 'skipped' ? [t.start, t.end] : [],
    )
    .sort();
  const start = dates[0];
  const end = dates[dates.length - 1];
  return start === undefined || end === undefined
    ? null
    : { start, end, days: workDay(end) - workDay(start) + 1 };
}

export function workDefaultTasks(areas: readonly string[]): WorkTaskType[] {
  const names = ['착수회의·요구사항 확정'];
  if (areas.includes('circuit')) names.push('시스템 구성·회로설계');
  if (areas.includes('pcb')) names.push('PCB 부품배치·배선');
  if (areas.includes('firmware')) names.push('펌웨어 개발');
  if (areas.includes('mech')) names.push('기구·제품 설계');
  if (areas.includes('app')) names.push('앱 개발');
  if (areas.includes('server')) names.push('서버 개발');
  names.push('시제품 제작·통합시험', '최종 검토·납품');
  return names.map((title, i) => ({
    id: `task-${String(i + 1)}`,
    title,
    assignee: '',
    status: 'planned',
    start: null,
    end: null,
    weight: 10,
    progress: 0,
    customerVisible: true,
    dependencies: [],
    approvalDocumentIds: [],
    note: '',
  }));
}
