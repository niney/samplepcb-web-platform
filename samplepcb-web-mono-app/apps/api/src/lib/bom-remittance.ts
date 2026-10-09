import { Prisma } from '@prisma/client';
import type { SpBomPo, SpBomRemittance } from '@prisma/client';
import type {
  AdminBomRemittanceCreateBodyType,
  BomRemittanceStatusType,
  BomRemittanceSummaryType,
  BomRemittanceViewType,
} from '@sp/api-contract';
import { asBomPartnerCurrency, roundBomAmount } from './bom-fx';
import { getPcbExchangeRate } from './exchange-rate';
import { prisma } from './prisma';

// ── BOM 송금 원장 코어(D48) — docs/SMARTBOM_PARTNER_RFQ.md §6.44 ─────────────
// 협력사 발주서 1:N 송금. PCB 송금 원장(pcb-remittance.ts)과 같은 규칙이다.
//  · 송금 통화 = 발주 통화(서버 강제) — 잔액을 같은 통화로만 뺀다.
//  · 외화는 **송금한 날의 실제 환율**로 원화를 박제한다. 발주서의 장부 환율
//    (SpBomPo.exchangeRate — 발행 시점 실제 환율)과의 차이가 환차다. 고객가에 쓴 견적 고정
//    환율과는 또 다른 값이다: 고객가(고정+마진) → 장부(발행일 실제) → 지급(송금일 실제).
//  · 지급할 금액은 호출부가 넘긴다(공급 부족 신고가 있으면 실제 공급 금액) — 이 파일은
//    발주 모듈을 읽지 않는다(순환 방지).

const parseKstDate = (s: string): Date => new Date(`${s}T00:00:00+09:00`);

/** 통화별 비교 허용 오차 — Decimal(15,2) 이라 소수 2자리 밖은 잡음이다. */
const EPSILON = 0.005;

export const bomRemittanceStatusOf = (
  poAmount: number,
  paidAmount: number,
): BomRemittanceStatusType => {
  if (paidAmount <= EPSILON) return 'unpaid';
  if (paidAmount > poAmount + EPSILON) return 'over';
  if (paidAmount >= poAmount - EPSILON) return 'paid';
  return 'partial';
};

type PoMoney = Pick<SpBomPo, 'currency' | 'exchangeRate'>;
type RemittanceRow = Pick<SpBomRemittance, 'amount' | 'remittedOn' | 'krwAmount'>;

/** 환차(원) = 실제 원화 − 장부 환율로 본 원화. 원화 발주·장부 환율 없음이면 null. */
export const bomFxDiffKrw = (po: PoMoney, row: Pick<SpBomRemittance, 'amount' | 'krwAmount'>): number | null => {
  if (asBomPartnerCurrency(po.currency) === 'KRW') return null;
  if (po.exchangeRate === null || row.krwAmount === null) return null;
  return row.krwAmount - Math.round(Number(row.amount) * Number(po.exchangeRate));
};

export const summarizeBomRemittances = (
  po: PoMoney,
  /** 지급할 금액(결제통화). */
  payable: number,
  rows: readonly RemittanceRow[],
): BomRemittanceSummaryType => {
  const currency = asBomPartnerCurrency(po.currency);
  const paid = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  const last = rows.reduce<Date | null>(
    (acc, row) => (acc === null || row.remittedOn > acc ? row.remittedOn : acc),
    null,
  );
  const diffs = rows.map((row) => bomFxDiffKrw(po, row));
  return {
    currency,
    poAmount: roundBomAmount(payable, currency),
    paidAmount: roundBomAmount(paid, currency),
    balance: roundBomAmount(payable - paid, currency),
    status: bomRemittanceStatusOf(payable, paid),
    count: rows.length,
    lastRemittedOn: last === null ? null : last.toISOString(),
    fxDiffKrw:
      currency === 'KRW' ? null : diffs.reduce<number>((sum, diff) => sum + (diff ?? 0), 0),
  };
};

export const toBomRemittanceView = (row: SpBomRemittance, po: PoMoney): BomRemittanceViewType => ({
  id: Number(row.id),
  poId: Number(row.poId),
  remittedOn: row.remittedOn.toISOString(),
  currency: row.currency,
  amount: Number(row.amount),
  exchangeRate: row.exchangeRate === null ? null : Number(row.exchangeRate),
  krwAmount: row.krwAmount,
  fxDiffKrw: bomFxDiffKrw(po, row),
  memo: row.memo,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

export const listBomRemittanceRows = (poId: bigint): Promise<SpBomRemittance[]> =>
  prisma.spBomRemittance.findMany({
    where: { poId },
    orderBy: [{ remittedOn: 'asc' }, { id: 'asc' }],
  });

/** 여러 발주서의 송금 행을 한 번에(목록 N+1 회피). */
export const loadBomRemittanceRowsByPo = async (
  poIds: readonly bigint[],
): Promise<Map<string, SpBomRemittance[]>> => {
  const map = new Map<string, SpBomRemittance[]>();
  if (poIds.length === 0) return map;
  const rows = await prisma.spBomRemittance.findMany({
    where: { poId: { in: [...poIds] } },
    orderBy: [{ remittedOn: 'asc' }, { id: 'asc' }],
  });
  for (const row of rows) {
    const key = row.poId.toString();
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return map;
};

export type CreateBomRemittanceResult =
  | { ok: true; row: SpBomRemittance }
  | { ok: false; error: 'FX_RATE_UNAVAILABLE' };

/**
 * 송금 기록 — 돈은 은행에서 사람이 보내고 여기는 사실만 적는다. 외화는 실제 환율을 받되, 비우면
 * 지금 고시 환율(없으면 발주서 장부 환율)로 채운다. 초과 지급도 막지 않는다 — 실제로 일어난 일이면
 * 적혀야 하고, 상태가 'over' 로 드러난다.
 */
export const createBomRemittance = async (
  po: Pick<SpBomPo, 'id' | 'currency' | 'exchangeRate'>,
  body: AdminBomRemittanceCreateBodyType,
  actorMbId: string,
): Promise<CreateBomRemittanceResult> => {
  const currency = asBomPartnerCurrency(po.currency);
  const amount = roundBomAmount(body.amount, currency);
  let exchangeRate: number | null = null;
  let krwAmount: number | null = null;
  if (currency !== 'KRW') {
    exchangeRate =
      body.exchangeRate ??
      (await getPcbExchangeRate(currency, 'KRW'))?.rate ??
      (po.exchangeRate === null ? null : Number(po.exchangeRate));
    if (exchangeRate === null) return { ok: false, error: 'FX_RATE_UNAVAILABLE' };
    krwAmount = Math.round(amount * exchangeRate);
  }
  const row = await prisma.spBomRemittance.create({
    data: {
      poId: po.id,
      remittedOn: parseKstDate(body.remittedOn),
      currency,
      amount: new Prisma.Decimal(amount),
      exchangeRate: exchangeRate === null ? null : new Prisma.Decimal(exchangeRate),
      krwAmount,
      memo: body.memo ?? null,
      createdBy: actorMbId,
    },
  });
  return { ok: true, row };
};
