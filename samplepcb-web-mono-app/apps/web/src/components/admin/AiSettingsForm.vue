<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { AI_EXTRA_INSTRUCTIONS_MAX, MarketDevReview } from '@sp/api-contract';
import { formatDateTime } from '../../lib/format';
import {
  useAiDevReviewTest,
  useAiJob,
  useAiJobLog,
  useAiModels,
  useAiSettings,
  useInvalidateAiJobLog,
  useSaveAiSettings,
} from '../../admin/useAdminSettings';
import DevReviewSummary from './DevReviewSummary.vue';
import UiPagination from '../ui/UiPagination.vue';

// AI 연동 폼 — 세 블록: ① 연결(baseUrl·apiKey) ② 검토서 생성(사용·주모델·첨부 판독 모델·
// 추가 지침·프롬프트 버전·샘플 테스트) ③ 실행 이력(sp_ai_job). 프롬프트 본문은 코드 정본
// (docs/AI_DEV_REVIEW.md §6)이라 화면에 textarea 가 없고, 유스케이스도 검토서 1종뿐이라
// 옛 카드 반복이 사라졌다.
// apiKey 는 서버가 마스킹만 돌려주므로 입력칸은 항상 빈 값에서 시작: 입력=교체, 비움=유지,
// 삭제 체크=제거. "연결 테스트"는 /api/tags 프록시 — 성공 시 모델 목록을 datalist 로 제공.
const { t } = useI18n();
const { data, isLoading } = useAiSettings();
const save = useSaveAiSettings();
const modelsTest = useAiModels();
const devReviewTest = useAiDevReviewTest();
const invalidateJobLog = useInvalidateAiJobLog();

const baseUrl = ref('');
const apiKeyInput = ref('');
const clearApiKey = ref(false);
const visionModel = ref('');
const drEnabled = ref(false);
const drModel = ref('');
const drExtra = ref('');
const models = ref<string[]>([]);

const testJobId = ref<string | null>(null);
const testJob = useAiJob(testJobId);
const testData = computed(() => testJob.data.value?.data);
const isTestRunning = computed(
  () => devReviewTest.isPending.value || testData.value?.status === 'running',
);
const testStageLabel = computed(() =>
  testData.value?.stage === 'attachments'
    ? t('admin.settings.ai.devReview.stageAttachments')
    : t('admin.settings.ai.devReview.stageReview'),
);

// @sp/shared 의 apiGet 은 `ZodType<T>`(= 입력·출력 같은 타입) 로 받으므로, .catch() 가
// 섞인 스키마에서는 추론이 **입력** 형태(status?: unknown)로 무너진다. 런타임 값은 이미
// AiJobResponse.parse 를 통과한 출력 형태라, 여기서 한 번 더 parse 해 출력 타입으로 좁힌다
// (실질 no-op — 계약 파일을 건드리지 않고 화면에서 닫는 방법).
const sampleReview = computed(() => {
  const result = testData.value;
  if (result?.status !== 'done' || result.review === null) return null;
  return MarketDevReview.parse(result.review);
});

const jobPage = ref(1);
const JOB_PAGE_SIZE = 20;
const jobLog = useAiJobLog(jobPage, JOB_PAGE_SIZE);

// 잡이 끝나면 이력 표에 방금 실행이 보이도록 무효화한다(수동 새로고침 버튼도 있다).
watch(
  () => testData.value?.status,
  (status) => {
    if (status === 'done' || status === 'error') void invalidateJobLog();
  },
);

// 로드/저장 에코 시 폼 리필(키 입력칸은 항상 초기화).
watch(
  () => data.value?.data,
  (d) => {
    if (d === undefined) return;
    baseUrl.value = d.baseUrl;
    visionModel.value = d.visionModel;
    drEnabled.value = d.devReview.enabled;
    drModel.value = d.devReview.model;
    drExtra.value = d.devReview.extraInstructions;
    apiKeyInput.value = '';
    clearApiKey.value = false;
  },
  { immediate: true },
);

const canSubmit = computed(() => !save.isPending.value && drModel.value.trim() !== '');
const canTest = computed(() => !isTestRunning.value && drModel.value.trim() !== '');

const jobStatusLabel = (status: 'running' | 'done' | 'error'): string =>
  status === 'running'
    ? t('admin.settings.ai.jobs.statusRunning')
    : status === 'done'
      ? t('admin.settings.ai.jobs.statusDone')
      : t('admin.settings.ai.jobs.statusError');

