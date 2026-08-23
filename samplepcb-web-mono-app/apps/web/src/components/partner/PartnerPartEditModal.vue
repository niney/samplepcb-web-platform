<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import type { PartnerPartRowType, PartnerPartUpdateBodyType } from '@sp/api-contract';

// 협력사 보유 부품 행 수정(docs/PARTNER_PARTS.md) — 포털·관리자 공용.
//
// 오타 품번·빠진 제조사·바뀐 재고를 전체 재업로드 없이 한 줄만 고친다.
// 파일 원문(`mpnRaw`)은 서버가 보존하므로 여기서 고치는 것은 **원장 값**뿐이고,
// 둘이 다르면 화면이 원문을 함께 보여 준다(무유실).
// ⚠ 다음 전체 교체 업로드는 원장을 비우므로 수정본도 사라진다 — 그 사실을 알린다.

const props = defineProps<{
  part: PartnerPartRowType | null;
  /** 저장 함수 — 포털은 자기 행, 관리자는 아무 행(호출부가 라우트를 고른다). */
  save: (partId: number, body: PartnerPartUpdateBodyType) => Promise<unknown>;
  busy?: boolean;
}>();
const emit = defineEmits<{ close: []; saved: [] }>();

interface Draft {
  mpn: string;
  manufacturer: string;
  description: string;
  stockQty: string;
  dateCode: string;
  leadTime: string;
  unitPrice: string;
  currency: string;
  moq: string;
}

const empty = (): Draft => ({
  mpn: '',
  manufacturer: '',
  description: '',
  stockQty: '',
  dateCode: '',
  leadTime: '',
  unitPrice: '',
  currency: '',
  moq: '',
});

const draft = ref<Draft>(empty());
const error = ref<string | null>(null);

const numText = (value: number | null): string => (value === null ? '' : String(value));

watch(
  () => props.part,
  (part) => {
    error.value = null;
    draft.value = part === null
      ? empty()
      : {
          mpn: part.mpn,
          manufacturer: part.manufacturer ?? '',
          description: part.description ?? '',
          stockQty: numText(part.stockQty),
          dateCode: part.dateCode ?? '',
          leadTime: part.leadTime ?? '',
          unitPrice: numText(part.unitPrice),
          currency: part.currency ?? '',
          moq: numText(part.moq),
        };
  },
  { immediate: true },
);

/** 빈 칸은 "지움"(null), 숫자 칸은 숫자로. 형식이 틀리면 저장을 막는다. */
const parseNumber = (raw: string, integer: boolean): number | null | 'invalid' => {
  const text = raw.trim();
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return 'invalid';
  if (integer && !Number.isInteger(value)) return 'invalid';
  return value;
};

const mpnChanged = computed(
  () => props.part !== null && draft.value.mpn.trim() !== props.part.mpn,
);

async function submit(): Promise<void> {
  const part = props.part;
  if (part === null) return;
  error.value = null;

  const mpn = draft.value.mpn.trim();
  if (mpn === '') {
    error.value = '품번은 비울 수 없습니다.';
    return;
  }
  const stockQty = parseNumber(draft.value.stockQty, true);
  const moq = parseNumber(draft.value.moq, true);
  const unitPrice = parseNumber(draft.value.unitPrice, false);
  if (stockQty === 'invalid') {
    error.value = '재고는 0 이상의 정수로 입력해 주세요.';
    return;
  }
  if (moq === 'invalid' || moq === 0) {
    error.value = '최소 주문은 1 이상의 정수로 입력해 주세요.';
    return;
  }
  if (unitPrice === 'invalid') {
    error.value = '단가는 0 이상의 숫자로 입력해 주세요.';
    return;
  }

  try {
    await props.save(part.partId, {
      mpn,
      manufacturer: draft.value.manufacturer.trim() === '' ? null : draft.value.manufacturer.trim(),
      description: draft.value.description.trim() === '' ? null : draft.value.description.trim(),
      stockQty,
      dateCode: draft.value.dateCode.trim() === '' ? null : draft.value.dateCode.trim(),
      leadTime: draft.value.leadTime.trim() === '' ? null : draft.value.leadTime.trim(),
      unitPrice,
      currency: draft.value.currency.trim() === '' ? null : draft.value.currency.trim(),
      moq,
    });
    emit('saved');
  } catch (caught) {
    error.value =
      caught instanceof ApiRequestError
        ? (caught.payload?.message ?? '저장하지 못했습니다.')
        : '저장하지 못했습니다.';
  }
}

