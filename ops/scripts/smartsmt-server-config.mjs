#!/usr/bin/env node
// SmartSMT 연동의 서버 설정 두 파일을 올바른 값으로 맞춘다 (docs/SMARTSMT_INTEGRATION.md §8).
//   samplepcb-web-mono-app/apps/api/.env      — sp-node
//   samplepcb-web/spcb/lib/secret.php         — sp-php
// 두 파일은 git 이 추적하지 않아 배포로 따라가지 않는다. 서버에서 한 번 실행한다.
//
// 사용 (리포 루트에서):
//   node ops/scripts/smartsmt-server-config.mjs            # 점검만 — 무엇을 바꿀지 보여 준다(아무것도 안 고친다)
//   node ops/scripts/smartsmt-server-config.mjs --apply    # 백업한 뒤 고친다
//
// 맞추는 것
//   1. 로그인 토큰 비밀 — .env 의 JWT_SECRET 과 secret.php 의 SPCB_JWT_SECRET 은 같은 값이어야 한다.
//      다르면 로그인은 되는데 /app 의 모든 API 가 401 이 된다(2026-11-17 실제 사례).
//      한쪽이 개발용 자리표시 값이면 다른 쪽 값으로 맞춘다. 둘 다 실제 값이거나 둘 다 자리표시 값이면
//      자동으로 고르지 않는다 — --jwt-from=php|env 또는 --new-jwt-secret 로 정해 준다.
//   2. SmartSMT 공유 비밀 — .env 의 SMARTSMT_SHARED_SECRET = secret.php 의 SPCB_SMARTSMT_SECRET.
//   3. 로그인 수신 주소 — secret.php 의 SPCB_SMARTSMT_LOGIN_URL.
//   4. SmartSMT 주소 — .env 의 SMARTSMT_BASE_URL (견적서 가져오기가 부른다).
//
// 비밀 값은 화면에 찍지 않는다(길이와 같은지 여부, 대조용 지문 6글자만).
// 백업은 웹에서 열리지 않는 곳(~/samplepcb-config-backups, 권한 600)에 둔다 — secret.php 옆에 .bak 을 두면
// nginx 가 글자 그대로 내줄 수 있다.
//
// 옵션: --login-url=<주소> · --base-url=<주소> · --jwt-from=php|env · --new-jwt-secret · --root=<리포 루트>

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=')];
}));
const APPLY = args.has('apply');
const root = resolve(args.get('root') || join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const LOGIN_URL = args.get('login-url') || 'https://smteyes.samplepcb.co.kr/auth/samplepcb';
const BASE_URL = (args.get('base-url') || 'https://smteyes.samplepcb.co.kr').replace(/\/+$/, '');
const JWT_FROM = args.get('jwt-from') || '';
const NEW_JWT = args.has('new-jwt-secret');

const envPath = join(root, 'samplepcb-web-mono-app', 'apps', 'api', '.env');
const phpPath = join(root, 'samplepcb-web', 'spcb', 'lib', 'secret.php');
for (const file of [envPath, phpPath]) {
  if (!existsSync(file)) {
    console.error(`파일이 없습니다: ${file}`);
    process.exit(1);
  }
}

let env = readFileSync(envPath, 'utf8');
let php = readFileSync(phpPath, 'utf8');
const envEol = env.includes('\r\n') ? '\r\n' : '\n';
const phpEol = php.includes('\r\n') ? '\r\n' : '\n';

// ── 읽기 · 쓰기 ──────────────────────────────────────────────────────────────────────────
const unquote = (value) => value.trim().replace(/^(["'])(.*)\1$/, '$2');
const envGet = (name) => {
  const m = new RegExp(`^${name}=(.*)$`, 'm').exec(env);
  return m ? unquote(m[1].replace(/\s+#.*$/, '')) : null;
};
const envSet = (name, value, comment) => {
  const line = `${name}=${value}`;
  if (new RegExp(`^${name}=`, 'm').test(env)) env = env.replace(new RegExp(`^${name}=.*$`, 'm'), () => line);
  else env = `${env.endsWith('\n') ? env : env + envEol}${comment ? `# ${comment}${envEol}` : ''}${line}${envEol}`;
};
const phpDefine = (name) => new RegExp(`define\\(\\s*'${name}'\\s*,\\s*'((?:[^'\\\\]|\\\\.)*)'\\s*\\)\\s*;`);
const phpGet = (name) => {
  const m = phpDefine(name).exec(php);
  return m ? m[1].replace(/\\(['\\])/g, '$1') : null;
};
const phpSet = (name, value, comment) => {
  if (/['\\]/.test(value)) throw new Error(`${name}: 작은따옴표·역슬래시가 든 값은 넣을 수 없습니다`);
  const line = `define('${name}', '${value}');`;
  if (phpDefine(name).test(php)) php = php.replace(phpDefine(name), () => line);
  else php = `${php.endsWith('\n') ? php : php + phpEol}${comment ? `// ${comment}${phpEol}` : ''}${line}${phpEol}`;
};

const fingerprint = (value) => (value ? createHash('sha256').update(value).digest('hex').slice(0, 6) : '------');
const describe = (value) => (value === null ? '없음' : value === '' ? '빈 값' : `길이 ${value.length} · 지문 ${fingerprint(value)}`);
/** 개발용 자리표시 값인가 — 로컬 예시 파일들이 쓰는 문자열. 추측할 수 있는 값이라 서버에 두면 안 된다. */
const isPlaceholder = (value) => value !== null && /^(dev-local-secret|change-me)/i.test(value);

const plan = [];
const notes = [];
const say = (text) => console.log(text);

say(`리포: ${root}`);
say(APPLY ? '방식: 고친다(--apply)' : '방식: 점검만 — 고치려면 --apply');
say('');

// ── 1. 로그인 토큰 비밀 ──────────────────────────────────────────────────────────────────
const envJwt = envGet('JWT_SECRET');
const phpJwt = phpGet('SPCB_JWT_SECRET');
say('[1] 로그인 토큰 비밀 (같아야 한다)');
say(`    .env        JWT_SECRET       : ${describe(envJwt)}${isPlaceholder(envJwt) ? '  ← 개발용 자리표시 값' : ''}`);
say(`    secret.php  SPCB_JWT_SECRET  : ${describe(phpJwt)}${isPlaceholder(phpJwt) ? '  ← 개발용 자리표시 값' : ''}`);
let jwtFinal = envJwt;
if (NEW_JWT) {
  jwtFinal = randomBytes(48).toString('base64url');
  plan.push(['JWT_SECRET · SPCB_JWT_SECRET 을 새 값으로(두 파일 같은 값)', () => { envSet('JWT_SECRET', jwtFinal); phpSet('SPCB_JWT_SECRET', jwtFinal); }]);
} else if (!envJwt || !phpJwt) {
  notes.push('로그인 토큰 비밀이 한쪽에 없습니다 — 손으로 확인이 필요합니다.');
} else if (envJwt === phpJwt) {
  say('    → 같다');
  if (isPlaceholder(envJwt)) notes.push('로그인 토큰 비밀이 두 파일 모두 개발용 자리표시 값입니다. 추측할 수 있는 값이라 누구나 관리자 토큰을 만들 수 있습니다 — --new-jwt-secret 로 새 값을 만드십시오.');
} else {
  say('    → 다르다 (로그인한 모든 API 호출이 401)');
  const from = JWT_FROM || (isPlaceholder(envJwt) && !isPlaceholder(phpJwt) ? 'php' : !isPlaceholder(envJwt) && isPlaceholder(phpJwt) ? 'env' : '');
  if (from === 'php') {
    jwtFinal = phpJwt;
    plan.push(['.env 의 JWT_SECRET 을 secret.php 의 값으로 맞춘다', () => envSet('JWT_SECRET', phpJwt)]);
  } else if (from === 'env') {
    jwtFinal = envJwt;
    plan.push(['secret.php 의 SPCB_JWT_SECRET 을 .env 의 값으로 맞춘다', () => phpSet('SPCB_JWT_SECRET', envJwt)]);
  } else {
    notes.push(isPlaceholder(envJwt) && isPlaceholder(phpJwt)
      ? '로그인 토큰 비밀이 두 파일 모두 개발용 자리표시 값인데 서로 다릅니다 — --new-jwt-secret 로 새 값을 만드십시오.'
      : '로그인 토큰 비밀이 서로 다른데 어느 쪽이 맞는지 가릴 수 없습니다 — 원래 값이 든 쪽을 --jwt-from=php 또는 --jwt-from=env 로 알려 주십시오.');
  }
}
say('');

// ── 2. SmartSMT 공유 비밀 ────────────────────────────────────────────────────────────────
const envSmt = envGet('SMARTSMT_SHARED_SECRET');
const phpSmt = phpGet('SPCB_SMARTSMT_SECRET');
say('[2] SmartSMT 공유 비밀 (같아야 하고, 로그인 토큰 비밀과는 달라야 한다)');
say(`    .env        SMARTSMT_SHARED_SECRET : ${describe(envSmt)}`);
say(`    secret.php  SPCB_SMARTSMT_SECRET   : ${describe(phpSmt)}`);
let smtFinal = envSmt || phpSmt || null;
if (envSmt && phpSmt && envSmt === phpSmt) say('    → 같다');
else if (envSmt) {
  say('    → secret.php 쪽이 없거나 다르다');
  plan.push(['secret.php 의 SPCB_SMARTSMT_SECRET 을 .env 의 값으로 맞춘다', () => phpSet('SPCB_SMARTSMT_SECRET', envSmt, 'SmartSMT 와 나눠 갖는 전용 비밀 — .env 의 SMARTSMT_SHARED_SECRET 과 같은 값')]);
} else if (phpSmt) {
  say('    → .env 쪽이 없다');
  plan.push(['.env 의 SMARTSMT_SHARED_SECRET 을 secret.php 의 값으로 맞춘다', () => envSet('SMARTSMT_SHARED_SECRET', phpSmt, 'SmartSMT 와 나눠 갖는 전용 비밀 — secret.php 의 SPCB_SMARTSMT_SECRET 과 같은 값')]);
} else {
  notes.push('SmartSMT 공유 비밀이 두 파일 모두에 없습니다 — SmartSMT 에 전달한 값을 .env 의 SMARTSMT_SHARED_SECRET 에 넣은 뒤 다시 실행하십시오.');
}
if (smtFinal && smtFinal.length < 32) notes.push('SmartSMT 공유 비밀이 32자보다 짧습니다 — 연동이 닫힙니다(503).');
if (smtFinal && jwtFinal && smtFinal === jwtFinal) notes.push('SmartSMT 공유 비밀이 로그인 토큰 비밀과 같은 값입니다 — 연동이 닫힙니다(503). 서로 다른 값이어야 합니다.');
say('');

// ── 3 · 4. 주소 ─────────────────────────────────────────────────────────────────────────
const curLogin = phpGet('SPCB_SMARTSMT_LOGIN_URL');
say('[3] 로그인 수신 주소 (로그인 뒤 회원을 돌려보낼 SmartSMT 주소)');
say(`    secret.php  SPCB_SMARTSMT_LOGIN_URL : ${curLogin === null ? '없음' : curLogin || '빈 값'}`);
if (curLogin === LOGIN_URL) say('    → 그대로');
else plan.push([`secret.php 의 SPCB_SMARTSMT_LOGIN_URL → ${LOGIN_URL}`, () => phpSet('SPCB_SMARTSMT_LOGIN_URL', LOGIN_URL, '로그인 뒤 회원을 돌려보낼 SmartSMT 주소')]);
say('');

const curBase = envGet('SMARTSMT_BASE_URL');
say('[4] SmartSMT 주소 (견적서 가져오기가 부른다)');
say(`    .env        SMARTSMT_BASE_URL : ${curBase === null ? '없음' : curBase || '빈 값'}`);
if (curBase === BASE_URL) say('    → 그대로');
else plan.push([`.env 의 SMARTSMT_BASE_URL → ${BASE_URL}`, () => envSet('SMARTSMT_BASE_URL', BASE_URL, 'SmartSMT 서버 주소 — 견적서 가져오기가 부른다')]);
say('');

// ── 5. .env 의 다른 값 — 로컬 것이 섞였는지 눈으로 볼 것 (고치지 않는다) ──────────────────────
say('[5] .env 의 다른 값 — 로컬 개발기 값이 섞였는지 확인하십시오 (이 스크립트는 고치지 않습니다)');
const hostOf = (url) => {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return url ? '(주소로 읽을 수 없음)' : '없음';
  }
};
const looksLocal = (value) => /local-web|localhost|^[A-Za-z]:[\\/]|xampp|127\.0\.0\.1:8888/i.test(value || '');
const rows = [
  ['DATABASE_URL (호스트/DB 만)', hostOf(envGet('DATABASE_URL') || ''), false],
  ['G5_DATABASE_URL (호스트/DB 만)', hostOf(envGet('G5_DATABASE_URL') || ''), false],
  ['G5_DATA_PATH', envGet('G5_DATA_PATH') ?? '없음', looksLocal(envGet('G5_DATA_PATH'))],
  ['WEB_BASE_URL', envGet('WEB_BASE_URL') ?? '없음(기본값 local-web 을 쓴다)', envGet('WEB_BASE_URL') === null || looksLocal(envGet('WEB_BASE_URL'))],
  ['SPCB_BRIDGE_URL', envGet('SPCB_BRIDGE_URL') ?? '없음', looksLocal(envGet('SPCB_BRIDGE_URL'))],
  ['SMTP_HOST', envGet('SMTP_HOST') ?? '없음', false],
  ['FILE_SERVICE_TYPE', envGet('FILE_SERVICE_TYPE') ?? '없음(기본값 gerber)', false],
  ['BOM_ENGINE_URL', envGet('BOM_ENGINE_URL') ?? '없음(기본값 127.0.0.1:8400)', false],
];
for (const [label, value, suspicious] of rows) say(`    ${label.padEnd(30)} ${value}${suspicious ? '   ← 로컬 값처럼 보입니다' : ''}`);
say('');

// ── 실행 ────────────────────────────────────────────────────────────────────────────────
if (plan.length === 0) say('바꿀 것이 없습니다.');
else {
  say(APPLY ? '고친 것:' : '바꿀 것 (--apply 로 실행하면 고칩니다):');
  for (const [label] of plan) say(`  · ${label}`);
}
if (notes.length > 0) {
  say('');
  say('확인이 필요한 것:');
  for (const note of notes) say(`  ! ${note}`);
}

if (APPLY && plan.length > 0) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backupDir = join(homedir(), 'samplepcb-config-backups');
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  for (const [file, name] of [[envPath, 'api.env'], [phpPath, 'secret.php']]) {
    const target = join(backupDir, `${name}.${stamp}.bak`);
    copyFileSync(file, target);
    try { chmodSync(target, 0o600); } catch { /* 권한 비트가 없는 파일 시스템 */ }
  }
  for (const [, run] of plan) run();
  writeFileSync(envPath, env);
  writeFileSync(phpPath, php);
  say('');
  say(`백업: ${backupDir} (api.env.${stamp}.bak · secret.php.${stamp}.bak)`);
  say('');
  say('다음 순서:');
  say('  1. sudo systemctl restart sp-api          # .env 는 다시 시작해야 읽힌다');
  say('  2. sudo systemctl reload php8.1-fpm       # secret.php 가 opcache 에 남아 있을 수 있다');
  say('  3. 사이트에 로그인해 /app/bom 목록이 보이는지 확인');
}
