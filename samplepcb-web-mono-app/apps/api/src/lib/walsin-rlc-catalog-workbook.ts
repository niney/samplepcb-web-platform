import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeMpn, roundSig } from '@sp/utils';
import { loadCatalogWorkbook, sheetRows, type WorkbookRow } from './catalog-workbook-xlsx';
import { resolveManufacturer } from './manufacturer-alias';

// Walsin 주선정 + 대체 벤더 R/C 워크북을 supplier-search ingest envelope로 결정적으로 변환한다.
//
// 이 데이터의 성격은 연호 Rev2와 다르다. 제조사 품번 규칙으로 생성한 AVL 후보이지만,
// SamplePCB가 자체 판매 카탈로그로 수용한 R/C 원장이다. 제조사 사실 오퍼는 출처 보존용,
// samplepcb 오퍼는 판매 채널용으로 함께 저장한다. 가격·재고를 만들지 않고 문의 견적으로
// 선정하며, 실제 공급사 API에서 확인된 가격만 후속 일회성 갱신으로 채운다.

export const WALSIN_RLC_SOURCE_SHA256 =
  '7aa0c323e02e11ec67086546f5dae47d38f83748732dea0eb463b3ef19433e6c';

const BASIS_DATE = '2026-07-06';
const DASHBOARD_VERSION = '2026-07-06 / Walsin Primary + Yageo Alt + 3 popular extra vendors';

/** 워크북 시트 접미 — input_size_code와 같다. */
const SIZE_CODES = [
  '1005', '201', '402', '603', '805', '1206',
  '1210', '1808', '1812', '2010', '2220', '3025', '2512',
] as const;

const EXPECTED_RESISTOR_ROWS = 364;
const EXPECTED_CAPACITOR_ROWS = 377;
const EXPECTED_PARTS = 2_628;
const EXPECTED_MERGED_SIZE_ALIASES = 285;
const EXPECTED_CROSS_SIZE_DROPS = 116;
/** 원본이 의도적으로 비워 둔 벤더 셀 — 아래 EMPTY_MPN_SHEETS 주석 참고. */
const EXPECTED_EMPTY_VENDOR_CELLS = 676;
/** 5개 벤더가 모두 빈 행 — 일반 칩저항 표준 사이즈가 아닌 R_1808·R_1812·R_2220·R_3025. */
const EXPECTED_EMPTY_ROWS = 112;

const RESISTOR_HEADERS = [
  'input_size_code', 'normalized_eia', 'metric_jis', 'component_type', 'value', 'tolerance',
  'power_policy', 'description', 'auto_quote_level', 'verification_status', 'risk_note',
] as const;

const CAPACITOR_HEADERS = [
  'input_size_code', 'normalized_eia', 'metric_jis', 'component_type', 'capacitance', 'tolerance',
  'voltage', 'dielectric', 'auto_quote_level', 'verification_status', 'risk_note',
] as const;

/** 역할 → (제조사 열, MPN 열). MPN 열 이름에 벤더가 박혀 있어 그룹마다 다르다. */
const RESISTOR_VENDORS = [
  ['primary', 'primary_mfr', 'primary_mpn_walsin'],
  ['alt1', 'alt1_mfr', 'alt1_mpn_yageo'],
  ['alt2', 'alt2_mfr', 'alt2_mpn_samsung'],
  ['alt3', 'alt3_mfr', 'alt3_mpn_vishay'],
  ['alt4', 'alt4_mfr', 'alt4_mpn_koa'],
] as const;

const CAPACITOR_VENDORS = [
  ['primary', 'primary_mfr', 'primary_mpn_walsin'],
  ['alt1', 'alt1_mfr', 'alt1_mpn_yageo'],
  ['alt2', 'alt2_mfr', 'alt2_mpn_samsung'],
  ['alt3', 'alt3_mfr', 'alt3_mpn_murata'],
  ['alt4', 'alt4_mfr', 'alt4_mpn_tdk'],
] as const;

/**
 * 원본 검증 등급.
 *
 * `PATTERN_CANDIDATE`는 제조사 품번 규칙으로 생성한 후보다.
 * `SAMPLE_VERIFIED_FOR_ALT_VENDOR_SET`는 `03_Source_Refs`에 제조사 스펙시트 근거가 있는
 * 표본 행으로, 0402 10kΩ 1%와 0402 100nF X7R 50V 두 사양뿐이다(사이즈 표기 중복 포함 4행).
 */
