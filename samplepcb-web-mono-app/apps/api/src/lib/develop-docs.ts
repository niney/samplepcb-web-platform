import { createHash } from 'node:crypto';
import type { SpDevelopDocument, SpDevelopRequest, SpDevelopTask, SpFile } from '@prisma/client';
import { kstToday } from '@sp/utils';
import {
  DEVELOP_DOC_DECISIONS,
  DEVELOP_DOC_STATUSES,
  DEVELOP_DOC_TYPES,
  DEVELOP_DOC_TYPE_LABELS,
  DEVELOP_TASK_PHASES,
  DEVELOP_TASK_STATUSES,
  DevelopDocContent,
  developDocDecisionLabel,
  developDocNo,
  developOverdueTaskCount,
  developProgressSummary,
  isDevelopDocApproval,
} from '@sp/api-contract';
import type {
  AdminDevelopDocumentViewType,
  AdminDevelopOpsType,
  DevelopDocContentType,
  DevelopDocDecisionType,
  DevelopDocStatusType,
  DevelopDocTypeType,
  DevelopDocumentViewType,
  DevelopProgressViewType,
  DevelopTaskPhaseType,
  DevelopTaskStatusType,
  DevelopTaskViewType,
} from '@sp/api-contract';
import { addDevelopEvent, asDevelopStatus, openableMilestoneCount, openedDevelopMilestonesFor } from './develop';
import { toFileMeta } from './market';
import { prisma } from './prisma';

// ── 프로젝트 문서·업무표 공용 헬퍼(docs/DEVELOP_FLOW.md §13) — 회원·관리자 라우트가 공유 ───────────
// 문서 본문은 JSON(계약 DevelopDocContent) — 형태가 어긋난 저장분은 빈 본문으로 읽는다(500 대신 빈 폼).

export const REF_DEVELOP_DOCUMENT = 'sp_develop_document'; // fileType: attachment

const narrow = <T extends string>(values: readonly T[], v: string, fallback: T): T =>
  (values as readonly string[]).includes(v) ? (v as T) : fallback;
const narrowOrNull = <T extends string>(values: readonly T[], v: string | null): T | null =>
  v !== null && (values as readonly string[]).includes(v) ? (v as T) : null;

export const asDocType = (v: string): DevelopDocTypeType => narrow(DEVELOP_DOC_TYPES, v, 'progress_report');
export const asDocStatus = (v: string): DevelopDocStatusType => narrow(DEVELOP_DOC_STATUSES, v, 'draft');
export const asDocDecision = (v: string | null): DevelopDocDecisionType | null => narrowOrNull(DEVELOP_DOC_DECISIONS, v);
export const asTaskPhase = (v: string): DevelopTaskPhaseType => narrow(DEVELOP_TASK_PHASES, v, 'design');
export const asTaskStatus = (v: string): DevelopTaskStatusType => narrow(DEVELOP_TASK_STATUSES, v, 'planned');

export const toDocContent = (json: unknown): DevelopDocContentType => {
  const r = DevelopDocContent.safeParse(json);
  return r.success ? r.data : {};
};

export const developDocTitle = (type: DevelopDocTypeType, seq: number): string => `${developDocNo(type, seq)} ${DEVELOP_DOC_TYPE_LABELS[type]}`;

