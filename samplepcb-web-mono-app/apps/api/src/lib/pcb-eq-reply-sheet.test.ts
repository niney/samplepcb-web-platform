import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { PCB_EQ_ITEM_CATEGORIES, PCB_EQ_ITEM_CATEGORY_LABELS_BY_LOCALE, pcbEqReplyFileName } from '@sp/api-contract';
import { renderEqReplyXlsx, type EqReplySheetInput, type EqReplySheetItem } from './pcb-eq-reply-sheet';

// EQ 회신서 엑셀(D20 P3) — 만든 파일을 **다시 읽어** 칸의 값과 서식을 확인한다(순수 렌더러, DB 없음).
const item = (over: Partial<EqReplySheetItem> = {}): EqReplySheetItem => ({
  factoryNo: '1',
  category: 'marking',
  question: 'UL 마킹을 보드에 넣을까요?',
  questionOrig: '是否需要在板上加UL标记？',
  options: [
    { key: 'A', label: '공장 제안대로 넣지 않음', labelOrig: '按我司建议不加' },
    { key: 'B', label: '위치를 지정하겠습니다', labelOrig: '贵司指示位置' },
  ],
  answer: { key: 'B', comment: '좌측 하단에 넣어 주세요' },
  change: null,
  figureCount: 0,
  ...over,
});
const input = (over: Partial<EqReplySheetInput> = {}): EqReplySheetInput => ({
  audience: 'partner',
  locale: 'zh-CN',
  projectName: 'L050AKM1001',
  poId: 985,
  partnerName: '深圳工厂',
  requestRound: 3,
  roundNo: 2,
  answeredAt: '2026-10-11T05:20:00.000Z',
  forwardedAt: '2026-10-11T05:44:00.000Z',
  proxyChannel: null,
  items: [item()],
  ...over,
});

const open = async (data: EqReplySheetInput): Promise<ExcelJS.Worksheet> => {
  const wb = new ExcelJS.Workbook();
  const buffer = await renderEqReplyXlsx(data);
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const sheet = wb.worksheets[0];
  if (sheet === undefined) throw new Error('시트가 없다');
  return sheet;
};
const text = (cell: ExcelJS.Cell): string => (typeof cell.value === 'string' ? cell.value : cell.value == null ? '' : cell.text);
/** 시트의 모든 글자 — 머리(병합 칸) 문구 검사용. */
const allText = (sheet: ExcelJS.Worksheet): string => {
  const out: string[] = [];
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      out.push(text(cell));
    });
  });
  return out.join('\n');
};
/** 바탕색이 칠해진 칸인가 — 서식이 없는 칸은 fill 이 비어 있다(타입은 늘 있다고 말한다). */
const isFilled = (cell: ExcelJS.Cell): boolean => {
  const f = cell.fill as ExcelJS.Fill | undefined;
  return f?.type === 'pattern' && f.pattern === 'solid';
};
/** 표 머리행 번호 — 첫 칸이 번호 열 제목인 줄. */
const headerRowOf = (sheet: ExcelJS.Worksheet, noLabel: string): number => {
  let found = 0;
  sheet.eachRow((row, n) => {
    if (found === 0 && text(row.getCell(1)) === noLabel) found = n;
  });
  if (found === 0) throw new Error(`머리행을 못 찾았다: ${noLabel}`);
  return found;
};
const rowValues = (sheet: ExcelJS.Worksheet, n: number): string[] => {
  const out: string[] = [];
  sheet.getRow(n).eachCell({ includeEmpty: true }, (cell) => out.push(text(cell)));
  return out;
};

