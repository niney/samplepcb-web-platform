import { PrismaClient } from '@prisma/client';
import { developReviewContentHash, recordDevelopReviewVersion } from '../lib/develop-review-versions';
import { toDevReview } from '../lib/market';

// 검토서 버전 원장 백필(docs/DEVELOP_FLOW.md §6.2) — 원장이 생기기 전 의뢰의 현재 3층(초안·작업본·공개본)을
// 시각 순으로 v1~ 에 옮긴다. **버전이 0개인 의뢰만** 건드린다(idempotent — 두 번 돌려도 같다).
// 실행: pnpm --filter api exec tsx --env-file=.env src/scripts/backfill-develop-review-versions.ts

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const requests = await prisma.spDevelopRequest.findMany({
    where: { reviewVersions: { none: {} } }, // Json null 필터는 Prisma 가 까다로워 코드에서 걸러낸다(3층 전부 null 이면 건너뜀)
    orderBy: { id: 'asc' },
  });
  let requestsDone = 0;
  let versions = 0;
  for (const r of requests) {
    const draft = toDevReview(r.devReviewDraft);
    const working = toDevReview(r.devReview);
    const publicReview = toDevReview(r.devReviewPublic);
    const rows: { at: Date; run: (tx: Parameters<typeof recordDevelopReviewVersion>[0]) => Promise<unknown> }[] = [];
    if (draft !== null) {
      rows.push({
        at: r.devReviewDraftAt ?? r.createdAt,
        run: (tx) =>
          recordDevelopReviewVersion(tx, r.id, {
            kind: 'ai_draft',
            review: draft,
            author: draft.meta.model,
            jobId: r.devReviewDraftJobId,
            inputHash: r.devReviewInputHash,
            createdAt: r.devReviewDraftAt ?? r.createdAt,
            note: '백필',
          }),
      });
    }
    // 작업본이 초안과 같은 내용이면(seed 그대로) 따로 만들지 않는다 — 평소 기록 규칙과 같다.
    if (working !== null && (draft === null || developReviewContentHash(working) !== developReviewContentHash(draft))) {
      rows.push({
        at: r.devReviewEditedAt ?? r.updatedAt,
        run: (tx) =>
          recordDevelopReviewVersion(tx, r.id, {
            kind: 'working',
            review: working,
            author: r.devReviewEditedBy ?? 'system',
            createdAt: r.devReviewEditedAt ?? r.updatedAt,
            note: '백필',
          }),
      });
    }
    if (publicReview !== null) {
      rows.push({
        at: r.devReviewPublishedAt ?? r.updatedAt,
        run: (tx) =>
          recordDevelopReviewVersion(tx, r.id, {
            kind: 'published',
            review: publicReview,
            author: r.devReviewEditedBy ?? 'system',
            createdAt: r.devReviewPublishedAt ?? r.updatedAt,
            note: '백필',
          }),
      });
    }
    if (rows.length === 0) continue;
    rows.sort((a, b) => a.at.getTime() - b.at.getTime());
    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const created = await row.run(tx);
        if (created !== null) versions += 1;
      }
    });
    requestsDone += 1;
    console.log(`request #${String(r.id)}: ${String(rows.length)} 판 기록`);
  }
  console.log(`백필 완료 — 의뢰 ${String(requestsDone)}건, 버전 ${String(versions)}판 (대상 ${String(requests.length)}건)`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
