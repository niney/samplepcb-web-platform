<script setup lang="ts">
import type { SmtField } from './smt-envelope';

// 견적서 칸 몇 개를 이름 · 값 격자로 — 견적 상세의 '주문 정보'(요율 판·조건·수량)가 같은 모양으로 쓴다.
// 이름 위에 마우스를 올리면 견적서의 칸 이름(key)이 보인다 — 원문과 맞춰 볼 때.
defineProps<{ title: string; fields: readonly SmtField[] }>();
</script>

<template>
  <div class="flex flex-col gap-2">
    <h3 class="text-muted-foreground text-xs font-medium">{{ title }}</h3>
    <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      <div v-for="field in fields" :key="field.key" class="min-w-0">
        <dt class="text-muted-foreground text-xs" :title="field.key">{{ field.label }}</dt>
        <dd class="mt-0.5 truncate font-medium tabular-nums" :title="field.value">{{ field.value }}</dd>
      </div>
    </dl>
  </div>
</template>
