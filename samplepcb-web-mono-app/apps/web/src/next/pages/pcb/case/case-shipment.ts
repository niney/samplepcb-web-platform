import { computed, ref } from 'vue';
import {
  PCB_SHIPMENT_FILE_LABELS,
  SHIPMENT_TRANSPORTS,
  SHIPMENT_TRANSPORT_LABELS,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  shipmentTransportDocType,
  shipmentTransportOf,
  type AdminPcbPoViewType,
  type AdminPcbShipmentViewType,
  type BomShipmentStatusType,
  type PcbShipmentAdvanceBodyType,
  type PcbShipmentFileTypeType,
  type PcbShipmentViewType,
} from '@sp/api-contract';
import {
  adminPcbInvoiceApi,
  useAdminPcbShipmentAdvance,
  useAdminPcbShipmentBox,
  useAdminPcbShipmentCancel,
  useAdminPcbShipmentCaseRef,
  useAdminPcbShipmentConfirm,
  useAdminPcbShipmentReceive,
  useAdminPcbShipmentRevert,
  useUploadAdminPcbShipmentFile,
} from '@/admin/useAdminPcbPos';
import { isPcbDirectShipIntl, pcbShipmentStatusLabel } from '@/lib/pcb-shipment-label';
import { INTL_CARRIERS } from '@/lib/shipment-carriers';
import { confirmDialog, promptDialog, type PromptField, type PromptResult } from '@/next/lib/dialog';
import { NEXT_PCB_ROUTES } from '@/next/pcb-navigation';
import type { CaseCore } from './case-core';

// PCB Case 상세 — 선적 줄(P3)의 조작. 관리자는 받는측 + 양측 만능 대행(서버 isSideActor).
// 값을 받아야 하는 단계는 옛 화면의 선언형 입력 모달 대신 next 입력 대화상자(promptDialog)로 묻는다.

type AdminShipFileView = AdminPcbShipmentViewType['files'][number];

// 운송수단 선택지 — 값은 계약 enum('air'|'sea')인데 입력 대화상자의 select 는 라벨=값이라 한국어 라벨로
// 묻고 제출에서 되돌린다. allowCustom:false 로 '직접입력'을 막아 역매핑이 실패할 길을 없앤다.
const TRANSPORT_OPTIONS = SHIPMENT_TRANSPORTS.map((t) => SHIPMENT_TRANSPORT_LABELS[t]);
const transportFromLabel = (label: string | undefined): 'air' | 'sea' | null =>
  SHIPMENT_TRANSPORTS.find((t) => SHIPMENT_TRANSPORT_LABELS[t] === label) ?? null;

interface ShipPromptContext {
  caseRefRequested: boolean;
  caseRef: string | null;
  caseRefNote: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  transport: 'air' | 'sea' | null;
}

