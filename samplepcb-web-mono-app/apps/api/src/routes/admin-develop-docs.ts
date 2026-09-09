import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { SpDevelopDocument, SpDevelopRequest } from '@prisma/client';
import { z } from 'zod';
import {
  AdminDevelopDocMailBody,
  AdminDevelopDocMailRunResponse,
  AdminDevelopDocumentCreateBody,
  AdminDevelopDocumentPatchBody,
  AdminDevelopDocumentResponse,
  AdminDevelopDocumentSendBody,
  AdminDevelopTasksPutBody,
  AdminDevelopTasksResponse,
  ApiError,
  DEVELOP_DOC_ALLOWED_STATUSES,
  DEVELOP_DOC_DECISION_OPTIONS,
  DEVELOP_DOC_TYPE_LABELS,
  DevelopOkResponse,
  buildDevelopDocMailDraft,
  developDocContentEmpty,
  developDocContentIssues,
  developDocContentRows,
  developDocNo,
  emptyDevelopDocContent,
  isDevelopDocApproval,
} from '@sp/api-contract';
import type { AdminDevelopDocumentResponseType, DevelopDocContentType, DevelopRequestStatusType } from '@sp/api-contract';
import { startDevelopDocMailJob } from '../lib/ai/doc-mail-runner';
import { hashAiInput } from '../lib/ai/hash';
import { DEVELOP_DOC_MAIL_PROMPT_VERSION } from '../lib/ai/develop-doc-mail';
import { DEVELOP_DOC_MAIL_USECASE, getAiUsecaseRuntime, toOllamaThink } from '../lib/ai/usecases';
import { DEVELOP_FILE_SERVICE_TYPE, addDevelopEvent, asDevelopStatus, toDevelopAreaCodes } from '../lib/develop';
import {
  REF_DEVELOP_DOCUMENT,
  asDocType,
  buildDevelopProgress,
  currentDocumentIds,
  developDocTitle,
  developDocumentFiles,
  loadDevelopDocuments,
  loadDevelopTasks,
  toAdminDevelopDocumentView,
  toDevelopTaskView,
  toDocContent,
} from '../lib/develop-docs';
import { buildDocumentSentEmail, sendDevelopMail } from '../lib/develop-email';
import { uploadToFileServer } from '../lib/file-server';
import { collectMultipart, deleteMarketFile } from '../lib/market';
import { prisma } from '../lib/prisma';
import { customerEmailOf } from './develop-requests';

// ── /api/admin/develop/{requests/:id/documents, documents/:docId, requests/:id/tasks} — 프로젝트 문서·업무표(docs/DEVELOP_FLOW.md §13) ──
// 문서는 draft 에서만 고치고(본문·첨부·메모), 발송이 판을 고정한다(메일 제목·본문은 관리자가 확인한 그대로 저장·발송).
// 재발송은 "새 판 만들기"(revise → 같은 종류·번호, version+1 draft) → 편집 → 발송이며 이전 판은 superseded.
// 업무표는 통째 교체(PUT) — 행 편집기가 표 전체를 보낸다. 에러 봉투 ApiError{error,message}(관리자 라우트 관례).

const RequestIdParams = z.object({ id: z.string().regex(/^\d+$/) });
const DocIdParams = z.object({ docId: z.string().regex(/^\d+$/) });
const DocFileParams = z.object({ docId: z.string().regex(/^\d+$/), fileId: z.string().regex(/^\d+$/) });

const notFound = { error: 'NOT_FOUND', message: '대상이 없습니다' };
const notDraft = { error: 'DOC_NOT_DRAFT', message: '작성 중인 문서만 고칠 수 있습니다' };

const docAllowed = (status: DevelopRequestStatusType): boolean => (DEVELOP_DOC_ALLOWED_STATUSES as readonly string[]).includes(status);

