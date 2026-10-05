<script setup lang="ts" generic="T extends string">
import { Badge } from '@/next/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/next/components/ui/tabs';
import type { QueueTab } from './queue-tabs';

// 워크큐 탭 — 탭마다 건수를 붙인다. 건수가 null 이면(아직 모름) 숫자를 비운다.
// attention 탭은 "지금 내가 움직여야 하는 칸"이라 건수가 있을 때 경고 배지로 띄운다.
// 오른쪽 end 슬롯에는 검색 등 목록 도구를 둔다(좁은 화면에서는 아래로 내려간다).
const props = defineProps<{ tabs: readonly QueueTab<T>[] }>();
const model = defineModel<T>({ required: true });

const select = (value: string | number): void => {
  const match = props.tabs.find((tab) => tab.key === value);
  if (match !== undefined) model.value = match.key;
};
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <Tabs :model-value="model" class="max-w-full overflow-x-auto" @update:model-value="select">
      <TabsList>
        <TabsTrigger v-for="tab in tabs" :key="tab.key" :value="tab.key">
          {{ tab.label }}
          <template v-if="tab.count !== null && tab.count !== undefined">
            <Badge v-if="tab.attention === true && tab.count > 0" variant="warning">{{ tab.count }}</Badge>
            <span v-else class="text-muted-foreground text-xs tabular-nums">{{ tab.count }}</span>
          </template>
        </TabsTrigger>
      </TabsList>
    </Tabs>
    <div v-if="$slots.end !== undefined" class="flex flex-wrap items-center gap-2">
      <slot name="end" />
    </div>
  </div>
</template>