const SAMPLE_VERIFIED = 'SAMPLE_VERIFIED_FOR_ALT_VENDOR_SET';
const EXPECTED_VERIFICATION_STATUSES = new Set(['PATTERN_CANDIDATE', SAMPLE_VERIFIED]);
const EXPECTED_SAMPLE_VERIFIED_ROWS = 4;
const EXPECTED_AUTO_QUOTE_LEVELS = new Set(['AUTO', 'CAUTION', 'MANUAL']);

/**
 * 관측된 원본 오류 교정.
 *
 * Samsung(CL43·CL55)과 Murata(GRM43·GRM55)는 각각 metric 4532(EIA 1812)와 5750(EIA 2220)
 * 품번이다. 두 제조사가 1808·2010 규격 MLCC를 표준 라인업에 두지 않아 워크북이 그 시트를
 * 한 치수 큰 품번으로 채웠다. 잘못된 사이즈 배정만 버린다 — 품번 자체는 1812·2220 시트에
 * 그대로 있으므로 MPN 손실은 없다.
 */
const CROSS_SIZE_DROPS: readonly {
  group: ComponentGroup;
  eia: string;
  manufacturers: readonly string[];
  belongsTo: string;
}[] = [
  { group: 'C', eia: '1808', manufacturers: ['samsung', 'murata'], belongsTo: '1812' },
  { group: 'C', eia: '2010', manufacturers: ['samsung', 'murata'], belongsTo: '2220' },
];

type ComponentGroup = 'R' | 'C';

interface VendorEntry {
  role: string;
  manufacturerRaw: string;
  manufacturerNorm: string;
  manufacturerName: string;
  mpn: string;
  mpnNorm: string;
}

interface RowRecord {
  group: ComponentGroup;
  sheet: string;
  rowNumber: number;
  inputSizeCode: string;
  eia: string;
  metricJis: string;
  tolerancePercent: number;
  autoQuoteLevel: string;
  verificationStatus: string;
  riskNote: string;
  /** R 전용 */
  resistanceOhm: number | null;
  description: string;
  /** C 전용 */
  capacitanceF: number | null;
  voltageV: number | null;
  dielectricRaw: string | null;
  dielectric: string | null;
  avlGroupId: string;
  vendors: VendorEntry[];
}

interface PartRecord {
  key: string;
  mpn: string;
  mpnNorm: string;
  manufacturerName: string;
  manufacturerNorm: string;
  role: string;
  row: RowRecord;
  inputSizeCodes: string[];
  sheets: string[];
  sourceRecordIds: number[];
  siblings: { role: string; manufacturer: string; mpn: string }[];
}

const AVL_ROLE_RANK: Readonly<Record<string, number>> = {
  primary: 0,
  alt1: 1,
  alt2: 2,
  alt3: 3,
  alt4: 4,
};

export interface WalsinRlcWorkbookStats {
  sourceSha256: string;
  basisDate: string;
  parts: number;
  resistorRows: number;
  capacitorRows: number;
  resistorParts: number;
  capacitorParts: number;
  sampleVerifiedParts: number;
  mergedSizeAliases: number;
  crossSizeDrops: number;
  emptyVendorCells: number;
  emptyRows: number;
  manufacturerCounts: Record<string, number>;
  avlGroups: number;
}

export interface WalsinRlcWorkbookResult {
  envelope: unknown;
  stats: WalsinRlcWorkbookStats;
}

function required(row: WorkbookRow, field: string): string {
  const value = row.values.get(field)?.trim() ?? '';
  if (value === '') throw new Error(`${String(row.rowNumber)}행 필수 값이 비었습니다: ${field}`);
  return value;
}

/** `0Ω` `2.2kΩ` `1MΩ` → ohm */
function parseResistance(text: string, context: string): number {
  const match = /^(\d+(?:\.\d+)?)(k|M)?Ω$/.exec(text);
  if (match === null) throw new Error(`저항값을 해석할 수 없습니다: ${context}=${text}`);
  const scale = match[2] === 'k' ? 1e3 : match[2] === 'M' ? 1e6 : 1;
  return roundSig(Number(match[1]) * scale, 9);
}

