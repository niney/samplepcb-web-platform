#!/usr/bin/env bash
#
# 그누보드 코어 "최소 수정(기록된 예외)"이 살아있는지 검사하는 가드.
#
# 왜 필요한가: samplepcb-web/ 은 그누보드 subtree(원본 복사본)라 `git subtree pull` 이
#   원본으로 덮어쓴다. 우리가 부득이 코어에 넣은 한 줄 수정이 **충돌 경고 없이 조용히
#   되돌려질 수 있고**, 그러면 대형 장애(예: 이메일 아이디 회원 전원 로그인 불가)가
#   나는데도 아무도 즉시 알아채지 못한다. 이 스크립트가 그 "조용한 되돌림"을 잡는다.
#
# 언제 실행: `git subtree pull` 직후 반드시. (CI/pre-commit 에 걸어두면 더 안전)
# 실패(exit 1) = 코어 수정이 사라짐 → 아래 안내대로 재적용 후 재실행.
#
# 배경: docs/UPSTREAM_SYNC.md · docs/LEGACY_DB_MIGRATION.md §8
#
set -euo pipefail
cd "$(dirname "$0")/../.."   # 플랫폼 루트

FAIL=0

# assert_contains <설명> <파일(루트 기준)> <있어야 할 고정문자열> <복구 안내>
assert_contains() {
  local desc="$1" file="$2" needle="$3" fix="$4"
  if [ ! -f "$file" ]; then
    echo "  ❌ $desc — 파일 없음: $file"
    FAIL=1
    return
  fi
  if grep -qF -- "$needle" "$file"; then
    echo "  ✅ $desc"
  else
    echo "  ❌ $desc"
    echo "       파일: $file"
    echo "       조치: $fix"
    FAIL=1
  fi
}

echo "── 그누보드 코어 최소 수정 가드 ──"

# ① 이메일 형식 mb_id 로그인: get_member() 문자 필터에 @ . - 허용
#    원본 코어는 [^0-9a-z_] → 이메일 아이디(@·.)를 "없는 회원"으로 거부한다.
#    이 수정이 없으면 레거시 이관 이메일 아이디 회원(수천 명)이 전원 로그인 불가.
assert_contains \
  "get_member 이메일 아이디 허용 (필터 [^0-9a-z_@.\\-])" \
  "samplepcb-web/lib/common.lib.php" \
  '0-9a-z_@' \
  "get_member() 의 mb_id 필터를 [^0-9a-z_] → [^0-9a-z_@.\\-] 로 재적용 (docs/LEGACY_DB_MIGRATION.md §8). 근처에 '[samplepcb 코어 최소 수정]' 주석."

# (앞으로 다른 코어 최소 수정이 생기면 위 형식으로 assert_contains 를 추가한다.)

if [ "$FAIL" -ne 0 ]; then
  echo "── ❌ 가드 실패: 위 코어 수정이 사라졌습니다. 재적용 후 다시 실행하세요. ──" >&2
  exit 1
fi
echo "── ✅ 전부 통과 ──"
