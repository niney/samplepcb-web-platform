---
topic: infrastructure
last_compiled: 2026-07-03
sources_count: 7
status: active
---

# infrastructure

## Purpose [coverage: high — 5 sources]

samplepcb 웹 플랫폼의 로컬/운영 라우팅·인프라 계층. 두 코드 영역(sp-php = 그누보드5/영카트 `samplepcb-web/`, sp-vue·sp-node = `samplepcb-web-mono-app/`)을 **같은 도메인**에서 함께 돌리는 것이 핵심 목표다 — 같은 도메인이어야 PHPSESSID 쿠키가 공유되어 인증 브리지(그누보드=IdP)가 성립한다. 인프라 설정은 메타 repo가 추적하는 `ops/` 폴더에 있고, 실파일 저장은 외부 파일서버 `file.samplepcb.kr`에 위임한다.

## Architecture [coverage: high — 5 sources]

**통합 호스트 `local-web.samplepcb.co.kr` — nginx 443 리버스프록시, 경로 분기:**

```
/api/  → 127.0.0.1:3000  Node (Fastify)      ← samplepcb-web-mono-app/apps/api  (sp-node)
/app/  → 127.0.0.1:5173  Vue (Vite dev+HMR)  ← samplepcb-web-mono-app/apps/web  (sp-vue, base:'/app/')
/      → 127.0.0.1:8888  PHP (XAMPP Apache)  ← samplepcb-web (그누보드/영카트)   ← 루트=PHP
```

- location 순서 규칙: 구체 경로(`/api`·`/app`)를 먼저, catch-all `/`을 마지막에. `/app`·`/api`는 그누보드가 점유하지 않는 **예약 경로**. `/spcb`(인증 브리지)는 별도 location 없이 catch-all로 흘러 PHP가 처리한다.
- **설정 파일 이원화 (중요)**: 실제 구동 config는 `D:\nginx\conf\nginx.conf`(repo **밖**, 로컬 머신). `ops/nginx/local-web.conf`는 repo가 추적하는 **레퍼런스 스니펫**으로 라이브와 동일 구조(라이브 `/app`엔 `X-Forwarded-Proto` 한 줄 추가). 80 포트는 https로 301 리다이렉트, 와일드카드 인증서 `_wildcard.samplepcb.co.kr`, `client_max_body_size 100M`.
- `/app`은 dev(Vite 프록시 + WebSocket Upgrade 헤더로 HMR)와 운영(빌드 `dist/` alias + `try_files ... /app/index.html` SPA fallback) 블록 중 **택1** — 운영 블록은 스니펫에 주석으로 준비돼 있다.
- 라이브 nginx의 개발 편의용 부가 호스트(repo 미추적): `local`·`local-www`→5173(Vue 단독 프리뷰), `local2`·`local3`→5174·5175(git worktree 병렬 dev). **통합 라우팅이 살아있는 건 `local-web` 하나뿐** — 나머지는 `/` 전체가 Vue.
- HTTPS/도메인 독립성: `G5_DOMAIN=''` + `g5_path()`가 `HTTP_HOST`를 쓰므로 nginx가 `Host $host`만 전달하면 운영 도메인이 달라도 무관. 프록시 뒤 https 인식은 `proxy_fix.php`(php.ini `auto_prepend_file`)가 `$_SERVER['HTTPS']='on'`을 주입 — 이중 nginx면 두 단 모두 `X-Forwarded-Proto`/`Host` 전달 필요.

**배포(예정)**: `ops/docker-compose.yml` — `web`(php+apache)·`api`(node/fastify)·`db`(mariadb)·`edge`(nginx) 4컨테이너를 운영 host nginx 뒤 단일 포트로 노출. 영속 볼륨 필수: 그누보드 `data/`(업로드·세션·`dbconfig.php`)와 mariadb 데이터. PHP 이미지 확장: gd(jpeg/freetype)·mysqli·mbstring·exif·fileinfo·curl·openssl·zip. `dev.sh`(로컬 전체 스택 기동)·`deploy.sh`도 예정.

## Talks To [coverage: high — 5 sources]

| 구성요소 | 상대 | 방식 |
|---|---|---|
| nginx edge | sp-node(3000) · sp-vue(5173) · sp-php(8888) | 경로 기반 리버스프록시, `X-Forwarded-*`/`Host` 전달 |
| sp-node | **file.samplepcb.kr** | 서버-to-서버 업로드/다운로드/삭제 대행 (`apps/api/src/lib/file-server.ts`), pathToken은 클라이언트 미노출 |
| sp-node | 그누보드 공유 DB `samplepcb` | `DATABASE_URL` — sp_* 테이블(Prisma 소유)이 g5_*와 동거 |
| 거버 뷰어 (local-gerber, 별도 repo) | local-web `/spcb/api/me` · `/api` | 교차 서브도메인이지만 same-site라 쿠키 전달, me.php가 `*.samplepcb.co.kr` 오리진 CORS 반사 허용 |
| sp-node HOST 바인딩 | 127.0.0.1 (기본, 권장) | nginx가 같은 호스트에서 프록시 — 컨테이너 등 외부 바인딩 필요시에만 0.0.0.0 |

## API Surface [coverage: medium — 3 sources]

파일서버 `file.samplepcb.kr` (기본값, `FILE_SERVER_URL`로 오버라이드):

