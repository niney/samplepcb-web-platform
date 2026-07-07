<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminNotifyChannelStatusType } from '@sp/api-contract';
import { useSendEstimate } from '../../admin/useAdminQuotes';

// 견적서 발송 컨트롤 — 툴바 버튼 + 드롭다운 폼(수신 이메일 확인) + 채널별(메일/알림톡) 결과.
// 발송 자체는 sp-node 직송(메일=nodemailer, 알림톡=iwinv). rfq(가격 미확정)는 서버 409 →
// 버튼 자체를 priced 로 게이트하고, 그래도 뚫린 경우 mutation 에러 메시지를 그대로 표시.
const props = defineProps<{
  projectId: number;
  defaultEmail: string;
  priced: boolean;
  // 드롭다운 전개 방향 — 좁고 우측 고정인 드로어에선 'right'(좌측 전개)로 화면 밖 넘침 방지.
  // 기본 'left'(견적서 모달 등 넓은 컨텍스트).
  align?: 'left' | 'right';
}>();
const { t } = useI18n();

const open = ref(false);
const email = ref('');
const localError = ref<string | null>(null);

const { mutate, data, isPending, reset } = useSendEstimate();
const result = computed(() => data.value?.data ?? null);

// 간단 이메일 형식 검사(서버 zod .email() 이 최종 판정, 여기선 오타 즉시 피드백용).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_KEY: Record<AdminNotifyChannelStatusType, string> = {
  sent: 'admin.quotes.estimate.send.statusSent',
  failed: 'admin.quotes.estimate.send.statusFailed',
  skipped: 'admin.quotes.estimate.send.statusSkipped',
};
const statusLabel = (s: AdminNotifyChannelStatusType): string => t(STATUS_KEY[s]);
const statusClass = (s: AdminNotifyChannelStatusType): string =>
  s === 'sent' ? 'text-green-700' : s === 'failed' ? 'text-red-600' : 'text-gray-500';
const anySkipped = computed(
  () =>
    result.value !== null &&
    (result.value.mail === 'skipped' || result.value.alimtalk === 'skipped'),
);

const toggle = (): void => {
  open.value = !open.value;
  if (open.value) {
    email.value = props.defaultEmail;
    localError.value = null;
    reset();
  }
};

const submit = (): void => {
  localError.value = null;
  const to = email.value.trim();
  if (!EMAIL_RE.test(to)) {
    localError.value = t('admin.quotes.estimate.send.invalidEmail');
    return;
  }
  mutate(
    { projectId: props.projectId, email: to },
    {
      onError: (e: unknown) => {
        localError.value = e instanceof Error ? e.message : t('admin.quotes.estimate.send.error');
      },
    },
  );
};
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-50"
      :disabled="!props.priced"
      :title="!props.priced ? t('admin.quotes.estimate.send.blockedRfq') : ''"
      @click="toggle"
    >
      {{ t('admin.quotes.estimate.send.button') }}
    </button>

    <div
      v-if="open"
      class="absolute top-full z-10 mt-2 w-80 rounded-lg border border-gray-200 bg-white p-4 text-left shadow-xl"
      :class="props.align === 'right' ? 'right-0' : 'left-0'"
      @click.stop
    >
      <p class="mb-2 text-sm font-semibold text-gray-800">
        {{ t('admin.quotes.estimate.send.title') }}
      </p>

      <label class="mb-1 block text-xs text-gray-500">
        {{ t('admin.quotes.estimate.send.emailLabel') }}
      </label>
      <input
        v-model="email"
        type="email"
        class="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        @keydown.enter="submit"
      >

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          :disabled="isPending"
          @click="submit"
        >
          {{ isPending ? t('admin.quotes.estimate.send.sending') : t('admin.quotes.estimate.send.submit') }}
        </button>
        <button type="button" class="text-sm text-gray-500 hover:underline" @click="toggle">
          {{ t('admin.quotes.estimate.send.cancel') }}
        </button>
      </div>

      <p v-if="localError !== null" class="mt-2 text-sm text-red-600">{{ localError }}</p>

      <div
        v-if="result !== null"
        class="mt-3 space-y-1 border-t border-gray-100 pt-2 text-sm"
      >
        <p class="text-xs font-medium text-gray-500">
          {{ t('admin.quotes.estimate.send.resultTitle') }}
        </p>
        <p>
          <span class="text-gray-600">{{ t('admin.quotes.estimate.send.channelMail') }}</span>
          <span class="mx-1 text-gray-300">·</span>
          <span :class="statusClass(result.mail)">{{ statusLabel(result.mail) }}</span>
        </p>
        <p>
          <span class="text-gray-600">{{ t('admin.quotes.estimate.send.channelAlimtalk') }}</span>
          <span class="mx-1 text-gray-300">·</span>
          <span :class="statusClass(result.alimtalk)">{{ statusLabel(result.alimtalk) }}</span>
        </p>
        <p v-if="anySkipped" class="text-xs text-gray-400">
          {{ t('admin.quotes.estimate.send.skippedHint') }}
        </p>
      </div>
    </div>
  </div>
</template>
