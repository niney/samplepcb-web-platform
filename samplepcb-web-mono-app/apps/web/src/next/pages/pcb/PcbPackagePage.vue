<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeftIcon, ArrowRightIcon, CircleAlertIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import { BOM_SHIPMENT_MODE_LABELS, PCB_PACKAGE_EVENT_LABELS, bomShipmentStatusLabel } from '@sp/api-contract';
import { useAdminPcbPackage } from '@/admin/useAdminPcbPos';
import { NEXT_PCB_ROUTES } from '@/next/pcb-navigation';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Spinner } from '@/next/components/ui/spinner';
import PageHeader from '@/next/components/common/PageHeader.vue';
import CustomerCell from '@/next/components/pcb/CustomerCell.vue';
import { pcbPackageStatusBadge } from '@/next/components/pcb/pos/pos-badges';

// PCB QR 스캔 도착점. token 은 식별자일 뿐이며 라우트와 API 모두 관리자 인증 뒤에 있다.
// 개별 QR 에서 입고 상태를 따로 바꾸지 않는다 — PCB 는 박스 선적 입고가 정본이고 서버가
// 그 사건을 현재 구성원 QR 전체에 동기화한다.

const route = useRoute();
const code = computed(() => {
  const raw = route.params.code;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
});
const query = useAdminPcbPackage(code);
const detail = computed(() => query.data.value?.data ?? null);
const statusBadge = computed(() => (detail.value === null ? null : pcbPackageStatusBadge(detail.value.status)));
// 최근 사건이 위로 — 스캔한 사람이 가장 먼저 알고 싶은 것은 지금 상태다.
const events = computed(() => (detail.value === null ? [] : [...detail.value.events].reverse()));

const loadError = computed(() => {
  const cause = query.error.value;
  if (cause === null) return '';
  return cause instanceof ApiRequestError ? cause.message : 'PCB QR을 조회하지 못했습니다.';
});

const fmtDateTime = (iso: string): string => new Date(iso).toLocaleString('ko-KR', { hour12: false });
</script>

