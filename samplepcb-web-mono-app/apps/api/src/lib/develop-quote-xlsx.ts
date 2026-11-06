import ExcelJS from 'exceljs';
import type { SpDevelopRequest } from '@prisma/client';
import {
  DEVELOP_MILESTONE_TRIGGER_LABELS,
  DEVELOP_QUOTE_SUPPLIER,
  developBpPercent,
  developQuoteDurationText,
  developQuoteNo,
  developQuoteRemarks,
  developQuoteSheetRows,
  developQuoteXlsxName,
} from '@sp/api-contract';
import type { DevelopQuoteSheetRecipient, DevelopQuoteSheetRow, DevelopQuoteViewType } from '@sp/api-contract';
import { kstToday } from '@sp/utils';
import {
  DEVELOP_QUOTE_LOGO_PNG_BASE64,
  DEVELOP_QUOTE_LOGO_SIZE,
  DEVELOP_QUOTE_STAMP_PNG_BASE64,
  DEVELOP_QUOTE_STAMP_SIZE,
} from './develop-quote-images';

// ── 개발의뢰 견적서 엑셀(docs/DEVELOP_FLOW.md §5.1, 2026-11-04 · 2026-11-06 서식 교체) ─────────────────────
// 1쪽 '견적서' = 인쇄 시트(@sp/ui DevelopQuoteSheet)와 같은 모양 — 피그마 「통합 견적서」(제목·견적명·번호/일자/유효기간 →
// 수신/공급자 상자 → 산출 내역 표 → Remark → 개발 기간·특기 사항 + 합계 상자) + 두 번째 시트 '조건'(결제 조건·산출물·검수·
// 별도 실비·표준 조건). 표의 행은 인쇄 시트와 같은 계약 함수 developQuoteSheetRows 가 정한다. 숫자는 **값**으로 넣는다
// (수식 없음) — 화면·PDF·엑셀의 숫자가 어긋날 수 없고, 받은 쪽이 셀을 고쳐도 합계가 따라 바뀌지 않는다는 점은 감수한다.
// 숨긴 행·숨긴 시트·내부 메모는 넣지 않는다.

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
const WON = '#,##0"원"';
const thin = { style: 'thin' as const, color: { argb: 'FF8C8C8C' } };
const BOX: Partial<ExcelJS.Borders> = { top: thin, bottom: thin, left: thin, right: thin };
const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const GRAY = solid('FFD9D9D9');
const LIGHT = solid('FFF2F2F2');
// 1쪽 색 — 인쇄 시트 scoped CSS 와 같은 값.
const INK = { title: 'FF061023', text: 'FF191919', label: 'FF646464', head: 'FF39404D', remark: 'FF75777D', cell: 'FF000000' } as const;
const HEAD_FILL = solid('FFFBFBFB');
const BOX_FILL = solid('FFEEEEEE');
const lineOf = (argb: string): ExcelJS.Border => ({ style: 'thin', color: { argb } });
const LINE_DARK = lineOf('FF3B424F'); // 표 바깥·머리줄·아래 합계 띠
const LINE_MID = lineOf('FF999999'); // 표 묶음 사이
const LINE_LIGHT = lineOf('FFD9D9D9'); // 열 구분·묶음 안 행 사이·수신/공급자/Remark 상자

// 열 — A 구분 · B 구분(직무·항목명) · C~E 항목(D 는 수신·공급자 상자 사이 틈) · F 적용 수량 · G 단가 · H 금액.
// 폭(px)은 인쇄 시트의 칸 폭 70·110·255·63·97·97 과 같다(엑셀 폭 단위 ≈ (px − 5) / 7).
const COL_PX = [70, 110, 147, 20, 88, 63, 97, 97] as const;
const LAST_COL = COL_PX.length;
// 병합 칸은 엑셀이 높이를 자동으로 안 잡는다 — 칸 폭으로 한 줄 글자 수를 어림해 줄 수를 센다(한글 기준 약 13px/자 @10pt,
// 영문·숫자·기호는 그 절반 남짓으로 친다 — 메일 주소·전화번호 줄이 두 줄로 잡혀 칸이 헐렁해지지 않게).
const textWidth = (s: string): number => [...s].reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) < 0x1100 ? 0.55 : 1), 0);
const linesOf = (text: string, widthPx: number, pxPerChar = 13): number =>
  text.split('\n').reduce((n, part) => n + Math.max(1, Math.ceil(textWidth(part) / Math.max(1, Math.floor(widthPx / pxPerChar)))), 0);
const spanPx = (from: number, to: number): number => COL_PX.slice(from - 1, to).reduce((a, b) => a + b, 0);

