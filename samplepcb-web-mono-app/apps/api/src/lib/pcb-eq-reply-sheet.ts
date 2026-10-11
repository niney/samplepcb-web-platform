import ExcelJS from 'exceljs';
import {
  PCB_EQ_ANSWER_CHANNEL_LABELS,
  PCB_EQ_ITEM_CATEGORIES,
  PCB_EQ_ITEM_CATEGORY_LABELS_BY_LOCALE,
  pcbEqReplyFileName,
  summarizePcbEqRounds,
  type PcbEqAnswerChannelType,
  type PcbEqItemCategoryType,
  type PcbEqItemChangeType,
  type PcbEqReplyLocaleType,
} from '@sp/api-contract';
import { prisma } from './prisma';
import { parseEqItemFigures, parseEqItemOptions } from './pcb-eq-items';
import { loadEqRoundNumbers } from './pcb-eq-review';
import { parseEqHistory } from './pcb-po';

// ── EQ 회신서 엑셀(D20 P3) — 고객이 문항별로 답한 결과를 **서식을 갖춘 한 장**으로 내려받는다 ──────
// 공장은 포털에서 답을 읽을 수 있지만, 실제 작업은 자기 EQ 표에 답을 옮겨 적고 내부에 돌리는 일이다 —
// 화면을 베끼지 않고 파일로 받게 한다. 관리자도 같은 파일을 근거로 보관한다.
//
// 공장이 올린 원본 EQ 엑셀에 답을 써넣지 않는다 — 원본은 대개 옛 형식(.xls)이고 양식이 공장마다 달라
// 써넣는 순간 서식·그림이 깨진다. 정해진 양식의 회신서를 새로 만든다(상업송장 생성기와 같은 ExcelJS).
//
// 원칙(포털 '고객 회신' 카드와 같다):
//  · 선택 **기호**가 공장이 읽는 키다 — 가장 크게, 강조색으로. 번역이 어긋나도 "B 를 골랐다"는 어긋나지 않는다.
//  · 질문·선택지는 공장 원문(없으면 한국어), 고객 의견은 번역 없이 한국어 원문(사용자 결정 — 역번역 없음).
//  · 협력사용에는 고객 정보·대리 입력 여부를 싣지 않는다(포털이 안 보이는 것은 파일에도 없다).
//    관리자용에만 '고객이 본 문장(한국어)' 열과 대리 입력 경로가 붙는다.
//  · 그림은 싣지 않고 장수만 적는다 — 그림은 공장이 자기 EQ 에 넣은 것이라 공장이 이미 갖고 있다.

export type EqReplyAudience = 'partner' | 'admin';

export interface EqReplySheetItem {
  factoryNo: string | null;
  category: PcbEqItemCategoryType;
  /** 고객이 본 한국어 질문. */
  question: string;
  /** 공장 원문 질문 — 없으면 한국어 질문이 그 자리에 선다. */
  questionOrig: string | null;
  options: { key: string; label: string; labelOrig: string | null }[];
  answer: { key: string; comment: string | null } | null;
  change: PcbEqItemChangeType | null;
  figureCount: number;
}

export interface EqReplySheetInput {
  audience: EqReplyAudience;
  locale: PcbEqReplyLocaleType;
  projectName: string;
  poId: number;
  partnerName: string;
  /** EQ 요청 회차(협력사가 승인요청을 올린 횟수 — 포털 타임라인의 'N차 요청'). 이력으로 못 정하면 null. */
  requestRound: number | null;
  /** 고객 확인 회차(고객에게 문항을 보낸 횟수). */
  roundNo: number;
  answeredAt: string | null;
  forwardedAt: string | null;
  /** 관리자가 고객 대신 입력한 답이면 그 경로(전화·메일·기타) — 관리자용에만 적는다. */
  proxyChannel: PcbEqAnswerChannelType | null;
  items: EqReplySheetItem[];
}

