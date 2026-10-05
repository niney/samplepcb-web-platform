<script setup lang="ts">
import { ArrowLeftIcon, FileTextIcon, MailIcon, Trash2Icon } from '@lucide/vue';
import { formatDate } from '@/lib/format';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { smartbomQuoteStatusBadge } from '@/next/components/smartbom/smartbom-badges';
import { NEXT_SMARTBOM_ROUTES } from '@/next/smartbom-navigation';
import { useSmartbomCaseContext } from './useSmartbomCase';

// 머리 — 진행현황 복귀 · Case 번호·제목·상태 · (오른쪽) 견적서 미리보기·빠른 메일·Case 삭제.
// 삭제는 PCB Case 상세와 같은 자리·같은 모양(2026-10-06 사용자 결정 — 옛 화면은 맨 아래 '위험 구역'이었다).
const { detail, caseNo, patch, openEstimatePreview, mailOpen, caseDeleteOpen } = useSmartbomCaseContext();
</script>

<template>
  <header class="flex flex-col gap-2">
    <RouterLink
      :to="{ name: NEXT_SMARTBOM_ROUTES.cases }"
      class="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
    >
      <ArrowLeftIcon class="size-4" />
      진행현황
    </RouterLink>
    <div v-if="detail !== null" class="flex flex-wrap items-center gap-2">
      <h1 class="flex min-w-0 items-baseline gap-2 text-xl font-semibold tracking-tight">
        <span class="text-muted-foreground font-mono text-base">{{ caseNo }}</span>
        <span class="truncate">{{ detail.title }}</span>
      </h1>
      <Badge :variant="smartbomQuoteStatusBadge(detail.status).variant">
        {{ smartbomQuoteStatusBadge(detail.status).label }}
      </Badge>
      <!-- 취소된 견적 — 고객에게 고지한 날이 지나면 자동 정리가 지운다(통합 메뉴 "삭제 기록"). -->
      <span
        v-if="detail.status === 'canceled' && detail.purgeAfter !== null"
        class="text-muted-foreground text-xs"
        data-testid="case-purge-date"
      >
        {{ formatDate(detail.purgeAfter) }} 이후 자동 삭제
      </span>
      <div class="ml-auto flex items-center gap-2">
        <!-- 견적서(§6.8) — 확정 전이면 시트가 "가안" 표기. 회신 전이면 현재 입력값을 먼저 저장한다. -->
        <Button variant="outline" size="sm" :disabled="patch.isPending.value" @click="void openEstimatePreview()">
          <FileTextIcon />
          견적서 미리보기
        </Button>
        <!-- 빠른 메일(§6.15) — 고객에게 바로 한 통. -->
        <Button variant="outline" size="sm" @click="mailOpen = true">
          <MailIcon />
          메일
        </Button>
        <!-- 영구 삭제 — 목록 행이 아니라 상세 단건에만 둔다(오작동 방지). 삭제를 막는 발주·선적을 정리하는 곳이
             바로 이 화면이라 정리하고 곧장 지울 수 있게 머리에 둔다. 차단·경고 판정은 대화상자(서버 정본). -->
        <Button variant="outline" size="sm" @click="caseDeleteOpen = true">
          <Trash2Icon class="text-destructive" />
          Case 삭제
        </Button>
      </div>
    </div>
  </header>
</template>
