import { useI18n } from 'vue-i18n';
import { ApiRequestError } from '@sp/shared';

// 회원 쓰기 실패 문구 — 서버 가드 코드(LEFT_MEMBER·SELF_FORBIDDEN·ADMIN_PROTECTED·*_DUPLICATE…)를
// admin.members.error.* 로 옮기고, 모르는 코드는 서버 메시지 → UNKNOWN 순으로 떨어진다(옛 드로어와 같은 식).
export function useMemberErrorText(): (err: unknown) => string | null {
  // te 는 구조분해하면 unbound-method(lint) — 컴포저 인스턴스로 호출한다
  const i18n = useI18n();
  return (err) => {
    if (err === null || err === undefined) return null;
    if (err instanceof ApiRequestError) {
      const code = err.payload?.error;
      if (code !== undefined && i18n.te(`admin.members.error.${code}`)) {
        return i18n.t(`admin.members.error.${code}`);
      }
      return err.payload?.message ?? i18n.t('admin.members.error.UNKNOWN');
    }
    return i18n.t('admin.members.error.UNKNOWN');
  };
}
