// 개발의뢰(sp-develop) API E2E — 등록(필수 조건·연락처·첨부) → 소유자 경계(403) → 수정·이벤트 → 관리자 워크큐·상세 →
// AI 3층(작업본 저장·공개·초안 없음 409)·구성도 교체 업로드·공개 → 상태 전이 → 견적(초안·대체·발송·NOT_EDITABLE) →
// 수락(마일스톤 pending·payable) → checkout(카트행·옵션행 DB 실증·재사용·NOT_PAYABLE·NO_CART_ID) → 결제 시뮬 → lazy 승격
// (in_progress·startedAt) → 납품(잠금 403) → 검수 확정 → 잔금 → 잠금 해제 200 → 문의·A/S → 취소·거절·만료.
// 실 LLM 호출 0: 시작 시 develop.* 유스케이스를 enabled=0 으로 내리고 끝날 때 원복한다(마켓 하네스 관례).
// sp-node(3333)가 떠 있어야 하며, 실존 회원 2명(의뢰인/제3자)과 관리자(cf_admin) JWT 를 JWT_SECRET 으로 직접 서명한다.
// 결제는 코어 orderformupdate 를 DB 직접(prisma raw)으로 최소 시뮬레이션한다. 생성 데이터(의뢰·이벤트·견적·마일스톤·
// 카트행·옵션행·시뮬 주문·실파일)는 cleanup 이 전수 정리한다(공유 DB — 스스로 만들고 스스로 지운다).
//
// 실행(apps/api 에서 — .env 의 JWT_SECRET/DATABASE_URL/FILE_SERVER_URL 사용):
//   pnpm --filter api exec tsx --env-file=.env ../../../ops/scripts/e2e-develop.mts run
//   pnpm --filter api exec tsx --env-file=.env ../../../ops/scripts/e2e-develop.mts cleanup
// 검증 맥락: docs/DEVELOP_FLOW.md §4(상태 머신)·§5(견적)·§8(API).
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const apiRequire = createRequire(new URL('../../samplepcb-web-mono-app/apps/api/package.json', import.meta.url));
const { PrismaClient } = apiRequire('@prisma/client');

const API = process.env.E2E_API ?? 'http://127.0.0.1:3333';
const MAILPIT = 'http://127.0.0.1:8025';
const IDS_FILE = join(tmpdir(), 'sp-develop-e2e-ids.json');
const MODE = process.argv[2] ?? 'run';
const ANCHOR_IT_ID = 'sp-develop-svc';
const CART_BUCKET = '7777000002'; // 마켓 하네스(…001)와 다른 합성 버킷
const USECASES = ['develop.dev-review', 'develop.dev-diagram'];

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const drainMail = async () => {
  let prev = await mailpitTotal();
  if (prev === null) return null;
  for (let i = 0; i < 15; i += 1) {
    await sleep(600);
    const cur = await mailpitTotal();
    if (cur === null) return null;
    if (cur === prev) return cur;
    prev = cur;
  }
  return prev;
};
const expectMailDelta = async (baseline, delta, name) => {
  if (baseline === null) {
    console.log(`SKIP  ${name} (Mailpit 미가동)`);
    return null;
  }
  const target = baseline + delta;
  for (let i = 0; i < 30; i += 1) {
    const cur = await mailpitTotal();
    if (cur !== null && cur >= target) {
      assert(true, name);
      return cur;
    }
    await sleep(400);
  }
  const now = await mailpitTotal();
  assert(false, name, `기대 +${delta} 이상 (baseline ${baseline}, 현재 ${now})`);
  return now;
};

const g5q = (sql, ...binds) => prisma.$queryRawUnsafe(sql, ...binds);
const g5e = (sql, ...binds) => prisma.$executeRawUnsafe(sql, ...binds);

// od_id 8.0e15 대역(2^53 미만 — mysql2 number 정밀도 함정, 마켓 하네스 실측).
let odSeq = 0;
const nextSimOdId = () => String(8_000_000_000_000_000 + Math.floor(Math.random() * 900_000_000_000) + odSeq++);
const simulatePaidOrder = async (ctId, amount, mbId) => {
  const odId = nextSimOdId();
  await g5e(`UPDATE g5_shop_cart SET od_id = ?, ct_status = '입금' WHERE ct_id = ?`, odId, ctId);
  await g5e(
    `INSERT INTO g5_shop_order
       (od_id, mb_id, od_name, od_email, od_tel, od_hp, od_zip1, od_zip2, od_addr1, od_addr2, od_addr3, od_addr_jibeon,
        od_status, od_settle_case, od_cart_price, od_receipt_price, od_misu,
        od_memo, od_shop_memo, od_mod_history, od_cash, od_cash_no, od_cash_info, od_time, od_ip)
     VALUES (?, ?, 'E2E고객', '', '', '', '', '', '', '', '', '', '입금', '무통장', ?, ?, 0, '', '', '', 0, '', '', NOW(), '127.0.0.1')`,
    odId,
    mbId,
    amount,
    amount,
  );
  return odId;
};
const cartRowsByIoId = (ioId) =>
  g5q(`SELECT ct_id, CAST(od_id AS CHAR) AS od_id, ct_status, io_id, io_price, ct_qty, ct_price, it_id, ct_select FROM g5_shop_cart WHERE io_id = ? ORDER BY ct_id`, ioId);
const optionRowsByIoId = (ioId) => g5q(`SELECT io_id, io_price FROM g5_shop_item_option WHERE it_id = ? AND io_id = ?`, ANCHOR_IT_ID, ioId);

// 등록 payload — 공통 조건 3(필수) + 공통 질문 1 + 연락처.
const requiredAnswers = [
  { code: 'timeline', choices: ['m2_3'] },
  { code: 'target_stage', choices: ['working_proto'] },
  { code: 'deliverable_scope', choices: ['full_source'] },
];
const basePayload = (title, extra = {}) => ({
  title,
  serviceAreas: ['circuit', 'firmware'],
  tools: { version: 1, byArea: {} },
  description: '[e2e] BLE 온습도 로거. 배터리 구동, 스마트폰 앱 연동. 개발의뢰 하네스 픽스처입니다.',
  answers: [...requiredAnswers, { code: 'stage', choices: ['idea'] }],
  budgetRange: 'r500_2000',
  ndaWanted: true,
  aiConsent: true,
  contact: { name: '이투이', company: '이투이랩', phone: '010-1234-5678', email: 'e2e-develop@example.com', hours: '오후 2~6시' },
  ...extra,
});
const createForm = (payload, files = []) => {
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  for (const f of files) form.append(f.field, new Blob([f.body], { type: f.type ?? 'text/plain' }), f.name);
  return form;
};
const eventForm = (payload, files = []) => createForm(payload, files);

