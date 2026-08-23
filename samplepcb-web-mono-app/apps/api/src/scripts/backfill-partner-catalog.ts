import { prisma } from '../lib/prisma';
import { projectPartnerPartsToCatalog } from '../lib/partner-parts';

// 협력사 보유 부품 원장 → 카탈로그 백필(docs/PARTNER_PARTS.md).
//
// 투영은 반영·수정·토글 시점에 자동으로 돈다. 이 스크립트는 **투영을 도입하기 전에 올린
// 원장**을 한 번 따라잡게 하는 용도다. 멱등하므로 몇 번을 돌려도 결과가 같다.
//
//   pnpm --dir apps/api backfill:partner-catalog            (전체)
//   pnpm --dir apps/api backfill:partner-catalog -- --partner 8
//
// `sp_part` 는 만들기만 하고 지우지 않는다 — 견적 행이 partId 로 참조하고 있고, 같은
// 품번이 다시 올라오면 그 행을 재사용한다. 협력사 구매 조건만 남은 부품은 색인되지
// 않으므로 검색 품질에 영향이 없다.

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const partnerArg = args.indexOf('--partner');
  const only = partnerArg >= 0 ? args[partnerArg + 1] : undefined;

  const partners = await prisma.spPartnerPart.groupBy({
    by: ['partnerId'],
    where: only === undefined ? {} : { partnerId: BigInt(only) },
    _count: { _all: true },
  });
  if (partners.length === 0) {
    console.log('대상 원장이 없습니다.');
    return;
  }

  for (const group of partners) {
    const partner = await prisma.spPartner.findUnique({
      where: { id: group.partnerId },
      select: { name: true },
    });
    const startedAt = Date.now();
    const result = await projectPartnerPartsToCatalog(group.partnerId);
    console.log(
      `#${String(group.partnerId)} ${partner?.name ?? '(이름 없음)'} — 원장 ${String(group._count._all)}행 `
      + `→ 구매 조건 ${String(result.offers)}건 반영 · ${String(result.removed)}건 정리 · 색인 ${String(result.indexed)}건 `
      + `(${String(Math.round((Date.now() - startedAt) / 1000))}초)`,
    );
  }

  // 결과 확인 — 구매 조건이 하나도 없는 껍데기는 색인에 남아 있으면 안 된다(§1.5).
  // 협력사만 가진 부품은 **색인된다** — 품번으로 찾혀야 하고, broad 질의는 partnerOnly 로 뺀다.
  const leaked = await prisma.spPart.count({
    where: { indexedAt: { not: null }, offers: { none: {} } },
  });
  console.log(leaked === 0
    ? '검증 — 구매 조건 없는 껍데기 중 색인된 것 0건'
    : `⚠ 껍데기 ${String(leaked)}건이 색인돼 있습니다 — parts-reindex 로 정리하세요`);
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
