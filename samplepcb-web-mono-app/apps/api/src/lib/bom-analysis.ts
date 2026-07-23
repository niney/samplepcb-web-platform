import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { BomQuoteSheetType } from '@sp/api-contract';
import { prisma } from './prisma';

// sp-engine 런타임 수신 계약. 알려진 필수 구조와 타입은 검증하되 passthrough로
// 새 엔진 필드를 허용하고 payload에 원본 그대로 보존한다.
const EngineEvidence = z.object({
  cell: z.string(),
  raw_value: z.string(),
  supports: z.string(),
}).passthrough();

const EngineFieldState = z.object({
  value: z.union([z.string(), z.number(), z.null()]),
  status: z.enum(['extracted', 'review', 'not_found']),
  evidence: z.array(EngineEvidence),
  source: z.enum(['col', 'text', 'infer']).optional(),
}).passthrough();

const EngineAttribute = z.object({
  name: z.string(),
  raw_value: z.union([z.string(), z.number(), z.null()]),
  normalized_value: z.unknown().optional(),
  unit: z.string().nullish(),
  evidence: z.array(EngineEvidence),
}).passthrough();

const EngineFieldAlternative = z.object({
  raw_value: z.string(),
  normalized_value: z.union([z.string(), z.number(), z.null()]),
  source_cell: z.string(),
  source_role: z.enum([
    'value',
    'package',
    'footprint',
    'description',
    'part_number',
    'library_reference',
  ]),
}).passthrough();

const EngineRowShape = z.object({
  status: z.enum(['recovered', 'invalid']),
  source_width: z.number().int().min(0),
  expected_width: z.number().int().min(0),
  merged_column_1based: z.number().int().min(1).nullish(),
  merged_fragment_count: z.number().int().min(2).nullish(),
  source_cells: z.array(z.string()),
  repaired_cells: z.array(z.string()).nullish(),
}).passthrough();

export const BomEngineAnalysisComponent = z.object({
  source_file: z.string(),
  sheet_name: z.string(),
  sheet_index_0based: z.number().int().min(0),
  source_rows_1based: z.array(z.number().int().min(1)).min(1),
  component_type: z.string().nullish(),
  part_number: z.string().nullish(),
  manufacturer: z.string().nullish(),
  description: z.string().nullish(),
  quantity: z.number().int().nullish(),
  reference_count: z.number().int().min(0).nullish().optional(),
  quantity_resolution: z.enum(['verified', 'conflict', 'missing']).optional(),
  search_disposition: z.enum(['search', 'excluded']).optional(),
  procurement_disposition: z.enum(['eligible', 'excluded', 'quantity_confirmation_required']).optional(),
  disposition_reason_codes: z.array(z.string()).optional(),
  reference_designators: z.array(z.string()),
  package: z.string().nullish(),
  footprint: z.string().nullish(),
  value_raw: z.string().nullish(),
  raw_fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  input_alternatives: z.record(z.string(), z.array(EngineFieldAlternative)).optional(),
  field_states: z.record(z.string(), EngineFieldState),
  evidence: z.array(EngineEvidence),
  uncertain_fields: z.array(z.string()),
  quality_flags: z.array(z.string()),
  review_status: z.enum(['extracted', 'review']),
  resistance_ohm: z.number().nullish(),
  capacitance_f: z.number().nullish(),
  inductance_h: z.number().nullish(),
  power_w: z.number().nullish(),
  tolerance_percent: z.number().nullish(),
  absolute_tolerance_h: z.number().nullish().optional(),
  impedance_ohm: z.number().nullish().optional(),
  impedance_frequency_hz: z.number().nullish().optional(),
  dc_resistance_max_ohm: z.number().nullish().optional(),
  color: z.string().nullish().optional(),
  pin_count: z.number().int().min(0).nullish().optional(),
  row_count: z.number().int().min(0).nullish().optional(),
  pitch_mm: z.number().nullish().optional(),
  body_dimensions_mm: z.array(z.number()).nullish().optional(),
  row_shape: EngineRowShape.nullish(),
  voltage_v: z.number().nullish(),
  current_a: z.number().nullish(),
  frequency_hz: z.number().nullish(),
  temperature_min_c: z.number().nullish(),
  temperature_max_c: z.number().nullish(),
  size_code: z.string().nullish(),
  attributes: z.array(EngineAttribute),
  evidence_exact_rate: z.number().nullish(),
  part_number_supported: z.boolean().nullish(),
  confidence: z.number().min(0).max(1).optional(),
}).passthrough();