const FIELD_CLS =
  'w-full rounded-md border border-gray-200 bg-surface px-2.5 py-1.5 text-sm focus:border-amber-400 focus:outline-none';
</script>

<template>
  <div
    v-if="part !== null"
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
    @click.self="emit('close')"
  >
    <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface p-5 shadow-2xl">
      <div class="mb-3">
        <h2 class="text-base font-bold text-gray-900">부품 수정</h2>
        <p class="mt-0.5 text-xs text-gray-500">
          이 한 줄만 고칩니다. 파일 원문은 그대로 남습니다.
        </p>
      </div>

      <p
        v-if="part.mpnRaw !== part.mpn"
        class="mb-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600"
      >
        파일 원문 <span class="font-mono font-semibold">{{ part.mpnRaw }}</span>
      </p>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="sm:col-span-2">
          <span class="mb-1 block text-xs font-semibold text-gray-700">품번</span>
          <input v-model="draft.mpn" type="text" :class="FIELD_CLS" maxlength="191">
        </label>
        <label>
          <span class="mb-1 block text-xs font-semibold text-gray-700">제조사</span>
          <input v-model="draft.manufacturer" type="text" :class="FIELD_CLS" maxlength="191">
        </label>
        <label>
          <span class="mb-1 block text-xs font-semibold text-gray-700">재고 수량</span>
          <input v-model="draft.stockQty" type="text" inputmode="numeric" :class="FIELD_CLS">
        </label>
        <label>
          <span class="mb-1 block text-xs font-semibold text-gray-700">데이트 코드</span>
          <input v-model="draft.dateCode" type="text" :class="FIELD_CLS" maxlength="100">
        </label>
        <label>
          <span class="mb-1 block text-xs font-semibold text-gray-700">납기</span>
          <input v-model="draft.leadTime" type="text" :class="FIELD_CLS" maxlength="100">
        </label>
        <label>
          <span class="mb-1 block text-xs font-semibold text-gray-700">단가</span>
          <input v-model="draft.unitPrice" type="text" inputmode="decimal" :class="FIELD_CLS">
        </label>
        <label>
          <span class="mb-1 block text-xs font-semibold text-gray-700">통화</span>
          <input v-model="draft.currency" type="text" :class="FIELD_CLS" maxlength="8" placeholder="USD">
        </label>
        <label>
          <span class="mb-1 block text-xs font-semibold text-gray-700">최소 주문</span>
          <input v-model="draft.moq" type="text" inputmode="numeric" :class="FIELD_CLS">
        </label>
        <label class="sm:col-span-2">
          <span class="mb-1 block text-xs font-semibold text-gray-700">설명</span>
          <input v-model="draft.description" type="text" :class="FIELD_CLS" maxlength="500">
        </label>
      </div>

      <p
        v-if="mpnChanged"
        class="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800"
      >
        품번을 바꾸면 BOM 검색에 걸리는 조회 키도 새 품번으로 다시 만듭니다.
      </p>
      <p class="mt-2 text-[11px] text-gray-400">
        다음에 <b>전체 교체</b>로 파일을 올리면 이 수정도 함께 사라집니다 — 원본 파일을 고쳐
        올리시면 더 오래갑니다.
      </p>

      <p v-if="error !== null" role="alert" class="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ error }}
      </p>

      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold hover:bg-gray-50"
          @click="emit('close')"
        >
          취소
        </button>
        <button
          type="button"
          class="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-40"
          :disabled="busy === true"
          @click="void submit()"
        >
          {{ busy === true ? '저장 중…' : '저장' }}
        </button>
      </div>
    </div>
  </div>
</template>
