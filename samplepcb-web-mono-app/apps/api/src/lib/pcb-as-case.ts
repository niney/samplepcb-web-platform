import type { SpPcbAsCase, SpPcbPo } from '@prisma/client';
import type {
  AdminPcbAsCaseCreateBodyType,
  AdminPcbAsCaseViewType,
  PartnerPcbAsCaseViewType,
  PcbAsCandidateViewType,
  PcbAsCaseFileViewType,
} from '@sp/api-contract';
import { defaultPcbAsCharge, PCB_PAYMENT_TERM_NET_7 } from '@sp/api-contract';
import { prisma } from './prisma';
import { resolvePcbRemittanceDueOn } from './pcb-payment-terms';
import { isPcbOrderLineCanceled } from './pcb-shipment';
import { deleteFromFileServer, uploadToFileServer, type UploadTarget } from './file-server';

// ── PCB A/S 케이스(P4) — 재생산(회차 재발주) 접수·회신·진행 ──────────────────
// 정본: docs/PCB_PARTNER_TRACK.md §9 A/S. 레거시 sp_pcb_as_case 승계 + 갭 교정:
//   • 회차 채번을 InnoDB tx 안에서(레거시 MyISAM 무롤백 경합 위험)
//   • proceed 가 생성한 발주서 id 를 응답으로(레거시는 못 내려줘 화면이 길을 잃음)
//   • 접수 회수(submitted→draft, 회신 전) — 레거시는 오전송 복구 수단이 없었다
//   • 첨부는 uploadedBy 로 관리자/협력사 구분(레거시는 회신이 관리자 첨부를 덮어씀)
// 케이스는 합의 기록이고, 재생산은 회차 발주서(reorderRound>0)가 기존 EQ·선적
// 파이프를 그대로 탄다 — 케이스 상태와 발주 상태는 서로를 참조하지 않는다.

export const AS_CASE_FILE_REF = 'sp_pcb_as_case';

const num = (v: bigint): number => Number(v);
const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

const loadAsCaseFilesMap = async (
  caseIds: bigint[],
): Promise<Map<string, PcbAsCaseFileViewType[]>> => {
  const map = new Map<string, PcbAsCaseFileViewType[]>();
  if (caseIds.length === 0) return map;
  const rows = await prisma.spFile.findMany({
    where: { refType: AS_CASE_FILE_REF, refId: { in: caseIds } },
    orderBy: { id: 'asc' },
  });
  for (const f of rows) {
    const key = f.refId.toString();
    const list = map.get(key) ?? [];
    list.push({
      fileId: num(f.id),
      name: f.originFileName,
      size: num(f.size),
      uploadedBy: f.uploadedBy,
      uploadedAt: f.writeDate.toISOString(),
    });
    map.set(key, list);
  }
  return map;
};

const loadPartnerNames = async (ids: bigint[]): Promise<Map<string, string>> => {
  const uniq = [...new Set(ids.filter((v) => v !== 0n).map((v) => v.toString()))];
  if (uniq.length === 0) return new Map();
  const rows = await prisma.spPartner.findMany({
    where: { id: { in: uniq.map((v) => BigInt(v)) } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id.toString(), r.name]));
};

/** 회차 최상위 발주 조직 — 직거래는 대상 협력사, MD 경유는 MD(관리자→MD 발주 A). */
const topPartnerIdOf = (c: SpPcbAsCase): bigint =>
  c.parentPartnerId === 0n ? c.targetPartnerId : c.parentPartnerId;

