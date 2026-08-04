// phase 06 — 미주문 견적 이관(레거시 견적관리 estimate.php 의 "주문 전" 부분집합).
//
//   레거시: g5_shop_cart(주문 헤더 미연결) + g5_shop_item(it_23='rfq' EAV 사양)
//   신규:   sp_quote + sp_order_spec(ctId = NULL — 플랫폼 네이티브 "비담김 견적")
//
// 02-shop(주문 이관)과 다른 점:
//  - cart/옵션행/주문 헤더를 만들지 않는다. 플랫폼에서 견적은 "담기 전"(ctId NULL)이고,
//    cart 행을 만들면 담김으로 보여 협력사 RFQ 가 막힌다(IN_CART 게이트).
//  - quoteId = uuidV5('cart:'+ct_id). ct_id 는 주문 승격 후에도 불변이라, 이 견적이 나중에
//    주문되면 02-shop 이 같은 quoteId 를 재사용해 **같은 spec 을 승격**한다(중복 생성 방지).
//  - 금액 산식은 공유(allocateVatIncl): 레거시 it_price(공급가) → 부가세 포함. it_price 와
//    ct_price 는 실측 항등이라(불일치 0건) it_price 를 정본으로 쓰고 어긋나면 리포트한다.
//
// 범위(사용자 확정 2026-08-04): ca_id 10(거버)·20(설문)·30(수동·구매대행). BOM(40·41)은
// 신규 플랫폼에 전용 트랙(sp_bom_quote)이 있어 제외 — 이중 표현 방지.
//
// 전체가 **upsert(멱등·드리프트 교정)** 라 sync 가 이 phase 를 그대로 재실행하면 신규분과
// 변경분(가격·상태·사양)이 함께 반영된다. 삭제는 정책상 리포트만(sync 가 별도 검출).
import type { Prisma } from '@prisma/client';
import type { LegacyRow } from '../../../lib/legacy-db';
import type { MigrateCtx } from '../lib/context';
import { mapGerberItem } from '../lib/eav-mapper';
import type { MappedLineSpec } from '../lib/eav-mapper';
import { allocateVatIncl } from '../lib/money-convert';
import { ACTIVE_ORDER_STATUSES, CANCEL_STATUSES } from '../lib/status-map';
import { asInt, asStr, canonicalJson, chunk, legacyDate, sha256Hex, uuidV5 } from '../lib/util';

const CANCEL = new Set<string>(CANCEL_STATUSES);
const ORDER_STAGE = new Set<string>(ACTIVE_ORDER_STATUSES);

/** 견적 단계 quoteId — ct_id 는 주문 승격 후에도 불변(승격 시 같은 spec 재사용의 앵커). */
export const quoteStageQuoteId = (legacyCtId: string): string => uuidV5(`cart:${legacyCtId}`);

/**
 * (cart, item) 이 견적 이관 스코프인지 — 아래 loadPendingQuotes 의 SQL·방어 조건과 같은 규칙.
 * upload-files.ts 가 "어떤 파일까지 나를지"를 이 판정으로 맞춘다(대상 불일치 방지).
 */
export function isPendingQuoteScope(ct: LegacyRow, item: LegacyRow | undefined): boolean {
  if (item === undefined) return false;
  const caId = asStr(item.ca_id);
  if (caId === '40' || caId === '41') return false; // BOM 은 전용 트랙(사용자 확정)
  if (!(asStr(item.it_23) === 'rfq' && asInt(item.it_use) === 1) && caId !== '30') return false;
  const status = asStr(ct.ct_status).trim();
  return !CANCEL.has(status) && !ORDER_STAGE.has(status);
}

function basename(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] ?? p;
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export interface PendingQuote {
  legacyCtId: string;
  quoteId: string;
  ct: LegacyRow;
  item: LegacyRow;
  mapped: MappedLineSpec;
  category: string;
  estimateJson: unknown;
  supply: number;
  incl: number;
  quoteStatus: 'rfq' | 'quoted';
  projectName: string;
  createdAt: Date;
  pricedAt: Date | null;
}

/**
 * 이관 대상 로드 — "주문 헤더 미연결" 이 곧 대기 견적이다.
 * ct_status='쇼핑' 을 OR 로 두는 이유: 장바구니 행의 od_id 는 세션 cart id 라 과거 주문번호와
 * 우연히 같을 수 있다(실측 함정, g5-db.ts 주석). 그 경우 헤더 조인이 걸려도 견적이 맞다.
 */
