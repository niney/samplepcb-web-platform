// PCB 보내기 보드(§9 묶음 재구성) — API 스토리. 세션 스모크(pcb-ship-board-smoke.mjs,
// 28케이스)의 리포 편입판: 자족 시드(협력2 명의) → 전 케이스 → 무잔재 정리.
// 협력2 가 CN 이라 관리자행(dest null)=국제, 직송 CN=국내 — 모드 파생의 실검증 겸용.
// 협력1 실데이터는 읽기만 한다(HANDOFF §5). 정본: docs/PCB_PARTNER_TRACK.md §9.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  RUN,
  api,
  cleanupPcbPos,
  countPcbResidue,
  createPcbPo,
  disconnectPrisma,
  getPartner,
  getPrisma,
  num,
  pickFreeSpecs,
  signJwt,
  type PartnerFixture,
  type PcbPoSeed,
} from '../helpers';

describe.skipIf(!RUN)('PCB 보내기 보드(§9) — 담기·승계·게이팅·전이·완료 스토리', () => {
  let sender: PartnerFixture; // 협력2(CN·쓰기 시드 조직)
  let other: PartnerFixture; // 협력1(읽기 전용)
  let P = ''; // 협력2 토큰
  // 시드 PO — i=관리자행(국제), d=직송 CN(국내), md=게이팅용, p=생산중
  let I1: any, I2: any, K1: any, K2: any, E1: any;
  let sd1: any, smd: any; // 직송1 스펙(관리자 입고확인 경로)·게이팅용 스펙
  const createdPoIds: bigint[] = [];

  const mkPo = async (seed: PcbPoSeed): Promise<any> => {
    const po = await createPcbPo(seed);
    createdPoIds.push(po.id);
    return po;
  };
  const board = () => api(P, 'GET', '/api/partner/pcb-shipments');
  const putIn = (po: any) => api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: num(po.id) });
  const takeOut = (po: any) =>
    api(P, 'DELETE', `/api/partner/pcb-pos/${po.id}/shipment/membership`, {});
  const advance = (po: any, body: unknown) =>
    api(P, 'POST', `/api/partner/pcb-pos/${po.id}/shipment/advance`, body);

  beforeAll(async () => {
    sender = await getPartner('협력2');
    other = await getPartner('협력1');
    if (sender.mbId === null) throw new Error('협력2 조직에 연결 계정이 없습니다');
    P = signJwt({ mbId: sender.mbId });

    // 전제: 협력2 는 PCB PO 0건 조직 — 잔재가 있으면 지난 실행 실패 흔적일 수 있으니
    // 자동 삭제하지 않고 중단한다(실데이터 오인 삭제 방지, 수동 확인 후 정리).
    const prisma = getPrisma();
    const existing = await prisma.spPcbPo.findMany({
      where: { partnerId: sender.id },
      select: { id: true },
    });
    if (existing.length > 0) {
      throw new Error(
        `협력2 에 기존 PCB PO ${String(existing.length)}건(id: ${existing
          .map((r: any) => String(r.id))
          .join(', ')}) — 지난 실행 잔재인지 확인 후 정리하고 재실행하세요`,
      );
    }

    const [si1, si2, d1, d2, md, sp1] = await pickFreeSpecs(6);
    sd1 = d1;
    smd = md;
    I1 = await mkPo({ specId: si1.id, partnerId: sender.id });
    I2 = await mkPo({ specId: si2.id, partnerId: sender.id });
    K1 = await mkPo({ specId: d1.id, partnerId: sender.id, destinationCountry: 'CN' });
    K2 = await mkPo({ specId: d2.id, partnerId: sender.id, destinationCountry: 'CN' });
    E1 = await mkPo({ specId: sp1.id, partnerId: sender.id, status: 'producing' });
  });

  afterAll(async () => {
    // 어느 지점에서 실패했든 레지스트리 기준 일괄 정리 → 무잔재 검증(공유 DB 관례)
    await cleanupPcbPos(createdPoIds);
    const residue = await countPcbResidue(createdPoIds);
    expect(residue, '시드 잔재가 남았습니다').toEqual({ pos: 0, shipments: 0, memberships: 0 });
    const leftover = await getPrisma().spPcbPo.count({ where: { partnerId: sender.id } });
    expect(leftover, '협력2 조직에 PO 잔재').toBe(0);
    await disconnectPrisma();
  });

  test('1. 보드 초기 상태 — 선반 4·박스 0·받는 곳 라벨·생산중 분리', async () => {
    const r = await board();
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json?.data?.shelf?.length, '선반 4건').toBe(4);
    expect(r.json?.data?.boxes?.length, '박스 0').toBe(0);
    const labels = new Map(
      (r.json?.data?.shelf ?? []).map((s: any) => [s.poId, s.receiverLabel]),
    );
    expect(labels.get(num(I1.id)), "관리자행 라벨 '샘플피씨비'").toBe('샘플피씨비');
    expect(labels.get(num(K1.id)), "직송 라벨 '직송 CN'").toBe('직송 CN');
    const prodRow = (r.json?.data?.producing ?? []).find((p: any) => p.poId === num(E1.id));
    expect(prodRow?.status, '생산중 E1 → producing 목록').toBe('producing');
    expect(labels.has(num(E1.id)), '생산중은 선반 제외').toBe(false);
  });

  test('2. 담기 — 같은 컨텍스트 합류·다른 컨텍스트 분리·멱등', async () => {
    let r = await putIn(I1);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.data.boxes.length, 'I1 담기 → 박스 1').toBe(1);
    expect(r.json.data.boxes[0].mode, '국제(CN발 관리자행)').toBe('international');

    r = await putIn(I2);
    expect(r.json.data.boxes.length, 'I2 → 같은 박스 합류').toBe(1);
    expect(r.json.data.boxes[0].groupPos.length).toBe(2);

    r = await putIn(K1);
    expect(r.json.data.boxes.length, 'K1 → 별도 박스').toBe(2);
    expect(
      r.json.data.boxes.some((b: any) => b.mode === 'domestic' && b.destinationCountry === 'CN'),
      '직송 CN 박스는 domestic',
    ).toBe(true);

    r = await putIn(K2);
    const kBox = (r.json?.data?.boxes ?? []).find((b: any) => b.destinationCountry === 'CN');
    expect(kBox?.groupPos.length, 'K2 → 직송 박스 합류').toBe(2);
    expect(r.json.data.shelf.length, '선반 비움').toBe(0);

    r = await putIn(K2);
    expect(r.status, '중복 담기 멱등').toBe(200);
  });

  test('3. 대표 꺼내기 → 승계, 마지막 꺼내기 → 박스 소멸(국제 박스)', async () => {
    let b = await board();
    const iBox = b.json.data.boxes.find((x: any) => x.destinationCountry === null);
    expect(iBox, '국제 박스 존재').toBeTruthy();
    const iRep = iBox.poId === num(I1.id) ? I1 : I2;
    const iOther = iBox.poId === num(I1.id) ? I2 : I1;

    let r = await takeOut(iRep);
    expect(r.status, '대표 꺼내기 200(승계)').toBe(200);
    b = await board();
    const iBox2 = b.json.data.boxes.find((x: any) => x.destinationCountry === null);
    expect(iBox2?.poId, '대표 승계').toBe(num(iOther.id));
    expect(iBox2?.groupPos.length, '1건 유지').toBe(1);

    r = await takeOut(iOther);
    expect(r.status, '마지막 꺼내기 200').toBe(200);
    b = await board();
    expect(b.json.data.boxes.length, '국제 박스 소멸(직송 박스만)').toBe(1);
    expect(b.json.data.shelf.length, '선반 2건 복귀').toBe(2);
  });

  test('4. 출고 게이팅 — 하위 미입고 담기 거부·상대 라벨·최초 전이 묶음 재검', async () => {
    // MD 2단: 같은 스펙에 상위(협력2)·하위(협력1 수주) 발주 — 하위 입고 전 상위 출고 금지
    const mdTop = await mkPo({ specId: smd.id, partnerId: sender.id });
    const mdChild = await mkPo({ specId: smd.id, partnerId: other.id, parentPartnerId: sender.id });

    let r = await putIn(mdTop);
    expect(r.status, '게이팅 담기 409').toBe(409);
    expect(r.json?.error).toBe('OUTBOUND_BLOCKED');
    const b = await board();
    const mdShelf = b.json.data.shelf.find((s: any) => s.poId === num(mdTop.id));
    expect(mdShelf?.outboundBlocked, '선반에 게이팅 표시').toBe(true);

    // 협력1 보드 읽기 — 하위 수주 건의 받는 곳 라벨(격리·읽기 전용)
    if (other.mbId !== null) {
      const ob = await api(signJwt({ mbId: other.mbId }), 'GET', '/api/partner/pcb-shipments');
      expect(ob.status).toBe(200);
      const mdRow = ob.json?.data?.shelf?.find((s: any) => s.poId === num(mdChild.id));
      expect(mdRow?.receiverLabel, "협력1 선반 'MD 협력2' 라벨").toBe('MD 협력2');
    }

    // 이미 담긴 박스 멤버(K1) 스펙에 하위 발주가 "나중에" 생긴 상황 — 전이 시 묶음 재검
    const lateChild = await mkPo({ specId: sd1.id, partnerId: other.id, parentPartnerId: sender.id });
    r = await advance(K1, { carrier: 'SF Express', trackingNumber: 'SF-001' });
    expect(r.status, '최초 전이 묶음 게이팅 재검 409').toBe(409);
    expect(r.json?.error).toBe('OUTBOUND_BLOCKED');

    // 다음 블록(정상 전이)을 위해 게이팅 시드 제거 — 실패 시엔 afterAll 레지스트리가 처리
    await cleanupPcbPos([lateChild.id, mdTop.id, mdChild.id]);
  });

  test('5. 국내(직송) 최초 전이 — 묶음 단위·상세 groupPos·revert 복귀', async () => {
    let r = await advance(K1, { carrier: 'SF Express', trackingNumber: 'SF-001' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json?.data?.shipment?.status, '배송 중 전이').toBe('shipping');
    expect(r.json?.data?.shipment?.groupPos?.length, '상세 groupPos 2건').toBe(2);

    const detail2 = await api(P, 'GET', `/api/partner/pcb-pos/${K2.id}`);
    expect(detail2.json?.data?.shipment?.status, '동반 K2 도 shipping').toBe('shipping');
    expect(detail2.json?.data?.shipment?.poIds?.length).toBe(2);

    let b = await board();
    expect(b.json.data.boxes.length, '박스 소진').toBe(0);
    expect(b.json.data.active.length, '진행 중 1').toBe(1);

    r = await api(P, 'POST', `/api/partner/pcb-pos/${K1.id}/shipment/revert`, {});
    expect(r.json?.data?.shipment?.status, 'revert → preparing').toBe('preparing');
    b = await board();
    expect(b.json.data.boxes.length, '박스 1 복귀').toBe(1);
  });

  test('6. 재전이 → 관리자 입고확인 → 협력사 관점 완료·아카이브(R2)', async () => {
    let r = await advance(K1, { carrier: 'SF Express', trackingNumber: 'SF-001' });
    expect(r.status, '재전이 200').toBe(200);

    const A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${sd1.id}/pos/${K1.id}/shipment/receive`,
      { note: 'e2e 입고' },
    );
    expect(recv.status, `관리자 입고확인: ${JSON.stringify(recv.json)}`).toBe(200);

    const b = await board();
    expect(b.json.data.doneCount, '입고확인=완료 분류').toBe(1);
    expect(b.json.data.active.length).toBe(0);

    const done = await api(P, 'GET', '/api/partner/pcb-shipments/done?page=1&pageSize=10');
    expect(done.status).toBe(200);
    expect(done.json.data.total, '완료 아카이브 1건').toBe(1);
    expect(done.json.data.items[0]?.receivedAt, '입고확인 표시').not.toBeNull();
  });
});
