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

  it('R&D 개발의뢰서는 10개 고정 섹션이 모두 있어야 저장한다', () => {
    const def = AI_USECASE_DEFS['rnd.pcb-request-document'];
    const input: unknown = def.inputSchema.parse(getAiAdminSampleInput('rnd.pcb-request-document'));
    const valid = Array.from({ length: 10 }, (_value, index) => {
      const number = index + 1;
      if (number === 2) return '## 2. 첨부자료 목록\n- F0001 prototype/board.pdf';
      if (number === 4) return '## 4. 입력 조건\n- 회로 문서 확인 [근거: F0001]';
      if (number === 7) return '## 7. 산출물\n- Gerber, NC Drill, BOM, Pick & Place 좌표';
      if (number === 9) return '## 9. 미확정 항목\n- 보드 치수 (TBD)';
      return `## ${String(number)}. 섹션\n내용`;
    }).join('\n\n');
    const result = def.parseResult(valid, input);
    expect('md' in result).toBe(true);
    expect(() => def.parseResult(valid.replace('## 10. 섹션\n내용', ''), input)).toThrow('FORMAT_MISMATCH');
    expect(() => def.parseResult(valid.replace('F0001 prototype/board.pdf', 'prototype/board.pdf'), input)).toThrow('SOURCE_COVERAGE_MISMATCH');
  });
});
