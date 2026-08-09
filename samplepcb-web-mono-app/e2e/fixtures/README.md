# e2e/fixtures — 테스트 픽스처

## 거버 보드 zip (업로드 E2E 용)

거버 뷰어 프로젝트 자체 테스트 픽스처(`sp-gerber-eye-v3\test\fixtures-boards\*` —
tracespace 계열 공개 테스트 보드)를 보드별로 그대로 zip 한 것(전부 뷰어 제한 5MB 이내).
재생성: `Compress-Archive -Path <fixtures-boards>\<board>\* -DestinationPath <board>.zip`

| zip | 검증 상태 |
|---|---|
| arduino-uno.zip | **검증 완료(2026-08-10)** — 빈 프로필 `setInputFiles` → 파싱 → 가격 35,000원 → [견적요청] 노출(pageerror 0). 실브라우저 제출 완주도 동일 보드로 실증 |
| 8bit-mixtape.zip · bus-pirate.zip · clockblock.zip · core.zip · freeduino.zip · mchck.zip · usbvil.zip | zip 생성만 — 일괄 검증 도구로 판정 후 사용 |

- **일괄 검증**: 거버 dev 서버(8040)+nginx 켠 상태에서
  `node e2e/tools/verify-gerber-fixtures.mjs` — 각 zip 을 업로드해 파싱·가격·버튼
  노출을 판정(제출 없음 — 서버 무접촉). 이름 필터 인자 지원.
- 가격은 라이브 가격표(pricing_data.json) 기준으로 유동 — 시나리오는 특정 금액이
  아니라 "가격 텍스트 존재"로 대기·검증할 것.

## 사적/실고객 보드로 돌려보고 싶다면

`fixtures/local/`(gitignore — 커밋 안 됨)에 zip 을 넣으면 일괄 검증 도구가 함께
집어 든다. 고객 설계 파일·PII 가 있는 보드는 반드시 local/ 에만 둘 것.
