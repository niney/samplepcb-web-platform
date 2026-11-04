import ExcelJS from 'exceljs';
import type { SpDevelopRequest } from '@prisma/client';
import {
  DEVELOP_MILESTONE_TRIGGER_LABELS,
  DEVELOP_QUOTE_SUPPLIER,
  developBpPercent,
  developQuoteNo,
  developQuoteRemarks,
  developQuoteSheetRows,
  developQuoteXlsxName,
} from '@sp/api-contract';
import type { DevelopQuoteSheetRecipient, DevelopQuoteViewType } from '@sp/api-contract';
import { kstToday } from '@sp/utils';
import {
  DEVELOP_QUOTE_LOGO_PNG_BASE64,
  DEVELOP_QUOTE_LOGO_SIZE,
  DEVELOP_QUOTE_STAMP_PNG_BASE64,
  DEVELOP_QUOTE_STAMP_SIZE,
} from './develop-quote-images';

// ── 개발의뢰 견적서 엑셀(docs/DEVELOP_FLOW.md §5.1, 2026-11-04) ─────────────────────────
// 참고 견적서 '개발견적서' 서식을 따른 1쪽(머리·수신/발신·견적명·산출 내역·합계·Remark) + 두 번째 시트 '조건'
// (결제 조건·산출물·검수·별도 실비·표준 조건). 표의 행은 인쇄 시트(@sp/ui DevelopQuoteSheet)와 같은 계약 함수
// developQuoteSheetRows 가 정한다. 숫자는 **값**으로 넣는다(수식 없음) — 화면·PDF·엑셀의 숫자가 어긋날 수 없고,
// 받은 쪽이 셀을 고쳐도 합계가 따라 바뀌지 않는다는 점은 감수한다. 숨긴 행·숨긴 시트·내부 메모는 넣지 않는다.

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface DevelopQuoteSheetData {
  quote: DevelopQuoteViewType;
  recipient: DevelopQuoteSheetRecipient;
  quoteNo: string;
  issuedOn: string; // YYYY-MM-DD(KST) — 발송일, 작성 중이면 오늘
}

export function developQuoteSheetData(quote: DevelopQuoteViewType, r: SpDevelopRequest): DevelopQuoteSheetData {
  return {
    quote,
    recipient: {
      company: r.contactCompany,
      dept: quote.recipientDept,
      name: r.contactName,
      phone: r.contactPhone,
      email: r.contactEmail,
    },
    quoteNo: developQuoteNo(quote.requestId, quote.version),
    issuedOn: quote.sentAt === null ? kstToday() : kstToday(new Date(quote.sentAt)),
  };
}

