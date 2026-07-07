import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { SpFile, SpMarketContract } from '@prisma/client';
import { maskName } from '@sp/utils';
import { z } from 'zod';
import { downloadFromFileServer, uploadToFileServer } from '../lib/file-server';
import type { UploadedFileType } from '../lib/file-server';
import {
  MARKET_ANCHOR_IT_ID,
  deleteCartRow,
  deleteCartRowsByIoId,
  deleteQuoteOption,
  getCartRowByCtId,
  getMarketAnchorItem,
  getMembersByIds,
  getOrderInfoByCtId,
  insertCartRow,
  insertQuoteOption,
  selectCartRows,
} from '../lib/g5-db';
import { kstDateTimeStr } from '../lib/kst';
import {
  AUTO_CONFIRM_DAYS,
  cancelPendingContractTx,
  deriveContractPayment,
  ensureContractLazy,
  ensurePaidLazy,
  notifyContractConfirmed,
  toMarketContract,
} from '../lib/market-contract';
import { buildContractDeliveredEmail, sendMarketMail } from '../lib/market-email';
import {
  MARKET_FILE_SERVICE_TYPE,
  REF_MARKET_CONTRACT,
  collectMultipart,
} from '../lib/market';
import type { MarketReceivedFile } from '../lib/market';
import { prisma } from '../lib/prisma';

// ── /api/market/projects/:id/contract — 계약(결제·납품·검수·취소·산출물) ──────
// 계약 접근은 프로젝트 경유로 통일(프로젝트당 1계약, projectId unique). 당사자 판정은
// 무조인 복제 컬럼으로: clientMbId===user.mbId(의뢰인) / expertMbId===user.mbId(전문가).
// 모든 전이 가드는 ensureContractLazy(paid·자동확정 승격) 뒤에서 판정한다(H1). 에러 봉투는
// 회원 라우트 관례(pcb-projects): { result:false, error:'CODE' }.

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://local-web.samplepcb.co.kr';

// checkout/취소에서 "재주입 가능"으로 보는 카트행 상태(취소류) — 정상 주문 라인이 아님.
const CANCELLED_ROW_STATUSES = new Set(['삭제', '취소', '반품', '품절']);

const ProjectIdParams = z.object({ id: z.string().regex(/^\d+$/) });
const ContractFileParams = z.object({
  id: z.string().regex(/^\d+$/),
  fileId: z.string().regex(/^\d+$/),
});
// deliver multipart 의 평문 텍스트 필드 note(선택, payload JSON 아님 — W4 FE 계약). 최대 5000자.
const DeliverNote = z.string().trim().max(5000);

type ContractFileRow = Pick<SpFile, 'id' | 'fileType' | 'originFileName' | 'size'>;

const contractFiles = (contractId: bigint): Promise<ContractFileRow[]> =>
  prisma.spFile.findMany({
    where: { refType: REF_MARKET_CONTRACT, refId: contractId, fileType: 'deliverable' },
    orderBy: { id: 'asc' },
    select: { id: true, fileType: true, originFileName: true, size: true },
  });

// 당사자 응답 — 산출물 파일 + od 파생 결제 정보를 붙여 계약 DTO 로.
const respondContract = async (c: SpMarketContract) => {
  const [files, payment] = await Promise.all([
    contractFiles(c.id),
    deriveContractPayment(c.ctId),
  ]);
  return { result: true as const, data: toMarketContract(c, files, payment) };
};

