# centrafab.co.kr 운영 배포 런북 (Ubuntu 22.04 · nginx 단독 · Cloudflare Flexible)

> samplepcb 웹 플랫폼(그누보드5/영카트 PHP + Vue + Node)을 **centrafab.co.kr** 로 운영 배포하는 전 과정.
> 실제 서버(`qn391`, `user samplepcb`, 앱은 `/home/samplepcb/`)에서 도출·검증한 값·명령을 순서대로 정리.
> 관련 문서: 마이그레이션 `LEGACY_DB_MIGRATION.md`, 통합 라우팅 `../AGENTS.md`. nginx 설정 전문은 STEP 9에 인라인 포함(리포 미추적 — 서버에서 직접 생성).

## 0. 아키텍처

```
[방문자] → Cloudflare(SSL 종단, Flexible) → 오리진 nginx :80 ─┬─ /api/    → 127.0.0.1:3333  Node/Fastify(sp-api, systemd)
                                                              ├─ /app/    → apps/web/dist       정적 SPA
                                                              ├─ /market/ → apps/market/dist    정적 SPA
                                                              └─ /        → php-fpm(unix socket) 그누보드/영카트  ※Apache 없음
```

- **Apache 불필요** — PHP는 nginx + php-fpm 직결. (Apache를 끼우면 REMOTE_ADDR=127.0.0.1이 돼 그누보드 `cloudflare.check.php`의 https 자동감지가 깨짐)
- https 인식: 그누보드 `common.php`→`cloudflare.check.php`가 CF-Connecting-IP + X-Forwarded-Proto/CF-Visitor로 자동 처리(오리진 proxy_fix 불필요).
- 인증 브리지: 그누보드 `/spcb/api/me`가 JWT(HS256, TTL 10분) 발급 → Vue가 `/api`에 Bearer → sp-node가 **공유 시크릿으로 검증만**.

## 확정 사양 (이 서버 기준)

| 항목 | 값 |
|---|---|
| OS | Ubuntu 22.04, nginx `user samplepcb` |
| PHP | **8.1**(OS 기본), 소켓 `/run/php/php8.1-fpm.sock` |
| Node(서비스용) | **시스템 LTS `/usr/bin/node`** (dev의 fnm/conda와 분리 — systemd는 절대경로 필요) |
| pnpm 필터 | 앱=`api`·`web`·`market` (스코프 없음) / 패키지=`@sp/*` |
| DB | MariaDB, DB·유저 `samplepcb`, charset **utf8**(utf8mb4 아님), **`sql_mode=''`** |
| 포트 | Node 3333(127.0.0.1 바인딩) · php-fpm 소켓 · 공개는 80만 |
| 경로 | `/home/samplepcb/samplepcb-web-platform` |

---

## STEP 1 — 패키지 설치

```bash
sudo apt update

# PHP 8.1 + 그누보드 필수 확장 (버전 안 박고 메타패키지 = OS 기본 8.1)
sudo apt install -y php-fpm php-mysql php-gd php-mbstring php-curl php-zip php-xml
php -v ; ls /run/php/*.sock            # v8.1.x / php8.1-fpm.sock 확인

# Node 시스템 LTS (서비스용 — dev는 fnm/conda 그대로 둬도 됨)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
/usr/bin/node -v                       # v22.x (≥20.6 — --env-file 지원)
sudo corepack enable && corepack prepare pnpm@9.15.0 --activate

# DB (이 서버에 둘 경우)
sudo apt install -y mariadb-server
```

> ⚠ `php8.2-fpm`은 이 OS 저장소에 없음(기본 8.1). 굳이 특정 버전이 필요하면 `ppa:ondrej/php`.

## STEP 2 — MariaDB 설정 (sql_mode·DB·유저)

그누보드/마이그레이션은 **비엄격 sql_mode 전제**(기본값 없는 NOT NULL 컬럼 다수).

