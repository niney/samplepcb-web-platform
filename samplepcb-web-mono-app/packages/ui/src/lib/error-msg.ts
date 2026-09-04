import { ApiRequestError } from '@sp/shared';

// 서버 비즈니스 에러(`{ result:false, error:'CODE' }` · `ApiError`) → 사용자 메시지.
// 코드→문구 사전은 앱마다 다르므로(마켓·개발의뢰·관리자) 인자로 받고, 여기서는 공통 폴백만 안다:
// 사전에 있는 코드 → 그 문구 / 401 → 로그인 / 404 → 대상 없음 / 그 외 → fallback.
export function apiErrorMessage(
  err: unknown,
  fallback: string,
  codeMessages: Readonly<Record<string, string>> = {},
): string {
  if (err instanceof ApiRequestError) {
    const code = err.payload?.error;
    if (code !== undefined) {
      const mapped = codeMessages[code];
      if (mapped !== undefined) return mapped;
    }
    if (err.status === 401) return '로그인이 필요합니다.';
    if (err.status === 404) return '대상을 찾을 수 없습니다.';
  }
  return fallback;
}

// 사전 없이 쓰는 공용 컴포넌트(첨부 미리보기 등)용.
export const errorMessage = (err: unknown, fallback = '요청에 실패했습니다. 잠시 후 다시 시도해 주세요.'): string =>
  apiErrorMessage(err, fallback);
