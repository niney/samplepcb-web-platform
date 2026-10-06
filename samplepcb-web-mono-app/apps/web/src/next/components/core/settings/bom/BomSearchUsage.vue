<script setup lang="ts">
import type { BomSupplierSearchOperationsType } from '@sp/api-contract';
import Panel from '@/next/components/common/Panel.vue';

// 공급사 검색 한도·사용량 네 칸 — 관리자 설정 · 엔진 안전 상한 · 실제 적용 한도(강조) · 오늘 검색.
// 옛 BomQuoteSettingsForm '공급사 검색 운영' 첫 줄 그대로. 관리자 설정 칸은 입력 중인 값을 바로 보인다.
const props = defineProps<{
  configuredMaxCalls: number;
  memberDailySearchLimit: number;
  engineMaxCalls: number | null;
  effectiveMaxCalls: number | null;
  supplierSearch: BomSupplierSearchOperationsType | null;
}>();

const num = (value: number | null | undefined): string => (typeof value === 'number' ? value.toLocaleString('ko-KR') : '');
</script>

<template>
  <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
    <Panel tone="muted">
      <p class="text-muted-foreground text-xs">관리자 설정</p>
      <strong class="mt-0.5 block text-lg tabular-nums">{{ num(props.configuredMaxCalls) }}회</strong>
    </Panel>
    <Panel tone="muted">
      <p class="text-muted-foreground text-xs">엔진 안전 상한</p>
      <strong class="mt-0.5 block text-lg tabular-nums">
        {{ props.engineMaxCalls !== null ? num(props.engineMaxCalls) : '확인 불가'
        }}<template v-if="props.engineMaxCalls !== null">회</template>
      </strong>
    </Panel>
    <Panel tone="info">
      <p class="text-xs">실제 적용 한도</p>
      <strong class="mt-0.5 block text-lg tabular-nums">
        {{ props.effectiveMaxCalls !== null ? num(props.effectiveMaxCalls) : '확인 불가'
        }}<template v-if="props.effectiveMaxCalls !== null">회</template>
      </strong>
    </Panel>
    <Panel tone="muted">
      <p class="text-muted-foreground text-xs">오늘 검색</p>
      <strong class="mt-0.5 block text-lg tabular-nums">{{ num(props.supplierSearch?.todayUsage.totalSearches ?? 0) }}회</strong>
      <p class="text-muted-foreground text-xs tabular-nums">
        회원 {{ props.supplierSearch?.todayUsage.memberCount ?? 0 }}명 · 최대
        {{ props.supplierSearch?.todayUsage.maxMemberSearches ?? 0 }}/{{ props.memberDailySearchLimit }}
      </p>
    </Panel>
  </div>
</template>
