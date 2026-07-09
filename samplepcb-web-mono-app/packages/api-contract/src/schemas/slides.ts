import { z } from 'zod';

// ── 메인 슬라이드(홈 최상단 배너) 관리 계약 ─────────────────────────────────
// 저장 백엔드는 현재 영카트 g5_shop_banner(bn_position='메인')이지만, 계약은 bn_*
// 컬럼을 미러하지 않고 **중립형**으로 둔다 — 후일 sp_slide 신규 모델로 승격해도
// FE(sp-vue)·계약을 재사용하기 위함(결정 자문 §3: 승격 시 90%+ 재사용의 보험료).
// 이미지 실파일은 data/banner/{id} 로컬 저장, sp-php 브릿지(theme/sp-lite/inc/
// main_slider.php)가 서빙한다. 라우트는 전부 requireAdmin(JWT isAdmin) 뒤.

// 목록/단건 응답 공용. active/imageUrl 은 서버 파생값(요청엔 없음).
export const Slide = z.object({
  id: z.number().int(), // 슬라이드 식별자(= g5_shop_banner.bn_id)
  title: z.string(), // 관리용 제목 / 이미지 대체텍스트(= bn_alt)
  linkUrl: z.string(), // 클릭 링크(= bn_url). 빈 문자열이면 링크 없음
  imageUrl: z.string(), // 서빙 URL(/data/banner/{id}?v=bn_time). 파생값
  newWindow: z.boolean(), // 새 창 열기(= bn_new_win)
  order: z.number().int(), // 표시 순서(= bn_order, 오름차순)
  active: z.boolean(), // 현재 노출 기간(beginAt~endAt)에 포함되는지. 파생값
  beginAt: z.string(), // 노출 시작(YYYYMMDDHHmmss, = bn_begin_time)
  endAt: z.string(), // 노출 종료(YYYYMMDDHHmmss, = bn_end_time)
});
export type SlideType = z.infer<typeof Slide>;

export const SlideListResponse = z.object({
  result: z.literal(true),
  data: z.array(Slide),
});
export type SlideListResponseType = z.infer<typeof SlideListResponse>;

export const SlideResponse = z.object({
  result: z.literal(true),
  data: Slide,
});
export type SlideResponseType = z.infer<typeof SlideResponse>;

// 생성/수정 메타. 멀티파트 요청의 `payload` 파트(JSON 문자열)로 전송되고,
// 라우트가 JSON.parse 후 이 스키마로 검증한다(이미지는 별도 파일 파트).
// device 는 계약에서 제외 — 브릿지가 pc|both 만 렌더하므로 라우트가 'both' 고정한다.
export const SlideUpsert = z.object({
  title: z.string().trim().max(255).default(''),
  linkUrl: z.string().trim().max(255).default(''),
  newWindow: z.boolean().default(false),
  beginAt: z.string().trim().max(14).default(''), // 빈값이면 라우트가 기본 시작(과거)
  endAt: z.string().trim().max(14).default(''), // 빈값이면 라우트가 기본 종료(먼 미래)
});
export type SlideUpsertType = z.infer<typeof SlideUpsert>;

// 순서 일괄 변경 — 표시 순서대로 id 배열.
export const SlideReorder = z.object({
  ids: z.array(z.number().int()).max(50),
});
export type SlideReorderType = z.infer<typeof SlideReorder>;

// 삭제 등 데이터 없는 성공 응답.
export const SlideOkResponse = z.object({
  result: z.literal(true),
});
export type SlideOkResponseType = z.infer<typeof SlideOkResponse>;
