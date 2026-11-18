import {
  SMARTSMT_ASSEMBLY_SIDES_LABELS,
  SMARTSMT_BASIS_LABELS,
  SMARTSMT_LINE_GROUP_LABELS,
  SMARTSMT_ORDER_SCENARIO_LABELS,
  SMARTSMT_PACKING_MODE_LABELS,
  SMARTSMT_PROCESS_LABELS,
  SMARTSMT_QUANTITY_LABELS,
  SMARTSMT_REFLOW_LABELS,
  SMARTSMT_STRATEGY_LABELS,
  SMARTSMT_SUPPLY_LABELS,
  smartsmtLabel,
} from '@sp/api-contract';

// SmartSMT 견적서(envelope)를 화면용 값으로 읽는다 — 견적 상세(SmtQuotePage)가 쓴다.
//
// 견적서는 바깥(SmartSMT)이 만든 JSON 이고 계약은 꼭 필요한 칸만 검사한다(나머지는 모르는 칸까지 그대로 온다).
// 칸 구성은 「견적서 전송 양식 0.3」으로 짠 뒤 **실제 견적서(envelope_version 9, 2026-11-18 수신분)** 에 맞춰 고쳤다 —
// 추정 금액(estimated_*) · 수량 칸 이름(…_set_qty) · 주문 공정(processes) · 고객 요청(quote_request.text · preorder).
// 양식은 또 바뀔 수 있다. 그래서 모든 칸을 타입 가드로 읽고, 없거나 모양이 다르면 빈 값('—')으로 둔다 —
// 화면이 죽지 않는 것이 먼저다. 아는 칸에 없는 값은 '원문' 섹션에서 그대로 볼 수 있다.
// 코드 값은 계약의 라벨 사전으로 읽고, 사전에 없으면 코드 그대로(smartsmtLabel).

type Labels = Readonly<Record<string, string>>;

// ── 작은 타입 가드 ────────────────────────────────────────────────────────────────────────

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 객체면 그대로, 아니면 빈 객체 — 칸을 꺼내다 죽지 않게. */
export const asRecord = (value: unknown): Readonly<Record<string, unknown>> => (isRecord(value) ? value : {});

export const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);

export const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** 번호·코드처럼 글자나 숫자로 올 수 있는 칸. */
export const asCode = (value: unknown): string | null =>
  typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : null;

/** 값 그대로의 글자 — 글자는 그대로, 그 밖은 JSON(10 → "10", null → "null"). 요율·제어값처럼 "값은 글자 그대로" 보일 때. */
export const rawText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  return JSON.stringify(value);
};

/** 사람이 읽는 값 — 없거나 빈 글자는 '—', 객체·배열은 JSON 한 줄. */
export const valueText = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  return rawText(value);
};

/** 코드 값을 라벨 사전으로 — 사전에 없으면 코드 그대로, 글자가 아니면 값 그대로. */
const labelText = (value: unknown, labels: Labels): string =>
  typeof value === 'string' ? smartsmtLabel(labels, value) : valueText(value);

// ── 화면용 모양 ───────────────────────────────────────────────────────────────────────────

/** 이름 · 값 한 칸(정의 목록). key 는 견적서의 칸 이름 — 툴팁으로 남겨 원문과 맞춰 보게 한다. */
export interface SmtField {
  key: string;
  label: string;
  value: string;
}

export interface SmtLine {
  code: string;
  item: string;
  group: string;
  basis: string;
  formula: string;
  count: number | null;
  countUnit: string;
  unitPrice: number | null;
  amount: number | null;
  /** 빈 글자 = 확정, null = 칸이 없음. */
  status: string | null;
}

export interface SmtSubtotal {
  label: string;
  amount: number | null;
}

/** 금액 구성 한 칸(직접비 → 간접비 → 이윤 → 공급가 → 부가세 → 합계). 합계는 SMT 작업비만이다. */
export interface SmtCost {
  key: string;
  label: string;
  amount: number | null;
}

export interface SmtBlock {
  block: string;
  source: string | null;
  quoteRef: string | null;
  /** 이 주문에서 사는가. null = 칸이 없음. */
  included: boolean | null;
  amount: number | null;
  amountCurrency: string | null;
  requestStatus: string | null;
  valuation: string | null;
  completeness: string | null;
  /** 합계에 들지 않는 사유. null = 사유 없음(합계에 든다). */
  reason: string | null;
}

