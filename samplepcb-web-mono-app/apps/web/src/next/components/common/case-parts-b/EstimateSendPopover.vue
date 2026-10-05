<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { SendIcon } from '@lucide/vue';
import type { AdminNotifyChannelStatusType } from '@sp/api-contract';
import { useSendEstimate } from '@/admin/useAdminQuotes';
import { Button } from '@/next/components/ui/button';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/next/components/ui/popover';
import { Separator } from '@/next/components/ui/separator';

// 견적서 발송 — 옛 components/admin/EstimateSendControl.vue 의 짝(같은 props).
// 툴바 버튼 + 팝오버 폼(수신 이메일 확인) + 채널별(메일/알림톡) 결과. 발송은 sp-node 직송.
// rfq(가격 미확정)는 서버가 409 로 막으니 버튼을 priced 로 잠그고, 그래도 뚫리면 오류 문구를 그대로 보인다.
const props = defineProps<{
  projectId: number;
  defaultEmail: string;
  priced: boolean;
  /** 팝오버 전개 방향 — 'right' 면 버튼 오른쪽 끝에 맞춘다(좁은 우측 드로어). 기본 'left'. */
  align?: 'left' | 'right';
}>();
const { t } = useI18n();

const open = ref(false);
const email = ref('');
const localError = ref<string | null>(null);
const emailId = `${useId()}-email`;

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
  s === 'sent' ? 'text-success' : s === 'failed' ? 'text-destructive' : 'text-muted-foreground';
const anySkipped = computed(
  () => result.value !== null && (result.value.mail === 'skipped' || result.value.alimtalk === 'skipped'),
);

// 열 때마다 수신 주소를 기본값으로 되돌리고 지난 결과를 지운다(옛 토글과 같은 규칙).
const onOpenChange = (next: boolean): void => {
  open.value = next;
  if (next) {
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
  <Popover :open="open" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        :disabled="!priced"
        :title="!priced ? t('admin.quotes.estimate.send.blockedRfq') : ''"
      >
        <SendIcon />
        {{ t('admin.quotes.estimate.send.button') }}
      </Button>
    </PopoverTrigger>
    <PopoverContent :align="align === 'right' ? 'end' : 'start'" class="w-80">
      <form class="space-y-3" @submit.prevent="submit">
        <p class="text-sm font-semibold">{{ t('admin.quotes.estimate.send.title') }}</p>
        <Field>
          <FieldLabel :for="emailId">{{ t('admin.quotes.estimate.send.emailLabel') }}</FieldLabel>
          <Input
            :id="emailId"
            :model-value="email"
            type="email"
            @update:model-value="(value: string | number) => (email = String(value))"
          />
        </Field>

        <div class="flex items-center gap-2">
          <Button type="submit" size="sm" :disabled="isPending">
            {{ isPending ? t('admin.quotes.estimate.send.sending') : t('admin.quotes.estimate.send.submit') }}
          </Button>
          <Button type="button" variant="ghost" size="sm" @click="onOpenChange(false)">
            {{ t('admin.quotes.estimate.send.cancel') }}
          </Button>
        </div>

        <p v-if="localError !== null" class="text-destructive text-sm" role="alert">{{ localError }}</p>

        <template v-if="result !== null">
          <Separator />
          <div class="space-y-1 text-sm">
            <p class="text-muted-foreground text-xs font-medium">{{ t('admin.quotes.estimate.send.resultTitle') }}</p>
            <p>
              <span class="text-muted-foreground">{{ t('admin.quotes.estimate.send.channelMail') }}</span>
              <span class="text-muted-foreground mx-1">·</span>
              <span :class="statusClass(result.mail)">{{ statusLabel(result.mail) }}</span>
            </p>
            <p>
              <span class="text-muted-foreground">{{ t('admin.quotes.estimate.send.channelAlimtalk') }}</span>
              <span class="text-muted-foreground mx-1">·</span>
              <span :class="statusClass(result.alimtalk)">{{ statusLabel(result.alimtalk) }}</span>
            </p>
            <p v-if="anySkipped" class="text-muted-foreground text-xs">{{ t('admin.quotes.estimate.send.skippedHint') }}</p>
          </div>
        </template>
      </form>
    </PopoverContent>
  </Popover>
</template>
