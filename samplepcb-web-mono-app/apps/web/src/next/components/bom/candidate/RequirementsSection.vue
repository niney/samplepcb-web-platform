<script setup lang="ts">
import { computed } from 'vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { useCandidateDrawer } from './useCandidateDrawer';

// 검색 조건 보완 — 원본 BOM 은 그대로 두고 이 행의 공급사 검색에만 쓰는 조건. 엔진이 '보완 필요'로 판정한 항목을
// 채워 행 재검색을 연다. 비워 둔 선택 조건은 자동선정을 막고 후보 검토 항목으로 남는다.
const { props, requirements: form } = useCandidateDrawer();
const {
  componentType,
  capacitorType,
  inductorType,
  diodeType,
  transistorType,
  transistorPolarity,
  crystalType,
  connectorGender,
  connectorOrientation,
  switchType,
  resistance,
  capacitance,
  inductance,
  impedance,
  impedanceFrequency,
  frequency,
  packageCode,
  tolerance,
  voltage,
  current,
  power,
  dielectric,
  color,
  pinCount,
  pitch,
  rowCount,
  contactForm,
  mountStyle,
  componentLabel,
  engineReadiness,
  engineSearchExcluded,
  engineMissingLabels,
  valid,
  submit,
} = form;

const is = (...types: string[]): boolean => componentType.value !== null && types.includes(componentType.value);
const locked = computed(() => props.requirementsSaving || props.interactionLocked || engineSearchExcluded.value);
const readinessBadge = computed(() =>
  engineReadiness.value === 'searchable'
    ? { label: '엔진 검색 가능', variant: 'success' as const }
    : engineReadiness.value === 'needs_user_input'
      ? { label: '엔진 보완 필요', variant: 'warning' as const }
      : { label: '검색 제외', variant: 'secondary' as const },
);
const submitLabel = computed(() =>
  engineSearchExcluded.value
    ? '검색 제외 행'
    : props.requirementsSaving
      ? '행 재검색 시작 중…'
      : props.context?.searchRequirements === null
        ? '조건 저장 후 검색'
        : '조건 변경 후 재검색',
);
</script>

