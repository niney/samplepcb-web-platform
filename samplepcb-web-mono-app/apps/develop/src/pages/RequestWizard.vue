<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { useCreateDevelopRequest } from '../api/useDevelopRequests';
import { useRequestForm } from '../composables/useRequestForm';
import { developPath, loginUrl } from '../lib/auth-urls';
import { errorMessage } from '../lib/error-msg';
import StepDescribe from '../components/request/StepDescribe.vue';
import StepConditions from '../components/request/StepConditions.vue';
import StepContact from '../components/request/StepContact.vue';
import WizardAside from '../components/request/WizardAside.vue';

// 개발의뢰 위저드 3스텝(docs/DEVELOP_FLOW.md §7.2) — 의뢰 내용 → 조건·질문 → 연락처·확인.
// 마켓 위저드와 달리 **AI 가 없다**: 검토서·구성도는 등록 뒤 서버가 관리자용 초안으로 만들고,
// 담당자가 검토한 뒤 공개한다(§2 결정 3). 그래서 이 화면에는 기다림도, 잡 상태도 없다.
// 셸이 하는 일 = 로그인 게이트 · 스텝 내비 · 제출 · 완료 화면. 폼 값은 useRequestForm 이 소유한다.

const auth = useAuthStore();
const route = useRoute();
const loggedIn = computed(() => auth.isLoggedIn);
const create = useCreateDevelopRequest();

const submitError = ref('');
const createdId = ref<number | null>(null);

const form = useRequestForm();
const { fields, contact, steps, stepIndex, currentStep, isLastStep, stepValid, prev, next, buildAnswers, buildTools, buildContact, appendAttachments, totalAttachmentCount } = form;

const answeredCount = computed(() => buildAnswers().length);

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
});
onBeforeUnmount(() => {
  window.removeEventListener('dragover', swallowDrop);
  window.removeEventListener('drop', swallowDrop);
});

function goLogin(): void {
  window.location.assign(loginUrl(developPath(route.fullPath)));
}
function goNext(): void {
  next();
  window.scrollTo({ top: 0 });
}
function goPrev(): void {
  prev();
  window.scrollTo({ top: 0 });
}

async function submit(): Promise<void> {
  submitError.value = '';
  const payload = {
    title: fields.title.trim(),
    serviceAreas: [...fields.serviceAreas],
    tools: buildTools(),
    description: fields.description.trim(),
    answers: buildAnswers(),
    budgetRange: fields.budgetRange ?? 'undecided', // 2스텝 게이트가 null 을 막는다 — 타입 방어
    ndaWanted: fields.ndaWanted,
    aiConsent: fields.aiConsent,
    contact: buildContact(),
  };
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  appendAttachments(fd);
  try {
    const res = await create.mutateAsync(fd);
    createdId.value = res.data.requestId;
    window.scrollTo({ top: 0 });
  } catch (err) {
    submitError.value = errorMessage(err);
  }
}
</script>

<template>
  <section class="mx-auto w-full max-w-[1280px] px-6 pt-9" :class="loggedIn && createdId === null ? 'pb-32' : 'pb-16'">
    <p class="font-mono text-micro tracking-[.14em] text-tx-3">NEW REQUEST</p>
    <h1 class="mt-1.5 text-h1 font-extrabold text-tx-1">개발 의뢰하기</h1>

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
      <h2 class="mt-4 text-title font-extrabold text-tx-1">접수되었습니다</h2>
      <p class="mx-auto mt-2 max-w-xl text-body leading-relaxed text-tx-2">
        담당자가 검토 후 영업일 2~3일 안에 연락드립니다.
        <template v-if="fields.aiConsent"><br>AI 사전 검토서는 담당자 검토 후 공개됩니다.</template>
      </p>
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
        <!-- 모바일 진행 표시 -->
        <ol class="mb-6 flex gap-1.5 lg:hidden">
          <li
            v-for="(s, i) in steps"
            :key="s.key"
            class="grid flex-1 gap-1.5"
          >
            <span class="h-1 rounded-full" :class="i <= stepIndex ? 'bg-brand-500' : 'bg-line'" />
            <span class="text-micro font-bold" :class="i === stepIndex ? 'text-tx-1' : 'text-tx-3'">{{ s.label }}</span>
          </li>
        </ol>

        <StepDescribe v-if="currentStep === 'describe'" :form="form" />
        <StepConditions v-else-if="currentStep === 'conditions'" :form="form" />
        <StepContact v-else :form="form" />

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
        <p class="hidden min-w-0 flex-1 truncate font-mono text-micro tabular-nums text-tx-3 sm:block">
          {{ stepIndex + 1 }} / {{ steps.length }} · 답변 {{ answeredCount }} · 첨부 {{ totalAttachmentCount }}
        </p>
        <button
          v-if="!isLastStep"
          type="button"
          class="ml-auto h-11 rounded-lg bg-ink-950 px-7 text-body font-bold text-white transition hover:bg-brand-600 disabled:bg-line-2 disabled:text-tx-3"
          :disabled="!stepValid"
          @click="goNext"
        >
          다음
        </button>
        <button
          v-else
          type="button"
          class="ml-auto h-11 rounded-lg bg-brand-500 px-7 text-body font-bold text-white transition hover:bg-brand-600 disabled:bg-line-2 disabled:text-tx-3"
          :disabled="!stepValid || create.isPending.value"
          @click="void submit()"
        >
          {{ create.isPending.value ? '등록 중…' : '의뢰 등록' }}
        </button>
      </div>
    </div>
  </section>
</template>
