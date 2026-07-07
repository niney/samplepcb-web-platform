import type { FastifyBaseLogger } from 'fastify';
import type { SpFile, SpMarketContract } from '@prisma/client';
import { MARKET_CONTRACT_STATUSES } from '@sp/api-contract';
import type {
  MarketConfirmTypeType,
  MarketContractPaymentType,
  MarketContractStatusType,
  MarketContractSummaryType,
  MarketContractType,
} from '@sp/api-contract';
import {
  MARKET_ANCHOR_IT_ID,
  PAID_ORDER_STATUSES,
  deleteCartRowsByIoId,
  deleteQuoteOption,
  getMembersByIds,
  getOrderInfoByCtId,
} from './g5-db';
import {
  buildContractConfirmedEmail,
  buildContractPaidEmail,
  sendMarketMail,
} from './market-email';
import { toFileMeta } from './market';
import { prisma } from './prisma';

// ── 재능마켓 계약(2차) 공용 헬퍼 — 라우트(market-contracts·admin-market-contracts·
//    market-projects·market-bids)가 공유한다 ─────────────────────────────────────
// paid 승격·7일 자동확정은 cron 없는 lazy write-back — 계약을 읽거나 전이 가드를 대는 모든
// 지점에서 ensureContractLazy 를 선행 호출해 "승격 전의 옛 상태를 믿고 전이하는 구멍"(H1)을
// 막는다. 승격/확정 tx 는 조건부 updateMany count===1 게이트 뒤에서만 메일을 보낸다(중복 방지).

export const AUTO_CONFIRM_DAYS = 7;
const AUTO_CONFIRM_MS = AUTO_CONFIRM_DAYS * 86_400_000;

// String 컬럼 → 계약 리터럴 유니온 내로잉(직렬화 실패 방지, market lib asXxx 관례).
export const asContractStatus = (v: string): MarketContractStatusType =>
  (MARKET_CONTRACT_STATUSES as readonly string[]).includes(v)
    ? (v as MarketContractStatusType)
    : 'pending';

export const asConfirmType = (v: string | null): MarketConfirmTypeType | null =>
  v === 'auto' ? 'auto' : v === 'client' ? 'client' : null;

// 자동확정 예정 시각 = deliveredAt + 7일. delivered ∧ hold 아님 ∧ deliveredAt 있음 일 때만
// 값(자동확정 D-day 표시·스윕 판정). 그 외 상태에서는 개념 자체가 없어 null.
export const autoConfirmDate = (
  c: Pick<SpMarketContract, 'status' | 'holdAt' | 'deliveredAt'>,
): Date | null => {
  if (c.status !== 'delivered' || c.holdAt !== null || c.deliveredAt === null) return null;
  return new Date(c.deliveredAt.getTime() + AUTO_CONFIRM_MS);
};

// 수수료 = round(amount×bp/10000), 실수령 = amount − fee. 채택 시점 스냅샷 계산(award).
export const computeContractFee = (
  amount: number,
  feeRateBp: number,
): { feeAmount: number; payoutAmount: number } => {
  const feeAmount = Math.round((amount * feeRateBp) / 10000);
  return { feeAmount, payoutAmount: amount - feeAmount };
};

// od 파생 결제 정보(영카트 주문 존재 시만) — ctId 없거나 주문 헤더 없으면 null(담김만 = 미결제).
export const deriveContractPayment = async (
  ctId: number | null,
): Promise<MarketContractPaymentType | null> => {
  if (ctId === null) return null;
  const info = await getOrderInfoByCtId(ctId);
  if (info === null) return null;
  return {
    odId: info.odId,
    odStatus: info.odStatus,
    settleCase: info.settleCase,
    receiptPrice: info.receiptPrice,
    misu: info.misu,
  };
};

type ContractFileRow = Pick<SpFile, 'id' | 'fileType' | 'originFileName' | 'size'>;