const StrictEngineEvidence = EngineEvidence.strict();
const StrictEngineFieldState = z.object({
  value: z.union([z.string(), z.number(), z.null()]),
  status: z.enum(['extracted', 'review', 'not_found']),
  evidence: z.array(StrictEngineEvidence),
  source: z.enum(['col', 'text', 'infer']).optional(),
}).strict();
const StrictEngineAttribute = z.object({
  name: z.string(),
  raw_value: z.union([z.string(), z.number(), z.null()]),
  normalized_value: z.unknown().optional(),
  unit: z.string().nullish(),
  evidence: z.array(StrictEngineEvidence),
}).strict();
const StrictEngineFieldAlternative = EngineFieldAlternative.strict();
const StrictEngineRowShape = EngineRowShape.strict();

/** 테스트/CI 전용 strict 계약. 런타임 저장은 위 passthrough 계약으로 새 필드를 먼저 보존한다. */
export const BomEngineAnalysisComponentStrict = BomEngineAnalysisComponent.extend({
  input_alternatives: z.record(z.string(), z.array(StrictEngineFieldAlternative)).optional(),
  field_states: z.record(z.string(), StrictEngineFieldState),
  evidence: z.array(StrictEngineEvidence),
  attributes: z.array(StrictEngineAttribute),
  row_shape: StrictEngineRowShape.nullish(),
}).strict();

export const BomEngineAnalysisSheet = z.object({
  sheet_index_0based: z.number().int().min(0),
  sheet_name: z.string(),
  status: z.enum(['parsed', 'not_bom', 'error']),
  component_count: z.number().int().min(0),
  column_count: z.number().int().min(0),
  header_rows_1based: z.array(z.number().int().min(1)),
  header_labels: z.array(z.string()),
  warnings: z.array(z.string()),
  unparsed_reason: z.string().nullish(),
}).passthrough();

const EngineObject = z.record(z.string(), z.unknown());

export const BomEngineAnalysisResult = z.object({
  schema_version: z.string(),
  engine: z.string(),
  model: z.string().nullish(),
  prompt_version: z.string().nullish(),
  parser_version: z.string(),
  source_file: z.string(),
  summary: z.object({ parser_version: z.string() }).passthrough(),
  sheets: z.array(BomEngineAnalysisSheet).min(1),
  components: z.array(BomEngineAnalysisComponent),
  headers: z.array(EngineObject),
  failures: z.array(EngineObject),
}).passthrough();

export type BomEngineAnalysisResultType = z.infer<typeof BomEngineAnalysisResult>;
export type BomEngineAnalysisComponentType = z.infer<typeof BomEngineAnalysisComponent>;

export class BomAnalysisContractError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(error: z.ZodError) {
    super('INVALID_ENGINE_ANALYSIS_RESULT');
    this.name = 'BomAnalysisContractError';
    this.issues = error.issues;
  }
}

export function parseBomEngineAnalysisResult(result: unknown): BomEngineAnalysisResultType {
  const parsed = BomEngineAnalysisResult.safeParse(result);
  if (!parsed.success) throw new BomAnalysisContractError(parsed.error);
  return parsed.data;
}

