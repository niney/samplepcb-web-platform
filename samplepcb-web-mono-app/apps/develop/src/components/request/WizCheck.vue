<script setup lang="ts">
import checkOn from '../../assets/wizard/check-on.svg';
import checkOff from '../../assets/wizard/check-off.svg';

// 동의 체크 한 줄 — 피그마 01-2 70:1230(자료 사용 동의)·01-5 70:12884(비밀유지): 30px 체크 상자 + 20px 파란 문구 + 16px 회색 설명.
// 시안은 체크된 모양만 있어 빈 상자(check-off)는 같은 상자에서 체크 표시만 뺐고, 체크 전 문구는 검정으로 둔다.
const model = defineModel<boolean>({ required: true });
defineProps<{ label: string; hint?: string; required?: boolean }>();
</script>

<template>
  <label class="flex cursor-pointer items-start gap-[8px]">
    <input v-model="model" type="checkbox" class="peer sr-only">
    <img :src="model ? checkOn : checkOff" alt="" width="30" height="30" class="block size-[30px] shrink-0 rounded-[4px] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#2945e8]">
    <span class="flex min-w-0 flex-col gap-[6px] pt-[2px]">
      <span class="text-[17px] font-medium leading-[24px] sm:text-[20px]" :class="model ? 'text-[#2a46e8]' : 'text-black'">{{ label }}<span v-if="required" class="text-red-500"> *</span></span>
      <span v-if="hint !== undefined && hint !== ''" class="text-[15px] font-medium leading-[1.3] text-[#666] sm:text-[16px]">{{ hint }}</span>
    </span>
  </label>
</template>
