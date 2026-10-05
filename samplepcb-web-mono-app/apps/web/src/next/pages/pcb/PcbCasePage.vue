<script setup lang="ts">
import { TriangleAlertIcon } from '@lucide/vue';
import CaseCustomerCard from '@/next/components/common/CaseCustomerCard.vue';
import AsCasePanel from '@/next/components/pcb/AsCasePanel.vue';
import ClaimStrip from '@/next/components/pcb/ClaimStrip.vue';
import CaseExternalDialogs from './case/CaseExternalDialogs.vue';
import CaseHeader from './case/CaseHeader.vue';
import CaseSummary from './case/CaseSummary.vue';
import MailSection from './case/MailSection.vue';
import PoSection from './case/PoSection.vue';
import RfqSection from './case/RfqSection.vue';
import SpecPanel from './case/SpecPanel.vue';
import AssignDialog from './case/dialogs/AssignDialog.vue';
import PoEditDialog from './case/dialogs/PoEditDialog.vue';
import PoIssueDialog from './case/dialogs/PoIssueDialog.vue';
import PriceDialog from './case/dialogs/PriceDialog.vue';
import ReplyDialog from './case/dialogs/ReplyDialog.vue';
import SelectDialog from './case/dialogs/SelectDialog.vue';
import { providePcbCase } from './case/usePcbCase';

// PCB Case 상세 — docs/PCB_PARTNER_TRACK.md §5.4. 옛 pages/admin/AdminPcbCase.vue 의 리뉴얼.
// 스펙 요약 + 협력사 RFQ 패널(배정 diff·대리 회신·선정/해제·매직링크) + 발주·EQ + 선적 + A/S·클레임 + 보낸 메일.
// 프로세스: 회신 비교 → [선정] → [확정가 등록] → 고객 주문 → 발주 → EQ → 생산 → 선적 → 입고 → 고객 배송.
// 상태·조작은 case/usePcbCase(core·rfq·po·shipment)가 한 곳에 들고, 섹션 컴포넌트는 그리기만 한다.
const { detail, specId, actionError, specPanelOpen, specPanelPinned } = providePcbCase();
</script>

<template>
  <!-- 사양 곁판을 고정하면 본문이 자리를 내준다(push). 잠깐 열 때는 덮고(overlay), 계속 열어 둘 때는 겹치지
       않게 — 계속 보는 사람에게 덮개는 방해고, 잠깐 보는 사람에게 리플로우는 과하다. -->
  <div
    class="flex flex-col gap-4 transition-all duration-200 motion-reduce:transition-none"
    :class="specPanelPinned && specPanelOpen ? 'md:pr-116' : ''"
  >
    <CaseHeader />

    <p
      v-if="actionError !== ''"
      role="alert"
      class="bg-destructive-soft text-destructive flex items-start gap-2 rounded-lg px-3 py-2 text-sm font-medium"
    >
      <TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />
      {{ actionError }}
    </p>

    <CaseCustomerCard v-if="detail !== null" :customer="detail.customer" />
    <CaseSummary />
    <RfqSection />
    <PoSection />

    <!-- A/S 재발주 — 완료·출고 건 재생산 접수 → 협력사 회신 → 회차 발주서.
         고객 클레임 — 판정은 워크큐 단일 창구, 여기선 신호 + 대리 접수만. -->
    <ClaimStrip v-if="detail !== null && specId !== null" :spec-id="specId" />
    <AsCasePanel v-if="detail !== null && specId !== null" :spec-id="specId" />

    <MailSection />

    <SpecPanel />
    <PoIssueDialog />
    <PoEditDialog />
    <PriceDialog />
    <AssignDialog />
    <ReplyDialog />
    <SelectDialog />
    <CaseExternalDialogs />
  </div>
</template>
