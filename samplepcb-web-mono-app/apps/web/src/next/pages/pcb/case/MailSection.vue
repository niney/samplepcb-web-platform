<script setup lang="ts">
import { ChevronRightIcon, ChevronUpIcon } from '@lucide/vue';
import { Button } from '@/next/components/ui/button';
import MailLogList from '@/next/components/common/MailLogList.vue';
import { usePcbCaseContext } from './usePcbCase';

// 보낸 메일 — 이 Case 컨텍스트의 발송 이력(전 채널 원장 임베드). 조회용이라 기본 접힘.
const { specId, mailLogOpen } = usePcbCaseContext();
</script>

<template>
  <button
    v-if="!mailLogOpen"
    type="button"
    class="bg-card text-muted-foreground hover:bg-accent hover:text-foreground flex w-full items-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-sm"
    @click="mailLogOpen = true"
  >
    <ChevronRightIcon class="size-4" />
    <span>보낸 메일</span>
    <span class="ml-auto text-xs">펼치기</span>
  </button>
  <section v-else class="bg-card flex flex-col gap-3 rounded-xl border p-4 shadow-xs">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold">보낸 메일</h2>
      <Button variant="ghost" size="xs" @click="mailLogOpen = false">
        <ChevronUpIcon />
        접기
      </Button>
    </div>
    <MailLogList v-if="specId !== null" :fixed="{ refType: 'pcb_spec', refId: String(specId) }" :page-size="10" />
  </section>
</template>
