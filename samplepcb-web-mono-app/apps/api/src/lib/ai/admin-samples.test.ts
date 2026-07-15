import { describe, expect, it } from 'vitest';
import { AI_USECASES } from '@sp/api-contract';
import { getAiAdminSampleInput } from './admin-samples';
import { AI_USECASE_DEFS } from './usecases';

describe('AI 관리자 프롬프트 테스트 샘플', () => {
  for (const useCase of AI_USECASES) {
    it(`${useCase} 입력 계약과 프롬프트 바인딩을 만족한다`, () => {
      const def = AI_USECASE_DEFS[useCase];
      const input: unknown = def.inputSchema.parse(getAiAdminSampleInput(useCase));
      if (def.isApplicable !== undefined) expect(def.isApplicable(input)).toBe(true);

      const prompt = def.buildPrompt(def.defaultPrompt, input);
      expect(prompt.length).toBeGreaterThan(100);
      expect(prompt).not.toContain('{{title}}');
    });
  }
});
