import { Prisma, type SpPartnerPart, type SpPartnerPartUpload } from '@prisma/client';
import {
  PARTNER_PART_COLUMN_ROLES,
  type AdminBomQuoteItemPartnerHolderType,
  type PartnerPartColumnRoleType,
  type PartnerPartPreviewRowType,
  type PartnerPartPreviewSheetType,
  type PartnerPartRowType,
  type PartnerPartUpdateBodyType,
  type PartnerPartSummaryType,
  type PartnerPartUploadModeType,
  type PartnerPartUploadStatsType,
  type PartnerPartUploadStatusType,
  type PartnerPartUploadViewType,
} from '@sp/api-contract';
import { normalizeMpn } from '@sp/utils';
import { z } from 'zod';
import { engineFetch } from './engine-client';
import { downloadFromFileServer } from './file-server';
import { resolveManufacturer } from './manufacturer-alias';
import { toCapabilities } from './partner';
import { PARTNER_SUPPLIER } from './parts-facts';
import { indexChangedParts, isTransientPartIngestError } from './parts-ingest';
import { prisma } from './prisma';

// ── 협력사 보유 부품 원장 — 정본 docs/PARTNER_PARTS.md ──────────────────────
//
// 저장을 부품 카탈로그(sp_part)와 분리한 이유: 카탈로그에 편입하면 로컬-우선 검색
// (bom-local-catalog)·ES 패싯·고객 단일검색·`pickDefaultOffer` 기본 선정까지 다섯 갈래로
// 새고, 그때마다 "협력사 제외" 분기를 공급사 하드코딩 목록 10여 곳에 심어야 한다.
// 여기서는 읽는 경로가 하나(BOM 검색 주입 조회)뿐이라 "뒤순위"가 구조로 보장된다.
//
// 만료는 두지 않는다(사용자 결정) — 낡은 정보는 관리자가 운영으로 뒤처리한다.
// 대신 나이(`ageDays`)를 어디서나 보이게 하고 경고 임계만 설정으로 둔다.

export const PARTNER_PART_FILE_REF_TYPE = 'sp_partner_part_upload';
export const PARTNER_PART_ALLOWED_EXT = new Set(['xlsx', 'xlsm', 'xls', 'csv', 'tsv', 'bom']);
export const PARTNER_PART_MAX_FILE_BYTES = 50 * 1024 * 1024;
/** 미리보기에 싣는 표본 행 수 — 전량은 커밋 후 원장 조회로 본다. */
export const PARTNER_PART_PREVIEW_ROW_LIMIT = 200;
/** 나이 경고 임계(일). 만료가 아니라 **표시 경고**다. */
export const PARTNER_PART_STALE_AFTER_DAYS = Number(
  process.env.PARTNER_PART_STALE_AFTER_DAYS ?? 90,
);

const COLUMN_ROLE_SET: ReadonlySet<string> = new Set(PARTNER_PART_COLUMN_ROLES);

const asColumnRole = (value: unknown): PartnerPartColumnRoleType =>
  typeof value === 'string' && COLUMN_ROLE_SET.has(value)
    ? (value as PartnerPartColumnRoleType)
    : 'ignore';

export const asUploadStatus = (value: string): PartnerPartUploadStatusType =>
  value === 'preview' || value === 'applied' || value === 'failed' || value === 'superseded'
    ? value
    : 'parsing';

export const asUploadMode = (value: string): PartnerPartUploadModeType =>
  value === 'merge' ? 'merge' : 'replace';

// ── 엔진 계약(느슨) — 알 수 없는 신규 필드는 통과시켜 원문 보존을 깨지 않는다 ──
const EngineInventoryRow = z
  .object({
    row_id: z.string(),
    sheet_name: z.string().optional(),
    source_row_1based: z.number().int().optional(),
    part_number: z.string(),
    part_number_raw: z.string(),
    part_number_alternatives: z.array(z.string()).default([]),
    manufacturer: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    package: z.string().nullable().optional(),
    stock_qty: z.number().int().nullable().optional(),
    date_code: z.string().nullable().optional(),
    lead_time: z.string().nullable().optional(),
    unit_price: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    moq: z.number().int().nullable().optional(),
    raw_fields: z.record(z.string(), z.string()).default({}),
    flags: z.array(z.string()).default([]),
  })
  .passthrough();

const EngineInventorySheet = z
  .object({
    sheet_index_0based: z.number().int().nonnegative(),
    sheet_name: z.string(),
    status: z.string(),
    row_count: z.number().int().nonnegative(),
    header_rows_1based: z.array(z.number().int()).default([]),
    columns: z
      .array(
        z
          .object({
            column_1based: z.number().int().positive(),
            raw_header: z.string(),
            role: z.string(),
            source: z.string(),
          })
          .passthrough(),
      )
      .default([]),
    warnings: z.array(z.string()).default([]),
    unparsed_reason: z.string().nullable().default(null),
  })
  .passthrough();

export const EngineInventoryResult = z
  .object({
    engine: z.literal('inventory'),
    schema_version: z.string(),
    summary: z
      .object({
        row_count: z.number().int().nonnegative(),
        distinct_part_number_count: z.number().int().nonnegative().default(0),
        with_manufacturer: z.number().int().nonnegative().default(0),
        with_stock: z.number().int().nonnegative().default(0),
        with_price: z.number().int().nonnegative().default(0),
        flag_counts: z.record(z.string(), z.number().int().nonnegative()).default({}),
        flagged_row_count: z.number().int().nonnegative().default(0),
        processing_ms: z.number().nonnegative().nullable().default(null),
      })
      .passthrough(),
    sheets: z.array(EngineInventorySheet),
    rows: z.array(EngineInventoryRow),
  })
  .passthrough();
export type EngineInventoryResultType = z.infer<typeof EngineInventoryResult>;

// ── 엔진 호출 ───────────────────────────────────────────────────────────────
export interface InventoryEngineOverrides {
  roleOverrides: Record<string, Record<string, string>>;
  headerRowOverrides: Record<string, number>;
}

export class PartnerPartEngineError extends Error {
  constructor(
    readonly code: 'BOM_ENGINE_UNREACHABLE' | 'BOM_ENGINE_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'PartnerPartEngineError';
  }
}

/** 재고표를 엔진 `inventory` 프로필로 제출한다. 반환은 잡 ID. */
export async function submitInventoryJob(
  file: { buffer: Buffer; filename: string; mimetype: string },
  overrides?: InventoryEngineOverrides,
): Promise<string> {
  const form = new FormData();
  form.append(
    'file',
    new File([new Uint8Array(file.buffer)], file.filename, { type: file.mimetype }),
  );
  form.append('engine', 'inventory');
  if (overrides !== undefined) {
    form.append(
      'inventory_options',
      JSON.stringify({
        role_overrides: overrides.roleOverrides,
        header_row_overrides: overrides.headerRowOverrides,
      }),
    );
  }
  let res: Response;
  try {
    res = await engineFetch('/jobs', { method: 'POST', body: form });
  } catch {
    throw new PartnerPartEngineError('BOM_ENGINE_UNREACHABLE', 'sp-engine 에 연결할 수 없습니다');
  }
  if (!res.ok) {
    throw new PartnerPartEngineError('BOM_ENGINE_ERROR', `엔진 응답 ${String(res.status)}`);
  }
  const body = (await res.json()) as { job_id?: unknown };
  if (typeof body.job_id !== 'string' || body.job_id === '') {
    throw new PartnerPartEngineError('BOM_ENGINE_ERROR', '엔진이 잡 ID 를 주지 않았습니다');
  }
  return body.job_id;
}

