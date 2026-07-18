#!/usr/bin/env pwsh
# samplepcb-parts-engine 실행 (Windows / PowerShell)
#   사용: .\run.ps1            (기본 포트 8400)
#         .\run.ps1 -Port 8500
# 참고: 8100 대는 Windows(Hyper-V/WSL) 예약 범위에 걸릴 수 있어 8400 을 기본으로 쓴다.
[CmdletBinding()]
param([int]$Port = 8400)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Error 'uv 가 설치되어 있지 않습니다. 설치: https://docs.astral.sh/uv/  (winget install astral-sh.uv)'
  exit 1
}

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host '.env 생성(.env.example 복사) — 공급사 검색을 쓰려면 키를 채우세요.' -ForegroundColor Yellow
}

Write-Host 'uv sync ...' -ForegroundColor Cyan
uv sync

Write-Host "엔진 시작 -> http://127.0.0.1:$Port  (/health, /docs)  ·  Ctrl+C 종료" -ForegroundColor Green
uv run uvicorn parts_engine_app.main:app --host 127.0.0.1 --port $Port --reload
