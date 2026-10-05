<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeftIcon, ArrowRightIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_PART_EVENT_LABELS,
  BOM_SHIPMENT_MODE_LABELS,
  bomShipmentStatusLabel,
  type AdminBomPartPackageActionBodyType,
} from '@sp/api-contract';
import { useAdminBomPackage, useAdminBomPackageAction } from '@/admin/useAdminBomPos';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Card } from '@/next/components/ui/card';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Spinner } from '@/next/components/ui/spinner';
import { Textarea } from '@/next/components/ui/textarea';
import PageHeader from '@/next/components/common/PageHeader.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { bomPackageStatusBadge } from '@/next/components/smartbom/smartbom-badges';
import { confirmDialog } from '@/next/lib/dialog';
import { NEXT_SMARTBOM_ROUTES, smartbomCaseTo } from '@/next/smartbom-navigation';

// QR 스캔 도착 화면(D24) — 옛 pages/admin/AdminSmartbomPackage.vue 의 짝. URL token 또는 라벨의 human code를
// 서버에서 조회한다. token은 권한이 아니며 이 라우트와 API 모두 관리자 인증 뒤에만 접근 가능하다.

const route = useRoute();
const code = computed(() => {
  const raw = route.params.code;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
});
const query = useAdminBomPackage(code);
const detail = computed(() => query.data.value?.data ?? null);
const mutation = useAdminBomPackageAction();

const location = ref('');
const note = ref('');
const actionError = ref('');

watch(
  () => detail.value?.storageLocation,
  (value) => {
    location.value = value ?? '';
  },
  { immediate: true },
);

const loadError = computed(() => {
  const cause = query.error.value;
  if (cause === null) return '';
  return cause instanceof ApiRequestError ? cause.message : 'QR 포장을 조회하지 못했습니다.';
});

const canReceive = computed(() => detail.value?.status === 'prepared');
const canInspect = computed(() => detail.value?.status === 'received');
const canStore = computed(() =>
  detail.value === null ? false : ['received', 'inspected', 'stored'].includes(detail.value.status),
);
const canIssue = computed(() =>
  detail.value === null ? false : ['received', 'inspected', 'stored'].includes(detail.value.status),
);

async function submit(action: AdminBomPartPackageActionBodyType['action']): Promise<void> {
  if (code.value === null || detail.value === null || mutation.isPending.value) return;
  actionError.value = '';
  if (action === 'store' && location.value.trim() === '') {
    actionError.value = '보관 위치를 입력해 주세요.';
    return;
  }
  if (
    action === 'issue' &&
    !(await confirmDialog({
      message: `${detail.value.labelCode} 포장을 자재 출고 처리할까요?`,
      confirmLabel: '자재 출고',
    }))
  ) {
    return;
  }
  try {
    await mutation.mutateAsync({
      code: code.value,
      body: {
        action,
        location: action === 'store' ? location.value.trim() : null,
        note: note.value.trim() === '' ? null : note.value.trim(),
      },
    });
    note.value = '';
  } catch (cause) {
    actionError.value = cause instanceof ApiRequestError ? cause.message : '추적 상태를 변경하지 못했습니다.';
  }
}

const fmtDateTime = (iso: string): string => new Date(iso).toLocaleString('ko-KR', { hour12: false });
const events = computed(() => [...(detail.value?.events ?? [])].reverse());
</script>

