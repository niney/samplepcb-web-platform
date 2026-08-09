// API 레벨 호출 헬퍼(스모크 call 미러) — 브라우저를 안 끼고 Fastify 를 직접 친다.
// body 미지정이면 content-type 헤더도 싣지 않는다: 본문 없는 액션에 json 헤더만
// 붙이면 Fastify 가 FST_ERR_CTP_EMPTY_JSON_BODY 로 거부한다(@sp/shared apiSend 규약).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { API_URL } from './env';

export interface ApiResult {
  status: number;
  json: any;
}

export async function api(
  token: string | null,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiResult> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* 본문 없는 응답 */
  }
  return { status: res.status, json };
}
