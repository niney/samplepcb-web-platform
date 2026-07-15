<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { DiagramSpec } from '@sp/api-contract';
import type { AiUsecaseConfigType, AiUsecaseKeyType } from '@sp/api-contract';
import { renderDiagramSpecHtml } from '@sp/utils';
import {
  useAiModels,
  useAiPromptTest,
  useAiPromptTestJob,
  useAiSettings,
  useSaveAiSettings,
} from '../../admin/useAdminSettings';
import { buildAiPreviewSrcdoc } from '../../lib/ai-preview-srcdoc';

// AI 연동 폼 — 연결(baseUrl·apiKey) + 유스케이스(활성·모델·프롬프트). apiKey 는 서버가
// 마스킹만 돌려주므로 입력칸은 항상 빈 값에서 시작: 입력=교체, 비움=유지, 삭제 체크=제거.
// "연결 테스트"는 /api/tags 프록시 — 성공 시 모델 목록을 셀렉트 datalist 로 제공한다.
const { t } = useI18n();
const { data, isLoading } = useAiSettings();
const save = useSaveAiSettings();
const modelsTest = useAiModels();
const promptTest = useAiPromptTest();

const baseUrl = ref('');
const apiKeyInput = ref('');
const clearApiKey = ref(false);
const usecases = ref<AiUsecaseConfigType[]>([]);
const models = ref<string[]>([]);
const testedUseCase = ref<AiUsecaseKeyType | null>(null);
const testJobId = ref<string | null>(null);
const testJob = useAiPromptTestJob(testJobId);

const testData = computed(() => testJob.data.value?.data);
const isPromptTestRunning = computed(
  () => promptTest.isPending.value || testData.value?.status === 'running',
);
const testPreviewHtml = computed<string | null>(() => {
  const result = testData.value;
  if (result?.status !== 'done') return null;
  try {
    if (testedUseCase.value === 'market.request-diagram' && result.html !== null) {
      return buildAiPreviewSrcdoc(result.html);
    }
    if (testedUseCase.value === 'market.request-structurize' && result.json !== null) {
      const spec = DiagramSpec.parse(JSON.parse(result.json) as unknown);
      return buildAiPreviewSrcdoc(renderDiagramSpecHtml(spec));
    }
  } catch {
    return null;
  }
  return null;
});

const testPreviewText = computed<string | null>(() => {
  const result = testData.value;
  if (result?.status !== 'done') return null;
  if (result.md !== null) return result.md;
  if (result.json !== null) {
    try {
      const parsed: unknown = JSON.parse(result.json);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return result.json;
    }
  }
  return result.html;
});

// 로드/저장 에코 시 폼 리필(키 입력칸은 항상 초기화).
watch(
  () => data.value?.data,
  (d) => {
    if (d === undefined) return;
    baseUrl.value = d.baseUrl;
    usecases.value = d.usecases.map((u) => ({ ...u }));
    apiKeyInput.value = '';
    clearApiKey.value = false;
  },
  { immediate: true },
);

function onTest(): void {
  modelsTest.mutate(undefined, {
    onSuccess: (res) => {
      models.value = res.data.models;
    },
  });
}

function onPromptTest(usecase: AiUsecaseConfigType): void {
  testedUseCase.value = usecase.useCase;
  testJobId.value = null;
  promptTest.reset();
  promptTest.mutate(
    {
      useCase: usecase.useCase,
      model: usecase.model,
      promptTemplate: usecase.promptTemplate,
    },
    {
      onSuccess: (response) => {
        testJobId.value = response.data.jobId;
      },
    },
  );
}

function onSubmit(): void {
  // env(.env)가 우선 적용 중인 항목은 저장하지 않는다(어차피 무시됨 — 혼동 방지).
  const baseUrlFromEnv = data.value?.data.baseUrlFromEnv ?? false;
  const apiKeyFromEnv = data.value?.data.apiKeyFromEnv ?? false;
  save.mutate({
    ...(baseUrlFromEnv ? {} : { baseUrl: baseUrl.value.trim() }),
    ...(apiKeyFromEnv
      ? {}
      : apiKeyInput.value.trim() !== ''
        ? { apiKey: apiKeyInput.value.trim() }
        : clearApiKey.value
          ? { apiKey: null }
          : {}),
    usecases: usecases.value.map((u) => ({
      useCase: u.useCase,
      enabled: u.enabled,
      model: u.model,
      promptTemplate: u.promptTemplate,
    })),
  });
}
</script>

