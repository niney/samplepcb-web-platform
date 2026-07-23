export type ExtractionCertainty = 'verified' | 'inferred' | 'review' | 'unknown';

export interface ExtractionDisplayField {
  key: string;
  label: string;
  value: string;
  normalizedValue: string | null;
  provenance: string;
  certainty: ExtractionCertainty;
  evidenceCells: string[];
  wide: boolean;
}

export interface ExtractionDisplaySummary {
  extracted: number;
  verified: number;
  inferred: number;
  review: number;
}

const FIELD_LABELS: Record<string, string> = {
  part_number: '원본 MPN',
  manufacturer: '제조사',
  part_type: '부품 종류',
  package: '패키지 / 크기',
  footprint: '풋프린트',
  description: '설명',
  value_raw: '원본 값',
  quantity: 'BOM 수량',
  reference_designators: 'REFDES',
  resistance: '저항',
  capacitance: '정전용량',
  inductance: '인덕턴스',
  power: '정격 전력',
  tolerance: '허용오차',
  voltage: '정격 전압',
  current: '정격 전류',
  frequency: '주파수',
  temperature: '동작 온도',
  size_code: '사이즈 코드',
};

const ALERT_LABELS: Record<string, string> = {
  row_shape_recovered: 'CSV 행 구조 복구됨',
  row_shape_invalid: 'CSV 행 구조 확인 필요',
};

const FIELD_ORDER = [
  'part_number',
  'manufacturer',
  'part_type',
  'value_raw',
  'package',
  'footprint',
  'description',
  'resistance',
  'capacitance',
  'inductance',
  'power',
  'tolerance',
  'voltage',
  'current',
  'frequency',
  'temperature',
  'size_code',
  'reference_designators',
  'quantity',
];

const DIRECT_KEYS: Record<string, string> = {
  part_number: 'part_number',
  manufacturer: 'manufacturer',
  part_type: 'component_type',
  package: 'package',
  footprint: 'footprint',
  description: 'description',
  value_raw: 'value_raw',
  quantity: 'quantity',
  reference_designators: 'reference_designators',
  size_code: 'size_code',
};

const NORMALIZED_KEYS: Record<string, { keys: string[]; unit: string }> = {
  resistance: { keys: ['resistance_ohm'], unit: 'Ω' },
  capacitance: { keys: ['capacitance_f'], unit: 'F' },
  inductance: { keys: ['inductance_h'], unit: 'H' },
  power: { keys: ['power_w'], unit: 'W' },
  tolerance: { keys: ['tolerance_percent'], unit: '%' },
  voltage: { keys: ['voltage_v'], unit: 'V' },
  current: { keys: ['current_a'], unit: 'A' },
  frequency: { keys: ['frequency_hz'], unit: 'Hz' },
  temperature: { keys: ['temperature_min_c', 'temperature_max_c'], unit: '°C' },
};

export function asExtractionRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function displayValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    const values = value.flatMap((entry) => displayValue(entry) ?? []);
    return values.length === 0 ? null : values.join(', ');
  }
  if (typeof value === 'number') return value.toLocaleString('ko-KR', { maximumSignificantDigits: 8 });
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'bigint') return value.toString();
  return null;
}

function scaled(value: number, unit: string): string {
  const scales: Record<string, { limit: number; symbol: string }[]> = {
    'Ω': [
      { limit: 1e6, symbol: 'MΩ' },
      { limit: 1e3, symbol: 'kΩ' },
      { limit: 1, symbol: 'Ω' },
      { limit: 1e-3, symbol: 'mΩ' },
    ],
    F: [
      { limit: 1e-3, symbol: 'mF' },
      { limit: 1e-6, symbol: 'µF' },
      { limit: 1e-9, symbol: 'nF' },
      { limit: 1e-12, symbol: 'pF' },
    ],
    H: [
      { limit: 1, symbol: 'H' },
      { limit: 1e-3, symbol: 'mH' },
      { limit: 1e-6, symbol: 'µH' },
      { limit: 1e-9, symbol: 'nH' },
    ],
    W: [
      { limit: 1, symbol: 'W' },
      { limit: 1e-3, symbol: 'mW' },
      { limit: 1e-6, symbol: 'µW' },
    ],
    A: [
      { limit: 1, symbol: 'A' },
      { limit: 1e-3, symbol: 'mA' },
      { limit: 1e-6, symbol: 'µA' },
    ],
    Hz: [
      { limit: 1e9, symbol: 'GHz' },
      { limit: 1e6, symbol: 'MHz' },
      { limit: 1e3, symbol: 'kHz' },
      { limit: 1, symbol: 'Hz' },
    ],
  };
  const absolute = Math.abs(value);
  const scale = scales[unit]?.find((candidate) => absolute >= candidate.limit);
  if (scale === undefined) return `${value.toLocaleString('ko-KR', { maximumSignificantDigits: 6 })} ${unit}`;
  return `${(value / scale.limit).toLocaleString('ko-KR', { maximumSignificantDigits: 6 })} ${scale.symbol}`;
}

