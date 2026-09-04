<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { useCreateProject } from '../api/useMarketProjects';
import { errorMessage } from '../lib/error-msg';
import { loginUrl, marketPath } from '../lib/auth-urls';
import { useRequestWizardForm } from '../composables/useRequestWizardForm';
import { useDevReviewJob } from '../composables/useDevReviewJob';
import StepDescribe from '../components/request/StepDescribe.vue';
import StepDetails from '../components/request/StepDetails.vue';
import StepReview from '../components/request/StepReview.vue';

// 재능마켓 의뢰 위저드 3스텝(docs/AI_DEV_REVIEW.md §13.4) — 의뢰 내용 → 몇 가지만 더 → 검토·등록.
// 이 셸은 스텝 인디케이터·네비게이션·제출 오케스트레이션만 한다. 폼 값·스텝 정의는
// useRequestWizardForm, 검토서 잡·신선도는 useDevReviewJob(스텝 이동에도 살아 있도록
// 셸이 소유한다).
// 등록 payload 는 검토서 본문을 싣지 않는다 — jobId 만 보내고 서버가 자기 저장분을 쓴다.

const auth = useAuthStore();
const route = useRoute();
const loggedIn = computed(() => auth.isLoggedIn);
const create = useCreateProject();

const submitError = ref('');
const createdId = ref<number | null>(null);

const form = useRequestWizardForm();
const job = useDevReviewJob(form);
const {
  fields,
  steps,
  stepIndex,
  currentStep,
  isLastStep,
  stepValid,
  prev,
  next,
  projectDeadline,
  buildAnswers,
  buildTools,
  appendAttachments,
} = form;

// 등록 가능 여부 — 폼 유효성 + "포함 예정 검토서가 생성 중이 아님".
const canProceed = computed(
  () => stepValid.value && !(currentStep.value === 'review' && job.blocking.value),
);
const registerHelp = computed<string>(() =>
  currentStep.value === 'review' && job.blocking.value
    ? "AI 사전 검토서 생성이 끝나면 등록됩니다 — 기다리지 않으려면 '검토서 없이 바로 등록'을 누르세요"
    : '',
);

function goLogin(): void {
  window.location.assign(loginUrl(marketPath(route.fullPath)));
}

async function submit(): Promise<void> {
  submitError.value = '';
  const payload = {
    title: fields.title.trim(),
    serviceAreas: [...fields.serviceAreas],
    tools: buildTools(),
    description: fields.description.trim(),
    answers: buildAnswers(),
    aiConsent: fields.aiConsent,
    ndaRequired: fields.ndaRequired,
    budgetRange: fields.budgetRange,
    deadline: projectDeadline(),
    method: fields.method,
    ...(fields.method === 'targeted' && fields.targetExpertId !== null
      ? { targetExpertId: fields.targetExpertId }
      : {}),
    ...(job.includable.value && job.jobId.value !== null
      ? { devReviewJobId: job.jobId.value }
      : {}),
    // 시스템 구성도 잡(§13.7) — 검토서와 같은 입력이므로 stale 판정도 같이 따른다.
    ...(!job.stale.value && job.diagramJobId.value !== null ? { devDiagramJobId: job.diagramJobId.value } : {}),
  };
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  appendAttachments(fd);
  try {
    const res = await create.mutateAsync(fd);
    createdId.value = res.data.projectId;
  } catch (err) {
    submitError.value = errorMessage(err);
  }
}
</script>

