import { ref } from 'vue';

// 확인 대화 — window.confirm 을 대신한다.
//
// 호출부가 서른 곳이 넘어 컴포넌트마다 상태·핸들러를 두면 코드가 그만큼 불어난다. 그래서
// 모양은 모달이되 쓰는 법은 confirm 그대로 두었다: `if (!(await confirmDialog('…'))) return;`
// 앱 루트에 UiConfirmHost 하나만 띄워 두면 어디서 불러도 그 호스트가 그린다.
//
// window.confirm 을 걷어내는 이유는 브라우저마다 모양이 다르고 사이트 톤과 따로 노는 것도
// 있지만, 결정적으로 "이 사이트에서 추가 대화상자를 표시하지 않음"을 한 번 체크하면 조용히
// false 가 되어 **조작이 통째로 막힌다**는 데 있다.

export interface ConfirmOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger 면 확인 버튼이 붉게 — 삭제·취소처럼 되돌리기 어려운 조작에. */
  tone?: 'default' | 'danger';
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/** 호스트가 구독하는 현재 요청 — 동시에 하나만 뜬다(직전 요청은 취소로 닫는다). */
export const pendingConfirm = ref<PendingConfirm | null>(null);

export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof options === 'string' ? { message: options } : options;
  // 앞선 물음이 남아 있으면 거절로 닫는다 — 답 없는 Promise 를 남기지 않는다.
  pendingConfirm.value?.resolve(false);
  return new Promise<boolean>((resolve) => {
    pendingConfirm.value = { ...opts, resolve };
  });
}

/** 호스트 전용 — 답이 정해지면 요청을 비운다. */
export function settleConfirm(ok: boolean): void {
  const pending = pendingConfirm.value;
  pendingConfirm.value = null;
  pending?.resolve(ok);
}