// ── 문구 사전 — 포털 사전(apps/web/src/partner/locales/pcb.ts)과 같은 말. 유형 라벨은 계약의 언어별 표를 쓴다 ──
interface SheetText {
  title: string;
  project: string;
  po: string;
  partner: string;
  requestRound: string;
  customerRound: string;
  round: (n: number) => string;
  answered: string;
  forwarded: string;
  notForwarded: string;
  note: string;
  colNo: string;
  colType: string;
  colQuestion: string;
  colOptions: string;
  colChoice: string;
  colChosen: string;
  colComment: string;
  colChange: string;
  colFigures: string;
  figures: (n: number) => string;
  noAnswer: string;
  change: Record<PcbEqItemChangeType, string>;
  font: string;
}

const TEXT: Record<PcbEqReplyLocaleType, SheetText> = {
  ko: {
    title: 'EQ 회신서',
    project: '프로젝트',
    po: '발주번호',
    partner: '협력사',
    requestRound: 'EQ 요청',
    customerRound: '고객 확인',
    round: (n) => `${String(n)}차`,
    answered: '고객 회신',
    forwarded: '전달',
    notForwarded: '아직 협력사에 전달하지 않음',
    note: '샘플피씨비가 고객에게 확인한 EQ 답변입니다. 선택 기호는 귀사 EQ 표의 기호와 같습니다. 고객 의견은 번역 없이 한국어 원문입니다.',
    colNo: '번호',
    colType: '유형',
    colQuestion: '질문',
    colOptions: '선택지',
    colChoice: '고객 선택',
    colChosen: '선택한 내용',
    colComment: '고객 의견',
    colChange: '변경',
    colFigures: '참고 그림',
    figures: (n) => `${String(n)}장`,
    noAnswer: '답변 없음',
    change: { new: '신규', changed: '변경', same: '동일' },
    font: 'Malgun Gothic',
  },
  en: {
    title: 'EQ Reply Sheet',
    project: 'Project',
    po: 'PO No.',
    partner: 'Supplier',
    requestRound: 'EQ request',
    customerRound: 'Customer confirmation',
    round: (n) => `Round ${String(n)}`,
    answered: 'Customer answered',
    forwarded: 'Forwarded',
    notForwarded: 'Not yet forwarded to the supplier',
    note: 'These are the EQ answers SamplePCB confirmed with the customer. Option letters match those in your EQ sheet. Customer comments are in the original Korean, untranslated.',
    colNo: 'No.',
    colType: 'Type',
    colQuestion: 'Question',
    colOptions: 'Options',
    colChoice: 'Customer choice',
    colChosen: 'Chosen option',
    colComment: 'Customer comment',
    colChange: 'Change',
    colFigures: 'Figures',
    figures: (n) => String(n),
    noAnswer: 'No answer',
    change: { new: 'New', changed: 'Changed', same: 'Same' },
    font: 'Arial',
  },
  'zh-CN': {
    title: 'EQ 回复单',
    project: '项目',
    po: '订单号',
    partner: '供应商',
    requestRound: 'EQ 申请',
    customerRound: '客户确认',
    round: (n) => `第 ${String(n)} 次`,
    answered: '客户回复于',
    forwarded: '转达于',
    notForwarded: '尚未转达给供应商',
    note: '以下是 SamplePCB 向客户确认的 EQ 回复。选项字母与贵司 EQ 表中的字母一致。客户意见为韩语原文，未经翻译。',
    colNo: '序号',
    colType: '类型',
    colQuestion: '问题',
    colOptions: '选项',
    colChoice: '客户选择',
    colChosen: '所选内容',
    colComment: '客户意见',
    colChange: '变更',
    colFigures: '参考图',
    figures: (n) => `${String(n)} 张`,
    noAnswer: '未回答',
    change: { new: '新增', changed: '变更', same: '相同' },
    font: 'Microsoft YaHei',
  },
};


// ── 서식 조각 ────────────────────────────────────────────────────────────────

/** KST 'YYYY-MM-DD HH:mm KST' — 중국 공장이 현지 시각으로 읽지 않게 기준 시간대를 글자로 적는다(포털과 같다). */
const kstStamp = (iso: string | null): string => {
  const ms = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isNaN(ms) ? '—' : `${new Date(ms + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')} KST`;
};

