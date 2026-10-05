import { ref } from 'vue';

// 리뉴얼 화면의 확인·입력 대화상자 — 옛 lib/confirmDialog.ts·UiPromptModal 의 짝.
//
// 쓰는 법은 window.confirm/prompt 그대로 둔다(호출부가 많아 컴포넌트마다 상태를 두면 불어난다):
//   if (!(await confirmDialog({ message: '…', tone: 'danger' }))) return;
//   const values = await promptDialog({ title: '…', fields: [...] }); if (values === null) return;
// 그리는 쪽(호스트)은 AdminNextLayout 이 하나씩 띄운다. 동시에 하나만 뜨고, 앞선 물음이 남아
// 있으면 거절(false/null)로 닫아 답 없는 Promise 를 남기지 않는다.

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

export const pendingConfirm = ref<PendingConfirm | null>(null);

export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof options === 'string' ? { message: options } : options;
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

// 옛 UiPromptModal 의 PromptField 와 같은 모양 — 화면을 옮길 때 필드 정의를 그대로 가져온다.
export interface PromptField {
  name: string;
  label: string;
  /** text=한 줄 · textarea=여러 줄(대외 문구) · date=YYYY-MM-DD · select=선택지(+직접입력) */
  type?: 'text' | 'textarea' | 'date' | 'select';
  required?: boolean;
  placeholder?: string;
  /** 필드 아래 보조 설명 */
  hint?: string;
  value?: string;
  maxlength?: number;
  /** select 전용 — 선택지. 기본으로 '직접입력'이 붙고, 초깃값이 목록 밖이면 직접입력으로 연다. */
  options?: readonly string[];
  /** select 전용 — false 면 '직접입력'을 막는다(닫힌 사전). 기본 true. */
  allowCustom?: boolean;
}

export interface PromptOptions {
  title: string;
  fields: readonly PromptField[];
  description?: string;
  confirmLabel?: string;
  tone?: 'default' | 'danger';
}

/** 확인하면 필드 name → 입력값(앞뒤 공백 제거), 취소하면 null. */
export type PromptResult = Record<string, string>;

interface PendingPrompt extends PromptOptions {
  resolve: (values: PromptResult | null) => void;
}

export const pendingPrompt = ref<PendingPrompt | null>(null);

export function promptDialog(options: PromptOptions): Promise<PromptResult | null> {
  pendingPrompt.value?.resolve(null);
  return new Promise<PromptResult | null>((resolve) => {
    pendingPrompt.value = { ...options, resolve };
  });
}

/** 호스트 전용. */
export function settlePrompt(values: PromptResult | null): void {
  const pending = pendingPrompt.value;
  pendingPrompt.value = null;
  pending?.resolve(values);
}
