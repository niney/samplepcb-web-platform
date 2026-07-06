---
topic: infrastructure
last_compiled: 2026-07-06
sources_count: 8
status: active
---

# infrastructure

## Purpose [coverage: high — 5 sources]

samplepcb 웹 플랫폼의 로컬/운영 라우팅·인프라 계층. 두 코드 영역(sp-php = 그누보드5/영카트 `samplepcb-web/`, sp-vue·sp-node = `samplepcb-web-mono-app/`)을 **같은 도메인**에서 함께 돌리는 것이 핵심 목표다 — 같은 도메인이어야 PHPSESSID 쿠키가 공유되어 인증 브리지(그누보드=IdP)가 성립한다. **모노레포가 가동 중이라 `/`·`/app`·`/api` 3경로가 모두 동작한다**(이전 "예정" 상태 아님). 인프라 설정은 메타 repo 가 추적하는 `ops/` 폴더에, 실파일 저장은 외부 파일서버 `file.samplepcb.kr` 에 위임한다.

## Architecture [coverage: high — 5 sources]

**통합 호스트 `local-web.samplepcb.co.kr` — nginx 443 리버스프록시, 경로 분기:**

```
/api/  → 127.0.0.1:3333  Node (Fastify)      ← samplepcb-web-mono-app/apps/api  (sp-node)
/app/  → 127.0.0.1:5173  Vue (Vite dev+HMR)  ← samplepcb-web-mono-app/apps/web  (sp-vue, base:'/app/')
/      → 127.0.0.1:8888  PHP (XAMPP Apache)  ← samplepcb-web (그누보드/영카트)   ← 루트=PHP
```

- location 순서 규칙: 구체 경로(`/api`·`/app`)를 먼저, catch-all `/`을 마지막에. `/app`·`/api`는 그누보드가 점유하지 않는 **예약 경로**. `/spcb`(인증·알림 브리지)는 별도 location 없이 catch-all 로 PHP 가 처리.
- **설정 파일 이원화 (중요)**: 실제 구동 config 는 `D:\nginx\conf\nginx.conf`(repo **밖**, 로컬 머신). `ops/nginx/local-web.conf` 는 repo 가 추적하는 **레퍼런스 스니펫**으로 라이브와 동일 구조(라이브 `/app`엔 `X-Forwarded-Proto` 한 줄 추가). 80 포트는 https 301, 와일드카드 인증서 `_wildcard.samplepcb.co.kr`, `client_max_body_size 100M`.
- `/app`은 dev(Vite 프록시 + WebSocket Upgrade HMR)와 운영(빌드 `dist/` alias + `try_files … /app/index.html` SPA fallback) 블록 중 **택1** — 운영 블록은 스니펫에 주석으로 준비돼 있다.
- 라이브 nginx 부가 호스트(repo 미추적): `local`·`local-www`→5173(Vue 단독 프리뷰), `local2`·`local3`→5174·5175(git worktree 병렬 dev). **통합 라우팅이 살아있는 건 `local-web` 하나뿐** — 나머지는 `/` 전체가 Vue.
- HTTPS/도메인 독립성: `G5_DOMAIN=''` + `g5_path()`가 `HTTP_HOST` 를 쓰므로 nginx 가 `Host $host` 만 전달하면 운영 도메인이 달라도 무관. 프록시 뒤 https 인식은 `proxy_fix.php`(php.ini `auto_prepend_file`).

**배포(예정)**: `ops/docker-compose.yml` — `web`(php+apache)·`api`(node/fastify)·`db`(mariadb)·`edge`(nginx) 4컨테이너를 운영 host nginx 뒤 단일 포트로 노출. 영속 볼륨 필수: 그누보드 `data/`(업로드·세션·`dbconfig.php`)와 mariadb. PHP 이미지 확장: gd·mysqli·mbstring·exif·fileinfo·curl·openssl·zip. `dev.sh`·`deploy.sh` 예정.

## Talks To [coverage: high — 6 sources]