const minimalReview = (areas) => ({
  version: 4,
  brief: { serviceAreas: areas, answers: requiredAnswers },
  summary: '[e2e] 담당자 작업본 요약',
  requirements: [{ text: 'BLE 5.0 광고 주기 1초', evidence: 'e2e' }],
  areas: areas.map((area) => ({ area, summary: `${area} 한 줄`, spec: [{ item: '전원', text: '리튬 3.7V', evidence: 'e2e' }], observations: [] })),
  openQuestions: [{ question: '외장은 정해졌나요?', why: '안테나 배치', area: 'circuit', resolution: '상담 결과: 3D 프린팅 외장' }],
  checks: [],
  // generatedAt 은 고정 — 같은 내용을 두 번 저장했을 때 버전이 안 늘어나는지(§6.2 중복 규칙) 보려면 meta 도 같아야 한다.
  meta: { jobId: 'e2e', model: 'e2e-model', promptVersion: 'dev-review.v5', inputHash: 'e2e', generatedAt: '2026-09-05T00:00:00.000Z', attachmentFiles: [] },
  adminComment: '담당자 의견: 배터리 수명 목표를 먼저 정하면 회로가 단순해집니다.',
  schedule: {
    phases: [
      { name: '회로 설계', minWeeks: 2, maxWeeks: 3, output: '회로도·부품표', prerequisite: '전원 사양 확정', note: '' },
      { name: '시제품 제작', minWeeks: 3, maxWeeks: 5, output: '시제품 3대', prerequisite: '', note: '부품 수급 리드타임 포함' },
    ],
    wishCode: 'm2_3',
    assumptions: '고객 자료 회신 3일 이내·시제품 1회전 기준',
  },
});

const quoteBody = (kind, over = {}) => ({
  kind,
  title: kind === 'change' ? '추가 견적 — 앱 화면 3종' : '1차 견적',
  vatMode: 'separate',
  durationDays: 60,
  scheduleNote: '착수 후 8주',
  deliverables: ['회로도', '거버', '펌웨어 소스'],
  exclusions: 'PCB 제작비·부품비 별도',
  terms: '표준 조건 e2e',
  warrantyDays: 180,
  reviewDays: 7,
  validUntil: '2099-12-31',
  note: null,
  internalNote: '내부 메모',
  items: [
    { title: 'H/W 회로·PCB 설계', description: null, amount: 3_600_000, durationDays: 30 },
    { title: '펌웨어·BLE 통신', description: null, amount: 3_200_000, durationDays: 30 },
  ],
  milestones: [
    { title: '착수금', ratioBp: 5000, trigger: 'on_accept', unlocksDeliverables: false },
    { title: '잔금', ratioBp: 5000, trigger: 'on_delivery', unlocksDeliverables: true },
  ],
  ...over,
});

async function cleanup() {
  const ids = JSON.parse(readFileSync(IDS_FILE, 'utf8'));
  const fileServer = process.env.FILE_SERVER_URL ?? 'https://file.samplepcb.kr';
  const rids = ids.requestIds.map((id) => BigInt(id));
  const events = await prisma.spDevelopEvent.findMany({ where: { requestId: { in: rids } }, select: { id: true } });
  const quotes = await prisma.spDevelopQuote.findMany({ where: { requestId: { in: rids } }, select: { id: true } });
  const refPairs = [
    ...rids.map((id) => ({ refType: 'sp_develop_request', refId: id })),
    ...events.map((e) => ({ refType: 'sp_develop_event', refId: e.id })),
    ...quotes.map((q) => ({ refType: 'sp_develop_quote', refId: q.id })),
  ];
  for (const p of refPairs) {
    const files = await prisma.spFile.findMany({ where: { refType: p.refType, refId: p.refId } });
    for (const f of files) {
      try {
        await fetch(`${fileServer}/api/delete/${encodeURIComponent(f.pathToken)}`);
      } catch {
        console.warn('file server delete 실패(고아 가능):', Number(f.id));
      }
    }
    await prisma.spFile.deleteMany({ where: { refType: p.refType, refId: p.refId } });
  }
  const keys = (ids.paymentKeys ?? []).map((k) => String(k));
  if (keys.length > 0) {
    const ph = keys.map(() => '?').join(',');
    await g5e(`DELETE FROM g5_shop_cart WHERE io_id IN (${ph})`, ...keys);
    await g5e(`DELETE FROM g5_shop_item_option WHERE io_id IN (${ph})`, ...keys);
  }
  const ods = (ids.simOdIds ?? []).map((o) => String(o));
  if (ods.length > 0) {
    const ph = ods.map(() => '?').join(',');
    await g5e(`DELETE FROM g5_shop_order WHERE od_id IN (${ph})`, ...ods);
    await g5e(`DELETE FROM g5_shop_order_delete WHERE de_key IN (${ph})`, ...ods);
  }
  // 의뢰 삭제 → events·quotes·items·milestones cascade.
  await prisma.spDevelopRequest.deleteMany({ where: { id: { in: rids } } });
  // 유스케이스 원복.
  for (const [useCase, enabled] of Object.entries(ids.usecaseEnabled ?? {})) {
    await prisma.spAiUsecase.updateMany({ where: { useCase }, data: { enabled } });
  }
  let leftCart = 0;
  if (keys.length > 0) {
    const ph = keys.map(() => '?').join(',');
    const [cart] = await g5q(`SELECT COUNT(*) AS c FROM g5_shop_cart WHERE io_id IN (${ph})`, ...keys);
    leftCart = Number(cart?.c ?? 0);
  }
  const leftReq = await prisma.spDevelopRequest.count({ where: { id: { in: rids } } });
  console.log(`잔여(0 기대) — 카트행:${leftCart} 의뢰:${leftReq}`);
  console.log('cleanup 완료:', ids);
}

