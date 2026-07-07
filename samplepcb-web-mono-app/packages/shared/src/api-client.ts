import type { ZodType } from 'zod';
import { ApiError, ApiMemberError, type ApiErrorType } from '@sp/api-contract';
import { useAuthStore } from './auth';

// 계약(@sp/api-contract)의 ApiError 는 Zod 스키마이므로, throw 가능한 Error 로 감싼다.
// (eslint strictTypeChecked 의 only-throw-error: Error 이외 throw 금지)
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly payload: ApiErrorType | null,
  ) {
    super(payload?.message ?? `API 요청 실패 (HTTP ${String(status)})`);
    this.name = 'ApiRequestError';
  }
}

// 인증 fetch 코어 — Bearer 첨부 + 401 시 bootstrap() 1회 재발급 후 재시도.
// JWT TTL 이 10분이라 SPA(특히 관리자 화면) 장시간 체류 중 만료는 정상 경로다:
// PHPSESSID 가 살아 있으면 /spcb/api/me 가 새 토큰을 발급한다. 재시도 후에도
// 401 이면 그누보드 세션 자체가 끝난 것 — 그대로 throw(호출측이 재로그인 안내).
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const auth = useAuthStore();

  const doFetch = (): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    if (auth.token !== null) headers.set('Authorization', `Bearer ${auth.token}`);
    return fetch(path, { ...init, headers });
  };

  let res = await doFetch();
  if (res.status === 401 && auth.token !== null) {
    await auth.bootstrap();
    res = await doFetch();
  }
  return res;
}

// 에러 본문 해석 — 관리자형({error,message})과 회원 봉투형({result:false,error})을 모두
// ApiErrorType 으로 정규화해 호출측이 payload.error 코드로 메시지를 매핑할 수 있게 한다.
function toApiErrorPayload(body: unknown): ApiErrorType | null {
  const admin = ApiError.safeParse(body);
  if (admin.success) return admin.data;
  const member = ApiMemberError.safeParse(body);
  if (member.success) {
    return { error: member.data.error, message: member.data.message ?? member.data.error };
  }
  return null;
}

async function parseJson<T>(res: Response, schema: ZodType<T>): Promise<T> {
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    throw new ApiRequestError(res.status, toApiErrorPayload(body));
  }
  const json: unknown = await res.json();
  return schema.parse(json);
}

// 타입 안전 GET: 응답을 schema.parse 로 검증해 T 로 반환.
export async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  return parseJson(await authFetch(path), schema);
}

// 타입 안전 변경 요청(JSON body): POST/PATCH/PUT/DELETE 공용.
// body 가 undefined 면 Content-Type·body 를 아예 싣지 않는다 — 조기마감/채택/철회 등
// 본문 없는 액션에 'application/json' 만 붙이면 body 가 비어(Content-Length:0) Fastify 가
// FST_ERR_CTP_EMPTY_JSON_BODY 로 거부하기 때문(E2E req 헬퍼와 동일 규약).
export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  schema: ZodType<T>,
): Promise<T> {
  const res = await authFetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return parseJson(res, schema);
}

// 타입 안전 변경 요청(multipart FormData): 파일 업로드 동반 API(재능마켓 전문가 등록·
// 의뢰 첨부 등) 공용. Content-Type 은 브라우저가 boundary 포함해 설정하므로 지정 금지.
export async function apiSendForm<T>(
  method: 'POST' | 'PATCH',
  path: string,
  form: FormData,
  schema: ZodType<T>,
): Promise<T> {
  const res = await authFetch(path, { method, body: form });
  return parseJson(res, schema);
}

// 파일 다운로드(관리자 거버 원본 등) — <img>/<a href> 는 Authorization 헤더를 못
// 실으므로 fetch 로 받아 Blob 으로 반환한다(호출측이 objectURL 로 저장 처리).
export async function apiGetBlob(path: string): Promise<Blob> {
  const res = await authFetch(path, { headers: { Accept: 'application/octet-stream' } });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    throw new ApiRequestError(res.status, toApiErrorPayload(body));
  }
  return res.blob();
}
