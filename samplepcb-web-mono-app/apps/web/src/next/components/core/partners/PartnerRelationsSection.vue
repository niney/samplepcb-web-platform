<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { UnlinkIcon } from '@lucide/vue';
import {
  PARTNER_STATUS_LABELS,
  PCB_CURRENCIES,
  type AdminPartnerDetailType,
  type PcbCurrencyType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  useAddPartnerRelation,
  useAdminPartnerRelations,
  useRemovePartnerRelation,
  useUpdatePartnerRelationCurrency,
} from '@/admin/useAdminPartners';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Item } from '@/next/components/ui/item';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Spinner } from '@/next/components/ui/spinner';

// 마스터딜러(MD) 소속 — sp_partner_relation. 사람 협력사(type partner)에서만 그린다(호출부가 v-if).
// 링크 통화는 배정 시점에 견적행으로 박제되므로 변경은 이후 배정부터 적용된다. 해제는 진행 중 문서
// 0건일 때만(서버 가드 — 화면도 진행 건이 있으면 버튼을 막는다). 다른 MD 의 하위면 하위를 둘 수 없다(2단 제한).
const props = defineProps<{ detail: AdminPartnerDetailType }>();

const partnerId = computed<number | null>(() => (props.detail.type === 'partner' ? props.detail.partnerId : null));
const relationsQ = useAdminPartnerRelations(partnerId);
const relations = computed(() => relationsQ.data.value?.data);
const relationError = ref('');
const relationChildId = ref<number | null>(null);
const relationCurrency = ref<PcbCurrencyType>('USD');
// 강제 전환 — 진행 중인 직속 발주가 있으면 첫 하위 연결(마스터딜러 전환)이 막힌다. 발주가 끊이지 않는
// 협력사는 그 가드에 영영 걸리므로, 관리자는 사유를 남기고 넘을 수 있다(진행 건은 직접 제작 그대로).
const forceReason = ref('');
const conversionBlock = computed(() => relations.value?.conversionBlock ?? null);
const addRelationMut = useAddPartnerRelation();
const relationCurrencyMut = useUpdatePartnerRelationCurrency();
const removeRelationMut = useRemovePartnerRelation();

// 상세가 다시 오면 입력·오류를 비운다(옛 화면 상세 watch 와 같은 동작).
watch(
  () => props.detail,
  () => {
    relationError.value = '';
    relationChildId.value = null;
    relationCurrency.value = 'USD';
    forceReason.value = '';
  },
);

async function addRelation(): Promise<void> {
  relationError.value = '';
  if (relationChildId.value === null) {
    relationError.value = '연결할 하위 협력사를 선택해 주세요.';
    return;
  }
  const force = conversionBlock.value !== null;
  if (force && forceReason.value.trim() === '') {
    relationError.value = '강제 전환 사유를 입력해 주세요.';
    return;
  }
  try {
    await addRelationMut.mutateAsync({
      partnerId: props.detail.partnerId,
      body: {
        childPartnerId: relationChildId.value,
        settlementCurrency: relationCurrency.value,
        force,
        ...(force ? { forceReason: forceReason.value.trim() } : {}),
      },
    });
    relationChildId.value = null;
    forceReason.value = '';
  } catch (e) {
    relationError.value = e instanceof ApiRequestError ? e.message : '연결에 실패했습니다.';
  }
}

async function changeLinkCurrency(parentId: number, childId: number, ev: Event): Promise<void> {
  relationError.value = '';
  const value = (ev.target as HTMLSelectElement).value as PcbCurrencyType;
  try {
    await relationCurrencyMut.mutateAsync({ partnerId: parentId, childId, body: { settlementCurrency: value } });
  } catch (e) {
    relationError.value = e instanceof ApiRequestError ? e.message : '통화 변경에 실패했습니다.';
  }
}

async function removeLink(parentId: number, childId: number): Promise<void> {
  relationError.value = '';
  try {
    await removeRelationMut.mutateAsync({ partnerId: parentId, childId });
  } catch (e) {
    relationError.value = e instanceof ApiRequestError ? e.message : '해제에 실패했습니다.';
  }
}

