---
topic: infrastructure
last_compiled: 2026-07-20
sources_count: 11
status: active
---

# infrastructure

## Purpose [coverage: high — 5 sources]

samplepcb 웹 플랫폼의 로컬/운영 라우팅·배포·인프라 계층. 두 코드 영역(sp-php = 그누보드5/영카트 `samplepcb-web/`, sp-vue·sp-market·sp-rnd·sp-node = `samplepcb-web-mono-app/`)을 **같은 도메인**에서 함께 돌리는 것이 핵심 목표다 — 같은 도메인이어야 PHPSESSID 쿠키가 공유되어 인증 브리지(그누보드=IdP)가 성립한다. 로컬은 nginx 5경로 분기(`/`·`/app`·`/market`·`/rnd`·`/api`)가 가동 중이고, 운영은 centrafab.co.kr 실서버 배포 런북·배포 스크립트(`deploy.sh`, 케이스 9종)까지 확립됐다(2026-07, `docs/DEPLOY_CENTRAFAB.md`). 2026-07-17 신규 **sp-rnd**(연구·실험용 독립 Vue 앱)가 `/rnd` 예약 경로로 편입되어 로컬 프록시와 운영 정적 배포를 모두 지원한다. 인프라 설정은 메타 repo 가 추적하는 `ops/` 폴더에, 실파일 저장은 외부 파일서버 `file.samplepcb.kr` 에 위임한다.

## Architecture [coverage: high — 7 sources]

**로컬 통합 호스트 `local-web.samplepcb.co.kr` — nginx 443 리버스프록시, 경로 분기:**

```
/api/    → 127.0.0.1:3333  Node (Fastify)      ← samplepcb-web-mono-app/apps/api    (sp-node)
/app/    → 127.0.0.1:5173  Vue (Vite dev+HMR)  ← samplepcb-web-mono-app/apps/web    (sp-vue, base:'/app/')
/market/ → 127.0.0.1:5176  Vue (Vite dev+HMR)  ← samplepcb-web-mono-app/apps/market (sp-market, base:'/market/')
/rnd/    → 127.0.0.1:5177  Vue (Vite dev+HMR)  ← samplepcb-web-mono-app/apps/rnd    (sp-rnd, base:'/rnd/') ★2026-07-17 신설
/        → 127.0.0.1:8888  PHP (XAMPP Apache)  ← samplepcb-web (그누보드/영카트)     ← 루트=PHP
```