export const adminDevelopDocRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  const loadDoc = async (docId: string): Promise<{ doc: SpDevelopDocument; request: SpDevelopRequest } | null> => {
    const doc = await prisma.spDevelopDocument.findUnique({ where: { id: BigInt(docId) }, include: { request: true } });
    if (doc === null) return null;
    const { request, ...rest } = doc;
    return { doc: rest, request };
  };

  const docView = async (docId: bigint): Promise<AdminDevelopDocumentResponseType['data']> => {
    const doc = await prisma.spDevelopDocument.findUniqueOrThrow({ where: { id: docId } });
    const siblings = await prisma.spDevelopDocument.findMany({ where: { requestId: doc.requestId, type: doc.type, seq: doc.seq } });
    const files = await developDocumentFiles([doc.id]);
    return toAdminDevelopDocumentView(doc, files.get(doc.id.toString()) ?? [], currentDocumentIds(siblings).has(doc.id.toString()));
  };

  const contentOr400 = (type: ReturnType<typeof asDocType>, content: DevelopDocContentType): string[] => developDocContentIssues(type, content);

  // ── POST /admin/develop/requests/:id/documents — 초안 생성 ─────────────────────
  fastify.post(
    '/develop/requests/:id/documents',
    { schema: { params: RequestIdParams, body: AdminDevelopDocumentCreateBody, response: { 200: AdminDevelopDocumentResponse, 400: ApiError, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const r = await prisma.spDevelopRequest.findUnique({ where: { id: BigInt(request.params.id) } });
      if (r === null) return reply.status(404).send(notFound);
      const status = asDevelopStatus(r.status);
      if (!docAllowed(status)) return reply.status(409).send({ error: 'INVALID_TRANSITION', message: '견적 수락(착수) 뒤에 만드는 문서입니다' });
      const { type } = request.body;
      if (type === 'delivery_confirm' && status !== 'delivered' && status !== 'completed') {
        return reply.status(409).send({ error: 'DOC_TYPE_NOT_ALLOWED', message: '납품 확인서는 납품(delivered) 뒤에 만듭니다' });
      }
      const content = request.body.content ?? emptyDevelopDocContent(type);
      const issues = contentOr400(type, content);
      if (issues.length > 0) return reply.status(400).send({ error: 'CONTENT_INVALID', message: issues.join(', ') });
      const last = await prisma.spDevelopDocument.findFirst({ where: { requestId: r.id, type }, orderBy: { seq: 'desc' }, select: { seq: true } });
      const seq = (last?.seq ?? 0) + 1;
      const created = await prisma.spDevelopDocument.create({
        data: {
          requestId: r.id,
          type,
          seq,
          version: 1,
          status: 'draft',
          title: developDocTitle(type, seq),
          content,
          internalNote: request.body.internalNote,
          createdBy: request.user.mbId,
        },
      });
      return { result: true as const, data: await docView(created.id) };
    },
  );

  // ── PATCH /admin/develop/documents/:docId — 초안 수정(본문·메모·회신 요청일) ──────
  fastify.patch(
    '/develop/documents/:docId',
    { schema: { params: DocIdParams, body: AdminDevelopDocumentPatchBody, response: { 200: AdminDevelopDocumentResponse, 400: ApiError, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const found = await loadDoc(request.params.docId);
      if (found === null) return reply.status(404).send(notFound);
      if (found.doc.status !== 'draft') return reply.status(409).send(notDraft);
      const b = request.body;
      if (b.content !== undefined) {
        const issues = contentOr400(asDocType(found.doc.type), b.content);
        if (issues.length > 0) return reply.status(400).send({ error: 'CONTENT_INVALID', message: issues.join(', ') });
      }
      await prisma.spDevelopDocument.update({
        where: { id: found.doc.id },
        data: {
          ...(b.content === undefined ? {} : { content: b.content }),
          ...(b.internalNote === undefined ? {} : { internalNote: b.internalNote }),
          ...(b.replyDueOn === undefined ? {} : { replyDueOn: b.replyDueOn }),
        },
      });
      return { result: true as const, data: await docView(found.doc.id) };
    },
  );

  // ── DELETE /admin/develop/documents/:docId — 초안 삭제(첨부 실파일 포함) ─────────
  fastify.delete(
    '/develop/documents/:docId',
    { schema: { params: DocIdParams, response: { 200: DevelopOkResponse, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const found = await loadDoc(request.params.docId);
      if (found === null) return reply.status(404).send(notFound);
      if (found.doc.status !== 'draft') return reply.status(409).send(notDraft);
      const files = await prisma.spFile.findMany({ where: { refType: REF_DEVELOP_DOCUMENT, refId: found.doc.id } });
      for (const f of files) await deleteMarketFile(f);
      await prisma.spDevelopDocument.delete({ where: { id: found.doc.id } });
      return { result: true as const };
    },
  );

  // ── POST /admin/develop/documents/:docId/revise — 새 판(version+1 draft) ───────────
  fastify.post(
    '/develop/documents/:docId/revise',
    { schema: { params: DocIdParams, response: { 200: AdminDevelopDocumentResponse, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const found = await loadDoc(request.params.docId);
      if (found === null) return reply.status(404).send(notFound);
      if (found.doc.status === 'draft') return reply.status(409).send({ error: 'DOC_IS_DRAFT', message: '작성 중인 문서는 그대로 고치면 됩니다' });
      const siblings = await prisma.spDevelopDocument.findMany({ where: { requestId: found.doc.requestId, type: found.doc.type, seq: found.doc.seq } });
      if (siblings.some((d) => d.status === 'draft')) return reply.status(409).send({ error: 'DOC_DRAFT_EXISTS', message: '이미 새 판을 쓰는 중입니다' });
      const maxVersion = Math.max(...siblings.map((d) => d.version));
      const created = await prisma.spDevelopDocument.create({
        data: {
          requestId: found.doc.requestId,
          type: found.doc.type,
          seq: found.doc.seq,
          version: maxVersion + 1,
          status: 'draft',
          title: found.doc.title,
          content: toDocContent(found.doc.content),
          replyDueOn: found.doc.replyDueOn,
          internalNote: found.doc.internalNote,
          createdBy: request.user.mbId,
        },
      });
      return { result: true as const, data: await docView(created.id) };
    },
  );

  // ── POST /admin/develop/documents/:docId/send — 발송(판 고정 + 이벤트 + 메일) ─────────
  fastify.post(
    '/develop/documents/:docId/send',
    { schema: { params: DocIdParams, body: AdminDevelopDocumentSendBody, response: { 200: AdminDevelopDocumentResponse, 400: ApiError, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const found = await loadDoc(request.params.docId);
      if (found === null) return reply.status(404).send(notFound);
      if (found.doc.status !== 'draft') return reply.status(409).send(notDraft);
      const status = asDevelopStatus(found.request.status);
      if (!docAllowed(status)) return reply.status(409).send({ error: 'INVALID_TRANSITION', message: '지금 상태에서는 문서를 보낼 수 없습니다' });
      const type = asDocType(found.doc.type);
      const content = toDocContent(found.doc.content);
      if (developDocContentEmpty(content)) return reply.status(400).send({ error: 'EMPTY_DOCUMENT', message: '내용이 없는 문서는 보낼 수 없습니다' });
      const b = request.body;
      const now = new Date();
      const docNo = developDocNo(type, found.doc.seq);
      await prisma.$transaction(async (tx) => {
        await tx.spDevelopDocument.updateMany({
          where: { requestId: found.doc.requestId, type: found.doc.type, seq: found.doc.seq, id: { not: found.doc.id }, status: { not: 'draft' } },
          data: { status: 'superseded' },
        });
        await tx.spDevelopDocument.update({
          where: { id: found.doc.id },
          data: { status: 'sent', sentAt: now, sentBy: request.user.mbId, replyDueOn: b.replyDueOn, mailSubject: b.mailSubject, mailBody: b.mailBody },
        });
        await addDevelopEvent(tx, found.doc.requestId, {
          type: 'document_sent',
          actorMbId: request.user.mbId,
          byAdmin: true,
          visibleToCustomer: true,
          title: `${docNo} ${DEVELOP_DOC_TYPE_LABELS[type]}${isDevelopDocApproval(type) ? ' — 확인을 요청합니다' : ' — 공유합니다'}`,
          body: null,
          payload: { documentId: Number(found.doc.id), type, seq: found.doc.seq, version: found.doc.version, docNo, replyDueOn: b.replyDueOn, approval: isDevelopDocApproval(type) },
        });
      });
      if (b.sendMail) {
        void sendDevelopMail(
          request.log,
          await customerEmailOf(found.request),
          buildDocumentSentEmail({
            requestId: Number(found.request.id),
            title: found.request.title,
            serviceAreas: toDevelopAreaCodes(found.request.serviceAreas),
            docNo,
            docLabel: DEVELOP_DOC_TYPE_LABELS[type],
            subject: b.mailSubject,
            body: b.mailBody,
            replyDueOn: b.replyDueOn,
          }),
          { kind: 'develop_document_sent', refType: 'develop_request', refId: found.request.id, sentBy: request.user.mbId, toMbId: found.request.mbId },
        );
      }
      return { result: true as const, data: await docView(found.doc.id) };
    },
  );

  // ── POST /admin/develop/documents/:docId/files — 첨부(multipart, draft 전용) ───────
  fastify.post('/develop/documents/:docId/files', async (request, reply) => {
    if (!request.isMultipart()) return reply.status(400).send({ error: 'MULTIPART_REQUIRED', message: 'multipart 요청이어야 합니다' });
    const { files } = await collectMultipart(request);
    const params = DocIdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'BAD_PARAMS', message: '잘못된 경로' });
    const found = await loadDoc(params.data.docId);
    if (found === null) return reply.status(404).send(notFound);
    if (found.doc.status !== 'draft') return reply.status(409).send(notDraft);
    if (files.length === 0) return reply.status(400).send({ error: 'NO_FILES', message: '파일이 없습니다' });
    let uploaded: Awaited<ReturnType<typeof uploadToFileServer>>;
    try {
      uploaded = await uploadToFileServer(files.map((f) => ({ buffer: f.buffer, filename: f.filename, mimetype: f.mimetype })), DEVELOP_FILE_SERVICE_TYPE);
    } catch (err) {
      request.log.error({ err }, 'develop document file upload failed');
      return reply.status(502).send({ error: 'FILE_UPLOAD_FAILED', message: '파일 업로드에 실패했습니다' });
    }
    const now = new Date();
    await prisma.spFile.createMany({
      data: uploaded.map((u) => ({
        refType: REF_DEVELOP_DOCUMENT,
        refId: found.doc.id,
        uploadFileName: u.uploadFileName,
        originFileName: u.originFileName,
        pathToken: u.pathToken,
        size: BigInt(u.size),
        writeDate: now,
        fileType: 'attachment',
        uploadedBy: 'ADMIN',
      })),
    });
    return { result: true as const, data: await docView(found.doc.id) };
  });

  fastify.delete(
    '/develop/documents/:docId/files/:fileId',
    { schema: { params: DocFileParams, response: { 200: AdminDevelopDocumentResponse, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const found = await loadDoc(request.params.docId);
      if (found === null) return reply.status(404).send(notFound);
      if (found.doc.status !== 'draft') return reply.status(409).send(notDraft);
      const file = await prisma.spFile.findFirst({ where: { id: BigInt(request.params.fileId), refType: REF_DEVELOP_DOCUMENT, refId: found.doc.id } });
      if (file === null) return reply.status(404).send(notFound);
      await deleteMarketFile(file);
      return { result: true as const, data: await docView(found.doc.id) };
    },
  );

  // ── POST /admin/develop/documents/:docId/ai-mail — 고객 메일 초안(비동기 잡, GET /api/ai/jobs/:jobId 폴링) ──
  // 유스케이스가 꺼져 있으면 409 — 화면은 계약 buildDevelopDocMailDraft(결정적 초안)를 그대로 쓴다.
  fastify.post(
    '/develop/documents/:docId/ai-mail',
    { schema: { params: DocIdParams, body: AdminDevelopDocMailBody, response: { 200: AdminDevelopDocMailRunResponse, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const found = await loadDoc(request.params.docId);
      if (found === null) return reply.status(404).send(notFound);
      const runtime = await getAiUsecaseRuntime(DEVELOP_DOC_MAIL_USECASE);
      if (!runtime.enabled) return reply.status(409).send({ error: 'USECASE_DISABLED', message: 'AI 메일 초안 기능이 꺼져 있습니다(관리자 > AI 설정)' });
      const type = asDocType(found.doc.type);
      const content = toDocContent(found.doc.content);
      const docNo = developDocNo(type, found.doc.seq);
      const draftInput = {
        type,
        docNo,
        requestTitle: found.request.title,
        customerName: found.request.contactName,
        customerCompany: found.request.contactCompany,
        replyDueOn: found.doc.replyDueOn,
        content,
      };
      const source = {
        typeLabel: DEVELOP_DOC_TYPE_LABELS[type],
        docNo,
        approval: isDevelopDocApproval(type),
        decisionLabels: DEVELOP_DOC_DECISION_OPTIONS[type].map((o) => o.label),
        requestTitle: found.request.title,
        customerName: found.request.contactName,
        customerCompany: found.request.contactCompany,
        replyDueOn: found.doc.replyDueOn,
        rows: developDocContentRows(type, content),
        draft: buildDevelopDocMailDraft(draftInput),
      };
      const inputHash = hashAiInput({ docId: Number(found.doc.id), content, replyDueOn: found.doc.replyDueOn, instructions: request.body.instructions, promptVersion: DEVELOP_DOC_MAIL_PROMPT_VERSION, extra: runtime.extraInstructions });
      const started = await startDevelopDocMailJob({
        mbId: request.user.mbId,
        model: runtime.model,
        think: toOllamaThink(runtime.think),
        extraInstructions: [runtime.extraInstructions, request.body.instructions].filter((s) => s.trim() !== '').join('\n'),
        source,
        inputHash,
        timeoutMs: runtime.timeoutMs,
        log: request.log,
      });
      return { result: true as const, data: { jobId: started.job.id, cached: started.cached } };
    },
  );

  // ── PUT /admin/develop/requests/:id/tasks — 업무표 통째 교체 ──────────────────────
  fastify.put(
    '/develop/requests/:id/tasks',
    { schema: { params: RequestIdParams, body: AdminDevelopTasksPutBody, response: { 200: AdminDevelopTasksResponse, 404: ApiError } } },
    async (request, reply) => {
      const r = await prisma.spDevelopRequest.findUnique({ where: { id: BigInt(request.params.id) } });
      if (r === null) return reply.status(404).send(notFound);
      await prisma.$transaction(async (tx) => {
        await tx.spDevelopTask.deleteMany({ where: { requestId: r.id } });
        if (request.body.tasks.length > 0) {
          await tx.spDevelopTask.createMany({
            data: request.body.tasks.map((t, i) => ({
              requestId: r.id,
              seq: i + 1,
              phase: t.phase,
              name: t.name,
              status: t.status,
              startOn: t.startOn,
              endOn: t.endOn,
              weightBp: t.weightBp,
              progressPct: t.progressPct,
              note: t.note,
              visibleToCustomer: t.visibleToCustomer,
            })),
          });
        }
      });
      const [tasks, documents] = await Promise.all([loadDevelopTasks(r.id), loadDevelopDocuments(r.id, { includeDrafts: true })]);
      return { result: true as const, data: { tasks: tasks.map(toDevelopTaskView), progress: buildDevelopProgress(r, tasks, documents.rows, false) } };
    },
  );

  done();
};
