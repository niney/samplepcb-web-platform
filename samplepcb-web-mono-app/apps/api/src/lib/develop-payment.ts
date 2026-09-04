import type { FastifyBaseLogger } from 'fastify';
import type { SpDevelopMilestone, SpDevelopRequest } from '@prisma/client';
import type { MarketContractPaymentType } from '@sp/api-contract';
import { kstToday } from '@sp/utils';
import { addDevelopEvent, transitionDevelopStatus } from './develop';
import { buildCompletedEmail, buildPaymentConfirmedEmail, sendDevelopMail, sendDevelopMailToAdmins } from './develop-email';
import { getDevelopSettings } from './develop-settings';
import { PAID_ORDER_STATUSES, deleteCartRowsByIoId, deleteQuoteOption, getMembersByIds, getOrderInfoByCtId, DEVELOP_ANCHOR_IT_ID } from './g5-db';
import { toAreaCodes } from './market';
import { prisma } from './prisma';

// ── 개발의뢰 결제·검수 lazy 승격(docs/DEVELOP_FLOW.md §4.2) — 마켓 ensureContractLazy 동형 ─────────────
// cron 없음. 의뢰를 읽거나 전이 가드를 대는 모든 지점이 `ensureDevelopLazy(request)` 를 먼저 부른다.
//  ① 마일스톤 paid: pending ∧ ctId 있는 마일스톤의 자기 카트 라인을 검증(PAID_ORDER_STATUSES ∧ io_id==paymentKey ∧
//     io_price==amount) → paid(단방향 래칫). 첫 결제면 의뢰 accepted→in_progress(startedAt).
//  ② 자동확정: delivered ∧ deliveredAt + reviewDays ≤ now → completed(confirmedBy auto, completedAt=파생값).
//  ③ 견적 만료: sent ∧ validUntil(KST) < 오늘 → expired.

const customerEmail = async (r: SpDevelopRequest): Promise<string | undefined> => {
  if (r.contactEmail.trim() !== '') return r.contactEmail.trim();
  const m = await getMembersByIds([r.mbId]);
  const email = m.get(r.mbId)?.email ?? '';
  return email === '' ? undefined : email;
};

export const deriveMilestonePayment = async (ctId: bigint | null): Promise<MarketContractPaymentType | null> => {
  if (ctId === null) return null;
  const info = await getOrderInfoByCtId(Number(ctId));
  if (info === null) return null;
  return { odId: info.odId, odStatus: info.odStatus, settleCase: info.settleCase, receiptPrice: info.receiptPrice, misu: info.misu };
};

// 마일스톤 하나를 paid 로 올린다(lazy 또는 관리자 수동). 첫 결제면 착수 전이. 성공(count==1)만 메일.
export const markMilestonePaid = async (
  m: SpDevelopMilestone,
  by: 'lazy' | 'admin',
  odId: string | null,
  log: FastifyBaseLogger,
  actorMbId: string | null = null,
): Promise<boolean> => {
  const now = new Date();
  const promoted = await prisma.$transaction(async (tx): Promise<boolean> => {
    const upd = await tx.spDevelopMilestone.updateMany({
      where: { id: m.id, status: 'pending' },
      data: { status: 'paid', paidAt: now, paidBy: by, paidOdId: odId },
    });
    if (upd.count === 0) return false;
    await addDevelopEvent(tx, m.requestId, {
      type: 'payment_confirmed',
      actorMbId,
      byAdmin: by === 'admin',
      title: `${m.title} 결제가 확인되었습니다`,
      payload: { milestoneId: Number(m.id), amount: m.amount, by, odId },
    });
    return true;
  });
  if (!promoted) return false;
  // 착수 — accepted 에서 첫 결제가 확인되면 in_progress. 이미 진행 중이면 그대로.
  const started = await transitionDevelopStatus(m.requestId, ['accepted'], 'in_progress', { mbId: actorMbId, byAdmin: by === 'admin' }, { startedAt: now });
  const r = await prisma.spDevelopRequest.findUnique({ where: { id: m.requestId } });
  if (r !== null) {
    const brief = { requestId: Number(r.id), title: r.title, serviceAreas: toAreaCodes(r.serviceAreas) };
    void sendDevelopMail(log, await customerEmail(r), buildPaymentConfirmedEmail({ ...brief, milestoneTitle: m.title, amount: m.amount, started }), {
      kind: 'develop_paid',
      refType: 'develop_request',
      refId: r.id,
      sentBy: actorMbId,
      toMbId: r.mbId,
    });
    const settings = await getDevelopSettings();
    void sendDevelopMailToAdmins(log, settings.notifyEmails, buildPaymentConfirmedEmail({ ...brief, milestoneTitle: m.title, amount: m.amount, started }), {
      kind: 'develop_admin_paid',
      refType: 'develop_request',
      refId: r.id,
      sentBy: actorMbId,
      toMbId: null,
    });
  }
  return true;
};

