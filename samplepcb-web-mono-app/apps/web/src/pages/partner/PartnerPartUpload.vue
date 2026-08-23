<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import {
  PARTNER_PART_COLUMN_ROLES,
  PARTNER_PART_COLUMN_ROLE_LABELS,
  PARTNER_PART_FLAG_LABELS,
  type PartnerPartColumnRoleType,
} from '@sp/api-contract';
import {
  useCancelPartnerPartUpload,
  useCommitPartnerPartUpload,
  usePartnerPartUpload,
  useRemapPartnerPartUpload,
} from '../../partner/usePartnerParts';
import PartnerPageHeader from '../../components/partner/PartnerPageHeader.vue';
import { confirmDialog } from '../../lib/confirmDialog';

// 업로드 확인 화면(docs/PARTNER_PARTS.md) — 반영 전에 사람이 한 번 본다.
//
// 형식이 파일마다 달라서 열 역할을 늘 맞힐 수는 없다. 그래서 틀렸을 때 고치는 길을
// 1급 기능으로 둔다: 역할을 바꾸면 **엔진을 같은 파일로 다시 돌린다**(화면이 셀을
// 재해석하지 않는다 — 판단은 엔진 한 곳).

const route = useRoute();
const router = useRouter();
const uploadId = computed(() =>
  typeof route.params.uploadId === 'string' ? route.params.uploadId : null,
);

const detailQuery = usePartnerPartUpload(uploadId);
const remap = useRemapPartnerPartUpload();
const commit = useCommitPartnerPartUpload();
const cancel = useCancelPartnerPartUpload();

const upload = computed(() => detailQuery.data.value?.data.upload ?? null);
const rows = computed(() => detailQuery.data.value?.data.rows ?? []);
const sheets = computed(() => upload.value?.sheets ?? []);
const stats = computed(() => upload.value?.stats ?? null);
const parsedSheets = computed(() => sheets.value.filter((s) => s.status === 'parsed'));

const error = ref<string | null>(null);
const mode = ref<'replace' | 'merge'>('replace');

// 로컬 역할 편집 — 저장(재분석) 전까지는 화면에만 있다.
const draftRoles = ref<Record<string, PartnerPartColumnRoleType>>({});
watch(
  sheets,
  (next) => {
    const map: Record<string, PartnerPartColumnRoleType> = {};
    for (const sheet of next) {
      for (const column of sheet.columns) {
        map[`${String(sheet.sheetIndex)}:${String(column.column1Based)}`] = column.role;
      }
    }
    draftRoles.value = map;
  },
  { immediate: true },
);

const roleKey = (sheetIndex: number, column1Based: number): string =>
  `${String(sheetIndex)}:${String(column1Based)}`;

const dirty = computed(() =>
  sheets.value.some((sheet) =>
    sheet.columns.some(
      (column) => draftRoles.value[roleKey(sheet.sheetIndex, column.column1Based)] !== column.role,
    ),
  ),
);

const hasPartNumber = computed(() =>
  parsedSheets.value.some((sheet) =>
    sheet.columns.some(
      (column) => draftRoles.value[roleKey(sheet.sheetIndex, column.column1Based)] === 'part_number',
    ),
  ),
);

const applyRemap = async (): Promise<void> => {
  if (uploadId.value === null) return;
  error.value = null;
  const roleOverrides = sheets.value.flatMap((sheet) =>
    sheet.columns.map((column) => ({
      sheetIndex: sheet.sheetIndex,
      column1Based: column.column1Based,
      role: draftRoles.value[roleKey(sheet.sheetIndex, column.column1Based)] ?? column.role,
    })),
  );
  try {
    await remap.mutateAsync({ uploadId: uploadId.value, body: { roleOverrides } });
  } catch (caught) {
    error.value =
      caught instanceof ApiRequestError
        ? (caught.payload?.message ?? '다시 분석하지 못했습니다.')
        : '다시 분석하지 못했습니다.';
  }
};

const applyCommit = async (): Promise<void> => {
  if (uploadId.value === null) return;
  error.value = null;
  const ok = await confirmDialog({
    title: mode.value === 'replace' ? '보유 부품을 이 목록으로 바꿀까요?' : '이 목록을 추가할까요?',
    message:
      mode.value === 'replace'
        ? '기존에 등록된 부품은 모두 지워지고 이번 목록으로 대체됩니다.'
        : '기존 목록은 그대로 두고 이번 목록을 더합니다.',
    confirmLabel: '반영',
  });
  if (!ok) return;
  try {
    await commit.mutateAsync({ uploadId: uploadId.value, mode: mode.value });
    await router.push({ name: 'partner-parts' });
  } catch (caught) {
    error.value =
      caught instanceof ApiRequestError
        ? (caught.payload?.message ?? '반영하지 못했습니다.')
        : '반영하지 못했습니다.';
  }
};