- location 순서 규칙: 구체 경로(`/api`·`/app`·`/market`·`/rnd`)를 먼저, catch-all `/`을 마지막에. **`/app`·`/api`·`/market`·`/rnd`는 그누보드가 점유하지 않는 예약 경로**. `/spcb`(인증·알림 브리지)는 별도 location 없이 catch-all 로 PHP 가 처리.
- **`/rnd` = sp-rnd (연구·실험 Vue 앱)**: 제품 기능과 분리된 가설 검증·프로토타이핑용 독립 Vite 앱(패키지명 `rnd`, base `'/rnd/'`, 포트 5177). `pnpm dev`(turbo dev)에 포함되며 단독 기동은 `pnpm dev:rnd`. dev 프록시 + 운영 정적 블록(주석 택1)이 스니펫에 준비돼 있다.
- **`/market` = 재능마켓 Vue 앱(sp-market)**: SPA급 인터랙션(마법사·블라인드 견적 비교·대시보드)이 필요한 신규 소비자 서비스는 sp-vue(관리자 전용)와 분리해 별도 Vue 앱으로 — 마켓 관리 화면은 `/app/admin/market`. 2026-07-08 라이브 nginx 반영 완료(`/rnd`의 라이브 반영은 스니펫에 별도 명시 없음 — 라이브 명시는 `/market`까지).
- **설정 파일 이원화 (중요)**: 실제 구동 config 는 `D:\nginx\conf\nginx.conf`(repo **밖**, 로컬 머신). `ops/nginx/local-web.conf` 는 repo 가 추적하는 **레퍼런스 스니펫**으로 라이브와 동일 구조(라이브 `/app`·`/market`엔 `X-Forwarded-Proto` 한 줄 추가). 80 포트는 https 301, 와일드카드 인증서 `_wildcard.samplepcb.co.kr`, `client_max_body_size 100M`.
- `/app`·`/market`·`/rnd`는 각각 dev(Vite 프록시 + WebSocket Upgrade HMR)와 운영(빌드 `dist/` alias + `try_files … /{app,market,rnd}/index.html` SPA fallback) 블록 중 **택1** — 운영 블록은 스니펫에 주석으로 준비돼 있다.
- **로컬 nginx = Windows 서비스('nginx', 자동 시작)**: `nginx -s reload` 신호는 서비스 컨텍스트라 관리자 권한으로도 Access denied — 설정 반영은 관리자 `net stop nginx & net start nginx`(순단 ~1초).
- 라이브 nginx 부가 호스트(repo 미추적): `local`·`local-www`→5173(Vue 단독 프리뷰), `local2`·`local3`→5174·5175(git worktree 병렬 dev). **통합 라우팅이 살아있는 건 `local-web` 하나뿐** — 나머지는 `/` 전체가 Vue.
- HTTPS/도메인 독립성: `G5_DOMAIN=''` + `g5_path()`가 `HTTP_HOST` 를 쓰므로 nginx 가 `Host $host` 만 전달하면 운영 도메인이 달라도 무관. 로컬 프록시 뒤 https 인식은 `proxy_fix.php`(php.ini `auto_prepend_file`).

**운영 배포 — centrafab.co.kr (`docs/DEPLOY_CENTRAFAB.md`, Ubuntu 22.04 · nginx 단독 · Cloudflare Flexible):**

```
[방문자] → Cloudflare(SSL 종단) → 오리진 nginx :80 ─┬─ /api/    → 127.0.0.1:3333 Node/Fastify (systemd 'sp-api')
                                                    ├─ /app/    → apps/web/dist    정적 SPA
                                                    ├─ /market/ → apps/market/dist 정적 SPA
                                                    ├─ /rnd/    → apps/rnd/dist    연구용 정적 SPA ★2026-07-17
                                                    └─ /        → php-fpm 8.1(unix socket) 그누보드  ※Apache 없음
```

