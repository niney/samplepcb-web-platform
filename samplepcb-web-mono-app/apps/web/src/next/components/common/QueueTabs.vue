<script setup lang="ts" generic="T extends string">
import { Badge } from '@/next/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/next/components/ui/tabs';
import type { QueueTab } from './queue-tabs';

// 워크큐 탭 — 옛 관리자 화면과 같은 밑줄 탭(2026-10-06 사용자 결정): 줄 전체에 밑줄 한 줄, 활성 탭은 주 색 글자+밑줄,
// 탭이 많으면 다음 줄로 넘긴다(주문 상태 16칸도 이것 하나). 탭마다 건수 알약을 붙이고 null 이면(아직 모름) 비운다.
// attention 탭은 "지금 내가 움직여야 하는 칸"이라 건수가 있을 때 경고 알약으로 띄운다.
// 오른쪽 end 슬롯에는 검색 등 목록 도구를 둔다 — 탭과 같은 줄, 밑줄 위(좁은 화면에서는 아래로 내려간다).
const props = defineProps<{ tabs: readonly QueueTab<T>[] }>();
const model = defineModel<T>({ required: true });

const select = (value: string | number): void => {
  const match = props.tabs.find((tab) => tab.key === value);
  if (match !== undefined) model.value = match.key;
};
</script>

<template>
  <div class="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-b">
    <Tabs :model-value="model" class="min-w-0" @update:model-value="select">
      <TabsList>
        <TabsTrigger v-for="tab in tabs" :key="tab.key" :value="tab.key">
          {{ tab.label }}
          <Badge
            v-if="tab.count !== null && tab.count !== undefined"
            :variant="tab.attention === true && tab.count > 0 ? 'warning' : 'secondary'"
            class="tabular-nums"
          >
            {{ tab.count }}
          </Badge>
        </TabsTrigger>
      </TabsList>
    </Tabs>
    <div v-if="$slots.end !== undefined" class="flex flex-wrap items-center gap-2 pb-1.5">
      <slot name="end" />
    </div>
  </div>
</template>