export const marketContractRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // ── GET /market/projects/:id/contract — 당사자 계약 상세(+lazy 승격) ─────────
  fastify.get(
    '/market/projects/:id/contract',
    { schema: { params: ProjectIdParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const contract = await prisma.spMarketContract.findUnique({
        where: { projectId: BigInt(request.params.id) },
      });
      if (contract === null) return reply.notFound('계약이 없습니다');
      const mbId = request.user.mbId;
      if (contract.clientMbId !== mbId && contract.expertMbId !== mbId) {
        return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
      }
      const c = await ensureContractLazy(contract, request.log);
      return respondContract(c);
    },
  );

  // ── POST /market/projects/:id/contract/checkout — 영카트 주입 후 주문서 직행 ──
  // 의뢰인 전용. 기존 ctId 를 재사용/재주입 판정(C2·H3·H4) 후 앵커 카트행을 담아 선택.
  fastify.post(
    '/market/projects/:id/contract/checkout',
    { schema: { params: ProjectIdParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const contract = await prisma.spMarketContract.findUnique({
        where: { projectId: BigInt(request.params.id) },
      });
      if (contract === null) return reply.notFound('계약이 없습니다');
      if (contract.clientMbId !== request.user.mbId) {
        return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
      }
      const c = await ensureContractLazy(contract, request.log);
      if (c.status === 'cancelled') {
        return reply.status(409).send({ result: false, error: 'CONTRACT_CANCELLED' });
      }
      if (c.status !== 'pending') {
        return reply.status(409).send({ result: false, error: 'ALREADY_PAID' });
      }
      const cartId = request.user.cartId;
      if (cartId === undefined || cartId === '') {
        return reply.status(409).send({ result: false, error: 'NO_CART_ID' });
      }
      const project = await prisma.spMarketProject.findUnique({
        where: { id: c.projectId },
        select: { title: true },
      });

      // 재사용 vs 재주입 판정. reuseCtId 가 잡히면 주입 스킵.
      let reuseCtId: number | null = null;
      let needInject = true;
      if (c.ctId !== null) {
        const cartRow = await getCartRowByCtId(c.ctId);
        if (cartRow === null) {
          needInject = true; // 카트행 자체 소멸 → 재주입
        } else if (cartRow.ctStatus === '쇼핑') {
          if (cartRow.odId === cartId) {
            reuseCtId = c.ctId; // 내 버킷의 '쇼핑' 행 → 재사용(ctId 유지)
            needInject = false;
          } else {
            await deleteCartRow(c.ctId); // 옛 버킷 잔류(세션 교체, H4) → 삭제 후 재주입
            needInject = true;
          }
        } else {
          // 주문 라인('쇼핑' 아님) — od·행 상태로 분해(C2)
          const info = await getOrderInfoByCtId(c.ctId);
          if (info === null) {
            needInject = true; // 주문 헤더 삭제됨
          } else if (info.odStatus === '취소' || CANCELLED_ROW_STATUSES.has(info.rowCtStatus)) {
            needInject = true; // 취소된 주문/행 → 재주입
          } else if (info.odStatus === '주문') {
            return reply.status(409).send({ result: false, error: 'ORDER_PENDING' });
          } else {
            // 정상 주문 라인 = 결제됨 — 승격 재시도 후 차단
            await ensurePaidLazy(c, request.log);
            return reply.status(409).send({ result: false, error: 'ALREADY_PAID' });
          }
        }
      }

      let ctId = reuseCtId;
      if (needInject) {
        const anchor = await getMarketAnchorItem();
        if (anchor === null) {
          request.log.error(
            { itId: MARKET_ANCHOR_IT_ID },
            '마켓 앵커 상품 없음 — seed-market-anchor-item 실행 필요',
          );
          return reply.status(503).send({ result: false, error: 'ANCHOR_ITEM_MISSING' });
        }
        // H3: 잔존 '쇼핑' 행 청소 → 옵션 행 재등록 → 카트 INSERT(실패 시 옵션 행 보상 삭제).
        await deleteCartRowsByIoId(c.contractKey);
        await deleteQuoteOption(anchor.itId, c.contractKey);
        await insertQuoteOption(anchor.itId, c.contractKey, c.amount);
        try {
          ctId = await insertCartRow({
            odId: cartId,
            mbId: request.user.mbId,
            item: anchor,
            itemName: `재능마켓 용역 · ${(project?.title ?? '').slice(0, 80)}`,
            ioId: c.contractKey,
            price: c.amount,
            option: `재능마켓 계약 #${String(Number(c.id))}`,
            ip: request.ip,
          });
        } catch (err) {
          await deleteQuoteOption(anchor.itId, c.contractKey).catch(() => undefined);
          request.log.error({ err, contractId: Number(c.id) }, 'g5_shop_cart INSERT 실패 (계약 checkout)');
          return reply.status(502).send({ result: false, error: 'CART_INSERT_FAILED' });
        }
        await prisma.spMarketContract.update({ where: { id: c.id }, data: { ctId } });
      }

      if (ctId === null) {
        // 논리상 도달 불가(재사용 or 주입 중 하나는 ctId 확정) — 방어.
        request.log.error({ contractId: Number(c.id) }, 'checkout ctId 미확정');
        return reply.status(500).send({ result: false, error: 'CHECKOUT_FAILED' });
      }
      await selectCartRows(cartId, [ctId]);
      return {
        result: true as const,
        data: { redirectUrl: `${WEB_BASE_URL}/shop/orderform.php` },
      };
    },
  );

  // ── POST /market/projects/:id/contract/deliver — 작업 완료 보고(multipart) ───
  // 전문가 전용. paid 에서 최초 전이(→delivered, 메일 #2) / delivered 재보고(파일·노트 갱신,
  // deliveredAt 유지 = 자동확정 시계 유지). note(선택 payload) + deliverable[] 파일(선택).
  fastify.post('/market/projects/:id/contract/deliver', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.badRequest('multipart/form-data 요청이어야 합니다');
    }
    const params = ProjectIdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('잘못된 경로입니다');
    const { files, fields } = await collectMultipart(request);
    try {
      await request.jwtVerify();
    } catch {
      return reply.unauthorized('로그인이 필요합니다');
    }

    const contract = await prisma.spMarketContract.findUnique({
      where: { projectId: BigInt(params.data.id) },
    });
    if (contract === null) return reply.notFound('계약이 없습니다');
    if (contract.expertMbId !== request.user.mbId) {
      return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
    }
    const c = await ensureContractLazy(contract, request.log);
    if (c.status !== 'paid' && c.status !== 'delivered') {
      return reply.status(409).send({ result: false, error: 'NOT_PAID' });
    }

    // 평문 note 필드(선택) — trim 후 빈 문자열은 미설정(기존 노트 보존).
    let note: string | undefined;
    if (fields.note !== undefined) {
      const parsed = DeliverNote.safeParse(fields.note);
      if (!parsed.success) {
        return reply.status(400).send({
          result: false,
          error: 'NOTE_INVALID',
          issues: parsed.error.issues,
        });
      }
      note = parsed.data === '' ? undefined : parsed.data;
    }

    const deliverables: MarketReceivedFile[] = files.filter((f) => f.field === 'deliverable');
    let uploaded: UploadedFileType[] = [];
    if (deliverables.length > 0) {
      try {
        uploaded = await uploadToFileServer(
          deliverables.map((f) => ({ buffer: f.buffer, filename: f.filename, mimetype: f.mimetype })),
          MARKET_FILE_SERVICE_TYPE,
        );
      } catch (err) {
        request.log.error({ err }, 'market contract deliverable upload failed');
        return reply.status(502).send({ result: false, error: 'FILE_UPLOAD_FAILED' });
      }
    }

    const now = new Date();
    const firstDelivery = await prisma.$transaction(async (tx): Promise<boolean> => {
      if (uploaded.length > 0) {
        await tx.spFile.createMany({
          data: uploaded.map((u) => ({
            refType: REF_MARKET_CONTRACT,
            refId: c.id,
            uploadFileName: u.uploadFileName,
            originFileName: u.originFileName,
            pathToken: u.pathToken,
            size: BigInt(u.size),
            writeDate: now,
            fileType: 'deliverable',
          })),
        });
      }
      if (c.status === 'paid') {
        const upd = await tx.spMarketContract.updateMany({
          where: { id: c.id, status: 'paid' },
          data: {
            status: 'delivered',
            deliveredAt: now,
            ...(note !== undefined ? { deliveryNote: note } : {}),
          },
        });
        return upd.count === 1;
      }
      if (note !== undefined) {
        // delivered 재보고 — deliveredAt 유지, 노트만 갱신.
        await tx.spMarketContract.update({ where: { id: c.id }, data: { deliveryNote: note } });
      }
      return false;
    });

    if (firstDelivery) {
      // 메일 #2(납품→의뢰인) — 최초 delivered 전이 시만. autoConfirmAt = now+7d.
      const auto = new Date(now.getTime() + AUTO_CONFIRM_DAYS * 86_400_000);
      const members = await getMembersByIds([c.clientMbId]);
      const member = members.get(c.clientMbId);
      const owner = maskName(member?.name ?? '');
      const project = await prisma.spMarketProject.findUnique({
        where: { id: c.projectId },
        select: { title: true },
      });
      void sendMarketMail(
        request.log,
        member?.email,
        buildContractDeliveredEmail({
          ownerName: owner === '' ? '고객' : owner,
          projectId: Number(c.projectId),
          projectTitle: project?.title ?? '',
          autoConfirmAt: `${kstDateTimeStr(auto).slice(0, 10)} (KST)`,
        }),
      );
    }

    const fresh = (await prisma.spMarketContract.findUnique({ where: { id: c.id } })) ?? c;
    return respondContract(fresh);
  });

  // ── POST /market/projects/:id/contract/confirm — 검수 확정(의뢰인) ──────────
  fastify.post(
    '/market/projects/:id/contract/confirm',
    { schema: { params: ProjectIdParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const contract = await prisma.spMarketContract.findUnique({
        where: { projectId: BigInt(request.params.id) },
      });
      if (contract === null) return reply.notFound('계약이 없습니다');
      if (contract.clientMbId !== request.user.mbId) {
        return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
      }
      const c = await ensureContractLazy(contract, request.log);
      if (c.status !== 'delivered') {
        return reply.status(409).send({ result: false, error: 'NOT_DELIVERED' });
      }
      const now = new Date();
      const confirmed = await prisma.$transaction(async (tx): Promise<boolean> => {
        const upd = await tx.spMarketContract.updateMany({
          where: { id: c.id, status: 'delivered' },
          data: { status: 'completed', completedAt: now, confirmedBy: 'client' },
        });
        if (upd.count === 0) return false;
        await tx.spMarketProject.updateMany({
          where: { id: c.projectId, status: { in: ['awarded', 'working'] } },
          data: { status: 'completed' },
        });
        return true;
      });
      if (!confirmed) {
        return reply.status(409).send({ result: false, error: 'NOT_DELIVERED' });
      }
      const fresh = (await prisma.spMarketContract.findUnique({ where: { id: c.id } })) ?? c;
      void notifyContractConfirmed(fresh, request.log); // 메일 #3(검수 확정→전문가)
      return respondContract(fresh);
    },
  );

  // ── POST /market/projects/:id/contract/cancel — 의뢰인 취소(pending 만) ──────
  fastify.post(
    '/market/projects/:id/contract/cancel',
    { schema: { params: ProjectIdParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const contract = await prisma.spMarketContract.findUnique({
        where: { projectId: BigInt(request.params.id) },
      });
      if (contract === null) return reply.notFound('계약이 없습니다');
      if (contract.clientMbId !== request.user.mbId) {
        return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
      }
      const c = await ensureContractLazy(contract, request.log);
      if (c.status !== 'pending') {
        return reply.status(409).send({ result: false, error: 'NOT_CANCELLABLE' });
      }
      // 무통장 미입금 주문이 걸린 상태면 취소 불가(주문 처리는 관리자 문의 안내는 FE 몫).
      if (c.ctId !== null) {
        const cartRow = await getCartRowByCtId(c.ctId);
        if (cartRow !== null && cartRow.ctStatus !== '쇼핑') {
          const info = await getOrderInfoByCtId(c.ctId);
          if (info !== null && info.odStatus === '주문') {
            return reply.status(409).send({ result: false, error: 'ORDER_PENDING' });
          }
        }
      }
      const cancelled = await cancelPendingContractTx(c, '의뢰인 취소');
      if (!cancelled) {
        return reply.status(409).send({ result: false, error: 'NOT_CANCELLABLE' });
      }
      const fresh = (await prisma.spMarketContract.findUnique({ where: { id: c.id } })) ?? c;
      return respondContract(fresh);
    },
  );

  // ── GET /market/projects/:id/contract/files/:fileId — 산출물 다운로드 ────────
  // 당사자(의뢰인·전문가) ∨ 관리자. 파일 소속(refType·refId) 검증 후 파일서버 프록시.
  fastify.get(
    '/market/projects/:id/contract/files/:fileId',
    { schema: { params: ContractFileParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const contract = await prisma.spMarketContract.findUnique({
        where: { projectId: BigInt(request.params.id) },
        select: { id: true, clientMbId: true, expertMbId: true },
      });
      if (contract === null) return reply.notFound('계약이 없습니다');
      const mbId = request.user.mbId;
      const isParty = contract.clientMbId === mbId || contract.expertMbId === mbId;
      if (!isParty && !request.user.isAdmin) {
        return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
      }
      const file = await prisma.spFile.findFirst({
        where: {
          id: BigInt(request.params.fileId),
          refType: REF_MARKET_CONTRACT,
          refId: contract.id,
        },
        select: { pathToken: true, originFileName: true },
      });
      if (file === null) return reply.notFound('파일이 없습니다');
      const downloaded = await downloadFromFileServer(file.pathToken);
      if (downloaded === null) return reply.notFound('파일이 없습니다');
      return reply
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`,
        )
        .type(downloaded.contentType)
        .send(downloaded.buffer);
    },
  );

  done();
};
