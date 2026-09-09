<script setup lang="ts">
import { computed } from 'vue';
import { WORK_TASK_LABELS, workDay, workProgress, workTimeline } from '@sp/api-contract';
import type { WorkPlanType, WorkTaskType } from '@sp/api-contract';
const props = defineProps<{ plan: WorkPlanType }>();
const tasks = computed(() => props.plan.tasks.filter((t) => t.status !== 'skipped'));
const timeline = computed(() => workTimeline(tasks.value));
const progress = computed(() => workProgress(tasks.value));
const current = computed(
  () =>
    tasks.value
      .filter((t) => t.status === 'in_progress')
      .map((t) => t.title)
      .join(' · ') || '일정 준비 중',
);
const bar = (task: WorkTaskType): Record<string, string> => {
  const span = timeline.value;
  if (span === null || task.start === null || task.end === null) return {};
  return {
    left: `${String(((workDay(task.start) - workDay(span.start)) / span.days) * 100)}%`,
    width: `${String(((workDay(task.end) - workDay(task.start) + 1) / span.days) * 100)}%`,
  };
};
</script>
<template>
  <div class="work-plan-view">
    <div class="metrics">
      <div>
        <span>전체 달성도</span><strong>{{ progress }}<small>%</small></strong><span>제외 작업을 뺀 가중치 기준</span>
      </div>
      <div>
        <span>현재 진행</span><strong class="current">{{ current }}</strong>
      </div>
      <div>
        <span>예상 완료일</span><strong class="current">{{ plan.forecastEnd ?? timeline?.end ?? '미정' }}</strong><span>기준 완료일 {{ plan.baselineEnd ?? '미정' }}</span>
      </div>
    </div>
    <div
      class="progress-track"
      role="progressbar"
      :aria-valuenow="progress"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-label="전체 달성도"
    >
      <i :style="{ width: `${progress}%` }" />
    </div>
    <div v-if="plan.completedReport || plan.currentReport || plan.nextReport" class="reports">
      <section
        v-for="item in [
          { title: '완료 업무', text: plan.completedReport },
          { title: '현재 진행', text: plan.currentReport },
          { title: '다음 예정', text: plan.nextReport },
        ]"
        :key="item.title"
      >
        <h4>{{ item.title }}</h4>
        <p>{{ item.text || '아직 등록되지 않았습니다.' }}</p>
      </section>
    </div>
    <p v-if="tasks.length === 0" class="empty">공유할 작업 일정을 준비하고 있습니다.</p>
    <div v-else class="gantt-scroll">
      <div class="gantt">
        <div class="gantt-row heading">
          <span>작업</span><span>상태</span>
          <div class="axis">
            <span>{{ timeline?.start ?? '시작일 미정' }}</span><span>{{ timeline?.end ?? '완료일 미정' }}</span>
          </div>
          <span>진행률</span>
        </div>
        <div v-for="task in tasks" :key="task.id" class="gantt-row">
          <span class="task-name">{{ task.title
          }}<small>{{ task.start ?? '미정' }} ~ {{ task.end ?? '미정' }}</small></span>
          <span>{{ WORK_TASK_LABELS[task.status] }}</span>
          <div
            v-if="task.start && task.end"
            class="track"
            :aria-label="`${task.title}: ${task.start}부터 ${task.end}까지`"
          >
            <i class="bar" :class="task.status" :style="bar(task)" />
          </div>
          <span v-else class="no-date">일정을 입력하면 표시됩니다.</span>
          <b>{{ task.progress }}%</b>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.work-plan-view {
  color: var(--color-tx-1, #152033);
}
.metrics {
  display: grid;
  grid-template-columns: 1fr 1.5fr 1fr;
  gap: 12px;
}
.metrics > div {
  display: grid;
  gap: 9px;
  padding: 18px;
  border: 1px solid var(--color-line, #d9e1ec);
  border-radius: 12px;
  background: var(--color-paper, #fff);
}
.metrics span {
  font-size: 12px;
  color: var(--color-tx-3, #64748b);
}
.metrics strong {
  font-size: 30px;
  line-height: 1.3;
}
.metrics strong.current {
  font-size: 18px;
}
.metrics small {
  font-size: 16px;
}
.progress-track {
  height: 8px;
  border-radius: 5px;
  background: var(--color-line, #d9e1ec);
  overflow: hidden;
  margin: 18px 0;
}
.progress-track i {
  display: block;
  height: 100%;
  background: var(--color-brand-600, #2864dc);
}
.reports {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin: 20px 0;
}
.reports section {
  padding: 12px;
  border-left: 3px solid var(--color-line, #d9e1ec);
}
h4 {
  font-size: 13px;
  font-weight: 700;
  margin: 0 0 8px;
}
p {
  white-space: pre-wrap;
  font-size: 13px;
}
.gantt-scroll {
  overflow: auto;
}
.gantt {
  min-width: 680px;
}
.gantt-row {
  display: grid;
  grid-template-columns: 190px 75px 1fr 50px;
  gap: 12px;
  align-items: center;
  border-bottom: 1px solid var(--color-line, #d9e1ec);
  padding: 12px 0;
  font-size: 12px;
}
.heading {
  color: var(--color-tx-3, #64748b);
  font-weight: 700;
}
.axis {
  display: flex;
  justify-content: space-between;
}
.task-name {
  font-weight: 650;
}
.task-name small {
  display: block;
  font-size: 10px;
  font-weight: 400;
  color: var(--color-tx-3, #64748b);
  margin-top: 4px;
}
.track {
  position: relative;
  height: 24px;
  border-radius: 4px;
  background: repeating-linear-gradient(
    90deg,
    var(--color-paper, #f3f6fa) 0,
    var(--color-paper, #f3f6fa) calc(12.5% - 1px),
    var(--color-line, #d9e1ec) 12.5%
  );
}
.bar {
  position: absolute;
  top: 4px;
  height: 16px;
  min-width: 2px;
  border-radius: 3px;
  background: var(--color-brand-300, #8fb3f1);
}
.bar.in_progress,
.bar.completed {
  background: var(--color-brand-600, #2864dc);
}
.bar.blocked {
  background: var(--color-tx-3, #64748b);
}
.no-date,
.empty {
  color: var(--color-tx-3, #64748b);
}
@media (max-width: 700px) {
  .metrics,
  .reports {
    grid-template-columns: 1fr;
  }
  .metrics strong {
    font-size: 24px;
  }
}
@media print {
  .gantt {
    min-width: 0;
  }
  .gantt-row {
    grid-template-columns: 150px 60px 1fr 45px;
  }
  .metrics,
  .reports {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
