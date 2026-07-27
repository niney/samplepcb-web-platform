# Walsin 공급사 가격 사전 데이터

이 폴더는 승인된 Walsin R/C AVL 원본 2,628개를 공급사 API에서 exact MPN+제조사로
한 번 조회한 재현 가능한 적용 입력을 보관한다.

- `walsin-price-snapshot-v1.json.gz`: exact 공급사 product/offer와 가격·재고
- `manifest.json`: 원본·스냅샷 SHA-256, 크기, coverage 집계
- `work-state.json`: 생성 중 재개 상태로 Git 제외하며 최종 검증 뒤 삭제 가능
- `v2/walsin-price-snapshot-v2.json.gz`: v1에 Eleparts·ICBanQ 검증 가격을 합친 현재 적용본
- `v2/manifest.json`: v2 원본·스냅샷 SHA-256과 coverage
- `v2/market/*-capture-v1.json.gz`: 사이트별 2,628개 전수 결과와 가격 근거

공급사별 rate limit 또는 의도적 미조회는 레코드 `warnings`와 manifest의
`supplierErrorRecords`에 보존한다. 배치 전체 타임아웃은 완료로 인정하지 않아
누락을 정상 `not_found`로 가장하지 않는다.

현재 스냅샷의 `supplierErrorRecords=371`은 전부 생성 후반 DigiKey `429`를 확인한 뒤
의도적으로 남긴 `digikey: not_requested_for_snapshot`이다. Mouser·UniKeyIC 오류와
판정 불가능한 전체 타임아웃은 없다.

스냅샷은 공급사 응답 시점의 가격이며 자동 갱신하지 않는다. 적용 시 같은 identity의
`sp_part` 한 행 아래 실제 공급사 오퍼를 저장하고, 가격이 있는 오퍼를 근거로 SamplePCB
판매 오퍼의 가격구간을 파생한다.

생성·검증·운영 적용 명령은 상위 [README.md](../README.md)를 따른다.
