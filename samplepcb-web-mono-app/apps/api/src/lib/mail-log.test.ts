import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

// ── 발송 이력 원장 — 래퍼(sendBomRfqMail)와 recordMailLog 의 계약 검증 ─────────
// 핵심 불변식: ① 모든 발송 시도(성공·실패·수신자없음 스킵)가 기록된다,
// ② 기록 실패는 발송 결과를 바꾸지 않는다(원장은 부수 기록이지 발송 조건이 아님).

const mocks = vi.hoisted(() => ({
  mailLogCreate: vi.fn(),
  mailLogFindMany: vi.fn(),
  mailLogDeleteMany: vi.fn(),
  configFindUnique: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    spMailLog: {
      create: mocks.mailLogCreate,
      findMany: mocks.mailLogFindMany,
      deleteMany: mocks.mailLogDeleteMany,
    },
    spConfig: { findUnique: mocks.configFindUnique },
  },
}));
vi.mock('./mailer', () => ({ sendMail: mocks.sendMail }));

import {
  cleanupExpiredMailLogs,
  errorReason,
  getMailLogRetentionDays,
  MAIL_LOG_RETENTION_DEFAULT_DAYS,
  recordMailLog,
} from './mail-log';
import { sendBomRfqMail } from './rfq-email';

const noopLog = { error: vi.fn() } as unknown as FastifyBaseLogger;

const meta = {
  kind: 'bom_rfq_request',
  refType: 'bom_quote',
  refId: 42n,
  sentBy: 'admin1',
} as const;

/** n번째 create 호출의 data 인자 — any 전파 없이 형태만 고정해 검사한다. */
const createdData = (nth = 0): Record<string, unknown> =>
  (mocks.mailLogCreate.mock.calls[nth]?.[0] as { data: Record<string, unknown> }).data;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mailLogCreate.mockResolvedValue({ id: 7n });
  mocks.sendMail.mockResolvedValue(undefined);
  mocks.configFindUnique.mockResolvedValue(null);
  mocks.mailLogFindMany.mockResolvedValue([]);
  mocks.mailLogDeleteMany.mockResolvedValue({ count: 0 });
});

describe('recordMailLog', () => {
  it('meta·entry 를 sp_mail_log 행으로 기록하고 id 를 돌려준다', async () => {
    const id = await recordMailLog(noopLog, meta, {
      channel: 'email',
      status: 'sent',
      recipient: 'p@example.com',
      subject: '제목',
    });
    expect(id).toBe(7n);
    expect(createdData()).toMatchObject({
      kind: 'bom_rfq_request',
      refType: 'bom_quote',
      refId: '42',
      channel: 'email',
      status: 'sent',
      reason: null,
      recipient: 'p@example.com',
      subject: '제목',
      body: null,
      sentBy: 'admin1',
    });
  });

  it('DB 기록 실패는 throw 하지 않고 null 을 돌려준다', async () => {
    mocks.mailLogCreate.mockRejectedValue(new Error('db down'));
    const id = await recordMailLog(noopLog, meta, {
      channel: 'email',
      status: 'sent',
      recipient: 'p@example.com',
    });
    expect(id).toBeNull();
  });

  it('과길이 필드는 컬럼 한도로 절단한다', async () => {
    await recordMailLog(noopLog, meta, {
      channel: 'email',
      status: 'failed',
      reason: 'x'.repeat(300),
      recipient: `${'r'.repeat(300)}@example.com`,
      subject: 's'.repeat(300),
    });
    expect(createdData().recipient).toHaveLength(255);
    expect(createdData().subject).toHaveLength(255);
  });
});

describe('errorReason', () => {
  it('Error 메시지를 255자로 절단한다', () => {
    expect(errorReason(new Error('m'.repeat(400)))).toHaveLength(255);
    expect(errorReason('plain')).toBe('plain');
  });
});

