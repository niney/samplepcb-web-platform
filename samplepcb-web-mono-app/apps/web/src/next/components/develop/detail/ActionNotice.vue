<script setup lang="ts">
// 조작 결과 한 줄 — 저장·전이·등록 뒤 그 자리에 남기는 성공/실패 문구(옛 화면의 notice·noticeError 쌍).
// 서버 가드 사유(INVALID_TRANSITION 등)를 그 조작 옆에 남겨야 해서 토스트가 아니라 인라인이다.
const props = defineProps<{ text: string; error: boolean }>();
</script>

<template>
  <p
    v-if="props.text !== ''"
    :role="props.error ? 'alert' : 'status'"
    class="text-sm font-medium"
    :class="props.error ? 'text-destructive' : 'text-success'"
  >
    {{ props.text }}
  </p>
</template>
