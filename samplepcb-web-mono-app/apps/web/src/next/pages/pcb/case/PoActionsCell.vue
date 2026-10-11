<script setup lang="ts">
import { computed } from 'vue';
import {
  BanknoteIcon,
  BanIcon,
  CheckIcon,
  MessageCircleQuestionIcon,
  PackageIcon,
  PencilIcon,
  Undo2Icon,
  UserCogIcon,
  XIcon,
} from '@lucide/vue';
import {
  PCB_EQ_REOPEN,
  pcbEqForwardLabel,
  pcbEqRejectActionLabel,
  pcbEqRevertLabel,
  type AdminPcbPoViewType,
} from '@sp/api-contract';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { pcbEqUnfixedLabel, pcbEqUnfixedTitle } from '@/next/components/pcb/pos/pos-badges';
import { substituteActionOf, substituteLabelOf } from './case-po';
import { usePcbCaseContext } from './usePcbCase';

// 발주 행의 액션 칸 — EQ 판정(승인·반려·되돌리기), 협력사 몫 대행, 발송 시작, 송금, 조건 수정, 취소.
// 고객 확인은 EQ 칸(PoEqCell)의 칩 + [EQ 열기] 가 맡는다(D20 — 작업공간 하나로 모았다).
const props = defineProps<{ po: AdminPcbPoViewType }>();

const {
  poRework,
  canSubstituteReopen,
  substituteReopen,
  eqUnfixedAfterReject,
  approvePo,
  rejectPoId,
  revertPo,
  runSubstitute,
  canStartShipment,
  startShipment,
  remittancePoId,
  openPoEdit,
  removePo,
} = usePcbCaseContext();

/** 경고의 기준이 된 경계 — 관리자 반려인가, 협력사 추가 EQ 요청인가(문구가 다르다, 판정은 같다). */
const reworkKind = computed(() => poRework(props.po)?.kind ?? 'reject');
</script>

<template>
  <span class="inline-flex flex-wrap justify-end gap-1">
    <!-- 고객 확인(D16 문구형·D20 문항형)은 EQ 칸의 상태 칩 + [EQ 열기] 하나로 옮겼다 — 여기는 판정·대행 버튼만. -->
    <template v-if="po.status === 'eq_requested' && po.eqDelegatePoId === null">
      <!-- 반려(보완 요청)했거나 협력사가 추가 EQ 를 요청했는데 그 뒤로 올라온 파일이 없다 = 같은 파일로 온 재요청.
           승인 버튼 옆이 아니면 볼 이유가 없는 정보다. -->
      <Badge v-if="eqUnfixedAfterReject(po)" variant="danger" :title="pcbEqUnfixedTitle(po.track, reworkKind)" data-eq-unfixed>
        {{ pcbEqUnfixedLabel(po.track, reworkKind) }}
      </Badge>
      <Button
        size="sm"
        :title="po.track === 'stencil' ? '확인하면 좌표파일이 고객 주문내역에서 내려받기 가능해집니다(통보는 없습니다).' : undefined"
        @click="void approvePo(po)"
      >
        <CheckIcon />
        {{ pcbEqForwardLabel('eq_requested', po.track) }}
      </Button>
      <!-- 반려는 스텐실에도 남긴다 — 좌표파일이 틀렸을 때 돌려보낼 유일한 문이다. -->
      <Button variant="outline" size="sm" @click="rejectPoId = po.poId">
        <XIcon class="text-destructive" />
        {{ pcbEqRejectActionLabel(po.track) }}
      </Button>
    </template>
    <Button v-if="po.status === 'eq_done' && po.eqDelegatePoId === null" variant="ghost" size="sm" @click="void revertPo(po)">
      <Undo2Icon />
      {{ pcbEqRevertLabel('eq_done', po.track) }}
    </Button>
    <!-- D11 — 협력사 몫 전이 대행(위임/차단 발주는 하위에서 진행) -->
    <Button
      v-if="substituteActionOf(po.status) !== null && po.eqDelegatePoId === null && !po.eqBlocked"
      variant="outline"
      size="sm"
      @click="void runSubstitute(po)"
    >
      <UserCogIcon />
      {{ substituteLabelOf(po, substituteActionOf(po.status) ?? 'eq-request') }}
    </Button>
    <!-- 추가 EQ 요청 대행(D20 후속) — 승인 뒤 협력사가 포털에서 누르는 전이. 생산 시작 전·EQ 트랙에서만. -->
    <Button
      v-if="canSubstituteReopen(po)"
      variant="outline"
      size="sm"
      title="협력사 포털의 [추가 EQ 요청]과 같습니다 — 사유를 적으면 발주가 '발주접수'로 돌아가 EQ 를 다시 올릴 수 있습니다."
      @click="void substituteReopen(po)"
    >
      <MessageCircleQuestionIcon />
      {{ PCB_EQ_REOPEN.label }}(대행)
    </Button>
    <!-- 발송 시작(담기) 대행 — 계정 없는 조직은 포털에서 누를 사람이 없다 -->
    <Button
      v-if="canStartShipment(po)"
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