export function bomEngineComponentId(sourceFile: string, sheetIndex: number, rows: readonly number[]): string {
  return createHash('sha256')
    .update(`${sourceFile}\0${String(sheetIndex)}\0${rows.join(',')}`)
    .digest('hex')
    .slice(0, 24);
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function text(value: string | null | undefined, max: number): string | null {
  const normalized = value?.trim();
  return normalized === undefined || normalized === '' ? null : normalized.slice(0, max);
}

function componentSearchText(component: BomEngineAnalysisComponentType): string | null {
  const values = [
    component.part_number,
    component.manufacturer,
    component.component_type,
    component.description,
    component.package,
    component.footprint,
    component.value_raw,
    ...component.reference_designators,
    ...Object.values(component.raw_fields),
  ].filter((value): value is string | number => typeof value === 'string' || typeof value === 'number');
  const joined = values.map(String).join(' ').replace(/\s+/g, ' ').trim();
  return joined === '' ? null : joined;
}

function quoteSheet(component: z.infer<typeof BomEngineAnalysisSheet>): BomQuoteSheetType {
  return {
    sheetIndex: component.sheet_index_0based,
    sheetName: component.sheet_name.slice(0, 191),
    status: component.status,
    componentCount: component.component_count,
    selected: false,
    hasItems: false,
    failureReason: component.unparsed_reason?.slice(0, 500) ?? null,
    warnings: component.warnings,
  };
}

const ANALYSIS_COMPONENT_INSERT_BATCH_SIZE = 20;

export interface PersistedBomAnalysis {
  analysisRunId: bigint;
  sheets: BomQuoteSheetType[];
  componentCount: number;
  hasParsedSheet: boolean;
}

/**
 * 완료된 엔진 결과 전체를 append-only 분석 실행으로 박제하고 성공한 실행만 활성화한다.
 * 기존 견적 시트 선택 UI가 사용하는 sp_bom_quote_sheet도 같은 트랜잭션에서 갱신한다.
 */
export async function persistBomAnalysisResult(
  quoteId: bigint,
  engineJobId: string | null,
  rawResult: unknown,
): Promise<PersistedBomAnalysis> {
  const result = parseBomEngineAnalysisResult(rawResult);
  const sheets = result.sheets.map(quoteSheet);
  const sheetIndexes = new Set(result.sheets.map((sheet) => sheet.sheet_index_0based));
  if (result.components.some((component) => !sheetIndexes.has(component.sheet_index_0based))) {
    throw new Error('ENGINE_COMPONENT_SHEET_MISSING');
  }
  const componentIds = result.components.map((component) =>
    bomEngineComponentId(result.source_file, component.sheet_index_0based, component.source_rows_1based),
  );
  if (new Set(componentIds).size !== componentIds.length) throw new Error('ENGINE_COMPONENT_ID_DUPLICATE');

  return prisma.$transaction(async (tx) => {
    const run = await tx.spBomAnalysisRun.create({
      data: {
        quoteId,
        engineJobId,
        engine: result.engine.slice(0, 32),
        schemaVersion: result.schema_version.slice(0, 32),
        parserVersion: result.parser_version.slice(0, 191),
        sourceFile: result.source_file.slice(0, 255),
        engineModel: text(result.model, 191),
        promptVersion: text(result.prompt_version, 191),
        status: 'completed',
        summary: inputJson(result.summary),
        headers: inputJson(result.headers),
        failures: inputJson(result.failures),
        completedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.spBomAnalysisSheet.createMany({
      data: result.sheets.map((sheet) => ({
        analysisRunId: run.id,
        sheetIndex: sheet.sheet_index_0based,
        sheetName: sheet.sheet_name.slice(0, 191),
        status: sheet.status,
        componentCount: sheet.component_count,
        columnCount: sheet.column_count,
        failureReason: sheet.unparsed_reason?.slice(0, 500) ?? null,
        payload: inputJson(sheet),
      })),
    });
    const storedSheets = await tx.spBomAnalysisSheet.findMany({
      where: { analysisRunId: run.id },
      select: { id: true, sheetIndex: true },
    });
    const sheetIdByIndex = new Map(storedSheets.map((sheet) => [sheet.sheetIndex, sheet.id] as const));
    const componentRows: Prisma.SpBomAnalysisComponentCreateManyInput[] = result.components.map((component, index) => {
      const analysisSheetId = sheetIdByIndex.get(component.sheet_index_0based);
      const engineComponentId = componentIds[index];
      if (analysisSheetId === undefined || engineComponentId === undefined) {
        throw new Error('ENGINE_ANALYSIS_PERSISTENCE_INVARIANT');
      }
      return {
        analysisRunId: run.id,
        analysisSheetId,
        engineComponentId,
        sourceRows: inputJson(component.source_rows_1based),
        referenceDesignators: inputJson(component.reference_designators),
        partNumber: text(component.part_number, 191),
        manufacturer: text(component.manufacturer, 191),
        componentType: text(component.component_type, 64),
        description: text(component.description, 1000),
        quantity: component.quantity ?? null,
        packageCode: text(component.package, 191),
        reviewStatus: component.review_status,
        confidence: component.confidence ?? null,
        searchText: componentSearchText(component),
        payload: inputJson(component),
      };
    });
    for (let offset = 0; offset < componentRows.length; offset += ANALYSIS_COMPONENT_INSERT_BATCH_SIZE) {
      await tx.spBomAnalysisComponent.createMany({
        data: componentRows.slice(offset, offset + ANALYSIS_COMPONENT_INSERT_BATCH_SIZE),
      });
    }

    await tx.spBomQuoteSheet.deleteMany({ where: { quoteId } });
    await tx.spBomQuoteSheet.createMany({
      data: sheets.map((sheet) => ({
        quoteId,
        sheetIndex: sheet.sheetIndex,
        sheetName: sheet.sheetName,
        status: sheet.status,
        componentCount: sheet.componentCount,
        selected: false,
        failureReason: sheet.failureReason,
        warnings: inputJson(sheet.warnings),
      })),
    });
    const hasParsedSheet = sheets.some((sheet) => sheet.status === 'parsed');
    await tx.spBomQuote.update({
      where: { id: quoteId },
      data: {
        activeAnalysisRunId: run.id,
        buildStatus: hasParsedSheet ? 'selecting' : 'failed',
      },
    });
    return {
      analysisRunId: run.id,
      sheets,
      componentCount: result.components.length,
      hasParsedSheet,
    };
  });
}

/** DB에 박제된 활성 분석 실행을 엔진 공개 결과 형태로 복원한다. */
export async function loadActiveBomAnalysisResult(
  quoteId: bigint,
  sheetIndexes?: readonly number[],
): Promise<BomEngineAnalysisResultType | null> {
  const quote = await prisma.spBomQuote.findUnique({
    where: { id: quoteId },
    select: {
      activeAnalysisRun: {
        select: {
          engine: true,
          schemaVersion: true,
          parserVersion: true,
          sourceFile: true,
          engineModel: true,
          promptVersion: true,
          summary: true,
          headers: true,
          failures: true,
          sheets: { select: { sheetIndex: true, payload: true } },
          components: {
            select: { payload: true, analysisSheet: { select: { sheetIndex: true } } },
          },
        },
      },
    },
  });
  const run = quote?.activeAnalysisRun;
  if (run === null || run === undefined) return null;
  const selected = sheetIndexes === undefined ? null : new Set(sheetIndexes);
  const sheets = run.sheets
    .sort((left, right) => left.sheetIndex - right.sheetIndex)
    .map((sheet) => sheet.payload);
  const components = run.components
    .filter((component) => selected === null || selected.has(component.analysisSheet.sheetIndex))
    .map((component) => BomEngineAnalysisComponent.parse(component.payload))
    .sort((left, right) => {
      const sheetOrder = left.sheet_index_0based - right.sheet_index_0based;
      if (sheetOrder !== 0) return sheetOrder;
      return Math.min(...left.source_rows_1based) - Math.min(...right.source_rows_1based);
    });
  return BomEngineAnalysisResult.parse({
    schema_version: run.schemaVersion,
    engine: run.engine,
    model: run.engineModel,
    prompt_version: run.promptVersion,
    parser_version: run.parserVersion,
    source_file: run.sourceFile,
    summary: run.summary,
    sheets,
    components,
    headers: run.headers,
    failures: run.failures,
  });
}