export const serializeAdminAsCases = async (
  rows: SpPcbAsCase[],
): Promise<AdminPcbAsCaseViewType[]> => {
  const names = await loadPartnerNames(
    rows.flatMap((r) => [r.targetPartnerId, r.parentPartnerId]),
  );
  const filesMap = await loadAsCaseFilesMap(rows.map((r) => r.id));
  const out: AdminPcbAsCaseViewType[] = [];
  for (const r of rows) {
    let roundPoId: number | null = null;
    if (r.status === 'proceeded' && r.reorderRound !== null) {
      const po = await prisma.spPcbPo.findUnique({
        where: {
          specId_partnerId_parentPartnerId_reorderRound: {
            specId: r.specId,
            partnerId: topPartnerIdOf(r),
            parentPartnerId: 0n,
            reorderRound: r.reorderRound,
          },
        },
        select: { id: true },
      });
      roundPoId = po === null ? null : num(po.id);
    }
    out.push({
      id: num(r.id),
      specId: num(r.specId),
      reorderRound: r.reorderRound,
      caseType: r.caseType as AdminPcbAsCaseViewType['caseType'],
      chargeType: r.chargeType as AdminPcbAsCaseViewType['chargeType'],
      description: r.description,
      status: r.status as AdminPcbAsCaseViewType['status'],
      targetPartnerId: num(r.targetPartnerId),
      targetPartnerName: names.get(r.targetPartnerId.toString()) ?? `#${r.targetPartnerId.toString()}`,
      parentPartnerId: num(r.parentPartnerId),
      parentPartnerName:
        r.parentPartnerId === 0n ? null : (names.get(r.parentPartnerId.toString()) ?? null),
      replyReason: r.replyReason,
      createdBy: r.createdBy,
      submittedAt: iso(r.submittedAt),
      repliedAt: iso(r.repliedAt),
      proceededAt: iso(r.proceededAt),
      createdAt: r.createdAt.toISOString(),
      roundPoId,
      files: filesMap.get(r.id.toString()) ?? [],
    });
  }
  return out;
};

/** proceeded 케이스의 포털 딥링크 — **보는 조직이 열 수 있는** 회차 발주만 안내한다
 *  (관리자 roundPoId 의 미러 — 레거시는 이 id 를 못 내려줘 "발주 목록에서 찾으세요"로
 *  사용자가 길을 잃던 갭). 최상위 수주자(직거래 대상·MD)는 최상위 회차 발주(A),
 *  MD 경유의 대상 협력사는 MD 가 이어받아 발행한 하위 회차 발주 — 아직 없으면 null. */
const partnerRoundPoIdOf = async (
  c: SpPcbAsCase,
  viewerPartnerId: bigint,
): Promise<number | null> => {
  if (c.status !== 'proceeded' || c.reorderRound === null) return null;
  const top = topPartnerIdOf(c);
  const po =
    viewerPartnerId === top
      ? await prisma.spPcbPo.findUnique({
          where: {
            specId_partnerId_parentPartnerId_reorderRound: {
              specId: c.specId,
              partnerId: top,
              parentPartnerId: 0n,
              reorderRound: c.reorderRound,
            },
          },
          select: { id: true },
        })
      : await prisma.spPcbPo.findFirst({
          where: {
            specId: c.specId,
            partnerId: viewerPartnerId,
            parentPartnerId: c.parentPartnerId,
            reorderRound: c.reorderRound,
          },
          select: { id: true },
        });
  return po === null ? null : num(po.id);
};

export const serializePartnerAsCases = async (
  rows: SpPcbAsCase[],
  viewerPartnerId: bigint,
): Promise<PartnerPcbAsCaseViewType[]> => {
  const names = await loadPartnerNames(rows.map((r) => r.targetPartnerId));
  const filesMap = await loadAsCaseFilesMap(rows.map((r) => r.id));
  const specs = await prisma.spOrderSpec.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.specId.toString()))].map((v) => BigInt(v)) } },
    select: { id: true, projectName: true },
  });
  const specNames = new Map(specs.map((s) => [s.id.toString(), s.projectName]));
  const out: PartnerPcbAsCaseViewType[] = [];
  for (const r of rows) {
    out.push({
      id: num(r.id),
      specId: num(r.specId),
      projectName: specNames.get(r.specId.toString()) ?? `Q${r.specId.toString()}`,
      reorderRound: r.reorderRound,
      caseType: r.caseType as PartnerPcbAsCaseViewType['caseType'],
      chargeType: r.chargeType as PartnerPcbAsCaseViewType['chargeType'],
      description: r.description,
      status: r.status as PartnerPcbAsCaseViewType['status'],
      targetPartnerId: num(r.targetPartnerId),
      targetPartnerName:
        names.get(r.targetPartnerId.toString()) ?? `#${r.targetPartnerId.toString()}`,
      parentPartnerId: num(r.parentPartnerId),
      replyReason: r.replyReason,
      submittedAt: iso(r.submittedAt),
      repliedAt: iso(r.repliedAt),
      proceededAt: iso(r.proceededAt),
      roundPoId: await partnerRoundPoIdOf(r, viewerPartnerId),
      files: filesMap.get(r.id.toString()) ?? [],
    });
  }
  return out;
};

