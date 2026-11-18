import { z } from 'zod';

// SmartSMT 견적의 관리자 확정 — 항목별 가격 수정 (docs/SMARTSMT_INTEGRATION.md §9).
//
// 관리자는 SmartSMT 가 계산해 온 견적을 놓고 **항목(견적 줄 · 블록)의 금액**을 고친다. 총액은 고치지 않는다 —
// 항목에서 계산돼 나온다. 계산 순서는 SmartSMT 통합 견적서와 같다(2026-11-19 실제 견적 3건으로 맞춰 봄):
//
//   직접공정비  = 견적 줄(quote.lines) 금액의 합
//   간접비      = round(직접공정비 × 간접비율)
//   기업이윤    = round((직접공정비 + 간접비) × 기업이윤율)
//   SMT 공급가  = 직접공정비 + 간접비 + 기업이윤
//   공급가액    = SMT 공급가 + 이 주문에서 사는 블록(PCB · 부품 · 배송 …)의 금액
//   부가세      = round(공급가액 × 부가세율)        합계 = 공급가액 + 부가세
//
// 요율은 견적서가 실어 온 값(header.controls)을 쓴다 — SmartSMT 가 요율을 바꾸면 다음 견적부터 그대로 반영된다.
// 서버와 화면이 같은 함수를 쓴다(화면은 입력하는 동안 미리 보여 주고, 저장할 때 서버가 다시 계산한다).

export const SMARTSMT_REVIEW_STATUSES = ['draft', 'confirmed'] as const;
export type SmartsmtReviewStatus = (typeof SMARTSMT_REVIEW_STATUSES)[number];
export const SMARTSMT_REVIEW_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: '임시 저장',
  confirmed: '확정',
};

/** 고친 금액 한 칸 — 0 이상의 정수(원). 미정으로 되돌리려면 그 키를 빼면 된다(SmartSMT 금액으로 돌아간다). */
const EditedAmount = z.number().int().min(0).max(1_000_000_000_000);

export const AdminSmtReviewBody = z.object({
  /** 견적 줄의 금액 덮어쓰기 — 키는 lines[].code. 키가 없는 줄은 SmartSMT 금액 그대로. */
  lineAmounts: z.record(z.string().min(1).max(40), EditedAmount).default({}),
  /** 블록 금액 덮어쓰기 — 키는 blocks[].block(PCB · PARTS · SHIPPING …). */
  blockAmounts: z.record(z.string().min(1).max(40), EditedAmount).default({}),
  /** 고객 안내 글. */
  customerNote: z.string().max(2000).default(''),
  /** true = 확정(빈 금액이 하나도 없어야 한다), false = 임시 저장. */
  confirm: z.boolean().default(false),
});
export type AdminSmtReviewBodyType = z.infer<typeof AdminSmtReviewBody>;

export const SmartsmtSheetTotals = z.object({
  /** 금액이 정해진 견적 줄의 합(직접공정비). 빈 줄은 0 으로 센다. */
  directCost: z.number(),
  indirectCost: z.number(),
  profit: z.number(),
  /** 직접공정비 + 간접비 + 기업이윤. */
  smtSupplyPrice: z.number(),
  /** 이 주문에서 사는 블록 금액의 합. 빈 블록은 0 으로 센다. */
  blockSum: z.number(),
  supplyPrice: z.number(),
  vat: z.number(),
  total: z.number(),
  /** 금액이 비어 있는 견적 줄의 코드. */
  unknownLines: z.array(z.string()),
  /** 금액이 비어 있는 블록(이 주문에서 사는 것만). */
  unknownBlocks: z.array(z.string()),
  /** 빈 금액이 하나도 없는가 — 확정할 수 있다. */
  complete: z.boolean(),
  /** 계산에 쓴 요율(%). */
  rates: z.object({ indirect: z.number(), profit: z.number(), vat: z.number() }),
});
export type SmartsmtSheetTotalsType = z.infer<typeof SmartsmtSheetTotals>;

/** 저장된 확정(또는 임시 저장) 한 벌 — 견적 하나에 하나. */
export const AdminSmtReview = z.object({
  status: z.enum(SMARTSMT_REVIEW_STATUSES),
  lineAmounts: z.record(z.string(), z.number()),
  blockAmounts: z.record(z.string(), z.number()),
  customerNote: z.string(),
  /** 저장할 때 서버가 계산한 값. */
  totals: SmartsmtSheetTotals,
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
  confirmedAt: z.string().nullable(),
});
export type AdminSmtReviewType = z.infer<typeof AdminSmtReview>;

