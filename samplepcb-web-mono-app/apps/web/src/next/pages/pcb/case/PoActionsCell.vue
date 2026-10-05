<script setup lang="ts">
import {
  BanknoteIcon,
  BanIcon,
  CheckIcon,
  PackageIcon,
  PencilIcon,
  Undo2Icon,
  UserCogIcon,
  XIcon,
} from '@lucide/vue';
import { pcbEqForwardLabel, pcbEqRejectActionLabel, pcbEqRevertLabel, type AdminPcbPoViewType } from '@sp/api-contract';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { EQ_REVIEW_DOT } from './case-badges';
import { substituteActionOf, substituteLabelOf } from './case-po';
import { usePcbCaseContext } from './usePcbCase';

// 발주 행의 액션 칸 — EQ 판정(고객 확인·승인·반려·되돌리기), 협력사 몫 대행, 발송 시작, 송금, 조건 수정, 취소.
defineProps<{ po: AdminPcbPoViewType }>();

const {
  eqReviewPo,
  eqReviewStateOf,
  eqReviewLabelOf,
  eqReviewTitleOf,
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
</script>

<template>
  <span class="inline-flex flex-wrap justify-end gap-1">
    <template v-if="po.status === 'eq_requested' && po.eqDelegatePoId === null">
      <!-- 고객 확인 — 승인 전에 고객에게 물어볼 수 있다. 버튼이 상태를 입는다: 미요청 → 확인중 → 승인/반려. -->
      <Button variant="outline" size="sm" :title="eqReviewTitleOf(po)" @click="eqReviewPo = po">
        <span class="size-2 rounded-full" :class="EQ_REVIEW_DOT[eqReviewStateOf(po)]" />
        {{ eqReviewLabelOf(po) }}
      </Button>
      <!-- 반려(보완 요청)했는데 그 뒤로 올라온 파일이 없다 = 같은 파일로 온 재요청. 승인 버튼 옆이 아니면
           볼 이유가 없는 정보다. -->
      <Badge
        v-if="eqUnfixedAfterReject(po)"
        variant="danger"
        :title="po.track === 'stencil'
          ? '직전 보완 요청 이후 새로 올라온 첨부가 없습니다 — 같은 파일로 다시 확인 요청됐을 수 있습니다.'
          : '직전 반려 이후 새로 올라온 EQ 첨부가 없습니다 — 같은 도면으로 다시 승인요청됐을 수 있습니다.'"
      >
        {{ po.track === 'stencil' ? '보완 요청 후 새 파일 없음' : '반려 후 새 파일 없음' }}
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
    <!-- EQ 단계가 지나도 고객 확인 결과는 남긴다(승인의 근거) — 클릭하면 이력. -->
    <Button v-else-if="po.eqReview !== null" variant="outline" size="sm" :title="eqReviewTitleOf(po)" @click="eqReviewPo = po">
      <span class="size-2 rounded-full" :class="EQ_REVIEW_DOT[eqReviewStateOf(po)]" />
      {{ eqReviewLabelOf(po) }}
    </Button>
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
