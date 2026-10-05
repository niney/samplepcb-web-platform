import { computed, ref } from 'vue';
import type { CandidateDrawerEmit, ResolvedCandidateDrawerProps } from './types';

// 검색 조건 보완 폼 — 원본 BOM 은 그대로 두고 이 행의 공급사 검색에만 쓰는 사용자 조건. 옛 BomCandidateDrawer 의
// 폼 상태·추론·검증·제출을 그대로 옮겼다. 초깃값 우선순위: 저장된 사용자 조건 → 엔진 보완 안내(guidance) →
// 원본 추출값 → 근거 문자열 추론.

export type RequirementComponentType =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'diode'
  | 'transistor'
  | 'led'
  | 'crystal'
  | 'connector'
  | 'switch';
type CapacitorType = 'ceramic' | 'electrolytic' | 'tantalum' | 'film';
type InductorType = 'standard' | 'ferrite';
type DiodeType = 'rectifier' | 'signal' | 'schottky' | 'zener' | 'tvs' | 'photodiode';
type TransistorType = 'bjt' | 'mosfet';
type TransistorPolarity = 'npn' | 'pnp' | 'n-channel' | 'p-channel';
type CrystalType = 'crystal' | 'oscillator' | 'resonator';
type ConnectorGender = 'male' | 'female' | 'genderless';
type ConnectorOrientation = 'straight' | 'right-angle' | 'vertical';
type SwitchType = 'tactile' | 'pushbutton' | 'slide' | 'toggle' | 'dip' | 'rotary' | 'reed' | 'other';

const COMPONENT_LABELS: Record<RequirementComponentType, string> = {
  resistor: '저항',
  capacitor: '캐패시터',
  inductor: '인덕터',
  diode: '다이오드',
  transistor: 'TR / FET',
  led: 'LED',
  crystal: '크리스탈',
  connector: '커넥터',
  switch: '스위치',
};

const MISSING_FIELD_LABELS: Record<string, string> = {
  resistance: '저항값',
  capacitance: '정전용량',
  inductance: '인덕턴스',
  impedance: '임피던스',
  frequency: '주파수',
  packageCode: '패키지',
  capacitorType: '캐패시터 종류',
  inductorType: '인덕터 종류',
  diodeType: '다이오드 종류',
  transistorType: '소자 종류',
  polarity: '극성/채널',
  color: '색상',
  crystalType: '발진 소자 종류',
  pinCount: '핀 수',
  pitch: '피치',
  switchType: '스위치 종류',
  voltage: '정격전압',
};

function inferCapacitorType(text: string, inferredDielectric: string): CapacitorType | '' {
  const normalized = text.toLocaleLowerCase('en-US');
  if (normalized.includes('electrolytic') || normalized.includes('ecap') || normalized.includes('전해')) {
    return 'electrolytic';
  }
  if (normalized.includes('tantalum') || normalized.includes('탄탈')) return 'tantalum';
  if (normalized.includes('film') || normalized.includes('필름')) return 'film';
  return inferredDielectric === '' ? '' : 'ceramic';
}

