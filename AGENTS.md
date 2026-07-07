# AGENTS.md — samplepcb-web-platform

samplepcb 고객 대면 웹 플랫폼. **단일 git repo**이며, 그누보드5/영카트 코어는 `samplepcb-web/`에 **git subtree**로 들어와 있다. (Claude Code는 `CLAUDE.md`가 이 파일을 가리킨다.)

## 구조 (단일 repo)

```
samplepcb-web-platform/          ← 단일 git repo  (origin: niney/samplepcb-web-platform)
├── samplepcb-web/               ← 그누보드5/영카트 PHP  = gnuboard5 subtree
├── samplepcb-web-mono-app/      ← Vue + Node 모노레포 (일반 서브폴더)
├── ops/                         ← nginx · docker-compose · scripts
├── docs/                        ← 절차·기록 문서 (UPSTREAM_SYNC · GERBER_ORDER_FLOW · pricing-engine-parity 등)
└── samplepcb-web-platform-wiki/ ← 컴파일된 코드베이스 위키 (토픽·개념 아티클, /wiki-compile 로 갱신)
```

> **📚 위키 먼저**: 코드베이스 파악이 필요하면 원시 파일 스캔 전에 **`samplepcb-web-platform-wiki/CONTEXT.md`**(사용법) → `samplepcb-web-platform-wiki/INDEX.md`(토픽 지도)를 읽어라. coverage 태그가 high 인 섹션은 원본 확인 없이 신뢰 가능.

- **AI 작업 방식**: 규모 있는 작업의 진행 방식(직접/Opus 위임+전수 감사/병렬 agent) 선택 기준·품질 게이트·실증 로그는 **`docs/AI_WORKFLOW_PLAYBOOK.md`** — 메인 세션이 자율 결정하고 근거를 고지, 사용자는 원-체크(퀄리티 > 비용).
- **리모트**: `origin`(push 대상) + `gnuboard`(=gnuboard/gnuboard5, subtree 소스, **push 차단**).
- 그누보드 코어 최신화는 **`git subtree pull --prefix=samplepcb-web gnuboard master --squash`** (push 아님). 상세 `docs/UPSTREAM_SYNC.md`.
- `samplepcb-web-mono-app`은 이 repo의 일반 서브폴더(자체 pnpm workspace). `node_modules`/`dist`/`.env`는 gitignore.

## 코어 비수정 원칙

- 커스텀은 `samplepcb-web/extend/`·`plugin/`·별도 스킨/테마, 신규 기능은 `samplepcb-web-mono-app`(Vue+Node).
- `bbs/`·`shop/`·`lib/`·`adm/`·루트 `*.php`·`config.php` 직접 수정 최소화 → subtree pull 충돌 지점.
- `config.php`의 `G5_DOMAIN`은 `''` 유지(https는 `proxy_fix.php` auto_prepend).

## 네이밍 컨벤션 (폴더·파일)

**그누보드 관행·레거시 스타일을 기본으로 따르고, 그 외 우리가 자유롭게 정하는 이름은 `kebab-case`.**

- **그누보드가 기능적으로 강제하는 이름은 그대로** — 안 지키면 그누보드가 인식 못 함:
  - 파일 suffix/규약: `*.extend.php`·`*.skin.php`·`theme.config.php`, 규약 폴더 `skin/board/<스킨명>/`·`theme/<테마명>/`·`extend/`·`plugin/`.
  - `extend/`·플러그인 PHP 파일은 그누보드 관례인 `snake_case`(예: `social_login.extend.php`).
  - 그누보드 코어·서드파티 폴더(`adm`·`lib`·`jquery-ui`…)는 들어온 그대로 — 손대지 않음(subtree).
- **우리가 자유롭게 정하는 이름은 `kebab-case`** — 소문자, 단어구분 `-`. 단일어는 자연히 소문자:
  - 신규 테마/스킨/플러그인 폴더명(예: `theme/sp-lite`), 루트·`ops`·`docs`·모노레포 폴더(예: `api-contract`, `samplepcb-web-mono-app`).
  - 근거: 웹 경로(URL)는 소문자-하이픈이 업계 표준(Google이 `_` 비권장)이고, npm 패키지명 컨벤션과도 일치.
