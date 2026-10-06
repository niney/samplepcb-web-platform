<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { CheckIcon } from '@lucide/vue';
import { ORDER_PIPELINE } from '@/admin/useAdminOrders';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { useOrderStatusLabel } from './order-detail';

// 주문 상태 스텝퍼 — 선형 파이프라인(주문→…→완료) 위의 현재 위치(옛 components/admin/OrderStatusStepper.vue).
// 12단계라 여러 줄로 감싼다. 지난 단계는 채운 원+체크, 현재는 테두리 원, 남은 단계는 옅은 원.
// 파이프라인 밖 상태(취소·반품·품절·A/S 등)는 진행바 대신 주의 알림 한 줄.
const props = defineProps<{ status: string }>();
const { t } = useI18n();
const label = useOrderStatusLabel();

const steps = ORDER_PIPELINE as readonly string[];
const currentIndex = computed(() => steps.indexOf(props.status));
const offPipeline = computed(() => currentIndex.value === -1);
</script>

<template>
  <Alert v-if="offPipeline" variant="warning" size="sm">
    <AlertDescription>
      {{
        props.status === 'A/S'
          ? t('admin.orders.stepper.afterService')
          : t('admin.orders.stepper.offPipeline', { status: label(props.status) })
      }}
    </AlertDescription>
  </Alert>
  <ol v-else class="flex flex-wrap gap-y-2" :aria-label="`주문 진행 — 현재 ${label(props.status)}`">
    <li v-for="(s, i) in steps" :key="s" class="flex items-start" :aria-current="i === currentIndex ? 'step' : undefined">
      <div class="flex w-14 flex-col items-center gap-1">
        <span
          class="flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums"
          :class="
            i < currentIndex
              ? 'bg-primary text-primary-foreground'
              : i === currentIndex
                ? 'border-primary bg-primary/10 text-primary border-2'
                : 'bg-background text-muted-foreground border'
          "
        >
          <CheckIcon v-if="i < currentIndex" class="size-3.5" aria-hidden="true" />
          <template v-else>{{ i + 1 }}</template>
        </span>
        <span
          class="text-center text-xs leading-tight"
          :class="
            i === currentIndex
              ? 'text-primary font-semibold'
              : i < currentIndex
                ? 'text-foreground'
                : 'text-muted-foreground'
          "
        >
          {{ label(s) }}
        </span>
      </div>
      <div
        v-if="i < steps.length - 1"
        class="mt-3 h-0.5 w-2 shrink-0 rounded-full"
        :class="i < currentIndex ? 'bg-primary' : 'bg-border'"
      />
    </li>
  </ol>
</template>
