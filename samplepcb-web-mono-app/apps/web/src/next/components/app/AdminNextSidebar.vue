<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Badge } from '@/next/components/ui/badge';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/next/components/ui/sidebar';
import {
  effectiveMenuRouteName,
  isNextMenuActive,
  nextPcbMenu,
  type NextMenuItem,
} from '@/next/admin-menu';
import { pcbAdminSectionTo, type PcbAdminMemory } from '@/next/pcb-navigation';
import { usePcbMenuBadges } from './usePcbMenuBadges';

// 좌측 사이드바 — 옛 AdminLayout 의 사이드바와 같은 구성(앱 이름·부제 → 모듈 메뉴 → 하단 메뉴).
// 데스크톱은 아이콘 폭으로 접히고(Ctrl/⌘+B), 모바일(<768px)은 시트로 열린다.
const props = defineProps<{ memory: PcbAdminMemory }>();

const route = useRoute();
const { isMobile, setOpenMobile } = useSidebar();
const badges = usePcbMenuBadges();

const effectiveRouteName = computed(() =>
  effectiveMenuRouteName(typeof route.name === 'string' ? route.name : '', route.query.from),
);
const mainItems = computed(() => nextPcbMenu.filter((item) => item.placement !== 'bottom'));
const bottomItems = computed(() => nextPcbMenu.filter((item) => item.placement === 'bottom'));

const badgeCount = (item: NextMenuItem): number =>
  item.badge === undefined ? 0 : badges.value[item.badge];

// 모바일 시트는 이동하면 닫는다(옛 셸 mobileMenuOpen 과 같은 동작).
watch(
  () => route.fullPath,
  () => {
    if (isMobile.value) setOpenMobile(false);
  },
);
</script>

<template>
  <Sidebar collapsible="icon">
    <SidebarHeader>
      <div class="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
        <div class="grid min-w-0 flex-1">
          <RouterLink to="/" class="text-primary truncate text-base font-bold">{{ $t('app.name') }}</RouterLink>
          <span class="text-muted-foreground truncate text-xs">{{ $t('admin.title') }}</span>
        </div>
        <Badge variant="info">새 화면</Badge>
      </div>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>{{ $t('admin.modules.pcb') }}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in mainItems" :key="item.section">
              <SidebarMenuButton
                as-child
                :is-active="isNextMenuActive(item, effectiveRouteName)"
                :tooltip="$t(item.labelKey)"
              >
                <RouterLink :to="pcbAdminSectionTo(props.memory, item.section)">
                  <component :is="item.icon" />
                  <span>{{ $t(item.labelKey) }}</span>
                  <Badge
                    v-if="badgeCount(item) > 0"
                    variant="warning"
                    class="ml-auto group-data-[collapsible=icon]:hidden"
                  >
                    {{ badgeCount(item) }}
                  </Badge>
                </RouterLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter v-if="bottomItems.length > 0">
      <SidebarMenu>
        <SidebarMenuItem v-for="item in bottomItems" :key="item.section">
          <SidebarMenuButton
            as-child
            :is-active="isNextMenuActive(item, effectiveRouteName)"
            :tooltip="$t(item.labelKey)"
          >
            <RouterLink :to="pcbAdminSectionTo(props.memory, item.section)">
              <component :is="item.icon" />
              <span>{{ $t(item.labelKey) }}</span>
            </RouterLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template>