const jobStageLabel = (stage: string | null): string =>
  stage === 'attachments'
    ? t('admin.settings.ai.jobs.stageAttachments')
    : stage === 'review'
      ? t('admin.settings.ai.jobs.stageReview')
      : '-';

function onTest(): void {
  modelsTest.mutate(undefined, {
    onSuccess: (res) => {
      models.value = res.data.models;
    },
  });
}

// 저장하지 않은 현재 모델·추가 지침을 서버의 비식별 샘플로 실제 실행한다.
function onSampleTest(): void {
  testJobId.value = null;
  devReviewTest.reset();
  devReviewTest.mutate(
    { model: drModel.value.trim(), extraInstructions: drExtra.value.trim() },
    {
      onSuccess: (response) => {
        testJobId.value = response.data.jobId;
        void invalidateJobLog();
      },
    },
  );
}

function onSubmit(): void {
  // env(.env)가 우선 적용 중인 항목은 저장하지 않는다(어차피 무시됨 — 혼동 방지).
  const d = data.value?.data;
  const baseUrlFromEnv = d?.baseUrlFromEnv ?? false;
  const apiKeyFromEnv = d?.apiKeyFromEnv ?? false;
  const visionModelFromEnv = d?.visionModelFromEnv ?? false;
  save.mutate({
    ...(baseUrlFromEnv ? {} : { baseUrl: baseUrl.value.trim() }),
    ...(apiKeyFromEnv
      ? {}
      : apiKeyInput.value.trim() !== ''
        ? { apiKey: apiKeyInput.value.trim() }
        : clearApiKey.value
          ? { apiKey: null }
          : {}),
    // 계약이 min(1) 이라 빈 값은 아예 보내지 않는다(비우기는 지원 대상이 아님).
    ...(visionModelFromEnv || visionModel.value.trim() === ''
      ? {}
      : { visionModel: visionModel.value.trim() }),
    devReview: {
      enabled: drEnabled.value,
      model: drModel.value.trim(),
      extraInstructions: drExtra.value.trim(),
    },
  });
}
</script>

