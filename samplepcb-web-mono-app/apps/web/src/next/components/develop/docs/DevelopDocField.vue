<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { PlusIcon, Trash2Icon } from '@lucide/vue';
import type { AcceptableValue } from 'reka-ui';
import type {
  DevelopDocContentType,
  DevelopDocFieldSpec,
  DevelopDocFieldValueType,
  DevelopDocTypeType,
} from '@sp/api-contract';
import {
  developDocCodes,
  developDocRows,
  developDocText,
  emptyDevelopDocRow,
} from '@/components/admin/develop/develop-doc-edit';
import Panel from '@/next/components/common/Panel.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Input } from '@/next/components/ui/input';
import { Label } from '@/next/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import { Textarea } from '@/next/components/ui/textarea';

// 문서 필드 하나(계약 필드 스펙 DEVELOP_DOC_FIELDS 의 한 항목) — 편집기가 머리(meta)·본문 필드를 모두 이 한 부품으로 그린다.
// 값 형태는 계약 그대로: text·textarea·date·datetime·select → string · checklist → 코드 배열 · table → 행 배열.
// 새 값을 통째로 올려 보낸다(v-model) — 편집기가 본문 객체를 들고 dirty 를 판정한다.
// 읽기 전용(서버 스냅샷 — 수락 견적의 계약 요약)은 입력 없이 값만, 비어 있으면 '수락 견적 없음'.
const props = withDefaults(
  defineProps<{
    field: DevelopDocFieldSpec;
    docType: DevelopDocTypeType;
    modelValue: DevelopDocFieldValueType | undefined;
    /** label·input 짝 id 접두(문서마다 고유). */
    idPrefix: string;
    /** 필드 검사 결과 문구(없으면 ''). */
    issue?: string;
    /** 문서 머리 줄(meta) — 한 줄 칸으로 작게. */
    compact?: boolean;
  }>(),
  { issue: '', compact: false },
);
const emit = defineEmits<{ 'update:modelValue': [value: DevelopDocFieldValueType] }>();

const { t } = useI18n();

const id = computed(() => `${props.idPrefix}-${props.field.key}`);
// 값 접근은 옛 편집기와 같은 순수 함수(develop-doc-edit.ts)로 — 이 필드 하나만 담은 본문으로 감싸 부른다.
const single = computed<DevelopDocContentType>(() =>
  props.modelValue === undefined ? {} : { [props.field.key]: props.modelValue },
);
const text = computed(() => developDocText(single.value, props.field.key));
const codes = computed(() => developDocCodes(single.value, props.field.key));
const rows = computed(() => developDocRows(single.value, props.field.key));

const inputType = computed(() =>
  props.field.kind === 'date' ? 'date' : props.field.kind === 'datetime' ? 'datetime-local' : 'text',
);
const readonlyText = computed(() => (text.value === '' ? t('admin.develop.docs.editor.noContract') : text.value));

const setText = (value: string | number): void => {
  emit('update:modelValue', String(value));
};
const setSelect = (value: AcceptableValue): void => {
  emit('update:modelValue', typeof value === 'string' ? value : '');
};
const toggleCode = (code: string, on: boolean): void => {
  const current = codes.value;
  emit('update:modelValue', on ? (current.includes(code) ? current : [...current, code]) : current.filter((c) => c !== code));
};
const setCell = (index: number, col: string, value: string): void => {
  emit(
    'update:modelValue',
    rows.value.map((row, i) => (i === index ? { ...row, [col]: value } : row)),
  );
};
const addRow = (): void => {
  emit('update:modelValue', [...rows.value, emptyDevelopDocRow(props.docType, props.field.key)]);
};
const removeRow = (index: number): void => {
  emit(
    'update:modelValue',
    rows.value.filter((_, i) => i !== index),
  );
};
const cellSelect = (index: number, col: string, value: AcceptableValue): void => {
  setCell(index, col, typeof value === 'string' ? value : '');
};
</script>

