<script setup lang="ts">
// 목록 표를 담는 카드 — shadcn Card 는 머리·본문용 여백(py-6·gap-6)이 있어 표를 담으면 위아래가
// 뜬다. 표 전용 테두리 상자를 따로 둔다. 첫·끝 열은 카드 테두리에서 한 단 더 띄운다.
// bare 면 테두리·바탕 없이 양끝 여백만 — 이미 카드(SectionCard 등) 안에 있는 표에 쓴다.
const props = withDefaults(defineProps<{ bare?: boolean }>(), { bare: false });
</script>

<template>
  <div
    class="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4"
    :class="props.bare ? '' : 'bg-card text-card-foreground overflow-hidden rounded-xl border shadow-xs'"
  >
    <slot />
  </div>
</template>
