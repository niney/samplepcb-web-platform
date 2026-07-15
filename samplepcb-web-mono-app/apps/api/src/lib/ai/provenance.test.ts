import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AiStructurizeRunBody,
  MarketProjectCreatePayload,
} from '@sp/api-contract';
import { createAiJob, finishAiJob, hashAiInput, hashAiText } from './jobs';
import {
  buildAiGenerationMeta,
  invalidateAiGenerationMeta,
  toAiProvenance,
} from './provenance';

const spec = JSON.stringify({
  project: { name: 'Inventory', summary: '재고 관리', stage: 'spec', service_type: 'full' },
  groups: [{ id: 'application', label: 'APPLICATION' }],
  blocks: [{ id: 'api', group: 'application', type: 'api', label: 'Inventory API', status: 'confirmed' }],
  connections: [],
  constraints: [],
  feature_highlights: [],
  questions_missing: [],
});

const basePayload = {
  title: '재고 관리 서비스 개발',
  requestType: 'system' as const,
  serviceAreas: ['app', 'server'] as const,
  categories: [],
  cadTools: [],
  description: '모바일 재고 관리 앱과 API 서버를 함께 개발합니다.',
  diagramSpec: spec,
  diagramHtml: '<svg>rendered</svg>',
  interviewAnswers: [{ code: 'stage', answer: '요구사항·기능 명세 보유' }],
  ndaRequired: true,
  budgetRange: 'r700_1500' as const,
  startHopeDate: '2026-08-01',
  dueHopeDate: '2026-10-31',
  deadline: { days: 14 as const },
  method: 'open' as const,
};

describe('AI 프로젝트 산출물 provenance', () => {
  it('소유 잡의 입력·출력이 모두 일치할 때만 AI 생성본으로 증명한다', () => {
    const mbId = `provenance-${randomUUID()}`;
    const input = AiStructurizeRunBody.parse({
      title: basePayload.title,
      serviceAreas: basePayload.serviceAreas,
      categories: basePayload.categories,
      cadTools: basePayload.cadTools,
      description: basePayload.description,
      answers: basePayload.interviewAnswers,
    });
    const job = createAiJob('market.request-structurize', mbId, {
      model: 'verified-model',
      promptVersion: hashAiText('prompt-v1'),
      inputHash: hashAiInput(input),
    });
    finishAiJob(job.id, { json: spec });
    const payload = MarketProjectCreatePayload.parse({
      ...basePayload,
      aiJobIds: { structurize: job.id },
    });
    const artifacts = {
      diagramSpec: spec,
      diagramHtml: '<svg>rendered</svg>',
      rocMd: null,
      postings: null,
    };

    const meta = buildAiGenerationMeta({ mbId, payload, artifacts, generatedAt: new Date(0) });
    const result = toAiProvenance(meta, artifacts);
    expect(result.diagramSpec).toMatchObject({ state: 'ai-generated', model: 'verified-model' });
    expect(result.diagramHtml).toMatchObject({ state: 'deterministic', model: null });
  });

  it('생성 이후 출력 또는 원천이 바뀌면 고객 수정본으로 표시한다', () => {
    const payload = MarketProjectCreatePayload.parse(basePayload);
    const artifacts = {
      diagramSpec: spec,
      diagramHtml: '<svg>rendered</svg>',
      rocMd: null,
      postings: null,
    };
    const meta = buildAiGenerationMeta({
      mbId: `unverified-${randomUUID()}`,
      payload,
      artifacts,
      generatedAt: new Date(0),
    });
    expect(toAiProvenance(meta, { ...artifacts, diagramHtml: '<svg>changed</svg>' }).diagramHtml?.state)
      .toBe('customer-modified');

    const invalidated = invalidateAiGenerationMeta(meta);
    expect(toAiProvenance(invalidated, artifacts).diagramHtml?.state).toBe('customer-modified');
  });

  it('검증 메타데이터가 없는 레거시 산출물은 AI 생성으로 단정하지 않는다', () => {
    expect(toAiProvenance(null, {
      diagramSpec: spec,
      diagramHtml: null,
      rocMd: null,
      postings: null,
    }).diagramSpec?.state).toBe('unverified');
  });
});
