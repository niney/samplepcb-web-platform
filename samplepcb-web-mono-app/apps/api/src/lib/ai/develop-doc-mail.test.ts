import { describe, expect, it } from 'vitest';
import { buildDevelopDocMailPrompt, parseDevelopDocMailLlmOutput } from './develop-doc-mail';

describe('develop-doc-mail', () => {
  it('프롬프트에 문서 행·선택지·기본 초안이 들어간다', () => {
    const prompt = buildDevelopDocMailPrompt({
      typeLabel: '중간 개발검토서',
      docNo: 'DR-01',
      approval: true,
      decisionLabels: ['승인합니다', '수정 후 다시 검토해 주세요'],
      requestTitle: 'BLE 로거',
      customerName: '홍길동',
      customerCompany: '이투이랩',
      replyDueOn: '2026-09-20',
      rows: [{ key: 'purpose', label: '검토 목적', text: '회로 확정', kind: 'textarea' }],
      draft: { subject: '[샘플피씨비] BLE 로거 중간 개발검토서 및 확인 요청', body: '초안 본문' },
    }, '짧게');
    expect(prompt).toContain('- 검토 목적: 회로 확정');
    expect(prompt).toContain('- 승인합니다');
    expect(prompt).toContain('이투이랩 홍길동 담당자님');
    expect(prompt).toContain('[추가 지침]\n짧게');
    expect(prompt).toContain('회신 요청일: 2026-09-20');
  });

  it('JSON 을 파싱하고 서식 잔재를 걷어낸다', () => {
    const out = parseDevelopDocMailLlmOutput('생각 중…\n{"subject":"[샘플피씨비] <b>제목</b>","body":"## 인사\\n**굵게** 본문\\r\\n\\n\\n\\n끝"}');
    expect(out.subject).toBe('[샘플피씨비] 제목');
    expect(out.body).toBe('인사\n굵게 본문\n\n끝');
  });

  it('빈 결과는 throw', () => {
    expect(() => parseDevelopDocMailLlmOutput('{"subject":"","body":"x"}')).toThrow('DOC_MAIL_EMPTY');
    expect(() => parseDevelopDocMailLlmOutput('[]')).toThrow();
  });
});
