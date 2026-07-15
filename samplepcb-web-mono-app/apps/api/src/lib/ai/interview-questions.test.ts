import { describe, expect, it } from 'vitest';
import {
  getApplicableAiInterviewQuestions,
  MarketProjectCreatePayload,
  MarketProjectUpdateBody,
} from '@sp/api-contract';
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

  it('세부분야와 요구 도구를 관리자 프롬프트 밖의 고정 컨텍스트로 전달한다', () => {
    const def = AI_USECASE_DEFS['market.request-structurize'];
    const prompt = def.buildPrompt(def.defaultPrompt, {
      title: '제어 보드 개발',
      serviceAreas: ['circuit', 'pcb'],
      categories: ['mcu', 'power'],
      cadTools: ['kicad'],
      description: '마이크로컨트롤러 기반 제어 보드의 회로와 PCB를 개발합니다.',
      answers: [],
    });
    expect(prompt).toContain('[사용자 선택 기술 조건]');
    expect(prompt).toContain('mcu=AVR·마이컴 회로');
    expect(prompt).toContain('power=전원회로·SMPS');
    expect(prompt).toContain('kicad=KiCad');
  });

  it('레거시 하드웨어 구성도는 전자 개발 분야에만 적용한다', () => {
    const applicable = AI_USECASE_DEFS['market.request-diagram'].isApplicable;
    expect(applicable).toBeDefined();
    expect(applicable?.({
      title: '모바일 앱 개발',
      serviceAreas: ['app', 'server'],
      categories: [],
      cadTools: [],
      description: '모바일 앱과 연동 API 서버를 함께 개발하는 프로젝트입니다.',
    })).toBe(false);
    expect(applicable?.({
      title: '제어 보드 개발',
      serviceAreas: ['circuit'],
      categories: ['mcu'],
      cadTools: ['kicad'],
      description: '마이크로컨트롤러 기반 제어 보드의 회로를 개발합니다.',
    })).toBe(true);
  });
});

describe('프로젝트 AI 산출물 의존성', () => {
  const createBase = {
    title: '제어 보드 개발',
    requestType: 'individual' as const,
    serviceAreas: ['circuit'] as const,
    categories: ['mcu'] as const,
    cadTools: ['kicad'] as const,
    description: '마이크로컨트롤러 기반 제어 보드의 회로를 개발합니다.',
    ndaRequired: true,
    budgetRange: 'r300_700' as const,
    deadline: { days: 7 as const },
    method: 'open' as const,
  };

  it('신규 등록에서 구성 명세 없는 ROC·분야 카드를 거부한다', () => {
    expect(MarketProjectCreatePayload.safeParse({ ...createBase, rocMd: '## 1. 프로젝트 식별' }).success).toBe(false);
    expect(MarketProjectCreatePayload.safeParse({
      ...createBase,
      postings: [{
        serviceArea: 'circuit',
        summary: ['회로 개발'],
        scope: ['회로 설계'],
        deliverables: [],
        notes: [],
      }],
    }).success).toBe(false);
  });

  it('수정 요청에서 구성 명세를 제거하면서 파생 산출물을 유지하지 못한다', () => {
    expect(MarketProjectUpdateBody.safeParse({
      diagramSpec: null,
      rocMd: '## 1. 프로젝트 식별',
    }).success).toBe(false);
    expect(MarketProjectUpdateBody.safeParse({
      diagramSpec: null,
      postings: [{
        serviceArea: 'circuit',
        summary: ['회로 개발'],
        scope: ['회로 설계'],
        deliverables: [],
        notes: [],
      }],
    }).success).toBe(false);
  });
});
