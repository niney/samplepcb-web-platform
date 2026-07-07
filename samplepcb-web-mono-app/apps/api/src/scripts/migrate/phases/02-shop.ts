// phase 02 — 주문 도메인 변환(핵심): 레거시 "주문마다 상품" 모델 → 신규 모델.
//
//   레거시: g5_shop_order + g5_shop_cart(라인, item 과 1:1) + g5_shop_item(EAV 사양)
//   신규:   g5_shop_order + g5_shop_cart(신규 규약) + g5_shop_item_option(io_id=quoteId)
//           + sp_quote + sp_order_spec(+_legacy 메타) + sp_file(사전 업로드 원장) + sp_order_biz_info
//
// od 단위 멱등 재실행(타깃 g5 는 무트랜잭션 전제): 원장 완료 마커 + 자연키 존재검사
// (od_id / (od_id, io_id=quoteId) / (it_id, io_id) / quoteId). 처리 순서는 "옵션행 → cart(ct_id 확보)
// → SpQuote → SpOrderSpec(ctId 포함 생성) → SpFile" — ctId 역기록 단계 제거(반쪽 상태 창 소멸).
//
// 금액: 레거시 라인가(공급가)를 부가세 포함으로 변환(money-convert)하고, 헤더 파생값은
// 신규 computeOrderMoney 로 재산출한다 — 이후 admin 전이/취소 재계산과 항등.
//
// 구조(2026-07-07 sync 확장): 로드→정규화→금액→헤더 산출은 **순수 변환 함수
// `loadAndConvertOrder`** 로 분리 — 덤프 INSERT(이 파일)와 증분 UPDATE(lib/sync/order-resync)가
// 같은 산출물을 쓴다(금액 항등의 단일 산식 강제, 계획 P1-4). od_cart_price 는 "활성 라인만" 관례.
import type { Prisma } from '@prisma/client';
import { computeOrderMoney, TEMPLATE_ITEMS } from '../../../lib/g5-db';
import { buildOptionSummary } from '../../../lib/option-summary';
import type { LegacyRow } from '../../../lib/legacy-db';
import { buildCopyPlan, rowFromLegacy } from '../lib/context';
import type { CopyPlan, MigrateCtx } from '../lib/context';
import { mapGerberItem } from '../lib/eav-mapper';
import type { MappedLineSpec } from '../lib/eav-mapper';
import type { Row } from '../lib/g5-writer';
import { convertOrderLineMoney } from '../lib/money-convert';
import type { OrderMoneyConversion } from '../lib/money-convert';
import { isCancelStatus, normalizeStatus, resolvePartialCancelOdStatus } from '../lib/status-map';
import { asInt, asStr, canonicalJson, legacyDate, sha256Hex, uuidV5 } from '../lib/util';

/** 비거버 카테고리 표시명(카트 it_name "라벨 · 원본명" 문법의 라벨부). */
const SERVICE_LABELS: Record<string, string> = {
  circuit: '회로개발',
  artwork: 'PCB 설계',
  assembly: 'SMT 조립',
  mass: '양산 견적',
  bom: 'BOM 견적',
  manual: '수동 견적',
  purchasing: '구매대행',
};

const TEMPLATE_DISPLAY: Record<string, string> = {
  standard: 'Standard PCB',
  metalmask: 'Metal Mask',
  advance: 'Advance PCB',
  flexible: 'Flexible PCB',
};

interface TemplateRow {
  itId: string;
  itName: string;
}

export interface LineConversion {
  legacyCtId: string;
  quoteId: string;
  incl: number;
  status: string;
  cancelled: boolean;
  mapped: MappedLineSpec;
  category: string; // 최종 카테고리(비거버 승격 반영)
  item: LegacyRow | null;
  estimateJson: unknown; // ca20 설문(JSON parse 결과) — spec._legacy.estimate
  cartItId: string; // 신규 cart 행의 it_id (템플릿 or 레거시 댕글링)
  itemName: string;
  projectName: string;
}