<template>
  <form class="max-w-4xl space-y-6" @submit.prevent="onSubmit">
    <p v-if="isLoading" class="text-sm text-gray-500">{{ t('admin.settings.loading') }}</p>
    <template v-else>
      <p class="text-sm text-gray-600">{{ t('admin.settings.ai.intro') }}</p>

      <!-- ① 연결 -->
      <div class="space-y-3 rounded-md border border-gray-200 p-4">
        <h3 class="text-sm font-semibold text-gray-800">{{ t('admin.settings.ai.connection') }}</h3>
        <label class="block text-sm">
          <span class="font-medium text-gray-800">{{ t('admin.settings.ai.baseUrl') }}</span>
          <input
            v-model="baseUrl"
            type="url"
            :disabled="data?.data.baseUrlFromEnv"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
          >
          <span class="mt-0.5 block text-xs" :class="data?.data.baseUrlFromEnv ? 'font-semibold text-amber-600' : 'text-gray-500'">
            {{ data?.data.baseUrlFromEnv ? t('admin.settings.ai.fromEnv') : t('admin.settings.ai.baseUrlHint') }}
          </span>
        </label>
        <label class="block text-sm">
          <span class="font-medium text-gray-800">{{ t('admin.settings.ai.apiKey') }}</span>
          <input
            v-model="apiKeyInput"
            type="password"
            autocomplete="off"
            :disabled="data?.data.apiKeyFromEnv"
            :placeholder="t('admin.settings.ai.apiKeyPlaceholder')"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          >
          <span class="mt-0.5 block text-xs" :class="data?.data.apiKeyFromEnv ? 'font-semibold text-amber-600' : 'text-gray-500'">
            <template v-if="data?.data.apiKeyFromEnv">
              {{ t('admin.settings.ai.fromEnv') }}
              <template v-if="data?.data.apiKeyMasked"> ({{ data.data.apiKeyMasked }})</template>
            </template>
            <template v-else-if="data?.data.apiKeyMasked">
              {{ t('admin.settings.ai.apiKeySet', { masked: data.data.apiKeyMasked }) }}
              <label class="ml-2 inline-flex items-center gap-1 text-red-600">
                <input v-model="clearApiKey" type="checkbox">
                {{ t('admin.settings.ai.apiKeyClear') }}
              </label>
            </template>
            <template v-else>{{ t('admin.settings.ai.apiKeyNone') }}</template>
          </span>
        </label>
        <div class="flex items-center gap-3">
          <button
            type="button"
            :disabled="modelsTest.isPending.value"
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            @click="onTest"
          >
            {{ modelsTest.isPending.value ? t('admin.settings.loading') : t('admin.settings.ai.testConnection') }}
          </button>
          <span v-if="modelsTest.isSuccess.value" class="text-sm text-green-600">
            {{ t('admin.settings.ai.testOk', { count: models.length }) }}
          </span>
          <span v-else-if="modelsTest.isError.value" class="text-sm text-red-600">
            {{ t('admin.settings.ai.testFail') }}
          </span>
        </div>
      </div>

      <!-- ② 검토서 생성 -->
      <div class="space-y-3 rounded-md border border-gray-200 p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-gray-800">
            {{ t('admin.settings.ai.devReview.title') }}
            <span class="ml-1 font-mono text-xs font-normal text-gray-400">market.dev-review</span>
          </h3>
          <label class="inline-flex items-center gap-1.5 text-sm text-gray-700">
            <input v-model="drEnabled" type="checkbox">
            {{ t('admin.settings.ai.devReview.enabled') }}
          </label>
        </div>
        <p class="text-xs text-gray-500">{{ t('admin.settings.ai.devReview.enabledHint') }}</p>

        <label class="block text-sm">
          <span class="font-medium text-gray-800">{{ t('admin.settings.ai.devReview.model') }}</span>
          <input
            v-model="drModel"
            type="text"
            list="ai-models"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
          >
          <span class="mt-0.5 block text-xs text-gray-500">{{ t('admin.settings.ai.devReview.modelHint') }}</span>
        </label>

        <label class="block text-sm">
          <span class="font-medium text-gray-800">{{ t('admin.settings.ai.devReview.visionModel') }}</span>
          <input
            v-model="visionModel"
            type="text"
            list="ai-models"
            :disabled="data?.data.visionModelFromEnv"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm disabled:bg-gray-100 disabled:text-gray-500"
          >
          <span class="mt-0.5 block text-xs" :class="data?.data.visionModelFromEnv ? 'font-semibold text-amber-600' : 'text-gray-500'">
            {{ data?.data.visionModelFromEnv ? t('admin.settings.ai.fromEnv') : t('admin.settings.ai.devReview.visionModelHint') }}
          </span>
        </label>

        <label class="block text-sm">
          <span class="font-medium text-gray-800">{{ t('admin.settings.ai.devReview.extraInstructions') }}</span>
          <textarea
            v-model="drExtra"
            rows="6"
            :maxlength="AI_EXTRA_INSTRUCTIONS_MAX"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-xs leading-relaxed"
          />
          <span class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {{ t('admin.settings.ai.devReview.extraInstructionsHint') }}
            <span class="ml-auto font-mono text-[11px] text-gray-400">
              {{ t('admin.settings.ai.devReview.extraInstructionsCount', { count: drExtra.length, max: AI_EXTRA_INSTRUCTIONS_MAX }) }}
            </span>
          </span>
        </label>

        <div class="grid gap-1 text-sm">
          <span class="font-medium text-gray-800">{{ t('admin.settings.ai.devReview.promptVersion') }}</span>
          <p class="font-mono text-sm text-gray-700">{{ data?.data.devReview.promptVersion }}</p>
          <span class="text-xs text-gray-500">
            {{ t('admin.settings.ai.devReview.promptVersionHint') }}
            <template v-if="data !== undefined">
              · {{ t('admin.settings.ai.devReview.updatedAt') }}
              {{ formatDateTime(data.data.devReview.updatedAt) }}
            </template>
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
          <button
            type="button"
            :disabled="!canTest"
            class="rounded-md border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            @click="onSampleTest"
          >
            {{ isTestRunning ? t('admin.settings.ai.devReview.testRunning') : t('admin.settings.ai.devReview.test') }}
          </button>
          <span class="text-xs text-gray-500">{{ t('admin.settings.ai.devReview.testHint') }}</span>
        </div>

        <div
          v-if="testJobId !== null || devReviewTest.isPending.value || devReviewTest.isError.value"
          class="space-y-3 rounded-md border border-blue-100 bg-blue-50/40 p-3"
        >
          <p v-if="isTestRunning" class="text-sm text-blue-700">
            {{ t('admin.settings.ai.devReview.testWaiting', { stage: testStageLabel, seconds: testData?.elapsedSecs ?? 0 }) }}
          </p>
          <p v-else-if="devReviewTest.isError.value || testJob.isError.value" class="text-sm text-red-600">
            {{ t('admin.settings.ai.devReview.testStartFail') }}
          </p>
          <p v-else-if="testData?.status === 'error'" class="text-sm text-red-600">
            {{ t('admin.settings.ai.devReview.testResultFail', { error: testData.error ?? 'GENERATION_FAILED' }) }}
          </p>
          <template v-else-if="testData?.status === 'done' && sampleReview !== null">
            <p class="text-sm font-medium text-green-700">
              {{ t('admin.settings.ai.devReview.testDone', { seconds: testData.elapsedSecs }) }}
            </p>
            <DevReviewSummary :review="sampleReview" />
          </template>
        </div>
      </div>

      <datalist id="ai-models">
        <option v-for="m in models" :key="m" :value="m" />
      </datalist>

      <div class="flex items-center gap-3">
        <button
          type="submit"
          :disabled="!canSubmit"
          class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {{ save.isPending.value ? t('admin.settings.saving') : t('admin.settings.save') }}
        </button>
        <span v-if="save.isSuccess.value" class="text-sm text-green-600">{{ t('admin.settings.saved') }}</span>
      </div>

      <!-- ③ 실행 이력 -->
      <div class="space-y-3 rounded-md border border-gray-200 p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-gray-800">{{ t('admin.settings.ai.jobs.title') }}</h3>
          <button
            type="button"
            :disabled="jobLog.isFetching.value"
            class="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            @click="invalidateJobLog"
          >
            {{ t('admin.settings.ai.jobs.refresh') }}
          </button>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="border-b border-gray-200 text-gray-500">
              <tr>
                <th class="py-2 pr-3">{{ t('admin.settings.ai.jobs.colStartedAt') }}</th>
                <th class="py-2 pr-3">{{ t('admin.settings.ai.jobs.colStage') }}</th>
                <th class="py-2 pr-3">{{ t('admin.settings.ai.jobs.colModel') }}</th>
                <th class="py-2 pr-3">{{ t('admin.settings.ai.jobs.colStatus') }}</th>
                <th class="py-2 pr-3">{{ t('admin.settings.ai.jobs.colElapsed') }}</th>
                <th class="py-2 pr-3">{{ t('admin.settings.ai.jobs.colError') }}</th>
                <th class="py-2">{{ t('admin.settings.ai.jobs.colMember') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="j in jobLog.data.value?.data.items ?? []" :key="j.jobId" class="border-b border-gray-100">
                <td class="py-2 pr-3 text-gray-500">{{ formatDateTime(j.startedAt) }}</td>
                <td class="py-2 pr-3">{{ jobStageLabel(j.stage) }}</td>
                <td class="py-2 pr-3 font-mono text-[11px]">{{ j.model }}</td>
                <td class="py-2 pr-3">
                  <span
                    class="rounded-full px-2 py-0.5 text-[11px] font-bold"
                    :class="
                      j.status === 'done'
                        ? 'bg-emerald-100 text-emerald-700'
                        : j.status === 'error'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-blue-100 text-blue-700'
                    "
                  >
                    {{ jobStatusLabel(j.status) }}
                  </span>
                </td>
                <td class="py-2 pr-3 text-gray-500">{{ j.elapsedSecs }}</td>
                <td class="max-w-64 truncate py-2 pr-3 text-red-600" :title="j.error ?? ''">{{ j.error ?? '-' }}</td>
                <td class="py-2 text-gray-500">{{ j.mbIdMasked }}</td>
              </tr>
              <tr v-if="(jobLog.data.value?.data.items ?? []).length === 0">
                <td colspan="7" class="py-8 text-center text-gray-400">
                  {{ jobLog.isFetching.value ? t('admin.settings.loading') : t('admin.settings.ai.jobs.empty') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="jobLog.data.value !== undefined" class="flex items-center justify-between">
          <p class="text-xs text-gray-500">
            {{ t('admin.settings.ai.jobs.total', { total: jobLog.data.value.data.total }) }}
          </p>
          <UiPagination
            :page="jobPage"
            :page-size="JOB_PAGE_SIZE"
            :total="jobLog.data.value.data.total"
            @update:page="(p) => (jobPage = p)"
          />
        </div>
      </div>
    </template>
  </form>
</template>
