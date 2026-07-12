#!/usr/bin/env bash
#
# samplepcb-web-platform 배포 스크립트 (운영 서버 전용 — centrafab.co.kr)
# 사용: cd /home/samplepcb/samplepcb-web-platform && ./deploy.sh
#       ./deploy.sh 5        # 번호 바로 지정도 가능
#
# 케이스
#   1) sp-api(Node)만          — DB 스키마 변경 없음
#   2) sp-api + DB 마이그레이션
#   3) sp-vue(web)만           — 정적 빌드(서비스 재시작 불필요)
#   4) sp-market만             — 정적 빌드
#   5) 풀 재배포 (api + web + market + DB)
#   6) sp-php(그누보드)만       — git pull + php-fpm reload(opcache 비움)
#   7) nginx 설정 reload
#   8) .env만                  — sp-api 재시작
#
# 전제: 유저 samplepcb 로 실행(코드 소유권), pnpm/node 는 PATH 에 있음.
#   systemctl/nginx/php-fpm 는 sudo 필요(암호 프롬프트 뜰 수 있음).
#   ⚠ 공유 DB 라 prisma 는 'migrate deploy' 만 — reset/dev 금지(g5_* 드랍).
#   DB 마이그레이션(2,5)은 "파괴적 여부"를 물어본다:
#     - 추가형(ADD COLUMN 등) → 무중단(N)  /  파괴적(DROP·NOT NULL·타입변경) → 중단(y)

set -euo pipefail

ROOT="/home/samplepcb/samplepcb-web-platform"
MONO="$ROOT/samplepcb-web-mono-app"

[[ -d "$MONO" ]] || { echo "경로 없음: $MONO"; exit 1; }
cd "$MONO"

# ── 헬퍼 ────────────────────────────────────────────────
step()         { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
# 과거 'vue-tsc -b' 빌드가 src/ 에 emit 한 스테일 .js·tsbuildinfo 제거(untracked 만).
# vite 확장자 해석이 .js > .ts 라 옛 .js 가 .ts 를 가려 MISSING_EXPORT 로 빌드가 깨진다.
# 빌드 스크립트는 --noEmit 으로 교정됐지만(bbc3216bf) 서버 작업트리 잔재는 pull 이 못 지움.
clean_stale()  { step "스테일 emit 정리";
  git -C "$ROOT" status --porcelain | sed -n 's/^?? //p' \
    | grep -E '/src/.*\.js$|\.tsbuildinfo$' \
    | while IFS= read -r f; do rm -f "$ROOT/$f" && echo "  삭제: $f"; done || true; }
pull()         { step "코드 받기";             git -C "$ROOT" pull --ff-only; clean_stale; pnpm install --frozen-lockfile; }
gen()          { step "prisma generate";       pnpm --filter api db:generate; }
migrate()      { step "prisma migrate deploy"; pnpm --filter api exec prisma migrate deploy; }
build_api()    { step "sp-api 빌드";           pnpm --filter api build; }
build_web()    { step "sp-vue(web) 빌드";      pnpm --filter web build; }
build_market() { step "sp-market 빌드";        pnpm --filter market build; }
api_restart()  { step "sp-api 재시작";         sudo systemctl restart sp-api; }
api_stop()     { step "sp-api 중단";           sudo systemctl stop sp-api; }
api_start()    { step "sp-api 기동";           sudo systemctl start sp-api; }
php_reload()   { step "php-fpm reload";        sudo systemctl reload php8.1-fpm; }
nginx_reload() { step "nginx 검사+reload";     sudo nginx -t && sudo systemctl reload nginx; }

ask_stop() {
  # 마이그레이션 전 sp-api 중단 여부 (기본 N = 무중단)
  read -rp $'\n파괴적 마이그레이션인가요? sp-api 중단하고 진행할까요? [y/N] ' a
  [[ "${a:-N}" =~ ^[Yy]$ ]]
}

# ── 케이스 실행 ─────────────────────────────────────────
case_1() {  # sp-api 만, DB 변경 없음
  pull; build_api; api_restart
}

case_2() {  # sp-api + DB 마이그레이션
  pull
  if ask_stop; then
    api_stop; gen; migrate; build_api; api_start
  else
    gen; migrate; build_api; api_restart
  fi
}

case_3() {  # sp-vue(web) 만 — 정적(nginx 가 즉시 서빙, 재시작 불필요)
  pull; build_web
}

case_4() {  # sp-market 만 — 정적
  pull; build_market
}

case_5() {  # 풀 재배포 (api + web + market + DB)
  pull
  if ask_stop; then
    api_stop; gen; migrate; build_api; build_web; build_market; api_start
  else
    gen; migrate; build_api; build_web; build_market; api_restart
  fi
}

case_6() {  # sp-php(그누보드) 만 — 파일은 git pull 로 갱신, opcache 비우려 php-fpm reload
  step "코드 받기"; git -C "$ROOT" pull --ff-only
  php_reload
}

case_7() {  # nginx 설정만 reload
  nginx_reload
}

case_8() {  # .env 만 — systemd 는 시작시점 env 고정이라 재시작 필요
  api_restart
}

# ── 메뉴 ────────────────────────────────────────────────
choice="${1:-}"
if [[ -z "$choice" ]]; then
  cat <<'MENU'

배포 케이스를 선택하세요:
  1) sp-api(Node)만          — DB 스키마 변경 없음
  2) sp-api + DB 마이그레이션
  3) sp-vue(web)만           — 정적 빌드
  4) sp-market만             — 정적 빌드
  5) 풀 재배포 (api + web + market + DB)
  6) sp-php(그누보드)만       — git pull + php-fpm reload
  7) nginx 설정 reload
  8) .env만                  — sp-api 재시작
MENU
  read -rp "번호 [1-8]: " choice
fi

case "$choice" in
  1) case_1 ;;
  2) case_2 ;;
  3) case_3 ;;
  4) case_4 ;;
  5) case_5 ;;
  6) case_6 ;;
  7) case_7 ;;
  8) case_8 ;;
  *) echo "잘못된 선택: '$choice' (1-8)"; exit 1 ;;
esac

step "완료 — 서비스 상태"
for u in sp-api php8.1-fpm nginx mariadb; do
  printf '  %-10s %s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null || true)"
done
