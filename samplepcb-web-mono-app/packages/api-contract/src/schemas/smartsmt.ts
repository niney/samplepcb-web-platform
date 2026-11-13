import { z } from 'zod';

// SmartSMT 연동 — 견적서 수신 계약 (docs/SMARTSMT_INTEGRATION.md).
//
// SmartSMT(바깥의 SMT 견적 계산 서버)가 확정한 견적서를 multipart 로 보낸다. 보내는 쪽은 재시도가 없고
// 실패하면 담당자가 다시 보내야 하므로, 받는 스키마는 **느슨하게** 둔다 — 꼭 필요한 칸만 검사하고
// 나머지는 모르는 칸까지 그대로 통과시킨다. 코드 값(basis·status·reason …)을 enum 으로 막지 않는다.

/** multipart 파트 이름 — 견적서 전송 양식 0.3 의 "Multipart 파트 목록". */
export const SMARTSMT_FILE_PARTS = ['gerber_archive', 'bom', 'cpl'] as const;
export type SmartsmtFilePart = (typeof SMARTSMT_FILE_PARTS)[number];

/** 견적서(envelope) — 수신 때 꼭 있어야 하는 칸만. 나머지는 passthrough. */
export const SmartsmtEnvelope = z
  .object({
    kind: z.literal('smartsmt.quote'),
    envelope_version: z.string().min(1).max(16),
    header: z
      .object({
        quote_id: z.string().min(1).max(100),
        order_id: z.string().min(1).max(100),
        made_at: z.string().min(1),
      })
      .passthrough(),
    quote: z.object({}).passthrough(),
  })
  .passthrough();
export type SmartsmtEnvelopeType = z.infer<typeof SmartsmtEnvelope>;

/**
 * 수신 응답의 사유 코드 — 실패 응답 본문 `detail.reason` 과 수신 기록(sp_smt_receive_log.reason)에 같은 값으로 남는다.
 * 인증 4종은 SmartSMT 전달 규격(docs/SMARTSMT_AUTH_REQUEST.html 3.4)과 같다.
 */
export const SMARTSMT_INBOUND_REASONS = [
  'NO_TOKEN',
  'BAD_TOKEN',
  'WRONG_AUDIENCE',
  'EXPIRED',
  /** 우리 쪽 공유 비밀이 설정되지 않음(503). */
  'NOT_CONFIGURED',
  /** multipart 가 아니거나 파트를 읽을 수 없음. */
  'INVALID_REQUEST',
  /** 파일·값 파트가 한도를 넘음(413). */
  'TOO_LARGE',
  /** envelope 파트가 없거나 꼭 있어야 하는 칸이 없음. */
  'INVALID_ENVELOPE',
  /** multipart 의 quote_id·order_id 가 견적서 안 값과 다름. */
  'ID_MISMATCH',
  /** 동봉 파일의 크기·해시가 견적서의 파일 목록과 다름. */
  'FILE_MISMATCH',
  /** 파일서버 저장 실패(502) — 다시 보내면 된다. */
  'FILE_STORE_FAILED',
] as const;
export type SmartsmtInboundReason = (typeof SMARTSMT_INBOUND_REASONS)[number];

/** 실패 응답 본문 — SmartSMT 서버가 쓰는 모양(`{"detail":{"reason","message"}}`)에 맞춘다. */
export const SmartsmtErrorBody = z.object({
  detail: z.object({ reason: z.string(), message: z.string() }),
});
export type SmartsmtErrorBodyType = z.infer<typeof SmartsmtErrorBody>;

/** 수신 성공. duplicate=true 는 같은 quote_id 를 이미 받아 둔 경우(덮어쓰지 않는다). */
export const SmartsmtInboundAccepted = z.object({
  result: z.literal(true),
  data: z.object({
    quoteId: z.string(),
    orderId: z.string(),
    duplicate: z.boolean(),
  }),
});
export type SmartsmtInboundAcceptedType = z.infer<typeof SmartsmtInboundAccepted>;
