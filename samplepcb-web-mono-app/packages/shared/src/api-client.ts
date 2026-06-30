import type { ZodType } from 'zod';
import { ApiError, type ApiErrorType } from '@sp/api-contract';
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

// 타입 안전 GET: 응답을 schema.parse 로 검증해 T 로 반환. auth 토큰이 있으면 Bearer 첨부.
export async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  const auth = useAuthStore();

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (auth.token !== null) {
    headers.Authorization = `Bearer ${auth.token}`;
  }

  const res = await fetch(path, { headers });

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const parsed = ApiError.safeParse(body);
    throw new ApiRequestError(res.status, parsed.success ? parsed.data : null);
  }

  const json: unknown = await res.json();
  return schema.parse(json);
}
