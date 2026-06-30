# samplepcb-web-platform

samplepcb 고객 대면 웹의 **단일 저장소**. 그누보드5/영카트(PHP)와 신규 Vue+Node 모노레포를 한 repo에서 같은 도메인으로 운영한다.

```
samplepcb-web-platform/          ← 단일 git repo (origin: niney/samplepcb-web-platform)
├── samplepcb-web/               ← 그누보드5/영카트 PHP  = gnuboard5 subtree
├── samplepcb-web-mono-app/      ← Vue + Node 모노레포 (일반 서브폴더)
├── ops/                         ← nginx · docker-compose · scripts
└── docs/UPSTREAM_SYNC.md        ← 그누보드 패치(subtree) 절차
```

## 핵심

- **그누보드 코어는 `samplepcb-web/`에 git subtree** 로 들어와 있고, `git subtree pull`로 최신화한다(`gnuboard` 리모트, push 차단).
- **코어 비수정** — 커스텀은 `samplepcb-web/extend/`·별도 스킨/테마, 신규 기능은 `samplepcb-web-mono-app`.
- **런타임 통합** — nginx 같은 도메인: `/` → PHP(8888), `/app` → Vue, `/api` → Node. (`/app`·`/api`는 그누보드 예약 경로)

## 구성요소

| 폴더 | 역할 | 가이드 |
|---|---|---|
| `samplepcb-web/` | 그누보드5/영카트(쇼핑·회원·인증), subtree | `docs/UPSTREAM_SYNC.md` |
| `samplepcb-web-mono-app/` | Vue 프런트 + Node API (pnpm+turbo, 매우 강함 TS) | `samplepcb-web-mono-app/AGENTS.md` |
| `ops/` | nginx·docker·스크립트 | `ops/README.md` |

상세 아키텍처: [AGENTS.md](AGENTS.md)
