<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { ArrowDownIcon, ArrowUpIcon, ImageIcon, PencilIcon, PlusIcon, SaveIcon, Trash2Icon } from '@lucide/vue';
import type { SlideType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useAdminSlides, useCreateSlide, useDeleteSlide, useReorderSlides, useUpdateSlide } from '@/admin/useAdminSlides';
import { confirmDialog } from '@/next/lib/dialog';
import { Alert, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Spinner } from '@/next/components/ui/spinner';
import { Switch } from '@/next/components/ui/switch';
import PageHeader from '@/next/components/common/PageHeader.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';

// 홈 최상단 메인 슬라이드 관리 — 옛 pages/admin/AdminSlides.vue 의 짝. 저장 백엔드는 영카트 배너관리
// (g5_shop_banner '메인')와 같다 — 여기서 등록/수정/삭제/순서 변경하면 홈 브릿지가 즉시 반영한다.
const uid = useId();

const { data, isLoading } = useAdminSlides();
const create = useCreateSlide();
const update = useUpdateSlide();
const remove = useDeleteSlide();
const reorder = useReorderSlides();

const slides = computed<SlideType[]>(() => data.value?.data ?? []);

// editingId=null 이면 신규 등록, 값이면 해당 슬라이드 수정.
const editingId = ref<number | null>(null);
const title = ref('');
const linkUrl = ref('');
const newWindow = ref(false);
const file = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const previewUrl = ref('');
const error = ref('');
const saving = computed(() => create.isPending.value || update.isPending.value);

function clearPreview(): void {
  if (previewUrl.value !== '') {
    URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = '';
  }
}

// 같은 파일을 다시 고를 수 있게 숨은 파일 입력도 비운다(값이 같으면 change 가 안 난다).
function clearFile(): void {
  file.value = null;
  if (fileInput.value !== null) fileInput.value.value = '';
  clearPreview();
}

function resetForm(): void {
  editingId.value = null;
  title.value = '';
  linkUrl.value = '';
  newWindow.value = false;
  clearFile();
  error.value = '';
}

function startEdit(s: SlideType): void {
  editingId.value = s.id;
  title.value = s.title;
  linkUrl.value = s.linkUrl;
  newWindow.value = s.newWindow;
  clearFile();
  error.value = '';
}

function pickFile(e: Event): void {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0] ?? null;
  file.value = f;
  clearPreview();
  if (f !== null) previewUrl.value = URL.createObjectURL(f);
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const code = err.payload?.error;
    if (code === 'INVALID_IMAGE') return '이미지 파일만 업로드할 수 있습니다.';
    if (code === 'IMAGE_REQUIRED') return '이미지를 선택해 주세요.';
    return err.message;
  }
  return '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

async function onSubmit(): Promise<void> {
  error.value = '';
  if (editingId.value === null && file.value === null) {
    error.value = '이미지를 선택해 주세요.';
    return;
  }
  const payload = {
    title: title.value.trim(),
    linkUrl: linkUrl.value.trim(),
    newWindow: newWindow.value,
  };
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  if (file.value !== null) fd.append('image', file.value);
  try {
    if (editingId.value === null) {
      await create.mutateAsync(fd);
    } else {
      await update.mutateAsync({ id: editingId.value, form: fd });
    }
    resetForm();
  } catch (err) {
    error.value = errorMessage(err);
  }
}

async function onDelete(id: number): Promise<void> {
  if (!(await confirmDialog({ message: '이 슬라이드를 삭제할까요? 되돌릴 수 없습니다.', confirmLabel: '삭제', tone: 'danger' }))) return;
  error.value = '';
  try {
    await remove.mutateAsync(id);
    if (editingId.value === id) resetForm();
  } catch (err) {
    error.value = errorMessage(err);
  }
}