export const toDevelopDocumentView = (d: SpDevelopDocument, files: readonly SpFile[], isCurrent: boolean): DevelopDocumentViewType => {
  const type = asDocType(d.type);
  return {
    documentId: Number(d.id),
    requestId: Number(d.requestId),
    type,
    seq: d.seq,
    version: d.version,
    docNo: developDocNo(type, d.seq),
    title: d.title,
    status: asDocStatus(d.status),
    approval: isDevelopDocApproval(type),
    content: toDocContent(d.content),
    replyDueOn: d.replyDueOn,
    sentAt: d.sentAt?.toISOString() ?? null,
    decision: asDocDecision(d.decision),
    decisionNote: d.decisionNote,
    decidedAt: d.decidedAt?.toISOString() ?? null,
    decidedName: d.decidedName,
    files: files.map((f) => toFileMeta(f)),
    isCurrent,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
};

export const toAdminDevelopDocumentView = (d: SpDevelopDocument, files: readonly SpFile[], isCurrent: boolean): AdminDevelopDocumentViewType => ({
  ...toDevelopDocumentView(d, files, isCurrent),
  internalNote: d.internalNote,
  mailSubject: d.mailSubject,
  mailBody: d.mailBody,
  createdBy: d.createdBy,
  sentBy: d.sentBy,
});

// 문서 파일 일괄 조회(refType=sp_develop_document) → documentId 별 묶음.
export const developDocumentFiles = async (docIds: readonly bigint[]): Promise<Map<string, SpFile[]>> => {
  const map = new Map<string, SpFile[]>();
  if (docIds.length === 0) return map;
  const rows = await prisma.spFile.findMany({ where: { refType: REF_DEVELOP_DOCUMENT, refId: { in: [...docIds] } }, orderBy: { id: 'asc' } });
  for (const f of rows) {
    const key = f.refId.toString();
    const list = map.get(key) ?? [];
    list.push(f);
    map.set(key, list);
  }
  return map;
};

// 같은 종류·번호의 최신 버전 id 집합 — "현재 판" 배지 근거.
export const currentDocumentIds = (docs: readonly SpDevelopDocument[]): Set<string> => {
  const latest = new Map<string, SpDevelopDocument>();
  for (const d of docs) {
    const key = `${d.type}:${String(d.seq)}`;
    const prev = latest.get(key);
    if (prev === undefined || d.version > prev.version) latest.set(key, d);
  }
  return new Set([...latest.values()].map((d) => d.id.toString()));
};

export interface DevelopDocumentBundle {
  rows: SpDevelopDocument[]; // 종류·번호·버전 순
  files: Map<string, SpFile[]>;
  current: Set<string>;
}
export async function loadDevelopDocuments(requestId: bigint, options: { includeDrafts: boolean }): Promise<DevelopDocumentBundle> {
  const rows = await prisma.spDevelopDocument.findMany({
    where: { requestId, ...(options.includeDrafts ? {} : { status: { not: 'draft' } }) },
    orderBy: [{ type: 'asc' }, { seq: 'asc' }, { version: 'asc' }],
  });
  // 고객에겐 현재 판 판정도 draft 를 뺀 목록 기준 — 관리자가 새 판을 쓰는 중이어도 고객이 보는 최신은 보낸 판이다.
  return { rows, files: await developDocumentFiles(rows.map((d) => d.id)), current: currentDocumentIds(rows) };
}

export const toDevelopTaskView = (t: SpDevelopTask): DevelopTaskViewType => ({
  taskId: Number(t.id),
  seq: t.seq,
  name: t.name,
  phase: asTaskPhase(t.phase),
  status: asTaskStatus(t.status),
  startOn: t.startOn,
  endOn: t.endOn,
  weightBp: t.weightBp,
  progressPct: t.progressPct,
  note: t.note,
  visibleToCustomer: t.visibleToCustomer,
});

export const loadDevelopTasks = (requestId: bigint): Promise<SpDevelopTask[]> =>
  prisma.spDevelopTask.findMany({ where: { requestId }, orderBy: { seq: 'asc' } });

// 업무표 낙관적 잠금 토큰 — 행 id·updatedAt 해시. 행이 하나라도 바뀌면(추가·삭제·수정) 값이 바뀐다. PUT …/tasks 가 대조한다.
export const developTasksRevision = (rows: readonly Pick<SpDevelopTask, 'id' | 'updatedAt'>[]): string => {
  if (rows.length === 0) return 'empty';
  const h = createHash('sha1');
  for (const r of [...rows].sort((a, b) => Number(a.id) - Number(b.id))) h.update(`${r.id.toString()}:${String(r.updatedAt.getTime())};`);
  return h.digest('hex').slice(0, 16);
};

// 진행 현황(00) — 달성도·현재 단계는 업무에서, 계획 일자는 최신 발송 수행계획(plan)에서, 확인 대기는 sent 승인형 문서 수.
// customer=true 면 비공개 업무 행과 제외(skipped) 행을 뺀다(단계 요약·달성도는 전 행 기준 — 숨긴 세부 행도 진행률에는 들어간다).
export function buildDevelopProgress(
  r: SpDevelopRequest,
  tasks: readonly SpDevelopTask[],
  documents: readonly SpDevelopDocument[],
  customer: boolean,
): DevelopProgressViewType {
  const status = asDevelopStatus(r.status);
  const contractDone = status === 'in_progress' || status === 'delivered' || status === 'completed';
  const summary = developProgressSummary(
    tasks.map((t) => ({ phase: asTaskPhase(t.phase), status: asTaskStatus(t.status), weightBp: t.weightBp, progressPct: t.progressPct })),
    contractDone,
  );
  const plans = documents.filter((d) => d.type === 'plan' && d.status !== 'draft' && d.sentAt !== null).sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0));
  const plan = plans[0] === undefined ? {} : toDocContent(plans[0].content);
  const dateOf = (key: string): string | null => {
    const v = plan[key];
    return typeof v === 'string' && v !== '' ? v : null;
  };
  return {
    progressPct: summary.progressPct,
    currentPhase: summary.currentPhase,
    phases: summary.phases,
    tasks: tasks.filter((t) => !customer || (t.visibleToCustomer && t.status !== 'skipped')).map(toDevelopTaskView),
    baseStartOn: dateOf('baseStartOn'),
    plannedEndOn: dateOf('plannedEndOn'),
    expectedEndOn: dateOf('expectedEndOn'),
    pendingApprovals: documents.filter((d) => d.status === 'sent' && isDevelopDocApproval(asDocType(d.type))).length,
    overdueTasks: developOverdueTaskCount(tasks.map((t) => ({ status: asTaskStatus(t.status), endOn: t.endOn })), kstToday()),
    // 고객 응답엔 잠금 토큰이 필요 없다(고객은 업무표를 고치지 못한다).
    tasksRevision: customer ? '' : developTasksRevision(tasks),
  };
}

