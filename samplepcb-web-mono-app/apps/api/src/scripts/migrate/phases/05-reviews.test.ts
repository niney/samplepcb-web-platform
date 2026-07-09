import { describe, expect, it } from 'vitest';
import type { SpReview } from '@prisma/client';
import type { LegacyRow } from '../../../lib/legacy-db';
import {
  resolveReviewQuoteId,
  reviewDiffers,
  toReviewInput,
  type ReviewLineRef,
} from './05-reviews';
import { uuidV5 } from '../lib/util';

const idx = (entries: Record<string, ReviewLineRef[]>): Map<string, ReviewLineRef[]> =>
  new Map(Object.entries(entries));

describe('resolveReviewQuoteId — 후기→프로젝트 귀속 결정 규칙', () => {
  it('단일 라인: quoteId = uuidV5("od:ct"), 02-shop 산식과 동일', () => {
    const m = resolveReviewQuoteId('IT1', 'kim@x.com', idx({ IT1: [{ odId: 'OD1', ctId: 42, mbId: 'kim@x.com' }] }));
    expect(m.quoteId).toBe(uuidV5('OD1:42'));
    expect(m.ambiguous).toBe(false);
  });

  it('1:N — mb_id 일치 라인 우선(작성자=주문자)', () => {
    const m = resolveReviewQuoteId(
      'IT1',
      'kim@x.com',
      idx({
        IT1: [
          { odId: 'OD1', ctId: 10, mbId: 'lee@x.com' },
          { odId: 'OD2', ctId: 20, mbId: 'kim@x.com' },
        ],
      }),
    );
    expect(m.quoteId).toBe(uuidV5('OD2:20'));
    expect(m.ambiguous).toBe(true); // 라인 다수 → 리포트 플래그
  });

  it('1:N — mb_id 일치 다수면 (od,ct) 오름차순 첫 라인(로드 정렬 전제)', () => {
    const m = resolveReviewQuoteId(
      'IT1',
      'kim@x.com',
      idx({
        IT1: [
          { odId: 'OD1', ctId: 10, mbId: 'kim@x.com' },
          { odId: 'OD3', ctId: 30, mbId: 'kim@x.com' },
        ],
      }),
    );
    expect(m.quoteId).toBe(uuidV5('OD1:10'));
  });

  it('mb_id 불일치뿐이면 전체 첫 라인으로 폴백', () => {
    const m = resolveReviewQuoteId('IT1', 'nobody@x.com', idx({ IT1: [{ odId: 'OD9', ctId: 5, mbId: 'lee@x.com' }] }));
    expect(m.quoteId).toBe(uuidV5('OD9:5'));
  });

  it('라인 없음 → quoteId null(귀속 실패, 저장은 유지)', () => {
    expect(resolveReviewQuoteId('MISS', 'kim@x.com', idx({})).quoteId).toBeNull();
  });
});

const legacyReview = (over: Partial<LegacyRow> = {}): LegacyRow => ({
  is_id: 65,
  it_id: 'IT1',
  mb_id: 'kim@x.com',
  is_name: '홍길동',
  is_password: '*FDE51BC0819804ABC', // 회원 비번 해시 사본 — 절대 이관 금지
  is_score: 5,
  is_subject: '만족합니다',
  is_content: '품질 좋아요',
  is_time: '2026-06-16 16:38:07',
  is_ip: '1.2.3.4',
  is_confirm: 1,
  is_reply_subject: '',
  is_reply_content: '',
  is_reply_name: '',
  ...over,
});

describe('toReviewInput — 필드 변환·보안', () => {
  it('is_password 는 어떤 필드·legacyJson 에도 실리지 않는다', () => {
    const out = toReviewInput(legacyReview(), { quoteId: 'q', specId: 1n });
    const serialized = JSON.stringify(out, (_k: string, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(serialized).not.toContain('FDE51BC0819804');
    expect(out.legacyJson).toEqual({ is_name: '홍길동', is_ip: '1.2.3.4' });
  });

  it('repliedAt 은 항상 null(레거시 답변시각 컬럼 부재)', () => {
    const out = toReviewInput(legacyReview({ is_reply_content: '답변드립니다', is_reply_name: '관리자' }), {
      quoteId: 'q',
      specId: 1n,
    });
    expect(out.repliedAt).toBeNull();
    expect(out.replyContent).toBe('답변드립니다');
    expect(out.replyName).toBe('관리자');
  });

  it('isConfirm·score·writeDate 보존, 빈 문자열은 null', () => {
    const out = toReviewInput(legacyReview({ is_confirm: 0, is_subject: '' }), { quoteId: null, specId: null });
    expect(out.isConfirm).toBe(0);
    expect(out.score).toBe(5);
    expect(out.subject).toBeNull();
    expect(out.writeDate.getTime()).toBe(new Date('2026-06-16 16:38:07+09:00').getTime());
    expect(out.quoteId).toBeNull();
    expect(out.legacyItId).toBe('IT1');
  });
});

const existingRow = (over: Partial<SpReview> = {}): SpReview => ({
  id: 1n,
  legacyIsId: 65,
  mbId: 'kim@x.com',
  quoteId: 'q',
  specId: 1n,
  score: 5,
  subject: '만족합니다',
  content: '품질 좋아요',
  isConfirm: 1,
  replySubject: null,
  replyContent: null,
  replyName: null,
  repliedAt: null,
  writeDate: new Date('2026-06-16 16:38:07+09:00'),
  legacyItId: 'IT1',
  legacyJson: { is_name: '홍길동', is_ip: '1.2.3.4' },
  createdAt: new Date('2026-07-09T00:00:00Z'),
  updatedAt: new Date('2026-07-09T00:00:00Z'),
  ...over,
});

describe('reviewDiffers — sync no-op 판정', () => {
  it('동일 입력이면 무변경(false) — legacyJson 키 순서 무관', () => {
    const input = toReviewInput(legacyReview(), { quoteId: 'q', specId: 1n });
    expect(reviewDiffers(existingRow(), input)).toBe(false);
  });

  it('별점 변경 감지', () => {
    const input = toReviewInput(legacyReview({ is_score: 2 }), { quoteId: 'q', specId: 1n });
    expect(reviewDiffers(existingRow(), input)).toBe(true);
  });

  it('관리자 답변 추가 감지', () => {
    const input = toReviewInput(legacyReview({ is_reply_content: '답변', is_reply_name: '관리자' }), {
      quoteId: 'q',
      specId: 1n,
    });
    expect(reviewDiffers(existingRow(), input)).toBe(true);
  });

  it('귀속(specId) 변경 감지', () => {
    const input = toReviewInput(legacyReview(), { quoteId: 'q2', specId: 2n });
    expect(reviewDiffers(existingRow(), input)).toBe(true);
  });
});
