#!/usr/bin/env bash
#
# 운영 서버 — 개발 프로토타입(G/C) 정리 + main 반영 (2026-09-10, docs/develop-prototypes.md)
#
#   1) git: origin 갱신 → main 으로 → ff pull → main 외 로컬 브랜치 전부 삭제(원격은 기본 유지)
#   2) DB : G 테이블 3개·제거된 마이그레이션 2행·설정 id=2 를 지운다(지우기 전 DB 전체 스냅샷). 없으면 "할 일 없음".
#   3) 배포: ./deploy.sh 5 (무중단 N 자동 응답 — 남은 마이그레이션은 C 테이블 CREATE 뿐이라 추가형)
#   4) 검증: 마이그레이션 상태 · /api/health · 옛 -c 경로 404 · 새 경로 401 · 서비스 상태
#
# 사용(유저 samplepcb, 어디서 실행해도 됨 — 파일을 서버 아무 곳에 올려 두고):
#   bash prod-develop-cleanup.sh                 # 각 단계 전에 물어본다
#   bash prod-develop-cleanup.sh --yes           # 묻지 않고 진행
#   옵션: --skip-db · --skip-deploy · --deploy-case N(기본 5) · --delete-remote(원격 프로토타입 브랜치 3개도 삭제)
#         --root /path/to/samplepcb-web-platform(기본 /home/samplepcb/samplepcb-web-platform)
#   sudo(systemctl) 암호 프롬프트는 deploy.sh 가 띄울 수 있다(tty 로 읽으므로 자동 응답과 무관).
#
# 원복: 로그 첫머리의 "이전 배포 커밋"으로 git checkout + 스냅샷 복원(docs/db-snapshot-rollback.md).
#       G 테이블은 이 스크립트가 만든 before-develop-g-rollback-* 스냅샷에 있다.

set -euo pipefail

ROOT="/home/samplepcb/samplepcb-web-platform"
YES=0; SKIP_DB=0; SKIP_DEPLOY=0; DELETE_REMOTE=0; DEPLOY_CASE=5
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) YES=1 ;;
    --skip-db) SKIP_DB=1 ;;
    --skip-deploy) SKIP_DEPLOY=1 ;;
    --delete-remote) DELETE_REMOTE=1 ;;
    --deploy-case) DEPLOY_CASE="${2:?--deploy-case N}"; shift ;;
    --root) ROOT="${2:?--root PATH}"; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "모르는 옵션: $1"; exit 1 ;;
  esac
  shift
done

MONO="$ROOT/samplepcb-web-mono-app"
API="$MONO/apps/api"
LOG="${HOME}/develop-cleanup-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m⚠\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
confirm() {
  [[ "$YES" == 1 ]] && return 0
  read -rp $'\n'"$1 [y/N] " a
  [[ "${a:-N}" =~ ^[Yy]$ ]] || die "중단했습니다."
}

[[ -d "$MONO" ]] || die "경로 없음: $MONO (--root 로 지정)"
command -v git >/dev/null || die "git 없음"
command -v pnpm >/dev/null || die "pnpm 없음(PATH)"
command -v node >/dev/null || die "node 없음(PATH)"
echo "로그: $LOG"
echo "실행 사용자: $(id -un) · 시각: $(date -Is)"

# ── 1) git ─────────────────────────────────────────────────────────────────────
step "git 상태"
cd "$ROOT"
PRE_HEAD="$(git rev-parse HEAD)"
PRE_BRANCH="$(git branch --show-current || true)"
echo "이전 배포 커밋: $PRE_HEAD (${PRE_BRANCH:-detached})"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  git status --short --untracked-files=no
  die "작업 트리에 커밋되지 않은 변경이 있습니다. 정리한 뒤 다시 실행해 주세요."
fi
git fetch --prune origin
echo "origin/main: $(git rev-parse --short origin/main) $(git log -1 --format=%s origin/main)"
echo "로컬 브랜치: $(git for-each-ref --format='%(refname:short)' refs/heads | tr '\n' ' ')"
confirm "main 으로 전환·ff pull 하고 main 외 로컬 브랜치를 전부 삭제할까요?"

step "main 으로 전환·최신화"
if [[ "$PRE_BRANCH" != "main" ]]; then git switch main; fi
git pull --ff-only origin main
ok "main = $(git rev-parse --short HEAD) $(git log -1 --format=%s)"

step "main 외 로컬 브랜치 삭제"
deleted=0
while IFS= read -r b; do
  [[ -z "$b" || "$b" == "main" ]] && continue
  git branch -D "$b" && deleted=$((deleted+1))
