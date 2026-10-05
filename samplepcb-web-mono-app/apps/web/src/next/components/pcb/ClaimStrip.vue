<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowRightIcon, WrenchIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import {
  PCB_CLAIM_KINDS,
  PCB_CLAIM_KIND_LABELS,
  PCB_CLAIM_REMEDIES,
  PCB_CLAIM_REMEDY_LABELS,
  PCB_CLAIM_STATUS_LABELS,
  type PcbClaimKindType,
  type PcbClaimRemedyType,
  type PcbClaimStatusType,
} from '@sp/api-contract';
import { useAdminPcbSpecClaims, useCreateAdminPcbClaim } from '@/admin/useAdminPcbClaims';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Textarea } from '@/next/components/ui/textarea';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { NEXT_PCB_ROUTES } from '@/next/pcb-navigation';
import type { BadgeVariant } from './pcb-badges';

// PCB 클레임(A/S 접수) Case 요약 스트립(P5) — 옛 PcbClaimStrip 과 같은 API. 판정 콕핏은
// 워크큐(A/S·클레임) 한 곳뿐이고(단일 창구), Case 상세는 존재 신호 + 대리 접수(전화·메일 건 —
// spec 컨텍스트가 여기 있다)만 맡는다.
const props = defineProps<{ specId: number }>();

const specIdRef = computed<bigint | null>(() => BigInt(props.specId));
const claimsQuery = useAdminPcbSpecClaims(specIdRef);
const claims = computed(() => claimsQuery.data.value?.data.items ?? []);
const pending = computed(() => claimsQuery.data.value?.data.counts.pending ?? 0);

const STATUS_VARIANT: Record<PcbClaimStatusType, BadgeVariant> = {
  open: 'warning',
  reviewing: 'info',
  resolved: 'success',
  rejected: 'secondary',
};
const statusVariant = (status: PcbClaimStatusType): BadgeVariant => STATUS_VARIANT[status];

const createOpen = ref(false);
const create = useCreateAdminPcbClaim();
const kind = ref<PcbClaimKindType>('quality');
const affectedQty = ref(1);
const remedy = ref<PcbClaimRemedyType>('reproduce');
const description = ref('');
const error = ref('');

const KIND_KEYS = PCB_CLAIM_KINDS;
const REMEDY_KEYS = PCB_CLAIM_REMEDIES;

function openCreate(): void {
  kind.value = 'quality';
  affectedQty.value = 1;
  remedy.value = 'reproduce';
  description.value = '';
  error.value = '';
  createOpen.value = true;
}

const selectValue = (event: Event): string => (event.target as HTMLSelectElement).value;
function onKind(event: Event): void {
  const value = selectValue(event);
  const hit = KIND_KEYS.find((k) => k === value);
  if (hit !== undefined) kind.value = hit;
}
function onRemedy(event: Event): void {
  const value = selectValue(event);
  const hit = REMEDY_KEYS.find((k) => k === value);
  if (hit !== undefined) remedy.value = hit;
}
const setQty = (value: string | number): void => {
  affectedQty.value = Number(value);
};
const setDescription = (value: string | number): void => {
  description.value = String(value);
};

async function submitCreate(): Promise<void> {
  if (description.value.trim().length < 5) {
    error.value = '증상 설명을 5자 이상 입력해 주세요.';
    return;
  }
  error.value = '';
  try {
    await create.mutateAsync({
      specId: BigInt(props.specId),
      body: {
        kind: kind.value,
        affectedQty: affectedQty.value,
        requestedRemedy: remedy.value,
        description: description.value.trim(),
      },
    });
    createOpen.value = false;
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '대리 접수에 실패했습니다.';
  }
}
</script>

<template>
  <SectionCard>
    <template #title>
      <span class="inline-flex items-center gap-1.5">
        <WrenchIcon class="text-muted-foreground size-4" />
        고객 클레임(A/S 접수)
      </span>
    </template>
    <template #meta>
      <Badge v-if="pending > 0" variant="warning">처리 필요 {{ pending }}건</Badge>
      <template v-else-if="claims.length > 0">총 {{ claims.length }}건 · 전부 종결</template>
      <template v-else>접수 없음</template>
    </template>
    <template #actions>
      <Button v-if="claims.length > 0" as-child variant="outline" size="sm">
        <RouterLink :to="{ name: NEXT_PCB_ROUTES.claims }">
          워크큐에서 처리
          <ArrowRightIcon />
        </RouterLink>
      </Button>
      <Button
        variant="outline"
        size="sm"
        title="전화·메일로 받은 A/S 를 고객 대신 접수합니다 — 고객에게 접수 확인 메일이 나갑니다"
        @click="openCreate"
      >
        대리 접수
      </Button>
    </template>
    <!-- 최근 접수 한 줄 요약 — 자세한 검토·판정은 워크큐가 단일 창구다. 0건이면 본문 없이 머리 줄만. -->
    <template v-if="claims.length > 0" #default>
      <ul class="space-y-1">
        <li v-for="c in claims.slice(0, 3)" :key="c.id" class="flex flex-wrap items-center gap-2 text-xs">
          <Badge :variant="statusVariant(c.status)">{{ PCB_CLAIM_STATUS_LABELS[c.status] }}</Badge>
          <span class="font-medium">{{ PCB_CLAIM_KIND_LABELS[c.kind] }}</span>
          <span class="text-muted-foreground tabular-nums">{{ c.affectedQty }}/{{ c.orderedQty }}</span>
          <span class="text-muted-foreground min-w-0 flex-1 truncate" :title="c.description">{{ c.description }}</span>
          <Badge v-if="c.asCaseId !== null" variant="outline">A/S #{{ c.asCaseId }}</Badge>
        </li>
      </ul>
    </template>
  </SectionCard>

  <Dialog v-model:open="createOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>A/S 대리 접수</DialogTitle>
        <DialogDescription>전화·메일로 받은 접수를 고객 대신 입력합니다 — 고객에게 접수 확인 메일이 나갑니다.</DialogDescription>
      </DialogHeader>
      <div class="grid gap-4">
        <Field>
          <FieldLabel for="claim-kind">문제 유형</FieldLabel>
          <NativeSelect id="claim-kind" :model-value="kind" @change="onKind">
            <NativeSelectOption v-for="k in KIND_KEYS" :key="k" :value="k">{{ PCB_CLAIM_KIND_LABELS[k] }}</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel for="claim-qty">문제 수량</FieldLabel>
          <Input id="claim-qty" :model-value="affectedQty" type="number" min="1" @update:model-value="setQty" />
        </Field>
        <Field>
          <FieldLabel for="claim-remedy">고객 희망 처리</FieldLabel>
          <NativeSelect id="claim-remedy" :model-value="remedy" @change="onRemedy">
            <NativeSelectOption v-for="r in REMEDY_KEYS" :key="r" :value="r">{{ PCB_CLAIM_REMEDY_LABELS[r] }}</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel for="claim-desc">증상 설명 <span class="text-destructive">*</span></FieldLabel>
          <Textarea
            id="claim-desc"
            :model-value="description"
            rows="3"
            maxlength="2000"
            placeholder="고객이 말한 증상을 그대로 적어 주세요."
            @update:model-value="setDescription"
          />
        </Field>
      </div>
      <p v-if="error !== ''" class="text-destructive text-sm font-medium">{{ error }}</p>
      <DialogFooter>
        <Button variant="outline" @click="createOpen = false">취소</Button>
        <Button :disabled="create.isPending.value" @click="void submitCreate()">접수</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
