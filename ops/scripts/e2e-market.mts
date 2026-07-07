// 재능마켓 1차 API E2E — 매칭 전 과정 + 부정 경로(블라인드·NDA·마감·레이스) 33항목.
// sp-node(3333)가 떠 있어야 하며, 실존 회원 2명(전문가/의뢰인 역할)과 관리자(cf_admin)
// JWT 를 JWT_SECRET 으로 직접 서명해 사용한다. 메일은 로컬 Mailpit(127.0.0.1:25)이
// 가로채므로 실발송 0통. 생성 데이터는 cleanup 이 파일서버 실파일까지 정리한다.
//
// 실행(apps/api 에서 — .env 의 JWT_SECRET/DATABASE_URL/FILE_SERVER_URL 사용):
//   pnpm --filter api exec tsx --env-file=.env ../../../ops/scripts/e2e-market.mts run
//   pnpm --filter api exec tsx --env-file=.env ../../../ops/scripts/e2e-market.mts cleanup
// 검증 맥락: docs/MARKET_FLOW.md §5(접근 제어)·§4(상태 머신). 2차(결제) 회귀에도 재사용.
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// api 패키지의 node_modules 를 해석(스크립트가 리포 ops/ 에 살아 자체 해석 불가).
const apiRequire = createRequire(
  new URL('../../samplepcb-web-mono-app/apps/api/package.json', import.meta.url),
);
const { PrismaClient } = apiRequire('@prisma/client');

const API = 'http://127.0.0.1:3333';
const MAILPIT = 'http://127.0.0.1:8025';
const IDS_FILE = join(tmpdir(), 'sp-market-e2e-ids.json');
const MODE = process.argv[2] ?? 'run';

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET 없음 (apps/api/.env — 실행법 주석 참조)');
const prisma = new PrismaClient();

const b64u = (s) => Buffer.from(s).toString('base64url');
const sign = (claims) => {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({ ...claims, iat: now, exp: now + 3600 }));
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
};

let pass = 0;
let fail = 0;
const assert = (cond, name, extra) => {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.error(`FAIL  ${name}`, extra ?? '');
  }
};

const req = async (method, path, { token, body, form } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form !== undefined) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + path, { method, headers, body: payload });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 비 JSON(다운로드 등) */
  }
  return { status: res.status, json };
};