export async function loadPendingQuotes(ctx: MigrateCtx): Promise<PendingQuote[]> {
  const { legacy, report } = ctx;

  const cartRows = await legacy(
    `SELECT c.* FROM g5_shop_cart c
       LEFT JOIN g5_shop_order o ON o.od_id = c.od_id
       JOIN g5_shop_item i ON i.it_id = c.it_id
      WHERE (o.od_id IS NULL OR c.ct_status = '쇼핑')
        AND ((i.it_23 = 'rfq' AND i.it_use = 1) OR i.ca_id = '30')
        AND i.ca_id NOT IN ('40', '41')
      ORDER BY c.ct_id`,
  );
  report.count('quotes.레거시 후보 cart 행', cartRows.length);

  const itemMap = new Map<string, LegacyRow>();
  const itIds = [...new Set(cartRows.map((r) => asStr(r.it_id)).filter((s) => s !== ''))];
  for (const part of chunk(itIds, 300)) {
    const items = await legacy(
      `SELECT * FROM g5_shop_item WHERE it_id IN (${part.map(() => '?').join(', ')})`,
      part,
    );
    for (const item of items) itemMap.set(asStr(item.it_id), item);
  }

  // ca20(설문 견적) 부속 JSON — 주문 이관과 동일 규약(spec._legacy.estimate)
  const estimateMap = new Map<string, unknown>();
  const ca20Ids = itIds.filter((id) => asStr(itemMap.get(id)?.ca_id) === '20');
  for (const part of chunk(ca20Ids, 300)) {
    const estimates = await legacy(
      `SELECT it_id, category, contents FROM sp_estimate WHERE it_id IN (${part.map(() => '?').join(', ')}) ORDER BY id`,
      part,
    );
    for (const e of estimates) {
      estimateMap.set(asStr(e.it_id), {
        category: asStr(e.category),
        contents: parseJsonSafe(asStr(e.contents)),
      });
    }
  }

  const out: PendingQuote[] = [];
  for (const ct of cartRows) {
    const legacyCtId = asStr(ct.ct_id);
    const ctStatus = asStr(ct.ct_status).trim();
    // 방어 — 주문 헤더가 사라진 잔재는 견적으로 되살리지 않는다(정직한 미이관).
    if (CANCEL.has(ctStatus)) {
      report.note('quotes.스킵(취소 라인)', `${legacyCtId}: ${ctStatus}`, 50);
      continue;
    }
    if (ORDER_STAGE.has(ctStatus)) {
      report.note('quotes.스킵(고아 주문 라인 — 헤더 부재)', `${legacyCtId}: ${ctStatus}`, 50);
      continue;
    }
    const item = itemMap.get(asStr(ct.it_id));
    if (item === undefined) {
      report.note('quotes.스킵(상품 행 부재)', legacyCtId, 50);
      continue;
    }

    const mapped = mapGerberItem(item);
    const caId = asStr(item.ca_id);
    let category = mapped.category;
    let estimateJson: unknown = null;
    if (caId === '20') {
      const est = estimateMap.get(asStr(ct.it_id));
      estimateJson = est ?? null;
      const estCategory =
        est !== undefined && est !== null ? asStr((est as Record<string, unknown>).category) : '';
      category = estCategory !== '' ? estCategory : 'estimate';
    } else if (caId === '30') {
      category = asStr(item.it_basic) === 'purchasing' ? 'purchasing' : 'manual';
    } else if (!mapped.categoryKnown) {
      report.note('quotes.menu 정규화 실패(원본 유지)', `${legacyCtId}: '${category}'`, 50);
    }

    // 금액 — it_price 정본(견적관리 화면이 편집하는 필드), ct_price 와 어긋나면 리포트.
    const itPrice = asInt(item.it_price);
    const ctPrice = asInt(ct.ct_price) + asInt(ct.io_price);
    if (itPrice !== ctPrice) {
      report.note('quotes.가격 불일치(it_price 채택)', `${legacyCtId}: it=${String(itPrice)} ct=${String(ctPrice)}`, 50);
    }
    const supply = itPrice * Math.max(1, asInt(ct.ct_qty));
    const incl = allocateVatIncl([supply])[0] ?? supply;
    const quoteStatus: 'rfq' | 'quoted' = supply > 0 ? 'quoted' : 'rfq';
    const it24 = asStr(item.it_24).trim();
    if (quoteStatus === 'rfq' && it24 === '견적완료') {
      report.note('quotes.상태-가격 불일치(견적완료인데 가격 0 → rfq)', legacyCtId, 50);
    }

    const createdAt = legacyDate(ct.ct_time, new Date('2019-01-01T00:00:00+09:00'));
    const fileBase = basename(mapped.filePath);
    const displayBase = fileBase !== '' ? fileBase : asStr(item.it_name);

    out.push({
      legacyCtId,
      quoteId: quoteStageQuoteId(legacyCtId),
      ct,
      item,
      mapped,
      category,
      estimateJson,
      supply,
      incl,
      quoteStatus,
      projectName: displayBase.slice(0, 190),
      createdAt,
      pricedAt:
        quoteStatus === 'quoted'
          ? legacyDate(item.it_update_time ?? item.it_time, createdAt)
          : null,
    });
  }
  return out;
}

