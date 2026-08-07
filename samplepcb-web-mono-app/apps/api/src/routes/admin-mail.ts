import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminMailLogDetailResponse,
  AdminMailLogListQuery,
  AdminMailLogListResponse,
  AdminMailTemplateListResponse,
  AdminMailTemplateResponse,
  AdminMailTemplateSaveBody,
  AdminQuickMailContextResponse,
  AdminQuickMailSendResponse,
  ApiError,
  QUICK_MAIL_MAX_FILE_BYTES,
  QUICK_MAIL_MAX_TOTAL_BYTES,
} from '@sp/api-contract';
import type { AdminMailLogItemType, AdminMailTemplateType } from '@sp/api-contract';
import type { Prisma, SpMailLog, SpMailTemplate } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { collectMultipart } from '../lib/market';
import { sendMail } from '../lib/mailer';
import { errorReason, recordMailLog } from '../lib/mail-log';
import type { MailLogMeta } from '../lib/mail-log';
import { getMembersByIds } from '../lib/g5-db';

// ── /api/admin — 빠른 메일(§6.15): 템플릿 CRUD + Case 컨텍스트 발송·이력 ──────
// 자동 알림(전이 트리거)과 별개인 관리자 수동 CS 메일. 본문은 플레인 텍스트로 받아
// 기존 메일 셸(HTML 카드)에 담는다. 첨부는 메모리 버퍼로 바로 발송(보관 없음 —
// sp_mail_log 엔 메타만). 전 라우트 requireAdmin.

const IdParams = z.object({ id: z.coerce.bigint() });

const esc = (v: string): string =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** 플레인 텍스트 본문 → 기존 알림 메일과 같은 카드 셸(줄바꿈 = <br>). */
const buildQuickMailHtml = (bodyText: string): string => `
<div style="margin:0;padding:24px 12px;background:#f5f7fb;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;">
    <tr><td style="padding:0 4px 12px;font-size:15px;font-weight:800;color:#081226;">SAMPLEPCB 스마트 BOM</td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e4eaf3;border-radius:12px;padding:24px;">
      <p style="margin:0;font-size:13px;color:#333;line-height:1.7;white-space:pre-wrap;">${esc(bodyText)}</p>
    </td></tr>
    <tr><td style="padding:12px 4px 0;font-size:11px;color:#8593ab;">
      본 메일은 샘플피씨비 담당자가 보낸 안내 메일입니다.</td></tr>
  </table>
</div>`;

const toTemplateDto = (row: SpMailTemplate): AdminMailTemplateType => ({
  templateId: Number(row.id),
  name: row.name,
  subject: row.subject,
  body: row.body,
  updatedAt: row.updatedAt.toISOString(),
});

// 이력 행 → DTO. 목록은 body 유무만(hasBody) — 원문은 단건 조회로만 연다.
const asChannel = (v: string): AdminMailLogItemType['channel'] =>
  v === 'alimtalk' ? 'alimtalk' : v === 'sms' ? 'sms' : 'email';
const asStatus = (v: string): AdminMailLogItemType['status'] =>
  v === 'failed' ? 'failed' : v === 'skipped' ? 'skipped' : 'sent';
const asAttachments = (v: Prisma.JsonValue | null): AdminMailLogItemType['attachments'] => {
  if (!Array.isArray(v)) return null;
  const items: { name: string; size: number; mime: string }[] = [];
  for (const entry of v) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const o = entry as Record<string, unknown>;
    items.push({
      name: typeof o.name === 'string' ? o.name : '',
      size: typeof o.size === 'number' ? o.size : 0,
      mime: typeof o.mime === 'string' ? o.mime : '',
    });
  }
  return items;
};
const toMailLogDto = (row: SpMailLog): AdminMailLogItemType => ({
  logId: Number(row.id),
  kind: row.kind,
  refType: row.refType,
  refId: row.refId,
  channel: asChannel(row.channel),
  status: asStatus(row.status),
  reason: row.reason,
  recipient: row.recipient,
  toMbId: row.toMbId,
  subject: row.subject,
  hasBody: row.body !== null && row.body !== '',
  params:
    row.params !== null && typeof row.params === 'object' && !Array.isArray(row.params)
      ? row.params
      : null,
  attachments: asAttachments(row.attachments),
  sentBy: row.sentBy,
  createdAt: row.createdAt.toISOString(),
});

