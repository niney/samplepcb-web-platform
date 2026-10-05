<script setup lang="ts">
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/next/components/ui/sheet';

// 자리표시 — 주문 상세 서랍(옛 components/admin/OrderDetailDrawer.vue 와 같은 props·emits). 작업 중.
const props = defineProps<{ odId: string | null }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Sheet :open="props.odId !== null" @update:open="(open) => { if (!open) emit('close'); }">
    <SheetContent>
      <SheetHeader>
        <SheetTitle>{{ props.odId }}</SheetTitle>
      </SheetHeader>
    </SheetContent>
  </Sheet>
</template>
