import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

// 제조사 카탈로그 워크북 공용 로더 — 연호·월신 등 외부에서 받은 xlsx는 유효한
// SpreadsheetML이지만 모든 핵심 태그에 x: prefix를 쓰고 표·도형 관계를 함께 담고 있어
// ExcelJS가 그대로는 읽지 못한다. 셀 값만 필요하므로 안전하게 재압축해서 넘긴다.

function xmlText(data: Uint8Array): Uint8Array {
  const normalized = strFromU8(data)
    .replace(/(<\/?)x:/g, '$1')
    .replace(/xmlns:x=/g, 'xmlns=')
    // 카탈로그 변환에는 셀 값만 필요하다. 표·도형 관계를 제거하면 ExcelJS가
    // 절대 Target과 prefix가 붙은 drawing XML을 해석하다 실패하는 것을 피한다.
    .replace(/<tableParts\b[^>]*>[\s\S]*?<\/tableParts>/g, '')
    .replace(/<drawing\b[^>]*\/>/g, '');
  return strToU8(normalized);
}

export function excelJsCompatibleArchive(buffer: Buffer): Uint8Array {
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

export async function loadCatalogWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const compatible = excelJsCompatibleArchive(buffer);
  await workbook.xlsx.load(
    Buffer.from(compatible) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  return workbook;
}

export function cellText(row: ExcelJS.Row, column: number): string {
  return row.getCell(column).text.trim();
}

export interface WorkbookRow {
  rowNumber: number;
  values: Map<string, string>;
}

/** 1행을 헤더로 읽고 필수 열을 확인한 뒤, 값이 모두 빈 행을 제외해 반환한다. */
export function sheetRows(
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
    const values = new Map<string, string>();
    for (const [header, column] of headers) values.set(header, cellText(row, column));
    rows.push({ rowNumber, values });
  }
  return rows;
}
