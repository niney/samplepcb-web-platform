<script setup lang="ts">
import { computed } from 'vue';
import type { MarketQuestionDef } from '@sp/api-contract';
import type { DevelopRequestForm } from '../../composables/useRequestForm';
import type { FollowupJob } from '../../composables/useFollowupJob';
import { WIZ } from '../../lib/wizard-copy';
import WizQuestion from './WizQuestion.vue';

// 위저드 3스텝 — 세부 질문(§7.2.2). 피그마 01-3(70:11880, 900 폭)은 시스템 개발의 폴백 판(기본 서술 3문항 + 외관·기구 범위 2문항)만 있다 —
// AI 가 읽는 중 · AI 질문 · 전문가에게 맡김 · 개별 견적 분야 질문은 같은 모양 언어(22px 섹션 제목 + 18px 질문 + 칩/회색 상자)로 그린다.
// 시스템개발: AI 가 설명문과 첨부를 읽고 고른 질문(선택지형·서술형 섞임, 최대 8) + 디자인·기구 범위 2문항.
//   AI 가 꺼져 있거나 실패·시간 초과면 고정 서술 3문항으로 조용히 폴백한다. 맡김이면 기술 질문을 건너뛰고 범위 2문항만.
// 개별 견적: 고른 분야마다 문항을 그대로 나열한다(AI 질문은 시스템개발 전용이다).
// 전부 선택 사항이라 필수 검증이 없다 — 다만 선택지가 메모를 요구하면(noteRequiredFor) 막는다.
// 수정 화면도 이 컴포넌트를 쓴다 — 거기엔 잡이 없고(followup 미전달) 저장된 AI 질문을 그대로 편집한다.
const props = defineProps<{ form: DevelopRequestForm; followup?: FollowupJob }>();
const {
  isSystem,
  skipQuestions,
  askedQuestions,
  pickedAreaDefs,
  areaQuestionsOf,
  stateOf,
  toggleChoice,
  noteMissingCodes,
  aiUnderstood,
  aiQuestionDefs,
  aiFollowupUsed,
  aiStateOf,
  toggleAiChoice,
} = props.form;

const systemTechQuestions = computed<MarketQuestionDef[]>(() => askedQuestions.value.filter((q) => q.askOnDelegate !== true));
const systemCollabQuestions = computed<MarketQuestionDef[]>(() => askedQuestions.value.filter((q) => q.askOnDelegate === true));

const running = computed(() => props.followup?.running.value ?? false);
const stageLabel = computed(() => props.followup?.stageLabel.value ?? '');
const fallbackNotice = computed(() => props.followup?.fallbackNotice.value ?? '');
const elapsedLabel = computed(() => {
  const secs = props.followup?.elapsedSecs.value ?? 0;
  return secs < 60 ? `${String(secs)}초` : `${String(Math.floor(secs / 60))}분 ${String(secs % 60)}초`;
});
function delegateInstead(): void {
  props.followup?.delegateInstead();
}
const PANEL = 'flex flex-col gap-[16px] rounded-[14px] border border-[#d9d9d9] bg-white px-[24px] py-[26px]';
</script>

