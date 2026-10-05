import { ref, watch, type Ref } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import {
  readPcbAdminMemory,
  rememberPcbAdminView,
  resolvePcbAdminSection,
  type PcbAdminMemory,
} from '@/next/pcb-navigation';

// PCB 워크큐 기억 — 마지막으로 본 워크큐와 그 탭. 사이드바 메뉴 링크와 모듈 스위처의 PCB 진입이
// 같은 기억을 쓴다(옛 셸과 같은 동작, 저장 키는 리뉴얼 전용). 셸에서 한 번만 부른다.
export function usePcbAdminMemory(): Ref<PcbAdminMemory> {
  const auth = useAuthStore();
  const route = useRoute();
  const memory = ref<PcbAdminMemory>(readPcbAdminMemory(auth.me?.mbId));

  watch(
    () => auth.me?.mbId,
    (mbId) => {
      memory.value = readPcbAdminMemory(mbId);
    },
  );
  watch(
    [() => route.name, () => route.query.tab],
    ([routeName, rawTab]) => {
      const section = typeof routeName === 'string' ? resolvePcbAdminSection(routeName) : null;
      if (section === null) return;
      const tab = typeof rawTab === 'string' ? rawTab : undefined;
      memory.value = rememberPcbAdminView(auth.me?.mbId, section, tab);
    },
    { immediate: true },
  );

  return memory;
}
