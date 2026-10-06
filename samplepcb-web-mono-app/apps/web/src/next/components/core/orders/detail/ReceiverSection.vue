<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { PencilIcon } from '@lucide/vue';
import type { AdminOrderDetailOrderType, AdminOrderInfoBodyType } from '@sp/api-contract';
import { useOrderInfoMutation } from '@/admin/useAdminOrders';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Button } from '@/next/components/ui/button';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import AddressFields from './AddressFields.vue';
import { formatAddr, useOrderErrorText, type AddrJibeon } from './order-detail';

// 받는분(표시 ↔ 편집) — 옛 서랍의 받는분 섹션. 저장 규칙은 주문자와 같다(바뀐 칸만 PATCH /info,
// 검색 적용 시 bAddrJibeon 동봉, 바뀐 게 없으면 폼만 닫음).
const props = defineProps<{ order: AdminOrderDetailOrderType }>();
const { t } = useI18n();
const errorText = useOrderErrorText();

interface ReceiverForm {
  bName: string;
  bTel: string;
  bHp: string;
  bZip1: string;
  bZip2: string;
  bAddr1: string;
  bAddr2: string;
  bAddr3: string;
}
const fromOrder = (o: AdminOrderDetailOrderType): ReceiverForm => ({
  bName: o.receiver.name,
  bTel: o.receiver.tel,
  bHp: o.receiver.hp,
  bZip1: o.receiver.zip1,
  bZip2: o.receiver.zip2,
  bAddr1: o.receiver.addr1,
  bAddr2: o.receiver.addr2,
  bAddr3: o.receiver.addr3,
});

const editing = ref(false);
const form = ref<ReceiverForm>(fromOrder(props.order));
const addrType = ref<AddrJibeon>('');

const { mutate: saveInfo, isPending, error, reset } = useOrderInfoMutation();
const saveError = computed(() => errorText(error.value));

const startEdit = (): void => {
  form.value = fromOrder(props.order);
  addrType.value = '';
  reset();
  editing.value = true;
};
const cancelEdit = (): void => {
  editing.value = false;
};

const submit = (): void => {
  const o = props.order;
  const orig = fromOrder(o);
  const f = form.value;
  const patch: AdminOrderInfoBodyType = {};
  if (f.bName !== orig.bName) patch.bName = f.bName;
  if (f.bTel !== orig.bTel) patch.bTel = f.bTel;
  if (f.bHp !== orig.bHp) patch.bHp = f.bHp;
  if (f.bZip1 !== orig.bZip1) patch.bZip1 = f.bZip1;
  if (f.bZip2 !== orig.bZip2) patch.bZip2 = f.bZip2;
  if (f.bAddr1 !== orig.bAddr1) patch.bAddr1 = f.bAddr1;
  if (f.bAddr2 !== orig.bAddr2) patch.bAddr2 = f.bAddr2;
  if (f.bAddr3 !== orig.bAddr3) patch.bAddr3 = f.bAddr3;
  if (addrType.value !== '') patch.bAddrJibeon = addrType.value;
  if (Object.keys(patch).length === 0) {
    cancelEdit();
    return;
  }
  reset();
  saveInfo(
    { odId: o.odId, ...patch },
    {
      onSuccess: () => {
        editing.value = false;
      },
    },
  );
};

const address = computed(() => formatAddr(props.order.receiver));
const phone = computed(() => {
  const r = props.order.receiver;
  return r.hp !== '' ? r.hp : r.tel !== '' ? r.tel : '-';
});
</script>

<template>
  <SectionCard :title="t('admin.orders.drawer.receiver')">
    <template v-if="!editing" #actions>
      <Button variant="outline" size="sm" @click="startEdit">
        <PencilIcon />
        {{ t('admin.orders.drawer.edit.button') }}
      </Button>
    </template>

    <dl v-if="!editing" class="space-y-1.5 text-sm">
      <div class="flex gap-2">
        <dt class="text-muted-foreground w-16 shrink-0">{{ t('admin.orders.drawer.name') }}</dt>
        <dd class="font-medium">{{ order.receiver.name !== '' ? order.receiver.name : '-' }}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-muted-foreground w-16 shrink-0">{{ t('admin.orders.drawer.tel') }}</dt>
        <dd class="tabular-nums">{{ phone }}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-muted-foreground w-16 shrink-0">{{ t('admin.orders.drawer.address') }}</dt>
        <dd class="min-w-0">{{ address !== '' ? address : '-' }}</dd>
      </div>
    </dl>

    <!-- 받는분 편집 폼 -->
    <div v-else class="flex flex-col gap-3">
      <Field>
        <FieldLabel for="od-receiver-name">{{ t('admin.orders.drawer.edit.name') }}</FieldLabel>
        <Input id="od-receiver-name" v-model="form.bName" type="text" />
      </Field>
      <div class="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel for="od-receiver-tel">{{ t('admin.orders.drawer.edit.tel') }}</FieldLabel>
          <Input id="od-receiver-tel" v-model="form.bTel" type="text" />
        </Field>
        <Field>
          <FieldLabel for="od-receiver-hp">{{ t('admin.orders.drawer.edit.hp') }}</FieldLabel>
          <Input id="od-receiver-hp" v-model="form.bHp" type="text" />
        </Field>
      </div>
      <AddressFields
        v-model:zip1="form.bZip1"
        v-model:zip2="form.bZip2"
        v-model:addr1="form.bAddr1"
        v-model:addr2="form.bAddr2"
        v-model:addr3="form.bAddr3"
        v-model:addr-type="addrType"
        id-prefix="od-receiver"
      />
      <div class="flex flex-wrap items-center gap-2">
        <Button :disabled="isPending" @click="submit">{{ t('admin.orders.drawer.edit.save') }}</Button>
        <Button variant="ghost" @click="cancelEdit">{{ t('admin.orders.drawer.edit.cancel') }}</Button>
        <span v-if="saveError !== null" class="text-destructive text-xs">{{ saveError }}</span>
      </div>
    </div>
  </SectionCard>
</template>