describe('sendBomRfqMail — 발송·이력 결합', () => {
  const mail = { subject: '견적요청', html: '<p>hi</p>' };

  it('성공: true 반환 + sent 기록', async () => {
    const ok = await sendBomRfqMail(noopLog, 'p@example.com', mail, { ...meta });
    expect(ok).toBe(true);
    expect(mocks.sendMail).toHaveBeenCalledOnce();
    expect(createdData()).toMatchObject({
      status: 'sent',
      recipient: 'p@example.com',
      subject: '견적요청',
    });
  });

  it('수신자 없음: 발송 없이 skipped/missing_recipient 기록', async () => {
    const ok = await sendBomRfqMail(noopLog, '  ', mail, { ...meta });
    expect(ok).toBe(false);
    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(createdData()).toMatchObject({
      status: 'skipped',
      reason: 'missing_recipient',
      recipient: '',
    });
  });

  it('전송 실패: false 반환 + failed 기록(사유 포함)', async () => {
    mocks.sendMail.mockRejectedValue(new Error('SMTP connect ECONNREFUSED'));
    const ok = await sendBomRfqMail(noopLog, 'p@example.com', mail, { ...meta });
    expect(ok).toBe(false);
    expect(createdData()).toMatchObject({
      status: 'failed',
      reason: 'SMTP connect ECONNREFUSED',
    });
  });

  it('이력 기록 실패는 발송 성공 결과를 바꾸지 않는다', async () => {
    mocks.mailLogCreate.mockRejectedValue(new Error('db down'));
    const ok = await sendBomRfqMail(noopLog, 'p@example.com', mail, { ...meta });
    expect(ok).toBe(true);
  });
});

describe('보존 기간(retention)', () => {
  it('미설정·손상 값은 기본 180일, 정수 값은 그대로 읽는다', async () => {
    expect(await getMailLogRetentionDays()).toBe(MAIL_LOG_RETENTION_DEFAULT_DAYS);
    mocks.configFindUnique.mockResolvedValue({ key: 'mail_log_retention_days', value: '90' });
    expect(await getMailLogRetentionDays()).toBe(90);
    mocks.configFindUnique.mockResolvedValue({ key: 'mail_log_retention_days', value: 'abc' });
    expect(await getMailLogRetentionDays()).toBe(MAIL_LOG_RETENTION_DEFAULT_DAYS);
  });

  it('0(무제한)이면 조회 없이 아무것도 지우지 않는다', async () => {
    mocks.configFindUnique.mockResolvedValue({ key: 'mail_log_retention_days', value: '0' });
    expect(await cleanupExpiredMailLogs(noopLog)).toBe(0);
    expect(mocks.mailLogFindMany).not.toHaveBeenCalled();
    expect(mocks.mailLogDeleteMany).not.toHaveBeenCalled();
  });

  it('컷오프 이전 행을 청크로 지우고 부분 청크에서 멈춘다', async () => {
    const full = Array.from({ length: 1000 }, (_v, i) => ({ id: BigInt(i + 1) }));
    const partial = [{ id: 2000n }, { id: 2001n }];
    mocks.mailLogFindMany.mockResolvedValueOnce(full).mockResolvedValueOnce(partial);
    mocks.mailLogDeleteMany
      .mockResolvedValueOnce({ count: 1000 })
      .mockResolvedValueOnce({ count: 2 });
    const removed = await cleanupExpiredMailLogs(noopLog);
    expect(removed).toBe(1002);
    expect(mocks.mailLogFindMany).toHaveBeenCalledTimes(2);
    // 컷오프 = createdAt lt 조건으로만 지운다(전체 삭제 방지의 핵심 가드).
    const where = (mocks.mailLogFindMany.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date } };
    }).where;
    expect(where.createdAt.lt).toBeInstanceOf(Date);
  });

  it('DB 오류는 throw 하지 않고 0을 돌려준다', async () => {
    mocks.mailLogFindMany.mockRejectedValue(new Error('db down'));
    expect(await cleanupExpiredMailLogs(noopLog)).toBe(0);
  });
});
