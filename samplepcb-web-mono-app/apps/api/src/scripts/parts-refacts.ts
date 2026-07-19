import { prisma } from '../lib/prisma';
import { applyPartFacts, tryIndexPart } from '../lib/parts-ingest';
import { bootstrapPartsIndex } from '../es/sp-parts-index';

// 전 부품 정본 재계산 백필 — resolvePartFacts(스펙 병합·충돌) + deriveSamplepcbOffer
// (자체 오퍼) 를 기존 카탈로그 전체에 적용하고 재색인한다. idempotent — 몇 번을
// 돌려도 같은 결과. 사용: pnpm --filter @sp/api parts:refacts

async function main(): Promise<void> {
  await bootstrapPartsIndex(console); // hasSpecConflict 등 신규 필드 putMapping(additive)

  const parts = await prisma.spPart.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  console.log(`부품 ${String(parts.length)}건 정본 재계산 시작`);

  let done = 0;
  let indexed = 0;
  let queued = 0;
  for (const { id } of parts) {
    await applyPartFacts(id);
    if (await tryIndexPart(id)) indexed += 1;
    else queued += 1;
    done += 1;
    if (done % 500 === 0) console.log(`  ${String(done)}/${String(parts.length)} 처리`);
  }

  const conflicts = await prisma.spPart.count({ where: { specConflicts: { not: { equals: null } } } });
  const derived = await prisma.spPartOffer.count({ where: { supplier: 'samplepcb' } });
  console.log(
    `완료: ${String(done)}건 (색인 ${String(indexed)} · 큐 ${String(queued)}) — 스펙 충돌 ${String(conflicts)}건 · samplepcb 오퍼 ${String(derived)}건`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