/** `10pF` `100nF` `2.2uF` → farad */
function parseCapacitance(text: string, context: string): number {
  const match = /^(\d+(?:\.\d+)?)(p|n|u)F$/.exec(text);
  if (match === null) throw new Error(`정전용량을 해석할 수 없습니다: ${context}=${text}`);
  const scale = match[2] === 'p' ? 1e-12 : match[2] === 'n' ? 1e-9 : 1e-6;
  return roundSig(Number(match[1]) * scale, 9);
}

/** `1%` `±5%` → percent */
function parseTolerance(text: string, context: string): number {
  const match = /^±?(\d+(?:\.\d+)?)%$/.exec(text);
  if (match === null) throw new Error(`허용오차를 해석할 수 없습니다: ${context}=${text}`);
  return Number(match[1]);
}

/** `50V` `6.3V` → volt */
function parseVoltage(text: string, context: string): number {
  const match = /^(\d+(?:\.\d+)?)V$/.exec(text);
  if (match === null) throw new Error(`정격전압을 해석할 수 없습니다: ${context}=${text}`);
  return Number(match[1]);
}

/**
 * 유전체 표기를 검색 가능한 단일 정규값으로 제한한다.
 *
 * C0G와 NP0는 같은 Class 1 유전체의 동의어라 C0G로 접을 수 있지만, X5R/X7R는
 * 서로 다른 온도 등급 후보를 한 셀에 적은 것이므로 어느 한쪽으로 추정하지 않는다.
 */
function normalizedDielectric(text: string): string | null {
  const tokens = text.toUpperCase().split('/').map((token) => token.trim());
  const normalized = new Set(tokens.map((token) => token === 'NP0' ? 'C0G' : token));
  return normalized.size === 1 ? [...normalized][0] ?? null : null;
}

function vendorEntries(
  row: WorkbookRow,
  columns: readonly (readonly [string, string, string])[],
  context: string,
): VendorEntry[] {
  const entries: VendorEntry[] = [];
  for (const [role, mfrColumn, mpnColumn] of columns) {
    const manufacturerRaw = required(row, mfrColumn);
    // MPN 공백은 원본의 사실이다 — 해당 제조사가 그 사이즈 규격을 만들지 않거나
    // (C_2512·C_3025의 Samsung·Murata), 사이즈 자체가 일반 칩저항 표준이 아니라
    // 품번을 만들지 않은 행이다(R_1808·R_1812·R_2220·R_3025 전 벤더).
    const mpn = row.values.get(mpnColumn)?.trim() ?? '';
    if (mpn === '') continue;
    const manufacturer = resolveManufacturer(manufacturerRaw);
    if (manufacturer.norm === 'unknown') {
      throw new Error(`제조사를 정규화할 수 없습니다: ${context}/${role}=${manufacturerRaw}`);
    }
    const mpnNorm = normalizeMpn(mpn);
    if (mpnNorm === '') throw new Error(`MPN 정규화 결과가 비었습니다: ${context}/${role}=${mpn}`);
    entries.push({
      role,
      manufacturerRaw,
      manufacturerNorm: manufacturer.norm,
      manufacturerName: manufacturer.name,
      mpn,
      mpnNorm,
    });
  }
  return entries;
}

function commonRowFields(row: WorkbookRow, sheet: string, group: ComponentGroup): {
  inputSizeCode: string;
  eia: string;
  metricJis: string;
  tolerancePercent: number;
  autoQuoteLevel: string;
  verificationStatus: string;
  riskNote: string;
} {
  const context = `${sheet}!${String(row.rowNumber)}`;
  const componentType = required(row, 'component_type');
  if (componentType !== group) {
    throw new Error(`${context} component_type이 시트와 다릅니다: ${componentType}`);
  }
  const inputSizeCode = required(row, 'input_size_code');
  if (!sheet.endsWith(`_${inputSizeCode}`)) {
    throw new Error(`${context} input_size_code가 시트 이름과 다릅니다: ${inputSizeCode}`);
  }
  const verificationStatus = required(row, 'verification_status');
  if (!EXPECTED_VERIFICATION_STATUSES.has(verificationStatus)) {
    throw new Error(`${context} 예상하지 못한 verification_status: ${verificationStatus}`);
  }
  const autoQuoteLevel = required(row, 'auto_quote_level');
  if (!EXPECTED_AUTO_QUOTE_LEVELS.has(autoQuoteLevel)) {
    throw new Error(`${context} 예상하지 못한 auto_quote_level: ${autoQuoteLevel}`);
  }
  return {
    inputSizeCode,
    eia: required(row, 'normalized_eia'),
    metricJis: required(row, 'metric_jis'),
    tolerancePercent: parseTolerance(required(row, 'tolerance'), context),
    autoQuoteLevel,
    verificationStatus,
    riskNote: row.values.get('risk_note')?.trim() ?? '',
  };
}

