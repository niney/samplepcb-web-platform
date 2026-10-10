<script setup lang="ts">
import { computed } from 'vue';
import {
  PARTNER_CAPABILITIES,
  PARTNER_CAPABILITY_LABELS,
  PARTNER_TYPES,
  PARTNER_TYPE_LABELS,
  type PartnerCapabilityType,
  type PartnerTypeType,
} from '@sp/api-contract';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Label } from '@/next/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Textarea } from '@/next/components/ui/textarea';
import type { PartnerForm } from './partner-form';

// 파트너 등록·수정 칸 — 옛 화면의 두 폼(생성 모달·상세 드로어)이 같은 칸을 썼다. 수정(edit)은 담당자·전화·
// 이메일(RFQ 알림 수신)·발주 고정 안내·내부 메모를 더 보이고, 등록(create)은 담당자 이메일만 받는다.
// 국가·통화는 서버가 대문자로 맞추지만 입력 중에도 대문자로 보이게 바로 올린다(옛 화면은 CSS 로만 대문자).
// masterDealerLock — 마스터딜러 체크를 바꿀 수 없는 이유(하위가 연결돼 있으면 끌 수 없다). null=바꿀 수 있다.
const props = withDefaults(
  defineProps<{ mode: 'create' | 'edit'; idPrefix: string; masterDealerLock?: string | null }>(),
  { masterDealerLock: null },
);
const form = defineModel<PartnerForm>({ required: true });

type TextKey = Exclude<keyof PartnerForm, 'type' | 'capabilities' | 'isMasterDealer'>;

const setMasterDealer = (checked: boolean | 'indeterminate'): void => {
  form.value = { ...form.value, isMasterDealer: checked === true };
};

const set = (key: TextKey, value: string | number): void => {
  const text = String(value);
  form.value = { ...form.value, [key]: key === 'country' || key === 'defaultCurrency' ? text.toUpperCase() : text };
};
const setType = (event: Event): void => {
  form.value = { ...form.value, type: (event.target as HTMLSelectElement).value as PartnerTypeType };
};
const toggleCapability = (cap: PartnerCapabilityType, checked: boolean | 'indeterminate'): void => {
  const rest = form.value.capabilities.filter((c) => c !== cap);
  form.value = { ...form.value, capabilities: checked === true ? [...rest, cap] : rest };
};

interface TextField {
  key: TextKey;
  label: string;
  maxlength?: number;
  placeholder?: string;
  type?: 'text' | 'email';
  wide?: boolean;
  mono?: boolean;
}

const isEdit = computed(() => props.mode === 'edit');
const isPartner = computed(() => form.value.type === 'partner');

// 기본 칸 — 순서는 옛 화면 그대로(유형 · 이름 · supplierCode · 국가 · 통화 · 연락처).
const basicFields = computed<TextField[]>(() => [
  { key: 'name', label: '이름(회사명)' },
  ...(isPartner.value ? [] : [{ key: 'supplierCode' as const, label: 'supplierCode', placeholder: 'digikey', mono: true }]),
  { key: 'country', label: `국가(ISO 2)${isPartner.value ? ' *' : ''}`, maxlength: 2, placeholder: 'KR' },
  { key: 'defaultCurrency', label: '기본 통화', maxlength: 3 },
  ...(isEdit.value
    ? [
        { key: 'contactName' as const, label: '담당자' },
        { key: 'contactPhone' as const, label: '전화' },
        { key: 'contactEmail' as const, label: '이메일(RFQ 알림 수신)', type: 'email' as const },
      ]
    : [{ key: 'contactEmail' as const, label: '담당자 이메일', type: 'email' as const }]),
]);

const businessFields: readonly TextField[] = [
  { key: 'businessNo', label: '사업자등록번호', maxlength: 30 },
  { key: 'ownerName', label: '대표자명', maxlength: 100 },
  { key: 'businessZip', label: '우편번호', maxlength: 10 },
  { key: 'fax', label: '팩스번호', maxlength: 50 },
  { key: 'businessAddress', label: '사업장주소', maxlength: 500, wide: true },
  { key: 'businessType', label: '업태', maxlength: 100 },
  { key: 'businessItem', label: '종목', maxlength: 100 },
];