<template>
  <div class="grid min-w-0 gap-1.5">
    <Label v-if="props.field.kind !== 'checklist' && props.field.kind !== 'table'" :for="id">
      {{ props.field.label }}
    </Label>
    <span v-else class="text-sm leading-none font-medium">{{ props.field.label }}</span>

    <!-- 읽기 전용(계약 요약 스냅샷) — 값만 보여 준다. -->
    <template v-if="props.field.readonly === true">
      <Panel
        :id="id"
        size="xs"
        tone="muted"
        class="text-sm"
        :class="[props.compact ? 'flex h-8 items-center truncate' : 'whitespace-pre-line', text === '' ? 'text-muted-foreground' : '']"
        :title="t('admin.develop.docs.editor.fromQuote')"
      >
        {{ readonlyText }}
      </Panel>
      <span v-if="!props.compact" class="text-muted-foreground text-xs">{{ t('admin.develop.docs.editor.fromQuote') }}</span>
    </template>

    <!-- 체크박스 격자 -->
    <Panel v-else-if="props.field.kind === 'checklist'" size="sm" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div v-for="o in props.field.options ?? []" :key="o.code" class="flex items-center gap-2">
        <Checkbox
          :id="`${id}-${o.code}`"
          :model-value="codes.includes(o.code)"
          @update:model-value="(v) => toggleCode(o.code, v === true)"
        />
        <Label :for="`${id}-${o.code}`">{{ o.label }}</Label>
      </div>
    </Panel>

    <!-- 표 -->
    <TableCard v-else-if="props.field.kind === 'table'">
      <Table class="min-w-130">
        <TableHeader>
          <TableRow>
            <TableHead v-for="c in props.field.columns ?? []" :key="c.key" :class="c.width === 'narrow' ? 'w-28' : ''">
              {{ c.label }}
            </TableHead>
            <TableHead class="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="(row, index) in rows" :key="index">
            <TableCell v-for="c in props.field.columns ?? []" :key="c.key">
              <NativeSelect
                v-if="c.kind === 'select'"
                :model-value="row[c.key] ?? ''"
                :aria-label="c.label"
                @update:model-value="(v) => cellSelect(index, c.key, v)"
              >
                <NativeSelectOption value="">{{ t('admin.develop.docs.editor.selectEmpty') }}</NativeSelectOption>
                <NativeSelectOption v-for="o in c.options ?? []" :key="o.code" :value="o.code">{{ o.label }}</NativeSelectOption>
              </NativeSelect>
              <Input
                v-else
                :model-value="row[c.key] ?? ''"
                :type="c.kind === 'date' ? 'date' : 'text'"
                :aria-label="c.label"
                @update:model-value="(v) => setCell(index, c.key, String(v))"
              />
            </TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="xs" @click="removeRow(index)">
                <Trash2Icon class="text-destructive" />
                {{ t('admin.develop.docs.task.remove') }}
              </Button>
            </TableCell>
          </TableRow>
          <TableEmptyRow v-if="rows.length === 0" :colspan="(props.field.columns ?? []).length + 1" :text="t('admin.develop.docs.editor.tableEmpty')" />
        </TableBody>
      </Table>
      <div class="border-t px-4 py-2">
        <Button variant="outline" size="xs" @click="addRow">
          <PlusIcon />
          {{ t('admin.develop.docs.editor.addRow') }}
        </Button>
      </div>
    </TableCard>

    <NativeSelect
      v-else-if="props.field.kind === 'select'"
      :id="id"
      :model-value="text"
      @update:model-value="setSelect"
    >
      <NativeSelectOption value="">{{ t('admin.develop.docs.editor.selectEmpty') }}</NativeSelectOption>
      <NativeSelectOption v-for="o in props.field.options ?? []" :key="o.code" :value="o.code">{{ o.label }}</NativeSelectOption>
    </NativeSelect>

    <Textarea
      v-else-if="props.field.kind === 'textarea'"
      :id="id"
      :model-value="text"
      rows="3"
      :maxlength="20000"
      :placeholder="props.field.placeholder ?? ''"
      @update:model-value="setText"
    />

    <Input
      v-else
      :id="id"
      :model-value="text"
      :type="inputType"
      :placeholder="props.field.placeholder ?? ''"
      @update:model-value="setText"
    />

    <span v-if="props.field.hint !== undefined" class="text-muted-foreground text-xs">{{ props.field.hint }}</span>
    <span v-if="props.issue !== ''" class="text-destructive text-xs font-medium">{{ props.issue }}</span>
  </div>
</template>
