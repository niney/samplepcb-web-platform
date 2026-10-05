<script setup lang="ts">
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import PartSearchPanel from '@/next/components/bom/PartSearchPanel.vue';
import { useCandidateDrawer } from './useCandidateDrawer';

// 전체 부품 검색 — 엔진 후보 밖에서 카탈로그를 직접 찾는다. 고른 결과는 엔진 추천과 섞지 않고
// '직접 검색(카탈로그 직접 선택)'으로 기록된다.
const { props, selectCatalogPart } = useCandidateDrawer();
</script>

<template>
  <div class="flex flex-col gap-3 p-3 sm:p-4">
    <Alert v-if="props.selectionError !== ''" variant="destructive" size="sm">
      <AlertDescription>{{ props.selectionError }}</AlertDescription>
    </Alert>

    <SectionCard title="엔진 후보 밖에서 직접 찾기">
      <template #meta>Manual catalog selection</template>
      <template #notice>
        <NoticeBand tone="info">
          품번·스펙·패키지로 전체 카탈로그를 검색합니다. 선택 결과는 엔진 추천과 섞지 않고
          <b>직접 검색</b>으로 기록됩니다.
        </NoticeBand>
      </template>
      <Panel muted class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span class="text-muted-foreground text-xs font-medium">현재 부품</span>
        <b class="break-all">{{ props.context?.currentMpn || props.searchInitialQuery || '미선정' }}</b>
      </Panel>
    </SectionCard>

    <SectionCard title="카탈로그 검색">
      <template #meta>부품을 고른 뒤 공급 포장·공급사·실제 주문수량과 총액을 확인하고 적용합니다.</template>
      <PartSearchPanel
        :initial-query="props.searchInitialQuery"
        :current-part-id="props.currentPartId"
        :selecting="props.catalogSelecting || props.interactionLocked"
        :browse="props.readOnly"
        :needed="props.needed"
        :usd-krw-rate="props.usdKrwRate"
        @select="selectCatalogPart"
      />
    </SectionCard>
  </div>
</template>
