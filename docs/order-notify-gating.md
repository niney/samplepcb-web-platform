# 주문 알림(메일/SMS) 체크박스 노출 게이트 — 결정 기록

관리자 주문 처리(입금·배송 전이)에서 "안내 메일 / 안내 SMS" 체크박스를
**언제 노출할지**에 대한 sp-vue 정책과, 그것이 코어(그누보드/영카트)와 왜 다른지를 기록한다.

## 배경 — 코어는 화면마다 게이트가 엇갈린다

같은 메일/SMS 발송 옵션인데 코어의 두 화면이 서로 다르게 동작한다.

| 화면 | 파일·위치 | 노출 게이트 | 설정 꺼졌을 때 |
|---|---|---|---|
| 주문 **목록** | `adm/shop_admin/orderlist.php:475` | 주문상태(`주문`/`준비`)만 · **설정 무관** | 체크박스 뜸 → 발송 시 조용히 skip |
| 주문 **상세** | `adm/shop_admin/orderform.php:717·825·851` | **설정 게이트** (`cf_sms_use && de_sms_use4/5`, `cf_email_use`) | 체크박스 숨김 |

즉 **상세는 설정대로 게이트(올바름)**, **목록은 설정을 무시(결함)**. 목록에서는 SMS가
꺼져 있어도 체크박스가 뜨고, 관리자가 체크해도 아무 통지 없이 발송이 skip되어
"보낸 줄 알았는데 안 나감"이 성립한다.

추가로, 코어 상세의 SMS 노출 조건(`cf_sms_use`가 truthy)과 실발송 조건이 미묘하게
어긋난다. 실발송(`adm/shop_admin/orderlistupdate.php`, `spcb/api/order-notify.php:119`)은
정확히 `cf_sms_use === 'icode'`를 요구하므로, `cf_sms_use`에 icode 아닌 값이 들어가면
상세는 SMS를 노출하지만 발송은 skip되는 틈이 생긴다.

## 결정

sp-vue는 목록·상세를 **하나의 정책으로 일관 게이트**한다. 코어 상세의 올바른 동작을
기준으로 삼되, 조건은 **실발송과 정합**하도록 좁힌다.

- **메일**: `cf_email_use`
- **SMS(입금 전이)**: `cf_sms_use === 'icode' && de_sms_use4`
- **SMS(배송 전이)**: `cf_sms_use === 'icode' && de_sms_use5`

설정이 꺼진 채널은 체크박스를 **숨긴다**(코어 상세와 동일한 표현). 이로써
"노출됐는데 실제론 안 나감"이 원천 차단된다 — 코어 목록의 결함을 교정하고,
코어 상세보다도 한 단계 정확하다.

> 이는 코어 목록(`orderlist.php`)과 **의도적으로 다르게** 동작한다(패리티 이탈).
> 목록의 무조건 노출은 결함으로 판단해 따르지 않는다.

## 구현

정책은 서버가 계산해 boolean만 내려주고, FE는 소비만 한다.

- 계약: `packages/api-contract/src/schemas/orders.ts` — `AdminNotifyConfigResponse`
  (`mailAvailable` / `smsDepositAvailable` / `smsShippingAvailable`)
- 서버 조회: `apps/api/src/lib/g5-db.ts` — `getNotifyConfig()` (read-only,
  `g5_config` + `g5_shop_default`)
- 라우트: `apps/api/src/routes/admin-orders.ts` — `GET /api/admin/orders/notify-config`
- FE 훅·헬퍼: `apps/web/src/admin/useAdminOrders.ts` — `useAdminNotifyConfig()`,
  `smsAvailableForTarget()`
- 게이트 적용: `OrderActionBar.vue`(목록), `OrderDetailDrawer.vue`(상세) —
  체크박스 `v-if`에 `mailAvailable` / `smsAvailable` 결합

## 참고 — 현재 로컬 설정에서의 결과

로컬 XAMPP(`samplepcb`) DB 기준 `cf_sms_use=''`, `de_sms_use4/5=0`, `cf_email_use=1`.
따라서 지금은 **메일 체크박스만 노출되고 SMS는 목록·상세 모두 숨는다**(정상).
운영에서 SMS를 쓰려면 그누보드 기본환경설정 `cf_sms_use='icode'` + icode 계정,
영카트 쇼핑몰설정에서 입금/배송 SMS(`de_sms_use4/5`) 활성화가 필요하다.
