import { z } from 'zod';

// ── 빠른 메일(§6.15) — 관리자 수동 메일: 템플릿 + Case 컨텍스트 발송 ──────────
// 진행현황·견적관리 리스트/Case 상세의 [✉] → 우하단 컴포즈 레이어. 수신 기본값 =
// Case 고객(mb_email, 수정 가능). 템플릿 변수 치환은 클라이언트 몫(서버는 그대로 발송).

export const AdminMailTemplate = z.object({
  templateId: z.number(),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  updatedAt: z.string(),
});
export type AdminMailTemplateType = z.infer<typeof AdminMailTemplate>;

export const AdminMailTemplateListResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(AdminMailTemplate) }),
});
export type AdminMailTemplateListResponseType = z.infer<typeof AdminMailTemplateListResponse>;

export const AdminMailTemplateSaveBody = z.object({
  name: z.string().trim().min(1).max(100),
  subject: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(10000),
});
export type AdminMailTemplateSaveBodyType = z.infer<typeof AdminMailTemplateSaveBody>;

export const AdminMailTemplateResponse = z.object({
  result: z.literal(true),
  data: AdminMailTemplate,
});
export type AdminMailTemplateResponseType = z.infer<typeof AdminMailTemplateResponse>;

/** 컴포즈 프리필 — 고객 이메일·이름(변수 치환 소스). 나머지 변수는 목록 행이 이미 안다. */
export const AdminQuickMailContextResponse = z.object({
  result: z.literal(true),
  data: z.object({
    toEmail: z.string().nullable(), // 회원 이메일 미등록이면 null(수동 입력)
    customerName: z.string(),
  }),
});
export type AdminQuickMailContextResponseType = z.infer<typeof AdminQuickMailContextResponse>;

/** 발송 첨부 제한(서버 검증과 동일 상수) — 이미지+PDF, 개당 10MB·합계 20MB. */
export const QUICK_MAIL_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const QUICK_MAIL_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export const AdminQuickMailSendResponse = z.object({
  result: z.literal(true),
  data: z.object({ logId: z.number() }),
});
export type AdminQuickMailSendResponseType = z.infer<typeof AdminQuickMailSendResponse>;

// ── 발송 이력(sp_mail_log) 조회 — 전 채널(email·alimtalk·sms) 공용 원장 ────────
// 모든 발송 시도(성공·실패·스킵)가 남는다. 본문(body)은 수동 메일(quick_mail)만
// 보존되며 목록에선 유무만 노출(단건 조회로 열람) — 자동 알림은 params 요약이 정본.

export const MailLogChannel = z.enum(['email', 'alimtalk', 'sms']);
export type MailLogChannelType = z.infer<typeof MailLogChannel>;

export const MailLogStatus = z.enum(['sent', 'failed', 'skipped']);
export type MailLogStatusType = z.infer<typeof MailLogStatus>;

export const AdminMailLogItem = z.object({
  logId: z.number(),
  kind: z.string(), // quick_mail|estimate|bom_rfq_request|pcb_po_issued|order_deposit…
  refType: z.string(), // bom_quote|pcb_spec|order|market_project|market_contract…
  refId: z.string(),
  channel: MailLogChannel,
  status: MailLogStatus,
  reason: z.string().nullable(),
  recipient: z.string(), // 이메일 또는 전화번호('' = PHP 브리지 등 수신처 미상)
  toMbId: z.string().nullable(),
  subject: z.string(),
  hasBody: z.boolean(),
  params: z.record(z.string(), z.unknown()).nullable(),
  attachments: z
    .array(z.object({ name: z.string(), size: z.number(), mime: z.string() }))
    .nullable(),
  sentBy: z.string().nullable(), // 트리거 주체 mbId — null=시스템(매직링크·자동전이)
  createdAt: z.string(),
});
export type AdminMailLogItemType = z.infer<typeof AdminMailLogItem>;

export const AdminMailLogListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  refType: z.string().trim().min(1).max(24).optional(),
  refId: z.string().trim().min(1).max(64).optional(),
  kind: z.string().trim().min(1).max(32).optional(),
  channel: MailLogChannel.optional(),
  status: MailLogStatus.optional(),
  /** 수신자 부분 일치(이메일·전화번호). */
  recipient: z.string().trim().min(1).max(255).optional(),
  /** KST 일자 범위(YYYY-MM-DD, 양끝 포함). */
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type AdminMailLogListQueryType = z.infer<typeof AdminMailLogListQuery>;

export const AdminMailLogListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminMailLogItem),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});
export type AdminMailLogListResponseType = z.infer<typeof AdminMailLogListResponse>;

export const AdminMailLogDetailResponse = z.object({
  result: z.literal(true),
  data: AdminMailLogItem.extend({ body: z.string().nullable() }),
});
export type AdminMailLogDetailResponseType = z.infer<typeof AdminMailLogDetailResponse>;

/** 재발송 — 원문(body)이 보존된 수동 메일(quick_mail·email)만. 수신자만 바꿀 수 있다. */
export const AdminMailLogResendBody = z.object({
  toEmail: z.string().trim().email().max(255).optional(), // 생략 = 원본 수신자
});
export type AdminMailLogResendBodyType = z.infer<typeof AdminMailLogResendBody>;
