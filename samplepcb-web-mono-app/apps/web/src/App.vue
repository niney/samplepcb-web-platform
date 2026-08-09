<script setup lang="ts">
import UiConfirmHost from './components/ui/UiConfirmHost.vue';
</script>

<template>
  <RouterView />
  <!-- confirmDialog() 가 쓰는 단 하나의 호스트 — 어느 화면에서 불러도 여기서 그린다. -->
  <UiConfirmHost />
</template>
