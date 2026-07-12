// 얇은 Ollama 클라이언트 — 로컬 데몬(클라우드 모델 프록시, 키 불요) 또는 ollama.com
// API(Bearer 키) 모두 baseUrl+Authorization 조합으로 동작한다. 프로바이더 추상화는
// 의도적으로 안 한다(YAGNI) — 인터페이스를 chat/listModels 둘로 좁게 유지.
// chat 은 반드시 stream 으로 받는다: 비스트림은 undici 헤더 타임아웃(~300s)에 걸려
// 장시간 생성(glm-5.2 ~3분)이 실패한다(프로빙 실측 — minimax 304s fail).

export interface AiConnection {
  baseUrl: string;
  apiKey: string | null;
}

const authHeaders = (conn: AiConnection): Record<string, string> => ({
  'content-type': 'application/json',
  ...(conn.apiKey !== null && conn.apiKey !== '' ? { authorization: `Bearer ${conn.apiKey}` } : {}),
});

// 전체 응답 텍스트를 모아 반환(스트리밍 수신). 타임아웃은 전체 소요 기준.
export async function ollamaChat(
  conn: AiConnection,
  model: string,
  prompt: string,
  timeoutMs = 600_000,
): Promise<string> {
  const res = await fetch(`${conn.baseUrl}/api/chat`, {
    method: 'POST',
    headers: authHeaders(conn),
    body: JSON.stringify({ model, stream: true, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok || res.body === null) {
    throw new Error(`ollama chat HTTP ${String(res.status)}: ${(await res.text()).slice(0, 200)}`);
  }
  let text = '';
  let buf = '';
  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line === '') continue;
      try {
        const j = JSON.parse(line) as { message?: { content?: string }; error?: string };
        if (j.error !== undefined) throw new Error(`ollama: ${j.error}`);
        text += j.message?.content ?? '';
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('ollama:')) throw err;
        // JSON 아닌 조각은 무시(방어)
      }
    }
  }
  return text;
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
