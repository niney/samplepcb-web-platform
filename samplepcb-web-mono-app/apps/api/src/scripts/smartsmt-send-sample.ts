import { randomBytes } from 'node:crypto';
import { buildSampleEnvelope, buildSampleMultipart, sampleFiles } from '../lib/smartsmt-sample';
import { SMARTSMT_PEER, SMARTSMT_SELF, signSmartsmtToken, smartsmtSecret } from '../lib/smartsmt-token';

// SmartSMT "견적서 전송"을 흉내 낸다 — SmartSMT 개발 서버는 로컬 개발기를 부를 수 없어서,
// 수신 주소(POST /api/smartsmt/quotes)를 로컬에서 시험할 때 쓴다. docs/SMARTSMT_INTEGRATION.md §4.7.
//
// ⚠ 보내는 견적서는 문서의 칸 표로 짠 **가짜 견본**이다(lib/smartsmt-sample.ts).
// ⚠ 받는 서버는 파일 3개를 파일서버에 올리고 sp_smt_* 에 행을 만든다. 시험 뒤 치우려면 --cleanup-hint 참고.
//
// 사용: pnpm smartsmt:send-sample [옵션]
//   --target=http://127.0.0.1:3333   받는 서버 (기본값)
//   --order=SIM-0001                 주문 번호 (같은 번호로 다시 보내면 같은 주문의 새 견적이 된다)
//   --quote=Q-…                      견적 번호 (기본: 실행마다 새 번호. 같은 번호를 주면 중복 응답을 본다)
//   --status=REVIEW_REQUIRED         검토 필요 견적
//   --blocked                        합계가 막힌 견적(최종 금액 null)
//   --owner=mb_id                    견적서의 owner_mb_id
//   --no-files                       파일 없이 보낸다
//   --bad-hash                       BOM 내용을 바꿔 보낸다 → 400 FILE_MISMATCH
//   --bad-token                      다른 비밀로 서명한다 → 401 BAD_TOKEN

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key = '', ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=')] as const;
  }),
);
const flag = (name: string): boolean => args.has(name);
const option = (name: string): string | undefined => {
  const value = args.get(name);
  return value === undefined || value === '' ? undefined : value;
};

const secret = smartsmtSecret();
if (secret === null) {
  console.error('SMARTSMT_SHARED_SECRET 이 설정되지 않았습니다 (apps/api/.env).');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(2, 14);
const orderId = option('order') ?? 'SIM-0001';
const quoteId = option('quote') ?? `Q-${stamp.slice(0, 6)}-${stamp.slice(6)}-${randomBytes(3).toString('hex')}`;
const status = option('status');
const ownerMbId = option('owner');

const files = flag('no-files') ? [] : sampleFiles();
const envelope = buildSampleEnvelope({
  orderId,
  quoteId,
  madeAt: new Date().toISOString(),
  blocked: flag('blocked'),
  files,
  ...(status === 'REVIEW_REQUIRED' ? { quoteStatus: 'REVIEW_REQUIRED' as const } : {}),
  ...(ownerMbId === undefined ? {} : { ownerMbId }),
});
// 해시는 원래 내용으로 적어 두고 내용만 바꾼다.
const sent = flag('bad-hash')
  ? files.map((file) => (file.part === 'bom' ? { ...file, buffer: Buffer.from('tampered-in-transit') } : file))
  : files;

const { boundary, body } = buildSampleMultipart(envelope, sent, { quoteId, orderId });
const token = signSmartsmtToken(
  flag('bad-token') ? 'not-the-shared-secret-0123456789abcdefghijklmnop' : secret,
  { iss: SMARTSMT_PEER, aud: SMARTSMT_SELF },
);
const target = `${option('target') ?? 'http://127.0.0.1:3333'}/api/smartsmt/quotes`;

const started = performance.now();
const res = await fetch(target, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
  body,
});
const text = await res.text();
console.log(`POST ${target}`);
console.log(`  order_id=${orderId} quote_id=${quoteId} files=${String(sent.length)} bytes=${String(body.length)}`);
console.log(`  → HTTP ${String(res.status)} (${String(Math.round(performance.now() - started))}ms) ${text}`);
if (!res.ok) process.exitCode = 1;
