<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button } from '@/next/components/ui/button';
import { ButtonGroup } from '@/next/components/ui/button-group';
import { Input } from '@/next/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/next/components/ui/tooltip';

// 확정 납기 필터 — 단일일도 API 에는 from=to 범위로 보내 서버 규칙을 한 벌만 둔다.
// from·to 는 적용된 값(목록 쿼리), 입력 중인 날짜·모드·오류는 이 안에서만 든다.
const props = defineProps<{ from: string; to: string }>();
const emit = defineEmits<{ apply: [from: string, to: string]; clear: [] }>();

type DeliveryFilterMode = 'single' | 'range';

const hasRange = props.from !== '' && props.to !== '';
const mode = ref<DeliveryFilterMode>(hasRange && props.from !== props.to ? 'range' : 'single');
const single = ref(hasRange && props.from === props.to ? props.from : '');
const rangeFrom = ref(props.from);
const rangeTo = ref(props.to);
const error = ref('');

const applied = computed(() => props.from !== '' && props.to !== '');
const appliedLabel = computed(() => (props.from === props.to ? props.from : `${props.from} ~ ${props.to}`));

const setMode = (next: DeliveryFilterMode): void => {
  mode.value = next;
  error.value = '';
};

const apply = (): void => {
  const from = mode.value === 'single' ? single.value : rangeFrom.value;
  const to = mode.value === 'single' ? single.value : rangeTo.value;
  if (from === '' || to === '') {
    error.value = mode.value === 'single' ? '납기일을 선택해 주세요.' : '시작일과 종료일을 모두 선택해 주세요.';
    return;
  }
  if (from > to) {
    error.value = '종료일은 시작일보다 빠를 수 없습니다.';
    return;
  }
  error.value = '';
  emit('apply', from, to);
};

const clear = (): void => {
  single.value = '';
  rangeFrom.value = '';
  rangeTo.value = '';
  error.value = '';
  emit('clear');
};
</script>

<template>
  <div class="flex min-w-0 flex-col items-end gap-1">
    <form class="flex flex-wrap items-center justify-end gap-1.5" @submit.prevent="apply">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <span class="text-muted-foreground cursor-help text-xs font-medium">납기</span>
          </TooltipTrigger>
          <TooltipContent>발주서의 확정 납기 기준입니다. 기간은 양끝 날짜를 모두 포함합니다.</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <ButtonGroup aria-label="납기일 검색 방식">
        <Button
          type="button"
          :variant="mode === 'single' ? 'default' : 'outline'"
          :aria-pressed="mode === 'single'"
          @click="setMode('single')"
        >
          단일일
        </Button>
        <Button
          type="button"
          :variant="mode === 'range' ? 'default' : 'outline'"
          :aria-pressed="mode === 'range'"
          @click="setMode('range')"
        >
          기간
        </Button>
      </ButtonGroup>

      <Input
        v-if="mode === 'single'"
        :model-value="single"
        type="date"
        aria-label="납기일"
        class="w-40"
        @update:model-value="(value) => (single = String(value))"
      />
      <template v-else>
        <Input
          :model-value="rangeFrom"
          type="date"
          aria-label="납기 시작일"
          class="w-40"
          @update:model-value="(value) => (rangeFrom = String(value))"
        />
        <span class="text-muted-foreground">~</span>
        <Input
          :model-value="rangeTo"
          type="date"
          aria-label="납기 종료일"
          class="w-40"
          @update:model-value="(value) => (rangeTo = String(value))"
        />
      </template>

      <Button type="submit">적용</Button>
      <Button v-if="applied" type="button" variant="outline" @click="clear">초기화</Button>
    </form>
    <p v-if="error !== ''" role="alert" class="text-destructive text-xs font-medium">{{ error }}</p>
    <p v-else-if="applied" class="text-primary text-xs font-medium">납기 {{ appliedLabel }} 적용 · 납기 미정 제외</p>
  </div>
</template>