function nullableRequirement(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

const pick = <T extends string>(value: string, allowed: readonly T[]): T | null =>
  allowed.find((entry) => entry === value) ?? null;

export function useRequirementsForm(
  props: ResolvedCandidateDrawerProps,
  emit: CandidateDrawerEmit,
  originalFieldValue: (key: string) => string,
) {
  const componentType = ref<RequirementComponentType | null>(null);
  const capacitorType = ref<CapacitorType | ''>('');
  const inductorType = ref<InductorType | ''>('');
  const diodeType = ref<DiodeType | ''>('');
  const transistorType = ref<TransistorType | ''>('');
  const transistorPolarity = ref<TransistorPolarity | ''>('');
  const crystalType = ref<CrystalType | ''>('');
  const connectorGender = ref<ConnectorGender | ''>('');
  const connectorOrientation = ref<ConnectorOrientation | ''>('');
  const switchType = ref<SwitchType | ''>('');
  const resistance = ref('');
  const capacitance = ref('');
  const inductance = ref('');
  const impedance = ref('');
  const impedanceFrequency = ref('');
  const frequency = ref('');
  const packageCode = ref('');
  const tolerance = ref('');
  const voltage = ref('');
  const current = ref('');
  const power = ref('');
  const dielectric = ref('');
  const color = ref('');
  const pinCount = ref('');
  const pitch = ref('');
  const rowCount = ref('');
  const contactForm = ref('');
  const mountStyle = ref<'' | 'smd' | 'through-hole'>('');

  function guidanceTextValue(field: string): string {
    const value = props.context?.searchRequirementGuidance?.values[field];
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
  }

  function payloadTextValue(...keys: string[]): string {
    const payload = props.context?.extraction?.payload;
    if (payload === undefined) return '';
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return '';
  }

  function inferredComponentType(): RequirementComponentType | null {
    const stored = props.context?.searchRequirements;
    if (stored !== null && stored !== undefined) return stored.componentType;
    const engineType = props.context?.searchRequirementGuidance?.componentType;
    if (engineType !== null && engineType !== undefined) return engineType;
    const payload = props.context?.extraction?.payload;
    const payloadType = typeof payload?.component_type === 'string' ? payload.component_type : originalFieldValue('part_type');
    const normalized = payloadType.toLocaleLowerCase('en-US');
    if (normalized.includes('resistor') || normalized.includes('저항')) return 'resistor';
    if (
      normalized.includes('capacitor') ||
      normalized.includes('capacit') ||
      normalized.includes('커패시터') ||
      normalized.includes('콘덴서')
    ) {
      return 'capacitor';
    }
    if (
      normalized.includes('inductor') ||
      normalized.includes('ferrite') ||
      normalized.includes('인덕터') ||
      normalized.includes('비드')
    ) {
      return 'inductor';
    }
    if (normalized.includes('transistor') || /\b(?:mosfet|fet)\b/.test(normalized) || normalized.includes('트랜지스터')) {
      return 'transistor';
    }
    if (normalized.includes('led') || normalized.includes('발광다이오드')) return 'led';
    if (normalized.includes('diode') || normalized.includes('다이오드')) return 'diode';
    if (
      normalized.includes('crystal') ||
      normalized.includes('oscillator') ||
      normalized.includes('resonator') ||
      normalized.includes('크리스털') ||
      normalized.includes('발진기')
    ) {
      return 'crystal';
    }
    if (
      normalized.includes('connector') ||
      normalized.includes('header') ||
      normalized.includes('socket') ||
      normalized.includes('커넥터')
    ) {
      return 'connector';
    }
    if (normalized.includes('switch') || normalized.includes('스위치')) return 'switch';
    return null;
  }

  function clearAll(): void {
    capacitorType.value = '';
    inductorType.value = '';
    diodeType.value = '';
    transistorType.value = '';
    transistorPolarity.value = '';
    crystalType.value = '';
    connectorGender.value = '';
    connectorOrientation.value = '';
    switchType.value = '';
    resistance.value = '';
    capacitance.value = '';
    inductance.value = '';
    impedance.value = '';
    impedanceFrequency.value = '';
    frequency.value = '';
    tolerance.value = '';
    voltage.value = '';
    current.value = '';
    power.value = '';
    dielectric.value = '';
    color.value = '';
    pinCount.value = '';
    pitch.value = '';
    rowCount.value = '';
    contactForm.value = '';
  }

  function reset(): void {
    const context = props.context;
    const stored = context?.searchRequirements;
    const type = inferredComponentType();
    componentType.value = type;
    clearAll();

    const extractedPackage = originalFieldValue('package');
    const guidedPackage = guidanceTextValue('packageCode');
    packageCode.value =
      stored?.packageCode ??
      (guidedPackage !== '' ? guidedPackage : extractedPackage === '' ? (context?.originalPackageCode ?? '') : extractedPackage);
    const evidenceText = JSON.stringify(context?.extraction?.payload ?? {});
    const mountText = `${originalFieldValue('package')} ${originalFieldValue('footprint')} ${evidenceText}`;
    mountStyle.value =
      stored?.mountStyle ??
      (/\b(?:THT|THROUGH[ -]?HOLE|DIP)\b/i.test(mountText) ? 'through-hole' : /\b(?:SMD|SMT)\b/i.test(mountText) ? 'smd' : '');

    if (stored !== null && stored !== undefined) {
      switch (stored.componentType) {
        case 'resistor':
          resistance.value = stored.resistance;
          tolerance.value = stored.tolerance ?? '';
          voltage.value = stored.voltage ?? (guidanceTextValue('voltage') || originalFieldValue('voltage'));
          power.value = stored.power ?? '';
          break;
        case 'capacitor':
          capacitorType.value = stored.capacitorType;
          capacitance.value = stored.capacitance;
          tolerance.value = stored.tolerance ?? '';
          voltage.value = stored.voltage ?? '';
          dielectric.value = stored.dielectric ?? '';
          break;
        case 'inductor':
          inductorType.value = stored.inductorType;
          inductance.value = stored.inductance ?? '';
          impedance.value = stored.impedance ?? '';
          impedanceFrequency.value = stored.impedanceFrequency ?? '';
          tolerance.value = stored.tolerance ?? '';
          current.value = stored.current ?? '';
          break;
        case 'diode':
          diodeType.value = stored.diodeType;
          voltage.value = stored.voltage ?? '';
          current.value = stored.current ?? '';
          power.value = stored.power ?? '';
          break;
        case 'transistor':
          transistorType.value = stored.transistorType;
          transistorPolarity.value = stored.polarity;
          voltage.value = stored.voltage ?? '';
          current.value = stored.current ?? '';
          power.value = stored.power ?? '';
          break;
        case 'led':
          color.value = stored.color;
          voltage.value = stored.voltage ?? '';
          current.value = stored.current ?? '';
          break;
        case 'crystal':
          crystalType.value = stored.crystalType;
          frequency.value = stored.frequency;
          tolerance.value = stored.tolerance ?? '';
          break;
        case 'connector':
          pinCount.value = String(stored.pinCount);
          pitch.value = stored.pitch;
          rowCount.value = stored.rowCount === null ? '' : String(stored.rowCount);
          connectorGender.value = stored.gender ?? '';
          connectorOrientation.value = stored.orientation ?? '';
          break;
        case 'switch':
          switchType.value = stored.switchType;
          contactForm.value = stored.contactForm ?? '';
          voltage.value = stored.voltage ?? '';
          current.value = stored.current ?? '';
          break;
      }
      return;
    }

    const has = (...types: RequirementComponentType[]): boolean => type !== null && types.includes(type);
    const guidedOr = (field: string, originalKey = field): string =>
      guidanceTextValue(field) || originalFieldValue(originalKey);

    resistance.value = has('resistor') ? guidedOr('resistance') : '';
    capacitance.value = has('capacitor') ? guidedOr('capacitance') : '';
    inductance.value = has('inductor') ? guidedOr('inductance') : '';
    frequency.value = has('crystal') ? guidedOr('frequency') : '';
    tolerance.value = has('resistor', 'capacitor', 'inductor', 'crystal') ? guidedOr('tolerance') : '';
    voltage.value = has('resistor', 'capacitor', 'diode', 'transistor', 'led', 'switch') ? guidedOr('voltage') : '';
    current.value = has('inductor', 'diode', 'transistor', 'led', 'switch') ? guidedOr('current') : '';
    power.value = has('resistor', 'diode', 'transistor') ? guidedOr('power') : '';
    dielectric.value = has('capacitor')
      ? guidanceTextValue('dielectric') || (/\b(?:C0G|NP0|X5R|X7R|X8R|Y5V)\b/i.exec(evidenceText)?.[0]?.toUpperCase() ?? '')
      : '';
    if (has('capacitor')) {
      capacitorType.value =
        pick(guidanceTextValue('capacitorType'), ['ceramic', 'electrolytic', 'tantalum', 'film'] as const) ??
        inferCapacitorType(evidenceText, dielectric.value);
    }
    if (has('inductor')) {
      inductorType.value =
        pick(guidanceTextValue('inductorType'), ['standard', 'ferrite'] as const) ??
        (/\b(?:ferrite|bead)\b|비드/i.test(evidenceText) ? 'ferrite' : 'standard');
      impedance.value = guidanceTextValue('impedance') || payloadTextValue('impedance_ohm');
      impedanceFrequency.value = guidanceTextValue('impedanceFrequency') || payloadTextValue('impedance_frequency_hz');
    }
    if (has('diode')) {
      diodeType.value =
        pick(guidanceTextValue('diodeType'), ['rectifier', 'signal', 'schottky', 'zener', 'tvs', 'photodiode'] as const) ??
        (/\btvs\b/i.test(evidenceText)
          ? 'tvs'
          : /\bzener\b|제너/i.test(evidenceText)
            ? 'zener'
            : /\bschottky\b|쇼트키/i.test(evidenceText)
              ? 'schottky'
              : /\bphoto ?diode\b|포토다이오드/i.test(evidenceText)
                ? 'photodiode'
                : /\bsignal\b/i.test(evidenceText)
                  ? 'signal'
                  : /\brectifier\b|정류/i.test(evidenceText)
                    ? 'rectifier'
                    : '');
    }
    if (has('transistor')) {
      transistorType.value =
        pick(guidanceTextValue('transistorType'), ['bjt', 'mosfet'] as const) ??
        (/\b(?:mosfet|fet)\b/i.test(evidenceText) ? 'mosfet' : /\bbjt\b|\btransistor\b|트랜지스터/i.test(evidenceText) ? 'bjt' : '');
      transistorPolarity.value =
        pick(guidanceTextValue('polarity'), ['npn', 'pnp', 'n-channel', 'p-channel'] as const) ??
        (/\bp[- ]?channel\b/i.test(evidenceText)
          ? 'p-channel'
          : /\bn[- ]?channel\b/i.test(evidenceText)
            ? 'n-channel'
            : /\bpnp\b/i.test(evidenceText)
              ? 'pnp'
              : /\bnpn\b/i.test(evidenceText)
                ? 'npn'
                : '');
    }
    color.value = has('led')
      ? guidanceTextValue('color') ||
        payloadTextValue('color') ||
        (/\b(?:red|green|blue|yellow|orange|white|amber)\b/i.exec(evidenceText)?.[0] ?? '')
      : '';
    if (has('crystal')) {
      crystalType.value =
        pick(guidanceTextValue('crystalType'), ['crystal', 'oscillator', 'resonator'] as const) ??
        (/\boscillator\b|발진기/i.test(evidenceText) ? 'oscillator' : /\bresonator\b|공진기/i.test(evidenceText) ? 'resonator' : 'crystal');
    }
    if (has('connector')) {
      pinCount.value = guidanceTextValue('pinCount') || payloadTextValue('pin_count');
      pitch.value = guidanceTextValue('pitch') || payloadTextValue('pitch_mm');
      rowCount.value = guidanceTextValue('rowCount') || payloadTextValue('row_count');
    }
    if (has('switch')) {
      switchType.value =
        pick(guidanceTextValue('switchType'), ['tactile', 'pushbutton', 'slide', 'toggle', 'dip', 'rotary', 'reed', 'other'] as const) ??
        '';
    }
  }

  const visible = computed(() => componentType.value !== null);
  const componentLabel = computed(() => (componentType.value === null ? '' : COMPONENT_LABELS[componentType.value]));
  const engineReadiness = computed(() => props.context?.searchRequirementGuidance?.readiness ?? null);
  const engineSearchExcluded = computed(() => engineReadiness.value === 'excluded');
  const engineMissingLabels = computed(() =>
    (props.context?.searchRequirementGuidance?.missingFields ?? []).map((field) => MISSING_FIELD_LABELS[field] ?? field),
  );

  const valid = computed(() => {
    const type = componentType.value;
    if (type === null) return false;
    const packaged = packageCode.value.trim() !== '';
    switch (type) {
      case 'resistor':
        return packaged && resistance.value.trim() !== '';
      case 'capacitor':
        return packaged && capacitance.value.trim() !== '' && capacitorType.value !== '';
      case 'inductor':
        return packaged && inductorType.value !== '';
      case 'diode':
        return packaged && diodeType.value !== '';
      case 'transistor':
        return packaged && transistorType.value !== '' && transistorPolarity.value !== '';
      case 'led':
        return packaged && color.value.trim() !== '';
      case 'crystal':
        return packaged && crystalType.value !== '' && frequency.value.trim() !== '';
      case 'connector':
        return Number.isInteger(Number(pinCount.value)) && Number(pinCount.value) > 0 && pitch.value.trim() !== '';
      case 'switch':
        return packaged && switchType.value !== '';
    }
  });

  function submit(): void {
    const type = componentType.value;
    if (props.interactionLocked || !valid.value || type === null) return;
    const physical = { mountStyle: mountStyle.value === '' ? null : mountStyle.value };
    const packaged = { ...physical, packageCode: packageCode.value.trim() };
    switch (type) {
      case 'resistor':
        emit('searchRequirements', {
          ...packaged,
          componentType: type,
          resistance: resistance.value.trim(),
          tolerance: nullableRequirement(tolerance.value),
          voltage: nullableRequirement(voltage.value),
          power: nullableRequirement(power.value),
        });
        break;
      case 'capacitor':
        if (capacitorType.value === '') return;
        emit('searchRequirements', {
          ...packaged,
          componentType: type,
          capacitorType: capacitorType.value,
          capacitance: capacitance.value.trim(),
          tolerance: nullableRequirement(tolerance.value),
          voltage: nullableRequirement(voltage.value),
          dielectric: capacitorType.value === 'ceramic' ? nullableRequirement(dielectric.value) : null,
        });
        break;
      case 'inductor':
        if (inductorType.value === '') return;
        emit('searchRequirements', {
          ...packaged,
          componentType: type,
          inductorType: inductorType.value,
          inductance: inductorType.value === 'standard' ? nullableRequirement(inductance.value) : null,
          impedance: inductorType.value === 'ferrite' ? nullableRequirement(impedance.value) : null,
          impedanceFrequency: inductorType.value === 'ferrite' ? nullableRequirement(impedanceFrequency.value) : null,
          current: nullableRequirement(current.value),
          tolerance: nullableRequirement(tolerance.value),
        });
        break;
      case 'diode':
        if (diodeType.value === '') return;
        emit('searchRequirements', {
          ...packaged,
          componentType: type,
          diodeType: diodeType.value,
          voltage: nullableRequirement(voltage.value),
          current: nullableRequirement(current.value),
          power: nullableRequirement(power.value),
        });
        break;
      case 'transistor':
        if (transistorType.value === '' || transistorPolarity.value === '') return;
        emit('searchRequirements', {
          ...packaged,
          componentType: type,
          transistorType: transistorType.value,
          polarity: transistorPolarity.value,
          voltage: nullableRequirement(voltage.value),
          current: nullableRequirement(current.value),
          power: nullableRequirement(power.value),
        });
        break;
      case 'led':
        emit('searchRequirements', {
          ...packaged,
          componentType: type,
          color: color.value.trim(),
          voltage: nullableRequirement(voltage.value),
          current: nullableRequirement(current.value),
        });
        break;
      case 'crystal':
        if (crystalType.value === '') return;
        emit('searchRequirements', {
          ...packaged,
          componentType: type,
          crystalType: crystalType.value,
          frequency: frequency.value.trim(),
          tolerance: nullableRequirement(tolerance.value),
        });
        break;
      case 'connector':
        emit('searchRequirements', {
          ...physical,
          componentType: type,
          packageCode: nullableRequirement(packageCode.value),
          pinCount: Number(pinCount.value),
          pitch: pitch.value.trim(),
          rowCount: rowCount.value.trim() === '' ? null : Number(rowCount.value),
          gender: connectorGender.value === '' ? null : connectorGender.value,
          orientation: connectorOrientation.value === '' ? null : connectorOrientation.value,
        });
        break;
      case 'switch':
        if (switchType.value === '') return;
        emit('searchRequirements', {
          ...packaged,
          componentType: type,
          switchType: switchType.value,
          contactForm: nullableRequirement(contactForm.value),
          voltage: nullableRequirement(voltage.value),
          current: nullableRequirement(current.value),
        });
        break;
    }
  }

  return {
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
    visible,
    componentLabel,
    engineReadiness,
    engineSearchExcluded,
    engineMissingLabels,
    valid,
    reset,
    submit,
  };
}

export type RequirementsForm = ReturnType<typeof useRequirementsForm>;
