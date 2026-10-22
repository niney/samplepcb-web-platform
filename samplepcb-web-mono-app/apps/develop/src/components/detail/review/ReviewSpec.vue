<script setup lang="ts">
import { computed, ref } from 'vue';
import { DEVELOP_REGISTRY } from '@sp/api-contract';
import type { DevReviewOpenQuestionType, MarketDevReviewType } from '@sp/api-contract';
import iconCircuit from '../../../assets/detail/spec-circuit.svg';
import iconPcb from '../../../assets/detail/spec-pcb.svg';
import iconFirmware from '../../../assets/detail/spec-firmware.svg';
import iconExpert from '../../../assets/detail/spec-expert.svg';

// 개발 명세서 카드 — 피그마 「00-3 의뢰 상세」 45:10535: 분야마다 파란 제목 + 명세 상자 2열 + 그 분야의
// "전문가 검토"(상의 항목) 상자. 상자는 접힌 채 질문 한 줄을 보이고, 펼치면 이유·확인 결과까지 보인다.
// 분야에 안 속하는 상의 항목(general)은 맨 뒤 "공통"으로 모은다. 아이콘은 시안에 있는 회로·PCB·펌웨어만.
const props = defineProps<{ review: MarketDevReviewType }>();

const ICONS: Record<string, string> = { circuit: iconCircuit, pcb: iconPcb, firmware: iconFirmware };

interface Group {
  key: string;
  label: string;
  icon: string | null;
  left: { item: string; text: string }[];
  right: { item: string; text: string }[];
  empty: boolean;
  questions: DevReviewOpenQuestionType[];
}
const groups = computed<Group[]>(() => {
  const areaCodes = new Set(props.review.areas.map((a) => a.area));
  const list: Group[] = props.review.areas.map((a) => {
    const half = Math.ceil(a.spec.length / 2);
    return {
      key: a.area,
      label: DEVELOP_REGISTRY.areaLabel(a.area),
      icon: ICONS[a.area] ?? null,
      left: a.spec.slice(0, half),
      right: a.spec.slice(half),
      empty: a.spec.length === 0,
      questions: props.review.openQuestions.filter((q) => q.area === a.area),
    };
  });
  const general = props.review.openQuestions.filter((q) => !areaCodes.has(q.area));
  if (general.length > 0) list.push({ key: 'general', label: '공통', icon: null, left: [], right: [], empty: false, questions: general });
  return list;
});

// 펼친 상의 항목 — "분야:순번" 키
const opened = ref(new Set<string>());
const isOpen = (k: string): boolean => opened.value.has(k);
function toggle(k: string): void {
  const next = new Set(opened.value);
  if (next.has(k)) next.delete(k);
  else next.add(k);
  opened.value = next;
}
const hasMore = (q: DevReviewOpenQuestionType): boolean => q.why !== '' || (q.resolution ?? '') !== '';
</script>

<template>
  <section class="flex flex-col gap-[26px] rounded-[14px] bg-white px-[24px] py-[26px] shadow-[0_8px_15px_rgba(0,0,0,0.06)]">
    <div class="flex flex-col gap-[2px] leading-[1.8]">
      <h3 class="text-[18px] font-bold text-black">개발 명세서</h3>
      <p class="text-[14px] text-[#666]">고객 자료에서 확정된 항목만 담았습니다. 나머지는 전문가가 상담 후 채웁니다.</p>
    </div>

    <div v-for="g in groups" :key="g.key" class="flex flex-col gap-[16px]">
      <p class="flex items-center gap-[6px] text-[18px] font-bold leading-[1.3] text-[#2945e8]">
        <img v-if="g.icon !== null" :src="g.icon" alt="" class="block size-[20px] shrink-0">{{ g.label }}
      </p>

      <div v-if="g.key !== 'general'" class="grid gap-[20px] md:grid-cols-2">
        <template v-if="!g.empty">
          <div class="flex flex-col gap-[14px] rounded-[10px] border border-[#d9d9d9] px-[16px] py-[14px]">
            <div v-for="(row, ri) in g.left" :key="ri" class="flex flex-col gap-[4px]">
              <p class="text-[16px] font-semibold leading-[1.3] text-black">{{ row.item }}</p>
              <p class="whitespace-pre-line text-[15px] leading-[1.8] text-[#141e34]">{{ row.text }}</p>
            </div>
          </div>
          <div v-if="g.right.length > 0" class="flex flex-col gap-[14px] rounded-[10px] border border-[#d9d9d9] px-[16px] py-[14px]">
            <div v-for="(row, ri) in g.right" :key="ri" class="flex flex-col gap-[4px]">
              <p class="text-[16px] font-semibold leading-[1.3] text-black">{{ row.item }}</p>
              <p class="whitespace-pre-line text-[15px] leading-[1.8] text-[#141e34]">{{ row.text }}</p>
            </div>
          </div>
        </template>
        <p v-else class="rounded-[10px] border border-[#d9d9d9] px-[16px] py-[14px] text-[15px] leading-[1.8] text-[#999] md:col-span-2">상담 후 작성</p>
      </div>

      <!-- 전문가 검토(상의 항목) -->
      <div
        v-for="(q, qi) in g.questions"
        :key="qi"
        class="flex flex-col gap-[4px] rounded-[10px] border border-[#d7deec] bg-[#f1f6ff] px-[16px] py-[14px]"
      >
        <div class="flex items-center justify-between gap-[12px]">
          <div class="flex min-w-0 flex-wrap items-center gap-x-[16px] gap-y-[4px]">
            <p class="flex shrink-0 items-center gap-[6px] text-[16px] font-bold leading-[1.3] text-black">
              <img :src="iconExpert" alt="" class="block size-[20px] shrink-0">전문가 검토
            </p>
            <p v-if="!isOpen(`${g.key}:${qi}`)" class="min-w-0 text-[15px] leading-[1.8] text-[#141e34]">
              <span class="text-[18px] font-semibold text-[#077ef6]">Q. </span>{{ q.question }}
            </p>
          </div>
          <button
            v-if="hasMore(q)"
            type="button"
            class="flex h-[34px] w-[84px] shrink-0 items-center justify-center rounded-[6px] bg-white text-[14px] leading-[1.3] text-[#0a151e] transition-colors hover:bg-[#e6ecf7]"
            :aria-expanded="isOpen(`${g.key}:${qi}`)"
            @click="toggle(`${g.key}:${qi}`)"
          >
            {{ isOpen(`${g.key}:${qi}`) ? '접기' : '내용 보기' }}
          </button>
        </div>
        <template v-if="isOpen(`${g.key}:${qi}`)">
          <p class="text-[15px] leading-[1.8] text-[#141e34]">
            <span class="text-[18px] font-semibold text-[#077ef6]">Q. </span>{{ q.question }}
          </p>
          <p v-if="q.why !== ''" class="whitespace-pre-wrap text-[15px] leading-[1.8] text-[#707b8f]">{{ `-  ${q.why}` }}</p>
          <p v-if="(q.resolution ?? '') !== ''" class="mt-[4px] rounded-[8px] bg-white px-[12px] py-[8px] text-[15px] leading-[1.8] text-[#141e34]">
            <b class="mr-[6px] font-semibold text-[#2945e8]">확인 결과</b>{{ q.resolution }}
          </p>
        </template>
      </div>
    </div>
  </section>
</template>
