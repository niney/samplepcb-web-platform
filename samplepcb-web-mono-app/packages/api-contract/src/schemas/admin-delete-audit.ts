import { z } from 'zod';

// 삭제 기록(sp_delete_audit)과 취소 견적 자동 정리 상태 — 관리자 "삭제 기록" 화면 계약.
//
// 감사 원장은 관리자 강제 삭제(BOM·PCB Case)와 보존 기간 자동 정리가 함께 쌓는다. 자동 정리는
// 사람 계정과 겹치지 않는 실행자 표식으로 구분한다.

/** 자동 정리가 감사 기록에 남기는 실행자 — mb_id 에는 콜론이 올 수 없어 사람 계정과 겹치지 않는다. */
export const DELETE_AUDIT_SYSTEM_ACTOR = 'system:retention';

export const AdminDeleteAuditItem = z.object({
  auditId: z.number(),
  subjectType: z.string(), // bom_case | pcb_case (확장 대비 문자열)
  subjectId: z.string(),
  title: z.string(),
  /** 대상 소유자(고객 mb_id). */
  mbId: z.string(),
  /** 삭제 시점의 대상 상태. */
  subjectStatus: z.string(),
  actorMbId: z.string(),
  /** 보존 기간 자동 정리가 남긴 기록인지(실행자가 시스템 표식). */
  automatic: z.boolean(),
  reason: z.string(),
  /** 삭제 직전 영향 스냅샷 — 대상 종류마다 모양이 다르다(화면은 아는 칸만 요약하고 나머지는 원문). */
  snapshot: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type AdminDeleteAuditItemType = z.infer<typeof AdminDeleteAuditItem>;

export const AdminDeleteAuditListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  subjectType: z.enum(['bom_case', 'pcb_case']).optional(),
  /** auto = 보존 기간 자동 정리, manual = 관리자 강제 삭제. */
  actor: z.enum(['auto', 'manual']).optional(),
  /** 제목·고객 ID·대상 번호 부분 일치. */
  search: z.string().trim().min(1).max(100).optional(),
  /** KST 일자 범위(YYYY-MM-DD, 양끝 포함). */
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type AdminDeleteAuditListQueryType = z.infer<typeof AdminDeleteAuditListQuery>;

export const AdminDeleteAuditListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminDeleteAuditItem),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});
export type AdminDeleteAuditListResponseType = z.infer<typeof AdminDeleteAuditListResponse>;

// ── 취소 견적 자동 정리(보존 기간 배치) ─────────────────────────────────────

/** 정리 한 번의 결과 요약 — sp_config 한 행에 덮어쓴다(이력은 감사 원장이 맡는다). */
export const BomQuoteRetentionRun = z.object({
  trigger: z.enum(['timer', 'manual']),
  /** 수동 실행한 관리자 mb_id — 타이머 실행은 null. */
  actorMbId: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string(),
  retentionDays: z.number().int(),
  /** 이번 실행 시점에 기한이 지나 있던 취소 견적 수. */
  due: z.number().int(),
  deleted: z.number().int(),
  /** 삭제를 막는 사정(진행 중인 작업·주문 연결 등)이 있어 건드리지 않은 견적. */
  skipped: z.array(
    z.object({ quoteId: z.string(), title: z.string(), blockers: z.array(z.string()) }),
  ),
  /** 삭제를 시도했지만 실패한 견적(엔진·파일서버·DB 오류) — 다음 주기에 다시 시도한다. */
  failed: z.array(z.object({ quoteId: z.string(), title: z.string(), error: z.string() })),
  /** 1회 처리 상한 때문에 다음 주기로 미룬 건수. */
  deferred: z.number().int(),
});
export type BomQuoteRetentionRunType = z.infer<typeof BomQuoteRetentionRun>;

/**
 * 정상 여부 —
 *   ok       마지막 실행이 두 주기 안에 있고, 지웠어야 할 견적이 남아 있지 않다
 *   stale    마지막 실행이 없거나 두 주기보다 오래됐다(배치가 돌지 않는다)
 *   backlog  기한이 지났는데 지난 실행 뒤에도 남아 있는 견적이 있다
 *   disabled 보존 기간이 0 이라 자동 정리가 꺼져 있다
 */
export const BomQuoteRetentionHealth = z.enum(['ok', 'stale', 'backlog', 'disabled']);
export type BomQuoteRetentionHealthType = z.infer<typeof BomQuoteRetentionHealth>;

export const BomQuoteRetentionOverdueItem = z.object({
  quoteId: z.string(),
  title: z.string(),
  mbId: z.string(),
  canceledAt: z.string().nullable(),
  purgeAfter: z.string(),
  /** 마지막 실행이 남긴 사정 — 차단 사유 코드 또는 오류 문구. 기록이 없으면 빈 배열. */
  reasons: z.array(z.string()),
});
export type BomQuoteRetentionOverdueItemType = z.infer<typeof BomQuoteRetentionOverdueItem>;

export const AdminBomQuoteRetentionStatus = z.object({
  health: BomQuoteRetentionHealth,
  /** 지금 적용 중인 보존 기간(일). 0 = 꺼짐. 이미 취소된 견적은 취소 당시 약속한 날을 그대로 따른다. */
  retentionDays: z.number().int(),
  /** 정리 주기(시간). */
  intervalHours: z.number(),
  lastRun: BomQuoteRetentionRun.nullable(),
  /** 지난 실행 때 지웠어야 하는데 아직 남아 있는 취소 견적 — 데이터에서 직접 센다. */
  overdueCount: z.number().int(),
  overdue: z.array(BomQuoteRetentionOverdueItem),
  /** 아직 기한이 오지 않았거나 다음 주기를 기다리는 취소 견적 수. */
  pendingCount: z.number().int(),
  /** 삭제 대기 중 가장 가까운 삭제 예정 시각. */
  nextPurgeAfter: z.string().nullable(),
});
export type AdminBomQuoteRetentionStatusType = z.infer<typeof AdminBomQuoteRetentionStatus>;

export const AdminBomQuoteRetentionStatusResponse = z.object({
  result: z.literal(true),
  data: AdminBomQuoteRetentionStatus,
});
export type AdminBomQuoteRetentionStatusResponseType = z.infer<
  typeof AdminBomQuoteRetentionStatusResponse
>;

/** "지금 실행" — 이미 도는 중이면 409, 꺼져 있으면 409. */
export const AdminBomQuoteRetentionRunResponse = z.object({
  result: z.literal(true),
  data: z.object({ run: BomQuoteRetentionRun, status: AdminBomQuoteRetentionStatus }),
});
export type AdminBomQuoteRetentionRunResponseType = z.infer<typeof AdminBomQuoteRetentionRunResponse>;