<template>
  <div class="mx-auto flex max-w-4xl flex-col gap-6">
    <PageHeader title="PCB 주문/견적 건 조회" description="PCB QR 추적">
      <template #actions>
        <Button variant="outline" as-child>
          <RouterLink :to="{ name: NEXT_PCB_ROUTES.shipments }">
            <ArrowLeftIcon />
            PCB 선적·배송
          </RouterLink>
        </Button>
      </template>
    </PageHeader>

    <div
      v-if="query.isFetching.value"
      class="bg-card text-muted-foreground flex items-center justify-center gap-2 rounded-xl border px-5 py-16 text-sm"
    >
      <Spinner />
      PCB QR을 조회하는 중…
    </div>
    <div
      v-else-if="loadError !== ''"
      role="alert"
      class="border-destructive bg-destructive-soft text-destructive flex items-center justify-center gap-2 rounded-xl border px-5 py-8 text-sm font-medium"
    >
      <CircleAlertIcon class="size-4" />
      {{ loadError }}
    </div>

    <template v-else-if="detail !== null">
      <section class="bg-card text-card-foreground overflow-hidden rounded-xl border shadow-xs">
        <div class="bg-muted flex flex-wrap items-start gap-3 border-b px-5 py-4">
          <div class="min-w-0 space-y-1">
            <p class="text-muted-foreground font-mono text-xs font-semibold">{{ detail.labelCode }}</p>
            <h2 class="text-xl font-semibold tracking-tight">{{ detail.projectName }}</h2>
            <p class="text-muted-foreground font-mono text-xs">
              PO-{{ detail.poId }} · Q{{ detail.specId }}
              <template v-if="detail.reorderRound > 0"> · A/S {{ detail.reorderRound }}차</template>
            </p>
          </div>
          <Badge v-if="statusBadge !== null" :variant="statusBadge.variant" class="ml-auto">{{ statusBadge.label }}</Badge>
        </div>

        <div
          v-if="detail.status === 'voided'"
          role="alert"
          class="bg-destructive-soft text-destructive border-b px-5 py-3 text-sm font-medium"
        >
          이 라벨은 박스 구성에서 제외되어 무효입니다. 실물에 붙어 있다면 사용하지 마세요.
        </div>

        <dl class="bg-border grid gap-px sm:grid-cols-2 lg:grid-cols-3">
          <div class="bg-card space-y-1 p-4">
            <dt class="text-muted-foreground text-xs font-medium">PCB 수량</dt>
            <dd class="text-lg font-semibold tabular-nums">{{ detail.qty.toLocaleString('ko-KR') }} PCS</dd>
          </div>
          <div class="bg-card space-y-1 p-4">
            <dt class="text-muted-foreground text-xs font-medium">고객</dt>
            <dd><CustomerCell :name="detail.customerName" :mb-id="detail.mbId" /></dd>
          </div>
          <div class="bg-card space-y-1 p-4">
            <dt class="text-muted-foreground text-xs font-medium">제작 협력사</dt>
            <dd class="text-sm font-medium">{{ detail.partnerName }}</dd>
          </div>
          <div class="bg-card space-y-1 p-4 sm:col-span-2">
            <dt class="text-muted-foreground text-xs font-medium">선적</dt>
            <dd class="space-y-0.5">
              <p class="text-sm font-medium">SH-{{ detail.shipment.shipmentId }} · {{ detail.shipment.receiverName }} 수신</p>
              <p class="text-muted-foreground text-xs">
                {{ BOM_SHIPMENT_MODE_LABELS[detail.shipment.mode] }} ·
                {{ bomShipmentStatusLabel(detail.shipment.mode, detail.shipment.status) }}
              </p>
              <p v-if="detail.shipment.trackingNumber !== null" class="text-muted-foreground text-xs">
                {{ detail.shipment.carrier ?? '' }} {{ detail.shipment.trackingNumber }}
              </p>
            </dd>
          </div>
          <div class="bg-card space-y-1 p-4">
            <dt class="text-muted-foreground text-xs font-medium">라벨 인쇄</dt>
            <dd class="text-sm font-medium">{{ detail.printedAt === null ? '미인쇄' : fmtDateTime(detail.printedAt) }}</dd>
          </div>
        </dl>

        <div class="flex flex-wrap gap-2 border-t px-5 py-4">
          <Button as-child>
            <RouterLink :to="{ name: NEXT_PCB_ROUTES.case, params: { id: detail.specId }, query: { from: 'qr' } }">
              Case 상세 열기
              <ArrowRightIcon />
            </RouterLink>
          </Button>
          <Button variant="outline" as-child>
            <RouterLink :to="{ name: NEXT_PCB_ROUTES.shipments }">선적 큐 열기</RouterLink>
          </Button>
        </div>
      </section>

      <section class="bg-card text-card-foreground space-y-4 rounded-xl border p-5 shadow-xs">
        <div class="space-y-1">
          <h2 class="text-sm font-semibold">QR 추적 이력</h2>
          <p class="text-muted-foreground text-xs">입고는 개별 QR이 아니라 선적 박스 입고 확인과 함께 처리됩니다.</p>
        </div>
        <ol v-if="events.length > 0" class="space-y-0">
          <li v-for="(event, index) in events" :key="event.eventId" class="flex gap-3">
            <div class="flex flex-col items-center">
              <span class="bg-success ring-success-soft mt-1.5 size-2.5 shrink-0 rounded-full ring-4" />
              <span v-if="index < events.length - 1" class="bg-border mt-1 w-px flex-1" />
            </div>
            <div class="min-w-0 pb-4">
              <p class="flex flex-wrap items-baseline gap-2">
                <span class="text-sm font-semibold">{{ PCB_PACKAGE_EVENT_LABELS[event.eventType] }}</span>
                <span class="text-muted-foreground text-xs tabular-nums">{{ fmtDateTime(event.occurredAt) }}</span>
              </p>
              <p class="text-muted-foreground mt-0.5 text-xs">
                {{ event.actorType }}<template v-if="event.actorMbId !== null"> · {{ event.actorMbId }}</template>
                <template v-if="event.note !== null && event.note !== ''"> · {{ event.note }}</template>
              </p>
            </div>
          </li>
        </ol>
        <p v-else class="text-muted-foreground text-xs">이력이 없습니다.</p>
      </section>
    </template>
  </div>
</template>