// ── 대상 후보 — 이 스펙의 원주문(round 0) 발주 중 **생산 주체(leaf)** 만 ─────────
// MD 조직(관리자→MD 발주 A)은 하위 발주가 있으면 중계자라 후보가 아니다. 하위가
// 아직 없으면(A만 발행) MD 가 직접 생산할 수도 있으므로 후보로 남긴다.
export const listPcbAsCandidates = async (specId: bigint): Promise<PcbAsCandidateViewType[]> => {
  const pos = await prisma.spPcbPo.findMany({
    where: { specId, reorderRound: 0 },
    orderBy: { id: 'asc' },
  });
  const leaf = pos.filter((p) => !pos.some((c) => c.parentPartnerId === p.partnerId));
  const names = await loadPartnerNames(
    leaf.flatMap((p) => [p.partnerId, p.parentPartnerId]),
  );
  return leaf.map((p) => ({
    partnerId: num(p.partnerId),
    partnerName: names.get(p.partnerId.toString()) ?? `#${p.partnerId.toString()}`,
    parentPartnerId: num(p.parentPartnerId),
    parentPartnerName:
      p.parentPartnerId === 0n ? null : (names.get(p.parentPartnerId.toString()) ?? null),
    poId: num(p.id),
  }));
};

// ── 생성·수정(draft) ─────────────────────────────────────────────────────────

export type CreatePcbAsCaseError =
  | 'SPEC_NOT_FOUND'
  | 'ORDER_CANCELED'
  | 'NO_ORIGIN_PO';

/** 대상 협력사의 원주문(round 0) 수주 발주 — 트랙(직거래/MD 경유)의 도출 근거. */
const findTargetOriginPo = async (
  specId: bigint,
  targetPartnerId: bigint,
): Promise<SpPcbPo | null> =>
  prisma.spPcbPo.findFirst({
    where: { specId, partnerId: targetPartnerId, reorderRound: 0 },
    orderBy: { id: 'asc' },
  });

export const createPcbAsCase = async (
  specId: bigint,
  body: AdminPcbAsCaseCreateBodyType,
  createdBy: string,
): Promise<{ ok: true; asCase: SpPcbAsCase } | { ok: false; error: CreatePcbAsCaseError }> => {
  const spec = await prisma.spOrderSpec.findFirst({
    where: { id: specId, status: 'active' },
  });
  if (spec === null) return { ok: false, error: 'SPEC_NOT_FOUND' };
  // 취소된 주문의 재생산은 성립하지 않는다(결제가 사라진 주문 — 사용자 결정 08-10).
  if (await isPcbOrderLineCanceled(specId)) return { ok: false, error: 'ORDER_CANCELED' };
  const origin = await findTargetOriginPo(specId, BigInt(body.targetPartnerId));
  if (origin === null) return { ok: false, error: 'NO_ORIGIN_PO' };
  const asCase = await prisma.spPcbAsCase.create({
    data: {
      specId,
      caseType: body.caseType,
      chargeType: body.chargeType ?? defaultPcbAsCharge(body.caseType),
      description: body.description === undefined || body.description === '' ? null : body.description,
      status: 'draft',
      targetPartnerId: BigInt(body.targetPartnerId),
      parentPartnerId: origin.parentPartnerId,
      createdBy,
    },
  });
  return { ok: true, asCase };
};