function parseRows(workbook: Awaited<ReturnType<typeof loadCatalogWorkbook>>): RowRecord[] {
  const records: RowRecord[] = [];
  for (const size of SIZE_CODES) {
    const resistorSheet = `R_${size}`;
    for (const row of sheetRows(workbook, resistorSheet, RESISTOR_HEADERS)) {
      const context = `${resistorSheet}!${String(row.rowNumber)}`;
      const common = commonRowFields(row, resistorSheet, 'R');
      const resistanceOhm = parseResistance(required(row, 'value'), context);
      records.push({
        group: 'R',
        sheet: resistorSheet,
        rowNumber: row.rowNumber,
        ...common,
        resistanceOhm,
        description: required(row, 'description'),
        capacitanceF: null,
        voltageV: null,
        dielectricRaw: null,
        dielectric: null,
        avlGroupId: `walsin-rlc:R:${common.eia}:${required(row, 'value')}:${required(row, 'tolerance')}`,
        vendors: vendorEntries(row, RESISTOR_VENDORS, context),
      });
    }

    const capacitorSheet = `C_${size}`;
    for (const row of sheetRows(workbook, capacitorSheet, CAPACITOR_HEADERS)) {
      const context = `${capacitorSheet}!${String(row.rowNumber)}`;
      const common = commonRowFields(row, capacitorSheet, 'C');
      const dielectricRaw = required(row, 'dielectric');
      const voltage = required(row, 'voltage');
      const capacitance = required(row, 'capacitance');
      records.push({
        group: 'C',
        sheet: capacitorSheet,
        rowNumber: row.rowNumber,
        ...common,
        resistanceOhm: null,
        // C 시트에는 description 열이 없다 — 사양에서 결정적으로 만든다.
        description: `Multilayer Ceramic Capacitor ${dielectricRaw} ${voltage}`,
        capacitanceF: parseCapacitance(capacitance, context),
        voltageV: parseVoltage(voltage, context),
        dielectricRaw,
        dielectric: normalizedDielectric(dielectricRaw),
        avlGroupId: `walsin-rlc:C:${common.eia}:${capacitance}:${required(row, 'tolerance')}:${voltage}:${dielectricRaw}`,
        vendors: vendorEntries(row, CAPACITOR_VENDORS, context),
      });
    }
  }
  return records;
}

function specSignature(row: RowRecord): string {
  return row.group === 'R'
    ? `R|${row.eia}|${String(row.resistanceOhm)}|${String(row.tolerancePercent)}`
    : `C|${row.eia}|${String(row.capacitanceF)}|${String(row.tolerancePercent)}|${String(row.voltageV)}|${String(row.dielectricRaw)}`;
}

function isCrossSizeDrop(row: RowRecord, manufacturerNorm: string): boolean {
  return CROSS_SIZE_DROPS.some(
    (rule) => rule.group === row.group
      && rule.eia === row.eia
      && rule.manufacturers.includes(manufacturerNorm),
  );
}

interface MergeResult {
  parts: PartRecord[];
  mergedSizeAliases: number;
  crossSizeDrops: number;
}

/**
 * (mpnNorm, manufacturerNorm)으로 병합한다.
 *
 * 같은 EIA를 가리키는 서로 다른 input_size_code(1005/402)는 같은 부품이므로 원본 표기만 모은다.
 * 서로 다른 EIA에 같은 MPN이 오는 것은 원본 오류이며, 교정 규칙에 해당하는 배정만 버린다.
 * 규칙 밖의 교차 배정이나 사양 자체가 어긋나는 중복은 적용 전에 중단한다.
 */
