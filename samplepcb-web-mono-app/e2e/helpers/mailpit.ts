// Mailpit REST 헬퍼(docs/LOCAL_MAIL_TESTING.md) — 로컬 SMTP(127.0.0.1:25) 캡처함.
// 무잔재 원칙: 전체 삭제는 제공하지 않는다(사용자 관찰 중인 메일 보존) — 시드가
// 유발한 메일만 id 로 지울 것.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MAILPIT_URL } from './env';

async function req(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${MAILPIT_URL}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Mailpit ${method} ${path} → ${String(res.status)} — Mailpit 구동 확인(127.0.0.1:8025)`);
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** 최근 메일 목록 — { total, messages: [{ ID, From, To, Subject, Created … }] } */
export async function mailpitList(limit = 50): Promise<any> {
  return req('GET', `/api/v1/messages?limit=${String(limit)}`);
}

/** 검색 — 예: mailpitSearch('to:"partner@example.com" subject:"발주"') */
export async function mailpitSearch(query: string): Promise<any> {
  return req('GET', `/api/v1/search?query=${encodeURIComponent(query)}`);
}

/** 본문 포함 단건 — { Subject, HTML, Text, To … }. 매직링크 URL 추출 등에 사용. */
export async function mailpitMessage(id: string): Promise<any> {
  return req('GET', `/api/v1/message/${id}`);
}

/** 시드가 만든 메일만 골라 삭제(전체 삭제 금지) */
export async function mailpitDelete(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await req('DELETE', '/api/v1/messages', { IDs: ids });
}
