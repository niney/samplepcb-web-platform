<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AiSettingsResponseType } from '@sp/api-contract';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Label } from '@/next/components/ui/label';

// ① 연결 — API 주소·API 키·연결 테스트(옛 AiSettingsForm 첫 블록). apiKey 는 서버가 마스킹만 돌려주므로
// 입력칸은 항상 빈 값에서 시작: 입력=교체, 비움=유지, 삭제 체크=제거. env(.env)가 우선 적용 중인 칸은
// 잠그고 경고색으로 알린다. 연결 테스트가 성공하면 부모가 모델 목록을 datalist 로 깐다.
const props = defineProps<{
  settings: AiSettingsResponseType['data'] | undefined;
  testPending: boolean;
  testSuccess: boolean;
  testError: boolean;
  modelCount: number;
}>();
const emit = defineEmits<{ test: [] }>();

const baseUrl = defineModel<string>('baseUrl', { required: true });
const apiKeyInput = defineModel<string>('apiKey', { required: true });
const clearApiKey = defineModel<boolean>('clearApiKey', { required: true });

const { t } = useI18n();

const onClearPick = (value: boolean | 'indeterminate'): void => {
  clearApiKey.value = value === true;
};
</script>

<template>
  <SectionCard :title="t('admin.settings.ai.connection')">
    <Field>
      <FieldLabel for="ai-base-url">{{ t('admin.settings.ai.baseUrl') }}</FieldLabel>
      <Input id="ai-base-url" v-model="baseUrl" type="url" :disabled="props.settings?.baseUrlFromEnv" />
      <p v-if="props.settings?.baseUrlFromEnv === true" class="text-warning text-sm font-medium">
        {{ t('admin.settings.ai.fromEnv') }}
      </p>
      <FieldDescription v-else>{{ t('admin.settings.ai.baseUrlHint') }}</FieldDescription>
    </Field>

    <Field>
      <FieldLabel for="ai-api-key">{{ t('admin.settings.ai.apiKey') }}</FieldLabel>
      <Input
        id="ai-api-key"
        v-model="apiKeyInput"
        type="password"
        autocomplete="off"
        :disabled="props.settings?.apiKeyFromEnv"
        :placeholder="t('admin.settings.ai.apiKeyPlaceholder')"
      />
      <p v-if="props.settings?.apiKeyFromEnv === true" class="text-warning text-sm font-medium">
        {{ t('admin.settings.ai.fromEnv') }}
        <template v-if="props.settings.apiKeyMasked"> ({{ props.settings.apiKeyMasked }})</template>
      </p>
      <FieldDescription v-else-if="props.settings?.apiKeyMasked">
        <span class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{{ t('admin.settings.ai.apiKeySet', { masked: props.settings.apiKeyMasked }) }}</span>
          <span class="inline-flex items-center gap-1.5">
            <Checkbox id="ai-api-key-clear" :model-value="clearApiKey" @update:model-value="onClearPick" />
            <Label for="ai-api-key-clear"><span class="text-destructive">{{ t('admin.settings.ai.apiKeyClear') }}</span></Label>
          </span>
        </span>
      </FieldDescription>
      <FieldDescription v-else>{{ t('admin.settings.ai.apiKeyNone') }}</FieldDescription>
    </Field>

    <div class="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" :disabled="props.testPending" @click="emit('test')">
        {{ props.testPending ? t('admin.settings.loading') : t('admin.settings.ai.testConnection') }}
      </Button>
      <span v-if="props.testSuccess" class="text-success text-sm">
        {{ t('admin.settings.ai.testOk', { count: props.modelCount }) }}
      </span>
      <span v-else-if="props.testError" class="text-destructive text-sm">
        {{ t('admin.settings.ai.testFail') }}
      </span>
    </div>
  </SectionCard>
</template>