// 당사자용 계약 상세 DTO — 수수료/실수령은 양 당사자 모두 실값 노출(수수료 정책은 공개 정보).
// 민감값(계좌·contractKey·ctId·paidOdId·pathToken)은 필드 자체를 담지 않는다(구조적 비노출).
export const toMarketContract = (
  c: SpMarketContract,
  files: ContractFileRow[],
  payment: MarketContractPaymentType | null,
): MarketContractType => ({
  contractId: Number(c.id),
  projectId: Number(c.projectId),
  bidId: Number(c.bidId),
  status: asContractStatus(c.status),
  amount: c.amount,
  feeRateBp: c.feeRateBp,
  feeAmount: c.feeAmount,
  payoutAmount: c.payoutAmount,
  paidAt: c.paidAt?.toISOString() ?? null,
  deliveredAt: c.deliveredAt?.toISOString() ?? null,
  deliveryNote: c.deliveryNote,
  completedAt: c.completedAt?.toISOString() ?? null,
  confirmedBy: asConfirmType(c.confirmedBy),
  settledAt: c.settledAt?.toISOString() ?? null,
  cancelledAt: c.cancelledAt?.toISOString() ?? null,
  cancelReason: c.cancelReason,
  autoConfirmAt: autoConfirmDate(c)?.toISOString() ?? null,
  files: files.map(toFileMeta),
  payment,
});

// 뷰어·목록용 경량 요약(프로젝트 상세 viewer 부착).
export const toMarketContractSummary = (c: SpMarketContract): MarketContractSummaryType => ({
  contractId: Number(c.id),
  status: asContractStatus(c.status),
  amount: c.amount,
  deliveredAt: c.deliveredAt?.toISOString() ?? null,
  autoConfirmAt: autoConfirmDate(c)?.toISOString() ?? null,
});

// ── 알림(비차단) — 전이 승격 뒤에서만 호출 ───────────────────────────────────

// ① 결제 확인 → 전문가. prisma 조회 실패는 로그만(액션 성패와 독립).
const notifyContractPaid = async (c: SpMarketContract, log: FastifyBaseLogger): Promise<void> => {
  try {
    const [project, expert, members] = await Promise.all([
      prisma.spMarketProject.findUnique({ where: { id: c.projectId }, select: { title: true } }),
      prisma.spMarketExpert.findUnique({ where: { id: c.expertId }, select: { displayName: true } }),
      getMembersByIds([c.expertMbId]),
    ]);
    void sendMarketMail(
      log,
      members.get(c.expertMbId)?.email,
      buildContractPaidEmail({
        expertName: expert?.displayName ?? '전문가',
        projectId: Number(c.projectId),
        projectTitle: project?.title ?? '',
        amount: c.amount,
        payoutAmount: c.payoutAmount,
      }),
    );
  } catch (err) {
    log.error({ err, contractId: Number(c.id) }, 'contract paid 메일 준비 실패');
  }
};

// ③ 검수 확정 → 전문가. 수동 confirm 라우트와 자동확정 승격이 공유(export).
export const notifyContractConfirmed = async (
  c: SpMarketContract,
  log: FastifyBaseLogger,
): Promise<void> => {
  try {
    const [project, expert, members] = await Promise.all([
      prisma.spMarketProject.findUnique({ where: { id: c.projectId }, select: { title: true } }),
      prisma.spMarketExpert.findUnique({ where: { id: c.expertId }, select: { displayName: true } }),
      getMembersByIds([c.expertMbId]),
    ]);
    void sendMarketMail(
      log,
      members.get(c.expertMbId)?.email,
      buildContractConfirmedEmail({
        expertName: expert?.displayName ?? '전문가',
        projectId: Number(c.projectId),
        projectTitle: project?.title ?? '',
        payoutAmount: c.payoutAmount,
      }),
    );
  } catch (err) {
    log.error({ err, contractId: Number(c.id) }, 'contract confirmed 메일 준비 실패');
  }
};

// ── lazy 승격 ────────────────────────────────────────────────────────────────

