// sp-engine(Python, BOM 추출 + 공급사 검색) HTTP 클라이언트 — admin-bom 프록시와
// admin-parts 수동 갱신이 공유한다. 엔진은 사설망·무인증(인증 경계는 sp-node).
export const BOM_ENGINE_URL = process.env.BOM_ENGINE_URL ?? 'http://127.0.0.1:8400';
const BOM_ENGINE_TIMEOUT_MS = Number(process.env.BOM_ENGINE_TIMEOUT_MS ?? 120_000);

export async function engineFetch(
  path: string,
  init?: RequestInit,
  timeoutMs = BOM_ENGINE_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(`${BOM_ENGINE_URL}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
