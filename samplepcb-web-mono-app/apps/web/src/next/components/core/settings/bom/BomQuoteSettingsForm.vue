<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { ApiRequestError, apiSend } from '@sp/shared';
import {
  BomQuoteConfigResponse,
  BomQuoteExchangeRateRefreshResponse,
  BomQuoteUsdRateMode,
  BomQuoteUsdRateType,
  type BomQuoteConfigType,
} from '@sp/api-contract';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Label } from '@/next/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Spinner } from '@/next/components/ui/spinner';
import { Switch } from '@/next/components/ui/switch';
import SaveRow from '../SaveRow.vue';
import BomContactSection from './BomContactSection.vue';
import BomExchangeRateStatus from './BomExchangeRateStatus.vue';
import BomRecentRuns from './BomRecentRuns.vue';
import BomSearchUsage from './BomSearchUsage.vue';
import {
  BOM_QUOTE_SETTINGS_KEY,
  BOM_QUOTE_SETTINGS_PATH,
  supplierLabel,
  useBomQuoteConfig,
} from './bom-quote-settings';

// BOM 견적 탭 — 고객 BOM 견적 비용·환율·검색 한도(sp_config bom_quote). 레거시 하드코딩(운송료 30000·
// 관리비 25000)의 관리자 설정 승격 — 고객 화면엔 '예상' 라벨로 표시된다. 옛
// components/admin/BomQuoteSettingsForm.vue 와 같은 섹션 순서(견적서 담당자 → 견적 비용 기본값 → USD 환율 →
// 공급사 검색 운영 → 저장 바)·같은 저장 본문. 견적서 담당자는 따로 저장되므로 이 폼 밖에 둔다(그 칸에서
// Enter 를 쳐도 비용 설정이 저장되지 않게).
const qc = useQueryClient();
const query = useBomQuoteConfig();

const form = ref<BomQuoteConfigType | null>(null);
const saved = ref(false);
const error = ref('');
const refreshMessage = ref('');
const exchangeRate = computed(() => query.data.value?.exchangeRate ?? null);
const supplierSearch = computed(() => query.data.value?.supplierSearch ?? null);
const engineMaxCalls = computed(() => supplierSearch.value?.engine.maxCallsPerJob ?? null);
const maxCallsInvalid = computed(() => {
  const configured = form.value?.supplierSearchMaxCalls;
  return configured !== undefined && engineMaxCalls.value !== null && configured > engineMaxCalls.value;
});
const effectiveMaxCalls = computed(() => {
  const configured = form.value?.supplierSearchMaxCalls;
  if (configured === undefined || engineMaxCalls.value === null) return null;
  return Math.min(configured, engineMaxCalls.value);
});

watch(
  () => query.data.value?.data,
  (d) => {
    if (d !== undefined && form.value === null) form.value = { ...d };
  },
  { immediate: true },
);

const save = useMutation({
  mutationFn: (body: BomQuoteConfigType) => apiSend('PUT', BOM_QUOTE_SETTINGS_PATH, body, BomQuoteConfigResponse),
  onSuccess: (res) => {
    form.value = { ...res.data };
    saved.value = true;
    void qc.invalidateQueries({ queryKey: BOM_QUOTE_SETTINGS_KEY });
    setTimeout(() => (saved.value = false), 2_000);
  },
  onError: (reason: unknown) => {
    error.value = reason instanceof ApiRequestError ? reason.message : '저장에 실패했습니다.';
  },
});

const refreshRate = useMutation({
  mutationFn: () =>
    apiSend('POST', `${BOM_QUOTE_SETTINGS_PATH}/exchange-rate/refresh`, undefined, BomQuoteExchangeRateRefreshResponse),
  onSuccess: (res) => {
    qc.setQueryData(BOM_QUOTE_SETTINGS_KEY, res);
    refreshMessage.value = res.exchangeRate.lastRefreshError ?? '최신 고시 환율을 반영했습니다.';
  },
  onError: () => {
    refreshMessage.value = '환율 갱신 요청에 실패했습니다.';
  },
});

function submit(): void {
  if (form.value === null || maxCallsInvalid.value) return;
  error.value = '';
  // 환율 빈 입력 → null(미환산 표시)
  const rate = form.value.usdKrwRate;
  save.mutate({ ...form.value, usdKrwRate: rate === null || Number.isNaN(rate) || rate <= 0 ? null : rate });
}

