# 발송 이력 원장 (sp_mail_log) — 전 채널 이력관리

> 정본. 2026-08-07 도입(§6.19 빠른 메일의 "Case 상세 '보낸 메일' 표시는 후속" 약속 이행 + 전 채널 일반화).
> 관련: docs/SMARTBOM_PARTNER_RFQ.md §6.19(빠른 메일), docs/PCB_PARTNER_TRACK.md §5.4(알림 메일).

## 1. 무엇인가

플랫폼이 보내는 **모든 채널(email·alimtalk·sms)의 발송 시도**를 한 테이블(`sp_mail_log`)에
남기는 공용 원장이다. 성공만이 아니라 **실패(failed)·스킵(skipped)** 도 기록한다 — "고객이
메일을 못 받았다" CS 때 발송 시도 여부·실패 사유·게이트 스킵을 확인하고 재발송 대상을
찾는 것이 이 이력의 절반의 가치다.

- 원칙: **기록은 발송의 부수 원장이지 발송 조건이 아니다.** 기록 실패는 어떤 경우에도
  발송 흐름·API 응답을 깨지 않는다(`recordMailLog` 는 throw 하지 않음).
- 발송 의도가 없던 경우(예: 관리자가 "이메일 발송" 체크를 끔)는 기록하지 않는다.
  의도했으나 못 보낸 경우(게이트 꺼짐·수신자 없음)만 skipped 로 남는다.

## 2. 스키마 (Prisma `SpMailLog` ↔ `sp_mail_log`)

| 컬럼 | 의미 |
| --- | --- |
| `kind` | 발송 종류 코드 — 메일 빌더와 1:1(아래 §5 코드표) |
| `refType`/`refId` | 컨텍스트 앵커(FK 없는 참조 — 원본 삭제 후에도 로그 보존): `bom_quote`·`pcb_spec`·`order`(odId)·`market_project`·`market_contract`·`market_expert` |
| `channel` | `email` · `alimtalk` · `sms` |
| `status` | `sent` · `failed` · `skipped` |
| `reason` | failed/skipped 사유: `send_failed` 상세 메시지, `mail_unavailable`(cf_email_use=0), `missing_recipient`, `php_skipped`(PHP 게이트/수신처 없음), `alimtalk_unavailable`, `missing_order` |
| `recipient` | 이메일 또는 전화번호. `''`=발송 주체가 수신처를 모름(PHP 브리지 — od_email 은 PHP 가 해석) |
| `toMbId` | 수신 회원 mbId(아는 경우만) |
| `subject`/`body` | 제목 / **본문은 수동 메일(quick_mail)만 원문 보존** — 자동 알림은 null |
| `params` | 자동 알림의 빌더 파라미터 요약(JSON) — body 대신 남기는 표시·재현용(빌더=순수 함수) |
| `attachments` | 첨부 메타 `[{name,size,mime}]` — 실파일 비보관 |
| `sentBy` | 트리거 주체 mbId(관리자·파트너·고객) — **null=시스템**(매직링크 무로그인·lazy 승격·자동확정) |

인덱스: `(refType, refId, createdAt)` + `(createdAt)`.
`sp_delete_audit` 의 subjectType/subjectId 와 같은 일반화인데, 메일 제목 컬럼(`subject`)과의
충돌을 피해 `refType/refId` 로 명명했다. 마이그레이션 `20260807170000_generalize_mail_log`
(기존 quick_mail 행은 `refType='bom_quote'` 로 backfill, `quoteId`·`toEmail` 컬럼은
`refId`·`recipient` 로 승계). 공유 DB — 추가 전용 + `migrate deploy` 규율 그대로.

## 3. 기록 지점 — 어디서 남나

새 발송을 추가할 때 **래퍼를 쓰면 이력은 자동**이다. 래퍼 밖 직송을 만들면 반드시
`recordMailLog` 를 직접 호출할 것.

| 계층 | 파일 | 커버 |
| --- | --- | --- |
| 도메인 래퍼 3종(meta 필수 인자) | `lib/rfq-email.ts` `sendBomRfqMail` · `lib/pcb-rfq-email.ts` `sendPcbMail` · `lib/market-email.ts` `sendMarketMail` | BOM·PCB·마켓 자동 알림 전부(관리자·파트너·고객·매직링크 트리거 ~37개 호출부). 수신자 없음 skipped 도 래퍼가 기록 |
| 직접 발송 라우트 | `routes/admin-mail.ts`(빠른 메일 — 실패도 기록으로 정책 변경, body 원문 보존) · `routes/admin-pcb-projects.ts` send-estimate(메일+**알림톡 채널** 각 1행) | 관리자 수동 발송 |
| PHP 브리지 | `routes/admin-orders.ts` `notifyOrderEventLogged`(입금·배송 전이, 송장 업로드) | 그누보드 ordermail 이 실제 발송 — sp-node 는 채널별 결과(sent/failed/skipped)만 기록, **PHP 무수정** |
| 공용 헬퍼 | `lib/mail-log.ts` `recordMailLog(log, meta, entry)` — throw 없음, 과길이 절단 | |

