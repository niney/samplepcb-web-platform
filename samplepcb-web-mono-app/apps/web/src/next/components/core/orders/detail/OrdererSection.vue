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

// 주문자(표시 ↔ 편집) — 옛 서랍의 주문자 섹션. 저장은 바뀐 칸만 PATCH /info, 주소 형식 플래그는
// 검색을 적용했을 때 항상 보낸다(미제공 시 서버가 addr1 수동 변경만 '' 로 초기화). 바뀐 게 없으면 폼만 닫는다.
const props = defineProps<{ order: AdminOrderDetailOrderType; memberOrderCount: number }>();
const { t } = useI18n();
const errorText = useOrderErrorText();

interface OrdererForm {
  odName: string;
  odEmail: string;
  odTel: string;
  odHp: string;
  zip1: string;
  zip2: string;
  addr1: string;
  addr2: string;
  addr3: string;
  depositName: string;
  hopeDate: string;
}
const fromOrder = (o: AdminOrderDetailOrderType): OrdererForm => ({
  odName: o.odName,
  odEmail: o.email,
  odTel: o.odTel,
  odHp: o.odHp,
  zip1: o.addr.zip1,
  zip2: o.addr.zip2,
  addr1: o.addr.addr1,
  addr2: o.addr.addr2,
  addr3: o.addr.addr3,
  depositName: o.depositName,
  hopeDate: o.hopeDate ?? '',
});

const editing = ref(false);
const form = ref<OrdererForm>(fromOrder(props.order));
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
  if (f.odName !== orig.odName) patch.odName = f.odName;
  if (f.odEmail !== orig.odEmail) patch.odEmail = f.odEmail;
  if (f.odTel !== orig.odTel) patch.odTel = f.odTel;
  if (f.odHp !== orig.odHp) patch.odHp = f.odHp;
  if (f.zip1 !== orig.zip1) patch.zip1 = f.zip1;
  if (f.zip2 !== orig.zip2) patch.zip2 = f.zip2;
  if (f.addr1 !== orig.addr1) patch.addr1 = f.addr1;
  if (f.addr2 !== orig.addr2) patch.addr2 = f.addr2;
  if (f.addr3 !== orig.addr3) patch.addr3 = f.addr3;
  if (addrType.value !== '') patch.addrJibeon = addrType.value;
  if (f.depositName !== orig.depositName) patch.depositName = f.depositName;
  if (f.hopeDate !== orig.hopeDate) patch.hopeDate = f.hopeDate;
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

const address = computed(() => formatAddr(props.order.addr));
const phone = computed(() =>
  props.order.odHp !== '' ? props.order.odHp : props.order.odTel !== '' ? props.order.odTel : '-',
);
</script>

<template>
  <SectionCard :title="t('admin.orders.drawer.orderer')">
    <template v-if="!editing" #actions>
      <Button variant="outline" size="sm" @click="startEdit">
        <PencilIcon />
        {{ t('admin.orders.drawer.edit.button') }}
      </Button>
    </template>

    <dl v-if="!editing" class="space-y-1.5 text-sm">
      <div class="flex gap-2">
        <dt class="text-muted-foreground w-16 shrink-0">{{ t('admin.orders.drawer.name') }}</dt>
        <dd class="min-w-0">
          <span class="font-medium">{{ order.odName !== '' ? order.odName : '-' }}</span>
          <span class="text-muted-foreground ml-1 text-xs">
            {{ order.mbId !== '' ? order.mbId : t('admin.orders.table.guest') }}
            <span v-if="memberOrderCount > 0" class="tabular-nums">({{ memberOrderCount }})</span>
          </span>
        </dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-muted-foreground w-16 shrink-0">{{ t('admin.orders.drawer.email') }}</dt>
        <dd class="min-w-0 break-all">{{ order.email !== '' ? order.email : '-' }}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-muted-foreground w-16 shrink-0">{{ t('admin.orders.drawer.tel') }}</dt>
        <dd class="tabular-nums">{{ phone }}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-muted-foreground w-16 shrink-0">{{ t('admin.orders.drawer.address') }}</dt>
        <dd class="min-w-0">{{ address !== '' ? address : '-' }}</dd>
      </div>
      <div v-if="order.depositName !== ''" class="flex gap-2">
        <dt class="text-muted-foreground w-16 shrink-0">{{ t('admin.orders.drawer.depositName') }}</dt>
        <dd>{{ order.depositName }}</dd>
      </div>
      <div v-if="order.hopeDate !== null" class="flex gap-2">
        <dt class="text-muted-foreground w-16 shrink-0">{{ t('admin.orders.drawer.hopeDate') }}</dt>
        <dd class="tabular-nums">{{ order.hopeDate }}</dd>
      </div>
    </dl>

    <!-- 주문자 편집 폼 -->
    <div v-else class="flex flex-col gap-3">
      <div class="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel for="od-orderer-name">{{ t('admin.orders.drawer.edit.name') }}</FieldLabel>
          <Input id="od-orderer-name" v-model="form.odName" type="text" />
        </Field>
        <Field>
          <FieldLabel for="od-orderer-email">{{ t('admin.orders.drawer.edit.email') }}</FieldLabel>
          <Input id="od-orderer-email" v-model="form.odEmail" type="email" />
        </Field>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel for="od-orderer-tel">{{ t('admin.orders.drawer.edit.tel') }}</FieldLabel>
          <Input id="od-orderer-tel" v-model="form.odTel" type="text" />
        </Field>
        <Field>
          <FieldLabel for="od-orderer-hp">{{ t('admin.orders.drawer.edit.hp') }}</FieldLabel>
          <Input id="od-orderer-hp" v-model="form.odHp" type="text" />
        </Field>
      </div>
      <AddressFields
        v-model:zip1="form.zip1"
        v-model:zip2="form.zip2"
        v-model:addr1="form.addr1"
        v-model:addr2="form.addr2"
        v-model:addr3="form.addr3"
        v-model:addr-type="addrType"
        id-prefix="od-orderer"
      />
      <div class="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel for="od-orderer-deposit">{{ t('admin.orders.drawer.edit.depositName') }}</FieldLabel>
          <Input id="od-orderer-deposit" v-model="form.depositName" type="text" />
        </Field>
        <Field>
          <FieldLabel for="od-orderer-hope">{{ t('admin.orders.drawer.edit.hopeDate') }}</FieldLabel>
          <Input id="od-orderer-hope" v-model="form.hopeDate" type="date" />
        </Field>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button :disabled="isPending" @click="submit">{{ t('admin.orders.drawer.edit.save') }}</Button>
        <Button variant="ghost" @click="cancelEdit">{{ t('admin.orders.drawer.edit.cancel') }}</Button>
        <span v-if="saveError !== null" class="text-destructive text-xs">{{ saveError }}</span>
      </div>
    </div>
  </SectionCard>
</template>