const mailpitTotal = async () => {
  try {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=1`);
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j.total === 'number' ? j.total : null;
  } catch {
    return null;
  }
};

async function cleanup() {
  const ids = JSON.parse(readFileSync(IDS_FILE, 'utf8'));
  const fileServer = process.env.FILE_SERVER_URL ?? 'https://file.samplepcb.kr';
  const refPairs = [
    ...ids.projectIds.map((id) => ({ refType: 'sp_market_project', refId: BigInt(id) })),
    ...(ids.expertId !== null ? [{ refType: 'sp_market_expert', refId: BigInt(ids.expertId) }] : []),
  ];
  for (const p of refPairs) {
    const files = await prisma.spFile.findMany({ where: { refType: p.refType, refId: p.refId } });
    for (const f of files) {
      // 실파일 먼저(파일서버) — 실패해도 DB 는 지운다(테스트 데이터 한정 예외).
      try {
        await fetch(`${fileServer}/api/delete/${encodeURIComponent(f.pathToken)}`);
      } catch {
        console.warn('file server delete 실패(고아 가능):', Number(f.id));
      }
    }
    await prisma.spFile.deleteMany({ where: { refType: p.refType, refId: p.refId } });
  }
  const pids = ids.projectIds.map((id) => BigInt(id));
  await prisma.spMarketBid.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.spMarketNdaSign.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.spMarketProject.deleteMany({ where: { id: { in: pids } } });
  if (ids.expertId !== null) {
    await prisma.spMarketExpert.deleteMany({ where: { id: BigInt(ids.expertId) } });
  }
  console.log('cleanup 완료:', ids);
}

async function run() {
  // ── 테스트 주체 선정: cf_admin + (전문가 행 없는) 실존 회원 2명 ──
  const cfg = await prisma.$queryRaw`SELECT cf_admin FROM g5_config LIMIT 1`;
  const cfAdmin = String(cfg[0]?.cf_admin ?? '');
  if (cfAdmin === '') throw new Error('cf_admin 없음');
  const members = await prisma.$queryRaw`
    SELECT mb_id, mb_nick, mb_email FROM g5_member
    WHERE mb_email <> '' AND mb_leave_date = '' AND mb_id <> ${cfAdmin}
      AND mb_id NOT IN (SELECT mbId FROM sp_market_expert)
    ORDER BY mb_datetime DESC LIMIT 2`;
  if (members.length < 2) throw new Error('테스트용 회원 2명 확보 실패');
  const [em, cm] = members;
  const tExpert = sign({ mbId: em.mb_id, mbNick: em.mb_nick, level: 2, isAdmin: false });
  const tClient = sign({ mbId: cm.mb_id, mbNick: cm.mb_nick, level: 2, isAdmin: false });
  const tAdmin = sign({ mbId: cfAdmin, mbNick: 'admin', level: 10, isAdmin: true });
  console.log(`주체: expert=${em.mb_id} client=${cm.mb_id} admin=${cfAdmin}`);

  const mailBefore = await mailpitTotal();
  const ids = { expertId: null, projectIds: [] };

  try {
    // ── 1) 전문가 등록(multipart) ──
    const regForm = new FormData();
    regForm.append(
      'payload',
      JSON.stringify({
        expertType: 'individual',
        displayName: 'E2E전문가',
        phone: '010-1234-5678',
        careerRange: 'r5_10',
        contactHours: '09:00 ~ 18:00',
        region: 'seoul',
        travelRange: 'within30km',
        intro: 'E2E 통합 테스트용 전문가 소개입니다.',
        categories: ['arduino', 'firmware'],
        cadTools: ['kicad'],
        bankName: '신한',
        bankHolder: '테스트',
        bankAccount: '110-123-456789',
        termsAgree: true,
      }),
    );
    regForm.append('license', new Blob(['e2e license'], { type: 'text/plain' }), 'e2e-license.txt');
    const reg = await req('POST', '/api/market/experts', { token: tExpert, form: regForm });
    assert(reg.status === 200 && reg.json?.result === true, '전문가 등록', reg);
    ids.expertId = reg.json?.data?.expertId ?? null;
    writeFileSync(IDS_FILE, JSON.stringify(ids));

    // ── 2) 관리자 승인(+이중 승인 전이 가드) ──
    const approve = await req('POST', `/api/admin/market/experts/${ids.expertId}/approve`, { token: tAdmin });
    assert(approve.status === 200 && approve.json?.data?.status === 'approved', '관리자 승인', approve);
    const reApprove = await req('POST', `/api/admin/market/experts/${ids.expertId}/approve`, { token: tAdmin });
    assert(reApprove.status === 409, '이중 승인 409', reApprove.status);

    // ── 3) 의뢰 등록(역견적·NDA·첨부) ──
    const prjForm = new FormData();
    prjForm.append(
      'payload',
      JSON.stringify({
        title: 'E2E 심박 모니터 회로 개발',
        category: 'circuit',
        cadTools: ['any'],
        description: 'E2E 통합 테스트용 프로젝트 상세 설명입니다.',
        ndaRequired: true,
        budgetRange: 'r300_700',
        deadline: { days: 7 },
        method: 'open',
      }),
    );
    prjForm.append('attachment', new Blob(['e2e spec content'], { type: 'text/plain' }), 'e2e-spec.txt');
    const prj = await req('POST', '/api/market/projects', { token: tClient, form: prjForm });
    assert(prj.status === 200 && prj.json?.result === true, '의뢰 등록(open+NDA+첨부)', prj);
    const pid = prj.json?.data?.projectId;
    ids.projectIds.push(pid);
    writeFileSync(IDS_FILE, JSON.stringify(ids));

    // ── 4) 익명 상세: viewer null·마스킹·첨부 메타 잠금 ──
    const anon = await req('GET', `/api/market/projects/${pid}`);
    assert(anon.status === 200 && anon.json?.data?.viewer === null, '익명 상세 viewer=null');
    assert(anon.json?.data?.attachments?.files === null && anon.json?.data?.attachments?.count === 1, 'NDA 메타 잠금(개수만)');
    const masked = anon.json?.data?.ownerName ?? '';
    assert(masked.includes('*') || masked === '회원', '의뢰인 마스킹', masked);

    // ── 5) 소유자 상세: 파일 보임 → fileId 확보 ──
    const ownerDetail = await req('GET', `/api/market/projects/${pid}`, { token: tClient });
    const fileId = ownerDetail.json?.data?.attachments?.files?.[0]?.fileId;
    assert(typeof fileId === 'number', '소유자 첨부 메타 노출', ownerDetail.json?.data?.attachments);

    // ── 6) 전문가: NDA 전 다운로드 403 → 서명(멱등) → 200 ──
    const dl403 = await fetch(`${API}/api/market/projects/${pid}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${tExpert}` },
    });
    assert(dl403.status === 403, 'NDA 미서명 다운로드 403', dl403.status);
    const nda = await req('POST', `/api/market/projects/${pid}/nda`, {
      token: tExpert,
      body: { agree: true, signedName: 'E2E전문가' },
    });
    assert(nda.status === 200, 'NDA 서명', nda);
    const nda2 = await req('POST', `/api/market/projects/${pid}/nda`, {
      token: tExpert,
      body: { agree: true, signedName: 'E2E전문가' },
    });
    assert(nda2.status === 200 && nda2.json?.data?.signedAt === nda.json?.data?.signedAt, 'NDA 재서명 멱등');
    const dl200 = await fetch(`${API}/api/market/projects/${pid}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${tExpert}` },
    });
    const dlBody = await dl200.text();
    assert(dl200.status === 200 && dlBody === 'e2e spec content', 'NDA 후 다운로드 200+본문 일치');

    // ── 7) 입찰: 제출·중복 409·비전문가 403·블라인드 ──
    const bid = await req('POST', `/api/market/projects/${pid}/bids`, {
      token: tExpert,
      body: { amount: 4200000, durationDays: 38, warranty: '납품 후 90일', message: 'E2E 입찰 제안 메시지입니다.' },
    });
    assert(bid.status === 200 && bid.json?.data?.status === 'submitted', '입찰 제출', bid);
    const dup = await req('POST', `/api/market/projects/${pid}/bids`, {
      token: tExpert,
      body: { amount: 1, durationDays: 1, message: '중복 제출 시도입니다.' },
    });
    assert(dup.status === 409 && dup.json?.error === 'ALREADY_BID', '중복 입찰 409');
    const selfBid = await req('POST', `/api/market/projects/${pid}/bids`, {
      token: tClient,
      body: { amount: 1000, durationDays: 1, message: '소유자 입찰 시도입니다.' },
    });
    assert(selfBid.status === 403, '비전문가(소유자) 입찰 403', selfBid.json);
    const stranger = await req('GET', `/api/market/projects/${pid}/bids`, { token: tExpert });
    assert(stranger.status === 403, '제3자 견적 목록 403(블라인드)');
    const ownerBids = await req('GET', `/api/market/projects/${pid}/bids`, { token: tClient });
    assert(ownerBids.status === 200 && ownerBids.json?.data?.items?.length === 1, '소유자 견적 목록 1건');

    // ── 8) 재제출(수정) ──
    const patch = await req('PATCH', `/api/market/projects/${pid}/my-bid`, {
      token: tExpert,
      body: { amount: 4000000, durationDays: 35, message: 'E2E 수정 제안 메시지입니다.' },
    });
    assert(patch.status === 200 && patch.json?.data?.amount === 4000000, '입찰 재제출');

    // ── 9) 채택 트랜잭션 + 레이스/종결 가드 ──
    const bidId = patch.json?.data?.bidId;
    const award = await req('POST', `/api/market/projects/${pid}/bids/${bidId}/award`, { token: tClient });
    assert(award.status === 200 && award.json?.data?.status === 'awarded', '채택', award);
    const award2 = await req('POST', `/api/market/projects/${pid}/bids/${bidId}/award`, { token: tClient });
    assert(award2.status === 409, '이중 채택 409');
    const myBid = await req('GET', `/api/market/projects/${pid}/my-bid`, { token: tExpert });
    assert(myBid.json?.data?.status === 'awarded', '전문가 my-bid=awarded');
    const lateEdit = await req('PATCH', `/api/market/projects/${pid}/my-bid`, {
      token: tExpert,
      body: { amount: 1, durationDays: 1, message: '채택 후 수정 시도입니다.' },
    });
    assert(lateEdit.status === 409, '채택 후 수정 409');

    // ── 10) 지정견적: 인박스 수신·지정자 입찰·취소·익명 404 ──
    const tf = new FormData();
    tf.append(
      'payload',
      JSON.stringify({
        title: 'E2E 지정견적 ArtWork',
        category: 'artwork',
        cadTools: ['kicad'],
        description: '지정견적 E2E 테스트 상세 설명입니다.',
        ndaRequired: false,
        budgetRange: 'under300',
        deadline: { days: 3 },
        method: 'targeted',
        targetExpertId: ids.expertId,
      }),
    );
    const tprj = await req('POST', '/api/market/projects', { token: tClient, form: tf });
    assert(tprj.status === 200, '지정견적 등록', tprj);
    const tpid = tprj.json?.data?.projectId;
    ids.projectIds.push(tpid);
    writeFileSync(IDS_FILE, JSON.stringify(ids));
    const inbox = await req('GET', '/api/market/my/targeted-projects', { token: tExpert });
    assert(
      inbox.status === 200 && inbox.json?.data?.items?.some((i) => i.projectId === tpid),
      '지정 인박스 수신',
    );
    const tbid = await req('POST', `/api/market/projects/${tpid}/bids`, {
      token: tExpert,
      body: { amount: 900000, durationDays: 10, message: '지정견적 입찰 메시지입니다.' },
    });
    assert(tbid.status === 200, '지정자 입찰 성공');
    const tcancel = await req('POST', `/api/market/projects/${tpid}/cancel`, { token: tClient });
    assert(tcancel.status === 200 && tcancel.json?.data?.status === 'cancelled', '소유자 취소');
    const anonCancelled = await req('GET', `/api/market/projects/${tpid}`);
    assert(anonCancelled.status === 404, '취소 건 익명 404');

    // ── 11) 조기 마감 → 마감 후 입찰 409 ──
    const cf = new FormData();
    cf.append(
      'payload',
      JSON.stringify({
        title: 'E2E 조기마감 테스트',
        category: 'consult',
        cadTools: ['any'],
        description: '조기 마감 E2E 테스트 상세 설명입니다.',
        ndaRequired: false,
        budgetRange: 'undecided',
        deadline: { days: 14 },
        method: 'open',
      }),
    );
    const cprj = await req('POST', '/api/market/projects', { token: tClient, form: cf });
    const cpid = cprj.json?.data?.projectId;
    ids.projectIds.push(cpid);
    writeFileSync(IDS_FILE, JSON.stringify(ids));
    const close = await req('POST', `/api/market/projects/${cpid}/close`, { token: tClient });
    assert(close.status === 200 && close.json?.data?.status === 'closed', '조기 마감');
    const lateBid = await req('POST', `/api/market/projects/${cpid}/bids`, {
      token: tExpert,
      body: { amount: 100000, durationDays: 5, message: '마감 후 입찰 시도입니다.' },
    });
    assert(lateBid.status === 409 && lateBid.json?.error === 'BIDDING_CLOSED', '마감 후 입찰 409');

    // ── 12) 마이 목록·공개 목록 반영 ──
    const myProjects = await req('GET', '/api/market/my/projects?tab=all', { token: tClient });
    assert(
      myProjects.json?.data?.items?.some((i) => i.projectId === pid && i.awardedBid !== null),
      '내 의뢰 채택 요약',
    );
    const myBids = await req('GET', '/api/market/my/bids', { token: tExpert });
    assert(myBids.json?.data?.items?.length >= 2, '내 입찰 목록 ≥2');
    const list = await req('GET', '/api/market/projects?tab=awarded');
    assert(list.json?.data?.items?.some((i) => i.projectId === pid), '공개 목록 awarded 탭 반영');

    // ── 13) 메일(Mailpit) — 승인·새 입찰×2·채택·지정요청 ≥ 4통 증가 기대 ──
    const mailAfter = await mailpitTotal();
    if (mailBefore === null || mailAfter === null) {
      console.log('SKIP  Mailpit 미가동 — 메일 검증 생략');
    } else {
      assert(mailAfter - mailBefore >= 4, `메일 수신(${mailAfter - mailBefore}통 증가)`);
    }
  } finally {
    writeFileSync(IDS_FILE, JSON.stringify(ids));
  }

  console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
  console.log(`정리: 같은 명령의 cleanup 모드 실행 (ids: ${IDS_FILE})`);
  if (fail > 0) process.exitCode = 1;
}

if (MODE === 'cleanup') await cleanup();
else await run();
await prisma.$disconnect();
