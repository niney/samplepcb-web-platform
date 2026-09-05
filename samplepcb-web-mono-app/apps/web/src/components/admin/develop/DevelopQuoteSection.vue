<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminDevelopRequestDetailType, DevelopQuoteKindType } from '@sp/api-contract';
import { useAdminDevelopSettings } from '../../../admin/useAdminDevelop';
import DevelopQuoteCard from './DevelopQuoteCard.vue';
import DevelopQuoteEditor from './DevelopQuoteEditor.vue';
import { defaultDevelopQuoteKind } from './develop-quote-edit';

// 견적 섹션(docs/DEVELOP_FLOW.md §5·§7.3) — 목록 + 작성/편집기 한 자리.
// 초안은 상세 응답에 같이 실려 오므로(관리자 응답만 draft 포함) 여기서 따로 조회하지 않는다.
// 새 견적 기본값은 설정 싱글턴에서 복사한다 — 설정을 못 읽으면 작성 버튼을 열지 않는다.
const props = defineProps<{ detail: AdminDevelopRequestDetailType }>();

const { t } = useI18n();
const { data: settingsData } = useAdminDevelopSettings();
const settings = computed(() => settingsData.value?.data);

const editing = ref(false);
const editingQuoteId = ref<number | null>(null);
// 편집기를 매번 새로 세우는 키 — 다른 초안으로 갈아탈 때 폼이 남지 않게 한다.
const editorSeq = ref(0);

const closed = computed(
  () => props.detail.status === 'completed' || props.detail.status === 'cancelled' || props.detail.status === 'declined',
);
const beforeStart = computed(
  () => props.detail.status === 'received' || props.detail.status === 'reviewing' || props.detail.status === 'quoted',
);
const allowedKinds = computed<readonly DevelopQuoteKindType[]>(() =>
  beforeStart.value ? (['initial', 'revision'] as const) : (['change'] as const),
);
const defaultKind = computed(() => defaultDevelopQuoteKind(props.detail.status, props.detail.quotes));

const editingQuote = computed(() => {
  const id = editingQuoteId.value;
  if (id === null) return null;
  return props.detail.quotes.find((q) => q.quoteId === id) ?? null;
});

const openNew = (): void => {
  editingQuoteId.value = null;
  editorSeq.value += 1;
  editing.value = true;
};

const openEdit = (quoteId: number): void => {
  editingQuoteId.value = quoteId;
  editorSeq.value += 1;
  editing.value = true;
};

const closeEditor = (): void => {
  editing.value = false;
  editingQuoteId.value = null;
};
</script>

<template>
  <section id="develop-quotes" class="scroll-mt-4 rounded-xl border border-gray-200 bg-white p-4">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-base font-bold text-gray-800">
        {{ t('admin.develop.quote.title') }}
        <span class="ml-1 text-xs font-normal text-gray-400">{{ detail.quotes.length }}</span>
      </h2>
      <button
        v-if="!closed"
        type="button"
        class="ml-auto rounded-md border border-blue-300 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
        :disabled="editing || settings === undefined"
        @click="openNew"
      >
        {{ t('admin.develop.quote.new') }}
      </button>
      <span v-else class="ml-auto text-xs text-gray-400">{{ t('admin.develop.quote.closed') }}</span>
    </div>

    <DevelopQuoteEditor
      v-if="editing && settings !== undefined"
      :key="`quote-editor-${editorSeq}`"
      class="mt-3"
      :request-id="detail.requestId"
      :quote="editingQuote"
      :settings="settings"
      :initial-kind="editingQuote?.kind ?? defaultKind"
      :allowed-kinds="allowedKinds"
      :request-title="detail.title"
      @close="closeEditor"
    />

    <div class="mt-3 grid gap-2">
      <DevelopQuoteCard
        v-for="q in detail.quotes"
        :key="q.quoteId"
        :quote="q"
        @edit="openEdit(q.quoteId)"
      />
      <p v-if="detail.quotes.length === 0 && !editing" class="py-4 text-center text-sm text-gray-400">
        {{ t('admin.develop.quote.empty') }}
      </p>
    </div>
  </section>
</template>
