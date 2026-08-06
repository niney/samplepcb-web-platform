<script setup lang="ts">
// 선택 삭제 툴바 — 선택이 있을 때만 뜬다. 진행현황·견적요청·대기 큐가 공유해
// 화면마다 문구·색이 갈라지지 않게 한다(견적 관리에서 정착한 형태).
defineProps<{ count: number }>();
defineEmits<{ delete: []; clear: [] }>();
</script>

<template>
  <div
    v-if="count > 0"
    class="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2"
  >
    <span class="text-sm font-medium text-red-700">{{ count }}건 선택됨</span>
    <button
      type="button"
      class="rounded-md bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
      @click="$emit('delete')"
    >
      선택 삭제
    </button>
    <button type="button" class="text-sm text-gray-500 hover:underline" @click="$emit('clear')">
      선택 해제
    </button>
  </div>
</template>
