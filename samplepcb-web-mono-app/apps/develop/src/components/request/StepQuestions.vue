<script setup lang="ts">
import { computed } from 'vue';
import type { MarketQuestionDef } from '@sp/api-contract';
import { AreaIcon, QuestionField } from '@sp/ui';
import type { DevelopRequestForm } from '../../composables/useRequestForm';
import type { FollowupJob } from '../../composables/useFollowupJob';

// 위저드 3스텝 — 세부 질문(2026-09-08 v2 + AI 후속 질문 §7.2.2).
// 시스템개발: AI 가 설명문과 첨부를 읽고 고른 질문(선택지형·서술형 섞임, 최대 8) + 디자인·기구 범위 2문항(선택지).
//   AI 가 꺼져 있거나 실패·시간 초과면 고정 서술 3문항(사용 상황·입출력·장애 시 동작)으로 조용히 폴백한다.
//   "전문가에게 맡김"이면 기술 질문을 통째로 건너뛰고 안내 박스 + 디자인·기구 범위 2문항만 남는다.
// 개별 견적: 고른 분야마다 문항을 그대로 나열한다(AI 질문은 시스템개발 전용이다).
// 전부 선택 사항이라 이 스텝에는 필수 검증이 없다 — 다만 선택지가 메모를 요구하면(noteRequiredFor) 막는다.
// 답변 상태는 폼 컴포저블이 들고 있으므로 스텝을 오갔다 돌아와도 그대로 남는다(AI 답도 마찬가지).
// 수정 화면도 이 컴포넌트를 쓴다 — 거기엔 잡이 없고(followup 미전달) 저장된 AI 질문을 그대로 편집한다.
const props = defineProps<{ form: DevelopRequestForm; followup?: FollowupJob }>();
const {
  systemMenu,
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

// 시스템개발 — 기술 문항(맡김·AI 질문이면 비어 있다)과 협업 범위 문항을 두 그룹으로 나눠 그린다.
const systemTechQuestions = computed<MarketQuestionDef[]>(() => askedQuestions.value.filter((q) => q.askOnDelegate !== true));
const systemCollabQuestions = computed<MarketQuestionDef[]>(() => askedQuestions.value.filter((q) => q.askOnDelegate === true));

// 잡 상태(위저드에서만 온다) — 수정 화면은 undefined 라 진행 패널도 폴백 안내도 없다.
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

const leadText = computed(() => {
  if (!isSystem.value) return '선택한 분야의 견적에 필요한 전문 사양입니다. 모르는 값은 담당자 제안 필요로 작성할 수 있습니다.';
  if (aiFollowupUsed.value) return '적어 주신 내용과 올려 주신 자료를 읽고, 견적에 꼭 필요한데 확인되지 않은 것만 묻습니다.';
  return '입력 내용과 등록자료에서 확인되지 않은 핵심 사항만 질문합니다.';
});
</script>

<template>
  <div class="grid gap-7">
    <div class="grid gap-2">
      <h2 class="text-title font-extrabold text-tx-1">{{ isSystem ? '시스템개발 추가 확인' : '개별 개발 전문 질문' }}</h2>
      <p class="text-body leading-relaxed text-tx-2">{{ leadText }}</p>
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

      <template v-else>
        <!-- AI 가 자료를 읽는 중 — 완성될 질문 자리를 미리 차지한다. 기다리지 않는 길도 같이 둔다. -->
        <section v-if="running" class="grid gap-4 rounded-2xl border-2 border-brand-200 bg-white p-5 sm:p-6">
          <div class="flex flex-wrap items-center gap-3.5">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <svg class="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M12 3a9 9 0 1 0 9 9" />
              </svg>
            </span>
            <div class="grid min-w-0 flex-1 gap-1">
              <p class="text-body font-extrabold text-tx-1">{{ stageLabel }}</p>
              <p class="text-label text-tx-3">
                경과 {{ elapsedLabel }} · 보통 30초에서 3분쯤 걸립니다. 이 화면을 열어 두시면 질문이 여기에 나타납니다.
              </p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2.5 border-t border-line pt-4">
            <button
              type="button"
              class="h-10 rounded-lg border border-line-2 bg-white px-5 text-label font-bold text-tx-2 transition hover:border-tx-3"
              @click="delegateInstead"
            >
              기다리지 않고 전문가에게 맡김으로 진행
            </button>
            <p class="text-label text-tx-3">기술값을 묻지 않고 담당자가 제안합니다.</p>
          </div>
        </section>

        <!-- AI 가 고른 질문 -->
        <section v-else-if="aiFollowupUsed" class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
          <div class="grid gap-1.5">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-body font-extrabold text-tx-1">확인이 필요한 항목</h3>
              <span class="rounded-full bg-brand-50 px-2.5 py-1 text-micro font-bold text-brand-700">AI 질문</span>
            </div>
            <p v-if="aiUnderstood !== ''" class="rounded-xl bg-paper px-4 py-3 text-label leading-relaxed text-tx-2">
              <b class="font-bold text-tx-1">AI 가 이해한 내용</b> — {{ aiUnderstood }}
            </p>
          </div>

          <template v-if="aiQuestionDefs.length > 0">
            <QuestionField
              v-for="item in aiQuestionDefs"
              :key="item.id"
              :question="item.def"
              :state="aiStateOf(item.id)"
              :note-missing="false"
              @toggle="toggleAiChoice(item.id, $event)"
              @note="aiStateOf(item.id).note = $event"
            />
          </template>
          <p v-else class="rounded-xl bg-paper px-4 py-3 text-body text-tx-2">자료가 충분해 추가 질문이 없습니다.</p>
        </section>

        <!-- 폴백 — 고정 서술 3문항 -->
        <section v-else-if="systemTechQuestions.length > 0" class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
          <div class="grid gap-1">
            <h3 class="text-body font-extrabold text-tx-1">분석 후 추가 확인</h3>
            <p v-if="fallbackNotice !== ''" class="text-label text-tx-3">{{ fallbackNotice }}</p>
          </div>
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
      </template>

      <!-- 디자인·기구 범위 2문항 — 맡김이어도, AI 질문을 써도 묻는다 -->
      <section v-if="systemCollabQuestions.length > 0" class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <div class="grid gap-1">
          <h3 class="text-body font-extrabold text-tx-1">제품 외관·기구 개발 범위</h3>
          <p class="text-label leading-relaxed text-tx-3">디자인과 기구설계는 각각 다른 곳에 맡길 수 있습니다. 분야별로 준비 방식을 알려주세요.</p>
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
