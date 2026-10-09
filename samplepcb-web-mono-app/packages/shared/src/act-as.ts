import { ref } from 'vue';

// 관리자 대리 접속 상태 — 관리자가 협력사 포털을 **그 조직으로** 여는 동안의 조직 id.
// sessionStorage(탭 단위)에 둔다: 포털을 새 탭으로 열어 그 탭에서만 대리 접속하고, 관리자의
// 다른 탭(관리 콘솔)은 영향받지 않는다. 판정·인가는 전부 서버가 하고(관리자 토큰 + 헤더),
// 여기는 "어느 조직으로 부를지"만 기억한다.

const STORAGE_KEY = 'sp.actAsPartner';

const read = (): string | null => {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    return value !== null && /^\d+$/.test(value) ? value : null;
  } catch {
    return null;
  }
};

/** 대리 접속 중인 조직 id(문자열). null=대리 접속 아님. */
export const actAsPartnerId = ref<string | null>(read());

export function enterActAsPartner(partnerId: string): void {
  if (!/^\d+$/.test(partnerId)) return;
  actAsPartnerId.value = partnerId;
  try {
    sessionStorage.setItem(STORAGE_KEY, partnerId);
  } catch {
    // 저장이 막힌 브라우저 — 이 페이지가 살아 있는 동안만 유지된다
  }
}

export function exitActAsPartner(): void {
  actAsPartnerId.value = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 무시 — 메모리 값은 이미 비웠다
  }
}
