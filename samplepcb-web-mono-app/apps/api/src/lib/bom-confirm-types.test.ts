// 부품 확인 요청 유형 확장(D44, docs/SMARTBOM_PARTNER_RFQ.md §6.40) — 계약 규칙 단위 시험.
// 요청 본체(bom-confirm.ts)는 DB 에 묶여 있어 e2e 여정이 맡고, 여기서는 유형·선택지 사전과 작성 입력 검증을 본다.
import { describe, expect, it } from 'vitest';
import {
  AdminBomConfirmCreateBody,
  AdminBomConfirmIssueInput,
  BOM_CONFIRM_ISSUE_TYPES,
  BOM_CONFIRM_TYPE_OPTION_KINDS,
  BomConfirmEvidence,
  BomConfirmOption,
  bomConfirmKindChangesItem,
  bomConfirmKindNeedsPayment,
  bomConfirmOptionDefaultTitle,
  isBomConfirmNoticeType,
  type AdminBomConfirmOptionInputType,
  type BomConfirmIssueTypeType,
} from '@sp/api-contract';

const RESTOCK = { expectedOn: '2026-10-20', basis: '공급사 입고 예정 공지' };
const REPLACEMENT = { source: 'rfq' as const, rfqItemId: '7' };

/** 유형 프리셋 그대로의 선택지 입력(필수 부속 값까지 채움). */
function presetOptions(issueType: BomConfirmIssueTypeType): AdminBomConfirmOptionInputType[] {
  return BOM_CONFIRM_TYPE_OPTION_KINDS[issueType].map((kind): AdminBomConfirmOptionInputType => ({
    kind,
    priceDelta: kind === 'customer_supply' || kind === 'notice' ? -1000 : 0,
    ...(kind === 'substitute' || kind === 'alt_supplier' ? { replacement: REPLACEMENT } : {}),
    ...(kind === 'moq_purchase' ? { moqOrderQty: 50 } : {}),
    ...(kind === 'wait_restock' ? { restock: RESTOCK } : {}),
  }));
}

function issueInput(issueType: BomConfirmIssueTypeType, overrides: Record<string, unknown> = {}) {
  return {
    quoteItemId: '11',
    issueType,
    description: '확인이 필요한 부품입니다.',
    observation: { unitPriceKrw: 1200 },
    options: presetOptions(issueType).map((option) =>
      issueType === 'eol_notice' ? { ...option, priceDelta: 0 } : option),
    ...overrides,
  };
}

describe('유형·선택지 사전(D44)', () => {
  it('11개 유형 모두 프리셋이 있고, 알림 2종만 안내 하나다', () => {
    expect(BOM_CONFIRM_ISSUE_TYPES).toHaveLength(11);
    for (const type of BOM_CONFIRM_ISSUE_TYPES) {
      const kinds = BOM_CONFIRM_TYPE_OPTION_KINDS[type];
      if (isBomConfirmNoticeType(type)) expect(kinds).toEqual(['notice']);
      else {
        expect(kinds.length).toBeGreaterThanOrEqual(3);
        expect(kinds).not.toContain('notice');
        // 거절 대비 공통 선택지 — 모든 질문 유형에 고객 사급(가격에서 빼기)이 있다.
        expect(kinds).toContain('customer_supply');
      }
    }
    expect(BOM_CONFIRM_ISSUE_TYPES.filter(isBomConfirmNoticeType)).toEqual(['price_decrease', 'eol_notice']);
  });

  it('같은 종류라도 유형에 따라 고객에게 보이는 제목이 다르다', () => {
    expect(bomConfirmOptionDefaultTitle('stock_out', 'wait_restock')).toBe('입고 대기');
    expect(bomConfirmOptionDefaultTitle('quality_issue', 'wait_restock')).toBe('교체품 기다리기');
    expect(bomConfirmOptionDefaultTitle('part_change', 'substitute')).toBe('바뀐 부품으로 진행');
    expect(bomConfirmOptionDefaultTitle('unofficial_source', 'alt_supplier')).toBe('비공식 공급처에서 구매');
    expect(bomConfirmOptionDefaultTitle('moq_increase', 'customer_supply')).toBe('고객 사급(해당 부품 전량)');
    expect(bomConfirmOptionDefaultTitle('price_increase', 'price_accept')).toBe('오른 가격으로 구매');
    expect(bomConfirmOptionDefaultTitle('manufacturing_info', 'accept_as_is')).toBe('그대로 진행');
    expect(bomConfirmOptionDefaultTitle('price_decrease', 'notice')).toBe('차액 환불');
  });

  it('발주서에 든 품목에는 품목을 바꾸지 않는 선택지만 적용된다 — 산 뒤 유형이 이 길을 쓴다', () => {
    for (const kind of ['substitute', 'alt_supplier', 'moq_purchase', 'customer_supply'] as const) {
      expect(bomConfirmKindChangesItem(kind)).toBe(true);
      expect(bomConfirmKindNeedsPayment(kind)).toBe(true);
    }
    for (const kind of ['wait_restock', 'accept_as_is', 'consult', 'notice'] as const) {
      expect(bomConfirmKindChangesItem(kind)).toBe(false);
      expect(bomConfirmKindNeedsPayment(kind)).toBe(false);
    }
    // 같은 부품을 오른 가격으로 — 품목은 그대로지만 먼저 사고 돈을 못 받는 일을 막는다(D43-12).
    expect(bomConfirmKindChangesItem('price_accept')).toBe(false);
    expect(bomConfirmKindNeedsPayment('price_accept')).toBe(true);
  });
});

