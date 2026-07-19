<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiRequestError, useAuthStore } from '@sp/shared';
import type { BomQuoteStatusType } from '@sp/api-contract';
import { useCreateBomQuote, useDeleteBomQuote, useMyBomQuotes } from '../../bom/useBom';

// 고객 스마트 BOM 홈 — 업로드(견적 생성) + 내 견적 이력. 설계: docs/BOM_QUOTE.md.
// 레거시 spSmartBomV2 의 list 화면 재설계: 서버 저장 견적이 단일 진실(로컬 캐시 없음).

const ALLOWED_EXTS = ['.xlsx', '.xlsm', '.xls', '.csv', '.tsv'] as const;
const MAX_FILE_BYTES = 30 * 1024 * 1024;

const router = useRouter();
const auth = useAuthStore();
const file = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const dragOver = ref(false);
const error = ref('');
const page = ref(1);

const create = useCreateBomQuote();
const removeQuote = useDeleteBomQuote();
const list = useMyBomQuotes(page, computed(() => auth.isLoggedIn));
const quotes = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / 20)));

const STATUS_LABEL: Record<BomQuoteStatusType, { label: string; cls: string }> = {
  draft: { label: '작성 중', cls: 'bg-gray-100 text-gray-600' },
  requested: { label: '견적요청', cls: 'bg-blue-100 text-blue-700' },
  reviewing: { label: '검토 중', cls: 'bg-amber-100 text-amber-700' },
  answered: { label: '회신 완료', cls: 'bg-emerald-100 text-emerald-700' },
  closed: { label: '종료', cls: 'bg-gray-200 text-gray-600' },
  canceled: { label: '취소', cls: 'bg-red-100 text-red-600' },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${String(Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} MB`;
}

function fmtWon(v: number | null): string {
  if (v === null) return '—';
  return `${v.toLocaleString('ko-KR')}원`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function hasAllowedExtension(name: string): boolean {
  const lower = name.toLocaleLowerCase();
  return ALLOWED_EXTS.some((extension) => lower.endsWith(extension));
}

function setFile(next: File | null): void {
  if (next === null) {
    file.value = null;
    return;
  }
  if (!hasAllowedExtension(next.name)) {
    error.value = '엑셀(.xlsx/.xlsm/.xls) 또는 CSV/TSV 파일만 업로드할 수 있습니다.';
    return;
  }
  if (next.size > MAX_FILE_BYTES) {
    error.value = '파일은 30 MB 이하만 업로드할 수 있습니다.';
    return;
  }
  error.value = '';
  file.value = next;
}

function onFileChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  setFile(target.files?.[0] ?? null);
}

function onDrop(event: DragEvent): void {
  dragOver.value = false;
  setFile(event.dataTransfer?.files[0] ?? null);
}

async function submit(): Promise<void> {
  if (file.value === null) {
    error.value = '견적을 낼 BOM 파일을 선택하세요.';
    return;
  }
  error.value = '';
  try {
    const res = await create.mutateAsync(file.value);
    await router.push({ name: 'bom-quote', params: { id: res.data.quoteId } });
  } catch (reason) {
    if (reason instanceof ApiRequestError && reason.payload?.error === 'BOM_ENGINE_UNREACHABLE') {
      error.value = '분석 엔진에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.';
    } else {
      error.value = 'BOM 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    }
  }
}

async function onDelete(quoteId: string): Promise<void> {
  try {
    await removeQuote.mutateAsync(quoteId);
  } catch {
    // 목록 갱신으로 상태 확인 — draft 외 삭제 불가 등
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="max-w-3xl">
      <p class="text-xs font-bold tracking-[0.16em] text-blue-700">SMART BOM</p>
      <h1 class="mt-2 text-2xl font-semibold tracking-tight text-gray-900">BOM 업로드 한 번으로 부품 견적까지</h1>
      <p class="mt-3 text-sm leading-6 text-gray-500">
        업로드한 BOM을 자동 분석해 부품을 매칭하고 예상 견적을 만듭니다. 검토 후 견적요청을 보내면 담당자가 확정 견적으로 회신합니다.
      </p>
    </header>

    <!-- 업로드 -->
    <section class="grid overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm lg:grid-cols-[0.82fr_1.18fr]">
      <div class="bg-slate-900 p-7 text-slate-100">
        <p class="text-xs font-bold tracking-[0.16em] text-emerald-300">STEP 01</p>
        <h2 class="mt-4 text-2xl font-semibold tracking-tight">BOM 파일을 올려주세요</h2>
        <p class="mt-3 text-sm leading-6 text-slate-300">품번·수량·사양을 자동 인식하고, 부품 카탈로그에서 가격·재고를 찾아 예상 견적을 구성합니다.</p>
        <div class="mt-12 border-t border-white/15 pt-5">
          <p class="text-sm font-semibold text-white">외부 LLM 전송 없음</p>
          <p class="mt-1 text-xs leading-5 text-slate-400">BOM 셀 데이터는 외부 AI API가 아니라 서버 안의 SMARTBOM 규칙 엔진으로 분석합니다.</p>
        </div>
      </div>

      <div class="p-6">
        <button
          type="button"
          class="flex min-h-52 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-5 text-center transition disabled:cursor-not-allowed disabled:opacity-60"
          :class="dragOver ? 'border-blue-500 bg-blue-50' : file !== null ? 'border-emerald-300 bg-emerald-50' : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/40'"
          :disabled="create.isPending.value"
          @click="fileInput?.click()"
          @dragenter.prevent="dragOver = true"
          @dragover.prevent
          @dragleave.prevent="dragOver = false"
          @drop.prevent="onDrop"
        >
          <span class="grid h-12 w-14 place-items-center rounded-lg border border-blue-100 bg-blue-50 text-xs font-extrabold tracking-wider text-blue-700">BOM</span>
          <strong class="max-w-full truncate text-base text-gray-900">{{ file?.name ?? '파일을 끌어놓거나 선택하세요' }}</strong>
          <span class="text-sm text-gray-500">{{ file ? `${formatBytes(file.size)} · 선택 완료` : 'XLSX · XLSM · XLS · CSV · TSV / 최대 30 MB' }}</span>
        </button>
        <input ref="fileInput" type="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv" class="hidden" @change="onFileChange">

        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" class="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="file === null || create.isPending.value" @click="submit">
            {{ create.isPending.value ? '업로드 중…' : '분석 시작' }}
          </button>
          <button v-if="file !== null" type="button" class="text-sm font-medium text-gray-500 hover:text-gray-800" @click="setFile(null)">선택 해제</button>
        </div>
        <p v-if="error" class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ error }}</p>
      </div>
    </section>

    <!-- 내 견적 이력 -->
    <section class="space-y-3">
      <div class="flex items-baseline justify-between">
        <h2 class="text-lg font-semibold text-gray-900">내 BOM 견적</h2>
        <span class="text-sm text-gray-400">{{ total }}건</span>
      </div>
      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="px-4 py-2.5">견적명</th>
              <th class="px-4 py-2.5">상태</th>
              <th class="whitespace-nowrap px-4 py-2.5">품목</th>
              <th class="whitespace-nowrap px-4 py-2.5">예상 합계</th>
              <th class="whitespace-nowrap px-4 py-2.5">마지막 수정</th>
              <th class="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr
              v-for="q in quotes"
              :key="q.id"
              class="cursor-pointer hover:bg-blue-50/40"
              @click="router.push({ name: 'bom-quote', params: { id: q.id } })"
            >
              <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">{{ q.title }}</td>
              <td class="px-4 py-2.5">
                <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="STATUS_LABEL[q.status].cls">{{ STATUS_LABEL[q.status].label }}</span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">{{ q.includedCount }}/{{ q.itemCount }} (매칭 {{ q.matchedCount }})</td>
              <td class="whitespace-nowrap px-4 py-2.5 tabular-nums">{{ fmtWon(q.finalTotal) }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ fmtDate(q.updatedAt) }}</td>
              <td class="px-4 py-2.5 text-right">
                <button
                  v-if="q.status === 'draft'"
                  type="button"
                  class="text-xs text-gray-400 hover:text-red-600"
                  @click.stop="onDelete(q.id)"
                >
                  삭제
                </button>
              </td>
            </tr>
            <tr v-if="quotes.length === 0">
              <td colspan="6" class="px-4 py-10 text-center text-sm text-gray-400">
                아직 견적이 없습니다 — 위에서 BOM 파일을 올려 시작하세요.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="totalPages > 1" class="flex items-center gap-2 text-sm">
        <button type="button" class="rounded-md border border-gray-300 bg-white px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40" :disabled="page <= 1" @click="page -= 1">이전</button>
        <span class="text-gray-500">{{ page }} / {{ totalPages }}</span>
        <button type="button" class="rounded-md border border-gray-300 bg-white px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40" :disabled="page >= totalPages" @click="page += 1">다음</button>
      </div>
    </section>
  </div>
</template>
