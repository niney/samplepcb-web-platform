# Codebase Wiki — Navigation Guide

This project has a compiled knowledge wiki. Use it instead of scanning raw files.

## How to use this wiki

1. Start at INDEX.md — scan the topic table to find relevant modules
2. Read 1-3 topic articles relevant to your current task
3. Check coverage tags:
   - [coverage: high] — trust this section, skip raw files
   - [coverage: medium] — good overview, check raw sources for implementation details
   - [coverage: low] — read the raw source files listed in Sources
4. Check concepts/ for cross-cutting patterns (코어 비수정 기법, 서버 단일 진실, 수동 동기화 드리프트)
5. Only read raw source files when you need code-level detail

## When NOT to use the wiki
- Writing new code (read the actual source files for exact syntax/types)
- Debugging a specific function (go to the file directly)
- The wiki article says [coverage: low] for what you need

## Stats
Compiled: 2026-07-03 | Topics: 9 | Sources: 18 | Auto-updates: prompt on stale
