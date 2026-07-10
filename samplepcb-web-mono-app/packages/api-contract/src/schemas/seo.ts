import { z } from 'zod';

// ── SEO 메타 관리 계약 (sp_seo, P1) ─────────────────────────────────────────
// 영카트/그누보드 코어엔 페이지별 SEO 가 없다(cf_title 전역접미사 + cf_add_meta 전역 raw).
// 관리=sp-vue(/app/admin/seo)→sp-node→Prisma sp_seo, 소비=sp-php 테마 head.sub.php 가
// 페이지 전역변수(basename+$it/$bo_table) 매칭으로 read-only 조회. 정본 docs/SEO_MANAGEMENT.md.
// nullable DB 필드는 응답에선 '' 로, upsert 요청의 '' 는 라우트가 null 로 정규화(=미설정).

// 매칭 단위. global=전역기본(1행) · page=정적페이지(basename) · item=상품(P2) · board=게시판(P3).
export const SeoScope = z.enum(['global', 'item', 'board', 'page']);
export type SeoScopeType = z.infer<typeof SeoScope>;

export const SeoRecord = z.object({
  id: z.number().int(),
  scope: SeoScope,
  refKey: z.string(), // global='' · item=it_id · board=bo_table · page=스크립트 basename
  metaTitle: z.string(), // <title> 오버라이드(''=미설정, 자동/코어 title 사용)
  metaDescription: z.string(),
  ogImage: z.string(), // 상대경로 저장 가능 — 소비측이 절대 URL 화
  canonical: z.string(), // ''=host+path 계산, 값=수동 오버라이드
  robots: z.string(), // 예: noindex,nofollow (''=기본 index,follow)
  updatedAt: z.string(),
});
export type SeoRecordType = z.infer<typeof SeoRecord>;

export const SeoListResponse = z.object({
  result: z.literal(true),
  data: z.array(SeoRecord),
});
export type SeoListResponseType = z.infer<typeof SeoListResponse>;

export const SeoResponse = z.object({
  result: z.literal(true),
  data: SeoRecord,
});
export type SeoResponseType = z.infer<typeof SeoResponse>;

// 생성/수정(upsert) — (scope, refKey) 복합키로 upsert. scope=global 은 refKey 무시(라우트가 '' 강제).
export const SeoUpsert = z.object({
  scope: SeoScope,
  refKey: z.string().trim().max(191).default(''),
  metaTitle: z.string().trim().max(255).default(''),
  metaDescription: z.string().trim().max(500).default(''),
  ogImage: z.string().trim().max(500).default(''),
  canonical: z.string().trim().max(500).default(''),
  robots: z.string().trim().max(50).default(''),
});
export type SeoUpsertType = z.infer<typeof SeoUpsert>;

// 삭제 등 데이터 없는 성공 응답.
export const SeoOkResponse = z.object({
  result: z.literal(true),
});
export type SeoOkResponseType = z.infer<typeof SeoOkResponse>;
