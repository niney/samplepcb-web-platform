import { createHash } from 'node:crypto';

// SmartSMT 견적서 **가짜 견본** — 「견적서 전송 양식 0.3」의 칸 표와 예시 값으로 짠 것이다.
// SmartSMT 가 실제로 보낸 견적서가 아니다. `review: true` 는 2026-11-18 에 실제로 받은 견적서(envelope_version 9)의
// **모양**을 따른다 — 확정 금액은 전부 미정(null), 추정 금액(estimated_*)이 따로, 수량 칸 이름이 …_set_qty.
// 값은 지어낸 것이다(실제 견적서는 고객 자료라 리포에 두지 않는다).
// 쓰는 곳: 보내는 쪽 흉내 스크립트(scripts/smartsmt-send-sample.ts)와 수신 테스트.
//
// `files` · `user_edits` 가 JSON 어디에 놓이는지는 문서에 없다 — 여기서는 머리(header) 안에 두었다.

export interface SmartsmtSampleFile {
  /** multipart 파트 이름 — 아는 세 파트 말고도 규칙에 맞는 이름이면 받는다. */
  part: string;
  filename: string;
  mimetype: string;
  buffer: Buffer;
}

export interface SmartsmtSampleOptions {
  orderId?: string;
  quoteId?: string;
  /** REVIEW_REQUIRED 로 만들면 검토 필요 견적이 된다. */
  quoteStatus?: 'CALCULATED' | 'REVIEW_REQUIRED';
  /** true 면 PCB 블록이 합계를 막은 견적(최종 금액 null). */
  blocked?: boolean;
  /** true 면 실제로 받은 모양(판 9)의 검토 필요 견적 — 확정 금액 미정 + 추정 금액 + 부품·배송·SMT 작업비가 합계를 막음. */
  review?: boolean;
  ownerMbId?: string;
  ownerName?: string;
  madeAt?: string;
  files?: readonly SmartsmtSampleFile[];
}

export const sampleFiles = (): SmartsmtSampleFile[] => [
  { part: 'gerber_archive', filename: 'sample-board.zip', mimetype: 'application/octet-stream', buffer: Buffer.from('PK-sample-gerber-archive') },
  { part: 'bom', filename: 'sample-bom.csv', mimetype: 'application/octet-stream', buffer: Buffer.from('REF,MPN,QTY\nR1,RC0603FR-0710KL,1\n') },
  { part: 'cpl', filename: 'sample-cpl.csv', mimetype: 'application/octet-stream', buffer: Buffer.from('REF,X,Y,ROT,SIDE\nR1,10.0,20.0,90,TOP\n') },
];

export function buildSampleEnvelope(options: SmartsmtSampleOptions = {}): Record<string, unknown> {
  const envelope = buildBaseEnvelope(options);
  return options.review === true ? asReviewEnvelope(envelope, options) : envelope;
}

