# ops — 통합 운영층

두 코드 repo(`samplepcb-web`, `samplepcb-web-mono-app`)를 같은 도메인에서 함께 돌리는 인프라 설정. 이 폴더는 메타 repo(`samplepcb-web-platform`)가 추적한다.

## 현재

- **실제 구동 nginx = `D:\nginx\conf\nginx.conf`** (repo 밖, 로컬 머신). `nginx/local-web.conf`는 이 repo가 추적하는 **통합 호스트 레퍼런스 스니펫**(라이브에 동일 반영).
- 통합 호스트 `local-web.samplepcb.co.kr`: `/api`→Node 3333 · `/app`→Vue 5173 · `/market`→Vue 5176(재능마켓) · `/`→PHP 8888. **모노레포 가동 중이라 4경로 모두 동작**(/market 은 2026-07-08 라이브 반영 완료).
- 라이브 nginx는 **Windows 서비스('nginx', 자동 시작)** — `nginx -s reload` 신호는 서비스 컨텍스트라 관리자 권한으로도 Access denied. 설정 반영은 관리자 `net stop nginx & net start nginx`(순단 ~1초).
- 라이브엔 개발용 부가 호스트도 있음: `local`·`local-www`→5173(Vue 단독 프리뷰), `local2`·`local3`→5174·5175(git worktree 병렬 dev). 통합 라우팅은 `local-web` 하나뿐, 나머지는 `/` 전체가 Vue.

## 예정

- `docker-compose.yml` — `web`(php+apache) · `api`(node/fastify) · `db`(mariadb) · `edge`(nginx). 운영 host nginx 뒤 단일 포트로 노출.
  - **영속 볼륨 필수**: 그누보드 `data/`(업로드·세션·`dbconfig.php`), mariadb 데이터.
  - PHP 이미지: `gd`(jpeg/freetype)·`mysqli`·`mbstring`·`exif`·`fileinfo`·`curl`·`openssl`·`zip`.
  - `proxy_fix.php` → 컨테이너 `php.ini` `auto_prepend_file` (https 인식).
- `dev.sh` — 로컬 전체 스택 기동(turbo dev + apache + nginx).
- `deploy.sh` — 빌드/배포.

## 참고

- 예약 경로 `/app`·`/market`·`/api`는 그누보드가 쓰지 않는다.
- DB charset = `utf8`(utf8mb4 아님).
- 상세: 상위 `../AGENTS.md`.
