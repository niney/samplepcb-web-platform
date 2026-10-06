<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { EyeOffIcon, SendIcon, UploadIcon } from '@lucide/vue';
import type { AdminDevelopDiagramStateType } from '@sp/api-contract';
import { DevDiagramSection, apiErrorMessage } from '@sp/ui';
import { useAdminDevelopAiRun, useAdminDevelopDiagramAction, useAdminDevelopDiagramUpload } from '@/admin/useAdminDevelop';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import ActionNotice from './ActionNotice.vue';

// 시스템 구성도 패널(옛 components/admin/develop/DevelopDiagramPanel.vue 와 같은 props·동작) — AI 재생성 · 담당자 교체
// 업로드(svg·png·jpg·webp·html) · 공개/공개 취소. 뷰어는 고객·마켓과 공용(@sp/ui DevDiagramSection — 고객이 보는 것과 같은
// 모양이어야 해서 리뉴얼하지 않는다): 본문은 sandbox iframe 으로만 렌더한다. 공개본은 별도 스냅샷이라 현재본을 고친 뒤에는
// 다시 공개해야 고객 화면이 바뀐다(publishedStale).
const props = defineProps<{ requestId: number; diagram: AdminDevelopDiagramStateType; aiConsent: boolean }>();

const { t } = useI18n();

const aiRun = useAdminDevelopAiRun();
const diagramAction = useAdminDevelopDiagramAction();
const upload = useAdminDevelopDiagramUpload();

const notice = ref('');
const noticeError = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const view = computed(() => ({ meta: props.diagram.meta, html: props.diagram.html }));
const busy = computed(() => aiRun.isPending.value || diagramAction.isPending.value || upload.isPending.value);

async function onRegenerate(): Promise<void> {
  notice.value = '';
  try {
    const res = await aiRun.mutateAsync({ requestId: props.requestId, kind: 'diagram' });
    noticeError.value = res.data.skipped !== null;
    notice.value =
      res.data.skipped === null
        ? t('admin.develop.diagram.runStarted')
        : t('admin.develop.diagram.runSkipped', { reason: res.data.skipped });
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.develop.diagram.runFail'), {
      AI_CONSENT_REQUIRED: t('admin.develop.noAiConsentHint'),
      AI_RUNNING: t('admin.develop.diagram.errorRunning'),
    });
  }
}

async function onAction(action: 'publish' | 'unpublish'): Promise<void> {
  notice.value = '';
  try {
    await diagramAction.mutateAsync({ requestId: props.requestId, action });
    noticeError.value = false;
    notice.value = t(`admin.develop.diagram.done.${action}`);
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.develop.diagram.actionFail'), {
      DIAGRAM_EMPTY: t('admin.develop.diagram.errorEmpty'),
    });
  }
}

async function onPickFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file === undefined) return;
  notice.value = '';
  try {
    await upload.mutateAsync({ requestId: props.requestId, file });
    noticeError.value = false;
    notice.value = t('admin.develop.diagram.uploaded');
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.develop.diagram.uploadFail'), {
      FILE_TOO_LARGE: t('admin.develop.diagram.errorTooLarge'),
      FILE_UNSUPPORTED: t('admin.develop.diagram.errorUnsupported'),
      FILE_REQUIRED: t('admin.develop.diagram.errorNoFile'),
    });
  } finally {
    input.value = '';
  }
}
</script>

<template>
  <SectionCard>
    <template #title>
      <span class="inline-flex flex-wrap items-center gap-2">
        {{ t('admin.develop.diagram.title') }}
        <Badge v-if="props.diagram.published" variant="success" class="tabular-nums">
          {{ t('admin.develop.diagram.published') }}
          <template v-if="props.diagram.publishedAt !== null"> · {{ formatDateTime(props.diagram.publishedAt) }}</template>
        </Badge>
        <Badge v-if="props.diagram.publishedStale" variant="warning">{{ t('admin.develop.diagram.publishedStale') }}</Badge>
      </span>
    </template>
    <template #actions>
      <Button variant="outline" size="sm" :disabled="busy" @click="fileInput?.click()">
        <UploadIcon />
        {{ upload.isPending.value ? t('admin.develop.diagram.uploading') : t('admin.develop.diagram.upload') }}
      </Button>
      <Button variant="success" size="sm" :disabled="busy || props.diagram.html === null" @click="void onAction('publish')">
        <SendIcon />
        {{ props.diagram.published ? t('admin.develop.diagram.republish') : t('admin.develop.diagram.publish') }}
      </Button>
      <Button v-if="props.diagram.published" variant="outline" size="sm" :disabled="busy" @click="void onAction('unpublish')">
        <EyeOffIcon />
        {{ t('admin.develop.diagram.unpublish') }}
      </Button>
    </template>

    <div class="grid gap-3">
      <input
        ref="fileInput"
        type="file"
        accept=".svg,.png,.jpg,.jpeg,.webp,.html,.htm,image/svg+xml,image/png,image/jpeg,image/webp,text/html"
        class="hidden"
        @change="onPickFile"
      >
      <p class="text-muted-foreground text-xs">{{ t('admin.develop.diagram.uploadHint') }}</p>
      <ActionNotice :text="notice" :error="noticeError" />
      <p v-if="!props.aiConsent" class="text-warning text-sm font-semibold">{{ t('admin.develop.noAiConsentHint') }}</p>

      <!-- 고객 화면과 같은 뷰어(@sp/ui) — 고객이 보는 모양 그대로 확인한다. -->
      <Panel size="md">
        <DevDiagramSection
          :diagram="view"
          :uploaded="props.diagram.source === 'upload'"
          :can-regenerate="props.aiConsent"
          :regenerating="aiRun.isPending.value"
          @regenerate="onRegenerate"
        />
      </Panel>
    </div>
  </SectionCard>
</template>