## 4. 조회

- API(관리자): `GET /api/admin/mail-logs`(필터: refType+refId·kind·channel·status·recipient
  부분일치·dateFrom/dateTo KST) · `GET /api/admin/mail-logs/:id`(body 원문 포함).
  목록은 `hasBody` 만 노출(본문은 단건). 계약 `packages/api-contract/src/schemas/admin-mail.ts`.
- UI: 코어 모듈 **[발송 이력]** `/app/admin/mail-logs`(전역, 필터 바) + SmartBOM/PCB
  **Case 상세 '보낸 메일' 접힘 섹션**(컨텍스트 고정 임베드). 둘 다
  `components/admin/MailLogList.vue` 하나를 공유한다(행 클릭=확장 상세).

## 5. kind 코드표 (빌더 1:1)

- 수동: `quick_mail`(빠른 메일) · `estimate`(견적서 — email/alimtalk 2행)
- BOM: `bom_rfq_request` · `bom_quote_answered` · `bom_po_issued` ·
  `bom_shipment_turn_admin|partner` · `bom_shipment_received`
- PCB: `pcb_rfq_request` · `pcb_rfq_replied` · `pcb_po_issued` · `pcb_eq_requested` ·
  `pcb_eq_decision` · `pcb_eq_customer_request|decision` · `pcb_produced` ·
  `pcb_shipment_turn` · `pcb_shipment_received`
- 주문(PHP 브리지): `order_deposit` · `order_delivery` (`order_ready`·`order_complete` 는 예약)
- 마켓: `market_targeted_request` · `market_new_bid` · `market_award` ·
  `market_expert_decision` · `market_contract_paid|delivered|confirmed|settled`

sp-vue 라벨은 i18n `admin.mailLogs.kind.*` — 미등록 코드는 원문 노출(catchall)이라
서버에 kind 를 추가해도 UI 가 깨지지 않는다.

## 6. P3 — 재발송·실패 위젯·보존 기간 (2026-08-07)

- **재발송** `POST /api/admin/mail-logs/:id/resend {toEmail?}` — **원문(body)이 보존된
  수동 메일(quick_mail·email)만**(그 외 409 NOT_RESENDABLE). 수신자 교정 재발송이 실제
  CS 케이스라 주소를 바꿀 수 있다. 결과는 새 이력 행(`params.resendOfLogId` 로 원본 연결,
  sentBy=재발송 관리자). 첨부 실파일은 미보관이라 재발송에 실리지 않는다(UI 고지).
  자동 알림은 여기서 재조립하지 않는다 — 각 트랙의 재발송 수단(회신 재발송·견적서
  발송 버튼·RFQ 매직링크 재발급)이 정본이고, 이력에선 Case 링크로 이동한다.
- **대시보드 실패 위젯**(AdminDashboard 첫 위젯) — 최근 7일 `status=failed` 카운트+최근
  5건(skipped 는 게이트 정상 동작이 다수라 제외). [모두 보기]는 전역 페이지의 URL 쿼리
  프리셋(`/app/admin/mail-logs?status=failed`)으로 연다(status·kind·channel·date 지원).
- **보존 기간** — sp_config `mail_log_retention_days`(**기본 180**, `0`=무제한, 설정 UI
  없음 — DB 키 직접 수정). server.ts 가 기동 시+6시간마다 `cleanupExpiredMailLogs` 실행:
  createdAt 컷오프 이전 행을 1,000행 청크(회당 최대 5만)로 삭제해 대량 DELETE 락을 피한다.

## 7. 검증

- 유닛 `apps/api/src/lib/mail-log.test.ts` 12케이스: 기록 필드 정합·DB 실패 무해성·절단·
  래퍼 성공/스킵/실패/이력실패 불변식 + retention(기본값·0 무제한 no-op·청크 정지·오류 무해).
- E2E(로컬 실스택, ALL PASS 2026-08-07): 발송→Mailpit 실수신→목록/단건 정합→무인증 401 /
  재발송 왕복(새 행·resendOfLogId·본문 승계·Mailpit 2통)→NOT_RESENDABLE 409→retention
  실삭제(오래된 행만 제거·최근 행 보존).
- 브라우저 실탐방: 대시보드 위젯(0건·1건 상태)→프리셋 링크→행 확장 재발송(성공 메시지+
  목록 자동 갱신) 확인. 기존 유닛 663개 무회귀.