```bash
# (1) sql_mode 비우기 — 즉시(재시작 전까지)
sudo mysql -e "SET GLOBAL sql_mode='';"

# (2) sql_mode 영구화 (재시작해도 유지 — 안 하면 strict로 자동복귀→그누보드 쓰기 실패)
sudo sed -i '/^\[mysqld\]/a sql_mode=' /etc/mysql/mariadb.conf.d/50-server.cnf
sudo systemctl restart mariadb
sudo mysql -e "SELECT @@global.sql_mode;"      # 빈 값 확인

# (3) DB + 앱 유저 (관리작업은 sudo mysql = root 소켓인증, 비번 불필요)
sudo mysql -e "CREATE DATABASE IF NOT EXISTS samplepcb CHARACTER SET utf8;"
sudo mysql <<'SQL'
CREATE USER IF NOT EXISTS 'samplepcb'@'localhost' IDENTIFIED BY '<DB비번>';
GRANT ALL PRIVILEGES ON samplepcb.* TO 'samplepcb'@'localhost';
FLUSH PRIVILEGES;
SQL
mysql -u samplepcb -p -e "SHOW DATABASES;"     # 앱 계정 접속 확인(using password: YES)
```

> `Access denied ... (using password: NO)`가 나오면 = OS유저로 `mysql`을 비번 없이 실행한 것. 관리작업은 `sudo mysql`, 앱접속은 `-u samplepcb -p`.

## STEP 3 — 코드 배치 & 빌드

```bash
sudo -iu samplepcb                     # 코드 소유권 일치
cd /home/samplepcb
git clone <origin> samplepcb-web-platform
cd samplepcb-web-platform/samplepcb-web-mono-app

pnpm install --frozen-lockfile
pnpm --filter api db:generate          # prisma client (필터는 'api' — @sp/api 아님!)
pnpm -r build                          # shared/config/utils → web(dist)·market(dist)·api(dist) 토폴로지 순
```

- 결과물: `apps/web/dist`, `apps/market/dist`, `apps/api/dist/server.js`.
- api 빌드는 `apps/api/tsup.config.ts`(`noExternal:[/^@sp\//]`)로 워크스페이스 소스를 번들에 포함 → `node dist/server.js`가 `.ts`를 안 만남.

## STEP 4 — 그누보드 클린 설치

> ⚠ 레거시 덤프를 raw로 넣으면 안 됨(옛 스키마). **신규 그누보드로 클린 설치** 후 STEP 11에서 마이그레이션으로 데이터 주입.

```bash
# 설치마법사가 뜨도록 dbconfig 잠시 치움(있을 때만)
mv /home/samplepcb/samplepcb-web-platform/samplepcb-web/data/dbconfig.php ~/dbconfig.php.bak 2>/dev/null || true
```
브라우저에서 **명시적으로**: `http://<도메인 또는 서버IP>/install/index.php`
→ DB(`samplepcb`/`samplepcb`/비번)·**최고관리자 id/pw** 입력.
- ⚠ 최고관리자 id는 **레거시 최고관리자 id와 동일하게**(운영 `SELECT cf_admin FROM g5_config`로 확인). 그래야 마이그레이션이 그 계정을 존재검사로 스킵하고 주문/글이 자연 귀속됨.
- 설치 후 보안상: `rm -rf /home/samplepcb/samplepcb-web-platform/samplepcb-web/install`

## STEP 5 — sp_* 스키마 + 템플릿 상품

```bash
cd /home/samplepcb/samplepcb-web-platform/samplepcb-web-mono-app/apps/api
pnpm exec prisma migrate deploy        # sp_* 스키마 (⚠ reset/dev 금지 — g5_* 드랍)
# 템플릿 상품 4종(sp-pcb-std·sp-mask·sp-pcb-adv·sp-pcb-flex) — 게이트가 부재 시 중단
pnpm exec tsx --env-file=.env.migration src/scripts/seed-template-items.ts
```

## STEP 6 — 시크릿 & 환경변수 (⚠ 어긋나면 로그인/401)

```bash
openssl rand -hex 32                    # JWT 공유 시크릿 1개 생성 → 아래 두 곳에 동일 사용
```

