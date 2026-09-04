// 재능마켓 API E2E — 1차(매칭: 블라인드·NDA·마감·레이스) + 2차(계약 결제: award 계약 자동생성·
// checkout·lazy 승격·납품·검수·자동확정·정산·취소·재주입) + v3 분야 레지스트리(2026-09-04:
// 분야별 툴 정규화·슬롯 첨부 area/slot·미지 툴 400·분야 밖 질문 400·정밀 구성도 409) + v4 구성도
// 분리(검토서 version 4 에 diagram 없음·devDiagramJobId 연결 대조·/my/dev-diagrams·jobs diagram 메타).
// 총 134항목(Mailpit 가동 시; 미가동이면 메일 6항목 SKIP). 시스템 구성도 유스케이스(sp_ai_usecase 의
// market.dev-diagram)는 하네스가 시작 시 enabled=0 으로 내리고 끝날 때 원복한다 — 활성이면 등록마다
// 10분짜리 kimi 생성이 시작돼 비용이 난다(dev-review 유스케이스는 건드리지 않는다).
// sp-node(3333)가 떠 있어야 하며, 실존 회원 3명(전문가/의뢰인/제3자)과 관리자(cf_admin)
// JWT 를 JWT_SECRET 으로 직접 서명해 사용한다(의뢰인 JWT 엔 영카트 버킷 cartId 클레임 포함).
// 메일은 로컬 Mailpit(127.0.0.1:25)이 가로채므로 실발송 0통. 2차 결제는 코어 orderformupdate
// 를 DB 직접(prisma raw)으로 최소 시뮬레이션한다. 생성 데이터(계약·카트행·옵션행·시뮬 주문·
// 산출물 실파일)는 cleanup 이 전수 정리한다(공유 DB — 스스로 만들고 스스로 지운다).
//
// 실행(apps/api 에서 — .env 의 JWT_SECRET/DATABASE_URL/FILE_SERVER_URL 사용):
//   pnpm --filter api exec tsx --env-file=.env ../../../ops/scripts/e2e-market.mts run
//   pnpm --filter api exec tsx --env-file=.env ../../../ops/scripts/e2e-market.mts cleanup
// 검증 맥락: docs/MARKET_FLOW.md §5(접근 제어)·§4(상태 머신). 2차(결제) 회귀에도 재사용.
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// 검토서 입력 해시는 **출하 코드와 같은 함수**를 쓴다(규칙이 갈라지면 정상 등록이
// REVIEW_STALE 로 튕기는 결함을 하네스가 못 잡는다). tsx 가 TS 를 그대로 로드한다.
import { devReviewInputHash } from '../../samplepcb-web-mono-app/apps/api/src/lib/ai/dev-review.ts';

// api 패키지의 node_modules 를 해석(스크립트가 리포 ops/ 에 살아 자체 해석 불가).
const apiRequire = createRequire(
  new URL('../../samplepcb-web-mono-app/apps/api/package.json', import.meta.url),
);
const { PrismaClient } = apiRequire('@prisma/client');

const API = 'http://127.0.0.1:3333';
const MAILPIT = 'http://127.0.0.1:8025';
const IDS_FILE = join(tmpdir(), 'sp-market-e2e-ids.json');
const MODE = process.argv[2] ?? 'run';

// 2차(계약 결제) 상수 — 계약 checkout 이 담는 앵커 상품 it_id 와, 의뢰인 JWT 의 cartId
// (영카트 장바구니 버킷 = g5_shop_cart.od_id). 버킷은 실 세션과 절대 겹치지 않는 합성 숫자값.
const ANCHOR_IT_ID = 'sp-market-svc';
const CART_BUCKET = '7777000001';

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

// ── AI 사전 검토서 잡 시드(LLM 호출 없음) ──────────────────────────────────────
// 등록 라우트는 클라이언트가 보낸 검토서 본문을 믿지 않고 sp_ai_job 의 done 행을 읽는다.
// 그래서 하네스가 완료 잡을 직접 만들어 두고 jobId 만 넘긴다(실호출은 관리자 샘플·프로빙 몫).
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
// 첨부 해시 항목 = `${파트이름}:${sha256}` 정렬 앞 10개 — routes/ai.ts devReviewAttachmentHashes 와
// 같은 규칙(서버 모듈을 통째로 로드하지 않으려고 계산만 복제; 규칙이 바뀌면 REVIEW_STALE 로 드러난다).
const attachmentHashOf = (field, body) => `${field}:${sha256(Buffer.from(body))}`;

const DEV_REVIEW_PROMPT_VERSION = 'dev-review.v5';
const DEV_DIAGRAM_PROMPT_VERSION = 'dev-diagram.v1';
const DEV_DIAGRAM_USECASE = 'market.dev-diagram';
// 프로젝트 공통 조건 3(완료 시점·목표 단계·인도 범위)은 등록 필수(ANSWERS_REQUIRED, docs/AI_DEV_REVIEW.md §13.8).
const requiredAnswers = [
  { code: 'timeline', choices: ['m2_3'] },
  { code: 'target_stage', choices: ['working_proto'] },
  { code: 'deliverable_scope', choices: ['full_source'] },
];
// 검토서 v4 픽스처 — MarketDevReview.parse 를 통과해야 sp_ai_job 시드가 유효하다(v4 는 3열 카드
// 구성도(diagram)가 없다 — 구성도는 market.dev-diagram 잡 하나뿐; 분야 카드 observations·상의 항목
// area·checks 는 v3 모양 그대로).
const minimalDevReview = (serviceAreas, answers, summary) => ({
  version: 4,
  brief: { serviceAreas, answers },
  summary,
  requirements: [{ text: 'E2E 확정 요구', evidence: 'E2E 통합 테스트용' }],
  areas: serviceAreas.map((area) => ({ area, summary: '', spec: [], observations: [] })),
  openQuestions: [
    { question: '전원은 무엇으로 공급하나요?', why: '전원 회로 설계에 필요', area: 'circuit' },
    { question: '자료 간 확인 필요: 없음', why: 'E2E', area: 'general' },
  ],
  checks: [],
  meta: {
    jobId: '', model: 'e2e-model', promptVersion: DEV_REVIEW_PROMPT_VERSION, inputHash: '',
    generatedAt: new Date().toISOString(), attachmentFiles: [],
  },
});

// 시스템 구성도 잡 결과 픽스처(DevDiagramJobResult = meta + 살균 HTML). status/jobId 는 시드가 채운다.
const minimalDevDiagramResult = (jobId, status = 'done') => {
  const now = new Date().toISOString();
  return {
    meta: {
      version: 1,
      status,
      jobId,
      model: 'e2e-model',
      promptVersion: DEV_DIAGRAM_PROMPT_VERSION,
      think: 'high',
      requestedAt: now,
      generatedAt: status === 'done' ? now : null,
      elapsedSecs: status === 'done' ? 1 : null,
      attempt: 1,
      audit:
        status === 'done'
          ? { svgCount: 1, sectionCount: 1, strippedNodes: 0, ungroundedTokens: [], requiredMissing: [] }
          : null,
      error: null,
      skipReason: null,
      corpusChars: 120,
    },
    html: status === 'done' ? '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg><h2>E2E 검토</h2>' : '',
  };
};

// g5 원시 접근 — 계약 결제는 그누보드 DB(samplepcb) 동거이므로 prisma 로 g5_* 를 직접
// 쿼리한다(1차 하네스가 g5_config·g5_member 를 $queryRaw 로 읽는 관례와 동일). g5-db.ts
// 함수를 재사용하지 않는 이유: 하네스가 결제 상태를 "만드는" 쪽이라 코어 부수효과 없는
// 최소 UPDATE/INSERT 로 시뮬레이션하며, 그 정리까지 스스로 책임진다.
const g5q = (sql, ...binds) => prisma.$queryRawUnsafe(sql, ...binds);
const g5e = (sql, ...binds) => prisma.$executeRawUnsafe(sql, ...binds);

// ── 주문 결제 시뮬(코어 orderformupdate 최소 재현) ──────────────────────────────
// checkout 이 만든 '쇼핑' 카트행(ct_id)을 '입금' 주문 라인으로 승격:
//   ① fake od_id 채번  ② 카트행 od_id←fake·ct_status='입금'  ③ g5_shop_order 헤더
//   INSERT(무통장·입금). NOT NULL·무기본값 컬럼(od_memo·od_shop_memo·od_mod_history TEXT,
//   od_cash·od_cash_no·od_cash_info)까지 최소셋으로 채운다(SHOW COLUMNS 확인). ensurePaidLazy
//   의 라인 검증(PAID∧io_id==contractKey∧io_price==amount)을 통과시켜 pending→paid 승격 유발.
// ⚠ od_id 대역: 8.0e15 (8_000_000_000_000_000 대역). 실 주문은 타임스탬프형 20xx…(≈2.0e15)라
//   무충돌이면서, **2^53(≈9.007e15) 미만**이라 API 의 g5-db mysql2 풀이 bigint od_id 를 JS
//   number 로 읽어도 정밀도 손실이 없다(9e15 대역은 2^53 초과 → String() 왕복이 어긋나 주문
//   헤더 조회가 실패해 승격이 안 됨 — 실측 교훈).
let odSeq = 0;
const nextSimOdId = () =>
  String(8_000_000_000_000_000 + Math.floor(Math.random() * 900_000_000_000) + odSeq++);

