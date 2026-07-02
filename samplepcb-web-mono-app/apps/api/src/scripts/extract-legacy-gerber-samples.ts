// 레거시 거버 주문(영카트 상품 ca_id=10) 샘플링 추출 스크립트.
//
// 목적: it_1~it_50 EAV(it_N_subj=키, it_N=값) → sp_order_spec.spec_json 마이그레이션
//       매핑 검증용 실데이터 샘플 + 전수 통계를 뽑는다. (읽기 전용, 서비스 코드 아님)
//
// 실행: apps/api 에서 `pnpm legacy:sample`
//   옵션: --out <경로>   덤프 JSON 출력 경로 (기본: 플랫폼 루트 .tmp/legacy-gerber-samples.json)
//         --latest <N>   최신순 샘플 건수 (기본 20)
//         --per-menu <N> menu(it_22)별 최신 샘플 건수 (기본 5)
//         --limit <N>    최신순 N건만 분석 (기본: 전수)
//
// 개인정보: mb_id 등 회원 식별자는 조회하지 않는다. 메시지(it_basic)의
//           전화번호/이메일 패턴은 마스킹 후 덤프한다.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { closeLegacyPool, legacySelect } from '../lib/legacy-db';
import type { LegacyRow } from '../lib/legacy-db';

const MAX_SLOT = 50;

// .tmp/gerber-project-migration-prompt.md 3장 매핑표 기준 — 문서화된 subj 키(정본 + 별칭).
const DOCUMENTED_SUBJ_KEYS: ReadonlyMap<string, string> = new Map([
  ['apiCompany', '(폐기) samplepcb 고정'],
  ['filePath', '(폐기) files[].pathToken 으로 대체'],
  ['length', 'length'],
  ['width', 'width'],
  ['layers', 'layers'],
  ['qty', '최상위 qty'],
  ['pcbThickness', 'pcbThickness'],
  ['material', 'material'],
  ['panel', 'panel'],
  ['minTraceSpacing', 'minTraceSpacing'],
  ['mixTrace', 'minTraceSpacing (별칭)'],
  ['minHole', 'minHole'],
  ['solderMask', 'solderMask'],
  ['silkscreen', 'silkscreen'],
  ['surfaceFinish', 'surfaceFinish'],
  ['viaProcess', 'viaProcess'],
  ['copperWeights', 'copperWeights'],
  ['kindpcb', 'kindPcb'],
  ['goldfingers', 'goldFingers'],
  ['finishedCopperAdvance', 'finishedCopperAdvance'],
  ['production_price', '(빈 슬롯 예상 it_20)'],
  ['totalPrice', '(폐기) quoteId 재계산'],
  ['menu', '최상위 category'],
  ['status', '최상위 flow'],
  ['견적상태', '(폐기) 서버 파생'],
  ['diffDesign', 'diffDesign'],
  ['differentDesign', 'diffDesign (별칭)'],
  ['impedance', 'impedance'],
  ['impedence', 'impedance (오탈자 별칭)'],
  ['etest', 'etest'],
  ['halfHole', 'halfHole'],
  ['stiffener', 'stiffener'],
  ['flayer', '(빈 슬롯 예상 it_30)'],
  ['tape3m', 'tape3m'],
  ['emiFilm', '(빈 슬롯 예상 it_32)'],
  ['fThickness', '(빈 슬롯 예상 it_33)'],
  ['fCopperThickness', '(빈 슬롯 예상 it_34)'],
  ['fColor', '(빈 슬롯 예상 it_35)'],
  ['fSilkcolor', '(빈 슬롯 예상 it_36)'],
  ['framework', 'framework'],
  ['frame', 'framework (별칭)'],
  ['stencilSide', 'stencilSide'],
  ['stDirection', 'stencilSide (별칭)'],
  ['stThickness', 'stThickness'],
  ['fiducial', 'fiducial'],
  ['electrop', 'electroPolish'],
  ['eta', 'eta'],
  ['metalCore', 'metalCore'],
  ['edgerail', 'edgeRail'],
  ['placeOfOrigin', 'placeOfOrigin'],
  ['coordinate', 'coordinate'],
  ['size', 'size'],
  ['sizeExtra', 'size (합성 별칭)'],
  ['cutting', 'cutting'],
  ['mqty', 'mqty'],
  ['category', '최상위 orderCategory'],
  // 실데이터의 it_50 subj 는 문서(category)와 달리 orderCategory 로 저장돼 있다.
  ['orderCategory', '최상위 orderCategory (실데이터 표기)'],
]);