done < <(git for-each-ref --format='%(refname:short)' refs/heads)
git worktree prune
ok "삭제 $deleted개 · 남은 브랜치: $(git for-each-ref --format='%(refname:short)' refs/heads | tr '\n' ' ')"
REMOTE_PROTOS=(prototype/develop-g-c prototype/develop-workflow feat/develop-workflow-docs)
if [[ "$DELETE_REMOTE" == 1 ]]; then
  step "원격 프로토타입 브랜치 삭제(태그 proto-gc-coexist-20260910 은 유지)"
  for b in "${REMOTE_PROTOS[@]}"; do
    if git ls-remote --exit-code --heads origin "$b" >/dev/null 2>&1; then git push origin --delete "$b" && ok "origin/$b 삭제"; else echo "  origin/$b 없음"; fi
  done
else
  echo "  원격 브랜치는 그대로 둔다(지우려면 --delete-remote): $(git ls-remote --heads origin "${REMOTE_PROTOS[@]}" 2>/dev/null | awk '{print $2}' | sed 's#refs/heads/##' | tr '\n' ' ')"
fi

# ── 2) DB ──────────────────────────────────────────────────────────────────────
if [[ "$SKIP_DB" == 1 ]]; then
  warn "DB 정리 건너뜀(--skip-db)"
else
  step "의존성·Prisma 클라이언트 준비(새 코드 기준)"
  (cd "$MONO" && pnpm install --frozen-lockfile && pnpm --filter api db:generate)
  step "DB — G 잔재 확인(dry-run)"
  (cd "$API" && node --env-file=.env --import tsx src/scripts/develop-g-rollback.ts)
  if (cd "$API" && node --env-file=.env --import tsx src/scripts/develop-g-rollback.ts --check) | grep -q '"work":true'; then
    confirm "위 항목을 지울까요? (먼저 DB 전체 스냅샷을 남긴다)"
    step "DB — 스냅샷 → G 테이블·마이그레이션 행·설정 id=2 삭제"
    (cd "$API" && node --env-file=.env --import tsx src/scripts/develop-g-rollback.ts --yes --code-ref "$PRE_HEAD")
    ok "DB 정리 완료"
  else
    ok "DB 에 지울 G 잔재가 없다"
  fi
fi

# ── 3) 배포 ────────────────────────────────────────────────────────────────────
if [[ "$SKIP_DEPLOY" == 1 ]]; then
  warn "배포 건너뜀(--skip-deploy)"
else
  confirm "./deploy.sh $DEPLOY_CASE 를 무중단(N)으로 실행할까요? (남은 마이그레이션은 C 테이블 CREATE 만)"
  step "배포 ./deploy.sh $DEPLOY_CASE"
  (cd "$ROOT" && printf 'N\n' | ./deploy.sh "$DEPLOY_CASE")
fi

# ── 4) 검증 ────────────────────────────────────────────────────────────────────
step "검증"
API_PORT=3333
if [[ -f "$API/.env" ]]; then API_PORT="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' "$API/.env" | head -1 || true)"; fi
API_PORT="${API_PORT:-3333}"
(cd "$API" && node --env-file=.env --import tsx src/scripts/develop-g-rollback.ts --check) || warn "상태 조회 실패"
code() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${API_PORT}$1" 2>/dev/null || true; }
# systemctl restart 는 포트가 열리기 전에 돌아오므로 sp-api 가 응답할 때까지 최대 30초 기다린다(2026-09-11 운영 1차 실행에서 000 오탐).
for _ in $(seq 1 30); do [[ "$(code /api/health)" == 200 ]] && break; sleep 1; done
h="$(code /api/health)";                        [[ "$h" == 200 ]] && ok "/api/health $h" || warn "/api/health $h"
o="$(code /api/admin/develop-c/requests)";     [[ "$o" == 404 ]] && ok "옛 /api/admin/develop-c → $o" || warn "옛 -c 경로가 $o (404 기대)"
w="$(code /api/admin/develop/requests)";       [[ "$w" == 401 ]] && ok "새 /api/admin/develop → $w(인증 필요)" || warn "새 경로가 $w (401 기대)"
for u in sp-api nginx mariadb; do printf '  %-8s %s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null || echo '?')"; done
echo
echo "끝. 이전 배포 커밋 $PRE_HEAD · 로그 $LOG"
echo "원복: git -C $ROOT checkout $PRE_HEAD && ./deploy.sh $DEPLOY_CASE, DB 는 스냅샷 복원(docs/db-snapshot-rollback.md)."