/** 잡이 끝날 때까지 폴링하고 결과를 계약으로 파싱한다. */
export async function awaitInventoryResult(
  jobId: string,
  { timeoutMs = 180_000, intervalMs = 1_000 } = {},
): Promise<EngineInventoryResultType> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let res: Response;
    try {
      res = await engineFetch(`/jobs/${encodeURIComponent(jobId)}`);
    } catch {
      throw new PartnerPartEngineError('BOM_ENGINE_UNREACHABLE', 'sp-engine 에 연결할 수 없습니다');
    }
    if (!res.ok) {
      throw new PartnerPartEngineError('BOM_ENGINE_ERROR', `잡 조회 ${String(res.status)}`);
    }
    const view = (await res.json()) as { status?: unknown; error?: unknown };
    if (view.status === 'failed') {
      throw new PartnerPartEngineError(
        'BOM_ENGINE_ERROR',
        typeof view.error === 'string' ? view.error : '추출 실패',
      );
    }
    if (view.status === 'completed') break;
    if (Date.now() > deadline) {
      throw new PartnerPartEngineError('BOM_ENGINE_ERROR', '추출이 시간 안에 끝나지 않았습니다');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  let resultRes: Response;
  try {
    resultRes = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/result`);
  } catch {
    throw new PartnerPartEngineError('BOM_ENGINE_UNREACHABLE', 'sp-engine 에 연결할 수 없습니다');
  }
  if (!resultRes.ok) {
    throw new PartnerPartEngineError('BOM_ENGINE_ERROR', `결과 조회 ${String(resultRes.status)}`);
  }
  const parsed = EngineInventoryResult.safeParse(await resultRes.json());
  if (!parsed.success) {
    throw new PartnerPartEngineError('BOM_ENGINE_ERROR', '엔진 결과 계약이 맞지 않습니다');
  }
  return parsed.data;
}

/** 잡을 지운다(임시 원본 정리) — 실패해도 업로드 흐름을 막지 않는다. */
export async function releaseInventoryJob(jobId: string): Promise<void> {
  try {
    await engineFetch(`/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  } catch {
    /* best-effort */
  }
}

// ── 엔진 결과 → 계약 DTO ────────────────────────────────────────────────────
export const toPreviewSheets = (
  result: EngineInventoryResultType,
): PartnerPartPreviewSheetType[] =>
  result.sheets.map((sheet) => ({
    sheetIndex: sheet.sheet_index_0based,
    sheetName: sheet.sheet_name,
    status:
      sheet.status === 'parsed' ? 'parsed' : sheet.status === 'error' ? 'error' : 'not_inventory',
    rowCount: sheet.row_count,
    headerRow1Based: sheet.header_rows_1based[0] ?? null,
    columns: sheet.columns.map((column) => ({
      column1Based: column.column_1based,
      rawHeader: column.raw_header,
      role: asColumnRole(column.role),
      source:
        column.source === 'label' || column.source === 'content' || column.source === 'override'
          ? column.source
          : 'none',
    })),
    warnings: sheet.warnings,
    unparsedReason: sheet.unparsed_reason,
  }));

export const toUploadStats = (
  result: EngineInventoryResultType,
): PartnerPartUploadStatsType => ({
  rowCount: result.summary.row_count,
  distinctMpnCount: result.summary.distinct_part_number_count,
  withManufacturer: result.summary.with_manufacturer,
  withStock: result.summary.with_stock,
  withPrice: result.summary.with_price,
  flagCounts: result.summary.flag_counts,
  flaggedRowCount: result.summary.flagged_row_count,
  processingMs: result.summary.processing_ms,
});

export const toPreviewRows = (
  result: EngineInventoryResultType,
  limit = PARTNER_PART_PREVIEW_ROW_LIMIT,
): PartnerPartPreviewRowType[] =>
  result.rows.slice(0, limit).map((row) => ({
    rowId: row.row_id,
    sheetName: row.sheet_name ?? '',
    sourceRow: row.source_row_1based ?? null,
    mpn: row.part_number,
    mpnRaw: row.part_number_raw,
    alternatives: row.part_number_alternatives,
    manufacturer: row.manufacturer ?? null,
    description: row.description ?? null,
    stockQty: row.stock_qty ?? null,
    dateCode: row.date_code ?? null,
    leadTime: row.lead_time ?? null,
    unitPrice: row.unit_price ?? null,
    currency: row.currency ?? null,
    moq: row.moq ?? null,
    flags: row.flags,
  }));

// ── 미리보기 스냅샷 · 커밋 입력 ──────────────────────────────────────────────
//
// ⚠ 엔진 결과 원문을 그대로 `previewJson` 에 넣으면 **MySQL 패킷 한도에 부딪혀 연결이
// 끊긴다** — 실측: 12,175행 재고표의 결과 JSON 6.36MB → "Server has closed the connection".
// (BOM 견적의 "대형 후보 저장 내성"과 같은 계열 함정.) 그래서
//   · 미리보기는 **표본 200행 + 통계·시트/열 정보만** 저장하고,
//   · 커밋에 필요한 전량은 **보관한 원본을 같은 옵션으로 다시 돌려** 얻는다.
// 추출은 결정론적 규칙 엔진이라 같은 파일·같은 교정이면 같은 결과가 나온다.

const PREVIEW_SNAPSHOT_VERSION = 'partner-part-preview-v1';

const PreviewSnapshot = z.object({
  version: z.literal(PREVIEW_SNAPSHOT_VERSION),
  rows: z.array(z.record(z.string(), z.unknown())),
  totalRowCount: z.number().int().nonnegative(),
});

export interface PartnerPartUploadOverrides {
  roleOverrides: Record<string, Record<string, string>>;
  headerRowOverrides: Record<string, number>;
}

const EMPTY_OVERRIDES: PartnerPartUploadOverrides = {
  roleOverrides: {},
  headerRowOverrides: {},
};

/** 미리보기 저장 형태(패킷 안전) — 표본 행만 담는다. */
export const previewSnapshotFor = (
  result: EngineInventoryResultType,
): Prisma.InputJsonValue => ({
  version: PREVIEW_SNAPSHOT_VERSION,
  rows: toPreviewRows(result) as unknown as Prisma.InputJsonValue[],
  totalRowCount: result.rows.length,
});

/** 저장된 미리보기에서 표본 행을 되읽는다. 구형·손상 스냅샷은 빈 목록으로 축퇴한다. */
export const previewRowsFrom = (value: unknown): PartnerPartPreviewRowType[] => {
  const parsed = PreviewSnapshot.safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.rows as unknown as PartnerPartPreviewRowType[];
};

/** 업로드 행에 박제한 열 역할 교정을 되읽는다. */
export const overridesFrom = (mappingJson: unknown): PartnerPartUploadOverrides => {
  if (typeof mappingJson !== 'object' || mappingJson === null) return EMPTY_OVERRIDES;
  const stored = (mappingJson as { engineOverrides?: unknown }).engineOverrides;
  const parsed = z
    .object({
      roleOverrides: z.record(z.string(), z.record(z.string(), z.string())).default({}),
      headerRowOverrides: z.record(z.string(), z.number().int()).default({}),
    })
    .safeParse(stored);
  return parsed.success ? parsed.data : EMPTY_OVERRIDES;
};

/** 미리보기 저장 묶음 — 라우트 두 곳(포털·관리자 대행)이 같은 형태를 쓴다. */
export const previewUpdateData = (
  result: EngineInventoryResultType,
  overrides: PartnerPartUploadOverrides | undefined,
): Prisma.SpPartnerPartUploadUpdateInput => ({
  status: 'preview',
  statsJson: toUploadStats(result),
  mappingJson: {
    sheets: toPreviewSheets(result),
    ...(overrides === undefined ? {} : { engineOverrides: overrides }),
  } as unknown as Prisma.InputJsonValue,
  previewJson: previewSnapshotFor(result),
  error: null,
});

/**
 * 보관한 원본을 같은 교정으로 다시 돌려 **전량**을 얻는다(커밋·재분석 공용).
 *
 * 원본이 없으면 커밋할 수 없다 — 그래서 업로드 시 원본 보관은 실패하면 업로드 자체를
 * 실패시킨다(best-effort 로 두면 여기서 되돌릴 수 없는 막다른 길이 된다).
 */
