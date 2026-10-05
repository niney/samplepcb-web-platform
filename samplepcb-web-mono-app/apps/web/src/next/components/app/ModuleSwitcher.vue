<script setup lang="ts">
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import type { AdminModuleKey } from '@/admin/menu';
import { nextModuleLinks } from '@/next/admin-menu';

// 상단 업무 영역 전환(Module Switcher) — 통합·PCB·BOM·개발·마켓. 리뉴얼 셸은 PCB 화면만
// 그리므로 활성은 늘 PCB 이고, 다른 모듈은 아직 옛 화면 홈으로 이동한다.
const props = defineProps<{ pcbEntry: RouteLocationRaw }>();

const ACTIVE_MODULE: AdminModuleKey = 'pcb';
const modules = computed(() => nextModuleLinks(props.pcbEntry));
</script>

<template>
  <nav
    class="bg-muted text-muted-foreground flex h-8 min-w-0 items-center overflow-x-auto rounded-lg p-0.5"
    aria-label="업무 모듈"
  >
    <RouterLink
      v-for="mod in modules"
      :key="mod.key"
      :to="mod.to"
      class="rounded-md px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors"
      :class="mod.key === ACTIVE_MODULE
        ? 'bg-background text-foreground shadow-xs'
        : 'hover:text-foreground'"
      :aria-current="mod.key === ACTIVE_MODULE ? 'page' : undefined"
    >
      {{ $t(mod.labelKey) }}
    </RouterLink>
  </nav>
</template>
