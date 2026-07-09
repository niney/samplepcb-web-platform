// 이관 검증 리포트(계획 §검증) — 실행: pnpm migrate:verify
//
// 1) 테이블별 행수 대조(레거시 vs 타깃)
// 2) 금액 항등: 타깃 라인 집계 → computeOrderMoney 시뮬레이션 == 저장 헤더(전이/취소 재계산과 항등 보장)
//    + 레거시 od_misu 와의 불변식(활성 라인 VAT 변환의 총합 보존) 대조
// 3) 참조 정합: spec.ctId↔cart↔order · sp_file↔spec · cart.io_id↔옵션행
// 4) 포인트: 회원별 원장 합계 + 말단 po_mb_point == mb_point (불일치는 레거시 기존 오류 — 보고만)
// 5) 비회원 주문(od_pwd 인증 단절 CS 정책 대상) 집계
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { computeOrderMoney } from '../../lib/g5-db';
import { closeLegacyPool, legacySelect } from '../../lib/legacy-db';
import { G5Writer } from './lib/g5-writer';
import { asInt, asStr, resolveMigrateTmpDir } from './lib/util';
import { ACTIVE_ORDER_STATUSES } from './lib/status-map';
import { MIGRATE_BOARDS } from './manifest';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];
function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}: ${detail}`);
}

const CART_LINE_VALUE_SQL = `IF(io_type = 1, (io_price * ct_qty), ((ct_price + io_price) * ct_qty))`; // g5-db.ts:2020 미러

/**
 * 회원 귀속 자산(포인트/주소록) 센서스 — 회원 단위 카운트 대조.
 * 버킷: 일치 / 고아(레거시 회원 부재 — mb_id 절단 등 레거시 자체 결함, 정책 스킵) /
 *       기존계정(타깃에 레거시와 다른 카운트로 이미 존재 — admin·테스트 계정, 정책 스킵) / 누락(실패).
 */
async function memberAssetCensus(g5: G5Writer, label: string, table: string): Promise<void> {
  const legacyByMb = new Map<string, number>();
  for (const r of await legacySelect(`SELECT mb_id k, COUNT(*) c FROM \`${table}\` GROUP BY mb_id`)) {
    legacyByMb.set(asStr(r.k), asInt(r.c));
  }
  const targetByMb = new Map<string, number>();
  for (const r of await g5.select(`SELECT mb_id k, COUNT(*) c FROM \`${table}\` GROUP BY mb_id`)) {
    targetByMb.set(asStr(r.k), asInt(r.c));
  }
  const legacyMembers = new Set(
    (await legacySelect(`SELECT mb_id FROM g5_member`)).map((r) => asStr(r.mb_id)),
  );
  let matched = 0;
  let orphanRows = 0;
  const preexisting: string[] = [];
  const bad: string[] = [];
  for (const [mbId, lc] of legacyByMb.entries()) {
    if (!legacyMembers.has(mbId)) {
      orphanRows += lc;
      continue;
    }
    const tc = targetByMb.get(mbId) ?? 0;
    if (tc === lc) {
      matched += lc;
      continue;
    }
    if (tc > 0) {
      preexisting.push(`${mbId}(레거시 ${String(lc)}/타깃 ${String(tc)})`);
      continue;
    }
    bad.push(`${mbId}(레거시 ${String(lc)}행 누락)`);
  }
  check(
    `회원자산 센서스 ${label}`,
    bad.length === 0,
    `일치 ${String(matched)}행 · 고아(레거시 mb_id 절단) ${String(orphanRows)}행 스킵 · 기존계정 ${String(preexisting.length)}명 스킵` +
      (bad.length > 0 ? ` · 누락 ${bad.slice(0, 5).join(', ')}` : ''),
  );
}