const simulatePaidOrder = async (ctId, amount, mbId) => {
  const odId = nextSimOdId();
  await g5e(`UPDATE g5_shop_cart SET od_id = ?, ct_status = '입금' WHERE ct_id = ?`, odId, ctId);
  await g5e(
    `INSERT INTO g5_shop_order
       (od_id, mb_id, od_name, od_email, od_tel, od_hp,
        od_zip1, od_zip2, od_addr1, od_addr2, od_addr3, od_addr_jibeon,
        od_status, od_settle_case, od_cart_price, od_receipt_price, od_misu,
        od_memo, od_shop_memo, od_mod_history, od_cash, od_cash_no, od_cash_info,
        od_time, od_ip)
     VALUES (?, ?, 'E2E고객', '', '', '',
        '', '', '', '', '', '',
        '입금', '무통장', ?, ?, 0,
        '', '', '', 0, '', '',
        NOW(), '127.0.0.1')`,
    odId,
    mbId,
    amount,
    amount,
  );
  return odId;
};

// 시뮬 주문 소멸 — 헤더 DELETE + 카트행 '삭제'(취소/삭제된 주문 라인 재현, checkout 재주입 경로용).
const deleteSimOrderHeader = async (odId, ctId) => {
  await g5e(`DELETE FROM g5_shop_order WHERE od_id = ?`, odId);
  await g5e(`UPDATE g5_shop_cart SET ct_status = '삭제' WHERE ct_id = ?`, ctId);
};

// io_id(=contractKey) 로 카트행/옵션행 조회 — checkout DB 실증·취소 후 0건 검증용.
// od_id·io_price 는 bigint/직렬화 안전을 위해 CHAR 캐스팅 후 JS 에서 비교한다.
const cartRowsByIoId = (ioId, status) =>
  status === undefined
    ? g5q(
        `SELECT ct_id, CAST(od_id AS CHAR) AS od_id, ct_status, io_id, io_price, ct_qty, ct_price, it_id, ct_select
           FROM g5_shop_cart WHERE io_id = ? ORDER BY ct_id`,
        ioId,
      )
    : g5q(
        `SELECT ct_id, CAST(od_id AS CHAR) AS od_id, ct_status, io_id, io_price, ct_qty, ct_price, it_id, ct_select
           FROM g5_shop_cart WHERE io_id = ? AND ct_status = ? ORDER BY ct_id`,
        ioId,
        status,
      );
const optionRowsByIoId = (ioId) =>
  g5q(`SELECT io_id, io_price FROM g5_shop_item_option WHERE it_id = ? AND io_id = ?`, ANCHOR_IT_ID, ioId);

