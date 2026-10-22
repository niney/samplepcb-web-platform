<script setup lang="ts">
import { computed } from 'vue';
import type { DevelopRequestForm } from '../../composables/useRequestForm';
import { WIZ } from '../../lib/wizard-copy';

// 연락처 입력 4칸(이름·회사·전화·이메일) — 피그마 01-5 70:12575: 2열(간격 40) · 18px 라벨 + 72px 입력.
// 위저드 5스텝과 수정 화면이 함께 쓴다. 형식 검사는 계약 DevelopContact 가 정본이고(등록 게이트), 여기는 입력 중 힌트만 낸다.
// 폼이 소유한 reactive 상태(contact)를 그대로 편집한다(위저드·수정 화면이 같은 상태를 공유한다).
const props = defineProps<{ form: DevelopRequestForm }>();
const { contact } = props.form;

const phoneOk = computed(() => contact.phone.trim() === '' || /^[0-9+\-() ]{9,50}$/.test(contact.phone.trim()));
const emailOk = computed(() => contact.email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()));
const LABEL = 'flex flex-col gap-[14px] sm:gap-[20px]';
</script>

<template>
  <div class="grid gap-[20px] sm:grid-cols-2 sm:gap-x-[40px] sm:gap-y-[26px]">
    <label :class="LABEL">
      <span :class="WIZ.question">담당자 이름 <span class="text-red-500">*</span></span>
      <input v-model="contact.name" type="text" autocomplete="name" maxlength="100" placeholder="홍길동" :class="WIZ.input">
    </label>
    <label :class="LABEL">
      <span :class="WIZ.question">회사 (선택)</span>
      <input v-model="contact.company" type="text" autocomplete="organization" maxlength="200" placeholder="(주)샘플피씨비" :class="WIZ.input">
    </label>
    <label :class="LABEL">
      <span :class="WIZ.question">연락처 <span class="text-red-500">*</span></span>
      <input
        v-model="contact.phone"
        type="tel"
        autocomplete="tel"
        maxlength="50"
        placeholder="010-0000-0000"
        :class="[WIZ.input, phoneOk ? '' : 'border-red-400']"
      >
      <span v-if="!phoneOk" class="text-[15px] font-semibold text-red-500">전화번호 형식이 아닙니다.</span>
    </label>
    <label :class="LABEL">
      <span :class="WIZ.question">이메일 <span class="text-red-500">*</span></span>
      <input
        v-model="contact.email"
        type="email"
        autocomplete="email"
        maxlength="191"
        placeholder="name@company.com"
        :class="[WIZ.input, emailOk ? '' : 'border-red-400']"
      >
      <span v-if="!emailOk" class="text-[15px] font-semibold text-red-500">이메일 형식이 아닙니다.</span>
    </label>
  </div>
</template>
