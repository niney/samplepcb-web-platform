<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { nextModuleLinks, resolveNextModuleKey, type NextMenuContext } from '@/next/admin-menu';

// 상단 업무 영역 전환(Module Switcher) — 통합·PCB·BOM·개발·마켓. 리뉴얼된 모듈(통합·PCB·SmartBOM)은 리뉴얼
// 화면으로, 나머지(개발·마켓)는 아직 옛 화면 홈으로 이동한다. 활성 모듈은 지금 라우트에서 파생한다.
const props = defineProps<{ ctx: NextMenuContext }>();

const route = useRoute();
const activeModule = computed(() => resolveNextModuleKey(typeof route.name === 'string' ? route.name : ''));
const modules = computed(() => nextModuleLinks(props.ctx));
</script>

<template>
  <nav
    class="bg-muted text-muted-foreground flex h-9 min-w-0 items-center overflow-x-auto rounded-lg p-0.5"
    aria-label="업무 모듈"
  >
    <!-- 셸 헤더 크기 36px, 활성 모듈은 주 색 글자(옛 헤더·밑줄 탭의 활성 표시와 같은 색) -->
    <RouterLink
      v-for="mod in modules"
      :key="mod.key"
      :to="mod.to"
      class="rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
      :class="mod.key === activeModule
        ? 'bg-background text-primary shadow-xs'
        : 'hover:text-foreground'"
      :aria-current="mod.key === activeModule ? 'page' : undefined"
    >
      {{ $t(mod.labelKey) }}
    </RouterLink>
  </nav>
</template>
