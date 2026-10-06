<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { SearchIcon } from '@lucide/vue';
import type { AdminMemberDetailType } from '@sp/api-contract';
import { formatDate, formatKrw } from '@/lib/format';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/next/components/ui/item';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { pcbQuoteBadge } from '@/next/components/pcb/pcb-badges';
import { LEGACY_CORE_QUOTES_ROUTE } from '@/next/core-navigation';

// 최근 견적(PCB 견적 최근 5건) — 상태 색은 PCB 견적 배지 사전(견적 대기=주의·자동견적=진행·확정=끝남),
// 글자는 옛 화면과 같은 i18n. '견적 관리에서 검색'은 리뉴얼하지 않은 옛 견적관리로 간다.
const props = defineProps<{ detail: AdminMemberDetailType }>();
const { t } = useI18n();
const router = useRouter();

const searchInQuotes = (): void => {
  void router.push({ name: LEGACY_CORE_QUOTES_ROUTE, query: { q: props.detail.mbId } });
};
</script>

<template>
  <SectionCard :title="t('admin.members.drawer.recentProjects')">
    <template #meta>
      <span class="tabular-nums">({{ props.detail.projectCount }})</span>
    </template>
    <template #actions>
      <Button variant="outline" size="sm" @click="searchInQuotes">
        <SearchIcon />
        {{ t('admin.members.drawer.searchQuotes') }}
      </Button>
    </template>

    <div v-if="props.detail.recentProjects.length > 0" class="flex flex-col gap-2">
      <Item v-for="rp in props.detail.recentProjects" :key="rp.projectId" variant="outline" size="sm">
        <ItemContent class="min-w-0">
          <ItemTitle class="w-full min-w-0">
            <span class="min-w-0 truncate" :title="rp.projectName">{{ rp.projectName }}</span>
          </ItemTitle>
          <ItemDescription><span class="tabular-nums">{{ formatDate(rp.createdAt) }}</span></ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge :variant="pcbQuoteBadge(rp.quoteStatus).variant">{{ t(`admin.quotes.badge.${rp.quoteStatus}`) }}</Badge>
          <span class="text-sm tabular-nums">{{ rp.price !== null ? formatKrw(rp.price) : '-' }}</span>
        </ItemActions>
      </Item>
    </div>
    <p v-else class="text-muted-foreground text-sm">{{ t('admin.members.drawer.noProjects') }}</p>
  </SectionCard>
</template>