export type UpdatePcbAsCaseError = 'CASE_NOT_FOUND' | 'NOT_DRAFT' | 'NO_ORIGIN_PO';

export const updatePcbAsCase = async (
  id: bigint,
  body: AdminPcbAsCaseCreateBodyType,
): Promise<{ ok: true; asCase: SpPcbAsCase } | { ok: false; error: UpdatePcbAsCaseError }> => {
  const c = await prisma.spPcbAsCase.findUnique({ where: { id } });
  if (c === null) return { ok: false, error: 'CASE_NOT_FOUND' };
  if (c.status !== 'draft') return { ok: false, error: 'NOT_DRAFT' };
  // 대상이 바뀌면 트랙도 다시 도출한다(대상과 트랙은 한 몸).
  const origin = await findTargetOriginPo(c.specId, BigInt(body.targetPartnerId));
  if (origin === null) return { ok: false, error: 'NO_ORIGIN_PO' };
  const asCase = await prisma.spPcbAsCase.update({
    where: { id },
    data: {
      caseType: body.caseType,
      chargeType: body.chargeType ?? defaultPcbAsCharge(body.caseType),
      description: body.description === undefined || body.description === '' ? null : body.description,
      targetPartnerId: BigInt(body.targetPartnerId),
      parentPartnerId: origin.parentPartnerId,
    },
  });
  return { ok: true, asCase };
};

// ── 전송·회수·삭제 ──────────────────────────────────────────────────────────

export type SubmitPcbAsCaseError = 'CASE_NOT_FOUND' | 'NOT_DRAFT';

export const submitPcbAsCase = async (
  id: bigint,
): Promise<{ ok: true; asCase: SpPcbAsCase } | { ok: false; error: SubmitPcbAsCaseError }> => {
  const c = await prisma.spPcbAsCase.findUnique({ where: { id } });
  if (c === null) return { ok: false, error: 'CASE_NOT_FOUND' };
  if (c.status !== 'draft') return { ok: false, error: 'NOT_DRAFT' };
  const asCase = await prisma.spPcbAsCase.update({
    where: { id },
    data: { status: 'submitted', submittedAt: new Date() },
  });
  return { ok: true, asCase };
};

export type RecallPcbAsCaseError = 'CASE_NOT_FOUND' | 'NOT_SUBMITTED';

/** 접수 회수 — 회신이 오기 전(submitted)만. 오전송 복구 창구(레거시에 없던 출구). */
export const recallPcbAsCase = async (
  id: bigint,
): Promise<{ ok: true; asCase: SpPcbAsCase } | { ok: false; error: RecallPcbAsCaseError }> => {
  const c = await prisma.spPcbAsCase.findUnique({ where: { id } });
  if (c === null) return { ok: false, error: 'CASE_NOT_FOUND' };
  if (c.status !== 'submitted') return { ok: false, error: 'NOT_SUBMITTED' };
  const asCase = await prisma.spPcbAsCase.update({
    where: { id },
    data: { status: 'draft', submittedAt: null },
  });
  return { ok: true, asCase };
};

export type DeletePcbAsCaseError = 'CASE_NOT_FOUND' | 'NOT_DRAFT';

export const deletePcbAsCase = async (
  id: bigint,
): Promise<{ ok: true } | { ok: false; error: DeletePcbAsCaseError }> => {
  const c = await prisma.spPcbAsCase.findUnique({ where: { id } });
  if (c === null) return { ok: false, error: 'CASE_NOT_FOUND' };
  if (c.status !== 'draft') return { ok: false, error: 'NOT_DRAFT' };
  await prisma.spPcbAsCase.delete({ where: { id } });
  await prisma.spFile.deleteMany({ where: { refType: AS_CASE_FILE_REF, refId: id } });
  return { ok: true };
};

