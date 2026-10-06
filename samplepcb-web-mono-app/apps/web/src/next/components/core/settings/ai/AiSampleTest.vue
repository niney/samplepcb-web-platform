<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { MarketDevReview } from '@sp/api-contract';
import { useAiDevReviewTest, useAiJob, useInvalidateAiJobLog } from '@/admin/useAdminSettings';
import Panel from '@/next/components/common/Panel.vue';
import { Button } from '@/next/components/ui/button';
import { Spinner } from '@/next/components/ui/spinner';
import DevReviewSummary from './DevReviewSummary.vue';

// 검토서 샘플 테스트 — 저장하지 않은 현재 모델·추가 지침을 서버의 비식별 샘플로 실제 실행한다(설정은
// 안 바뀐다). 옛 AiSettingsForm ② 블록 아래 부분 그대로: 시작 → 잡 폴링(3초) → 끝나면 이력 무효화 →
// 결과 검토서 축약 표시.
const props = defineProps<{ model: string; extraInstructions: string }>();
const { t } = useI18n();
const devReviewTest = useAiDevReviewTest();
const invalidateJobLog = useInvalidateAiJobLog();

const testJobId = ref<string | null>(null);
const testJob = useAiJob(testJobId);
const testData = computed(() => testJob.data.value?.data);
const isTestRunning = computed(() => devReviewTest.isPending.value || testData.value?.status === 'running');
const testStageLabel = computed(() =>
  testData.value?.stage === 'attachments'
    ? t('admin.settings.ai.devReview.stageAttachments')
    : t('admin.settings.ai.devReview.stageReview'),
);
const canTest = computed(() => !isTestRunning.value && props.model.trim() !== '');

// @sp/shared 의 apiGet 은 `ZodType<T>`(입력·출력 같은 타입)로 받아 .catch() 가 섞인 스키마에서 추론이
// 입력 형태로 무너진다 — 이미 parse 를 통과한 값을 한 번 더 parse 해 출력 타입으로 좁힌다(옛 화면과 같음).
const sampleReview = computed(() => {
  const result = testData.value;
  if (result?.status !== 'done' || result.review === null) return null;
  return MarketDevReview.parse(result.review);
});

// 잡이 끝나면 이력 표에 방금 실행이 보이도록 무효화한다(이력 구역에 수동 새로고침 버튼도 있다).
watch(
  () => testData.value?.status,
  (status) => {
    if (status === 'done' || status === 'error') void invalidateJobLog();
  },
);

function onSampleTest(): void {
  testJobId.value = null;
  devReviewTest.reset();
  devReviewTest.mutate(
    { model: props.model.trim(), extraInstructions: props.extraInstructions.trim() },
    {
      onSuccess: (response) => {
        testJobId.value = response.data.jobId;
        void invalidateJobLog();
      },
    },
  );
}
</script>

<template>
  <div class="flex flex-col gap-3 border-t pt-3">
    <div class="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" :disabled="!canTest" @click="onSampleTest">
        <Spinner v-if="isTestRunning" />
        {{ isTestRunning ? t('admin.settings.ai.devReview.testRunning') : t('admin.settings.ai.devReview.test') }}
      </Button>
      <span class="text-muted-foreground text-xs">{{ t('admin.settings.ai.devReview.testHint') }}</span>
    </div>

    <Panel
      v-if="testJobId !== null || devReviewTest.isPending.value || devReviewTest.isError.value"
      tone="muted"
      class="flex flex-col gap-3"
    >
      <p v-if="isTestRunning" class="text-info text-sm">
        {{ t('admin.settings.ai.devReview.testWaiting', { stage: testStageLabel, seconds: testData?.elapsedSecs ?? 0 }) }}
      </p>
      <p v-else-if="devReviewTest.isError.value || testJob.isError.value" class="text-destructive text-sm">
        {{ t('admin.settings.ai.devReview.testStartFail') }}
      </p>
      <p v-else-if="testData?.status === 'error'" class="text-destructive text-sm">
        {{ t('admin.settings.ai.devReview.testResultFail', { error: testData.error ?? 'GENERATION_FAILED' }) }}
      </p>
      <template v-else-if="testData?.status === 'done' && sampleReview !== null">
        <p class="text-success text-sm font-medium">
          {{ t('admin.settings.ai.devReview.testDone', { seconds: testData.elapsedSecs }) }}
        </p>
        <DevReviewSummary :review="sampleReview" />
      </template>
    </Panel>
  </div>
</template>
