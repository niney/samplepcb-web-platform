# AGENTS.md — samplepcb-web-platform

samplepcb 고객 대면 웹 플랫폼. **단일 git repo**이며, 그누보드5/영카트 코어는 `samplepcb-web/`에 **git subtree**로 들어와 있다. (Claude Code는 `CLAUDE.md`가 이 파일을 가리킨다.)

## 구조 (단일 repo)

```
samplepcb-web-platform/          ← 단일 git repo  (origin: niney/samplepcb-web-platform)
├── samplepcb-web/               ← 그누보드5/영카트 PHP  = gnuboard5 subtree
├── samplepcb-web-mono-app/      ← Vue + Node 모노레포 (일반 서브폴더)
├── ops/                         ← nginx · docker-compose · scripts
└── docs/UPSTREAM_SYNC.md        ← subtree 패치 절차
```

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

## 런타임 통합 — 같은 도메인 라우팅

```
/        → Apache 8888 (PHP, samplepcb-web)
/app/    → Vue (Vite 5173 dev | 빌드 static)   ← samplepcb-web-mono-app/apps/web
/api/    → Node (Fastify 3000)                 ← samplepcb-web-mono-app/apps/api
```
- **`/app`·`/api`는 그누보드 예약 경로**(그누보드가 점유하지 않음). Vue 빌드 `base:'/app/'`.
- 설정: `ops/nginx/local-web.conf`.

## 인증 브리지 (그누보드 = IdP)

- 같은 도메인이라 PHPSESSID 공유. Node는 PHP 세션 직접 못 읽음 →
- 그누보드 `/spcb/api/me.php`(common.php 부트스트랩 → `$member` + **서명 JWT**, 시크릿 `extend/`) → Vue가 `/api` 호출 시 `Bearer` → **Fastify는 공유 시크릿으로 JWT만 검증**.
- Node DB = 별도 `samplepcb_app` + `sp_*`(Prisma 소유). 회원 식별=JWT 클레임(그누보드 스키마 결합 회피).

## HTTPS / 도메인

- 운영 도메인이 달라도 무관: `G5_DOMAIN=''` + `g5_path()`가 `HTTP_HOST` 사용 → nginx `Host $host`면 자동.
- 프록시 뒤 https: `proxy_fix.php`(php.ini `auto_prepend_file`) → `$_SERVER['HTTPS']='on'`+`SERVER_PORT=443`. 이중 nginx면 두 단 모두 `X-Forwarded-Proto`/`Host` 전달.

## 모노레포 타입 강성 "매우 강함"

- tsconfig strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax. ESLint strictTypeChecked + `no-explicit-any` error. scope `@sp`.
- 검증: `pnpm -r typecheck` / `pnpm -r lint` (turbo가 Windows에서 깨져 pnpm -r 우회 — `ops/README.md` 참고).

## 배포 (Docker, 예정)

- `ops/docker-compose.yml`: web(php)·api(node)·db(mariadb)·edge(nginx) → 운영 host nginx 뒤 단일 포트. 영속 볼륨: 그누보드 `data/`, mariadb.