// ── 협력사 회신 ──────────────────────────────────────────────────────────────

export type ReplyPcbAsCaseError = 'CASE_NOT_FOUND' | 'NOT_YOUR_CASE' | 'NOT_SUBMITTED';

export const replyPcbAsCase = async (
  id: bigint,
  byPartnerId: bigint,
  accept: boolean,
  reason: string | null,
): Promise<{ ok: true; asCase: SpPcbAsCase } | { ok: false; error: ReplyPcbAsCaseError }> => {
  const c = await prisma.spPcbAsCase.findUnique({ where: { id } });
  if (c === null) return { ok: false, error: 'CASE_NOT_FOUND' };
  if (c.targetPartnerId !== byPartnerId) return { ok: false, error: 'NOT_YOUR_CASE' };
  if (c.status !== 'submitted') return { ok: false, error: 'NOT_SUBMITTED' };
  const asCase = await prisma.spPcbAsCase.update({
    where: { id },
    data: {
      status: accept ? 'accepted' : 'rejected',
      replyReason: reason,
      repliedAt: new Date(),
    },
  });
  return { ok: true, asCase };
};

// ── 재발주 진행 — 회차 채번 + 회차 발주서 생성 ───────────────────────────────

export type ProceedPcbAsCaseError =
  | 'CASE_NOT_FOUND'
  | 'NOT_ACCEPTED'
  | 'ORDER_CANCELED'
  | 'NO_ORIGIN_PO';

/**
 * 재발주 진행: 같은 스펙 케이스의 최대 회차 +1 을 채번하고, 최상위 원발주(round 0)를
 * 복사해 회차 발주서를 만든다(레거시 copyForReorder 승계). 한 tx — UK(specId,
 * reorderRound)가 동시 진행을 막고 실패 시 전부 롤백된다(레거시 MyISAM 경합 교정).
 *
 * 복사: 가격 일체(통화·원가·환율·회계·입력통화)·직송지·지불조건·rfq 참조·memo.
 * 초기화: status=issued, eqHistory=[], 송금(원장 축이라 자연히 0), **납기는 비운다**
 * — 레거시는 1차 납기를 복사해 stale 납기가 남았다(정본 문서 §7 경고를 여기서 교정).
 * MD 경유는 A(관리자→MD)만 생성 — 하위 발주는 MD 가 포털에서 회차를 이어받아 발주
 * (createChildPcbPo 가 parentPo.reorderRound 를 상속하므로 무변경).
 */
export const proceedPcbAsCase = async (
  id: bigint,
): Promise<
  | { ok: true; asCase: SpPcbAsCase; po: SpPcbPo; round: number }
  | { ok: false; error: ProceedPcbAsCaseError }
