#!/usr/bin/env bash
# samplepcb-parts-engine 실행 (macOS / Linux)
#   사용: ./run.sh                    (기본 포트 8400)
#         ./run.sh 8500
#         PARTS_ENGINE_PORT=8500 ./run.sh
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-${PARTS_ENGINE_PORT:-8400}}"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv 가 설치되어 있지 않습니다. 설치: https://docs.astral.sh/uv/  (brew install uv)" >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo ".env 생성(.env.example 복사) — 공급사 검색을 쓰려면 키를 채우세요."
fi

echo "uv sync ..."
uv sync

echo "엔진 시작 -> http://127.0.0.1:${PORT}  (/health, /docs)  ·  Ctrl+C 종료"
exec uv run uvicorn parts_engine_app.main:app --host 127.0.0.1 --port "${PORT}" --reload