function mergeParts(rows: RowRecord[]): MergeResult {
  const byKey = new Map<string, PartRecord>();
  let mergedSizeAliases = 0;
  let crossSizeDrops = 0;

  for (const row of rows) {
    for (const vendor of row.vendors) {
      if (isCrossSizeDrop(row, vendor.manufacturerNorm)) {
        crossSizeDrops += 1;
        continue;
      }
      const key = `${vendor.manufacturerNorm}:${vendor.mpnNorm}`;
      const existing = byKey.get(key);
      if (existing === undefined) {
        byKey.set(key, {
          key,
          mpn: vendor.mpn,
          mpnNorm: vendor.mpnNorm,
          manufacturerName: vendor.manufacturerName,
          manufacturerNorm: vendor.manufacturerNorm,
          role: vendor.role,
          row,
          inputSizeCodes: [row.inputSizeCode],
          sheets: [row.sheet],
          sourceRecordIds: [row.rowNumber],
          siblings: row.vendors
            .filter(
              (entry) => entry.role !== vendor.role
                && !isCrossSizeDrop(row, entry.manufacturerNorm),
            )
            .map((entry) => ({ role: entry.role, manufacturer: entry.manufacturerName, mpn: entry.mpn })),
        });
        continue;
      }
      if (specSignature(existing.row) !== specSignature(row)) {
        throw new Error(
          `같은 품번이 서로 다른 사양으로 중복됩니다: ${key} `
          + `(${existing.sheets.join(',')} != ${row.sheet}!${String(row.rowNumber)})`,
        );
      }
      mergedSizeAliases += 1;
      if (!existing.inputSizeCodes.includes(row.inputSizeCode)) {
        existing.inputSizeCodes.push(row.inputSizeCode);
      }
      existing.sheets.push(row.sheet);
      existing.sourceRecordIds.push(row.rowNumber);
    }
  }
  return { parts: [...byKey.values()], mergedSizeAliases, crossSizeDrops };
}

function productFor(
  part: PartRecord,
  sourceFile: string,
  sourceSha256: string,
): Record<string, unknown> {
  const row = part.row;
  const normalizedSpecs: Record<string, unknown> = row.group === 'R'
    ? {
      part_type: 'resistor',
      resistance_ohm: row.resistanceOhm,
      tolerance_percent: row.tolerancePercent,
      package: row.eia,
      mounting_type: 'smd',
    }
    : {
      part_type: 'capacitor',
      capacitor_type: 'ceramic',
      capacitance_f: row.capacitanceF,
      tolerance_percent: row.tolerancePercent,
      voltage_v: row.voltageV,
      ...(row.dielectric === null ? {} : { dielectric: row.dielectric }),
      package: row.eia,
      mounting_type: 'smd',
    };

  return {
    supplier: part.manufacturerNorm,
    supplier_product_id: `walsin-rlc:${part.manufacturerNorm}:${part.mpnNorm}`,
    manufacturer_part_number: part.mpn,
    manufacturer: part.manufacturerName,
    manufacturer_evidence: 'structured',
    description: row.description,
    category: row.group === 'R' ? 'Chip Resistor' : 'Multilayer Ceramic Capacitor',
    package: row.eia,
    lifecycle_status: null,
    datasheet_url: null,
    image_url: null,
    normalized_specs: normalizedSpecs,
    catalog_metadata: {
      sourceDataset: sourceFile,
      sourceDatasetSha256: sourceSha256,
      sourceRecordIds: [...part.sourceRecordIds].sort((a, b) => a - b),
      bomMatchKey: part.mpnNorm,
      imageStatus: '없음',
      catalogOnly: true,
      commercialDataAvailable: false,
      // 규칙 생성 여부는 감사 정보로 보존한다. 판매 가능 여부는 별도 SamplePCB
      // 카탈로그 정책이며, 가격·재고는 이 필드로 추정하지 않는다.
      generatedMpn: row.verificationStatus !== SAMPLE_VERIFIED,
      verificationStatus: row.verificationStatus,
      autoQuoteLevel: row.autoQuoteLevel,
      autoQuoteEligible: true,
      apiVerificationRequired: false,
      samplepcbPreferred: true,
      samplepcbPreferenceRank: AVL_ROLE_RANK[part.role] ?? 100,
      ...(row.riskNote === '' ? {} : { riskNote: row.riskNote }),
      componentGroup: row.group,
      normalizedEia: row.eia,
      metricJis: row.metricJis,
      ...(row.dielectricRaw === null
        ? {}
        : {
          sourceDielectric: row.dielectricRaw,
          dielectricAmbiguous: row.dielectric === null,
        }),
      inputSizeCodes: [...part.inputSizeCodes].sort(),
      sourceSheets: [...part.sheets].sort(),
      avlGroupId: row.avlGroupId,
      avlRole: part.role,
      avlSiblings: part.siblings,
    },
    offers: [
      {
        supplier: part.manufacturerNorm,
        supplier_sku: part.mpn,
        offer_kind: 'manufacturer_catalog',
        purchasable: null,
        packaging: null,
        stock: null,
        moq: null,
        order_multiple: null,
        price_breaks: [],
        lead_time: null,
        product_url: null,
        fetched_at: `${BASIS_DATE}T00:00:00+09:00`,
      },
      {
        supplier: 'samplepcb',
        supplier_sku: part.mpn,
        offer_kind: 'manufacturer_catalog',
        purchasable: null,
        packaging: null,
        // 자체 취급 품목이지만 실시간 가용 재고 근거는 없으므로 null을 유지한다.
        stock: null,
        moq: null,
        order_multiple: null,
        price_breaks: [],
        lead_time: null,
        product_url: null,
        fetched_at: `${BASIS_DATE}T00:00:00+09:00`,
      },
    ],
  };
}

