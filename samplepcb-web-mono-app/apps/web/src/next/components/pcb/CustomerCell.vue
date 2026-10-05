<script setup lang="ts">
// PCB 목록의 '고객명' 한 칸 — 사람 이름을 앞세우고 로그인 아이디를 작게 병기한다(2026-08-12 결정).
// 아이디만 두면 누구 건인지 모르고, 이름만 두면 동명이인·이름 없는 건에서 식별이 끊긴다.
// 이름은 말줄임(줄바꿈하면 열 많은 화면에서 글자 단위로 쪼개진다), 전체는 title 로 남긴다.
// 이름의 정본은 서버(lib/pcb-customer) — 화면은 빈 값을 어떻게 부를지만 정한다.
defineProps<{ name: string; mbId: string | null }>();
</script>

<template>
  <span class="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
    <span v-if="name !== ''" class="max-w-56 truncate font-medium" :title="name">{{ name }}</span>
    <span v-else class="text-muted-foreground">이름 없음</span>
    <span class="text-muted-foreground text-xs whitespace-nowrap">{{ mbId ?? '비회원' }}</span>
  </span>
</template>
