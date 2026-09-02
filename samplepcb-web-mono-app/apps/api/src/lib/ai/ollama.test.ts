import { describe, expect, it } from 'vitest';
import { extractJsonObject } from './ollama';

// LLM 응답 JSON 추출 — 프로빙 실측 실패 3종(추론문 혼입·제어문자·코드펜스)을 고정한다.

describe('extractJsonObject', () => {
  it('코드펜스 안의 객체를 꺼낸다', () => {
    expect(extractJsonObject('설명\n```json\n{"a": 1}\n```\n끝')).toEqual({ a: 1 });
  });

  it('추론문에 중괄호가 섞여도 실제 JSON 블록을 고른다(glm-5.3 think 누출)', () => {
    const text = 'Let me analyze {the request}. Customer says {"x": 1} is fine.\n\n{"summary": "요약", "items": [{"k": "v"}]}';
    expect(extractJsonObject(text)).toEqual({ summary: '요약', items: [{ k: 'v' }] });
  });

  it('문자열 안의 원시 개행·탭을 이스케이프해 파싱한다(kimi-k3·mistral 제어문자)', () => {
    const text = '{"summary": "첫 줄\n둘째 줄\t탭", "n": 2}';
    expect(extractJsonObject(text)).toEqual({ summary: '첫 줄\n둘째 줄\t탭', n: 2 });
  });

  it('객체가 없으면 던진다', () => {
    expect(() => extractJsonObject('그냥 문장입니다')).toThrow('no JSON object');
  });
});