describe('작성 입력 검증(D44)', () => {
  it('모든 유형이 프리셋 그대로 통과한다', () => {
    for (const type of BOM_CONFIRM_ISSUE_TYPES) {
      const parsed = AdminBomConfirmIssueInput.safeParse(issueInput(type));
      expect(parsed.success, `${type}: ${parsed.success ? '' : parsed.error.issues[0]?.message ?? ''}`).toBe(true);
    }
  });

  it('가격 인상·인하는 지금 공급 단가가 없으면 막는다', () => {
    for (const type of ['price_increase', 'price_decrease'] as const) {
      const parsed = AdminBomConfirmIssueInput.safeParse(issueInput(type, { observation: {} }));
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe('지금 공급 단가를 입력해 주세요.');
    }
  });

  it('유형에 없는 선택지는 막는다 — 품질 문제에 그대로 진행은 없다(가품 의심은 쓰지 않는다)', () => {
    const parsed = AdminBomConfirmIssueInput.safeParse(issueInput('quality_issue', {
      options: [{ kind: 'accept_as_is', priceDelta: 0 }],
    }));
    expect(parsed.success).toBe(false);
  });

  it('알림은 안내 하나뿐이고, 가격 인하는 환불만·단종은 금액 없음', () => {
    expect(AdminBomConfirmIssueInput.safeParse(issueInput('price_decrease', {
      options: [{ kind: 'notice', priceDelta: 500 }],
    })).success).toBe(false);
    expect(AdminBomConfirmIssueInput.safeParse(issueInput('eol_notice', {
      options: [{ kind: 'notice', priceDelta: -500 }],
    })).success).toBe(false);
    expect(AdminBomConfirmIssueInput.safeParse(issueInput('eol_notice', {
      options: [{ kind: 'notice', priceDelta: 0 }, { kind: 'notice', priceDelta: 0 }],
    })).success).toBe(false);
  });

  it('알림과 질문은 한 요청에 섞지 않는다', () => {
    const mixed = AdminBomConfirmCreateBody.safeParse({
      issues: [issueInput('stock_out'), { ...issueInput('eol_notice'), quoteItemId: '12' }],
    });
    expect(mixed.success).toBe(false);
    const notices = AdminBomConfirmCreateBody.safeParse({
      issues: [issueInput('price_decrease'), { ...issueInput('eol_notice'), quoteItemId: '12' }],
    });
    expect(notices.success).toBe(true);
  });
});

describe('D43 박제와의 호환', () => {
  it('D44 이전에 저장된 선택지·근거도 그대로 읽힌다(가격 비교·지금 단가는 null)', () => {
    const legacyOption = BomConfirmOption.parse({
      code: 'A',
      kind: 'wait_restock',
      title: '입고 대기',
      detail: null,
      priceDelta: 0,
      referenceDelta: 0,
      replacement: null,
      moq: null,
      restock: { expectedOn: '2026-10-20', basis: '공지', maxWaitOn: null, splitAllowed: false, splitShippingFee: 0 },
    });
    expect(legacyOption.price).toBeNull();
    const legacyEvidence = BomConfirmEvidence.parse({
      part: {
        mpn: 'ABC',
        manufacturerName: null,
        description: null,
        packageCode: null,
        neededQty: 1,
        orderQty: 1,
        unitPriceKrw: 100,
        lineTotalKrw: 100,
        supplierLabel: null,
        location: null,
      },
      observation: { checkedAt: '2026-09-30T00:00:00.000Z', sourceLabel: null, stock: 0, moq: null, leadTime: null, note: null },
    });
    expect(legacyEvidence.observation.unitPriceKrw).toBeNull();
  });
});
