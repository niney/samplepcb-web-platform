<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { History } from '@lucide/vue';
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
  nextModuleOf,
  type NextMenuContext,
  type NextMenuItem,
} from '@/next/admin-menu';
import { useNextMenuBadges } from './useNextMenuBadges';

// 좌측 사이드바 — 옛 AdminLayout 의 사이드바와 같은 구성(앱 이름·부제 → 모듈 메뉴 → 하단 메뉴).
// 데스크톱은 아이콘 폭으로 접히고(Ctrl/⌘+B), 모바일(<768px)은 시트로 열린다. 메뉴는 지금 라우트의
// 모듈(통합·PCB·SmartBOM — next/admin-menu.ts 의 nextModules)을 그린다. 옛 화면으로 가는 메뉴(통합 견적관리)는
// 이름 뒤에 '이전 화면' 아이콘을 붙인다(머리의 '이전 화면' 버튼과 같은 아이콘).
const props = defineProps<{ ctx: NextMenuContext }>();

const route = useRoute();
const { isMobile, setOpenMobile } = useSidebar();
const badges = useNextMenuBadges();

const effectiveRouteName = computed(() =>
  effectiveMenuRouteName(typeof route.name === 'string' ? route.name : '', route.query.from),
);
const activeModule = computed(() => nextModuleOf(typeof route.name === 'string' ? route.name : ''));
const mainItems = computed(() => activeModule.value.items.filter((item) => item.placement !== 'bottom'));
const bottomItems = computed(() => activeModule.value.items.filter((item) => item.placement === 'bottom'));

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
        <SidebarGroupLabel>{{ $t(activeModule.labelKey) }}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in mainItems" :key="item.key">
              <SidebarMenuButton
                as-child
                :is-active="isNextMenuActive(item, effectiveRouteName)"
                :tooltip="$t(item.labelKey)"
              >
                <RouterLink
                  :to="item.to(props.ctx)"
                  :title="item.legacy === true ? '아직 이전 디자인 화면입니다' : undefined"
                >
                  <component :is="item.icon" />
                  <span>{{ $t(item.labelKey) }}</span>
                  <History v-if="item.legacy === true" class="text-muted-foreground" aria-label="이전 화면" />
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
        <SidebarMenuItem v-for="item in bottomItems" :key="item.key">
          <SidebarMenuButton
            as-child
            :is-active="isNextMenuActive(item, effectiveRouteName)"
            :tooltip="$t(item.labelKey)"
          >
            <RouterLink :to="item.to(props.ctx)">
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
