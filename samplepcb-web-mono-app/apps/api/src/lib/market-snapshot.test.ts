import { describe, expect, it } from 'vitest';
import type { SpMarketBid, SpMarketProject } from '@prisma/client';
import { buildMarketRequestSnapshot, requestSnapshotCapturedAt } from './market-snapshot';

const project = {
  id: 7n,
  title: '제어 시스템 개발',
  requestType: 'system',
  serviceAreas: ['circuit', 'firmware'],
  categories: ['mcu'],
  cadTools: ['kicad'],
  description: '제어 시스템의 회로와 펌웨어를 함께 개발합니다.',
  diagramHtml: '<svg />',
  diagramSpec: '{"project":{}}',
  rocMd: 'ROC',
  interviewAnswers: [{ code: 'stage', answer: '명세 보유' }],
  interviewAnswersSharedAt: new Date('2026-07-15T00:00:00Z'),
  postings: null,
  aiGenerationMeta: { version: 1 },
  ndaRequired: true,
  budgetRange: 'r700_1500',
  startHopeDate: '2026-08-01',
  dueHopeDate: '2026-10-31',
  bidDeadlineAt: new Date('2026-07-31T14:59:59Z'),
  method: 'open',
  targetExpertId: null,
} as unknown as SpMarketProject;

const bid = {
  id: 11n,
  expertId: 3n,
  mbId: 'expert-1',
  amount: 12_000_000,
  durationDays: 60,
  warranty: '납품 후 3개월',
  message: '제안 내용',
} as SpMarketBid;

describe('계약 시점 의뢰 스냅샷', () => {
  it('의뢰·AI 산출물·공개 동의 답변·채택 견적을 JSON 안전값으로 고정한다', () => {
    const capturedAt = new Date('2026-07-15T09:00:00Z');
    const snapshot = buildMarketRequestSnapshot(project, bid, capturedAt);
    expect(snapshot.request.projectId).toBe(7);
    expect(snapshot.request.interviewAnswers).toEqual([{ code: 'stage', answer: '명세 보유' }]);
    expect(snapshot.selectedBid).toMatchObject({ bidId: 11, expertId: 3, amount: 12_000_000 });
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    expect(requestSnapshotCapturedAt(snapshot)).toBe(capturedAt.toISOString());
  });

  it('공개 동의가 없는 기존 의뢰 답변은 계약 스냅샷에도 넣지 않는다', () => {
    const snapshot = buildMarketRequestSnapshot(
      { ...project, interviewAnswersSharedAt: null },
      bid,
      new Date(0),
    );
    expect(snapshot.request.interviewAnswers).toBeNull();
  });
});
