import { z } from 'zod';
import {
  MARKET_BUDGET_RANGE_LABELS,
  MARKET_REVISION_FIELD_LABELS,
  MarketAnswers,
  MarketTools,
  isMajorMarketRevision,
  marketAnswerText,
  marketAreaLabel,
  marketQuestion,
  sortMarketAreas,
} from '@sp/api-contract';
import type {
  MarketAnswerType,
  MarketRevisionChangeType,
  MarketRevisionFieldType,
  MarketToolsType,
} from '@sp/api-contract';
import type { Prisma, SpMarketProject } from '@prisma/client';
import { kstDateTimeStr } from './kst';
import { toAnswers, toAreaCodes, toTools } from './market';
import { prisma } from './prisma';

// ── 의뢰 수정 이력(docs/MARKET_FLOW.md §의뢰 수정·버전) ─────────────────────────
// 수정 직전 값을 한 덩어리(snapshot)로 남기고, 이전↔현재를 견줘 "무엇이 바뀌었나"를 만든다.
// 화면은 diff 를 계산하지 않는다 — 이력 목록은 서버가 조립한 사람 읽는 문자열만 받는다.
// 첨부는 개수만 담는다: 파일명은 NDA 게이트 뒤에 있는 정보라 이력에 실으면 게이트가 새는 셈이다.

export const MarketProjectSnapshot = z.object({
  title: z.string(),
  serviceAreas: z.array(z.string()),
  tools: MarketTools,
  description: z.string(),
  answers: MarketAnswers,
  budgetRange: z.string(),
  ndaRequired: z.boolean(),
  bidDeadlineAt: z.string(), // ISO
  attachmentCount: z.number().int(),
});
export type MarketProjectSnapshotType = z.infer<typeof MarketProjectSnapshot>;

export function snapshotOfProject(
  project: SpMarketProject,
  attachmentCount: number,
): MarketProjectSnapshotType {
  return {
    title: project.title,
    serviceAreas: toAreaCodes(project.serviceAreas),
    tools: toTools(project.tools),
    description: project.description,
    answers: toAnswers(project.answers),
    budgetRange: project.budgetRange,
    ndaRequired: project.ndaRequired,
    bidDeadlineAt: project.bidDeadlineAt.toISOString(),
    attachmentCount,
  };
}