<template>
  <form class="max-w-3xl space-y-6" @submit.prevent="onSubmit">
    <p v-if="isLoading" class="text-sm text-gray-500">{{ t('admin.settings.loading') }}</p>
    <template v-else>
      <p class="text-sm text-gray-600">{{ t('admin.settings.ai.intro') }}</p>

      <!-- 연결 -->
      <div class="space-y-3 rounded-md border border-gray-200 p-4">
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

      <!-- 유스케이스 -->
      <div
        v-for="u in usecases"
        :key="u.useCase"
        class="space-y-3 rounded-md border border-gray-200 p-4"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-gray-800">
            <!-- i18n 키는 점·하이픈 불가(중첩 경로로 해석) — 언더스코어 slug 로 변환 -->
            {{ t(`admin.settings.ai.usecases.${u.useCase.replaceAll('.', '_').replaceAll('-', '_')}`) }}
            <span class="ml-1 font-mono text-xs font-normal text-gray-400">{{ u.useCase }}</span>
          </h3>
          <label class="inline-flex items-center gap-1.5 text-sm text-gray-700">
            <input v-model="u.enabled" type="checkbox">
            {{ t('admin.settings.ai.enabled') }}
          </label>
        </div>
        <label class="block text-sm">
          <span class="font-medium text-gray-800">{{ t('admin.settings.ai.model') }}</span>
          <input
            v-model="u.model"
            type="text"
            list="ai-models"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
          >
          <span class="mt-0.5 block text-xs text-gray-500">{{ t('admin.settings.ai.modelHint') }}</span>
        </label>
        <label class="block text-sm">
          <span class="font-medium text-gray-800">{{ t('admin.settings.ai.promptTemplate') }}</span>
          <textarea
            v-model="u.promptTemplate"
            rows="16"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs leading-relaxed"
          />
          <span class="mt-0.5 block text-xs text-gray-500">{{ t('admin.settings.ai.promptHint') }}</span>
        </label>
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            :disabled="isPromptTestRunning || u.model.trim() === '' || u.promptTemplate.trim().length < 10"
            class="rounded-md border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            @click="onPromptTest(u)"
          >
            {{
              testedUseCase === u.useCase && isPromptTestRunning
                ? t('admin.settings.ai.promptTestRunning')
                : t('admin.settings.ai.promptTest')
            }}
          </button>
          <span class="text-xs text-gray-500">{{ t('admin.settings.ai.promptTestHint') }}</span>
        </div>

        <div
          v-if="testedUseCase === u.useCase"
          class="space-y-3 rounded-md border border-blue-100 bg-blue-50/40 p-3"
        >
          <p v-if="promptTest.isPending.value || testData?.status === 'running'" class="text-sm text-blue-700">
            {{ t('admin.settings.ai.promptTestWaiting') }}
            <template v-if="testData"> ({{ testData.elapsedSecs }}s)</template>
          </p>
          <p v-else-if="promptTest.isError.value || testJob.isError.value" class="text-sm text-red-600">
            {{ t('admin.settings.ai.promptTestStartFail') }}
          </p>
          <p v-else-if="testData?.status === 'error'" class="text-sm text-red-600">
            {{ t('admin.settings.ai.promptTestResultFail', { error: testData.error ?? 'GENERATION_FAILED' }) }}
          </p>
          <template v-else-if="testData?.status === 'done'">
            <p class="text-sm font-medium text-green-700">
              {{ t('admin.settings.ai.promptTestDone', { seconds: testData.elapsedSecs }) }}
            </p>
            <iframe
              v-if="testPreviewHtml !== null"
              :srcdoc="testPreviewHtml"
              sandbox=""
              class="h-[430px] w-full rounded-md border border-gray-200 bg-white"
              :title="t('admin.settings.ai.promptTestPreviewTitle')"
            />
            <details v-if="testPreviewText !== null" :open="testPreviewHtml === null">
              <summary class="cursor-pointer text-xs font-medium text-gray-600">
                {{ t('admin.settings.ai.promptTestRaw') }}
              </summary>
              <pre class="mt-2 max-h-[430px] overflow-auto whitespace-pre-wrap rounded-md bg-gray-900 p-3 text-xs text-gray-100">{{ testPreviewText }}</pre>
            </details>
          </template>
        </div>
      </div>
      <datalist id="ai-models">
        <option v-for="m in models" :key="m" :value="m" />
      </datalist>

      <div class="flex items-center gap-3">
        <button
          type="submit"
          :disabled="save.isPending.value"
          class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {{ save.isPending.value ? t('admin.settings.saving') : t('admin.settings.save') }}
        </button>
        <span v-if="save.isSuccess.value" class="text-sm text-green-600">{{ t('admin.settings.saved') }}</span>
      </div>
    </template>
  </form>
</template>