**(a) 그누보드측** `samplepcb-web/spcb/lib/secret.php` (gitignore — example에서 생성):
```bash
cd /home/samplepcb/samplepcb-web-platform/samplepcb-web/spcb/lib
cp secret.php.example secret.php
# 편집: define('SPCB_JWT_SECRET', '<openssl 값>');
```

**(b) Node측** `apps/api/.env`:
```ini
PORT=3333
HOST=127.0.0.1
JWT_SECRET=<openssl 값과 동일>
DATABASE_URL="mysql://samplepcb:<DB비번>@127.0.0.1:3306/samplepcb"
G5_DATABASE_URL="mysql://samplepcb:<DB비번>@127.0.0.1:3306/samplepcb"
G5_DATA_PATH=/home/samplepcb/samplepcb-web-platform/samplepcb-web/data
SPCB_BRIDGE_URL=https://centrafab.co.kr/spcb/api/me
SMTP_HOST=127.0.0.1
SMTP_PORT=25
ALIMTALK_ENABLED=false
```

**(c) 그누보드 DB 접속** `samplepcb-web/data/dbconfig.php` (STEP 4 설치가 생성, 값 확인):
`G5_MYSQL_HOST=localhost · USER=samplepcb · PASSWORD=<DB비번> · DB=samplepcb`

## STEP 7 — php-fpm 풀을 samplepcb로 (502 방지)

nginx가 `samplepcb` 유저라 소켓 소유자도 맞춰야 함(안 하면 `13: Permission denied` → 502):
```bash
sudo sed -i 's/^user = www-data/user = samplepcb/'   /etc/php/8.1/fpm/pool.d/www.conf
sudo sed -i 's/^group = www-data/group = samplepcb/' /etc/php/8.1/fpm/pool.d/www.conf
sudo sed -i -E 's/^;?[[:space:]]*listen\.owner[[:space:]]*=.*/listen.owner = samplepcb/' /etc/php/8.1/fpm/pool.d/www.conf
sudo sed -i -E 's/^;?[[:space:]]*listen\.group[[:space:]]*=.*/listen.group = samplepcb/' /etc/php/8.1/fpm/pool.d/www.conf
sudo systemctl enable --now php8.1-fpm
sudo systemctl restart php8.1-fpm
ls -l /run/php/php8.1-fpm.sock         # 소유자 samplepcb 확인

# 업로드/세션 폴더 권한
sudo chown -R samplepcb:samplepcb /home/samplepcb/samplepcb-web-platform/samplepcb-web/data
```

## STEP 8 — Node API systemd 서비스 (sp-api :3333)

```bash
sudo tee /etc/systemd/system/sp-api.service >/dev/null <<'EOF'
[Unit]
Description=samplepcb Node API (Fastify)
After=network.target mariadb.service

[Service]
WorkingDirectory=/home/samplepcb/samplepcb-web-platform/samplepcb-web-mono-app/apps/api
ExecStart=/usr/bin/node --env-file=.env dist/server.js
Restart=always
RestartSec=2
User=samplepcb
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now sp-api
sudo systemctl status sp-api --no-pager
curl -i http://127.0.0.1:3333/api/health
```

> ⚠ `ExecStart`는 반드시 **시스템 node 절대경로**(`/usr/bin/node`). `which node`가 fnm 임시경로(`/run/user/.../fnm_multishells/...`)를 가리켜도 무시 — systemd는 그 경로를 못 씀(`status=203/EXEC`).

## STEP 9 — nginx centrafab 사이트 활성화

아래 설정을 서버에 그대로 생성한다(4경로 + `.htaccess` 번역 + 소켓 php8.1). `.htaccess`는 nginx가 안 읽으므로 이 설정이 번역해 둠: data/ PHP 실행차단(RCE 방지)·/spcb 무확장 라우팅(인증 브리지)·루트 짧은URL·lib 차단.