/** spec._legacy 메타 — 주문 이관과 같은 구조 + 견적 단계 표식(ctStatus·it24). */
function buildLegacyMeta(q: PendingQuote): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    itId: asStr(q.ct.it_id),
    ctId: asInt(q.ct.ct_id),
    odId: null, // 미주문 — 승격 시 02-shop 이 채운다
    itName: asStr(q.item.it_name),
    caId: asStr(q.item.ca_id),
    flow: q.mapped.flow,
    filePath: q.mapped.filePath,
    supplyPrice: q.supply,
    migratedFrom: 'samplepcb_php',
    stage: 'quote', // 견적 단계 이관분 표식(승격 판정·검증용)
    legacyCtStatus: asStr(q.ct.ct_status),
    legacyIt24: asStr(q.item.it_24),
  };
  if (Object.keys(q.mapped.rawUnknown).length > 0) meta.rawSpec = q.mapped.rawUnknown;
  if (q.estimateJson !== null) meta.estimate = q.estimateJson;
  const contact: Record<string, string> = {};
  for (const [src, dst] of [
    ['it_member_name', 'name'],
    ['it_member_tel', 'tel'],
    ['it_member_mail', 'mail'],
    ['it_member_memo', 'memo'],
    ['it_eta', 'itEta'],
  ] as const) {
    const v = asStr(q.item[src]).trim();
    if (v !== '') contact[dst] = v;
  }
  if (Object.keys(contact).length > 0) meta.memberContact = contact;
  return meta;
}