function basename(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] ?? p;
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text; // 파싱 불가면 원문 보존
  }
}

// ── 공유 의존성(덤프 phase 와 sync 가 함께 사용) ────────────────────────────

export interface ShopDeps {
  orderPlan: CopyPlan;
  cartPlan: CopyPlan;
  templateByCategory: Map<string, TemplateRow>;
}

/** 템플릿 상품·복사 계획 로드(게이트에서 템플릿 존재 보장). */
export async function prepareShopDeps(ctx: MigrateCtx): Promise<ShopDeps> {
  const templateIds = Object.values(TEMPLATE_ITEMS);
  const tmplRows = await ctx.g5.select(
    `SELECT it_id, it_name FROM g5_shop_item WHERE it_id IN (${templateIds.map(() => '?').join(', ')})`,
    templateIds,
  );
  const templateByCategory = new Map<string, TemplateRow>();
  for (const [category, itId] of Object.entries(TEMPLATE_ITEMS)) {
    const row = tmplRows.find((r) => asStr(r.it_id) === itId);
    if (row !== undefined) {
      templateByCategory.set(category, { itId, itName: asStr(row.it_name) });
    }
  }
  const orderPlan = await buildCopyPlan(ctx.schema, 'g5_shop_order');
  const cartPlan = await buildCopyPlan(ctx.schema, 'g5_shop_cart', { dropAutoIncrement: true });
  return { orderPlan, cartPlan, templateByCategory };
}

export interface ShopPhaseOptions {
  /** 지정 시 이 od 목록만 처리(sync 신규분 = 레거시∖타깃 차집합). 미지정 = 레거시 전량. */
  odIds?: readonly string[];
  /** 원장 done 마커 무시 — sync 에서 원장은 권위 없음(계획 P0-1: 타깃 DB "이름"으로만
   *  구분되는 원장 파일이 다른 환경의 마커로 신규 주문을 조용히 누락시키는 모드 차단). */
  ignoreLedger?: boolean;
}

export async function runShopPhase(ctx: MigrateCtx, opts: ShopPhaseOptions = {}): Promise<void> {
  const { g5, legacy, report, ledger } = ctx;
  console.log('\n── phase 02: shop (주문 변환) ──');

  const deps = await prepareShopDeps(ctx);

  const targetOrderIds = new Set(
    (await g5.select(`SELECT od_id FROM g5_shop_order`)).map((r) => asStr(r.od_id)),
  );

  const odList =
    opts.odIds !== undefined
      ? [...opts.odIds]
      : (await legacy(`SELECT od_id FROM g5_shop_order ORDER BY od_id`)).map((r) =>
          asStr(r.od_id),
        );
  report.count('shop.레거시 주문 수', odList.length);

  let processed = 0;
  for (const odId of odList) {
    if (opts.ignoreLedger !== true && ledger.isOrderDone(odId)) {
      report.count('shop.스킵(원장 완료)');
      continue;
    }
    await migrateOrder(ctx, odId, {
      ...deps,
      headerExists: targetOrderIds.has(odId),
    });
    if (!ctx.dryRun) await ledger.markOrderDone(odId);
    processed += 1;
    if (processed % 100 === 0) {
      console.log(`  … ${String(processed)}/${String(odList.length)} 주문 처리`);
      if (!ctx.dryRun) await ledger.save();
    }
  }
  if (!ctx.dryRun) await ledger.save();
  report.count('shop.주문 처리', processed);

  // 주문에 연결되지 않은 레거시 cart 행(쇼핑/협력사 대기/오염) — 정책상 스킵, 규모만 기록.
  // (odIds 지정 = sync 부분 실행에서는 생략 — 전량 모드의 감사 항목)
  if (opts.odIds === undefined) {
    const unlinked = await legacy(
      `SELECT c.ct_status s, COUNT(*) c FROM g5_shop_cart c
        LEFT JOIN g5_shop_order o ON o.od_id = c.od_id
       WHERE o.od_id IS NULL GROUP BY c.ct_status`,
    );
    for (const r of unlinked) {
      report.note('shop.비이관 cart 행(주문 미연결)', `${asStr(r.s)}: ${asStr(r.c)}건`, 30);
    }
  }
}