- **예외**: PSR-4 오토로딩 PHP 클래스를 도입하면 그 디렉토리/파일만 `PascalCase`(현재 미사용). 모노레포 TS/JS 파일명은 각 도구 관례를 따름(폴더 규칙과 분리).

## 프로젝트 호칭 (별칭)

세 프로젝트를 부르는 **별칭**. 폴더·경로·패키지명은 **바꾸지 않는다** — 사람·에이전트가 문서·이슈·커밋·대화에서 안 헷갈리도록 통일한 호칭일 뿐(`@sp` 스코프·kebab-case 규칙과 일관).

| 별칭 | 정체 | 폴더 (불변) | 라우트 | 정밀 구분 |
|---|---|---|---|---|
| **`sp-php`** | 그누보드5/영카트 (PHP) | `samplepcb-web/` | `/` | `g5` · `youngcart` |
| **`sp-vue`** | Vue SPA 프런트 (관리자) | `samplepcb-web-mono-app/apps/web` | `/app` | `@sp` 스코프 |
| **`sp-market`** | Vue SPA 재능마켓 (고객) | `samplepcb-web-mono-app/apps/market` | `/market` | `@sp` 스코프 |
| **`sp-node`** | Node/Fastify 백엔드 | `samplepcb-web-mono-app/apps/api` | `/api` | Fastify · `@sp` 스코프 |

- **sp-vue `/app`의 실질 기본 용도는 관리자(`/app/admin`)다** — 고객 대면 신규 화면(견적관리 등)은 sp-php(`spcb/pages/`)에 우선 구현하는 플랫폼 결정에 따라, `/app` 루트 홈은 최소 셸이고 관리자 화면이 본문이다. **예외(2026-07-08): 재능마켓처럼 SPA급 인터랙션(마법사·블라인드 견적 비교·대시보드)이 필요한 신규 소비자 서비스는 별도 Vue 앱(sp-market, `/market`)으로 구현** — sp-vue는 계속 관리자 전용이고, 마켓의 관리 화면은 `/app/admin/market`에 둔다.
- **"web"은 호칭으로 쓰지 않는다** — `samplepcb-web/`(PHP)와 `apps/web`(Vue) 양쪽에 걸쳐 혼동을 부르기 때문. 위 세 별칭으로 대체.
- 빠른 대화에선 `php`/`vue`/`node`로 줄여도 1:1로 통함. **문서·커밋엔 `sp-` 접두형 권장.**
- `sp-node`는 런타임 기준 이름. 라우트/계약(`/api`, `@sp/api-contract`)을 콕 집을 땐 "sp-node의 api".

## 런타임 통합 — 같은 도메인 라우팅 (nginx 443 리버스프록시)

**통합 호스트 `local-web.samplepcb.co.kr`** — 한 도메인에서 PHP·Vue·Node를 경로로 분기. 구체 경로(`/api`·`/app`)를 먼저, catch-all `/`를 마지막에 둔다:

```
/api/    → 127.0.0.1:3333  Node (Fastify)      ← samplepcb-web-mono-app/apps/api
/app/    → 127.0.0.1:5173  Vue (Vite dev+HMR)  ← samplepcb-web-mono-app/apps/web (base:'/app/')
/market/ → 127.0.0.1:5176  Vue (Vite dev+HMR)  ← samplepcb-web-mono-app/apps/market (base:'/market/')
/        → 127.0.0.1:8888  PHP (XAMPP Apache)  ← samplepcb-web (그누보드/영카트)  ← 루트=PHP
```
- **`/app`·`/api`·`/market`는 그누보드 예약 경로**(그누보드가 점유 안 함). `/spcb`(인증 브리지)는 별도 location이 없어 catch-all `/`로 흘러 PHP가 처리.

