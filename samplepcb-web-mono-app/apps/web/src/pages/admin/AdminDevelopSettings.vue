<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEVELOP_MILESTONE_TRIGGERS,
  DEVELOP_MILESTONE_TRIGGER_LABELS,
  DEVELOP_VAT_MODES,
  DEVELOP_VAT_MODE_LABELS,
} from '@sp/api-contract';
import type { DevelopMilestoneTriggerType, DevelopVatModeType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import { useAdminDevelopSettings, useSaveAdminDevelopSettings } from '../../admin/useAdminDevelop';
import { formatDateTime } from '../../lib/format';

// 개발의뢰 설정 싱글턴(docs/DEVELOP_FLOW.md §7.3) — 견적 생성이 복사해 쓰는 기본값 + 알림 수신자 + AI 자동 초안.
// 마일스톤 비율은 bp(1/100 %)로 저장되고 합이 정확히 100% 여야 서버가 받는다.

interface MilestoneRow {
  title: string;
  percent: string;
  trigger: DevelopMilestoneTriggerType;
}

const { t } = useI18n();
const { data, isLoading } = useAdminDevelopSettings();
const save = useSaveAdminDevelopSettings();

const terms = ref('');
const exclusions = ref('');
const warrantyDays = ref('0');
const reviewDays = ref('7');
const validDays = ref('30');
const vatMode = ref<DevelopVatModeType>('separate');
const milestones = ref<MilestoneRow[]>([]);
const notifyEmails = ref('');
const aiAutoDraft = ref(false);
const aiDiagramAutoDraft = ref(false);
const notice = ref('');
const noticeError = ref(false);

watch(
  () => data.value?.data,
  (s) => {
    if (s === undefined) return;
    terms.value = s.defaultTerms;
    exclusions.value = s.defaultExclusions;
    warrantyDays.value = String(s.defaultWarrantyDays);
    reviewDays.value = String(s.defaultReviewDays);
    validDays.value = String(s.defaultValidDays);
    vatMode.value = s.defaultVatMode;
    milestones.value = s.defaultMilestones.map((m) => ({
      title: m.title,
      percent: String(m.ratioBp / 100),
      trigger: m.trigger,
    }));
    notifyEmails.value = s.notifyEmails.join('\n');
    aiAutoDraft.value = s.aiAutoDraft;
    aiDiagramAutoDraft.value = s.aiDiagramAutoDraft;
  },
  { immediate: true },
);

const ratioBpOf = (row: MilestoneRow): number => Math.round(Number(row.percent) * 100);
const ratioSum = computed(() => milestones.value.reduce((n, m) => n + ratioBpOf(m), 0));
const emailList = computed(() =>
  notifyEmails.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== ''),
);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const badEmails = computed(() => emailList.value.filter((e) => !EMAIL_RE.test(e)));

const issues = computed<string[]>(() => {
  const list: string[] = [];
  if (milestones.value.length === 0) list.push(t('admin.develop.settings.errNoMilestone'));
  if (milestones.value.some((m) => m.title.trim() === '')) list.push(t('admin.develop.settings.errMilestoneTitle'));
  if (milestones.value.some((m) => !Number.isFinite(ratioBpOf(m)) || ratioBpOf(m) < 1 || ratioBpOf(m) > 10_000)) {
    list.push(t('admin.develop.settings.errMilestoneRatio'));
  }
  if (milestones.value.length > 0 && ratioSum.value !== 10_000) list.push(t('admin.develop.settings.errRatioSum'));
  if (badEmails.value.length > 0) list.push(t('admin.develop.settings.errEmail', { emails: badEmails.value.join(', ') }));
  return list;
});

const addMilestone = (): void => {
  if (milestones.value.length >= 10) return;
  milestones.value.push({ title: '', percent: '0', trigger: 'manual' });
};