<template>
  <div class="mx-auto flex w-full max-w-4xl flex-col gap-6">
    <PageHeader title="실물 포장 조회" description="부품 QR 추적 — 포장을 식별하고 입고·검수·보관·출고를 처리합니다.">
      <template #actions>
        <Button variant="outline" size="sm" as-child>
          <RouterLink :to="{ name: NEXT_SMARTBOM_ROUTES.logistics }">
            <ArrowLeftIcon />
            선적·배송
          </RouterLink>
        </Button>
      </template>
    </PageHeader>

    <Card v-if="query.isFetching.value" class="flex-row items-center justify-center gap-2 py-16">
      <Spinner />
      <span class="text-muted-foreground text-sm">QR 포장을 조회하는 중…</span>
    </Card>
    <Alert v-else-if="loadError !== ''" variant="destructive">
      <AlertDescription>{{ loadError }}</AlertDescription>
    </Alert>

    <template v-else-if="detail !== null">
      <SectionCard flush>
        <template #title>
          <span class="font-mono">{{ detail.labelCode }}</span>
        </template>
        <template #actions>
          <Badge :variant="bomPackageStatusBadge(detail.status).variant">{{ bomPackageStatusBadge(detail.status).label }}</Badge>
        </template>
        <div class="flex flex-col gap-1 border-b px-4 py-4">
          <p class="font-mono text-2xl font-bold">{{ detail.item.mpn }}</p>
          <p class="text-muted-foreground text-sm">{{ detail.item.manufacturerName ?? '제조사 미상' }}</p>
          <p v-if="detail.item.description !== null" class="text-muted-foreground max-w-2xl text-xs">
            {{ detail.item.description }}
          </p>
          <p v-if="detail.item.partId !== null" class="text-muted-foreground text-xs">내부 부품 ID {{ detail.item.partId }}</p>
        </div>
        <dl class="bg-border grid gap-px sm:grid-cols-2 lg:grid-cols-3">
          <div class="bg-card p-4">
            <dt class="text-muted-foreground text-xs font-medium">포장 수량</dt>
            <dd class="mt-1 text-lg font-bold tabular-nums">{{ detail.quantity.toLocaleString('ko-KR') }}</dd>
            <dd class="text-muted-foreground text-xs">발주 품목 {{ detail.item.expectedQty.toLocaleString('ko-KR') }}</dd>
          </div>
          <div class="bg-card p-4">
            <dt class="text-muted-foreground text-xs font-medium">LOT / DATE CODE</dt>
            <dd class="mt-1 font-mono text-sm font-bold">{{ detail.lotNo ?? '—' }}</dd>
            <dd class="text-muted-foreground font-mono text-xs">{{ detail.dateCode ?? '—' }}</dd>
          </div>
          <div class="bg-card p-4">
            <dt class="text-muted-foreground text-xs font-medium">보관 위치</dt>
            <dd class="mt-1 text-sm font-bold">{{ detail.storageLocation ?? '미지정' }}</dd>
          </div>
          <div class="bg-card p-4">
            <dt class="text-muted-foreground text-xs font-medium">협력사·선적</dt>
            <dd class="mt-1 text-sm font-bold">{{ detail.shipment.partnerName }}</dd>
            <dd class="text-muted-foreground text-xs">
              {{ detail.shipment.packingNo }} · {{ BOM_SHIPMENT_MODE_LABELS[detail.shipment.mode] }}
              {{ bomShipmentStatusLabel(detail.shipment.mode, detail.shipment.status) }}
            </dd>
          </div>
          <div class="bg-card p-4 sm:col-span-2">
            <dt class="text-muted-foreground text-xs font-medium">발주·Case</dt>
            <dd class="mt-1 text-sm font-bold">PO #{{ detail.po.poId }} · {{ detail.po.quoteTitle }}</dd>
            <dd class="mt-1">
              <Button variant="link" size="xs" as-child>
                <RouterLink :to="smartbomCaseTo(detail.po.quoteId, 'logistics')">
                  Case 열기
                  <ArrowRightIcon />
                </RouterLink>
              </Button>
            </dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard title="입고·검수·보관 처리">
        <p class="text-muted-foreground text-sm">
          QR은 포장을 식별합니다. 제조사 라벨·수량·LOT/DATE CODE를 실물과 대조한 뒤 처리하세요.
        </p>
        <Field>
          <FieldLabel for="bom-package-note">처리 메모</FieldLabel>
          <Textarea
            id="bom-package-note"
            v-model="note"
            rows="2"
            maxlength="2000"
            placeholder="파손·수량 편차·검수 결과 등"
          />
        </Field>
        <div class="flex flex-wrap items-center gap-2">
          <Button v-if="canReceive" :disabled="mutation.isPending.value" @click="void submit('receive')">입고 처리</Button>
          <Button v-if="canInspect" :disabled="mutation.isPending.value" @click="void submit('inspect')">검수 완료</Button>
          <div v-if="canStore" class="flex min-w-72 flex-1 gap-2">
            <Input
              v-model="location"
              type="text"
              maxlength="191"
              class="min-w-0 flex-1"
              aria-label="보관 위치"
              placeholder="보관 위치 예: A-03-02"
            />
            <Button variant="outline" :disabled="mutation.isPending.value" @click="void submit('store')">위치 저장</Button>
          </div>
          <Button v-if="canIssue" variant="secondary" :disabled="mutation.isPending.value" @click="void submit('issue')">
            자재 출고
          </Button>
        </div>
        <Alert v-if="actionError !== ''" variant="destructive" size="sm">
          <AlertDescription>{{ actionError }}</AlertDescription>
        </Alert>
        <Alert v-if="!canReceive && !canInspect && !canStore && !canIssue" variant="muted" size="sm">
          <AlertDescription>현재 상태에서는 추가 처리할 작업이 없습니다.</AlertDescription>
        </Alert>
      </SectionCard>

      <SectionCard title="추적 이력">
        <ol class="flex flex-col gap-3 border-l-2 pl-4">
          <li v-for="event in events" :key="event.eventId" class="relative">
            <span class="bg-primary ring-background absolute top-1.5 -left-5.5 size-2.5 rounded-full ring-4" />
            <div class="flex flex-wrap items-baseline gap-2">
              <p class="text-sm font-semibold">{{ BOM_PART_EVENT_LABELS[event.eventType] }}</p>
              <p class="text-muted-foreground text-xs tabular-nums">{{ fmtDateTime(event.occurredAt) }}</p>
            </div>
            <p class="text-muted-foreground text-xs">
              {{ event.actorType }}<template v-if="event.actorMbId !== null"> · {{ event.actorMbId }}</template>
              <template v-if="event.location !== null"> · 위치 {{ event.location }}</template>
              <template v-if="event.quantity !== null"> · 수량 {{ event.quantity.toLocaleString('ko-KR') }}</template>
            </p>
            <p v-if="event.note !== null && event.note !== ''" class="mt-0.5 text-xs">{{ event.note }}</p>
          </li>
        </ol>
      </SectionCard>
    </template>
  </div>
</template>
