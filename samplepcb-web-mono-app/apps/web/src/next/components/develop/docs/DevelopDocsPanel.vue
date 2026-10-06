<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { PlusIcon } from '@lucide/vue';
import type { AcceptableValue } from 'reka-ui';
import {
  DEVELOP_DOC_ALLOWED_STATUSES,
  DEVELOP_DOC_TYPES,
  DEVELOP_DOC_TYPE_LABELS,
} from '@sp/api-contract';
import type { AdminDevelopDocumentViewType, AdminDevelopRequestDetailType, DevelopDocTypeType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import type { PreviewTarget } from '@sp/ui';
import { useAdminDevelopDocumentCreate } from '@/admin/useAdminDevelop';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Button } from '@/next/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import DevelopDocCard from './DevelopDocCard.vue';
import DevelopProjectStatus from './DevelopProjectStatus.vue';
import DevelopTaskTable from './DevelopTaskTable.vue';

// 프로젝트 문서 탭(docs/DEVELOP_FLOW.md §13) — 옛 components/admin/develop/DevelopDocsPanel.vue 의 짝(같은 props·emits).
// 00 현황 띠 · 업무표(WBS·간트, 프로젝트 일정 3개 포함) · 문서 5종(2026-09-11 간소화).
// 문서 목록은 관리자 상세 응답에 draft·이전 판까지 실려 오므로 여기서 따로 조회하지 않는다.
// 카드 순서는 문서 번호 체계(계약 DEVELOP_DOC_TYPES 순 → seq)다. 편집 중 표시(dirty)는 업무표·문서 카드가 올린 것을 모아
// 상세 페이지의 이탈 가드·탭 배지로 넘긴다.
const props = defineProps<{ detail: AdminDevelopRequestDetailType }>();
const emit = defineEmits<{ dirty: [value: boolean]; preview: [file: PreviewTarget] }>();

const { t } = useI18n();
const create = useAdminDevelopDocumentCreate();

const notice = ref('');
const noticeError = ref(false);
const newType = ref<DevelopDocTypeType>('progress_report');

const taskDirty = ref(false);
const docDirty = ref<Record<number, boolean>>({});
const pushDirty = (): void => {
  emit('dirty', taskDirty.value || Object.values(docDirty.value).some((v) => v));
};
const onTaskDirty = (value: boolean): void => {
  taskDirty.value = value;
  pushDirty();
};
const onDocDirty = (documentId: number, value: boolean): void => {
  docDirty.value = { ...docDirty.value, [documentId]: value };
  pushDirty();
};

// ── 문서 묶음(같은 종류·번호의 판들) ──────────────────────────────────────────
interface DocGroup {
  key: string;
  current: AdminDevelopDocumentViewType;
  older: AdminDevelopDocumentViewType[];
}

const groups = computed<DocGroup[]>(() => {
  const map = new Map<string, AdminDevelopDocumentViewType[]>();
  for (const doc of props.detail.documents) {
    const key = `${doc.type}:${String(doc.seq)}`;
    map.set(key, [...(map.get(key) ?? []), doc]);
  }
  const out: DocGroup[] = [];
  for (const [key, docs] of map) {
    const sorted = [...docs].sort((a, b) => b.version - a.version);
    const current = sorted.find((d) => d.status === 'draft') ?? sorted.find((d) => d.isCurrent) ?? sorted[0];
    if (current === undefined) continue;
    out.push({ key, current, older: sorted.filter((d) => d.documentId !== current.documentId) });
  }
  return out.sort((a, b) => {
    const ta = DEVELOP_DOC_TYPES.indexOf(a.current.type) - DEVELOP_DOC_TYPES.indexOf(b.current.type);
    return ta !== 0 ? ta : a.current.seq - b.current.seq;
  });
});

