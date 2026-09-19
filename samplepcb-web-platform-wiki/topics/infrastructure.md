---
topic: infrastructure
last_compiled: 2026-09-19
sources_count: 40
status: active
---

# infrastructure

## Purpose [coverage: high — 12 sources]

samplepcb 웹 플랫폼의 로컬/운영 라우팅·배포·DB 운영·인프라 계층. 소스 날짜 범위는 2026-06-30(CLAUDE.md)~2026-09-18(`shot.mjs`)이며 무게중심은 2026-09(서브도메인 nginx·DB 스냅샷 원복·운영 재이관·프로토타입 정리). 두 코드 영역(sp-php = 그누보드5/영카트 `samplepcb-web/`, sp-vue·sp-market·sp-develop·sp-node = `samplepcb-web-mono-app/`)을 **같은 도메인**에서 함께 돌리는 것이 핵심 목표다 — 같은 도메인이어야 PHPSESSID 쿠키가 공유되어 인증 브리지(그누보드=IdP, [spcb-bridge](spcb-bridge.md))가 성립한다.

2026-09-19 현재 로컬은 nginx 4경로 분기(`/`·`/app`·`/market`·`/develop`·`/api` — **`/rnd` 는 2026-08-28 폐지**, 5177 포트와 `deploy.sh` 9번 자리를 sp-develop 이 이어받음)가 가동 중이다. 운영은 한 Ubuntu 서버(`qn391`, 유저 samplepcb)에 **세 nginx 사이트**가 산다: `centrafab.co.kr`(운영 정본 `centrafab-main`, Cloudflare Flexible) · `dev.centrafab.co.kr`(개발용 — `-dev` 작업트리·`sp-api-dev` 3334·`sp-engine-dev` 8401) · `new.samplepcb.co.kr`(Cafe24 DNS 직결 + Let's Encrypt 443, 2026-09-16 설계·미커밋). 재배포는 루트 `deploy.sh` 메뉴 10케이스, 배포 전 DB 스냅샷은 `db:prepare` 가 자동으로 남기고(2026-09-11), 전체 원복·운영 재이관(`migrate:reset-data`, 2026-09-16)·프로토타입 정리(`prod-develop-cleanup.sh`, 2026-09-11 운영 실행)·그누보드 코어 패치 가드(`check-core-patches.sh`, 2026-08-05)까지 `ops/`·`docs/` 가 절차로 붙든다. 실파일 저장은 외부 파일서버 `file.samplepcb.kr` 위임, 로컬 메일은 Mailpit, DB 런타임 튜닝은 `docs/DB_TUNING.md`(2026-07-24) 그대로다.

## Architecture [coverage: high — 14 sources]

**로컬 통합 호스트 `local-web.samplepcb.co.kr` — nginx 443 리버스프록시, 경로 분기 (2026-09-05 기준 [local-web.conf](../../ops/nginx/local-web.conf)):**

```
/api/     → upstream node_api     127.0.0.1:3333  Node (Fastify)      ← apps/api     (sp-node)     keepalive 32
/app/     → upstream vite_app     127.0.0.1:5173  Vue (Vite dev+HMR)  ← apps/web     (sp-vue,     base:'/app/')     keepalive 64
/market/  → upstream vite_market  127.0.0.1:5176  Vue (Vite dev+HMR)  ← apps/market  (sp-market,  base:'/market/')  keepalive 32
/develop/ → upstream vite_develop 127.0.0.1:5177  Vue (Vite dev+HMR)  ← apps/develop (sp-develop, base:'/develop/') keepalive 32 ★2026-09-05 (/rnd 자리)
/         → 127.0.0.1:8888  PHP (XAMPP Apache)  ← samplepcb-web (그누보드/영카트)  ← 루트=PHP
(nginx 미노출)  127.0.0.1:8400  Python (FastAPI/uvicorn) ← samplepcb-parts-engine (sp-engine) ★sp-node 내부 프록시
```

- location 순서 규칙: 구체 경로를 먼저, catch-all `/` 을 마지막에. **`/app`·`/api`·`/market`·`/develop` 는 그누보드가 점유하지 않는 예약 경로**([AGENTS.md](../../AGENTS.md)). `/spcb`(인증·알림 브리지)는 별도 location 없이 catch-all 로 PHP 가 처리.
- **upstream keepalive 는 선택이 아니다(2026-08-16 실측)**: Vite dev 는 모듈 하나가 요청 하나라 e2e 여정을 연속으로 돌리면 수만 건이 나가고, 연결을 재사용하지 않으면 TIME_WAIT 이 쌓여 **Windows 임시 포트(이 머신 13,977개)가 고갈** → error.log `10048 Only one usage of each socket address` → 502 → SPA 빈 화면. 범인은 `Connection "upgrade"` 고정값(HMR 용인데 일반 요청까지 새 연결). 처방은 http{} 의 `map $http_upgrade $connection_upgrade { default upgrade; '' ''; }` + 각 upstream `keepalive` + `proxy_http_version 1.1`(`/api` 는 `Connection ""`).
- **Vite dev 서버 바인딩 규율**(`apps/*/vite.config.ts`): `host: '127.0.0.1'`(기본 localhost 는 Windows 에서 IPv6 ::1 만 열려 nginx IPv4 프록시가 502) · `allowedHosts: ['local-web.samplepcb.co.kr']`(Vite 는 비허용 Host 403) · `/api`·`/spcb` 프록시(nginx 없이 5173 직결 시) · sp-develop 은 **`strictPort: true`** — nginx 가 5177 고정 프록시라 점유 시 조용히 밀리면 라우팅이 끊기므로 명시적으로 실패시킨다. 포트 대역: 5173=sp-vue, 5174·5175=worktree 병렬, 5176=sp-market, 5177=sp-develop.
- **설정 파일 이원화**: 실제 구동 config 는 `D:\nginx\conf\nginx.conf`(repo **밖**). `ops/nginx/local-web.conf` 는 repo 가 추적하는 **레퍼런스 스니펫**(라이브 `/app`·`/market` 엔 `X-Forwarded-Proto` 한 줄 추가). 80 포트는 https 301, 와일드카드 인증서 `_wildcard.samplepcb.co.kr`(mkcert), `client_max_body_size 100M`. 각 앱은 dev(Vite 프록시) / 운영(빌드 `dist/` alias + `try_files … /{app,market,develop}/index.html`) 블록 **택1**(운영 블록은 주석).
- **로컬 nginx = Windows 서비스('nginx', 자동 시작)**: `nginx -s reload` 는 관리자여도 Access denied — 반영은 관리자 `net stop nginx & net start nginx`(순단 ~1초). 부가 호스트(repo 미추적) `local`·`local-www`→5173, `local2`·`local3`→5174·5175 — 통합 라우팅은 `local-web` 하나뿐.
- HTTPS/도메인 독립성: `G5_DOMAIN=''` + `g5_path()` 가 `HTTP_HOST` 를 쓰므로 nginx 가 `Host $host` 만 전달하면 도메인이 달라도 무관([core-nonmodification](../concepts/core-nonmodification.md)). 로컬 프록시 뒤 https 인식은 `proxy_fix.php`(php.ini `auto_prepend_file`).

**`ops/` 폴더 구성(2026-09-19)**: `nginx/local-web.conf`(로컬 스니펫, 추적) · `nginx-live/`(**운영 서버 `/etc/nginx` 스냅샷 — gitignore, 커밋 금지**: `nginx.conf`·`sites-enabled/{centrafab-main,centrafab,new-samplepcb,default,sp_projects,niney_life_pickr*}`·`bootstrap/new-samplepcb-http.conf` — 같은 서버에 easypcb.co.kr 계열 타 프로젝트 사이트도 동거) · `systemd/sp-engine.service` · `scripts/`(`check-core-patches.sh`·`prod-develop-cleanup.sh`·`shot.mjs`·`e2e-market.mts`·`e2e-develop.mts`) · `README.md`(2026-07-20 판 — `/develop` 미반영, 아래 Gotchas). `docker-compose.yml` 은 여전히 "예정"[as of 2026-07].

**운영 배포 — centrafab.co.kr ([DEPLOY_CENTRAFAB](../../docs/DEPLOY_CENTRAFAB.md), Ubuntu 22.04 · nginx 단독 · Cloudflare Flexible):**

```
[방문자] → Cloudflare(SSL 종단) → 오리진 nginx :80 (centrafab-main) ─┬─ /api/     → 127.0.0.1:3333 Node/Fastify (systemd 'sp-api')
                                                                    ├─ /app/     → apps/web/dist     정적 SPA
                                                                    ├─ /market/  → apps/market/dist  정적 SPA
                                                                    ├─ /develop/ → apps/develop/dist 정적 SPA ★2026-09-05 (/rnd 블록 제거)
                                                                    └─ /         → php-fpm 8.1(unix socket) 그누보드  ※Apache 없음
                                                                       (nginx 밖) 127.0.0.1:8400 sp-engine (systemd 'sp-engine')
[dev.centrafab.co.kr] → 같은 서버, root …/samplepcb-web-platform-dev, /api→3334 (sp-api-dev), sp-engine-dev 8401, 같은 php8.1 소켓
[new.samplepcb.co.kr] → Cafe24 DNS A 레코드 직결 → nginx :443 Let's Encrypt (CF 헤더 미사용) — 같은 운영 root·3333·8400 ★2026-09-16 설계
```

- **Apache 불필요** — PHP 는 nginx + php-fpm 직결(Apache 를 끼우면 REMOTE_ADDR=127.0.0.1 이 돼 `cloudflare.check.php` https 자동감지가 깨짐). Cloudflare 경유 사이트의 https 인식은 코어 `cloudflare.check.php`(CF-Connecting-IP + X-Forwarded-Proto). **DNS 직결 사이트(new.samplepcb)는 CF 헤더가 없으므로 `fastcgi_param HTTPS on` 을 두 PHP 핸들러에 명시**하고 Node 엔 `$remote_addr`·`$scheme` 을 그대로 전달한다.
- **운영 nginx 의 정본은 서버 `/etc/nginx/`, 리포 참고본은 `ops/nginx-live/`(gitignore)**. 2026-09-05 부터 운영 반영 안내가 "런북 STEP 9 인라인 전문" 에서 **"보관본을 서버에 그대로 복사 → `./deploy.sh 7`"** 방식으로 바뀌었다(`deploy.sh` 머리말·[DEVELOP_FLOW](../../docs/DEVELOP_FLOW.md) 운영 반영 절). 보관본이 담은 `.htaccess` 번역: `= /app|/market|/develop` 무슬래시 301(슬러그 정규식보다 `=` 가 먼저라 PHP 로 안 샘) · data/ PHP 실행차단(RCE 방지)·`/data/session/` 차단 · `/spcb/lib/`·`/plugin/okname/key/` 차단 · `/spcb` 무확장 라우팅 + `HTTP_AUTHORIZATION` 패스스루(Bearer) · `/shop/quotes`·`/shop/quotes/archive`·**`/shop/eq`·`/shop/as`(끝 슬래시 유무 모두)** rewrite · 루트 짧은 URL `/슬러그` → `spcb/pages/슬러그.php`(**`if (-f …) rewrite … last`** — `try_files` 로 .php 를 찾으면 그 location 엔 fastcgi 가 없어 소스가 다운로드된다) · `fastcgi_read_timeout 420s`. 서버 공통 `nginx.conf` 는 `user samplepcb`, client/proxy/keepalive/send 타임아웃 전부 420s, `keepalive_requests 1000`, gzip.
- **new.samplepcb.co.kr 2단계 적용([samplepcb-subdomain-nginx](../../docs/samplepcb-subdomain-nginx.md))**: ① `bootstrap/new-samplepcb-http.conf` 를 `/etc/nginx/sites-enabled/new-samplepcb` 로 복사(ACME `/.well-known/acme-challenge/` 만 서빙, 나머지 503) → 외부에서 검증 파일 curl 확인 → ② `certbot certonly --webroot … --cert-name new.samplepcb.co.kr --deploy-hook 'nginx -t && systemctl reload nginx'` → ③ `sites-enabled/new-samplepcb` HTTPS 파일로 **같은 경로를 교체**(HTTP 파일을 별도 이름으로 남기지 않는다). 검증 5종: 80→301 · 443 응답 · `/api/health` JSON · `/app/` · `/data/session/` 403. 대표 주소 전환 시 운영 `.env` 의 `WEB_BASE_URL`·`SPCB_BRIDGE_URL` 만 바꾸고 `systemctl restart sp-api`; PHP `G5_DOMAIN`·`G5_HTTPS_DOMAIN`·`G5_COOKIE_DOMAIN` 은 빈 문자열 유지. `www.samplepcb.co.kr` 레거시는 기존 Cafe24 서버 그대로.
- 빌드 산출물 = `apps/{web,market,develop}/dist`·`apps/api/dist/server.js`(`pnpm -r build`, api 는 tsup `noExternal:[/^@sp\//]`). Node 는 systemd 유닛 `sp-api`(`ExecStart=/usr/bin/node --env-file=.env dist/server.js` — **시스템 node 절대경로 필수**, fnm 경로는 203/EXEC). MariaDB 는 charset utf8 + **`sql_mode=''` 영구화**(strict 면 그누보드 쓰기 실패). 초기 설치는 STEP 6 `pnpm db:seed-initial`(템플릿 상품 5종 `sp-pcb-std/sp-mask/sp-pcb-adv/sp-pcb-flex/sp-bom-parts` + 사업자정보 11필드 + 무통장 2필드, 멱등) 확인 없이는 진행 금지.
- **sp-engine systemd 유닛**([sp-engine.service](../../ops/systemd/sp-engine.service), 2026-07-20): 유저/그룹 samplepcb, `ExecStart=~/.local/bin/uv run --no-sync uvicorn parts_engine_app.main:app --host 127.0.0.1 --port 8400`(`--no-sync` = 기동 시 네트워크 의존 제거), `Restart=always`/`RestartSec=3`/`TimeoutStopSec=30`, 하드닝 `NoNewPrivileges`·`PrivateTmp`·`ProtectSystem=full`. 최초 설치는 uv → `uv sync` → `.env`(MOUSER/DIGIKEY/UNIKEYIC) → 유닛 복사+`enable --now` → `/health`. 상세는 [parts-engine](parts-engine.md).
- **재배포 = 루트 [deploy.sh](../../deploy.sh)** (운영 전용, 메뉴식 10케이스, 2026-09-11 판): 1 sp-api / 2 sp-api+DB / 3 web / 4 market / **5 풀(api+web+market+develop+DB)** / 6 sp-php(pull+php-fpm reload) / 7 nginx reload / 8 .env(sp-api 재시작) / **9 sp-develop**(구 rnd 자리) / 10 sp-engine(pull → `uv sync --frozen` → restart → `/health`). `pull` 에 **스테일 emit 정리 가드**(`clean_stale`, 옛 `vue-tsc -b` 가 src/ 에 남긴 `.js`·`.tsbuildinfo` 제거). **DB 단계는 `pnpm --filter api db:prepare --always-backup --code-ref <배포 전 HEAD>`** — 스냅샷을 먼저 남기고 미적용 migration 만 `migrate deploy`(reset/dev 금지), 이어 `develop:seed-anchor`(sp-develop 앵커 상품, 멱등). 파괴적 마이그레이션 여부를 물어 sp-api 중단/무중단 선택. 말미에 `sp-api`·`sp-engine`·`php8.1-fpm`·`nginx`·`mariadb` 상태 요약. sp-develop 첫 배포 체크리스트(스크립트 밖): 보관본 nginx 복사 → 7 · 관리자 AI 설정에서 `develop.dev-review`·`develop.dev-diagram` 켜기(기본 꺼짐) · 파일서버 serviceType `develop` 수용 확인(안 되면 `DEVELOP_FILE_SERVICE_TYPE` → 8).

**DB 스냅샷·원복 계층 ([db-snapshot-rollback](../../docs/db-snapshot-rollback.md), 2026-09-11)**: `apps/api/src/lib/db-prepare.ts` 의 `prepareDatabase` 가 MySQL advisory lock(`GET_LOCK('samplepcb-schema-<DB>', 30)`)으로 동시 실행을 직렬화하고 → 미적용 migration 목록(`_prisma_migrations` 대조) → 있으면(또는 `--always-backup`) `createDatabaseSnapshot`(라벨 `before-migration`/`before-deploy`) → `prisma migrate deploy` → Prisma 클라이언트 서명 비교 후 필요할 때만 generate. **로컬 `pnpm dev` 도 `prepare-dev.ts` 로 같은 함수를 돌린다(`localOnly` — 원격 DB 면 거부)**. 백업 위치는 리포 **밖 형제 디렉터리** `samplepcb-db-backups/`(로컬 `D:/work/workspace_other/…`, 운영 `/home/samplepcb/…`), 폴더당 `database.sql.gz`+`manifest.json`(DB·서버·시각·코드 ref·크기·SHA-256·테이블 목록, 비밀번호 없음). 덤프 클라이언트는 `mariadb-dump`/`mysqldump`, Windows 는 XAMPP 경로 폴백. 원복 `pnpm --filter api db:snapshot restore <폴더> --confirm-database samplepcb` 는 SHA-256·DB명 검증 → **복원 직전 상태를 또 백업(`before-restore`)** → DB 재생성 → 필요한 `max_allowed_packet` 사전 검사(권한 있으면 자동 증설, 없으면 변경 전 중단).

**운영 재이관 ([legacy-production-reimport](../../docs/legacy-production-reimport.md), 2026-09-16)**: 유지보수 진입은 **`centrafab-main` 을 503 서버 블록으로 잠시 교체**(원본은 `mktemp -d` 에 보관) + `systemctl stop sp-api` → `pnpm migrate:reset-data`(기본 미리보기) → `-- --yes --confirm-database samplepcb`(전체 백업+SHA-256 검증 → 원장 보관·제거 → FK 검사 조정 후 업무 행 삭제, 설정·`_prisma_migrations`·고정 결제 상품 7종 보존, `reset-report.json`) → 앵커 시드 3종 → `migrate:gate/dry/run` → `verify` → (`sync --final`) → sp-api 기동·`/api/health` 재시도 curl → nginx 원본 복원. `.env`(운영 앱)와 `.env.migration`(이관)의 DB URL 4개가 같은 타깃인지 명령이 검사한다. 마이그레이션 자체는 [gnuboard-integration](gnuboard-integration.md).

**프로토타입 정리 스크립트 ([prod-develop-cleanup.sh](../../ops/scripts/prod-develop-cleanup.sh), 2026-09-11)**: ① git — origin 갱신·main 전환·ff pull·main 외 로컬 브랜치 전부 삭제(원격은 `--delete-remote` 때만) ② DB — `develop-g-rollback.ts` dry-run → `--check` 가 `"work":true` 면 **스냅샷 먼저** 뜨고 G 테이블 3개(FK 순서)·마이그레이션 2행·설정 id=2 삭제 ③ `printf 'N\n' | ./deploy.sh 5`(무중단) ④ 검증 — `/api/health` 200·옛 `/api/admin/develop-c/*` 404·새 경로 401·유닛 상태. 로그 `~/develop-cleanup-<시각>.log` 첫머리에 이전 배포 커밋. 운영 실행 2026-09-11 17:30 KST 기록은 [develop-prototypes](../../docs/develop-prototypes.md)(G 테이블이 실제로 있었고 스냅샷 `…before-develop-g-rollback-04038b` 뒤 정리, 서비스 5개 active).

**코어 패치 가드 ([check-core-patches.sh](../../ops/scripts/check-core-patches.sh), 2026-08-05·08-17)**: `git subtree pull` 이 원본으로 덮어써 **코어 최소 수정이 충돌 경고 없이 조용히 되돌아가는 것**을 잡는다 — `assert_contains` 5건(get_member 이메일 아이디 필터 `0-9a-z_@` · orderform `G5_IS_MOBILE` · orderform.sub `sp_custom_row_it_ids_in` · orderformupdate `sp_order_cart_count_sql` pc+mobile). subtree pull 직후 필수, 새 코어 수정은 여기 한 줄 등록이 규칙([UPSTREAM_SYNC](../../docs/UPSTREAM_SYNC.md)).

**개발 검증 도구**: [shot.mjs](../../ops/scripts/shot.mjs)(2026-09-18) 는 playwright-core + 시스템 Chrome→Edge 채널 **헤드리스** 스크린샷(`--full`·`--selector`·`--scroll`·`--hover`·`--click`·`--mobile`, JSON 치수·`.sp-home` 섹션 좌표·콘솔 error/4xx 목록 출력) — 피그마 대조용이며 헤드리스라 Aside/Chrome 확장(실로그인 관찰용)과 충돌하지 않는다([FIGMA_PAGES](../../docs/FIGMA_PAGES.md)). API 하네스 `e2e-market.mts`(134항목)·`e2e-develop.mts`(181 PASS) 는 `apps/api` 에서 `tsx --env-file=.env` 로 실행, sp-node 3333·Mailpit 8025 전제, 실 LLM 유스케이스를 시작 시 끄고 끝날 때 원복. 브라우저 하네스는 [testing](testing.md).

## Talks To [coverage: high — 11 sources]

| 구성요소 | 상대 | 방식 |
|---|---|---|
| nginx edge (로컬) | sp-node(3333) · sp-vue(5173) · sp-market(5176) · sp-develop(5177) · sp-php(8888) | 경로 기반 리버스프록시, upstream keepalive + `map $http_upgrade`, `X-Forwarded-*`/`Host` 전달 |
| nginx edge (운영 `centrafab-main`) | sp-api(3333, systemd) · web/market/develop `dist/` 정적 · php-fpm unix socket | Cloudflare 뒤 :80, `X-Real-IP=$http_cf_connecting_ip`, `X-Forwarded-Proto https` 고정 |
| nginx edge (운영 `centrafab`, dev.centrafab) | sp-api-dev(3334) · `-dev` 작업트리 dist · 같은 php8.1 소켓 | 운영 서버 동거 개발 사이트, sp-engine-dev 8401 은 sp-api-dev 내부 호출 |
| nginx edge (운영 `new-samplepcb`) | Cafe24 DNS(A `new` → 원본 IP) · Let's Encrypt(certbot webroot `/var/www/letsencrypt`) · 같은 운영 root·3333 | 443 직결, `X-Real-IP=$remote_addr`·`X-Forwarded-Proto $scheme`, `fastcgi_param HTTPS on` |
| sp-node → **sp-engine** | `BOM_ENGINE_URL`(기본 `http://127.0.0.1:8400`) | 내부 HTTP 프록시(`BOM_ENGINE_TIMEOUT_MS` 기본 120s). nginx 미노출 — sp-node 가 유일한 진입점이자 인증 담당 |
| sp-node | **file.samplepcb.kr** | 서버-to-서버 업로드/다운로드/삭제 대행(`file-server.ts`), pathToken 클라이언트 미노출, serviceType 버킷별 분리 |
| sp-node | 그누보드 공유 DB `samplepcb` | `DATABASE_URL`(Prisma sp_*) + `G5_DATABASE_URL`(g5 접근 카탈로그) — [sp-node-api](sp-node-api.md) |
| sp-node → sp-php (역방향) | `SPCB_BRIDGE_URL`(**base URL**, 기본 `http://127.0.0.1:8888`) | `POST {base}/spcb/api/order-notify` 로 메일/SMS 위임(서비스 JWT, 타임아웃 10s) |
| deploy.sh · prepare-dev · cleanup | MySQL advisory lock `samplepcb-schema-<DB>` · `samplepcb-db-backups/` | 배포/기동 전 스냅샷, 동시 DB 준비 직렬화 |
| migrate:sync / reset-data (운영) | 레거시 운영 DB(읽기전용 직결, `.env.migration`) | 델타 diff · 초기화 후 전량 재이관 — 삭제/이상은 리포트만 |
| sp-php 메일 / sp-node nodemailer | **로컬 Mailpit `127.0.0.1:25`**(UI `:8025`) | config.php `G5_SMTP` SMTP 모드 · `SMTP_HOST/PORT` — 외부 0통 |
| e2e 하네스 · shot.mjs | `E2E_BASE_URL`(기본 `https://local-web…`, mkcert) · `E2E_API_URL` · `E2E_BOM_ENGINE_URL` · `E2E_MAILPIT_URL` · 시스템 Chrome/Edge | nginx(Windows 서비스) 꺼져 있으면 beforeAll 중단, 5173 직결 우회 시 `/bbs` 불가 |
| 거버 뷰어 (local-gerber) | local-web `/spcb/api/me` · `/api` | 교차 서브도메인 same-site 쿠키 전달 — 도메인와이드 PHPSESSID 충돌 재발 지점(Gotchas) |
| sp-node·sp-engine HOST 바인딩 | 127.0.0.1 (로컬·운영 공통, `HOST` env) | 공개 포트는 운영 80(CF 경유)·443(new.samplepcb)뿐 |

## API Surface [coverage: medium — 4 sources]

파일서버 `file.samplepcb.kr`(기본값, `FILE_SERVER_URL` 오버라이드): `POST /api/uploadFileByAnonymous`(multipart `serviceType`+`files` → `{ uploadFileName, originFileName, pathToken, size }`) · `GET /api/download/:pathToken`(404 는 null, content-type 미제공 시 octet-stream 보정) · `GET /api/delete/:pathToken`(404=성공, 멱등). **serviceType 버킷은 트랙마다 분리**: 거버 `gerber`(테스트 `demo`, `FILE_SERVICE_TYPE`) · BOM `bom` · 선적 서류 `bom_shipment`(`BOM_SHIPMENT_FILE_SERVICE_TYPE`) · 마켓 `market`(`MARKET_FILE_SERVICE_TYPE`) · 개발의뢰 `develop`(`DEVELOP_FILE_SERVICE_TYPE`) · PCB 협력 트랙(EQ·송금·선적·클레임·A/S 각자 상수). 파일서버가 **신규 버킷을 받는지는 운영 전 1회 실측**이 관례(market·develop 미실측).

헬스 계약 지점: sp-engine `GET /health`(deploy 10·최초 설치) · sp-api `GET /api/health`(deploy·cleanup·서브도메인 검증·재이관 재개 — `systemctl restart` 직후엔 포트가 열리기 전이라 **최대 30초 재시도**). 옛 `/api/admin/develop-c/*` 는 404, 새 `/api/admin/develop/*` 는 무토큰 401 이 정상.

sp-node 환경변수([.env.example](../../samplepcb-web-mono-app/apps/api/.env.example), 2026-08-29): `PORT`·`HOST`·`JWT_SECRET`(그누보드 `spcb/lib/secret.php` 와 수동 동기화 — 회원 JWT·서비스 JWT 공통 대칭키)·`DATABASE_URL`·`LEGACY_DATABASE_URL`·`G5_DATABASE_URL`·`G5_DATA_PATH`·`SPCB_BRIDGE_URL`·`SMTP_HOST/PORT`(+`SMTP_USER/PASS`·`MAIL_FROM`)·`ALIMTALK_ENABLED/URL/AUTH_TOKEN`·`WEB_BASE_URL`·`FILE_SERVER_URL`·`FILE_SERVICE_TYPE`·`AI_BASE_URL`·`AI_API_KEY`·`AI_ATTACHMENT_VISION_MODEL`(파일 값이 관리자 화면 저장값보다 **우선**)·`ES_NODE_URL`·`PART_INGEST_DB_CONCURRENCY`·`BOM_ENGINE_URL`·`BOM_ENGINE_TIMEOUT_MS`·`KOREAEXIM_API_KEY`·`DIGIKEY_CLIENT_ID/SECRET`·`DIGIKEY_OAUTH_REDIRECT_URI`(DigiKey 앱당 1개라 로컬/운영 환경별). sp-engine `.env`: `MOUSER_API_KEY`·`DIGIKEY_*`·`UNIKEYIC_*`·`SEARCH_SUPPLIER_CONCURRENCY=4`·`SUPPLIER_MAX_CALLS=3000`(관리자 화면 상한도 이 값을 못 넘음).

운영 명령 표면: `./deploy.sh 1–10` · `pnpm --filter api db:snapshot backup|inspect <폴더>|restore <폴더> --confirm-database <DB>|prepare` · `pnpm migrate:gate|dry|run|files|sync [--dry-run|--final]|verify|reset-data [-- --yes --confirm-database samplepcb]` · `pnpm db:seed-initial [-- --force-shop-defaults]` · `pnpm market:seed-anchor`·`develop:seed-anchor` · `bash ops/scripts/check-core-patches.sh` · `bash prod-develop-cleanup.sh [--yes|--skip-db|--skip-deploy|--deploy-case N|--delete-remote]` · `node ops/scripts/shot.mjs <url> <out.png> [옵션]`.

## Data [coverage: high — 7 sources]

- **실파일** 소유 = file.samplepcb.kr. sp-node 는 `pathToken` 만 `sp_file` 폴리모픽(ref_type/ref_id)에 보관. DB 를 비우거나 원복해도 **외부 파일은 그대로**(재이관·원복 절차 모두 파일서버 무접촉).
- **공유 DB**: sp_* 는 그누보드 DB(`samplepcb`) 동거(2026-07-03 통합). ⚠ `prisma migrate reset`/`migrate dev` 금지 — g5_* 전체 드랍. 배포도 `migrate deploy` 만(`db:prepare` 경유). charset `utf8`(utf8mb4 아님), 운영 MariaDB `sql_mode=''` 영구.
- **배포 전 스냅샷(2026-09-11~)**: 리포 밖 `samplepcb-db-backups/<ISO시각>-<label>-<hex6>/` — 라벨 `before-migration`·`before-deploy`·`before-restore`·`before-develop-g-rollback`·`manual`. 스키마·데이터·뷰·루틴·이벤트·트리거·`_prisma_migrations` 포함, 64KB INSERT 묶음+테이블별 트랜잭션. 2026-09-09 개발 DB 스냅샷 `2026-09-09T11-00-07-116Z-before-migration-148b5f`(수행관리 적용 전, **개발 PC 용 — 운영 원복엔 운영 배포가 만든 스냅샷만**). 검증 실측: 압축 143MB 백업을 별도 3344 서버에 복원, 151 테이블·회원 6,387·주문 16,349 확인.
- **재이관 보존 정책 정본** = `apps/api/src/scripts/migrate/lib/reset-data-policy.ts` — 보존: 구조·`_prisma_migrations`·사이트/쇼핑몰/사업자/결제 설정·게시판 설정·메뉴/FAQ/팝업/배너/SEO·AI 유스케이스·메일 템플릿·마켓 수수료·개발의뢰 기본 조건, 부분 보존: 고정 결제 상품 7종. 분류 안 된 테이블은 삭제하지 않고 중단. 마이그레이션 원장 `.tmp/migrate/ledger-<DB>.json`(재이관 시 초기화 명령이 백업 폴더로 보관 후 제거 — 수동 추측 삭제 금지), sync 리포트 `.tmp/migrate/sync-report-<DB>-<시각>.json`.
- **로컬 MySQL 복구 기록([local-mysql-recovery-2026-09-09](../../docs/local-mysql-recovery-2026-09-09.md))**: XAMPP MariaDB 10.4.32 의 시스템 테이블 `mysql.db`·`mysql.procs_priv`(Aria) 물리 손상 → 계정 인증은 되는데 DB 선택 1044(USAGE 뿐). 처치: 서버 중지 후 `aria_chk --recover` 로 두 테이블만 복구 → 복제본 3341(`innodb_force_recovery=0`, read_only)에서 전체 덤프 2.1GB → 새 데이터 디렉터리 3342 에 적재(296 테이블 정상·275 테이블 1,613,377행 체크섬 일치) → **`C:/xampp/mysql/data` 통째 교체**(구본 `data-before-recovery-20260909-190235` 보관), `bin/my.ini`·계정·비밀번호 무변경. 보존본 `.tmp/db-recovery-20260909-190235/`(gitignore, 회원 PII 포함 — 외부 공유 금지).
- **InnoDB buffer pool 튜닝(2026-07-24, [DB_TUNING](../../docs/DB_TUNING.md))**: `sp_bom_quote_candidate` 97,985행/1.73GB(견적 44건) 로 XAMPP 기본 16MB 는 전부 디스크 바운드(삭제 cascade 10.8초, P2028 공범) → 로컬 **16M → 1G**. 운영 사이징: DB 전용 RAM 50~70%, 웹 동거 시 최소 2G. 동반 권장 `innodb_log_file_size`(buffer pool 의 25%) 는 클린 셧다운 전제라 미적용.
- **로컬 메일 영속**: Mailpit 기본 인메모리(재시작 시 비움), `--database` 로 영속. nssm 서비스 등록(`Mailpit`)으로 부팅 자동 실행([LOCAL_MAIL_TESTING](../../docs/LOCAL_MAIL_TESTING.md)).
- 운영 영속 경로: 그누보드 `data/`(업로드·세션·`dbconfig.php`) — sp-api 실행 유저(samplepcb)가 `data/banner/` 쓰기 권한 필요. 로컬 `.env` 실측 키(2026-09): `PORT JWT_SECRET DATABASE_URL LEGACY_DATABASE_URL AI_BASE_URL AI_API_KEY KOREAEXIM_API_KEY MOUSER_ORDER_API_KEY DIGIKEY_*`.

## Key Decisions [coverage: high — 13 sources]

- **2026-09-16 — new.samplepcb.co.kr 은 Cloudflare 를 거치지 않는 DNS 직결 + Let's Encrypt**: 신규 운영 도메인을 Cafe24 DNS 의 A 레코드로 원본 IP 에 직접 붙이고(CF 프록시 IP 복사 금지) 인증서는 certbot webroot(무중단, deploy-hook reload). 같은 파일 경로를 HTTP 부트스트랩 → HTTPS 순서로 교체하는 2단계 적용. `centrafab.co.kr`·개발 도메인 설정은 유지, 레거시 `www` 는 기존 서버 계속. 대표 주소 전환은 `.env` 두 값만(PHP 도메인 상수는 계속 빈 값).
- **2026-09-16 — 운영 재이관은 "설정 보존 초기화" 전용 명령으로**: `migrate:reset-data`(미리보기 기본·전체 백업+SHA-256 검증 후에만 삭제·보존 정책 정본 파일·미분류 시 중단). `prisma migrate reset` 도, 거래 일부만 지우는 `migrate:wipe` 도 대체 수단이 아니다. 유지보수는 nginx 503 블록 교체 + sp-api 중지(php-fpm·개발 서비스는 유지). `admin` 도 레거시 정본으로 이관(증분 sync 기본 보호 대상에서 제외).
- **2026-09-11 — 배포·기동 전 DB 스냅샷을 코드로 강제**: `deploy.sh` 의 DB 단계가 `db:prepare --always-backup` 로 바뀌어 매 배포 전 원복점을 남기고, 로컬 `pnpm dev` 도 미적용 migration 이 있을 때만 스냅샷→deploy. advisory lock 으로 동시 준비 직렬화. 원복 도구는 복원 직전 상태도 백업하고 패킷 한도를 DB 변경 전에 검사한다.
- **2026-09-11 — 프로토타입 G 제거는 스크립트 한 본으로 재현 가능하게**: git 정리·DB(스냅샷 먼저)·`deploy.sh 5` 무중단·검증 4종을 `prod-develop-cleanup.sh` 로 묶고, 되돌릴 지점은 태그 `proto-gc-coexist-20260910` + 스냅샷. 운영 1차 실행에서 health curl `000` 오탐 → 30초 대기로 교정.
- **2026-09-05 — sp-develop `/develop` 편입, `/rnd` 폐지(2026-08-28)**: 네 번째 앱(`apps/develop`, 5177, `strictPort`, [sp-develop-web](sp-develop-web.md))이 rnd 의 포트·nginx 블록·`deploy.sh` 9번을 이어받음. 예약 경로 = `/app`·`/api`·`/market`·`/develop`. 운영 nginx 반영 안내가 **런북 인라인 → `ops/nginx-live` 보관본 복사** 방식으로 바뀜(정본 이동). 마이그레이션 뒤 `develop:seed-anchor` 자동.
- **2026-08-16 — nginx upstream keepalive 필수화**: `Connection "upgrade"` 고정값을 `map` 으로 갈라 HMR 만 upgrade, 나머지는 재사용 — 임시 포트 고갈 502 의 근본 처방.
- **2026-08-05 — 그누보드 코어 최소 수정은 가드 스크립트에 등록**: subtree pull 의 "조용한 되돌림" 을 `check-core-patches.sh` 가 잡는다(2026-08-17 주문서 4건 추가). 코어 수정 허용 조건이 "주석 + 가드 한 줄" 로 명문화([core-nonmodification](../concepts/core-nonmodification.md)).
- **2026-07-24 — DB 튜닝을 스키마 개선과 분리된 인프라 레버로 채택**: 후보 스냅샷 비대가 근본 원인이지만 buffer pool 증설을 즉효 조치로 선행. 온라인 리사이즈 + 설정 파일 영속화 병행(SET GLOBAL 은 재시작 시 증발).
- **2026-07-20 — sp-engine 운영 배포는 nginx 미노출 + 전용 systemd 유닛**: 무인증 엔진은 127.0.0.1:8400 강제, location 없음(인증은 sp-node). `deploy.sh` 10 신설, 유닛은 `uv run --no-sync`.
- **2026-07-20 — 운영 nginx 실설정은 `ops/nginx-live/` 스냅샷으로만 참고**: gitignore, 정본은 서버 `/etc/nginx/`. 로컬 스니펫과 같은 "리포는 참고본, 정본은 바깥" 원칙 — 2026-09-05 부터는 이 보관본이 운영 반영의 복사 원본이기도 하다.
- **2026-07-17 — sp-rnd 독립 R&D Vue 앱 + `/rnd` 예약 경로 신설** → **2026-08-28 폐지**(`apps/rnd` 삭제). 위 2026-09-05 항목이 자리를 이었다.
- **2026-07-11 — deploy.sh pull 단계 스테일 emit 정리 가드**: 빌드 스크립트는 `--noEmit` 으로 교정됐지만 서버 작업트리 잔재는 pull 이 못 지우므로 배포 스크립트가 방어.
- **2026-07 — 운영은 Docker 없이 native**(nginx+php-fpm 직결, Apache 없음, systemd sp-api/sp-engine, 정적 dist). Docker compose 는 여전히 "예정" 트랙[as of 2026-07].
- **2026-07 — Cloudflare Flexible 로 SSL 종단**(centrafab): 오리진 :80, https 인식은 `cloudflare.check.php`. Full(strict) 승격 권장. new.samplepcb 는 이 결정 밖(직결 443).
- **2026-07-08 — 재능마켓은 별도 Vue 앱 + `/market` 예약 경로**([sp-market-web](sp-market-web.md)); sp-vue 는 관리자 전용 유지.
- **2026-07-06 — 택배(CJ) API 연동은 조사만, 채택 보류**([DELIVERY_CARRIER_INTEGRATION](../../docs/DELIVERY_CARRIER_INTEGRATION.md)): 송장 발급은 굿스플로, 추적·자동완료는 딜리버리트래커/스마트택배 후보. CJ 계약·라벨 프린터·물량 확정 전엔 수동 3필드+엑셀 유지.
- **같은 도메인 경로 분기**(도메인 분리 대신): PHPSESSID 공유 → 인증 브리지가 CORS/서드파티쿠키 문제 없이 성립. **레퍼런스 스니펫 방식**: 실구동 conf 는 repo 밖. **파일 업로드 대행**: 서버-to-서버, 하드 삭제는 실파일 먼저 → DB, 404 는 성공. **메일은 코어 SMTP 모드에 종속**: 로컬은 25번 무인증 SMTP(Mailpit), 운영은 인증형 릴레이/`mail_options` 커스텀 필요. **코어 비수정**: `G5_DOMAIN=''`, 로컬 https 는 `proxy_fix.php`.

## Gotchas [coverage: high — 12 sources]

- **운영 nginx 의 "정본" 이 문서상 두 곳**([manual-sync-drift](../concepts/manual-sync-drift.md)): 런북 STEP 9 인라인 전문은 2026-07 판(`/rnd` 블록 잔존·`/develop` 없음·`/shop/eq|as` rewrite 없음·슬러그를 `try_files` 로 찾아 **PHP 소스 다운로드 함정**)이고, `deploy.sh` 머리말·DEVELOP_FLOW 가 가리키는 `ops/nginx-live/sites-enabled/centrafab-main` 이 신판이다. 런북 §0 구조도도 `/rnd` 그대로. 서버에 올릴 땐 보관본을 쓰고, 보관본은 gitignore 라 **클론만으로는 없다**(서버 `/etc/nginx` 에서 다시 복사).
- **`SPCB_BRIDGE_URL` 런북 값이 코드 관례와 어긋난다**: 런북 STEP 5 는 `https://centrafab.co.kr/spcb/api/me` 로 적혀 있는데 `php-bridge.ts` 는 이 값을 **base** 로 보고 `/spcb/api/order-notify` 를 뒤에 붙인다(`.env.example`·서브도메인 문서는 base 만). 런북대로 넣으면 알림 브리지 경로가 `/spcb/api/me/spcb/api/order-notify` 가 된다 — 확인 필요.
- **`ops/README.md` 는 2026-07-20 판**: "현재" 절이 4경로(`/develop` 없음), `deploy.sh 9` 를 R&D 로 기술. AGENTS.md 는 `/develop` 반영됐으나 "배포(Docker, 예정)" 절은 그대로. 문서 부분 갱신 상태.
- **`deploy.sh` 풀 재배포(5)에 sp-engine 이 없다** — 엔진 코드가 바뀐 배포는 `./deploy.sh 10` 을 따로. 또 **일반 재배포는 `db:seed-initial` 을 자동 실행하지 않는다** — `TEMPLATE_ITEMS` 가 바뀐 배포 뒤엔 STEP 6 시드를 손으로(누락 시 BOM 주문 `TEMPLATE_ITEM_MISSING`). `develop:seed-anchor` 만 2·5 에 자동.
- **`systemctl restart sp-api` 는 포트가 열리기 전에 돌아온다** — 직후 curl 은 `000`(2026-09-11 운영 1차 실행 오탐). `/api/health` 는 30초 재시도(cleanup 스크립트·재이관 절차 `--retry-connrefused`).
- **DB 원복은 전체를 되돌린다**: 회원·주문 포함 백업 시점으로, 결제사 실결제·발송 메일은 취소 안 됨. 복원 중 쓰기 서비스는 도구가 안 멈추므로 **먼저 API·PHP 를 멈춰야** 한다. 로컬 `max_allowed_packet` 1MB 한도에선 대형 BOM 행 복원이 막힌다 — `SET GLOBAL max_allowed_packet=268435456`(런타임 값, `.env` 아님). 스냅샷 코드 ref 는 배포 시작 HEAD 라 복원할 코드는 실제 이전 배포 버전으로 고른다.
- **`aria_chk` 는 실행 중인 서버 파일에 쓰면 안 된다**(중지 후 별도 복사본에서 먼저 시험). 강제 복구 모드는 추출 수단이지 파일을 고치지 않는다 — 2026-09-09 는 정상 모드 덤프로 해결, `innodb_force_recovery` 를 남기지 않았다.
- **`my.ini` 는 두 벌이고 로드되는 건 `bin` 쪽** — XAMPP mysqld 가 `--defaults-file="c:\xampp\mysql\bin\my.ini"`. `data\my.ini` 에 고치면 "안 먹는" 증상.
- **buffer pool 온라인 리사이즈 제약**: `innodb_buffer_pool_chunk_size`(128M)×instances 의 배수(1G/2G 안전), `Innodb_buffer_pool_resize_status` 가 Completed 될 때까지, SUPER 권한.
- **로컬 nginx 는 Windows 서비스라 reload 불가** — 관리자 `net stop nginx & net start nginx`. e2e 는 nginx 꺼져 있으면 beforeAll 중단, `E2E_BASE_URL=http://127.0.0.1:5173` 우회는 `/bbs` 검증 불가.
- **여정 연속 실행 502 = 프록시 문제**: 임시 포트 고갈(keepalive 미적용 conf). 증상이 테스트마다 떠돌고 리포트 `## HTTP ≥400` 에 502 무더기. 라이브 `D:\nginx\conf\nginx.conf` 에 `map`+`keepalive` 가 실제로 반영됐는지부터.
- **Vite `host` 기본값 함정**: `localhost` 는 Windows 에서 IPv6 만 열려 nginx IPv4 프록시 502 — 모든 앱 `host: '127.0.0.1'`. sp-develop 은 `strictPort` 라 5177 점유 시 기동 실패가 정상(조용히 밀리면 `/develop` 이 끊긴다).
- **로컬 dev 쿠키 도메인 충돌 재발(2026-08-13, [PCB_PARTNER_TRACK](../../docs/PCB_PARTNER_TRACK.md))**: 거버 devServer 가 심는 도메인와이드 `.samplepcb.co.kr` PHPSESSID 가 host-only 쿠키와 공존하면 **g5 로그인이 성공해도 `/spcb/api/me` 가 401** → 포털이 익명으로 굴러떨어진다. 근본책(`cookieDomainRewrite`)이 있어도 재발 — 증상 보이면 그 도메인 쿠키부터 삭제.
- **new.samplepcb 적용 순서 함정**: 인증서 없이 HTTPS 파일을 먼저 올리면 nginx -t 실패. HTTP 부트스트랩을 별도 이름으로 남겨 두면 두 서버 블록이 겹친다 — 같은 `sites-enabled/new-samplepcb` 를 교체. 최종 HTTP 블록의 ACME location 을 지우면 webroot 갱신이 죽는다. `dig centrafab.co.kr` 로 IP 를 복사하면 Cloudflare IP 일 수 있다. 서버 공통 `nginx.conf` 의 `ssl_protocols` 에 TLSv1/1.1 이 남아 있어 `new-samplepcb` 는 서버 블록에서 1.2/1.3 으로 덮는다.
- **운영 서버는 공유 호스트**: 같은 `/etc/nginx/sites-enabled` 에 easypcb.co.kr 계열·개발 사이트(`dev.centrafab`, 3334/8401, `-dev` 작업트리·`samplepcb_dev` DB)가 동거. 재이관·정리 절차는 `-dev` 자원을 건드리지 않는다고 명시하지만 `php8.1-fpm` 은 공용이라 통째 재시작이 개발 사이트도 끊는다.
- **systemd 함정 3종**: ① `ExecStart` 는 `/usr/bin/node` 절대경로(fnm 경로 203/EXEC) ② `.env` 변경 후 `systemctl restart sp-api` 필수 ③ php-fpm 소켓 소유자를 nginx 유저(samplepcb)로 안 맞추면 502(13: Permission denied). ⚠ **sp-engine 은 무인증** — 127.0.0.1 바인딩 절대 유지, 엔진 `.env` 는 서버에서 직접.
- **pnpm 필터명은 스코프 없음** — `--filter api`·`web`·`market`·`develop`(`@sp/api` 아님). sp-engine 은 uv workspace 라 필터 대상이 아니다. **strict sql_mode 면 그누보드 쓰기 실패**(1364) — `sql_mode=''` 즉시+영구.
- ⚠ **파일서버 delete 무인증 GET**: pathToken 유출 시 임의 삭제 가능(내부망 제한·서버 간 인증 미처리 과제). 한 요청 복수 파일 불가 — 파일당 1요청 순차. 신규 serviceType 버킷(`market`·`develop`)은 운영 전 수용 실측 미완.
- **로컬 메일 안 옴**: `127.0.0.1:25` 에 Mailpit 없으면 `error.log` 에 `SMTP connect() failed` 만 남고 조용히 실패(코어가 반환값 미검사, 브리지는 `sent` 응답). **알림 브리지 실패는 삼켜진다**(타임아웃 10s, 'failed' 로 전이 성공 불변) — access.log 의 `POST /spcb/api/order-notify`·JWT 시크릿 정합부터.
- **재이관 시 원장**: `migrate:run` 재실행은 원장 삭제가 전제지만 `reset-data` 가 보관·제거를 대신하니 수동 추측 삭제 금지; `migrate:sync` 는 원장 무시. 컷오버 전 신규 플랫폼에서 바꾼 데이터는 다음 sync 가 레거시 기준으로 원복. `.env`/`.env.migration` 의 `localhost`↔`127.0.0.1` 표기를 섞으면 타깃 일치 검사가 실패.
- **check-core-patches 는 subtree pull 뒤에만 의미** — CI/pre-commit 에 안 걸려 있어 사람이 돌려야 한다. `shot.mjs --full` 은 `loading="lazy"` 이미지가 빈 상자 — 뷰포트+`--scroll` 로 다시. 이 PC 엔 python·ImageMagick·ffmpeg 가 없어 이미지 가공도 헤드리스 Edge 캔버스로.
- location 순서: 구체 경로를 catch-all 보다 먼저 두지 않으면 `/api`·`/app`·`/market`·`/develop` 가 PHP 로 흘러간다. 무슬래시 `= /develop` 301 은 슬러그 정규식보다 앞에 있어야 한다.

## Sources [coverage: high — 40 sources]

- [ops/README.md](../../ops/README.md) — 예약 경로·Windows 서비스·nginx-live·sp-engine 유닛(2026-07-20 판, `/develop` 미반영)
- [ops/nginx/local-web.conf](../../ops/nginx/local-web.conf) — 로컬 4경로 스니펫, upstream keepalive·map(2026-08-16), `/develop` 5177(2026-09-05), `/rnd` 폐지 주석
- [ops/nginx-live/sites-enabled/centrafab-main](../../ops/nginx-live/sites-enabled/centrafab-main) — 운영 centrafab.co.kr 실설정 스냅샷(gitignore, 2026-09-16 복사본)
- [ops/nginx-live/sites-enabled/centrafab](../../ops/nginx-live/sites-enabled/centrafab) — dev.centrafab.co.kr(sp-api-dev 3334·sp-engine-dev 8401·`-dev` 작업트리)
- [ops/nginx-live/sites-enabled/new-samplepcb](../../ops/nginx-live/sites-enabled/new-samplepcb) — new.samplepcb.co.kr HTTPS(Let's Encrypt·`HTTPS on`·독립 map)
- [ops/nginx-live/bootstrap/new-samplepcb-http.conf](../../ops/nginx-live/bootstrap/new-samplepcb-http.conf) — 인증서 최초 발급용 HTTP(ACME 만, 나머지 503)
- [ops/nginx-live/nginx.conf](../../ops/nginx-live/nginx.conf) — 서버 공통 http{}(user samplepcb·420s 타임아웃·100M·ssl_protocols)
- [ops/systemd/sp-engine.service](../../ops/systemd/sp-engine.service) — sp-engine 유닛(uv run --no-sync·127.0.0.1:8400·하드닝·설치 절차)
- [ops/scripts/check-core-patches.sh](../../ops/scripts/check-core-patches.sh) — 코어 최소 수정 가드 5 assert(2026-08-05·08-17)
- [ops/scripts/prod-develop-cleanup.sh](../../ops/scripts/prod-develop-cleanup.sh) — 운영 프로토타입 G 정리 4단계(2026-09-11)
- [ops/scripts/shot.mjs](../../ops/scripts/shot.mjs) — 헤드리스 스크린샷 헬퍼(2026-09-18)
- [ops/scripts/e2e-develop.mts](../../ops/scripts/e2e-develop.mts) — 개발의뢰 API 하네스(sp-node 3333·Mailpit 전제)
- [ops/scripts/e2e-market.mts](../../ops/scripts/e2e-market.mts) — 재능마켓 API 하네스 134항목
- [deploy.sh](../../deploy.sh) — 운영 재배포 10케이스(5 에 develop·9=develop·db:prepare 스냅샷·seed_develop, 2026-09-11)
- [docs/DEPLOY_CENTRAFAB.md](../../docs/DEPLOY_CENTRAFAB.md) — centrafab 런북(STEP 4 admin 정책 2026-09-16·STEP 6 시드·STEP 9 인라인 nginx 구판·STEP 11 재이관 링크)
- [docs/samplepcb-subdomain-nginx.md](../../docs/samplepcb-subdomain-nginx.md) — new.samplepcb.co.kr DNS 직결·certbot 2단계 절차(2026-09-16, 미커밋 untracked)
- [docs/db-snapshot-rollback.md](../../docs/db-snapshot-rollback.md) — 배포 전 스냅샷·전체 원복 절차·검증(2026-09-11)
- [docs/local-mysql-recovery-2026-09-09.md](../../docs/local-mysql-recovery-2026-09-09.md) — XAMPP MariaDB 시스템 테이블 손상 복구 기록
- [docs/legacy-production-reimport.md](../../docs/legacy-production-reimport.md) — 운영 DB 초기화·재이관(유지보수 503·reset-data·시드·검증, 2026-09-16)
- [docs/develop-prototypes.md](../../docs/develop-prototypes.md) — G/C 정리·운영 실행 기록(2026-09-11)·태그
- [docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) — 운영 반영 절(보관본 nginx 복사·serviceType develop)
- [docs/DB_TUNING.md](../../docs/DB_TUNING.md) — InnoDB buffer pool 16M→1G·운영 사이징(2026-07-24)
- [docs/LOCAL_MAIL_TESTING.md](../../docs/LOCAL_MAIL_TESTING.md) — Mailpit·SMTP 모드·nssm·발송 경로
- [docs/DELIVERY_CARRIER_INTEGRATION.md](../../docs/DELIVERY_CARRIER_INTEGRATION.md) — 택배 API 조사·보류(2026-07-06)
- [docs/UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md) — 코어 수정 시 가드 등록 규칙
- [docs/FIGMA_PAGES.md](../../docs/FIGMA_PAGES.md) — shot.mjs 사용법·lazy 이미지 함정
- [docs/PCB_PARTNER_TRACK.md](../../docs/PCB_PARTNER_TRACK.md) — 도메인와이드 PHPSESSID 재발 실측(2026-08-13)
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 파일서버 대행·pathToken(2026-07 컴파일 시 기여)
- [AGENTS.md](../../AGENTS.md) — sp-develop 별칭·예약 경로 4종·통합 라우팅·인증 브리지(2026-09-05)
- [CLAUDE.md](../../CLAUDE.md) — 통합 요약
- [samplepcb-web-mono-app/e2e/README.md](../../samplepcb-web-mono-app/e2e/README.md) — E2E_* 환경 변수·mkcert·keepalive 함정·Mailpit 기준선
- [samplepcb-web-mono-app/apps/api/.env.example](../../samplepcb-web-mono-app/apps/api/.env.example) — sp-node 환경변수 전체(2026-08-29)
- [samplepcb-parts-engine/.env.example](../../samplepcb-parts-engine/.env.example) — 공급사 키·동시성·호출 상한
- [samplepcb-web-mono-app/apps/api/package.json](../../samplepcb-web-mono-app/apps/api/package.json) — db:prepare·db:snapshot·migrate:*·seed 스크립트
- [samplepcb-web-mono-app/apps/api/src/lib/db-prepare.ts](../../samplepcb-web-mono-app/apps/api/src/lib/db-prepare.ts) — advisory lock·미적용 migration·스냅샷→deploy
- [samplepcb-web-mono-app/apps/api/src/lib/db-snapshot.ts](../../samplepcb-web-mono-app/apps/api/src/lib/db-snapshot.ts) — 백업 폴더·manifest·restore·max_allowed_packet
- [samplepcb-web-mono-app/apps/api/src/lib/file-server.ts](../../samplepcb-web-mono-app/apps/api/src/lib/file-server.ts) — 파일서버 3 엔드포인트·serviceType 기본 gerber
- [samplepcb-web-mono-app/apps/api/src/lib/php-bridge.ts](../../samplepcb-web-mono-app/apps/api/src/lib/php-bridge.ts) — `SPCB_BRIDGE_URL` base + `/spcb/api/order-notify`
- [samplepcb-web-mono-app/apps/develop/vite.config.ts](../../samplepcb-web-mono-app/apps/develop/vite.config.ts) — base '/develop/'·5177·strictPort·host 127.0.0.1
- [samplepcb-web-mono-app/apps/web/vite.config.ts](../../samplepcb-web-mono-app/apps/web/vite.config.ts) — host 127.0.0.1(IPv6 함정)·allowedHosts·/api·/spcb 프록시