type ItemRow = Extract<DevelopQuoteSheetRow, { kind: 'item' }>;
// 항목 칸 — 인건비는 '기술등급 · 담당업무', 직접비는 내용. 비면 '-'(인쇄 시트와 같다).
const itemText = (it: ItemRow): string => {
  const parts = it.category === 'labor' ? [it.grade, it.description] : [it.description];
  const text = parts.filter((v): v is string => v !== null && v.trim() !== '').join(' · ');
  return text === '' ? '-' : text;
};

interface PutOpts {
  bold?: boolean;
  size?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle';
  fill?: ExcelJS.Fill;
  numFmt?: string;
  wrap?: boolean;
  indent?: number;
  rows?: number;
}

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
      margins: { left: 0.5, right: 0.5, top: 0.45, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  ws.columns = COL_PX.map((w) => ({ width: Math.round(((w - 5) / 7) * 10) / 10 }));

  const cellAt = (row: number, col: number): ExcelJS.Cell => ws.getRow(row).getCell(col);
  const put = (row: number, from: number, to: number, value: string | number, opts: PutOpts = {}): void => {
    const lastRow = row + (opts.rows ?? 1) - 1;
    if (to > from || lastRow > row) ws.mergeCells(row, from, lastRow, to);
    const c = cellAt(row, from);
    c.value = value;
    c.font = { name: FONT, size: opts.size ?? 10, bold: opts.bold === true, color: { argb: opts.color ?? INK.text } };
    c.alignment = {
      vertical: opts.valign ?? 'middle',
      horizontal: opts.align ?? 'left',
      wrapText: opts.wrap === true,
      ...(opts.indent === undefined ? {} : { indent: opts.indent }),
    };
    if (opts.numFmt !== undefined) c.numFmt = opts.numFmt;
    if (opts.fill !== undefined) {
      for (let r = row; r <= lastRow; r += 1) for (let col = from; col <= to; col += 1) cellAt(r, col).fill = opts.fill;
    }
  };
  // 테두리는 칸마다 덧붙인다(병합 칸은 둘레 칸의 테두리가 보인다).
  const edge = (row: number, col: number, patch: Partial<ExcelJS.Borders>): void => {
    const c = cellAt(row, col);
    c.border = { ...c.border, ...patch };
  };
  const frame = (r1: number, c1: number, r2: number, c2: number, line: ExcelJS.Border): void => {
    for (let c = c1; c <= c2; c += 1) {
      edge(r1, c, { top: line });
      edge(r2, c, { bottom: line });
    }
    for (let r = r1; r <= r2; r += 1) {
      edge(r, c1, { left: line });
      edge(r, c2, { right: line });
    }
  };
  const height = (row: number, h: number): void => {
    ws.getRow(row).height = h;
  };

  // ── 머리: 제목 + 로고(오른쪽 위) · 견적명 · 번호/일자/유효기간 ──
  height(1, 38);
  put(1, 1, 5, '견적서', { bold: true, size: 22, color: INK.title });
  const logoId = wb.addImage({ base64: DEVELOP_QUOTE_LOGO_PNG_BASE64, extension: 'png' });
  const logoW = 125;
  ws.addImage(logoId, {
    tl: { col: 6.62, row: 0.12 },
    ext: { width: logoW, height: Math.round((logoW * DEVELOP_QUOTE_LOGO_SIZE.height) / DEVELOP_QUOTE_LOGO_SIZE.width) },
  });
  height(2, Math.max(22, linesOf(quote.title, spanPx(1, LAST_COL), 15) * 17));
  put(2, 1, LAST_COL, quote.title, { bold: true, size: 12, color: INK.title, wrap: true });
  height(3, 20);
  put(3, 1, LAST_COL, `견적번호  ${data.quoteNo}      견적일자  ${data.issuedOn}      유효기간  ${quote.validUntil}`, { size: 9 });
  height(4, 6);

  // ── 수신(A~C) · 공급자(E~H) 상자 — D 는 두 상자 사이 틈 ──
  const partyTop = 5;
  height(partyTop, 22);
  put(partyTop, 1, 3, '수신', { bold: true, size: 9, color: INK.head, align: 'center', fill: BOX_FILL });
  put(partyTop, 5, LAST_COL, '공급자', { bold: true, size: 9, color: INK.head, align: 'center', fill: BOX_FILL });
  // 수신 — 비어 있는 칸(개인 의뢰의 회사명·부서)은 줄째 뺀다(인쇄 시트와 같다).
  const leftAll: [string, string][] = [
    ['회사명', recipient.company ?? ''],
    ['부서', recipient.dept ?? ''],
    ['이름', recipient.name],
    ['연락처', recipient.phone],
    ['이메일', recipient.email],
  ];
  const left = leftAll.filter(([, v]) => v.trim() !== '');
  const right: [string, string][] = [
    ['상호', DEVELOP_QUOTE_SUPPLIER.name],
    ['대표자', DEVELOP_QUOTE_SUPPLIER.owner],
    ['주소', DEVELOP_QUOTE_SUPPLIER.address],
    ['연락처', `${DEVELOP_QUOTE_SUPPLIER.managerName}  ${DEVELOP_QUOTE_SUPPLIER.managerPhone}`],
    ['이메일', DEVELOP_QUOTE_SUPPLIER.managerEmail],
  ];
  const fieldRows = Math.max(left.length, right.length);
  for (let i = 0; i < fieldRows; i += 1) {
    const row = partyTop + 1 + i;
    const [rk, rv] = right[i] ?? ['', ''];
    // 주소는 상자 폭(값 칸 248px)에 두 줄까지 흐른다.
    height(row, Math.max(20, linesOf(rv, spanPx(6, LAST_COL) - 40) * 15 + 5));
    const [lk, lv] = left[i] ?? ['', ''];
    put(row, 1, 1, lk, { size: 10, color: INK.label, indent: 1 });
    put(row, 2, 3, lv, { size: 10, wrap: true });
    put(row, 5, 5, rk, { size: 10, color: INK.label, indent: 1 });
    put(row, 6, LAST_COL, rv, { size: 10, wrap: true });
  }
  const partyBottom = partyTop + fieldRows;
  frame(partyTop, 1, partyBottom, 3, LINE_LIGHT);
  frame(partyTop, 5, partyBottom, LAST_COL, LINE_LIGHT);
  for (let c = 1; c <= LAST_COL; c += 1) if (c !== 4) edge(partyTop, c, { bottom: LINE_LIGHT });
  // 직인 — 공급자 상자 오른쪽 위(인쇄 시트와 같은 자리).
  const stampId = wb.addImage({ base64: DEVELOP_QUOTE_STAMP_PNG_BASE64, extension: 'png' });
  const stampH = 46;
  ws.addImage(stampId, {
    tl: { col: 7.45, row: partyTop + 0.15 },
    ext: { width: Math.round((stampH * DEVELOP_QUOTE_STAMP_SIZE.width) / DEVELOP_QUOTE_STAMP_SIZE.height), height: stampH },
  });

  // ── 산출 내역 표 ──
  const tableTop = partyBottom + 2;
  height(tableTop - 1, 10);
  height(tableTop, 22);
  const headCells: [number, number, string][] = [
    [1, 1, '구분'],
    [2, 2, '구분'],
    [3, 5, '항목'],
    [6, 6, '적용 수량'],
    [7, 7, '단가'],
    [8, 8, '금액'],
  ];
  for (const [from, to, label] of headCells) put(tableTop, from, to, label, { size: 9, color: INK.head, align: 'center', fill: HEAD_FILL });
  for (let c = 1; c <= LAST_COL; c += 1) edge(tableTop, c, { top: LINE_DARK, bottom: LINE_DARK });

  const cell = { size: 10, color: INK.cell } as const;
  let r = tableTop + 1;
  const groupEnds: number[] = []; // 묶음 마지막 행 — 아래 선을 묶음 사이 선(중간 회색)으로
  const rows = developQuoteSheetRows(quote);
  for (const row of rows) {
    if (row.kind === 'item') {
      if (row.groupFirst) {
        // 구분 칸은 항목 + 소계 행을 묶는다.
        put(r, 1, 1, row.groupLabel, { ...cell, align: 'center', rows: row.groupSize + 1 });
      }
      const text = itemText(row);
      height(r, Math.max(22, Math.max(linesOf(row.title, spanPx(2, 2) - 14), linesOf(text, spanPx(3, 5) - 14)) * 14 + 8));
      put(r, 2, 2, row.title, { ...cell, wrap: true, indent: 1 });
      put(r, 3, 5, text, { ...cell, wrap: true, indent: 1 });
      put(r, 6, 6, row.qtyText, { ...cell, align: 'center' });
      put(r, 7, 7, row.unitPrice, { ...cell, align: 'center', numFmt: WON });
      put(r, 8, 8, row.amount, { ...cell, align: 'center', numFmt: WON });
    } else if (row.kind === 'subtotal') {
      height(r, 22);
      put(r, 2, 7, row.label, { ...cell, bold: true, align: 'center', fill: HEAD_FILL });
      put(r, 8, 8, row.amount, { ...cell, bold: true, align: 'center', numFmt: WON, fill: HEAD_FILL });
      groupEnds.push(r);
    } else {
      height(r, 22);
      put(r, 1, 1, row.label, { ...cell, align: 'center' });
      put(r, 2, 7, row.text, { ...cell, indent: 1 });
      put(r, 8, 8, row.amount, { ...cell, align: 'center', numFmt: WON });
      groupEnds.push(r);
    }
    // 묶음 안 행 사이 — 옅은 선(구분 칸은 병합이라 안 보인다)
    for (let c = 2; c <= LAST_COL; c += 1) edge(r, c, { bottom: LINE_LIGHT });
    r += 1;
  }
  if (rows.length === 0) {
    height(r, 24);
    put(r, 1, LAST_COL, '견적 항목이 없습니다.', { size: 10, color: INK.remark, align: 'center' });
    groupEnds.push(r);
    r += 1;
  }
  const tableBottom = r - 1;
  for (const end of groupEnds) for (let c = 1; c <= LAST_COL; c += 1) edge(end, c, { bottom: end === tableBottom ? LINE_DARK : LINE_MID });
  // 열 구분(옅게) · 바깥 좌우(짙게) — 병합 칸 안쪽 선은 엑셀이 그리지 않는다.
  for (let row = tableTop; row <= tableBottom; row += 1) {
    for (let c = 2; c <= LAST_COL; c += 1) edge(row, c, { left: LINE_LIGHT });
    edge(row, 1, { left: LINE_DARK });
    edge(row, LAST_COL, { right: LINE_DARK });
  }

  // ── Remark — 한 줄에 하나(인쇄 시트는 두 단) ──
  r = tableBottom + 2;
  height(r - 1, 8);
  const remarkTop = r;
  height(r, 20);
  put(r, 1, LAST_COL, 'Remark', { bold: true, size: 10, color: INK.head, indent: 1 });
  r += 1;
  for (const rm of developQuoteRemarks(quote)) {
    // 여러 줄로 적은 글(별도 실비)은 둘째 줄부터 글머리 폭만큼 띄워 첫 줄 글과 맞춘다.
    const line = `•  ${rm.label === null ? '' : `${rm.label} : `}${rm.text.replace(/\n/g, '\n     ')}`;
    height(r, Math.max(17, linesOf(line, spanPx(1, LAST_COL) - 30, 12) * 14 + 3));
    put(r, 1, LAST_COL, line, { size: 9, bold: rm.label === null, color: rm.label === null ? INK.head : INK.remark, wrap: true, indent: 1 });
    r += 1;
  }
  frame(remarkTop, 1, r - 1, LAST_COL, LINE_LIGHT);

  // ── 아래 — 개발 기간·특기 사항(왼쪽) + 합계 상자(오른쪽), 위아래 짙은 선 사이 ──
  r += 1;
  height(r - 1, 12);
  const sumTop = r;
  const note = (quote.note ?? '').trim();
  const vatLabel = quote.vatMode === 'exempt' ? '부가세 (면세)' : quote.vatMode === 'included' ? '부가세 (포함)' : '부가세';
  const totals: [string, number][] = [
    ['공급가액', quote.supplyAmount],
    [vatLabel, quote.vatAmount],
    [quote.vatMode === 'exempt' ? '총합계' : '총합계 (VAT 포함)', quote.totalAmount],
  ];
  const noteLines = note === '' ? 0 : linesOf(note, spanPx(2, 5) - 10);
  totals.forEach(([label, amount], i) => {
    height(sumTop + i, i === 2 ? Math.max(22, (noteLines - 1) * 14 + 8) : 22);
    put(sumTop + i, 6, 7, label, { size: 9, color: INK.head, fill: BOX_FILL, indent: 1 });
    put(sumTop + i, 8, 8, amount, { size: 9, bold: true, color: INK.head, align: 'right', numFmt: WON, fill: BOX_FILL });
  });
  put(sumTop, 1, 1, '개발 기간', { size: 9, color: INK.head });
  put(sumTop, 2, 5, developQuoteDurationText(quote), { size: 9, bold: true, color: INK.head, wrap: true });
  if (note !== '') {
    put(sumTop + 1, 1, 1, '특기 사항', { size: 9, color: INK.head, valign: 'top' });
    put(sumTop + 1, 2, 5, note, { size: 9, color: INK.head, wrap: true, valign: 'top', rows: 2 });
  }
  const sumBottom = sumTop + totals.length - 1;
  for (let c = 1; c <= LAST_COL; c += 1) {
    edge(sumTop, c, { top: LINE_DARK });
    edge(sumBottom, c, { bottom: LINE_DARK });
  }
  ws.pageSetup.printArea = `A1:H${String(sumBottom)}`;

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
