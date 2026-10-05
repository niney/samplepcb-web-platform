<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';
import { Separator } from '@/next/components/ui/separator';
import { SidebarTrigger } from '@/next/components/ui/sidebar';
import LegacyScreenLink from './LegacyScreenLink.vue';
import ModuleSwitcher from './ModuleSwitcher.vue';
import ProfileMenu from './ProfileMenu.vue';
import SiteHomeButton from './SiteHomeButton.vue';
import ThemeToggle from './ThemeToggle.vue';

// 상단 헤더 — 옛 셸과 같은 배치: 메뉴 버튼 · 모듈 스위처 · (우측) 이전 화면 · 테마 · 사이트 홈 · 프로필.
defineProps<{ pcbEntry: RouteLocationRaw }>();
</script>

<template>
  <header class="bg-background sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
    <SidebarTrigger />
    <Separator orientation="vertical" class="data-[orientation=vertical]:h-4" />
    <ModuleSwitcher :pcb-entry="pcbEntry" />
    <div class="ml-auto flex shrink-0 items-center gap-1">
      <LegacyScreenLink />
      <ThemeToggle />
      <SiteHomeButton />
      <ProfileMenu />
    </div>
  </header>
</template>
