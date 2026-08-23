import { computed, type WritableComputedRef } from 'vue';
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router';

// 워크큐 탭을 ?tab= 쿼리에 싣는다(포털 재설계 R3 — 관리자 워크큐 관례). 홈 카드·메일
// 딥링크가 특정 탭으로 바로 보낼 수 있고, 새로고침·뒤로가기에도 탭이 유지된다.
// 기본 탭은 쿼리에서 지워 URL 을 짧게 유지하고, 탭이 바뀌면 목록 페이지(page)는 되돌린다.
export function useRouteTab<K extends string>(
  keys: readonly K[],
  fallback: K,
): WritableComputedRef<K> {
  const route = useRoute();
  const router = useRouter();
  const isKey = (v: unknown): v is K => typeof v === 'string' && keys.some((k) => k === v);
  return computed<K>({
    get: () => {
      const raw = route.query.tab;
      return isKey(raw) ? raw : fallback;
    },
    set: (next) => {
      const query: LocationQueryRaw = { ...route.query };
      delete query.tab;
      delete query.page;
      if (next !== fallback) query.tab = next;
      void router.replace({ query });
    },
  });
}
