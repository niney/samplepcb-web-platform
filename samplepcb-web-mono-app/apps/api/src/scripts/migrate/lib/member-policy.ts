// 최초 이관·증분 동기화가 공유하는 회원 보호/비밀번호 정책.
import type { Row } from './g5-writer';
import { asStr } from './util';
import { diffCols } from './sync/row-diff';

export function protectedMbIds(): Set<string> {
  const extra = (process.env.MIGRATE_PROTECTED_MB_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  // admin은 레거시 정본으로 이관한다. kpeter와 명시한 추가 보호 계정은 기존 정책 유지.
  return new Set(['kpeter', ...extra]);
}

export interface PasswordSyncDecision {
  set: { mb_password: string; mb_password2: string } | null;
}

/** 같은 레거시 비밀번호에서 만들어진 신규 코어 재해시는 보존한다. */
export function resolvePasswordSync(
  legacyPw: string,
  targetPw: string,
  targetPw2: string,
): PasswordSyncDecision {
  if (targetPw === legacyPw) return { set: null };
  if (targetPw.startsWith('sha256:')) {
    if (targetPw2 === legacyPw) return { set: null };
    return { set: { mb_password: legacyPw, mb_password2: '' } };
  }
  return { set: { mb_password: legacyPw, mb_password2: '' } };
}

/**
 * 설치 과정에서 이미 만들어진 admin도 레거시 회원으로 갱신한다.
 * null은 기존 계정 보존, 빈 객체는 admin 이관 대상이지만 회원 행 변경은 없음을 뜻한다.
 * cols에는 교집합 컬럼만 전달한다. INSERT용 filler와 mb_no는 기존 행에 덮어쓰지 않는다.
 */
export function planExistingAdminUpdate(
  legacy: Row,
  target: Row,
  cols: readonly string[],
  protectedIds: ReadonlySet<string>,
): Row | null {
  const mbId = asStr(legacy.mb_id);
  if (mbId !== 'admin' || protectedIds.has(mbId)) return null;
  const compareCols = cols.filter(
    (col) => !['mb_id', 'mb_no', 'mb_password', 'mb_password2'].includes(col),
  );
  const set: Row = {};
  for (const col of diffCols(legacy, target, compareCols)) set[col] = legacy[col] ?? null;
  const password = resolvePasswordSync(
    asStr(legacy.mb_password), asStr(target.mb_password), asStr(target.mb_password2),
  );
  if (password.set !== null) Object.assign(set, password.set);
  return set;
}