async function move(index: number, dir: -1 | 1): Promise<void> {
  const ids = slides.value.map((s) => s.id);
  const j = index + dir;
  if (j < 0 || j >= ids.length) return;
  const a = ids[index];
  const b = ids[j];
  if (a === undefined || b === undefined) return;
  ids[index] = b;
  ids[j] = a;
  error.value = '';
  try {
    await reorder.mutateAsync(ids);
  } catch (err) {
    error.value = errorMessage(err);
  }
}
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-4">
    <PageHeader
      title="메인 슬라이드"
      description="홈 최상단에 표시되는 슬라이드입니다. 위에서 아래 순서로 회전(5초 자동)합니다."
    />

    <!-- 등록/수정 폼 -->
    <SectionCard :title="editingId === null ? '슬라이드 추가' : '슬라이드 수정'">
      <template v-if="editingId !== null" #meta>
        <Badge variant="info">#{{ editingId }} 수정 중</Badge>
      </template>

      <div class="flex flex-col gap-4">
        <Field>
          <FieldLabel :for="`${uid}-image`">이미지 {{ editingId === null ? '(필수)' : '(변경할 때만 선택)' }}</FieldLabel>
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" @click="fileInput?.click()">
              <ImageIcon />
              이미지 선택
            </Button>
            <span class="text-muted-foreground min-w-0 truncate text-sm">
              {{ file === null ? '선택한 파일 없음' : file.name }}
            </span>
            <input
              :id="`${uid}-image`"
              ref="fileInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="pickFile"
            >
          </div>
          <FieldDescription>권장 1920×550. 미선택 시 기존 이미지 유지.</FieldDescription>
        </Field>

        <div v-if="previewUrl !== ''" class="overflow-hidden rounded-lg border">
          <img :src="previewUrl" alt="미리보기" class="w-full">
        </div>

        <Field>
          <FieldLabel :for="`${uid}-title`">제목 / 대체텍스트</FieldLabel>
          <Input :id="`${uid}-title`" v-model="title" type="text" maxlength="255" />
        </Field>

        <Field>
          <FieldLabel :for="`${uid}-link`">링크 URL (비우면 링크 없음)</FieldLabel>
          <Input :id="`${uid}-link`" v-model="linkUrl" type="text" maxlength="255" placeholder="https://…" />
        </Field>

        <Field orientation="horizontal">
          <Switch :id="`${uid}-new-window`" v-model="newWindow" />
          <FieldLabel :for="`${uid}-new-window`">새 창으로 열기</FieldLabel>
        </Field>

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
    <SectionCard title="슬라이드 목록">
      <template #meta>
        <span v-if="slides.length > 0" class="tabular-nums">{{ slides.length }}개</span>
      </template>

      <p v-if="isLoading" class="text-muted-foreground inline-flex items-center gap-2 text-sm">
        <Spinner />
        불러오는 중…
      </p>
      <p v-else-if="slides.length === 0" class="text-muted-foreground text-sm">등록된 슬라이드가 없습니다.</p>
      <ul v-else class="divide-y">
        <li
          v-for="(s, i) in slides"
          :key="s.id"
          class="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
        >
          <img :src="s.imageUrl" :alt="s.title" class="bg-muted h-14 w-40 flex-none rounded-md border object-cover">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ s.title || '(제목 없음)' }}</p>
            <p class="text-muted-foreground truncate text-xs">
              {{ s.linkUrl || '링크 없음' }}<span v-if="s.newWindow"> · 새 창</span>
            </p>
          </div>
          <Badge :variant="s.active ? 'success' : 'secondary'" class="flex-none">{{ s.active ? '노출' : '숨김' }}</Badge>
          <div class="flex flex-none items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="위로"
              title="위로"
              :disabled="i === 0 || reorder.isPending.value"
              @click="move(i, -1)"
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="아래로"
              title="아래로"
              :disabled="i === slides.length - 1 || reorder.isPending.value"
              @click="move(i, 1)"
            >
              <ArrowDownIcon />
            </Button>
            <Button variant="outline" size="sm" @click="startEdit(s)">
              <PencilIcon />
              수정
            </Button>
            <Button variant="outline" size="sm" @click="onDelete(s.id)">
              <Trash2Icon class="text-destructive" />
              삭제
            </Button>
          </div>
        </li>
      </ul>
    </SectionCard>
  </div>
</template>
