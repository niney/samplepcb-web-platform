import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BomAnalysisContractError,
  BomEngineAnalysisComponentStrict,
  bomEngineComponentId,
  parseBomEngineAnalysisResult,
} from './bom-analysis';

function engineResult() {
  return {
    schema_version: '1.0',
    engine: 'smartbom',
    model: null,
    prompt_version: null,
    parser_version: 'smartbom-rules/1.0',
    source_file: 'unit.xlsx',
    summary: { parser_version: 'smartbom-rules/1.0', component_count: 1 },
    sheets: [{
      sheet_index_0based: 0,
      sheet_name: 'BOM',
      status: 'parsed',
      component_count: 1,
      column_count: 6,
      header_rows_1based: [1],
      header_labels: ['Part Number', 'Value', 'Package', 'Qty', 'Reference', 'Manufacturer'],
      warnings: [],
      unparsed_reason: null,
      future_sheet_field: 'preserve-me',
    }],
    components: [{
      source_file: 'unit.xlsx',
      sheet_name: 'BOM',
      sheet_index_0based: 0,
      source_rows_1based: [2],
      component_type: 'resistor',
      part_number: 'RC0603FR-0710KL',
      manufacturer: 'YAGEO',
      description: 'Chip resistor',
      quantity: 2,
      reference_designators: ['R1', 'R2'],
      package: '0603',
      footprint: 'R_0603_1608Metric',
      value_raw: '10K OHM 1% 1/10W',
      raw_fields: {
        part_number: 'RC0603FR-0710KL',
        part_type: 'resistor',
        resistance: '10K OHM',
        power: '1/10W',
        tolerance: '1%',
        package: '0603',
        manufacturer: 'YAGEO',
        quantity: 2,
      },
      field_states: {
        resistance: {
          value: '10K OHM',
          status: 'extracted',
          source: 'text',
          evidence: [{ cell: 'B2', raw_value: '10K OHM 1% 1/10W', supports: 'resistance' }],
          future_state_field: 'preserve-me',
        },
      },
      evidence: [{ cell: 'A2', raw_value: 'RC0603FR-0710KL', supports: 'part_number' }],
      uncertain_fields: [],
      quality_flags: [],
      review_status: 'extracted',
      resistance_ohm: 10_000,
      capacitance_f: null,
      inductance_h: null,
      power_w: 0.1,
      tolerance_percent: 1,
      voltage_v: null,
      current_a: null,
      frequency_hz: null,
      temperature_min_c: null,
      temperature_max_c: null,
      size_code: '0603',
      attributes: [{
        name: 'resistance',
        raw_value: '10K OHM',
        normalized_value: 10_000,
        unit: 'Ω',
        evidence: [{ cell: 'B2', raw_value: '10K OHM 1% 1/10W', supports: 'resistance' }],
        future_attribute_field: 'preserve-me',
      }],
      evidence_exact_rate: 1,
      part_number_supported: true,
      confidence: 0.9,
      future_component_field: { nested: true },
    }],
    headers: [],
    failures: [],
    future_result_field: 'preserve-me',
  };
}

describe('BOM 분석 영속 계약', () => {
  it('Python 실제 출력 fixture를 strict 파싱해 엔진 계약 드리프트를 감지한다', () => {
    const fixtureUrl = new URL(
      '../../../../../samplepcb-parts-engine/contracts/fixtures/component-record.json',
      import.meta.url,
    );
    const fixture: unknown = JSON.parse(readFileSync(fixtureUrl, 'utf8'));

    const parsed = BomEngineAnalysisComponentStrict.parse(fixture);

    expect(parsed).toEqual(fixture);
    expect(parsed.quantity_resolution).toBe('verified');
    expect(parsed.procurement_disposition).toBe('eligible');
    expect(parsed.input_alternatives).toEqual({});

    const withPartNumberLineage = BomEngineAnalysisComponentStrict.parse({
      ...parsed,
      input_alternatives: {
        part_number: [
          {
            raw_value: 'MF-MSMF050-2',
            normalized_value: 'MFMSMF0502',
            source_cell: 'A2',
            source_role: 'part_number',
          },
          {
            raw_value: 'ERA-6ARW104V',
            normalized_value: 'ERA6ARW104V',
            source_cell: 'B2',
            source_role: 'library_reference',
          },
        ],
      },
    });
    expect(withPartNumberLineage.input_alternatives?.part_number?.map((item) => item.source_role))
      .toEqual(['part_number', 'library_reference']);
  });

  it('필수 구조를 검증하면서 새 엔진 필드를 모든 계층에서 보존한다', () => {
    const parsed = parseBomEngineAnalysisResult(engineResult());

    expect(parsed.future_result_field).toBe('preserve-me');
    expect(parsed.sheets[0]?.future_sheet_field).toBe('preserve-me');
    expect(parsed.components[0]?.future_component_field).toEqual({ nested: true });
    expect(parsed.components[0]?.field_states.resistance?.future_state_field).toBe('preserve-me');
    expect(parsed.components[0]?.attributes[0]?.future_attribute_field).toBe('preserve-me');
  });

  it('컴포넌트 위치 계약이 깨지면 부분 저장 전에 거부한다', () => {
    const result = engineResult();
    const component = result.components[0];
    if (component === undefined) throw new Error('test fixture invariant');
    component.source_rows_1based = [];

    expect(() => parseBomEngineAnalysisResult(result)).toThrow(BomAnalysisContractError);
  });

  it('파일·시트·원본 행 조합으로 결정적인 엔진 컴포넌트 ID를 만든다', () => {
    const first = bomEngineComponentId('unit.xlsx', 0, [2]);

    expect(first).toMatch(/^[a-f0-9]{24}$/);
    expect(bomEngineComponentId('unit.xlsx', 0, [2])).toBe(first);
    expect(bomEngineComponentId('unit.xlsx', 1, [2])).not.toBe(first);
  });
});
