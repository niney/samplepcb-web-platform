# e2e/fixtures — 테스트 픽스처

## Smart BOM

- `bom-journey-1-diverse.csv` — BOM 완주 여정 1호용 소형 혼합 BOM. 정확 MPN과
  무품번 파라메트릭 품목, 복수 Reference, DNP/수량 0, IC·저항·커패시터·다이오드·
  인덕터·LED·커넥터·MOSFET·테스트포인트를 한 파일에서 검증한다. 시나리오는 이 파일의
  행 수를 후속 API에 하드코딩하지 않고, 엔진이 활성화한 품목 전체를 동적으로 RFQ·선정·
  발주·포장한다.
- `partner-stock-eureka-sample.csv` + `bom-partner-stock-match.csv` — **짝으로 쓰는 두 본**
  (`partner-parts-bom-search.e2e.test.ts`). 앞은 협력사가 올리는 브로커 재고표 서식, 뒤는
  고객이 올리는 BOM 이고 품번이 **일부러 겹친다**. 품번은 실물 `EUREKA-stock parts 8.6.xlsx`
  에서 뽑은 진짜 값이라, 흔한 것(MCP1700T·PIC16F1825T)은 DigiKey·Mouser 가 함께 잡히고
  단종·희귀(ADUC7020BCPZ62I-R7·88PW886-B1-NFHIC000-T)는 협력사만 남는 자리를 만든다.
  `LPC2387FBD100` 은 재고표에 `LPC2387FBD100,551`(NXP 포장 코드)로 적혀 있어 **대체 조회 키**
  를 검증한다. ⚠ 수량과 Reference 개수를 어긋나게 쓰면 그 행이 `included=false` 로 빠져
  관리자 보유 조회에서 사라진다 — 픽스처를 고칠 때 함께 맞출 것.

- BOM 4호는 엔진 입력 픽스처가 아니라 `journey-bom-reorder.e2e.test.ts` 안의 확정 거래
  스냅샷을 쓴다. 저항·MLCC와 MCU·커넥터 두 Case를 코드로 명시해 묶음 주문 이후의
  부분취소·재주문·감사 이력만 독립적으로 반복 검증한다.

## 거버 보드 zip (업로드 E2E 용)

거버 뷰어 프로젝트 자체 테스트 픽스처(`sp-gerber-eye-v3\test\fixtures-boards\*` —
tracespace 계열 공개 테스트 보드)를 보드별로 그대로 zip 한 것(전부 뷰어 제한 5MB 이내).
재생성: `Compress-Archive -Path <fixtures-boards>\<board>\* -DestinationPath <board>.zip`

| zip                                                                                                    | 검증 상태                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| arduino-uno.zip                                                                                        | **검증 완료(2026-08-10)** — 빈 프로필 `setInputFiles` → 파싱 → 가격 35,000원 → [견적요청] 노출(pageerror 0). 실브라우저 제출 완주도 동일 보드로 실증 |
| 8bit-mixtape.zip · bus-pirate.zip · clockblock.zip · core.zip · freeduino.zip · mchck.zip · usbvil.zip | zip 생성만 — 일괄 검증 도구로 판정 후 사용                                                                                                           |

- **일괄 검증**: 거버 dev 서버(8040)+nginx 켠 상태에서
  `node e2e/tools/verify-gerber-fixtures.mjs` — 각 zip 을 업로드해 파싱·가격·버튼
  노출을 판정(제출 없음 — 서버 무접촉). 이름 필터 인자 지원.
- 가격은 라이브 가격표(pricing_data.json) 기준으로 유동 — 시나리오는 특정 금액이
  아니라 "가격 텍스트 존재"로 대기·검증할 것.

## 사적/실고객 보드로 돌려보고 싶다면

`fixtures/local/`(gitignore — 커밋 안 됨)에 zip 을 넣으면 일괄 검증 도구가 함께
집어 든다. 고객 설계 파일·PII 가 있는 보드는 반드시 local/ 에만 둘 것.