// 현황 띠에서 문서를 고르면 그 판이 든 카드로 스크롤한다(접힌 이전 판은 카드 머리로).
function focusDoc(documentId: number): void {
  const group = groups.value.find((g) => g.current.documentId === documentId || g.older.some((o) => o.documentId === documentId));
  const targetId = group?.current.documentId ?? documentId;
  void nextTick(() => {
    document.getElementById(`develop-doc-${String(targetId)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// ── 새 문서 ─────────────────────────────────────────────────────────────────
const canCreate = computed(() => (DEVELOP_DOC_ALLOWED_STATUSES as readonly string[]).includes(props.detail.status));
const deliveredOrLater = computed(() => props.detail.status === 'delivered' || props.detail.status === 'completed');
// 납품 확인서는 납품 뒤에만 뜻이 있다(서버도 409 DOC_TYPE_NOT_ALLOWED 로 막는다).
const typeOptions = computed(() => DEVELOP_DOC_TYPES.filter((type) => type !== 'delivery_confirm' || deliveredOrLater.value));

const onPickType = (value: AcceptableValue): void => {
  const hit = DEVELOP_DOC_TYPES.find((type) => type === value);
  if (hit !== undefined) newType.value = hit;
};

async function onCreate(): Promise<void> {
  notice.value = '';
  try {
    const res = await create.mutateAsync({ requestId: props.detail.requestId, body: { type: newType.value, internalNote: null } });
    noticeError.value = false;
    notice.value = t('admin.develop.docs.created', { docNo: res.data.docNo });
    focusDoc(res.data.documentId);
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.develop.docs.createFail'), {
      INVALID_TRANSITION: t('admin.develop.docs.errNotStarted'),
      DOC_TYPE_NOT_ALLOWED: t('admin.develop.docs.errNotDelivered'),
      CONTENT_INVALID: t('admin.develop.docs.editor.errContent'),
    });
  }
}

const reviewSchedule = computed(
  () => (props.detail.review.working ?? props.detail.review.draft ?? props.detail.review.publicReview)?.schedule ?? null,
);
</script>

<template>
  <div class="grid gap-4">
    <DevelopProjectStatus :progress="detail.progress" :documents="detail.documents" @focus="focusDoc" />

    <DevelopTaskTable
      :request-id="detail.requestId"
      :tasks="detail.progress.tasks"
      :status="detail.status"
      :schedule="{ baseStartOn: detail.progress.baseStartOn, plannedEndOn: detail.progress.plannedEndOn, expectedEndOn: detail.progress.expectedEndOn }"
      :review-schedule="reviewSchedule"
      :revision="detail.progress.tasksRevision"
      @dirty="onTaskDirty"
    />

    <SectionCard :title="t('admin.develop.docs.title')">
      <template #meta>
        <span class="tabular-nums">{{ groups.length }}</span>
      </template>
      <template #actions>
        <NativeSelect
          :model-value="newType"
          :disabled="!canCreate"
          :aria-label="t('admin.develop.docs.title')"
          @update:model-value="onPickType"
        >
          <NativeSelectOption v-for="type in typeOptions" :key="type" :value="type">{{ DEVELOP_DOC_TYPE_LABELS[type] }}</NativeSelectOption>
        </NativeSelect>
        <Button variant="outline" size="sm" :disabled="!canCreate || create.isPending.value" @click="onCreate">
          <PlusIcon />
          {{ create.isPending.value ? t('admin.develop.saving') : t('admin.develop.docs.new') }}
        </Button>
      </template>
      <template v-if="!canCreate" #notice>
        <NoticeBand tone="warning">{{ t('admin.develop.docs.errNotStarted') }}</NoticeBand>
      </template>

      <div class="grid gap-3">
        <p v-if="notice !== ''" class="text-sm font-medium" :class="noticeError ? 'text-destructive' : 'text-success'">{{ notice }}</p>
        <DevelopDocCard
          v-for="group in groups"
          :key="group.key"
          :doc="group.current"
          :older="group.older"
          :request-title="detail.title"
          :customer-name="detail.contact.name"
          :customer-company="detail.contact.company"
          :customer-email="detail.contact.email"
          @dirty="onDocDirty(group.current.documentId, $event)"
          @preview="emit('preview', $event)"
        />
        <p v-if="groups.length === 0" class="text-muted-foreground py-6 text-center text-sm">{{ t('admin.develop.docs.empty') }}</p>
      </div>
    </SectionCard>
  </div>
</template>
