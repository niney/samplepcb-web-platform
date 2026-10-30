import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractJsonObject, ollamaChatDetailed } from './ollama';

// LLM 응답 JSON 추출 — 프로빙 실측 실패 3종(추론문 혼입·제어문자·코드펜스)을 고정한다.

describe('extractJsonObject', () => {
  it('코드펜스 안의 객체를 꺼낸다', () => {
    expect(extractJsonObject('설명\n```json\n{"a": 1}\n```\n끝')).toEqual({ a: 1 });
  });

  it('추론문에 중괄호가 섞여도 실제 JSON 블록을 고른다(glm-5.3 think 누출)', () => {
    const text = 'Let me analyze {the request}. Customer says {"x": 1} is fine.\n\n{"summary": "요약", "items": [{"k": "v"}]}';
    expect(extractJsonObject(text)).toEqual({ summary: '요약', items: [{ k: 'v' }] });
  });

  it('추론문에 초안 JSON 이 여럿 있어도 마지막 완전한 객체(최종 답)를 고른다', () => {
    const draft = '{"summary": "초안", "requirements": [{"text": "a", "evidence": "b"}], "note": "이건 초안이고 더 길다……"}';
    const final = '{"summary": "최종", "requirements": []}';
    expect(extractJsonObject(`Draft:\n${draft}\n\nRevised {again}. Final:\n${final}\n`)).toEqual({ summary: '최종', requirements: [] });
  });

  it('앞선 추론문에 따옴표·중괄호가 어긋나 있어도 줄 머리에서 시작하는 마지막 객체를 찾는다', () => {
    const text = 'He said "wait{ and never closed it.\n{"summary": "초안", "n": 1}\n\nWait — rethinking } this.\n{"summary": "최종", "n": 2}\n';
    expect(extractJsonObject(text)).toEqual({ summary: '최종', n: 2 });
  });

  it('문자열 안의 원시 개행·탭을 이스케이프해 파싱한다(kimi-k3·mistral 제어문자)', () => {
    const text = '{"summary": "첫 줄\n둘째 줄\t탭", "n": 2}';
    expect(extractJsonObject(text)).toEqual({ summary: '첫 줄\n둘째 줄\t탭', n: 2 });
  });

  it('배열 원소를 열 0 에 찍어도 바깥 객체 전체를 고른다(minimax-m3·glm-5.3 실측 — 마지막 원소 하나로 줄던 결함)', () => {
    const text = '{"header": {"no": null},\n"items": [\n{"factoryNo": "1", "q": "가"},\n{"factoryNo": "2", "q": "나"}\n]}';
    expect(extractJsonObject(text)).toEqual({
      header: { no: null },
      items: [
        { factoryNo: '1', q: '가' },
        { factoryNo: '2', q: '나' },
      ],
    });
    // 서문이 붙어 통째 파싱이 안 돼도 열 0 후보 중 바깥 객체가 먼저다.
    expect(extractJsonObject(`결과입니다:\n${text}\n`)).toEqual(extractJsonObject(text));
  });

  it('열 0 에서 시작한 잘린 초안이 최종 JSON 을 삼켜도 안쪽의 최종 객체를 찾는다', () => {
    const text = '{"summary": "초안", "items": [\nWait, let me redo.\n{"summary": "최종", "n": 3}\n';
    expect(extractJsonObject(text)).toEqual({ summary: '최종', n: 3 });
  });

  it('객체가 없으면 던진다', () => {
    expect(() => extractJsonObject('그냥 문장입니다')).toThrow('no JSON object');
  });
});

describe('ollamaChatDetailed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('조각 경계에 걸린 한글을 깨뜨리지 않는다(열처리 → 열처� 실측)', async () => {
    const bytes = new TextEncoder().encode(`${JSON.stringify({ message: { content: '열처리 설비' } })}\n${JSON.stringify({ done: true })}\n`);
    const cut = bytes.indexOf(0xb2) + 1; // '처'(EC B2 98)의 가운데를 자른다
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body))));
    const res = await ollamaChatDetailed({ baseUrl: 'http://ai.test', apiKey: null }, 'm', 'p');
    expect(res.text).toBe('열처리 설비');
  });
});
