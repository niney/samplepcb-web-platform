<script setup lang="ts">
import { computed } from 'vue';
import type { PartFacetBucketType } from '@sp/api-contract';
import Panel from '@/next/components/common/Panel.vue';
import { Button } from '@/next/components/ui/button';
import { supplierLabel, type PartFacetKey } from './part-format';

// 검색 결과 왼쪽 패싯 — 제조사·패키지·공급사. 누르면 그 값으로 좁히고 다시 누르면 푼다(토글은 화면이 한다).

const props = defineProps<{
  facets: {
    manufacturers: readonly PartFacetBucketType[];
    packages: readonly PartFacetBucketType[];
    suppliers: readonly PartFacetBucketType[];
  };
  selected: Partial<Record<PartFacetKey, string>>;
}>();
const emit = defineEmits<{ toggle: [key: PartFacetKey, value: string] }>();

const groups = computed<{ title: string; key: PartFacetKey; buckets: readonly PartFacetBucketType[] }[]>(() => [
  { title: '제조사', key: 'manufacturer', buckets: props.facets.manufacturers },
  { title: '패키지', key: 'packageCode', buckets: props.facets.packages },
  { title: '공급사', key: 'supplier', buckets: props.facets.suppliers },
]);

const label = (key: PartFacetKey, bucket: PartFacetBucketType): string =>
  key === 'supplier' ? supplierLabel(bucket.value) : bucket.value;
</script>

<template>
  <Panel tone="card" class="flex flex-col gap-4 text-sm shadow-xs">
    <div v-for="(group, gi) in groups" :key="group.key" :class="gi > 0 ? 'border-t pt-3' : ''">
      <h3 class="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wide uppercase">{{ group.title }}</h3>
      <ul class="flex flex-col gap-0.5">
        <li v-for="b in group.buckets" :key="b.value">
          <Button
            :variant="selected[group.key] === b.value ? 'secondary' : 'ghost'"
            size="sm"
            class="w-full justify-between"
            :aria-pressed="selected[group.key] === b.value"
            @click="emit('toggle', group.key, b.value)"
          >
            <span class="truncate" :class="selected[group.key] === b.value ? 'text-primary font-semibold' : 'font-normal'">
              {{ label(group.key, b) }}
            </span>
            <span class="text-muted-foreground shrink-0 tabular-nums">{{ b.count }}</span>
          </Button>
        </li>
        <li v-if="group.buckets.length === 0" class="text-muted-foreground px-2">—</li>
      </ul>
    </div>
  </Panel>
</template>
