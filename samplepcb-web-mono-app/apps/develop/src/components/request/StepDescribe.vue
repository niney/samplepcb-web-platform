<script setup lang="ts">
import { computed } from 'vue';
import {
  DEVELOP_BUDGET_RANGES,
  DEVELOP_BUDGET_RANGE_LABELS,
  DEVELOP_CURRENT_STAGES,
  DEVELOP_CURRENT_STAGE_LABELS,
  DEVELOP_TARGET_STAGES,
  DEVELOP_TARGET_STAGE_LABELS,
} from '@sp/api-contract';
import type { DevelopRequestForm } from '../../composables/useRequestForm';
import { WIZ } from '../../lib/wizard-copy';
import WizDropZone from './WizDropZone.vue';
import WizCheck from './WizCheck.vue';
import stageOn from '../../assets/wizard/stage-on.svg';
import stageOff from '../../assets/wizard/stage-off.svg';
import radioOn from '../../assets/wizard/radio-on.svg';
import radioOff from '../../assets/wizard/radio-off.svg';
import icoCalendar from '../../assets/wizard/ico-calendar.svg';
import icoSelect from '../../assets/wizard/ico-select.svg';

// 위저드 2스텝 — 의뢰 내용. 피그마 01-2(70:1069, 900 폭): 제목 입력(72) + 개발 목적(흰 상자 278) · 현재/목표 개발단계(점선으로
// 이은 라디오 줄) · 희망 완료 시기(날짜 242 + 'N개월' 칸)와 예산(선택 상자) · 참고 자료 드롭존 + 자료 사용 동의 · (시스템 개발이면)
// 진행 절차 2택. 제목은 입력·안내 모두 Medium(디자이너 체크리스트 2026-10 — 굵기 통일).
// 희망 시기는 날짜와 기간 중 하나만 있어도 된다(사용자 결정 2026-10-22). 기간 칸은 시안대로 'N개월' 모양이지만 저장은 예전 그대로
// 문구(wishNote)라, 숫자만 치면 '개월'을 붙이고 예전 의뢰의 '계약 후 3개월' 같은 문구도 그대로 둔다.
// 동의 체크가 여기 있는 이유: 시스템 개발 AI 질의가 2→3 전환에서 설명문과 첨부를 외부 AI 로 보낸다.
// 수정 화면도 이 컴포넌트를 쓴다 — 첨부는 거기서 즉시 반영하므로 그 블록을 끈다(동의도 접수 때 이미 받았다).
const props = withDefaults(defineProps<{ form: DevelopRequestForm; showAttachments?: boolean }>(), {
  showAttachments: true,
});
const { fields, isSystem, attachments, addAttachments, removeAttachment } = props.form;

// 개발단계 두 줄 — 같은 모양이라 한 목록으로 그리고, 고른 코드는 각 사전에서 다시 찾아 넣는다(문자열 캐스팅 없이).
type StageKey = 'current' | 'target';
const STAGE_GROUPS = [
  { key: 'current', title: '현재 개발단계', options: DEVELOP_CURRENT_STAGES.map((c) => ({ code: c, label: DEVELOP_CURRENT_STAGE_LABELS[c] })) },
  { key: 'target', title: '목표 개발단계', options: DEVELOP_TARGET_STAGES.map((c) => ({ code: c, label: DEVELOP_TARGET_STAGE_LABELS[c] })) },
] as const satisfies readonly { key: StageKey; title: string; options: { code: string; label: string }[] }[];
const stageOf = (key: StageKey): string | null => (key === 'current' ? fields.currentStage : fields.targetStage);
function pickStage(key: StageKey, code: string): void {
  if (key === 'current') {
    const hit = DEVELOP_CURRENT_STAGES.find((c) => c === code);
    if (hit !== undefined) fields.currentStage = hit;
    return;
  }
  const hit = DEVELOP_TARGET_STAGES.find((c) => c === code);
  if (hit !== undefined) fields.targetStage = hit;
}

// 날짜 상자는 시안 폭 242 라 요일까지는 안 들어간다 — 상자엔 날짜만, 요일은 title 로.
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;
const wishDateLabel = computed(() => (/^\d{4}-\d{2}-\d{2}$/.test(fields.wishDate) ? fields.wishDate.replace(/-/g, '.') : ''));
const wishDateTitle = computed(() => {
  if (wishDateLabel.value === '') return '희망 완료일';
  const [y, mo, da] = fields.wishDate.split('-').map(Number) as [number, number, number];
  return `${wishDateLabel.value} (${WEEKDAYS[new Date(y, mo - 1, da).getDay()] ?? ''}요일)`;
});
// 숫자만 적었으면 '개월'을 붙인다(0 은 비움). 문구는 건드리지 않는다.
function normalizeWishNote(): void {
  const m = /^\s*(\d{1,3})\s*$/.exec(fields.wishNote);
  if (m === null) return;
  const n = Number(m[1]);
  fields.wishNote = n === 0 ? '' : `${String(n)}개월`;
}
// 날짜 상자 전체를 누르면 달력을 연다(지원 안 하는 브라우저는 입력 칸 기본 동작 그대로).
function openPicker(e: Event): void {
  const input = e.currentTarget as HTMLInputElement;
  try {
    input.showPicker();
  } catch {
    // 일부 브라우저는 사용자 제스처 밖이거나 미지원이면 던진다 — 기본 동작에 맡긴다.
  }
}
</script>

