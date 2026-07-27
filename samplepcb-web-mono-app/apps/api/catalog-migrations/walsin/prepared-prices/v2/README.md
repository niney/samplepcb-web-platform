# Walsin R/C 가격 스냅샷 v2

기존 DigiKey·Mouser·UniKeyIC v1에 Eleparts·ICBanQ의 검증된 부가세 포함 KRW 가격을
합친 재적재용 불변 스냅샷이다. 재고·MOQ·주문배수는 국내 판매처 응답에서 만들지 않았다.

## 적용 파일

- `walsin-price-snapshot-v2.json.gz`
- `manifest.json`
- 스냅샷 SHA-256:
  `60922524787370d7c099de39b10ed578134870cfc646663c832deceec13225b0`
- 원본 SHA-256:
  `7aa0c323e02e11ec67086546f5dae47d38f83748732dea0eb463b3ef19433e6c`

DB·ES 초기화 후에도 외부 사이트를 다시 호출하지 않고 다음처럼 적용한다.

```bash
pnpm --filter api parts:catalog -- --dry-run --source walsin-rlc \
  --price-snapshot catalog-migrations/walsin/prepared-prices/v2/walsin-price-snapshot-v2.json.gz
pnpm --filter api parts:catalog -- --apply --source walsin-rlc \
  --price-snapshot catalog-migrations/walsin/prepared-prices/v2/walsin-price-snapshot-v2.json.gz
pnpm --filter api parts:catalog -- --verify-search --source walsin-rlc \
  --price-snapshot catalog-migrations/walsin/prepared-prices/v2/walsin-price-snapshot-v2.json.gz
```

## 출처 capture

- `market/eleparts-capture-v1.json.gz`: 2,628개 전수, 가격 487개, 오류 0
- `market/icbanq-capture-v1.json.gz`: 2,628개 전수, 가격 443개, 제조사 충돌 제외 4개, 오류 0
- 각 capture의 manifest가 원본 SHA, 파일 SHA, 제조사별 coverage를 고정한다.

Eleparts·ICBanQ 공통 가격 대상은 433개다. 부가세 포함 가격이 낮은 판매처를 사용하고,
동률이면 Eleparts를 사용한다. 사이트 안에 표시되는 DigiKey·Mouser 등의 출처 라벨은
별도 공급사 오퍼가 아니라 감사 메타데이터로만 보존한다.

v2 결과는 2,628개 중 가격 보유 522개다. v1의 502개보다 Walsin 10개와 Samsung
10개가 늘었다. 생성·재개·검증 명령과 전체 제조사별 결과는 상위
[README.md](../../README.md)의 `국내 판매처 가격 보강(v2)`를 따른다.