/** 추정 금액 — 확정 금액이 미정일 때 SmartSMT 가 따로 싣는 가견적. 확정 금액이 아니다. */
export interface SmtEstimates {
  /** 통합(최종) 추정 — 공급가 · 부가세 · 합계. 고객 화면의 "최종합계"가 이 합계다. */
  final: SmtCost[];
  /** 추정에 든 블록(integrated.totals.estimated_blocks). */
  finalBlocks: string[];
  /** SMT 작업비 추정 — 금액이 확인된 줄의 합 · 간접비 · 이윤 · 공급가 · 부가세 · 합계. */
  smt: SmtCost[];
}

export interface SmtKnown {
  sum: number | null;
  blocks: string[];
}

export interface SmtWarningGroup {
  key: string;
  label: string;
  items: string[];
}

export interface SmtRequestField {
  key: string;
  label: string;
  value: string;
}

export interface SmtEntry {
  key: string;
  value: string;
}

export interface SmtQuoteView {
  currency: string | null;
  madeAt: string | null;
  lang: string | null;
  /** 예시(기본) 요율로 계산된 견적인가 — 실제 요율이 아니라는 경고. */
  policyIsDefault: boolean;
  versions: SmtField[];
  conditions: SmtField[];
  quantities: SmtField[];
  lines: SmtLine[];
  subtotals: SmtSubtotal[];
  costs: SmtCost[];
  /** 추정 금액이 하나도 오지 않았으면 null. */
  estimates: SmtEstimates | null;
  blocks: SmtBlock[];
  /** 참고값 — 금액이 확인된 블록의 합(integrated.known). 합계가 아니다. */
  known: SmtKnown | null;
  warnings: SmtWarningGroup[];
  request: SmtRequestField[];
  controls: SmtEntry[];
  rates: SmtEntry[];
  /** 고객이 넣은 PCB 사양(user_edits.pcb_spec_inputs) — 칸 이름은 SmartSMT 화면의 것 그대로. */
  pcbSpec: SmtEntry[];
}

// 라벨은 SmartSMT 「견적서 전송 양식 0.3」의 "뜻" 칸을 따른다(우리가 지어 붙인 이름이 아니다).
const VERSION_FIELDS: readonly (readonly [string, string])[] = [
  ['pricing_model_version', '원가 모델'],
  ['policy_version', '요율표'],
  ['catalog_version', '항목 목록'],
  ['calculator_version', '계산 순서'],
];

// 사람이 정한 조건 — 사전이 있는 코드는 라벨로.
const CONDITION_FIELDS: readonly (readonly [string, string, Labels | null])[] = [
  ['strategy', '구분', SMARTSMT_STRATEGY_LABELS],
  ['order_scenario', '주문 유형', SMARTSMT_ORDER_SCENARIO_LABELS],
  ['assembly_sides', '실장 면', SMARTSMT_ASSEMBLY_SIDES_LABELS],
  ['reflow_atmosphere', '리플로우', SMARTSMT_REFLOW_LABELS],
  ['parts_supply', '부품 조달', SMARTSMT_SUPPLY_LABELS],
  ['metal_mask_supply', '메탈마스크 조달', SMARTSMT_SUPPLY_LABELS],
  ['metal_mask_sets', '메탈마스크 SET 수', null],
  ['feeder_slots', '피더 칸 수', null],
  ['cut_tape_types', '컷테이프 종수', null],
  ['fixture_quantity', '고정지그 수', null],
  ['hand_solder_pins', '수삽 핀 수 (보드 1장분)', null],
  ['packing_mode', '포장', SMARTSMT_PACKING_MODE_LABELS],
];

// 수량은 온 칸을 온 순서대로 보인다 — 칸 이름이 양식 0.3(set_qty …)과 판 9(make_set_qty …)에서 다르다.
// 라벨은 계약의 SMARTSMT_QUANTITY_LABELS, 사전에 없는 칸은 이름 그대로.

const ESTIMATED_FINAL_FIELDS: readonly (readonly [string, string])[] = [
  ['estimated_supply_price', '추정 공급가'],
  ['estimated_vat', '추정 부가세'],
  ['estimated_total', '추정 합계'],
];

