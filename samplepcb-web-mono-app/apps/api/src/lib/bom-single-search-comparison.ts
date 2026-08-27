import { Prisma } from '@prisma/client';
import { normalizeMpn } from '@sp/utils';
import {
  BomEngineAnalysisResult,
  bomEngineComponentId,
  type BomEngineAnalysisResultType,
} from './bom-analysis';
import { prisma } from './prisma';

const SINGLE_SEARCH_COMPARISON_PARSER_VERSION = 'single-search-comparison/1.0';
const SINGLE_SEARCH_COMPARISON_SHEET_NAME = '단일검색';
const ANALYSIS_COMPONENT_INSERT_BATCH_SIZE = 20;

interface SingleSearchComparisonItem {
  id: bigint;
  rowIdx: number;
  included: boolean;
  mpn: string;
  manufacturerName: string | null;
  description: string | null;
  bomQty: number;
  selectionSource: string;
  sourceRow: Prisma.JsonValue;
}

export interface SingleSearchComparisonTarget {
  itemId: string;
  rowIdx: number;
  componentId: string;
  partNumber: string;
  manufacturer: string | null;
}

export interface SingleSearchComparisonAnalysisPlan {
  sourceFile: string;
  analysis: BomEngineAnalysisResultType;
  targets: SingleSearchComparisonTarget[];
}

function jsonRecord(value: Prisma.JsonValue): Prisma.JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function sourceFileFor(quoteId: bigint): string {
  return `single-search-quote-${String(quoteId)}`;
}

function sourceRowNumber(rowIdx: number): number {
  return rowIdx + 2;
}

function comparisonComponentId(quoteId: bigint, rowIdx: number): string {
  return bomEngineComponentId(sourceFileFor(quoteId), 0, [sourceRowNumber(rowIdx)]);
}

function manufacturerOf(item: SingleSearchComparisonItem): string | null {
  const manufacturer = item.manufacturerName?.trim();
  return manufacturer === undefined || manufacturer === '' ? null : manufacturer;
}

/** 단일검색에서 사람이 명시적으로 고른 협력사 보유 행만 최초 비교 진입점으로 인정한다. */
export function singleSearchPartnerComparisonTarget(
  quoteId: bigint,
  item: SingleSearchComparisonItem,
): SingleSearchComparisonTarget | null {
  const sourceRow = jsonRecord(item.sourceRow);
  if (
    !item.included
    || item.selectionSource !== 'partner'
    || sourceRow?.singleSearch !== true
    || normalizeMpn(item.mpn) === ''
  ) {
    return null;
  }
  return {
    itemId: String(item.id),
    rowIdx: item.rowIdx,
    componentId: comparisonComponentId(quoteId, item.rowIdx),
    partNumber: item.mpn.trim(),
    manufacturer: manufacturerOf(item),
  };
}

function singleSearchAnalysisTarget(
  quoteId: bigint,
  item: SingleSearchComparisonItem,
): SingleSearchComparisonTarget | null {
  const sourceRow = jsonRecord(item.sourceRow);
  if (!item.included || sourceRow?.singleSearch !== true || normalizeMpn(item.mpn) === '') {
    return null;
  }
  return {
    itemId: String(item.id),
    rowIdx: item.rowIdx,
    componentId: comparisonComponentId(quoteId, item.rowIdx),
    partNumber: item.mpn.trim(),
    manufacturer: manufacturerOf(item),
  };
}

/**
 * 파일 분석이 없는 단일검색 견적을 기존 supplier-job 계약에 태우는 최소 분석 스냅샷.
 * 품번·제조사·수량은 사용자가 고른 카탈로그 정체성을 옮길 뿐이고, exact 관계와
 * 구매 가능 판단은 이후 sp-engine이 소유한다.
 */