async function onSubmit(): Promise<void> {
  notice.value = '';
  if (issues.value.length > 0) {
    noticeError.value = true;
    notice.value = t('admin.develop.settings.blocked');
    return;
  }
  try {
    await save.mutateAsync({
      defaultTerms: terms.value,
      defaultExclusions: exclusions.value,
      defaultWarrantyDays: Number(warrantyDays.value),
      defaultReviewDays: Number(reviewDays.value),
      defaultValidDays: Number(validDays.value),
      defaultVatMode: vatMode.value,
      defaultMilestones: milestones.value.map((m) => ({
        title: m.title.trim(),
        ratioBp: ratioBpOf(m),
        trigger: m.trigger,
      })),
      notifyEmails: emailList.value,
      aiAutoDraft: aiAutoDraft.value,
      aiDiagramAutoDraft: aiDiagramAutoDraft.value,
    });
    noticeError.value = false;
    notice.value = t('admin.develop.settings.saved');
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.develop.settings.saveFail'));
  }
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">{{ t('admin.develop.settings.title') }}</h1>
    <p v-if="isLoading" class="text-sm text-gray-500">{{ t('admin.develop.loading') }}</p>

    <form v-else class="max-w-4xl space-y-5" @submit.prevent="onSubmit">
      <!-- 견적서 기본값 -->
      <section class="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 class="text-sm font-bold text-gray-800">{{ t('admin.develop.settings.quoteDefaults') }}</h2>

        <label class="block text-sm">
          <span class="font-medium text-gray-800">{{ t('admin.develop.settings.terms') }}</span>
          <textarea v-model="terms" rows="8" :maxlength="20000" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-xs leading-relaxed" />
          <span class="mt-0.5 block text-xs text-gray-500">{{ t('admin.develop.settings.termsHint') }}</span>
        </label>

        <label class="block text-sm">
          <span class="font-medium text-gray-800">{{ t('admin.develop.settings.exclusions') }}</span>
          <textarea v-model="exclusions" rows="3" :maxlength="4000" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-xs leading-relaxed" />
          <span class="mt-0.5 block text-xs text-gray-500">{{ t('admin.develop.settings.exclusionsHint') }}</span>
        </label>

        <div class="grid gap-3 sm:grid-cols-4">
          <label class="block text-sm">
            <span class="font-medium text-gray-800">{{ t('admin.develop.settings.warrantyDays') }}</span>
            <input v-model="warrantyDays" type="number" min="0" max="3650" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
          </label>
          <label class="block text-sm">
            <span class="font-medium text-gray-800">{{ t('admin.develop.settings.reviewDays') }}</span>
            <input v-model="reviewDays" type="number" min="1" max="90" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
          </label>
          <label class="block text-sm">
            <span class="font-medium text-gray-800">{{ t('admin.develop.settings.validDays') }}</span>
            <input v-model="validDays" type="number" min="1" max="365" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
          </label>
          <label class="block text-sm">
            <span class="font-medium text-gray-800">{{ t('admin.develop.settings.vatMode') }}</span>
            <select v-model="vatMode" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
              <option v-for="mode in DEVELOP_VAT_MODES" :key="mode" :value="mode">{{ DEVELOP_VAT_MODE_LABELS[mode] }}</option>
            </select>
          </label>
        </div>
      </section>

      <!-- 기본 마일스톤 -->
      <section class="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-sm font-bold text-gray-800">{{ t('admin.develop.settings.milestones') }}</h2>
          <span class="text-xs" :class="ratioSum === 10000 ? 'text-gray-500' : 'font-bold text-red-600'">
            {{ t('admin.develop.settings.ratioSum', { percent: (ratioSum / 100).toFixed(2) }) }}
          </span>
          <button
            type="button"
            class="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-[11px] font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            :disabled="milestones.length >= 10"
            @click="addMilestone"
          >
            {{ t('admin.develop.settings.addMilestone') }}
          </button>
        </div>
        <div v-for="(m, i) in milestones" :key="`ms-${i}`" class="flex flex-wrap items-center gap-2">
          <input
            v-model="m.title"
            type="text"
            :maxlength="100"
            :placeholder="t('admin.develop.settings.milestoneTitle')"
            class="h-9 min-w-40 flex-1 rounded-md border border-gray-300 px-3 text-sm"
          >
          <label class="flex items-center gap-1 text-xs text-gray-600">
            <input v-model="m.percent" type="number" min="0.01" max="100" step="0.01" class="h-9 w-24 rounded-md border border-gray-300 px-2 text-sm">
            %
          </label>
          <select v-model="m.trigger" class="h-9 rounded-md border border-gray-300 bg-white px-2 text-xs">
            <option v-for="trig in DEVELOP_MILESTONE_TRIGGERS" :key="trig" :value="trig">{{ DEVELOP_MILESTONE_TRIGGER_LABELS[trig] }}</option>
          </select>
          <button
            type="button"
            class="rounded-md border border-red-200 px-2.5 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-50"
            @click="milestones.splice(i, 1)"
          >
            {{ t('admin.develop.settings.removeMilestone') }}
          </button>
        </div>
        <p class="text-xs text-gray-500">{{ t('admin.develop.settings.milestonesHint') }}</p>
      </section>

      <!-- 알림·AI -->
      <section class="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 class="text-sm font-bold text-gray-800">{{ t('admin.develop.settings.notifyAi') }}</h2>
        <label class="block text-sm">
          <span class="font-medium text-gray-800">{{ t('admin.develop.settings.notifyEmails') }}</span>
          <textarea v-model="notifyEmails" rows="3" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs" />
          <span class="mt-0.5 block text-xs text-gray-500">{{ t('admin.develop.settings.notifyEmailsHint') }}</span>
        </label>
        <label class="flex items-center gap-1.5 text-sm text-gray-700">
          <input v-model="aiAutoDraft" type="checkbox">
          {{ t('admin.develop.settings.aiAutoDraft') }}
        </label>
        <label class="flex items-center gap-1.5 text-sm text-gray-700">
          <input v-model="aiDiagramAutoDraft" type="checkbox">
          {{ t('admin.develop.settings.aiDiagramAutoDraft') }}
        </label>
      </section>

      <ul v-if="issues.length > 0" class="grid gap-0.5 text-xs text-red-600">
        <li v-for="(issue, i) in issues" :key="i">· {{ issue }}</li>
      </ul>

      <div class="flex items-center gap-3">
        <button
          type="submit"
          class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          :disabled="save.isPending.value || issues.length > 0"
        >
          {{ save.isPending.value ? t('admin.develop.saving') : t('admin.develop.settings.save') }}
        </button>
        <span v-if="notice !== ''" class="text-sm font-semibold" :class="noticeError ? 'text-red-600' : 'text-green-600'">{{ notice }}</span>
        <span v-if="data !== undefined && data.data.updatedAt !== null" class="ml-auto text-xs text-gray-400">
          {{ t('admin.develop.settings.updatedAt') }} {{ formatDateTime(data.data.updatedAt) }}
        </span>
      </div>
    </form>
  </div>
</template>
