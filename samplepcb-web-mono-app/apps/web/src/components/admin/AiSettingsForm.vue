<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AiUsecaseConfigType } from '@sp/api-contract';
import { useAiModels, useAiSettings, useSaveAiSettings } from '../../admin/useAdminSettings';

// AI 연동 폼 — 연결(baseUrl·apiKey) + 유스케이스(활성·모델·프롬프트). apiKey 는 서버가
// 마스킹만 돌려주므로 입력칸은 항상 빈 값에서 시작: 입력=교체, 비움=유지, 삭제 체크=제거.
// "연결 테스트"는 /api/tags 프록시 — 성공 시 모델 목록을 셀렉트 datalist 로 제공한다.
const { t } = useI18n();
const { data, isLoading } = useAiSettings();
const save = useSaveAiSettings();
const modelsTest = useAiModels();

const baseUrl = ref('');
const apiKeyInput = ref('');
const clearApiKey = ref(false);
const usecases = ref<AiUsecaseConfigType[]>([]);
const models = ref<string[]>([]);

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

function onSubmit(): void {
  save.mutate({
    baseUrl: baseUrl.value.trim(),
    ...(apiKeyInput.value.trim() !== ''
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
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
          <span class="mt-0.5 block text-xs text-gray-500">{{ t('admin.settings.ai.baseUrlHint') }}</span>
        </label>
        <label class="block text-sm">
          <span class="font-medium text-gray-800">{{ t('admin.settings.ai.apiKey') }}</span>
          <input
            v-model="apiKeyInput"
            type="password"
            autocomplete="off"
            :placeholder="t('admin.settings.ai.apiKeyPlaceholder')"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
          <span class="mt-0.5 block text-xs text-gray-500">
            <template v-if="data?.data.apiKeyMasked">
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
