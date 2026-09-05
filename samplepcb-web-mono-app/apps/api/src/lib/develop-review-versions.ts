import { createHash } from 'node:crypto';
import type { Prisma, SpDevelopReviewVersion } from '@prisma/client';
import type { DevelopReviewVersionKindType, DevelopReviewVersionMetaType, MarketDevReviewType } from '@sp/api-contract';
import { toDevReview } from './market';

// 검토서 버전 원장(docs/DEVELOP_FLOW.md §6.2) — 3층 컬럼은 현재 포인터, 이 원장은 이력.
// 기록 3순간: AI 초안 완성(runner) · 관리자 저장/초안 가져오기(PUT·reset) · 공개(publish). unpublish 는 기록하지 않는다.
// 중복 규칙: 같은 의뢰의 **직전 버전**과 kind·contentHash 가 모두 같으면 기록하지 않는다(null). kind 가 다르면
// 내용이 같아도 기록한다 — "공개"는 공개한 시각 자체가 사실이다.

type Tx = Prisma.TransactionClient;

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return value === undefined ? 'null' : JSON.stringify(value);
};

/** meta.editedAt/By 를 뺀 키 정렬 JSON 의 sha256 — "내용이 같은가"의 기준. 저장 시각·저장자는 내용이 아니다. */
export function developReviewContentHash(review: MarketDevReviewType): string {
  const meta = Object.fromEntries(Object.entries(review.meta).filter(([key]) => key !== 'editedAt' && key !== 'editedBy'));
  return createHash('sha256').update(canonicalJson({ ...review, meta })).digest('hex');
}

export interface RecordDevelopReviewVersionInput {
  kind: DevelopReviewVersionKindType;
  review: MarketDevReviewType;
  author: string;
  jobId?: string | null;
  inputHash?: string | null;
  parentSeq?: number | null;
  note?: string | null;
  createdAt?: Date; // 백필용 — 평소엔 now
}

/** 트랜잭션 안에서 seq=max+1 로 기록. 직전 버전과 kind·내용이 같으면 기록하지 않고 null. */
export async function recordDevelopReviewVersion(
  tx: Tx,
  requestId: bigint,
  input: RecordDevelopReviewVersionInput,
): Promise<SpDevelopReviewVersion | null> {
  const contentHash = developReviewContentHash(input.review);
  const last = await tx.spDevelopReviewVersion.findFirst({ where: { requestId }, orderBy: { seq: 'desc' } });
  if (last !== null && last.kind === input.kind && last.contentHash === contentHash) return null;
  return tx.spDevelopReviewVersion.create({
    data: {
      requestId,
      seq: (last?.seq ?? 0) + 1,
      kind: input.kind,
      review: input.review,
      contentHash,
      parentSeq: input.parentSeq ?? null,
      author: input.author,
      jobId: input.jobId ?? null,
      inputHash: input.inputHash ?? null,
      note: input.note ?? null,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    },
  });
}

const asKind = (kind: string): DevelopReviewVersionKindType =>
  kind === 'ai_draft' || kind === 'published' ? kind : 'working';

export function toDevelopReviewVersionMeta(row: SpDevelopReviewVersion): DevelopReviewVersionMetaType {
  const review = toDevReview(row.review);
  const summary = review?.summary ?? '';
  return {
    seq: row.seq,
    kind: asKind(row.kind),
    author: row.author,
    model: review?.meta.model ?? '',
    jobId: row.jobId,
    parentSeq: row.parentSeq,
    note: row.note,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
    summary: summary.length > 80 ? `${summary.slice(0, 80)}…` : summary,
    counts: {
      requirements: review?.requirements.length ?? 0,
      questions: review?.openQuestions.length ?? 0,
      phases: review?.schedule?.phases.length ?? 0,
    },
  };
}

/** 현재 3층 JSON 과 같은 내용의 가장 최근 버전 seq — 없으면 null. rows 는 seq 내림차순. */
export function currentDevelopReviewSeqs(
  rows: readonly SpDevelopReviewVersion[],
  layers: { draft: unknown; working: unknown; publicReview: unknown },
): { draftSeq: number | null; workingSeq: number | null; publicSeq: number | null } {
  const find = (json: unknown, kind?: DevelopReviewVersionKindType): number | null => {
    const review = toDevReview(json);
    if (review === null) return null;
    const hash = developReviewContentHash(review);
    return rows.find((r) => r.contentHash === hash && (kind === undefined || r.kind === kind))?.seq ?? null;
  };
  return {
    draftSeq: find(layers.draft, 'ai_draft'),
    workingSeq: find(layers.working),
    publicSeq: find(layers.publicReview, 'published'),
  };
}

/** 고객 상세용 — 지금 공개본과 같은 최근 published 버전의 seq. */
export async function developReviewPublicSeq(tx: Tx | { spDevelopReviewVersion: Tx['spDevelopReviewVersion'] }, requestId: bigint, publicJson: unknown): Promise<number | null> {
  const review = toDevReview(publicJson);
  if (review === null) return null;
  const hash = developReviewContentHash(review);
  const row = await tx.spDevelopReviewVersion.findFirst({
    where: { requestId, kind: 'published', contentHash: hash },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  });
  return row?.seq ?? null;
}
