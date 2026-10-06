<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { PencilIcon, PlusIcon, SaveIcon, Trash2Icon } from '@lucide/vue';
import type { SeoRecordType, SeoScopeType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useAdminSeo, useDeleteSeo, useUpsertSeo } from '@/admin/useAdminSeo';
import { confirmDialog } from '@/next/lib/dialog';
import { Alert, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Spinner } from '@/next/components/ui/spinner';
import { Textarea } from '@/next/components/ui/textarea';
import PageHeader from '@/next/components/common/PageHeader.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';

// 페이지별 SEO 메타 관리 — 옛 pages/admin/AdminSeo.vue 의 짝. 저장은 sp_seo((scope, refKey) upsert),
// 실제 <head> 출력은 sp-php 테마 head.sub.php 가 이 테이블을 읽어 맡는다(정본 docs/SEO_MANAGEMENT.md).
// P1 은 전역 기본(global) + 정적 페이지(page) 중심. 상품(item)/게시판(board)은 P2/P3.
const uid = useId();

const { data, isLoading } = useAdminSeo();
const upsert = useUpsertSeo();
const remove = useDeleteSeo();

const records = computed<SeoRecordType[]>(() => data.value?.data ?? []);
const saving = computed(() => upsert.isPending.value);

// 스코프 메타(라벨·refKey 안내). global 은 전역 단일 레코드라 refKey 를 비활성한다.
interface ScopeMeta {
  value: SeoScopeType;
  label: string;
  refHint: string;
  refPlaceholder: string;
}
const GLOBAL_SCOPE: ScopeMeta = {
  value: 'global',
  label: '전역 기본 (모든 페이지)',
  refHint: '전역 기본값 — 개별 설정이 없는 페이지에 적용',
  refPlaceholder: '',
};
const SCOPES: ScopeMeta[] = [
  GLOBAL_SCOPE,
  { value: 'page', label: '정적 페이지 (파일명)', refHint: '스크립트 파일명으로 매칭', refPlaceholder: '예: reviews.php' },
  {
    value: 'item',
    label: '상품 (it_id) — P2',
    refHint: '상품 번호(it_id)로 매칭. 미설정 시 상품 정보에서 자동 유도',
    refPlaceholder: '예: 1024',
  },
  { value: 'board', label: '게시판 (bo_table) — P3', refHint: '게시판 테이블명으로 매칭', refPlaceholder: '예: notice' },
];
function scopeLabel(v: string): string {
  return SCOPES.find((s) => s.value === v)?.label ?? v;
}
const asScope = (v: unknown): SeoScopeType => SCOPES.find((s) => s.value === v)?.value ?? 'global';

// editingId=null 이면 신규, 값이면 해당 레코드 수정(단 저장은 scope+refKey upsert 라 멱등).
const editingId = ref<number | null>(null);
const scope = ref<SeoScopeType>('global');
const refKey = ref('');
const metaTitle = ref('');
const metaDescription = ref('');
const ogImage = ref('');
const canonical = ref('');
const robots = ref('');
const error = ref('');
const activeScope = computed(() => SCOPES.find((s) => s.value === scope.value) ?? GLOBAL_SCOPE);

function resetForm(): void {
  editingId.value = null;
  scope.value = 'global';
  refKey.value = '';
  metaTitle.value = '';
  metaDescription.value = '';
  ogImage.value = '';
  canonical.value = '';
  robots.value = '';
  error.value = '';
}