- **Apache 불필요** — PHP는 nginx + php-fpm 직결(Apache를 끼우면 REMOTE_ADDR=127.0.0.1이 돼 `cloudflare.check.php` https 자동감지가 깨짐). https 인식은 코어 `cloudflare.check.php`(CF-Connecting-IP + X-Forwarded-Proto) — 오리진 proxy_fix 불필요.
- 운영 nginx 설정은 리포 미추적(서버에서 직접 생성, 런북 STEP 9 인라인) — `/app`·`/market`·`/rnd` 무슬래시 301 + `.htaccess` 번역 포함: data/ PHP 실행차단(RCE 방지)·`/spcb` 무확장 라우팅+Bearer 패스스루·루트 짧은URL(`/슬러그`→`spcb/pages/`)·lib 차단.
- 빌드 산출물 = `apps/web/dist`·`apps/market/dist`·`apps/rnd/dist`·`apps/api/dist/server.js`(`pnpm -r build`). Node는 systemd 유닛 `sp-api`(`ExecStart=/usr/bin/node --env-file=.env dist/server.js` — **시스템 node 절대경로 필수**, fnm 임시경로는 203/EXEC). MariaDB는 charset utf8 + **`sql_mode=''` 영구화**(strict면 그누보드 쓰기 실패).
- **재배포 = 루트 `deploy.sh`** (운영 서버 전용, 메뉴식 **9케이스**): sp-api만/+DB마이그레이션/web만/market만/**풀 재배포(api+web+market+rnd+DB)**/sp-php만(git pull+php-fpm reload=opcache 비움)/nginx reload/.env만(sp-api 재시작)/**R&D(rnd)만(케이스 9, 2026-07-17 신설)**. `pull` 단계에 **스테일 emit 정리 가드**(`clean_stale`) 내장 — 과거 `vue-tsc -b`가 src/에 emit한 untracked `.js`·`.tsbuildinfo`를 제거(vite 확장자 해석이 .js > .ts라 옛 .js가 .ts를 가려 MISSING_EXPORT 빌드 실패 재발 방지). prisma는 `migrate deploy`만(reset/dev 금지), 파괴적 마이그레이션 여부를 물어 sp-api 중단/무중단 선택.
- 레거시 데이터 이관: 최초 `migrate:run`(1회) → 이후 `migrate:sync`(델타 반복, 원장 무시·diff 판정) → 컷오버 `migrate:sync --final`. 컷오버 전 신규 플랫폼은 조회 전용(신규 변경은 다음 sync가 레거시 기준으로 원복).

**Docker 배포(별도 트랙, 예정)**: `ops/docker-compose.yml` — `web`(php+apache)·`api`(node/fastify)·`db`(mariadb)·`edge`(nginx) 4컨테이너. 영속 볼륨: 그누보드 `data/`, mariadb. centrafab 실배포는 Docker 없이 native(php-fpm+systemd)로 확정됐다.

## Talks To [coverage: high — 7 sources]

| 구성요소 | 상대 | 방식 |
|---|---|---|
| nginx edge (로컬) | sp-node(3333) · sp-vue(5173) · sp-market(5176) · sp-rnd(5177) · sp-php(8888) | 경로 기반 리버스프록시, `X-Forwarded-*`/`Host` 전달 |
| nginx edge (운영) | sp-api(3333, systemd) · web/market/rnd `dist/` 정적 · php-fpm unix socket | Cloudflare 뒤 :80, `X-Real-IP=$http_cf_connecting_ip` |
| sp-node | **file.samplepcb.kr** | 서버-to-서버 업로드/다운로드/삭제 대행(`file-server.ts`), pathToken 클라이언트 미노출 |
| sp-node | 그누보드 공유 DB `samplepcb` | `DATABASE_URL`(Prisma sp_*) + `G5_DATABASE_URL`(g5 접근 카탈로그, mysql2) |
| sp-node → sp-php (역방향 서버 호출) | `SPCB_BRIDGE_URL` (`http://127.0.0.1:8888`) | 주문 상태 전이 시 `POST /spcb/api/order-notify` 로 메일/SMS 위임(서비스 JWT). 기존 PHP→Node(JWT 인증)에 더해 **양방향 서버 통신** 성립 |
| sp-php 메일 | **로컬 Mailpit `127.0.0.1:25`** | config.php `G5_SMTP` SMTP 모드 — `mailer.lib.php`→PHPMailer(IsSMTP)→25번. Mailpit 이 가로채 웹 UI(`:8025`). XAMPP mailtodisk 는 안 통함 |
| 거버 뷰어 (local-gerber) | local-web `/spcb/api/me` · `/api` | 교차 서브도메인 same-site 쿠키 전달, me.php `*.samplepcb.co.kr` 오리진 CORS 반사 |
| migrate:sync (운영) | 레거시 운영 DB (읽기전용 직결) | 델타 diff 대조 — 신규분+재대조, 삭제/이상은 리포트만 |
| sp-node HOST 바인딩 | 127.0.0.1 (로컬·운영 공통) | nginx 가 같은 호스트에서 프록시 — 공개 포트는 운영 80뿐 |

## API Surface [coverage: medium — 4 sources]

파일서버 `file.samplepcb.kr` (기본값, `FILE_SERVER_URL` 오버라이드):

- `POST /api/uploadFileByAnonymous` — multipart(`serviceType`, `files`). 응답 `{ data: [{ uploadFileName, originFileName, pathToken, size }] }`. `serviceType` 운영 `gerber`/테스트 `demo`(`FILE_SERVICE_TYPE`).
- `GET /api/download/:pathToken` — 실파일 다운로드(썸네일 프록시용). 404 는 null, content-type 미제공 시 octet-stream 보정.
- `GET /api/delete/:pathToken` — 실파일 삭제. 404(이미 없음)는 성공 → 재시도 멱등.

sp-node 환경변수(`apps/api/.env.example` + 운영 런북 STEP 6): `PORT`·`HOST`·`JWT_SECRET`(그누보드 `spcb/lib/secret.php` 와 수동 동기화 — **회원 JWT·서비스 JWT 공통 대칭키**, 어긋나면 401)·`DATABASE_URL`·`LEGACY_DATABASE_URL`(읽기 전용)·`G5_DATABASE_URL`·`G5_DATA_PATH`(배너 이미지 등 그누보드 data 쓰기)·`SPCB_BRIDGE_URL`·`WEB_BASE_URL`·`FILE_SERVER_URL`·`FILE_SERVICE_TYPE`·`SMTP_HOST/PORT`·`ALIMTALK_ENABLED`.

운영 배포 명령 표면(`deploy.sh` 케이스 1–9): api / api+DB / web / market / 풀(rnd 포함) / php / nginx / .env / **rnd** — 정적 앱(web·market·rnd)은 dist 교체만으로 즉시 반영(서비스 재시작 불필요), sp-api는 `.env`·코드 변경 시 `systemctl restart sp-api` 필수(systemd 는 시작시점 env 고정). R&D 앱 단독 배포는 `./deploy.sh 9`.

## Data [coverage: medium — 4 sources]

- **실파일** 소유 = file.samplepcb.kr. sp-node 는 `pathToken` 만 `sp_file`(ref_type='sp_order_spec')에 보관. 다운로드 접근 보안은 추후 과제.
- **공유 DB**: sp_* 는 그누보드 DB(`samplepcb`) 동거(2026-07-03 통합). ⚠ `prisma migrate reset`/`migrate dev` 금지 — g5_* 전체 드랍/전체 reset 요구. 배포도 `migrate deploy` 만.
- DB charset = `utf8`(utf8mb4 아님). 운영 MariaDB 는 `sql_mode=''` 영구 설정 필수.
- 마이그레이션 상태 파일: 원장 `.tmp/migrate/ledger-<DB>.json`(재이관 시 삭제 필수 — 안 지우면 스킵), sync 리포트 `.tmp/migrate/sync-report-<DB>-<시각>.json`.
- **로컬 메일 영속**: Mailpit 기본 인메모리(재시작 시 비움). `--database` 로 영속 가능. nssm 서비스 등록으로 부팅 자동 실행(`docs/LOCAL_MAIL_TESTING.md`).
- 운영 영속 경로: 그누보드 `data/`(업로드·세션·`dbconfig.php`) — sp-api 실행 유저(samplepcb)가 `data/banner/` 쓰기 권한 필요(없으면 슬라이드 등록 500).

## Key Decisions [coverage: high — 7 sources]

- **2026-07-17 — sp-rnd 독립 R&D Vue 앱 + `/rnd` 예약 경로 신설**: 가설 검증·프로토타이핑을 제품 앱과 분리한 네 번째 앱(`samplepcb-web-mono-app/apps/rnd`, base `'/rnd/'`, 포트 5177). 그누보드 예약 경로가 `/app`·`/api`·`/market`·`/rnd` 4개로 확장. 로컬 스니펫 `/rnd`→5177 프록시, 운영 nginx `/rnd/`→`apps/rnd/dist` 정적 서빙, `deploy.sh` 케이스 9(rnd 단독)·케이스 5(풀 배포)에 rnd 빌드 편입, pnpm 필터 `rnd` 추가.
- **2026-07-11 — deploy.sh pull 단계 스테일 emit 정리 가드**: 과거 `vue-tsc -b` 가 src/에 emit 한 `.js`/`.tsbuildinfo` 잔재를 pull 마다 자동 제거 — 빌드 스크립트는 `--noEmit` 으로 교정됐지만 서버 작업트리 잔재는 pull 이 못 지우므로 배포 스크립트가 방어(vite MISSING_EXPORT 재발 방지).
- **2026-07 — 운영은 Docker 없이 native**: centrafab.co.kr 은 nginx+php-fpm 직결(Apache 없음)+systemd sp-api+정적 dist 로 확정. Apache 를 끼우면 REMOTE_ADDR 오염으로 Cloudflare https 자동감지가 깨진다. Docker compose 는 별도 예정 트랙.
- **2026-07 — Cloudflare Flexible 로 SSL 종단**: 오리진은 :80 만 공개, https 인식은 코어 `cloudflare.check.php` 에 위임(proxy_fix 불필요). 추후 Full(strict) 승격 권장.
- **2026-07-08 — 재능마켓은 별도 Vue 앱 + `/market` 예약 경로**: sp-vue(`/app`)는 관리자 전용 유지, SPA급 소비자 서비스는 sp-market 분리(마켓 관리 화면만 `/app/admin/market`). 라이브 nginx 반영 완료.
- **같은 도메인 경로 분기** (도메인 분리 대신): PHPSESSID 공유 → 인증 브리지가 CORS/서드파티쿠키 문제 없이 성립. `/app`·`/market`·`/rnd`·`/api` 를 예약 경로로 확보.
- **레퍼런스 스니펫 방식**: 실구동 nginx.conf 는 repo 밖, `ops/nginx/local-web.conf` 를 라이브 동일 반영 추적본으로 유지. 운영 nginx 설정도 리포 미추적(런북에 전문 인라인).
- **파일 업로드 대행**: sp-node 서버-to-서버 대행(pathToken 클라이언트 미노출). 하드 삭제는 실파일 먼저 → DB 파기, 404 는 성공 취급으로 멱등. 삭제 API 보안은 후속 트랙(2026-07 — 기능 먼저).
- **메일은 인프라가 아니라 코어 SMTP 모드에 종속** — config.php `G5_SMTP=127.0.0.1:25` 를 코어 비수정으로 유지하므로, 로컬은 25번에 인증 없는 SMTP(Mailpit)를 맞춘다. 운영은 인증형 릴레이/`mail_options` 이벤트 커스텀 필요.
- 코어 비수정: `G5_DOMAIN=''` 유지, 로컬 https 는 `proxy_fix.php` auto_prepend.

## Gotchas [coverage: high — 6 sources]

- **로컬 nginx 는 Windows 서비스라 reload 불가** — `nginx -s reload` 는 관리자여도 Access denied. 반영은 관리자 `net stop nginx & net start nginx`(순단 ~1초).
- **운영 재배포 후 스테일 emit**: 서버 작업트리에 남은 옛 `src/**/*.js` 가 vite 에서 `.ts` 를 가려 MISSING_EXPORT — `deploy.sh` 의 `clean_stale` 이 pull 마다 제거하므로 수동 pull+빌드 대신 deploy.sh 사용.
- **systemd 함정 3종**(운영): ① `ExecStart` 는 시스템 node 절대경로(`/usr/bin/node`) — fnm 경로면 203/EXEC ② `.env` 변경 후 `systemctl restart sp-api` 필수(시작시점 env 고정) ③ php-fpm 소켓 소유자를 nginx 유저(samplepcb)로 안 맞추면 502(13: Permission denied).
- **pnpm 필터명은 스코프 없음** — `--filter api`·`web`·`market`·`rnd`(`@sp/api` 아님). `@sp/*` 는 패키지 쪽.
- **strict sql_mode 면 그누보드 쓰기 실패**(1364 Field doesn't have a default value) — `sql_mode=''` 를 즉시+영구(50-server.cnf) 둘 다.
- ⚠ **파일서버 delete 무인증 GET**: pathToken 유출 시 임의 파일 삭제 가능. 내부망 제한/서버 간 인증 미처리 과제. 파일서버는 한 요청 복수 파일 처리 못 함 — `file-server.ts` 가 파일당 1요청 순차 전송.
- **로컬 메일 안 옴**: `127.0.0.1:25` 에 Mailpit 안 떠 있으면 `error.log` 에 `SMTP connect() failed` 만 남고 조용히 실패(코어가 반환값 미검사). `netstat -ano | findstr :25` 확인. 브리지는 `sent` 라도 실발송 실패 가능.
- **알림 브리지 실패는 삼켜짐** — `notifyOrderEvent` 타임아웃 10s, 실패는 'failed' 로 전이 성공 불변. 발송 안 되면 access.log 의 `POST /spcb/api/order-notify` 기록·JWT 시크릿 정합부터 확인. sp-node 401 은 시크릿 불일치/토큰 만료(TTL 10분)/.env 미재시작.
- **레퍼런스 스니펫 ≠ 라이브 그대로**: 라이브 `/app`·`/market` 엔 `X-Forwarded-Proto` 한 줄 더, 부가 호스트(local·local2·local3)는 repo 미추적. `/rnd` 라이브 반영 여부도 스니펫 헤더에 명시가 없다(라이브 반영 명시는 `/market` 2026-07-08 까지) — `ops/README.md` "현재" 절의 통합 호스트 나열에도 `/rnd` 가 아직 빠져 있어(참고 절 예약 경로엔 포함) 문서 간 부분 갱신 상태.
- **통합 라우팅은 local-web 하나뿐** — `local.samplepcb.co.kr` 등은 `/` 전부 Vue라 PHP·`/api` 없음.
- **로컬 dev 쿠키 도메인 충돌**: 거버 webpack devServer 가 운영 www 로 프록시하며 도메인와이드 PHPSESSID 를 심으면 host-only PHPSESSID 와 공존해 재로그인 실패 — 근본책은 거버 프록시 `cookieDomainRewrite`.
- **재이관 시 원장 삭제 필수** — `.tmp/migrate/ledger-*.json` 안 지우면 migrate:run 이 전부 스킵. 반대로 `migrate:sync` 는 원장 무시(diff 판정)라 삭제 불필요. 컷오버 전 신규 플랫폼에서 바꾼 데이터는 다음 sync 가 레거시 기준으로 원복(단방향 정본).
- location 순서: 구체 경로를 catch-all 보다 먼저 두지 않으면 `/api`·`/app`·`/market`·`/rnd` 가 PHP 로 흘러간다.

## Sources [coverage: high — 11 sources]

- [ops/README.md](../../ops/README.md) — 예약 경로 4종·R&D 앱 배포 안내(deploy.sh 9/5)
- [ops/nginx/local-web.conf](../../ops/nginx/local-web.conf) — 5경로 레퍼런스 스니펫(/rnd 포함)
- [docs/DEPLOY_CENTRAFAB.md](../../docs/DEPLOY_CENTRAFAB.md) — centrafab.co.kr 운영 배포 런북(/rnd 정적 서빙 포함)
- [deploy.sh](../../deploy.sh) — 운영 재배포 스크립트(케이스 9종·스테일 emit 가드)
- [docs/LOCAL_MAIL_TESTING.md](../../docs/LOCAL_MAIL_TESTING.md) — Mailpit·SMTP 모드·발송 경로
- [AGENTS.md](../../AGENTS.md) — sp-rnd 별칭·예약 경로·통합 라우팅·인증 브리지
- [CLAUDE.md](../../CLAUDE.md)
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md)
- [samplepcb-web-mono-app/apps/api/.env.example](../../samplepcb-web-mono-app/apps/api/.env.example) — SPCB_BRIDGE_URL·파일서버·공유 DB
- [samplepcb-web-mono-app/apps/api/src/lib/file-server.ts](../../samplepcb-web-mono-app/apps/api/src/lib/file-server.ts)
- [samplepcb-web-mono-app/apps/rnd/vite.config.ts](../../samplepcb-web-mono-app/apps/rnd/vite.config.ts) — base '/rnd/'·포트 5177 실측
