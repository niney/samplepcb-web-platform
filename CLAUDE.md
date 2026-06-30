# CLAUDE.md

이 플랫폼의 에이전트 가이드는 **[AGENTS.md](AGENTS.md)** 에 있습니다. 작업 전 먼저 읽으세요.

요약:
- `samplepcb-web-platform` = **단일 git repo**. 그누보드5/영카트는 `samplepcb-web/`에 **git subtree**, 신규 Vue+Node는 `samplepcb-web-mono-app/` 서브폴더.
- 그누보드 최신화: `git subtree pull --prefix=samplepcb-web gnuboard master --squash` (push 아님). 상세 `docs/UPSTREAM_SYNC.md`.
- 코어 비수정 — 커스텀은 `samplepcb-web/extend/`·모노레포에. `config.php`/코어 직접수정 금지.
- 통합: nginx 같은 도메인 `/`→PHP · `/app`→Vue · `/api`→Node (`ops/nginx/local-web.conf`).

➡️ 상세: **[AGENTS.md](AGENTS.md)**
