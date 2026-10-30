<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiGet, useAuthStore } from '@sp/shared';
import { apiRoutes, MeContact, type MeContactType } from '@sp/api-contract';
import { useCreateDevelopRequest } from '../api/useDevelopRequests';
import { useFollowupJob } from '../composables/useFollowupJob';
import { useRequestForm } from '../composables/useRequestForm';
import { developPath, loginUrl } from '../lib/auth-urls';
import { errorMessage } from '../lib/error-msg';
import StepMenu from '../components/request/StepMenu.vue';
import StepDescribe from '../components/request/StepDescribe.vue';
import StepQuestions from '../components/request/StepQuestions.vue';
import StepProduction from '../components/request/StepProduction.vue';
import StepReview from '../components/request/StepReview.vue';
import WizardShell from '../components/request/WizardShell.vue';
import WizardStepper from '../components/request/WizardStepper.vue';
import { INDIVIDUAL_QUESTIONS_COPY, STEP_COPY } from '../lib/wizard-copy';
import arrowNext from '../assets/wizard/arrow-next.svg';
import stepDone from '../assets/wizard/step-done.svg';
import lockIcon from '../assets/wizard/lock.png';

// 개발의뢰 위저드 v2 — 5스텝(개발 메뉴 → 의뢰 내용 → 세부 질문 → 제작 계획 → 검토·접수).
// 화면 = 피그마 「개발 의뢰」 01-0~01-5(Design done, 사용자 결정 2026-10-22·10-29): 위저드 전용 어두운 앱 셸(WizardShell — 사이트
// 헤더·푸터 없음, 라우트 meta.bare) · 위 바에 스텝 제목 + Save Draft · 안내 · PREVIOUS/NEXT(마지막 DONE) · 본문 판에 큰 제목·부제·
// 진행 표시·스텝. 오류는 안내 자리에 빨갛게 바꿔 띄운다. 시안에 없는 '처음부터'는 사용자 메뉴에, 이어쓰기·처음부터 확인은 본문
// 맨 위 띠. 비로그인은 01-0(자물쇠 화면) — 바 제목은 'Step1' 대신 '개발 의뢰', 오른쪽은 시안 숨김 레이어의 Login 버튼.
// 검토서·구성도는 등록 뒤 서버가 관리자용 초안으로 만들고 담당자가 검토한 뒤 공개한다 — 여기서 기다리지 않는다.
// 고객이 기다리는 잡은 3스텝 질문 하나뿐이다(useFollowupJob): 시스템개발 = AI 후속 질문(§7.2.2), 개별 메뉴 = AI 맞춤 질문(§7.2.4).
// 2→3 전환에서 시작해 3스텝이 진행을 보이고, 실패·시간 초과면 기본 문항으로 조용히 폴백한다.
// 셸이 하는 일 = 로그인 게이트 · 스텝 내비 · 잡 시작 신호 · 임시저장 · 제출 · 완료 화면. 폼 값은 useRequestForm 이 소유한다.
// 확인 대화는 전부 인라인 패널이다(네이티브 confirm 금지).

const auth = useAuthStore();
const route = useRoute();
const loggedIn = computed(() => auth.isLoggedIn);
const memberId = computed(() => loggedIn.value ? auth.me?.mbId ?? null : null);
const create = useCreateDevelopRequest();

const submitError = ref('');
const createdId = ref<number | null>(null);
const askReset = ref(false);
// 스텝 오류는 "다음"을 눌러 본 뒤에만 띄운다 — 들어서자마자 빨간 줄이 뜨면 안내가 아니라 잔소리가 된다.
const tried = ref(false);

const form = useRequestForm(memberId);
const {
  steps,
  stepIndex,
  currentStep,
  isLastStep,
  stepValid,
  currentError,
  prev,
  next,
  buildPayload,
  appendAttachments,
  draftFound,
  draftSavedAt,
  saveDraft,
  restoreDraft,
  clearDraft,
  resetAll,
} = form;

// 랜딩 분야 카드(?menu=<code>)에서 들어오면 그 메뉴를 고른 채 1스텝을 연다.
const menuQuery = route.query.menu;
if (typeof menuQuery === 'string') form.preselectMenu(menuQuery);