export function buildSingleSearchComparisonAnalysis(
  quoteId: bigint,
  items: readonly SingleSearchComparisonItem[],
): SingleSearchComparisonAnalysisPlan {
  const sourceFile = sourceFileFor(quoteId);
  const targetRows = items
    .flatMap((item) => {
      const target = singleSearchAnalysisTarget(quoteId, item);
      return target === null ? [] : [{ item, target }];
    })
    .sort((left, right) => left.target.rowIdx - right.target.rowIdx);
  const analysis = BomEngineAnalysisResult.parse({
    schema_version: '1.0',
    engine: 'smartbom',
    model: null,
    prompt_version: null,
    parser_version: SINGLE_SEARCH_COMPARISON_PARSER_VERSION,
    source_file: sourceFile,
    summary: {
      parser_version: SINGLE_SEARCH_COMPARISON_PARSER_VERSION,
      component_count: targetRows.length,
      source_kind: 'single_search',
    },
    sheets: [{
      sheet_index_0based: 0,
      sheet_name: SINGLE_SEARCH_COMPARISON_SHEET_NAME,
      status: 'parsed',
      component_count: targetRows.length,
      column_count: 4,
      header_rows_1based: [1],
      header_labels: ['Part Number', 'Manufacturer', 'Description', 'Qty'],
      warnings: [],
      unparsed_reason: null,
    }],
    components: targetRows.map(({ item, target }) => {
      const manufacturerState = target.manufacturer === null
        ? {}
        : {
            manufacturer: {
              value: target.manufacturer,
              status: 'extracted' as const,
              evidence: [],
              source: 'col' as const,
            },
          };
      return {
        source_file: sourceFile,
        sheet_name: SINGLE_SEARCH_COMPARISON_SHEET_NAME,
        sheet_index_0based: 0,
        source_rows_1based: [sourceRowNumber(target.rowIdx)],
        component_type: null,
        part_number: target.partNumber,
        supplier_part_numbers: [],
        internal_part_numbers: [],
        library_identifiers: [],
        manufacturer: target.manufacturer,
        description: item.description,
        quantity: item.bomQty,
        reference_count: 0,
        quantity_resolution: 'verified' as const,
        search_disposition: 'search' as const,
        procurement_disposition: 'eligible' as const,
        disposition_reason_codes: [],
        reference_designators: [],
        package: null,
        footprint: null,
        value_raw: target.partNumber,
        raw_fields: {
          part_number: target.partNumber,
          manufacturer: target.manufacturer,
          description: item.description,
          quantity: item.bomQty,
        },
        input_alternatives: {},
        field_states: {
          part_number: {
            value: target.partNumber,
            status: 'extracted' as const,
            evidence: [],
            source: 'col' as const,
          },
          ...manufacturerState,
          quantity: {
            value: item.bomQty,
            status: 'extracted' as const,
            evidence: [],
            source: 'col' as const,
          },
        },
        evidence: [],
        uncertain_fields: [],
        quality_flags: [],
        review_status: 'extracted' as const,
        resistance_ohm: null,
        capacitance_f: null,
        inductance_h: null,
        power_w: null,
        tolerance_percent: null,
        absolute_tolerance_h: null,
        impedance_ohm: null,
        impedance_frequency_hz: null,
        dc_resistance_max_ohm: null,
        color: null,
        pin_count: null,
        row_count: null,
        pitch_mm: null,
        body_dimensions_mm: null,
        row_shape: null,
        voltage_v: null,
        current_a: null,
        frequency_hz: null,
        temperature_min_c: null,
        temperature_max_c: null,
        size_code: null,
        attributes: [],
        evidence_exact_rate: 1,
        part_number_supported: true,
        confidence: 1,
      };
    }),
    headers: [],
    failures: [],
  });
  return { sourceFile, analysis, targets: targetRows.map(({ target }) => target) };
}

function sourceRowWithComparisonTarget(
  sourceRow: Prisma.JsonValue,
  target: SingleSearchComparisonTarget,
): Prisma.InputJsonValue {
  return inputJson({
    ...(jsonRecord(sourceRow) ?? {}),
    componentId: target.componentId,
    inputPartNumber: target.partNumber,
    inputManufacturer: target.manufacturer,
    manualSupplierComparison: true,
  });
}

