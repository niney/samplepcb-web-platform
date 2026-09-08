<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { useCreateDevelopRequest } from '../api/useDevelopRequests';
import { useRequestForm } from '../composables/useRequestForm';
import { developPath, loginUrl } from '../lib/auth-urls';
import { errorMessage } from '../lib/error-msg';
import StepMenu from '../components/request/StepMenu.vue';
import StepDescribe from '../components/request/StepDescribe.vue';
import StepQuestions from '../components/request/StepQuestions.vue';
import StepProduction from '../components/request/StepProduction.vue';
import StepReview from '../components/request/StepReview.vue';
import WizardAside from '../components/request/WizardAside.vue';

// 개발의뢰 위저드 v2 — 5스텝(개발 메뉴 → 의뢰 내용 → 세부 질문 → 제작 계획 → 검토·접수).
// 마켓 위저드와 달리 **AI 가 없다**: 검토서·구성도는 등록 뒤 서버가 관리자용 초안으로 만들고,
// 담당자가 검토한 뒤 공개한다. 그래서 이 화면에는 기다림도, 잡 상태도 없다.
// 셸이 하는 일 = 로그인 게이트 · 스텝 내비 · 임시저장 · 제출 · 완료 화면. 폼 값은 useRequestForm 이 소유한다.
// 확인 대화는 전부 인라인 패널이다(네이티브 confirm 금지).

const auth = useAuthStore();
const route = useRoute();
const loggedIn = computed(() => auth.isLoggedIn);
const create = useCreateDevelopRequest();

const submitError = ref('');
const createdId = ref<number | null>(null);
const askReset = ref(false);
// 스텝 오류는 "다음"을 눌러 본 뒤에만 띄운다 — 들어서자마자 빨간 줄이 뜨면 안내가 아니라 잔소리가 된다.
const tried = ref(false);

const form = useRequestForm();
const {
  contact,
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
  checkDraft,
  saveDraft,
  restoreDraft,
  clearDraft,
  resetAll,
} = form;