// ── 순수 변환: 로드 → 라인 정규화 → 금액 변환 → 헤더 산출 (쓰기 없음) ─────────

export interface ConvertedOrder {
  odId: string;
  od: LegacyRow;
  lines: LineConversion[];
  cartByCtId: Map<string, LegacyRow>;
  odStatus: string;
  conversion: OrderMoneyConversion;
  /** 헤더 재작성 컬럼(od_status + 금액 6컬럼) — INSERT override 와 UPDATE SET 이 공유 */
  headerOverrides: Row;
  /** od_1~od_11 → sp_order_biz_info 필드(값 있는 것만) */
  biz: Record<string, string>;
}

/** null = 주문 부재 또는 미지 od_status(노트 남김·스킵). */
export async function loadAndConvertOrder(
  ctx: MigrateCtx,
  odId: string,
  deps: ShopDeps,
): Promise<ConvertedOrder | null> {
  const { legacy, report } = ctx;

  const odRows = await legacy(`SELECT * FROM g5_shop_order WHERE od_id = ?`, [odId]);
  const od = odRows[0];
  if (od === undefined) return null;

  const cartRows = await legacy(`SELECT * FROM g5_shop_cart WHERE od_id = ? ORDER BY ct_id`, [odId]);
  if (cartRows.length === 0) {
    report.note('shop.주문에 cart 없음(헤더만 이관)', odId, 50);
  }

  // ── 라인 준비: 아이템·설문 로드 ──
  const itIds = [...new Set(cartRows.map((r) => asStr(r.it_id)).filter((s) => s !== ''))];
  const itemMap = new Map<string, LegacyRow>();
  if (itIds.length > 0) {
    const items = await legacy(
      `SELECT * FROM g5_shop_item WHERE it_id IN (${itIds.map(() => '?').join(', ')})`,
      itIds,
    );
    for (const item of items) itemMap.set(asStr(item.it_id), item);
  }
  const estimateMap = new Map<string, unknown>();
  const ca20Ids = itIds.filter((id) => asStr(itemMap.get(id)?.ca_id) === '20');
  if (ca20Ids.length > 0) {
    const estimates = await legacy(
      `SELECT it_id, category, contents FROM sp_estimate WHERE it_id IN (${ca20Ids.map(() => '?').join(', ')}) ORDER BY id`,
      ca20Ids,
    );
    for (const e of estimates) {
      estimateMap.set(asStr(e.it_id), {
        category: asStr(e.category),
        contents: parseJsonSafe(asStr(e.contents)),
      });
    }
  }

  // ── 라인 상태·금액 변환 ──
  const lines: LineConversion[] = [];
  for (const ct of cartRows) {
    const rawStatus = asStr(ct.ct_status);
    const normalized = normalizeStatus(rawStatus);
    if (normalized === null) {
      report.note('shop.미지 ct_status 라인 스킵', `${odId}/${asStr(ct.ct_id)}: '${rawStatus}'`);
      continue;
    }
    if (normalized.mapped) report.count(`shop.상태 매핑(${rawStatus}→${normalized.status})`);

    const legacyCtId = asStr(ct.ct_id);
    const item = itemMap.get(asStr(ct.it_id)) ?? null;
    const mapped: MappedLineSpec =
      item !== null
        ? mapGerberItem(item)
        : {
            spec: {},
            rawUnknown: {},
            category: 'unknown',
            categoryKnown: false,
            orderCategory: 'sample',
            orderCategoryExplicit: false,
            qty: Math.max(1, asInt(ct.ct_qty)),
            filePath: '',
            eta: '',
            flow: '',
          };

    // 비거버 카테고리 승격(ca20=설문 견적 / ca30=수동·구매대행 / ca40·41=BOM)
    const caId = asStr(item?.ca_id);
    let category = mapped.category;
    let estimateJson: unknown = null;
    if (caId === '20') {
      const est = estimateMap.get(asStr(ct.it_id));
      estimateJson = est ?? null;
      const estCategory =
        est !== undefined && est !== null ? asStr((est as Record<string, unknown>).category) : '';
      category = estCategory !== '' ? estCategory : 'estimate';
    } else if (caId === '30') {
      category = asStr(item?.it_basic) === 'purchasing' ? 'purchasing' : 'manual';
    } else if (caId === '40' || caId === '41') {
      category = 'bom';
    } else if (!mapped.categoryKnown && item !== null) {
      report.note('shop.menu 정규화 실패(원본 유지)', `${odId}/${legacyCtId}: '${category}'`);
    }

    const template = deps.templateByCategory.get(category.toLowerCase());
    const fileBase = basename(mapped.filePath);
    const displayBase =
      fileBase !== '' ? fileBase : item !== null ? asStr(item.it_name) : asStr(ct.it_name);
    const label =
      template !== undefined
        ? (TEMPLATE_DISPLAY[category.toLowerCase()] ?? template.itName)
        : (SERVICE_LABELS[category] ?? category);
    const itemName = `${label} · ${displayBase}`.slice(0, 250);
    if (template === undefined && item !== null) {
      report.note('shop.템플릿 없음(레거시 it_id 유지)', `${odId}/${legacyCtId}: ${category}`, 100);
    }

    lines.push({
      legacyCtId,
      quoteId: uuidV5(`${odId}:${legacyCtId}`),
      incl: 0, // 아래 금액 변환에서 채움
      status: normalized.status,
      cancelled: isCancelStatus(normalized.status),
      mapped,
      category,
      item,
      estimateJson,
      cartItId: template?.itId ?? asStr(ct.it_id),
      itemName,
      projectName: (fileBase !== '' ? fileBase : displayBase).slice(0, 190),
    });
  }

  // 금액 변환(활성/취소 그룹별 VAT 배분)
  const cartByCtId = new Map(cartRows.map((r) => [asStr(r.ct_id), r]));
  const conversion = convertOrderLineMoney(
    lines.map((l) => {
      const ct = cartByCtId.get(l.legacyCtId);
      const supply =
        (asInt(ct?.ct_price) + asInt(ct?.io_price)) * Math.max(1, asInt(ct?.ct_qty));
      return { key: l.legacyCtId, supply, cancelled: l.cancelled };
    }),
  );
  for (const line of lines) line.incl = conversion.inclByKey[line.legacyCtId] ?? 0;

  // ── od_status 정규화(부분취소는 라인 다수결 해소) ──
  const rawOdStatus = asStr(od.od_status);
  let odStatus: string;
  if (rawOdStatus === '부분취소') {
    odStatus = resolvePartialCancelOdStatus(lines.filter((l) => !l.cancelled).map((l) => l.status));
    report.note('shop.부분취소 od 해소', `${odId} → '${odStatus}'`, 50);
  } else {
    const normalized = normalizeStatus(rawOdStatus);
    if (normalized === null) {
      report.note('shop.미지 od_status(주문 스킵)', `${odId}: '${rawOdStatus}'`);
      return null;
    }
    if (normalized.mapped) report.count(`shop.상태 매핑(${rawOdStatus}→${normalized.status})`);
    odStatus = normalized.status;
  }

  // ── 헤더 금액 재산출(신규 산식과 항등이 되도록 저장값을 만든다) ──
  const activeLines = lines.filter((l) => !l.cancelled);
  const cartCoupon = activeLines.reduce(
    (a, l) => a + asInt(cartByCtId.get(l.legacyCtId)?.cp_price),
    0,
  );
  const taxMny = activeLines.reduce((a, l) => {
    const notax = asInt(cartByCtId.get(l.legacyCtId)?.ct_notax) === 1;
    return notax ? a : a + l.incl - asInt(cartByCtId.get(l.legacyCtId)?.cp_price);
  }, 0);
  const freeMny = activeLines.reduce((a, l) => {
    const notax = asInt(cartByCtId.get(l.legacyCtId)?.ct_notax) === 1;
    return notax ? a + l.incl - asInt(cartByCtId.get(l.legacyCtId)?.cp_price) : a;
  }, 0);
  const money = computeOrderMoney({
    taxFlag: asInt(od.od_tax_flag) > 0,
    cartPrice: conversion.activeIncl,
    cartCoupon,
    taxMny,
    freeMny,
    sendCost: asInt(od.od_send_cost),
    sendCost2: asInt(od.od_send_cost2),
    odCoupon: asInt(od.od_coupon),
    odSendCoupon: asInt(od.od_send_coupon),
    receiptPrice: asInt(od.od_receipt_price),
    receiptPoint: asInt(od.od_receipt_point),
    refundPrice: asInt(od.od_refund_price),
  });

  const headerOverrides: Row = {
    od_status: odStatus,
    od_cart_price: conversion.activeIncl, // "활성 라인만" 관례 — verify 금액 항등의 기준
    od_misu: money.odMisu,
    od_tax_mny: money.odTaxMny,
    od_vat_mny: money.odVatMny,
    od_free_mny: money.odFreeMny,
  };
  if (deps.orderPlan.insertCols.includes('od_cancel_price')) {
    headerOverrides.od_cancel_price = conversion.cancelIncl;
  }

  return {
    odId,
    od,
    lines,
    cartByCtId,
    odStatus,
    conversion,
    headerOverrides,
    biz: buildOrderBizMap(od),
  };
}

