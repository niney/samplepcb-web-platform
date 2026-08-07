import type { FastifyBaseLogger } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

// ── 발송 이력 원장(sp_mail_log) 기록 ─────────────────────────────────────────
// 모든 채널(email·alimtalk·sms)의 발송 시도를 한 테이블에 남긴다. 기록은 발송의
// 부수 원장이지 발송 조건이 아니다 — recordMailLog 는 어떤 경우에도 throw 하지
// 않고, 기록 실패는 서버 로그로만 남긴다(발송 흐름·API 응답에 영향 0).
// 본문 정책: 수동 메일(quick_mail)만 body 원문, 자동 알림은 params 요약만(비대 방지).

export type MailLogChannel = 'email' | 'alimtalk' | 'sms';
export type MailLogStatus = 'sent' | 'failed' | 'skipped';

/** 발송 컨텍스트 — 호출부만 아는 정보. 래퍼(send*Mail)가 성패와 합쳐 기록한다. */
export interface MailLogMeta {
  /** 발송 종류 코드 — 빌더 함수와 1:1(bom_rfq_request|pcb_po_issued|quick_mail…). */
  kind: string;
  /** 컨텍스트 앵커: bom_quote|pcb_spec|order|market_project|market_contract… */
  refType: string;
  refId: string | number | bigint;
  /** 트리거 주체 mbId(관리자·파트너·고객). 생략/null=시스템(매직링크·자동전이). */
  sentBy?: string | null;
  /** 수신 회원 mbId(아는 경우만). */
  toMbId?: string | null;
  /** 빌더 파라미터 요약 — 자동 알림의 body 원문 대신 남기는 표시·재현용 데이터. */
  params?: Prisma.InputJsonObject | null;
}

export interface MailLogEntry {
  channel: MailLogChannel;
  status: MailLogStatus;
  /** failed·skipped 사유 코드/요약(send_failed 상세, mail_unavailable 등). */
  reason?: string | null;
  /** 이메일 또는 전화번호. ''=발송 주체가 수신처를 모름(PHP 브리지). */
  recipient: string;
  /** 채널에 제목이 없으면(sms 등) 생략 → ''. */
  subject?: string;
  /** quick_mail 원문만 — 자동 알림은 저장하지 않는다. */
  body?: string | null;
  /** 첨부 메타([{name,size,mime}]) — 실파일은 보관하지 않는다. */
  attachments?: Prisma.InputJsonArray | null;
}

export const errorReason = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).slice(0, 255);

// ── 보존 기간(retention) — sp_config 'mail_log_retention_days' ───────────────
// 원장이 무한히 쌓이면 공유 DB가 비대해진다(BOM 스냅샷 1.7GB 교훈). 기본 180일,
// 0=무제한. 설정 UI 는 두지 않는다 — 운영에서 바꿀 일이 드물어 sp_config 직접 키로
// 충분(docs/MAIL_LOG.md 문서화). 정리는 server.ts 주기 타이머가 호출한다.

const RETENTION_KEY = 'mail_log_retention_days';
export const MAIL_LOG_RETENTION_DEFAULT_DAYS = 180;
// 1회 실행당 삭제 상한 — 대량 DELETE 락을 피하는 청크 가드(잔여는 다음 주기가 처리).
const CLEANUP_CHUNK = 1000;
const CLEANUP_MAX_CHUNKS_PER_RUN = 50;

export async function getMailLogRetentionDays(): Promise<number> {
  const row = await prisma.spConfig.findUnique({ where: { key: RETENTION_KEY } });
  if (row === null) return MAIL_LOG_RETENTION_DEFAULT_DAYS;
  const days = Number(row.value);
  return Number.isInteger(days) && days >= 0 ? days : MAIL_LOG_RETENTION_DEFAULT_DAYS;
}

/** 보존 기간 경과 행 정리(청크 삭제). 삭제 행 수 반환 — throw 하지 않는다. */
export async function cleanupExpiredMailLogs(log: FastifyBaseLogger): Promise<number> {
  try {
    const days = await getMailLogRetentionDays();
    if (days === 0) return 0; // 무제한 보존
    const cutoff = new Date(Date.now() - days * 86_400_000);
    let removed = 0;
    for (let chunk = 0; chunk < CLEANUP_MAX_CHUNKS_PER_RUN; chunk += 1) {
      const rows = await prisma.spMailLog.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: CLEANUP_CHUNK,
      });
      if (rows.length === 0) break;
      const res = await prisma.spMailLog.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
      removed += res.count;
      if (rows.length < CLEANUP_CHUNK) break;
    }
    return removed;
  } catch (err) {
    log.error({ err }, 'mail log retention cleanup failed');
    return 0;
  }
}

/** 발송 시도 1건 기록. 성공 시 로그 id, 기록 실패 시 null(throw 없음). */
export async function recordMailLog(
  log: FastifyBaseLogger,
  meta: MailLogMeta,
  entry: MailLogEntry,
): Promise<bigint | null> {
  try {
    const row = await prisma.spMailLog.create({
      data: {
        kind: meta.kind.slice(0, 32),
        refType: meta.refType.slice(0, 24),
        refId: String(meta.refId).slice(0, 64),
        channel: entry.channel,
        status: entry.status,
        reason: entry.reason ?? null,
        recipient: entry.recipient.slice(0, 255),
        toMbId: meta.toMbId ?? null,
        subject: (entry.subject ?? '').slice(0, 255),
        body: entry.body ?? null,
        sentBy: meta.sentBy ?? null,
        ...(meta.params != null ? { params: meta.params } : {}),
        ...(entry.attachments != null ? { attachments: entry.attachments } : {}),
      },
    });
    return row.id;
  } catch (err) {
    log.error(
      { err, kind: meta.kind, refType: meta.refType, refId: String(meta.refId) },
      'mail log write failed',
    );
    return null;
  }
}
