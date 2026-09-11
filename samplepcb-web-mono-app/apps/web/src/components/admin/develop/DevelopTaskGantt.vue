<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEVELOP_TASK_STATUS_LABELS } from '@sp/api-contract';
import { developGanttModel, developTaskBarClass } from './develop-doc-edit';
import type { DevelopTaskRow } from './develop-doc-edit';

// 간트 — **실제 날짜** 기준이다(프로토타입의 순서 기반 가짜 위치는 계약 주석대로 안 가져온다).
// 전체 범위 = 가장 이른 시작일 ~ 가장 늦은 완료일, 격자는 주 단위, 막대 위치·폭은 날짜 비례.
// 날짜가 없는 행은 자리를 못 잡으므로 아래 '일정 미정' 목록으로 뺀다.
const props = defineProps<{ rows: readonly DevelopTaskRow[] }>();

const { t } = useI18n();
const model = computed(() => developGanttModel(props.rows));
const nameOf = (name: string, index: number): string =>
  name.trim() === '' ? t('admin.develop.docs.task.unnamed', { seq: index + 1 }) : name;
</script>

<template>
  <div class="rounded-lg border border-gray-200 p-3">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-sm font-bold text-gray-800">{{ t('admin.develop.docs.gantt.title') }}</h3>
      <span v-if="model !== null" class="text-xs text-gray-500">
        {{ model.startOn }} ~ {{ model.endOn }} · {{ t('admin.develop.docs.gantt.days', { days: model.totalDays }) }}
      </span>
    </div>

    <p v-if="model === null" class="mt-2 text-xs text-gray-400">{{ t('admin.develop.docs.gantt.noRange') }}</p>

    <div v-else class="mt-2 overflow-x-auto">
      <div class="min-w-[640px]">
        <!-- 주 단위 눈금 -->
        <div class="relative ml-[168px] h-4 border-b border-gray-200">
          <span
            v-for="tick in model.ticks"
            :key="tick.label"
            class="absolute top-0 -translate-x-1/2 text-[10px] text-gray-400"
            :style="{ left: `${String(tick.leftPct)}%` }"
          >{{ tick.label }}</span>
        </div>

        <ul class="mt-1 grid gap-1">
          <li v-for="bar in model.bars" :key="bar.index" class="flex items-center gap-2">
            <span class="w-[160px] shrink-0 truncate text-xs text-gray-700">{{ nameOf(bar.name, bar.index) }}</span>
            <span class="relative h-4 min-w-0 flex-1 rounded bg-gray-50">
              <span
                v-for="tick in model.ticks"
                :key="tick.label"
                class="absolute top-0 h-full w-px bg-gray-200"
                :style="{ left: `${String(tick.leftPct)}%` }"
              />
              <span
                class="absolute top-0.5 h-3 rounded-full"
                :class="developTaskBarClass(bar.status)"
                :style="{ left: `${String(bar.leftPct)}%`, width: `${String(Math.max(bar.widthPct, 1.2))}%` }"
                :title="`${bar.startOn} ~ ${bar.endOn} · ${DEVELOP_TASK_STATUS_LABELS[bar.status]}`"
              />
            </span>
          </li>
        </ul>

        <p v-if="model.undated.length > 0" class="mt-2 text-[11px] text-gray-400">
          {{ t('admin.develop.docs.gantt.undated') }}:
          {{ model.undated.map((u) => nameOf(u.name, u.index)).join(' · ') }}
        </p>
      </div>
    </div>
  </div>
</template>
