import { onScopeDispose, watch } from 'vue';

/**
 * 조건이 참인 동안만 주기적으로 부른다 — 행 칩 'AI 분석 중'(D20 P2)이 끝났는지 발주 목록을 다시 읽는 데 쓴다.
 * 분석은 서버 뒤에서 돌고 끝나도 화면에 알림이 오지 않는다. 조건이 거짓이 되면(분석이 끝나 칩이 바뀌면) 멈추고,
 * 화면을 떠나면 정리한다. 분석 중인 줄이 없으면 타이머 자체가 없다.
 */
export function usePollWhile(active: () => boolean, tick: () => void, ms: number): void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = (): void => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };
  watch(
    active,
    (on) => {
      stop();
      if (on) timer = setInterval(tick, ms);
    },
    { immediate: true },
  );
  onScopeDispose(stop);
}