export async function rerunUploadFromArchive(
  upload: { id: bigint; fileName: string },
  overrides: PartnerPartUploadOverrides,
): Promise<EngineInventoryResultType> {
  const file = await prisma.spFile.findFirst({
    where: { refType: PARTNER_PART_FILE_REF_TYPE, refId: upload.id },
    orderBy: { id: 'desc' },
  });
  if (file === null) {
    throw new PartnerPartEngineError('BOM_ENGINE_ERROR', '원본 파일이 보관되지 않았습니다');
  }
  const downloaded = await downloadFromFileServer(file.pathToken);
  if (downloaded === null) {
    throw new PartnerPartEngineError('BOM_ENGINE_ERROR', '원본 파일을 찾을 수 없습니다');
  }
  const jobId = await submitInventoryJob(
    {
      buffer: downloaded.buffer,
      filename: upload.fileName,
      mimetype: downloaded.contentType,
    },
    overrides,
  );
  try {
    return await awaitInventoryResult(jobId);
  } finally {
    void releaseInventoryJob(jobId);
  }
}

// ── 원장 쓰기 ───────────────────────────────────────────────────────────────
const CHUNK = 500;

interface LedgerRowInput {
  mpn: string;
  mpnRaw: string;
  mpnNorm: string;
  keys: string[];
  manufacturer: string | null;
  manufacturerNorm: string;
  description: string | null;
  packageCode: string | null;
  stockQty: number | null;
  dateCode: string | null;
  leadTime: string | null;
  unitPrice: Prisma.Decimal | null;
  currency: string | null;
  moq: number | null;
  sourceRow: number | null;
  sourceSheetName: string | null;
  rawFields: Prisma.InputJsonValue;
  flags: Prisma.InputJsonValue;
}

const clip = (value: string | null | undefined, max: number): string | null => {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  return text === '' ? null : text.slice(0, max);
};

/**
 * 엔진 행 → 원장 입력. 품번이 없는 행은 조회할 수 없으므로 원장에 넣지 않는다
 * (미리보기·통계에는 남아 협력사가 원본을 고칠 수 있다).
 */
export const toLedgerRows = (result: EngineInventoryResultType): LedgerRowInput[] => {
  const rows: LedgerRowInput[] = [];
  for (const row of result.rows) {
    const canonical = normalizeMpn(row.part_number);
    if (canonical === '') continue;
    const keys = new Set<string>([canonical]);
    for (const alternative of row.part_number_alternatives) {
      const norm = normalizeMpn(alternative);
      if (norm !== '') keys.add(norm);
    }
    const manufacturer = clip(row.manufacturer ?? null, 191);
    rows.push({
      mpn: row.part_number.slice(0, 191),
      mpnRaw: row.part_number_raw.slice(0, 255),
      mpnNorm: canonical.slice(0, 191),
      keys: [...keys].map((key) => key.slice(0, 191)),
      manufacturer,
      manufacturerNorm: resolveManufacturer(manufacturer ?? '').norm.slice(0, 191),
      description: clip(row.description ?? null, 500),
      packageCode: clip(row.package ?? null, 100),
      stockQty: row.stock_qty ?? null,
      dateCode: clip(row.date_code ?? null, 100),
      leadTime: clip(row.lead_time ?? null, 100),
      unitPrice:
        row.unit_price === null || row.unit_price === undefined
          ? null
          : new Prisma.Decimal(row.unit_price),
      currency: clip(row.currency ?? null, 8)?.toUpperCase() ?? null,
      moq: row.moq ?? null,
      sourceRow: row.source_row_1based ?? null,
      sourceSheetName: clip(row.sheet_name ?? null, 191),
      rawFields: row.raw_fields,
      flags: row.flags,
    });
  }
  return rows;
};

/**
 * 미리보기 스냅샷을 원장에 반영한다.
 *
 * `replace` 는 그 협력사의 기존 원장을 통째로 지우고 새 회차로 바꾼다 — 협력사가 올린 표가
 * 그 시점 보유 전량이라는 실무 의미. 삭제는 트랜잭션 밖 청크로 돌린다(견적 삭제에서 배운
 * P2028 함정 — 수만 행 cascade 를 인터랙티브 트랜잭션에 넣지 않는다).
 */
export async function commitPartnerPartUpload(
  uploadId: bigint,
  partnerId: bigint,
  mode: PartnerPartUploadModeType,
  rows: LedgerRowInput[],
): Promise<number> {
  if (mode === 'replace') {
    for (;;) {
      const stale = await prisma.spPartnerPart.findMany({
        where: { partnerId, uploadId: { not: uploadId } },
        select: { id: true },
        take: CHUNK,
      });
      if (stale.length === 0) break;
      const ids = stale.map((row) => row.id);
      await prisma.spPartnerPartKey.deleteMany({ where: { partId: { in: ids } } });
      await prisma.spPartnerPart.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.spPartnerPartUpload.updateMany({
      where: { partnerId, status: 'applied', id: { not: uploadId } },
      data: { status: 'superseded' },
    });
  }

  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    // createMany 는 생성 ID 를 돌려주지 않으므로(MySQL) 키 테이블을 채우려면 행 ID 가
    // 필요하다. 청크마다 삽입 후 uploadId+sourceRow 로 되읽어 키를 만든다.
    await prisma.spPartnerPart.createMany({
      data: chunk.map((row) => ({
        partnerId,
        uploadId,
        mpn: row.mpn,
        mpnRaw: row.mpnRaw,
        mpnNorm: row.mpnNorm,
        manufacturer: row.manufacturer,
        manufacturerNorm: row.manufacturerNorm,
        description: row.description,
        packageCode: row.packageCode,
        stockQty: row.stockQty,
        dateCode: row.dateCode,
        leadTime: row.leadTime,
        unitPrice: row.unitPrice,
        currency: row.currency,
        moq: row.moq,
        sourceRow: row.sourceRow,
        sourceSheetName: row.sourceSheetName,
        rawFields: row.rawFields,
        flags: row.flags,
      })),
    });
    inserted += chunk.length;
  }

  // 조회 키 — 원문 정리본 + 엔진이 준 대체 후보를 모두 건다.
  //
  // 삽입한 행의 ID 는 `createMany` 가 돌려주지 않으므로(MySQL) 되읽어야 한다. 청크마다
  // 500개짜리 OR 조건을 거는 대신 **이 회차 전체를 한 번** 읽는다 — OR 500 은 쿼리 자체가
  // 커져 대형 재고표에서 다시 패킷 벽에 부딪힌다. 식별은 (시트, 원본 행) 조합으로 한다
  // (같은 품번이 여러 lot 으로 반복되므로 mpnNorm 만으로는 행이 갈리지 않는다).
  const rowKey = (sheet: string | null, sourceRow: number | null): string =>
    `${sheet ?? ''} ${sourceRow === null ? '' : String(sourceRow)}`;
  const saved = await prisma.spPartnerPart.findMany({
    where: { uploadId },
    select: { id: true, sourceSheetName: true, sourceRow: true },
  });
  const idByRow = new Map(saved.map((row) => [rowKey(row.sourceSheetName, row.sourceRow), row.id]));
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const keyRows: { partId: bigint; partnerId: bigint; mpnNorm: string; kind: string }[] = [];
    for (const row of rows.slice(offset, offset + CHUNK)) {
      const partId = idByRow.get(rowKey(row.sourceSheetName, row.sourceRow));
      if (partId === undefined) continue;
      for (const key of row.keys) {
        keyRows.push({
          partId,
          partnerId,
          mpnNorm: key,
          kind: key === row.mpnNorm ? 'canonical' : 'alternative',
        });
      }
    }
    if (keyRows.length > 0) {
      await prisma.spPartnerPartKey.createMany({ data: keyRows, skipDuplicates: true });
    }
  }

  await prisma.spPartnerPartUpload.update({
    where: { id: uploadId },
    data: {
      status: 'applied',
      mode,
      appliedAt: new Date(),
      previewJson: Prisma.DbNull, // 반영 후에는 스냅샷을 비운다(용량)
    },
  });
  // 카탈로그 투영 — 단일검색·[부품 추가]가 카탈로그를 보므로 반영 시점에 함께 맞춘다.
  await projectPartnerPartsToCatalog(partnerId);
  return inserted;
}

