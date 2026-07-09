<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SlideType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  useAdminSlides,
  useCreateSlide,
  useDeleteSlide,
  useReorderSlides,
  useUpdateSlide,
} from '../../admin/useAdminSlides';

// 홈 최상단 메인 슬라이드 관리. 저장 백엔드는 영카트 배너관리(g5_shop_banner '메인')와
// 동일 — 여기서 등록/수정/삭제/순서변경하면 홈 브릿지가 즉시 반영한다.

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
const previewUrl = ref('');
const error = ref('');
const saving = computed(() => create.isPending.value || update.isPending.value);

function clearPreview(): void {
  if (previewUrl.value !== '') {
    URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = '';
  }
}

function resetForm(): void {
  editingId.value = null;
  title.value = '';
  linkUrl.value = '';
  newWindow.value = false;
  file.value = null;
  clearPreview();
  error.value = '';
}

function startEdit(s: SlideType): void {
  editingId.value = s.id;
  title.value = s.title;
  linkUrl.value = s.linkUrl;
  newWindow.value = s.newWindow;
  file.value = null;
  clearPreview();
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
  if (!window.confirm('이 슬라이드를 삭제할까요? 되돌릴 수 없습니다.')) return;
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
  <div class="max-w-3xl space-y-6">
    <div>
      <h1 class="text-xl font-bold">메인 슬라이드</h1>
      <p class="mt-1 text-sm text-gray-500">
        홈 최상단에 표시되는 슬라이드입니다. 위에서 아래 순서로 회전(5초 자동)합니다.
      </p>
    </div>

    <!-- 등록/수정 폼 -->
    <div class="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
      <p class="text-sm font-bold text-gray-800">
        {{ editingId === null ? '슬라이드 추가' : '슬라이드 수정' }}
      </p>

      <label class="block">
        <span class="text-xs font-semibold text-gray-600">
          이미지 {{ editingId === null ? '(필수)' : '(변경할 때만 선택)' }}
        </span>
        <input type="file" accept="image/*" class="mt-1 block text-sm" @change="pickFile">
        <span class="mt-1 block text-xs text-gray-400">권장 1920×550. 미선택 시 기존 이미지 유지.</span>
      </label>

      <div v-if="previewUrl !== ''" class="overflow-hidden rounded-lg border border-gray-200">
        <img :src="previewUrl" alt="미리보기" class="w-full">
      </div>

      <label class="block">
        <span class="text-xs font-semibold text-gray-600">제목 / 대체텍스트</span>
        <input
          v-model="title"
          type="text"
          maxlength="255"
          class="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
        >
      </label>

      <label class="block">
        <span class="text-xs font-semibold text-gray-600">링크 URL (비우면 링크 없음)</span>
        <input
          v-model="linkUrl"
          type="text"
          maxlength="255"
          placeholder="https://…"
          class="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
        >
      </label>

      <label class="flex items-center gap-2">
        <input v-model="newWindow" type="checkbox">
        <span class="text-xs font-semibold text-gray-600">새 창으로 열기</span>
      </label>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="saving"
          @click="onSubmit"
        >
          {{ saving ? '저장 중…' : editingId === null ? '추가' : '수정 저장' }}
        </button>
        <button
          v-if="editingId !== null"
          type="button"
          class="rounded-lg border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          @click="resetForm"
        >
          취소
        </button>
      </div>

      <p v-if="error !== ''" class="text-xs font-semibold text-red-600">{{ error }}</p>
    </div>

    <!-- 목록 -->
    <div class="rounded-xl border border-gray-200 bg-white">
      <p v-if="isLoading" class="p-6 text-sm text-gray-400">불러오는 중…</p>
      <p v-else-if="slides.length === 0" class="p-6 text-sm text-gray-400">등록된 슬라이드가 없습니다.</p>
      <ul v-else class="divide-y divide-gray-100">
        <li v-for="(s, i) in slides" :key="s.id" class="flex items-center gap-4 p-4">
          <img
            :src="s.imageUrl"
            :alt="s.title"
            class="h-14 w-40 flex-none rounded border border-gray-200 object-cover"
          >
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-gray-800">{{ s.title || '(제목 없음)' }}</p>
            <p class="truncate text-xs text-gray-400">
              {{ s.linkUrl || '링크 없음' }}<span v-if="s.newWindow"> · 새 창</span>
            </p>
          </div>
          <span
            class="flex-none rounded px-2 py-0.5 text-xs font-semibold"
            :class="s.active ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'"
          >{{ s.active ? '노출' : '숨김' }}</span>
          <div class="flex flex-none items-center gap-1">
            <button
              type="button"
              class="h-7 w-7 rounded border border-gray-200 text-xs disabled:opacity-30"
              :disabled="i === 0 || reorder.isPending.value"
              @click="move(i, -1)"
            >↑</button>
            <button
              type="button"
              class="h-7 w-7 rounded border border-gray-200 text-xs disabled:opacity-30"
              :disabled="i === slides.length - 1 || reorder.isPending.value"
              @click="move(i, 1)"
            >↓</button>
            <button
              type="button"
              class="rounded border border-gray-200 px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50"
              @click="startEdit(s)"
            >수정</button>
            <button
              type="button"
              class="rounded border border-gray-200 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
              @click="onDelete(s.id)"
            >삭제</button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
