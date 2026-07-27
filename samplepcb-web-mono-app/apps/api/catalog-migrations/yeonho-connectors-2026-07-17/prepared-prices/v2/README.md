# 연호전자 가격 스냅샷 v2

기초 v1의 Mouser·UniKeyIC exact 결과와 Eleparts·ICBanQ 전수 capture를 병합한 현재
적용본이다. DB·ES를 초기화해도 외부 사이트를 다시 호출하지 않고 동일 데이터를 복원한다.

- 대상: 1,606개
- 가격 보유: 162개(v1 3개 대비 +159)
- exact product/오퍼/가격구간: 205 / 205 / 219
- Eleparts/ICBanQ 가격: 각 101개, 국내 합집합 162개
- ICBanQ 제조사 충돌 제외: 54개
- 스냅샷 SHA-256:
  `48428ee9f376e9b27200e564ceb43b0fe483db131674d13d3a6dceeec9934bad`

적용:

```bash
cd samplepcb-web-mono-app

pnpm --filter api parts:catalog -- --dry-run --source yeonho \
  --price-snapshot catalog-migrations/yeonho-connectors-2026-07-17/prepared-prices/v2/yeonho-price-snapshot-v2.json.gz

pnpm --filter api parts:catalog -- --apply --source yeonho \
  --price-snapshot catalog-migrations/yeonho-connectors-2026-07-17/prepared-prices/v2/yeonho-price-snapshot-v2.json.gz

pnpm --filter api parts:catalog -- --verify-search --source yeonho \
  --price-snapshot catalog-migrations/yeonho-connectors-2026-07-17/prepared-prices/v2/yeonho-price-snapshot-v2.json.gz
```

`market/*-work-state.json`은 재개용 로컬 상태라 Git에서 제외한다. 압축 capture와 manifest는
원본 coverage, exact MPN·제조사 판정, 응답 해시를 다시 검증하는 감사 근거다.
