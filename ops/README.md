# ops — 통합 운영층

두 코드 repo(`samplepcb-web`, `samplepcb-web-mono-app`)를 같은 도메인에서 함께 돌리는 인프라 설정. 이 폴더는 메타 repo(`samplepcb-web-platform`)가 추적한다.

## 현재

- `nginx/local-web.conf` — 로컬 같은 도메인 라우팅(`/`→PHP 8888, `/app`→Vue 5173, `/api`→Node 3000). 지금은 모노레포 미생성이라 `/`(PHP)만 동작.

## 예정

- `docker-compose.yml` — `web`(php+apache) · `api`(node/fastify) · `db`(mariadb) · `edge`(nginx). 운영 host nginx 뒤 단일 포트로 노출.
  - **영속 볼륨 필수**: 그누보드 `data/`(업로드·세션·`dbconfig.php`), mariadb 데이터.
  - PHP 이미지: `gd`(jpeg/freetype)·`mysqli`·`mbstring`·`exif`·`fileinfo`·`curl`·`openssl`·`zip`.
  - `proxy_fix.php` → 컨테이너 `php.ini` `auto_prepend_file` (https 인식).
- `dev.sh` — 로컬 전체 스택 기동(turbo dev + apache + nginx).
- `deploy.sh` — 빌드/배포.

## 참고

- 예약 경로 `/app`·`/api`는 그누보드가 쓰지 않는다.
- DB charset = `utf8`(utf8mb4 아님).
- 상세: 상위 `../AGENTS.md`.