// AI 후속 질문 잡 — 3스텝에 들어설 때 시작하고, 진행 중에는 "다음 단계"를 막는다(질문이 나오기 전에 지나치지 않게).
const followup = useFollowupJob(form);
const nextBlocked = computed(() => currentStep.value === 'questions' && followup.running.value);

const savedLabel = computed(() => {
  const at = draftSavedAt.value;
  if (at === null) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
});
// Save Draft 는 시안 98px 버튼 하나뿐이라 '저장됨' 표시는 누른 직후 버튼 글자로 잠깐 바꾼다(시각은 title).
// 저장소가 막혀 실패하면 안내 자리에 빨갛게 띄운다.
const draftFlash = ref<'saved' | 'failed' | null>(null);
let draftFlashTimer: ReturnType<typeof setTimeout> | undefined;
function onSaveDraft(): void {
  saveDraft();
  draftFlash.value = draftSavedAt.value === null ? 'failed' : 'saved';
  clearTimeout(draftFlashTimer);
  draftFlashTimer = setTimeout(() => { draftFlash.value = null; }, draftFlash.value === 'saved' ? 2000 : 4000);
}
onBeforeUnmount(() => {
  clearTimeout(draftFlashTimer);
});
const draftSavedDateLabel = computed(() => {
  const at = draftFound.value?.savedAt ?? '';
  const d = new Date(at);
  if (at === '' || Number.isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
});

// 스텝 문구 — 3스텝은 시스템 개발/개별 견적에 따라 제목이 다르다. 완료·비로그인은 바 안내만 바꾼다.
const copy = computed(() => (currentStep.value === 'questions' && !form.isSystem.value ? INDIVIDUAL_QUESTIONS_COPY : STEP_COPY[currentStep.value]));
const stepLabels = computed(() => steps.value.map((s) => s.label));
const barTitle = computed(() => {
  if (!loggedIn.value) return '개발 의뢰';
  return createdId.value !== null ? '접수 완료' : copy.value.bar;
});
const guideError = computed(() => tried.value && currentError.value !== '' && createdId.value === null);
const draftFailed = computed(() => draftFlash.value === 'failed');
const guide = computed(() => {
  if (!loggedIn.value) return '로그인 해주세요.';
  if (createdId.value !== null) return '담당자가 검토한 뒤 연락드립니다.';
  if (submitError.value !== '') return submitError.value;
  if (draftFailed.value) return '이 브라우저에서는 임시저장을 할 수 없습니다.';
  return guideError.value ? currentError.value : copy.value.guide;
});

// "수정하기"·내비로 스텝이 바뀌어도 앞 스텝의 오류 문구·'Saved' 표시를 끌고 가지 않는다.
watch(stepIndex, () => {
  tried.value = false;
  draftFlash.value = null;
});

// 3스텝에 들어서면 잡을 확인한다 — 같은 입력이면 기존 잡으로 폴링만 하고, 바뀐 입력이면 다시 읽는다.
watch(
  currentStep,
  (key) => {
    if (key === 'questions') followup.ensure();
  },
  { immediate: true },
);

// 신규 의뢰 기본값은 회원당 한 번 조회한다. 토큰 갱신/스텝 이동은 재입력을 유발하지 않는다.
const memberContact = ref<MeContactType | null>(null);
watch(
  memberId,
  async (id, _previous, onCleanup) => {
    const pending = { active: true };
    onCleanup(() => { pending.active = false; });
    memberContact.value = null;
    createdId.value = null;
    submitError.value = '';
    askReset.value = false;
    tried.value = false;
    if (id === null) return;
    try {
      const profile = await apiGet(apiRoutes.meContact, MeContact);
      if (!pending.active || memberId.value !== id || profile.mbId !== id) return;
      memberContact.value = profile;
      form.prefillContact(profile);
    } catch {
      // 미등록/조회 실패여도 수동 입력과 의뢰 작성을 계속할 수 있다.
    }
  },
  { immediate: true, flush: 'sync' },
);

// 드롭존을 빗나간 파일 드롭 방어 — 기본 동작이면 브라우저가 그 파일을 이 탭에서 열어 작성 중인 의뢰가 사라진다.
function swallowDrop(e: DragEvent): void {
  e.preventDefault();
}
onMounted(() => {
  window.addEventListener('dragover', swallowDrop);
  window.addEventListener('drop', swallowDrop);
});
onBeforeUnmount(() => {
  window.removeEventListener('dragover', swallowDrop);
  window.removeEventListener('drop', swallowDrop);
});

function goLogin(): void {
  window.location.assign(loginUrl(developPath(route.fullPath)));
}
function goNext(): void {
  if (nextBlocked.value) return;
  if (!stepValid.value) {
    tried.value = true;
    return;
  }
  tried.value = false;
  next();
  window.scrollTo({ top: 0 });
}
function goPrev(): void {
  tried.value = false;
  prev();
  window.scrollTo({ top: 0 });
}
function acceptDraft(): void {
  tried.value = false;
  restoreDraft();
  window.scrollTo({ top: 0 });
}
// 사용자 메뉴에서 열면 확인 띠가 본문 맨 위에 뜬다 — 거기로 올려 보여 준다.
function openReset(): void {
  askReset.value = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function confirmReset(): void {
  resetAll();
  clearDraft();
  if (memberContact.value !== null) form.prefillContact(memberContact.value);
  askReset.value = false;
  tried.value = false;
  submitError.value = '';
  window.scrollTo({ top: 0 });
}

async function submit(): Promise<void> {
  if (!stepValid.value) {
    tried.value = true;
    return;
  }
  submitError.value = '';
  const fd = new FormData();
  fd.append('payload', JSON.stringify(buildPayload()));
  appendAttachments(fd);
  try {
    const res = await create.mutateAsync(fd);
    createdId.value = res.data.requestId;
    clearDraft();
    window.scrollTo({ top: 0 });
  } catch (err) {
    submitError.value = errorMessage(err);
  }
}
</script>

<template>
  <WizardShell :bar-title="barTitle" :guide="guide" :guide-error="guideError || submitError !== '' || draftFailed">
    <!-- Save Draft — 시안 98×34 흰 테두리(01-1 183:22720). 누른 직후 'Saved' 로 잠깐 바뀐다. -->
    <template v-if="loggedIn && createdId === null" #title-actions>
      <button
        type="button"
        class="flex h-[34px] min-w-[98px] items-center justify-center whitespace-nowrap rounded-[8px] border border-white px-[10px] text-[14px] font-bold text-white transition-colors hover:bg-white/10"
        :title="savedLabel === '' ? '작성 중인 내용을 이 브라우저에 저장합니다(첨부 파일 제외).' : `저장됨 · ${savedLabel}`"
        @click="onSaveDraft"
      >
        {{ draftFlash === 'saved' ? 'Saved ✓' : 'Save Draft' }}
      </button>
      <span class="sr-only" role="status">{{ draftFlash === 'saved' ? `임시저장했습니다 · ${savedLabel}` : '' }}</span>
    </template>
    <template v-if="loggedIn && createdId === null" #menu>
      <button type="button" class="rounded-[6px] px-[10px] py-[8px] text-left hover:bg-white/10" @click="openReset">처음부터 다시 작성</button>
    </template>

    <!-- 비로그인 — 시안 숨김 레이어(183:22538)의 'Login' 버튼 -->
    <template v-if="!loggedIn" #actions>
      <button
        type="button"
        class="flex h-[40px] w-[96px] items-center justify-center gap-[4px] rounded-[8px] bg-[#08d3e1] text-[14px] font-bold text-[#061023] transition-colors hover:bg-[#1bfffb] sm:w-[120px]"
        @click="goLogin"
      >
        Login <img :src="arrowNext" alt="" width="14" height="14" class="block size-[14px]">
      </button>
    </template>
    <template v-else-if="createdId === null" #actions>
      <button
        type="button"
        class="flex h-[40px] w-[96px] items-center justify-center rounded-[8px] bg-[#d9d9d9] text-[14px] font-bold uppercase text-[#061023] transition-opacity disabled:opacity-40 sm:w-[120px]"
        :disabled="stepIndex === 0"
        @click="goPrev"
      >
        Previous
      </button>
      <button
        v-if="!isLastStep"
        type="button"
        class="flex h-[40px] w-[96px] items-center justify-center gap-[4px] rounded-[8px] text-[14px] font-bold text-[#061023] transition-colors sm:w-[120px]"
        :class="stepValid && !nextBlocked ? 'bg-[#08d3e1] hover:bg-[#1bfffb]' : 'bg-[#08d3e1]/50'"
        :disabled="nextBlocked"
        @click="goNext"
      >
        <template v-if="nextBlocked">준비 중…</template>
        <template v-else>NEXT <img :src="arrowNext" alt="" width="14" height="14" class="block size-[14px]"></template>
      </button>
      <button
        v-else
        type="button"
        class="flex h-[40px] w-[96px] items-center justify-center gap-[4px] rounded-[8px] text-[14px] font-bold text-[#061023] transition-colors sm:w-[120px]"
        :class="stepValid ? 'bg-[#08d3e1] hover:bg-[#1bfffb]' : 'bg-[#08d3e1]/50'"
        :disabled="create.isPending.value"
        @click="void submit()"
      >
        <template v-if="create.isPending.value">접수 중…</template>
        <template v-else>DONE <img :src="arrowNext" alt="" width="14" height="14" class="block size-[14px]"></template>
      </button>
    </template>

    <!-- 비로그인 — 피그마 01-0(183:22384): 자물쇠 112 → 60 → 제목 38 → 20 → 부제 22 → 40 → LOGIN 200×51(본문 판 위에서 120) -->
    <div v-if="!loggedIn" class="mx-auto flex max-w-[900px] flex-col items-center text-center lg:mt-[50px]">
      <img :src="lockIcon" alt="" width="112" height="112" class="block size-[88px] sm:size-[112px]">
      <h1 class="mt-[40px] text-[28px] font-bold leading-[1.2] text-[#061023] sm:mt-[60px] sm:text-[38px]">개발 의뢰는 로그인 후 진행할 수 있습니다.</h1>
      <p class="mt-[20px] text-[17px] font-medium leading-[1.3] text-[#666] sm:text-[22px]">견적서·진행 상황·산출물을 계정에서 확인하실 수 있도록 회원 전용으로 운영합니다.</p>
      <button
        type="button"
        class="mt-[40px] flex h-[51px] w-[200px] items-center justify-center rounded-[8px] bg-[#08d3e1] px-[26px] text-[16px] font-bold uppercase text-black transition-colors hover:bg-[#1bfffb]"
        @click="goLogin"
      >
        Login
      </button>
    </div>

    <!-- 완료 -->
    <div v-else-if="createdId !== null" class="mx-auto flex max-w-[900px] flex-col items-center gap-[20px] py-[60px] text-center">
      <img :src="stepDone" alt="" width="28" height="28" class="block size-[64px]">
      <h1 class="text-[30px] font-bold leading-[1.2] text-[#061023] sm:text-[38px]">개발의뢰가 접수되었습니다</h1>
      <p class="max-w-[640px] text-[17px] font-medium leading-[1.5] text-[#666] sm:text-[20px]">
        담당자가 입력 내용과 첨부자료를 검토한 뒤 견적제안서를 전달드리겠습니다.
      </p>
      <p class="text-[18px] font-bold tabular-nums text-black">접수번호 DEV-{{ createdId }}</p>
      <div class="mt-[10px] flex flex-wrap justify-center gap-[14px]">
        <RouterLink
          :to="`/requests/${String(createdId)}`"
          class="flex h-[56px] items-center rounded-[8px] bg-[#2945e8] px-[28px] text-[18px] font-bold text-white transition-colors hover:bg-[#1f37c4]"
        >
          의뢰 보기
        </RouterLink>
        <RouterLink
          :to="{ name: 'me' }"
          class="flex h-[56px] items-center rounded-[8px] border border-[#2945e8] bg-white px-[28px] text-[18px] font-bold text-[#2945e8] transition-colors hover:bg-[#f1f6ff]"
        >
          내 의뢰
        </RouterLink>
      </div>
    </div>

    <!-- 작성 -->
    <template v-else>
      <div class="mx-auto flex w-full max-w-[900px] flex-col gap-[16px]">
        <!-- 초안 복원 -->
        <div v-if="draftFound !== null" class="flex flex-wrap items-center gap-[14px] rounded-[14px] border-2 border-[#2945e8] bg-white px-[24px] py-[18px]">
          <div class="flex min-w-0 flex-1 flex-col gap-[4px]">
            <h2 class="text-[18px] font-bold text-black">이어서 작성할까요?</h2>
            <p class="text-[15px] font-medium leading-[1.5] text-[#666]">
              {{ draftSavedDateLabel === '' ? '저장해 둔 작성 내용' : `${draftSavedDateLabel} 에 저장한 내용` }}이 있습니다 —
              {{ draftFound.menu }}<template v-if="draftFound.title !== ''"> · {{ draftFound.title }}</template>
              · 첨부한 파일은 저장되지 않아 다시 올려 주셔야 합니다.
            </p>
          </div>
          <div class="flex shrink-0 gap-[10px]">
            <button type="button" class="h-[44px] rounded-[8px] bg-[#2945e8] px-[18px] text-[15px] font-bold text-white hover:bg-[#1f37c4]" @click="acceptDraft">이어쓰기</button>
            <button type="button" class="h-[44px] rounded-[8px] border border-[#d9d9d9] bg-white px-[18px] text-[15px] font-bold text-[#333] hover:border-[#9aa3ad]" @click="clearDraft">버리기</button>
          </div>
        </div>

        <!-- 처음부터 확인 -->
        <div v-if="askReset" class="flex flex-wrap items-center gap-[14px] rounded-[14px] border-2 border-red-300 bg-white px-[24px] py-[18px]">
          <div class="flex min-w-0 flex-1 flex-col gap-[4px]">
            <h2 class="text-[18px] font-bold text-black">처음부터 다시 작성할까요?</h2>
            <p class="text-[15px] font-medium text-[#666]">지금까지 입력한 내용과 임시저장한 초안이 모두 지워집니다.</p>
          </div>
          <div class="flex shrink-0 gap-[10px]">
            <button type="button" class="h-[44px] rounded-[8px] bg-red-600 px-[18px] text-[15px] font-bold text-white hover:bg-red-700" @click="confirmReset">모두 지우고 처음부터</button>
            <button type="button" class="h-[44px] rounded-[8px] border border-[#d9d9d9] bg-white px-[18px] text-[15px] font-bold text-[#333] hover:border-[#9aa3ad]" @click="askReset = false">그만두기</button>
          </div>
        </div>
      </div>

      <!-- 제목 · 부제 · 진행 표시 -->
      <div class="mx-auto flex max-w-[1060px] flex-col items-center gap-[16px] text-center sm:gap-[20px]">
        <h1 class="text-[28px] font-bold leading-[1.2] text-[#061023] sm:text-[38px]">{{ copy.title }}</h1>
        <p class="text-[17px] font-medium leading-[1.3] text-[#666] sm:text-[22px]">{{ copy.lead }}</p>
      </div>
      <div class="mt-[40px] pb-[34px] sm:mt-[60px]">
        <WizardStepper :labels="stepLabels" :current="stepIndex" />
      </div>

      <div class="mx-auto mt-[26px] w-full sm:mt-[34px]" :class="currentStep === 'menu' ? 'max-w-[1060px]' : 'max-w-[900px]'">
        <StepMenu v-if="currentStep === 'menu'" :form="form" />
        <StepDescribe v-else-if="currentStep === 'describe'" :form="form" />
        <StepQuestions v-else-if="currentStep === 'questions'" :form="form" :followup="followup" toc />
        <StepProduction v-else-if="currentStep === 'production'" :form="form" />
        <StepReview v-else :form="form" />

        <p v-if="submitError !== ''" class="mt-[30px] rounded-[10px] bg-red-50 px-[16px] py-[12px] text-[16px] font-semibold text-red-700">{{ submitError }}</p>
      </div>
    </template>
  </WizardShell>
</template>