- `POST /api/uploadFileByAnonymous` — multipart(`serviceType`, `files`). 응답 `{ result, data: [{ uploadFileName, originFileName, pathToken, size }] }`. `serviceType`은 운영 `gerber` / 테스트 `demo`(`FILE_SERVICE_TYPE`).
- `GET /api/download/:pathToken` — 실파일 다운로드(썸네일 프록시용). 404는 null 취급, content-type 미제공 시 octet-stream 보정.
- `GET /api/delete/:pathToken` — 실파일 삭제. 404(이미 없음)는 성공 취급 → 재시도 멱등.

sp-node 환경변수(`apps/api/.env.example`): `PORT`·`HOST`·`JWT_SECRET`(그누보드 `spcb/lib/secret.php`와 수동 동기화)·`DATABASE_URL`·`LEGACY_DATABASE_URL`(읽기 전용)·`G5_DATABASE_URL`·`WEB_BASE_URL`(redirectUrl 기준 도메인, 기본 `https://local-web.samplepcb.co.kr`)·`FILE_SERVER_URL`·`FILE_SERVICE_TYPE`.

## Data [coverage: medium — 4 sources]

- **실파일** 소유 = file.samplepcb.kr. sp-node는 `pathToken`만 `sp_file` 테이블에 보관(ref_type='sp_order_spec'). 다운로드 접근 보안은 추후 과제.
- **공유 DB**: sp_* 테이블은 그누보드 DB(`samplepcb`)에 동거(2026-07-03 통합 — 백업 정합성·조인). ⚠ `prisma migrate reset` 절대 금지 — g5_* 전체 드랍.
- DB charset = `utf8`(utf8mb4 아님).
- Docker 전환 시 영속 볼륨: 그누보드 `data/`(업로드·세션·dbconfig.php), mariadb 데이터.

## Key Decisions [coverage: high — 5 sources]

- **같은 도메인 경로 분기** (도메인 분리 대신): PHPSESSID 공유 → 인증 브리지(세션→JWT)가 CORS/서드파티쿠키 문제 없이 성립. `/app`·`/api`를 그누보드 예약 경로로 확보.
- **레퍼런스 스니펫 방식**: 실구동 nginx.conf는 repo 밖에 두고 `ops/nginx/local-web.conf`를 라이브에 동일 반영되는 추적본으로 유지.
- **파일 업로드 대행**: 클라이언트가 파일서버에 직접 올리지 않고 sp-node가 서버-to-서버 대행 — pathToken 클라이언트 미노출. 업로드 실패 시 담기 트랜잭션 중단(파일 없는 프로젝트를 만들지 않는다).
- **하드 삭제 순서**: 실파일(파일서버) 먼저 → DB 파기. 삭제 실패 시 pathToken이 남아 재시도 가능(고아 파일 방지), 404는 성공 취급으로 멱등.
- **파일 삭제 API 보안은 후속 트랙**: 2026-07 결정 — 기능 먼저, 접근 제한은 인프라 트랙에서 후속 처리.
- 코어 비수정: `config.php`의 `G5_DOMAIN=''` 유지, https는 `proxy_fix.php` auto_prepend로 해결(코어 수정 회피).

## Gotchas [coverage: high — 5 sources]

- ⚠ **파일서버 delete가 무인증 GET**: `GET /api/delete/:pathToken`은 인증 없이 pathToken만으로 삭제된다 — pathToken 유출 시 임의 파일 삭제 가능. 내부망 제한 또는 서버 간 인증 추가가 미처리 과제(남은 것 ④).
- **파일서버는 한 요청 복수 파일을 처리 못 함**(실측: 2개 전송 시 서버 오류) — `file-server.ts`가 파일당 1요청으로 순차 전송한다.
- **dev 교차 서브도메인**: 거버 뷰어(local-gerber)→local-web 호출은 same-site라 쿠키는 전달되지만, me.php의 CORS가 `*.samplepcb.co.kr` 오리진 반사 허용에 의존한다.
- **레퍼런스 스니펫 ≠ 라이브 그대로**: 라이브 `/app` 블록엔 `X-Forwarded-Proto` 한 줄이 더 있고, 개발용 부가 호스트(local·local2·local3)는 repo 미추적. 스니펫만 보고 라이브 전체를 추정하지 말 것.
- **통합 라우팅은 local-web 하나뿐** — `local.samplepcb.co.kr` 등에서는 `/`가 전부 Vue라 PHP·`/api` 경로가 없다.
- **운영 전환 미완(남은 것 ⑤)**: 거버 prod 분기·운영 nginx `/api` 반영이 남아 있음(체크리스트는 로컬 HANDOFF.md 7장 — 커밋 안 됨). `/app` 운영용 static 블록도 아직 주석 상태.
- location 순서: 구체 경로를 catch-all보다 먼저 두지 않으면 `/api`·`/app`이 PHP로 흘러간다.
- `JWT_SECRET`은 PHP측 `spcb/lib/secret.php`(gitignore)와 **같은 값 수동 동기화** — 한쪽만 바꾸면 401.

## Sources [coverage: high — 7 sources]

- [ops/README.md](../../ops/README.md)
- [ops/nginx/local-web.conf](../../ops/nginx/local-web.conf)
- [AGENTS.md](../../AGENTS.md)
- [CLAUDE.md](../../CLAUDE.md)
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md)
- [samplepcb-web-mono-app/apps/api/.env.example](../../samplepcb-web-mono-app/apps/api/.env.example)
- [samplepcb-web-mono-app/apps/api/src/lib/file-server.ts](../../samplepcb-web-mono-app/apps/api/src/lib/file-server.ts)
