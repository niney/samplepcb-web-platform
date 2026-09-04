<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminDevelopDiagramStateType } from '@sp/api-contract';
import { DevDiagramSection, apiErrorMessage } from '@sp/ui';
import {
  useAdminDevelopAiRun,
  useAdminDevelopDiagramAction,
  useAdminDevelopDiagramUpload,
} from '../../../admin/useAdminDevelop';
import { formatDateTime } from '../../../lib/format';

// 시스템 구성도 패널 — AI 재생성 · 담당자 교체 업로드(svg·png·jpg·webp·html) · 공개/공개 취소.
// 뷰어는 마켓과 공용(@sp/ui DevDiagramSection): 본문은 sandbox iframe 으로만 렌더한다.
// 공개본은 별도 스냅샷이라 현재본을 고친 뒤에는 다시 공개해야 고객 화면이 바뀐다(publishedStale).
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
  <section class="rounded-xl border border-indigo-100 bg-indigo-50/20 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-bold text-gray-800">{{ t('admin.develop.diagram.title') }}</h2>
      <span
        v-if="diagram.published"
        class="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700"
      >
        {{ t('admin.develop.diagram.published') }}
        <template v-if="diagram.publishedAt !== null"> · {{ formatDateTime(diagram.publishedAt) }}</template>
      </span>
      <span v-if="diagram.publishedStale" class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
        {{ t('admin.develop.diagram.publishedStale') }}
      </span>

      <div class="ml-auto flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[11px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          :disabled="busy"
          @click="fileInput?.click()"
        >
          {{ upload.isPending.value ? t('admin.develop.diagram.uploading') : t('admin.develop.diagram.upload') }}
        </button>
        <button
          type="button"
          class="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
          :disabled="busy || diagram.html === null"
          @click="onAction('publish')"
        >
          {{ diagram.published ? t('admin.develop.diagram.republish') : t('admin.develop.diagram.publish') }}
        </button>
        <button
          v-if="diagram.published"
          type="button"
          class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[11px] font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          :disabled="busy"
          @click="onAction('unpublish')"
        >
          {{ t('admin.develop.diagram.unpublish') }}
        </button>
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept=".svg,.png,.jpg,.jpeg,.webp,.html,.htm,image/svg+xml,image/png,image/jpeg,image/webp,text/html"
      class="hidden"
      @change="onPickFile"
    >
    <p class="mt-1 text-[11px] text-gray-500">{{ t('admin.develop.diagram.uploadHint') }}</p>
    <p v-if="notice !== ''" class="mt-2 text-xs font-semibold" :class="noticeError ? 'text-red-600' : 'text-emerald-700'">
      {{ notice }}
    </p>
    <p v-if="!aiConsent" class="mt-2 text-xs font-semibold text-amber-700">{{ t('admin.develop.noAiConsentHint') }}</p>

    <div class="mt-3 rounded-lg border border-gray-200 bg-white p-4">
      <DevDiagramSection
        :diagram="view"
        :uploaded="diagram.source === 'upload'"
        :can-regenerate="aiConsent"
        :regenerating="aiRun.isPending.value"
        @regenerate="onRegenerate"
      />
    </div>
  </section>
</template>
