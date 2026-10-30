<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { DEVELOP_AREA_FOLLOWUP_LOCKED, DEVELOP_REVERSE_NOTICE } from '@sp/api-contract';
import type { MarketQuestionDef } from '@sp/api-contract';
import type { DevelopRequestForm } from '../../composables/useRequestForm';
import type { FollowupJob } from '../../composables/useFollowupJob';
import WizQuestion from './WizQuestion.vue';
import WizGroup from './WizGroup.vue';

// 위저드 3스텝 — 세부 질문(§7.2.2). 피그마 01-3(135:21515, 900 폭)은 시스템 개발의 폴백 판(기본 문항 + 외관·기구 범위 2문항)만
// 있다 — AI 가 읽는 중 · AI 질문 · 전문가에게 맡김 · 개별 견적 분야 질문은 같은 모양 언어로 그린다.
// 질문 묶음은 번호 붙은 접이식 제목(WizGroup, 26px) — 번호는 목차와 같게 실제로 그려지는 묶음만 센다(시안은 목차 1 = '분석 후 추가
// 확인'인데 본문은 외관·기구가 '1.' 이라 본문을 목차에 맞췄다). 목차(240, 본문 왼쪽 100 띄움)는 위저드에서만(toc) — 묶음이 2개
// 이상이고 화면이 1600 이상일 때(그보다 좁으면 본문 왼쪽에 자리가 없다). 시안 목차의 3~6번은 복사본 자리표시라 따르지 않는다.
// 시스템개발: AI 가 설명문과 첨부를 읽고 고른 질문(선택지형·서술형 섞임, 최대 8) + 디자인·기구 범위 2문항.
//   AI 가 꺼져 있거나 실패·시간 초과면 고정 문항(동작·환경·전원·연결·인증 5, 2026-10-30)으로 조용히 폴백한다. 맡김이면 기술 질문을 건너뛰고 범위 2문항만.
// 개별 메뉴: 고른 카드마다 한 묶음. 회로·펌웨어를 같이 고르면 통신 문항은 앞 묶음에서 한 번만,
//   '앱 및 서버'는 범위·작업 종류 뒤에 앱·서버 질문이 소제목과 함께, 역설계는 묶음 맨 위에 권리 안내(DEVELOP_REVERSE_NOTICE).
//   다른 답에 따라 나오는 문항(역설계 펌웨어 추출 자료·PCBA 검증)은 그 선택지를 골랐을 때만 보인다(계약 showWhen).
//   AI 맞춤 질문(§7.2.4)이 켜져 있으면: AI 가 도는 동안은 AI 에 맡기지 않는 질문(범위·권리 확인·필요 작업)만 먼저 보이고,
//   끝나면 자료에서 채운 질문엔 'AI 가 채움'과 근거, 고쳐 물은 질문엔 'AI 질문' 표시, 묶음 끝엔 새 질문이 붙는다.
//   꺼져 있거나 실패·기다리지 않음이면 기본 질문 그대로.
// 필수는 역설계 권리 확인 하나 — 그 밖엔 선택지가 메모를 요구할 때만(noteRequiredFor) 막는다.
// 수정 화면도 이 컴포넌트를 쓴다 — 거기엔 잡이 없고(followup 미전달) 저장된 AI 질문을 그대로 편집한다. 목차는 끈다.
const props = defineProps<{ form: DevelopRequestForm; followup?: FollowupJob; toc?: boolean }>();
const {
  isSystem,
  skipQuestions,
  askedQuestions,
  questionGroups,
  requiredMissingCodes,
  stateOf,
  toggleChoice,
  noteMissingCodes,
  aiUnderstood,
  aiQuestionDefs,
  aiFollowupUsed,
  aiStateOf,
  toggleAiChoice,
  areaUnderstood,
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
function skipToBasic(): void {
  props.followup?.skipToBasic();
}
// 개별 메뉴 맞춤 질문을 기다리는 중 — 그동안은 AI 에 맡기지 않는 질문만 그린다(답이 AI 결과와 부딪히지 않는다).
const areaRunning = computed(() => !isSystem.value && running.value);
const visibleItems = <T extends { question: MarketQuestionDef }>(items: readonly T[]): readonly T[] =>
  areaRunning.value ? items.filter((item) => DEVELOP_AREA_FOLLOWUP_LOCKED.includes(item.question.code)) : items;
const BADGE = 'ml-[8px] inline-block rounded-full px-[10px] py-[3px] align-middle text-[13px] font-bold leading-[1.3]';
// 기다리는 동안 먼저 물을 질문이 없는 묶음(회로·PCB·펌웨어)은 제목도 감춘다 — 빈 묶음 제목만 덩그러니 남지 않게.
const shownGroups = computed(() => (areaRunning.value ? questionGroups.value.filter((g) => visibleItems(g.items).length > 0) : questionGroups.value));

// ── 묶음 목록 = 번호 · 목차의 정본 ──────────────────────────────────────────
interface Group {
  id: string;
  title: string;
}
const GROUP_AI: Group = { id: 'q-ai', title: '확인이 필요한 항목' };
const GROUP_BASIC: Group = { id: 'q-basic', title: '분석 후 추가 확인' };
const GROUP_COLLAB: Group = { id: 'q-collab', title: '제품 외관·기구 개발 범위' };
const groups = computed<Group[]>(() => {
  if (!isSystem.value) return shownGroups.value.map((g) => ({ id: `q-area-${g.code}`, title: g.label }));
  const list: Group[] = [];
  if (!skipQuestions.value && !running.value) {
    if (aiFollowupUsed.value) list.push(GROUP_AI);
    else if (systemTechQuestions.value.length > 0) list.push(GROUP_BASIC);
  }
  if (systemCollabQuestions.value.length > 0) list.push(GROUP_COLLAB);
  return list;
});
const noOf = (id: string): number => groups.value.findIndex((g) => g.id === id) + 1;
const showToc = computed(() => props.toc && groups.value.length >= 2);

// 접힘은 기본 펼침 — 닫은 것만 기억한다. 메모가 빠졌거나 필수 답이 없는 문항이 든 묶음은 접어 두었어도 펼친다(오류 칸이 숨지 않게).
const closed = ref<Record<string, boolean>>({});
function groupCodes(id: string): string[] {
  if (id === GROUP_BASIC.id) return systemTechQuestions.value.map((q) => q.code);
  if (id === GROUP_COLLAB.id) return systemCollabQuestions.value.map((q) => q.code);
  const group = questionGroups.value.find((g) => `q-area-${g.code}` === id);
  return group === undefined ? [] : group.items.map((item) => item.question.code);
}
const isOpen = (id: string): boolean =>
  closed.value[id] !== true
  || groupCodes(id).some((code) => noteMissingCodes.value.includes(code) || requiredMissingCodes.value.includes(code));
function toggleGroup(id: string): void {
  closed.value = { ...closed.value, [id]: isOpen(id) };
}
async function jumpTo(id: string): Promise<void> {
  closed.value = { ...closed.value, [id]: false };
  await nextTick();
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const PANEL = 'flex flex-col gap-[16px] rounded-[14px] border border-[#d9d9d9] bg-white px-[24px] py-[26px]';
</script>

<template>
  <div class="flex flex-col gap-[40px] sm:gap-[50px]">
    <!-- 목차 — 피그마 137:21924: 240 폭 · #fdfdfe · 테두리 #eaeaec · r12. 본문 판(WizardShell, relative) 기준으로 본문 900 왼쪽 100 에
         붙이고(1920 에서 x130 = 시안), 스크롤하면 위 바 아래에 멈춘다. -->
    <nav
      v-if="showToc"
      class="pointer-events-none absolute bottom-[80px] left-[max(30px,calc(50%-790px))] top-[100px] hidden w-[240px] min-[1600px]:block"
      aria-label="세부 질문 목차"
    >
      <div class="pointer-events-auto sticky top-[92px] flex flex-col gap-[12px] rounded-[12px] border border-[#eaeaec] bg-[#fdfdfe] px-[20px] py-[18px]">
        <p class="text-[28px] font-bold leading-[1.3] text-black">목차</p>
        <ol class="flex flex-col gap-[6px]">
          <li v-for="(g, i) in groups" :key="g.id">
            <a
              :href="`#${g.id}`"
              class="block truncate text-[16px] font-medium leading-[1.7] text-[#2438ad] hover:underline"
              :title="g.title"
              @click.prevent="void jumpTo(g.id)"
            >{{ i + 1 }}. {{ g.title }}</a>
          </li>
        </ol>
      </div>
    </nav>

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
        <WizGroup
          v-else-if="aiFollowupUsed"
          :id="GROUP_AI.id"
          :no="noOf(GROUP_AI.id)"
          :title="GROUP_AI.title"
          :lead="aiUnderstood === '' ? '' : `AI 가 이해한 내용 — ${aiUnderstood}`"
          :open="isOpen(GROUP_AI.id)"
          @toggle="toggleGroup(GROUP_AI.id)"
        >
          <template #badge>
            <span class="ml-[8px] inline-block rounded-full bg-[#eef2ff] px-[10px] py-[3px] align-middle text-[13px] font-bold leading-[1.3] text-[#2945e8]">AI 질문</span>
          </template>
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
          <p v-else class="text-[16px] font-medium text-[#666]">자료가 충분해 추가 질문이 없습니다.</p>
        </WizGroup>

        <!-- 폴백 — 고정 문항(분석 후 추가 확인) -->
        <WizGroup
          v-else-if="systemTechQuestions.length > 0"
          :id="GROUP_BASIC.id"
          :no="noOf(GROUP_BASIC.id)"
          :title="GROUP_BASIC.title"
          :lead="fallbackNotice"
          :open="isOpen(GROUP_BASIC.id)"
          @toggle="toggleGroup(GROUP_BASIC.id)"
        >
          <WizQuestion
            v-for="q in systemTechQuestions"
            :key="q.code"
            :question="q"
            :state="stateOf(q.code)"
            :note-missing="noteMissingCodes.includes(q.code)"
            @toggle="toggleChoice(q, $event)"
            @note="stateOf(q.code).note = $event"
          />
        </WizGroup>
      </template>

      <!-- 디자인·기구 범위 2문항 — 맡김이어도, AI 질문을 써도 묻는다 -->
      <WizGroup
        v-if="systemCollabQuestions.length > 0"
        :id="GROUP_COLLAB.id"
        :no="noOf(GROUP_COLLAB.id)"
        :title="GROUP_COLLAB.title"
        lead="디자인과 기구설계는 각각 다른 곳에 맡길 수 있습니다. 분야별로 준비 방식을 알려 주세요."
        :open="isOpen(GROUP_COLLAB.id)"
        @toggle="toggleGroup(GROUP_COLLAB.id)"
      >
        <WizQuestion
          v-for="q in systemCollabQuestions"
          :key="q.code"
          :question="q"
          :state="stateOf(q.code)"
          :note-missing="noteMissingCodes.includes(q.code)"
          @toggle="toggleChoice(q, $event)"
          @note="stateOf(q.code).note = $event"
        />
      </WizGroup>
    </template>

    <!-- 개별 메뉴 — 고른 카드마다 -->
    <template v-else>
      <!-- AI 가 의뢰 내용에 맞춰 질문을 정리하는 중 — 기본 질문으로 바로 가는 길도 같이 둔다 -->
      <section v-if="areaRunning" :class="PANEL" aria-live="polite">
        <div class="flex flex-wrap items-center gap-[14px]">
          <span class="flex size-[44px] shrink-0 items-center justify-center rounded-full bg-[#eef2ff] text-[#2945e8]">
            <svg class="size-[22px] animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M12 3a9 9 0 1 0 9 9" />
            </svg>
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-[4px]">
            <p class="text-[20px] font-bold leading-[1.3] text-black">{{ stageLabel }}</p>
            <p class="text-[15px] font-medium text-[#666]">경과 {{ elapsedLabel }} · 보통 10초 안팎입니다. 자료에 이미 있는 답은 채워 두고 나머지만 여쭙니다.</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-[12px] border-t border-[#eee] pt-[16px]">
          <button
            type="button"
            class="flex h-[44px] items-center rounded-[8px] border border-[#2945e8] px-[18px] text-[15px] font-bold text-[#2945e8] transition-colors hover:bg-[#f1f6ff]"
            @click="skipToBasic"
          >
            기다리지 않고 기본 질문으로 진행
          </button>
        </div>
      </section>
      <p v-else-if="fallbackNotice !== ''" class="text-[16px] font-medium text-[#666]">{{ fallbackNotice }}</p>
      <p v-if="!areaRunning && areaUnderstood !== ''" class="rounded-[10px] bg-[#f5f6f8] px-[16px] py-[14px] text-[16px] font-medium leading-[1.7] text-[#141e34]">
        <b class="font-bold text-black">AI 가 이해한 내용</b> — {{ areaUnderstood }}
        <span class="block text-[14px] text-[#666]">자료에서 찾은 답은 미리 채워 두었습니다. 맞는지 확인하고 다르면 고쳐 주세요.</span>
      </p>
      <WizGroup
        v-for="group in shownGroups"
        :id="`q-area-${group.code}`"
        :key="group.code"
        :no="noOf(`q-area-${group.code}`)"
        :title="group.label"
        :lead="group.code === 'reverse' ? DEVELOP_REVERSE_NOTICE : ''"
        :open="isOpen(`q-area-${group.code}`)"
        @toggle="toggleGroup(`q-area-${group.code}`)"
      >
        <template v-for="item in visibleItems(group.items)" :key="item.question.code">
          <p v-if="item.heading !== null" class="border-t border-[#e5e5e5] pt-[24px] text-[20px] font-bold leading-[1.3] text-[#2438ad] sm:text-[22px]">
            {{ item.heading }}
          </p>
          <WizQuestion
            :question="item.question"
            :state="stateOf(item.question.code)"
            :note-missing="noteMissingCodes.includes(item.question.code)"
            @toggle="toggleChoice(item.question, $event)"
            @note="stateOf(item.question.code).note = $event"
          >
            <template v-if="item.source === 'covered'" #badge>
              <span :class="BADGE" class="bg-[#e6f4ee] text-[#0f7a55]">AI 가 채움</span>
            </template>
            <template v-else-if="item.source === 'asked'" #badge>
              <span :class="BADGE" class="bg-[#eef2ff] text-[#2945e8]">AI 질문</span>
            </template>
            <template v-if="item.source === 'covered' && item.evidence !== ''" #hint>
              <p class="-mt-[6px] text-[14px] font-medium leading-[1.6] text-[#666] sm:-mt-[14px]">근거 {{ item.evidence }}</p>
            </template>
          </WizQuestion>
        </template>
        <template v-if="!areaRunning">
          <WizQuestion
            v-for="item in group.added"
            :key="item.id"
            :question="item.def"
            :state="aiStateOf(item.id)"
            :note-missing="false"
            @toggle="toggleAiChoice(item.id, $event)"
            @note="aiStateOf(item.id).note = $event"
          >
            <template #badge>
              <span :class="BADGE" class="bg-[#eef2ff] text-[#2945e8]">AI 질문</span>
            </template>
          </WizQuestion>
        </template>
      </WizGroup>
    </template>
  </div>
</template>
