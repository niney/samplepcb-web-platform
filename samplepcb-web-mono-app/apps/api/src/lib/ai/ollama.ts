// 얇은 Ollama 클라이언트 — 로컬 데몬(클라우드 모델 프록시, 키 불요) 또는 ollama.com
// API(Bearer 키) 모두 baseUrl+Authorization 조합으로 동작한다. 프로바이더 추상화는
// 의도적으로 안 한다(YAGNI) — 인터페이스를 chat/listModels 둘로 좁게 유지.
// chat 은 반드시 stream 으로 받는다: 비스트림은 undici 헤더 타임아웃(~300s)에 걸려
// 장시간 생성(glm-5.2 ~3분)이 실패한다(프로빙 실측 — minimax 304s fail).
// 2026-08-28: 구조화 출력(format=JSON 스키마)·thinking 제어(think)·컨텍스트 길이 옵션 추가.
// 스트림의 message.thinking(사고 토큰)은 버리고 content 만 모은다.

export interface AiConnection {
  baseUrl: string;
  apiKey: string | null;
}

export interface OllamaChatExtra {
  // 'json' 또는 JSON 스키마 객체 — 서버가 문법 수준에서 출력 형태를 강제한다.
  format?: 'json' | Record<string, unknown>;
  // thinking 모델(deepseek-v4·glm 등) 사고 단계 on/off. 지원 안 하는 모델엔 보내지 않는다.
  think?: boolean;
  numCtx?: number;
  temperature?: number;
}

export interface OllamaChatResult {
  text: string;
  thinkingChars: number; // 버린 사고 토큰 분량(프로빙 계측용)
  elapsedMs: number;
}

const authHeaders = (conn: AiConnection): Record<string, string> => ({
  'content-type': 'application/json',
  ...(conn.apiKey !== null && conn.apiKey !== '' ? { authorization: `Bearer ${conn.apiKey}` } : {}),
});

// 전체 응답 텍스트를 모아 반환(스트리밍 수신). 타임아웃은 전체 소요 기준.
export async function ollamaChatDetailed(
  conn: AiConnection,
  model: string,
  prompt: string,
  timeoutMs = 600_000,
  images: readonly string[] = [],
  extra: OllamaChatExtra = {},
): Promise<OllamaChatResult> {
  const startedAt = Date.now();
  const options: Record<string, number> = {};
  if (extra.numCtx !== undefined) options.num_ctx = extra.numCtx;
  if (extra.temperature !== undefined) options.temperature = extra.temperature;
  const res = await fetch(`${conn.baseUrl}/api/chat`, {
    method: 'POST',
    headers: authHeaders(conn),
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{
        role: 'user',
        content: prompt,
        ...(images.length === 0 ? {} : { images }),
      }],
      ...(extra.format === undefined ? {} : { format: extra.format }),
      ...(extra.think === undefined ? {} : { think: extra.think }),
      ...(Object.keys(options).length === 0 ? {} : { options }),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok || res.body === null) {
    throw new Error(`ollama chat HTTP ${String(res.status)}: ${(await res.text()).slice(0, 200)}`);
  }
  let text = '';
  let thinkingChars = 0;
  let buf = '';
  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line === '') continue;
      try {
        const j = JSON.parse(line) as { message?: { content?: string; thinking?: string }; error?: string };
        if (j.error !== undefined) throw new Error(`ollama: ${j.error}`);
        text += j.message?.content ?? '';
        thinkingChars += j.message?.thinking?.length ?? 0;
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('ollama:')) throw err;
        // JSON 아닌 조각은 무시(방어)
      }
    }
  }
  return { text, thinkingChars, elapsedMs: Date.now() - startedAt };
}

export async function ollamaChat(
  conn: AiConnection,
  model: string,
  prompt: string,
  timeoutMs = 600_000,
  images: readonly string[] = [],
  extra: OllamaChatExtra = {},
): Promise<string> {
  return (await ollamaChatDetailed(conn, model, prompt, timeoutMs, images, extra)).text;
}

// 모델 목록(/api/tags) — 관리자 모델 셀렉트 + 연결 테스트 겸용.
export async function ollamaListModels(conn: AiConnection): Promise<string[]> {
  const res = await fetch(`${conn.baseUrl}/api/tags`, {
    headers: authHeaders(conn),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ollama tags HTTP ${String(res.status)}`);
  const json = (await res.json()) as { models?: { name?: string }[] };
  return (json.models ?? []).map((m) => m.name ?? '').filter((n) => n !== '');
}

// LLM 응답에서 HTML 본문만 추출 — 코드펜스·서문 방어(프로빙 검증 로직 이식).
export function extractHtml(text: string): string {
  const fence =
    /```html\s*([\s\S]*?)```/i.exec(text) ?? /```\s*(<!doctype[\s\S]*?|<html[\s\S]*?)```/i.exec(text);
  if (fence?.[1] !== undefined) return fence[1].trim();
  const start = text.search(/<!doctype html|<html/i);
  if (start >= 0) return text.slice(start).trim();
  return text.trim();
}

// LLM 응답에서 JSON 객체만 추출 — 코드펜스·서문·후문 방어(인터뷰 프로빙 로직 이식).
// 파싱 실패는 throw — 러너의 재시도 1회가 흡수한다.
export function extractJsonObject(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fence?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in LLM output');
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}
