import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { normalizeMpn } from '@sp/utils';

export const YEONHO_REV2_SOURCE_SHA256 =
  '8612d52bb7858f3a994d9fed0e1d7e1bb706bdf233a9794e231600d9a103a9e6';
export const YEONHO_RETIRED_SOURCE_SHA256 =
  '35167e82504b04a569edaabd0ab0793ff57d3f8e3f0e6e8f4ca086a13ff7b9b4';

const EXPECTED_PARTS = 1_606;
const EXPECTED_DIRECT_PARTS = 1_239;
const EXPECTED_DERIVED_PARTS = 367;
const EXPECTED_SERIES = 91;
const EXPECTED_CATEGORIES = new Set([
  'Board to Board',
  'FFC/BOARD',
  'FFC/FPC',
  'I/O Connector',
  'Wire to Board',
  'Wire to Wire',
]);
const EXPECTED_COMPONENT_TYPES = new Set([
  'Connector',
  'Housing',
  'Receptacle',
  'Terminal',
  'Wafer',
]);

interface WorkbookRow {
  rowNumber: number;
  values: Map<string, string>;
}

interface SeriesRecord {
  id: number;
  category: string;
  pitchMm: number;
  familyPattern: string;
  availablePins: number[];
  description: string;
  imageUrl: string;
  catalogPdf: string;
  sourceUrl: string;
}

interface OfficialMpnRecord {
  id: number;
  manufacturer: string;
  manufacturerKorean: string;
  mpn: string;
  mpnNorm: string;
  connectorComponentType: string;
  category: string;
  pitchMm: number;
  pins: number | null;
  verificationStatus: 'OFFICIAL_MPN' | 'OFFICIAL_DERIVED';
  familyPattern: string;
  pdfFile: string;
  evidenceLine: number;
  evidenceText: string;
  catalogPdf: string;
  sourceUrl: string;
  imageUrl: string;
  sourceCount: number;
  seriesIds: number[];
}

export interface YeonhoCatalogWorkbookStats {
  sourceSha256: string;
  basisDate: string;
  parts: number;
  directParts: number;
  derivedParts: number;
  series: number;
  missingPins: number;
  categoryCounts: Record<string, number>;
  componentTypeCounts: Record<string, number>;
}

export interface YeonhoCatalogWorkbookResult {
  envelope: unknown;
  stats: YeonhoCatalogWorkbookStats;
}

function xmlText(data: Uint8Array): Uint8Array {
  const normalized = strFromU8(data)
    // 이 파일은 유효한 SpreadsheetML이지만 모든 핵심 태그에 x: prefix를 쓴다.
    // ExcelJS가 기대하는 기본 namespace로 바꿔 셀 데이터만 안전하게 읽는다.
    .replace(/(<\/?)x:/g, '$1')
    .replace(/xmlns:x=/g, 'xmlns=')
    // 카탈로그 변환에는 셀 값만 필요하다. 표·도형 관계를 제거하면 ExcelJS가
    // 절대 Target과 prefix가 붙은 drawing XML을 해석하다 실패하는 것을 피한다.
    .replace(/<tableParts\b[^>]*>[\s\S]*?<\/tableParts>/g, '')
    .replace(/<drawing\b[^>]*\/>/g, '');
  return strToU8(normalized);
}

function excelJsCompatibleArchive(buffer: Buffer): Uint8Array {
  const archive = unzipSync(new Uint8Array(buffer));
  const compatible: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(archive)) {
    if (
      name.startsWith('xl/tables/')
      || name.startsWith('xl/drawings/')
      || name.startsWith('xl/media/')
      || name.startsWith('xl/worksheets/_rels/')
    ) continue;
    compatible[name] = name.startsWith('xl/') && name.endsWith('.xml') ? xmlText(data) : data;
  }
  return zipSync(compatible);
}

function cellText(row: ExcelJS.Row, column: number): string {
  return row.getCell(column).text.trim();
}

function sheetRows(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  requiredHeaders: readonly string[],
): WorkbookRow[] {
  const sheet = workbook.getWorksheet(sheetName);
  if (sheet === undefined) throw new Error(`필수 시트가 없습니다: ${sheetName}`);
  const headers = new Map<string, number>();
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    const header = cellText(sheet.getRow(1), column);
    if (header !== '') headers.set(header, column);
  }
  for (const header of requiredHeaders) {
    if (!headers.has(header)) throw new Error(`${sheetName} 시트에 필수 열이 없습니다: ${header}`);
  }
  const rows: WorkbookRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if ([...headers.values()].every((column) => cellText(row, column) === '')) continue;
    rows.push({
      rowNumber,
      values: new Map(
        [...headers.entries()].map(([header, column]) => [header, cellText(row, column)]),
      ),
    });
  }
  return rows;
}

