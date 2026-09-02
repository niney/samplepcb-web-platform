import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketDevReviewType } from '@sp/api-contract';

// sp_ai_job(DB) 저장소 — 재사용 창·소유 경계는 prisma where 절이 강제하므로 목으로 그
// 질의 조건을 검사하고, 파손 저장분(resultJson)이 조용히 통과하지 않는지를 확인한다.

const prismaMocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('../prisma', () => ({
  prisma: {
    spAiJob: {
      findFirst: prismaMocks.findFirst,
      findUnique: prismaMocks.findUnique,
      create: prismaMocks.create,
      updateMany: prismaMocks.updateMany,
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { findReusableAiJob, finishAiJob, getAiJob } from './jobs';

const review: MarketDevReviewType = {
  version: 2,
  brief: { serviceAreas: ['circuit'], answers: [{ code: 'stage', choices: ['idea'] }] },
  summary: '테스트 검토서',
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
  areas: [{ area: 'circuit', summary: '', spec: [] }],
  openQuestions: [],
  meta: {
    jobId: 'job-1', model: 'm', promptVersion: 'dev-review.v2', inputHash: 'h',
    generatedAt: '2026-09-02T00:00:00.000Z', attachmentFiles: [],
  },
};

const row = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  useCase: 'market.dev-review',
  mbId: 'owner',
  status: 'done',
  stage: null,
  model: 'm',
  promptVersion: 'dev-review.v2',
  inputHash: 'h',
  resultJson: JSON.stringify(review),
  error: null,
  startedAt: new Date('2026-08-28T00:00:00Z'),
  finishedAt: new Date('2026-08-28T00:01:00Z'),
  ...over,
});

describe('AI 잡 저장소(sp_ai_job)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('완료 잡의 검토서를 파싱해 돌려준다', async () => {
    prismaMocks.findUnique.mockResolvedValue(row());
    const job = await getAiJob('job-1');
    expect(job?.status).toBe('done');
    expect(job?.review?.summary).toBe('테스트 검토서');
  });

  it('파손된 저장분은 done 이어도 error 로 취급한다', async () => {
    prismaMocks.findUnique.mockResolvedValue(row({ resultJson: '{"version":9}' }));
    const job = await getAiJob('job-1');
    expect(job?.status).toBe('error');
    expect(job?.review).toBeNull();
    expect(job?.error).toBe('RESULT_CORRUPTED');
  });

  it('재사용은 회원·모델·프롬프트·입력·상태·시간창을 전부 건다', async () => {
    prismaMocks.findFirst.mockResolvedValue(row());
    const found = await findReusableAiJob('market.dev-review', 'owner', {
      model: 'm', promptVersion: 'dev-review.v2', inputHash: 'h',
    });
    expect(found?.id).toBe('job-1');
    const args = prismaMocks.findFirst.mock.calls[0]?.[0] as
      | { where: Record<string, unknown> }
      | undefined;
    const where = args?.where ?? {};
    expect(where).toMatchObject({
      useCase: 'market.dev-review', mbId: 'owner', model: 'm',
      promptVersion: 'dev-review.v2', inputHash: 'h', status: 'done',
    });
    expect(where.finishedAt).toHaveProperty('gte');
  });

  it('파손 저장분은 캐시로 재사용하지 않는다(비 JSON 도 500 이 아니다)', async () => {
    prismaMocks.findFirst.mockResolvedValue(row({ resultJson: 'not json at all{' }));
    await expect(
      findReusableAiJob('market.dev-review', 'owner', {
        model: 'm', promptVersion: 'dev-review.v2', inputHash: 'h',
      }),
    ).resolves.toBeNull();
  });

  it('오류 코드는 100자로 잘라 저장한다(VARCHAR(100) 방어)', async () => {
    prismaMocks.updateMany.mockResolvedValue({ count: 1 });
    await finishAiJob('job-1', { error: 'X'.repeat(300) });
    const args = prismaMocks.updateMany.mock.calls[0]?.[0] as
      | { data: { error: string } }
      | undefined;
    expect(args?.data.error).toHaveLength(100);
  });
});
