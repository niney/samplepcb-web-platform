<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import 'vue-sonner/style.css';
import { SidebarInset, SidebarProvider } from '@/next/components/ui/sidebar';
import { Toaster } from '@/next/components/ui/sonner';
import { pcbAdminEntryTo } from '@/next/pcb-navigation';
import AdminNextHeader from '@/next/components/app/AdminNextHeader.vue';
import AdminNextSidebar from '@/next/components/app/AdminNextSidebar.vue';
import ConfirmHost from '@/next/components/app/ConfirmHost.vue';
import PromptHost from '@/next/components/app/PromptHost.vue';
import { usePcbAdminMemory } from '@/next/components/app/usePcbAdminMemory';

// 관리자 리뉴얼 셸(shadcn-vue) — 옛 layouts/AdminLayout.vue 와 같은 배치(좌 사이드바 · 상단 헤더 ·
// 본문)를 새 디자인으로 그린다. 지금은 PCB 모듈만 이 셸을 쓴다(docs/ADMIN_NEXT_UI.md).
//
// html.sp-next — next/theme.css 의 전역 기본 스타일(테두리색·본문 배경) 범위. 이 셸이 떠 있을
// 때만 붙여 옛 화면으로 돌아가면 옛 기본 스타일 그대로다.
// 확인·입력 대화상자(@/next/lib/dialog)와 토스트(vue-sonner)의 호스트도 여기 하나씩 둔다.
const memory = usePcbAdminMemory();
const pcbEntry = computed(() => pcbAdminEntryTo(memory.value));

onMounted(() => {
  document.documentElement.classList.add('sp-next');
});
onBeforeUnmount(() => {
  document.documentElement.classList.remove('sp-next');
});
</script>

<template>
  <SidebarProvider>
    <AdminNextSidebar :memory="memory" />
    <SidebarInset>
      <AdminNextHeader :pcb-entry="pcbEntry" />
      <div class="flex min-w-0 flex-1 flex-col p-4 md:p-6">
        <RouterView />
      </div>
    </SidebarInset>
    <ConfirmHost />
    <PromptHost />
    <Toaster position="top-right" rich-colors close-button />
  </SidebarProvider>
</template>
