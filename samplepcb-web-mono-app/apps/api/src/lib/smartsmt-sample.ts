import { createHash } from 'node:crypto';
import type { SmartsmtFilePart } from '@sp/api-contract';

// SmartSMT 견적서 **가짜 견본** — 「견적서 전송 양식 0.3」의 칸 표와 예시 값으로 짠 것이다.
// SmartSMT 가 실제로 보낸 견적서가 아니다. 실제 견본을 받으면(문서 §6-1) 이 파일을 그것에 맞춘다.
// 쓰는 곳: 보내는 쪽 흉내 스크립트(scripts/smartsmt-send-sample.ts)와 수신 테스트.
//
// `files` · `user_edits` 가 JSON 어디에 놓이는지는 문서에 없다 — 여기서는 머리(header) 안에 두었다.

export interface SmartsmtSampleFile {
  part: SmartsmtFilePart;
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
  for (const file of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.part}"; filename="${file.filename}"\r\nContent-Type: ${file.mimetype}\r\n\r\n`,
    ));
    chunks.push(file.buffer, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}