interface SlotEntry {
  slot: number;
  subj: string;
  value: string;
}

interface GerberItem {
  itId: string;
  itName: string;
  itTime: string;
  itPrice: number;
  itUse: string;
  itStockQty: number;
  message: string;
  menu: string;
  status: string;
  orderCategory: string;
  entries: SlotEntry[];
  spec: Record<string, string>;
}

interface CartLink {
  rows: number;
  orderedRows: number;
  statuses: string[];
  odIds: string[];
}

interface SubjKeyStat {
  count: number;
  nonEmpty: number;
  slots: Set<number>;
  samples: Set<string>;
}

function asStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '';
}

function asNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** 전화번호·이메일 패턴 마스킹 (요청 메시지 덤프용). */
function redactPii(text: string): string {
  return text
    .replace(/\d{2,3}[-. ]?\d{3,4}[-. ]?\d{4}/g, '[전화번호]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[이메일]');
}

function toGerberItem(row: LegacyRow): GerberItem {
  const entries: SlotEntry[] = [];
  const spec: Record<string, string> = {};
  for (let slot = 1; slot <= MAX_SLOT; slot += 1) {
    const subjRaw = row[`it_${String(slot)}_subj`];
    // 2020 덤프처럼 it_46~50 컬럼 자체가 없는 스키마도 있으므로 미존재 슬롯은 스킵.
    if (subjRaw === undefined) continue;
    const subj = asStr(subjRaw).trim();
    if (subj === '') continue;
    const value = asStr(row[`it_${String(slot)}`]);
    entries.push({ slot, subj, value });
    spec[subj] = value;
  }
  return {
    itId: asStr(row.it_id),
    itName: asStr(row.it_name),
    itTime: asStr(row.it_time),
    itPrice: asNum(row.it_price),
    itUse: asStr(row.it_use),
    itStockQty: asNum(row.it_stock_qty),
    message: redactPii(asStr(row.it_basic)),
    menu: spec.menu ?? '',
    status: spec.status ?? '',
    orderCategory: spec.orderCategory ?? spec.category ?? '',
    entries,
    spec,
  };
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function toCountRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
}

