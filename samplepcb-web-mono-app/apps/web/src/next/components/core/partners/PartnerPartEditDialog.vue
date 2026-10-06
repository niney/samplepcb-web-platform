<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import type { PartnerPartRowType, PartnerPartUpdateBodyType } from '@sp/api-contract';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';

// 협력사 보유 부품 행 수정(docs/PARTNER_PARTS.md) — 옛 components/partner/PartnerPartEditModal.vue 의 관리자용
// 짝(같은 props·emits). 옛 모달은 파트너 포털도 쓰므로 그대로 두고, 관리자 화면은 언제나 한국어라 문구를 바로 쓴다.
//
// 오타 품번·빠진 제조사·바뀐 재고를 전체 재업로드 없이 한 줄만 고친다. 파일 원문(mpnRaw)은 서버가 보존하므로
// 여기서 고치는 것은 원장 값뿐이고, 둘이 다르면 원문을 함께 보인다. 다음 전체 교체 업로드는 원장을 비우므로
// 수정본도 사라진다 — 그 사실을 알린다.
const props = defineProps<{
  part: PartnerPartRowType | null;
  /** 저장 함수 — 관리자는 아무 행(호출부가 라우트를 고른다). */
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
    draft.value =
      part === null
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

const mpnChanged = computed(() => props.part !== null && draft.value.mpn.trim() !== props.part.mpn);

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
    error.value = caught instanceof ApiRequestError ? (caught.payload?.message ?? '저장하지 못했습니다.') : '저장하지 못했습니다.';
  }
}

type DraftKey = keyof Draft;
interface DraftField {
  key: DraftKey;
  label: string;
  maxlength?: number;
  inputmode?: 'numeric' | 'decimal';
  placeholder?: string;
  wide?: boolean;
}
// 칸 순서는 옛 모달 그대로.
const FIELDS: readonly DraftField[] = [
  { key: 'mpn', label: '품번', maxlength: 191, wide: true },
  { key: 'manufacturer', label: '제조사', maxlength: 191 },
  { key: 'stockQty', label: '재고 수량', inputmode: 'numeric' },
  { key: 'dateCode', label: '데이트 코드', maxlength: 100 },
  { key: 'leadTime', label: '납기', maxlength: 100 },
  { key: 'unitPrice', label: '단가', inputmode: 'decimal' },
  { key: 'currency', label: '통화', maxlength: 8, placeholder: 'USD' },
  { key: 'moq', label: '최소 주문', inputmode: 'numeric' },
  { key: 'description', label: '설명', maxlength: 500, wide: true },
];

const setDraft = (key: DraftKey, value: string | number): void => {
  draft.value = { ...draft.value, [key]: String(value) };
};
const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
</script>

<template>
  <Dialog :open="part !== null" @update:open="onOpenChange">
    <DialogContent v-if="part !== null" class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>부품 수정</DialogTitle>
        <DialogDescription>이 한 줄만 고칩니다. 파일 원문은 그대로 남습니다.</DialogDescription>
      </DialogHeader>

      <Panel v-if="part.mpnRaw !== part.mpn" tone="muted" class="text-muted-foreground text-xs">
        파일 원문 <span class="text-foreground font-mono font-semibold">{{ part.mpnRaw }}</span>
      </Panel>

      <div class="grid gap-x-3 gap-y-4 sm:grid-cols-2">
        <Field v-for="f in FIELDS" :key="f.key" :class="f.wide === true ? 'sm:col-span-2' : ''">
          <FieldLabel :for="`partner-part-${f.key}`">{{ f.label }}</FieldLabel>
          <Input
            :id="`partner-part-${f.key}`"
            :model-value="draft[f.key]"
            type="text"
            :maxlength="f.maxlength"
            :inputmode="f.inputmode"
            :placeholder="f.placeholder"
            @update:model-value="(value: string | number) => setDraft(f.key, value)"
          />
        </Field>
      </div>

      <Alert v-if="mpnChanged" variant="info" size="sm">
        <AlertDescription>품번을 바꾸면 BOM 검색에 걸리는 조회 키도 새 품번으로 다시 만듭니다.</AlertDescription>
      </Alert>
      <p class="text-muted-foreground text-xs">
        다음에 전체 교체로 파일을 올리면 이 수정도 함께 사라집니다 — 원본 파일을 고쳐 올리시면 더 오래갑니다.
      </p>
      <Alert v-if="error !== null" variant="destructive" size="sm" role="alert">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <DialogFooter>
        <Button variant="outline" @click="emit('close')">취소</Button>
        <Button :disabled="busy === true" @click="void submit()">{{ busy === true ? '저장 중…' : '저장' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