function assertDashboard(workbook: Awaited<ReturnType<typeof loadCatalogWorkbook>>): void {
  const dashboard = workbook.getWorksheet('00_Dashboard');
  if (dashboard === undefined) throw new Error('필수 시트가 없습니다: 00_Dashboard');
  const version = dashboard.getCell('B2').text.trim();
  if (version !== DASHBOARD_VERSION) {
    throw new Error(`대시보드 버전이 승인본과 다릅니다: ${version}`);
  }
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export async function buildWalsinRlcCatalogEnvelope(
  file: string,
): Promise<WalsinRlcWorkbookResult> {
  const buffer = await readFile(file);
  const sourceSha256 = createHash('sha256').update(buffer).digest('hex');
  if (sourceSha256 !== WALSIN_RLC_SOURCE_SHA256) {
    throw new Error(
      `승인된 Walsin R/C 원본 해시와 다릅니다: ${sourceSha256} != ${WALSIN_RLC_SOURCE_SHA256}`,
    );
  }
  const workbook = await loadCatalogWorkbook(buffer);
  assertDashboard(workbook);

  const rows = parseRows(workbook);
  const resistorRows = rows.filter((row) => row.group === 'R').length;
  const capacitorRows = rows.filter((row) => row.group === 'C').length;
  if (resistorRows !== EXPECTED_RESISTOR_ROWS) {
    throw new Error(`저항 행 수가 다릅니다: ${String(resistorRows)} != ${String(EXPECTED_RESISTOR_ROWS)}`);
  }
  if (capacitorRows !== EXPECTED_CAPACITOR_ROWS) {
    throw new Error(`캐패시터 행 수가 다릅니다: ${String(capacitorRows)} != ${String(EXPECTED_CAPACITOR_ROWS)}`);
  }
  const emptyVendorCells = rows.reduce((total, row) => total + (5 - row.vendors.length), 0);
  if (emptyVendorCells !== EXPECTED_EMPTY_VENDOR_CELLS) {
    throw new Error(
      `빈 벤더 셀 수가 다릅니다: ${String(emptyVendorCells)} != ${String(EXPECTED_EMPTY_VENDOR_CELLS)}`,
    );
  }
  const emptyRows = rows.filter((row) => row.vendors.length === 0).length;
  if (emptyRows !== EXPECTED_EMPTY_ROWS) {
    throw new Error(`빈 행 수가 다릅니다: ${String(emptyRows)} != ${String(EXPECTED_EMPTY_ROWS)}`);
  }
  const sampleVerifiedRows = rows.filter((row) => row.verificationStatus === SAMPLE_VERIFIED).length;
  if (sampleVerifiedRows !== EXPECTED_SAMPLE_VERIFIED_ROWS) {
    throw new Error(
      `표본 검증 행 수가 다릅니다: ${String(sampleVerifiedRows)} != ${String(EXPECTED_SAMPLE_VERIFIED_ROWS)}`,
    );
  }

  const { parts, mergedSizeAliases, crossSizeDrops } = mergeParts(rows);

  // 교정 규칙 밖의 교차 사이즈 배정이 남아 있으면 원본 해석이 바뀐 것이다.
  const eiaByKey = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const vendor of row.vendors) {
      if (isCrossSizeDrop(row, vendor.manufacturerNorm)) continue;
      const key = `${vendor.manufacturerNorm}:${vendor.mpnNorm}`;
      const set = eiaByKey.get(key) ?? new Set<string>();
      set.add(row.eia);
      eiaByKey.set(key, set);
    }
  }
  const unresolved = [...eiaByKey.entries()].filter(([, eias]) => eias.size > 1);
  if (unresolved.length > 0) {
    throw new Error(
      `교정되지 않은 교차 사이즈 중복이 ${String(unresolved.length)}건 남았습니다: `
      + unresolved.slice(0, 3).map(([key, eias]) => `${key}(${[...eias].join(',')})`).join(', '),
    );
  }
  if (crossSizeDrops !== EXPECTED_CROSS_SIZE_DROPS) {
    throw new Error(`교차 사이즈 교정 건수가 다릅니다: ${String(crossSizeDrops)} != ${String(EXPECTED_CROSS_SIZE_DROPS)}`);
  }
  if (mergedSizeAliases !== EXPECTED_MERGED_SIZE_ALIASES) {
    throw new Error(`사이즈 표기 병합 건수가 다릅니다: ${String(mergedSizeAliases)} != ${String(EXPECTED_MERGED_SIZE_ALIASES)}`);
  }
  if (parts.length !== EXPECTED_PARTS) {
    throw new Error(`부품 수가 다릅니다: ${String(parts.length)} != ${String(EXPECTED_PARTS)}`);
  }

  const sourceFile = path.basename(file);
  const sorted = [...parts].sort((a, b) => a.key.localeCompare(b.key));
  const products = sorted.map((part) => productFor(part, sourceFile, sourceSha256));
  const manufacturerCounts = countBy(sorted.map((part) => part.manufacturerName));
  // 부품이 하나도 없는 행은 AVL 그룹을 이루지 못한다.
  const avlGroups = new Set(
    rows.filter((row) => row.vendors.length > 0).map((row) => row.avlGroupId),
  ).size;
  const resistorParts = sorted.filter((part) => part.row.group === 'R').length;
  const capacitorParts = sorted.filter((part) => part.row.group === 'C').length;
  const sampleVerifiedParts = sorted.filter(
    (part) => part.row.verificationStatus === SAMPLE_VERIFIED,
  ).length;

  const envelope = {
    schemaVersion: 'sp-parts-catalog-ingest-envelope/v2',
    generatedAt: `${BASIS_DATE}T00:00:00+09:00`,
    source: {
      file: sourceFile,
      sha256: sourceSha256,
      basisDate: BASIS_DATE,
      manufacturer: 'Walsin Technology (primary) + AVL vendors',
      manufacturerNormExpected: 'walsin',
      officialSite: 'https://www.passivecomponent.com/',
      sheetsAnalyzed: [
        '00_Dashboard',
        ...SIZE_CODES.map((size) => `R_${size}`),
        ...SIZE_CODES.map((size) => `C_${size}`),
      ],
      sha256Verified: true,
    },
    analysis: {
      outputUniqueParts: products.length,
      resistorRows,
      capacitorRows,
      resistorParts,
      capacitorParts,
      sampleVerifiedParts,
      mergedSizeAliases,
      crossSizeDrops,
      emptyVendorCells,
      emptyRows,
      manufacturerCounts,
      avlGroups,
      conflictingDuplicateGroups: [],
    },
    search: {
      components: [
        {
          component_id: `catalog:walsin-rlc:${BASIS_DATE}`,
          source: 'manufacturer_catalog',
          candidates: sorted.map((part, index) => ({
            catalog_candidate_id: `walsin-rlc:${part.key}`,
            product: products[index],
          })),
        },
      ],
    },
  };

  return {
    envelope,
    stats: {
      sourceSha256,
      basisDate: BASIS_DATE,
      parts: products.length,
      resistorRows,
      capacitorRows,
      resistorParts,
      capacitorParts,
      sampleVerifiedParts,
      mergedSizeAliases,
      crossSizeDrops,
      emptyVendorCells,
      emptyRows,
      manufacturerCounts,
      avlGroups,
    },
  };
}