const applyCancel = async (): Promise<void> => {
  if (uploadId.value === null) return;
  const ok = await confirmDialog({
    title: '이 업로드를 취소할까요?',
    message: '분석 결과가 버려집니다. 등록된 부품은 그대로 남습니다.',
    confirmLabel: '취소하기',
    tone: 'danger',
  });
  if (!ok) return;
  await cancel.mutateAsync(uploadId.value);
  await router.push({ name: 'partner-parts' });
};

const fmtQty = (value: number | null): string =>
  value === null ? '—' : value.toLocaleString('ko-KR');
const flagLabel = (flag: string): string => PARTNER_PART_FLAG_LABELS[flag] ?? flag;
const busy = computed(
  () => remap.isPending.value || commit.isPending.value || cancel.isPending.value,
);
</script>

<template>
  <div class="space-y-4">
    <PartnerPageHeader
      :title="upload?.fileName ?? '업로드 확인'"
      subtitle="반영하기 전에 읽은 내용을 확인하세요. 열이 잘못 잡혔으면 아래에서 바꾼 뒤 다시 분석합니다."
      :back="{ to: { name: 'partner-parts' }, label: '보유 부품' }"
    />

    <p v-if="detailQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>

    <template v-else-if="upload !== null">
      <!-- 읽은 결과 요약 -->
      <div v-if="stats !== null" class="grid gap-3 sm:grid-cols-4">
        <div class="rounded-xl border border-gray-200 bg-surface p-4">
          <p class="text-xs text-gray-500">읽은 행</p>
          <p class="mt-1 text-2xl font-bold tabular-nums">{{ fmtQty(stats.rowCount) }}</p>
          <p class="mt-0.5 text-xs text-gray-400">
            고유 품번 {{ fmtQty(stats.distinctMpnCount) }}
          </p>
        </div>
        <div class="rounded-xl border border-gray-200 bg-surface p-4">
          <p class="text-xs text-gray-500">제조사 있음</p>
          <p class="mt-1 text-2xl font-bold tabular-nums">{{ fmtQty(stats.withManufacturer) }}</p>
          <p class="mt-0.5 text-xs text-gray-400">없어도 등록됩니다</p>
        </div>
        <div class="rounded-xl border border-gray-200 bg-surface p-4">
          <p class="text-xs text-gray-500">재고 수량 있음</p>
          <p class="mt-1 text-2xl font-bold tabular-nums">{{ fmtQty(stats.withStock) }}</p>
        </div>
        <div class="rounded-xl border border-gray-200 bg-surface p-4">
          <p class="text-xs text-gray-500">확인 권장</p>
          <p class="mt-1 text-2xl font-bold tabular-nums">
            {{ fmtQty(stats.flaggedRowCount ?? 0) }}<span class="text-base font-normal text-gray-400">행</span>
          </p>
          <p class="mt-0.5 text-xs text-gray-400">그대로 등록해도 됩니다</p>
        </div>
      </div>

      <!-- 열 역할 -->
      <div class="rounded-xl border border-gray-200 bg-surface p-4">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p class="text-sm font-semibold text-gray-800">열을 이렇게 읽었습니다</p>
            <p class="text-xs text-gray-500">
              틀린 게 있으면 바꾼 뒤 [다시 분석]을 누르세요.
            </p>
          </div>
          <button
            type="button"
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            :disabled="!dirty || busy"
            @click="void applyRemap()"
          >
            {{ remap.isPending.value ? '다시 분석 중…' : '다시 분석' }}
          </button>
        </div>

        <div v-for="sheet in sheets" :key="sheet.sheetIndex" class="mt-3">
          <p class="mb-1 text-xs font-semibold text-gray-600">
            {{ sheet.sheetName }}
            <span class="font-normal text-gray-400">
              · {{ fmtQty(sheet.rowCount) }}행
              <template v-if="sheet.headerRow1Based !== null">
                · 머리글 {{ sheet.headerRow1Based }}행
              </template>
            </span>
            <span
              v-if="sheet.status !== 'parsed'"
              class="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500"
            >
              {{ sheet.unparsedReason === 'empty_sheet' ? '빈 시트' : '부품 목록 아님' }}
            </span>
          </p>
          <div v-if="sheet.columns.length > 0" class="flex flex-wrap gap-2">
            <label
              v-for="column in sheet.columns"
              :key="column.column1Based"
              class="flex min-w-[160px] flex-col gap-1 rounded-md border border-gray-200 p-2"
            >
              <span class="truncate text-xs font-medium text-gray-700">
                {{ column.rawHeader === '' ? `${column.column1Based}번째 열` : column.rawHeader }}
              </span>
              <select
                v-model="draftRoles[roleKey(sheet.sheetIndex, column.column1Based)]"
                class="rounded border border-gray-200 bg-surface px-1.5 py-1 text-xs focus:border-amber-400 focus:outline-none"
              >
                <option v-for="role in PARTNER_PART_COLUMN_ROLES" :key="role" :value="role">
                  {{ PARTNER_PART_COLUMN_ROLE_LABELS[role] }}
                </option>
              </select>
            </label>
          </div>
          <p v-for="warning in sheet.warnings" :key="warning" class="mt-1 text-xs text-amber-700">
            {{ warning }}
          </p>
        </div>

        <p v-if="!hasPartNumber" class="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          품번 열이 지정되지 않았습니다 — 품번이 없으면 등록할 수 없습니다.
        </p>
      </div>

      <!-- 표본 행 -->
      <div class="rounded-xl border border-gray-200 bg-surface">
        <p class="border-b border-gray-100 p-3 text-sm font-semibold text-gray-800">
          미리보기
          <span class="font-normal text-gray-400">
            (앞 {{ rows.length }}행 — 반영하면 전체가 등록됩니다)
          </span>
        </p>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[760px] text-sm">
            <thead class="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th class="px-3 py-2 font-semibold">품번</th>
                <th class="px-3 py-2 font-semibold">제조사</th>
                <th class="px-3 py-2 text-right font-semibold">재고</th>
                <th class="px-3 py-2 font-semibold">D/C</th>
                <th class="px-3 py-2 font-semibold">납기</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr v-for="row in rows" :key="row.rowId">
                <td class="px-3 py-2">
                  <p class="font-medium text-gray-900">{{ row.mpn === '' ? '—' : row.mpn }}</p>
                  <p v-if="row.alternatives.length > 0" class="text-[11px] text-gray-400">
                    함께 검색: {{ row.alternatives.join(' · ') }}
                  </p>
                  <span
                    v-for="flag in row.flags"
                    :key="flag"
                    class="mr-1 mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                  >
                    {{ flagLabel(flag) }}
                  </span>
                </td>
                <td class="px-3 py-2 text-gray-700">{{ row.manufacturer ?? '—' }}</td>
                <td class="px-3 py-2 text-right tabular-nums text-gray-700">
                  {{ fmtQty(row.stockQty) }}
                </td>
                <td class="px-3 py-2 text-gray-600">{{ row.dateCode ?? '—' }}</td>
                <td class="px-3 py-2 text-gray-600">{{ row.leadTime ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p v-if="error !== null" role="alert" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ error }}
      </p>

      <!-- 반영 -->
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-surface p-4"
      >
        <div class="flex flex-wrap items-center gap-3 text-sm">
          <label class="flex items-center gap-1.5">
            <input v-model="mode" type="radio" value="replace" class="accent-amber-600">
            <span>전체 교체 <span class="text-xs text-gray-400">(권장)</span></span>
          </label>
          <label class="flex items-center gap-1.5">
            <input v-model="mode" type="radio" value="merge" class="accent-amber-600">
            <span>기존에 추가</span>
          </label>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-md px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-40"
            :disabled="busy"
            @click="void applyCancel()"
          >
            업로드 취소
          </button>
          <button
            type="button"
            class="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
            :disabled="busy || dirty || upload.status !== 'preview'"
            :title="dirty ? '열 역할을 바꿨습니다 — 먼저 [다시 분석]을 눌러 주세요' : undefined"
            @click="void applyCommit()"
          >
            {{ commit.isPending.value ? '반영 중…' : '보유 부품에 반영' }}
          </button>
        </div>
      </div>
    </template>

    <p v-else class="rounded-xl border border-gray-200 bg-surface p-6 text-sm text-gray-500">
      업로드를 찾을 수 없습니다.
    </p>
  </div>
</template>