export const AdminSmtReviewResponse = z.object({
  result: z.literal(true),
  data: z.object({ review: AdminSmtReview.nullable() }),
});
export type AdminSmtReviewResponseType = z.infer<typeof AdminSmtReviewResponse>;

// ── 계산 ────────────────────────────────────────────────────────────────────────────────

export interface SmartsmtSheetInput {
  lines: readonly { code: string; amount: number | null }[];
  blocks: readonly { block: string; included: boolean; amount: number | null }[];
  /** 요율(%) — 10 = 10%. */
  rates: { indirect: number; profit: number; vat: number };
}

export interface SmartsmtSheetEdits {
  lineAmounts: Readonly<Record<string, number>>;
  blockAmounts: Readonly<Record<string, number>>;
}

type Json = Record<string, unknown>;
const asRecord = (value: unknown): Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);
const asAmount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const asRate = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

/**
 * 견적서(envelope)에서 계산에 필요한 값만 읽는다. 견적서는 바깥 JSON 이라 칸이 없어도 죽지 않게 읽는다 —
 * 줄 · 블록이 없으면 빈 목록, 간접비율 · 이윤율이 없으면 0, 부가세율이 없으면 10.
 */
export function readSmartsmtSheetInput(envelope: unknown): SmartsmtSheetInput {
  const root = asRecord(envelope);
  const quote = asRecord(root.quote);
  const controls = asRecord(asRecord(root.header).controls);
  return {
    lines: asList(quote.lines).flatMap((entry) => {
      const line = asRecord(entry);
      return typeof line.code === 'string' && line.code !== '' ? [{ code: line.code, amount: asAmount(line.amount) }] : [];
    }),
    blocks: asList(asRecord(quote.integrated).blocks).flatMap((entry) => {
      const block = asRecord(entry);
      return typeof block.block === 'string' && block.block !== ''
        ? [{ block: block.block, included: block.included === true, amount: asAmount(block.amount) }]
        : [];
    }),
    rates: {
      indirect: asRate(controls['markup.indirect_cost_rate'], 0),
      profit: asRate(controls['markup.profit_rate'], 0),
      vat: asRate(controls['policy.vat_rate'], 10),
    },
  };
}

/** 고친 금액 중 이 견적에 실제로 있는 항목만 남긴다(없는 코드 · 사지 않는 블록은 버린다). */
export function pickSmartsmtSheetEdits(input: SmartsmtSheetInput, edits: SmartsmtSheetEdits): SmartsmtSheetEdits {
  const lineCodes = new Set(input.lines.map((line) => line.code));
  const blockNames = new Set(input.blocks.filter((block) => block.included).map((block) => block.block));
  return {
    lineAmounts: Object.fromEntries(Object.entries(edits.lineAmounts).filter(([code]) => lineCodes.has(code))),
    blockAmounts: Object.fromEntries(Object.entries(edits.blockAmounts).filter(([name]) => blockNames.has(name))),
  };
}

/** 항목 금액에서 합계를 낸다. 고친 금액이 있으면 그 값, 없으면 SmartSMT 금액. 순수 함수. */
export function computeSmartsmtSheet(input: SmartsmtSheetInput, edits: SmartsmtSheetEdits): SmartsmtSheetTotalsType {
  const unknownLines: string[] = [];
  let directCost = 0;
  for (const line of input.lines) {
    const amount = edits.lineAmounts[line.code] ?? line.amount;
    if (amount === null) unknownLines.push(line.code);
    else directCost += amount;
  }
  const unknownBlocks: string[] = [];
  let blockSum = 0;
  for (const block of input.blocks) {
    if (!block.included) continue;
    const amount = edits.blockAmounts[block.block] ?? block.amount;
    if (amount === null) unknownBlocks.push(block.block);
    else blockSum += amount;
  }
  const indirectCost = Math.round((directCost * input.rates.indirect) / 100);
  const profit = Math.round(((directCost + indirectCost) * input.rates.profit) / 100);
  const smtSupplyPrice = directCost + indirectCost + profit;
  const supplyPrice = smtSupplyPrice + blockSum;
  const vat = Math.round((supplyPrice * input.rates.vat) / 100);
  return {
    directCost,
    indirectCost,
    profit,
    smtSupplyPrice,
    blockSum,
    supplyPrice,
    vat,
    total: supplyPrice + vat,
    unknownLines,
    unknownBlocks,
    complete: unknownLines.length === 0 && unknownBlocks.length === 0,
    rates: { ...input.rates },
  };
}
