<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AiThinkLevelType } from '@sp/api-contract';
import { useAiModels, useAiSettings, useSaveAiSettings } from '@/admin/useAdminSettings';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Spinner } from '@/next/components/ui/spinner';
import SaveRow from '../SaveRow.vue';
import AiConnectionSection from './AiConnectionSection.vue';
import AiJobLogSection from './AiJobLogSection.vue';
import AiSampleTest from './AiSampleTest.vue';
import AiUseCaseSection from './AiUseCaseSection.vue';
import type { AiUseCaseKeys } from './ai-labels';

// AI 연동 탭 — 옛 components/admin/AiSettingsForm.vue 와 같은 여덟 블록·같은 저장 본문:
// ① 연결 ② 검토서 생성(+첨부 판독 모델·샘플 테스트) ③ 정밀 시스템 구성도 ④·⑤ 개발의뢰 검토서·구성도
// ⑥ 개발의뢰 후속 질문 ⑦ 개발의뢰 문서 메일 초안 → 저장 → ⑧ 실행 이력.
// 프롬프트 본문은 코드 정본(docs/AI_DEV_REVIEW.md §6)이라 화면에 없다. 상태는 여기 한 곳에 두고
// 구역 조각에 v-model 로 내려준다(저장은 한 번에).
const { t } = useI18n();
const { data, isLoading } = useAiSettings();
const save = useSaveAiSettings();
const modelsTest = useAiModels();

const baseUrl = ref('');
const apiKeyInput = ref('');
const clearApiKey = ref(false);
const visionModel = ref('');
const drEnabled = ref(false);
const drModel = ref('');
const drExtra = ref('');
const ddEnabled = ref(false);
const ddModel = ref('');
const ddThink = ref<AiThinkLevelType>('high');
const ddExtra = ref('');
// 개발의뢰(develop.*) — 마켓과 같은 두 유스케이스를 따로 든다(모델·thinking·지침이 다르다).
const devrEnabled = ref(false);
const devrModel = ref('');
const devrThink = ref<AiThinkLevelType>('high');
const devrExtra = ref('');
const devdEnabled = ref(false);
const devdModel = ref('');
const devdThink = ref<AiThinkLevelType>('high');
const devdExtra = ref('');
// 위저드 AI 후속 질문 — 고객이 화면에서 기다린다(정밀 모델·높은 thinking 은 폴백만 부른다).
const devfEnabled = ref(false);
const devfModel = ref('');
const devfThink = ref<AiThinkLevelType>('low');
const devfExtra = ref('');
// 프로젝트 문서 → 고객 메일 초안(develop.doc-mail) — 관리자가 발송 패널에서 기다리는 짧은 잡.
const devmEnabled = ref(false);
const devmModel = ref('');
const devmThink = ref<AiThinkLevelType>('low');
const devmExtra = ref('');
const models = ref<string[]>([]);

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
    ddEnabled.value = d.devDiagram.enabled;
    ddModel.value = d.devDiagram.model;
    ddThink.value = d.devDiagram.think;
    ddExtra.value = d.devDiagram.extraInstructions;
    devrEnabled.value = d.developReview.enabled;
    devrModel.value = d.developReview.model;
    devrThink.value = d.developReview.think;
    devrExtra.value = d.developReview.extraInstructions;
    devdEnabled.value = d.developDiagram.enabled;
    devdModel.value = d.developDiagram.model;
    devdThink.value = d.developDiagram.think;
    devdExtra.value = d.developDiagram.extraInstructions;
    devfEnabled.value = d.developFollowup.enabled;
    devfModel.value = d.developFollowup.model;
    devfThink.value = d.developFollowup.think;
    devfExtra.value = d.developFollowup.extraInstructions;
    devmEnabled.value = d.developDocMail.enabled;
    devmModel.value = d.developDocMail.model;
    devmThink.value = d.developDocMail.think;
    devmExtra.value = d.developDocMail.extraInstructions;
    apiKeyInput.value = '';
    clearApiKey.value = false;
  },
  { immediate: true },
);

// 여섯 유스케이스 모두 model 이 계약 min(1) 이라 전부 채워야 저장할 수 있다.
const canSubmit = computed(
  () =>
    !save.isPending.value &&
    drModel.value.trim() !== '' &&
    ddModel.value.trim() !== '' &&
    devrModel.value.trim() !== '' &&
    devdModel.value.trim() !== '' &&
    devfModel.value.trim() !== '' &&
    devmModel.value.trim() !== '',
);

