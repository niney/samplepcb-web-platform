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
