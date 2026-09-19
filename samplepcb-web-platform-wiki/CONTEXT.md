# Codebase Wiki — Navigation Guide

This project has a compiled knowledge wiki. Use it instead of scanning raw files.

## How to use this wiki

1. Start at INDEX.md — scan the topic table to find relevant modules
2. Read 1-3 topic articles relevant to your current task
3. Check coverage tags:
   - [coverage: high] — trust this section, skip raw files
   - [coverage: medium] — good overview, check raw sources for implementation details
   - [coverage: low] — read the raw source files listed in Sources
4. Check concepts/ for cross-cutting patterns (17종 — 판단 단일 소유권·서버 단일 진실·스냅샷 박제·lazy 파생·코어 비수정·수동 동기화 드리프트·비동기 잡·관리/소비 브릿지 + 2026-09 신설 9종: 공유vs격리 경계·워크큐 척추·여정 재점검 루프·골든=명세·예외 원장·앱 온보딩·파괴 작업 가드레일·GET 무부작용·네이티브 대화상자 금지)
5. Only read raw source files when you need code-level detail

## When NOT to use the wiki
- Writing new code (read the actual source files for exact syntax/types)
- Debugging a specific function (go to the file directly)
- The wiki article says [coverage: low] for what you need

## Stats
Compiled: 2026-09-19 | Topics: 14 | Concepts: 17 | Sources: 82 | Auto-updates: prompt on stale