/** 단일검색 견적의 현재 행 구성을 append-only 분석 실행으로 박제하고 활성 포인터만 교체한다. */
export async function prepareSingleSearchComparisonAnalysis(quoteId: bigint): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      SELECT id FROM sp_bom_quote WHERE id = ${quoteId} FOR UPDATE
    `);
    if (locked.length === 0) return 0;
    const quote = await tx.spBomQuote.findUnique({
      where: { id: quoteId },
      include: {
        items: true,
        activeAnalysisRun: {
          select: {
            sourceFile: true,
            parserVersion: true,
            components: {
              select: { engineComponentId: true, partNumber: true, manufacturer: true },
            },
          },
        },
      },
    });
    if (quote?.sourceKind !== 'single_search') return 0;

    const plan = buildSingleSearchComparisonAnalysis(quoteId, quote.items);
    if (plan.targets.length === 0) return 0;
    const targetByItemId = new Map(plan.targets.map((target) => [target.itemId, target] as const));
    const expectedComponents = new Map(plan.targets.map((target) => [
      target.componentId,
      `${normalizeMpn(target.partNumber)}\u0000${target.manufacturer?.trim().toLocaleLowerCase() ?? ''}`,
    ] as const));
    const currentComponents = new Map(
      (quote.activeAnalysisRun?.components ?? []).map((component) => [
        component.engineComponentId,
        `${normalizeMpn(component.partNumber ?? '')}\u0000${component.manufacturer?.trim().toLocaleLowerCase() ?? ''}`,
      ] as const),
    );
    const analysisCurrent = quote.activeAnalysisRun?.sourceFile === plan.sourceFile
      && quote.activeAnalysisRun.parserVersion === SINGLE_SEARCH_COMPARISON_PARSER_VERSION
      && expectedComponents.size === currentComponents.size
      && [...expectedComponents].every(([componentId, identity]) =>
        currentComponents.get(componentId) === identity);
    const sourceRowsCurrent = quote.items.every((item) => {
      const target = targetByItemId.get(String(item.id));
      if (target === undefined) return true;
      const sourceRow = jsonRecord(item.sourceRow);
      return sourceRow?.componentId === target.componentId
        && sourceRow.manualSupplierComparison === true;
    });
    if (analysisCurrent && sourceRowsCurrent) return plan.targets.length;

    let analysisRunId = quote.activeAnalysisRunId;
    if (!analysisCurrent) {
      const run = await tx.spBomAnalysisRun.create({
        data: {
          quoteId,
          engineJobId: null,
          engine: plan.analysis.engine,
          schemaVersion: plan.analysis.schema_version,
          parserVersion: plan.analysis.parser_version,
          sourceFile: plan.analysis.source_file,
          engineModel: null,
          promptVersion: null,
          status: 'completed',
          summary: inputJson(plan.analysis.summary),
          headers: inputJson(plan.analysis.headers),
          failures: inputJson(plan.analysis.failures),
          completedAt: new Date(),
        },
        select: { id: true },
      });
      const sheet = plan.analysis.sheets[0];
      if (sheet === undefined) throw new Error('SINGLE_SEARCH_COMPARISON_SHEET_MISSING');
      const storedSheet = await tx.spBomAnalysisSheet.create({
        data: {
          analysisRunId: run.id,
          sheetIndex: sheet.sheet_index_0based,
          sheetName: sheet.sheet_name,
          status: sheet.status,
          componentCount: sheet.component_count,
          columnCount: sheet.column_count,
          failureReason: null,
          payload: inputJson(sheet),
        },
        select: { id: true },
      });
      const componentRows: Prisma.SpBomAnalysisComponentCreateManyInput[] =
        plan.analysis.components.map((component, index) => {
          const target = plan.targets[index];
          if (target === undefined) throw new Error('SINGLE_SEARCH_COMPARISON_TARGET_MISSING');
          return {
            analysisRunId: run.id,
            analysisSheetId: storedSheet.id,
            engineComponentId: target.componentId,
            sourceRows: inputJson(component.source_rows_1based),
            referenceDesignators: inputJson(component.reference_designators),
            partNumber: target.partNumber,
            manufacturer: target.manufacturer,
            componentType: null,
            description: component.description ?? null,
            quantity: component.quantity ?? null,
            packageCode: null,
            reviewStatus: component.review_status,
            confidence: component.confidence ?? null,
            searchText: [target.partNumber, target.manufacturer].filter(Boolean).join(' '),
            payload: inputJson(component),
          };
        });
      for (
        let offset = 0;
        offset < componentRows.length;
        offset += ANALYSIS_COMPONENT_INSERT_BATCH_SIZE
      ) {
        await tx.spBomAnalysisComponent.createMany({
          data: componentRows.slice(offset, offset + ANALYSIS_COMPONENT_INSERT_BATCH_SIZE),
        });
      }
      analysisRunId = run.id;
    }
    if (analysisRunId === null) throw new Error('SINGLE_SEARCH_COMPARISON_ANALYSIS_MISSING');

    for (const item of quote.items) {
      const target = targetByItemId.get(String(item.id));
      if (target === undefined) continue;
      await tx.spBomQuoteItem.update({
        where: { id: item.id },
        data: { sourceRow: sourceRowWithComparisonTarget(item.sourceRow, target) },
      });
    }
    if (!analysisCurrent) {
      await tx.spBomQuote.update({
        where: { id: quoteId },
        data: { activeAnalysisRunId: analysisRunId },
      });
    }
    return plan.targets.length;
  }, { maxWait: 10_000, timeout: 60_000 });
}