const onChildSelect = (event: Event): void => {
  const raw = (event.target as HTMLSelectElement).value;
  relationChildId.value = raw === '' ? null : Number(raw);
};
const onCurrencySelect = (event: Event): void => {
  relationCurrency.value = (event.target as HTMLSelectElement).value as PcbCurrencyType;
};
</script>

<template>
  <SectionCard title="마스터딜러 소속">
    <template #meta>PCB 2단 중개 링크(MD↔하위)</template>

    <p v-if="relations === undefined" class="text-muted-foreground flex items-center gap-2 text-sm">
      <Spinner />
      불러오는 중…
    </p>
    <template v-else>
      <!-- 이 조직이 소속된 상위 MD -->
      <div v-if="relations.parents.length > 0" class="flex flex-col gap-1.5">
        <p class="text-info text-xs font-semibold">소속된 마스터딜러</p>
        <Item v-for="p in relations.parents" :key="p.partnerId" variant="outline-info" size="xs">
          <span class="text-info min-w-0 flex-1 truncate text-sm font-semibold">{{ p.name }}</span>
          <span class="text-muted-foreground text-xs">{{ p.country ?? '—' }}</span>
          <NativeSelect
            :model-value="p.settlementCurrency ?? 'USD'"
            class="w-24"
            :aria-label="`${p.name} 링크 통화`"
            :disabled="relationCurrencyMut.isPending.value"
            @change="(event: Event) => void changeLinkCurrency(p.partnerId, detail.partnerId, event)"
          >
            <NativeSelectOption v-for="cur in PCB_CURRENCIES" :key="cur" :value="cur">{{ cur }}</NativeSelectOption>
          </NativeSelect>
          <Badge v-if="p.activeCount > 0" variant="warning" class="tabular-nums">진행 {{ p.activeCount }}건</Badge>
          <Button
            variant="ghost"
            size="xs"
            :disabled="p.activeCount > 0 || removeRelationMut.isPending.value"
            @click="void removeLink(p.partnerId, detail.partnerId)"
          >
            <UnlinkIcon class="text-destructive" />
            <span class="text-destructive">해제</span>
          </Button>
        </Item>
      </div>

      <!-- 하위 협력사 -->
      <div class="flex flex-col gap-1.5">
        <p class="text-muted-foreground text-xs font-semibold">하위 협력사 ({{ relations.children.length }})</p>
        <p v-if="relations.children.length === 0" class="text-muted-foreground text-sm">
          하위 협력사 없음 — 연결하면 이 조직이 마스터딜러로 동작합니다(하위 재요청·재발주).
        </p>
        <Item v-for="c in relations.children" :key="c.partnerId" variant="outline" size="xs">
          <span class="min-w-0 flex-1 truncate text-sm">{{ c.name }}</span>
          <Badge v-if="c.status !== 'approved'" variant="danger">{{ PARTNER_STATUS_LABELS[c.status] }}</Badge>
          <span class="text-muted-foreground text-xs">{{ c.country ?? '—' }}</span>
          <NativeSelect
            :model-value="c.settlementCurrency ?? 'USD'"
            class="w-24"
            :aria-label="`${c.name} 링크 통화`"
            :disabled="relationCurrencyMut.isPending.value"
            @change="(event: Event) => void changeLinkCurrency(detail.partnerId, c.partnerId, event)"
          >
            <NativeSelectOption v-for="cur in PCB_CURRENCIES" :key="cur" :value="cur">{{ cur }}</NativeSelectOption>
          </NativeSelect>
          <Badge
            v-if="c.activeCount > 0"
            variant="warning"
            class="tabular-nums"
            title="진행 중 견적·발주가 있어 해제할 수 없습니다"
          >
            진행 {{ c.activeCount }}건
          </Badge>
          <Button
            variant="ghost"
            size="xs"
            :disabled="c.activeCount > 0 || removeRelationMut.isPending.value"
            @click="void removeLink(detail.partnerId, c.partnerId)"
          >
            <UnlinkIcon class="text-destructive" />
            <span class="text-destructive">해제</span>
          </Button>
          <!-- 강제 전환으로 맺은 링크 — 누가 왜 넘었는지 남긴다 -->
          <p v-if="c.forceNote !== null" class="text-warning w-full text-xs">
            강제 전환{{ c.createdBy !== null ? ` · ${c.createdBy}` : '' }} — {{ c.forceNote }}
          </p>
        </Item>
      </div>

      <!-- 첫 하위 연결(마스터딜러 전환)이 지금 막히는 조직 — 누르기 전에 알리고 사유를 받는다 -->
      <div
        v-if="relations.parents.length === 0 && conversionBlock !== null"
        class="border-warning/40 bg-warning-soft flex flex-col gap-2 rounded-lg border p-3"
        data-testid="relation-conversion-block"
      >
        <p class="text-warning text-xs font-semibold">
          진행 중인 발주가 {{ conversionBlock.activePoCount }}건 있어 마스터딜러 전환이 막혀 있습니다.
        </p>
        <p class="text-muted-foreground text-xs">
          사유를 남기면 강제로 연결할 수 있습니다. 진행 중인 발주는 직접 제작으로 그대로 진행되고, 이후 견적부터
          하위에 맡길 수 있습니다.
        </p>
        <Field>
          <FieldLabel :for="`relation-force-${String(detail.partnerId)}`" class="sr-only">강제 전환 사유</FieldLabel>
          <Input
            :id="`relation-force-${String(detail.partnerId)}`"
            v-model="forceReason"
            maxlength="255"
            placeholder="강제 전환 사유 (예: 발주가 끊이지 않아 종결을 기다릴 수 없음)"
          />
        </Field>
      </div>

      <!-- 하위 연결 — 다른 MD 의 하위 조직이면 후보가 비어 폼을 감춘다(2단 제한) -->
      <div v-if="relations.parents.length === 0" class="flex items-center gap-2">
        <!-- Field 가 자식 폭을 채운다(NativeSelect 바깥 상자는 w-fit) — 후보 이름이 길어도 남은 폭을 다 쓴다. -->
        <Field class="min-w-0 flex-1">
          <FieldLabel :for="`relation-child-${String(detail.partnerId)}`" class="sr-only">하위로 연결할 협력사</FieldLabel>
          <NativeSelect
            :id="`relation-child-${String(detail.partnerId)}`"
            :model-value="relationChildId === null ? '' : String(relationChildId)"
            @change="onChildSelect"
          >
            <NativeSelectOption value="" disabled>하위로 연결할 협력사 선택</NativeSelectOption>
            <NativeSelectOption v-for="cand in relations.candidates" :key="cand.partnerId" :value="String(cand.partnerId)">
              {{ cand.name }}{{ cand.country !== null ? ` · ${cand.country}` : '' }}{{ cand.hasPcbRfq ? '' : ' (PCB 견적 능력 없음)' }}
            </NativeSelectOption>
          </NativeSelect>
        </Field>
        <NativeSelect :model-value="relationCurrency" class="w-24" aria-label="링크 통화" @change="onCurrencySelect">
          <NativeSelectOption v-for="cur in PCB_CURRENCIES" :key="cur" :value="cur">{{ cur }}</NativeSelectOption>
        </NativeSelect>
        <Button variant="secondary" :disabled="addRelationMut.isPending.value" @click="void addRelation()">
          {{ conversionBlock !== null ? '강제 연결' : '연결' }}
        </Button>
      </div>
      <p v-else class="text-muted-foreground text-xs">
        다른 마스터딜러의 하위 조직입니다 — 하위를 둘 수 없습니다(2단 제한).
      </p>
      <p class="text-muted-foreground text-xs">
        링크 통화는 MD↔하위 결제통화입니다 — 배정 시점에 견적행으로 박제되며, 변경은 이후 배정부터 적용됩니다.
      </p>
      <p v-if="relationError !== ''" role="alert" class="text-destructive text-sm font-medium">{{ relationError }}</p>
    </template>
  </SectionCard>
</template>