<template>
  <section class="mx-auto w-full max-w-6xl px-4 py-10">
    <p class="font-mono text-[11px] tracking-widest text-tx-3">NEW REQUEST</p>
    <h1 class="mt-1 text-2xl font-extrabold text-tx-1">{{ $t('nav.request') }}</h1>

    <!-- 비로그인 -->
    <div v-if="!loggedIn" class="mt-8 rounded-2xl border border-line bg-white p-10 text-center">
      <p class="text-sm text-tx-2">프로젝트 의뢰는 로그인 후 진행할 수 있습니다.</p>
      <button
        type="button"
        class="mt-4 rounded-lg bg-ink-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-ink-800"
        @click="goLogin"
      >
        {{ $t('auth.login') }}
      </button>
    </div>

    <!-- 완료 -->
    <div v-else-if="createdId !== null" class="mt-8 rounded-2xl border border-line bg-white p-10 text-center">
      <p class="text-3xl">🎉</p>
      <h2 class="mt-3 text-lg font-extrabold text-tx-1">의뢰가 등록되었습니다</h2>
      <p class="mt-2 text-sm leading-relaxed text-tx-2">
        <template v-if="fields.method === 'targeted'">지정한 전문가에게 견적 요청을 알렸습니다.</template>
        <template v-else>조건이 맞는 전문가들이 블라인드 견적을 제출하면 알려드립니다.</template>
        <br>견적 비교·채택은 프로젝트 상세 또는 마이페이지에서 진행하세요.
        <template v-if="fields.aiConsent"><br>시스템 구성도는 자료가 충분하면 몇 분 뒤 상세에 붙습니다 — 우측 아래 알림과 메일로 알려드립니다.</template>
      </p>
      <div class="mt-5 flex justify-center gap-2">
        <RouterLink
          :to="`/projects/${String(createdId)}`"
          class="rounded-lg bg-copper-500 px-4 py-2 text-xs font-bold text-white hover:bg-copper-600"
        >
          프로젝트 확인
        </RouterLink>
        <RouterLink
          to="/me"
          class="rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2"
        >
          {{ $t('nav.me') }}
        </RouterLink>
      </div>
    </div>

    <!-- 위저드 -->
    <template v-else>
      <ol class="mt-6 flex flex-wrap items-center gap-2 text-xs font-bold">
        <li v-for="(s, i) in steps" :key="s.key" class="flex items-center gap-2">
          <span
            class="flex h-6 w-6 items-center justify-center rounded-full"
            :class="
              stepIndex === i
                ? 'bg-copper-500 text-white'
                : stepIndex > i
                  ? 'bg-ink-900 text-white'
                  : 'bg-line text-tx-3'
            "
          >
            {{ i + 1 }}
          </span>
          <span :class="stepIndex === i ? 'text-tx-1' : 'text-tx-3'">{{ s.label }}</span>
          <span v-if="i < steps.length - 1" class="text-line-2">─</span>
        </li>
      </ol>

      <div class="mt-6 rounded-2xl border border-line bg-white p-6 sm:p-8">
        <StepDescribe v-if="currentStep === 'describe'" :form="form" />
        <StepDetails v-else-if="currentStep === 'details'" :form="form" />
        <StepReview v-else-if="currentStep === 'review'" :form="form" :job="job" />

        <p v-if="submitError !== ''" class="mt-4 text-xs font-semibold text-red-600">{{ submitError }}</p>
        <p v-if="registerHelp !== ''" class="mt-4 text-xs leading-relaxed text-tx-3">{{ registerHelp }}</p>
        <div class="mt-6 flex items-center justify-between border-t border-line pt-5">
          <button
            v-if="stepIndex > 0"
            type="button"
            class="rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2"
            @click="prev"
          >
            이전
          </button>
          <span v-else />
          <button
            v-if="!isLastStep"
            type="button"
            class="rounded-lg bg-ink-900 px-5 py-2 text-xs font-bold text-white hover:bg-ink-800 disabled:opacity-40"
            :disabled="!canProceed"
            @click="next"
          >
            다음
          </button>
          <button
            v-else
            type="button"
            class="rounded-lg bg-copper-500 px-5 py-2 text-xs font-bold text-white hover:bg-copper-600 disabled:opacity-40"
            :disabled="!canProceed || create.isPending.value"
            @click="submit"
          >
            {{ create.isPending.value ? '등록 중…' : '의뢰 등록' }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