/** 판 9 의 검토 필요 견적으로 바꾼다 — 실제로 받은 견적서의 칸 구성. */
function asReviewEnvelope(envelope: Record<string, unknown>, options: SmartsmtSampleOptions): Record<string, unknown> {
  const header = envelope.header as Record<string, unknown>;
  const quote = envelope.quote as Record<string, unknown>;
  const ownerMbId = options.ownerMbId ?? 'hong123';
  const ownerName = options.ownerName ?? '홍길동';
  return {
    ...envelope,
    envelope_version: '9',
    header: {
      ...header,
      policy_is_default: true,
      pricing_mode: 'SAMPLE',
      feeder_slots: null,
      cut_tape_types: null,
      hand_solder_pins: null,
      packing_mode: 'STANDARD',
      processes: ['pcb', 'parts', 'stencil', 'smt'],
      quantities: { make_set_qty: 5, spare_set_qty: 0, order_type: 'sample', total_set_qty: 5, price_set_qty: 5 },
      quote_request: {
        text: '[긴급 제작 요청]\n긴급 제작 테스트입니다',
        mb_id: ownerMbId,
        mb_name: ownerName,
        updated_at: '2026-11-18T08:10:31.354851+00:00',
      },
      due_date: '2026-11-20',
      user_edits: {
        owner_mb_id: ownerMbId,
        owner_name: ownerName,
        pcb_spec_inputs: { layers: 4, thickness: 1.6, surfaceFinish: 'HASL(lead)', solderMask: 'green' },
        preorder: { region: null, extras: [], extra_note: '', parts_form: 'reel', due_date: '2026-11-20', rush: true },
      },
    },
    quote: {
      ...quote,
      quote_status: 'REVIEW_REQUIRED',
      quantity: 5,
      policy_is_default: true,
      unknown_lines: ['SMT-P03'],
      known_subtotal: 303780,
      estimated_total: 396979,
      estimated_supply_price: 360890,
      estimated_indirect_cost: 24302,
      estimated_profit: 32808,
      estimated_vat: 36089,
      direct_cost: null,
      indirect_cost: null,
      profit: null,
      supply_price: null,
      vat: null,
      total: null,
      lines: [
        ...(quote.lines as unknown[]),
        {
          code: 'SMT-P03', item: '피더 작업비', group: 'PLACEMENT', basis: 'PER_SLOT', formula: '피더 칸 수가 오지 않음',
          amount: null, status: 'UNKNOWN_INPUT', count: null, count_unit: '슬롯', unit_price: 500, lot_once: true, lot_quantity: 1,
          per_pcba_amount: null, is_custom: false, supply: '', refs: [], breakdown: [], rate_key: 'prep.feeder_setup_per_slot',
        },
      ],
      subtotals: [
        { label: '메탈마스크', amount: 120000, known_amount: 120000, unknown_count: 0, codes: ['STN-01'] },
        { label: 'SMT', amount: null, known_amount: 183780, unknown_count: 1, codes: ['SMT-P03'] },
      ],
      integrated: {
        totals: {
          supply_price: null, vat: null, total: null,
          estimated_supply_price: 463250, estimated_vat: 46325, estimated_total: 509575, estimated_blocks: ['PCB', 'PARTS', 'DETAIL'],
        },
        blocked_by: ['PARTS', 'SHIPPING', 'DETAIL'],
        known: { sum: 390780, blocks: ['PCB', 'DETAIL'] },
        blocks: [
          {
            block: 'PCB', source: 'GERBEREYE', quote_ref: null, included: true, reason: null,
            amount: 87000, amount_currency: 'KRW', source_currency: null, source_qty: 5, source_qty_unit: '장',
            display_only_unit_price: 17400, request_status: 'DONE', valuation: 'CONFIRMED', completeness: 'COMPLETE',
            value_source: null, detail: {},
          },
          {
            block: 'PARTS', source: 'PARTSEYES', quote_ref: null, included: true, reason: 'QTY_UNVERIFIED',
            amount: 15360, amount_currency: 'KRW', source_currency: null, source_qty: 5, source_qty_unit: 'SET',
            display_only_unit_price: 3072, request_status: 'DONE', valuation: 'ESTIMATED', completeness: 'PARTIAL',
            value_source: null, detail: {},
          },
          {
            block: 'SHIPPING', source: 'MANUAL', quote_ref: null, included: true, reason: 'MISSING_INPUT',
            amount: null, amount_currency: 'KRW', source_currency: null, source_qty: null, source_qty_unit: '',
            display_only_unit_price: null, request_status: 'WAITING_INPUT', valuation: 'NA', completeness: 'NA',
            value_source: null, detail: {},
          },
        ],
      },
    },
  };
}