// 납품확인서 동기화(2026-09-10, G syncWorkflowAutoConfirm 이식) — 검수기간 경과 자동확정·관리자 대행 확정·옛 검수 확정 경로로
// 의뢰가 completed 가 됐는데 sent 로 남은 납품확인서를 '납품 승인'으로 닫는다. 안 닫으면 끝난 건에 확인 대기 배지·회신 기한
// 초과 신호가 계속 켜진다. 문서가 없거나 이미 결정된 판은 no-op. 이벤트(document_decided)만 남기고 메일은 보내지 않는다(완료 메일이 따로 나간다).
export async function closeDeliveryConfirmDocs(
  requestId: bigint,
  by: { decidedName: string; note: string | null; actorMbId: string | null; byAdmin: boolean },
  at: Date,
): Promise<number> {
  const open = await prisma.spDevelopDocument.findMany({ where: { requestId, type: 'delivery_confirm', status: 'sent' } });
  let closed = 0;
  for (const doc of open) {
    const upd = await prisma.spDevelopDocument.updateMany({
      where: { id: doc.id, status: 'sent' },
      data: { status: 'approved', decision: 'approved', decisionNote: by.note, decidedAt: at, decidedName: by.decidedName },
    });
    if (upd.count !== 1) continue;
    closed += 1;
    const docNo = developDocNo('delivery_confirm', doc.seq);
    await addDevelopEvent(prisma, requestId, {
      type: 'document_decided',
      actorMbId: by.actorMbId,
      byAdmin: by.byAdmin,
      title: `${docNo} ${DEVELOP_DOC_TYPE_LABELS.delivery_confirm} — ${developDocDecisionLabel('delivery_confirm', 'approved')}`,
      body: by.note,
      payload: { documentId: Number(doc.id), docNo, type: 'delivery_confirm', decision: 'approved', decidedName: by.decidedName, synced: true },
    });
  }
  return closed;
}

// ── 운영 신호(§14, 관리자 워크큐) — 행마다 진행률·단계·회신 대기·기한·미답변 문의를 한 번의 배치 조회로 파생 ─────
// 문의 판정: comment/as_request 이벤트를 시간순으로 걸어 고객 글(byAdmin=false)이 오면 미답변 +1, 담당자 답변(byAdmin=true comment)이
// 오면 0 으로 — "마지막 답변 뒤에 온 고객 글 수"다. 저장하지 않는다(이벤트가 진실).
export const emptyDevelopOps = (): AdminDevelopOpsType => ({
  progressPct: 0,
  currentPhase: null,
  taskCount: 0,
  pendingApprovals: 0,
  nextReplyDueOn: null,
  replyOverdue: false,
  openInquiries: 0,
  lastInquiry: null,
  overdueTasks: 0,
  paidAmount: 0,
  pendingAmount: 0,
  openableMilestones: 0,
});

