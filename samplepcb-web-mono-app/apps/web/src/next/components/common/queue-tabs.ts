/** QueueTabs 한 칸. .vue 가 export 한 타입은 ESLint 프로그램에서 error 타입이 되므로 .ts 에 둔다. */
export interface QueueTab<T extends string> {
  key: T;
  label: string;
  /** null·undefined 면 건수를 비운다(아직 모름). */
  count?: number | null;
  /** 지금 내 차례인 칸 — 건수가 있으면 경고 배지로 띄운다. */
  attention?: boolean;
}