/** 한 건 upsert — 신규 생성/변경 반영 모두 처리(멱등). 담긴(ctId 보유) spec 은 건드리지 않는다. */
export async function upsertPendingQuote(ctx: MigrateCtx, q: PendingQuote): Promise<void> {
  const { prisma, report, ledger } = ctx;

  const specJson = { ...q.mapped.spec, _legacy: buildLegacyMeta(q) } as Prisma.InputJsonValue;
  const mbId = asStr(q.ct.mb_id);
  const companyName = asStr(q.item.it_company_name).trim();
  const message = asStr(q.item.it_basic).trim();

  if (ctx.dryRun) {
    const exists = await prisma.spOrderSpec.findFirst({
      where: { quoteId: q.quoteId },
      select: { id: true },
    });
    report.count(exists === null ? 'quotes.신규(예정)' : 'quotes.갱신 검사(예정)');
    return;
  }

  // 1) sp_quote — 결정적 id, 사양·수량은 최신 레거시로 맞춘다(드리프트 교정).
  const specHash = sha256Hex(canonicalJson(q.mapped.spec));
  const quoteData = {
    category: q.category,
    orderCategory: q.mapped.orderCategory,
    qty: q.mapped.qty,
    specJson: q.mapped.spec as Prisma.InputJsonValue,
    specHash,
    autoPrice: null,
    eta: q.mapped.eta === '' ? null : q.mapped.eta,
    priceVersion: 'legacy-migration',
    expiresAt: new Date(q.createdAt.getTime() + 72 * 3600 * 1000),
  };
  const existingQuote = await prisma.spQuote.findUnique({ where: { id: q.quoteId } });
  if (existingQuote === null) {
    await prisma.spQuote.create({ data: { id: q.quoteId, ...quoteData, createdAt: q.createdAt } });
    report.count('quotes.sp_quote 생성');
  } else if (existingQuote.specHash !== specHash) {
    await prisma.spQuote.update({ where: { id: q.quoteId }, data: quoteData });
    report.count('quotes.sp_quote 사양 갱신');
  }

  // 2) sp_order_spec — 견적 단계는 ctId NULL. 이미 담김/주문된 spec 은 승격된 것이라 보존.
  const existing = await prisma.spOrderSpec.findFirst({ where: { quoteId: q.quoteId } });
  if (existing !== null && existing.ctId !== null) {
    report.note('quotes.스킵(이미 주문 승격됨)', `${q.legacyCtId} → spec#${String(existing.id)}`, 50);
    return;
  }

  const data = {
    mbId: mbId === '' ? null : mbId,
    projectName: q.projectName,
    category: q.category,
    orderCategory: q.mapped.orderCategory,
    qty: q.mapped.qty,
    message: message === '' ? null : message,
    companyName: companyName === '' ? null : companyName.slice(0, 250),
    specJson,
    status: 'active',
    quoteStatus: q.quoteStatus,
    finalPrice: q.quoteStatus === 'quoted' ? q.incl : null,
    pricedBy: q.quoteStatus === 'quoted' ? 'legacy-migration' : null,
    pricedAt: q.pricedAt,
  };

  let specId: bigint;
  if (existing === null) {
    const created = await prisma.spOrderSpec.create({
      data: { ...data, quoteId: q.quoteId, ctId: null, createdAt: q.createdAt },
      select: { id: true },
    });
    specId = created.id;
    report.count('quotes.sp_order_spec 생성');
    report.count(`quotes.카테고리(${q.category})`);
  } else {
    specId = existing.id;
    const changed =
      existing.quoteStatus !== data.quoteStatus ||
      existing.finalPrice !== data.finalPrice ||
      existing.projectName !== data.projectName ||
      existing.qty !== data.qty ||
      canonicalJson(existing.specJson) !== canonicalJson(specJson);
    if (changed) {
      await prisma.spOrderSpec.update({ where: { id: existing.id }, data });
      report.count('quotes.sp_order_spec 갱신');
    }
  }

  // 3) sp_file — 사전 업로드 원장(upload-files.ts)에 토큰이 있으면 연결(주문 이관과 동일).
  const fileEntry = ledger.fileEntry(q.quoteId);
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
          uploadFileName: fileEntry.uploadFileName ?? basename(q.mapped.filePath),
          originFileName: fileEntry.originFileName ?? basename(q.mapped.filePath),
          pathToken: fileEntry.pathToken,
          size: BigInt(fileEntry.size ?? 0),
          writeDate: q.createdAt,
          fileType: 'gerber',
        },
      });
      report.count('quotes.sp_file 연결');
    }
  }
}

/** 반환값 = 현재 레거시에 살아 있는 대기 견적(삭제 검출의 기준 집합 — sync 가 사용). */
export async function runQuotesPhase(ctx: MigrateCtx): Promise<PendingQuote[]> {
  console.log('\n── phase 06: quotes (미주문 견적 이관) ──');
  const pending = await loadPendingQuotes(ctx);
  ctx.report.count('quotes.이관 대상', pending.length);
  for (const q of pending) await upsertPendingQuote(ctx, q);
  return pending;
}

/**
 * 레거시에서 사라진 견적 검출 — 고객이 장바구니에서 지우면 행 자체가 없어진다(레거시가
 * sp_estimate 도 DELETE). 정책상 **리포트만**(sync 삭제 정책 동일) — 컷오버 최종 동기에서 판단.
 */
export async function detectQuoteDeletions(
  ctx: MigrateCtx,
  liveCtIds: ReadonlySet<string>,
): Promise<void> {
  const specs = await ctx.prisma.spOrderSpec.findMany({
    where: { ctId: null, status: 'active' },
    select: { id: true, projectName: true, specJson: true },
  });
  for (const spec of specs) {
    const meta = (spec.specJson as { _legacy?: { stage?: unknown; ctId?: unknown } } | null)?._legacy;
    if (meta === undefined || asStr(meta.stage) !== 'quote') continue; // 플랫폼 자체 견적은 대상 아님
    const ctId = asStr(meta.ctId);
    if (ctId !== '' && !liveCtIds.has(ctId)) {
      ctx.report.note(
        'sync.견적 삭제 검출(레거시 부재 — 수동 확인)',
        `spec#${String(spec.id)} ct_id=${ctId} ${spec.projectName}`,
        50,
      );
    }
  }
}