describe('renderEqReplyXlsx', () => {
  it('협력사용(중국어) — 머리·표 제목은 중국어, 질문·선택지는 공장 원문, 고객 의견은 한국어 원문', async () => {
    const sheet = await open(input());
    expect(sheet.name).toBe('EQ Reply R2');
    expect(text(sheet.getCell('A1'))).toBe('EQ 回复单');
    const head = allText(sheet);
    expect(head).toContain('项目: L050AKM1001');
    expect(head).toContain('订单号: PO-985');
    // 두 가지 '차'를 이름으로 가른다 — EQ 요청 회차 / 고객 확인 회차.
    expect(head).toContain('EQ 申请: 第 3 次');
    expect(head).toContain('客户确认: 第 2 次');
    // 시각에는 기준 시간대를 글자로(중국 공장이 현지 시각으로 읽지 않게) — 05:20Z = 14:20 KST.
    expect(head).toContain('客户回复于: 2026-10-11 14:20 KST');
    expect(head).toContain('转达于: 2026-10-11 14:44 KST');

    const h = headerRowOf(sheet, '序号');
    expect(rowValues(sheet, h)).toEqual(['序号', '类型', '问题', '选项', '客户选择', '所选内容', '客户意见']);
    expect(rowValues(sheet, h + 1)).toEqual([
      '1',
      '标记（UL·周期）',
      '是否需要在板上加UL标记？',
      'A. 按我司建议不加\nB. 贵司指示位置',
      'B',
      '贵司指示位置',
      '좌측 하단에 넣어 주세요',
    ]);
  });

  it('고객 선택 기호가 가장 크다 — 굵게·강조색, 고른 내용과 의견 칸에도 바탕색', async () => {
    const sheet = await open(input());
    const row = sheet.getRow(headerRowOf(sheet, '序号') + 1);
    const choice = row.getCell(5);
    expect(choice.font).toMatchObject({ size: 16, bold: true });
    expect(choice.fill).toMatchObject({ type: 'pattern', pattern: 'solid' });
    expect(choice.alignment).toMatchObject({ horizontal: 'center' });
    expect(row.getCell(6).font).toMatchObject({ bold: true });
    expect(row.getCell(7).fill).toMatchObject({ type: 'pattern', pattern: 'solid' });
    // 질문 칸은 강조하지 않는다(강조는 답에만).
    expect(isFilled(row.getCell(3))).toBe(false);
    // 모든 칸에 테두리·줄바꿈.
    for (let c = 1; c <= 7; c += 1) {
      expect(row.getCell(c).border.top?.style, `${String(c)}열 테두리`).toBe('thin');
      expect(row.getCell(c).alignment.wrapText, `${String(c)}열 줄바꿈`).toBe(true);
    }
  });

  it('인쇄·보기 설정 — A4 가로·한 장 너비에 맞춤·머리행 고정과 반복', async () => {
    const sheet = await open(input());
    const h = headerRowOf(sheet, '序号');
    expect(sheet.pageSetup).toMatchObject({ orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 });
    expect(sheet.pageSetup.printTitlesRow).toBe(`${String(h)}:${String(h)}`);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: h });
    expect(sheet.getRow(h).getCell(1).font).toMatchObject({ bold: true });
  });

  it('협력사용에는 고객이 본 한국어 문장 열도, 대리 입력 사실도 없다(포털이 안 보이는 것은 파일에도 없다)', async () => {
    const sheet = await open(input({ proxyChannel: 'phone' }));
    const all = allText(sheet);
    expect(all).not.toContain('고객이 본 문장');
    expect(all).not.toContain('대리');
    expect(all).not.toContain('UL 마킹을 보드에 넣을까요?');
  });

  it('관리자용(한국어) — 고객이 본 문장 열(질문+선택지)과 대리 입력 경로, 전달 전이면 그렇게 적는다', async () => {
    const sheet = await open(input({ audience: 'admin', locale: 'ko', proxyChannel: 'phone', forwardedAt: null }));
    const all = allText(sheet);
    expect(text(sheet.getCell('A1'))).toBe('EQ 회신서');
    expect(all).toContain('담당자 대리 입력 — 경로: 전화');
    expect(all).toContain('아직 협력사에 전달하지 않음');
    const h = headerRowOf(sheet, '번호');
    expect(rowValues(sheet, h)).toEqual(['번호', '유형', '질문', '고객이 본 문장(한국어)', '선택지', '고객 선택', '선택한 내용', '고객 의견']);
    const row = rowValues(sheet, h + 1);
    expect(row[2], '질문 열은 공장 원문').toBe('是否需要在板上加UL标记？');
    expect(row[3], '고객이 본 문장 = 한국어 질문 + 한국어 선택지').toBe(
      'UL 마킹을 보드에 넣을까요?\nA. 공장 제안대로 넣지 않음\nB. 위치를 지정하겠습니다',
    );
    expect(row[1]).toBe('마킹(UL·주기)');
  });

  it('고객이 직접 답했으면 대리 입력 줄이 없다', async () => {
    const sheet = await open(input({ audience: 'admin', locale: 'ko', proxyChannel: null }));
    expect(allText(sheet)).not.toContain('대리 입력');
  });

  it('개정 회차·그림이 있으면 그 열이 생긴다 — 없으면 빈 열을 두지 않는다', async () => {
    const sheet = await open(
      input({
        locale: 'en',
        items: [item({ change: 'changed', figureCount: 2 }), item({ factoryNo: '2', change: 'same', figureCount: 0, answer: { key: 'A', comment: null } })],
      }),
    );
    const h = headerRowOf(sheet, 'No.');
    expect(rowValues(sheet, h)).toEqual([
      'No.',
      'Type',
      'Question',
      'Options',
      'Customer choice',
      'Chosen option',
      'Customer comment',
      'Change',
      'Figures',
    ]);
    expect(rowValues(sheet, h + 1).slice(7)).toEqual(['Changed', '2']);
    expect(rowValues(sheet, h + 2).slice(7)).toEqual(['Same', '']);
    // 의견이 없으면 의견 칸은 비고 바탕색도 없다.
    const second = sheet.getRow(h + 2);
    expect(text(second.getCell(7))).toBe('');
    expect(isFilled(second.getCell(7))).toBe(false);
  });

  it('공장 번호·원문이 없으면 순서와 한국어 문장이 대신한다', async () => {
    const sheet = await open(
      input({
        locale: 'ko',
        items: [
          item({
            factoryNo: null,
            questionOrig: null,
            options: [
              { key: 'A', label: '키워도 됩니다', labelOrig: null },
              { key: 'B', label: '안 됩니다', labelOrig: null },
            ],
            answer: { key: 'A', comment: null },
          }),
        ],
      }),
    );
    const row = rowValues(sheet, headerRowOf(sheet, '번호') + 1);
    expect(row.slice(0, 6)).toEqual(['1', '마킹(UL·주기)', 'UL 마킹을 보드에 넣을까요?', 'A. 키워도 됩니다\nB. 안 됩니다', 'A', '키워도 됩니다']);
  });

  it('선택지가 고쳐져 사라진 기호 — 기호는 남고 내용은 빈다. 답이 없으면 그렇게 적는다', async () => {
    const sheet = await open(input({ locale: 'en', items: [item({ answer: { key: 'C', comment: null } }), item({ factoryNo: '2', answer: null })] }));
    const h = headerRowOf(sheet, 'No.');
    expect(rowValues(sheet, h + 1).slice(4, 6)).toEqual(['C', '']);
    expect(rowValues(sheet, h + 2).slice(4, 6)).toEqual(['No answer', '']);
    // 답이 없는 칸은 큰 기호 서식이 아니다.
    expect(sheet.getRow(h + 2).getCell(5).font.size).toBe(10);
  });

  it('긴 글은 행이 높아진다 — 엑셀 상한(409pt)을 넘지 않는다', async () => {
    const short = await open(input());
    const long = await open(input({ items: [item({ questionOrig: '阻抗条位置需再确认。'.repeat(40) })] }));
    const huge = await open(input({ items: [item({ questionOrig: '阻抗条位置需再确认。\n'.repeat(400) })] }));
    const height = (s: ExcelJS.Worksheet): number => s.getRow(headerRowOf(s, '序号') + 1).height;
    expect(height(long)).toBeGreaterThan(height(short));
    expect(height(huge)).toBe(409);
  });

  it('이력으로 요청 회차를 못 정하면 고객 확인 회차만 적는다', async () => {
    const all = allText(await open(input({ requestRound: null })));
    expect(all).not.toContain('EQ 申请');
    expect(all).toContain('客户确认: 第 2 次');
  });

  it('유형 라벨은 세 언어 모두 열여섯 유형을 다 가진다', () => {
    for (const locale of ['ko', 'en', 'zh-CN'] as const) {
      const labels = PCB_EQ_ITEM_CATEGORY_LABELS_BY_LOCALE[locale];
      expect(Object.keys(labels).sort()).toEqual([...PCB_EQ_ITEM_CATEGORIES].sort());
      expect(Object.values(labels).every((v) => v.trim() !== '')).toBe(true);
    }
  });
});