const fieldId = (key: string): string => `${props.idPrefix}-${key}`;
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="grid grid-cols-2 gap-x-3 gap-y-4">
      <Field>
        <FieldLabel :for="fieldId('type')">유형</FieldLabel>
        <!-- 마스터딜러는 사람 협력사의 한 갈래라 유형 옆에 둔다(docs/PARTNER_PORTAL.md "마스터딜러 지정"). -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <NativeSelect :id="fieldId('type')" :model-value="form.type" @change="setType">
            <NativeSelectOption v-for="t in PARTNER_TYPES" :key="t" :value="t">{{ PARTNER_TYPE_LABELS[t] }}</NativeSelectOption>
          </NativeSelect>
          <div
            v-if="isPartner"
            class="flex items-center gap-1.5"
            :title="masterDealerLock ?? '받은 견적요청·발주를 하위 협력사에 다시 맡기는 조직'"
          >
            <Checkbox
              :id="fieldId('master-dealer')"
              :model-value="form.isMasterDealer"
              :disabled="masterDealerLock !== null"
              data-testid="partner-master-dealer"
              @update:model-value="setMasterDealer"
            />
            <Label :for="fieldId('master-dealer')">마스터딜러</Label>
          </div>
        </div>
      </Field>
      <Field v-for="f in basicFields" :key="f.key">
        <FieldLabel :for="fieldId(f.key)">{{ f.label }}</FieldLabel>
        <Input
          :id="fieldId(f.key)"
          :model-value="form[f.key]"
          :type="f.type ?? 'text'"
          :maxlength="f.maxlength"
          :placeholder="f.placeholder"
          :class="f.mono === true ? 'font-mono' : ''"
          @update:model-value="(value: string | number) => set(f.key, value)"
        />
      </Field>
    </div>

    <FieldSet>
      <FieldLegend variant="label">거래 문서 사업자정보</FieldLegend>
      <p v-if="isEdit" class="text-warning text-xs">견적서는 PO 발행 시점의 정보로 고정됩니다. 발주 전에 확인해 주세요.</p>
      <div class="grid grid-cols-2 gap-x-3 gap-y-4">
        <Field v-for="f in businessFields" :key="f.key" :class="f.wide === true ? 'col-span-2' : ''">
          <FieldLabel :for="fieldId(f.key)">{{ f.label }}</FieldLabel>
          <Input
            :id="fieldId(f.key)"
            :model-value="form[f.key]"
            type="text"
            :maxlength="f.maxlength"
            @update:model-value="(value: string | number) => set(f.key, value)"
          />
        </Field>
      </div>
    </FieldSet>

    <FieldSet>
      <FieldLegend variant="label">{{ isEdit ? '참여 트랙(capabilities)' : '참여 트랙' }}</FieldLegend>
      <div class="flex flex-wrap gap-x-5 gap-y-2">
        <div v-for="c in PARTNER_CAPABILITIES" :key="c" class="flex items-center gap-2">
          <Checkbox
            :id="fieldId(`cap-${c}`)"
            :model-value="form.capabilities.includes(c)"
            @update:model-value="(checked: boolean | 'indeterminate') => toggleCapability(c, checked)"
          />
          <Label :for="fieldId(`cap-${c}`)">{{ PARTNER_CAPABILITY_LABELS[c] }}</Label>
        </div>
      </div>
    </FieldSet>

    <Field v-if="isEdit">
      <FieldLabel :for="fieldId('memo')">내부 메모(협력사 비노출)</FieldLabel>
      <Textarea
        :id="fieldId('memo')"
        :model-value="form.memo"
        rows="2"
        @update:model-value="(value: string | number) => set('memo', value)"
      />
    </Field>
  </div>
</template>
