import { SMARTSMT_BLOCK_LABELS, smartsmtLabel } from '@sp/api-contract';
import { asArray, asNumber, asRecord, asText, isRecord, valueText } from './smt-envelope';

// 견적서형 편집 표의 줄 — SmartSMT 「통합 견적서」와 같은 순서로 읽는다(2026-11-19 화면 실측).
//
//   PCB · 부품(이 주문에서 사는 블록) → 견적 줄을 묶음별로(quote.subtotals 의 label · codes:
//   메탈마스크 / SMT / 수삽 및 후공정 / 검사 · 시험 · 프로그램 / 완제품 조립 · 포장) → 기타(간접비 · 기업이윤 · 배송)
//
// 여기서는 줄을 읽기만 한다. 금액 계산은 계약의 computeSmartsmtSheet 가 한다(서버와 같은 함수).
// 견적서는 바깥 JSON 이라 칸이 없거나 모양이 달라도 죽지 않게 타입 가드로 읽는다.

export interface SmtSheetRow {
  /** line = 견적 줄(quote.lines), block = 통합 합계 블록(PCB · PARTS · SHIPPING …). */
  kind: 'line' | 'block';
  /** 고친 금액의 키 — 줄은 code, 블록은 block. */
  key: string;
  item: string;
  /** 줄의 식 · 블록의 설명. */
  formula: string;
  count: number | null;
  countUnit: string;
  unitPrice: number | null;
  /** SmartSMT 가 계산해 온 금액. null = 미정. */
  original: number | null;
  /** 줄 상태(lines[].status — 빈 글자 = 확정). 블록은 null. */
  status: string | null;
  /** 수량이 0 이라 SmartSMT 견적서에도 나오지 않는 줄("미적용") — 기본으로 접어 둔다. */
  idle: boolean;
}

export interface SmtSheetGroup {
  key: string;
  label: string;
  rows: SmtSheetRow[];
}

export interface SmtSheet {
  /** 이 주문에서 사는 블록 중 PCB · 부품 — 표의 맨 위. */
  blocks: SmtSheetRow[];
  /** 견적 줄 — 묶음별. */
  groups: SmtSheetGroup[];
  /** 기타에 놓는 블록(배송 등 — PCB · 부품이 아닌 것). */
  extras: SmtSheetRow[];
}

const TOP_BLOCKS: readonly string[] = ['PCB', 'PARTS'];

const readLine = (value: unknown): SmtSheetRow | null => {
  if (!isRecord(value)) return null;
  const code = asText(value.code);
  if (code === null || code === '') return null;
  const count = asNumber(value.count);
  const original = asNumber(value.amount);
  return {
    kind: 'line',
    key: code,
    item: valueText(value.item),
    formula: asText(value.formula) ?? '',
    count,
    countUnit: asText(value.count_unit) ?? '',
    unitPrice: asNumber(value.unit_price),
    original,
    status: asText(value.status),
    idle: count === 0 && original === 0,
  };
};

const readBlock = (value: unknown): SmtSheetRow | null => {
  if (!isRecord(value) || value.included !== true) return null;
  const name = asText(value.block);
  if (name === null || name === '') return null;
  return {
    kind: 'block',
    key: name,
    item: smartsmtLabel(SMARTSMT_BLOCK_LABELS, name),
    formula: '',
    count: asNumber(value.source_qty),
    countUnit: asText(value.source_qty_unit) ?? '',
    unitPrice: asNumber(value.display_only_unit_price),
    original: asNumber(value.amount),
    status: null,
    idle: false,
  };
};

export function readSmtSheet(envelope: Readonly<Record<string, unknown>>): SmtSheet {
  const quote = asRecord(envelope.quote);
  const lines = asArray(quote.lines).flatMap((entry) => readLine(entry) ?? []);
  const blocks = asArray(asRecord(quote.integrated).blocks).flatMap((entry) => readBlock(entry) ?? []);

  // 묶음 — SmartSMT 가 실어 온 소계(label · codes)를 따른다. 어느 묶음에도 없는 줄은 맨 끝 '그 밖의 줄'.
  const placed = new Set<string>();
  const groups: SmtSheetGroup[] = [];
  for (const [index, entry] of asArray(quote.subtotals).entries()) {
    if (!isRecord(entry)) continue;
    const codes = asArray(entry.codes).flatMap((code) => (typeof code === 'string' ? [code] : []));
    const rows = codes.flatMap((code) => {
      const line = placed.has(code) ? undefined : lines.find((row) => row.key === code);
      if (line === undefined) return [];
      placed.add(code);
      return [line];
    });
    if (rows.length > 0) groups.push({ key: `subtotal-${String(index)}`, label: valueText(entry.label), rows });
  }
  const rest = lines.filter((line) => !placed.has(line.key));
  if (rest.length > 0) groups.push({ key: 'rest', label: groups.length === 0 ? '견적 줄' : '그 밖의 줄', rows: rest });

  return {
    blocks: blocks.filter((block) => TOP_BLOCKS.includes(block.key)),
    groups,
    extras: blocks.filter((block) => !TOP_BLOCKS.includes(block.key)),
  };
}

/** 입력칸의 글자를 금액으로 — 빈 글자는 null(고치지 않음), 숫자가 아니면 undefined(잘못된 입력). 쉼표 · 공백 · '원'은 뗀다. */
export function parseSheetAmount(text: string): number | null | undefined {
  const cleaned = text.replace(/[,\s원]/g, '');
  if (cleaned === '') return null;
  if (!/^\d{1,13}$/.test(cleaned)) return undefined;
  return Number(cleaned);
}
