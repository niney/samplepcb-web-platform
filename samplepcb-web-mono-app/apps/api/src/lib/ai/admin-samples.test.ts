import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DevReviewAnswers, DevReviewRunPayload } from '@sp/api-contract';
import { DEV_REVIEW_ADMIN_SAMPLE } from './admin-samples';
import { buildDevReviewPrompt, devReviewSourceText } from './dev-review';

// 관리자 샘플이 계약을 만족하고, 원본 픽스처(01-idea-only)와 어긋나지 않는지 지킨다 —
// 샘플은 코드 상수 사본이라 픽스처만 고치면 조용히 노후화된다.

const fixturePath = path.resolve(
  fileURLToPath(new URL('../../scripts/fixtures/dev-review/01-idea-only.json', import.meta.url)),
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  title: string;
  serviceAreas: string[];
  description: string;
  answers: unknown;
  attachments: string[];
};

describe('AI 사전 검토서 관리자 샘플', () => {
  it('실행 payload 계약을 만족한다(첨부 없음 — 비전 단계를 타지 않는다)', () => {
    const parsed = DevReviewRunPayload.parse({
      title: DEV_REVIEW_ADMIN_SAMPLE.title,
      serviceAreas: DEV_REVIEW_ADMIN_SAMPLE.serviceAreas,
      description: DEV_REVIEW_ADMIN_SAMPLE.description,
      answers: DEV_REVIEW_ADMIN_SAMPLE.answers,
    });
    expect(parsed.answers).toHaveLength(9);
    expect(DEV_REVIEW_ADMIN_SAMPLE.attachmentFiles).toHaveLength(0);
    expect(DEV_REVIEW_ADMIN_SAMPLE.attachmentContext).toBe('');
  });

  it('프로빙 픽스처 01-idea-only 와 같은 내용이다', () => {
    expect(DEV_REVIEW_ADMIN_SAMPLE.title).toBe(fixture.title);
    expect(DEV_REVIEW_ADMIN_SAMPLE.description).toBe(fixture.description);
    expect([...DEV_REVIEW_ADMIN_SAMPLE.serviceAreas]).toEqual(fixture.serviceAreas);
    expect([...DEV_REVIEW_ADMIN_SAMPLE.answers]).toEqual(DevReviewAnswers.parse(fixture.answers));
    expect(fixture.attachments).toHaveLength(0);
  });

  it('프롬프트에 바인딩되고 추가 지침이 실린다', () => {
    const prompt = buildDevReviewPrompt(DEV_REVIEW_ADMIN_SAMPLE, '표는 5행 이상 채울 것');
    expect(prompt.length).toBeGreaterThan(1000);
    expect(prompt).toContain('반려견 자동 급식기 제어 보드');
    expect(prompt).toContain('표는 5행 이상 채울 것');
    // 근거 코퍼스에 답변 라벨이 들어가야 후처리 R1 이 인용을 인정한다.
    expect(devReviewSourceText(DEV_REVIEW_ADMIN_SAMPLE)).toContain('Wi-Fi');
  });
});
