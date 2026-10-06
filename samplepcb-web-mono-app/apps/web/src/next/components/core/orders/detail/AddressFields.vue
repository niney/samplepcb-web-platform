<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { SearchIcon, XIcon } from '@lucide/vue';
import { useDaumPostcode, type DaumPostcodeData } from '@/lib/useDaumPostcode';
import { Button } from '@/next/components/ui/button';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { addressFromPostcode, type AddrJibeon } from './order-detail';

// 주소 칸 다섯 개(우편번호 앞·뒤, 기본·상세·참고) + 다음(카카오) 주소 검색 — 주문자·받는분 편집이 같이 쓴다.
// 검색을 고르면 다섯 칸을 채우고 주소 형식 플래그(R 도로명·J 지번)를 남긴다(저장 때 함께 보낸다 — 옛 서랍과 같음).
const props = defineProps<{ idPrefix: string }>();
const zip1 = defineModel<string>('zip1', { required: true });
const zip2 = defineModel<string>('zip2', { required: true });
const addr1 = defineModel<string>('addr1', { required: true });
const addr2 = defineModel<string>('addr2', { required: true });
const addr3 = defineModel<string>('addr3', { required: true });
const addrType = defineModel<AddrJibeon>('addrType', { required: true });
const { t } = useI18n();

const { embed } = useDaumPostcode();
const postcodeOpen = ref(false);
const postcodeFailed = ref(false);
const panel = ref<HTMLElement | null>(null);

const applyPostcode = (d: DaumPostcodeData): void => {
  const a = addressFromPostcode(d);
  zip1.value = a.zip1;
  zip2.value = a.zip2;
  addr1.value = a.addr1;
  addr3.value = a.addr3;
  addr2.value = a.addr2;
  addrType.value = d.userSelectedType;
  postcodeOpen.value = false;
};

const openPostcode = (): void => {
  postcodeFailed.value = false;
  postcodeOpen.value = true;
  void nextTick(() => {
    const el = panel.value;
    if (el === null) return;
    embed(el, applyPostcode).catch(() => {
      postcodeFailed.value = true;
      postcodeOpen.value = false;
    });
  });
};
// 편집을 접으면 이 칸들이 통째로 내려가 열려 있던 검색 창도 함께 닫힌다(다시 열면 닫힌 채로 시작).
</script>

<template>
  <Field>
    <FieldLabel :for="`${props.idPrefix}-zip1`">{{ t('admin.orders.drawer.edit.zip') }}</FieldLabel>
    <div class="flex items-center gap-1.5">
      <Input :id="`${props.idPrefix}-zip1`" v-model="zip1" type="text" inputmode="numeric" maxlength="3" class="w-16" />
      <span class="text-muted-foreground">-</span>
      <Input v-model="zip2" type="text" inputmode="numeric" maxlength="3" class="w-16" aria-label="우편번호 뒷자리" />
      <Button variant="outline" size="sm" @click="openPostcode">
        <SearchIcon />
        {{ t('admin.orders.drawer.edit.addrSearch') }}
      </Button>
    </div>
    <p v-if="postcodeFailed" class="text-destructive text-xs">{{ t('admin.orders.drawer.edit.addrSearchFailed') }}</p>
  </Field>
  <div v-if="postcodeOpen" class="overflow-hidden rounded-md border">
    <div class="bg-muted/40 flex items-center justify-between border-b px-2 py-1">
      <span class="text-muted-foreground text-xs">{{ t('admin.orders.drawer.edit.addrSearch') }}</span>
      <Button variant="ghost" size="xs" @click="postcodeOpen = false">
        <XIcon />
        {{ t('admin.orders.drawer.edit.addrSearchClose') }}
      </Button>
    </div>
    <div ref="panel" class="h-80 w-full" />
  </div>
  <Field>
    <FieldLabel :for="`${props.idPrefix}-addr1`">{{ t('admin.orders.drawer.edit.addr1') }}</FieldLabel>
    <Input :id="`${props.idPrefix}-addr1`" v-model="addr1" type="text" />
  </Field>
  <Field>
    <FieldLabel :for="`${props.idPrefix}-addr2`">{{ t('admin.orders.drawer.edit.addr2') }}</FieldLabel>
    <Input :id="`${props.idPrefix}-addr2`" v-model="addr2" type="text" />
  </Field>
  <Field>
    <FieldLabel :for="`${props.idPrefix}-addr3`">{{ t('admin.orders.drawer.edit.addr3') }}</FieldLabel>
    <Input :id="`${props.idPrefix}-addr3`" v-model="addr3" type="text" />
  </Field>
</template>