// NativeSelect 의 change 는 select 원소에 그대로 붙는다 — 계약 enum 으로 좁혀 받는다.
const selectValue = (event: Event): string => (event.target instanceof HTMLSelectElement ? event.target.value : '');
const onRateModePick = (event: Event): void => {
  const parsed = BomQuoteUsdRateMode.safeParse(selectValue(event));
  if (parsed.success && form.value !== null) form.value.usdKrwRateMode = parsed.data;
};
const onAutoRateTypePick = (event: Event): void => {
  const parsed = BomQuoteUsdRateType.safeParse(selectValue(event));
  if (parsed.success && form.value !== null) form.value.usdKrwAutoRateType = parsed.data;
};
// 수동 환율은 null(미설정)을 갖는다 — 입력칸에는 빈 칸으로 보이고, 비우면 null 로 돌린다(저장 때 null·NaN·0 이하는
// 어차피 null 로 보낸다 — 옛 화면 v-model.number 와 같은 결과).
const onManualRateInput = (value: string | number): void => {
  if (form.value === null) return;
  form.value.usdKrwRate = typeof value === 'number' ? value : value.trim() === '' ? null : Number(value);
};
</script>

<template>
  <p v-if="query.isLoading.value" class="text-muted-foreground inline-flex items-center gap-2 text-sm">
    <Spinner />
    불러오는 중…
  </p>
  <div v-else-if="form !== null" class="flex max-w-5xl flex-col gap-4">
    <BomContactSection />

    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <SectionCard title="견적 비용 기본값">
        <p class="text-muted-foreground text-sm">고객 화면에는 예상 금액으로 표시되며 확정가는 관리자 검토에서 결정합니다.</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel for="bom-default-shipping">기본 운송료(원)</FieldLabel>
            <Input id="bom-default-shipping" v-model.number="form.defaultShippingFee" type="number" min="0" class="text-right tabular-nums" />
          </Field>
          <Field>
            <FieldLabel for="bom-default-management">기본 관리비(원)</FieldLabel>
            <Input
              id="bom-default-management"
              v-model.number="form.defaultManagementFee"
              type="number"
              min="0"
              class="text-right tabular-nums"
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="USD 환율">
        <p class="text-muted-foreground text-sm">자동 고시 환율과 장애 시 사용할 수동 폴백을 관리합니다.</p>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field>
            <FieldLabel for="bom-rate-mode">적용 방식</FieldLabel>
            <NativeSelect id="bom-rate-mode" :model-value="form.usdKrwRateMode" @change="onRateModePick">
              <NativeSelectOption value="auto">수출입은행 자동 환율</NativeSelectOption>
              <NativeSelectOption value="manual">관리자 수동 환율</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel for="bom-rate-manual">수동 환율 / 장애 폴백(원)</FieldLabel>
            <Input
              id="bom-rate-manual"
              :model-value="form.usdKrwRate ?? ''"
              type="number"
              min="0"
              step="0.01"
              placeholder="예: 1400"
              class="text-right tabular-nums"
              @update:model-value="onManualRateInput"
            />
          </Field>
          <Field>
            <FieldLabel for="bom-rate-auto-type">자동 환율 기준</FieldLabel>
            <NativeSelect
              id="bom-rate-auto-type"
              :model-value="form.usdKrwAutoRateType"
              :disabled="form.usdKrwRateMode !== 'auto'"
              @change="onAutoRateTypePick"
            >
              <NativeSelectOption value="dealBasR">매매기준율</NativeSelectOption>
              <NativeSelectOption value="tts">송금 보낼 때(TTS)</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel for="bom-rate-margin">안전계수(%)</FieldLabel>
            <Input
              id="bom-rate-margin"
              v-model.number="form.usdKrwSafetyMarginPercent"
              type="number"
              min="0"
              max="20"
              step="0.1"
              :disabled="form.usdKrwRateMode !== 'auto'"
              class="text-right tabular-nums"
            />
          </Field>
          <Field>
            <FieldLabel for="bom-rate-max-age">최대 경과일</FieldLabel>
            <Input
              id="bom-rate-max-age"
              v-model.number="form.usdKrwMaxAgeDays"
              type="number"
              min="1"
              max="30"
              :disabled="form.usdKrwRateMode !== 'auto'"
              class="text-right tabular-nums"
            />
          </Field>
        </div>
        <BomExchangeRateStatus
          v-if="exchangeRate !== null"
          :exchange-rate="exchangeRate"
          :refreshing="refreshRate.isPending.value"
          :refresh-message="refreshMessage"
          @refresh="refreshRate.mutate()"
        />
      </SectionCard>

      <SectionCard title="공급사 검색 운영">
        <template #meta>업무 한도와 엔진 안전 상한, 실제 검색 사용량을 함께 확인합니다.</template>
        <template #actions>
          <Badge :variant="supplierSearch?.engine.available ? 'success' : 'danger'">
            {{ supplierSearch?.engine.available ? '엔진 연결됨' : '엔진 연결 실패' }}
          </Badge>
        </template>

        <BomSearchUsage
          :configured-max-calls="form.supplierSearchMaxCalls"
          :member-daily-search-limit="form.memberDailySearchLimit"
          :engine-max-calls="engineMaxCalls"
          :effective-max-calls="effectiveMaxCalls"
          :supplier-search="supplierSearch"
        />

        <div class="grid gap-4 sm:grid-cols-3">
          <Field :data-invalid="maxCallsInvalid ? true : undefined">
            <FieldLabel for="bom-max-calls">검색 1회 최대 API 호출</FieldLabel>
            <Input
              id="bom-max-calls"
              v-model.number="form.supplierSearchMaxCalls"
              type="number"
              min="1"
              :max="engineMaxCalls ?? 3000"
              :aria-invalid="maxCallsInvalid ? true : undefined"
              class="text-right tabular-nums"
            />
            <FieldDescription>예상치는 경고, 실제 호출은 이 값에서 제한</FieldDescription>
          </Field>
          <Field>
            <FieldLabel for="bom-member-daily">회원별 일일 검색 한도</FieldLabel>
            <Input
              id="bom-member-daily"
              v-model.number="form.memberDailySearchLimit"
              type="number"
              min="1"
              max="1000"
              class="text-right tabular-nums"
            />
            <FieldDescription>KST 자정 기준·DB 영속</FieldDescription>
          </Field>
          <Field>
            <FieldLabel for="bom-freshness">데이터 신선 임계(시간)</FieldLabel>
            <Input
              id="bom-freshness"
              v-model.number="form.freshnessHours"
              type="number"
              min="1"
              max="720"
              class="text-right tabular-nums"
            />
            <FieldDescription>초과 시 업로드 때 자동 보강</FieldDescription>
          </Field>
        </div>
        <Alert v-if="maxCallsInvalid" variant="destructive" size="sm">
          <AlertDescription>현재 엔진 안전 상한 {{ engineMaxCalls }}회를 넘을 수 없습니다.</AlertDescription>
        </Alert>

        <Panel size="md" :tone="form.storedPartPrioritySearchEnabled ? 'default' : 'muted'">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-sm font-semibold">저장된 부품 우선 검색</h3>
                <Badge variant="outline">실험 기능</Badge>
              </div>
              <p class="text-muted-foreground mt-1 text-sm">
                MPN 없는 저항·캐패시터를 저장된 공급사 부품에서 값과 패키지로 먼저 찾고, 엔진이 확인한 후보가 있으면 외부 API 호출을
                생략합니다.
              </p>
              <p class="text-muted-foreground mt-1 text-xs">
                끄면 저장 후 시작하는 검색부터 기존 외부 공급사 검색을 사용합니다. SamplePCB R/C·커넥터 자체 카탈로그와 과거 선정 결과에는
                영향이 없습니다.
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Switch
                id="bom-stored-part-priority"
                v-model="form.storedPartPrioritySearchEnabled"
                aria-label="저장된 부품 우선 검색 실험 사용 여부"
              />
              <Label for="bom-stored-part-priority">{{ form.storedPartPrioritySearchEnabled ? '켜짐' : '꺼짐' }}</Label>
            </div>
          </div>
        </Panel>

        <div v-if="supplierSearch !== null" class="flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
          <Badge
            v-for="supplier in supplierSearch.engine.suppliers"
            :key="supplier.supplier"
            :variant="supplier.configured ? 'success' : 'warning'"
          >
            {{ supplierLabel(supplier.supplier) }} {{ supplier.configured ? '연결' : '키 없음' }}
          </Badge>
          <span v-if="supplierSearch.engine.cache !== null" class="text-muted-foreground ml-auto tabular-nums">
            캐시 {{ supplierSearch.engine.cache.mode === 'normal' ? '일반' : '전용' }} ·
            {{ supplierSearch.engine.cache.entryCount.toLocaleString('ko-KR') }}건 · 키워드 TTL
            {{ Math.round(supplierSearch.engine.cache.keywordTtlSeconds / 3600) }}시간
          </span>
          <span v-else class="text-destructive ml-auto">{{ supplierSearch.engine.error }}</span>
        </div>
      </SectionCard>

      <BomRecentRuns v-if="supplierSearch !== null" :runs="supplierSearch.recentRuns" />

      <Panel class="bg-card/95 sticky bottom-3 shadow-lg backdrop-blur">
        <SaveRow :pending="save.isPending.value" :disabled="maxCallsInvalid" :saved="saved" :error="error" />
      </Panel>
    </form>
  </div>
</template>
