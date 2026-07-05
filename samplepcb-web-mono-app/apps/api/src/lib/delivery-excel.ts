// ── 엑셀 배송처리 (레거시 orderdeliveryexcel.php·orderdeliveryupdate.php 이식) ──
// 다운로드: od_status='준비' AND od_misu=0 주문을 xlsx 로. 업로드: xlsx 를 파싱해 운송장 정보를
// 추출 → 기존 matchDeliveryRows+setOrdersDelivery(⑬) 재사용. 순수 헬퍼(csvSafeCell·printAddress·
// deliveryRowToCells·extractDeliveryRowsFromMatrix)는 DB/파일 없이 테스트한다.
import ExcelJS from 'exceljs';
import type { DeliveryExcelRow } from './g5-db';

// 엑셀 헤더 10열(레거시 orderdeliveryexcel.php:26 미러 — 순서·라벨 고정).
export const DELIVERY_EXCEL_HEADERS = [
  '주문번호',
  '주문자명',
  '주문자전화1',
  '주문자전화2',
  '배송자명',
  '배송지전화1',
  '배송지전화2',
  '배송지주소',
  '배송회사',
  '운송장번호',
] as const;

// 열 너비(레거시 :27 미러).
const DELIVERY_EXCEL_WIDTHS = [18, 15, 15, 15, 15, 15, 15, 50, 20, 20];
const DELIVERY_HEADER_ARGB = 'FFABCDEF'; // 레거시 :28 헤더 배경색

// CSV/Excel 수식 인젝션 방지(코어 csv_safe_cell, common.lib.php:222 미러).
// =,+,-,@,TAB,CR 로 시작하는 값은 작은따옴표를 prefix 해 수식 해석을 차단.
export function csvSafeCell(v: string): string {
  if (v === '') return v;
  const first = v[0];
  if (
    first === '=' ||
    first === '+' ||
    first === '-' ||
    first === '@' ||
    first === '\t' ||
    first === '\r'
  ) {
    return `'${v}`;
  }
  return v;
}

// 배송지 주소 조립(코어 print_address, common.lib.php:3755 미러). addr4('N'=공백 구분, 그 외=쉼표
// 구분)로 addr2 를 잇고 addr3 를 공백으로 잇는다. 코어의 get_text(HTML escape)는 엑셀 셀에
// 부적절해 생략한다(플레인 텍스트 — 의도적 개선).
export function printAddress(addr1: string, addr2: string, addr3: string, addr4: string): string {
  let address = addr1.trim();
  const a2 = addr2.trim();
  const a3 = addr3.trim();
  if (addr4 === 'N') {
    if (a2 !== '') address += ` ${a2}`;
  } else {
    if (a2 !== '') address += `, ${a2}`;
  }
  if (a3 !== '') address += ` ${a3}`;
  return address;
}

// DeliveryExcelRow → 셀 값 10개(순서 = DELIVERY_EXCEL_HEADERS). od_id·전화는 문자열 셀로 그대로
// (코어의 앞 공백 hack 은 exceljs 문자열 셀이 대체 — 빅넘버·앞자리 0 보존). 텍스트 필드는 csvSafeCell.
export function deliveryRowToCells(r: DeliveryExcelRow): string[] {
  return [
    r.odId,
    csvSafeCell(r.odName),
    r.odTel,
    r.odHp,
    csvSafeCell(r.bName),
    r.bTel,
    r.bHp,
    csvSafeCell(printAddress(r.bAddr1, r.bAddr2, r.bAddr3, r.bAddrJibeon)),
    csvSafeCell(r.deliveryCompany),
    csvSafeCell(r.invoiceNo),
  ];
}

// 배송 엑셀 워크북 생성 → xlsx Buffer. 헤더 배경색·열너비 + 전 셀 문자열(빅넘버 방지).
export async function buildDeliveryWorkbook(rows: DeliveryExcelRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('배송처리');
  ws.columns = DELIVERY_EXCEL_HEADERS.map((header, i) => ({
    header,
    width: DELIVERY_EXCEL_WIDTHS[i] ?? 15,
  }));

  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DELIVERY_HEADER_ARGB } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.font = { bold: true };
  });

  for (const r of rows) {
    const added = ws.addRow(deliveryRowToCells(r));
    added.eachCell((cell) => {
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// exceljs CellValue → 문자열(숫자/날짜/수식결과/richText/하이퍼링크 모두 문자열화).
function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText.map((t) => t.text).join('');
    }
    if ('text' in v && typeof v.text === 'string') return v.text; // 하이퍼링크
    if ('result' in v) {
      // 수식 결과 — 원시값만 문자열화(CellErrorValue 등 객체는 빈 값).
      const r: unknown = v.result;
      if (typeof r === 'string') return r;
      if (typeof r === 'number' || typeof r === 'boolean') return String(r);
      if (r instanceof Date) return r.toISOString();
    }
  }
  return '';
}

// 업로드 xlsx → 2D 문자열 매트릭스(비어있지 않은 행만, A..J = 10열). 첫 행은 헤더.
export async function readDeliverySheet(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  // exceljs 는 자체 `Buffer`(ArrayBuffer 확장) 타입을 선언 — Node Buffer(Uint8Array 뷰)와 타입이
  // 갈린다. 런타임은 Node Buffer 를 그대로 받으므로 load 파라미터 타입으로만 캐스팅한다.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (ws === undefined) return [];
  const matrix: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= 10; c++) {
      cells.push(cellToString(row.getCell(c).value));
    }
    matrix.push(cells);
  });
  return matrix;
}

// 매트릭스(헤더 포함) → 배송 입력 후보. 첫 행(헤더) 제외. A=od_id, I=배송회사, J=운송장번호
// (코어 orderdeliveryupdate.php:41-43 의 컬럼 인덱스 0/8/9 미러). od_id 앞 공백은 trim.
// 세 값이 모두 빈 행은 스킵(엑셀 잔여 빈 행 방어). 필드 결손 판정은 후단 matchDeliveryRows 가 담당.
export interface DeliveryExcelParsed {
  odId: string;
  deliveryCompany: string;
  invoiceNo: string;
}

export function extractDeliveryRowsFromMatrix(matrix: string[][]): DeliveryExcelParsed[] {
  const out: DeliveryExcelParsed[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (row === undefined) continue;
    const odId = (row[0] ?? '').trim();
    const deliveryCompany = (row[8] ?? '').trim();
    const invoiceNo = (row[9] ?? '').trim();
    if (odId === '' && deliveryCompany === '' && invoiceNo === '') continue;
    out.push({ odId, deliveryCompany, invoiceNo });
  }
  return out;
}