// 구역별 문구 — 옛 화면이 구역마다 쓰던 i18n 키 그대로(일부 구역은 devReview·devDiagram 의 공용 문구를 빌린다).
const DEV_REVIEW_KEYS: AiUseCaseKeys = {
  title: 'admin.settings.ai.devReview.title',
  enabled: 'admin.settings.ai.devReview.enabled',
  enabledHint: 'admin.settings.ai.devReview.enabledHint',
  model: 'admin.settings.ai.devReview.model',
  modelHint: 'admin.settings.ai.devReview.modelHint',
  extra: 'admin.settings.ai.devReview.extraInstructions',
  extraHint: 'admin.settings.ai.devReview.extraInstructionsHint',
  count: 'admin.settings.ai.devReview.extraInstructionsCount',
  promptVersion: 'admin.settings.ai.devReview.promptVersion',
  promptVersionHint: 'admin.settings.ai.devReview.promptVersionHint',
  updatedAt: 'admin.settings.ai.devReview.updatedAt',
};
const DIAGRAM_COMMON = {
  count: 'admin.settings.ai.devDiagram.extraInstructionsCount',
  promptVersion: 'admin.settings.ai.devDiagram.promptVersion',
  promptVersionHint: 'admin.settings.ai.devDiagram.promptVersionHint',
  updatedAt: 'admin.settings.ai.devDiagram.updatedAt',
} as const;
const DEV_DIAGRAM_KEYS: AiUseCaseKeys = {
  title: 'admin.settings.ai.devDiagram.title',
  enabled: 'admin.settings.ai.devDiagram.enabled',
  enabledHint: 'admin.settings.ai.devDiagram.enabledHint',
  model: 'admin.settings.ai.devDiagram.model',
  modelHint: 'admin.settings.ai.devDiagram.modelHint',
  think: 'admin.settings.ai.devDiagram.think',
  thinkHint: 'admin.settings.ai.devDiagram.thinkHint',
  extra: 'admin.settings.ai.devDiagram.extraInstructions',
  extraHint: 'admin.settings.ai.devDiagram.extraInstructionsHint',
  ...DIAGRAM_COMMON,
};
const DEVELOP_REVIEW_KEYS: AiUseCaseKeys = {
  title: 'admin.settings.ai.developReview.title',
  enabled: 'admin.settings.ai.developReview.enabled',
  enabledHint: 'admin.settings.ai.developReview.enabledHint',
  model: 'admin.settings.ai.developReview.model',
  modelHint: 'admin.settings.ai.developReview.modelHint',
  think: 'admin.settings.ai.developReview.think',
  thinkHint: 'admin.settings.ai.developReview.thinkHint',
  extra: 'admin.settings.ai.developReview.extraInstructions',
  extraHint: 'admin.settings.ai.developReview.extraInstructionsHint',
  count: 'admin.settings.ai.devReview.extraInstructionsCount',
  promptVersion: 'admin.settings.ai.devReview.promptVersion',
  promptVersionHint: 'admin.settings.ai.devReview.promptVersionHint',
  updatedAt: 'admin.settings.ai.devReview.updatedAt',
};
const developKeys = (name: 'developDiagram' | 'developFollowup' | 'developDocMail'): AiUseCaseKeys => ({
  title: `admin.settings.ai.${name}.title`,
  enabled: `admin.settings.ai.${name}.enabled`,
  enabledHint: `admin.settings.ai.${name}.enabledHint`,
  model: `admin.settings.ai.${name}.model`,
  modelHint: `admin.settings.ai.${name}.modelHint`,
  think: `admin.settings.ai.${name}.think`,
  thinkHint: 'admin.settings.ai.devDiagram.thinkHint',
  extra: `admin.settings.ai.${name}.extraInstructions`,
  extraHint: `admin.settings.ai.${name}.extraInstructionsHint`,
  ...DIAGRAM_COMMON,
});

