// 부품 카탈로그 ES 전량 재색인 — DB(sp_part*)가 진실원본, ES 는 언제든 재구축 가능.
// 사용: pnpm --filter api parts:reindex            (인덱스 보존, 문서만 재색인)
//       pnpm --filter api parts:reindex --recreate (v1 삭제 후 재생성 — 매핑 변경 반영)
// 운영 무중단 전환은 v2 인덱스 + alias 스왑으로(docs/PARTS_SEARCH.md).
import { prisma } from '../lib/prisma';
import { esClient } from '../es/client';
import { SP_PARTS_READ, bootstrapPartsIndex, recreatePartsIndex } from '../es/sp-parts-index';
import { buildPartDoc, bulkIndexPartDocs } from '../lib/parts-es';

const log = {
  info: (m: string): void => {
    console.log(m);
  },
  warn: (m: string): void => {
    console.warn(m);
  },
};

async function main(): Promise<void> {
  if (process.argv.includes('--recreate')) await recreatePartsIndex(log);
  else await bootstrapPartsIndex(log);

  let cursor: bigint | undefined;
  let total = 0;
  let failed = 0;
  for (;;) {
    const parts = await prisma.spPart.findMany({
      take: 500,
      ...(cursor === undefined ? {} : { skip: 1, cursor: { id: cursor } }),
      orderBy: { id: 'asc' },
      include: { offers: { include: { priceBreaks: true } } },
    });
    if (parts.length === 0) break;
    failed += await bulkIndexPartDocs(parts.map(buildPartDoc));
    total += parts.length;
    cursor = parts.at(-1)?.id;
    log.info(`... ${String(total)}건 색인`);
  }

  await esClient().indices.refresh({ index: SP_PARTS_READ });
  const count = await esClient().count({ index: SP_PARTS_READ });
  log.info(`재색인 완료: DB ${String(total)}건 → ES ${String(count.count)}건 (bulk 실패 ${String(failed)})`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