export async function developOpsFor(rows: readonly Pick<SpDevelopRequest, 'id' | 'status'>[]): Promise<Map<string, AdminDevelopOpsType>> {
  const map = new Map<string, AdminDevelopOpsType>();
  if (rows.length === 0) return map;
  const ids = rows.map((r) => r.id);
  const [tasks, docs, events, milestones, openedBy] = await Promise.all([
    prisma.spDevelopTask.findMany({ where: { requestId: { in: ids } }, select: { requestId: true, phase: true, status: true, weightBp: true, progressPct: true, endOn: true } }),
    prisma.spDevelopDocument.findMany({ where: { requestId: { in: ids }, status: 'sent' }, select: { requestId: true, type: true, replyDueOn: true } }),
    prisma.spDevelopEvent.findMany({
      where: { requestId: { in: ids }, type: { in: ['comment', 'as_request'] } },
      orderBy: { id: 'asc' },
      select: { requestId: true, type: true, byAdmin: true, title: true, body: true, createdAt: true },
    }),
    // 수납·미수납은 수락 견적의 마일스톤만 합산한다(철회·대체 견적이 미수를 부풀리지 않게 — G 워크스페이스와 같은 규칙).
    prisma.spDevelopMilestone.findMany({
      where: { requestId: { in: ids }, quote: { status: 'accepted' } },
      select: { requestId: true, id: true, status: true, trigger: true, amount: true },
    }),
    openedDevelopMilestonesFor(ids),
  ]);
  const today = kstToday();
  const byReq = <T extends { requestId: bigint }>(list: readonly T[]): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const x of list) {
      const k = x.requestId.toString();
      m.set(k, [...(m.get(k) ?? []), x]);
    }
    return m;
  };
  const tasksBy = byReq(tasks);
  const docsBy = byReq(docs);
  const eventsBy = byReq(events);
  const milestonesBy = byReq(milestones);
  for (const r of rows) {
    const key = r.id.toString();
    const status = asDevelopStatus(r.status);
    const contractDone = status === 'in_progress' || status === 'delivered' || status === 'completed';
    const t = tasksBy.get(key) ?? [];
    const summary = developProgressSummary(
      t.map((x) => ({ phase: asTaskPhase(x.phase), status: asTaskStatus(x.status), weightBp: x.weightBp, progressPct: x.progressPct })),
      contractDone,
    );
    const pending = (docsBy.get(key) ?? []).filter((d) => isDevelopDocApproval(asDocType(d.type)));
    const dues = pending.map((d) => d.replyDueOn).filter((d): d is string => d !== null).sort();
    let openInquiries = 0;
    let lastInquiry: AdminDevelopOpsType['lastInquiry'] = null;
    for (const e of eventsBy.get(key) ?? []) {
      if (e.byAdmin) {
        if (e.type === 'comment') openInquiries = 0;
        continue;
      }
      openInquiries += 1;
      lastInquiry = {
        at: e.createdAt.toISOString(),
        type: e.type === 'as_request' ? 'as_request' : 'comment',
        excerpt: (e.body ?? e.title).replace(/\s+/g, ' ').trim().slice(0, 80),
      };
    }
    const ms = milestonesBy.get(key) ?? [];
    map.set(key, {
      progressPct: summary.progressPct,
      currentPhase: summary.currentPhase,
      taskCount: t.length,
      pendingApprovals: pending.length,
      nextReplyDueOn: dues[0] ?? null,
      replyOverdue: dues.some((d) => d < today),
      openInquiries,
      lastInquiry,
      overdueTasks: developOverdueTaskCount(t.map((x) => ({ status: asTaskStatus(x.status), endOn: x.endOn })), today),
      paidAmount: ms.filter((m) => m.status === 'paid').reduce((a, m) => a + m.amount, 0),
      pendingAmount: ms.filter((m) => m.status === 'pending').reduce((a, m) => a + m.amount, 0),
      openableMilestones: openableMilestoneCount(ms, openedBy.get(key) ?? new Set<number>()),
    });
  }
  return map;
}

// 고객이 답할 승인형 문서가 있나(nextAction answer_document).
export const hasPendingDocumentDecision = (documents: readonly SpDevelopDocument[]): boolean =>
  documents.some((d) => d.status === 'sent' && isDevelopDocApproval(asDocType(d.type)));