function onTest(): void {
  modelsTest.mutate(undefined, {
    onSuccess: (res) => {
      models.value = res.data.models;
    },
  });
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
    ...(visionModelFromEnv || visionModel.value.trim() === '' ? {} : { visionModel: visionModel.value.trim() }),
    devReview: {
      enabled: drEnabled.value,
      model: drModel.value.trim(),
      extraInstructions: drExtra.value.trim(),
    },
    devDiagram: {
      enabled: ddEnabled.value,
      model: ddModel.value.trim(),
      think: ddThink.value,
      extraInstructions: ddExtra.value.trim(),
    },
    developReview: {
      enabled: devrEnabled.value,
      model: devrModel.value.trim(),
      think: devrThink.value,
      extraInstructions: devrExtra.value.trim(),
    },
    developDiagram: {
      enabled: devdEnabled.value,
      model: devdModel.value.trim(),
      think: devdThink.value,
      extraInstructions: devdExtra.value.trim(),
    },
    developFollowup: {
      enabled: devfEnabled.value,
      model: devfModel.value.trim(),
      think: devfThink.value,
      extraInstructions: devfExtra.value.trim(),
    },
    developDocMail: {
      enabled: devmEnabled.value,
      model: devmModel.value.trim(),
      think: devmThink.value,
      extraInstructions: devmExtra.value.trim(),
    },
  });
}
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <p v-if="isLoading" class="text-muted-foreground inline-flex items-center gap-2 text-sm">
      <Spinner />
      {{ t('admin.settings.loading') }}
    </p>
    <template v-else>
      <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
        <p class="text-muted-foreground text-sm">{{ t('admin.settings.ai.intro') }}</p>

        <!-- ① 연결 -->
        <AiConnectionSection
          v-model:base-url="baseUrl"
          v-model:api-key="apiKeyInput"
          v-model:clear-api-key="clearApiKey"
          :settings="data?.data"
          :test-pending="modelsTest.isPending.value"
          :test-success="modelsTest.isSuccess.value"
          :test-error="modelsTest.isError.value"
          :model-count="models.length"
          @test="onTest"
        />

        <!-- ② 검토서 생성 — 첨부 판독 모델과 샘플 테스트가 붙는다. -->
        <AiUseCaseSection
          v-model:enabled="drEnabled"
          v-model:model="drModel"
          v-model:extra="drExtra"
          id-prefix="ai-dr"
          code="market.dev-review"
          :keys="DEV_REVIEW_KEYS"
          :prompt-version="data?.data.devReview.promptVersion"
          :updated-at="data?.data.devReview.updatedAt"
          tall-extra
        >
          <template #after-model>
            <Field>
              <FieldLabel for="ai-dr-vision">{{ t('admin.settings.ai.devReview.visionModel') }}</FieldLabel>
              <Input
                id="ai-dr-vision"
                v-model="visionModel"
                type="text"
                list="ai-models"
                class="font-mono"
                :disabled="data?.data.visionModelFromEnv"
              />
              <p v-if="data?.data.visionModelFromEnv === true" class="text-warning text-sm font-medium">
                {{ t('admin.settings.ai.fromEnv') }}
              </p>
              <FieldDescription v-else>{{ t('admin.settings.ai.devReview.visionModelHint') }}</FieldDescription>
            </Field>
          </template>
          <template #footer>
            <AiSampleTest :model="drModel" :extra-instructions="drExtra" />
          </template>
        </AiUseCaseSection>

        <!-- ③ 정밀 시스템 구성도 — 등록 뒤 비동기 잡. 모델·thinking 단계는 프로빙 결정값이 기본. -->
        <AiUseCaseSection
          v-model:enabled="ddEnabled"
          v-model:model="ddModel"
          v-model:think="ddThink"
          v-model:extra="ddExtra"
          id-prefix="ai-dd"
          code="market.dev-diagram"
          :keys="DEV_DIAGRAM_KEYS"
          :prompt-version="data?.data.devDiagram.promptVersion"
          :updated-at="data?.data.devDiagram.updatedAt"
        />

        <!-- ④ 개발의뢰 검토서 — 관리자가 눌러서 도는 초안(고객은 기다리지 않는다)이라 정밀 모델을 허용한다. -->
        <AiUseCaseSection
          v-model:enabled="devrEnabled"
          v-model:model="devrModel"
          v-model:think="devrThink"
          v-model:extra="devrExtra"
          id-prefix="ai-devr"
          code="develop.dev-review"
          :keys="DEVELOP_REVIEW_KEYS"
          :prompt-version="data?.data.developReview.promptVersion"
          :updated-at="data?.data.developReview.updatedAt"
        />

        <!-- ⑤ 개발의뢰 구성도 -->
        <AiUseCaseSection
          v-model:enabled="devdEnabled"
          v-model:model="devdModel"
          v-model:think="devdThink"
          v-model:extra="devdExtra"
          id-prefix="ai-devd"
          code="develop.dev-diagram"
          :keys="developKeys('developDiagram')"
          :prompt-version="data?.data.developDiagram.promptVersion"
          :updated-at="data?.data.developDiagram.updatedAt"
        />

        <!-- ⑥ 개발의뢰 후속 질문 — 고객이 위저드에서 기다리는 잡이라 빠른 모델·낮은 thinking 이 기본이다. -->
        <AiUseCaseSection
          v-model:enabled="devfEnabled"
          v-model:model="devfModel"
          v-model:think="devfThink"
          v-model:extra="devfExtra"
          id-prefix="ai-devf"
          code="develop.followup"
          :keys="developKeys('developFollowup')"
          :prompt-version="data?.data.developFollowup.promptVersion"
          :updated-at="data?.data.developFollowup.updatedAt"
        />

        <!-- ⑦ 개발의뢰 문서 메일 초안 — 꺼져 있으면 발송 패널은 계약의 결정적 초안(buildDevelopDocMailDraft)만 쓴다. -->
        <AiUseCaseSection
          v-model:enabled="devmEnabled"
          v-model:model="devmModel"
          v-model:think="devmThink"
          v-model:extra="devmExtra"
          id-prefix="ai-devm"
          code="develop.doc-mail"
          :keys="developKeys('developDocMail')"
          :prompt-version="data?.data.developDocMail.promptVersion"
          :updated-at="data?.data.developDocMail.updatedAt"
        />

        <datalist id="ai-models">
          <option v-for="m in models" :key="m" :value="m" />
        </datalist>

        <SaveRow :pending="save.isPending.value" :disabled="!canSubmit" :saved="save.isSuccess.value" />
      </form>

      <!-- ⑧ 실행 이력 -->
      <AiJobLogSection />
    </template>
  </div>
</template>