/** od_1~od_11(세금계산서 섹션) → sp_order_biz_info 필드 맵(값 있는 것만). */
export function buildOrderBizMap(od: LegacyRow): Record<string, string> {
  const biz: Record<string, string> = {};
  const bizCols: [string, string][] = [
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
  for (const [src, dst] of bizCols) {
    const v = asStr(od[src]).trim();
    if (v !== '') biz[dst] = v;
  }
  return biz;
}

export async function upsertOrderBizInfo(
  ctx: MigrateCtx,
  odId: string,
  biz: Record<string, string>,
): Promise<void> {
  if (Object.keys(biz).length === 0) return;
  if (!ctx.dryRun) {
    await ctx.prisma.spOrderBizInfo.upsert({
      where: { odId },
      create: { odId, ...biz },
      update: biz,
    });
  }
  ctx.report.count('shop.세금계산서 정보(sp_order_biz_info)');
}

// ── 덤프 경로: 변환 산출물을 INSERT 로 실체화 ───────────────────────────────

async function migrateOrder(
  ctx: MigrateCtx,
  odId: string,
  deps: ShopDeps & { headerExists: boolean },
): Promise<void> {
  const { g5, report } = ctx;

  const conv = await loadAndConvertOrder(ctx, odId, deps);
  if (conv === null) return;

  // ── 헤더 INSERT(멱등: od_id 존재검사) ──
  if (!deps.headerExists && !(await g5.exists('g5_shop_order', { od_id: odId }))) {
    if (!ctx.dryRun) {
      await g5.insertRow(
        'g5_shop_order',
        rowFromLegacy(conv.od, deps.orderPlan, conv.headerOverrides),
      );
    }
    report.count('shop.주문 헤더 삽입');
    if (asStr(conv.od.mb_id) === '') report.count('shop.비회원 주문');
  }

  // ── 라인 처리: 옵션행 → cart → SpQuote → SpOrderSpec → SpFile ──
  for (const line of conv.lines) {
    const ct = conv.cartByCtId.get(line.legacyCtId);
    if (ct === undefined) continue;
    if (line.item === null && asStr(ct.it_id) !== '') {
      report.note('shop.라인의 상품 부재(플레인 복사)', `${odId}/${line.legacyCtId}`, 100);
    }
    await migrateLine(ctx, { odId, od: conv.od, ct, line, cartPlan: deps.cartPlan });
  }

  // ── 세금계산서 정보(od_1~od_11 → sp_order_biz_info) ──
  await upsertOrderBizInfo(ctx, odId, conv.biz);
}

export interface LineDeps {
  odId: string;
  od: LegacyRow;
  ct: LegacyRow;
  line: LineConversion;
  cartPlan: CopyPlan;
}

export async function migrateLine(ctx: MigrateCtx, deps: LineDeps): Promise<void> {
  const { g5, prisma, report, ledger } = ctx;
  const { odId, od, ct, line } = deps;
  // 상품 행 부재(빈 it_id 또는 삭제된 상품) = spec 을 만들 수 없는 오염 라인 → 플레인 복사
  const brokenLine = line.item === null;

  // 1) 견적 옵션행 — (it_id, io_id) 유니크 없음 → 존재검사(계획 #6)
  if (!brokenLine) {
    const optExists = await g5.exists('g5_shop_item_option', {
      it_id: line.cartItId,
      io_id: line.quoteId,
    });
    if (!optExists && !ctx.dryRun) {
      await g5.insertRow('g5_shop_item_option', {
        io_id: line.quoteId,
        io_type: 0,
        it_id: line.cartItId,
        io_price: line.incl,
        io_stock_qty: 9999999,
        io_noti_qty: 0,
        io_use: 1,
      });
    }
  }

  // 2) 신규 cart 행 — 자연키 (od_id, io_id=quoteId) 존재검사
  let newCtId: number | null = null;
  const existing = await g5.select(
    `SELECT ct_id FROM g5_shop_cart WHERE od_id = ? AND io_id = ? LIMIT 1`,
    [odId, line.quoteId],
  );
  const existingRow = existing[0];
  if (existingRow !== undefined) {
    newCtId = asInt(existingRow.ct_id);
  } else {
    // 재작성 컬럼 한정(계획 #3) — 나머지(ct_notax·ct_send_cost·it_sc_*·ct_point·ct_history·
    // ct_time/ct_ip·ct_stock_use(레거시 값)·cp_* 등)는 레거시 스냅샷 보존.
    if (!ctx.dryRun) {
      newCtId = await g5.insertRow(
        'g5_shop_cart',
        rowFromLegacy(ct, deps.cartPlan, buildCartOverrides(line)),
      );
    }
    report.count('shop.cart 라인 삽입');
    report.count(`shop.라인 카테고리(${line.category})`);
  }
  if (brokenLine || ctx.dryRun) return;

  // 3) SpQuote(결정적 quoteId — 존재검사로 멱등)
  const createdAt = legacyDate(ct.ct_time, legacyDate(od.od_time, new Date('2019-01-01T00:00:00+09:00')));
  const odTime = legacyDate(od.od_time, createdAt);
  const specHashSource = canonicalJson(line.mapped.spec);
  const existingQuote = await prisma.spQuote.findUnique({ where: { id: line.quoteId } });
  if (existingQuote === null) {
    await prisma.spQuote.create({
      data: {
        id: line.quoteId,
        category: line.category,
        orderCategory: line.mapped.orderCategory,
        qty: line.mapped.qty,
        specJson: line.mapped.spec,
        specHash: sha256Hex(specHashSource),
        autoPrice: null,
        eta: line.mapped.eta === '' ? null : line.mapped.eta,
        priceVersion: 'legacy-migration',
        expiresAt: new Date(odTime.getTime() + 72 * 3600 * 1000),
        createdAt,
      },
    });
    report.count('shop.sp_quote 생성');
  }

  // 4) SpOrderSpec — quoteId 는 non-unique 인덱스 → findFirst 존재검사(계획 #6)
  const existingSpec = await prisma.spOrderSpec.findFirst({
    where: { quoteId: line.quoteId },
    select: { id: true },
  });
  let specId = existingSpec?.id ?? null;
  if (specId === null) {
    const legacyMeta: Record<string, unknown> = {
      itId: asStr(ct.it_id),
      ctId: asInt(ct.ct_id),
      odId,
      itName: line.item !== null ? asStr(line.item.it_name) : asStr(ct.it_name),
      caId: line.item !== null ? asStr(line.item.ca_id) : '',
      flow: line.mapped.flow,
      filePath: line.mapped.filePath,
      supplyPrice: (asInt(ct.ct_price) + asInt(ct.io_price)) * Math.max(1, asInt(ct.ct_qty)),
      migratedFrom: 'samplepcb_php',
    };
    if (Object.keys(line.mapped.rawUnknown).length > 0) legacyMeta.rawSpec = line.mapped.rawUnknown;
    if (line.estimateJson !== null) legacyMeta.estimate = line.estimateJson;
    const contact: Record<string, string> = {};
    if (line.item !== null) {
      for (const [src, dst] of [
        ['it_member_name', 'name'],
        ['it_member_tel', 'tel'],
        ['it_member_mail', 'mail'],
        ['it_member_memo', 'memo'],
        ['it_eta', 'itEta'],
      ] as const) {
        const v = asStr(line.item[src]).trim();
        if (v !== '') contact[dst] = v;
      }
    }
    if (Object.keys(contact).length > 0) legacyMeta.memberContact = contact;

    const mbId = asStr(od.mb_id);
    const companyName = asStr(line.item?.it_company_name).trim() || asStr(od.od_1).trim();
    const created = await prisma.spOrderSpec.create({
      data: {
        mbId: mbId === '' ? null : mbId,
        quoteId: line.quoteId,
        ctId: newCtId,
        projectName: line.projectName === '' ? line.itemName : line.projectName,
        category: line.category,
        orderCategory: line.mapped.orderCategory,
        qty: line.mapped.qty,
        message: asStr(line.item?.it_basic).trim() === '' ? null : asStr(line.item?.it_basic),
        companyName: companyName === '' ? null : companyName.slice(0, 250),
        specJson: { ...line.mapped.spec, _legacy: legacyMeta } as Prisma.InputJsonValue,
        status: 'active',
        quoteStatus: 'quoted', // 주문까지 간 견적 — 확정가 표현(계획 §구현 중 결정)
        finalPrice: line.incl,
        pricedBy: 'legacy-migration',
        pricedAt: odTime,
        createdAt,
      },
      select: { id: true },
    });
    specId = created.id;
    report.count('shop.sp_order_spec 생성');
  }

  // 5) SpFile — 사전 업로드 원장(upload-files.ts)의 pathToken 연결
  const fileEntry = ledger.fileEntry(line.quoteId);
  if (fileEntry?.pathToken !== undefined) {
    const existingFile = await prisma.spFile.findFirst({
      where: { refType: 'sp_order_spec', refId: specId, fileType: 'gerber' },
      select: { id: true },
    });
    if (existingFile === null) {
      await prisma.spFile.create({
        data: {
          refType: 'sp_order_spec',
          refId: specId,
          uploadFileName: fileEntry.uploadFileName ?? basename(line.mapped.filePath),
          originFileName: fileEntry.originFileName ?? basename(line.mapped.filePath),
          pathToken: fileEntry.pathToken,
          size: BigInt(fileEntry.size ?? 0),
          writeDate: createdAt,
          fileType: 'gerber',
        },
      });
      report.count('shop.sp_file 연결');
    }
  } else if (line.mapped.filePath !== '') {
    report.count('shop.파일 미업로드(원장 없음/누락)');
  }
}

/** cart 행 재작성 컬럼(계획 #3) — 덤프 INSERT override 와 sync UPDATE 대조가 공유. */
export function buildCartOverrides(line: LineConversion): Row {
  return line.item === null
    ? {
        ct_status: line.status,
        ct_price: line.incl, // 상품·spec 없는 오염 라인 — 레거시 보존형(io 규약 미적용)
        io_id: '',
        io_price: 0,
        ct_select: 1,
      }
    : {
        it_id: line.cartItId,
        it_name: line.itemName,
        ct_status: line.status,
        ct_price: 0,
        io_id: line.quoteId,
        io_type: 0,
        io_price: line.incl,
        ct_option: buildOptionSummary(line.mapped.spec, line.mapped.qty),
        ct_select: 1,
      };
}
