import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createAiJob,
  findReusableAiJob,
  finishAiJob,
  hashAiInput,
  hashAiText,
} from './jobs';

describe('AI 동일 입력 잡 캐시', () => {
  const source = {
    model: 'test-model',
    promptVersion: hashAiText('prompt-v1'),
    inputHash: hashAiInput({ title: 'same request', answers: [] }),
  };

  it('동일 회원의 완료된 성공 결과만 재사용한다', () => {
    const mbId = `cache-owner-${randomUUID()}`;
    const running = createAiJob('market.request-structurize', mbId, source);
    expect(findReusableAiJob('market.request-structurize', mbId, source)).toBeUndefined();

    finishAiJob(running.id, { json: '{"ok":true}' });
    expect(findReusableAiJob('market.request-structurize', mbId, source)?.id).toBe(running.id);
  });

  it('회원·모델·프롬프트·입력 경계가 하나라도 다르면 재사용하지 않는다', () => {
    const mbId = `cache-boundary-${randomUUID()}`;
    const job = createAiJob('market.request-roc', mbId, source);
    finishAiJob(job.id, { md: 'result' });

    expect(findReusableAiJob('market.request-roc', `${mbId}-other`, source)).toBeUndefined();
    expect(findReusableAiJob('market.request-roc', mbId, { ...source, model: 'other' })).toBeUndefined();
    expect(findReusableAiJob('market.request-roc', mbId, {
      ...source,
      promptVersion: hashAiText('prompt-v2'),
    })).toBeUndefined();
    expect(findReusableAiJob('market.request-roc', mbId, {
      ...source,
      inputHash: hashAiInput({ title: 'changed request', answers: [] }),
    })).toBeUndefined();
  });
});