// ── 카탈로그 투영(docs/PARTNER_PARTS.md) ────────────────────────────────────
//
// 원장이 정본, 카탈로그는 파생이다 — `samplepcb` 파생 구매 조건과 같은 관계.
// 투영하는 이유는 하나: 단일검색·[부품 추가]가 카탈로그를 보기 때문이다(P7).
// BOM 후보는 여전히 주입(`local_products`)이 만든다 — 로컬-우선 검색은 `samplepcb`
// 파생 구매 조건이 있는 부품만 후보로 삼으므로 협력사 부품은 그 경로에 안 걸린다.
//
// 세 가지를 지킨다:
//  ① 정본 오염 금지 — 협력사는 `resolvePartFacts` 의 실공급사 집합에서 빠진다.
//  ② 색인 오염 금지 — `buildPartDoc` 이 협력사 구매 조건을 뺀다. 그래서 협력사 offer 를
//     넣고 빼도 **ES 문서가 안 바뀌고**, 전체 교체 업로드가 재색인을 유발하지 않는다.
//  ③ 그 둘 덕에 투영은 facts·색인을 아예 건드릴 필요가 없다.

/**
 * 쓰기 경합 재시도 — 두 협력사가 **겹치는 신규 품번**을 동시에 반영하면 유니크 인덱스
 * (`mpnNorm, manufacturerNorm`) 갭 락에서 교착이 난다(P2034). 유니크 충돌(P2002)은
 * `ensureCatalogPart` 가 '남이 먼저 만들었다'로 흡수하지만 교착은 흡수할 수 없다 —
 * 트랜잭션 자체가 죽으므로 **다시 시도하는 것만이 답**이다.
 *
 * ⚠ 실측: 여정 스펙을 단독으로 돌리면 안 나고 **전체 스위트를 함께 돌릴 때** 터졌다.
 * 한 번 통과했다고 경합이 없는 게 아니다.
 */
async function withWriteRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown = new Error('partner catalog write retry exhausted');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isTransientPartIngestError(error)) throw error;
      const backoffMs = 25 * 2 ** attempt + Math.floor(Math.random() * 25);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastError;
}

/** 협력사 구매 조건의 SKU — `{partnerId}:{원장 행 id}`. 접두가 곧 소유권이다. */
const partnerOfferSku = (partnerId: bigint, ledgerPartId: bigint): string =>
  `${String(partnerId)}:${String(ledgerPartId)}`;

interface CatalogProjectionRow {
  id: bigint;
  mpn: string;
  mpnRaw: string;
  mpnNorm: string;
  manufacturer: string | null;
  manufacturerNorm: string;
  description: string | null;
  packageCode: string | null;
  stockQty: number | null;
  dateCode: string | null;
  leadTime: string | null;
  moq: number | null;
  createdAt: Date;
}

const PROJECTION_SELECT = {
  id: true,
  mpn: true,
  mpnRaw: true,
  mpnNorm: true,
  manufacturer: true,
  manufacturerNorm: true,
  description: true,
  packageCode: true,
  stockQty: true,
  dateCode: true,
  leadTime: true,
  moq: true,
  createdAt: true,
} as const;

/** 카탈로그 부품을 찾거나 만든다. 기존 부품의 정본 필드는 절대 덮지 않는다. */
async function ensureCatalogPart(row: CatalogProjectionRow): Promise<bigint> {
  const identity = { mpnNorm: row.mpnNorm, manufacturerNorm: row.manufacturerNorm };
  const existing = await prisma.spPart.findUnique({
    where: { mpnNorm_manufacturerNorm: identity },
    select: { id: true },
  });
  if (existing !== null) return existing.id;
  // 제조사를 못 읽은 행은 `manufacturerNorm='unknown'` 으로 앉는다(실측 57%). 같은 품번의
  // 진짜 부품과 별개 레코드가 되지만, 실공급사 구매 조건이 없어 **색인되지 않으므로**
  // 검색 품질을 해치지 않는다. 나중에 공급사 결과가 붙으면 그 레코드가 정상 색인된다.
  // 두 협력사가 같은 신규 품번을 동시에 올릴 수 있다 — 유니크 충돌은 실패가 아니라
  // '남이 먼저 만들었다'는 뜻이므로 다시 읽어 그 행을 쓴다(인제스트 `upsertWithRaceRecovery` 와 같은 결).
  try {
    const created = await withWriteRetry(() => prisma.spPart.create({
      data: {
        mpn: row.mpn.slice(0, 191),
        ...identity,
        manufacturerName: (row.manufacturer ?? '').slice(0, 191),
        specsJson: {},
        specsSi: {},
      },
      select: { id: true },
    }));
    return created.id;
  } catch (error) {
    const raced = await prisma.spPart.findUnique({
      where: { mpnNorm_manufacturerNorm: identity },
      select: { id: true },
    });
    if (raced !== null) return raced.id;
    throw error;
  }
}

interface PartnerOfferData {
  stock: number | null;
  moq: number | null;
  leadTime: string | null;
  rawJson: Prisma.InputJsonValue;
  fetchedAt: Date;
}

const partnerOfferData = (partnerId: bigint, row: CatalogProjectionRow): PartnerOfferData => ({
  stock: row.stockQty,
  moq: row.moq,
  leadTime: row.leadTime === null ? null : row.leadTime.slice(0, 64),
  // 가격은 담지 않는다 — 재고표 단가는 견적가가 아니고, 구매 조건을 만드는 순간
  // 자동 선정·합계로 새는 길이 열린다(값의 정본은 RFQ 회신이다).
  rawJson: {
    supplier: PARTNER_SUPPLIER,
    partnerId: Number(partnerId),
    ledgerPartId: Number(row.id),
    manufacturer_part_number: row.mpn,
    mpnRaw: row.mpnRaw,
    manufacturer: row.manufacturer,
    description: row.description,
    package: row.packageCode,
    partnerStockQty: row.stockQty,
    partnerDateCode: row.dateCode,
    partnerLeadTime: row.leadTime,
    offers: [],
  },
  fetchedAt: row.createdAt,
});

async function upsertPartnerOffer(
  catalogPartId: bigint,
  sku: string,
  data: PartnerOfferData,
): Promise<void> {
  await prisma.spPartOffer.upsert({
    where: {
      partId_supplier_supplierSku: {
        partId: catalogPartId,
        supplier: PARTNER_SUPPLIER,
        supplierSku: sku,
      },
    },
    create: { partId: catalogPartId, supplier: PARTNER_SUPPLIER, supplierSku: sku, ...data },
    update: data,
  });
}

/** 원장 행 하나를 카탈로그에 반영한다(행 수정·삭제 같은 낱개 변경용). */
export async function syncPartnerPartOfferToCatalog(ledgerPartId: bigint): Promise<void> {
  const row = await prisma.spPartnerPart.findUnique({
    where: { id: ledgerPartId },
    select: { ...PROJECTION_SELECT, partnerId: true, isActive: true },
  });
  if (row?.isActive !== true) {
    // 꺼졌거나 사라진 행은 카탈로그에서도 빠진다 — 관리자가 끈 원장이 검색에 남으면 안 된다.
    const gone = await prisma.spPartOffer.findMany({
      where: {
        supplier: PARTNER_SUPPLIER,
        supplierSku: { endsWith: `:${String(ledgerPartId)}` },
      },
      select: { id: true, partId: true },
    });
    if (gone.length === 0) return;
    await prisma.spPartOffer.deleteMany({ where: { id: { in: gone.map((o) => o.id) } } });
    await indexChangedParts([...new Set(gone.map((o) => o.partId))]);
    return;
  }
  const catalogPartId = await ensureCatalogPart(row);
  const sku = partnerOfferSku(row.partnerId, row.id);
  // 품번을 고치면 다른 카탈로그 부품으로 옮겨 가므로 옛 자리의 구매 조건을 먼저 지운다.
  const moved = await prisma.spPartOffer.findMany({
    where: { supplier: PARTNER_SUPPLIER, supplierSku: sku, partId: { not: catalogPartId } },
    select: { id: true, partId: true },
  });
  if (moved.length > 0) {
    await prisma.spPartOffer.deleteMany({ where: { id: { in: moved.map((o) => o.id) } } });
  }
  await upsertPartnerOffer(catalogPartId, sku, partnerOfferData(row.partnerId, row));
  // 옮겨 온 자리와 떠난 자리 모두 문서가 바뀐다.
  await indexChangedParts([...new Set([catalogPartId, ...moved.map((o) => o.partId)])]);
}

