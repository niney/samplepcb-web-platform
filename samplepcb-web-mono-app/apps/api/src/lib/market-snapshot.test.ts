import { describe, expect, it } from 'vitest';
import type { SpMarketBid, SpMarketProject } from '@prisma/client';
import { buildMarketRequestSnapshot, requestSnapshotCapturedAt } from './market-snapshot';

const devReview = {
  version: 2,
  brief: { serviceAreas: ['circuit', 'firmware'], answers: [{ code: 'stage', choices: ['spec'] }] },
  summary: '제어 시스템 회로·펌웨어 개발',
  requirements: [],
  diagram: {
    columns: { inputs: '입력', board: '메인 보드', outputs: '출력·연동' },
    inputs: [],
    board: { label: '메인 컨트롤러', detail: '', chips: [] },
    outputs: [],
    linkIn: '',
    linkOut: '',
    notes: { flow: '', design: '', extension: '' },
  },
  areas: [
    { area: 'circuit', summary: '', spec: [], observations: [] },
    { area: 'firmware', summary: '', spec: [], observations: [] },
  ],
  openQuestions: [],
  checks: [],
  meta: {
    jobId: 'job-1', model: 'm', promptVersion: 'dev-review.v2', inputHash: 'h',
    generatedAt: '2026-09-02T00:00:00.000Z', attachmentFiles: [],
  },
};

const project = {
  id: 7n,
  title: '제어 시스템 개발',
  requestType: 'system',
  serviceAreas: ['circuit', 'firmware'],
  categories: ['mcu'],
  cadTools: ['kicad'],
  description: '제어 시스템의 회로와 펌웨어를 함께 개발합니다.',
  devReview,
  ndaRequired: true,
  budgetRange: 'r700_1500',
  startHopeDate: null,
  dueHopeDate: null,
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
  it('의뢰·AI 사전 검토서·채택 견적을 JSON 안전값으로 고정한다', () => {
    const capturedAt = new Date('2026-07-15T09:00:00Z');
    const snapshot = buildMarketRequestSnapshot(project, bid, capturedAt);
    expect(snapshot.request.projectId).toBe(7);
    expect(snapshot.request.devReview?.summary).toBe('제어 시스템 회로·펌웨어 개발');
    expect(snapshot.selectedBid).toMatchObject({ bidId: 11, expertId: 3, amount: 12_000_000 });
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    expect(requestSnapshotCapturedAt(snapshot)).toBe(capturedAt.toISOString());
  });

  it('검토서 없는 의뢰는 null 로 굳는다', () => {
    const snapshot = buildMarketRequestSnapshot({ ...project, devReview: null }, bid, new Date(0));
    expect(snapshot.request.devReview).toBeNull();
  });

  // 옛 스냅샷(4산출물 시대)은 devReview 키가 없고 폐기된 AI 키를 갖고 있다. 캡처 시각
  // 조회가 계속 살아 있어야 계약 화면이 무너지지 않는다(zod strip + default(null)).
  it('옛 스냅샷도 계속 파싱된다 — 캡처 시각은 유지, devReview 는 null', () => {
    const legacy = {
      version: 1,
      capturedAt: '2026-07-01T00:00:00.000Z',
      request: {
        projectId: 1, title: 'T', requestType: 'individual', serviceAreas: ['circuit'],
        categories: [], cadTools: [], description: 'D',
        diagramHtml: '<svg />', diagramSpec: '{"project":{}}', rocMd: 'ROC',
        postings: null, interviewAnswers: [{ code: 'stage', answer: '명세 보유' }],
        aiGenerationMetaJson: '{"version":1}',
        ndaRequired: true, budgetRange: 'r700_1500',
        startHopeDate: null, dueHopeDate: null,
        bidDeadlineAt: '2026-07-31T14:59:59.000Z', method: 'open', targetExpertId: null,
      },
      selectedBid: {
        bidId: 11, expertId: 3, expertMbId: 'expert-1', amount: 1, durationDays: 1,
        warranty: null, message: 'm',
      },
    };
    expect(requestSnapshotCapturedAt(legacy)).toBe('2026-07-01T00:00:00.000Z');
  });
});