// ── Mailpit 델타 검증 ───────────────────────────────────────────────────────
// 메일은 비차단(fire-and-forget SMTP)이라 전이 응답이 먼저 돌아온다. drainMail 로
// 백그라운드 메일(award/new-bid 등)이 정착(연속 2회 동일)할 때까지 기다려 baseline 을
// 안정화한 뒤, expectMailDelta 로 +delta 이상을 폴링한다. Mailpit 미가동이면 SKIP.
const drainMail = async () => {
  let prev = await mailpitTotal();
  if (prev === null) return null;
  for (let i = 0; i < 15; i += 1) {
    await sleep(700);
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

  // ── 2차: 계약 산출물(deliverable) 파일 — refType='sp_market_contract', refId=contractId.
  // 프로젝트 첨부(refPairs)와 달리 refId 가 계약 id 라 별도 처리. 실파일 먼저(1차 방식 미러).
  const contracts = await prisma.spMarketContract.findMany({ where: { projectId: { in: pids } } });
  for (const c of contracts) {
    const files = await prisma.spFile.findMany({
      where: { refType: 'sp_market_contract', refId: c.id },
    });
    for (const f of files) {
      try {
        await fetch(`${fileServer}/api/delete/${encodeURIComponent(f.pathToken)}`);
      } catch {
        console.warn('file server delete 실패(고아 가능):', Number(f.id));
      }
    }
    await prisma.spFile.deleteMany({ where: { refType: 'sp_market_contract', refId: c.id } });
  }
  await prisma.spMarketContract.deleteMany({ where: { projectId: { in: pids } } });

  // ── 2차: g5 잔재 — 카트행·옵션행(io_id=contractKey), 시뮬 주문 헤더/백업(od_id). ids 에
  // 기록해 둔 키/주문번호 기준으로 상태 무관 전수 삭제(주문 라인 '입금'·'삭제' 포함).
  const keys = (ids.contractKeys ?? []).map((k) => String(k));
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

  await prisma.spMarketBid.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.spMarketNdaSign.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.spMarketProject.deleteMany({ where: { id: { in: pids } } });
  // 하네스가 시드한 AI 잡(sp_ai_job) — 프로젝트와 FK 가 없으므로 id 로 직접 지운다.
  const aiJobIds = (ids.aiJobIds ?? []).map((v) => String(v));
  if (aiJobIds.length > 0) {
    await prisma.spAiJob.deleteMany({ where: { id: { in: aiJobIds } } });
  }
  if (ids.expertId !== null) {
    await prisma.spMarketExpert.deleteMany({ where: { id: BigInt(ids.expertId) } });
  }

  // ── 잔여 0 검증(브리프 §5) — 정리 후 카트행·옵션행·계약 행이 남지 않았는지 로그. ──
  let leftCart = 0;
  let leftOpt = 0;
  if (keys.length > 0) {
    const ph = keys.map(() => '?').join(',');
    const [cart] = await g5q(`SELECT COUNT(*) AS c FROM g5_shop_cart WHERE io_id IN (${ph})`, ...keys);
    const [opt] = await g5q(
      `SELECT COUNT(*) AS c FROM g5_shop_item_option WHERE io_id IN (${ph})`,
      ...keys,
    );
    leftCart = Number(cart?.c ?? 0);
    leftOpt = Number(opt?.c ?? 0);
  }
  const leftContracts = await prisma.spMarketContract.count({ where: { projectId: { in: pids } } });
  const leftAiJobs =
    aiJobIds.length === 0 ? 0 : await prisma.spAiJob.count({ where: { id: { in: aiJobIds } } });
  console.log(
    `잔여(0 기대) — 카트행:${leftCart} 옵션행:${leftOpt} 계약:${leftContracts} AI잡:${leftAiJobs}`,
  );
  console.log('cleanup 완료:', ids);
}

async function run() {
  // ── 테스트 주체 선정: cf_admin + (전문가 행 없는) 실존 회원 2명 ──
  const cfg = await prisma.$queryRaw`SELECT cf_admin FROM g5_config LIMIT 1`;
  const cfAdmin = String(cfg[0]?.cf_admin ?? '');
  if (cfAdmin === '') throw new Error('cf_admin 없음');
  // 2차는 제3자(계약 비당사자·비관리자) 표면이 필요해 회원 3명을 쓴다(1차는 2명이면 충분).
  const members = await prisma.$queryRaw`
    SELECT mb_id, mb_nick, mb_email FROM g5_member
    WHERE mb_email <> '' AND mb_leave_date = '' AND mb_id <> ${cfAdmin}
      AND mb_id NOT IN (SELECT mbId FROM sp_market_expert)
    ORDER BY mb_datetime DESC LIMIT 3`;
  if (members.length < 3) throw new Error('테스트용 회원 3명 확보 실패(2차 제3자 표면 필요)');
  const [em, cm, sm] = members;
  const tExpert = sign({ mbId: em.mb_id, mbNick: em.mb_nick, level: 2, isAdmin: false });
  // 의뢰인 JWT 에는 cartId 클레임(영카트 버킷)을 실어 계약 checkout 이 카트에 담을 수 있게 한다.
  const tClient = sign({ mbId: cm.mb_id, mbNick: cm.mb_nick, level: 2, isAdmin: false, cartId: CART_BUCKET });
  const tClientNoCart = sign({ mbId: cm.mb_id, mbNick: cm.mb_nick, level: 2, isAdmin: false });
  const tStranger = sign({ mbId: sm.mb_id, mbNick: sm.mb_nick, level: 2, isAdmin: false });
  const tAdmin = sign({ mbId: cfAdmin, mbNick: 'admin', level: 10, isAdmin: true });
  console.log(`주체: expert=${em.mb_id} client=${cm.mb_id} stranger=${sm.mb_id} admin=${cfAdmin}`);

  const mailBefore = await mailpitTotal();
  const ids = { expertId: null, projectIds: [], contractKeys: [], simOdIds: [], aiJobIds: [] };

  // 완료 잡 시드 — 소유자·입력 해시를 지정해 등록 라우트의 대조 경로를 그대로 태운다.
  // 잡 재사용 창(findReusableAiJob)은 finishedAt 이 아니라 startedAt 기준 1시간이라 startedAt 을 지금으로.
  const seedAiJob = async (mbId, inputHash, review) => {
    const id = randomUUID();
    await prisma.spAiJob.create({
      data: {
        id,
        useCase: 'market.dev-review',
        mbId,
        status: 'done',
        stage: null,
        model: 'e2e-model',
        promptVersion: DEV_REVIEW_PROMPT_VERSION,
        inputHash,
        resultJson: JSON.stringify({ ...review, meta: { ...review.meta, jobId: id, inputHash } }),
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    ids.aiJobIds.push(id);
    writeFileSync(IDS_FILE, JSON.stringify(ids));
    return id;
  };
  // 시스템 구성도 잡 시드(useCase=market.dev-diagram, done) — 등록 payload devDiagramJobId 연결 대조용.
  const seedDiagramJob = async (mbId, inputHash) => {
    const id = randomUUID();
    await prisma.spAiJob.create({
      data: {
        id,
        useCase: DEV_DIAGRAM_USECASE,
        mbId,
        status: 'done',
        stage: null,
        model: 'e2e-model',
        promptVersion: DEV_DIAGRAM_PROMPT_VERSION,
        inputHash,
        resultJson: JSON.stringify(minimalDevDiagramResult(id)),
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    ids.aiJobIds.push(id);
    writeFileSync(IDS_FILE, JSON.stringify(ids));
    return id;
  };

  // 시스템 구성도 유스케이스를 하네스 동안 끈다(활성이면 등록마다 kimi 생성이 시작돼 비용) — finally 에서 원복.
  const diagramUsecaseBefore = await prisma.spAiUsecase.findUnique({ where: { useCase: DEV_DIAGRAM_USECASE } });
  const diagramUsecaseWasEnabled = diagramUsecaseBefore !== null && diagramUsecaseBefore.enabled === true;
  if (diagramUsecaseWasEnabled) {
    await prisma.spAiUsecase.update({ where: { useCase: DEV_DIAGRAM_USECASE }, data: { enabled: false } });
    console.log(`유스케이스 ${DEV_DIAGRAM_USECASE} enabled=1 → 0 (끝날 때 원복)`);
  }

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
        serviceAreas: ['circuit', 'pcb'], // 필수(min 1) — 레지스트리 5종 코드
        // v3: 분야별 툴(레지스트리 사전) — 목록 필터 ?tool=kicad 가 이 값으로 걸린다.
        tools: { version: 1, byArea: { circuit: ['kicad'], pcb: ['kicad', 'altium'] } },
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

    // ── 2.5) 전문가 v3 응답·목록 툴 필터(분야 무관 툴 코드 하나) ──
    const expertDetail = await req('GET', `/api/market/experts/${ids.expertId}`);
    assert(
      expertDetail.status === 200 &&
        JSON.stringify(expertDetail.json?.data?.tools?.byArea?.pcb) === JSON.stringify(['kicad', 'altium']) &&
        expertDetail.json?.data?.categories === undefined &&
        expertDetail.json?.data?.cadTools === undefined,
      '전문가 상세 tools.byArea 반영(+옛 categories/cadTools 없음)',
      expertDetail.json?.data?.tools,
    );
    const expertsByTool = await req('GET', '/api/market/experts?tool=altium&pageSize=100');
    assert(
      expertsByTool.status === 200 &&
        expertsByTool.json?.data?.items?.some((e) => e.expertId === ids.expertId),
      '전문가 목록 ?tool=altium 포함',
      expertsByTool.json?.data?.items?.length,
    );
    const expertsByOtherTool = await req('GET', '/api/market/experts?tool=flutter&pageSize=100');
    assert(
      expertsByOtherTool.status === 200 &&
        !expertsByOtherTool.json?.data?.items?.some((e) => e.expertId === ids.expertId),
      '전문가 목록 ?tool=flutter 제외',
    );
    const expertsBadTool = await req('GET', '/api/market/experts?tool=not-a-tool&pageSize=100');
    assert(
      expertsBadTool.status === 200 &&
        !expertsBadTool.json?.data?.items?.some((e) => e.expertId === ids.expertId),
      '전문가 목록 미지 툴 필터 = 0건(400 아님)',
      expertsBadTool.status,
    );

    // ── 3) AI 사전 검토서 잡 시드 → 의뢰 등록(역견적·NDA·첨부) ──
    // 원천 해시 = 제목·분야·설명·공통+분야별 질문 답변 + 첨부(`파트이름:sha256`, 정렬 앞 10개).
    // 등록 라우트가 같은 규칙으로 재계산해 대조하므로, 하네스도 출하 함수(devReviewInputHash)를 쓴다.
    // 첨부는 일반 1건 + 분야 슬롯(attachment:circuit:schematic) 1건 — 슬롯 파트가 해시·area/slot
    // 응답에 모두 반영되는지 같이 검증한다.
    const prjAnswers = [
      ...requiredAnswers,
      { code: 'stage', choices: ['idea'] },
      { code: 'quantity', choices: ['proto_1_10'], note: '먼저 3개' },
      { code: 'external', choices: ['mobile_app'] },
    ];
    const prjAttachmentBody = 'e2e spec content';
    const prjSlotBody = 'e2e schematic sketch';
    const prjSlotField = 'attachment:circuit:schematic';
    const prjSource = {
      title: 'E2E 심박 모니터 회로 개발',
      serviceAreas: ['circuit'],
      description: 'E2E 통합 테스트용 프로젝트 상세 설명입니다.',
      answers: prjAnswers,
    };
    const prjHash = devReviewInputHash({
      ...prjSource,
      attachmentHashes: [
        attachmentHashOf('attachment', prjAttachmentBody),
        attachmentHashOf(prjSlotField, prjSlotBody),
      ],
    });
    const reviewJobId = await seedAiJob(
      cm.mb_id,
      prjHash,
      minimalDevReview(['circuit'], prjAnswers, 'E2E 검토서 요약'),
    );
    // 제3자(stranger) 소유 잡 — 같은 해시라도 소유자가 다르면 등록이 막혀야 한다.
    const strangerJobId = await seedAiJob(
      sm.mb_id,
      prjHash,
      minimalDevReview(['circuit'], prjAnswers, '남의 검토서'),
    );

    const buildProjectForm = (over = {}) => {
      const form = new FormData();
      form.append(
        'payload',
        JSON.stringify({
          ...prjSource,
          // v3 희망 툴 — 중복 코드·선택 안 한 분야(pcb)는 저장 정규화가 걷어내야 한다(툴은 해시 원천이 아니다).
          tools: { version: 1, byArea: { circuit: ['kicad', 'altium', 'kicad'], pcb: ['kicad'] } },
          ndaRequired: true,
          budgetRange: 'r500_2000',
          deadline: { days: 7 },
          method: 'open',
          devReviewJobId: reviewJobId,
          aiConsent: false, // 정밀 구성도 큐는 유스케이스 비활성 전제(활성이면 조용히 큐잉될 뿐)
          ...over,
        }),
      );
      form.append('attachment', new Blob([prjAttachmentBody], { type: 'text/plain' }), 'e2e-spec.txt');
      form.append(prjSlotField, new Blob([prjSlotBody], { type: 'text/plain' }), 'e2e-schematic.txt');
      return form;
    };

    // 3-a) 타인 소유 잡 id → 400 REVIEW_JOB_INVALID(존재하지만 내 것이 아니다)
    const foreignJob = await req('POST', '/api/market/projects', {
      token: tClient,
      form: buildProjectForm({ devReviewJobId: strangerJobId }),
    });
    assert(
      foreignJob.status === 400 && foreignJob.json?.error === 'REVIEW_JOB_INVALID',
      '타인 검토서 잡으로 등록 400 REVIEW_JOB_INVALID',
      foreignJob,
    );

    // 3-b) 원천(제목)이 달라진 payload → 400 REVIEW_STALE(신선도 대조)
    const stale = await req('POST', '/api/market/projects', {
      token: tClient,
      form: buildProjectForm({ title: 'E2E 심박 모니터 회로 개발(제목만 바뀜)' }),
    });
    assert(
      stale.status === 400 && stale.json?.error === 'REVIEW_STALE',
      '원천 변경 후 등록 400 REVIEW_STALE',
      stale,
    );

    const prj = await req('POST', '/api/market/projects', { token: tClient, form: buildProjectForm() });
    assert(prj.status === 200 && prj.json?.result === true, '의뢰 등록(open+NDA+첨부+검토서)', prj);
    const pid = prj.json?.data?.projectId;
    ids.projectIds.push(pid);
    writeFileSync(IDS_FILE, JSON.stringify(ids));

    // ── 4) 익명 상세: viewer null·마스킹·첨부 메타 잠금 ──
    const anon = await req('GET', `/api/market/projects/${pid}`);
    assert(anon.status === 200 && anon.json?.data?.viewer === null, '익명 상세 viewer=null');
    assert(anon.json?.data?.attachments?.files === null && anon.json?.data?.attachments?.count === 2, 'NDA 메타 잠금(개수만, 일반+슬롯=2)');
    const masked = anon.json?.data?.ownerName ?? '';
    assert(masked.includes('*') || masked === '회원', '의뢰인 마스킹', masked);
    // v3 툴 정규화 — 중복 제거·선택 분야(circuit)만 남고 pcb 는 버려진다. 옛 categories/cadTools 는 응답에 없다.
    assert(
      JSON.stringify(anon.json?.data?.tools?.byArea) === JSON.stringify({ circuit: ['kicad', 'altium'] }) &&
        anon.json?.data?.tools?.version === 1 &&
        anon.json?.data?.categories === undefined &&
        anon.json?.data?.cadTools === undefined,
      '희망 툴 정규화(중복 제거·선택 분야만) + 옛 필드 없음',
      anon.json?.data?.tools,
    );
    assert(
      JSON.stringify(anon.json?.data?.answers) === JSON.stringify(prjAnswers),
      '질문 답변(answers) 상세 반영',
      anon.json?.data?.answers,
    );
    // 시스템 구성도 — 잡 id 없이 검토서만 있으면 등록 뒤 큐잉을 시도하는데, 유스케이스가 꺼져 있어
    // 조용히 건너뛰어 meta/html 이 null 이다.
    assert(
      anon.json?.data?.devDiagram?.meta === null && anon.json?.data?.devDiagram?.html === null,
      '시스템 구성도 미시도(유스케이스 비활성) devDiagram null',
      anon.json?.data?.devDiagram,
    );
    // 잡 폴링 응답 — 검토서 잡은 diagram 메타가 null(구성도는 별도 잡), 타인 잡은 404.
    const reviewJobPoll = await req('GET', `/api/ai/jobs/${reviewJobId}`, { token: tClient });
    assert(
      reviewJobPoll.status === 200 &&
        reviewJobPoll.json?.data?.status === 'done' &&
        reviewJobPoll.json?.data?.review?.version === 4 &&
        reviewJobPoll.json?.data?.diagram === null,
      '잡 폴링: 검토서 잡 review v4 + diagram null',
      reviewJobPoll.json?.data,
    );
    const strangerJobPoll = await req('GET', `/api/ai/jobs/${strangerJobId}`, { token: tClient });
    assert(strangerJobPoll.status === 404, '잡 폴링: 타인 잡 404', strangerJobPoll.status);
    // 검토서는 서버 저장분(sp_ai_job)이 정본 — 클라이언트가 본문을 보낸 적이 없는데도
    // 상세를 볼 수 있는 뷰어 전원(익명 포함)에게 노출된다(공개 범위 = description 동일).
    assert(
      anon.json?.data?.devReview?.version === 4 &&
        anon.json?.data?.devReview?.requirements?.length === 1 &&
        anon.json?.data?.devReview?.summary === 'E2E 검토서 요약' &&
        'diagram' in (anon.json?.data?.devReview ?? {}) === false &&
        anon.json?.data?.devReview?.openQuestions?.[1]?.area === 'general',
      'AI 사전 검토서(v4) 익명 상세 노출(서버 저장분, diagram 필드 없음)',
      anon.json?.data?.devReview,
    );
    assert(
      anon.json?.data?.devReview?.meta?.jobId === reviewJobId &&
        anon.json?.data?.hasDevReview === true,
      '검토서 meta.jobId 박제 + 목록 플래그 hasDevReview',
      anon.json?.data?.meta,
    );
    assert(
      anon.json?.data?.requestType === 'individual',
      '분야 1개 → requestType=individual 파생',
      anon.json?.data?.requestType,
    );

    // ── 4.1) 시스템 구성도 잡 연결(devDiagramJobId) — 대조 실패는 등록을 막지 않는다 ──
    // 같은 원천(제목·분야·설명·답변·첨부)이라 입력 해시는 prjHash 그대로. 검토서 잡은 안 실어(devReviewJobId
    // 생략) 구성도 연결만 본다. 유스케이스가 꺼져 있고 aiConsent=false 라 미연결 시 자동 큐잉도 없다.
    const withoutReview = (over) => buildProjectForm({ devReviewJobId: undefined, ...over });
    // 4.1-a) 엉뚱한 uuid → 200 등록, 상세 devDiagram.meta null
    const bogusDiag = await req('POST', '/api/market/projects', {
      token: tClient,
      form: withoutReview({ devDiagramJobId: randomUUID() }),
    });
    assert(bogusDiag.status === 200 && bogusDiag.json?.result === true, '엉뚱한 devDiagramJobId 로 등록 200(연결만 생략)', bogusDiag);
    const bogusPid = bogusDiag.json?.data?.projectId;
    if (bogusPid) ids.projectIds.push(bogusPid);
    writeFileSync(IDS_FILE, JSON.stringify(ids));
    const bogusDetail = await req('GET', `/api/market/projects/${bogusPid}`, { token: tClient });
    assert(
      bogusDetail.status === 200 &&
        bogusDetail.json?.data?.devDiagram?.meta === null &&
        bogusDetail.json?.data?.devReview === null,
      '엉뚱한 잡 id → devDiagram.meta null(검토서도 없음)',
      bogusDetail.json?.data?.devDiagram,
    );
    // 4.1-b) 타인(stranger) 소유 구성도 잡 → 200 등록, 연결 생략
    const strangerDiagJobId = await seedDiagramJob(sm.mb_id, prjHash);
    const foreignDiag = await req('POST', '/api/market/projects', {
      token: tClient,
      form: withoutReview({ devDiagramJobId: strangerDiagJobId }),
    });
    assert(foreignDiag.status === 200 && foreignDiag.json?.result === true, '타인 구성도 잡 id 로 등록 200(연결만 생략)', foreignDiag);
    const foreignPid = foreignDiag.json?.data?.projectId;
    if (foreignPid) ids.projectIds.push(foreignPid);
    writeFileSync(IDS_FILE, JSON.stringify(ids));
    const foreignDetail = await req('GET', `/api/market/projects/${foreignPid}`, { token: tClient });
    assert(
      foreignDetail.json?.data?.devDiagram?.meta === null,
      '타인 구성도 잡 → devDiagram.meta null',
      foreignDetail.json?.data?.devDiagram,
    );
    // 4.1-c) 내 잡 + 입력 해시 어긋남(제목 변경) → 200 등록, 연결 생략(stale)
    const ownDiagJobId = await seedDiagramJob(cm.mb_id, prjHash);
    const staleDiag = await req('POST', '/api/market/projects', {
      token: tClient,
      form: withoutReview({ devDiagramJobId: ownDiagJobId, title: 'E2E 심박 모니터 회로 개발(구성도 stale)' }),
    });
    assert(staleDiag.status === 200, '원천 어긋난 구성도 잡으로 등록 200(연결만 생략)', staleDiag);
    const stalePid = staleDiag.json?.data?.projectId;
    if (stalePid) ids.projectIds.push(stalePid);
    writeFileSync(IDS_FILE, JSON.stringify(ids));
    const staleDetail = await req('GET', `/api/market/projects/${stalePid}`, { token: tClient });
    assert(
      staleDetail.json?.data?.devDiagram?.meta === null,
      '원천 어긋난 구성도 잡 → devDiagram.meta null',
      staleDetail.json?.data?.devDiagram,
    );
    // 4.1-d) 내 잡 + 해시 일치 → 연결: 상세 meta.status=done·jobId·html 본문, 목록 devDiagramStatus=done
    const linkedDiag = await req('POST', '/api/market/projects', {
      token: tClient,
      form: withoutReview({ devDiagramJobId: ownDiagJobId }),
    });
    assert(linkedDiag.status === 200, '내 구성도 잡(해시 일치) 등록 200', linkedDiag);
    const linkedPid = linkedDiag.json?.data?.projectId;
    if (linkedPid) ids.projectIds.push(linkedPid);
    writeFileSync(IDS_FILE, JSON.stringify(ids));
    const linkedDetail = await req('GET', `/api/market/projects/${linkedPid}`, { token: tClient });
    assert(
      linkedDetail.json?.data?.devDiagram?.meta?.status === 'done' &&
        linkedDetail.json?.data?.devDiagram?.meta?.jobId === ownDiagJobId &&
        linkedDetail.json?.data?.devDiagram?.meta?.attempt === 1 &&
        typeof linkedDetail.json?.data?.devDiagram?.html === 'string' &&
        linkedDetail.json?.data?.devDiagram?.html.includes('<svg'),
      '구성도 잡 연결 → devDiagram meta done + html 본문',
      linkedDetail.json?.data?.devDiagram?.meta,
    );
    const linkedList = await req('GET', '/api/market/projects?tab=open&pageSize=100');
    assert(
      linkedList.json?.data?.items?.find((i) => i.projectId === linkedPid)?.devDiagramStatus === 'done',
      '목록 devDiagramStatus=done',
      linkedList.json?.data?.items?.find((i) => i.projectId === linkedPid),
    );
    // 잡 폴링 — 구성도 잡은 diagram 메타(done)·review null
    const diagJobPoll = await req('GET', `/api/ai/jobs/${ownDiagJobId}`, { token: tClient });
    assert(
      diagJobPoll.status === 200 &&
        diagJobPoll.json?.data?.diagram?.status === 'done' &&
        diagJobPoll.json?.data?.diagram?.jobId === ownDiagJobId &&
        diagJobPoll.json?.data?.review === null,
      '잡 폴링: 구성도 잡 diagram done + review null',
      diagJobPoll.json?.data,
    );
    // 연결된 프로젝트(done)에 재요청 — 유스케이스 비활성이라 409 USECASE_DISABLED(RUNNING 아님)
    const relink = await req('POST', `/api/market/projects/${linkedPid}/dev-diagram`, { token: tClient });
    assert(
      relink.status === 409 && relink.json?.error === 'USECASE_DISABLED',
      '완성된 구성도 재생성 요청(유스케이스 비활성) 409 USECASE_DISABLED',
      relink,
    );

    // ── 4.2) GET /api/market/my/dev-diagrams — 진행 중 + 24시간 내 완료분(소유자 전용) ──
    const myDiagrams = await req('GET', '/api/market/my/dev-diagrams', { token: tClient });
    assert(
      myDiagrams.status === 200 &&
        myDiagrams.json?.result === true &&
        Array.isArray(myDiagrams.json?.data?.items) &&
        myDiagrams.json.data.items.some(
          (i) => i.projectId === linkedPid && i.meta?.status === 'done' && typeof i.title === 'string',
        ) &&
        !myDiagrams.json.data.items.some((i) => i.projectId === bogusPid),
      '내 구성도 목록: 연결 건 포함(done)·미연결 건 제외',
      myDiagrams.json?.data?.items?.map((i) => [i.projectId, i.meta?.status]),
    );
    const myDiagramsStranger = await req('GET', '/api/market/my/dev-diagrams', { token: tStranger });
    assert(
      myDiagramsStranger.status === 200 &&
        !myDiagramsStranger.json?.data?.items?.some((i) => i.projectId === linkedPid),
      '내 구성도 목록: 제3자에겐 남의 건 없음',
      myDiagramsStranger.json?.data?.items?.length,
    );
    const myDiagramsAnon = await req('GET', '/api/market/my/dev-diagrams');
    assert(myDiagramsAnon.status === 401, '내 구성도 목록 비로그인 401', myDiagramsAnon.status);

    // ── 4.3) 검토서 부착 상태의 원천 수정 가드 ──
    // 원천(제목·설명·분야)과 검토서가 어긋나는 상태를 만들 수 없다: 409 → 같은 요청에
    // devReview:null 을 실으면 통과(검토서를 버리는 선택을 명시한 것).
    const retitle = await req('PATCH', `/api/market/projects/${pid}`, {
      token: tClient,
      body: { title: 'E2E 심박 모니터 회로 개발 v2' },
    });
    assert(
      retitle.status === 409 && retitle.json?.error === 'DEV_REVIEW_ATTACHED',
      '검토서 있는 의뢰의 제목 PATCH 409 DEV_REVIEW_ATTACHED',
      retitle,
    );
    const retitleWithDrop = await req('PATCH', `/api/market/projects/${pid}`, {
      token: tClient,
      body: { title: 'E2E 심박 모니터 회로 개발 v2', devReview: null },
    });
    assert(retitleWithDrop.status === 200, '제목+검토서 제거 동시 PATCH 200', retitleWithDrop);
    const afterDrop = await req('GET', `/api/market/projects/${pid}`);
    assert(
      afterDrop.json?.data?.devReview === null &&
        afterDrop.json?.data?.hasDevReview === false &&
        afterDrop.json?.data?.title === 'E2E 심박 모니터 회로 개발 v2',
      '검토서 제거 반영 + 제목 갱신',
      afterDrop.json?.data?.devReview,
    );

    // ── 4.5) 분야 2개 → requestType=system 파생 + 개인 전문가 입찰 200 ──
    // 전체서비스 회사 전용 가드는 폐지됐다(활성 3분야는 개인이 통으로 수행).
    const sysForm = new FormData();
    sysForm.append(
      'payload',
      JSON.stringify({
        title: 'E2E 회로+펌웨어 통합 의뢰',
        serviceAreas: ['circuit', 'firmware'],
        tools: { version: 1, byArea: { firmware: ['c_cpp', 'stm32cube'] } },
        description: '분야 2개 파생·개인 전문가 입찰 E2E 검증용 프로젝트입니다.',
        answers: requiredAnswers,
        ndaRequired: false,
        budgetRange: 'r500_2000',
        deadline: { days: 7 },
        method: 'open',
      }),
    );
    const sysPrj = await req('POST', '/api/market/projects', { token: tClient, form: sysForm });
    const sysPid = sysPrj.json?.data?.projectId;
    ids.projectIds.push(sysPid);
    writeFileSync(IDS_FILE, JSON.stringify(ids));
    const sysDetail = await req('GET', `/api/market/projects/${sysPid}`);
    assert(
      sysDetail.json?.data?.requestType === 'system',
      '분야 2개 → requestType=system 파생',
      sysDetail.json?.data?.requestType,
    );
    const sysBid = await req('POST', `/api/market/projects/${sysPid}/bids`, {
      token: tExpert, // e2e 전문가는 individual — 이제 통합 의뢰에도 입찰할 수 있어야 한다
      body: { amount: 1_000_000, durationDays: 30, message: '통합 의뢰 개인 전문가 입찰입니다.' },
    });
    assert(sysBid.status === 200, '시스템 통합 의뢰 개인 전문가 입찰 200', sysBid);

    // ── 5) 소유자 상세: 파일 보임 → fileId 확보 + 슬롯 첨부 area/slot 메타 ──
    const ownerDetail = await req('GET', `/api/market/projects/${pid}`, { token: tClient });
    const ownerFiles = ownerDetail.json?.data?.attachments?.files ?? [];
    const generalFile = ownerFiles.find((f) => f.name === 'e2e-spec.txt');
    const slotFile = ownerFiles.find((f) => f.name === 'e2e-schematic.txt');
    const fileId = generalFile?.fileId;
    assert(typeof fileId === 'number', '소유자 첨부 메타 노출', ownerDetail.json?.data?.attachments);
    assert(
      generalFile?.area === null && generalFile?.slot === null &&
        slotFile?.area === 'circuit' && slotFile?.slot === 'schematic',
      '슬롯 첨부 area/slot 메타(일반=null·슬롯=circuit/schematic)',
      ownerFiles,
    );

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
        serviceAreas: ['pcb'],
        tools: { version: 1, byArea: { pcb: ['kicad'] } },
        // 분야별 질문(pcb.outline) — fixed 는 메모 필수(noteRequiredFor).
        answers: [{ code: 'pcb.outline', choices: ['fixed'], note: '80×50mm, 케이스 맞춤' }, ...requiredAnswers],
        description: '지정견적 E2E 테스트 상세 설명입니다.',
        ndaRequired: false,
        budgetRange: 'under500',
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
    const tDetail = await req('GET', `/api/market/projects/${tpid}`, { token: tClient });
    assert(
      tDetail.json?.data?.answers?.[0]?.code === 'pcb.outline' &&
        tDetail.json?.data?.answers?.[0]?.note === '80×50mm, 케이스 맞춤',
      '분야별 질문(pcb.outline) 답변 저장·상세 반영',
      tDetail.json?.data?.answers,
    );
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

    // ── 11) v3 입력 거절(미지 툴·분야 밖 질문·미지 슬롯·미지 분야) → 정상 등록 → 정밀 구성도 409 → 조기 마감 ──
    // 옛 하네스의 "cadTools:['any'] 수용+빈 배열 정규화"는 폐기됐다 — 툴 코드는 레지스트리 사전 검증이라
    // 미지 코드는 400 이고, 빈 byArea 가 "전문가 추천"이다.
    const closePayload = {
      title: 'E2E 조기마감 테스트',
      serviceAreas: ['firmware'],
      tools: { version: 1, byArea: {} }, // 빈 = 전문가 추천
      description: '조기 마감 E2E 테스트 상세 설명입니다.',
      answers: requiredAnswers,
      ndaRequired: false,
      budgetRange: 'undecided',
      deadline: { days: 14 },
      method: 'open',
    };
    const buildCloseForm = (over = {}, extraPart = null) => {
      const f = new FormData();
      f.append('payload', JSON.stringify({ ...closePayload, ...over }));
      if (extraPart !== null) f.append(extraPart, new Blob(['x'], { type: 'text/plain' }), 'x.txt');
      return f;
    };
    const badTool = await req('POST', '/api/market/projects', {
      token: tClient,
      form: buildCloseForm({ tools: { version: 1, byArea: { firmware: ['any'] } } }),
    });
    assert(
      badTool.status === 400 && badTool.json?.error === 'PAYLOAD_SCHEMA_MISMATCH' &&
        JSON.stringify(badTool.json?.issues ?? []).includes('UNKNOWN_TOOL:any'),
      "미지 툴 코드(['any']) 400 PAYLOAD_SCHEMA_MISMATCH(UNKNOWN_TOOL)",
      badTool,
    );
    const badAnswer = await req('POST', '/api/market/projects', {
      token: tClient,
      form: buildCloseForm({ answers: [{ code: 'pcb.outline', choices: ['free'] }] }),
    });
    assert(
      badAnswer.status === 400 && badAnswer.json?.error === 'PAYLOAD_SCHEMA_MISMATCH' &&
        JSON.stringify(badAnswer.json?.issues ?? []).includes('UNKNOWN_QUESTION'),
      '선택 분야 밖 질문(pcb.outline on firmware) 400(UNKNOWN_QUESTION)',
      badAnswer,
    );
    // v5: 프로젝트 공통 조건 3(완료 시점·목표 단계·인도 범위)은 등록 필수 — 빠지면 ANSWERS_REQUIRED + missing 코드.
    const noRequired = await req('POST', '/api/market/projects', {
      token: tClient,
      form: buildCloseForm({ answers: [{ code: 'timeline', choices: ['m2_3'] }] }),
    });
    assert(
      noRequired.status === 400 && noRequired.json?.error === 'ANSWERS_REQUIRED' &&
        JSON.stringify(noRequired.json?.missing ?? []) === JSON.stringify(['target_stage', 'deliverable_scope']),
      '공통 조건 미응답(목표 단계·인도 범위) 400(ANSWERS_REQUIRED, missing 2)',
      noRequired,
    );
    // 풀 개발(5분야)이면 분야당 앞 2개만 묻는다 — 3번째 문항(server.ops)은 선택 분야 밖 취급(UNKNOWN_QUESTION).
    const capped = await req('POST', '/api/market/projects', {
      token: tClient,
      form: buildCloseForm({ serviceAreas: ['circuit', 'pcb', 'firmware', 'app', 'server'], answers: [...requiredAnswers, { code: 'server.ops', choices: ['dev_only'] }] }),
    });
    assert(
      capped.status === 400 && JSON.stringify(capped.json?.issues ?? []).includes('UNKNOWN_QUESTION'),
      '풀 개발 분야당 질문 상한 2 — 3번째 문항(server.ops) 400(UNKNOWN_QUESTION)',
      capped,
    );
    const badSlot = await req('POST', '/api/market/projects', {
      token: tClient,
      form: buildCloseForm({}, 'attachment:pcb:gerber'), // 선택 안 한 분야의 슬롯
    });
    assert(
      badSlot.status === 400 && badSlot.json?.error === 'ATTACHMENT_FIELD_INVALID',
      '선택 안 한 분야 슬롯 파트 400 ATTACHMENT_FIELD_INVALID',
      badSlot,
    );
    const badSlot2 = await req('POST', '/api/market/projects', {
      token: tClient,
      form: buildCloseForm({}, 'attachment:firmware:nope'), // 사전에 없는 슬롯
    });
    assert(
      badSlot2.status === 400 && badSlot2.json?.error === 'ATTACHMENT_FIELD_INVALID',
      '사전에 없는 슬롯 파트 400 ATTACHMENT_FIELD_INVALID',
      badSlot2,
    );
    const badArea = await req('POST', '/api/market/projects', {
      token: tClient,
      form: buildCloseForm({ serviceAreas: ['mechanical'] }),
    });
    assert(
      badArea.status === 400 && badArea.json?.error === 'PAYLOAD_SCHEMA_MISMATCH',
      '레지스트리 밖 분야 코드 400',
      badArea,
    );

    const cprj = await req('POST', '/api/market/projects', { token: tClient, form: buildCloseForm() });
    assert(cprj.status === 200, '툴 미지정(전문가 추천) 등록 200', cprj);
    const cpid = cprj.json?.data?.projectId;
    ids.projectIds.push(cpid);
    writeFileSync(IDS_FILE, JSON.stringify(ids));
    const cDetail = await req('GET', `/api/market/projects/${cpid}`, { token: tClient });
    assert(
      JSON.stringify(cDetail.json?.data?.tools) === JSON.stringify({ version: 1, byArea: {} }) &&
        cDetail.json?.data?.cadTools === undefined,
      '빈 툴 = {version:1, byArea:{}} 정규화(옛 cadTools 없음)',
      cDetail.json?.data?.tools,
    );
    const listItem = await req('GET', '/api/market/projects?tab=open&pageSize=100');
    const cItem = listItem.json?.data?.items?.find((i) => i.projectId === cpid);
    assert(
      cItem !== undefined && cItem.devDiagramStatus === null && cItem.hasDevReview === false &&
        cItem.categories === undefined,
      '목록 devDiagramStatus=null·hasDevReview=false(옛 categories 없음)',
      cItem,
    );
    // 시스템 구성도 수동 요청 — 유스케이스 비활성이면 409 USECASE_DISABLED(하네스가 시작 시 enabled=0 으로 내림).
    const diagStranger = await req('POST', `/api/market/projects/${cpid}/dev-diagram`, { token: tStranger });
    assert(diagStranger.status === 403 && diagStranger.json?.error === 'FORBIDDEN', '정밀 구성도 요청 제3자 403', diagStranger);
    const diagOwner = await req('POST', `/api/market/projects/${cpid}/dev-diagram`, { token: tClient });
    assert(
      diagOwner.status === 409 && diagOwner.json?.error === 'USECASE_DISABLED',
      '정밀 구성도 요청(유스케이스 비활성) 409 USECASE_DISABLED',
      diagOwner,
    );
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

    // ════════════════════════════════════════════════════════════════════════
    //  2차(계약 결제) — award 계약 자동생성·checkout·lazy 승격·납품·검수·자동확정·
    //  정산·취소·재주입. 1차 주체(expert em / client cm / stranger sm / admin) 재사용.
    // ════════════════════════════════════════════════════════════════════════

    // open 프로젝트 → 전문가 입찰 → 의뢰인 채택 → 계약 자동생성. 계약 행(contractKey)을
    // 회수하고 cleanup 대상으로 등록해 반환한다(별도 계약 B/C/D 용).
    const createAwardedContract = async (title, amount) => {
      const f = new FormData();
      f.append(
        'payload',
        JSON.stringify({
          title,
          serviceAreas: ['circuit'],
          description: `${title} — 2차 E2E 상세 설명입니다.`,
          answers: requiredAnswers,
          ndaRequired: false,
          budgetRange: 'r500_2000',
          deadline: { days: 7 },
          method: 'open',
        }),
      );
      const pr = await req('POST', '/api/market/projects', { token: tClient, form: f });
      const projectId = pr.json?.data?.projectId;
      ids.projectIds.push(projectId);
      writeFileSync(IDS_FILE, JSON.stringify(ids));
      const b = await req('POST', `/api/market/projects/${projectId}/bids`, {
        token: tExpert,
        body: { amount, durationDays: 20, message: `${title} 입찰 메시지입니다.` },
      });
      const bidId = b.json?.data?.bidId;
      await req('POST', `/api/market/projects/${projectId}/bids/${bidId}/award`, { token: tClient });
      const contract = await prisma.spMarketContract.findUnique({
        where: { projectId: BigInt(projectId) },
      });
      if (contract !== null) {
        ids.contractKeys.push(contract.contractKey);
        writeFileSync(IDS_FILE, JSON.stringify(ids));
      }
      return { projectId, bidId, amount, contract };
    };

    // 앵커 상품 존재 확인(checkout 이 503 ANCHOR_ITEM_MISSING 로 죽지 않게 사전 검증).
    const anchorRows = await g5q(`SELECT it_id FROM g5_shop_item WHERE it_id = ?`, ANCHOR_IT_ID);
    assert(anchorRows.length === 1, '앵커 상품(sp-market-svc) 시드 존재', anchorRows.length);

    // ── 14) award 직후 계약 자동생성(Contract A = 1차 pid) + 스냅샷 + 당사자/제3자 ──
    const cA = await prisma.spMarketContract.findUnique({ where: { projectId: BigInt(pid) } });
    assert(
      cA !== null && cA.status === 'pending' && cA.requestSnapshot !== null,
      'award 계약 자동생성(pending)+요청 스냅샷',
      cA?.status,
    );
    if (cA !== null) {
      ids.contractKeys.push(cA.contractKey);
      writeFileSync(IDS_FILE, JSON.stringify(ids));
      const expFee = Math.round((cA.amount * cA.feeRateBp) / 10000);
      assert(cA.amount === 4000000, '계약 amount=채택 입찰액', cA.amount);
      assert(cA.feeAmount === expFee, '계약 feeAmount=round(amount*bp/10000)', {
        feeAmount: cA.feeAmount,
        expFee,
        bp: cA.feeRateBp,
      });
      assert(cA.payoutAmount === cA.amount - cA.feeAmount, '계약 payoutAmount=amount-fee', cA.payoutAmount);
    }
    const cGetClient = await req('GET', `/api/market/projects/${pid}/contract`, { token: tClient });
    assert(
      cGetClient.status === 200 &&
        cGetClient.json?.data?.status === 'pending' &&
        typeof cGetClient.json?.data?.requestSnapshotAt === 'string',
      '의뢰인 계약 GET 200+스냅샷 시각',
    );
    const cGetExpert = await req('GET', `/api/market/projects/${pid}/contract`, { token: tExpert });
    assert(cGetExpert.status === 200, '전문가 계약 GET 200(당사자)');
    const cGetStranger = await req('GET', `/api/market/projects/${pid}/contract`, { token: tStranger });
    assert(cGetStranger.status === 403 && cGetStranger.json?.error === 'FORBIDDEN', '제3자 계약 GET 403');

    // ── 15) checkout — 카트 주입 + DB 실증 + 멱등 + NO_CART_ID + 타인 403 ──────────
    const co = await req('POST', `/api/market/projects/${pid}/contract/checkout`, { token: tClient });
    assert(co.status === 200 && typeof co.json?.data?.redirectUrl === 'string', 'checkout redirectUrl', co);
    const shopRows = await cartRowsByIoId(cA.contractKey, '쇼핑');
    assert(shopRows.length === 1, 'checkout 카트행 1건 생성', shopRows.length);
    const cartRow = shopRows[0];
    assert(
      cartRow !== undefined &&
        cartRow.od_id === CART_BUCKET &&
        Number(cartRow.io_price) === cA.amount &&
        Number(cartRow.ct_qty) === 1 &&
        Number(cartRow.ct_price) === 0 &&
        String(cartRow.it_id) === ANCHOR_IT_ID &&
        Number(cartRow.ct_select) === 1,
      'checkout 카트행 실증(버킷·io_price·qty·price·it_id·select)',
      cartRow,
    );
    const optRows = await optionRowsByIoId(cA.contractKey);
    assert(
      optRows.length === 1 && Number(optRows[0].io_price) === cA.amount,
      'checkout 옵션행 생성(io_price=amount)',
      optRows,
    );
    const co2 = await req('POST', `/api/market/projects/${pid}/contract/checkout`, { token: tClient });
    const shopRows2 = await cartRowsByIoId(cA.contractKey, '쇼핑');
    assert(co2.status === 200 && shopRows2.length === 1, '재checkout 멱등(쇼핑 행 1개 유지)', shopRows2.length);
    const coNoCart = await req('POST', `/api/market/projects/${pid}/contract/checkout`, { token: tClientNoCart });
    assert(coNoCart.status === 409 && coNoCart.json?.error === 'NO_CART_ID', 'cartId 없는 checkout 409');
    const coStranger = await req('POST', `/api/market/projects/${pid}/contract/checkout`, { token: tExpert });
    assert(coStranger.status === 403 && coStranger.json?.error === 'FORBIDDEN', '타인 checkout 403');

    // ── 16) 미결제 deliver → 409 NOT_PAID ─────────────────────────────────────
    const deliverEarlyForm = new FormData();
    deliverEarlyForm.append('note', '결제 전 납품 시도');
    const deliverEarly = await req('POST', `/api/market/projects/${pid}/contract/deliver`, {
      token: tExpert,
      form: deliverEarlyForm,
    });
    assert(
      deliverEarly.status === 409 && deliverEarly.json?.error === 'NOT_PAID',
      '미결제 deliver 409 NOT_PAID',
      deliverEarly.status,
    );

    // ── 17) 주문 결제 시뮬(입금) → GET 승격(paid) + paidOdId + project working + 메일 ──
    const ctIdA = shopRows2[0].ct_id;
    const mailPaidBase = await drainMail();
    const simOdA = await simulatePaidOrder(ctIdA, cA.amount, cm.mb_id);
    ids.simOdIds.push(simOdA);
    writeFileSync(IDS_FILE, JSON.stringify(ids));
    const cGetPaid = await req('GET', `/api/market/projects/${pid}/contract`, { token: tClient });
    assert(cGetPaid.status === 200 && cGetPaid.json?.data?.status === 'paid', 'GET 계약 lazy 승격 paid');
    assert(cGetPaid.json?.data?.paidAt !== null, '승격 paidAt 기록');
    assert(cGetPaid.json?.data?.payment?.odId === simOdA, '결제 파생 odId=시뮬 주문번호');
    const cARow = await prisma.spMarketContract.findUnique({ where: { id: cA.id } });
    assert(cARow?.paidOdId === simOdA, 'DB paidOdId=시뮬 주문번호', cARow?.paidOdId);
    const prjA = await prisma.spMarketProject.findUnique({ where: { id: BigInt(pid) } });
    assert(prjA?.status === 'working', 'project awarded→working 승격', prjA?.status);
    await expectMailDelta(mailPaidBase, 1, '결제 확인 메일 +1(전문가)');

    // ── 18) paid 재checkout → 409 ALREADY_PAID / paid 취소 → 409 NOT_CANCELLABLE ──
    const coPaid = await req('POST', `/api/market/projects/${pid}/contract/checkout`, { token: tClient });
    assert(coPaid.status === 409 && coPaid.json?.error === 'ALREADY_PAID', 'paid 재checkout 409');
    const cancelPaid = await req('POST', `/api/market/projects/${pid}/contract/cancel`, { token: tClient });
    assert(
      cancelPaid.status === 409 && cancelPaid.json?.error === 'NOT_CANCELLABLE',
      'paid 취소 409 NOT_CANCELLABLE',
    );

    // ── 19) deliver(note+파일1) → delivered + 파일메타 / 재보고(노트만) 불변 + 메일 ──
    const mailDeliverBase = await drainMail();
    const deliverForm = new FormData();
    deliverForm.append('note', '납품합니다 — 산출물 1건 첨부.');
    deliverForm.append(
      'deliverable',
      new Blob(['e2e deliverable content'], { type: 'text/plain' }),
      'e2e-deliverable.txt',
    );
    const deliver1 = await req('POST', `/api/market/projects/${pid}/contract/deliver`, {
      token: tExpert,
      form: deliverForm,
    });
    assert(deliver1.status === 200 && deliver1.json?.data?.status === 'delivered', 'deliver → delivered');
    assert(deliver1.json?.data?.files?.length === 1, '납품 파일 메타 1건', deliver1.json?.data?.files);
    const deliveredAt1 = deliver1.json?.data?.deliveredAt;
    const deliverFileId = deliver1.json?.data?.files?.[0]?.fileId;
    assert(typeof deliverFileId === 'number', '납품 파일 fileId 확보', deliverFileId);
    await expectMailDelta(mailDeliverBase, 1, '납품 메일 +1(의뢰인)');
    const reDeliverForm = new FormData();
    reDeliverForm.append('note', '수정 노트 — 재보고(파일 없음).');
    const deliver2 = await req('POST', `/api/market/projects/${pid}/contract/deliver`, {
      token: tExpert,
      form: reDeliverForm,
    });
    assert(
      deliver2.status === 200 &&
        deliver2.json?.data?.deliveredAt === deliveredAt1 &&
        deliver2.json?.data?.deliveryNote === '수정 노트 — 재보고(파일 없음).' &&
        deliver2.json?.data?.files?.length === 1,
      '재보고: deliveredAt 불변·노트 갱신·파일 1건',
      { deliveredAt1, got: deliver2.json?.data?.deliveredAt, files: deliver2.json?.data?.files?.length },
    );

    // ── 20) 산출물 다운로드 — 의뢰인 200 본문>0 / 제3자 403 ─────────────────────
    const dlRes = await fetch(`${API}/api/market/projects/${pid}/contract/files/${deliverFileId}`, {
      headers: { Authorization: `Bearer ${tClient}` },
    });
    const contractDlBody = await dlRes.text();
    assert(dlRes.status === 200 && contractDlBody.length > 0, '산출물 다운로드 의뢰인 200·본문>0', dlRes.status);
    const dlStranger = await fetch(`${API}/api/market/projects/${pid}/contract/files/${deliverFileId}`, {
      headers: { Authorization: `Bearer ${tStranger}` },
    });
    assert(dlStranger.status === 403, '산출물 다운로드 제3자 403', dlStranger.status);

    // ── 21) 관리자 hold → 자동확정 스윕 제외 → unhold → 자동확정(auto) ────────────
    const hold = await req('POST', `/api/admin/market/contracts/${Number(cA.id)}/hold`, {
      token: tAdmin,
      body: { reason: 'E2E 자동확정 정지' },
    });
    assert(hold.status === 200 && hold.json?.data?.holdAt !== null, '관리자 hold(자동확정 정지)');
    // deliveredAt 를 8일 전(정각초)으로 백데이트 → 자동확정 임계 통과.
    const backdated = new Date(Math.floor((Date.now() - 8 * 86_400_000) / 1000) * 1000);
    await prisma.spMarketContract.update({ where: { id: cA.id }, data: { deliveredAt: backdated } });
    const listHeld = await req(
      'GET',
      `/api/admin/market/contracts?tab=all&pageSize=100&q=${encodeURIComponent(cm.mb_id)}`,
      { token: tAdmin },
    );
    const itemHeld = listHeld.json?.data?.items?.find((i) => i.contractId === Number(cA.id));
    assert(itemHeld?.status === 'delivered', 'hold 중 자동확정 스윕 제외(여전히 delivered)', itemHeld?.status);
    const mailAutoBase = await drainMail();
    const unhold = await req('POST', `/api/admin/market/contracts/${Number(cA.id)}/unhold`, { token: tAdmin });
    assert(unhold.status === 200, '관리자 unhold');
    const listSwept = await req(
      'GET',
      `/api/admin/market/contracts?tab=all&pageSize=100&q=${encodeURIComponent(cm.mb_id)}`,
      { token: tAdmin },
    );
    const itemSwept = listSwept.json?.data?.items?.find((i) => i.contractId === Number(cA.id));
    assert(
      itemSwept?.status === 'completed' && itemSwept?.confirmedBy === 'auto',
      'unhold 후 자동확정(completed·auto)',
      { status: itemSwept?.status, by: itemSwept?.confirmedBy },
    );
    const cASwept = await prisma.spMarketContract.findUnique({ where: { id: cA.id } });
    const expCompletedAt = backdated.getTime() + 7 * 86_400_000;
    assert(
      cASwept?.completedAt !== null && cASwept.completedAt.getTime() === expCompletedAt,
      '자동확정 completedAt=deliveredAt+7d',
      { got: cASwept?.completedAt?.toISOString(), expected: new Date(expCompletedAt).toISOString() },
    );
    await expectMailDelta(mailAutoBase, 1, '자동확정 메일 +1(전문가)');

    // ── 22) 관리자 settle(completed→settled) + 이중 settle 409 + 메일 ────────────
    const mailSettleBase = await drainMail();
    const settle = await req('POST', `/api/admin/market/contracts/${Number(cA.id)}/settle`, {
      token: tAdmin,
      body: { note: 'E2E 정산 완료' },
    });
    assert(
      settle.status === 200 &&
        settle.json?.data?.status === 'settled' &&
        settle.json?.data?.settledBy === cfAdmin,
      'settle → settled + settledBy',
      { status: settle.json?.data?.status, by: settle.json?.data?.settledBy },
    );
    const settle2 = await req('POST', `/api/admin/market/contracts/${Number(cA.id)}/settle`, {
      token: tAdmin,
      body: {},
    });
    assert(settle2.status === 409, '이중 settle 409', settle2.status);
    await expectMailDelta(mailSettleBase, 1, '정산 메일 +1(전문가)');

    // ── 23) 별도 계약 B — 의뢰인 confirm(client) + project completed + 메일 ───────
    const B = await createAwardedContract('E2E 계약B 검수확정', 1_500_000);
    assert(B.contract !== null, 'B 계약 생성', B.projectId);
    const coB = await req('POST', `/api/market/projects/${B.projectId}/contract/checkout`, { token: tClient });
    assert(coB.status === 200, 'B checkout');
    const bShop = await cartRowsByIoId(B.contract.contractKey, '쇼핑');
    const simOdB = await simulatePaidOrder(bShop[0].ct_id, B.amount, cm.mb_id);
    ids.simOdIds.push(simOdB);
    writeFileSync(IDS_FILE, JSON.stringify(ids));
    const bGetPaid = await req('GET', `/api/market/projects/${B.projectId}/contract`, { token: tClient });
    assert(bGetPaid.json?.data?.status === 'paid', 'B 승격 paid');
    const bDeliverForm = new FormData();
    bDeliverForm.append('note', 'B 납품');
    const bDeliver = await req('POST', `/api/market/projects/${B.projectId}/contract/deliver`, {
      token: tExpert,
      form: bDeliverForm,
    });
    assert(bDeliver.json?.data?.status === 'delivered', 'B deliver → delivered');
    const mailConfirmBase = await drainMail();
    const confirm = await req('POST', `/api/market/projects/${B.projectId}/contract/confirm`, { token: tClient });
    assert(
      confirm.status === 200 &&
        confirm.json?.data?.status === 'completed' &&
        confirm.json?.data?.confirmedBy === 'client',
      'B confirm → completed(client)',
      { status: confirm.json?.data?.status, by: confirm.json?.data?.confirmedBy },
    );
    const prjB = await prisma.spMarketProject.findUnique({ where: { id: BigInt(B.projectId) } });
    assert(prjB?.status === 'completed', 'B project → completed', prjB?.status);
    await expectMailDelta(mailConfirmBase, 1, '검수 확정 메일 +1(전문가)');

    // ── 24) 별도 계약 C — pending 취소 → 계약·프로젝트 cancelled + 카트/옵션 0건 ──
    const C = await createAwardedContract('E2E 계약C 취소', 800_000);
    assert(C.contract !== null, 'C 계약 생성', C.projectId);
    const coC = await req('POST', `/api/market/projects/${C.projectId}/contract/checkout`, { token: tClient });
    assert(coC.status === 200, 'C checkout');
    const cCancel = await req('POST', `/api/market/projects/${C.projectId}/contract/cancel`, { token: tClient });
    assert(
      cCancel.status === 200 && cCancel.json?.data?.status === 'cancelled',
      'C pending 취소 → cancelled',
      cCancel.json,
    );
    const cShopAfter = await cartRowsByIoId(C.contract.contractKey, '쇼핑');
    const cOptAfter = await optionRowsByIoId(C.contract.contractKey);
    assert(cShopAfter.length === 0 && cOptAfter.length === 0, 'C 취소 후 카트행·옵션행 0건', {
      cart: cShopAfter.length,
      opt: cOptAfter.length,
    });
    const prjC = await prisma.spMarketProject.findUnique({ where: { id: BigInt(C.projectId) } });
    assert(prjC?.status === 'cancelled', 'C project → cancelled', prjC?.status);

    // ── 25) 별도 계약 D — 주문 삭제 후 재주입(checkout C2/H3) ────────────────────
    const D = await createAwardedContract('E2E 계약D 재주입', 2_000_000);
    assert(D.contract !== null, 'D 계약 생성', D.projectId);
    const coD1 = await req('POST', `/api/market/projects/${D.projectId}/contract/checkout`, { token: tClient });
    assert(coD1.status === 200, 'D 최초 checkout');
    const dShop1 = await cartRowsByIoId(D.contract.contractKey, '쇼핑');
    const dCtId1 = dShop1[0].ct_id;
    const simOdD = await simulatePaidOrder(dCtId1, D.amount, cm.mb_id);
    ids.simOdIds.push(simOdD);
    writeFileSync(IDS_FILE, JSON.stringify(ids));
    await deleteSimOrderHeader(simOdD, dCtId1); // 헤더 delete + 카트행 '삭제'
    const coD2 = await req('POST', `/api/market/projects/${D.projectId}/contract/checkout`, { token: tClient });
    assert(coD2.status === 200, 'D 재주입 checkout 성공');
    const dShop2 = await cartRowsByIoId(D.contract.contractKey, '쇼핑');
    assert(
      dShop2.length === 1 && dShop2[0].ct_id !== dCtId1,
      'D 재주입: 새 쇼핑 카트행 1건(신 ct_id)',
      { count: dShop2.length, oldCt: dCtId1, newCt: dShop2[0]?.ct_id },
    );
  } finally {
    writeFileSync(IDS_FILE, JSON.stringify(ids));
    if (diagramUsecaseWasEnabled) {
      await prisma.spAiUsecase.update({ where: { useCase: DEV_DIAGRAM_USECASE }, data: { enabled: true } });
      console.log(`유스케이스 ${DEV_DIAGRAM_USECASE} enabled 원복(0 → 1)`);
    }
  }

  console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
  console.log(`정리: 같은 명령의 cleanup 모드 실행 (ids: ${IDS_FILE})`);
  if (fail > 0) process.exitCode = 1;
}

if (MODE === 'cleanup') await cleanup();
else await run();
await prisma.$disconnect();
