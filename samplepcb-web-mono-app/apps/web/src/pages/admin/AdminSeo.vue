<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SeoRecordType, SeoScopeType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useAdminSeo, useDeleteSeo, useUpsertSeo } from '../../admin/useAdminSeo';

// 페이지별 SEO 메타 관리. 저장은 sp_seo((scope, refKey) upsert), 실제 <head> 출력은 sp-php
// 테마 head.sub.php 가 이 테이블을 읽어 담당한다(정본 docs/SEO_MANAGEMENT.md).
// P1 은 전역 기본(global) + 정적 페이지(page) 중심. 상품(item)/게시판(board)은 P2/P3.

const { data, isLoading } = useAdminSeo();
const upsert = useUpsertSeo();
const remove = useDeleteSeo();

const records = computed<SeoRecordType[]>(() => data.value?.data ?? []);
const saving = computed(() => upsert.isPending.value);

// 스코프 메타(라벨·refKey 안내). global 은 전역 단일 레코드라 refKey 를 비활성한다.
interface ScopeMeta { value: SeoScopeType; label: string; refHint: string; refPlaceholder: string }
const GLOBAL_SCOPE: ScopeMeta = { value: 'global', label: '전역 기본 (모든 페이지)', refHint: '전역 기본값 — 개별 설정이 없는 페이지에 적용', refPlaceholder: '' };
const SCOPES: ScopeMeta[] = [
  GLOBAL_SCOPE,
  { value: 'page', label: '정적 페이지 (파일명)', refHint: '스크립트 파일명으로 매칭', refPlaceholder: '예: reviews.php' },
  { value: 'item', label: '상품 (it_id) — P2', refHint: '상품 번호(it_id)로 매칭. 미설정 시 상품 정보에서 자동 유도', refPlaceholder: '예: 1024' },
  { value: 'board', label: '게시판 (bo_table) — P3', refHint: '게시판 테이블명으로 매칭', refPlaceholder: '예: notice' },
];
function scopeLabel(v: string): string {
  return SCOPES.find((s) => s.value === v)?.label ?? v;
}
const activeScope = computed(() => SCOPES.find((s) => s.value === scope.value) ?? GLOBAL_SCOPE);

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
  if (!window.confirm('이 SEO 설정을 삭제할까요? 되돌릴 수 없습니다.')) return;
  error.value = '';
  try {
    await remove.mutateAsync(r.id);
    if (editingId.value === r.id) resetForm();
  } catch (err) {
    error.value = errorMessage(err);
  }
}

const inputCls = 'mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm';
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <div>
      <h1 class="text-xl font-bold">SEO 설정</h1>
      <p class="mt-1 text-sm text-gray-500">
        검색엔진·SNS 공유용 메타 정보입니다. 전역 기본을 먼저 채우고, 특정 페이지만 다르게 하려면
        해당 스코프로 개별 등록하세요. 실제 출력은 사이트 <code class="text-xs">&lt;head&gt;</code>에서 이뤄집니다.
      </p>
    </div>

    <!-- 등록/수정 폼 -->
    <div class="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
      <p class="text-sm font-bold text-gray-800">
        {{ editingId === null ? 'SEO 설정 추가' : 'SEO 설정 수정' }}
      </p>

      <div class="grid grid-cols-2 gap-4">
        <label class="block">
          <span class="text-xs font-semibold text-gray-600">적용 범위</span>
          <select v-model="scope" :class="inputCls">
            <option v-for="s in SCOPES" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </label>
        <label class="block">
          <span class="text-xs font-semibold text-gray-600">매칭 키 (refKey)</span>
          <input
            v-model="refKey"
            type="text"
            maxlength="191"
            :disabled="scope === 'global'"
            :placeholder="activeScope.refPlaceholder"
            :class="[inputCls, scope === 'global' ? 'bg-gray-50 text-gray-400' : '']"
          >
        </label>
      </div>
      <p class="-mt-2 text-xs text-gray-400">{{ activeScope.refHint }}</p>

      <label class="block">
        <span class="text-xs font-semibold text-gray-600">제목 (title) — 비우면 자동/기본 제목</span>
        <input v-model="metaTitle" type="text" maxlength="255" :class="inputCls">
      </label>

      <label class="block">
        <span class="text-xs font-semibold text-gray-600">설명 (description)</span>
        <textarea
          v-model="metaDescription"
          maxlength="500"
          rows="2"
          class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <span class="mt-1 block text-xs text-gray-400">권장 70~160자. og:description 에도 함께 쓰입니다.</span>
      </label>

      <label class="block">
        <span class="text-xs font-semibold text-gray-600">OG 이미지 URL (공유 미리보기)</span>
        <input v-model="ogImage" type="text" maxlength="500" placeholder="/data/… 또는 https://…" :class="inputCls">
      </label>

      <div class="grid grid-cols-2 gap-4">
        <label class="block">
          <span class="text-xs font-semibold text-gray-600">canonical (비우면 현재 URL)</span>
          <input v-model="canonical" type="text" maxlength="500" placeholder="https://…" :class="inputCls">
        </label>
        <label class="block">
          <span class="text-xs font-semibold text-gray-600">robots (비우면 index,follow)</span>
          <input v-model="robots" type="text" maxlength="50" placeholder="noindex,nofollow" :class="inputCls">
        </label>
      </div>

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
      <p v-else-if="records.length === 0" class="p-6 text-sm text-gray-400">
        등록된 SEO 설정이 없습니다. 전역 기본부터 추가해 보세요.
      </p>
      <ul v-else class="divide-y divide-gray-100">
        <li v-for="r in records" :key="r.id" class="flex items-start gap-4 p-4">
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <span class="flex-none rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{{ scopeLabel(r.scope) }}</span>
              <span v-if="r.refKey" class="truncate text-xs text-gray-500">{{ r.refKey }}</span>
              <span v-if="r.robots" class="flex-none rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-600">{{ r.robots }}</span>
            </p>
            <p class="mt-1 truncate text-sm text-gray-800">{{ r.metaTitle || '(제목 자동)' }}</p>
            <p class="truncate text-xs text-gray-400">{{ r.metaDescription || '(설명 없음)' }}</p>
          </div>
          <div class="flex flex-none items-center gap-1">
            <button
              type="button"
              class="rounded border border-gray-200 px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50"
              @click="startEdit(r)"
            >수정</button>
            <button
              type="button"
              class="rounded border border-gray-200 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
              @click="onDelete(r)"
            >삭제</button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
