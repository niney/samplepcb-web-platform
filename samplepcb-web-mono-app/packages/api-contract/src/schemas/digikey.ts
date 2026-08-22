import { z } from 'zod';
import { BomReceivingCandidate } from './bom-receiving';

// ── DigiKey 3-legged OAuth 연결 + Barcoding 조회(D42, docs/SMARTBOM_PARTNER_RFQ.md §6.35) ──
// Barcoding API 는 "Only 3-legged OAuth" — 관리자가 DigiKey 로그인으로 한 번 연결하고 refresh 로 유지한다.

export const DigikeyConnectionStatus = z.object({
  configured: z.boolean(), // 서버 env(클라이언트 ID·시크릿·Redirect URI)가 있는가
  redirectUri: z.string(), // DigiKey 앱에 등록해야 하는 값(문자 단위 일치)
  connected: z.boolean(), // refresh 토큰이 살아 있는가
  connectedAt: z.string().nullable(),
  connectedBy: z.string().nullable(),
  accessExpiresAt: z.string().nullable(),
  refreshExpiresAt: z.string().nullable(),
  lastRefreshAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type DigikeyConnectionStatusType = z.infer<typeof DigikeyConnectionStatus>;

export const AdminDigikeyStatusResponse = z.object({
  result: z.literal(true),
  data: DigikeyConnectionStatus,
});
export type AdminDigikeyStatusResponseType = z.infer<typeof AdminDigikeyStatusResponse>;

export const AdminDigikeyOauthStartResponse = z.object({
  result: z.literal(true),
  data: z.object({ url: z.string().url() }),
});
export type AdminDigikeyOauthStartResponseType = z.infer<typeof AdminDigikeyOauthStartResponse>;

export const DigikeyBarcodeLookup = z.object({
  kind: z.enum(['2d', '1d']),
  digiKeyPartNumber: z.string().nullable(),
  manufacturerPartNumber: z.string().nullable(),
  manufacturerName: z.string().nullable(),
  productDescription: z.string().nullable(),
  quantity: z.number().int().nullable(),
  salesorderId: z.number().nullable(),
  invoiceId: z.number().nullable(),
  purchaseOrder: z.string().nullable(),
  countryOfOrigin: z.string().nullable(),
  lotCode: z.string().nullable(),
  dateCode: z.string().nullable(),
});
export type DigikeyBarcodeLookupType = z.infer<typeof DigikeyBarcodeLookup>;

export const AdminBomReceivingDigikeyLookupBody = z.object({
  barcode: z.string().trim().min(1).max(4000),
});
export const AdminBomReceivingDigikeyLookupResponse = z.object({
  result: z.literal(true),
  data: z.object({
    lookup: DigikeyBarcodeLookup,
    candidates: z.array(BomReceivingCandidate),
  }),
});
export type AdminBomReceivingDigikeyLookupResponseType = z.infer<
  typeof AdminBomReceivingDigikeyLookupResponse
>;