```bash
sudo tee /etc/nginx/sites-available/centrafab >/dev/null <<'EOF'
# centrafab.co.kr — samplepcb 플랫폼 (PHP + Vue + Node), Cloudflare Flexible(오리진 :80)
# https 인식은 그누보드 cloudflare.check.php 가 담당(CF-Connecting-IP + X-Forwarded-Proto).
upstream centrafab_php {
    server unix:/run/php/php8.1-fpm.sock;   # 이 서버 PHP 8.1 (ls /run/php/*.sock 로 확인)
}

server {
    listen 80;
    listen [::]:80;
    server_name centrafab.co.kr www.centrafab.co.kr;

    root  /home/samplepcb/samplepcb-web-platform/samplepcb-web;
    index index.php index.html;
    client_max_body_size 100M;

    location = /app    { return 301 /app/; }
    location = /market { return 301 /market/; }

    # 1) Node API (sp-node)
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:3333;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $http_cf_connecting_ip;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # 2) Vue 정적 빌드 + SPA fallback
    location ^~ /app/ {
        alias /home/samplepcb/samplepcb-web-platform/samplepcb-web-mono-app/apps/web/dist/;
        try_files $uri $uri/ /app/index.html;
    }
    location ^~ /market/ {
        alias /home/samplepcb/samplepcb-web-platform/samplepcb-web-mono-app/apps/market/dist/;
        try_files $uri $uri/ /market/index.html;
    }

    # 3) 보안: data/ PHP 실행차단(RCE)·include 전용 디렉토리 차단
    location ^~ /data/ {
        location ~* \.(php|phtml|pht|phar|inc|cgi|pl)$ { deny all; }
        location ~  ^/data/session/                    { deny all; }
    }
    location ^~ /spcb/lib/          { deny all; }
    location ^~ /plugin/okname/key/ { deny all; }

    # 4) /spcb 무확장 라우팅 (인증 브리지) + Bearer 패스스루
    location ^~ /spcb/ {
        try_files $uri $uri/ $uri.php$is_args$args;
        location ~ \.php$ {
            include snippets/fastcgi-php.conf;
            fastcgi_pass  centrafab_php;
            fastcgi_read_timeout 420s;
            fastcgi_param HTTP_AUTHORIZATION $http_authorization;
        }
    }

    # 5) 루트 짧은 URL (/슬러그 → /spcb/pages/슬러그.php)
    location = /shop/quotes         { rewrite ^ /spcb/pages/quotes.php         last; }
    location = /shop/quotes/archive { rewrite ^ /spcb/pages/quotes-archive.php last; }
    location ~ ^/(?<slug>[a-z0-9-]+)/?$ {
        try_files /spcb/pages/$slug.php @gnuboard;
    }
    location @gnuboard { try_files $uri $uri/ /index.php?$args; }

    # 6) 그누보드 일반 PHP
    location / { try_files $uri $uri/ /index.php?$args; }
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass  centrafab_php;
        fastcgi_read_timeout 420s;
        fastcgi_param HTTP_AUTHORIZATION $http_authorization;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/centrafab /etc/nginx/sites-enabled/centrafab
sudo nginx -t && sudo systemctl reload nginx
```

> PHP 버전이 8.1이 아니면 `upstream centrafab_php`의 소켓 경로만 교체(`ls /run/php/*.sock`). 이 설정은 리포에 미추적이므로 서버에서 직접 생성한다.

## STEP 10 — Cloudflare Flexible (무료)

1. Cloudflare 가입 → **Add a site** → `centrafab.co.kr` (Free).
2. 안내된 **네임서버 2개**를 **cafe24 도메인관리 → 네임서버 설정**에 입력(전파 대기).
3. Cloudflare **DNS**: `A @ → 서버 공인IP`(Proxied 🟠), `A www → 같은 IP`(🟠). 공인IP는 `curl -s ifconfig.me`.
4. **SSL/TLS → Overview → Flexible** (오리진 :80만).
5. **SSL/TLS → Edge Certificates → Always Use HTTPS = On**.

