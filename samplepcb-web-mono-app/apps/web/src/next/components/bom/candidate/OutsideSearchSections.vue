<script setup lang="ts">
import { SearchIcon } from '@lucide/vue';
import { Button } from '@/next/components/ui/button';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { useCandidateDrawer } from './useCandidateDrawer';

// 후보 목록 아래 — 최근 선택 이력 다섯 건과, 엔진 후보 밖에서 찾는 길(현재 부품 구매 조건·전체 부품 검색).
const { props, emit, view, sourceLabel } = useCandidateDrawer();
</script>

<template>
  <SectionCard v-if="props.context !== null && props.context.events.length > 0" title="선택 이력">
    <div class="flex flex-col gap-1.5">
      <Panel
        v-for="event in props.context.events.slice(0, 5)"
        :key="event.id"
        size="xs"
        muted
        class="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between"
      >
        <span>
          <b>{{ sourceLabel(event.source) }}</b> · {{ event.previousMpn ?? '미선정' }} → {{ event.selectedMpn ?? '미선정' }}
        </span>
        <span class="text-muted-foreground">{{ new Date(event.createdAt).toLocaleString('ko-KR') }}</span>
      </Panel>
    </div>
  </SectionCard>

  <SectionCard v-if="!props.readOnly" title="엔진 후보 밖에서 찾기">
    <template #meta>품번·스펙으로 카탈로그를 직접 검색할 수 있습니다.</template>
    <template #actions>
      <Button
        v-if="props.hasCatalogPart"
        variant="outline"
        size="sm"
        :disabled="props.interactionLocked"
        @click="emit('catalogOffers')"
      >
        현재 부품 구매 조건
      </Button>
      <Button variant="outline" size="sm" :disabled="props.interactionLocked" @click="view = 'search'">
        <SearchIcon />
        전체 부품 검색
      </Button>
    </template>
  </SectionCard>
</template>
