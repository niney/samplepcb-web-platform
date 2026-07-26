# 연호전자 공급사 가격 사전 데이터

승인된 연호전자 커넥터 Rev2 공식 MPN 1,606개를 공급사 API에서
`exact MPN + manufacturer=yeonho`로 한 번 조회한 적용 입력을 보관한다.

- `yeonho-price-snapshot-v1.json.gz`: exact 공급사 product/offer와 가격·재고
- `manifest.json`: 원본·스냅샷 SHA-256, 크기, coverage 집계
- `work-state.json`: 생성 중 재개 상태로 Git에서 제외

다른 제조사의 동일 MPN, 유사 시리즈·핀 수 대체품은 가격 근거로 사용하지 않는다.
외부 공급사 오퍼는 원문 가격·재고를 저장하지만, SamplePCB 오퍼에는 선택된 한
공급사의 가격곡선만 복사하고 외부 재고는 복사하지 않는다. 정확 공급사 가격이
없는 품목도 SamplePCB 문의 견적으로 계속 취급한다.

## 2026-07-27 생성 결과

- 원본 대상/coverage: 1,606 / 1,606
- exact MPN+제조사 가격: 3개 (`SMH200-04`, `SMH250-02`, `YST200`)
- exact 상품/공급사 오퍼/가격 구간: 3 / 3 / 17
- 미일치: 1,603개
- API 호출: 5,915회
- 스냅샷 SHA-256: `c15f5203bb1c39a98ed79f337e2cbee21cdff10053d57c82eb3853eeff3e6cbb`
- 공급사 감사 경고: DigiKey 미조회 1,606건, Mouser HTTP 403 279건

DigiKey 전수 단계는 HTTP 429와 300초 작업 상한으로 중단했다. 현재 산출물은 원본·파일
해시와 전체 coverage를 검사하는 표준 `--verify`를 통과하지만, 모든 공급사 성공을 요구하는
`--require-all-suppliers`는 위 1,885개 경고 때문에 의도대로 실패한다.

생성·검증·운영 적용 명령은 상위 [README.md](../README.md)를 따른다.