// 선적 전이의 필수값은 단계마다 다르다 — 둘 이상을 받아야 하는 단계는 한 대화상자에서 받는다
// (window.prompt 로 두 번 물으면 두 번째에서 취소할 때 첫 입력이 사라졌다).
export const shipPromptFieldsOf = (next: BomShipmentStatusType, ship?: ShipPromptContext): PromptField[] => {
  if (next === 'requested') {
    // 관리자 대행 '선적 요청'(포털 계정 없는 조직 — 여정 12호) — 운송수단은 협력사가 고를 자리가 없다.
    return [
      {
        name: 'transport',
        label: '운송수단',
        type: 'select',
        options: TRANSPORT_OPTIONS,
        allowCustom: false,
        required: true,
        value: SHIPMENT_TRANSPORT_LABELS[shipmentTransportOf(ship?.transport)],
        hint: '해상은 운송서류가 B/L 입니다(항공은 AWB).',
      },
      { name: 'shipDate', label: '출고예정일', type: 'date', required: true, hint: '선적 요청에는 Invoice 첨부도 필요합니다.' },
    ];
  }
  if (next === 'shipping') {
    return [
      { name: 'carrier', label: '택배사', required: true, placeholder: '예) CJ대한통운' },
      { name: 'trackingNumber', label: '송장번호', required: true },
    ];
  }
  if (next === 'shipped') {
    // 직접 발송(Case ID 미체크) — 받는측 입력 없음: 운송 계약 주체가 협력사라 준비 단계에 적어 둔 값이
    // 그대로 실린다. 빈 배열 = 무입력 즉시 전이.
    if (ship?.caseRefRequested !== true) return [];
    // Case ID 갈래 — 관리자가 부킹 주체라 참조번호·운송회사·운송장을 한 번에 받는다. 운송수단은 여기서
    // 묻지 않는다: 어느 서류(AWB/B·L)를 붙였는지가 이미 수단을 말한다(스트립 ②). 예전에는 마지막
    // 창에서 수단을 바꿀 수 있어, 바꾸는 순간 앞 단계에서 붙인 서류가 무효가 됐다.
    const sea = shipmentTransportOf(ship.transport) === 'sea';
    return [
      {
        name: 'caseRef',
        label: '발송 참조번호(Case ID)',
        required: true,
        maxlength: 100,
        value: ship.caseRef ?? '',
        hint:
          ship.caseRefNote !== null && ship.caseRefNote !== ''
            ? `협력사 요청 메모: ${ship.caseRefNote}`
            : '협력사가 라벨링·인계에 쓸 값입니다 — 선적 통지 메일에 함께 나갑니다.',
      },
      // 해상은 포워더 이름을 적는 실무라 특송 프리셋이 방해가 된다 — 바로 적는 칸으로 둔다(예전에는 빈
      // 목록의 셀렉트에서 '직접입력'을 먼저 골라야 칸이 나왔다).
      sea
        ? { name: 'carrier', label: '선사·포워더', maxlength: 50, value: ship.carrier ?? '', placeholder: '선사 또는 포워더명' }
        : {
            name: 'carrier',
            label: '운송회사',
            type: 'select',
            options: INTL_CARRIERS,
            maxlength: 50,
            value: ship.carrier ?? '',
            placeholder: '운송회사명',
          },
      {
        name: 'trackingNumber',
        label: `트래킹 번호(${PCB_SHIPMENT_FILE_LABELS[shipmentTransportDocType(ship.transport)]})`,
        required: true,
        maxlength: 100,
        value: ship.trackingNumber ?? '',
      },
    ];
  }
  return [];
};

