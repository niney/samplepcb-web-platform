<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { PlusIcon } from '@lucide/vue';
import type { AdminDevelopRequestDetailType, DevelopQuoteKindType } from '@sp/api-contract';
import { useAdminDevelopSettings } from '@/admin/useAdminDevelop';
import { defaultDevelopQuoteKind } from '@/components/admin/develop/develop-quote-edit';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Button } from '@/next/components/ui/button';
import DevelopQuoteCard from './DevelopQuoteCard.vue';
import DevelopQuoteEditor from './DevelopQuoteEditor.vue';

// 견적 섹션(docs/DEVELOP_FLOW.md §5·§7.3) — 옛 components/admin/develop/DevelopQuoteSection.vue 의 짝(같은 props·emits).
// 목록 + 작성/편집기 한 자리. 초안은 상세 응답에 같이 실려 오므로(관리자 응답만 draft 포함) 따로 조회하지 않는다.
// 새 견적 기본값은 설정 싱글턴에서 복사한다 — 설정을 못 읽으면 작성 버튼을 열지 않는다.
const props = defineProps<{ detail: AdminDevelopRequestDetailType }>();
const emit = defineEmits<{ editing: [value: boolean] }>();

const { t } = useI18n();
const { data: settingsData } = useAdminDevelopSettings();
const settings = computed(() => settingsData.value?.data);

const editing = ref(false);
const editingQuoteId = ref<number | null>(null);
watch(editing, (value) => {
  emit('editing', value);
});
// 편집기를 매번 새로 세우는 키 — 다른 초안으로 갈아탈 때 폼이 남지 않게 한다.
const editorSeq = ref(0);

const closed = computed(
  () => props.detail.status === 'completed' || props.detail.status === 'cancelled' || props.detail.status === 'declined',
);
// 착수 전(첫/수정 견적) ↔ 착수 뒤(추가 견적) — 서버 409 KIND_MISMATCH 와 같은 규칙(admin-develop-quotes.ts).
const beforeStart = computed(
  () => props.detail.status === 'received' || props.detail.status === 'reviewing' || props.detail.status === 'quoted',
);
const allowedKinds = computed<readonly DevelopQuoteKindType[]>(() =>
  beforeStart.value ? (['initial', 'revision'] as const) : (['change'] as const),
);
const defaultKind = computed(() => defaultDevelopQuoteKind(props.detail.status, props.detail.quotes));

// 견적 편집기에 넘길 개발 일정(예상) — 작업본 → 초안 → 공개본 순으로 관리자가 마지막에 본 것을 준다.
const reviewSchedule = computed(
  () => (props.detail.review.working ?? props.detail.review.draft ?? props.detail.review.publicReview)?.schedule ?? null,
);

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
  <SectionCard :title="t('admin.develop.quote.title')">
    <template #meta>
      <span class="tabular-nums">{{ detail.quotes.length }}</span>
    </template>
    <template #actions>
      <Button v-if="!closed" variant="outline" size="sm" :disabled="editing || settings === undefined" @click="openNew">
        <PlusIcon />
        {{ t('admin.develop.quote.new') }}
      </Button>
      <span v-else class="text-muted-foreground text-xs">{{ t('admin.develop.quote.closed') }}</span>
    </template>

    <DevelopQuoteEditor
      v-if="editing && settings !== undefined"
      :key="`quote-editor-${editorSeq}`"
      :request-id="detail.requestId"
      :quote="editingQuote"
      :settings="settings"
      :initial-kind="editingQuote?.kind ?? defaultKind"
      :allowed-kinds="allowedKinds"
      :request-title="detail.title"
      :schedule="reviewSchedule"
      @close="closeEditor"
    />

    <div v-if="detail.quotes.length > 0" class="flex flex-col gap-2">
      <DevelopQuoteCard v-for="q in detail.quotes" :key="q.quoteId" :quote="q" @edit="openEdit(q.quoteId)" />
    </div>
    <p v-else-if="!editing" class="text-muted-foreground py-4 text-center text-sm">
      {{ t('admin.develop.quote.empty') }}
    </p>
  </SectionCard>
</template>
