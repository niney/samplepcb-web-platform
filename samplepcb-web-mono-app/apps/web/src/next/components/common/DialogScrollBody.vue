<script setup lang="ts">
// 대화상자 본문 스크롤 영역 — 내용이 길 때 머리·바닥(DialogHeader/Footer)은 두고 가운데만 스크롤한다.
// 높이는 화면 높이의 65% 한 값으로 맞춘다(화면마다 60·65·70vh 로 갈리던 것을 모음).
</script>

<template>
  <div class="-mx-6 max-h-[65vh] overflow-y-auto px-6">
    <slot />
  </div>
</template>