**설정 파일 위치 (중요)**
- 실제 구동 = **`D:\nginx\conf\nginx.conf`** (repo **밖**, 로컬 머신).
- **`ops/nginx/local-web.conf`** = repo가 추적하는 **통합 호스트 레퍼런스 스니펫**(위 4개 location). 라이브와 동일 구조(라이브 `/app`·`/market`엔 `X-Forwarded-Proto` 한 줄이 더 있음). `/market`은 2026-07-08 라이브 반영 완료. 라이브 nginx는 Windows 서비스라 reload 신호 불가 — 관리자 `net stop/start nginx`.

**라이브 nginx의 다른 호스트 (개발 편의용, repo 미추적)**

| server_name | `/` 라우팅 | 용도 |
|---|---|---|
| `local-web.samplepcb.co.kr` | 통합(위 표) | **정식 통합 라우팅** |
| `local.samplepcb.co.kr` · `local-www.samplepcb.co.kr` | 전체 → 5173 | Vue 단독 프리뷰 |
| `local2 / local3.samplepcb.co.kr` | 5174 / 5175 | git worktree 병렬 dev |

→ 통합 라우팅(PHP `/` + `/api` + `/app`)이 살아있는 건 `local-web` **하나뿐**. 나머지는 `/` 전체가 Vue다.

## 인증 브리지 (그누보드 = IdP) — 단일 설명원본

**이 절이 인증 브리지의 단일 설명원본** — 다른 문서(HANDOFF·모노레포 AGENTS.md)는 여기로 링크만 한다. 구현 완료.

- 같은 도메인이라 PHPSESSID 공유. Node는 PHP 세션 직접 못 읽음 →
- 그누보드 `GET /spcb/api/me`(무확장 — `spcb/.htaccess`. common.php 부트스트랩 → `$member` 기반 **서명 HS256 JWT**, TTL 10분) → Vue가 `/api` 호출 시 `Bearer` → **Fastify는 공유 시크릿으로 JWT만 검증**(`JwtClaims` — `iat`/`exp` 필수).
- **시크릿**: `samplepcb-web/spcb/lib/secret.php`(gitignore) ↔ `apps/api/.env`의 `JWT_SECRET` — **같은 값 수동 동기화**.
- Node DB = 그누보드와 **공유 DB(`samplepcb`)** 의 `sp_*` 테이블(Prisma 소유, 2026-07-03 통합 — 백업 정합성·조인). ⚠ `prisma migrate reset` 금지(g5_* 드랍). 회원 식별=JWT 클레임. `g5_*` 접근은 `apps/api/src/lib/g5-db.ts` **접근 카탈로그**로 일원화 — sp-php 업무 기능의 모노레포 점진 마이그레이션 방침(2026-07-04, `docs/GERBER_ORDER_FLOW.md` 5장·HANDOFF #11)에 따라 규율 하에 확장.
- 구현 위치: `samplepcb-web/spcb/`(me.php·jwt.php) · `apps/api/src/plugins/auth.ts`(검증) · `packages/shared/src/auth.ts`(bootstrap).

## HTTPS / 도메인

- 운영 도메인이 달라도 무관: `G5_DOMAIN=''` + `g5_path()`가 `HTTP_HOST` 사용 → nginx `Host $host`면 자동.
- 프록시 뒤 https: `proxy_fix.php`(php.ini `auto_prepend_file`) → `$_SERVER['HTTPS']='on'`+`SERVER_PORT=443`. 이중 nginx면 두 단 모두 `X-Forwarded-Proto`/`Host` 전달.

## 모노레포 타입 강성 "매우 강함"

- tsconfig strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax. ESLint strictTypeChecked + `no-explicit-any` error. scope `@sp`.
- 검증: `pnpm -r typecheck` / `pnpm -r lint` (turbo가 Windows에서 깨져 pnpm -r 우회 — `ops/README.md` 참고).

## 배포 (Docker, 예정)

- `ops/docker-compose.yml`: web(php)·api(node)·db(mariadb)·edge(nginx) → 운영 host nginx 뒤 단일 포트. 영속 볼륨: 그누보드 `data/`, mariadb.