> (권장, 나중에) 쇼핑몰이라 Flexible→**Full(strict)**: CF Origin Certificate 발급→오리진에 설치→nginx 443 블록 추가→모드 Full(strict).

## STEP 11 — 레거시 데이터 마이그레이션 (운영 직결)

> 상세·설계는 `LEGACY_DB_MIGRATION.md`. 여기선 실행 순서만.

```bash
cd /home/samplepcb/samplepcb-web-platform/samplepcb-web-mono-app/apps/api
cp .env.migration.example .env.migration
# 편집:
#   LEGACY_DATABASE_URL="mysql://hyoh9150:<비번URL인코딩>@www.samplepcb.co.kr:3306/hyoh9150"  (! → %21, @ → %40, # → %23)
#   G5_DATABASE_URL="mysql://samplepcb:<DB비번>@127.0.0.1:3306/samplepcb"
#   DATABASE_URL="mysql://samplepcb:<DB비번>@127.0.0.1:3306/samplepcb"   (G5_DATABASE_URL과 동일 DB 필수)

pnpm migrate:gate      # 처분표·컬럼·상태·길이 검사 (드리프트/미시드 있으면 중단)
pnpm migrate:dry       # 쓰기 없이 변환 통계
pnpm migrate:run       # 전량 이관 (운영 실측 ~6분)
pnpm migrate:verify    # 검증 (행수·금액 항등·참조 정합)
```

**재이관(초기화 후 다시)이 필요하면:**
```bash
# 완전 초기화: 백업 → DB 재생성 → 클린설치(STEP4) → prisma deploy+시드(STEP5) → 원장삭제 → gate/run
mysqldump --default-character-set=utf8 samplepcb > ~/samplepcb-backup-$(date +%F).sql
sudo mysql -e "DROP DATABASE samplepcb; CREATE DATABASE samplepcb CHARACTER SET utf8;"
rm -f /home/samplepcb/samplepcb-web-platform/.tmp/migrate/ledger-samplepcb.json   # ★ 안 지우면 재이관이 스킵됨
# 거래만 초기화(회원·게시판·설정 유지): pnpm migrate:wipe -- --yes  후 위 원장 삭제 → migrate:run
```

- 거버 실파일: `pnpm migrate:files`.

## STEP 11-B — 증분 동기화 (새 데이터만 반영, `migrate:sync`)

최초 `migrate:run` 후, **운영이 계속 만드는 신규·변경분만** 반영. 반복 실행 안전(무변경이면 no-op). 컷오버 전까지 로컬을 운영 최신으로 유지하는 정식 경로(§6-C·§6-D).

| | `migrate:run` | `migrate:sync` |
|---|---|---|
| 용도 | 최초 전량 이관/재이관 | 이후 **델타만** 반영 |
| 소스 | 덤프 임포트본 권장 | **운영 직결**(읽기전용) |
| 판정 | 원장(완료마커) | **대조(diff)** — 레거시에 수정시각 컬럼 없음 |
| 원장 | 삭제 필요(재이관 시) | **무시** — 원장 삭제 불필요 |

```bash
cd /home/samplepcb/samplepcb-web-platform/samplepcb-web-mono-app/apps/api
pnpm migrate:sync -- --dry-run     # 미리보기(타깃 무변경) — 델타 규모 확인
pnpm migrate:sync                  # 실제 반영 (기본 --window=90: 최근 생성 주문 재대조 창)
pnpm migrate:verify                # 검증
# 컷오버 마지막 1회만: 노이즈 컬럼(mb_today_login·mb_login_ip)까지 반영
pnpm migrate:sync -- --final && pnpm migrate:verify
```

**동작(매 실행)**: 게이트(스키마 드리프트 시 중단) → 신규분(레거시∖타깃 차집합) → 재대조(비종결 주문·헤더 지문 상이·window 내 = 사후 수납·송장·가격확인 포착) → 삭제/이상 리포트.

