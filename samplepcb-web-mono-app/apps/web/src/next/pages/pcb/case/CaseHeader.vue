<script setup lang="ts">
import { ArrowLeftIcon, ArrowRightIcon, FileTextIcon, Trash2Icon } from '@lucide/vue';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { pcbQuoteBadge } from '@/next/components/pcb/pcb-badges';
import { usePcbCaseContext } from './usePcbCase';

// Case 머리 — 복귀 링크 · 견적번호+프로젝트 · 상태 배지 · 두 축 불일치 신호 · 견적서/삭제.
const {
  specId,
  detail,
  backTarget,
  rfqGate,
  axisMismatch,
  caseDirectShipCountry,
  completeDirectShip,
  openCustomerShip,
  estimateEnabled,
  estimateBlockedReason,
  estimateProjectId,
  deleteOpen,
} = usePcbCaseContext();
</script>

<template>
  <header class="flex flex-col gap-2">
    <RouterLink
      :to="backTarget.to"
      class="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
    >
      <ArrowLeftIcon class="size-4" />
      {{ backTarget.label }}
    </RouterLink>
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="flex min-w-0 items-baseline gap-2 text-xl font-semibold tracking-tight">
        <span class="text-muted-foreground font-mono text-base">Q{{ specId }}</span>
        <span class="truncate">{{ detail?.projectName ?? '' }}</span>
      </h1>
      <template v-if="detail !== null">
        <Badge :variant="pcbQuoteBadge(detail.quoteStatus).variant">{{ pcbQuoteBadge(detail.quoteStatus).label }}</Badge>
        <Badge v-if="detail.cartState === 'cart'" variant="warning">장바구니 담김</Badge>
        <Badge v-if="detail.order !== null" variant="info">주문됨 · {{ detail.order.odStatus }}</Badge>
        <Badge v-if="detail.order !== null && rfqGate === 'ok'" variant="outline">원가 소싱 모드 — 판매가 불변</Badge>
      </template>
      <!-- 두 축 불일치 — 주문(od)과 협력 트랙은 서로를 게이트하지 않는다. 강제로 막지 않는 대신 보이게 한다. -->
      <Badge
        v-if="axisMismatch === 'shipped-without-po'"
        variant="warning"
        title="주문은 배송·완료까지 갔는데 협력사 발주 기록이 없습니다(레거시·수동 처리 건일 수 있습니다)"
      >
        협력 발주 없이 진행된 주문
      </Badge>
      <!-- 직송 건은 관리자가 보낼 실물이 없다 — 유도 액션이 [직송 완료](운송장 없이 완료 종결)로 바뀐다. -->
      <Button
        v-else-if="axisMismatch === 'received-not-delivered' && caseDirectShipCountry !== null"
        variant="secondary"
        size="sm"
        :title="`직송(${caseDirectShipCountry}) 건 — 실물은 주문지로 직송됐습니다. 운송장 없이 완료로 종결하세요`"
        @click="void completeDirectShip()"
      >
        직송 완료 대기 · 직송 완료
        <ArrowRightIcon />
      </Button>
      <Button
        v-else-if="axisMismatch === 'received-not-delivered'"
        variant="secondary"
        size="sm"
        title="입고가 끝났는데 고객 주문 상태가 아직 배송 전입니다 — 운송장을 입력해 배송 처리하세요"
        @click="openCustomerShip"
      >
        <span class="bg-warning size-2 rounded-full" />
        배송 처리 대기 · 배송 처리
        <ArrowRightIcon />
      </Button>
      <!-- 견적서는 확정 전이어도 자리를 지킨다(비활성 + 사유 툴팁). 위험 버튼(삭제) 왼쪽에 중립으로. -->
      <div v-if="specId !== null" class="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="!estimateEnabled"
          :title="estimateBlockedReason"
          @click="estimateProjectId = specId"
        >
          <FileTextIcon />
          견적서
        </Button>
        <!-- 영구 삭제 — 차단을 푸는 곳(발주 취소·선적 취소)이 바로 이 화면이라 정리하고 곧장 지울 수 있게 둔다. -->
        <Button variant="outline" size="sm" @click="deleteOpen = true">
          <Trash2Icon class="text-destructive" />
          견적 삭제
        </Button>
      </div>
    </div>
  </header>
</template>