> => {
  const c = await prisma.spPcbAsCase.findUnique({ where: { id } });
  if (c === null) return { ok: false, error: 'CASE_NOT_FOUND' };
  if (c.status !== 'accepted') return { ok: false, error: 'NOT_ACCEPTED' };
  if (await isPcbOrderLineCanceled(c.specId)) return { ok: false, error: 'ORDER_CANCELED' };
  const topPartnerId = topPartnerIdOf(c);
  const origin = await prisma.spPcbPo.findUnique({
    where: {
      specId_partnerId_parentPartnerId_reorderRound: {
        specId: c.specId,
        partnerId: topPartnerId,
        parentPartnerId: 0n,
        reorderRound: 0,
      },
    },
  });
  if (origin === null) return { ok: false, error: 'NO_ORIGIN_PO' };

  const issuedAt = new Date();
  const net7Due =
    origin.paymentTerms === PCB_PAYMENT_TERM_NET_7
      ? resolvePcbRemittanceDueOn({
          paymentTerms: origin.paymentTerms,
          requestedDueOn: undefined,
          issuedAt,
        })
      : null;

  return prisma.$transaction(async (tx) => {
    const max = await tx.spPcbAsCase.aggregate({
      where: { specId: c.specId },
      _max: { reorderRound: true },
    });
    const round = (max._max.reorderRound ?? 0) + 1;
    const po = await tx.spPcbPo.create({
      data: {
        specId: origin.specId,
        partnerId: origin.partnerId,
        parentPartnerId: 0n,
        reorderRound: round,
        rfqId: origin.rfqId,
        status: 'issued',
        currency: origin.currency,
        priceOriginal: origin.priceOriginal,
        exchangeRate: origin.exchangeRate,
        krwAmount: origin.krwAmount,
        subCurrency: origin.subCurrency,
        subPriceOriginal: origin.subPriceOriginal,
        subExchangeRate: origin.subExchangeRate,
        destinationCountry: origin.destinationCountry,
        paymentTerms: origin.paymentTerms,
        // A/S 회차는 새 지급 일정이다. NET 7은 새 회차 발주일에서 다시 계산하고,
        // CUSTOM은 과거 회차 날짜를 복사하지 않고 조건 수정에서 새 날짜를 확정한다.
        remittanceDueOn: net7Due?.ok === true ? net7Due.dueOn : null,
        remittedAt: null,
        deliveryDate: null,
        memo: origin.memo,
        eqHistory: [],
        issuedAt,
      },
    });
    const asCase = await tx.spPcbAsCase.update({
      where: { id },
      data: { reorderRound: round, status: 'proceeded', proceededAt: new Date() },
    });
    return { ok: true as const, asCase, po, round };
  });
};

// ── 첨부 — uploadedBy(ADMIN/PARTNER)로 관리자 접수 자료와 협력사 회신 자료 구분 ──
const AS_UPLOAD_SERVICE_TYPE = 'pcb_as_case';

export const uploadPcbAsCaseFile = async (
  caseId: bigint,
  file: UploadTarget,
  uploadedBy: 'ADMIN' | 'PARTNER',
): Promise<PcbAsCaseFileViewType> => {
  const [uploaded] = await uploadToFileServer([file], AS_UPLOAD_SERVICE_TYPE);
  if (uploaded === undefined) throw new Error('A/S 파일 업로드에 실패했습니다');
  const row = await prisma.spFile.create({
    data: {
      refType: AS_CASE_FILE_REF,
      refId: caseId,
      uploadFileName: uploaded.uploadFileName,
      originFileName: file.filename,
      pathToken: uploaded.pathToken,
      size: BigInt(file.buffer.length),
      writeDate: new Date(),
      fileType: null,
      uploadedBy,
    },
  });
  return {
    fileId: num(row.id),
    name: row.originFileName,
    size: num(row.size),
    uploadedBy: row.uploadedBy,
    uploadedAt: row.writeDate.toISOString(),
  };
};

/** 삭제는 자기 역할이 올린 파일만(레거시 전체 교체 결함 교정) — by null 은 무제한(관리자 정리). */
export const deletePcbAsCaseFile = async (
  caseId: bigint,
  fileId: bigint,
  by: 'ADMIN' | 'PARTNER' | null,
): Promise<boolean> => {
  const row = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (row === null) return false;
  if (row.refType !== AS_CASE_FILE_REF || row.refId !== caseId) return false;
  if (by !== null && row.uploadedBy !== by) return false;
  await deleteFromFileServer(row.pathToken);
  await prisma.spFile.delete({ where: { id: row.id } });
  return true;
};

export const getPcbAsCaseFileDownload = async (
  caseId: bigint,
  fileId: bigint,
): Promise<{ pathToken: string; originFileName: string } | null> => {
  const row = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (row === null) return null;
  if (row.refType !== AS_CASE_FILE_REF || row.refId !== caseId) return null;
  return { pathToken: row.pathToken, originFileName: row.originFileName };
};

// 스펙 삭제 시 A/S 첨부(실파일+sp_file) 정리는 quote-delete.ts loadPcbTrackFiles 가
// EQ·선적 첨부와 함께 걷는다(실파일 먼저 → DB 순서 불변식) — 여기 별도 헬퍼 없음.
