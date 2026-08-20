// 인쇄 격리 스타일 주입기 — 인쇄용 레이어 모달(견적서·발주서·패킹리스트·라벨 등)이
// 공통으로 쓰는 "body 자식을 전부 숨기고 내 호스트만 남긴다" 규칙의 수명을 관리한다.
//
// 왜 컴포저블인가 — 이 규칙은 셀렉터가 `body > :not(.내-호스트)` 라서 **문서에 존재하는
// 동안 다른 모달의 인쇄까지 통째로 지운다**. 그래서 규칙은 "그 모달이 실제로 열려 있는
// 동안"만 살아 있어야 한다. 두 방식이 실제로 결함을 만들었다(2026-08-20 실측):
//   1) SFC <style> 에 두면 임포트 시점부터 문서에 상주한다 — 모달을 연 적이 없어도.
//      (ShipmentPackingModal 이 이 방식이라 BOM 견적서 인쇄가 백지로 나왔다)
//   2) onMounted 주입은 마운트 수명이라, `v-if` 로 상주하고 open 만 토글하는 모달에서는
//      닫혀 있는 내내 규칙이 남아 다른 모달의 인쇄를 깬다.
// 명시도까지 겹쳐 `body > :not(.A)`(0,1,1) 가 피해자의 `.B{display:block!important}`(0,1,0)
// 를 이기므로, 피해자 쪽에서 방어할 수단이 없다 — 가해자가 규칙을 걷어가는 수밖에 없다.
//
// isOpen 을 주면 열림 수명, 생략하면 마운트 수명(모달 컴포넌트 자체를 v-if 로 감싸서
// 마운트 = 열림인 호출부용)으로 동작한다. 같은 styleId 를 쓰는 인스턴스가 여럿 살아 있을
// 수 있으므로(한 화면에 같은 모달이 여러 벌), 참조 카운트로 마지막 사용자만 걷어낸다.
import { onBeforeUnmount, watch, type Ref } from 'vue';

const USERS_ATTR = 'printIsolationUsers';

/**
 * @param styleId  주입할 <style> 의 id — 모달 종류마다 고유해야 한다.
 * @param css      `@media print { ... }` 를 포함한 전체 CSS 텍스트.
 * @param isOpen   열림 상태. 주면 열려 있는 동안만 규칙이 문서에 존재한다.
 */
export function usePrintIsolation(
  styleId: string,
  css: string,
  isOpen?: Ref<boolean> | (() => boolean),
): void {
  // 이 인스턴스가 지금 참조를 쥐고 있는지 — 중복 acquire/release 로 카운트가 어긋나지 않게 한다.
  let held = false;

  const acquire = (): void => {
    if (held) return;
    held = true;
    const existing = document.getElementById(styleId);
    if (existing === null) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = css;
      style.dataset[USERS_ATTR] = '1';
      document.head.appendChild(style);
      return;
    }
    existing.dataset[USERS_ATTR] = String(Number(existing.dataset[USERS_ATTR] ?? '0') + 1);
  };

  const release = (): void => {
    if (!held) return;
    held = false;
    const style = document.getElementById(styleId);
    if (style === null) return;
    const users = Math.max(0, Number(style.dataset[USERS_ATTR] ?? '1') - 1);
    if (users === 0) style.remove();
    else style.dataset[USERS_ATTR] = String(users);
  };

  if (isOpen === undefined) {
    acquire();
  } else {
    watch(
      typeof isOpen === 'function' ? isOpen : () => isOpen.value,
      (open) => {
        if (open) acquire();
        else release();
      },
      { immediate: true },
    );
  }

  // 열린 채로 언마운트되는 경로(라우트 이동 등)에서도 반드시 걷어낸다.
  onBeforeUnmount(release);
}
