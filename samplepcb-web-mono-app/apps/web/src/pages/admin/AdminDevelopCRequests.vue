<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import DevelopQueueTable from '../../components/admin/develop-c/DevelopQueueTable.vue';
import { DEVELOP_QUEUE_PRESETS, DEVELOP_REQUESTS_TABS } from '../../components/admin/develop-c/develop-queue';

// 전체 의뢰(docs/DEVELOP_FLOW.md §7.3·§14) — 단계별 큐가 놓치는 건까지 전 상태를 한 표에서.
// 탭 counts · 검색 · 행 클릭 상세는 공용 표(DevelopQueueTable)가 담당한다. 합산 탭
// (intake·contract)은 여기서 숨긴다 — 같은 건이 두 번 세어져 헷갈린다.
const { t } = useI18n();
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold">{{ t('admin.developC.title') }}</h1>
    <DevelopQueueTable :tabs="DEVELOP_REQUESTS_TABS" default-tab="all" :columns="DEVELOP_QUEUE_PRESETS.requests" />
  </div>
</template>
