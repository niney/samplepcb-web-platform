<script setup lang="ts">
import { computed } from 'vue';
import { BanknoteIcon, BanIcon, PackageIcon, PencilIcon, UserCogIcon } from '@lucide/vue';
import type { AdminPcbPoViewType } from '@sp/api-contract';
import { Button } from '@/next/components/ui/button';
import { substituteActionOf, substituteLabelOf } from './case-po';
import { usePcbCaseContext } from './usePcbCase';

// 발주 행의 액션 칸 — **발주 자체**에 대한 것만: 생산·발송 대행(협력사 몫), 송금, 조건 수정, 취소.
// EQ 에 관한 것(판정 — 승인·반려·승인 취소, 고객 확인, 승인요청·추가 EQ 요청 대행, 첨부)은 행 아래의
// EQ 줄(PoEqBand)이 맡는다 — 판정 버튼이 판정 대상(파일·고객 답) 옆에 서게(2026-10-11).
const props = defineProps<{ po: AdminPcbPoViewType }>();

const { showProxy, runSubstitute, canStartShipment, startShipment, remittancePoId, openPoEdit, removePo } = usePcbCaseContext();

/** 생산 시작·생산 완료 대행 — 승인요청 대행(발주접수)은 EQ 줄에 있다. 위임·차단 발주는 하위에서 진행한다. */
const productionProxy = computed(() => {
  const action = substituteActionOf(props.po.status);
  return action === null || action === 'eq-request' || props.po.eqDelegatePoId !== null || props.po.eqBlocked ? null : action;
});
</script>

<template>
  <span class="inline-flex flex-wrap justify-end gap-1">
    <!-- D11 — 협력사 몫 대행(생산 시작·완료). [협력사 대행 동작 보기]가 켜졌거나 포털 계정이 없는 조직일 때만. -->
    <Button v-if="productionProxy !== null && showProxy(po)" variant="outline" size="sm" data-po-proxy @click="void runSubstitute(po)">
      <UserCogIcon />
      {{ substituteLabelOf(po, productionProxy) }}
    </Button>
    <!-- 발송 시작(담기) 대행 — 계정 없는 조직은 포털에서 누를 사람이 없다 -->
    <Button
      v-if="canStartShipment(po) && showProxy(po)"
      variant="outline"
      size="sm"
      title="협력사 포털의 [담기]와 같습니다 — 박스를 열면 아래 선적 줄에서 진행할 수 있습니다."
      @click="void startShipment(po)"
    >
      <PackageIcon />
      발송 시작
    </Button>
    <!-- 송금 원장 — 부분 송금·증빙까지 여기서 다룬다 -->
    <Button variant="outline" size="sm" @click="remittancePoId = po.poId">
      <BanknoteIcon />
      송금
    </Button>
    <!-- 조건 수정 — 결제조건·납기·메모(송금은 원장이 정본이라 여기 없다) -->
    <Button variant="ghost" size="sm" @click="openPoEdit(po)">
      <PencilIcon />
      조건 수정
    </Button>
    <Button v-if="po.status === 'issued'" variant="ghost" size="sm" @click="void removePo(po)">
      <BanIcon class="text-destructive" />
      발주 취소
    </Button>
  </span>
</template>