const savedLabel = computed(() => {
  const at = draftSavedAt.value;
  if (at === null) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
});
const draftSavedDateLabel = computed(() => {
  const at = draftFound.value?.savedAt ?? '';
  const d = new Date(at);
  if (at === '' || Number.isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
});

// 사이드 내비·"고치기" 로 스텝이 바뀌어도 앞 스텝의 오류 문구를 끌고 가지 않는다.
watch(stepIndex, () => {
  tried.value = false;
});

// 회원 정보 프리필 — 그누보드 브리지가 주는 것은 mbId·mbNick 뿐이라 이름 자리만 채운다(나머지는 직접 입력).
watch(
  () => auth.me,
  (me) => {
    if (me !== null && contact.name.trim() === '') contact.name = me.mbNick;
  },
  { immediate: true },
);

// 드롭존을 빗나간 파일 드롭 방어 — 기본 동작이면 브라우저가 그 파일을 이 탭에서 열어 작성 중인 의뢰가 사라진다.
function swallowDrop(e: DragEvent): void {
  e.preventDefault();
}
onMounted(() => {
  window.addEventListener('dragover', swallowDrop);
  window.addEventListener('drop', swallowDrop);
  checkDraft();
});
onBeforeUnmount(() => {
  window.removeEventListener('dragover', swallowDrop);
  window.removeEventListener('drop', swallowDrop);
});

function goLogin(): void {
  window.location.assign(loginUrl(developPath(route.fullPath)));
}
function goNext(): void {
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
function confirmReset(): void {
  resetAll();
  clearDraft();
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
  <section class="mx-auto w-full max-w-[1280px] px-6 pt-9" :class="loggedIn && createdId === null ? 'pb-32' : 'pb-16'">
    <div class="flex flex-wrap items-end gap-3">
      <div class="grid gap-1.5">
        <p class="font-mono text-micro tracking-[.14em] text-tx-3">NEW REQUEST</p>
        <h1 class="text-h1 font-extrabold text-tx-1">개발 의뢰하기</h1>
      </div>
      <div v-if="loggedIn && createdId === null" class="ml-auto flex flex-wrap items-center gap-2.5">
        <p v-if="savedLabel !== ''" class="text-label text-tx-3">저장됨 · {{ savedLabel }}</p>
        <button
          type="button"
          class="h-9 rounded-lg border border-line-2 bg-white px-4 text-label font-bold text-tx-2 transition hover:border-tx-3"
          @click="saveDraft"
        >
          임시저장
        </button>
        <button
          type="button"
          class="h-9 rounded-lg border border-line-2 bg-white px-4 text-label font-bold text-tx-3 transition hover:border-red-400 hover:text-red-600"
          @click="askReset = true"
        >
          처음부터
        </button>
      </div>
    </div>

    <!-- 비로그인 -->
    <div v-if="!loggedIn" class="mt-8 rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body text-tx-2">개발 의뢰는 로그인 후 진행할 수 있습니다.</p>
      <p class="mt-1.5 text-label text-tx-3">견적서·진행 상황·산출물을 계정에서 확인하실 수 있도록 회원 전용으로 운영합니다.</p>
      <button type="button" class="mt-5 h-11 rounded-lg bg-ink-950 px-6 text-body font-bold text-white transition hover:bg-brand-600" @click="goLogin">
        로그인하고 의뢰하기
      </button>
    </div>

    <!-- 완료 -->
    <div v-else-if="createdId !== null" class="mt-8 rounded-2xl border border-line bg-white p-10 text-center sm:p-12">
      <span class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500 text-white">
        <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 12.5 9.5 18 20 6.5" />
        </svg>
      </span>
      <h2 class="mt-4 text-title font-extrabold text-tx-1">개발의뢰가 접수되었습니다</h2>
      <p class="mx-auto mt-2 max-w-xl text-body leading-relaxed text-tx-2">
        담당자가 입력 내용과 첨부자료를 검토한 뒤 견적제안서를 전달드리겠습니다.
      </p>
      <p class="mt-4 font-mono text-label font-bold tabular-nums text-tx-1">접수번호 DEV-{{ createdId }}</p>
      <div class="mt-6 flex flex-wrap justify-center gap-2.5">
        <RouterLink
          :to="`/requests/${String(createdId)}`"
          class="h-11 rounded-lg bg-ink-950 px-6 text-body font-bold leading-[2.75rem] text-white transition hover:bg-brand-600"
        >
          의뢰 보기
        </RouterLink>
        <RouterLink
          to="/me"
          class="h-11 rounded-lg border border-line-2 bg-white px-6 text-body font-bold leading-[2.75rem] text-tx-2 transition hover:border-tx-3"
        >
          내 의뢰
        </RouterLink>
      </div>
    </div>

    <!-- 작성 -->
    <div v-else class="mt-7 grid items-start gap-8 lg:grid-cols-[1fr_300px]">
      <div class="min-w-0">
        <!-- 초안 복원 -->
        <div v-if="draftFound !== null" class="mb-6 grid gap-3 rounded-2xl border-2 border-ink-950 bg-white p-5">
          <div class="grid gap-1">
            <h2 class="text-body font-extrabold text-tx-1">이어서 작성할까요?</h2>
            <p class="text-label leading-relaxed text-tx-2">
              {{ draftSavedDateLabel === '' ? '저장해 둔 작성 내용' : `${draftSavedDateLabel} 에 저장한 내용` }}이 있습니다 —
              {{ draftFound.menu }}<template v-if="draftFound.title !== ''"> · {{ draftFound.title }}</template>
            </p>
            <p class="text-label text-tx-3">첨부한 파일은 저장되지 않습니다. 이어쓰기 후 다시 올려 주세요.</p>
          </div>
          <div class="flex flex-wrap gap-2.5">
            <button
              type="button"
              class="h-10 rounded-lg bg-ink-950 px-5 text-label font-bold text-white transition hover:bg-brand-600"
              @click="acceptDraft"
            >
              이어쓰기
            </button>
            <button
              type="button"
              class="h-10 rounded-lg border border-line-2 bg-white px-5 text-label font-bold text-tx-2 transition hover:border-tx-3"
              @click="clearDraft"
            >
              버리기
            </button>
          </div>
        </div>

        <!-- 처음부터 확인 -->
        <div v-if="askReset" class="mb-6 grid gap-3 rounded-2xl border-2 border-red-300 bg-white p-5">
          <div class="grid gap-1">
            <h2 class="text-body font-extrabold text-tx-1">처음부터 다시 작성할까요?</h2>
            <p class="text-label leading-relaxed text-tx-2">지금까지 입력한 내용과 임시저장한 초안이 모두 지워집니다.</p>
          </div>
          <div class="flex flex-wrap gap-2.5">
            <button
              type="button"
              class="h-10 rounded-lg bg-red-600 px-5 text-label font-bold text-white transition hover:bg-red-700"
              @click="confirmReset"
            >
              모두 지우고 처음부터
            </button>
            <button
              type="button"
              class="h-10 rounded-lg border border-line-2 bg-white px-5 text-label font-bold text-tx-2 transition hover:border-tx-3"
              @click="askReset = false"
            >
              그만두기
            </button>
          </div>
        </div>

        <!-- 모바일 진행 표시 -->
        <ol class="mb-6 flex gap-1.5 lg:hidden">
          <li v-for="(s, i) in steps" :key="s.key" class="grid flex-1 gap-1.5">
            <span class="h-1 rounded-full" :class="i <= stepIndex ? 'bg-brand-500' : 'bg-line'" />
            <span class="truncate text-micro font-bold" :class="i === stepIndex ? 'text-tx-1' : 'text-tx-3'">{{ s.label }}</span>
          </li>
        </ol>

        <StepMenu v-if="currentStep === 'menu'" :form="form" />
        <StepDescribe v-else-if="currentStep === 'describe'" :form="form" />
        <StepQuestions v-else-if="currentStep === 'questions'" :form="form" />
        <StepProduction v-else-if="currentStep === 'production'" :form="form" />
        <StepReview v-else :form="form" />

        <p v-if="submitError !== ''" class="mt-5 rounded-xl bg-red-50 px-4 py-3 text-body font-semibold text-red-700">{{ submitError }}</p>
      </div>

      <div class="hidden lg:sticky lg:top-20 lg:block">
        <WizardAside :form="form" />
      </div>
    </div>

    <!-- 하단 고정 액션 바 -->
    <div v-if="loggedIn && createdId === null" class="print-hidden fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur">
      <div class="mx-auto flex w-full max-w-[1280px] items-center gap-3 px-6 py-3.5">
        <button
          type="button"
          class="h-11 rounded-lg border border-line-2 bg-white px-5 text-body font-bold text-tx-2 transition hover:border-tx-3 disabled:opacity-40"
          :disabled="stepIndex === 0"
          @click="goPrev"
        >
          이전
        </button>
        <p v-if="tried && currentError !== ''" role="alert" class="min-w-0 flex-1 truncate text-label font-semibold text-red-600">
          {{ currentError }}
        </p>
        <p v-else class="hidden min-w-0 flex-1 truncate font-mono text-micro tabular-nums text-tx-3 sm:block">
          {{ stepIndex + 1 }} / {{ steps.length }}
        </p>
        <button
          v-if="!isLastStep"
          type="button"
          class="ml-auto h-11 rounded-lg px-7 text-body font-bold text-white transition"
          :class="stepValid ? 'bg-ink-950 hover:bg-brand-600' : 'bg-line-2 text-tx-3'"
          @click="goNext"
        >
          다음 단계 →
        </button>
        <button
          v-else
          type="button"
          class="ml-auto h-11 rounded-lg px-7 text-body font-bold text-white transition disabled:bg-line-2 disabled:text-tx-3"
          :class="stepValid ? 'bg-brand-500 hover:bg-brand-600' : 'bg-line-2 text-tx-3'"
          :disabled="create.isPending.value"
          @click="void submit()"
        >
          {{ create.isPending.value ? '접수 중…' : '개발의뢰 접수' }}
        </button>
      </div>
    </div>
  </section>
</template>