<template>
  <SectionCard>
    <template #title>검색 조건 보완</template>
    <template #meta>
      <span class="inline-flex flex-wrap items-center gap-1.5">
        <Badge variant="info">{{ componentLabel }}</Badge>
        <Badge v-if="engineReadiness !== null" :variant="readinessBadge.variant">{{ readinessBadge.label }}</Badge>
        <Badge v-if="props.context?.searchRequirements !== null" variant="success">사용자 조건 저장됨</Badge>
      </span>
    </template>
    <template #notice>
      <NoticeBand v-if="engineSearchExcluded" class="font-medium">
        이 행은 엔진 판정에 따라 공급사 검색에서 제외되었습니다. 필요한 경우 전체 부품 검색에서 직접 선택할 수 있습니다.
      </NoticeBand>
      <NoticeBand v-else>
        원본 BOM은 유지하고 이 행의 공급사 검색에만 적용합니다. 비워 둔 선택 조건은 자동선정을 막고 후보 검토 항목으로 남습니다.
      </NoticeBand>
      <NoticeBand v-if="engineMissingLabels.length > 0" tone="warning" class="font-medium">
        엔진이 확인한 보완 항목: {{ engineMissingLabels.join(', ') }}
      </NoticeBand>
    </template>

    <form :aria-busy="props.requirementsProgress !== ''" @submit.prevent="submit">
      <fieldset class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" :disabled="locked">
        <Field v-if="is('resistor')">
          <FieldLabel for="req-resistance">저항값 <b class="text-destructive">*</b></FieldLabel>
          <Input id="req-resistance" v-model.trim="resistance" maxlength="64" placeholder="예: 10kΩ" />
        </Field>
        <Field v-if="is('capacitor')">
          <FieldLabel for="req-capacitance">정전용량 <b class="text-destructive">*</b></FieldLabel>
          <Input id="req-capacitance" v-model.trim="capacitance" maxlength="64" placeholder="예: 100nF" />
        </Field>
        <Field v-if="is('capacitor')">
          <FieldLabel for="req-capacitor-type">캐패시터 종류 <b class="text-destructive">*</b></FieldLabel>
          <NativeSelect id="req-capacitor-type" v-model="capacitorType">
            <NativeSelectOption value="">선택 필요</NativeSelectOption>
            <NativeSelectOption value="ceramic">MLCC / 세라믹</NativeSelectOption>
            <NativeSelectOption value="electrolytic">전해</NativeSelectOption>
            <NativeSelectOption value="tantalum">탄탈</NativeSelectOption>
            <NativeSelectOption value="film">필름</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field v-if="is('inductor')">
          <FieldLabel for="req-inductor-type">인덕터 종류 <b class="text-destructive">*</b></FieldLabel>
          <NativeSelect id="req-inductor-type" v-model="inductorType">
            <NativeSelectOption value="">선택 필요</NativeSelectOption>
            <NativeSelectOption value="standard">일반 인덕터</NativeSelectOption>
            <NativeSelectOption value="ferrite">페라이트 비드</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field v-if="is('inductor') && inductorType === 'standard'">
          <FieldLabel for="req-inductance">인덕턴스 <b class="text-destructive">*</b></FieldLabel>
          <Input id="req-inductance" v-model.trim="inductance" maxlength="64" placeholder="예: 10uH" />
        </Field>
        <Field v-if="is('inductor') && inductorType === 'ferrite'">
          <FieldLabel for="req-impedance">임피던스 <b class="text-destructive">*</b></FieldLabel>
          <Input id="req-impedance" v-model.trim="impedance" maxlength="64" placeholder="예: 120Ω" />
        </Field>
        <Field v-if="is('inductor') && inductorType === 'ferrite'">
          <FieldLabel for="req-impedance-frequency">임피던스 기준 주파수</FieldLabel>
          <Input id="req-impedance-frequency" v-model.trim="impedanceFrequency" maxlength="64" placeholder="예: 100MHz" />
        </Field>
        <Field v-if="is('diode')">
          <FieldLabel for="req-diode-type">다이오드 종류 <b class="text-destructive">*</b></FieldLabel>
          <NativeSelect id="req-diode-type" v-model="diodeType">
            <NativeSelectOption value="">선택 필요</NativeSelectOption>
            <NativeSelectOption value="rectifier">정류</NativeSelectOption>
            <NativeSelectOption value="signal">신호</NativeSelectOption>
            <NativeSelectOption value="schottky">쇼트키</NativeSelectOption>
            <NativeSelectOption value="zener">제너</NativeSelectOption>
            <NativeSelectOption value="tvs">TVS</NativeSelectOption>
            <NativeSelectOption value="photodiode">포토다이오드</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field v-if="is('transistor')">
          <FieldLabel for="req-transistor-type">소자 종류 <b class="text-destructive">*</b></FieldLabel>
          <NativeSelect id="req-transistor-type" v-model="transistorType">
            <NativeSelectOption value="">선택 필요</NativeSelectOption>
            <NativeSelectOption value="bjt">BJT</NativeSelectOption>
            <NativeSelectOption value="mosfet">MOSFET</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field v-if="is('transistor')">
          <FieldLabel for="req-polarity">극성 / 채널 <b class="text-destructive">*</b></FieldLabel>
          <NativeSelect id="req-polarity" v-model="transistorPolarity">
            <NativeSelectOption value="">선택 필요</NativeSelectOption>
            <NativeSelectOption v-if="transistorType !== 'mosfet'" value="npn">NPN</NativeSelectOption>
            <NativeSelectOption v-if="transistorType !== 'mosfet'" value="pnp">PNP</NativeSelectOption>
            <NativeSelectOption v-if="transistorType !== 'bjt'" value="n-channel">N-Channel</NativeSelectOption>
            <NativeSelectOption v-if="transistorType !== 'bjt'" value="p-channel">P-Channel</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field v-if="is('led')">
          <FieldLabel for="req-color">발광색 <b class="text-destructive">*</b></FieldLabel>
          <Input id="req-color" v-model.trim="color" maxlength="32" placeholder="예: Red / Green / White" />
        </Field>
        <Field v-if="is('crystal')">
          <FieldLabel for="req-crystal-type">소자 종류 <b class="text-destructive">*</b></FieldLabel>
          <NativeSelect id="req-crystal-type" v-model="crystalType">
            <NativeSelectOption value="">선택 필요</NativeSelectOption>
            <NativeSelectOption value="crystal">크리스탈</NativeSelectOption>
            <NativeSelectOption value="oscillator">오실레이터</NativeSelectOption>
            <NativeSelectOption value="resonator">레조네이터</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field v-if="is('crystal')">
          <FieldLabel for="req-frequency">주파수 <b class="text-destructive">*</b></FieldLabel>
          <Input id="req-frequency" v-model.trim="frequency" maxlength="64" placeholder="예: 16MHz" />
        </Field>
        <Field v-if="is('connector')">
          <FieldLabel for="req-pin-count">핀 수 <b class="text-destructive">*</b></FieldLabel>
          <Input id="req-pin-count" v-model.trim="pinCount" type="number" min="1" max="1000" step="1" placeholder="예: 4" />
        </Field>
        <Field v-if="is('connector')">
          <FieldLabel for="req-pitch">피치 <b class="text-destructive">*</b></FieldLabel>
          <Input id="req-pitch" v-model.trim="pitch" maxlength="32" placeholder="예: 2.54mm" />
        </Field>
        <Field v-if="is('connector')">
          <FieldLabel for="req-row-count">열 수</FieldLabel>
          <Input id="req-row-count" v-model.trim="rowCount" type="number" min="1" max="100" step="1" placeholder="모름 또는 예: 2" />
        </Field>
        <Field v-if="is('connector')">
          <FieldLabel for="req-gender">성별</FieldLabel>
          <NativeSelect id="req-gender" v-model="connectorGender">
            <NativeSelectOption value="">모름 · 직접 검토</NativeSelectOption>
            <NativeSelectOption value="male">Male</NativeSelectOption>
            <NativeSelectOption value="female">Female</NativeSelectOption>
            <NativeSelectOption value="genderless">Genderless</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field v-if="is('connector')">
          <FieldLabel for="req-orientation">방향</FieldLabel>
          <NativeSelect id="req-orientation" v-model="connectorOrientation">
            <NativeSelectOption value="">모름 · 직접 검토</NativeSelectOption>
            <NativeSelectOption value="straight">Straight</NativeSelectOption>
            <NativeSelectOption value="right-angle">Right Angle</NativeSelectOption>
            <NativeSelectOption value="vertical">Vertical</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field v-if="is('switch')">
          <FieldLabel for="req-switch-type">스위치 종류 <b class="text-destructive">*</b></FieldLabel>
          <NativeSelect id="req-switch-type" v-model="switchType">
            <NativeSelectOption value="">선택 필요</NativeSelectOption>
            <NativeSelectOption value="tactile">택트</NativeSelectOption>
            <NativeSelectOption value="pushbutton">푸시버튼</NativeSelectOption>
            <NativeSelectOption value="slide">슬라이드</NativeSelectOption>
            <NativeSelectOption value="toggle">토글</NativeSelectOption>
            <NativeSelectOption value="dip">DIP</NativeSelectOption>
            <NativeSelectOption value="rotary">로터리</NativeSelectOption>
            <NativeSelectOption value="reed">리드</NativeSelectOption>
            <NativeSelectOption value="other">기타</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field v-if="is('switch')">
          <FieldLabel for="req-contact-form">접점 구성</FieldLabel>
          <Input id="req-contact-form" v-model.trim="contactForm" maxlength="64" placeholder="모름 또는 예: SPST-NO" />
        </Field>

        <Field>
          <FieldLabel for="req-package">
            패키지 / 외형 <b v-if="!is('connector')" class="text-destructive">*</b>
          </FieldLabel>
          <Input
            id="req-package"
            v-model.trim="packageCode"
            maxlength="64"
            :placeholder="is('connector') ? '선택 · 예: 2x2 Header' : '예: 0603 / SOT-23 / 6x6mm'"
          />
        </Field>
        <Field v-if="is('resistor', 'capacitor', 'inductor', 'crystal')">
          <FieldLabel for="req-tolerance">허용오차</FieldLabel>
          <Input id="req-tolerance" v-model.trim="tolerance" maxlength="64" placeholder="모름 또는 예: 10%" />
        </Field>
        <Field v-if="is('resistor', 'diode', 'transistor')">
          <FieldLabel for="req-power">정격전력</FieldLabel>
          <Input id="req-power" v-model.trim="power" maxlength="64" placeholder="조건 없음 또는 예: 0.1W" />
        </Field>
        <Field v-if="is('resistor', 'capacitor', 'diode', 'transistor', 'led', 'switch')">
          <FieldLabel for="req-voltage">
            정격전압 <b v-if="is('diode') && (diodeType === 'zener' || diodeType === 'tvs')" class="text-destructive">*</b>
          </FieldLabel>
          <Input id="req-voltage" v-model.trim="voltage" maxlength="64" placeholder="모름 또는 예: 25V" />
        </Field>
        <Field v-if="is('inductor', 'diode', 'transistor', 'led', 'switch')">
          <FieldLabel for="req-current">정격전류</FieldLabel>
          <Input id="req-current" v-model.trim="current" maxlength="64" placeholder="모름 또는 예: 1A" />
        </Field>
        <Field v-if="is('capacitor') && capacitorType === 'ceramic'">
          <FieldLabel for="req-dielectric">유전체</FieldLabel>
          <NativeSelect id="req-dielectric" v-model="dielectric">
            <NativeSelectOption value="">모름 · 직접 검토</NativeSelectOption>
            <NativeSelectOption value="C0G">C0G / NP0</NativeSelectOption>
            <NativeSelectOption value="X5R">X5R</NativeSelectOption>
            <NativeSelectOption value="X7R">X7R</NativeSelectOption>
            <NativeSelectOption value="X8R">X8R</NativeSelectOption>
            <NativeSelectOption value="Y5V">Y5V</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel for="req-mount">실장방식</FieldLabel>
          <NativeSelect id="req-mount" v-model="mountStyle">
            <NativeSelectOption value="">자동 판정</NativeSelectOption>
            <NativeSelectOption value="smd">SMD</NativeSelectOption>
            <NativeSelectOption value="through-hole">THT</NativeSelectOption>
          </NativeSelect>
        </Field>

        <div class="flex flex-col gap-2 sm:col-span-2 lg:col-span-4">
          <Alert v-if="props.requirementsError !== ''" variant="destructive" size="sm">
            <AlertDescription>{{ props.requirementsError }}</AlertDescription>
          </Alert>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-muted-foreground text-xs">
              {{
                engineSearchExcluded
                  ? '검색 제외 사유는 원본 BOM에 유지되며, 검색 조건 재검색은 실행하지 않습니다.'
                  : '정격은 이상(≥), 허용오차는 이하(≤)로 검증합니다. 신규 유형의 최소 조건 검색은 후보 검토 대상으로 유지됩니다.'
              }}
            </p>
            <Button type="submit" :disabled="locked || !valid">{{ submitLabel }}</Button>
          </div>
        </div>
      </fieldset>
    </form>
  </SectionCard>
</template>