/** 화면 폭(영문 1, 한중일 2) — 줄바꿈될 줄 수를 어림해 행 높이를 정한다(엑셀은 병합·서식 행을 저절로 안 늘린다). */
const displayWidth = (text: string): number => {
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0) ?? 0) > 0x2e7f ? 2 : 1;
  return w;
};
const wrappedLines = (text: string, colWidth: number): number =>
  text
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(displayWidth(line) / Math.max(1, colWidth - 1))), 0);

const THIN = { style: 'thin' as const, color: { argb: 'FF9CA3AF' } };
const BOX = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const HEAD_FILL = fill('FFE5E7EB');
const CHOICE_FILL = fill('FFEDE9FE'); // 포털의 보라(고객 선택)와 같은 계열
const COMMENT_FILL = fill('FFFEF9C3');

interface Column {
  key: 'no' | 'type' | 'question' | 'questionKo' | 'options' | 'choice' | 'chosen' | 'comment' | 'change' | 'figures';
  header: string;
  width: number;
  center?: boolean;
}

const optionLine = (o: { key: string; label: string; labelOrig: string | null }, orig: boolean): string =>
  `${o.key}. ${orig ? (o.labelOrig ?? o.label) : o.label}`;

/** 회신서 엑셀을 그린다(순수 — DB 를 읽지 않는다). */
export const renderEqReplyXlsx = async (input: EqReplySheetInput): Promise<Buffer> => {
  const t = TEXT[input.locale];
  const admin = input.audience === 'admin';
  const hasChange = input.items.some((i) => i.change !== null);
  const hasFigures = input.items.some((i) => i.figureCount > 0);

  const columns: Column[] = [
    { key: 'no', header: t.colNo, width: 7, center: true },
    { key: 'type', header: t.colType, width: 16 },
    { key: 'question', header: t.colQuestion, width: admin ? 38 : 46 },
    // 관리자용 — 고객이 실제로 읽은 한국어 문장(질문 + 선택지). 번역이 답을 갈랐는지 볼 근거.
    ...(admin ? [{ key: 'questionKo' as const, header: '고객이 본 문장(한국어)', width: 36 }] : []),
    { key: 'options', header: t.colOptions, width: 34 },
    { key: 'choice', header: t.colChoice, width: 11, center: true },
    { key: 'chosen', header: t.colChosen, width: 30 },
    { key: 'comment', header: t.colComment, width: 34 },
    // 개정 회차가 아니면(전부 null) 변경 열은 빈 칸뿐이라 두지 않는다. 그림도 한 장도 없으면 열을 두지 않는다.
    ...(hasChange ? [{ key: 'change' as const, header: t.colChange, width: 9, center: true }] : []),
    ...(hasFigures ? [{ key: 'figures' as const, header: t.colFigures, width: 10, center: true }] : []),
  ];
  const last = columns.length;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'SAMPLEPCB';
  wb.created = new Date();
  const sheet = wb.addWorksheet(`EQ Reply R${String(input.roundNo)}`, {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  sheet.columns = columns.map((c) => ({ width: c.width }));
  const font = (extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: t.font, size: 10, ...extra });

  let r = 1;
  const mergedRow = (text: string, height: number, f: Partial<ExcelJS.Font>, wrap = false): void => {
    sheet.mergeCells(r, 1, r, last);
    const row = sheet.getRow(r);
    row.height = height;
    const cell = row.getCell(1);
    cell.value = text;
    cell.font = font(f);
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: wrap };
    r += 1;
  };
  // 한 줄에 "라벨: 값" 둘 — 왼쪽 절반과 오른쪽 절반.
  const half = Math.ceil(last / 2);
  const infoRow = (left: string, right: string): void => {
    sheet.mergeCells(r, 1, r, half);
    sheet.mergeCells(r, half + 1, r, last);
    const row = sheet.getRow(r);
    row.height = 18;
    for (const [col, text] of [
      [1, left],
      [half + 1, right],
    ] as const) {
      const cell = row.getCell(col);
      cell.value = text;
      cell.font = font();
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
    r += 1;
  };

  mergedRow(t.title, 30, { size: 16, bold: true });
  infoRow(`${t.project}: ${input.projectName}`, `${t.po}: PO-${String(input.poId)}`);
  infoRow(
    `${t.partner}: ${input.partnerName}`,
    [
      input.requestRound === null ? null : `${t.requestRound}: ${t.round(input.requestRound)}`,
      `${t.customerRound}: ${t.round(input.roundNo)}`,
    ]
      .filter((x) => x !== null)
      .join('  ·  '),
  );
  infoRow(
    `${t.answered}: ${kstStamp(input.answeredAt)}`,
    input.forwardedAt === null ? t.notForwarded : `${t.forwarded}: ${kstStamp(input.forwardedAt)}`,
  );
  // 관리자용 — 고객이 직접 답했는가, 담당자가 전화·메일로 듣고 대신 넣었는가(나중에 다툼이 생기면 근거).
  if (admin && input.proxyChannel !== null) {
    mergedRow(`담당자 대리 입력 — 경로: ${PCB_EQ_ANSWER_CHANNEL_LABELS[input.proxyChannel]}`, 18, { bold: true, color: { argb: 'FFB45309' } });
  }
  const totalWidth = columns.reduce((n, c) => n + c.width, 0);
  mergedRow(t.note, Math.max(18, wrappedLines(t.note, totalWidth) * 14 + 4), { size: 9, color: { argb: 'FF6B7280' } }, true);
  r += 1;

  // 머리행 — 틀 고정·인쇄 때 장마다 반복.
  const headerRow = r;
  const head = sheet.getRow(r);
  head.height = 22;
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = font({ bold: true });
    cell.fill = HEAD_FILL;
    cell.border = BOX;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  r += 1;

  input.items.forEach((item, index) => {
    const chosen = item.answer === null ? null : (item.options.find((o) => o.key === item.answer?.key) ?? null);
    const comment = item.answer?.comment ?? '';
    const text: Record<Column['key'], string> = {
      no: item.factoryNo ?? String(index + 1),
      type: PCB_EQ_ITEM_CATEGORY_LABELS_BY_LOCALE[input.locale][item.category],
      question: item.questionOrig ?? item.question,
      questionKo: [item.question, ...item.options.map((o) => optionLine(o, false))].join('\n'),
      options: item.options.map((o) => optionLine(o, true)).join('\n'),
      choice: item.answer === null ? t.noAnswer : item.answer.key,
      // 선택지가 고쳐져 사라진 기호면 기호만 남는다(그래도 무엇을 골랐는지는 기호가 말한다).
      chosen: chosen === null ? '' : (chosen.labelOrig ?? chosen.label),
      comment,
      change: item.change === null ? '' : t.change[item.change],
      figures: item.figureCount > 0 ? t.figures(item.figureCount) : '',
    };
    const row = sheet.getRow(r);
    let lines = 1;
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = text[c.key];
      cell.font = font();
      cell.border = BOX;
      cell.alignment = { vertical: 'top', horizontal: c.center === true ? 'center' : 'left', wrapText: true };
      if (c.key === 'choice') {
        // 기호가 공장이 읽는 키다 — 문장보다 크게, 강조색으로.
        cell.font = font(item.answer === null ? { color: { argb: 'FF9CA3AF' } } : { size: 16, bold: true, color: { argb: 'FF5B21B6' } });
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        if (item.answer !== null) cell.fill = CHOICE_FILL;
      } else if (c.key === 'chosen' && text.chosen !== '') {
        cell.font = font({ bold: true });
        cell.fill = CHOICE_FILL;
      } else if (c.key === 'comment' && comment !== '') {
        cell.fill = COMMENT_FILL;
      }
      lines = Math.max(lines, wrappedLines(text[c.key], c.width));
    });
    // 엑셀 행 높이의 상한은 409pt — 아주 긴 질문도 잘리지 않게 위에 붙여(top) 둔다.
    row.height = Math.min(409, Math.max(26, lines * 14 + 6));
    r += 1;
  });

  sheet.views = [{ state: 'frozen', ySplit: headerRow, showGridLines: false }];
  sheet.pageSetup.printTitlesRow = `${String(headerRow)}:${String(headerRow)}`;

  return Buffer.from(await wb.xlsx.writeBuffer());
};

