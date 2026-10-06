<script setup lang="ts">
import type { AdminOrderTabType } from '@sp/api-contract';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import { Badge } from '@/next/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/next/components/ui/tabs';

// 주문상태 탭 16칸(표준 8 + 제작 8) — 공용 QueueTabs 와 같은 모양(건수·attention 경고 배지)이되 한 줄에 다 들어가지
// 않아 격자로 접는다: 넓은 화면 8칸 × 2줄(흐름 순서대로 왼→오, 위→아래), 좁으면 4칸씩. QueueTabs 의 한 줄 가로
// 스크롤로 두면 끝 칸(취소·부분취소 — 주의가 필요한 칸)이 화면 밖에 숨는다.
const props = defineProps<{ tabs: readonly QueueTab<AdminOrderTabType>[] }>();
const model = defineModel<AdminOrderTabType>({ required: true });

const select = (value: string | number): void => {
  const match = props.tabs.find((tab) => tab.key === value);
  if (match !== undefined) model.value = match.key;
};
</script>

<template>
  <Tabs :model-value="model" @update:model-value="select">
    <TabsList class="grid h-auto w-full grid-cols-4 xl:grid-cols-8">
      <TabsTrigger v-for="tab in props.tabs" :key="tab.key" :value="tab.key" class="h-7">
        {{ tab.label }}
        <template v-if="tab.count !== null && tab.count !== undefined">
          <Badge v-if="tab.attention === true && tab.count > 0" variant="warning">{{ tab.count }}</Badge>
          <span v-else class="text-muted-foreground text-xs tabular-nums">{{ tab.count }}</span>
        </template>
      </TabsTrigger>
    </TabsList>
  </Tabs>
</template>
