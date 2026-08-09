// 확정가(판매가) 등록 코어 — admin-pcb-projects PATCH price 와 "선정+확정가 한 번에"
// (admin-pcb-rfqs select, 레거시 선정 모달 통합 복원)가 공유한다.
//
// 게이트는 RFQ 게이트(D10 — 진행 중 주문 허용)와 다르다: 판매가는 불변 원칙이라
// 담김·주문됨 전부 거부. 유령 active(cart 행 소실)는 사용자 lazy reconcile 과 동일하게
// 보관함(deleted)으로 정리한 뒤 거부한다(유령 건에 확정하는 것 방지 — 기존 라우트 승계).
import type { SpOrderSpec } from '@prisma/client';
import { getCartStates } from './g5-db';
import { prisma } from './prisma';

export interface PcbPriceGateFail {
  ok: false;
  /** ApiError 응답 매핑용 — FE 에러 사전이 읽는 코드 */
  error: 'NOT_ACTIVE' | 'IN_CART' | 'ALREADY_ORDERED';
  message: string;
  /** 게이트 실패는 전부 충돌(409) — 스펙 없음(404)은 null 반환으로 구분한다. */
  status: 409;
}

export type PcbPriceGateResult = { ok: true; spec: SpOrderSpec } | PcbPriceGateFail | null;

/** 확정가 게이트 — null=스펙 없음(404 몫), 실패 객체는 그대로 409 응답으로. */
export const checkPcbPriceGate = async (specId: bigint): Promise<PcbPriceGateResult> => {
  const spec = await prisma.spOrderSpec.findFirst({ where: { id: specId } });
  if (spec === null) return null;
  if (spec.status !== 'active') {
    return { ok: false, error: 'NOT_ACTIVE', message: '활성 상태의 견적이 아닙니다', status: 409 };
  }
  if (spec.ctId !== null) {
    const state = (await getCartStates([spec.ctId])).get(spec.ctId);
    if (state === 'cart') {
      return {
        ok: false,
        error: 'IN_CART',
        message: '장바구니에 담긴 견적은 확정할 수 없습니다',
        status: 409,
      };
    }
    if (state === 'ordered') {
      return { ok: false, error: 'ALREADY_ORDERED', message: '이미 주문된 견적입니다', status: 409 };
    }
    // 유령 active — 보관함으로 정리 후 거부(쓰기 라우트 공통 방어).
    await prisma.spOrderSpec.update({ where: { id: spec.id }, data: { status: 'deleted' } });
    return {
      ok: false,
      error: 'NOT_ACTIVE',
      message: '장바구니에서 삭제된 견적입니다 (보관함으로 이동됨)',
      status: 409,
    };
  }
  return { ok: true, spec };
};

export interface ConfirmPcbPriceOk {
  ok: true;
  projectId: number;
  finalPrice: number;
  pricedBy: string;
  pricedAt: Date;
}

/** 확정가 등록 — 게이트 통과 후 조건부 updateMany(소프트 삭제 레이스 최소 방어). */
export const confirmPcbFinalPrice = async (
  specId: bigint,
  finalPrice: number,
  mbId: string,
): Promise<ConfirmPcbPriceOk | PcbPriceGateFail | null> => {
  const gate = await checkPcbPriceGate(specId);
  if (gate?.ok !== true) return gate;

  const pricedAt = new Date();
  const updated = await prisma.spOrderSpec.updateMany({
    where: { id: specId, status: 'active' },
    data: { finalPrice, quoteStatus: 'quoted', pricedBy: mbId, pricedAt },
  });
  if (updated.count === 0) {
    return { ok: false, error: 'NOT_ACTIVE', message: '활성 상태의 견적이 아닙니다', status: 409 };
  }
  return { ok: true, projectId: Number(specId), finalPrice, pricedBy: mbId, pricedAt };
};
