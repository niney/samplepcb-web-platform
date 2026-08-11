import { getMembersByIds, getOrderNamesByCtIds } from './g5-db';

// ── PCB 관리자 목록의 '고객명' 한 칸 ────────────────────────────────────────
// 값의 정본은 주문 시점 스냅샷(od_name) > 현재 회원 이름(mb_name) 순이다 — Case 상세
// 고객 카드(admin-case-customer.toAdminCaseCustomer)가 이미 쓰는 우선순위와 같은 사전의
// 목록 면(사용자 결정 2026-08-12). 회원이 이름을 바꿔도 지난 주문의 송장·문서와 어긋나지
// 않게 하려는 규칙이라, 목록이 다른 사전을 쓰면 같은 건이 화면마다 다른 이름으로 불린다.
// 빈 문자열 = "쓸 이름이 없다" — '이름 없음'/'비회원' 같은 표시 문구는 화면 몫이다
// (아이디는 별도 필드로 함께 실어 화면이 이름 뒤에 병기한다).

export const resolvePcbCustomerName = (
  odName: string | null | undefined,
  memberName: string | null | undefined,
): string => (odName ?? '').trim() || (memberName ?? '').trim();

/** 목록 행이 고객명을 얻기 위해 넘기는 최소 스펙 정보. */
export interface PcbCustomerSpecRef {
  specId: bigint | number;
  mbId: string | null;
  ctId: number | null;
}

/**
 * 스펙 묶음의 고객명을 한 번에 해석한다 — key = String(specId), value = 고객명(없으면 '').
 * g5 조회는 회원 1쿼리 + 주문 1쿼리로 고정한다(목록 행마다 부르면 N+1).
 */
export async function loadPcbCustomerNames(
  refs: readonly PcbCustomerSpecRef[],
): Promise<Map<string, string>> {
  const [members, orderNames] = await Promise.all([
    getMembersByIds(refs.map((r) => r.mbId).filter((id): id is string => id !== null)),
    getOrderNamesByCtIds(refs.map((r) => r.ctId).filter((id): id is number => id !== null)),
  ]);
  const out = new Map<string, string>();
  for (const ref of refs) {
    out.set(
      String(ref.specId),
      resolvePcbCustomerName(
        ref.ctId === null ? '' : orderNames.get(ref.ctId),
        ref.mbId === null ? '' : members.get(ref.mbId)?.name,
      ),
    );
  }
  return out;
}