/**
 * 한 청크를 **일괄로** 투영한다 — 행마다 두 질의(부품 확보 + 구매 조건 upsert)를 돌면
 * 12,000행 반영이 70초였다. 식별자 일괄 조회 → `createMany` → 구매 조건 일괄 조회 →
 * 신규만 `createMany` · 값이 바뀐 것만 개별 update 로 줄인다(재실행은 대개 0건 update).
 */
async function projectChunk(
  partnerId: bigint,
  rows: CatalogProjectionRow[],
  kept: Set<string>,
  touched: Set<string>,
): Promise<number> {
  const identityKey = (row: { mpnNorm: string; manufacturerNorm: string }): string =>
    `${row.mpnNorm} ${row.manufacturerNorm}`;

  // ① 부품 확보 — 있는 것을 한 번에 읽고, 없는 것만 한 번에 만든다.
  const mpnNorms = [...new Set(rows.map((row) => row.mpnNorm))];
  const partIdByIdentity = new Map<string, bigint>();
  const readParts = async (): Promise<void> => {
    const found = await prisma.spPart.findMany({
      where: { mpnNorm: { in: mpnNorms } },
      select: { id: true, mpnNorm: true, manufacturerNorm: true },
    });
    for (const part of found) partIdByIdentity.set(identityKey(part), part.id);
  };
  await readParts();

  const missing = new Map<string, CatalogProjectionRow>();
  for (const row of rows) {
    const key = identityKey(row);
    if (!partIdByIdentity.has(key) && !missing.has(key)) missing.set(key, row);
  }
  if (missing.size > 0) {
    // 제조사를 못 읽은 행은 `manufacturerNorm='unknown'` 으로 앉는다(§1.5).
    await withWriteRetry(() => prisma.spPart.createMany({
      data: [...missing.values()].map((row) => ({
        mpn: row.mpn.slice(0, 191),
        mpnNorm: row.mpnNorm,
        manufacturerNorm: row.manufacturerNorm,
        manufacturerName: (row.manufacturer ?? '').slice(0, 191),
        specsJson: {},
        specsSi: {},
      })),
      skipDuplicates: true,
    }));
    // MySQL 은 createMany 가 id 를 안 돌려준다 — 같은 조건으로 다시 읽는다.
    await readParts();
  }

  // ② 구매 조건 — 이 청크가 닿는 부품의 협력사 분만 한 번에 읽는다(partId 가 유일 키 앞자리).
  const partIds = [...new Set([...partIdByIdentity.values()].map(String))].map((id) => BigInt(id));
  const existing = await prisma.spPartOffer.findMany({
    where: { supplier: PARTNER_SUPPLIER, partId: { in: partIds } },
    select: { id: true, partId: true, supplierSku: true, stock: true, moq: true, leadTime: true, fetchedAt: true },
  });
  const existingBySku = new Map(existing.map((offer) => [offer.supplierSku, offer]));

  const creates: { partId: bigint; supplier: string; supplierSku: string }[] = [];
  const updates: { id: bigint; data: PartnerOfferData; partId: bigint }[] = [];
  const createData = new Map<string, PartnerOfferData>();
  let projected = 0;
  for (const row of rows) {
    // 동시에 도는 다른 협력사의 미커밋 생성 때문에 재조회가 놓칠 수 있다. 조용히 건너뛰면
    // 그 행의 구매 조건이 **소리 없이 빠진다** — 개별 확보로 반드시 자리를 만든다.
    const catalogPartId = partIdByIdentity.get(identityKey(row)) ?? (await ensureCatalogPart(row));
    partIdByIdentity.set(identityKey(row), catalogPartId);
    const sku = partnerOfferSku(partnerId, row.id);
    kept.add(sku);
    touched.add(String(catalogPartId));
    const data = partnerOfferData(partnerId, row);
    const prior = existingBySku.get(sku);
    if (prior === undefined) {
      creates.push({ partId: catalogPartId, supplier: PARTNER_SUPPLIER, supplierSku: sku });
      createData.set(sku, data);
    } else if (
      prior.partId !== catalogPartId
      || prior.stock !== data.stock
      || prior.moq !== data.moq
      || prior.leadTime !== data.leadTime
      || prior.fetchedAt.getTime() !== data.fetchedAt.getTime()
    ) {
      // 품번을 고쳐 다른 부품으로 옮겨 갔으면 자리도 함께 옮긴다(옛 부품도 문서가 바뀐다).
      if (prior.partId !== catalogPartId) touched.add(String(prior.partId));
      updates.push({ id: prior.id, data, partId: catalogPartId });
    }
    projected += 1;
  }

  if (creates.length > 0) {
    await withWriteRetry(() => prisma.spPartOffer.createMany({
      data: creates.flatMap((offer) => {
        const data = createData.get(offer.supplierSku);
        return data === undefined ? [] : [{
          partId: offer.partId,
          supplier: offer.supplier,
          supplierSku: offer.supplierSku,
          stock: data.stock,
          moq: data.moq,
          leadTime: data.leadTime,
          rawJson: data.rawJson,
          fetchedAt: data.fetchedAt,
        }];
      }),
      skipDuplicates: true,
    }));
  }
  for (const update of updates) {
    await withWriteRetry(() => prisma.spPartOffer.update({
      where: { id: update.id },
      data: { ...update.data, partId: update.partId },
    }));
  }
  return projected;
}


/**
 * 협력사 원장 전체를 카탈로그에 다시 투영한다(반영·비우기·일괄 토글용). 멱등하다.
 *
 * 전체 교체 업로드는 원장을 통째로 갈아 끼우므로 여기서도 "지금 활성인 행"으로 맞추고
 * 남은 구매 조건을 지운다. 지워도 `sp_part` 는 남긴다 — 견적 행이 `partId` 로 참조하고
 * 있고(FK 없는 느슨한 참조라 DB 가 막아 주지 않는다) 같은 품번이 다시 올라오면 그 행을
 * 재사용하기 때문이다. 남은 껍데기는 색인 밖이라 검색을 해치지 않는다.
 */
export async function projectPartnerPartsToCatalog(
  partnerId: bigint,
): Promise<{ offers: number; removed: number; indexed: number }> {
  // 문서가 바뀐 부품만 모아 마지막에 한 번 색인한다. 협력사 전용 부품은 **색인돼야**
  // 단일검색이 품번으로 찾을 수 있고, 공존 부품은 `hasPartnerStock` 이 바뀌므로 갱신이 필요하다.
  const touched = new Set<string>();
  const kept = new Set<string>();
  let offers = 0;
  let cursor: bigint | null = null;
  for (;;) {
    const rows: (CatalogProjectionRow & { partnerId: bigint })[] =
      await prisma.spPartnerPart.findMany({
        where: { partnerId, isActive: true, ...(cursor === null ? {} : { id: { gt: cursor } }) },
        select: { ...PROJECTION_SELECT, partnerId: true },
        orderBy: { id: 'asc' },
        take: CHUNK,
      });
    const last = rows[rows.length - 1];
    if (last === undefined) break;
    cursor = last.id;
    offers += await projectChunk(partnerId, rows, kept, touched);
  }
  // 이 협력사 몫만 정리한다 — SKU 접두가 곧 소유권이다.
  let removed = 0;
  let scanned = 0;
  for (;;) {
    const stale: { id: bigint; supplierSku: string; partId: bigint }[] = await prisma.spPartOffer.findMany({
      where: {
        supplier: PARTNER_SUPPLIER,
        supplierSku: { startsWith: `${String(partnerId)}:` },
      },
      select: { id: true, supplierSku: true, partId: true },
      orderBy: { id: 'asc' },
      skip: scanned,
      take: CHUNK,
    });
    if (stale.length === 0) break;
    const dropped = stale.filter((offer) => !kept.has(offer.supplierSku));
    // 구매 조건이 빠지는 부품도 문서가 바뀐다 — 마지막 하나가 빠지면 색인에서 통째로 내려간다.
    for (const offer of dropped) touched.add(String(offer.partId));
    const drop = dropped.map((offer) => offer.id);
    if (drop.length > 0) {
      await prisma.spPartOffer.deleteMany({ where: { id: { in: drop } } });
      removed += drop.length;
    }
    // 지운 만큼은 다음 페이지에서 자리가 당겨지므로 남긴 개수만 건너뛴다.
    scanned += stale.length - drop.length;
  }
  const { indexed } = await indexChangedParts([...touched].map((id) => BigInt(id)));
  return { offers, removed, indexed };
}

