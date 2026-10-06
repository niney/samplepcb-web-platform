<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEVELOP_TASK_STATUS_LABELS } from '@sp/api-contract';
import { developGanttModel } from '@/components/admin/develop/develop-doc-edit';
import type { DevelopTaskRow } from '@/components/admin/develop/develop-doc-edit';
import Panel from '@/next/components/common/Panel.vue';
import { DEVELOP_TASK_BAR_CLASS } from '@/next/components/develop/develop-badges';

// 간트 — **실제 날짜** 기준(옛 components/admin/develop/DevelopTaskGantt.vue 의 짝, 모델은 같은 순수 함수 developGanttModel).
// 전체 범위 = 가장 이른 시작일 ~ 가장 늦은 완료일, 격자는 주 단위, 막대 위치·폭은 날짜 비례.
// 위치·폭은 CSS 변수(--x·--w)로 넘기고 클래스 left-(--x)·w-(--w) 가 받는다(인라인 위치 스타일을 직접 쓰지 않는다).
// 날짜가 없는 행은 자리를 못 잡으므로 아래 '일정 미정' 줄로 뺀다.
const props = defineProps<{ rows: readonly DevelopTaskRow[] }>();

const { t } = useI18n();
const model = computed(() => developGanttModel(props.rows));
const nameOf = (name: string, index: number): string =>
  name.trim() === '' ? t('admin.develop.docs.task.unnamed', { seq: index + 1 }) : name;
const pct = (value: number): string => `${String(value)}%`;
</script>

<template>
  <Panel>
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-sm font-semibold">{{ t('admin.develop.docs.gantt.title') }}</h3>
      <span v-if="model !== null" class="text-muted-foreground text-xs tabular-nums">
        {{ model.startOn }} ~ {{ model.endOn }} · {{ t('admin.develop.docs.gantt.days', { days: model.totalDays }) }}
      </span>
    </div>

    <p v-if="model === null" class="text-muted-foreground mt-2 text-xs">{{ t('admin.develop.docs.gantt.noRange') }}</p>

    <div v-else class="mt-2 overflow-x-auto">
      <div class="min-w-160">
        <!-- 주 단위 눈금 -->
        <div class="relative ml-42 h-4 border-b">
          <span
            v-for="tick in model.ticks"
            :key="tick.label"
            class="text-muted-foreground absolute top-0 left-(--x) -translate-x-1/2 text-xs leading-none tabular-nums"
            :style="{ '--x': pct(tick.leftPct) }"
          >{{ tick.label }}</span>
        </div>

        <ul class="mt-1 grid gap-1">
          <li v-for="bar in model.bars" :key="bar.index" class="flex items-center gap-2">
            <span class="w-40 shrink-0 truncate text-xs" :title="nameOf(bar.name, bar.index)">{{ nameOf(bar.name, bar.index) }}</span>
            <span class="bg-muted/50 relative h-4 min-w-0 flex-1 rounded">
              <span
                v-for="tick in model.ticks"
                :key="tick.label"
                class="bg-border absolute top-0 left-(--x) h-full w-px"
                :style="{ '--x': pct(tick.leftPct) }"
              />
              <span
                class="absolute top-0.5 left-(--x) h-3 w-(--w) rounded-full"
                :class="DEVELOP_TASK_BAR_CLASS[bar.status]"
                :style="{ '--x': pct(bar.leftPct), '--w': pct(Math.max(bar.widthPct, 1.2)) }"
                :title="`${bar.startOn} ~ ${bar.endOn} · ${DEVELOP_TASK_STATUS_LABELS[bar.status]}`"
              />
            </span>
          </li>
        </ul>

        <p v-if="model.undated.length > 0" class="text-muted-foreground mt-2 text-xs">
          {{ t('admin.develop.docs.gantt.undated') }}:
          {{ model.undated.map((u) => nameOf(u.name, u.index)).join(' · ') }}
        </p>
      </div>
    </div>
  </Panel>
</template>
