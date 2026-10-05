<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeftIcon, ArrowRightIcon, CircleAlertIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import { BOM_SHIPMENT_MODE_LABELS, PCB_PACKAGE_EVENT_LABELS, bomShipmentStatusLabel } from '@sp/api-contract';
import { useAdminPcbPackage } from '@/admin/useAdminPcbPos';
import { NEXT_PCB_ROUTES } from '@/next/pcb-navigation';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Card } from '@/next/components/ui/card';
import { Spinner } from '@/next/components/ui/spinner';
import PageHeader from '@/next/components/common/PageHeader.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import CustomerCell from '@/next/components/common/CustomerCell.vue';
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
    <!-- 화면의 주제(프로젝트명)를 화면 제목으로 — 조회 전·실패 시에는 화면 이름을 보인다. -->
    <PageHeader :title="detail?.projectName ?? 'PCB 주문/견적 건 조회'">
      <template #description>
        PCB QR 추적
        <span v-if="detail !== null" class="font-mono text-xs">
          · {{ detail.labelCode }} · PO-{{ detail.poId }} · Q{{ detail.specId
          }}<template v-if="detail.reorderRound > 0"> · A/S {{ detail.reorderRound }}차</template>
        </span>
      </template>
      <template #actions>
        <Button variant="outline" as-child>
          <RouterLink :to="{ name: NEXT_PCB_ROUTES.shipments }">
            <ArrowLeftIcon />
            PCB 선적·배송
          </RouterLink>
        </Button>
      </template>
    </PageHeader>

    <Card v-if="query.isFetching.value" class="flex-row items-center justify-center gap-2 py-16">
      <Spinner />
      <span class="text-muted-foreground text-sm">PCB QR을 조회하는 중…</span>
    </Card>
    <Alert v-else-if="loadError !== ''" variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>{{ loadError }}</AlertTitle>
    </Alert>

    <template v-else-if="detail !== null">
      <SectionCard :title="`QR 라벨 ${detail.labelCode}`" flush>
        <template #actions>
          <Badge v-if="statusBadge !== null" :variant="statusBadge.variant">{{ statusBadge.label }}</Badge>
        </template>

        <div v-if="detail.status === 'voided'" class="border-b px-4 py-3">
          <Alert variant="destructive" size="sm">
            <AlertDescription>
              이 라벨은 박스 구성에서 제외되어 무효입니다. 실물에 붙어 있다면 사용하지 마세요.
            </AlertDescription>
          </Alert>
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

        <div class="flex flex-wrap gap-2 border-t px-4 py-3">
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
      </SectionCard>

      <SectionCard title="QR 추적 이력">
        <p class="text-muted-foreground text-xs">입고는 개별 QR이 아니라 선적 박스 입고 확인과 함께 처리됩니다.</p>
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
      </SectionCard>
    </template>
  </div>
</template>