<template>
  <div class="flex flex-col gap-[40px]">
    <template v-if="isSystem">
      <!-- 전문가에게 맡김 -->
      <section v-if="skipQuestions" :class="PANEL">
        <p class="text-[20px] font-bold leading-[1.3] text-black">전문가 검토로 접수합니다</p>
        <p class="text-[16px] font-medium leading-[1.6] text-[#666]">
          기술 사양을 추가로 입력하지 않아도 됩니다. 담당자가 요구사항과 자료를 검토해 필요한 개발 분야, 제안 사양과
          견적 전제를 정리합니다. 아래 역할 분담만 알려 주시면 견적 범위를 정하는 데 도움이 됩니다.
        </p>
      </section>

      <template v-else>
        <!-- AI 가 자료를 읽는 중 — 기다리지 않는 길도 같이 둔다 -->
        <section v-if="running" :class="PANEL" aria-live="polite">
          <div class="flex flex-wrap items-center gap-[14px]">
            <span class="flex size-[44px] shrink-0 items-center justify-center rounded-full bg-[#eef2ff] text-[#2945e8]">
              <svg class="size-[22px] animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M12 3a9 9 0 1 0 9 9" />
              </svg>
            </span>
            <div class="flex min-w-0 flex-1 flex-col gap-[4px]">
              <p class="text-[20px] font-bold leading-[1.3] text-black">{{ stageLabel }}</p>
              <p class="text-[15px] font-medium text-[#666]">경과 {{ elapsedLabel }} · 보통 30초에서 3분쯤 걸립니다. 이 화면을 열어 두시면 질문이 여기에 나타납니다.</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-[12px] border-t border-[#eee] pt-[16px]">
            <button
              type="button"
              class="flex h-[44px] items-center rounded-[8px] border border-[#2945e8] px-[18px] text-[15px] font-bold text-[#2945e8] transition-colors hover:bg-[#f1f6ff]"
              @click="delegateInstead"
            >
              기다리지 않고 전문가에게 맡김으로 진행
            </button>
            <p class="text-[15px] font-medium text-[#666]">기술값을 묻지 않고 담당자가 제안합니다.</p>
          </div>
        </section>

        <!-- AI 가 고른 질문 -->
        <section v-else-if="aiFollowupUsed" :class="WIZ.section">
          <div class="flex flex-col gap-[6px]">
            <h2 :class="WIZ.sectionTitle">
              확인이 필요한 항목
              <span class="ml-[6px] rounded-full bg-[#eef2ff] px-[10px] py-[3px] align-middle text-[13px] font-bold text-[#2945e8]">AI 질문</span>
            </h2>
            <p v-if="aiUnderstood !== ''" :class="WIZ.sectionLead"><b class="font-bold text-black">AI 가 이해한 내용</b> — {{ aiUnderstood }}</p>
          </div>
          <template v-if="aiQuestionDefs.length > 0">
            <WizQuestion
              v-for="item in aiQuestionDefs"
              :key="item.id"
              :question="item.def"
              :state="aiStateOf(item.id)"
              :note-missing="false"
              @toggle="toggleAiChoice(item.id, $event)"
              @note="aiStateOf(item.id).note = $event"
            />
          </template>
          <p v-else :class="WIZ.sectionLead">자료가 충분해 추가 질문이 없습니다.</p>
        </section>

        <!-- 폴백 — 고정 서술 3문항(시안 판) -->
        <section v-else-if="systemTechQuestions.length > 0" :class="WIZ.section">
          <div class="flex flex-col gap-[6px]">
            <h2 :class="WIZ.sectionTitle">분석 후 추가 확인</h2>
            <p v-if="fallbackNotice !== ''" :class="WIZ.sectionLead">{{ fallbackNotice }}</p>
          </div>
          <WizQuestion
            v-for="q in systemTechQuestions"
            :key="q.code"
            :question="q"
            :state="stateOf(q.code)"
            :note-missing="noteMissingCodes.includes(q.code)"
            @toggle="toggleChoice(q, $event)"
            @note="stateOf(q.code).note = $event"
          />
        </section>
      </template>

      <!-- 디자인·기구 범위 2문항 — 맡김이어도, AI 질문을 써도 묻는다 -->
      <section v-if="systemCollabQuestions.length > 0" :class="WIZ.section">
        <div class="flex flex-col gap-[6px]">
          <h2 :class="WIZ.sectionTitle">제품 외관·기구 개발 범위</h2>
          <p :class="WIZ.sectionLead">디자인과 기구설계는 각각 다른 곳에 맡길 수 있습니다. 분야별로 준비 방식을 알려 주세요.</p>
        </div>
        <WizQuestion
          v-for="q in systemCollabQuestions"
          :key="q.code"
          :question="q"
          :state="stateOf(q.code)"
          :note-missing="noteMissingCodes.includes(q.code)"
          @toggle="toggleChoice(q, $event)"
          @note="stateOf(q.code).note = $event"
        />
      </section>
    </template>

    <!-- 개별 견적 — 고른 분야마다 -->
    <template v-else>
      <section v-for="area in pickedAreaDefs" :key="area.code" :class="WIZ.section">
        <h2 :class="WIZ.sectionTitle">{{ area.label }}</h2>
        <WizQuestion
          v-for="q in areaQuestionsOf(area.code)"
          :key="q.code"
          :question="q"
          :state="stateOf(q.code)"
          :note-missing="noteMissingCodes.includes(q.code)"
          @toggle="toggleChoice(q, $event)"
          @note="stateOf(q.code).note = $event"
        />
      </section>
    </template>
  </div>
</template>
