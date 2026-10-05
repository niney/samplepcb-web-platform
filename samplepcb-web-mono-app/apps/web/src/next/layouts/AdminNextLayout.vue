<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import 'vue-sonner/style.css';
import { SidebarInset, SidebarProvider } from '@/next/components/ui/sidebar';
import { Toaster } from '@/next/components/ui/sonner';
import type { NextMenuContext } from '@/next/admin-menu';
import AdminNextHeader from '@/next/components/app/AdminNextHeader.vue';
import AdminNextSidebar from '@/next/components/app/AdminNextSidebar.vue';
import ConfirmHost from '@/next/components/app/ConfirmHost.vue';
import PromptHost from '@/next/components/app/PromptHost.vue';
import { usePcbAdminMemory } from '@/next/components/app/usePcbAdminMemory';

// 관리자 리뉴얼 셸(shadcn-vue) — 옛 layouts/AdminLayout.vue 와 같은 배치(좌 사이드바 · 상단 헤더 ·
// 본문)를 새 디자인으로 그린다. PCB·SmartBOM 모듈이 이 셸을 쓴다(docs/ADMIN_NEXT_UI.md).
//
// html.sp-next — next/theme.css 의 전역 기본 스타일(테두리색·본문 배경) 범위. 이 셸이 떠 있을
// 때만 붙여 옛 화면으로 돌아가면 옛 기본 스타일 그대로다.
// 확인·입력 대화상자(@/next/lib/dialog)와 토스트(vue-sonner)의 호스트도 여기 하나씩 둔다.
const memory = usePcbAdminMemory();
const ctx = computed<NextMenuContext>(() => ({ pcbMemory: memory.value }));
// 작업대형 화면(BOM 업로드·매칭)은 본문 여백 없이 화면 높이를 채우고 안에서 스크롤한다(옛 셸 adminContentFlush 와 같음).
const route = useRoute();
const contentFlush = computed(() => route.meta.adminContentFlush === true);

onMounted(() => {
  document.documentElement.classList.add('sp-next');
});
onBeforeUnmount(() => {
  document.documentElement.classList.remove('sp-next');
});
</script>

<template>
  <SidebarProvider>
    <AdminNextSidebar :ctx="ctx" />
    <!-- min-w-0: 넓은 표가 본문을 밀어 페이지 전체가 가로로 넘치지 않고 표 카드 안에서만 스크롤되게 한다. -->
    <SidebarInset class="min-w-0" :class="contentFlush ? 'h-svh overflow-hidden' : ''">
      <AdminNextHeader :ctx="ctx" />
      <div v-if="contentFlush" class="flex min-h-0 min-w-0 flex-1 flex-col">
        <RouterView />
      </div>
      <div v-else class="flex min-w-0 flex-1 flex-col p-4 md:p-6">
        <RouterView />
      </div>
    </SidebarInset>
    <ConfirmHost />
    <PromptHost />
    <Toaster position="top-right" rich-colors close-button />
  </SidebarProvider>
</template>