**리포트만(자동조치 X — 수동 판단)**: 주문/게시글 삭제 검출 · 보호계정(admin·kpeter) 상이 · 포인트 타깃 초과 · 파일 교체(→`migrate:files --sideload`) · **금액 항등 불일치(0이 정상, 나오면 즉시 조사)**. 리포트: `.tmp/migrate/sync-report-<DB>-<시각>.json`.

**주의**:
- 컷오버 전 신규 플랫폼은 **조회 전용** 전제 — 신규에서 바꾼 데이터는 다음 sync가 레거시 기준으로 **원복**(단방향 정본).
- 게이트가 매번 먼저 도니 운영 스키마 변경 시 중단 → 처분 확정 후 재실행.

> 흐름 요약: **초기 `migrate:run`(1회) → 이후 `migrate:sync`(반복) → 컷오버 `migrate:sync --final`**.

## STEP 12 — 관리자 계정

그누보드 최고관리자 = `g5_config.cf_admin`에 지정된 회원 1인(코드가 아니라 DB값).
- STEP 4에서 install 관리자 id를 레거시 `cf_admin`과 동일하게 만들었으면 추가 작업 없음.
- 별도 회원을 최고관리자로 만들려면:
```bash
sudo mysql samplepcb -e "UPDATE g5_config SET cf_admin='회원ID'; UPDATE g5_member SET mb_level=10, mb_email_certify=NOW() WHERE mb_id='회원ID';"
```

---

## 배포 후 검증

```bash
curl -I http://127.0.0.1/                          # 그누보드(php-fpm) 200/302
curl -i http://127.0.0.1:3333/api/health           # sp-api
curl -I https://centrafab.co.kr/                    # Cloudflare 경유 https
curl -s https://centrafab.co.kr/spcb/api/me -b 'PHPSESSID=<세션>'   # 인증브리지 JWT
curl -I https://centrafab.co.kr/app/  https://centrafab.co.kr/market/
curl -I https://centrafab.co.kr/data/session/      # 403 = 보안 정상
```
브라우저: `/` 홈 · `/bbs/login.php` 로그인 · `/adm/` · `/app/admin`(sp-vue) · `/market`(sp-market).

> **메인 슬라이드(홈 최상단 배너)**: `g5_shop_banner`는 마이그레이션 skip(STEP 11 대상 아님)이라 배너 행·이미지가 이관되지 않는다. 컷오버 후 `/app/admin/slides`(메인 슬라이드)에서 이미지를 재등록한다. 이미지는 `G5_DATA_PATH/banner/{id}`에 저장되므로 **sp-api 실행 유저(samplepcb)가 이 경로에 쓰기 권한**이 있어야 한다(없으면 등록 시 500). 홈 렌더는 sp-php 브릿지 `theme/sp-lite/inc/main_slider.php`.

---

## 운영 명령 모음 (올리고·내리고·로그·재배포)

### Node API (sp-api)
```bash
sudo systemctl start   sp-api          # 올리기
sudo systemctl stop    sp-api          # 내리기
sudo systemctl restart sp-api          # 재시작 (★ .env·코드 변경 후 필수 — systemd는 시작시점 env 고정)
sudo systemctl status  sp-api --no-pager
sudo systemctl enable  sp-api          # 부팅 자동시작 등록
sudo systemctl disable sp-api          # 자동시작 해제
journalctl -u sp-api -f                 # 실시간 로그
journalctl -u sp-api -n 100 --no-pager  # 최근 100줄
journalctl -u sp-api -p err --no-pager  # 에러만
sudo systemctl reset-failed sp-api      # 반복실패로 잠겼을 때 해제
```

### PHP-FPM
```bash
sudo systemctl restart php8.1-fpm
sudo systemctl status  php8.1-fpm --no-pager
sudo journalctl -u php8.1-fpm -n 50 --no-pager
```

### nginx
```bash
sudo nginx -t                           # 설정 문법검사 (reload 전 항상)
sudo systemctl reload  nginx            # 무중단 재적용
sudo systemctl restart nginx
sudo tail -n 50 /var/log/nginx/error.log
sudo tail -f    /var/log/nginx/access.log
```

