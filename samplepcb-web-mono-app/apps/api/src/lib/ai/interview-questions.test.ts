import { describe, expect, it } from 'vitest';
import { getApplicableAiInterviewQuestions } from '@sp/api-contract';
import { AI_USECASE_DEFS } from './usecases';

const codesFor = (
  areas: Parameters<typeof getApplicableAiInterviewQuestions>[0],
): string[] => getApplicableAiInterviewQuestions(areas).map((q) => q.code);

describe('분야별 AI 인터뷰 질문', () => {
  it('분야 미지정 시스템 통합은 공통 질문만 노출한다', () => {
    expect(codesFor([])).toEqual(['stage', 'delivery', 'assets']);
  });

  it('앱 의뢰에는 앱 질문만 추가하고 하드웨어 질문을 제외한다', () => {
    const codes = codesFor(['app']);
    expect(codes).toEqual(['stage', 'delivery', 'assets', 'appPlatform', 'appScope', 'appExisting']);
    expect(codes).not.toContain('power');
    expect(codes).not.toContain('mcu');
  });

  it('회로 의뢰에는 기존 하드웨어 핵심 질문을 유지한다', () => {
    const codes = codesFor(['circuit']);
    expect(codes).toEqual(expect.arrayContaining(['power', 'powerDetail', 'mcu', 'sensors', 'outputs', 'comm']));
    expect(codes).not.toContain('appPlatform');
    expect(codes).not.toContain('serverScale');
  });

  it('복수 분야는 질문을 중복 없이 합집합으로 구성한다', () => {
    const codes = codesFor(['circuit', 'app', 'server']);
    expect(codes).toEqual(expect.arrayContaining(['mcu', 'appPlatform', 'serverScope']));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('기존 관리자 프롬프트에도 순수 소프트웨어 실행 정책을 앞에 붙인다', () => {
    const def = AI_USECASE_DEFS['market.request-structurize'];
    const prompt = def.buildPrompt(def.defaultPrompt, {
      title: '재고 관리 앱 개발',
      serviceAreas: ['app', 'server'],
      description: '모바일 재고 관리 앱과 연동 API 서버를 개발합니다.',
      answers: [],
    });
    expect(prompt).toContain('이 의뢰는 순수 소프트웨어 분야다');
    expect(prompt).toContain('전원·MCU·센서·PCB 블록을 만들지 말고');
    expect(prompt).not.toContain('- 전원은 무엇을 사용하나요?');
  });
});
