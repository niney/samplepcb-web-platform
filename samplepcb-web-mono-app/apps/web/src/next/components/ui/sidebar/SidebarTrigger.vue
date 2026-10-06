<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { PanelLeft } from "@lucide/vue"
import { cn } from '@/next/lib/utils'
import { Button } from '@/next/components/ui/button'
import { useSidebar } from "./utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()

const { toggleSidebar } = useSidebar()
</script>

<template>
  <!-- 관리자 리뉴얼: 셸 헤더 크기(32px·아이콘 18px) — 업스트림은 28px·16px -->
  <Button
    data-sidebar="trigger"
    data-slot="sidebar-trigger"
    variant="ghost"
    size="icon"
    :class="cn(props.class)"
    @click="toggleSidebar"
  >
    <PanelLeft class="size-4.5" :stroke-width="1.75" />
    <span class="sr-only">사이드바 열기·닫기</span>
  </Button>
</template>