| 구성요소 | 상대 | 방식 |
|---|---|---|
| nginx edge | sp-node(3333) · sp-vue(5173) · sp-php(8888) | 경로 기반 리버스프록시, `X-Forwarded-*`/`Host` 전달 |
| sp-node | **file.samplepcb.kr** | 서버-to-서버 업로드/다운로드/삭제 대행(`file-server.ts`), pathToken 클라이언트 미노출 |
| sp-node | 그누보드 공유 DB `samplepcb` | `DATABASE_URL`(Prisma sp_*) + `G5_DATABASE_URL`(g5 접근 카탈로그, mysql2) |
| **sp-node → sp-php (신규 역방향 서버 호출)** | `SPCB_BRIDGE_URL` (`http://127.0.0.1:8888`) | 주문 상태 전이 시 `POST /spcb/api/order-notify` 로 메일/SMS 위임(서비스 JWT). 기존 PHP→Node(JWT 인증)에 더해 **양방향 서버 통신** 성립 |
| sp-php 메일 | **로컬 Mailpit `127.0.0.1:25`** | config.php `G5_SMTP` SMTP 모드 — `mailer.lib.php`→PHPMailer(IsSMTP)→25번. Mailpit 이 가로채 웹 UI(`:8025`). XAMPP mailtodisk 는 안 통함 |
| 거버 뷰어 (local-gerber) | local-web `/spcb/api/me` · `/api` | 교차 서브도메인 same-site 쿠키 전달, me.php `*.samplepcb.co.kr` 오리진 CORS 반사 |
| sp-node HOST 바인딩 | 127.0.0.1 (기본) | nginx 가 같은 호스트에서 프록시 — 외부 바인딩 필요시에만 0.0.0.0 |

## API Surface [coverage: medium — 3 sources]

파일서버 `file.samplepcb.kr` (기본값, `FILE_SERVER_URL` 오버라이드):

- `POST /api/uploadFileByAnonymous` — multipart(`serviceType`, `files`). 응답 `{ data: [{ uploadFileName, originFileName, pathToken, size }] }`. `serviceType` 운영 `gerber`/테스트 `demo`(`FILE_SERVICE_TYPE`).
- `GET /api/download/:pathToken` — 실파일 다운로드(썸네일 프록시용). 404 는 null, content-type 미제공 시 octet-stream 보정.
- `GET /api/delete/:pathToken` — 실파일 삭제. 404(이미 없음)는 성공 → 재시도 멱등.

sp-node 환경변수(`apps/api/.env.example`): `PORT`·`HOST`·`JWT_SECRET`(그누보드 `spcb/lib/secret.php` 와 수동 동기화 — **회원 JWT·서비스 JWT 공통 대칭키**)·`DATABASE_URL`·`LEGACY_DATABASE_URL`(읽기 전용)·`G5_DATABASE_URL`·**`SPCB_BRIDGE_URL`**(알림 브리지 대상)·`WEB_BASE_URL`(기본 `https://local-web.samplepcb.co.kr`)·`FILE_SERVER_URL`·`FILE_SERVICE_TYPE`.

## Data [coverage: medium — 4 sources]

- **실파일** 소유 = file.samplepcb.kr. sp-node 는 `pathToken` 만 `sp_file`(ref_type='sp_order_spec')에 보관. 다운로드 접근 보안은 추후 과제.
- **공유 DB**: sp_* 는 그누보드 DB(`samplepcb`) 동거(2026-07-03 통합). ⚠ `prisma migrate reset`/`migrate dev` 금지 — g5_* 전체 드랍/전체 reset 요구.
- DB charset = `utf8`(utf8mb4 아님).
- **로컬 메일 영속**: Mailpit 기본 인메모리(재시작 시 비움). `--database` 로 영속 가능. nssm 서비스 등록으로 부팅 자동 실행(`docs/LOCAL_MAIL_TESTING.md`).
- Docker 전환 시 영속 볼륨: 그누보드 `data/`, mariadb.

## Key Decisions [coverage: high — 5 sources]