### MariaDB
```bash
sudo systemctl restart mariadb
sudo systemctl status  mariadb --no-pager
sudo mysql                              # root(소켓)
mysql -u samplepcb -p samplepcb         # 앱 계정
mysqldump --default-character-set=utf8 samplepcb > ~/backup-$(date +%F).sql   # 백업
```

### 코드 재배포 (git pull → 빌드 → 재시작)
```bash
cd /home/samplepcb/samplepcb-web-platform
git pull
cd samplepcb-web-mono-app
pnpm install --frozen-lockfile          # 의존성 변경 시
pnpm --filter api db:generate           # prisma 스키마 변경 시
pnpm -r build                           # 또는 --filter api / web / market 개별
pnpm --filter api exec prisma migrate deploy   # 스키마 마이그레이션 있을 때만(reset/dev 금지)
sudo systemctl restart sp-api           # Node 반영
sudo systemctl reload  nginx            # nginx 설정 바꿨을 때
# PHP(그누보드)·Vue dist는 파일 교체 즉시 반영(서비스 재시작 불필요). PHP 코드 대량변경 후엔 php-fpm restart 권장.
```

### 전체 스택 한 번에 상태 확인
```bash
systemctl status sp-api php8.1-fpm nginx mariadb --no-pager | grep -E 'Active|●|sp-api|php8.1|nginx|mariadb'
```

---

## 트러블슈팅 (실제 겪은 것)

| 증상 | 원인 | 해결 |
|---|---|---|
| `No projects matched the filters "@sp/web"` | 앱 패키지명은 스코프 없음 | 필터를 `api`·`web`·`market`로 (또는 `pnpm -r build`) |
| `Unable to locate package php8.2-fpm` | OS 기본은 8.1 | 메타패키지 `php-fpm ...`로 설치, 소켓 php8.1 |
| `ERR_UNKNOWN_FILE_EXTENSION ".ts"` (node dist/server.js) | 워크스페이스 소스 external | `apps/api/tsup.config.ts` `noExternal:[/^@sp\//]` (리포 반영됨) → 재빌드 |
| `@prisma/client did not initialize` | prisma generate 누락 | `pnpm --filter api db:generate` (필터 api!) — 재빌드 불필요 |
| systemd `status=203/EXEC` | ExecStart node 경로 없음(fnm 임시경로) | 시스템 node 설치 → `ExecStart=/usr/bin/node` |
| `502 Bad Gateway`, error.log `unix:/run/php/...sock (13: Permission denied)` | 소켓 소유자 www-data ↔ nginx samplepcb | php-fpm 풀 user/group/listen.owner/group=samplepcb → restart |
| seed/그누보드 INSERT `Field 'it_basic' doesn't have a default value` (1364) | strict sql_mode | `sql_mode=''` 전역(즉시+영구) |
| `Access denied ... (using password: NO)` | OS유저로 mysql 비번없이 | 관리=`sudo mysql`, 앱=`-u samplepcb -p` |
| sp-node `401 Invalid or missing authentication token` | 시크릿 불일치 or 토큰만료(TTL 10분) or .env 변경 후 미재시작 | `secret.php`↔`.env` JWT_SECRET 동일 확인 → `systemctl restart sp-api`, 브라우저에서 재테스트 |
| 마이그레이션 게이트 `템플릿 상품 누락` | 시드 안 함 | `seed-template-items.ts` 실행 후 재게이트 |

---

## 부록 — 서비스 의존/포트 요약

| 서비스 | 유닛/포트 | 역할 |
|---|---|---|
| nginx | systemd `nginx`, :80(공개) | 리버스 프록시·정적·php-fpm 게이트웨이 |
| php-fpm | systemd `php8.1-fpm`, unix sock | 그누보드/영카트 PHP |
| sp-api | systemd `sp-api`, 127.0.0.1:3333 | Node/Fastify (/api) |
| mariadb | systemd `mariadb`, :3306 | 공유 DB samplepcb (g5_* + sp_*) |
