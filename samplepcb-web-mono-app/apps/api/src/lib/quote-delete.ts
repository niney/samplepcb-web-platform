// 견적 삭제 코어 — 사용자 삭제(DELETE /api/pcb-projects/:id)와 관리자 완전삭제가
// 공유하는 sp_ 테이블·거버 파일·장바구니 행 삭제 로직의 단일 진실(복붙 금지).
//   removeCartRow  — 담김(cart) 견적을 장바구니에서 빼기(ct_id 단위)
//   purgeQuoteData — 하드 삭제(실파일 먼저, 전부 성공 시에만 DB) 불변식 캡슐화
// g5_shop_order(주문) 삭제는 여기 없다 — 주문 부수효과(포인트 환급·쿠폰 롤백) 이식이
// 필요해 관리자 라우트에서 별도 헬퍼로 다룬다(g5-db 접근 카탈로그 ⑪).
import type { SpOrderSpec } from '@prisma/client';
import { deleteFromFileServer } from './file-server';
import { TEMPLATE_ITEMS, deleteCartRow, deleteQuoteOption } from './g5-db';
import { prisma } from './prisma';

// 담김(cart) 견적을 장바구니에서 빼기 — cart 행·옵션 행을 ct_id 단위로 제거.
// (코어 seldelete 는 it_id 단위라 같은 템플릿 다른 견적까지 지우므로 정밀 삭제.)
// 실패 시 throw — 호출부가 502(CART_DELETE_FAILED)로 매핑한다.
export async function removeCartRow(spec: SpOrderSpec): Promise<void> {
  if (spec.ctId === null) return;
  await deleteCartRow(spec.ctId);
  const itId = TEMPLATE_ITEMS[spec.category.toLowerCase()];
  if (itId !== undefined) await deleteQuoteOption(itId, spec.quoteId);
}

// 하드 삭제 — 실파일(파일서버) 먼저, 전부 성공했을 때만 DB 삭제(순서 불변식).
// 반대로 하면 실패 시 pathToken 이 사라져 고아 파일이 영구히 남는다. 파일 삭제 실패
// 시 throw(→ 호출부 502) 하고 spec 을 건드리지 않아, 재시도 시 그대로 멱등 재실행된다.
// 삭제 대상: 실파일 + sp_file(거버·썸네일) · 잔여 견적 옵션 행 · 현재 sp_quote · spec 본체.
// ※ 과거 재견적 sp_quote 스냅샷은 역참조가 없어 여기서 못 지운다(만료분 정리 별도 과제).
export async function purgeQuoteData(spec: SpOrderSpec): Promise<void> {
  const files = await prisma.spFile.findMany({
    where: { refType: 'sp_order_spec', refId: spec.id },
    select: { pathToken: true },
  });
  for (const f of files) {
    await deleteFromFileServer(f.pathToken);
  }
  // 코어 cartupdate 삭제 경로는 deleteQuoteOption 을 안 타 옵션 행이 남을 수 있어 정리
  const itId = TEMPLATE_ITEMS[spec.category.toLowerCase()];
  if (itId !== undefined) {
    await deleteQuoteOption(itId, spec.quoteId);
  }
  await prisma.$transaction([
    prisma.spFile.deleteMany({ where: { refType: 'sp_order_spec', refId: spec.id } }),
    prisma.spQuote.deleteMany({ where: { id: spec.quoteId } }),
    prisma.spOrderSpec.delete({ where: { id: spec.id } }),
  ]);
}
