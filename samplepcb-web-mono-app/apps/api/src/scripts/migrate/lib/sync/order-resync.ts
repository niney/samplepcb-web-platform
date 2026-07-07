// 주문 재대조(증분 핵심) — 후보 선정 → loadAndConvertOrder(단일 산식) → 상이분 UPDATE/부재 INSERT.
//
// 후보(계획 (b)) = 레거시 비종결 ∪ 타깃 비종결 ∪ 최근 window일 생성 ∪ 헤더 지문 상이
//   (지문 = 교집합 전 컬럼 − 변환 산출 금액 컬럼 − od_status(정규화 별도 비교) + 레거시 od_1~11 vs
//    sp_order_biz_info — 종결 주문의 사후 수납·송장·메모·주소 변경까지 밀폐 포착, 계획 P2-10).
//
// 갱신 규칙:
// - 헤더 UPDATE = 교집합 컬럼 전체 + 금액 6컬럼 재산출 override(filler 는 INSERT 전용 — P0-2).
// - 라인: 타깃 (od_id, io_id=quoteId) 부재 → migrateLine INSERT(레이스 수습 — P0-3).
//   존재 → buildCartOverrides 산출물과 대조해 상이 컬럼만 UPDATE + 옵션행 io_price 동기 +
//   spec.finalPrice / 사양 드리프트(specHash) 시 quote·spec 일괄 갱신(P1-5, _legacy 보존 병합).
//   quote.autoPrice 는 이관 규약상 항상 null — 갱신하지 않는다(명시 제외).
// - 오염 라인(io_id='', 상품행 부재)은 자연키가 없어 갱신 불가 — 발견 시 카운트만(덤프와 동일 한계).
import { computeOrderMoney } from '../../../../lib/g5-db';
import { rowFromLegacy } from '../context';
import type { MigrateCtx } from '../context';
import type { Row } from '../g5-writer';
import {
  buildCartOverrides,
  loadAndConvertOrder,
  migrateLine,
  upsertOrderBizInfo,
} from '../../phases/02-shop';
import type { ConvertedOrder, ShopDeps } from '../../phases/02-shop';
import { ACTIVE_ORDER_STATUSES, normalizeStatus } from '../status-map';
import { asInt, asStr, canonicalJson, sha256Hex } from '../util';
import { diffCols, normValue } from './row-diff';

/** 변환이 재산출하는 금액 컬럼 — 지문·헤더 원문 대조에서 제외(override 로만 비교). */
const CONVERTED_MONEY_COLS = new Set([
  'od_misu',
  'od_cart_price',
  'od_cancel_price',
  'od_tax_mny',
  'od_vat_mny',
  'od_free_mny',
]);

/** 레거시 종결 상태(레거시 원문 기준 — '전체취소' 포함). */
const LEGACY_TERMINAL = new Set(['완료', '취소', '전체취소', '반품', '품절']);
const TARGET_TERMINAL = new Set(['완료', '취소', '반품', '품절']);

const QUOTE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** [레거시 od_N, sp_order_biz_info 필드] 쌍 — 지문의 세금계산서 대조용. */
const BIZ_PAIRS: readonly [string, string][] = [
  ['od_1', 'companyName'],
  ['od_2', 'bizNo'],
  ['od_3', 'ceoName'],
  ['od_4', 'bizType'],
  ['od_5', 'bizItem'],
  ['od_6', 'managerName'],
  ['od_7', 'taxEmail'],
  ['od_8', 'companyTel'],
  ['od_9', 'bizZip'],
  ['od_10', 'bizAddr1'],
  ['od_11', 'bizAddr2'],
];

export interface OrderResyncResult {
  /** 헤더/라인이 실제 갱신·삽입된 od 목록(자가 금액검증 대상) */
  touchedOds: string[];
}

