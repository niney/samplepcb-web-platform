<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { AI_EXTRA_INSTRUCTIONS_MAX, AI_THINK_LEVELS } from '@sp/api-contract';
import type { AiThinkLevelType } from '@sp/api-contract';
import { formatDateTime } from '@/lib/format';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Label } from '@/next/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Switch } from '@/next/components/ui/switch';
import { Textarea } from '@/next/components/ui/textarea';
import { aiThinkLabel, type AiUseCaseKeys } from './ai-labels';

// AI 유스케이스 한 구역(검토서·구성도·개발의뢰 넷) — 머리(제목·유스케이스 코드·사용 스위치) → 사용 안내 →
// 모델 → (thinking 단계) → 추가 지침 → 프롬프트 버전. 옛 AiSettingsForm 의 ②~⑦ 블록이 같은 골격을 여섯 번
// 되풀이하던 것을 하나로 모았다. 문구는 구역마다 옛 화면이 쓰던 i18n 키를 그대로 받는다(keys).
// thinking 단계는 keys.think 가 있을 때만(검토서 생성은 없다). 첨부 판독 모델·샘플 테스트는 슬롯으로.
const props = withDefaults(
  defineProps<{
    /** 입력칸 id 접두(구역마다 다르게). */
    idPrefix: string;
    /** sp_ai_usecase 코드(market.dev-review 등) — 제목 옆에 작게. */
    code: string;
    keys: AiUseCaseKeys;
    /** 저장된 값의 프롬프트 버전·마지막 저장(조회 전이면 undefined). */
    promptVersion?: string | undefined;
    updatedAt?: string | undefined;
    /** 추가 지침 칸 높이 — 옛 화면 rows 6(검토서)·4(나머지). */
    tallExtra?: boolean;
  }>(),
  { promptVersion: undefined, updatedAt: undefined, tallExtra: false },
);

const enabled = defineModel<boolean>('enabled', { required: true });
const model = defineModel<string>('model', { required: true });
const think = defineModel<AiThinkLevelType>('think', { default: 'high' });
const extra = defineModel<string>('extra', { required: true });

const { t } = useI18n();

// NativeSelect 의 change 는 select 원소에 그대로 붙는다 — 사전에 있는 값으로 좁혀 받는다.
const onThinkPick = (event: Event): void => {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
  const hit = AI_THINK_LEVELS.find((level) => level === value);
  if (hit !== undefined) think.value = hit;
};
</script>

<template>
  <SectionCard>
    <template #title>
      {{ t(props.keys.title) }}
      <span class="text-muted-foreground ml-1 font-mono text-xs font-normal">{{ props.code }}</span>
    </template>
    <template #actions>
      <div class="flex items-center gap-2">
        <Switch :id="`${props.idPrefix}-enabled`" v-model="enabled" />
        <Label :for="`${props.idPrefix}-enabled`">{{ t(props.keys.enabled) }}</Label>
      </div>
    </template>

    <p class="text-muted-foreground text-sm">{{ t(props.keys.enabledHint) }}</p>

    <Field>
      <FieldLabel :for="`${props.idPrefix}-model`">{{ t(props.keys.model) }}</FieldLabel>
      <Input :id="`${props.idPrefix}-model`" v-model="model" type="text" list="ai-models" class="font-mono" />
      <FieldDescription>{{ t(props.keys.modelHint) }}</FieldDescription>
    </Field>

    <slot name="after-model" />

    <Field v-if="props.keys.think !== undefined">
      <FieldLabel :for="`${props.idPrefix}-think`">{{ t(props.keys.think) }}</FieldLabel>
      <NativeSelect :id="`${props.idPrefix}-think`" :model-value="think" @change="onThinkPick">
        <NativeSelectOption v-for="level in AI_THINK_LEVELS" :key="level" :value="level">
          {{ aiThinkLabel(t, level) }}
        </NativeSelectOption>
      </NativeSelect>
      <FieldDescription v-if="props.keys.thinkHint !== undefined">{{ t(props.keys.thinkHint) }}</FieldDescription>
    </Field>

    <Field>
      <FieldLabel :for="`${props.idPrefix}-extra`">{{ t(props.keys.extra) }}</FieldLabel>
      <Textarea
        :id="`${props.idPrefix}-extra`"
        v-model="extra"
        :maxlength="AI_EXTRA_INSTRUCTIONS_MAX"
        :class="props.tallExtra ? 'min-h-32' : 'min-h-24'"
      />
      <FieldDescription>
        <span class="flex flex-wrap items-center gap-2">
          <span>{{ t(props.keys.extraHint) }}</span>
          <span class="ml-auto font-mono text-xs tabular-nums">
            {{ t(props.keys.count, { count: extra.length, max: AI_EXTRA_INSTRUCTIONS_MAX }) }}
          </span>
        </span>
      </FieldDescription>
    </Field>

    <div class="grid gap-1 text-sm">
      <span class="font-medium">{{ t(props.keys.promptVersion) }}</span>
      <p class="font-mono">{{ props.promptVersion }}</p>
      <span class="text-muted-foreground text-xs">
        {{ t(props.keys.promptVersionHint) }}
        <template v-if="props.updatedAt !== undefined">
          · {{ t(props.keys.updatedAt) }}
          {{ formatDateTime(props.updatedAt) }}
        </template>
      </span>
    </div>

    <slot name="footer" />
  </SectionCard>
</template>
