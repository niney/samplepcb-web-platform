<script setup lang="ts">
import { computed } from 'vue';
import type { MarketQuestionDef } from '@sp/api-contract';
import { AreaIcon, QuestionField } from '@sp/ui';
import type { DevelopRequestForm } from '../../composables/useRequestForm';

// 위저드 3스텝 — 세부 질문(2026-09-08 v2, 프로토타입 그대로 간소화).
// 시스템개발: 서술 3문항(사용 상황·입출력·장애 시 동작) + 협업 범위 3문항(제품디자인·기구설계·협업 방식, 선택지).
//   "전문가에게 맡김"이면 서술 3문항은 건너뛰고 안내 박스 + 협업 범위 3문항만 남는다(역할 질문이라 기술값이 아니다).
// 개별 견적: 고른 분야마다 문항을 그대로 나열한다(희망 툴·분야별 자료 슬롯·접기는 프로토타입에 없어 뺐다 — PCB 설계 툴은 문항 `pcb.tool`).
// 전부 선택 사항이라 이 스텝에는 필수 검증이 없다 — 다만 선택지가 메모를 요구하면(noteRequiredFor) 막는다.
// 답변 상태는 폼 컴포저블이 들고 있으므로 스텝을 오갔다 돌아와도 그대로 남는다. 어느 문항을 보일지(askedQuestions)도 거기서 온다.
// 수정 화면도 이 컴포넌트를 그대로 쓴다.
const props = defineProps<{ form: DevelopRequestForm }>();
const { systemMenu, isSystem, skipQuestions, askedQuestions, pickedAreaDefs, areaQuestionsOf, stateOf, toggleChoice, noteMissingCodes } = props.form;

// 시스템개발 — 기술 문항(맡김이면 비어 있다)과 협업 범위 문항을 두 그룹으로 나눠 그린다.
const systemTechQuestions = computed<MarketQuestionDef[]>(() => askedQuestions.value.filter((q) => q.askOnDelegate !== true));
const systemCollabQuestions = computed<MarketQuestionDef[]>(() => askedQuestions.value.filter((q) => q.askOnDelegate === true));
</script>

<template>
  <div class="grid gap-7">
    <div class="grid gap-2">
      <h2 class="text-title font-extrabold text-tx-1">{{ isSystem ? '시스템개발 추가 확인' : '개별 개발 전문 질문' }}</h2>
      <p class="text-body leading-relaxed text-tx-2">
        {{
          isSystem
            ? '입력 내용과 등록자료에서 확인되지 않은 핵심 사항만 질문합니다.'
            : '선택한 분야의 견적에 필요한 전문 사양입니다. 모르는 값은 담당자 제안 필요로 작성할 수 있습니다.'
        }}
      </p>
      <div class="flex flex-wrap gap-2">
        <span v-if="isSystem" class="rounded-full bg-ink-950 px-3 py-1 text-micro font-bold text-white">{{ systemMenu.label }}</span>
        <template v-else>
          <span
            v-for="area in pickedAreaDefs"
            :key="area.code"
            class="rounded-full bg-paper px-3 py-1 text-micro font-bold text-tx-2"
          >{{ area.label }}</span>
        </template>
      </div>
    </div>

    <template v-if="isSystem">
      <!-- 전문가에게 맡김 -->
      <section v-if="skipQuestions" class="grid gap-2 rounded-2xl border-2 border-ink-950 bg-white p-5 sm:p-6">
        <h3 class="text-body font-extrabold text-tx-1">전문가 검토로 접수합니다</h3>
        <p class="text-body leading-relaxed text-tx-2">
          기술 사양을 추가로 입력하지 않아도 됩니다. 담당자가 요구사항과 자료를 검토해 필요한 개발 분야, 제안 사양과
          견적 전제를 정리합니다. 아래 역할 분담만 알려 주시면 견적 범위를 정하는 데 도움이 됩니다.
        </p>
      </section>

      <!-- 시스템개발 서술 3문항 -->
      <section v-if="systemTechQuestions.length > 0" class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <h3 class="text-body font-extrabold text-tx-1">분석 후 추가 확인</h3>
        <QuestionField
          v-for="q in systemTechQuestions"
          :key="q.code"
          :question="q"
          :state="stateOf(q.code)"
          :note-missing="noteMissingCodes.includes(q.code)"
          @toggle="toggleChoice(q, $event)"
          @note="stateOf(q.code).note = $event"
        />
      </section>

      <!-- 협업 범위 3문항 — 맡김이어도 묻는다 -->
      <section v-if="systemCollabQuestions.length > 0" class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <div class="grid gap-1">
          <h3 class="text-body font-extrabold text-tx-1">제품디자인·기구설계 및 협업 범위</h3>
          <p class="text-label leading-relaxed text-tx-3">디자인과 기구를 누가 맡는지에 따라 견적에 들어가는 항목이 달라집니다.</p>
        </div>
        <QuestionField
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

    <!-- 개별 견적 분야 카드 — 문항만 -->
    <template v-else>
      <section v-for="area in pickedAreaDefs" :key="area.code" class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <div class="flex items-center gap-3">
          <AreaIcon :code="area.code" size="sm" />
          <h3 class="text-title font-extrabold text-tx-1">{{ area.label }}</h3>
        </div>
        <QuestionField
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