// pending ∧ ctId 있을 때 자기 카트 라인을 검증(PAID_ORDER_STATUSES ∧ io_id==contractKey ∧
// io_price==amount)해 paid 로 승격(+project awarded→working). 라인 불일치·od '주문'(무통장
// 미입금)·'취소'는 미승격. 승격은 단방향 래칫 — 이후 od 가 역행해도 paid 유지.
export const ensurePaidLazy = async (
  c: SpMarketContract,
  log: FastifyBaseLogger,
): Promise<SpMarketContract> => {
  if (c.status !== 'pending' || c.ctId === null) return c;
  const info = await getOrderInfoByCtId(c.ctId);
  if (info === null) return c;
  const linePaid =
    PAID_ORDER_STATUSES.includes(info.rowCtStatus) &&
    info.rowIoId === c.contractKey &&
    info.rowIoPrice === c.amount;
  if (!linePaid) return c;

  const now = new Date();
  const promoted = await prisma.$transaction(async (tx): Promise<boolean> => {
    const upd = await tx.spMarketContract.updateMany({
      where: { id: c.id, status: 'pending' },
      data: { status: 'paid', paidAt: now, paidOdId: info.odId },
    });
    if (upd.count === 0) return false; // 동시 승격 — 다른 요청이 처리(메일도 그쪽에서)
    await tx.spMarketProject.updateMany({
      where: { id: c.projectId, status: 'awarded' },
      data: { status: 'working' },
    });
    return true;
  });
  // 갱신본을 재조회(count===0 이어도 동시 승격 결과를 정확히 반영 — 승격 전 pending 을 믿는 구멍 차단).
  const fresh = (await prisma.spMarketContract.findUnique({ where: { id: c.id } })) ?? c;
  if (promoted) void notifyContractPaid(fresh, log);
  return fresh;
};

// delivered ∧ holdAt null ∧ deliveredAt+7d ≤ now → completed 로 자동확정(+project→completed).
// completedAt 은 실시각이 아니라 deliveredAt+7d 파생값(조회가 늦어도 확정 시각은 정확).
export const ensureAutoConfirmLazy = async (
  c: SpMarketContract,
  log: FastifyBaseLogger,
): Promise<SpMarketContract> => {
  const auto = autoConfirmDate(c);
  if (auto === null || auto.getTime() > Date.now()) return c;

  const promoted = await prisma.$transaction(async (tx): Promise<boolean> => {
    const upd = await tx.spMarketContract.updateMany({
      where: { id: c.id, status: 'delivered', holdAt: null },
      data: { status: 'completed', completedAt: auto, confirmedBy: 'auto' },
    });
    if (upd.count === 0) return false;
    await tx.spMarketProject.updateMany({
      where: { id: c.projectId, status: { in: ['awarded', 'working'] } },
      data: { status: 'completed' },
    });
    return true;
  });
  const fresh = (await prisma.spMarketContract.findUnique({ where: { id: c.id } })) ?? c;
  if (promoted) void notifyContractConfirmed(fresh, log);
  return fresh;
};

// 계약을 읽거나 전이 가드를 대는 모든 지점의 선행 호출(H1).
export const ensureContractLazy = async (
  c: SpMarketContract,
  log: FastifyBaseLogger,
): Promise<SpMarketContract> => ensureAutoConfirmLazy(await ensurePaidLazy(c, log), log);

// ── pending 계약 취소(공용) ──────────────────────────────────────────────────
// 계약 pending→cancelled + project awarded→cancelled + 카트 정리(H2: 잔존 '쇼핑' 행은 코어
// buy 경로로 취소된 계약을 결제할 수 있는 구멍). 의뢰인 취소·프로젝트 동반 취소가 공유.
// 성공(count===1) 여부를 반환한다.
export const cancelPendingContractTx = async (
  c: SpMarketContract,
  reason: string,
): Promise<boolean> => {
  const cancelled = await prisma.$transaction(async (tx): Promise<boolean> => {
    const upd = await tx.spMarketContract.updateMany({
      where: { id: c.id, status: 'pending' },
      data: { status: 'cancelled', cancelReason: reason, cancelledAt: new Date() },
    });
    if (upd.count === 0) return false;
    await tx.spMarketProject.updateMany({
      where: { id: c.projectId, status: 'awarded' },
      data: { status: 'cancelled' },
    });
    return true;
  });
  if (cancelled) {
    // g5 카트/옵션 정리는 prisma tx 밖(mysql2) — 잔존 '쇼핑' 행만 삭제(주문 라인 불변).
    await deleteCartRowsByIoId(c.contractKey);
    await deleteQuoteOption(MARKET_ANCHOR_IT_ID, c.contractKey);
  }
  return cancelled;
};