// 저장분 파싱 — 옛 행·손상 행은 빈 스냅샷으로 떨어뜨린다(이력 한 줄이 안 보일 뿐 목록은 산다).
export function parseSnapshot(value: Prisma.JsonValue | null): MarketProjectSnapshotType | null {
  const parsed = MarketProjectSnapshot.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// ── 사람이 읽는 값 ───────────────────────────────────────────────────────────
const areasText = (codes: readonly string[]): string =>
  codes.length === 0 ? '없음' : sortMarketAreas(codes).map(marketAreaLabel).join(' · ');

const toolsText = (tools: MarketToolsType): string => {
  const entries = Object.entries(tools.byArea).filter(([, codes]) => codes.length > 0);
  if (entries.length === 0) return '전문가 추천';
  return entries.map(([area, codes]) => `${marketAreaLabel(area)}: ${codes.join(', ')}`).join(' · ');
};

const answerKey = (a: MarketAnswerType): string => `${a.code}=${[...a.choices].sort().join(',')}|${a.note?.trim() ?? ''}`;
const answerText = (a: MarketAnswerType): string => `${marketQuestion(a.code)?.short ?? a.code}: ${marketAnswerText(a)}`;

// 답변은 전체를 늘어놓지 않고 **바뀐 문항만** 견준다(6~10문항 중 한둘만 바뀌는 것이 보통).
function answerDiff(before: readonly MarketAnswerType[], after: readonly MarketAnswerType[]): { before: string; after: string } | null {
  const beforeMap = new Map(before.map((a) => [a.code, a]));
  const afterMap = new Map(after.map((a) => [a.code, a]));
  const codes = [...new Set([...beforeMap.keys(), ...afterMap.keys()])];
  const changed = codes.filter((c) => {
    const b = beforeMap.get(c);
    const a = afterMap.get(c);
    if (b === undefined || a === undefined) return true;
    return answerKey(b) !== answerKey(a);
  });
  if (changed.length === 0) return null;
  const side = (map: Map<string, MarketAnswerType>): string =>
    changed
      .map((c) => {
        const a = map.get(c);
        return a === undefined ? `${marketQuestion(c)?.short ?? c}: (없음)` : answerText(a);
      })
      .join(' · ');
  return { before: side(beforeMap), after: side(afterMap) };
}

const budgetText = (code: string): string =>
  (MARKET_BUDGET_RANGE_LABELS as Record<string, string>)[code] ?? code;

const label = (field: MarketRevisionFieldType): string => MARKET_REVISION_FIELD_LABELS[field];

// ── diff ────────────────────────────────────────────────────────────────────
export interface MarketRevisionDiff {
  changedFields: MarketRevisionFieldType[];
  changes: MarketRevisionChangeType[];
  major: boolean;
}

export function diffProjectSnapshots(
  before: MarketProjectSnapshotType,
  after: MarketProjectSnapshotType,
): MarketRevisionDiff {
  const changes: MarketRevisionChangeType[] = [];
  const push = (field: MarketRevisionFieldType, b: string, a: string): void => {
    if (b === a) return;
    changes.push({ field, label: label(field), before: b, after: a });
  };

  push('title', before.title, after.title);
  push('serviceAreas', areasText(before.serviceAreas), areasText(after.serviceAreas));
  push('tools', toolsText(before.tools), toolsText(after.tools));
  push('description', before.description, after.description);
  const answers = answerDiff(before.answers, after.answers);
  if (answers !== null) {
    changes.push({ field: 'answers', label: label('answers'), before: answers.before, after: answers.after });
  }
  push('budgetRange', budgetText(before.budgetRange), budgetText(after.budgetRange));
  push('ndaRequired', before.ndaRequired ? '필요' : '불필요', after.ndaRequired ? '필요' : '불필요');
  push('deadline', kstDateTimeStr(new Date(before.bidDeadlineAt)), kstDateTimeStr(new Date(after.bidDeadlineAt)));
  push('attachments', `${String(before.attachmentCount)}개`, `${String(after.attachmentCount)}개`);

  const changedFields = changes.map((c) => c.field as MarketRevisionFieldType);
  return { changedFields, changes, major: isMajorMarketRevision(changedFields) };
}

// ── 기록 ────────────────────────────────────────────────────────────────────
// 수정과 **같은 트랜잭션**에서 부른다(이력 없는 수정이 생기지 않게). 바뀐 값이 없으면 행을 만들지 않는다 —
// "저장만 누른" 수정이 v2, v3 으로 쌓여 입찰자 경고를 울리는 것을 막는다.
type RevisionTx = Pick<Prisma.TransactionClient, 'spMarketProjectRevision'>;

export async function writeProjectRevision(
  tx: RevisionTx,
  projectId: bigint,
  actorMbId: string,
  byOwner: boolean,
  before: MarketProjectSnapshotType,
  after: MarketProjectSnapshotType,
): Promise<{ revNo: number; major: boolean; changedFields: MarketRevisionFieldType[] } | null> {
  const diff = diffProjectSnapshots(before, after);
  if (diff.changedFields.length === 0) return null;
  const last = await tx.spMarketProjectRevision.findFirst({
    where: { projectId },
    orderBy: { revNo: 'desc' },
    select: { revNo: true },
  });
  const revNo = (last?.revNo ?? 0) + 1;
  await tx.spMarketProjectRevision.create({
    data: {
      projectId,
      revNo,
      actorMbId,
      byOwner,
      major: diff.major,
      changedFields: diff.changedFields,
      snapshot: before,
    },
  });
  return { revNo, major: diff.major, changedFields: diff.changedFields };
}

// ── AI 사전 검토서 stale 판정 ────────────────────────────────────────────────
// 검토서의 원천은 제목·분야·설명·답변·참고 자료다(예산·마감·NDA·툴은 프롬프트에 안 들어간다 — §13.10).
// 그 다섯 중 하나라도 검토서 생성 뒤에 바뀌었으면 "v1 기준" 배지를 세운다(삭제하지 않는다).
const REVIEW_SOURCE_FIELDS: readonly string[] = ['title', 'serviceAreas', 'description', 'answers', 'attachments'];

export function isDevReviewStale(
  review: { meta: { generatedAt: string } } | null,
  revisions: readonly { createdAt: Date; changedFields: Prisma.JsonValue }[],
): boolean {
  if (review === null) return false;
  const generatedAt = new Date(review.meta.generatedAt).getTime();
  if (Number.isNaN(generatedAt)) return false;
  return revisions.some((r) => {
    if (r.createdAt.getTime() <= generatedAt) return false;
    const fields = Array.isArray(r.changedFields) ? r.changedFields : [];
    return fields.some((f) => typeof f === 'string' && REVIEW_SOURCE_FIELDS.includes(f));
  });
}

// 여러 프로젝트의 마지막 중대 수정 시각 — 내 견적 목록(N+1 회피).
export async function lastMajorRevisionMap(projectIds: readonly bigint[]): Promise<Map<string, Date>> {
  if (projectIds.length === 0) return new Map();
  const rows = await prisma.spMarketProjectRevision.groupBy({
    by: ['projectId'],
    where: { projectId: { in: [...projectIds] }, major: true },
    _max: { createdAt: true },
  });
  const out = new Map<string, Date>();
  for (const r of rows) {
    if (r._max.createdAt !== null) out.set(String(r.projectId), r._max.createdAt);
  }
  return out;
}