// ── 원장에서 읽기 ────────────────────────────────────────────────────────────

export type EqReplySheetError = 'NOT_FOUND' | 'NOT_ANSWERED' | 'NOT_FORWARDED';

/**
 * 회차 하나를 회신서 입력으로 읽는다.
 * `poId` 는 **회차가 붙어 있는 발주서**다(위임 상위가 보는 것은 하위 발주서의 회차 — 부르는 쪽이 풀어서 준다).
 * 문항형 회차만, 그리고 **회신이 온 뒤**에만 만든다(답이 없는 회신서는 없다). 협력사는 관리자가 전달한 회차만 받는다.
 */
export const loadEqReplySheet = async (args: {
  poId: bigint;
  reviewId: bigint;
  audience: EqReplyAudience;
  locale: PcbEqReplyLocaleType;
}): Promise<{ ok: true; sheet: EqReplySheetInput; fileName: string } | { ok: false; error: EqReplySheetError }> => {
  const review = await prisma.spPcbEqReview.findFirst({
    where: { id: args.reviewId, poId: args.poId, format: 'items' },
    include: { items: { orderBy: { seq: 'asc' } } },
  });
  if (review === null) return { ok: false, error: 'NOT_FOUND' };
  if (review.status !== 'answered') return { ok: false, error: 'NOT_ANSWERED' };
  if (args.audience === 'partner' && review.forwardedAt === null) return { ok: false, error: 'NOT_FORWARDED' };

  const po = await prisma.spPcbPo.findUnique({
    where: { id: args.poId },
    include: { partner: { select: { name: true } }, spec: { select: { projectName: true } } },
  });
  if (po === null) return { ok: false, error: 'NOT_FOUND' };
  const roundNo = (await loadEqRoundNumbers([args.poId])).get(review.id.toString()) ?? 0;
  // EQ 요청 회차 — 이 고객 확인이 어느 승인요청의 것인가(요청 회차의 시간 창에 든 것). 이력이 비면 적지 않는다.
  const at = review.requestedAt.getTime();
  const requestRound =
    summarizePcbEqRounds(parseEqHistory(po.eqHistory), []).find(
      (round) =>
        (round.startAt === null || at > Date.parse(round.startAt)) && (round.endAt === null || at <= Date.parse(round.endAt)),
    )?.index ?? null;

  const category = (v: string): PcbEqItemCategoryType => PCB_EQ_ITEM_CATEGORIES.find((c) => c === v) ?? 'other';
  const change = (v: string | null): PcbEqItemChangeType | null => (v === 'new' || v === 'changed' || v === 'same' ? v : null);
  const sheet: EqReplySheetInput = {
    audience: args.audience,
    locale: args.locale,
    projectName: po.spec.projectName,
    poId: Number(po.id),
    partnerName: po.partner.name,
    requestRound: po.eqHistory === null ? null : requestRound,
    roundNo,
    answeredAt: review.decidedAt === null ? null : review.decidedAt.toISOString(),
    forwardedAt: review.forwardedAt === null ? null : review.forwardedAt.toISOString(),
    proxyChannel:
      review.answeredRole === 'admin'
        ? (review.answerChannel === 'phone' || review.answerChannel === 'email' || review.answerChannel === 'other'
            ? review.answerChannel
            : 'other')
        : null,
    items: review.items.map((i) => ({
      factoryNo: i.factoryNo,
      category: category(i.category),
      question: i.question,
      questionOrig: i.questionOrig,
      options: parseEqItemOptions(i.options).map((o) => ({ key: o.key, label: o.label, labelOrig: o.labelOrig })),
      answer: i.answerKey === null ? null : { key: i.answerKey, comment: i.answerComment === '' ? null : i.answerComment },
      change: change(i.change),
      figureCount: parseEqItemFigures(i.figures).length,
    })),
  };
  return {
    ok: true,
    sheet,
    fileName: pcbEqReplyFileName({ projectName: sheet.projectName, poId: sheet.poId, roundNo, locale: args.locale }),
  };
};