const ESTIMATED_SMT_FIELDS: readonly (readonly [string, string])[] = [
  ['known_subtotal', '금액이 확인된 줄의 합'],
  ['estimated_indirect_cost', '추정 간접비'],
  ['estimated_profit', '추정 이윤'],
  ['estimated_supply_price', '추정 공급가'],
  ['estimated_vat', '추정 부가세'],
  ['estimated_total', '추정 합계 (SMT 작업비)'],
];

const COST_FIELDS: readonly (readonly [string, string])[] = [
  ['direct_cost', '직접비'],
  ['indirect_cost', '간접비'],
  ['profit', '이윤'],
  ['supply_price', '공급가'],
  ['vat', '부가세'],
  ['total', '합계 (SMT 작업비)'],
];

const WARNING_FIELDS: readonly (readonly [string, string])[] = [
  ['blockers', '파일이 덜 와서 막힌 사유'],
  ['unknown_lines', '금액을 내지 못한 줄'],
  ['unknown_controls', '값이 비어 있는 요율'],
  ['unknown_refs', '종류를 가리지 못한 부품 (REF)'],
  ['input_warnings', '입력값끼리 어긋남'],
];

// remark · remark_warn 은 견적서 바닥에 들어가는 글이다(고객이 쓴 요청사항은 quote_request).
const REQUEST_FIELDS: readonly (readonly [string, string])[] = [
  ['quote_request', '고객 요청사항'],
  ['due_date', '희망 납품일'],
  ['remark', '견적서 비고'],
  ['remark_warn', '견적서 주의 문구'],
];

// 주문 전 단계에서 고객이 고른 값(user_edits.preorder). rush 는 참일 때만 보인다.
const PREORDER_FIELDS: readonly (readonly [string, string])[] = [
  ['extra_note', '추가 요청'],
  ['extras', '추가 작업'],
  ['parts_form', '부품 형태'],
  ['region', '지역'],
];

/** 경고 한 건 — 글자는 그대로, 객체는 message(또는 code·reason)를 앞세우고 없으면 JSON. */
const warningText = (value: unknown): string => {
  if (!isRecord(value)) return valueText(value);
  const message = asText(value.message);
  const code = asText(value.code) ?? asText(value.reason);
  if (message !== null && message !== '') return code === null ? message : `${code} — ${message}`;
  return JSON.stringify(value);
};

/**
 * 고객이 쓴 값 — 비었으면 null(섹션에서 뺀다). 객체는 들여쓴 JSON.
 * quote_request 는 판 9 에서 { text, mb_id, mb_name, updated_at } 객체로 온다 — 글(text)만 보인다(쓴 사람은 주문 정보에 있다).
 */
const requestText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (isRecord(value) && typeof value.text === 'string') return value.text.trim() === '' ? null : value.text;
  if (isRecord(value) && Object.keys(value).length === 0) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : rawText(value);
};

const readLine = (value: unknown): SmtLine | null => {
  if (!isRecord(value)) return null;
  const basis = asText(value.basis);
  return {
    code: valueText(value.code),
    item: valueText(value.item),
    group: labelText(value.group, SMARTSMT_LINE_GROUP_LABELS),
    basis: basis === null ? valueText(value.basis) : smartsmtLabel(SMARTSMT_BASIS_LABELS, basis),
    formula: valueText(value.formula),
    count: asNumber(value.count),
    countUnit: asText(value.count_unit) ?? '',
    unitPrice: asNumber(value.unit_price),
    amount: asNumber(value.amount),
    status: asText(value.status),
  };
};

const readBlock = (value: unknown): SmtBlock | null => {
  if (!isRecord(value)) return null;
  const included = value.included;
  return {
    block: valueText(value.block),
    source: asCode(value.source),
    quoteRef: asCode(value.quote_ref),
    included: typeof included === 'boolean' ? included : null,
    amount: asNumber(value.amount),
    amountCurrency: asText(value.amount_currency),
    requestStatus: asCode(value.request_status),
    valuation: asCode(value.valuation),
    completeness: asCode(value.completeness),
    reason: asCode(value.reason),
  };
};

const entriesOf = (value: unknown): SmtEntry[] =>
  Object.entries(asRecord(value)).map(([key, entry]) => ({ key, value: rawText(entry) }));