function startEdit(r: SeoRecordType): void {
  editingId.value = r.id;
  scope.value = r.scope;
  refKey.value = r.refKey;
  metaTitle.value = r.metaTitle;
  metaDescription.value = r.metaDescription;
  ogImage.value = r.ogImage;
  canonical.value = r.canonical;
  robots.value = r.robots;
  error.value = '';
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  return '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

async function onSubmit(): Promise<void> {
  error.value = '';
  if (scope.value !== 'global' && refKey.value.trim() === '') {
    error.value = '매칭 키(refKey)를 입력해 주세요.';
    return;
  }
  try {
    await upsert.mutateAsync({
      scope: scope.value,
      refKey: scope.value === 'global' ? '' : refKey.value.trim(),
      metaTitle: metaTitle.value.trim(),
      metaDescription: metaDescription.value.trim(),
      ogImage: ogImage.value.trim(),
      canonical: canonical.value.trim(),
      robots: robots.value.trim(),
    });
    resetForm();
  } catch (err) {
    error.value = errorMessage(err);
  }
}

async function onDelete(r: SeoRecordType): Promise<void> {
  if (!(await confirmDialog({ message: '이 SEO 설정을 삭제할까요? 되돌릴 수 없습니다.', confirmLabel: '삭제', tone: 'danger' }))) return;
  error.value = '';
  try {
    await remove.mutateAsync(r.id);
    if (editingId.value === r.id) resetForm();
  } catch (err) {
    error.value = errorMessage(err);
  }
}
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-4">
    <PageHeader title="SEO 설정">
      <template #description>
        검색엔진·SNS 공유용 메타 정보입니다. 전역 기본을 먼저 채우고, 특정 페이지만 다르게 하려면 해당 스코프로 개별
        등록하세요. 실제 출력은 사이트 <code class="bg-muted rounded px-1 font-mono text-xs">&lt;head&gt;</code>에서 이뤄집니다.
      </template>
    </PageHeader>

    <!-- 등록/수정 폼 -->
    <SectionCard :title="editingId === null ? 'SEO 설정 추가' : 'SEO 설정 수정'">
      <template v-if="editingId !== null" #meta>
        <Badge variant="info">#{{ editingId }} 수정 중</Badge>
      </template>

      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel :for="`${uid}-scope`">적용 범위</FieldLabel>
              <NativeSelect
                :id="`${uid}-scope`"
                :model-value="scope"
                class="w-full"
                @change="(e: Event) => (scope = asScope((e.target as HTMLSelectElement).value))"
              >
                <NativeSelectOption v-for="s in SCOPES" :key="s.value" :value="s.value">{{ s.label }}</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel :for="`${uid}-ref`">매칭 키 (refKey)</FieldLabel>
              <Input
                :id="`${uid}-ref`"
                v-model="refKey"
                type="text"
                maxlength="191"
                :disabled="scope === 'global'"
                :placeholder="activeScope.refPlaceholder"
              />
            </Field>
          </div>
          <p class="text-muted-foreground text-xs">{{ activeScope.refHint }}</p>
        </div>

        <Field>
          <FieldLabel :for="`${uid}-title`">제목 (title) — 비우면 자동/기본 제목</FieldLabel>
          <Input :id="`${uid}-title`" v-model="metaTitle" type="text" maxlength="255" />
        </Field>

        <Field>
          <FieldLabel :for="`${uid}-desc`">설명 (description)</FieldLabel>
          <Textarea :id="`${uid}-desc`" v-model="metaDescription" maxlength="500" rows="2" />
          <FieldDescription>권장 70~160자. og:description 에도 함께 쓰입니다.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel :for="`${uid}-og`">OG 이미지 URL (공유 미리보기)</FieldLabel>
          <Input :id="`${uid}-og`" v-model="ogImage" type="text" maxlength="500" placeholder="/data/… 또는 https://…" />
        </Field>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel :for="`${uid}-canonical`">canonical (비우면 현재 URL)</FieldLabel>
            <Input :id="`${uid}-canonical`" v-model="canonical" type="text" maxlength="500" placeholder="https://…" />
          </Field>
          <Field>
            <FieldLabel :for="`${uid}-robots`">robots (비우면 index,follow)</FieldLabel>
            <Input :id="`${uid}-robots`" v-model="robots" type="text" maxlength="50" placeholder="noindex,nofollow" />
          </Field>
        </div>

        <Alert v-if="error !== ''" variant="destructive" size="sm">
          <AlertTitle>{{ error }}</AlertTitle>
        </Alert>

        <div class="flex items-center gap-2">
          <Button :disabled="saving" @click="onSubmit">
            <Spinner v-if="saving" />
            <PlusIcon v-else-if="editingId === null" />
            <SaveIcon v-else />
            {{ saving ? '저장 중…' : editingId === null ? '추가' : '수정 저장' }}
          </Button>
          <Button v-if="editingId !== null" variant="outline" @click="resetForm">취소</Button>
        </div>
      </div>
    </SectionCard>

    <!-- 목록 -->
    <SectionCard title="등록된 설정">
      <template #meta>
        <span v-if="records.length > 0" class="tabular-nums">{{ records.length }}건</span>
      </template>

      <p v-if="isLoading" class="text-muted-foreground inline-flex items-center gap-2 text-sm">
        <Spinner />
        불러오는 중…
      </p>
      <p v-else-if="records.length === 0" class="text-muted-foreground text-sm">
        등록된 SEO 설정이 없습니다. 전역 기본부터 추가해 보세요.
      </p>
      <ul v-else class="divide-y">
        <li v-for="r in records" :key="r.id" class="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
          <div class="min-w-0 flex-1">
            <p class="flex min-w-0 items-center gap-2">
              <Badge variant="secondary" class="flex-none">{{ scopeLabel(r.scope) }}</Badge>
              <span v-if="r.refKey" class="text-muted-foreground truncate font-mono text-xs">{{ r.refKey }}</span>
              <Badge v-if="r.robots" variant="warning" class="flex-none">{{ r.robots }}</Badge>
            </p>
            <p class="mt-1 truncate text-sm font-medium">{{ r.metaTitle || '(제목 자동)' }}</p>
            <p class="text-muted-foreground truncate text-xs">{{ r.metaDescription || '(설명 없음)' }}</p>
          </div>
          <div class="flex flex-none items-center gap-1">
            <Button variant="outline" size="sm" @click="startEdit(r)">
              <PencilIcon />
              수정
            </Button>
            <Button variant="outline" size="sm" @click="onDelete(r)">
              <Trash2Icon class="text-destructive" />
              삭제
            </Button>
          </div>
        </li>
      </ul>
    </SectionCard>
  </div>
</template>