export async function resyncOrders(
  ctx: MigrateCtx,
  deps: ShopDeps,
  opts: { windowDays: number },
): Promise<OrderResyncResult> {
  const { g5, legacy, report } = ctx;
  console.log('── sync: orders 재대조 ──');

  const fpCols = deps.orderPlan.cols.filter(
    (c) => c !== 'od_id' && c !== 'od_status' && !CONVERTED_MONEY_COLS.has(c),
  );

  // ── 전량 로드(지문 대조) ──
  const legacyOrders = await legacy(
    `SELECT od_id, od_status, od_time, ${fpCols.map((c) => `\`${c}\``).join(', ')}, ${BIZ_PAIRS.map(([c]) => c).join(', ')}
       FROM g5_shop_order`,
  );
  const targetRows = await g5.select(
    `SELECT od_id, od_status, ${fpCols.map((c) => `\`${c}\``).join(', ')} FROM g5_shop_order`,
  );
  const targetByOd = new Map<string, Row>(targetRows.map((r) => [asStr(r.od_id), r]));
  const bizRows = await ctx.prisma.spOrderBizInfo.findMany();
  const bizByOd = new Map(bizRows.map((b) => [b.odId, b]));

  const cutoff = new Date(Date.now() - opts.windowDays * 24 * 3600 * 1000);
  const candidates = new Set<string>();
  const legacyOdIds = new Set<string>();

  for (const lo of legacyOrders) {
    const odId = asStr(lo.od_id);
    legacyOdIds.add(odId);
    const rawStatus = asStr(lo.od_status);
    const target = targetByOd.get(odId);

    if (target === undefined) {
      candidates.add(odId); // (a)가 놓친 직후 레이스 — 멱등이라 중복 처리 무해
      continue;
    }
    if (!LEGACY_TERMINAL.has(rawStatus)) {
      candidates.add(odId);
      continue;
    }
    const odTime = new Date(asStr(lo.od_time).replace(' ', 'T') + '+09:00');
    if (!Number.isNaN(odTime.getTime()) && odTime >= cutoff) {
      candidates.add(odId);
      continue;
    }
    // 상태 정규화 비교('부분취소'는 라인 의존이라 항상 후보)
    if (rawStatus === '부분취소') {
      candidates.add(odId);
      continue;
    }
    const norm = normalizeStatus(rawStatus);
    if (norm?.status !== asStr(target.od_status)) {
      candidates.add(odId);
      continue;
    }
    // 헤더 지문(교집합 원문 컬럼)
    if (diffCols(lo, target, fpCols).length > 0) {
      candidates.add(odId);
      continue;
    }
    // 세금계산서(od_1~11 vs sp_order_biz_info)
    const biz = bizByOd.get(odId) as Record<string, unknown> | undefined;
    for (const [legacyCol, field] of BIZ_PAIRS) {
      const legacyVal = asStr(lo[legacyCol]).trim();
      const targetVal = biz === undefined ? '' : asStr(biz[field] ?? '');
      if (legacyVal !== targetVal) {
        candidates.add(odId);
        break;
      }
    }
  }
  // 타깃 비종결(레거시 존재분) — 레거시가 종결로 넘어갔는데 타깃이 낡은 경우의 안전망
  for (const tr of targetRows) {
    const odId = asStr(tr.od_id);
    if (legacyOdIds.has(odId) && !TARGET_TERMINAL.has(asStr(tr.od_status))) candidates.add(odId);
  }
  report.count('sync.주문 후보', candidates.size);
  // (od 단위 삭제 검출은 sync.ts (c) 단계가 담당 — 여기서는 라인 레벨만 아래에서 검출)

  const touchedOds: string[] = [];
  let processed = 0;
  for (const odId of candidates) {
    try {
      const touched = await resyncOrder(ctx, deps, odId);
      if (touched) touchedOds.push(odId);
    } catch (err) {
      report.note('sync.주문 처리 실패(재실행 대상)', `${odId}: ${String(err).slice(0, 160)}`, 50);
    }
    processed += 1;
    if (processed % 100 === 0) console.log(`  … ${String(processed)}/${String(candidates.size)} 후보 처리`);
  }
  report.count('sync.주문 갱신(터치)', touchedOds.length);
  return { touchedOds };
}

async function resyncOrder(ctx: MigrateCtx, deps: ShopDeps, odId: string): Promise<boolean> {
  const { g5, report } = ctx;
  const conv = await loadAndConvertOrder(ctx, odId, deps);
  if (conv === null) return false;
  let touched = false;

  // ── 헤더 ──
  const targetHeaderRows = await g5.select(
    `SELECT ${['od_id', ...deps.orderPlan.cols].map((c) => `\`${c}\``).join(', ')}
       FROM g5_shop_order WHERE od_id = ? LIMIT 1`,
    [odId],
  );
  const targetHeader = targetHeaderRows[0];
  if (targetHeader === undefined) {
    if (!ctx.dryRun) {
      await g5.insertRow('g5_shop_order', rowFromLegacy(conv.od, deps.orderPlan, conv.headerOverrides));
    }
    report.count('sync.헤더 삽입(재대조)');
    touched = true;
  } else {
    const expected: Row = {};
    for (const c of deps.orderPlan.cols) expected[c] = conv.od[c] ?? null;
    for (const [k, v] of Object.entries(conv.headerOverrides)) expected[k] = v;
    const changed = Object.keys(expected).filter(
      (c) => normValue(expected[c]) !== normValue(targetHeader[c]),
    );
    if (changed.length > 0) {
      const set: Row = {};
      for (const c of changed) set[c] = expected[c] ?? null;
      if (!ctx.dryRun) await g5.updateRow('g5_shop_order', set, { od_id: odId });
      report.count('sync.헤더 갱신');
      touched = true;
    }
  }

  // ── 세금계산서 ──
  await upsertOrderBizInfo(ctx, odId, conv.biz);

  // ── 라인 ──
  // ⚠ SELECT 컬럼은 buildCartOverrides 가 재작성하는 키 전부를 포함해야 한다 — 빠지면
  //   undefined 와 비교되어 전 라인이 오탐 갱신된다(P1 baseline 실증: ct_select 누락 → 861건 오탐).
  const targetLines = await g5.select(
    `SELECT ct_id, io_id, it_id, it_name, ct_status, ct_price, io_price, io_type, ct_option, ct_select
       FROM g5_shop_cart WHERE od_id = ?`,
    [odId],
  );
  const targetByQuote = new Map<string, Row>();
  for (const tl of targetLines) {
    const ioId = asStr(tl.io_id);
    if (ioId !== '') targetByQuote.set(ioId, tl);
  }
  const legacyQuoteIds = new Set(conv.lines.map((l) => l.quoteId));

  for (const line of conv.lines) {
    const ct = conv.cartByCtId.get(line.legacyCtId);
    if (ct === undefined) continue;
    const brokenLine = line.item === null;
    const target = brokenLine ? undefined : targetByQuote.get(line.quoteId);

    if (target === undefined) {
      if (brokenLine) {
        // 오염 라인은 자연키(io_id='')가 모호 — 덤프와 동일하게 (od_id, io_id='') 1행 존재 시 스킵
        const exists = targetLines.some((tl) => asStr(tl.io_id) === '');
        if (exists) {
          report.count('sync.오염 라인 갱신 불가(스킵)');
          continue;
        }
      }
      await migrateLine(ctx, { odId, od: conv.od, ct, line, cartPlan: deps.cartPlan });
      report.count('sync.라인 삽입(재대조)');
      touched = true;
      continue;
    }

    // 존재 라인 대조 — 재작성 컬럼 산출물(buildCartOverrides)과 비교
    const expected = buildCartOverrides(line);
    const changed = diffCols(expected, target, Object.keys(expected));
    if (changed.length > 0) {
      const set: Row = {};
      for (const c of changed) set[c] = expected[c] ?? null;
      if (!ctx.dryRun) {
        await g5.updateRow('g5_shop_cart', set, { ct_id: asInt(target.ct_id) });
        // 옵션행 io_price 동기(부재 시 보충 — 코어 재검증·재고 경로의 짝)
        const affected = await g5.updateRow(
          'g5_shop_item_option',
          { io_price: line.incl },
          { it_id: line.cartItId, io_id: line.quoteId },
        );
        if (affected === 0) {
          await g5.insertRow('g5_shop_item_option', {
            io_id: line.quoteId,
            io_type: 0,
            it_id: line.cartItId,
            io_price: line.incl,
            io_stock_qty: 9999999,
            io_noti_qty: 0,
            io_use: 1,
          });
          report.count('sync.옵션행 보충');
        }
      }
      report.count('sync.라인 갱신');
      touched = true;
    }

    // spec/quote 동기(금액·사양)
    if (!ctx.dryRun) {
      const updatedSpec = await syncSpecAndQuote(ctx, line, changed.length > 0);
      if (updatedSpec) touched = true;
    }

    // 파일 교체 감지(리포트만) — 원장의 업로드 당시 경로 vs 현 레거시 filePath
    const fileEntry = ctx.ledger.fileEntry(line.quoteId);
    if (
      fileEntry?.pathToken !== undefined &&
      fileEntry.sourcePath !== undefined &&
      line.mapped.filePath !== '' &&
      fileEntry.sourcePath !== line.mapped.filePath
    ) {
      report.note(
        'sync.파일 교체 감지(재업로드 필요 — 수동 확인)',
        `${odId}/${line.quoteId}: ${fileEntry.sourcePath} → ${line.mapped.filePath}`,
        30,
      );
    }
  }

  // 라인 삭제 검출(리포트만) — 타깃 견적 라인의 quoteId 가 레거시에 없음
  for (const [quoteId] of targetByQuote) {
    if (QUOTE_ID_RE.test(quoteId) && !legacyQuoteIds.has(quoteId)) {
      report.note('sync.라인 삭제 검출(레거시 부재 — 수동 확인)', `${odId}/${quoteId}`, 50);
    }
  }
  return touched;
}

/** spec.finalPrice·사양 드리프트(specHash) 동기 — quote.autoPrice 는 의도적으로 미갱신. */
async function syncSpecAndQuote(
  ctx: MigrateCtx,
  line: ConvertedOrder['lines'][number],
  moneyChanged: boolean,
): Promise<boolean> {
  const { prisma, report } = ctx;
  const quote = await prisma.spQuote.findUnique({ where: { id: line.quoteId } });
  const spec = await prisma.spOrderSpec.findFirst({ where: { quoteId: line.quoteId } });
  if (quote === null || spec === null) return false; // 라인 삽입 경로가 생성 담당

  const newHash = sha256Hex(canonicalJson(line.mapped.spec));
  const specDrift = quote.specHash !== newHash;
  const priceDrift = spec.finalPrice !== line.incl;
  if (!specDrift && !priceDrift && !moneyChanged) return false;

  if (specDrift) {
    await prisma.spQuote.update({
      where: { id: line.quoteId },
      data: {
        specJson: line.mapped.spec,
        specHash: newHash,
        qty: line.mapped.qty,
        category: line.category,
        orderCategory: line.mapped.orderCategory,
      },
    });
    // 기존 spec_json 의 _legacy 메타 보존 병합
    const existingJson = spec.specJson as Record<string, unknown> | null;
    const legacyMeta =
      existingJson !== null && typeof existingJson === 'object' ? existingJson._legacy : undefined;
    await prisma.spOrderSpec.update({
      where: { id: spec.id },
      data: {
        specJson: {
          ...line.mapped.spec,
          ...(legacyMeta === undefined ? {} : { _legacy: legacyMeta }),
        },
        qty: line.mapped.qty,
        category: line.category,
        orderCategory: line.mapped.orderCategory,
        projectName: line.projectName === '' ? line.itemName : line.projectName,
        finalPrice: line.incl,
      },
    });
    report.count('sync.사양 드리프트 갱신');
    return true;
  }
  if (priceDrift) {
    await prisma.spOrderSpec.update({
      where: { id: spec.id },
      data: { finalPrice: line.incl },
    });
    report.count('sync.spec 확정가 갱신');
    return true;
  }
  return false;
}

/** 갱신된 od 의 금액 항등 자가검증(verify 축약) — 불일치 0 이 정상. */
export async function verifyOrdersMoney(ctx: MigrateCtx, odIds: readonly string[]): Promise<number> {
  if (odIds.length === 0) return 0;
  const { g5, report } = ctx;
  const activeIn = ACTIVE_ORDER_STATUSES.map((s) => `'${s}'`).join(', ');
  const lineValue = `IF(io_type = 1, (io_price * ct_qty), ((ct_price + io_price) * ct_qty))`;
  let mismatch = 0;
  for (const odId of odIds) {
    const rows = await g5.select(
      `SELECT o.od_tax_flag, o.od_send_cost, o.od_send_cost2, o.od_coupon, o.od_send_coupon,
              o.od_receipt_price, o.od_receipt_point, o.od_refund_price,
              o.od_misu, o.od_tax_mny, o.od_vat_mny, o.od_free_mny, o.od_cart_price,
              agg.price, agg.coupon, agg.tax_mny, agg.free_mny
         FROM g5_shop_order o
         LEFT JOIN (
           SELECT od_id, SUM(${lineValue}) price, SUM(cp_price) coupon,
                  SUM(IF(ct_notax = 0, (${lineValue} - cp_price), 0)) tax_mny,
                  SUM(IF(ct_notax = 1, (${lineValue} - cp_price), 0)) free_mny
             FROM g5_shop_cart WHERE od_id = ? AND ct_status IN (${activeIn}) GROUP BY od_id
         ) agg ON agg.od_id = o.od_id
        WHERE o.od_id = ?`,
      [odId, odId],
    );
    const o = rows[0];
    if (o === undefined) continue;
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
    const ok =
      money.odMisu === asInt(o.od_misu) &&
      money.odTaxMny === asInt(o.od_tax_mny) &&
      money.odVatMny === asInt(o.od_vat_mny) &&
      money.odFreeMny === asInt(o.od_free_mny) &&
      asInt(o.price) === asInt(o.od_cart_price);
    if (!ok) {
      mismatch += 1;
      report.note('sync.금액 항등 불일치(요조사)', odId, 20);
    }
  }
  return mismatch;
}