function required(row: WorkbookRow, field: string): string {
  const value = row.values.get(field)?.trim() ?? '';
  if (value === '') throw new Error(`${String(row.rowNumber)}행 필수 값이 비었습니다: ${field}`);
  return value;
}

function integer(value: string, context: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`양의 정수가 아닙니다: ${context}=${value}`);
  return parsed;
}

function positiveNumber(value: string, context: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`양수가 아닙니다: ${context}=${value}`);
  return parsed;
}

function optionalInteger(value: string, context: string): number | null {
  return value === '' ? null : integer(value, context);
}

function integerList(value: string, context: string): number[] {
  const parsed = value.split(',').map((item) => integer(item.trim(), context));
  if (parsed.length === 0) throw new Error(`정수 목록이 비었습니다: ${context}`);
  return [...new Set(parsed)];
}

function assertUrl(value: string, context: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol');
  } catch {
    throw new Error(`URL이 올바르지 않습니다: ${context}=${value}`);
  }
  return value;
}

function countBy(values: string[]): Record<string, number> {
  return Object.fromEntries(
    [...new Set(values)].sort().map((value) => [
      value,
      values.filter((candidate) => candidate === value).length,
    ]),
  );
}

function productHeightMm(description: string): number[] {
  const clause = /Product Height is\s+(.+?)(?=\s+\d+\.\s|$)/i.exec(description)?.[1];
  if (clause === undefined) return [];
  return [...clause.matchAll(/(\d+(?:\.\d+)?)\s*mm/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function parseSeries(workbook: ExcelJS.Workbook): Map<number, SeriesRecord> {
  const rows = sheetRows(workbook, '시리즈_카탈로그', [
    'SERIES_ID',
    'CATEGORY',
    'PITCH_mm',
    'FAMILY_PATTERN',
    'AVAILABLE_PINS',
    'DESCRIPTION',
    'IMAGE_URL',
    'CATALOG_PDF',
    'SOURCE_URL',
  ]);
  if (rows.length !== EXPECTED_SERIES) {
    throw new Error(`시리즈 수량이 다릅니다: ${String(rows.length)} != ${String(EXPECTED_SERIES)}`);
  }
  const result = new Map<number, SeriesRecord>();
  for (const row of rows) {
    const id = integer(required(row, 'SERIES_ID'), `시리즈 ${String(row.rowNumber)}`);
    if (result.has(id)) throw new Error(`SERIES_ID가 중복됩니다: ${String(id)}`);
    const category = required(row, 'CATEGORY');
    if (!EXPECTED_CATEGORIES.has(category)) throw new Error(`알 수 없는 카테고리: ${category}`);
    result.set(id, {
      id,
      category,
      pitchMm: positiveNumber(required(row, 'PITCH_mm'), `SERIES_ID ${String(id)} pitch`),
      familyPattern: required(row, 'FAMILY_PATTERN'),
      availablePins: integerList(required(row, 'AVAILABLE_PINS'), `SERIES_ID ${String(id)} pins`),
      description: required(row, 'DESCRIPTION'),
      imageUrl: assertUrl(required(row, 'IMAGE_URL'), `SERIES_ID ${String(id)} image`),
      catalogPdf: assertUrl(required(row, 'CATALOG_PDF'), `SERIES_ID ${String(id)} pdf`),
      sourceUrl: assertUrl(required(row, 'SOURCE_URL'), `SERIES_ID ${String(id)} source`),
    });
  }
  return result;
}

function verificationSet(
  workbook: ExcelJS.Workbook,
  sheetName: '정식품번_직접확인' | '주문코드_승인도전개',
): Set<string> {
  const rows = sheetRows(workbook, sheetName, ['MPN_ORIGINAL', 'MPN_NORMALIZED']);
  const result = new Set<string>();
  for (const row of rows) {
    const original = required(row, 'MPN_ORIGINAL');
    const normalized = required(row, 'MPN_NORMALIZED');
    if (normalizeMpn(original) !== normalized) {
      throw new Error(`${sheetName} ${String(row.rowNumber)}행 MPN 정규화가 다릅니다`);
    }
    if (result.has(normalized)) throw new Error(`${sheetName} MPN이 중복됩니다: ${normalized}`);
    result.add(normalized);
  }
  return result;
}

function parseOfficialParts(
  workbook: ExcelJS.Workbook,
  seriesById: Map<number, SeriesRecord>,
): OfficialMpnRecord[] {
  const rows = sheetRows(workbook, 'OFFICIAL_MPN_DB', [
    'ID',
    'MANUFACTURER',
    '제조사',
    'MPN_ORIGINAL',
    'MPN_NORMALIZED',
    'PART_TYPE',
    'CATEGORY',
    'PITCH_mm',
    'PINS',
    'VERIFICATION_STATUS',
    'FAMILY_PATTERN',
    'PDF_FILE',
    'EVIDENCE_LINE',
    'EVIDENCE_TEXT',
    'CATALOG_PDF',
    'SOURCE_URL',
    'IMAGE_URL',
    'SOURCE_COUNT',
    'SERIES_IDS',
  ]);
  if (rows.length !== EXPECTED_PARTS) {
    throw new Error(`공식 MPN 수량이 다릅니다: ${String(rows.length)} != ${String(EXPECTED_PARTS)}`);
  }
  const seen = new Set<string>();
  return rows.map((row): OfficialMpnRecord => {
    const id = integer(required(row, 'ID'), `OFFICIAL_MPN_DB ${String(row.rowNumber)}행 ID`);
    const mpn = required(row, 'MPN_ORIGINAL');
    const mpnNorm = required(row, 'MPN_NORMALIZED');
    if (normalizeMpn(mpn) !== mpnNorm) {
      throw new Error(`OFFICIAL_MPN_DB ${String(row.rowNumber)}행 MPN 정규화가 다릅니다`);
    }
    if (seen.has(mpnNorm)) throw new Error(`공식 MPN이 중복됩니다: ${mpnNorm}`);
    seen.add(mpnNorm);
    const connectorComponentType = required(row, 'PART_TYPE');
    if (!EXPECTED_COMPONENT_TYPES.has(connectorComponentType)) {
      throw new Error(`알 수 없는 커넥터 구성 유형: ${connectorComponentType}`);
    }
    const category = required(row, 'CATEGORY');
    if (!EXPECTED_CATEGORIES.has(category)) throw new Error(`알 수 없는 카테고리: ${category}`);
    const pitchMm = positiveNumber(required(row, 'PITCH_mm'), `${mpn} pitch`);
    const verification = required(row, 'VERIFICATION_STATUS');
    if (verification !== 'OFFICIAL_MPN' && verification !== 'OFFICIAL_DERIVED') {
      throw new Error(`알 수 없는 공식 품번 검증 상태: ${mpn}/${verification}`);
    }
    const seriesIds = integerList(required(row, 'SERIES_IDS'), `${mpn} series`);
    const referencedSeries = seriesIds.map((seriesId) => {
      const series = seriesById.get(seriesId);
      if (series === undefined) throw new Error(`${mpn}이 없는 SERIES_ID를 참조합니다: ${String(seriesId)}`);
      return series;
    });
    if (!referencedSeries.some((series) => series.category === category && series.pitchMm === pitchMm)) {
      throw new Error(`${mpn}의 카테고리·피치가 참조 시리즈와 다릅니다`);
    }
    const familyPattern = required(row, 'FAMILY_PATTERN');
    if (!referencedSeries.some((series) => series.familyPattern === familyPattern)) {
      throw new Error(`${mpn}의 FAMILY_PATTERN이 참조 시리즈에 없습니다: ${familyPattern}`);
    }
    return {
      id,
      manufacturer: required(row, 'MANUFACTURER'),
      manufacturerKorean: required(row, '제조사'),
      mpn,
      mpnNorm,
      connectorComponentType,
      category,
      pitchMm,
      pins: optionalInteger(row.values.get('PINS') ?? '', `${mpn} pins`),
      verificationStatus: verification,
      familyPattern,
      pdfFile: required(row, 'PDF_FILE'),
      evidenceLine: integer(required(row, 'EVIDENCE_LINE'), `${mpn} evidence line`),
      evidenceText: required(row, 'EVIDENCE_TEXT'),
      catalogPdf: assertUrl(required(row, 'CATALOG_PDF'), `${mpn} pdf`),
      sourceUrl: assertUrl(required(row, 'SOURCE_URL'), `${mpn} source`),
      imageUrl: assertUrl(required(row, 'IMAGE_URL'), `${mpn} image`),
      sourceCount: integer(required(row, 'SOURCE_COUNT'), `${mpn} source count`),
      seriesIds,
    };
  });
}

function assertWorkbookInvariants(
  workbook: ExcelJS.Workbook,
  parts: OfficialMpnRecord[],
  direct: Set<string>,
  derived: Set<string>,
): string {
  if (direct.size !== EXPECTED_DIRECT_PARTS) {
    throw new Error(`직접 확인 MPN 수량이 다릅니다: ${String(direct.size)} != ${String(EXPECTED_DIRECT_PARTS)}`);
  }
  if (derived.size !== EXPECTED_DERIVED_PARTS) {
    throw new Error(`승인도 전개 MPN 수량이 다릅니다: ${String(derived.size)} != ${String(EXPECTED_DERIVED_PARTS)}`);
  }
  for (const value of direct) {
    if (derived.has(value)) throw new Error(`직접 확인과 승인도 전개에 MPN이 중복됩니다: ${value}`);
  }
  const all = new Set([...direct, ...derived]);
  const official = new Set(parts.map((part) => part.mpnNorm));
  if (
    all.size !== official.size
    || [...all].some((value) => !official.has(value))
    || parts.some((part) => {
      const expected = direct.has(part.mpnNorm) ? 'OFFICIAL_MPN' : 'OFFICIAL_DERIVED';
      return part.verificationStatus !== expected;
    })
  ) {
    throw new Error('직접 확인·승인도 전개 시트와 OFFICIAL_MPN_DB의 합집합이 다릅니다');
  }
  if (official.has('1250508')) throw new Error('폐기 대상 가상 품번 12505-08이 포함되었습니다');
  for (const expected of ['12505WS08', '12505HS08', '12505WR08', '12505TS1']) {
    if (!official.has(expected)) throw new Error(`12505 검증 품번이 누락되었습니다: ${expected}`);
  }

  const guide = workbook.getWorksheet('안내');
  if (guide === undefined) throw new Error('필수 시트가 없습니다: 안내');
  const basisDate = guide.getCell('B4').text.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(basisDate)) throw new Error(`개정 기준일이 잘못되었습니다: ${basisDate}`);
  if (Number(guide.getCell('B7').text) !== EXPECTED_PARTS) throw new Error('안내 시트 공식 MPN 합계가 다릅니다');
  if (Number(guide.getCell('B8').text) !== EXPECTED_DIRECT_PARTS) {
    throw new Error('안내 시트 직접 확인 MPN 합계가 다릅니다');
  }
  if (Number(guide.getCell('B9').text) !== EXPECTED_DERIVED_PARTS) {
    throw new Error('안내 시트 승인도 전개 MPN 합계가 다릅니다');
  }
  return basisDate;
}

function productFor(
  part: OfficialMpnRecord,
  seriesById: Map<number, SeriesRecord>,
  sourceFile: string,
  sourceSha256: string,
  basisDate: string,
): Record<string, unknown> {
  const referencedSeries = part.seriesIds.flatMap((id) => {
    const series = seriesById.get(id);
    return series === undefined ? [] : [series];
  });
  const primarySeries = referencedSeries.find((series) => series.familyPattern === part.familyPattern)
    ?? referencedSeries[0];
  if (primarySeries === undefined) throw new Error(`${part.mpn}의 설명 원본 시리즈가 없습니다`);
  const availablePins = [...new Set(referencedSeries.flatMap((series) => series.availablePins))]
    .sort((a, b) => a - b);
  const heights = productHeightMm(primarySeries.description);
  const derived = part.verificationStatus === 'OFFICIAL_DERIVED';
  return {
    supplier: 'yeonho',
    supplier_product_id: `yeonho:${part.mpnNorm}`,
    manufacturer_part_number: part.mpn,
    manufacturer: part.manufacturer,
    manufacturer_evidence: 'structured',
    description: primarySeries.description,
    category: part.category,
    package: null,
    lifecycle_status: null,
    datasheet_url: part.catalogPdf,
    image_url: part.imageUrl,
    normalized_specs: {
      part_type: 'connector',
      connector_category: part.category,
      connector_component_type: part.connectorComponentType,
      ...(part.pins === null ? {} : { pin_count: part.pins }),
      pitch_mm: part.pitchMm,
      family_pattern: part.familyPattern,
      series_available_pins: availablePins,
      ...(heights.length === 0 ? {} : { product_height_mm: heights }),
    },
    catalog_metadata: {
      sourceDataset: sourceFile,
      sourceDatasetSha256: sourceSha256,
      sourceRecordIds: [part.id],
      seriesIds: part.seriesIds,
      manufacturerKorean: part.manufacturerKorean,
      familyPattern: part.familyPattern,
      bomMatchKey: part.mpnNorm,
      sourceUrl: part.sourceUrl,
      originalImageUrl: part.imageUrl,
      imageStatus: '수집완료',
      identityProvenance: derived
        ? 'official_drawing_order_code_plus_pin_table'
        : 'official_drawing_table',
      verificationStatus: part.verificationStatus,
      generatedMpn: derived,
      orderCodeConfirmationRecommended: derived,
      catalogOnly: true,
      commercialDataAvailable: false,
      evidence: {
        pdfFile: part.pdfFile,
        line: part.evidenceLine,
        text: part.evidenceText,
        sourceCount: part.sourceCount,
      },
    },
    offers: [
      {
        supplier: 'yeonho',
        supplier_sku: part.mpn,
        offer_kind: 'manufacturer_catalog',
        purchasable: null,
        packaging: null,
        stock: null,
        moq: null,
        order_multiple: null,
        price_breaks: [],
        lead_time: null,
        product_url: part.sourceUrl,
        fetched_at: `${basisDate}T00:00:00+09:00`,
      },
    ],
  };
}

/**
 * Rev2 공식품번 워크북을 기존 supplier-search ingest envelope로 결정적으로 변환한다.
 * 워크북을 정본으로 유지하고 1,606개 후보 JSON을 Git에 이중 저장하지 않는다.
 */
export async function buildYeonhoCatalogEnvelope(
  file: string,
): Promise<YeonhoCatalogWorkbookResult> {
  const buffer = await readFile(file);
  const sourceSha256 = createHash('sha256').update(buffer).digest('hex');
  if (sourceSha256 !== YEONHO_REV2_SOURCE_SHA256) {
    throw new Error(
      `승인된 연호 Rev2 원본 해시와 다릅니다: ${sourceSha256} != ${YEONHO_REV2_SOURCE_SHA256}`,
    );
  }
  const workbook = new ExcelJS.Workbook();
  const compatible = excelJsCompatibleArchive(buffer);
  await workbook.xlsx.load(
    Buffer.from(compatible) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );

  const seriesById = parseSeries(workbook);
  const parts = parseOfficialParts(workbook, seriesById);
  const direct = verificationSet(workbook, '정식품번_직접확인');
  const derived = verificationSet(workbook, '주문코드_승인도전개');
  const basisDate = assertWorkbookInvariants(workbook, parts, direct, derived);
  const sourceFile = path.basename(file);
  const products = parts.map((part) =>
    productFor(part, seriesById, sourceFile, sourceSha256, basisDate),
  );
  const categoryCounts = countBy(parts.map((part) => part.category));
  const componentTypeCounts = countBy(parts.map((part) => part.connectorComponentType));
  const envelope = {
    schemaVersion: 'sp-parts-catalog-ingest-envelope/v2',
    generatedAt: `${basisDate}T00:00:00+09:00`,
    source: {
      file: sourceFile,
      sha256: sourceSha256,
      basisDate,
      manufacturer: 'YEONHO ELECTRONICS',
      manufacturerNormExpected: 'yeonho',
      officialSite: 'https://www.yeonho.com/',
      sheetsAnalyzed: [
        '안내',
        '12505_검증',
        'OFFICIAL_MPN_DB',
        '정식품번_직접확인',
        '주문코드_승인도전개',
        '시리즈_카탈로그',
        '제품이미지',
        'BOM_매칭규칙',
      ],
      sha256Verified: true,
    },
    analysis: {
      sourceSeries: seriesById.size,
      outputUniqueParts: products.length,
      directOfficialParts: direct.size,
      derivedOfficialParts: derived.size,
      conflictingDuplicateGroups: [],
      categoryCounts,
      componentTypeCounts,
      missingPins: parts.filter((part) => part.pins === null).length,
    },
    search: {
      components: [
        {
          component_id: `catalog:yeonho:${basisDate}`,
          source: 'manufacturer_catalog',
          candidates: products.map((product, index) => ({
            catalog_candidate_id: `yeonho:${parts[index]?.mpnNorm ?? String(index + 1)}`,
            product,
          })),
        },
      ],
    },
  };
  return {
    envelope,
    stats: {
      sourceSha256,
      basisDate,
      parts: parts.length,
      directParts: direct.size,
      derivedParts: derived.size,
      series: seriesById.size,
      missingPins: parts.filter((part) => part.pins === null).length,
      categoryCounts,
      componentTypeCounts,
    },
  };
}
