import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { DEVELOP_QUOTE_SUPPLIER, computeDevelopQuoteBreakdown, developQuoteItemAmount } from '@sp/api-contract';
import type { DevelopQuoteViewType } from '@sp/api-contract';
import { developQuoteXlsxDisposition, renderDevelopQuoteXlsx } from './develop-quote-xlsx';

// 개발의뢰 견적서 엑셀(docs/DEVELOP_FLOW.md §5.1) — 만든 파일을 ExcelJS 로 다시 읽어 칸의 값을 대조한다.
const items = [
  { category: 'labor' as const, title: 'PM', grade: '특급', description: '시스템 설계', unitPrice: 8_000_000, qty: 0.5, unit: '개월' },
  { category: 'labor' as const, title: 'FPGA', grade: '고급', description: '신호처리, Verilog', unitPrice: 7_000_000, qty: 2, unit: '개월' },
  { category: 'direct' as const, title: 'PCB 제작', grade: null, description: '6층 빌드업, RF매칭', unitPrice: 1_300_000, qty: 3, unit: '회' },
].map((it, i) => ({ ...it, itemId: i + 1, seq: i + 1, amount: developQuoteItemAmount(it.unitPrice, it.qty), durationDays: null }));
const rates = { indirectBp: 1500, overheadBp: 500, profitBp: 1000 };
const b = computeDevelopQuoteBreakdown(items, rates, 'separate');

const quote: DevelopQuoteViewType = {
  quoteId: 7,
  requestId: 42,
  version: 2,
  kind: 'initial',
  status: 'sent',
  title: 'RF 부분방전 감지기 시제품 개발',
  vatMode: 'separate',
  ...rates,
  breakdown: {
    laborSubtotal: b.laborSubtotal,
    directSubtotal: b.directSubtotal,
    indirectAmount: b.indirectAmount,
    overheadAmount: b.overheadAmount,
    profitAmount: b.profitAmount,
  },
  recipientDept: '연구소',
  supplyAmount: b.supplyAmount,
  vatAmount: b.vatAmount,
  totalAmount: b.totalAmount,
  durationDays: 120,
  scheduleNote: null,
  deliverables: ['회로도', '펌웨어 소스'],
  exclusions: '인증 시험비 별도',
  terms: '1. 표준 조건',
  warrantyDays: 180,
  reviewDays: 7,
  validUntil: '2026-12-04',
  note: '함체는 사급 지원',
  sentAt: '2026-11-04T01:00:00.000Z',
  acceptedAt: null,
  acceptedName: null,
  declinedAt: null,
  declineReason: null,
  items,
  milestones: [
    { milestoneId: 1, quoteId: 7, seq: 1, title: '계약금', ratioBp: 4000, amount: Math.round(b.totalAmount * 0.4), trigger: 'on_accept', status: 'draft', payable: false, unlocksDeliverables: false, paidAt: null, paidBy: null, payment: null },
    { milestoneId: 2, quoteId: 7, seq: 2, title: '잔금', ratioBp: 6000, amount: b.totalAmount - Math.round(b.totalAmount * 0.4), trigger: 'on_completion', status: 'draft', payable: false, unlocksDeliverables: true, paidAt: null, paidBy: null, payment: null },
  ],
  poFile: null,
};

describe('renderDevelopQuoteXlsx', () => {
  it('1쪽 서식(머리·수신/발신·산출 내역·합계·Remark)과 조건 시트를 만든다', async () => {
    const buf = await renderDevelopQuoteXlsx({
      quote,
      recipient: { company: '(주)멀티', dept: '연구소', name: '김태욱', phone: '010-0000-0000', email: 'a@example.com' },
      quoteNo: 'Q42-v2',
      issuedOn: '2026-11-04',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['견적서', '조건']);
    const ws = wb.getWorksheet('견적서');
    if (ws === undefined) throw new Error('시트 없음');
    // 숨긴 행 없음(참고 견적서의 숨긴 원가표 같은 사고가 없게)
    ws.eachRow({ includeEmpty: true }, (row) => {
      expect(row.hidden).toBe(false);
    });
    const texts: string[] = [];
    const numbers: number[] = [];
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'string') texts.push(cell.value);
        if (typeof cell.value === 'number') numbers.push(cell.value);
      });
    });
    const joined = texts.join('\n');
    expect(joined).toContain('견    적    서');
    expect(joined).toContain('견적번호 : Q42-v2');
    expect(joined).toContain('견적일자 : 2026. 11. 04');
    expect(joined).toContain('(주)멀티');
    expect(joined).toContain('김태욱 님');
    expect(joined).toContain(DEVELOP_QUOTE_SUPPLIER.owner);
    expect(joined).toContain(DEVELOP_QUOTE_SUPPLIER.managerPhone);
    expect(joined).toContain('0.5개월');
    expect(joined).toContain('인건비 소계');
    expect(joined).toContain('15% (인건비+직접비)');
    expect(joined).toContain('함체는 사급 지원');
    expect(joined).toContain('결제 조건 : 계약금 40%(견적 수락 시), 잔금 60%(검수 확정 시)');
    // 값으로 들어간 금액(수식 아님) — 소계·가산·합계
    for (const n of [b.laborSubtotal, b.directSubtotal, b.indirectAmount, b.overheadAmount, b.profitAmount, b.supplyAmount, b.vatAmount, b.totalAmount]) {
      expect(numbers).toContain(n);
    }
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        expect(cell.formula).toBeUndefined();
      });
    });
    expect(ws.getImages()).toHaveLength(2); // 로고 + 직인
    const terms = wb.getWorksheet('조건');
    const termTexts: string[] = [];
    terms?.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'string') termTexts.push(cell.value);
      });
    });
    expect(termTexts.join('\n')).toContain('· 회로도');
    expect(termTexts.join('\n')).toContain('인증 시험비 별도');
  });

  it('파일 이름 — 제목 + 견적번호, 예약 문자는 지운다', () => {
    const header = developQuoteXlsxDisposition({ ...quote, title: 'A/B: "테스트"' });
    expect(decodeURIComponent(header.replace("attachment; filename*=UTF-8''", ''))).toBe('A B 테스트 견적서 Q42-v2.xlsx');
  });
});
