import { describe, expect, it } from 'vitest';
import { mergeRequestedItemIds } from './bom-rfq';
import { buildBomRfqScopeAddedEmail } from './rfq-email';

// 행 추가(§6.13 개정) — 이미 보낸 미회신 견적요청에 행을 더하는 합집합 규칙.

const SCOPE = ['1', '2', '3', '4', '5'];

describe('mergeRequestedItemIds', () => {
  it('기존 범위에 새 행만 더하고 순서는 기존 → 추가', () => {
    expect(mergeRequestedItemIds(['1', '2'], ['2', '4'], SCOPE)).toEqual({ next: ['1', '2', '4'], addedCount: 1 });
  });

  it('더할 행이 없으면 그대로 · addedCount 0', () => {
    expect(mergeRequestedItemIds(['1', '2'], ['1'], SCOPE)).toEqual({ next: ['1', '2'], addedCount: 0 });
  });

  it('이미 전체(null)면 더할 것이 없다', () => {
    expect(mergeRequestedItemIds(null, ['1'], SCOPE)).toEqual({ next: null, addedCount: 0 });
  });

  it('adding=null 은 전체 — 나머지 행이 모두 더해지고 null 로 정규화', () => {
    expect(mergeRequestedItemIds(['1', '2'], null, SCOPE)).toEqual({ next: null, addedCount: 3 });
  });

  it('합집합이 scope 를 다 덮으면 null(이후 행 추가 자동 포함)', () => {
    expect(mergeRequestedItemIds(['1', '2', '3'], ['4', '5'], SCOPE)).toEqual({ next: null, addedCount: 2 });
  });

  it('scope 에서 빠진 옛 id 는 지우지 않고 남긴다 — 행이 다시 포함되면 원래 요청으로 돌아온다', () => {
    expect(mergeRequestedItemIds(['1', '99'], ['2'], SCOPE)).toEqual({ next: ['1', '99', '2'], addedCount: 1 });
  });

  it('추가 목록의 중복은 한 번만 센다', () => {
    expect(mergeRequestedItemIds(['1'], ['3', '3'], SCOPE)).toEqual({ next: ['1', '3'], addedCount: 1 });
  });
});

describe('buildBomRfqScopeAddedEmail', () => {
  it('제목에 추가·전체 품목 수, 본문 동적 값은 이스케이프', () => {
    const mail = buildBomRfqScopeAddedEmail({
      partnerName: '<협력>',
      quoteTitle: '견적 A',
      addedCount: 3,
      itemCount: 12,
      magicUrl: 'https://example.test/app/rfq-reply/abc',
    });
    expect(mail.subject).toBe('[샘플피씨비] 견적요청 품목 추가 — 견적 A (+3개, 총 12개)');
    expect(mail.html).toContain('&lt;협력&gt;');
    expect(mail.html).toContain('가입 없이 바로 회신하기');
    expect(mail.html).not.toContain('<협력>');
  });
});