const ALLOWED_MIME = /^(image\/|application\/pdf$)/;

export const adminMailRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── 템플릿 — 컴포즈 안에서 저장·삭제(별도 관리 화면 없음) ───────────────────
  fastify.get(
    '/mail-templates',
    { schema: { response: { 200: AdminMailTemplateListResponse } } },
    async () => {
      const rows = await prisma.spMailTemplate.findMany({ orderBy: { id: 'asc' } });
      return { result: true as const, data: { items: rows.map(toTemplateDto) } };
    },
  );

  fastify.post(
    '/mail-templates',
    { schema: { body: AdminMailTemplateSaveBody, response: { 200: AdminMailTemplateResponse } } },
    async (request) => {
      const row = await prisma.spMailTemplate.create({ data: request.body });
      return { result: true as const, data: toTemplateDto(row) };
    },
  );

  fastify.delete(
    '/mail-templates/:id',
    { schema: { params: IdParams, response: { 200: AdminMailTemplateListResponse } } },
    async (request) => {
      await prisma.spMailTemplate.deleteMany({ where: { id: request.params.id } });
      const rows = await prisma.spMailTemplate.findMany({ orderBy: { id: 'asc' } });
      return { result: true as const, data: { items: rows.map(toTemplateDto) } };
    },
  );

  // ── 발송 이력 — 전 채널 원장 조회(전역 페이지 + Case 상세 '보낸 메일' 공용) ──
  fastify.get(
    '/mail-logs',
    { schema: { querystring: AdminMailLogListQuery, response: { 200: AdminMailLogListResponse } } },
    async (request) => {
      const q = request.query;
      const where: Prisma.SpMailLogWhereInput = {
        ...(q.refType !== undefined ? { refType: q.refType } : {}),
        ...(q.refId !== undefined ? { refId: q.refId } : {}),
        ...(q.kind !== undefined ? { kind: q.kind } : {}),
        ...(q.channel !== undefined ? { channel: q.channel } : {}),
        ...(q.status !== undefined ? { status: q.status } : {}),
        ...(q.recipient !== undefined ? { recipient: { contains: q.recipient } } : {}),
        ...(q.dateFrom !== undefined || q.dateTo !== undefined
          ? {
              createdAt: {
                ...(q.dateFrom !== undefined
                  ? { gte: new Date(`${q.dateFrom}T00:00:00+09:00`) }
                  : {}),
                // dateTo 는 포함 범위 — KST 다음날 0시 미만으로 변환.
                ...(q.dateTo !== undefined
                  ? { lt: new Date(new Date(`${q.dateTo}T00:00:00+09:00`).getTime() + 86_400_000) }
                  : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.spMailLog.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        prisma.spMailLog.count({ where }),
      ]);
      return {
        result: true as const,
        data: { items: rows.map(toMailLogDto), total, page: q.page, pageSize: q.pageSize },
      };
    },
  );

  fastify.get(
    '/mail-logs/:id',
    { schema: { params: IdParams, response: { 200: AdminMailLogDetailResponse } } },
    async (request, reply) => {
      const row = await prisma.spMailLog.findUnique({ where: { id: request.params.id } });
      if (row === null) return reply.notFound('발송 이력을 찾을 수 없습니다');
      return { result: true as const, data: { ...toMailLogDto(row), body: row.body } };
    },
  );

  // ── 컴포즈 프리필 — 고객 이메일·이름(변수 치환 소스) ────────────────────────
  fastify.get(
    '/bom-quotes/:id/quick-mail-context',
    { schema: { params: IdParams, response: { 200: AdminQuickMailContextResponse } } },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findUnique({
        where: { id: request.params.id },
        select: { mbId: true },
      });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
      const member = (await getMembersByIds([quote.mbId])).get(quote.mbId);
      const email = member?.email ?? '';
      return {
        result: true as const,
        data: {
          toEmail: email === '' ? null : email,
          customerName: member?.name !== undefined && member.name !== '' ? member.name : quote.mbId,
        },
      };
    },
  );

  // ── 발송 — multipart(to·subject·body + files[]) → SMTP + 이력(sp_mail_log) ──
  fastify.post(
    '/bom-quotes/:id/quick-mail',
    { schema: { params: IdParams, response: { 200: AdminQuickMailSendResponse, 400: ApiError, 502: ApiError } } },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findUnique({
        where: { id: request.params.id },
        select: { id: true, mbId: true },
      });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');

      const { files, fields } = await collectMultipart(request);
      const to = (fields.to ?? '').trim();
      const subject = (fields.subject ?? '').trim();
      const body = (fields.body ?? '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return reply.status(400).send({ error: 'BAD_TO', message: '수신자 이메일을 확인해 주세요.' });
      }
      if (subject === '' || subject.length > 255 || body === '' || body.length > 10000) {
        return reply
          .status(400)
          .send({ error: 'BAD_CONTENT', message: '제목과 본문을 확인해 주세요.' });
      }
      const badFile = files.find(
        (f) => !ALLOWED_MIME.test(f.mimetype) || f.buffer.length > QUICK_MAIL_MAX_FILE_BYTES,
      );
      if (badFile !== undefined) {
        return reply.status(400).send({
          error: 'BAD_FILE',
          message: '첨부는 이미지·PDF, 개당 10MB 이하만 가능합니다.',
        });
      }
      const totalBytes = files.reduce((sum, f) => sum + f.buffer.length, 0);
      if (totalBytes > QUICK_MAIL_MAX_TOTAL_BYTES) {
        return reply
          .status(400)
          .send({ error: 'FILES_TOO_LARGE', message: '첨부 합계는 20MB 이하만 가능합니다.' });
      }

      // 발송 이력(§6.15→이력관리 확장) — 성공·실패 모두 기록한다(CS 근거·재발송 판단).
      // 수동 CS 메일이므로 body 원문을 보존한다(자동 알림과 달리 params 요약이 아님).
      const meta: MailLogMeta = {
        kind: 'quick_mail',
        refType: 'bom_quote',
        refId: quote.id,
        sentBy: request.user.mbId,
        toMbId: quote.mbId,
      };
      const attachmentsMeta = files.map((f) => ({
        name: f.filename,
        size: f.buffer.length,
        mime: f.mimetype,
      }));
      try {
        await sendMail({
          to,
          subject,
          html: buildQuickMailHtml(body),
          fromName: '샘플피씨비',
          fromAddress: process.env.MAIL_FROM ?? 'sales@samplepcb.co.kr',
          attachments: files.map((f) => ({
            filename: f.filename,
            content: f.buffer,
            contentType: f.mimetype,
          })),
        });
      } catch (err) {
        request.log.error({ err, to, subject }, 'quick mail send failed');
        await recordMailLog(request.log, meta, {
          channel: 'email',
          status: 'failed',
          reason: errorReason(err),
          recipient: to,
          subject,
          body,
          attachments: attachmentsMeta,
        });
        return reply
          .status(502)
          .send({ error: 'SEND_FAILED', message: '메일 발송에 실패했습니다 — 잠시 후 다시 시도해 주세요.' });
      }

      const logId = await recordMailLog(request.log, meta, {
        channel: 'email',
        status: 'sent',
        recipient: to,
        subject,
        body,
        attachments: attachmentsMeta,
      });
      return { result: true as const, data: { logId: Number(logId ?? 0) } };
    },
  );

  done();
};