function normalizedDisplay(payload: Record<string, unknown>, key: string, attribute: Record<string, unknown> | null): string | null {
  const config = NORMALIZED_KEYS[key];
  const attributeValue = attribute?.normalized_value;
  const attributeUnit = typeof attribute?.unit === 'string' ? attribute.unit : config?.unit;
  if (typeof attributeValue === 'number' && attributeUnit !== undefined) return scaled(attributeValue, attributeUnit);
  if (attributeValue !== null && attributeValue !== undefined) return displayValue(attributeValue);
  if (config === undefined) return null;
  const values = config.keys.map((normalizedKey) => payload[normalizedKey]);
  const numeric = values.filter((value): value is number => typeof value === 'number');
  if (numeric.length === 0) return null;
  if (config.keys.length === 2) {
    if (numeric.length === 2) return `${scaled(numeric[0] ?? 0, config.unit)} ~ ${scaled(numeric[1] ?? 0, config.unit)}`;
    return scaled(numeric[0] ?? 0, config.unit);
  }
  return scaled(numeric[0] ?? 0, config.unit);
}

function evidenceCells(state: Record<string, unknown> | null, attribute: Record<string, unknown> | null): string[] {
  const evidence = Array.isArray(state?.evidence)
    ? state.evidence
    : Array.isArray(attribute?.evidence)
      ? attribute.evidence
      : [];
  return [...new Set(evidence.flatMap((entry) => {
    const record = asExtractionRecord(entry);
    return typeof record?.cell === 'string' && record.cell !== '' ? [record.cell] : [];
  }))];
}

function certainty(state: Record<string, unknown> | null): Pick<ExtractionDisplayField, 'certainty' | 'provenance'> {
  if (state?.status === 'review') return { certainty: 'review', provenance: '검토 필요' };
  if (state?.status !== 'extracted') return { certainty: 'unknown', provenance: '엔진 추출' };
  if (state.source === 'col') return { certainty: 'verified', provenance: '근거 셀 확인' };
  if (state.source === 'text') return { certainty: 'verified', provenance: '원문 해석' };
  if (state.source === 'infer') return { certainty: 'inferred', provenance: '규칙 추론' };
  return { certainty: 'unknown', provenance: '근거 유형 미상' };
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replaceAll('_', ' ');
}

/** null/not_found를 제외하고 엔진이 실제로 추출한 모든 값을 원문 우선으로 한 번씩 반환한다. */
export function extractionDisplayFields(payload: Record<string, unknown>): ExtractionDisplayField[] {
  const states = asExtractionRecord(payload.field_states) ?? {};
  const rawFields = asExtractionRecord(payload.raw_fields) ?? {};
  const attributes: Record<string, unknown>[] = Array.isArray(payload.attributes)
    ? payload.attributes
        .map(asExtractionRecord)
        .filter((value): value is Record<string, unknown> => value !== null)
    : [];
  const attributeByName = new Map<string, Record<string, unknown>>(attributes.flatMap((attribute) =>
    typeof attribute.name === 'string' ? [[attribute.name, attribute] as const] : [],
  ));
  const keys = new Set<string>([
    ...FIELD_ORDER,
    ...Object.keys(states),
    ...Object.keys(rawFields),
    ...attributeByName.keys(),
  ]);
  for (const key of Object.keys(NORMALIZED_KEYS)) {
    if (NORMALIZED_KEYS[key]?.keys.some((normalizedKey) => payload[normalizedKey] !== null && payload[normalizedKey] !== undefined)) {
      keys.add(key);
    }
  }

  return [...keys].flatMap((key) => {
    const state = asExtractionRecord(states[key]);
    const attribute = attributeByName.get(key) ?? null;
    const directKey = DIRECT_KEYS[key];
    const raw = state?.value
      ?? attribute?.raw_value
      ?? rawFields[key]
      ?? (directKey === undefined ? undefined : payload[directKey]);
    const normalized = normalizedDisplay(payload, key, attribute);
    const rawDisplay = displayValue(raw);
    const primary = rawDisplay ?? normalized;
    if (primary === null) return [];
    const extraction = certainty(state);
    return [{
      key,
      label: fieldLabel(key),
      value: primary,
      normalizedValue: rawDisplay !== null && normalized !== null && normalized !== rawDisplay ? normalized : null,
      provenance: extraction.provenance,
      certainty: extraction.certainty,
      evidenceCells: evidenceCells(state, attribute),
      wide: key === 'description' || key === 'footprint' || key === 'reference_designators',
    }];
  }).sort((left, right) => {
    const leftIndex = FIELD_ORDER.indexOf(left.key);
    const rightIndex = FIELD_ORDER.indexOf(right.key);
    return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || left.key.localeCompare(right.key);
  });
}

export function extractionDisplaySummary(fields: readonly ExtractionDisplayField[]): ExtractionDisplaySummary {
  return fields.reduce<ExtractionDisplaySummary>((summary, field) => ({
    extracted: summary.extracted + 1,
    verified: summary.verified + (field.certainty === 'verified' ? 1 : 0),
    inferred: summary.inferred + (field.certainty === 'inferred' ? 1 : 0),
    review: summary.review + (field.certainty === 'review' ? 1 : 0),
  }), { extracted: 0, verified: 0, inferred: 0, review: 0 });
}

export function extractionAlerts(payload: Record<string, unknown>): string[] {
  return [...new Set(['uncertain_fields', 'quality_flags'].flatMap((key) => {
    const values = payload[key];
    return Array.isArray(values)
      ? values
          .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
          .map((value) => ALERT_LABELS[value] ?? value)
      : [];
  }))];
}
