// g5(그누보드/영카트) 테이블 유틸 — prisma 스키마 밖이라 raw SQL 로만 접근한다.
// ⚠ 공유 DB: 조회는 자유, 삭제는 "여정에서 방금 만든 행"만 대장(ledger) 기준으로.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getPrisma } from './db';

export interface G5OrderRow {
  odId: string;
  status: string;
  mbId: string;
  name: string;
  invoice: string;
  time: string;
}

/** 특정 회원의 최신 주문 — 여정에서 방금 만든 주문(od_id) 식별용. */
export async function findLatestOrder(mbId: string): Promise<G5OrderRow | null> {
  const prisma = getPrisma();
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT od_id, od_status, mb_id, od_name, od_invoice, od_time
       FROM g5_shop_order WHERE mb_id = ? ORDER BY od_id DESC LIMIT 1`,
    mbId,
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    odId: String(r.od_id),
    status: String(r.od_status ?? ''),
    mbId: String(r.mb_id ?? ''),
    name: String(r.od_name ?? ''),
    invoice: String(r.od_invoice ?? ''),
    time: String(r.od_time ?? ''),
  };
}

/** 주문의 카트 행 수(정리 검증용). */
export async function countCartRows(odId: string): Promise<number> {
  const prisma = getPrisma();
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM g5_shop_cart WHERE od_id = ?`,
    odId,
  );
  return Number(rows[0]?.c ?? 0);
}

/**
 * 여정 생성 주문의 하드 정리 — 주문 헤더+카트 행 삭제.
 * ⚠ 재고 앵커: '배송'/'완료' 진입 시 옵션행 재고가 차감되므로, 삭제 전에 반드시
 * force-status 로 '입금' 이하로 되돌려 재고를 복원한 뒤 호출할 것(P4.6 원복 패턴).
 */
export async function deleteOrderHard(odId: string): Promise<void> {
  const prisma = getPrisma();
  await prisma.$executeRawUnsafe(`DELETE FROM g5_shop_cart WHERE od_id = ?`, odId);
  await prisma.$executeRawUnsafe(`DELETE FROM g5_shop_order WHERE od_id = ?`, odId);
}
