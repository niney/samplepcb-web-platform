<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  MARKET_BUDGET_RANGE_LABELS,
  apiRoutes,
  isMarketAnswerUnknown,
  marketAnswerText,
  marketAreaLabel,
  marketQuestionsFor,
  marketSlotLabel,
  marketToolRows,
} from '@sp/api-contract';
import type { AdminDevelopRequestDetailType } from '@sp/api-contract';
import { apiGetBlob } from '@sp/shared';
import { apiErrorMessage } from '@sp/ui';
import { formatBytes } from '../../../lib/format';

// 의뢰 내용 — 설명 · 조건/질문 답변 · 희망 툴 · 연락처 · 비밀유지 · 첨부 · AI 동의.
// 문항 라벨·순서는 레지스트리(marketQuestionsFor)가 정본이라, 답변 배열이 아니라 문항 순서로 표를 만든다.
const props = defineProps<{ detail: AdminDevelopRequestDetailType }>();

const { t } = useI18n();

const answerRows = computed(() => {
  const byCode = new Map(props.detail.answers.map((a) => [a.code, a]));
  const known = marketQuestionsFor(props.detail.serviceAreas).flatMap((q) => {
    const answer = byCode.get(q.code);
    if (answer === undefined) return [];
    byCode.delete(q.code);
    return [{ code: q.code, label: q.short, question: q.label, value: marketAnswerText(answer), unknown: isMarketAnswerUnknown(answer) }];
  });
  // 사전에서 사라졌거나 분야 밖 문항(옛 저장분) — 코드 그대로 뒤에 붙인다.
  const rest = [...byCode.values()].map((a) => ({
    code: a.code,
    label: a.code,
    question: '',
    value: marketAnswerText(a),
    unknown: isMarketAnswerUnknown(a),
  }));
  return [...known, ...rest];
});

const toolRows = computed(() => marketToolRows(props.detail.tools, props.detail.serviceAreas));

const slotLabel = (area: string | null, slot: string | null): string =>
  area === null || slot === null ? '' : `${marketAreaLabel(area)} · ${marketSlotLabel(area, slot)}`;

const downloadError = ref('');

async function downloadFile(fileId: number, name: string): Promise<void> {
  downloadError.value = '';
  try {
    const blob = await apiGetBlob(`${apiRoutes.adminDevelopFiles}/${String(fileId)}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    downloadError.value = apiErrorMessage(error, t('admin.develop.content.downloadFail'));
  }
}
</script>

<template>
  <section class="rounded-xl border border-gray-200 bg-white p-4">
    <h2 class="text-sm font-bold text-gray-800">{{ t('admin.develop.content.title') }}</h2>

    <p class="mt-3 whitespace-pre-line rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
      {{ detail.description }}
    </p>

    <dl class="mt-4 grid grid-cols-[104px_1fr] gap-y-2 text-xs">
      <dt class="text-gray-500">{{ t('admin.develop.content.budget') }}</dt>
      <dd class="font-semibold text-gray-800">{{ MARKET_BUDGET_RANGE_LABELS[detail.budgetRange] }}</dd>
      <dt class="text-gray-500">{{ t('admin.develop.content.nda') }}</dt>
      <dd>{{ detail.ndaWanted ? t('admin.develop.content.ndaWanted') : t('admin.develop.content.ndaNone') }}</dd>
      <dt class="text-gray-500">{{ t('admin.develop.content.aiConsent') }}</dt>
      <dd :class="detail.aiConsent ? 'text-gray-800' : 'font-semibold text-amber-700'">
        {{ detail.aiConsent ? t('admin.develop.content.aiConsentYes') : t('admin.develop.content.aiConsentNo') }}
      </dd>
      <dt class="text-gray-500">{{ t('admin.develop.content.tools') }}</dt>
      <dd>
        <template v-if="toolRows.length === 0">—</template>
        <ul v-else class="grid gap-0.5">
          <li v-for="row in toolRows" :key="row.area">
            <span class="text-gray-500">{{ row.areaLabel }}:</span>
            {{ row.labels.length > 0 ? row.labels.join(' · ') : t('admin.develop.content.toolsAny') }}
          </li>
        </ul>
      </dd>
    </dl>

    <!-- 연락처 — 접수 뒤 전화·미팅으로 요구사항을 좁히는 것이 실무라 필수 항목이다. -->
    <div class="mt-4 rounded-lg border border-gray-200 p-3">
      <p class="text-xs font-bold text-gray-500">{{ t('admin.develop.content.contact') }}</p>
      <dl class="mt-1.5 grid grid-cols-[104px_1fr] gap-y-1.5 text-xs">
        <dt class="text-gray-500">{{ t('admin.develop.content.contactName') }}</dt>
        <dd class="font-semibold text-gray-800">
          {{ detail.contact.name }}
          <span v-if="detail.contact.company !== null" class="font-normal text-gray-500"> · {{ detail.contact.company }}</span>
        </dd>
        <dt class="text-gray-500">{{ t('admin.develop.content.contactPhone') }}</dt>
        <dd><a class="font-semibold text-blue-600 hover:underline" :href="`tel:${detail.contact.phone}`">{{ detail.contact.phone }}</a></dd>
        <dt class="text-gray-500">{{ t('admin.develop.content.contactEmail') }}</dt>
        <dd><a class="text-blue-600 hover:underline" :href="`mailto:${detail.contact.email}`">{{ detail.contact.email }}</a></dd>
        <template v-if="detail.contact.hours !== null">
          <dt class="text-gray-500">{{ t('admin.develop.content.contactHours') }}</dt>
          <dd>{{ detail.contact.hours }}</dd>
        </template>
      </dl>
    </div>

    <div v-if="answerRows.length > 0" class="mt-4">
      <p class="text-xs font-bold text-gray-500">{{ t('admin.develop.content.answers', { count: answerRows.length }) }}</p>
      <dl class="mt-1.5 grid grid-cols-[112px_1fr] gap-y-1.5 rounded-lg border border-gray-100 px-3 py-2 text-xs">
        <template v-for="row in answerRows" :key="row.code">
          <dt class="text-gray-500" :title="row.question">{{ row.label }}</dt>
          <dd :class="row.unknown ? 'text-amber-700' : 'text-gray-800'">{{ row.value }}</dd>
        </template>
      </dl>
    </div>

    <div class="mt-4">
      <p class="text-xs font-bold text-gray-500">{{ t('admin.develop.content.files', { count: detail.files.length }) }}</p>
      <p v-if="downloadError !== ''" class="mt-1 text-xs font-semibold text-red-600">{{ downloadError }}</p>
      <ul class="mt-1.5 grid gap-1">
        <li
          v-for="f in detail.files"
          :key="f.fileId"
          class="flex min-w-0 items-center gap-2 rounded-lg border border-gray-100 px-3 py-1.5 text-xs"
        >
          <span v-if="slotLabel(f.area, f.slot) !== ''" class="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
            {{ slotLabel(f.area, f.slot) }}
          </span>
          <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
          <span class="shrink-0 text-[11px] text-gray-400">{{ formatBytes(f.size) }}</span>
          <button type="button" class="shrink-0 font-bold text-blue-600 hover:text-blue-700" @click="downloadFile(f.fileId, f.name)">
            {{ t('admin.develop.content.download') }}
          </button>
        </li>
        <li v-if="detail.files.length === 0" class="text-xs text-gray-400">{{ t('admin.develop.content.noFiles') }}</li>
      </ul>
    </div>
  </section>
</template>