// 파일 이름 — 계약 developQuoteXlsxName(화면이 blob 으로 저장할 때도 같은 이름).
export function developQuoteXlsxDisposition(quote: DevelopQuoteViewType): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(developQuoteXlsxName(quote))}`;
}

const FONT = '맑은 고딕';
const NUM = '#,##0';
const thin = { style: 'thin' as const, color: { argb: 'FF8C8C8C' } };
const BOX: Partial<ExcelJS.Borders> = { top: thin, bottom: thin, left: thin, right: thin };
const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const GRAY = solid('FFD9D9D9');
const LIGHT = solid('FFF2F2F2');
const FINAL = solid('FFFFF2CC');

const dotDate = (ymd: string): string => ymd.replace(/-/g, '. ');

export async function renderDevelopQuoteXlsx(data: DevelopQuoteSheetData): Promise<Buffer> {
  const { quote, recipient } = data;
  const wb = new ExcelJS.Workbook();
  wb.creator = DEVELOP_QUOTE_SUPPLIER.name;
  const ws = wb.addWorksheet('견적서', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  // A 순위 · B 구분 · C 직무 · D 기술등급 · E 담당업무 · F 단가 · G 기간 · H 합계
  ws.columns = [{ width: 6 }, { width: 10 }, { width: 15 }, { width: 10 }, { width: 26 }, { width: 14 }, { width: 10 }, { width: 16 }];

  const cellAt = (row: number, col: number): ExcelJS.Cell => ws.getRow(row).getCell(col);
  const put = (
    row: number,
    from: number,
    to: number,
    value: string | number,
    opts: { bold?: boolean; size?: number; align?: 'left' | 'center' | 'right'; fill?: ExcelJS.Fill; border?: boolean; num?: boolean; wrap?: boolean; rows?: number } = {},
  ): void => {
    const lastRow = row + (opts.rows ?? 1) - 1;
    if (to > from || lastRow > row) ws.mergeCells(row, from, lastRow, to);
    const c = cellAt(row, from);
    c.value = value;
    c.font = { name: FONT, size: opts.size ?? 10, bold: opts.bold === true };
    c.alignment = { vertical: 'middle', horizontal: opts.align ?? 'left', wrapText: opts.wrap === true };
    if (opts.num === true) c.numFmt = NUM;
    for (let r = row; r <= lastRow; r += 1) {
      for (let col = from; col <= to; col += 1) {
        const each = cellAt(r, col);
        if (opts.fill !== undefined) each.fill = opts.fill;
        if (opts.border === true) each.border = BOX;
      }
    }
  };

  // ── 머리: 로고 + 회사 주소·연락처 ──
  const logoId = wb.addImage({ base64: DEVELOP_QUOTE_LOGO_PNG_BASE64, extension: 'png' });
  const logoW = 170;
  ws.addImage(logoId, {
    tl: { col: 0.1, row: 0.2 },
    ext: { width: logoW, height: Math.round((logoW * DEVELOP_QUOTE_LOGO_SIZE.height) / DEVELOP_QUOTE_LOGO_SIZE.width) },
  });
  for (const r of [1, 2, 3]) ws.getRow(r).height = 20;
  put(1, 4, 8, DEVELOP_QUOTE_SUPPLIER.address, { align: 'right', size: 9 });
  put(2, 4, 8, `T ${DEVELOP_QUOTE_SUPPLIER.tel}   F ${DEVELOP_QUOTE_SUPPLIER.fax}   E ${DEVELOP_QUOTE_SUPPLIER.email}`, { align: 'right', size: 9, bold: true });
  ws.getRow(4).height = 8;

  // ── 제목 띠 ──
  ws.getRow(5).height = 34;
  put(5, 1, 8, '견    적    서', { bold: true, size: 20, align: 'center', fill: GRAY, border: true });
  ws.getRow(6).height = 8;

  put(7, 1, 4, `견적번호 : ${data.quoteNo}`, { bold: true });
  put(7, 5, 8, `견적일자 : ${dotDate(data.issuedOn)}`, { bold: true });

  // ── 수신 · 발신 ──
  const parties: [string, string, string, string][] = [
    ['수신', recipient.company ?? recipient.name, '발신', DEVELOP_QUOTE_SUPPLIER.name],
    ['부서', recipient.dept ?? '', '대표자', DEVELOP_QUOTE_SUPPLIER.owner],
    ['담당자', `${recipient.name} 님`, '담당자', DEVELOP_QUOTE_SUPPLIER.managerName],
    ['핸드폰', recipient.phone, '연락처', DEVELOP_QUOTE_SUPPLIER.managerPhone],
    ['e-mail', recipient.email, 'e-mail', DEVELOP_QUOTE_SUPPLIER.managerEmail],
  ];
  parties.forEach(([lk, lv, rk, rv], i) => {
    const row = 8 + i;
    ws.getRow(row).height = 20;
    put(row, 1, 2, lk, { bold: true, align: 'center', fill: LIGHT, border: true });
    put(row, 3, 4, lv, { bold: i === 0 || i === 2, border: true });
    put(row, 5, 5, rk, { bold: true, align: 'center', fill: LIGHT, border: true });
    put(row, 6, 8, rv, { bold: i === 0 || i === 2, border: true });
  });
  // 직인 — 대표자 칸 오른쪽(참고 견적서 위치).
  const stampId = wb.addImage({ base64: DEVELOP_QUOTE_STAMP_PNG_BASE64, extension: 'png' });
  const stampW = 54;
  ws.addImage(stampId, {
    tl: { col: 7.05, row: 7.75 },
    ext: { width: stampW, height: Math.round((stampW * DEVELOP_QUOTE_STAMP_SIZE.height) / DEVELOP_QUOTE_STAMP_SIZE.width) },
  });

  ws.getRow(13).height = 8;
  ws.getRow(14).height = 24;
  put(14, 1, 2, '견적명 :', { bold: true });
  put(14, 3, 8, quote.title, { bold: true, size: 12 });
  put(15, 1, 8, '아래와 같이 견적합니다.');

  // ── 산출 내역 표 ──
  const head = ['순위', '구분', '직무', '기술등급', '담당업무', '단가', '기간', '합계'];
  ws.getRow(16).height = 22;
  head.forEach((h, i) => {
    put(16, i + 1, i + 1, h, { bold: true, align: 'center', fill: GRAY, border: true });
  });

  let r = 17;
  const rows = developQuoteSheetRows(quote);
  for (const row of rows) {
    ws.getRow(r).height = 20;
    if (row.kind === 'item') {
      if (row.groupFirst) {
        // 순위는 항목 + 소계 행, 구분은 항목 행만 묶는다.
        put(r, 1, 1, row.rank, { align: 'center', border: true, rows: row.groupSize + 1 });
        put(r, 2, 2, row.groupLabel, { bold: true, align: 'center', border: true, rows: row.groupSize });
      }
      put(r, 3, 3, row.title, { border: true, wrap: true });
      if (row.category === 'labor') {
        put(r, 4, 4, row.grade ?? '', { align: 'center', border: true });
        put(r, 5, 5, row.description ?? '', { border: true, wrap: true });
      } else {
        put(r, 4, 5, row.description ?? '', { border: true, wrap: true });
      }
      put(r, 6, 6, row.unitPrice, { align: 'right', num: true, border: true });
      put(r, 7, 7, row.qtyText, { align: 'center', border: true });
      put(r, 8, 8, row.amount, { align: 'right', num: true, border: true });
    } else if (row.kind === 'subtotal') {
      put(r, 2, 7, row.label, { bold: true, align: 'center', fill: LIGHT, border: true });
      put(r, 8, 8, row.amount, { bold: true, align: 'right', num: true, fill: LIGHT, border: true });
    } else {
      put(r, 1, 1, row.rank, { align: 'center', border: true });
      put(r, 2, 2, row.label, { bold: true, align: 'center', border: true });
      put(r, 3, 7, row.text, { border: true });
      put(r, 8, 8, row.amount, { bold: true, align: 'right', num: true, border: true });
    }
    r += 1;
  }

  // ── 합계 + 특기 사항(왼쪽) ──
  const vatLabel = quote.vatMode === 'exempt' ? '부가세 (면세)' : quote.vatMode === 'included' ? '부가세 (포함)' : '부가세';
  const totals: [string, number, ExcelJS.Fill][] = [
    ['공급가 합계', quote.supplyAmount, LIGHT],
    [vatLabel, quote.vatAmount, LIGHT],
    ['최종 견적 합계', quote.totalAmount, FINAL],
  ];
  put(r, 1, 5, quote.note ?? '', { bold: true, wrap: true, border: true, rows: 3 });
  totals.forEach(([label, amount, fill], i) => {
    ws.getRow(r + i).height = 22;
    put(r + i, 6, 7, label, { bold: true, align: 'center', fill, border: true });
    put(r + i, 8, 8, amount, { bold: true, align: 'right', num: true, fill, border: true });
  });
  r += 4;

  // ── Remark ──
  put(r, 1, 8, `Remark${quote.vatMode === 'separate' ? '' : `   (${quote.vatMode === 'exempt' ? '면세' : '부가세 포함'})`}`, { bold: true });
  r += 1;
  developQuoteRemarks(quote).forEach((rm, i) => {
    ws.getRow(r).height = 20;
    put(r, 1, 8, `   ${String(i + 1)}. ${rm.label === null ? '' : `${rm.label} : `}${rm.text}`, { bold: rm.label === null, wrap: true });
    r += 1;
  });
  ws.pageSetup.printArea = `A1:H${String(r - 1)}`;

  renderTermsSheet(wb, data);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// 두 번째 시트 — 인쇄 화면의 별지(결제 조건 · 개발 기간 · 산출물 · 검수 · 별도 실비 · 표준 조건).
function renderTermsSheet(wb: ExcelJS.Workbook, data: DevelopQuoteSheetData): void {
  const { quote } = data;
  const ws = wb.addWorksheet('조건', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 22 }, { width: 12 }, { width: 18 }, { width: 22 }, { width: 30 }];
  let r = 1;
  const text = (value: string, opts: { bold?: boolean; size?: number; fill?: ExcelJS.Fill; height?: number } = {}): void => {
    ws.mergeCells(r, 1, r, 5);
    const c = ws.getRow(r).getCell(1);
    c.value = value;
    c.font = { name: FONT, size: opts.size ?? 10, bold: opts.bold === true };
    c.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    if (opts.fill !== undefined) c.fill = opts.fill;
    // 줄 수만큼 높이를 잡는다(엑셀은 병합 셀 자동 높이를 안 한다).
    const lines = value.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 70)), 0);
    ws.getRow(r).height = opts.height ?? Math.max(18, lines * 15);
    r += 1;
  };

  text(`견적서 ${data.quoteNo} — 조건`, { bold: true, size: 14, height: 26 });
  r += 1;

  text('결제 조건', { bold: true, fill: LIGHT });
  const head = ['명칭', '비율', '금액', '청구 시점'];
  head.forEach((h, i) => {
    const c = ws.getRow(r).getCell(i + 1);
    c.value = h;
    c.font = { name: FONT, size: 10, bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.fill = GRAY;
    c.border = BOX;
  });
  r += 1;
  for (const m of quote.milestones) {
    const values: (string | number)[] = [
      m.title,
      m.ratioBp === null ? '' : `${developBpPercent(m.ratioBp)}%`,
      m.amount,
      DEVELOP_MILESTONE_TRIGGER_LABELS[m.trigger],
    ];
    values.forEach((v, i) => {
      const c = ws.getRow(r).getCell(i + 1);
      c.value = v;
      c.font = { name: FONT, size: 10 };
      c.alignment = { vertical: 'middle', horizontal: i === 2 ? 'right' : i === 1 ? 'center' : 'left' };
      if (i === 2) c.numFmt = NUM;
      c.border = BOX;
    });
    r += 1;
  }
  text('결제 금액은 부가세를 포함한 최종 견적 합계를 비율로 나눈 금액입니다.', { size: 9 });
  r += 1;

  const duration =
    quote.durationDays === null
      ? quote.scheduleNote ?? '협의'
      : `${String(quote.durationDays)}일${quote.scheduleNote === null ? '' : ` · ${quote.scheduleNote}`}`;
  const sections: [string, string][] = [
    ['개발 기간', duration],
    ['산출물', quote.deliverables.length === 0 ? '협의' : quote.deliverables.map((d) => `· ${d}`).join('\n')],
    ['검수 · 하자보수', `납품 후 ${String(quote.reviewDays)}일 검수${quote.warrantyDays === null ? '' : ` · 하자보수 ${String(quote.warrantyDays)}일`}`],
  ];
  if (quote.exclusions !== null) sections.push(['별도 실비', quote.exclusions]);
  sections.push(['표준 조건', quote.terms]);
  for (const [label, body] of sections) {
    text(label, { bold: true, fill: LIGHT });
    text(body);
    r += 1;
  }
  text(`본 견적서는 ${quote.validUntil}까지 유효합니다. 금액은 원화(KRW) 기준입니다.`, { size: 9 });
}