- **같은 도메인 경로 분기** (도메인 분리 대신): PHPSESSID 공유 → 인증 브리지가 CORS/서드파티쿠키 문제 없이 성립. `/app`·`/api` 를 예약 경로로 확보.
- **레퍼런스 스니펫 방식**: 실구동 nginx.conf 는 repo 밖, `ops/nginx/local-web.conf` 를 라이브 동일 반영 추적본으로 유지.
- **파일 업로드 대행**: sp-node 서버-to-서버 대행(pathToken 클라이언트 미노출). 업로드 실패 시 담기 트랜잭션 중단.
- **하드 삭제 순서**: 실파일 먼저 → DB 파기. 404 는 성공 취급으로 멱등.
- **메일은 인프라가 아니라 코어 SMTP 모드에 종속** — config.php `G5_SMTP=127.0.0.1:25` 를 코어 비수정으로 유지하므로, 로컬은 25번에 인증 없는 SMTP(Mailpit)를 맞춘다(포트를 코어에 맞추는 게 아니라 서버를 25에 맞춘다). 운영은 인증형 릴레이/`mail_options` 이벤트 커스텀 필요.
- **파일 삭제 API 보안은 후속 트랙**: 2026-07 결정 — 기능 먼저, 접근 제한은 인프라 트랙 후속.
- 코어 비수정: `G5_DOMAIN=''` 유지, https 는 `proxy_fix.php` auto_prepend.

## Gotchas [coverage: high — 5 sources]

- ⚠ **파일서버 delete 무인증 GET**: pathToken 유출 시 임의 파일 삭제 가능. 내부망 제한/서버 간 인증 미처리 과제.
- **파일서버는 한 요청 복수 파일 처리 못 함**(2개 전송 시 서버 오류) — `file-server.ts` 가 파일당 1요청 순차 전송.
- **로컬 메일 안 옴**: `127.0.0.1:25` 에 Mailpit 안 떠 있으면 `error.log` 에 `SMTP connect() failed` 만 남고 조용히 실패(코어가 반환값 미검사). `netstat -ano | findstr :25` 확인. 브리지는 `sent` 라도 실발송 실패 가능.
- **알림 브리지 실패는 삼켜짐** — `notifyOrderEvent` 타임아웃 10s, 실패는 'failed' 로 전이 성공 불변. 발송 안 되면 access.log 의 `POST /spcb/api/order-notify` 기록·JWT 시크릿 정합부터 확인.
- **레퍼런스 스니펫 ≠ 라이브 그대로**: 라이브 `/app` 엔 `X-Forwarded-Proto` 한 줄 더, 부가 호스트(local·local2·local3)는 repo 미추적.
- **통합 라우팅은 local-web 하나뿐** — `local.samplepcb.co.kr` 등은 `/` 전부 Vue라 PHP·`/api` 없음.
- **로컬 dev 쿠키 도메인 충돌**: 거버 webpack devServer 가 운영 www 로 프록시하며 도메인와이드 PHPSESSID 를 심으면 host-only PHPSESSID 와 공존해 재로그인 실패 — 근본책은 거버 프록시 `cookieDomainRewrite`.
- **운영 전환 미완**: 거버 prod 분기·운영 nginx `/api` 반영·`/app` static 블록 주석 상태(체크리스트는 로컬 HANDOFF.md).
- location 순서: 구체 경로를 catch-all 보다 먼저 두지 않으면 `/api`·`/app` 이 PHP 로 흘러간다.

## Sources [coverage: high — 8 sources]

- [ops/README.md](../../ops/README.md)
- [ops/nginx/local-web.conf](../../ops/nginx/local-web.conf)
- [docs/LOCAL_MAIL_TESTING.md](../../docs/LOCAL_MAIL_TESTING.md) — Mailpit·SMTP 모드·발송 경로
- [AGENTS.md](../../AGENTS.md)
- [CLAUDE.md](../../CLAUDE.md)
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md)
- [samplepcb-web-mono-app/apps/api/.env.example](../../samplepcb-web-mono-app/apps/api/.env.example) — SPCB_BRIDGE_URL·파일서버·공유 DB
- [samplepcb-web-mono-app/apps/api/src/lib/file-server.ts](../../samplepcb-web-mono-app/apps/api/src/lib/file-server.ts)