const stringsOf = (value: unknown): string[] =>
  asArray(value).flatMap((entry) => (typeof entry === 'string' ? [entry] : []));

const costsOf = (source: Readonly<Record<string, unknown>>, fields: readonly (readonly [string, string])[]): SmtCost[] =>
  fields.map(([key, label]) => ({ key, label, amount: asNumber(source[key]) }));

/** 추정 금액 — 통합 추정도 SMT 추정도 오지 않았으면 null(양식 0.3 의 견적서에는 이 칸이 없다). */
const readEstimates = (
  quote: Readonly<Record<string, unknown>>,
  totals: Readonly<Record<string, unknown>>,
): SmtEstimates | null => {
  if (asNumber(totals.estimated_total) === null && asNumber(quote.estimated_total) === null) return null;
  return {
    final: costsOf(totals, ESTIMATED_FINAL_FIELDS),
    finalBlocks: stringsOf(totals.estimated_blocks),
    smt: costsOf(quote, ESTIMATED_SMT_FIELDS),
  };
};

export function readSmtQuoteView(envelope: Readonly<Record<string, unknown>>): SmtQuoteView {
  const header = asRecord(envelope.header);
  const quote = asRecord(envelope.quote);
  const quantities = asRecord(header.quantities);
  const integrated = asRecord(quote.integrated);
  const known = isRecord(integrated.known) ? integrated.known : null;
  const edits = asRecord(header.user_edits);
  const preorder = asRecord(edits.preorder);
  const processes = stringsOf(header.processes);
  // 문서 예시가 문자열 "false" 였다(docs §6-6) — 글자 'true' 도 참으로 읽는다. 머리에 없으면 quote 쪽 칸.
  const policyFlag = header.policy_is_default ?? quote.policy_is_default;

  return {
    currency: asText(header.currency),
    madeAt: asText(header.made_at),
    lang: asText(header.lang),
    policyIsDefault: policyFlag === true || policyFlag === 'true',
    versions: VERSION_FIELDS.map(([key, label]) => ({ key, label, value: valueText(header[key]) })),
    conditions: [
      ...(processes.length === 0
        ? []
        : [
            {
              key: 'processes',
              label: '주문 공정',
              value: processes.map((code) => smartsmtLabel(SMARTSMT_PROCESS_LABELS, code)).join(' · '),
            },
          ]),
      ...CONDITION_FIELDS.map(([key, label, labels]) => ({
        key,
        label,
        value: labels === null ? valueText(header[key]) : labelText(header[key], labels),
      })),
    ],
    quantities: Object.entries(quantities).map(([key, value]) => ({
      key,
      label: smartsmtLabel(SMARTSMT_QUANTITY_LABELS, key),
      value: valueText(value),
    })),
    lines: asArray(quote.lines).flatMap((entry) => readLine(entry) ?? []),
    subtotals: asArray(quote.subtotals).flatMap((entry) =>
      isRecord(entry) ? [{ label: valueText(entry.label), amount: asNumber(entry.amount) }] : [],
    ),
    costs: costsOf(quote, COST_FIELDS),
    estimates: readEstimates(quote, asRecord(integrated.totals)),
    blocks: asArray(integrated.blocks).flatMap((entry) => readBlock(entry) ?? []),
    known:
      known === null
        ? null
        : {
            sum: asNumber(known.sum),
            blocks: stringsOf(known.blocks),
          },
    warnings: WARNING_FIELDS.flatMap(([key, label]) => {
      const items = asArray(quote[key]).map(warningText);
      return items.length === 0 ? [] : [{ key, label, items }];
    }),
    request: [
      ...REQUEST_FIELDS.flatMap(([key, label]) => {
        const value = requestText(header[key]);
        return value === null ? [] : [{ key, label, value }];
      }),
      ...(preorder.rush === true ? [{ key: 'preorder.rush', label: '긴급 제작', value: '요청함' }] : []),
      ...PREORDER_FIELDS.flatMap(([key, label]) => {
        const value = requestText(preorder[key]);
        return value === null ? [] : [{ key: 'preorder.' + key, label, value }];
      }),
    ],
    controls: entriesOf(header.controls),
    rates: entriesOf(header.rates),
    pcbSpec: entriesOf(edits.pcb_spec_inputs),
  };
}