const ensureMilestonesPaidLazy = async (requestId: bigint, log: FastifyBaseLogger): Promise<void> => {
  const pending = await prisma.spDevelopMilestone.findMany({ where: { requestId, status: 'pending', ctId: { not: null } } });
  for (const m of pending) {
    if (m.ctId === null) continue;
    const info = await getOrderInfoByCtId(Number(m.ctId));
    if (info === null) continue;
    const linePaid = PAID_ORDER_STATUSES.includes(info.rowCtStatus) && info.rowIoId === m.paymentKey && info.rowIoPrice === m.amount;
    if (!linePaid) continue;
    await markMilestonePaid(m, 'lazy', info.odId, log);
  }
};

export const autoConfirmDate = (r: Pick<SpDevelopRequest, 'status' | 'deliveredAt' | 'reviewDays'>): Date | null =>
  r.status === 'delivered' && r.deliveredAt !== null ? new Date(r.deliveredAt.getTime() + r.reviewDays * 86_400_000) : null;

const ensureAutoConfirmLazy = async (r: SpDevelopRequest, log: FastifyBaseLogger): Promise<void> => {
  const auto = autoConfirmDate(r);
  if (auto === null || auto.getTime() > Date.now()) return;
  const ok = await transitionDevelopStatus(r.id, ['delivered'], 'completed', { mbId: null, byAdmin: false }, { completedAt: auto }, '검수 기간 경과 — 자동 확정');
  if (!ok) return;
  const brief = { requestId: Number(r.id), title: r.title, serviceAreas: toAreaCodes(r.serviceAreas) };
  void sendDevelopMail(log, await customerEmail(r), buildCompletedEmail({ ...brief, confirmedBy: 'auto', forAdmin: false }), {
    kind: 'develop_completed',
    refType: 'develop_request',
    refId: r.id,
    sentBy: null,
    toMbId: r.mbId,
  });
  const settings = await getDevelopSettings();
  void sendDevelopMailToAdmins(log, settings.notifyEmails, buildCompletedEmail({ ...brief, confirmedBy: 'auto', forAdmin: true }), {
    kind: 'develop_admin_completed',
    refType: 'develop_request',
    refId: r.id,
    sentBy: null,
    toMbId: null,
  });
};

const ensureQuoteExpiryLazy = async (requestId: bigint): Promise<void> => {
  await prisma.spDevelopQuote.updateMany({
    where: { requestId, status: 'sent', validUntil: { lt: kstToday() } },
    data: { status: 'expired' },
  });
};

// 의뢰를 읽는 모든 지점의 선행 호출. 갱신본을 돌려준다.
export const ensureDevelopLazy = async (r: SpDevelopRequest, log: FastifyBaseLogger): Promise<SpDevelopRequest> => {
  await ensureMilestonesPaidLazy(r.id, log);
  await ensureQuoteExpiryLazy(r.id);
  const mid = (await prisma.spDevelopRequest.findUnique({ where: { id: r.id } })) ?? r;
  await ensureAutoConfirmLazy(mid, log);
  return (await prisma.spDevelopRequest.findUnique({ where: { id: r.id } })) ?? mid;
};

// 견적 철회·의뢰 취소 시 대기 마일스톤 정리 — 잔존 '쇼핑' 카트행은 코어 buy 경로로 취소된 건을 결제할 수 있는 구멍.
export const cancelPendingMilestones = async (where: { requestId: bigint } | { quoteId: bigint }): Promise<void> => {
  const rows = await prisma.spDevelopMilestone.findMany({ where: { ...where, status: { in: ['draft', 'pending'] } } });
  if (rows.length === 0) return;
  await prisma.spDevelopMilestone.updateMany({ where: { id: { in: rows.map((m) => m.id) } }, data: { status: 'cancelled' } });
  for (const m of rows) {
    await deleteCartRowsByIoId(m.paymentKey).catch(() => 0);
    await deleteQuoteOption(DEVELOP_ANCHOR_IT_ID, m.paymentKey).catch(() => undefined);
  }
};