/**
 * 원장이 사라진 협력사 구매 조건 청소 — 조직 삭제처럼 **원장을 우회해 지워지는 경로**의
 * 뒤처리다. `sp_partner_part` 는 조직 삭제에 cascade 로 딸려 가지만 카탈로그 쪽 구매
 * 조건에는 FK 가 없어(대량 교체를 청크로 돌기 위해 일부러 안 걸었다) 그대로 남는다.
 *
 * SKU 가 `{partnerId}:{원장 행 id}` 라 원장 행 존재만 보면 고아를 판별할 수 있다.
 * `sp_part` 는 지우지 않는다 — 견적 행이 partId 로 참조하고, 색인 밖이라 해롭지 않다.
 */
export async function purgeOrphanPartnerOffers(partnerId?: bigint): Promise<number> {
  let removed = 0;
  let scanned = 0;
  for (;;) {
    const offers: { id: bigint; supplierSku: string }[] = await prisma.spPartOffer.findMany({
      where: {
        supplier: PARTNER_SUPPLIER,
        ...(partnerId === undefined ? {} : { supplierSku: { startsWith: `${String(partnerId)}:` } }),
      },
      select: { id: true, supplierSku: true },
      orderBy: { id: 'asc' },
      skip: scanned,
      take: CHUNK,
    });
    if (offers.length === 0) break;
    const ledgerIds = offers.flatMap((offer) => {
      const raw = offer.supplierSku.split(':')[1];
      return raw === undefined || !/^\d+$/.test(raw) ? [] : [BigInt(raw)];
    });
    const alive = new Set(
      (await prisma.spPartnerPart.findMany({
        where: { id: { in: ledgerIds } },
        select: { id: true },
      })).map((row) => String(row.id)),
    );
    const drop = offers
      .filter((offer) => !alive.has(offer.supplierSku.split(':')[1] ?? ''))
      .map((offer) => offer.id);
    if (drop.length > 0) {
      await prisma.spPartOffer.deleteMany({ where: { id: { in: drop } } });
      removed += drop.length;
    }
    scanned += offers.length - drop.length;
  }
  return removed;
}

// ── 조회 DTO ────────────────────────────────────────────────────────────────
const toFlags = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((flag): flag is string => typeof flag === 'string') : [];

export const toPartnerPartRow = (
  part: SpPartnerPart & { upload?: { createdAt: Date } | null; partner?: { name: string } | null },
): PartnerPartRowType => ({
  partId: Number(part.id),
  partnerId: Number(part.partnerId),
  partnerName: part.partner?.name ?? null,
  uploadId: Number(part.uploadId),
  mpn: part.mpn,
  mpnRaw: part.mpnRaw,
  manufacturer: part.manufacturer,
  description: part.description,
  stockQty: part.stockQty,
  dateCode: part.dateCode,
  leadTime: part.leadTime,
  unitPrice: part.unitPrice === null ? null : Number(part.unitPrice),
  currency: part.currency,
  moq: part.moq,
  sourceSheetName: part.sourceSheetName,
  sourceRow: part.sourceRow,
  flags: toFlags(part.flags),
  isActive: part.isActive,
  uploadedAt: (part.upload?.createdAt ?? part.createdAt).toISOString(),
  editedAt: part.editedAt?.toISOString() ?? null,
  editedBy: part.editedBy,
});

/** 사람이 고친 행에 붙는 플래그 — 파일 원문과 다르다는 표시. */
export const PARTNER_PART_EDITED_FLAG = 'manually_edited';

/**
 * 원장 행 하나를 고친다(전체 재업로드 없이).
 *
 * 품번이 바뀌면 **조회 키를 다시 만든다** — 안 하면 화면엔 새 품번이 보이는데 BOM 검색은
 * 옛 품번으로 걸리는 어긋남이 생긴다. 엔진이 준 대체 후보(alternative)는 이제 원문
 * 기준이라 의미를 잃으므로 버리고, 사람이 확정한 품번 하나만 남긴다.
 * 원문 `mpnRaw` 는 절대 건드리지 않는다(무유실 — 파일에 뭐라 적혀 있었는지가 남아야 한다).
 */
export async function updatePartnerPart(
  partId: bigint,
  patch: PartnerPartUpdateBodyType,
  editedBy: string,
): Promise<PartnerPartRowType | null> {
  const current = await prisma.spPartnerPart.findUnique({ where: { id: partId } });
  if (current === null) return null;

  const nextMpn = patch.mpn?.trim();
  const mpnChanged = nextMpn !== undefined && nextMpn !== current.mpn;
  const nextMpnNorm = mpnChanged ? normalizeMpn(nextMpn) : current.mpnNorm;
  if (mpnChanged && nextMpnNorm === '') {
    throw new PartnerPartEditError('품번에 사용할 수 있는 문자가 없습니다.');
  }
  // 빈 문자열은 "지움"으로 읽는다 — `??` 는 빈 문자열을 통과시키므로 쓸 수 없다.
  const blank = (value: string | null | undefined, max: number): string | null => {
    const text = value?.trim() ?? '';
    return text === '' ? null : text.slice(0, max);
  };
  const manufacturer =
    patch.manufacturer === undefined ? current.manufacturer : blank(patch.manufacturer, 191);
  const flags = new Set(toFlags(current.flags));
  flags.add(PARTNER_PART_EDITED_FLAG);
  if (mpnChanged) {
    // 사람이 확정했으므로 추출기가 남긴 품번 검토 표시는 더 이상 유효하지 않다.
    for (const stale of [
      'mpn_needs_review',
      'mpn_replacement_char',
      'mpn_brand_suffix_stripped',
      'mpn_quantity_suffix_stripped',
      'mpn_comma_suffix_alternative',
      'part_number_missing',
    ]) {
      flags.delete(stale);
    }
  }
  if (manufacturer !== null) flags.delete('manufacturer_from_part_number');

  const updated = await prisma.spPartnerPart.update({
    where: { id: partId },
    data: {
      ...(nextMpn === undefined ? {} : { mpn: nextMpn.slice(0, 191), mpnNorm: nextMpnNorm.slice(0, 191) }),
      ...(patch.manufacturer === undefined
        ? {}
        : {
            manufacturer,
            manufacturerNorm: resolveManufacturer(manufacturer ?? '').norm.slice(0, 191),
          }),
      ...(patch.description === undefined
        ? {}
        : { description: blank(patch.description, 500) }),
      ...(patch.stockQty === undefined ? {} : { stockQty: patch.stockQty }),
      ...(patch.dateCode === undefined
        ? {}
        : { dateCode: blank(patch.dateCode, 100) }),
      ...(patch.leadTime === undefined
        ? {}
        : { leadTime: blank(patch.leadTime, 100) }),
      ...(patch.unitPrice === undefined
        ? {}
        : { unitPrice: patch.unitPrice === null ? null : new Prisma.Decimal(patch.unitPrice) }),
      ...(patch.currency === undefined
        ? {}
        : { currency: blank(patch.currency, 8)?.toUpperCase() ?? null }),
      ...(patch.moq === undefined ? {} : { moq: patch.moq }),
      flags: [...flags],
      editedAt: new Date(),
      editedBy: editedBy.slice(0, 191),
    },
    include: { upload: { select: { createdAt: true } }, partner: { select: { name: true } } },
  });

  if (mpnChanged) {
    await prisma.spPartnerPartKey.deleteMany({ where: { partId } });
    await prisma.spPartnerPartKey.create({
      data: {
        partId,
        partnerId: current.partnerId,
        mpnNorm: nextMpnNorm.slice(0, 191),
        kind: 'canonical',
        isActive: current.isActive,
      },
    });
  }
  // 원장이 정본이므로 카탈로그 쪽 구매 조건도 같은 값으로 맞춘다(품번을 고치면 자리도 옮긴다).
  await syncPartnerPartOfferToCatalog(updated.id);
  return toPartnerPartRow(updated);
}

