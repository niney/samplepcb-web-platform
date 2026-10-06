<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminOrderDetailOrderType } from '@sp/api-contract';
import { useOrderMemoMutation } from '@/admin/useAdminOrders';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Button } from '@/next/components/ui/button';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Textarea } from '@/next/components/ui/textarea';

// 메모 — 고객 요청(od_memo, 읽기 전용) + 관리자 메모(od_shop_memo, PATCH /memo · ''=비움).
// 입력값은 주문을 열 때 한 번 채운다(같은 주문 다시 불러오기에 편집 중 글이 덮이지 않게 — 옛 서랍과 같음).
const props = defineProps<{ order: AdminOrderDetailOrderType }>();
const { t } = useI18n();

const memoInput = ref(props.order.shopMemo);
const memoChanged = computed(() => memoInput.value !== props.order.shopMemo);

const { mutate: saveMemo, isPending, isSuccess, isError, reset } = useOrderMemoMutation();
const submit = (): void => {
  if (!memoChanged.value) return;
  reset();
  saveMemo({ odId: props.order.odId, shopMemo: memoInput.value });
};
</script>

<template>
  <SectionCard :title="t('admin.orders.drawer.memo')">
    <div class="flex flex-col gap-3">
      <!-- 고객 요청(od_memo) 읽기 전용 -->
      <div v-if="order.memo !== ''" class="space-y-1">
        <p class="text-muted-foreground text-xs">{{ t('admin.orders.drawer.customerMemo') }}</p>
        <Panel tone="muted" class="text-sm whitespace-pre-wrap">{{ order.memo }}</Panel>
      </div>
      <!-- 관리자 메모(od_shop_memo) 편집 -->
      <Field>
        <FieldLabel for="od-shop-memo">{{ t('admin.orders.drawer.shopMemo') }}</FieldLabel>
        <Textarea
          id="od-shop-memo"
          v-model="memoInput"
          rows="3"
          :placeholder="t('admin.orders.drawer.memoEdit.placeholder')"
        />
      </Field>
      <div class="flex flex-wrap items-center gap-2">
        <Button :disabled="!memoChanged || isPending" @click="submit">{{ t('admin.orders.drawer.memoEdit.save') }}</Button>
        <span v-if="isError" class="text-destructive text-xs">{{ t('admin.orders.drawer.memoEdit.failed') }}</span>
        <span v-else-if="isSuccess" class="text-success text-xs">{{ t('admin.orders.drawer.memoEdit.success') }}</span>
      </div>
    </div>
  </SectionCard>
</template>