function printCounts(title: string, map: Map<string, number>): void {
  console.log(`\n■ ${title}`);
  for (const [key, count] of [...map.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key === '' ? '(빈값)' : key}: ${String(count)}`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      latest: { type: 'string', default: '20' },
      'per-menu': { type: 'string', default: '5' },
      limit: { type: 'string' },
    },
  });
  const limitN = values.limit === undefined ? 0 : Math.trunc(Number(values.limit));
  const latestN = Number(values.latest);
  const perMenuN = Number(values['per-menu']);
  // src/scripts → 플랫폼 루트(.tmp)는 5단계 상위.
  const defaultOut = fileURLToPath(
    new URL('../../../../../.tmp/legacy-gerber-samples.json', import.meta.url),
  );
  const outPath = path.resolve(values.out ?? defaultOut);

  console.log(`레거시 거버 상품(ca_id=10) ${limitN > 0 ? `최신 ${String(limitN)}건` : '전수'} 조회 중...`);
  const rows = await legacySelect(
    "SELECT * FROM g5_shop_item WHERE ca_id = '10' ORDER BY it_time DESC, it_id DESC" +
      (limitN > 0 ? ` LIMIT ${String(limitN)}` : ''),
  );
  const items = rows.map(toGerberItem);
  console.log(`총 ${String(items.length)}건`);

  // ── 장바구니/주문 연결 (mb_id 등 회원 식별자는 조회하지 않음) ──
  const cartRows = await legacySelect(
    "SELECT c.it_id, c.ct_status, c.od_id FROM g5_shop_cart c INNER JOIN g5_shop_item i ON i.it_id = c.it_id WHERE i.ca_id = '10'",
  );
  const cartByItem = new Map<string, CartLink>();
  for (const row of cartRows) {
    const itId = asStr(row.it_id);
    const status = asStr(row.ct_status);
    const odId = asStr(row.od_id);
    const link = cartByItem.get(itId) ?? { rows: 0, orderedRows: 0, statuses: [], odIds: [] };
    link.rows += 1;
    if (status !== '쇼핑') {
      link.orderedRows += 1;
      if (odId !== '' && odId !== '0' && !link.odIds.includes(odId)) link.odIds.push(odId);
    }
    if (!link.statuses.includes(status)) link.statuses.push(status);
    cartByItem.set(itId, link);
  }

  // ── 집계 ──
  const byMenu = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byOrderCategory = new Map<string, number>();
  const byCtStatus = new Map<string, number>();
  const menuStatusMatrix = new Map<string, Map<string, number>>();
  const menuOrderCategoryMatrix = new Map<string, Map<string, number>>();
  const subjKeyStats = new Map<string, SubjKeyStat>();
  const slotSubjKeys = new Map<number, Map<string, number>>();
  const filePathPrefixes = new Map<string, number>();
  const cartLinkDist = { ordered: 0, cartOnly: 0, orphan: 0 };

  for (const item of items) {
    increment(byMenu, item.menu);
    increment(byStatus, item.status);
    increment(byOrderCategory, item.orderCategory);

    const matrixRow = menuStatusMatrix.get(item.menu) ?? new Map<string, number>();
    increment(matrixRow, item.status);
    menuStatusMatrix.set(item.menu, matrixRow);

    const ocRow = menuOrderCategoryMatrix.get(item.menu) ?? new Map<string, number>();
    increment(ocRow, item.orderCategory);
    menuOrderCategoryMatrix.set(item.menu, ocRow);

    for (const { slot, subj, value } of item.entries) {
      const stat = subjKeyStats.get(subj) ?? {
        count: 0,
        nonEmpty: 0,
        slots: new Set<number>(),
        samples: new Set<string>(),
      };
      stat.count += 1;
      if (value.trim() !== '') {
        stat.nonEmpty += 1;
        if (stat.samples.size < 8) stat.samples.add(value);
      }
      stat.slots.add(slot);
      subjKeyStats.set(subj, stat);

      const slotKeys = slotSubjKeys.get(slot) ?? new Map<string, number>();
      increment(slotKeys, subj);
      slotSubjKeys.set(slot, slotKeys);
    }

    const filePath = item.spec.filePath ?? '';
    if (filePath !== '') {
      const prefix = filePath.replace(/[^/]*$/, '');
      increment(filePathPrefixes, prefix);
    }

    const link = cartByItem.get(item.itId);
    if (!link) cartLinkDist.orphan += 1;
    else if (link.orderedRows > 0) cartLinkDist.ordered += 1;
    else cartLinkDist.cartOnly += 1;
    if (link) for (const s of link.statuses) increment(byCtStatus, s);
  }

  // 슬롯 하나에 서로 다른 subj 가 섞인 경우(별칭/오타 혼재 검출)
  const slotConflicts = [...slotSubjKeys.entries()]
    .filter(([, keys]) => keys.size > 1)
    .map(([slot, keys]) => ({ slot, keys: toCountRecord(keys) }))
    .sort((a, b) => a.slot - b.slot);

  const subjKeyReport = [...subjKeyStats.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([key, stat]) => ({
      key,
      documentedAs: DOCUMENTED_SUBJ_KEYS.get(key) ?? null,
      slots: [...stat.slots].sort((a, b) => a - b),
      count: stat.count,
      nonEmptyRatio: Number((stat.nonEmpty / stat.count).toFixed(4)),
      samples: [...stat.samples],
    }));
  const unexpectedSubjKeys = subjKeyReport.filter((s) => s.documentedAs === null).map((s) => s.key);

  // ── 샘플 선정: 최신 N + menu 별 최신 N ──
  const sampleIds = new Set<string>();
  for (const item of items.slice(0, latestN)) sampleIds.add(item.itId);
  const perMenuTaken = new Map<string, number>();
  for (const item of items) {
    const taken = perMenuTaken.get(item.menu) ?? 0;
    if (taken < perMenuN) {
      sampleIds.add(item.itId);
      perMenuTaken.set(item.menu, taken + 1);
    }
  }
  const samples = items
    .filter((item) => sampleIds.has(item.itId))
    .map(({ entries: _entries, ...item }) => ({
      ...item,
      cart: cartByItem.get(item.itId) ?? null,
    }));

  // ── 덤프 저장 ──
  const dump = {
    generatedAt: new Date().toISOString(),
    source: {
      table: 'g5_shop_item',
      caId: '10',
      limit: limitN > 0 ? limitN : null,
      availableSlots: [...slotSubjKeys.keys()].sort((a, b) => a - b),
      note: '회원 식별자(mb_id 등) 미포함, 메시지 내 전화번호/이메일 마스킹',
    },
    totals: { items: items.length, cartLink: cartLinkDist },
    stats: {
      byMenu: toCountRecord(byMenu),
      byStatus: toCountRecord(byStatus),
      byOrderCategory: toCountRecord(byOrderCategory),
      byCtStatus: toCountRecord(byCtStatus),
      menuStatusMatrix: Object.fromEntries(
        [...menuStatusMatrix.entries()].map(([menu, m]) => [menu, toCountRecord(m)]),
      ),
      menuOrderCategoryMatrix: Object.fromEntries(
        [...menuOrderCategoryMatrix.entries()].map(([menu, m]) => [menu, toCountRecord(m)]),
      ),
      subjKeys: subjKeyReport,
      unexpectedSubjKeys,
      slotConflicts,
      filePathPrefixes: toCountRecord(filePathPrefixes),
    },
    samples,
  };
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(dump, null, 2), 'utf8');

  // ── 콘솔 요약 ──
  printCounts('menu(it_22) 분포', byMenu);
  printCounts('status(it_23) 분포', byStatus);
  printCounts('orderCategory(it_50) 분포', byOrderCategory);
  printCounts('cart ct_status 분포(상품 기준)', byCtStatus);
  console.log('\n■ 장바구니/주문 연결');
  console.log(`  주문까지 감: ${String(cartLinkDist.ordered)}`);
  console.log(`  장바구니만: ${String(cartLinkDist.cartOnly)}`);
  console.log(`  고아(연결 없음): ${String(cartLinkDist.orphan)}`);
  console.log('\n■ subj 키 (등장수 / 값 채움률 / 슬롯)');
  for (const s of subjKeyReport) {
    const mark = s.documentedAs === null ? ' ⚠️ 문서화 안 됨' : '';
    console.log(
      `  ${s.key} [슬롯 ${s.slots.join(',')}] ${String(s.count)}건, 채움률 ${(s.nonEmptyRatio * 100).toFixed(1)}%${mark}`,
    );
  }
  if (slotConflicts.length > 0) {
    console.log('\n■ 슬롯별 subj 혼재(별칭/오타)');
    for (const c of slotConflicts) {
      console.log(`  it_${String(c.slot)}: ${JSON.stringify(c.keys)}`);
    }
  }
  console.log(`\n샘플 ${String(samples.length)}건 포함 덤프 저장: ${outPath}`);
}

try {
  await main();
} finally {
  await closeLegacyPool();
}