export class PartnerPartEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartnerPartEditError';
  }
}

export const toUploadView = (
  upload: SpPartnerPartUpload & { partner?: { name: string } | null },
  activePartCount: number,
): PartnerPartUploadViewType => {
  const stats = upload.statsJson as PartnerPartUploadStatsType | null;
  const sheets = (upload.mappingJson as { sheets?: PartnerPartPreviewSheetType[] } | null)?.sheets;
  return {
    uploadId: Number(upload.id),
    partnerId: Number(upload.partnerId),
    partnerName: upload.partner?.name ?? null,
    fileName: upload.fileName,
    fileSize: Number(upload.fileSize),
    status: asUploadStatus(upload.status),
    mode: asUploadMode(upload.mode),
    stats: stats ?? null,
    sheets: sheets ?? [],
    error: upload.error,
    uploadedBy: upload.uploadedBy,
    uploadedById: upload.uploadedById,
    appliedAt: upload.appliedAt?.toISOString() ?? null,
    createdAt: upload.createdAt.toISOString(),
    activePartCount,
  };
};

// ── BOM 검색 주입 (docs/PARTNER_PARTS.md) ───────────────────────────────────
//
// 협력사 원장을 읽는 **유일한** 경로. 별도 폴백 티어가 아니라, 외부 3사 검색과 같은
// 판정에 로컬 후보를 함께 실어 보낸다 — "기존 공급사와 같은 개념, 다만 뒤순위"라는
// 사용자 결정(2026-08-23)의 구현이다. 순서는 엔진 정렬 키(`_source_rank`)가 낸다.
//
// 값(재고·D/C·납기)은 표시용 사실로만 넘긴다. 구매 조건(offer)으로 만들지 않으므로
// 가격이 붙지 않고, 따라서 자동 선정이 금액을 만들어 내지 못한다.

/** 엔진 `catalog_metadata` 에 실어 보내는 협력사 후보 1건. */
interface PartnerLocalProduct {
  supplier: 'partner';
  manufacturer_part_number: string;
  manufacturer: string | null;
  description: string | null;
  package: string | null;
  normalized_specs: Record<string, never>;
  catalog_metadata: {
    catalogOnly: true;
    // 브랜드가 없으면 자동 선정을 막고 검토 후보로만 남긴다(재고표의 절반이 이렇다).
    autoQuoteEligible: boolean;
    apiVerificationRequired: false;
    partnerId: number;
    partnerStockQty: number | null;
    partnerDateCode: string | null;
    partnerLeadTime: string | null;
    partnerUploadedAt: string;
  };
  offers: [];
}

export interface PartnerLocalProductLookup {
  /** 엔진 주입 페이로드 — 키는 정규 품번. */
  products: Record<string, PartnerLocalProduct[]>;
  /** 화면 표기를 위한 협력사 이름(관리자에게만 노출). */
  partnerNames: Record<string, string>;
  matchedKeyCount: number;
  partCount: number;
}

/**
 * 검색 대상 품번들로 협력사 원장을 exact 조회한다.
 *
 * 정확 품번만 본다 — 스펙 호환 판정을 협력사 주장에 기대지 않는다. 한 품번을 여러
 * 협력사가 가지고 있으면 최신 업로드 순으로 상한까지만 싣는다(노이즈 완충; 제한이
 * 아니라 화면·판정을 흐리지 않기 위한 상한).
 */
export async function loadPartnerLocalProducts(
  mpnNorms: readonly string[],
  { perKeyLimit = 5 } = {},
): Promise<PartnerLocalProductLookup> {
  const keys = [...new Set(mpnNorms.filter((key) => key !== ''))];
  if (keys.length === 0) {
    return { products: {}, partnerNames: {}, matchedKeyCount: 0, partCount: 0 };
  }
  // 키 테이블에는 FK 관계를 두지 않았다(원장 교체가 잦아 대량 삭제를 청크로 도는 구조).
  // 그래서 조회는 2단계 — 키 → partId → 행. 둘 다 인덱스를 탄다.
  const hits = await prisma.spPartnerPartKey.findMany({
    where: { mpnNorm: { in: keys }, isActive: true },
    select: { mpnNorm: true, partId: true },
    orderBy: { partId: 'desc' },
  });
  if (hits.length === 0) {
    return { products: {}, partnerNames: {}, matchedKeyCount: 0, partCount: 0 };
  }
  const rows = await prisma.spPartnerPart.findMany({
    where: { id: { in: [...new Set(hits.map((hit) => hit.partId))] }, isActive: true },
    select: {
      id: true,
      partnerId: true,
      mpn: true,
      manufacturer: true,
      description: true,
      packageCode: true,
      stockQty: true,
      dateCode: true,
      leadTime: true,
      isActive: true,
      createdAt: true,
      partner: { select: { name: true, status: true, capabilities: true } },
      upload: { select: { createdAt: true, appliedAt: true } },
    },
  });
  const partById = new Map(rows.map((row) => [String(row.id), row]));

  const products: Record<string, PartnerLocalProduct[]> = {};
  const partnerNames: Record<string, string> = {};
  let partCount = 0;
  for (const hit of hits) {
    const part = partById.get(String(hit.partId));
    if (part === undefined) continue;
    // 조직이 정지되거나 트랙이 회수되면 다음 검색부터 즉시 빠진다(서버 매 요청 판정).
    if (!part.isActive || part.partner.status !== 'approved') continue;
    if (!toCapabilities(part.partner.capabilities).includes('part_sale')) continue;
    const bucket = (products[hit.mpnNorm] ??= []);
    if (bucket.length >= perKeyLimit) continue;
    const uploadedAt = part.upload.appliedAt ?? part.upload.createdAt;
    bucket.push({
      supplier: 'partner',
      manufacturer_part_number: part.mpn,
      manufacturer: part.manufacturer,
      description: part.description,
      package: part.packageCode,
      normalized_specs: {},
      catalog_metadata: {
        catalogOnly: true,
        autoQuoteEligible: part.manufacturer !== null && part.manufacturer.trim() !== '',
        apiVerificationRequired: false,
        partnerId: Number(part.partnerId),
        partnerStockQty: part.stockQty,
        partnerDateCode: part.dateCode,
        partnerLeadTime: part.leadTime,
        partnerUploadedAt: uploadedAt.toISOString(),
      },
      offers: [],
    });
    partnerNames[String(part.partnerId)] = part.partner.name;
    partCount += 1;
  }
  return {
    products,
    partnerNames,
    matchedKeyCount: Object.keys(products).length,
    partCount,
  };
}

