<script setup lang="ts">
// PCB 관리자 목록의 '고객명' 한 칸 — 사람 이름을 앞세우고 로그인 아이디를 작게 병기한다
// (사용자 결정 2026-08-12). 원래 이 열은 아이디만 보여 줬는데, 아이디는 송장에도 전화에도
// 못 쓰는 식별자라 운영자가 "누구 건인지"를 목록에서 알 수 없었다. 반대로 아이디를 지우면
// 동명이인·이름 없는 건에서 식별이 끊기므로 **둘 다** 싣는다.
// 이름의 정본은 서버 lib/pcb-customer(주문 시점 od_name > 회원 mb_name) — 화면은 빈 값을
// 어떻게 부를지만 정한다. 선적·배송 '고객' 열이 쓰던 표기를 그대로 전 목록으로 넓힌 것이다.
defineProps<{ name: string; mbId: string | null }>();
</script>

<!-- 이름은 truncate(=nowrap+말줄임) — 열이 아홉인 발주 화면에서 flex-wrap 만 두면 이름이
     **글자 단위로 쪼개져** 한 행이 세 줄이 된다. 폭이 모자라면 줄바꿈이 아니라 말줄임이
     맞다(전체 문자열은 title 로 남긴다). 아이디도 nowrap — 아이디가 접히면 더 못 읽는다. -->
<template>
  <span class="inline-flex flex-wrap items-baseline gap-x-1">
    <span
      v-if="name !== ''"
      class="max-w-[14rem] truncate font-medium text-gray-800"
      :title="name"
    >{{ name }}</span>
    <span v-else class="text-gray-400">이름 없음</span>
    <span class="whitespace-nowrap text-xs text-gray-400">{{ mbId ?? '비회원' }}</span>
  </span>
</template>