<template>
  <div class="flex flex-col gap-[40px]">
    <!-- 제목 · 목적 -->
    <section :class="WIZ.section">
      <h2 :class="WIZ.sectionTitle">무엇을 개발하고 어떤 문제를 해결하고 싶으신가요? <span class="text-red-500">*</span></h2>
      <div class="flex flex-col gap-[14px]">
        <input
          v-model="fields.title"
          type="text"
          maxlength="200"
          placeholder="의뢰 제목을 입력하세요."
          aria-label="의뢰 제목"
          class="placeholder:text-[#555]"
          :class="WIZ.input"
        >
        <div class="flex flex-col gap-[10px]">
          <textarea
            v-model="fields.description"
            rows="8"
            maxlength="3000"
            aria-label="개발 목적"
            placeholder="예) 여러 센서의 값을 수집하고 설정 범위를 벗어나면 펌프와 솔레노이드 밸브를 자동으로 제어하는 장비가 필요합니다. 스마트폰에서 상태 확인과 설정 변경도 가능해야 합니다."
            class="min-h-[240px] leading-[1.6] sm:min-h-[278px]"
            :class="WIZ.textarea"
          />
          <p class="flex justify-between gap-[12px] text-[14px] font-medium leading-[1.6] sm:text-[15px]">
            <span class="text-[#666]">10자 이상. 자세히 적을수록 검토와 견적이 빨라집니다.</span>
            <span class="shrink-0 font-bold tabular-nums"><span class="text-[#2945e8]">{{ fields.description.length.toLocaleString('ko-KR') }}</span><span class="text-[#666]">/3,000</span></span>
          </p>
        </div>
      </div>
    </section>

    <!-- 현재 · 목표 개발단계 -->
    <section v-for="group in STAGE_GROUPS" :key="group.key" :class="WIZ.section">
      <h2 :class="WIZ.sectionTitle">{{ group.title }} <span class="text-red-500">*</span></h2>
      <div class="flex flex-wrap items-center gap-x-[10px] gap-y-[12px]" role="group" :aria-label="group.title">
        <template v-for="(opt, oi) in group.options" :key="opt.code">
          <span v-if="oi > 0" class="hidden h-px w-[24px] bg-[#d9d9d9] sm:block" aria-hidden="true" />
          <button
            type="button"
            class="flex items-center gap-[6px] text-[17px] font-bold leading-[1.2] sm:text-[20px]"
            :class="stageOf(group.key) === opt.code ? 'text-[#2945e8]' : 'text-black'"
            :aria-pressed="stageOf(group.key) === opt.code"
            @click="pickStage(group.key, opt.code)"
          >
            <img :src="stageOf(group.key) === opt.code ? stageOn : stageOff" alt="" width="24" height="24" class="block size-[24px] shrink-0">
            {{ opt.label }}
          </button>
        </template>
      </div>
    </section>

    <!-- 희망 완료 시기 · 예산 -->
    <section :class="WIZ.section">
      <h2 :class="WIZ.sectionTitle">희망 완료 시기와 예상 예산을 선택해 주세요. <span class="text-red-500">*</span></h2>
      <!-- 두 칸은 lg 부터 — 그보다 좁으면 왼쪽 칸이 날짜 242 를 빼고 'N개월'이 들어갈 폭이 안 남는다 -->
      <div class="grid gap-[16px] lg:grid-cols-2 lg:gap-[40px]">
        <!-- 날짜 242 · 쉼표 · 'N개월'(남은 폭) — 시안 188:22819 -->
        <div class="flex min-w-0 items-end gap-[8px]">
          <label
            class="relative flex h-[72px] w-[190px] shrink-0 cursor-pointer items-center justify-between gap-[8px] rounded-[14px] border border-[#d9d9d9] bg-white px-[18px] focus-within:border-[#2945e8] sm:h-[90px] sm:w-[242px] sm:px-[30px]"
            :title="wishDateTitle"
          >
            <img :src="icoCalendar" alt="" width="30" height="30" class="block size-[26px] shrink-0 sm:size-[30px]">
            <span
              class="whitespace-nowrap text-[17px] sm:text-[20px]"
              :class="wishDateLabel === '' ? 'font-semibold text-[#888]' : 'font-bold tabular-nums text-black'"
            >{{ wishDateLabel === '' ? '희망 완료일' : wishDateLabel }}</span>
            <input
              v-model="fields.wishDate"
              type="date"
              aria-label="희망 완료일"
              class="absolute inset-0 size-full cursor-pointer opacity-0"
              @click="openPicker"
            >
          </label>
          <span class="pb-[4px] text-[20px] font-semibold text-[#888]" aria-hidden="true">,</span>
          <input
            v-model="fields.wishNote"
            type="text"
            maxlength="200"
            placeholder="0개월"
            aria-label="희망 기간"
            title="계약 후 개발 기간(개월). 날짜와 기간 중 하나만 적어도 됩니다."
            class="h-[72px] min-w-0 flex-1 rounded-[14px] border border-[#d9d9d9] bg-white px-[18px] text-right text-[17px] font-semibold text-black outline-none placeholder:text-[#888] focus:border-[#2945e8] sm:h-[90px] sm:px-[30px] sm:text-[20px]"
            @blur="normalizeWishNote"
          >
        </div>
        <label :class="WIZ.selectBox">
          <select
            v-model="fields.budgetRange"
            aria-label="예상 개발 예산"
            class="absolute inset-0 size-full cursor-pointer appearance-none rounded-[14px] bg-transparent pl-[24px] pr-[64px] outline-none sm:pl-[30px]"
            :class="[WIZ.selectText, fields.budgetRange === null ? 'text-[#999]' : '']"
          >
            <option :value="null" disabled>예상 예산 선택</option>
            <option v-for="r in DEVELOP_BUDGET_RANGES" :key="r" :value="r">{{ DEVELOP_BUDGET_RANGE_LABELS[r] }}</option>
          </select>
          <img :src="icoSelect" alt="" width="30" height="30" class="pointer-events-none absolute right-[24px] block size-[30px] sm:right-[30px]">
        </label>
      </div>
    </section>

    <!-- 참고 자료 — 수정 화면은 첨부를 즉시 반영으로 따로 다룬다(showAttachments=false) -->
    <section v-if="showAttachments" :class="WIZ.section">
      <h2 :class="WIZ.sectionTitle">개발명세서와 참고자료를 올려주세요. (선택 사항)</h2>
      <div class="flex flex-col gap-[18px]">
        <WizDropZone :files="attachments" @add="addAttachments" @remove="removeAttachment" />
        <WizCheck
          v-model="fields.aiConsent"
          label="입력한 내용과 자료를 견적 검토와 AI 사전 검토 목적으로 사용하는 것에 동의합니다."
          required
          hint="시스템 개발에서 'AI 사전 검토 및 질의'를 고르면 다음 단계에서 AI 가 자료를 읽고 질문을 고릅니다."
        />
      </div>
    </section>

    <!-- 진행 절차 — 시스템 개발에서만 -->
    <section v-if="isSystem" :class="WIZ.section">
      <h2 :class="WIZ.sectionTitle">진행 절차를 선택해 주세요.</h2>
      <div class="grid gap-[16px] md:grid-cols-2 md:gap-[40px]" role="group" aria-label="진행 절차">
        <button
          v-for="opt in [
            { delegate: false, title: 'AI 사전 검토 및 질의', desc: '자료 검토 후 필요한 사항을 질문으로 확인합니다.' },
            { delegate: true, title: '전문가에게 맡김', desc: '기술값을 묻지 않고 담당자가 제안합니다.' },
          ]"
          :key="opt.title"
          type="button"
          class="relative flex min-h-[90px] items-center gap-[20px] rounded-[14px] bg-white px-[24px] py-[14px] text-left sm:px-[30px]"
          :aria-pressed="fields.expertDelegate === opt.delegate"
          @click="fields.expertDelegate = opt.delegate"
        >
          <img :src="fields.expertDelegate === opt.delegate ? radioOn : radioOff" alt="" width="30" height="30" class="block size-[30px] shrink-0">
          <span class="flex min-w-0 flex-col gap-[6px]">
            <span class="text-[18px] font-bold text-black sm:text-[20px]">{{ opt.title }}</span>
            <span class="text-[15px] font-medium leading-[1.3] text-[#666] sm:text-[16px]">{{ opt.desc }}</span>
          </span>
          <span
            class="pointer-events-none absolute inset-0 rounded-[14px]"
            :class="fields.expertDelegate === opt.delegate ? 'border-2 border-[#2945e8]' : 'border border-[#d9d9d9]'"
            aria-hidden="true"
          />
        </button>
      </div>
    </section>
  </div>
</template>