/** 엔진 preflight 응답에서 검색 정체성(품번)을 모은다 — 계약 밖 필드는 조용히 건너뛴다. */
const PreflightPartNumbers = z
  .object({
    plan: z
      .object({
        components: z
          .array(
            z
              .object({
                part_number: z.string().nullish(),
                planned_queries: z
                  .array(z.object({ part_number: z.string().nullish() }).passthrough())
                  .default([]),
              })
              .passthrough(),
          )
          .default([]),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * preflight 결과의 품번으로 협력사 원장을 조회해 엔진 주입 페이로드를 만든다.
 *
 * 실패는 검색을 막지 않는다 — 협력사 부품은 보조 소스이므로 조회가 깨져도 기존
 * 외부 검색은 그대로 돌아야 한다(로그만 남긴다).
 */
export async function loadPartnerLocalProductsForPreflight(
  preflight: unknown,
  log?: { warn: (obj: unknown, msg: string) => void },
): Promise<PartnerLocalProductLookup> {
  const empty: PartnerLocalProductLookup = {
    products: {},
    partnerNames: {},
    matchedKeyCount: 0,
    partCount: 0,
  };
  const parsed = PreflightPartNumbers.safeParse(preflight);
  if (!parsed.success) return empty;
  const keys = new Set<string>();
  for (const component of parsed.data.plan.components) {
    for (const raw of [component.part_number, ...component.planned_queries.map((q) => q.part_number)]) {
      const norm = normalizeMpn(raw ?? '');
      if (norm !== '') keys.add(norm);
    }
  }
  if (keys.size === 0) return empty;
  try {
    return await loadPartnerLocalProducts([...keys]);
  } catch (error) {
    log?.warn({ err: error }, '협력사 보유 부품 조회 실패 — 외부 검색만 진행합니다');
    return empty;
  }
}

/**
 * 견적 품목 → 보유 협력사(관리자 전용).
 *
 * 견적요청을 누구에게 보낼지 정하는 근거다. 조회는 BOM 검색 주입과 **같은 조회 키**
 * (`sp_partner_part_key`)를 쓰므로 "후보로 떴는데 목록엔 없다" 같은 어긋남이 없다.
 * `bom_rfq` 트랙이 없는 조직도 보유 사실은 보여 주되 발송 대상에서만 뺀다.
 */
export async function loadQuoteItemPartnerHolders(
  items: readonly { id: bigint; mpn: string }[],
): Promise<{
  itemHolders: Record<string, AdminBomQuoteItemPartnerHolderType[]>;
  partnerItems: Record<string, string[]>;
}> {
  const byNorm = new Map<string, string[]>();
  for (const item of items) {
    const norm = normalizeMpn(item.mpn);
    if (norm === '') continue;
    byNorm.set(norm, [...(byNorm.get(norm) ?? []), String(item.id)]);
  }
  if (byNorm.size === 0) return { itemHolders: {}, partnerItems: {} };

  const hits = await prisma.spPartnerPartKey.findMany({
    where: { mpnNorm: { in: [...byNorm.keys()] }, isActive: true },
    select: { mpnNorm: true, partId: true },
  });
  if (hits.length === 0) return { itemHolders: {}, partnerItems: {} };
  const rows = await prisma.spPartnerPart.findMany({
    where: { id: { in: [...new Set(hits.map((hit) => hit.partId))] }, isActive: true },
    select: {
      id: true,
      partnerId: true,
      stockQty: true,
      dateCode: true,
      leadTime: true,
      createdAt: true,
      partner: { select: { name: true, status: true, capabilities: true } },
      upload: { select: { createdAt: true, appliedAt: true } },
    },
  });
  const partById = new Map(rows.map((row) => [String(row.id), row]));

  // (품목, 협력사) 단위로 합친다 — 같은 품번을 여러 lot 으로 올린 경우 재고는 합산하고
  // 데이트코드·납기는 가장 최근 업로드 값을 쓴다.
  const merged = new Map<string, AdminBomQuoteItemPartnerHolderType>();
  const itemHolders: Record<string, AdminBomQuoteItemPartnerHolderType[]> = {};
  const partnerItems: Record<string, Set<string>> = {};
  for (const hit of hits) {
    const part = partById.get(String(hit.partId));
    if (part?.partner.status !== 'approved') continue;
    const capabilities = toCapabilities(part.partner.capabilities);
    if (!capabilities.includes('part_sale')) continue;
    const uploadedAt = part.upload.appliedAt ?? part.upload.createdAt;
    for (const itemId of byNorm.get(hit.mpnNorm) ?? []) {
      const key = `${itemId}:${String(part.partnerId)}`;
      const existing = merged.get(key);
      if (existing === undefined) {
        const holder: AdminBomQuoteItemPartnerHolderType = {
          partnerId: Number(part.partnerId),
          partnerName: part.partner.name,
          stockQty: part.stockQty,
          dateCode: part.dateCode,
          leadTime: part.leadTime,
          uploadedAt: uploadedAt.toISOString(),
          rfqEligible: capabilities.includes('bom_rfq'),
        };
        merged.set(key, holder);
        (itemHolders[itemId] ??= []).push(holder);
        (partnerItems[String(part.partnerId)] ??= new Set()).add(itemId);
      } else if (part.stockQty !== null) {
        existing.stockQty = (existing.stockQty ?? 0) + part.stockQty;
      }
    }
  }
  for (const holders of Object.values(itemHolders)) {
    holders.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }
  return {
    itemHolders,
    partnerItems: Object.fromEntries(
      Object.entries(partnerItems).map(([partnerId, ids]) => [partnerId, [...ids]]),
    ),
  };
}

export interface PartnerOwnStock {
  stockQty: number | null;
  dateCode: string | null;
  leadTime: string | null;
  unitPrice: number | null;
  currency: string | null;
  moq: number | null;
  uploadedAt: string;
}

/**
 * 한 협력사의 자기 원장에서 견적 품목과 같은 품번을 찾는다 — RFQ 회신 폼 프리필용.
 *
 * **자기 것만** 본다(partnerId 스코프). 값은 제안일 뿐이고 회신은 사람이 확정한다.
 * 조회 키는 BOM 검색 주입과 같은 `sp_partner_part_key` — 후보로 뜬 것과 어긋나지 않는다.
 */
export async function loadOwnStockForItems(
  partnerId: bigint,
  items: readonly { id: bigint; mpn: string }[],
): Promise<Map<string, PartnerOwnStock>> {
  const byNorm = new Map<string, string[]>();
  for (const item of items) {
    const norm = normalizeMpn(item.mpn);
    if (norm === '') continue;
    byNorm.set(norm, [...(byNorm.get(norm) ?? []), String(item.id)]);
  }
  const result = new Map<string, PartnerOwnStock>();
  if (byNorm.size === 0) return result;

  const hits = await prisma.spPartnerPartKey.findMany({
    where: { partnerId, mpnNorm: { in: [...byNorm.keys()] }, isActive: true },
    select: { mpnNorm: true, partId: true },
  });
  if (hits.length === 0) return result;
  const rows = await prisma.spPartnerPart.findMany({
    where: { id: { in: [...new Set(hits.map((hit) => hit.partId))] }, isActive: true },
    select: {
      id: true,
      stockQty: true,
      dateCode: true,
      leadTime: true,
      unitPrice: true,
      currency: true,
      moq: true,
      upload: { select: { createdAt: true, appliedAt: true } },
    },
  });
  const partById = new Map(rows.map((row) => [String(row.id), row]));
  for (const hit of hits) {
    const part = partById.get(String(hit.partId));
    if (part === undefined) continue;
    const uploadedAt = (part.upload.appliedAt ?? part.upload.createdAt).toISOString();
    for (const itemId of byNorm.get(hit.mpnNorm) ?? []) {
      const existing = result.get(itemId);
      if (existing === undefined) {
        result.set(itemId, {
          stockQty: part.stockQty,
          dateCode: part.dateCode,
          leadTime: part.leadTime,
          unitPrice: part.unitPrice === null ? null : Number(part.unitPrice),
          currency: part.currency,
          moq: part.moq,
          uploadedAt,
        });
      } else if (part.stockQty !== null) {
        // 같은 품번 여러 lot — 재고는 합치고 나머지는 먼저 잡힌 값을 유지한다.
        existing.stockQty = (existing.stockQty ?? 0) + part.stockQty;
      }
    }
  }
  return result;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const ageDaysFrom = (date: Date | null): number | null =>
  date === null ? null : Math.max(0, Math.floor((Date.now() - date.getTime()) / DAY_MS));

/** 협력사 원장 요약 — 관리자 뒤처리 화면과 포털 배너가 같은 값을 본다. */
export async function loadPartnerPartSummary(
  partnerId: bigint,
  partnerName: string,
): Promise<PartnerPartSummaryType> {
  const [activeCount, inactiveCount, lastUpload] = await Promise.all([
    prisma.spPartnerPart.count({ where: { partnerId, isActive: true } }),
    prisma.spPartnerPart.count({ where: { partnerId, isActive: false } }),
    prisma.spPartnerPartUpload.findFirst({
      where: { partnerId, status: 'applied' },
      orderBy: { appliedAt: 'desc' },
      select: { fileName: true, appliedAt: true, createdAt: true },
    }),
  ]);
  const uploadedAt = lastUpload?.appliedAt ?? lastUpload?.createdAt ?? null;
  const ageDays = ageDaysFrom(uploadedAt);
  return {
    partnerId: Number(partnerId),
    partnerName,
    activeCount,
    inactiveCount,
    lastUploadedAt: uploadedAt?.toISOString() ?? null,
    lastUploadFileName: lastUpload?.fileName ?? null,
    ageDays,
    stale: ageDays !== null && ageDays > PARTNER_PART_STALE_AFTER_DAYS,
  };
}