function buildBaseEnvelope(options: SmartsmtSampleOptions): Record<string, unknown> {
  const blocked = options.blocked === true;
  const files = options.files ?? sampleFiles();
  return {
    kind: 'smartsmt.quote',
    envelope_version: '3',
    header: {
      quote_id: options.quoteId ?? 'Q-123456-123456-123abc',
      order_id: options.orderId ?? '123456789abc',
      made_at: options.madeAt ?? '2026-10-20T16:36:32.603783+09:00',
      currency: 'KRW',
      fx_rate: null,
      fx_at: null,
      lang: 'ko',
      pricing_model_version: 'PRICING_V1',
      policy_version: '0.1v',
      catalog_version: '10',
      calculator_version: '1',
      policy_is_default: false,
      controls: { 'policy.vat_rate': 10, 'markup.indirect_cost_rate': 8, 'markup.profit_rate': 10 },
      rates: { 'stencil.fixed': 120000, 'prep.review': 40000, 'placement.chip_base': 58 },
      customs: [],
      disabled: [],
      volume_factor: 1.0,
      strategy: 'SAMPLE',
      order_scenario: 'NEW_OR_CHANGED',
      assembly_sides: 'DOUBLE',
      reflow_atmosphere: 'AIR',
      pricing_mode: 'AUTO',
      feeder_slots: 96,
      cut_tape_types: 0,
      fixture_quantity: 0,
      metal_mask_supply: 'TURNKEY',
      metal_mask_sets: 1,
      hand_solder_pins: 0,
      parts_supply: 'TURNKEY',
      processes: null,
      quantities: { set_qty: 1, panel_qty: 20, spare_qty: 0, order_type: 'sample', pcb_qty: 20, pcb_price_qty: 20, assembled_qty: 20 },
      quote_request: null,
      due_date: null,
      remark: '',
      remark_warn: '',
      files: files.map((file) => ({
        part: file.part,
        name: file.filename,
        bytes: file.buffer.length,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
      })),
      user_edits: {
        owner_mb_id: options.ownerMbId ?? 'hong123',
        owner_name: options.ownerName ?? '홍길동',
        memos: {},
      },
      labor_charge: { material_check: { seconds: 30, krw: 100 }, feeder_setup: { seconds: 120, krw: null }, placement: { seconds: 3, krw: 5 } },
    },
    quote: {
      quote_status: options.quoteStatus ?? 'CALCULATED',
      strategy: 'SAMPLE',
      quantity: 20,
      points_per_board: 24,
      total_points: 480,
      unknown_lines: [],
      unknown_controls: [],
      unknown_refs: [],
      blockers: [],
      policy_is_default: false,
      volume_factor: 1.0,
      known_subtotal: 798000,
      direct_cost: 798000,
      indirect_cost: 63840,
      profit: 86184,
      supply_price: 948024,
      vat: 94802,
      total: 1042826,
      lines: [
        {
          code: 'STN-01', item: '메탈마스크 제작', group: 'PREP', basis: 'PER_SET', formula: '120,000원 × 1 SET',
          amount: 120000, status: '', count: 1, count_unit: 'SET', unit_price: 120000, lot_once: true, lot_quantity: 1,
          per_board_amount: null, is_custom: false, supply: 'TURNKEY', refs: [], rate_key: 'stencil.fixed',
        },
      ],
      subtotals: [{ label: '생산 준비', amount: 120000, codes: ['STN-01'] }],
      input_warnings: [],
      integrated: {
        totals: blocked
          ? { supply_price: null, vat: null, total: null }
          : { supply_price: 1078393, vat: 107839, total: 1186232 },
        blocked_by: blocked ? ['PCB'] : [],
        known: { sum: 30000, blocks: ['SHIPPING'] },
        blocks: [
          {
            block: 'PCB', source: 'GERBEREYE', quote_ref: '623', included: true,
            amount: blocked ? null : 87000, amount_currency: 'KRW', source_currency: 'USD',
            request_status: 'DONE', valuation: 'ESTIMATED', completeness: 'COMPLETE',
            reason: blocked ? 'QTY_UNVERIFIED' : null, value_source: null, detail: {},
          },
        ],
      },
    },
    signature: null,
  };
}

/** 견적서 전송 양식의 multipart 본문을 만든다(envelope 는 application/json 값 파트 — 실제와 같은 모양). */
export function buildSampleMultipart(
  envelope: unknown,
  files: readonly SmartsmtSampleFile[],
  ids: { quoteId?: string; orderId?: string } = {},
  /** state — 작업 상태(JSON 글자). SmartSMT 처럼 application/json 값 파트로 싣는다. */
  extra: { state?: string } = {},
): { boundary: string; body: Buffer } {
  const boundary = '----smartsmtQuoteBoundary';
  const chunks: Buffer[] = [];
  const text = (name: string, contentType: string, value: string): void => {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\nContent-Type: ${contentType}\r\n\r\n${value}\r\n`,
    ));
  };
  text('envelope', 'application/json; charset=utf-8', typeof envelope === 'string' ? envelope : JSON.stringify(envelope));
  if (ids.quoteId !== undefined) text('quote_id', 'text/plain; charset=utf-8', ids.quoteId);
  if (ids.orderId !== undefined) text('order_id', 'text/plain; charset=utf-8', ids.orderId);
  if (extra.state !== undefined) text('state', 'application/json; charset=utf-8', extra.state);
  for (const file of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.part}"; filename="${file.filename}"\r\nContent-Type: ${file.mimetype}\r\n\r\n`,
    ));
    chunks.push(file.buffer, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}