async function run() {
  const cfg = await prisma.$queryRaw`SELECT cf_admin FROM g5_config LIMIT 1`;
  const cfAdmin = String(cfg[0]?.cf_admin ?? '');
  if (cfAdmin === '') throw new Error('cf_admin 없음');
  const members = await prisma.$queryRaw`
    SELECT mb_id, mb_nick, mb_email FROM g5_member
    WHERE mb_email <> '' AND mb_leave_date = '' AND mb_id <> ${cfAdmin}
    ORDER BY mb_datetime DESC LIMIT 2`;
  if (members.length < 2) throw new Error('테스트용 회원 2명 확보 실패');
  const [cm, sm] = members;
  const tClient = sign({ mbId: cm.mb_id, mbNick: cm.mb_nick, level: 2, isAdmin: false, cartId: CART_BUCKET });
  const tClientNoCart = sign({ mbId: cm.mb_id, mbNick: cm.mb_nick, level: 2, isAdmin: false });
  const tStranger = sign({ mbId: sm.mb_id, mbNick: sm.mb_nick, level: 2, isAdmin: false });
  const tAdmin = sign({ mbId: cfAdmin, mbNick: 'admin', level: 10, isAdmin: true });
  console.log(`주체: client=${cm.mb_id} stranger=${sm.mb_id} admin=${cfAdmin}`);

  const ids = { requestIds: [], paymentKeys: [], simOdIds: [], usecaseEnabled: {} };
  const save = () => writeFileSync(IDS_FILE, JSON.stringify(ids));
  // 실 LLM 차단 — develop.* 유스케이스 비활성(원복은 cleanup).
  for (const useCase of USECASES) {
    const row = await prisma.spAiUsecase.findUnique({ where: { useCase } });
    ids.usecaseEnabled[useCase] = row?.enabled ?? false;
    if (row !== null) await prisma.spAiUsecase.update({ where: { useCase }, data: { enabled: false } });
  }
  save();
  let mail = await drainMail();

  // ── 1. 등록 ──────────────────────────────────────────────────────────────────
  const bad = await req('POST', '/api/develop/requests', { token: tClient, form: createForm(basePayload('[e2e] 필수 조건 누락', { answers: [] })) });
  assert(bad.status === 400 && bad.json?.error === 'ANSWERS_REQUIRED', '등록: 필수 조건 누락 400 ANSWERS_REQUIRED', bad);
  const badContact = await req('POST', '/api/develop/requests', { token: tClient, form: createForm({ ...basePayload('[e2e] 연락처 누락'), contact: undefined }) });
  assert(badContact.status === 400 && badContact.json?.error === 'PAYLOAD_SCHEMA_MISMATCH', '등록: 연락처 누락 400', badContact);
  const noAuth = await req('POST', '/api/develop/requests', { form: createForm(basePayload('[e2e] 비로그인')) });
  assert(noAuth.status === 401, '등록: 비로그인 401', noAuth);

  const created = await req('POST', '/api/develop/requests', {
    token: tClient,
    form: createForm(basePayload('[e2e] BLE 온습도 로거'), [
      { field: 'attachment', name: 'spec.txt', body: '[e2e] 요구사항 텍스트. BLE 5.0, 3.7V 배터리.' },
      { field: 'attachment:circuit:schematic', name: 'sch.txt', body: '[e2e] 슬롯 첨부(회로도 자리)' },
    ]),
  });
  assert(created.status === 200 && created.json?.data?.status === 'received', '등록 200 received', created);
  const rid = created.json.data.requestId;
  ids.requestIds.push(rid);
  save();
  assert(created.json.data.aiQueued === true, '등록: aiQueued(동의·자동 초안 설정) true', created.json.data);
  mail = await expectMailDelta(mail, 1, '메일: 접수 확인(고객)');

  // ── 2. 소유자 경계·목록·상세 ─────────────────────────────────────────────────
  const mine = await req('GET', '/api/develop/my/requests', { token: tClient });
  assert(mine.status === 200 && mine.json.data.items.some((i) => i.requestId === rid), '내 의뢰 목록에 있음', mine.json);
  const strangerList = await req('GET', '/api/develop/my/requests', { token: tStranger });
  assert(strangerList.status === 200 && !strangerList.json.data.items.some((i) => i.requestId === rid), '제3자 목록엔 없음');
  const det = await req('GET', `/api/develop/requests/${rid}`, { token: tClient });
  assert(det.status === 200 && det.json.data.contact.name === '이투이' && det.json.data.files.length === 2, '상세 200(연락처·첨부 2)', det.json?.data?.files);
  assert(det.json.data.review === null && det.json.data.diagram === null, '상세: 공개본 없음(null)');
  assert(!('internalMemo' in det.json.data) && !('aiSupplement' in det.json.data), '상세: 내부 메모·보충 메모 비노출');
  assert(det.json.data.viewer.canEdit === true && det.json.data.viewer.canCancel === true, '상세: received 수정·취소 가능');
  const strangerDet = await req('GET', `/api/develop/requests/${rid}`, { token: tStranger });
  assert(strangerDet.status === 403, '제3자 상세 403', strangerDet);
  const adminOnCustomer = await req('GET', `/api/develop/requests/${rid}`, { token: tAdmin });
  assert(adminOnCustomer.status === 403, '관리자 토큰으로 고객 라우트 403(소유자만)', adminOnCustomer);
  const fileId = det.json.data.files[0].fileId;
  const dl = await fetch(`${API}/api/develop/requests/${rid}/files/${fileId}`, { headers: { Authorization: `Bearer ${tClient}` } });
  assert(dl.status === 200, '첨부 다운로드 200(소유자)', dl.status);
  const dlStranger = await req('GET', `/api/develop/requests/${rid}/files/${fileId}`, { token: tStranger });
  assert(dlStranger.status === 403, '첨부 다운로드 403(제3자)');
  const pv = await req('GET', `/api/develop/requests/${rid}/files/${fileId}/preview`, { token: tClient });
  assert(pv.status === 200 && pv.json.data.kind === 'unsupported', '미리보기: txt 는 브라우저 몫(unsupported FORMAT)', pv.json);

  // ── 3. 수정·이벤트 ──────────────────────────────────────────────────────────
  const patched = await req('PATCH', `/api/develop/requests/${rid}`, { token: tClient, body: { title: '[e2e] BLE 온습도 로거 v2' } });
  assert(patched.status === 200 && patched.json.data.title.endsWith('v2'), '수정 200', patched.json);
  assert(patched.json.data.events.some((e) => e.type === 'edited'), '수정 이벤트 기록');
  const patchStranger = await req('PATCH', `/api/develop/requests/${rid}`, { token: tStranger, body: { title: '[e2e] 제3자 수정 시도' } });
  assert(patchStranger.status === 403, '제3자 수정 403');
  const patchAnswers = await req('PATCH', `/api/develop/requests/${rid}`, { token: tClient, body: { answers: [] } });
  assert(patchAnswers.status === 400 && patchAnswers.json?.error === 'ANSWERS_REQUIRED', '수정: 필수 조건 빼면 400');

  // ── 4. 관리자 워크큐·상세·메모 ─────────────────────────────────────────────
  const list = await req('GET', '/api/admin/develop/requests?tab=received&q=%5Be2e%5D', { token: tAdmin });
  assert(list.status === 200 && list.json.data.items.some((i) => i.requestId === rid) && list.json.data.counts.received >= 1, '관리자 워크큐(received·검색)', list.json?.data?.counts);
  const item = list.json.data.items.find((i) => i.requestId === rid);
  assert(item.ai.review === 'none' && item.ai.diagram === null && item.contact.phone === '010-1234-5678', '워크큐 행: AI none·연락처', item);
  const listCustomer = await req('GET', '/api/admin/develop/requests', { token: tClient });
  assert(listCustomer.status === 403, '관리자 라우트 비관리자 403');
  const adet = await req('GET', `/api/admin/develop/requests/${rid}`, { token: tAdmin });
  assert(adet.status === 200 && adet.json.data.review.draft === null && adet.json.data.review.working === null, '관리자 상세: 초안·작업본 없음');
  const memo = await req('PATCH', `/api/admin/develop/requests/${rid}`, { token: tAdmin, body: { internalMemo: '전화 상담 완료', aiSupplement: '고객 통화: 배터리 2000mAh 확정' } });
  assert(memo.status === 200 && memo.json.data.internalMemo === '전화 상담 완료' && memo.json.data.aiSupplement.includes('2000mAh'), '관리자 메모·보충 메모 저장');
  // 관리자 AI 재생성(동의 의뢰)은 force 로 실 LLM 을 돌리므로 하네스에서 부르지 않는다 — 미동의 409 만 본다(6절).

  // ── 5. 검토서 3층 · 구성도 ────────────────────────────────────────────────────
  const resetNoDraft = await req('POST', `/api/admin/develop/requests/${rid}/review/reset`, { token: tAdmin });
  assert(resetNoDraft.status === 409 && resetNoDraft.json?.error === 'DRAFT_EMPTY', '초안 없음 → reset 409');
  const pubEmpty = await req('POST', `/api/admin/develop/requests/${rid}/review/publish`, { token: tAdmin });
  assert(pubEmpty.status === 409 && pubEmpty.json?.error === 'REVIEW_EMPTY', '작업본 없음 → publish 409');
  const put = await req('PUT', `/api/admin/develop/requests/${rid}/review`, { token: tAdmin, body: { review: minimalReview(['circuit', 'firmware']) } });
  assert(put.status === 200 && put.json.data.review.working?.adminComment?.startsWith('담당자 의견') && put.json.data.review.editedAt !== null, '작업본 저장(담당자 의견·확인 결과)', put.json?.data?.review);
  assert(put.json.data.review.working.openQuestions[0].resolution === '상담 결과: 3D 프린팅 외장', '상의 항목 확인 결과 보존');
  assert(put.json.data.review.working.schedule?.phases?.length === 2 && put.json.data.review.working.schedule.wishCode === 'm2_3', '작업본 저장: 개발 일정 2단계·희망 시점', put.json?.data?.review?.working?.schedule);
  const badWeeks = await req('PUT', `/api/admin/develop/requests/${rid}/review`, {
    token: tAdmin,
    body: { review: { ...minimalReview(['circuit', 'firmware']), schedule: { phases: [{ name: '회로 설계', minWeeks: 0, maxWeeks: 200, output: '', prerequisite: '', note: '' }], wishCode: 'm2_3', assumptions: '' } } },
  });
  assert(badWeeks.status === 400, '개발 일정 잘못된 주(0·200) → 400', badWeeks.json);
  const stillTwo = await req('GET', `/api/admin/develop/requests/${rid}`, { token: tAdmin });
  assert(stillTwo.json.data.review.working.schedule.phases.length === 2, '400 뒤 작업본 일정은 그대로');
  const custBefore = await req('GET', `/api/develop/requests/${rid}`, { token: tClient });
  assert(custBefore.json.data.review === null, '공개 전: 고객 검토서 null');
  const pub = await req('POST', `/api/admin/develop/requests/${rid}/review/publish`, { token: tAdmin });
  assert(pub.status === 200 && pub.json.data.review.publicReview !== null && pub.json.data.ai.review === 'published', '검토서 공개');
  assert(pub.json.data.review.publicReview.schedule?.phases?.length === 2, '공개본에 개발 일정이 실린다');
  const custAfter = await req('GET', `/api/develop/requests/${rid}`, { token: tClient });
  assert(custAfter.json.data.review?.summary === '[e2e] 담당자 작업본 요약' && custAfter.json.data.reviewPublished === true, '공개 후: 고객 검토서 보임');
  assert(custAfter.json.data.review.schedule?.phases?.length === 2, '고객 공개본에도 개발 일정(예상)');
  assert(custAfter.json.data.reviewPublicSeq === 2, '고객 상세 reviewPublicSeq = 공개 판 v2', custAfter.json?.data?.reviewPublicSeq);
  const put2 = await req('PUT', `/api/admin/develop/requests/${rid}/review`, { token: tAdmin, body: { review: { ...minimalReview(['circuit', 'firmware']), summary: '수정본' } } });
  assert(put2.json.data.review.publishedStale === true, '공개 뒤 편집 → publishedStale');
  const custStale = await req('GET', `/api/develop/requests/${rid}`, { token: tClient });
  assert(custStale.json.data.review?.summary === '[e2e] 담당자 작업본 요약', '공개본은 스냅샷(편집이 고객 화면을 안 흔든다)');
  // ── 검토서 버전 원장(§6.2): 저장·공개·저장이 v1 working·v2 published·v3 working 으로 쌓였다 ──
  const vers = await req('GET', `/api/admin/develop/requests/${rid}/review/versions`, { token: tAdmin });
  assert(
    vers.status === 200 && vers.json.data.items.map((v) => `${v.seq}:${v.kind}`).join(',') === '3:working,2:published,1:working',
    '버전 원장: v3 working · v2 published · v1 working(최신 먼저)',
    vers.json?.data?.items?.map((v) => `${v.seq}:${v.kind}`),
  );
  assert(vers.json.data.current.workingSeq === 3 && vers.json.data.current.publicSeq === 2 && vers.json.data.current.draftSeq === null, '현재 포인터: 작업본 v3 · 공개 v2 · 초안 없음', vers.json?.data?.current);
  assert(vers.json.data.items[0].author === 'admin' && vers.json.data.items[0].counts.phases === 2, '버전 메타: 작성자·일정 단계 수', vers.json?.data?.items?.[0]);
  const putSame = await req('PUT', `/api/admin/develop/requests/${rid}/review`, { token: tAdmin, body: { review: { ...minimalReview(['circuit', 'firmware']), summary: '수정본' } } });
  const versSame = await req('GET', `/api/admin/develop/requests/${rid}/review/versions`, { token: tAdmin });
  assert(putSame.status === 200 && versSame.json.data.items.length === 3, '같은 내용 저장은 버전을 늘리지 않는다', versSame.json?.data?.items?.length);
  const ver1 = await req('GET', `/api/admin/develop/requests/${rid}/review/versions/1`, { token: tAdmin });
  assert(ver1.status === 200 && ver1.json.data.review.summary === '[e2e] 담당자 작업본 요약' && ver1.json.data.meta.seq === 1, '옛 판 단건 조회', ver1.json?.data?.meta);
  const restored = await req('POST', `/api/admin/develop/requests/${rid}/review/versions/1/restore`, { token: tAdmin });
  assert(restored.status === 200 && restored.json.data.review.working.summary === '[e2e] 담당자 작업본 요약' && restored.json.data.review.editedBy === 'admin', '복원: 작업본이 v1 내용', restored.json?.data?.review?.working?.summary);
  const versRestored = await req('GET', `/api/admin/develop/requests/${rid}/review/versions`, { token: tAdmin });
  const newest = versRestored.json.data.items[0];
  assert(versRestored.json.data.items.length === 4 && newest.kind === 'working' && newest.parentSeq === 1 && newest.note === 'v1 복원' && versRestored.json.data.current.workingSeq === 4, '복원이 새 working v4(parentSeq=1)를 쌓는다', newest);
  const badRestore = await req('POST', `/api/admin/develop/requests/${rid}/review/versions/999/restore`, { token: tAdmin });
  assert(badRestore.status === 404, '없는 버전 복원 404');
  const versStranger = await req('GET', `/api/admin/develop/requests/${rid}/review/versions`, { token: tClient });
  assert(versStranger.status === 403, '버전 목록은 관리자만(403)');

  const unpub = await req('POST', `/api/admin/develop/requests/${rid}/review/unpublish`, { token: tAdmin });
  assert(unpub.status === 200 && unpub.json.data.review.publicReview === null, '검토서 공개 취소');

  const dpubEmpty = await req('POST', `/api/admin/develop/requests/${rid}/diagram/publish`, { token: tAdmin });
  assert(dpubEmpty.status === 409 && dpubEmpty.json?.error === 'DIAGRAM_EMPTY', '구성도 없음 → publish 409');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10" onclick="x()"/></svg>';
  const up = await req('POST', `/api/admin/develop/requests/${rid}/diagram/upload`, { token: tAdmin, form: createForm({}, [{ field: 'file', name: 'diagram.svg', body: svg, type: 'image/svg+xml' }]) });
  assert(up.status === 200 && up.json.data.diagram.source === 'upload' && up.json.data.diagram.html.includes('<svg'), '구성도 svg 교체 업로드', up.json?.data?.diagram);
  assert(!up.json.data.diagram.html.includes('<script') && !up.json.data.diagram.html.includes('onclick'), '업로드 svg 살균(script·이벤트 제거)');
  const dpub = await req('POST', `/api/admin/develop/requests/${rid}/diagram/publish`, { token: tAdmin });
  assert(dpub.status === 200 && dpub.json.data.diagram.published === true, '구성도 공개');
  const custDiag = await req('GET', `/api/develop/requests/${rid}`, { token: tClient });
  assert(custDiag.json.data.diagram?.source === 'upload' && custDiag.json.data.diagram.html.includes('<svg'), '고객: 공개 구성도(upload)');

  // ── 6. 상태 전이(검토 시작) · 미동의 AI 409 ───────────────────────────────────
  const toReviewing = await req('POST', `/api/admin/develop/requests/${rid}/status`, { token: tAdmin, body: { to: 'reviewing' } });
  assert(toReviewing.status === 200 && toReviewing.json.data.status === 'reviewing', '전이 received→reviewing');
  const badTransition = await req('POST', `/api/admin/develop/requests/${rid}/status`, { token: tAdmin, body: { to: 'completed' } });
  assert(badTransition.status === 409, '잘못된 전이 409(reviewing→completed)');
  const declineNoReason = await req('POST', `/api/admin/develop/requests/${rid}/status`, { token: tAdmin, body: { to: 'declined' } });
  assert(declineNoReason.status === 409 && declineNoReason.json?.error === 'REASON_REQUIRED', '진행 불가 사유 필수 409');
  const noConsent = await req('POST', '/api/develop/requests', { token: tClient, form: createForm(basePayload('[e2e] AI 미동의', { aiConsent: false })) });
  const rid2 = noConsent.json.data.requestId;
  ids.requestIds.push(rid2);
  save();
  assert(noConsent.json.data.aiQueued === false, '미동의 등록: aiQueued false');
  const aiNoConsent = await req('POST', `/api/admin/develop/requests/${rid2}/ai/review`, { token: tAdmin });
  assert(aiNoConsent.status === 409 && aiNoConsent.json?.error === 'AI_CONSENT_REQUIRED', '미동의 의뢰 AI 재생성 409');

  // ── 7. 견적 ─────────────────────────────────────────────────────────────────
  const changeTooEarly = await req('POST', `/api/admin/develop/requests/${rid}/quotes`, { token: tAdmin, body: quoteBody('change') });
  assert(changeTooEarly.status === 409 && changeTooEarly.json?.error === 'KIND_MISMATCH', '착수 전 추가 견적 409');
  const badRatio = await req('POST', `/api/admin/develop/requests/${rid}/quotes`, { token: tAdmin, body: quoteBody('initial', { milestones: [{ title: '전액', ratioBp: 9000, trigger: 'on_accept', unlocksDeliverables: true }] }) });
  assert(badRatio.status === 400, '마일스톤 비율 합≠100% 400');
  const q1 = await req('POST', `/api/admin/develop/requests/${rid}/quotes`, { token: tAdmin, body: quoteBody('initial') });
  assert(q1.status === 200 && q1.json.data.status === 'draft' && q1.json.data.version === 1, '견적 초안 생성 v1', q1.json);
  assert(q1.json.data.supplyAmount === 6_800_000 && q1.json.data.vatAmount === 680_000 && q1.json.data.totalAmount === 7_480_000, '금액: 공급가 6.8M·VAT 0.68M·합계 7.48M', q1.json?.data);
  assert(q1.json.data.milestones.length === 2 && q1.json.data.milestones[0].amount === 3_740_000 && q1.json.data.milestones[1].unlocksDeliverables === true, '마일스톤 2건 50/50');
  const custNoDraft = await req('GET', `/api/develop/requests/${rid}`, { token: tClient });
  assert(custNoDraft.json.data.quotes.length === 0, '고객: 초안 견적 비노출');
  const q1patch = await req('PATCH', `/api/admin/develop/quotes/${q1.json.data.quoteId}`, { token: tAdmin, body: quoteBody('initial', { title: '1차 견적(수정)' }) });
  assert(q1patch.status === 200 && q1patch.json.data.title === '1차 견적(수정)', '초안 수정');
  mail = await drainMail();
  const sent = await req('POST', `/api/admin/develop/quotes/${q1.json.data.quoteId}/send`, { token: tAdmin });
  assert(sent.status === 200 && sent.json.data.status === 'sent' && sent.json.data.sentAt !== null, '견적 발송');
  mail = await expectMailDelta(mail, 1, '메일: 견적 발송(고객)');
  const afterSend = await req('GET', `/api/develop/requests/${rid}`, { token: tClient });
  assert(afterSend.json.data.status === 'quoted' && afterSend.json.data.quotes.length === 1 && afterSend.json.data.nextAction === 'review_quote', '고객: quoted·견적 1건·nextAction review_quote', afterSend.json?.data?.nextAction);
  const editAfterQuote = await req('PATCH', `/api/develop/requests/${rid}`, { token: tClient, body: { title: '[e2e] 견적 뒤 수정 시도' } });
  assert(editAfterQuote.status === 409 && editAfterQuote.json?.error === 'NOT_EDITABLE', '견적 뒤 수정 409 NOT_EDITABLE');
  const patchSent = await req('PATCH', `/api/admin/develop/quotes/${q1.json.data.quoteId}`, { token: tAdmin, body: quoteBody('initial') });
  assert(patchSent.status === 409 && patchSent.json?.error === 'QUOTE_NOT_DRAFT', '발송 견적 수정 409');
  // 수정 견적 v2 발송 → v1 superseded
  const q2 = await req('POST', `/api/admin/develop/requests/${rid}/quotes`, { token: tAdmin, body: quoteBody('revision', { title: '2차 견적' }) });
  const q2sent = await req('POST', `/api/admin/develop/quotes/${q2.json.data.quoteId}/send`, { token: tAdmin });
  assert(q2sent.status === 200 && q2sent.json.data.version === 2, '수정 견적 v2 발송');
  const adetQ = await req('GET', `/api/admin/develop/requests/${rid}`, { token: tAdmin });
  const v1 = adetQ.json.data.quotes.find((q) => q.version === 1);
  assert(v1.status === 'superseded' && adetQ.json.data.quotes.filter((q) => q.status === 'sent').length === 1, 'v1 superseded·sent 1건');

  // ── 8. 수락 ──────────────────────────────────────────────────────────────────
  const acceptOld = await req('POST', `/api/develop/requests/${rid}/quotes/${q1.json.data.quoteId}/accept`, { token: tClient, body: { agree: true, name: '이투이' } });
  assert(acceptOld.status === 409 && acceptOld.json?.error === 'QUOTE_NOT_OPEN', '대체된 견적 수락 409');
  const acceptStranger = await req('POST', `/api/develop/requests/${rid}/quotes/${q2.json.data.quoteId}/accept`, { token: tStranger, body: { agree: true, name: 'x' } });
  assert(acceptStranger.status === 403, '제3자 수락 403');
  mail = await drainMail();
  const accepted = await req('POST', `/api/develop/requests/${rid}/quotes/${q2.json.data.quoteId}/accept`, { token: tClient, body: { agree: true, name: '이투이' } });
  assert(accepted.status === 200 && accepted.json.data.status === 'accepted', '수락 → accepted', accepted.json);
  const q2v = accepted.json.data.quotes.find((q) => q.version === 2);
  assert(q2v.status === 'accepted' && q2v.acceptedName === '이투이' && q2v.milestones.every((m) => m.status === 'pending'), '견적 accepted·마일스톤 pending');
  assert(q2v.milestones[0].payable === true && q2v.milestones[1].payable === false && accepted.json.data.nextAction === 'pay', 'payable: 착수금만·nextAction pay');
  for (const m of q2v.milestones) ids.paymentKeys.push(m.milestoneId); // 임시(아래에서 paymentKey 로 교체)
  const msRows = await prisma.spDevelopMilestone.findMany({ where: { requestId: BigInt(rid) } });
  ids.paymentKeys = msRows.map((m) => m.paymentKey);
  save();
  const m1 = q2v.milestones[0];
  const m2 = q2v.milestones[1];

  // ── 9. checkout ──────────────────────────────────────────────────────────────
  const noCart = await req('POST', `/api/develop/requests/${rid}/milestones/${m1.milestoneId}/checkout`, { token: tClientNoCart });
  assert(noCart.status === 409 && noCart.json?.error === 'NO_CART_ID', 'checkout: cartId 없음 409');
  const notPayable = await req('POST', `/api/develop/requests/${rid}/milestones/${m2.milestoneId}/checkout`, { token: tClient });
  assert(notPayable.status === 409 && notPayable.json?.error === 'NOT_PAYABLE', 'checkout: 잔금(납품 전) 409 NOT_PAYABLE');
  const co = await req('POST', `/api/develop/requests/${rid}/milestones/${m1.milestoneId}/checkout`, { token: tClient });
  assert(co.status === 200 && String(co.json.data.redirectUrl).endsWith('/shop/orderform.php'), 'checkout 200 → orderform', co.json);
  const m1Row = msRows.find((m) => Number(m.id) === m1.milestoneId);
  const cart1 = await cartRowsByIoId(m1Row.paymentKey);
  assert(cart1.length === 1 && cart1[0].ct_status === '쇼핑' && cart1[0].it_id === ANCHOR_IT_ID && Number(cart1[0].io_price) === m1.amount && Number(cart1[0].ct_qty) === 1 && cart1[0].od_id === CART_BUCKET, 'DB: 카트행 1(쇼핑·앵커·io_price=금액·qty 1·버킷)', cart1);
  const opt1 = await optionRowsByIoId(m1Row.paymentKey);
  assert(opt1.length === 1 && Number(opt1[0].io_price) === m1.amount, 'DB: 옵션행 1(io_price=금액)');
  const co2 = await req('POST', `/api/develop/requests/${rid}/milestones/${m1.milestoneId}/checkout`, { token: tClient });
  const cart1b = await cartRowsByIoId(m1Row.paymentKey);
  assert(co2.status === 200 && cart1b.length === 1 && cart1b[0].ct_id === cart1[0].ct_id, '재checkout: 같은 카트행 재사용');

  // ── 10. 결제 시뮬 → lazy 승격 ────────────────────────────────────────────────
  mail = await drainMail();
  const od1 = await simulatePaidOrder(Number(cart1[0].ct_id), m1.amount, cm.mb_id);
  ids.simOdIds.push(od1);
  save();
  const afterPay = await req('GET', `/api/develop/requests/${rid}`, { token: tClient });
  const m1After = afterPay.json.data.quotes.find((q) => q.version === 2).milestones[0];
  assert(m1After.status === 'paid' && m1After.payment?.odId === od1 && afterPay.json.data.status === 'in_progress' && afterPay.json.data.startedAt !== null, 'lazy: 착수금 paid·in_progress·startedAt', { m1After, status: afterPay.json.data.status });
  assert(afterPay.json.data.events.some((e) => e.type === 'payment_confirmed'), '결제 확인 이벤트');
  mail = await expectMailDelta(mail, 1, '메일: 결제 확인(고객)');
  const coPaid = await req('POST', `/api/develop/requests/${rid}/milestones/${m1.milestoneId}/checkout`, { token: tClient });
  assert(coPaid.status === 409 && coPaid.json?.error === 'ALREADY_PAID', 'paid 마일스톤 checkout 409');
  const cancelLate = await req('POST', `/api/develop/requests/${rid}/cancel`, { token: tClient, body: {} });
  assert(cancelLate.status === 409 && cancelLate.json?.error === 'NOT_CANCELLABLE', '착수 후 고객 취소 409');

  // ── 11. 진행 메모·확인 요청·납품(잠금) ────────────────────────────────────────
  const note = await req('POST', `/api/admin/develop/requests/${rid}/events`, { token: tAdmin, form: eventForm({ type: 'note', body: '내부 진행 메모', visibleToCustomer: false }) });
  assert(note.status === 200 && note.json.data.visibleToCustomer === false, '내부 메모 이벤트');
  const rr = await req('POST', `/api/admin/develop/requests/${rid}/events`, { token: tAdmin, form: eventForm({ type: 'review_request', title: '회로도 확인 요청', body: '회로도 v1 을 확인해 주세요' }, [{ field: 'file', name: 'sch-v1.txt', body: '[e2e] 회로도 v1' }]) });
  assert(rr.status === 200 && rr.json.data.files.length === 1, '확인 요청 이벤트(+파일)');
  const custRR = await req('GET', `/api/develop/requests/${rid}`, { token: tClient });
  assert(!custRR.json.data.events.some((e) => e.type === 'note') && custRR.json.data.nextAction === 'answer_review', '고객: 내부 메모 비노출·nextAction answer_review');
  const approve = await req('POST', `/api/develop/requests/${rid}/review-requests/${rr.json.data.eventId}/approve`, { token: tClient, body: { note: '좋습니다' } });
  assert(approve.status === 200 && approve.json.data.type === 'review_approved', '확인 요청 승인');
  mail = await drainMail();
  const deliver = await req('POST', `/api/admin/develop/requests/${rid}/events`, { token: tAdmin, form: eventForm({ type: 'deliverable', final: true, locked: true, body: '최종 산출물' }, [{ field: 'file', name: 'gerber.zip.txt', body: '[e2e] 최종 거버' }]) });
  assert(deliver.status === 200, '납품 이벤트(final·locked)');
  mail = await expectMailDelta(mail, 1, '메일: 납품 안내(고객)');
  const afterDeliver = await req('GET', `/api/develop/requests/${rid}`, { token: tClient });
  const delivEvent = afterDeliver.json.data.events.find((e) => e.type === 'deliverable');
  assert(afterDeliver.json.data.status === 'delivered' && afterDeliver.json.data.viewer.deliverablesLocked === true && delivEvent.files[0].locked === true, 'delivered·산출물 잠김', afterDeliver.json?.data?.viewer);
  assert(afterDeliver.json.data.nextAction === 'pay', '납품 후 잔금 payable → nextAction pay');
  const lockedDl = await req('GET', `/api/develop/requests/${rid}/files/${delivEvent.files[0].fileId}`, { token: tClient });
  assert(lockedDl.status === 403 && lockedDl.json?.error === 'LOCKED_UNTIL_PAID', '잠긴 산출물 다운로드 403 LOCKED_UNTIL_PAID');
  const adminDl = await fetch(`${API}/api/admin/develop/files/${delivEvent.files[0].fileId}`, { headers: { Authorization: `Bearer ${tAdmin}` } });
  assert(adminDl.status === 200, '관리자 파일 다운로드 200');
  const adminPv = await req('GET', `/api/admin/develop/files/${delivEvent.files[0].fileId}/preview`, { token: tAdmin });
  assert(adminPv.status === 200 && adminPv.json.data.fileId === delivEvent.files[0].fileId, '관리자 파일 미리보기 200', adminPv.json);
  const adminPvMissing = await req('GET', '/api/admin/develop/files/999999999/preview', { token: tAdmin });
  assert(adminPvMissing.status === 404, '관리자 파일 미리보기 404(없는 파일)');

  // ── 12. 검수 확정 → 잔금 → 잠금 해제 ─────────────────────────────────────────
  const confirm = await req('POST', `/api/develop/requests/${rid}/deliveries/${delivEvent.eventId}/confirm`, { token: tClient, body: { note: '검수 완료' } });
  assert(confirm.status === 200 && confirm.json.data.status === 'completed' && confirm.json.data.completedAt !== null, '검수 확정 → completed');
  const co3 = await req('POST', `/api/develop/requests/${rid}/milestones/${m2.milestoneId}/checkout`, { token: tClient });
  assert(co3.status === 200, '잔금 checkout 200(완료 뒤)');
  const m2Row = msRows.find((m) => Number(m.id) === m2.milestoneId);
  const cart2 = await cartRowsByIoId(m2Row.paymentKey);
  const od2 = await simulatePaidOrder(Number(cart2[0].ct_id), m2.amount, cm.mb_id);
  ids.simOdIds.push(od2);
  save();
  const afterFinal = await req('GET', `/api/develop/requests/${rid}`, { token: tClient });
  assert(afterFinal.json.data.viewer.deliverablesLocked === false && afterFinal.json.data.nextAction === null, '잔금 paid → 잠금 해제·nextAction null', afterFinal.json?.data?.viewer);
  const unlockedDl = await fetch(`${API}/api/develop/requests/${rid}/files/${delivEvent.files[0].fileId}`, { headers: { Authorization: `Bearer ${tClient}` } });
  assert(unlockedDl.status === 200, '해제 뒤 산출물 다운로드 200');
  // 추가 견적(change)은 완료 뒤엔 만들 수 없다(종결).
  const changeAfterDone = await req('POST', `/api/admin/develop/requests/${rid}/quotes`, { token: tAdmin, body: quoteBody('change') });
  assert(changeAfterDone.status === 409, '완료 뒤 견적 생성 409');

  // ── 13. 문의·A/S ─────────────────────────────────────────────────────────────
  const comment = await req('POST', `/api/develop/requests/${rid}/comments`, { token: tClient, form: eventForm({ body: '펌웨어 업데이트 방법을 알려 주세요', asRequest: false }) });
  assert(comment.status === 200 && comment.json.data.type === 'comment' && comment.json.data.actorName === '나', '고객 문의');
  const as = await req('POST', `/api/develop/requests/${rid}/comments`, { token: tClient, form: eventForm({ body: '전원이 안 켜집니다', asRequest: true }, [{ field: 'file', name: 'photo.txt', body: '[e2e] 사진 자리' }]) });
  assert(as.status === 200 && as.json.data.type === 'as_request' && as.json.data.files.length === 1, 'A/S 요청(+파일)');
  const reply = await req('POST', `/api/admin/develop/requests/${rid}/events`, { token: tAdmin, form: eventForm({ type: 'comment', body: '확인 후 연락드리겠습니다' }) });
  assert(reply.status === 200 && reply.json.data.type === 'comment' && reply.json.data.byAdmin === true, '담당자 답변');
  const tax = await req('POST', `/api/admin/develop/requests/${rid}/events`, { token: tAdmin, form: eventForm({ type: 'tax_invoice', payload: { issuedAt: '2026-09-05', supplyAmount: 6_800_000, vatAmount: 680_000 } }) });
  assert(tax.status === 200 && tax.json.data.payload?.supplyAmount === 6_800_000, '세금계산서 발행 기록');

  // ── 14. 두 번째 의뢰: 고객 취소 · 종결 뒤 전이 409 ───────────────────────────
  const cancel2 = await req('POST', `/api/develop/requests/${rid2}/cancel`, { token: tClient, body: { reason: '내부 사정' } });
  assert(cancel2.status === 200 && cancel2.json.data.status === 'cancelled', '고객 취소(received)');
  const editCancelled = await req('PATCH', `/api/develop/requests/${rid2}`, { token: tClient, body: { title: '[e2e] 취소 뒤 수정 시도' } });
  assert(editCancelled.status === 409, '취소 뒤 수정 409');
  const declineCancelled = await req('POST', `/api/admin/develop/requests/${rid2}/status`, { token: tAdmin, body: { to: 'declined', reason: 'x' } });
  assert(declineCancelled.status === 409, '취소된 의뢰 진행 불가 전이 409');
  const closedList = await req('GET', '/api/admin/develop/requests?tab=closed', { token: tAdmin });
  assert(closedList.json.data.items.some((i) => i.requestId === rid2), '워크큐 closed 탭에 취소 건');

  // ── 15. 세 번째 의뢰: 견적 거절 · 철회 · 만료 · 관리자 진행 불가 ────────────────
  const r3 = await req('POST', '/api/develop/requests', { token: tClient, form: createForm(basePayload('[e2e] 거절·만료', { aiConsent: false })) });
  const rid3 = r3.json.data.requestId;
  ids.requestIds.push(rid3);
  save();
  const q3 = await req('POST', `/api/admin/develop/requests/${rid3}/quotes`, { token: tAdmin, body: quoteBody('initial') });
  await req('POST', `/api/admin/develop/quotes/${q3.json.data.quoteId}/send`, { token: tAdmin });
  const decl = await req('POST', `/api/develop/requests/${rid3}/quotes/${q3.json.data.quoteId}/decline`, { token: tClient, body: { reason: '예산 초과' } });
  assert(decl.status === 200 && decl.json.data.quotes[0].status === 'declined' && decl.json.data.status === 'quoted', '견적 거절 → declined·의뢰는 quoted 유지');
  const ms3 = await prisma.spDevelopMilestone.findMany({ where: { quoteId: BigInt(q3.json.data.quoteId) } });
  assert(ms3.every((m) => m.status === 'cancelled'), '거절 견적 마일스톤 cancelled');
  ids.paymentKeys.push(...ms3.map((m) => m.paymentKey));
  const q4 = await req('POST', `/api/admin/develop/requests/${rid3}/quotes`, { token: tAdmin, body: quoteBody('revision', { validUntil: '2020-01-01' }) });
  await req('POST', `/api/admin/develop/quotes/${q4.json.data.quoteId}/send`, { token: tAdmin });
  const expired = await req('GET', `/api/develop/requests/${rid3}`, { token: tClient });
  const q4v = expired.json.data.quotes.find((q) => q.quoteId === q4.json.data.quoteId);
  assert(q4v.status === 'expired', '유효기간 지난 견적 lazy expired');
  const acceptExpired = await req('POST', `/api/develop/requests/${rid3}/quotes/${q4.json.data.quoteId}/accept`, { token: tClient, body: { agree: true, name: 'x' } });
  assert(acceptExpired.status === 409 && acceptExpired.json?.error === 'QUOTE_EXPIRED', '만료 견적 수락 409 QUOTE_EXPIRED');
  const q5 = await req('POST', `/api/admin/develop/requests/${rid3}/quotes`, { token: tAdmin, body: quoteBody('revision') });
  await req('POST', `/api/admin/develop/quotes/${q5.json.data.quoteId}/send`, { token: tAdmin });
  const withdraw = await req('POST', `/api/admin/develop/quotes/${q5.json.data.quoteId}/withdraw`, { token: tAdmin });
  assert(withdraw.status === 200 && withdraw.json.data.status === 'withdrawn', '견적 철회');
  const ms45 = await prisma.spDevelopMilestone.findMany({ where: { quoteId: { in: [BigInt(q4.json.data.quoteId), BigInt(q5.json.data.quoteId)] } } });
  ids.paymentKeys.push(...ms45.map((m) => m.paymentKey));
  save();
  mail = await drainMail();
  const declinedReq = await req('POST', `/api/admin/develop/requests/${rid3}/status`, { token: tAdmin, body: { to: 'declined', reason: '당사 역량 밖' } });
  assert(declinedReq.status === 200 && declinedReq.json.data.status === 'declined', '관리자 진행 불가');
  mail = await expectMailDelta(mail, 1, '메일: 진행 불가(고객)');

  // ── 16. 설정 ─────────────────────────────────────────────────────────────────
  const settings = await req('GET', '/api/admin/develop/settings', { token: tAdmin });
  assert(settings.status === 200 && settings.json.data.defaultMilestones.length >= 1 && settings.json.data.defaultReviewDays === 7, '설정 GET 기본값');
  const prevEmails = settings.json.data.notifyEmails;
  const sPatch = await req('PATCH', '/api/admin/develop/settings', { token: tAdmin, body: { notifyEmails: ['e2e-admin@example.com'] } });
  assert(sPatch.status === 200 && sPatch.json.data.notifyEmails[0] === 'e2e-admin@example.com' && sPatch.json.data.defaultReviewDays === 7, '설정 PATCH(부분)');
  await req('PATCH', '/api/admin/develop/settings', { token: tAdmin, body: { notifyEmails: prevEmails } });
  const sBad = await req('PATCH', '/api/admin/develop/settings', { token: tAdmin, body: { defaultMilestones: [{ title: 'x', ratioBp: 0, trigger: 'manual' }] } });
  assert(sBad.status === 400, '설정 PATCH 검증 400');
  const sCustomer = await req('GET', '/api/admin/develop/settings', { token: tClient });
  assert(sCustomer.status === 403, '설정 비관리자 403');

  console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
  console.log(`정리: 같은 명령의 cleanup 모드 실행 (ids: ${IDS_FILE})`);
  if (fail > 0) process.exitCode = 1;
}

if (MODE === 'cleanup') await cleanup();
else await run();
await prisma.$disconnect();