export function useCaseShipment(core: CaseCore) {
  const { specId, route, router, allPos, shipmentByPo, actionError, surfaceError } = core;

  /**
   * 이 Case 안에서 발송 줄을 걸어 둘 발주서 — 원칙은 발송 대표(s.poId)다. 묶음은 고객(Case) 경계를
   * 넘어 합류하므로(여정 9호) 대표가 남의 Case 발주서면 이 Case 엔 대표 행이 없어 선적 줄이 사라졌다
   * (2026-08-10 실측). 그래서 대표가 이 Case 밖이면 이 Case 가 가진 첫 구성원이 대신 맡는다 — 서버는
   * 발송을 구성원 어느 poId 로도 찾으므로 조작은 그대로 동작한다.
   */
  const caseAnchorPoOf = (s: PcbShipmentViewType): number | null => {
    if (allPos.value.some((p) => p.poId === s.poId)) return s.poId;
    const mine = allPos.value.filter((p) => s.poIds.includes(p.poId));
    if (mine.length === 0) return null;
    // 최상위 발주를 먼저 고른다 — 하위(MD) 발주 행은 접힌 요약 줄이라 전이·입고 버튼이 걸릴 자리가 아니다.
    const top = mine.filter((p) => p.parentPartnerId === 0);
    return Math.min(...(top.length > 0 ? top : mine).map((p) => p.poId));
  };
  /** 서브행용 — Case 당 발송 1줄(묶음이어도 한 번만). */
  const shipRowsOf = (poId: number): AdminPcbShipmentViewType[] => {
    const s = shipmentByPo.value.get(poId);
    if (s === undefined) return [];
    return caseAnchorPoOf(s) === poId ? [s] : [];
  };
  /** 묶음 구성 — 이 Case 것과 남의 Case 것을 갈라 보여준다. 남의 것은 고객까지 말하고 그 Case 로 연다. */
  const shipMatesOf = (
    s: AdminPcbShipmentViewType,
  ): { poId: number; specId: number; projectName: string; customerLabel: string; mine: boolean }[] =>
    s.groupPos.map((g) => ({
      poId: g.poId,
      specId: g.specId,
      projectName: g.projectName,
      customerLabel: g.customerName !== '' ? g.customerName : (g.mbId ?? '비회원'),
      mine: allPos.value.some((p) => p.poId === g.poId),
    }));
  // 동반 건의 Case 로 이동 — 같은 라우트 params 교체(specId computed 가 반응해 전체 재조회).
  function openMateCase(mateSpecId: number): void {
    void router.push({ name: NEXT_PCB_ROUTES.case, params: { id: String(mateSpecId) }, query: route.query });
  }

  const shipAdvanceAdmin = useAdminPcbShipmentAdvance();
  const shipBoxAdmin = useAdminPcbShipmentBox();
  const shipRevertAdmin = useAdminPcbShipmentRevert();
  const shipCancelAdmin = useAdminPcbShipmentCancel();
  const shipReceiveAdmin = useAdminPcbShipmentReceive();

  // 국내 종점(delivered)은 [입고 확인]이 상태까지 닫는다 — 전이 버튼에서는 그 단계를 빼고 입고 확인을
  // 한 단계 일찍 열어 준다(서버도 RECEIVE_REQUIRED).
  const adminShipAdvanceLabel = (s: PcbShipmentViewType): string | null => {
    const next = bomShipmentNextStatus(s.mode, s.status);
    if (next === null || (s.mode === 'domestic' && next === 'delivered')) return null;
    // 직송 국제 체인은 '국내도착' 대신 '현지도착'(표시층 치환 — 상태 코드는 공유 그대로).
    return pcbShipmentStatusLabel(s.mode, next, { directShip: isPcbDirectShipIntl(s.destinationCountry) });
  };
  /** [○○ 진행]이 **협력사 몫 대행**인가 — 다음 단계로 들이는 주체가 보내는 쪽(협력사)이면 그렇다
   *  (국제: 선적 요청 · 국내: 배송 중 — 계약 BOM_SHIPMENT_ACTORS). 받는 쪽이 MD 인 선적은 받는 쪽 단계도
   *  관리자 몫이 아니다(receiverKind). 대행이면 [협력사 대행 동작 보기]가 켜졌을 때만 보인다. */
  const isShipAdvanceProxy = (s: PcbShipmentViewType): boolean => {
    const next = bomShipmentNextStatus(s.mode, s.status);
    return next !== null && (bomShipmentActorOf(s.mode, next) === 'PARTNER' || s.receiverKind !== 'admin');
  };
  // 발송 시작(담기) — 생산완료인데 아직 어느 박스에도 안 담긴 발주. 원칙은 협력사 포털의 [담기]지만 연결
  // 계정이 0인 조직은 누를 사람이 없다(여정 12호 P5). 담기까지만 하고 멈춘다 — 다음 단계 필수값이
  // 모드마다 다르고, 모드는 담아 봐야 정해진다.
  const canStartShipment = (po: AdminPcbPoViewType): boolean =>
    po.status === 'produced' && shipmentByPo.value.get(po.poId) === undefined;
  async function startShipment(po: AdminPcbPoViewType): Promise<void> {
    if (specId.value === null) return;
    if (
      !(await confirmDialog(
        `${po.partnerName}의 발송을 시작할까요? 박스를 열어 두면 아래 선적 줄에서 다음 단계를 진행할 수 있습니다.`,
      ))
    )
      return;
    actionError.value = '';
    try {
      await shipBoxAdmin.mutateAsync({ specId: specId.value, poId: po.poId });
    } catch (e) {
      surfaceError(e, '발송을 시작하지 못했습니다.');
    }
  }

  const canAdminReceive = (s: PcbShipmentViewType): boolean => {
    if (s.receivedAt !== null || s.receiverKind !== 'admin') return false;
    return s.mode === 'domestic'
      ? s.status === 'shipping' // 배송 중이면 실물이 왔을 수 있다 — 검수 즉시 입고 완료로
      : bomShipmentNextStatus(s.mode, s.status) === null;
  };

  async function runShipAdvance(poId: number, body: PcbShipmentAdvanceBodyType): Promise<void> {
    if (specId.value === null) return;
    actionError.value = '';
    try {
      await shipAdvanceAdmin.mutateAsync({ specId: specId.value, poId, body });
    } catch (e) {
      surfaceError(e, '선적 진행에 실패했습니다.');
    }
  }
  const shipBodyOf = (values: PromptResult): PcbShipmentAdvanceBodyType => {
    const transport = transportFromLabel(values.transport);
    return {
      ...(values.shipDate === undefined || values.shipDate === '' ? {} : { shipDate: values.shipDate }),
      // 운송수단 — 라벨을 계약 값으로 되돌린다. 서버는 수단이 바뀌면 앞서 박힌 운송회사·운송장을 비우므로
      // 이 줄이 carrier 보다 앞에 있어야 같은 요청의 새 값이 살아남는다.
      ...(transport === null ? {} : { transport }),
      ...(values.carrier === undefined || values.carrier === '' ? {} : { carrier: values.carrier }),
      ...(values.trackingNumber === undefined || values.trackingNumber === ''
        ? {}
        : { trackingNumber: values.trackingNumber }),
      ...(values.caseRef === undefined || values.caseRef === '' ? {} : { caseRef: values.caseRef }),
    };
  };
  async function adminShipAdvance(poId: number, s: PcbShipmentViewType): Promise<void> {
    const next = bomShipmentNextStatus(s.mode, s.status);
    if (next === null) return;
    if (next === 'shipped' && s.caseRefRequestedAt !== null) {
      await adminShipCaseRef(poId, s);
      return;
    }
    // 필드 판정은 갈래를 알아야 한다 — 직접 발송 '선적'은 무입력이지만 Case ID 갈래는 입력이 필수라,
    // 갈래 없이 물으면 후자까지 즉시 전이로 새어 409 만 남는다.
    const ship: ShipPromptContext = {
      caseRefRequested: s.caseRefRequestedAt !== null,
      caseRef: s.caseRef,
      caseRefNote: s.caseRefNote,
      carrier: s.carrier,
      trackingNumber: s.trackingNumber,
      transport: s.transport,
    };
    const fields = shipPromptFieldsOf(next, ship);
    // 입력이 필요 없는 단계(직접 발송 '선적'·국내도착/현지도착·통관·완료 등)는 그대로 진행.
    if (fields.length === 0) {
      await runShipAdvance(poId, {});
      return;
    }
    const label = pcbShipmentStatusLabel(s.mode, next, { directShip: isPcbDirectShipIntl(s.destinationCountry) });
    const sid = specId.value;
    if (sid === null) return;
    actionError.value = '';
    // 저장은 대화상자가 연 채로 한다 — 실패하면 입력(운송장 등)이 남은 채 오류가 보인다.
    await promptDialog({
      title: `${label} 진행`,
      fields,
      confirmLabel: '진행',
      errorFallback: '선적 진행에 실패했습니다.',
      submit: async (values) => {
        await shipAdvanceAdmin.mutateAsync({ specId: sid, poId, body: shipBodyOf(values) });
      },
    });
  }
  async function adminShipRevert(poId: number): Promise<void> {
    if (specId.value === null) return;
    if (!(await confirmDialog({ message: '선적을 한 단계 되돌릴까요?', confirmLabel: '되돌리기', tone: 'danger' }))) return;
    actionError.value = '';
    try {
      await shipRevertAdmin.mutateAsync({ specId: specId.value, poId });
    } catch (e) {
      surfaceError(e, '되돌리기에 실패했습니다.');
    }
  }
  // 선적 취소 — 문서 자체를 삭제한다(묶음이면 통째로). 발송 전·입고 전만 서버가 허용.
  async function adminShipCancel(poId: number, s: PcbShipmentViewType): Promise<void> {
    if (specId.value === null) return;
    const extra = s.poIds.length > 1 ? `\n묶인 발주서 ${String(s.poIds.length)}건이 함께 취소됩니다.` : '';
    if (
      !(await confirmDialog({
        message: `선적을 취소(삭제)할까요? 첨부도 함께 지워집니다.${extra}`,
        confirmLabel: '선적 취소',
        tone: 'danger',
      }))
    )
      return;
    actionError.value = '';
    try {
      await shipCancelAdmin.mutateAsync({ specId: specId.value, poId });
    } catch (e) {
      surfaceError(e, '선적 취소에 실패했습니다.');
    }
  }

  // 선적 첨부 업로드(관리자) — Case ID 갈래의 핵심 왕복: 협력사 인보이스(xlsx)를 내려받아 수정 후
  // 재첨부(종류별 1건 교체)하고, 부킹한 AWB 를 첨부한다.
  const shipFileUpload = useUploadAdminPcbShipmentFile();
  // Case ID 처리 스트립 — 파일의 주인은 uploadedBy 가 말한다: 재첨부(교체)하면 자사(ADMIN) 파일이 되므로
  // ①의 완료 판정이 곧 "수정본이 올라갔다"다. 실발송(선적) 전까지만 선다.
  const invoiceOf = (s: AdminPcbShipmentViewType): AdminShipFileView | null =>
    s.files.find((f) => f.fileType === 'invoice') ?? null;
  const adminInvoiceOf = (s: AdminPcbShipmentViewType): AdminShipFileView | null =>
    s.files.find((f) => f.fileType === 'invoice' && f.uploadedBy === 'ADMIN') ?? null;
  const caseRefStrip = (s: PcbShipmentViewType): boolean =>
    s.caseRefRequestedAt !== null && s.receivedAt === null && (s.status === 'preparing' || s.status === 'requested');
  // 스트립 ② 의 운송수단 — **어느 서류를 붙였는지가 곧 수단이다.** 관리자가 여기서 고르고(부킹 주체),
  // 그 값이 ③ 의 전이에 실린다(서버 게이트: body.transport ?? 박제값). 고르기 전에는 협력사가 요청 때
  // 적어 둔 값이 기본이고, 새로 열었을 때는 붙어 있는 서류에서 되짚는다(B/L 만 있으면 해상).
  const stripTransportPick = ref(new Map<number, 'air' | 'sea'>());
  const stripTransportOf = (s: PcbShipmentViewType): 'air' | 'sea' => {
    const picked = stripTransportPick.value.get(s.shipmentId);
    if (picked !== undefined) return picked;
    const stored = shipmentTransportOf(s.transport);
    const other = stored === 'air' ? 'sea' : 'air';
    const has = (t: 'air' | 'sea'): boolean => s.files.some((f) => f.fileType === shipmentTransportDocType(t));
    return !has(stored) && has(other) ? other : stored;
  };
  function setStripTransport(s: PcbShipmentViewType, transport: 'air' | 'sea'): void {
    const next = new Map(stripTransportPick.value);
    next.set(s.shipmentId, transport);
    stripTransportPick.value = next;
  }
  /** 이 발송의 운송서류 — 항공 AWB / 해상 B/L. 서버 게이트와 같은 사전에서 유도해야 "첨부했는데 409"가 안 난다. */
  const shipDocTypeOf = (s: PcbShipmentViewType): PcbShipmentFileTypeType =>
    shipmentTransportDocType(caseRefStrip(s) ? stripTransportOf(s) : s.transport);
  const shipDocLabelOf = (s: PcbShipmentViewType): string => PCB_SHIPMENT_FILE_LABELS[shipDocTypeOf(s)];
  const awbOf = (s: PcbShipmentViewType): AdminShipFileView | null =>
    s.files.find((f) => f.fileType === shipDocTypeOf(s)) ?? null;
  /** 스트립 ③ 이 관리자 차례인가 — 협력사가 선적 요청을 마친 뒤다(되돌려 준비 중이면 아직 아니다). */
  const caseRefShipStep = (s: PcbShipmentViewType): boolean => caseRefStrip(s) && s.status === 'requested';
  /** ③ 이 잠긴 이유 — 눌러 보고 409 로 배우게 하지 않는다(서버 게이트와 같은 조건). 열려 있으면 null. */
  const caseRefShipLock = (s: PcbShipmentViewType): string | null => {
    if (s.status !== 'requested') return '협력사가 선적 요청을 하면 열립니다.';
    if (awbOf(s) === null) return `${shipDocLabelOf(s)} 를 먼저 첨부해 주세요(2단계).`;
    return null;
  };
  // 스트립 ③ — Case ID·운송회사·운송장을 한 번에 받아 선적으로 넘긴다. 협력사 통지는 이때 한 번 나간다
  // (Case ID·운송장 동봉 — 사용자 결정 2026-10-11).
  async function adminShipCaseRef(poId: number, s: PcbShipmentViewType): Promise<void> {
    const sid = specId.value;
    if (sid === null || caseRefShipLock(s) !== null) return;
    const transport = stripTransportOf(s);
    // 수단을 바꿔 골랐다면 앞서 박힌 운송회사·운송장은 남의 수단 값이다 — 미리 채우지 않는다.
    const sameTransport = transport === shipmentTransportOf(s.transport);
    actionError.value = '';
    await promptDialog({
      title: 'Case ID·운송장 입력 — 선적 진행',
      description: `운송수단 ${SHIPMENT_TRANSPORT_LABELS[transport]} · 입력하면 선적으로 넘어가고, 협력사에게 Case ID·운송장이 메일로 한 번에 안내됩니다.`,
      fields: shipPromptFieldsOf('shipped', {
        caseRefRequested: true,
        caseRef: s.caseRef,
        caseRefNote: s.caseRefNote,
        carrier: sameTransport ? s.carrier : null,
        trackingNumber: sameTransport ? s.trackingNumber : null,
        transport,
      }),
      confirmLabel: '선적 진행',
      errorFallback: '선적 진행에 실패했습니다.',
      submit: async (values) => {
        // 운송수단을 함께 보낸다 — 서버는 수단이 바뀌면 앞서 박힌 운송회사·운송장을 비우고 이 요청의 값을 쓴다.
        await shipAdvanceAdmin.mutateAsync({ specId: sid, poId, body: { ...shipBodyOf(values), transport } });
      },
    });
  }
  /** 스트립 ①·② 밖의 제출 서류(원산지증명원 등) — 스트립이 서 있는 동안의 다운로드 자리. */
  const otherShipFilesOf = (s: AdminPcbShipmentViewType): AdminShipFileView[] =>
    s.files.filter((f) => f.fileType !== 'invoice' && f.fileType !== shipDocTypeOf(s));
  function adminPickShipFile(poId: number, fileType: PcbShipmentFileTypeType): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file === undefined || specId.value === null) return;
      actionError.value = '';
      try {
        await shipFileUpload.mutateAsync({ specId: specId.value, poId, file, fileType });
      } catch (e) {
        surfaceError(e, '선적 파일 업로드에 실패했습니다.');
      }
    };
    input.click();
  }

  // 발송 참조번호(Case ID) 단독 입력 — **기록·정정 경로**다. 요청 건의 주 경로는 스트립 ③ 이 운송장과 함께
  // 받으므로 스트립이 서 있는 동안엔 이 버튼이 없다. 협력사 통지는 발송 뒤 값이 바뀌었을 때만(정정) 나간다.
  const shipCaseRefAdmin = useAdminPcbShipmentCaseRef();
  async function openCaseRef(poId: number, s: PcbShipmentViewType): Promise<void> {
    const has = s.caseRef !== null && s.caseRef !== '';
    const correcting = s.caseRefRequestedAt !== null && s.shippedAt !== null;
    actionError.value = '';
    await promptDialog({
      title: has ? '발송 참조번호(Case ID) 정정' : '발송 참조번호(Case ID) 입력',
      description: correcting
        ? '발송 뒤 정정입니다 — 값을 바꾸면 협력사에게 정정 메일이 나갑니다.'
        : '기록용입니다 — 이 입력만으로는 협력사에게 메일이 나가지 않습니다.',
      fields: [
        {
          name: 'caseRef',
          label: '발송 참조번호(Case ID)',
          required: true,
          maxlength: 100,
          value: s.caseRef ?? '',
          hint:
            s.caseRefNote !== null && s.caseRefNote !== ''
              ? `협력사 요청 메모: ${s.caseRefNote}`
              : '특송 계정·포워더 부킹·통관 참조 등 발송에 쓰는 값입니다.',
        },
      ],
      confirmLabel: has ? '정정' : '입력',
      errorFallback: '발송 참조번호 입력에 실패했습니다.',
      submit: async (values) => {
        if (specId.value === null) return;
        await shipCaseRefAdmin.mutateAsync({ specId: specId.value, poId, caseRef: values.caseRef ?? '' });
      },
    });
  }

  // 입고 확인 — 국내는 이 조작이 상태(입고 완료)까지 닫으므로 무엇이 함께 일어나는지 밝힌다. 묶음 입고는
  // 한 번 눌러 여러 주문이 배송 대기로 넘어간다(고객이 서로 달라도 — 여정 9호).
  async function openReceive(poId: number, domestic: boolean, mates: number): Promise<void> {
    const base = domestic
      ? '실물 검수를 기록하고 발송을 입고 완료로 닫습니다 — 고객 배송 처리가 열립니다.'
      : '실물 검수를 기록합니다 — 이후 고객 배송 처리가 열립니다.';
    const description =
      mates > 1
        ? `${base} 이 발송은 묶음 ${String(mates)}건이라, 함께 담긴 발주서의 주문(다른 고객일 수 있습니다)도 같이 배송 대기로 넘어갑니다.`
        : base;
    actionError.value = '';
    await promptDialog({
      title: '입고 확인',
      description,
      fields: [
        {
          name: 'note',
          label: '검수 메모 (선택)',
          type: 'textarea',
          placeholder: '수량 부족·불량 등 특이사항이 있으면 적어 주세요.',
        },
      ],
      confirmLabel: '입고 확인',
      errorFallback: '입고 확인에 실패했습니다.',
      submit: async (values) => {
        if (specId.value === null) return;
        const note = values.note ?? '';
        await shipReceiveAdmin.mutateAsync({ specId: specId.value, poId, note: note === '' ? null : note });
      },
    });
  }

  // 협력사 [선적 완료] 확인 대행 — 포털 계정이 없는 조직 등 협력사가 누를 수 없을 때([협력사 대행 동작 보기]).
  const shipConfirmAdmin = useAdminPcbShipmentConfirm();
  async function adminShipConfirm(poId: number, s: PcbShipmentViewType): Promise<void> {
    const sid = specId.value;
    if (sid === null) return;
    if (
      !(await confirmDialog({
        message: `${s.senderName}의 선적 완료를 대신 확인할까요? 협력사 화면에서 이 발송이 완료 내역으로 넘어갑니다.`,
        confirmLabel: '선적 완료 대행',
      }))
    )
      return;
    actionError.value = '';
    try {
      await shipConfirmAdmin.mutateAsync({ specId: sid, poId });
    } catch (e) {
      surfaceError(e, '선적 완료 확인에 실패했습니다.');
    }
  }

  // 인보이스 생성기 — 대표 발주 기준 콜백 주입.
  const invoicePoId = ref<number | null>(null);
  const adminInvoiceApiRef = computed(() =>
    invoicePoId.value === null || specId.value === null ? null : adminPcbInvoiceApi(specId.value, invoicePoId.value),
  );
  // [엑셀 생성·첨부] — 업로드 뮤테이션 경유로 캐시를 무효화한다(맨 API 호출을 주입하면 서버엔 붙는데
  // 발송 줄의 첨부 표시가 안 바뀐다).
  async function attachInvoiceXlsx(file: File): Promise<void> {
    if (invoicePoId.value === null || specId.value === null) return;
    await shipFileUpload.mutateAsync({ specId: specId.value, poId: invoicePoId.value, file, fileType: 'invoice' });
  }

  return {
    shipRowsOf,
    shipMatesOf,
    openMateCase,
    adminShipAdvanceLabel,
    isShipAdvanceProxy,
    canStartShipment,
    startShipment,
    canAdminReceive,
    adminShipAdvance,
    adminShipRevert,
    adminShipCancel,
    invoiceOf,
    adminInvoiceOf,
    shipDocTypeOf,
    shipDocLabelOf,
    awbOf,
    otherShipFilesOf,
    caseRefStrip,
    caseRefShipStep,
    caseRefShipLock,
    stripTransportOf,
    setStripTransport,
    adminShipCaseRef,
    adminPickShipFile,
    openCaseRef,
    adminShipConfirm,
    openReceive,
    invoicePoId,
    adminInvoiceApiRef,
    attachInvoiceXlsx,
  };
}

export type CaseShipment = ReturnType<typeof useCaseShipment>;
