// 컷오버 전 신규 DB 의 **테스트 거래 데이터** 정리(계획 §절차 P3) — 회원/설정/게시판은 남긴다.
//
// 삭제 범위(거래 계열만): sp_order_spec · sp_quote · sp_file(ref_type='sp_order_spec') ·
//   g5_shop_cart(견적 규약 행: io_id=sp_quote.id 또는 it_id=템플릿) · g5_shop_item_option(동일 기준) ·
//   g5_shop_order(위 cart 가 참조하던 주문) — 전부 **목록 출력 후 --yes 에서만 실행**.
//
// 실행: pnpm migrate:wipe            → 대상 목록만 출력(안전)
//       pnpm migrate:wipe -- --yes   → 실제 삭제
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { TEMPLATE_ITEMS } from '../../lib/g5-db';
import { G5Writer } from './lib/g5-writer';
import { asStr } from './lib/util';

async function main(): Promise<void> {
  // pnpm run 이 '--' 구분 토큰까지 전달하므로 걸러낸다(파싱 시 위치 인자 오인 방지)
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const { values } = parseArgs({ args, options: { yes: { type: 'boolean', default: false } } });
  const g5 = new G5Writer();
  const prisma = new PrismaClient();
  try {
    console.log(`══ 테스트 거래 데이터 정리 — 타깃 DB: ${g5.dbName} ══`);

    const quotes = await prisma.spQuote.findMany({ select: { id: true, priceVersion: true } });
    const specs = await prisma.spOrderSpec.findMany({
      select: { id: true, projectName: true, quoteStatus: true, ctId: true },
    });
    const files = await prisma.spFile.findMany({
      where: { refType: 'sp_order_spec' },
      select: { id: true, originFileName: true },
    });
    const templateIds = Object.values(TEMPLATE_ITEMS);
    const quoteIds = quotes.map((q) => q.id);
    const inQuote = quoteIds.length > 0 ? quoteIds.map(() => '?').join(', ') : "''";
    const inTmpl = templateIds.map(() => '?').join(', ');

    const carts = await g5.select(
      `SELECT ct_id, od_id, it_name, ct_status FROM g5_shop_cart
        WHERE io_id IN (${inQuote}) OR it_id IN (${inTmpl})`,
      [...quoteIds, ...templateIds],
    );
    const odIds = [...new Set(carts.map((c) => asStr(c.od_id)).filter((s) => /^\d{10,}$/.test(s)))];
    const orders =
      odIds.length === 0
        ? []
        : await g5.select(
            `SELECT od_id, od_status, od_name FROM g5_shop_order WHERE od_id IN (${odIds.map(() => '?').join(', ')})`,
            odIds,
          );
    const options = await g5.select(
      `SELECT io_id, it_id FROM g5_shop_item_option WHERE io_id IN (${inQuote}) OR it_id IN (${inTmpl})`,
      [...quoteIds, ...templateIds],
    );

    console.log(`  sp_order_spec: ${String(specs.length)}건`);
    for (const s of specs.slice(0, 20)) {
      console.log(`    - #${String(s.id)} ${s.projectName} (${s.quoteStatus}, ctId=${String(s.ctId ?? '-')})`);
    }
    console.log(`  sp_quote: ${String(quotes.length)}건 · sp_file: ${String(files.length)}건`);
    console.log(`  g5_shop_cart(견적 규약 행): ${String(carts.length)}건 · 옵션행: ${String(options.length)}건`);
    console.log(`  g5_shop_order(연결 주문): ${String(orders.length)}건`);
    for (const o of orders) console.log(`    - ${asStr(o.od_id)} ${asStr(o.od_status)} ${asStr(o.od_name)}`);

    if (!values.yes) {
      console.log('\n(목록 확인용 — 실제 삭제는 --yes)');
      return;
    }

    // 삭제(논리 순서: 파일 → spec → quote → cart/옵션 → 주문). 실파일은 파기하지 않는다
    // (파일서버 삭제는 별도 판단 — 테스트 파일은 demo serviceType 이므로 방치 무해).
    await prisma.spFile.deleteMany({ where: { refType: 'sp_order_spec' } });
    await prisma.spOrderSpec.deleteMany({});
    await prisma.spQuote.deleteMany({});
    if (carts.length > 0) {
      await g5.execute(
        `DELETE FROM g5_shop_cart WHERE io_id IN (${inQuote}) OR it_id IN (${inTmpl})`,
        [...quoteIds, ...templateIds],
      );
    }
    await g5.execute(
      `DELETE FROM g5_shop_item_option WHERE io_id IN (${inQuote}) OR it_id IN (${inTmpl})`,
      [...quoteIds, ...templateIds],
    );
    if (odIds.length > 0) {
      await g5.execute(
        `DELETE FROM g5_shop_order WHERE od_id IN (${odIds.map(() => '?').join(', ')})`,
        odIds,
      );
    }
    console.log('삭제 완료. (sp_member_profile·회원·게시판·설정은 보존)');
  } finally {
    await Promise.allSettled([g5.end(), prisma.$disconnect()]);
  }
}

await main();