describe('pcbEqReplyFileName', () => {
  it('회차 꼬리는 언어를 따른다', () => {
    expect(pcbEqReplyFileName({ projectName: 'L050AKM1001', poId: 985, roundNo: 2, locale: 'ko' })).toBe('EQ-Reply_L050AKM1001_PO-985_2차.xlsx');
    expect(pcbEqReplyFileName({ projectName: 'L050AKM1001', poId: 985, roundNo: 2, locale: 'zh-CN' })).toBe('EQ-Reply_L050AKM1001_PO-985_R2.xlsx');
  });

  it('경로 문자·공백은 밑줄로, 비면 PCB, 길면 자른다', () => {
    expect(pcbEqReplyFileName({ projectName: ' a/b:c*  d?.zip ', poId: 1, roundNo: 1, locale: 'en' })).toBe('EQ-Reply_a_b_c_d_.zip_PO-1_R1.xlsx');
    expect(pcbEqReplyFileName({ projectName: '///', poId: 1, roundNo: 1, locale: 'en' })).toBe('EQ-Reply_PCB_PO-1_R1.xlsx');
    expect(pcbEqReplyFileName({ projectName: 'x'.repeat(200), poId: 1, roundNo: 1, locale: 'en' }).length).toBeLessThan(90);
  });
});
