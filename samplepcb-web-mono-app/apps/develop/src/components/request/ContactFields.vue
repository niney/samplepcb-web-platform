<script setup lang="ts">
import { computed } from 'vue';
import type { DevelopRequestForm } from '../../composables/useRequestForm';

// 연락처 입력 4+1(이름·회사·전화·이메일·통화 가능 시간) — 위저드 3스텝과 수정 화면이 함께 쓴다.
// 형식 검사는 계약 DevelopContact 가 정본이고(등록 게이트), 여기는 입력 중 눈에 보이는 힌트만 낸다.
// 다른 스텝 컴포넌트와 같이 폼 전체를 받아 `contact` 를 꺼내 쓴다 — 값을 복사해 오가는 prop 이 아니라
// 폼이 소유한 reactive 상태를 그대로 편집하는 자리다(위저드·수정 화면이 같은 상태를 공유한다).
const props = defineProps<{ form: DevelopRequestForm }>();
const { contact } = props.form;

const phoneOk = computed(() => contact.phone.trim() === '' || /^[0-9+\-() ]{9,50}$/.test(contact.phone.trim()));
const emailOk = computed(() => contact.email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()));
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2">
    <label class="grid gap-2">
      <span class="text-label font-semibold text-tx-2">담당자 이름 <span class="text-red-500">*</span></span>
      <input
        v-model="contact.name"
        type="text"
        maxlength="100"
        placeholder="홍길동"
        class="h-11 rounded-lg border border-line-2 bg-white px-3.5 text-body text-tx-1 outline-none focus:border-brand-500"
      >
    </label>
    <label class="grid gap-2">
      <span class="text-label font-semibold text-tx-2">회사 <span class="font-normal text-tx-3">선택</span></span>
      <input
        v-model="contact.company"
        type="text"
        maxlength="200"
        placeholder="(주)샘플피씨비"
        class="h-11 rounded-lg border border-line-2 bg-white px-3.5 text-body text-tx-1 outline-none focus:border-brand-500"
      >
    </label>
    <label class="grid gap-2">
      <span class="text-label font-semibold text-tx-2">연락처 <span class="text-red-500">*</span></span>
      <input
        v-model="contact.phone"
        type="tel"
        maxlength="50"
        placeholder="010-0000-0000"
        class="h-11 rounded-lg border bg-white px-3.5 text-body text-tx-1 outline-none focus:border-brand-500"
        :class="phoneOk ? 'border-line-2' : 'border-red-400'"
      >
      <span v-if="!phoneOk" class="text-label font-semibold text-red-500">전화번호 형식이 아닙니다.</span>
    </label>
    <label class="grid gap-2">
      <span class="text-label font-semibold text-tx-2">이메일 <span class="text-red-500">*</span></span>
      <input
        v-model="contact.email"
        type="email"
        maxlength="191"
        placeholder="name@company.com"
        class="h-11 rounded-lg border bg-white px-3.5 text-body text-tx-1 outline-none focus:border-brand-500"
        :class="emailOk ? 'border-line-2' : 'border-red-400'"
      >
      <span v-if="!emailOk" class="text-label font-semibold text-red-500">이메일 형식이 아닙니다.</span>
    </label>
    <label class="grid gap-2 sm:col-span-2">
      <span class="text-label font-semibold text-tx-2">통화 가능한 시간 <span class="font-normal text-tx-3">선택</span></span>
      <input
        v-model="contact.hours"
        type="text"
        maxlength="100"
        placeholder="예: 평일 오후 2~6시 / 메일이 편합니다"
        class="h-11 rounded-lg border border-line-2 bg-white px-3.5 text-body text-tx-1 outline-none focus:border-brand-500"
      >
    </label>
  </div>
</template>