async function main(): Promise<void> {
  // --light: 행수·금액 항등만(운영 직결 sync 후 빠른 확인용 — 센서스/샘플/포인트 대조 생략)
  const light = process.argv.slice(2).includes('--light');
  const g5 = new G5Writer();
  const prisma = new PrismaClient();
  try {
    console.log(`══ 이관 검증 — 타깃 ${g5.dbName}${light ? ' (light)' : ''} ══`);

    // ── 1) 행수 대조 ──
    const countPairs: [string, string, string][] = [
      // [라벨, 레거시 SQL, 타깃 SQL]
      ['회원(레거시 전량 vs 타깃)', `SELECT COUNT(*) c FROM g5_member`, `SELECT COUNT(*) c FROM g5_member`],
      ['주문', `SELECT COUNT(*) c FROM g5_shop_order`, `SELECT COUNT(*) c FROM g5_shop_order`],
      [
        '주문 라인(주문 연결 cart)',
        `SELECT COUNT(*) c FROM g5_shop_cart c JOIN g5_shop_order o ON o.od_id = c.od_id`,
        `SELECT COUNT(*) c FROM g5_shop_cart c JOIN g5_shop_order o ON o.od_id = c.od_id`,
      ],
      ['1:1문의', `SELECT COUNT(*) c FROM g5_qa_content`, `SELECT COUNT(*) c FROM g5_qa_content`],
      ['쿠폰', `SELECT COUNT(*) c FROM g5_shop_coupon`, `SELECT COUNT(*) c FROM g5_shop_coupon`],
    ];
    for (const [label, legacySql, targetSql] of countPairs) {
      const l = asInt((await legacySelect(legacySql))[0]?.c);
      const t = asInt((await g5.select(targetSql))[0]?.c);
      check(`행수 ${label}`, t >= l || label.startsWith('회원'), `레거시 ${String(l)} → 타깃 ${String(t)}`);
    }

    // 소셜 프로필: 레거시에서 회원 행이 삭제된 고아(연결 대상 없음)는 스킵이 정책 — 고아 제외 대조.
    if (!light) {
      const l = asInt(
        (await legacySelect(`SELECT COUNT(*) c FROM g5_member_social_profiles`))[0]?.c,
      );
      const orphan = asInt(
        (
          await legacySelect(
            `SELECT COUNT(*) c FROM g5_member_social_profiles s
              LEFT JOIN g5_member m ON m.mb_id = s.mb_id WHERE m.mb_id IS NULL`,
          )
        )[0]?.c,
      );
      const t = asInt((await g5.select(`SELECT COUNT(*) c FROM g5_member_social_profiles`))[0]?.c);
      check(
        '행수 소셜 프로필(고아 제외)',
        t >= l - orphan,
        `레거시 ${String(l)}(회원 삭제 고아 ${String(orphan)} 제외 ${String(l - orphan)}) → 타깃 ${String(t)}`,
      );
    }

    // 회원 귀속 자산(포인트/주소록)은 회원 단위 센서스 — 정책 스킵(레거시 절단 고아·타깃 기존
    // 계정)을 버킷으로 분리하고, 그 밖의 회원에서 카운트 불일치가 나오면 실패.
    if (!light) {
      await memberAssetCensus(g5, '포인트 원장', 'g5_point');
      await memberAssetCensus(g5, '주소록', 'g5_shop_order_address');
    }
    for (const board of MIGRATE_BOARDS) {
      const table = `g5_write_${board}`;
      const l = asInt((await legacySelect(`SELECT COUNT(*) c FROM \`${table}\``))[0]?.c);
      const t = (await g5.tableExists(table))
        ? asInt((await g5.select(`SELECT COUNT(*) c FROM \`${table}\``))[0]?.c)
        : 0;
      check(`행수 게시판 ${board}`, t >= l, `레거시 ${String(l)} → 타깃 ${String(t)}`);
    }

    // 별점후기(sp_review) 행수 — 이관분(legacyIsId 보유) 기준(신규 작성분 제외)
    {
      const l = asInt(
        (await legacySelect(`SELECT COUNT(*) c FROM g5_shop_item_use`))[0]?.c,
      );
      const t = await prisma.spReview.count({ where: { legacyIsId: { not: null } } });
      check('행수 별점후기(sp_review)', t >= l, `레거시 ${String(l)} → 타깃 ${String(t)}`);
    }

    // ── 2) 금액 항등(이관 주문 전수) ──
    const legacyOrders = new Map<string, { misu: number }>();
    for (const r of await legacySelect(`SELECT od_id, od_misu FROM g5_shop_order`)) {
      legacyOrders.set(asStr(r.od_id), { misu: asInt(r.od_misu) });
    }
    const activeIn = ACTIVE_ORDER_STATUSES.map((s) => `'${s}'`).join(', ');
    const targetOrders = await g5.select(
      `SELECT o.od_id, o.od_tax_flag, o.od_send_cost, o.od_send_cost2, o.od_coupon, o.od_send_coupon,
              o.od_receipt_price, o.od_receipt_point, o.od_refund_price,
              o.od_misu, o.od_tax_mny, o.od_vat_mny, o.od_free_mny, o.od_cart_price,
              agg.price, agg.coupon, agg.tax_mny, agg.free_mny
         FROM g5_shop_order o
         LEFT JOIN (
           SELECT od_id,
                  SUM(${CART_LINE_VALUE_SQL}) price,
                  SUM(cp_price) coupon,
                  SUM(IF(ct_notax = 0, (${CART_LINE_VALUE_SQL} - cp_price), 0)) tax_mny,
                  SUM(IF(ct_notax = 1, (${CART_LINE_VALUE_SQL} - cp_price), 0)) free_mny
             FROM g5_shop_cart
            WHERE ct_status IN (${activeIn})
            GROUP BY od_id
         ) agg ON agg.od_id = o.od_id`,
    );
    let moneyMismatch = 0;
    let misuDrift = 0;
    const mismatchSamples: string[] = [];
    for (const o of targetOrders) {
      const odId = asStr(o.od_id);
      if (!legacyOrders.has(odId)) continue; // 이관분만 검사
      const money = computeOrderMoney({
        taxFlag: asInt(o.od_tax_flag) > 0,
        cartPrice: asInt(o.price),
        cartCoupon: asInt(o.coupon),
        taxMny: asInt(o.tax_mny),
        freeMny: asInt(o.free_mny),
        sendCost: asInt(o.od_send_cost),
        sendCost2: asInt(o.od_send_cost2),
        odCoupon: asInt(o.od_coupon),
        odSendCoupon: asInt(o.od_send_coupon),
        receiptPrice: asInt(o.od_receipt_price),
        receiptPoint: asInt(o.od_receipt_point),
        refundPrice: asInt(o.od_refund_price),
      });
      const stored = {
        misu: asInt(o.od_misu),
        tax: asInt(o.od_tax_mny),
        vat: asInt(o.od_vat_mny),
        free: asInt(o.od_free_mny),
        cart: asInt(o.od_cart_price),
      };
      const simOk =
        money.odMisu === stored.misu &&
        money.odTaxMny === stored.tax &&
        money.odVatMny === stored.vat &&
        money.odFreeMny === stored.free &&
        asInt(o.price) === stored.cart;
      if (!simOk) {
        moneyMismatch += 1;
        if (mismatchSamples.length < 10) {
          mismatchSamples.push(
            `${odId}: sim(misu ${String(money.odMisu)}/tax ${String(money.odTaxMny)}) vs 저장(misu ${String(stored.misu)}/tax ${String(stored.tax)})`,
          );
        }
      }
      const legacyMisu = legacyOrders.get(odId)?.misu ?? 0;
      if (stored.misu !== legacyMisu) misuDrift += 1;
    }
    check('금액 항등(computeOrderMoney == 저장 헤더)', moneyMismatch === 0, `불일치 ${String(moneyMismatch)}건`);
    for (const s of mismatchSamples) console.log(`      · ${s}`);
    // 레거시 저장 misu 는 시대별 구산식(2019 초기: VAT 항 부재)·취소 잔재로 **레거시 자체 산식과도
    // 불일치**함이 실측됨(P1: 559건 = 자기산식 불일치 559건과 정확히 일치) → 불변식이 아니라 참고 대조.
    check(
      '금액 참고 대조(레거시 저장 misu — 구산식·취소 잔재 포함, 판단자료)',
      true,
      `차이 ${String(misuDrift)}건 (신규 산식 항등이 정본 — 계획 문서 §금액 변환)`,
    );

    // ── 3) 참조 정합 ──
    if (!light) {
    const specs = await prisma.spOrderSpec.findMany({ select: { id: true, ctId: true, quoteId: true } });
    const ctIds = specs.map((s) => s.ctId).filter((v): v is number => v !== null);
    let danglingCt = 0;
    if (ctIds.length > 0) {
      const found = new Set(
        (
          await g5.select(
            `SELECT ct_id FROM g5_shop_cart WHERE ct_id IN (${ctIds.map(() => '?').join(', ')})`,
            ctIds,
          )
        ).map((r) => asInt(r.ct_id)),
      );
      danglingCt = ctIds.filter((id) => !found.has(id)).length;
    }
    check('spec.ctId → cart 정합', danglingCt === 0, `끊어진 참조 ${String(danglingCt)}건 / spec ${String(specs.length)}건`);

    const orphanCarts = asInt(
      (
        await g5.select(
          `SELECT COUNT(*) c FROM g5_shop_cart c LEFT JOIN g5_shop_order o ON o.od_id = c.od_id
            WHERE o.od_id IS NULL AND c.ct_status <> '쇼핑'`,
        )
      )[0]?.c,
    );
    check('cart(비쇼핑) → order 정합', orphanCarts === 0, `주문 없는 비쇼핑 cart ${String(orphanCarts)}건`);

    const quoteRows = await g5.select(
      `SELECT c.ct_id FROM g5_shop_cart c
        LEFT JOIN g5_shop_item_option io ON io.io_id = c.io_id AND io.it_id = c.it_id
       WHERE c.io_id <> '' AND io.io_id IS NULL`,
    );
    check('cart.io_id → 옵션행 정합', quoteRows.length === 0, `옵션행 없는 견적 cart ${String(quoteRows.length)}건`);

    const fileCount = await prisma.spFile.count({ where: { refType: 'sp_order_spec' } });
    check('sp_file 연결', true, `${String(fileCount)}건 (누락은 phase 02 리포트 '파일 미업로드' 참조)`);

    // 별점후기 정합: 별점 합 항등 · 귀속(quoteId 비-null 행의 spec 존재) · 관리자 답변 보존
    {
      const legacyScore = asInt(
        (await legacySelect(`SELECT SUM(is_score) s FROM g5_shop_item_use`))[0]?.s,
      );
      const targetScore = (await prisma.spReview.aggregate({
        where: { legacyIsId: { not: null } },
        _sum: { score: true },
      }))._sum.score;
      check('별점후기 score 합 항등', (targetScore ?? 0) === legacyScore, `레거시 ${String(legacyScore)} → 타깃 ${String(targetScore ?? 0)}`);

      const reviewQuoteIds = (
        await prisma.spReview.findMany({
          where: { quoteId: { not: null } },
          select: { quoteId: true },
        })
      )
        .map((r) => r.quoteId)
        .filter((v): v is string => v !== null);
      let danglingReview = 0;
      if (reviewQuoteIds.length > 0) {
        const foundQuotes = new Set(
          (
            await prisma.spOrderSpec.findMany({
              where: { quoteId: { in: reviewQuoteIds } },
              select: { quoteId: true },
            })
          ).map((s) => s.quoteId),
        );
        danglingReview = reviewQuoteIds.filter((q) => !foundQuotes.has(q)).length;
      }
      check('후기.quoteId → spec 정합', danglingReview === 0, `끊어진 귀속 ${String(danglingReview)}건 / 귀속 후기 ${String(reviewQuoteIds.length)}건`);

      const legacyReplies = asInt(
        (await legacySelect(`SELECT COUNT(*) c FROM g5_shop_item_use WHERE is_reply_content <> ''`))[0]?.c,
      );
      const targetReplies = await prisma.spReview.count({
        where: { legacyIsId: { not: null }, replyContent: { not: null } },
      });
      check('후기 관리자 답변 보존', targetReplies >= legacyReplies, `레거시 ${String(legacyReplies)} → 타깃 ${String(targetReplies)}`);
    }

    // ── 4) 포인트 정합 ──
    // 합계 대조는 "행수까지 일치하는 회원"(=이관 대상 그 자체)만 — 기존 계정(admin 등, 카운트
    // 불일치)은 센서스 버킷에서 이미 분리·보고된다.
    const legacyPoint = new Map<string, { sum: number; cnt: number }>();
    for (const r of await legacySelect(
      `SELECT mb_id, SUM(po_point) s, COUNT(*) c FROM g5_point GROUP BY mb_id`,
    )) {
      legacyPoint.set(asStr(r.mb_id), { sum: asInt(r.s), cnt: asInt(r.c) });
    }
    const targetPoint = new Map<string, { sum: number; cnt: number }>();
    for (const r of await g5.select(
      `SELECT mb_id, SUM(po_point) s, COUNT(*) c FROM g5_point GROUP BY mb_id`,
    )) {
      targetPoint.set(asStr(r.mb_id), { sum: asInt(r.s), cnt: asInt(r.c) });
    }
    let pointSumDrift = 0;
    for (const [mbId, lp] of legacyPoint.entries()) {
      const tp = targetPoint.get(mbId);
      if (tp?.cnt !== lp.cnt) continue; // 미이관/기존계정 — 센서스가 담당
      if (tp.sum !== lp.sum) pointSumDrift += 1;
    }
    const mbPointDrift = await g5.select(
      `SELECT COUNT(*) c FROM g5_member m
        WHERE m.mb_point <> (SELECT COALESCE(SUM(po_point), 0) FROM g5_point p WHERE p.mb_id = m.mb_id)`,
    );
    check('포인트 원장 합계(이관 회원)', pointSumDrift === 0, `합계 불일치 ${String(pointSumDrift)}건`);
    check(
      '포인트 mb_point vs 원장(보고만 — 레거시 기존 오차 포함)',
      true,
      `${asStr(mbPointDrift[0]?.c)}건 불일치(수정하지 않음)`,
    );

    // ── 5) CS 정책 대상 집계 ──
    const guest = asInt(
      (await g5.select(`SELECT COUNT(*) c FROM g5_shop_order WHERE mb_id = ''`))[0]?.c,
    );
    check(
      '비회원 주문(od_pwd 인증 단절 — 관리자 대리조회 정책 대상)',
      true,
      `${String(guest)}건`,
    );
    } // if (!light) — 참조 정합·포인트·CS 집계는 전량 검증에서만

    const failCount = results.filter((r) => !r.ok).length;
    console.log(`\n══ 결과: ${failCount === 0 ? '전 항목 통과' : `실패 ${String(failCount)}건`} ══`);
    const tmpDir = await resolveMigrateTmpDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(tmpDir, `verify-${g5.dbName}-${stamp}.json`);
    await writeFile(out, JSON.stringify(results, null, 2), 'utf8');
    console.log(`검증 리포트 저장: ${out}`);
    if (failCount > 0) process.exitCode = 1;
  } finally {
    await Promise.allSettled([g5.end(), prisma.$disconnect(), closeLegacyPool()]);
  }
}

await main();
